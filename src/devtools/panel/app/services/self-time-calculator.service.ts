/**
 * SelfTimeCalculatorService
 *
 * Calculates self-time vs. child-time for components in a render cascade.
 * This is critical for the flame graph — it answers:
 * - How much time did this component spend in its own logic?
 * - How much time was spent in children?
 *
 * Self-time = Total - ChildTime
 */

import { Injectable } from '@angular/core';
import type { RenderEvent } from '../../../../types/render-events';
import type { RenderSpan, ChangeDetectionCycle, TimingMetrics } from '../../../../types/render-profile';

@Injectable({ providedIn: 'root' })
export class SelfTimeCalculatorService {
  /**
   * Calculate self-time for all render spans in a change detection cycle.
   * Returns updated spans with selfTime and childTime calculated.
   */
  calculateSelfTimeForCycle(cycle: ChangeDetectionCycle): RenderSpan[] {
    // Build a tree of spans for easy traversal
    const spanMap = new Map<string, RenderSpan>();
    for (const span of cycle.renders) {
      spanMap.set(span.id, span);
    }

    // Calculate child time for each span
    for (const span of cycle.renders) {
      let childTime = 0;

      // Sum all children's durations
      for (const childId of span.children) {
        const childSpan = spanMap.get(childId);
        if (childSpan) {
          childTime += childSpan.duration;
        }
      }

      span.childTime = childTime;
      span.selfTime = Math.max(0, span.duration - childTime);
    }

    return cycle.renders;
  }

  /**
   * Calculate self-time from a cascade of render events.
   * Used when building the flame graph from raw render events.
   *
   * Algorithm:
   * 1. Sort events by timestamp
   * 2. Build parent-child relationships based on timing + component tree
   * 3. For each parent, sum child durations to get child-time
   * 4. Self-time = total - child-time
   */
  calculateSelfTimeFromEvents(renders: RenderEvent[]): Map<string, { selfTime: number; childTime: number }> {
    const result = new Map<string, { selfTime: number; childTime: number }>();

    // Sort by timestamp, then by depth (top-level first)
    const sorted = [...renders].sort((a, b) => {
      const timeDiff = a.timestamp - b.timestamp;
      if (timeDiff !== 0) return timeDiff;
      return (a.depth || 0) - (b.depth || 0);
    });

    // Group by timestamp (same CD cycle)
    const cycleGroups = this.groupByCycle(sorted);

    for (const group of cycleGroups) {
      // Within this cycle, calculate timing
      const timingData = this.calculateTimingInCycle(group);
      for (const [componentName, timing] of timingData) {
        result.set(componentName, timing);
      }
    }

    return result;
  }

  /**
   * Group render events into change detection cycles.
   * Events within 50ms of the first event are in the same cycle.
   */
  private groupByCycle(renders: RenderEvent[]): RenderEvent[][] {
    if (renders.length === 0) return [];

    const groups: RenderEvent[][] = [];
    let currentGroup: RenderEvent[] = [];
    let cycleStart = renders[0].timestamp;

    for (const render of renders) {
      if (render.timestamp - cycleStart > 50) {
        // Start new cycle
        groups.push(currentGroup);
        currentGroup = [];
        cycleStart = render.timestamp;
      }
      currentGroup.push(render);
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Calculate timing breakdown within a single CD cycle.
   * Returns map of component name → {selfTime, childTime}
   */
  private calculateTimingInCycle(
    cycleRenders: RenderEvent[]
  ): Map<string, { selfTime: number; childTime: number }> {
    const result = new Map<string, { selfTime: number; childTime: number }>();

    // Build parent-child relationships
    const childrenOf = new Map<string, RenderEvent[]>();
    const componentTimings = new Map<string, number>();

    for (const render of cycleRenders) {
      componentTimings.set(render.componentName, render.duration);

      if (render.parentComponent) {
        if (!childrenOf.has(render.parentComponent)) {
          childrenOf.set(render.parentComponent, []);
        }
        childrenOf.get(render.parentComponent)!.push(render);
      }
    }

    // Calculate child time for each component
    for (const render of cycleRenders) {
      let childTime = 0;

      const children = childrenOf.get(render.componentName) || [];
      for (const child of children) {
        childTime += child.duration;
      }

      const selfTime = Math.max(0, render.duration - childTime);

      result.set(render.componentName, { selfTime, childTime });
    }

    return result;
  }

  /**
   * Calculate timing metrics for a render span (for flame graph visualization).
   */
  calculateTimingMetrics(span: RenderSpan, parentDuration: number = 0): TimingMetrics {
    const total = span.duration;
    const selfTime = span.selfTime;
    const childTime = span.childTime;

    const percentOfParent = parentDuration > 0 ? (total / parentDuration) * 100 : 100;
    const isSlow = total > 16; // > 16ms is considered slow (60fps budget)
    const frameBudgetExceeded = total > 16.67; // 60fps frame budget

    return {
      total,
      selfTime,
      childTime,
      percentOfParent,
      isSlow,
      frameBudgetExceeded,
    };
  }

  /**
   * Build a hierarchical tree of render spans with timing calculated.
   * Used by flame graph component for rendering.
   */
  buildTimingHierarchy(rootSpan: RenderSpan, spanMap: Map<string, RenderSpan>): RenderSpan {
    // Recursively build children with timing
    const buildChild = (span: RenderSpan): RenderSpan => {
      const children = span.children.map((childId: string) => {
        const childSpan = spanMap.get(childId);
        return childSpan ? buildChild(childSpan) : null;
      });

      return {
        ...span,
        children: children.filter((c: RenderSpan | null): c is RenderSpan => c !== null).map((c: RenderSpan) => c.id),
      };
    };

    return buildChild(rootSpan);
  }

  /**
   * Validate timing calculations (sanity check).
   * Returns array of issues found.
   */
  validateTimings(spans: RenderSpan[]): string[] {
    const issues: string[] = [];

    for (const span of spans) {
      // Check: selfTime + childTime <= total (within rounding error)
      const calculatedTotal = span.selfTime + span.childTime;
      const diff = Math.abs(calculatedTotal - span.duration);
      if (diff > 0.5) {
        // Allow 0.5ms rounding error
        issues.push(
          `${span.componentName}: Timing mismatch. Self (${span.selfTime.toFixed(1)}ms) + Child (${span.childTime.toFixed(1)}ms) = ${calculatedTotal.toFixed(1)}ms, but total is ${span.duration.toFixed(1)}ms`
        );
      }

      // Check: selfTime >= 0 and childTime >= 0
      if (span.selfTime < 0) {
        issues.push(`${span.componentName}: Negative self-time (${span.selfTime.toFixed(1)}ms)`);
      }
      if (span.childTime < 0) {
        issues.push(`${span.componentName}: Negative child-time (${span.childTime.toFixed(1)}ms)`);
      }

      // Check: duration > 0
      if (span.duration <= 0) {
        issues.push(`${span.componentName}: Duration is zero or negative (${span.duration.toFixed(1)}ms)`);
      }
    }

    return issues;
  }

  /**
   * Find components that are "time sinks" (spend most time in children, not themselves).
   * These are good candidates for OnPush optimization.
   */
  findTimeRelayComponents(spans: RenderSpan[]): Map<string, number> {
    const relayComponents = new Map<string, number>();

    for (const span of spans) {
      if (span.childTime > 0) {
        const childPercentage = (span.childTime / span.duration) * 100;
        if (childPercentage > 80) {
          // >80% of time spent in children
          relayComponents.set(span.componentName, childPercentage);
        }
      }
    }

    // Sort by percentage descending
    return new Map(Array.from(relayComponents).sort((a, b) => b[1] - a[1]));
  }

  /**
   * Find components that are "CPU sinks" (spend most time in themselves, not children).
   * These are good candidates for code optimization or memoization.
   */
  findCpuSinkComponents(spans: RenderSpan[]): Map<string, number> {
    const cpuSinks = new Map<string, number>();

    for (const span of spans) {
      if (span.selfTime > 0) {
        const selfPercentage = (span.selfTime / span.duration) * 100;
        if (selfPercentage > 80) {
          // >80% of time in own logic
          cpuSinks.set(span.componentName, selfPercentage);
        }
      }
    }

    // Sort by percentage descending
    return new Map(Array.from(cpuSinks).sort((a, b) => b[1] - a[1]));
  }
}

/**
 * RenderProfileBuilderService
 *
 * Transforms raw render events and execution steps into a complete RenderProfile.
 * This is the core data transformation layer for the Render Inspector.
 *
 * Responsibilities:
 * 1. Group render events into change detection cycles
 * 2. Build parent-child component hierarchy
 * 3. Calculate timing metrics (self-time, child-time)
 * 4. Aggregate per-component statistics
 * 5. Detect performance issues
 * 6. Collect evidence and confidence scores
 */

import { Injectable, inject } from '@angular/core';
import type { RenderEvent, FlowEvent, RenderCause } from '../../../../types/render-events';
import type {
  RenderProfile,
  ChangeDetectionCycle,
  RenderSpan,
  ComponentProfile,
  PerformanceIssue,
  ProfileTrigger,
  UserInteraction,
} from '../../../../types/render-profile';
import type { ExecutionStep } from '../../../../types/execution-intelligence';
import { SelfTimeCalculatorService } from './self-time-calculator.service';
import { EvidenceCollectorService } from './evidence-collector.service';

@Injectable({ providedIn: 'root' })
export class RenderProfileBuilderService {
  private readonly selfTimeCalc = inject(SelfTimeCalculatorService);
  private readonly evidenceCollector = inject(EvidenceCollectorService);

  /**
   * Build a complete RenderProfile from raw events.
   */
  buildProfile(
    renders: RenderEvent[],
    flows: FlowEvent[],
    executionSteps: ExecutionStep[],
    profileId: string,
    trigger?: ProfileTrigger
  ): RenderProfile {
    const startTime = Math.min(...renders.map(r => r.timestamp), ...flows.map(f => f.timestamp));
    const endTime = Math.max(...renders.map(r => r.timestamp), ...flows.map(f => f.timestamp));

    // Group renders into CD cycles
    const cycles = this.buildChangeDetectionCycles(renders, executionSteps);

    // Build per-component profiles
    const components = this.buildComponentProfiles(renders);

    // Extract user interactions
    const interactions = this.extractUserInteractions(renders);

    // Detect performance issues
    const issues = this.detectPerformanceIssues(renders, cycles);

    return {
      id: profileId,
      startTime,
      endTime,
      duration: endTime - startTime,
      trigger: trigger || this.inferTrigger(renders, flows),
      changeDetectionCycles: cycles,
      components,
      interactions,
      issues,
      metadata: {
        angularVersion: 17, // TODO: detect from page
        mode: 'development', // TODO: detect from page
        zoneless: false, // TODO: detect from page
        frameId: renders[0]?.frameId || 0,
      },
    };
  }

  /**
   * Group render events into change detection cycles.
   * Uses timing: events within 50ms of first event are in same cycle.
   */
  private buildChangeDetectionCycles(
    renders: RenderEvent[],
    steps: ExecutionStep[]
  ): ChangeDetectionCycle[] {
    if (renders.length === 0) return [];

    const cycles: ChangeDetectionCycle[] = [];
    let cycleNumber = 0;

    // Group renders by time windows (50ms = approximate CD cycle duration)
    const sorted = [...renders].sort((a, b) => a.timestamp - b.timestamp);
    const groups = this.groupByTimeWindow(sorted, 50);

    for (const group of groups) {
      const cycle = this.buildCycle(group, steps, cycleNumber++);
      cycles.push(cycle);
    }

    return cycles;
  }

  /**
   * Build a single change detection cycle.
   */
  private buildCycle(renders: RenderEvent[], steps: ExecutionStep[], sequenceNumber: number): ChangeDetectionCycle {
    const startTime = Math.min(...renders.map(r => r.timestamp));
    const endTime = Math.max(...renders.map(r => r.timestamp + r.duration));

    // Build render spans
    const spans = this.buildRenderSpans(renders);

    // Calculate self-time and child-time
    this.selfTimeCalc.calculateSelfTimeForCycle({
      id: `cycle-${sequenceNumber}`,
      sequenceNumber,
      startTime,
      endTime,
      duration: endTime - startTime,
      renders: spans,
      topLevelRenders: spans.filter(s => s.isTopLevel).map(s => s.componentName),
      componentCount: spans.length,
      isSynchronous: endTime - startTime < 50,
    });

    // Infer trigger from render causes
    const trigger = this.inferCycleTrigger(renders, steps);

    return {
      id: `cycle-${sequenceNumber}`,
      sequenceNumber,
      startTime,
      endTime,
      duration: endTime - startTime,
      trigger,
      renders: spans,
      topLevelRenders: spans.filter(s => s.isTopLevel).map(s => s.componentName),
      componentCount: spans.length,
      isSynchronous: endTime - startTime < 50,
    };
  }

  /**
   * Build render spans from events, establishing parent-child relationships.
   */
  private buildRenderSpans(renders: RenderEvent[]): RenderSpan[] {
    const spans: RenderSpan[] = [];
    let spanId = 0;

    // Build spans with parent-child relationships from event data
    for (const render of renders) {
      const span: RenderSpan = {
        id: `span-${spanId++}`,
        componentName: render.componentName,
        startTime: render.timestamp,
        endTime: render.timestamp + render.duration,
        duration: render.duration,
        selfTime: render.duration, // Will be recalculated
        childTime: 0, // Will be recalculated
        parentId: undefined,
        children: [],
        causes: render.causes,
        reasons: render.reasons || [],
        evidence: [],
        isTopLevel: !render.parentComponent,
        isHotspot: false,
        severity: this.calculateSeverity(render.duration, render.cdCount),
        metrics: {
          renderCount: 1,
          averageRenderTime: render.duration,
          totalRenderTime: render.duration,
          cdMer: render.cdCount || 0,
          inputCount: 0, // TODO: from component introspection
          outputCount: 0, // TODO: from component introspection
          templateBindings: render.totalTemplateBindings || 0,
          usesOnPush: false, // TODO: from component metadata
          hasCustomChangeDetection: false,
        },
      };

      spans.push(span);
    }

    // Link parent-child relationships
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      const render = renders[i];

      if (render.parentComponent) {
        // Find parent span
        const parentSpan = spans.find(s => s.componentName === render.parentComponent);
        if (parentSpan) {
          span.parentId = parentSpan.id;
          parentSpan.children.push(span.id);
        }
      }
    }

    return spans;
  }

  /**
   * Build per-component profiles (aggregations across all renders).
   */
  private buildComponentProfiles(renders: RenderEvent[]): ComponentProfile[] {
    const componentMap = new Map<string, RenderEvent[]>();

    // Group renders by component name
    for (const render of renders) {
      if (!componentMap.has(render.componentName)) {
        componentMap.set(render.componentName, []);
      }
      componentMap.get(render.componentName)!.push(render);
    }

    // Build profiles
    const profiles: ComponentProfile[] = [];
    for (const [componentName, rendersForComponent] of componentMap) {
      const totalRenderTime = rendersForComponent.reduce((sum, r) => sum + r.duration, 0);
      const avgRenderTime = totalRenderTime / rendersForComponent.length;

      // Determine primary cause
      const causeCounts: Record<string, number> = {
        signal: 0,
        input: 0,
        zone: 0,
        parent: 0,
        'manual-cd': 0,
      };

      for (const render of rendersForComponent) {
        for (const cause of render.causes) {
          const key = cause.type as keyof typeof causeCounts;
          if (key in causeCounts) {
            causeCounts[key]++;
          }
        }
      }

      const primaryCause = Object.entries(causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

      profiles.push({
        componentName,
        renderCount: rendersForComponent.length,
        totalRenderTime,
        averageRenderTime: avgRenderTime,
        totalSelfTime: 0, // Will be filled from spans
        totalChildTime: 0, // Will be filled from spans
        primaryCause: primaryCause as any,
        causesBreakdown: causeCounts as Record<RenderCause['type'], number>,
        isHotspot: rendersForComponent.length >= 3 || avgRenderTime > 16,
        parents: this.extractParents(rendersForComponent),
        children: this.extractChildren(rendersForComponent),
        metrics: {
          renderCount: rendersForComponent.length,
          averageRenderTime: avgRenderTime,
          totalRenderTime,
          inputCount: 0,
          outputCount: 0,
          templateBindings: Math.max(...rendersForComponent.map(r => r.totalTemplateBindings || 0)),
          usesOnPush: false,
          hasCustomChangeDetection: false,
        },
      });
    }

    return profiles;
  }

  /**
   * Group events by time window.
   */
  private groupByTimeWindow<T extends { timestamp: number }>(events: T[], windowMs: number): T[][] {
    if (events.length === 0) return [];

    const groups: T[][] = [];
    let currentGroup: T[] = [events[0]];
    let windowStart = events[0].timestamp;

    for (let i = 1; i < events.length; i++) {
      if (events[i].timestamp - windowStart > windowMs) {
        groups.push(currentGroup);
        currentGroup = [events[i]];
        windowStart = events[i].timestamp;
      } else {
        currentGroup.push(events[i]);
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Calculate severity level for a render.
   */
  private calculateSeverity(duration: number, cdCount?: number): 'high' | 'medium' | 'low' | 'none' {
    if (duration > 16) return 'high'; // Exceeds frame budget
    if (duration > 8) return 'medium';
    if (duration > 2) return 'low';
    return 'none';
  }

  /**
   * Extract parent components from renders.
   */
  private extractParents(renders: RenderEvent[]): string[] {
    const parents = new Set<string>();
    for (const render of renders) {
      if (render.parentComponent) {
        parents.add(render.parentComponent);
      }
    }
    return Array.from(parents);
  }

  /**
   * Extract child components from renders.
   */
  private extractChildren(renders: RenderEvent[]): string[] {
    // This would require full component tree, which we don't have from just these renders
    return [];
  }

  /**
   * Extract user interactions from renders.
   */
  private extractUserInteractions(renders: RenderEvent[]): UserInteraction[] {
    const interactions: UserInteraction[] = [];

    for (const render of renders) {
      if (render.interactionTarget && render.interactionComponent) {
        interactions.push({
          type: 'click', // Inferred; could be enhanced with actual event type
          selector: render.interactionTarget,
          componentName: render.interactionComponent,
          timestamp: render.timestamp,
        });
      }
    }

    return interactions;
  }

  /**
   * Detect performance issues in the profile.
   */
  private detectPerformanceIssues(renders: RenderEvent[], cycles: ChangeDetectionCycle[]): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];
    let issueId = 0;

    // Issue: Slow renders (>16ms)
    for (const render of renders) {
      if (render.duration > 16) {
        issues.push({
          id: `issue-${issueId++}`,
          severity: render.duration > 50 ? 'critical' : 'warning',
          type: 'slow-render',
          componentName: render.componentName,
          title: `${render.componentName} render took ${render.duration.toFixed(1)}ms`,
          description: `This component render exceeded the 60fps frame budget (16.67ms). Consider optimizing change detection or using OnPush strategy.`,
          timestamp: render.timestamp,
          suggestion: 'Use ChangeDetectionStrategy.OnPush to reduce unnecessary renders.',
        });
      }
    }

    // Issue: Excessive renders
    const renderCounts = new Map<string, number>();
    for (const render of renders) {
      renderCounts.set(render.componentName, (renderCounts.get(render.componentName) || 0) + 1);
    }

    for (const [componentName, count] of renderCounts) {
      if (count >= 5) {
        issues.push({
          id: `issue-${issueId++}`,
          severity: count > 10 ? 'critical' : 'warning',
          type: 'excessive-renders',
          componentName,
          title: `${componentName} rendered ${count} times`,
          description: `This component rendered excessively during this profile. This may indicate reactive cascades or change detection inefficiency.`,
          timestamp: 0, // Aggregated
          suggestion: 'Review what causes this component to render. Consider OnPush or memoization.',
        });
      }
    }

    return issues;
  }

  /**
   * Infer trigger from render events.
   */
  private inferTrigger(renders: RenderEvent[], flows: FlowEvent[]): ProfileTrigger {
    // Look for user interaction
    const withInteraction = renders.find(r => r.interactionComponent && r.interactionTarget);
    if (withInteraction) {
      return {
        type: 'user-interaction',
        element: withInteraction.interactionTarget || '',
        eventType: 'click',
        selector: withInteraction.interactionTarget || '',
      };
    }

    // Look for API response
    const apiFlow = flows.find(f => f.type === 'http-response');
    if (apiFlow) {
      return {
        type: 'api-response',
        url: apiFlow.detail || 'API',
        method: apiFlow.detail?.split(' ')[0] || 'GET',
        status: 200,
      };
    }

    return { type: 'unknown' };
  }

  /**
   * Infer trigger for a specific CD cycle.
   */
  private inferCycleTrigger(renders: RenderEvent[], steps: ExecutionStep[]) {
    const firstRender = renders[0];
    if (!firstRender) return undefined;

    const causes = firstRender.causes || [];
    if (causes.length > 0) {
      return {
        type: causes[0].type as 'signal' | 'input' | 'parent' | 'zone' | 'api' | 'route' | 'unknown',
        source: causes[0].source,
        timestamp: firstRender.timestamp,
      };
    }

    return undefined;
  }
}

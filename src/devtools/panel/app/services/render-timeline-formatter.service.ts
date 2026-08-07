/**
 * Render Timeline Formatter
 *
 * CORE SERVICE: Stage 3 of the 3-stage pipeline.
 *
 * Converts raw analysis results (RenderTimeline) into UI-ready format.
 *
 * Outputs:
 * - Waterfall bars (for timeline visualization)
 * - Component cascade (for tree view)
 * - Hotspot summary (for overview tab)
 * - Per-component metrics
 *
 * NO business logic. Pure data transformation for display.
 */

import { Injectable } from '@angular/core';

// ============================================================================
// UI TYPES
// ============================================================================

export interface WaterfallBar {
  id: string;
  componentName: string;
  startMs: number;
  durationMs: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  renderCount: number;
  causedBy: string[];
  impactCount: number;
}

export interface ComponentCascadeNode {
  componentName: string;
  renderCount: number;
  totalDuration: number;
  severity: string;
  children: ComponentCascadeNode[];
}

export interface RenderHotspot {
  componentName: string;
  renderCount: number;
  severity: string;
  impact: number;
}

export interface TimelineDisplayData {
  waterfallBars: WaterfallBar[];
  cascade: ComponentCascadeNode[];
  hotspots: RenderHotspot[];
  summary: {
    overallHealth: number;
    totalRenders: number;
    totalDuration: number;
    hotspotCount: number;
  };
}

// ============================================================================
// FORMATTER SERVICE
// ============================================================================

@Injectable({ providedIn: 'root' })
export class RenderTimelineFormatter {
  /**
   * Format analysis timeline into UI-ready data.
   */
  format(timeline: any): TimelineDisplayData {
    // Extract waterfall bars from steps
    const waterfallBars = this.buildWaterfallBars(timeline.steps);

    // Build component cascade tree
    const cascade = this.buildCascadeTree(timeline.steps);

    // Find hotspots (components with excessive renders)
    const hotspots = this.findHotspots(timeline.steps);

    // Build summary
    const summary = {
      overallHealth: timeline.overallHealthScore,
      totalRenders: timeline.steps.reduce((sum: number, s: any) => sum + s.renderCount, 0),
      totalDuration: timeline.steps.reduce((sum: number, s: any) => sum + s.duration, 0),
      hotspotCount: timeline.hotspotComponentCount,
    };

    return {
      waterfallBars,
      cascade,
      hotspots,
      summary,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Waterfall Building
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Convert render steps into horizontal bar chart data.
   */
  private buildWaterfallBars(steps: any[]): WaterfallBar[] {
    // Find min timestamp to calculate relative offsets
    const minTime = Math.min(...steps.map((s: any) => s.timestamp));

    return steps.map((step: any) => ({
      id: step.id,
      componentName: step.componentName,
      startMs: step.timestamp - minTime, // Relative to first event
      durationMs: step.duration,
      severity: step.hotspotSeverity,
      renderCount: step.renderCount,
      causedBy: step.causes,
      impactCount: step.impactedComponents.length,
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Cascade Building
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build component tree showing hierarchy.
   *
   * Since we don't have explicit parent-child relationships in the flat event stream,
   * we build a simple tree ordered by render frequency.
   */
  private buildCascadeTree(steps: any[]): ComponentCascadeNode[] {
    const componentStats = new Map<string, { renderCount: number; totalDuration: number; severity: string }>();

    // Aggregate stats per component
    for (const step of steps) {
      const existing = componentStats.get(step.componentName) || {
        renderCount: 0,
        totalDuration: 0,
        severity: 'low',
      };
      existing.renderCount += step.renderCount;
      existing.totalDuration += step.duration;
      existing.severity = this.calculateSeverity(existing.renderCount);
      componentStats.set(step.componentName, existing);
    }

    // Convert to sorted nodes (high render count first)
    const nodes: ComponentCascadeNode[] = Array.from(componentStats.entries())
      .sort((a, b) => b[1].renderCount - a[1].renderCount)
      .map(([componentName, stats]) => ({
        componentName,
        renderCount: stats.renderCount,
        totalDuration: stats.totalDuration,
        severity: stats.severity,
        children: [], // Phase 2: No nested tree building yet
      }));

    return nodes;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Hotspot Finding
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Find components with excessive renders (hotspots).
   */
  private findHotspots(steps: any[]): RenderHotspot[] {
    const componentStats = new Map<string, { renderCount: number; impact: number; severity: string }>();

    for (const step of steps) {
      const existing = componentStats.get(step.componentName) || {
        renderCount: 0,
        impact: 0,
        severity: 'low',
      };
      existing.renderCount += step.renderCount;
      existing.impact += step.impactedComponents.length;
      existing.severity = this.calculateSeverity(existing.renderCount);
      componentStats.set(step.componentName, existing);
    }

    // Return top hotspots (high render count or high impact)
    const hotspots = Array.from(componentStats.entries())
      .filter(([_, stats]) => stats.severity === 'high' || stats.severity === 'critical')
      .map(([componentName, stats]) => ({
        componentName,
        renderCount: stats.renderCount,
        severity: stats.severity,
        impact: stats.impact,
      }))
      .sort((a, b) => b.renderCount - a.renderCount);

    return hotspots;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private calculateSeverity(renderCount: number): string {
    if (renderCount <= 1) return 'low';
    if (renderCount <= 5) return 'medium';
    if (renderCount <= 15) return 'high';
    return 'critical';
  }
}

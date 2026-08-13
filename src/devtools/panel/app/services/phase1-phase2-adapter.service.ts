/**
 * Phase 1 & Phase 2 Adapter Service
 * 
 * Transforms ExecutionNarrative data into component-specific inputs.
 * Handles mapping from complex data models to UI-ready data structures.
 */
import { Injectable } from '@angular/core';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';
import type { StickyExecutionMetrics } from '../features/execution-explorer/components/sticky-summary/sticky-summary.component';
import type { HeadlineData } from '../features/execution-explorer/components/execution-headline/execution-headline.component';
import type { HotspotsData, Hotspot } from '../features/execution-explorer/components/hotspots-list/hotspots-list.component';
import type { APIPhase, APICall } from '../features/execution-explorer/components/api-timeline/api-timeline.component';
import type { ComponentMetrics, RenderReason } from '../features/execution-explorer/components/component-card/component-card.component';
import type { FocusData, ExecutionStep } from '../features/execution-explorer/components/focus-mode/focus-mode.component';

@Injectable({ providedIn: 'root' })
export class Phase1Phase2AdapterService {
  /**
   * Transform ExecutionNarrative → StickyExecutionSummary metrics
   */
  toStickyMetrics(narrative: ExecutionNarrative | null): StickyExecutionMetrics {
    if (!narrative) {
      return {
        totalTime: 0,
        slowRenderCount: 0,
        warningCount: 0,
        retryCount: 0,
      };
    }

    // Count slow renders from chapters
    const slowRenderCount = narrative.chapters?.filter((c: any) => c.duration > 500).length || 0;

    // Count warnings from insights
    const warningCount = narrative.insights?.filter((i: any) => i.type === 'warning').length || 0;

    // Count retries from observations (heuristic: contains "retry" or "failed")
    const retryCount = narrative.observations?.filter((o: any) => 
      o.toLowerCase().includes('retry') || o.toLowerCase().includes('failed')
    ).length || 0;

    // Total components rendered
    let totalComponents = 0;
    narrative.chapters?.forEach((c: any) => {
      totalComponents += c.metrics?.componentRenders?.count || 0;
    });

    // Total signals
    let totalSignals = 0;
    narrative.chapters?.forEach((c: any) => {
      totalSignals += c.metrics?.signalEmissions?.count || 0;
    });

    return {
      totalTime: narrative.duration || 0,
      slowRenderCount,
      warningCount,
      retryCount,
      otherMetrics: {
        signalsChanged: totalSignals,
        storesAffected: 0, // Could be tracked from chapters
        componentsRendered: totalComponents,
      },
    };
  }

  /**
   * Transform ExecutionNarrative → ExecutionHeadline
   */
  toHeadline(narrative: ExecutionNarrative | null): HeadlineData | null {
    if (!narrative) return null;

    const slowRenderCount = narrative.chapters?.filter((c: any) => c.duration > 500).length || 0;
    const warningCount = narrative.insights?.filter((i: any) => i.type === 'warning').length || 0;

    // Extract headline from narrative text
    const headline = narrative.title || narrative.executionNarrative?.split('.')[0] || 'Execution occurred';

    // Extract reason from narrative
    const reason = this.extractReasonFromNarrative(narrative);

    // Impact: number of components
    const impact = `${narrative.metrics?.totalComponents || 0} components affected`;

    // Assessment
    const status = slowRenderCount > 0 ? 'slow' : warningCount > 0 ? 'warning' : 'fast';
    const message = this.assessmentMessage(narrative.duration || 0);

    return {
      headline,
      reason,
      impact,
      assessment: {
        status,
        message,
      },
    };
  }

  /**
   * Transform ExecutionNarrative → HotspostsList
   */
  toHotspots(narrative: ExecutionNarrative | null): HotspotsData | null {
    if (!narrative) return null;

    const slowRenders: Hotspot[] = narrative.chapters?.slice(0, 3).map((c: any, i: number) => ({
      id: `slow-${i}`,
      component: c.domain?.name || 'Unknown',
      metric: `${c.metrics?.componentRenders?.count || 0}x, ${c.duration.toFixed(0)}ms`,
      reason: c.summary || 'Chapter execution',
      action: c.duration > 500 ? 'Slower than expected' : 'Review needed',
      severity: 'slow' as const,
    })) || [];

    const warnings: Hotspot[] = narrative.insights?.slice(0, 2).map((w: any, i: number) => ({
      id: `warn-${i}`,
      component: w.type?.charAt(0).toUpperCase() + w.type?.slice(1) || 'Issue',
      metric: '1',
      reason: w.message || 'Issue detected',
      action: 'Review needed',
      severity: 'warning' as const,
    })) || [];

    return {
      slowRenders,
      warnings,
      info: [],
    };
  }

  /**
   * Transform ExecutionNarrative → APITimeline
   */
  toAPITimeline(narrative: ExecutionNarrative | null): APIPhase[] {
    if (!narrative) return [];

    // Group APIs by execution chapter
    // For now, create phases based on chapters
    const phases: APIPhase[] = [];

    narrative.chapters?.forEach((chapter: any, idx: number) => {
      const apiCount = chapter.metrics?.apiCalls?.count || 0;
      if (apiCount > 0) {
        phases.push({
          id: `phase-${idx}`,
          name: chapter.domain?.name || `Phase ${idx + 1}`,
          timing: {
            start: chapter.startTime || 0,
            end: chapter.endTime || 0,
            duration: chapter.duration || 0,
          },
          status: chapter.duration > 500 ? 'warning' : 'success',
          statusCount: {
            success: apiCount,
            retried: 0,
            failed: 0,
          },
          apis: (chapter.metrics?.apiCalls?.endpoints || []).map((endpoint: string, i: number) => ({
            id: `api-${idx}-${i}`,
            method: 'GET',
            endpoint,
            status: 200,
            duration: chapter.duration || 0,
            timestamp: chapter.startTime || 0,
            isRetry: false,
          } as APICall)),
          summary: `${apiCount} API call(s)`,
        });
      }
    });

    return phases;
  }

  /**
   * Transform Chapter → ComponentMetrics
   */
  toComponentCard(chapter: any): ComponentMetrics {
    const renderCount = chapter.metrics?.componentRenders?.count || 1;
    const totalDuration = chapter.duration || 0;
    const signalEmissions = chapter.metrics?.signalEmissions?.count || 0;
    const storeUpdates = chapter.metrics?.storeUpdates?.count || 0;
    const apiCalls = chapter.metrics?.apiCalls?.count || 0;

    const reasons: RenderReason[] = [];
    if (signalEmissions > 0) {
      reasons.push({
        type: 'signal',
        description: `Signal emitted ${signalEmissions} time(s)`,
        count: signalEmissions,
      });
    }
    if (storeUpdates > 0) {
      reasons.push({
        type: 'store',
        description: `Store updated ${storeUpdates} property(s)`,
        count: storeUpdates,
      });
    }
    if (apiCalls > 0) {
      reasons.push({
        type: 'props',
        description: `API call completed`,
        count: apiCalls,
      });
    }

    return {
      name: chapter.domain?.name || chapter.summary || 'Unknown',
      renderCount,
      totalDuration,
      averageDuration: renderCount > 0 ? totalDuration / renderCount : 0,
      reasons,
      performance: totalDuration > 500 ? 'slow' : totalDuration > 100 ? 'warning' : 'fast',
      affectedChildren: chapter.metrics?.componentRenders?.componentNames?.length || 0,
    };
  }

  /**
   * Transform narrative into FocusMode data
   */
  toFocusData(narrative: ExecutionNarrative | null, componentName: string): FocusData | null {
    if (!narrative) return null;

    const chapter = narrative.chapters?.find((c: any) => c.domain?.name === componentName);

    const executionPath: ExecutionStep[] = [
      {
        time: 0,
        description: 'Execution started',
        type: 'render',
        icon: '▶',
      },
      ...narrative.observations?.map((o: any, i: number) => ({
        time: i * 10,
        description: o,
        type: 'signal' as const,
        icon: '◆',
      })) || [],
    ];

    return {
      componentName,
      executionPath,
      affectedStores: [],
      affectedSignals: [],
      childComponents: [],
      totalDuration: chapter?.duration || narrative.duration || 0,
      renderCount: chapter?.metrics?.componentRenders?.count || 1,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private extractReasonFromNarrative(narrative: ExecutionNarrative): string {
    // Try to extract from narrative text
    if (narrative.executionNarrative) {
      const parts = narrative.executionNarrative.split('because');
      if (parts.length > 1) {
        return 'Because ' + parts[1].split('.')[0].trim();
      }
      return narrative.executionNarrative.split('.')[0];
    }

    // Extract from observations
    if (narrative.observations?.length > 0) {
      return narrative.observations[0];
    }

    // Extract from chapters
    if (narrative.chapters?.length > 0) {
      return narrative.chapters[0].summary || 'Execution occurred';
    }

    return 'Unknown cause';
  }

  private assessmentMessage(duration: number): string {
    if (duration > 500) {
      return `${duration.toFixed(0)}ms (slow, expected <500ms)`;
    } else if (duration > 100) {
      return `${duration.toFixed(0)}ms (warning, near threshold)`;
    } else {
      return `${duration.toFixed(0)}ms (good)`;
    }
  }
}

/**
 * Insight Engine Service
 * 
 * Automatically detects anomalies, anti-patterns, and performance issues.
 * Generates actionable insights from execution stories.
 * 
 * Detects:
 * - Duplicate API calls
 * - Large payloads
 * - Slow renders (> 16ms)
 * - Excessive renders
 * - Infinite loops (rapid emissions)
 * - Memory leaks
 * - Performance issues
 * - Best practices
 */

import { Injectable } from '@angular/core';
import type {
  ExecutionStory,
  ExecutionStep,
  InsightMessage,
  RuntimeEvent,
  InsightSeverity,
  InsightCategory,
} from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class InsightEngineService {
  /**
   * Generate insights for a story.
   */
  generateInsights(story: ExecutionStory, eventMap: Map<string, RuntimeEvent>): InsightMessage[] {
    const insights: InsightMessage[] = [];

    // Run all detection algorithms
    insights.push(...this.detectDuplicateApis(story));
    insights.push(...this.detectLargePayloads(story, eventMap));
    insights.push(...this.detectSlowRenders(story));
    insights.push(...this.detectExcessiveRenders(story));
    insights.push(...this.detectInfiniteLoops(story, eventMap));
    insights.push(...this.detectPerformanceIssues(story));
    insights.push(...this.detectBestPractices(story));

    // Sort by severity
    return insights.sort((a, b) => this.severityToNumber(b.severity) - this.severityToNumber(a.severity));
  }

  /**
   * Detect duplicate API calls in the story.
   */
  private detectDuplicateApis(story: ExecutionStory): InsightMessage[] {
    const insights: InsightMessage[] = [];
    const apiCalls = new Map<string, string[]>(); // URL → [stepIds]

    for (const step of story.steps) {
      if (step.type === 'data-fetch') {
        const url = this.extractApiUrl(step.title, step.summary);
        if (url) {
          if (!apiCalls.has(url)) {
            apiCalls.set(url, []);
          }
          apiCalls.get(url)!.push(step.id);
        }
      }
    }

    // Find duplicates
    for (const [url, stepIds] of apiCalls) {
      if (stepIds.length > 1) {
        insights.push({
          id: `insight-dup-${Date.now()}-${Math.random()}`,
          category: 'duplicate-api',
          severity: 'warning',
          title: `Duplicate API call detected`,
          description: `${url} was called ${stepIds.length} times in this session`,
          affectedSteps: stepIds,
          recommendation: 'Consider caching the API response or using a single fetch strategy',
        });
      }
    }

    return insights;
  }

  /**
   * Detect large payloads that could impact performance.
   */
  private detectLargePayloads(story: ExecutionStory, eventMap: Map<string, RuntimeEvent>): InsightMessage[] {
    const insights: InsightMessage[] = [];
    const largePayloads: { stepId: string; size: number }[] = [];

    for (const step of story.steps) {
      if (step.type === 'data-fetch') {
        const events = step.eventIds
          .map(id => eventMap.get(id))
          .filter((e): e is RuntimeEvent => !!e);

        for (const event of events) {
          if (event.responseBody) {
            const size = event.responseBody.length;
            // Flag payloads > 100KB
            if (size > 102400) {
              largePayloads.push({ stepId: step.id, size });
            }
          }
        }
      }
    }

    if (largePayloads.length > 0) {
      const totalSize = largePayloads.reduce((sum, p) => sum + p.size, 0);
      insights.push({
        id: `insight-large-${Date.now()}-${Math.random()}`,
        category: 'large-payload',
        severity: largePayloads.some(p => p.size > 1048576) ? 'critical' : 'warning',
        title: `Large payload detected`,
        description: `${largePayloads.length} API response${largePayloads.length > 1 ? 's' : ''} over 100KB (total: ${(totalSize / 1024).toFixed(1)}KB)`,
        affectedSteps: largePayloads.map(p => p.stepId),
        recommendation: 'Consider pagination, filtering, or compression to reduce payload size',
      });
    }

    return insights;
  }

  /**
   * Detect slow renders (> 16ms).
   */
  private detectSlowRenders(story: ExecutionStory): InsightMessage[] {
    const insights: InsightMessage[] = [];
    const slowRenders = story.steps.filter(s => s.type === 'ui-update' && s.duration > 16);

    if (slowRenders.length > 0) {
      const avgDuration = slowRenders.reduce((sum, s) => sum + s.duration, 0) / slowRenders.length;

      insights.push({
        id: `insight-slow-render-${Date.now()}-${Math.random()}`,
        category: 'slow-render',
        severity: avgDuration > 50 ? 'critical' : 'warning',
        title: `Slow renders detected`,
        description: `${slowRenders.length} render${slowRenders.length > 1 ? 's' : ''} took > 16ms (avg: ${avgDuration.toFixed(1)}ms)`,
        affectedSteps: slowRenders.map(s => s.id),
        recommendation: 'Use ChangeDetectionStrategy.OnPush, optimize component templates, or reduce change detection triggers',
        evidence: {
          metrics: {
            slowRenderCount: slowRenders.length,
            averageDuration: Math.round(avgDuration),
            maxDuration: Math.max(...slowRenders.map(s => s.duration)),
          },
        },
      });
    }

    return insights;
  }

  /**
   * Detect excessive renders on single component.
   */
  private detectExcessiveRenders(story: ExecutionStory): InsightMessage[] {
    const insights: InsightMessage[] = [];
    const renderCounts = new Map<string, number>();

    for (const step of story.steps) {
      for (const comp of step.impact.components.names) {
        renderCounts.set(comp, (renderCounts.get(comp) ?? 0) + step.impact.components.renders);
      }
    }

    for (const [component, count] of renderCounts) {
      if (count > 10) {
        // Find affected steps
        const affectedSteps = story.steps
          .filter(s => s.impact.components.names.includes(component))
          .map(s => s.id);

        insights.push({
          id: `insight-render-${Date.now()}-${Math.random()}`,
          category: 'excessive-renders',
          severity: count > 30 ? 'critical' : count > 20 ? 'warning' : 'info',
          title: `Excessive renders`,
          description: `${component} rendered ${count} times. Possible memory leak or infinite update cycle.`,
          affectedComponents: [component],
          affectedSteps,
          recommendation: 'Check for circular dependencies, unintended store subscriptions, or change detection triggers',
          evidence: {
            metrics: {
              renderCount: count,
            },
          },
        });
      }
    }

    return insights;
  }

  /**
   * Detect infinite loops (rapid emissions from same source).
   */
  private detectInfiniteLoops(story: ExecutionStory, eventMap: Map<string, RuntimeEvent>): InsightMessage[] {
    const insights: InsightMessage[] = [];

    // Collect all signal/subject emissions and check for rapid bursts
    const emissionSequences = new Map<string, number[]>(); // property → [timestamps]

    for (const event of eventMap.values()) {
      if (event.type === 'signal-write' || event.type === 'subject-emit') {
        const key = event.propertyName || event.ownerClass || event.label;
        if (!emissionSequences.has(key)) {
          emissionSequences.set(key, []);
        }
        emissionSequences.get(key)!.push(event.timestamp);
      }
    }

    // Find rapid bursts
    for (const [source, timestamps] of emissionSequences) {
      const sorted = [...timestamps].sort((a, b) => a - b);
      
      // Check for 5+ emissions within 100ms window
      for (let i = 0; i < sorted.length - 4; i++) {
        const window = sorted[i + 4] - sorted[i];
        if (window < 100) {
          insights.push({
            id: `insight-loop-${Date.now()}-${Math.random()}`,
            category: 'infinite-loop',
            severity: 'critical',
            title: `Potential infinite loop detected`,
            description: `${source} emitted 5+ times within 100ms. This indicates a circular update cycle.`,
            affectedComponents: [],
            recommendation: 'Check for circular subscriptions: A → B → A, or unintended side effects in selectors/derivations',
            evidence: {
              metrics: {
                emissionCount: sorted.length,
                timeSpan: sorted[sorted.length - 1] - sorted[0],
              },
            },
          });
          break;
        }
      }
    }

    return insights;
  }

  /**
   * Detect general performance issues.
   */
  private detectPerformanceIssues(story: ExecutionStory): InsightMessage[] {
    const insights: InsightMessage[] = [];

    // Check total execution time
    if (story.duration > 5000) {
      insights.push({
        id: `insight-perf-${Date.now()}-${Math.random()}`,
        category: 'performance-issue',
        severity: 'warning',
        title: `Long execution time`,
        description: `Session took ${(story.duration / 1000).toFixed(2)}s, which is unusually long`,
        recommendation: 'Check for slow API calls, expensive computations, or unnecessary re-renders',
      });
    }

    // Check API call count
    const apiCalls = story.steps.filter(s => s.type === 'data-fetch').length;
    if (apiCalls > 20) {
      insights.push({
        id: `insight-api-${Date.now()}-${Math.random()}`,
        category: 'performance-issue',
        severity: 'warning',
        title: `High API call count`,
        description: `${apiCalls} API calls in this session. Consider batching or pagination.`,
        recommendation: 'Use API batching, pagination, or GraphQL to reduce network requests',
      });
    }

    // Check total render count
    const totalRenders = story.steps.reduce((sum, s) => sum + s.impact.totalRenderCount, 0);
    if (totalRenders > 100) {
      insights.push({
        id: `insight-renders-${Date.now()}-${Math.random()}`,
        category: 'performance-issue',
        severity: 'warning',
        title: `High render count`,
        description: `${totalRenders} renders in this session. Application may feel sluggish.`,
        recommendation: 'Use OnPush change detection strategy and optimize component templates',
      });
    }

    return insights;
  }

  /**
   * Detect best practices.
   */
  private detectBestPractices(story: ExecutionStory): InsightMessage[] {
    const insights: InsightMessage[] = [];

    // Positive: No duplicates
    const apiCalls = story.steps.filter(s => s.type === 'data-fetch');
    const uniqueUrls = new Set(apiCalls.map(s => s.title));
    if (uniqueUrls.size === apiCalls.length) {
      insights.push({
        id: `insight-best-${Date.now()}-${Math.random()}`,
        category: 'best-practice',
        severity: 'info',
        title: `No duplicate API calls detected`,
        description: `All ${apiCalls.length} API calls were unique`,
      });
    }

    // Positive: Good render efficiency
    const avgRenderDuration = story.steps
      .filter(s => s.type === 'ui-update')
      .reduce((sum, s) => sum + s.duration, 0) / story.steps.filter(s => s.type === 'ui-update').length || 0;

    if (avgRenderDuration < 16 && story.steps.filter(s => s.type === 'ui-update').length > 0) {
      insights.push({
        id: `insight-best-${Date.now()}-${Math.random()}`,
        category: 'best-practice',
        severity: 'info',
        title: `Good render performance`,
        description: `Average render time: ${avgRenderDuration.toFixed(1)}ms (under 16ms budget)`,
      });
    }

    return insights;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private extractApiUrl(title: string, summary: string): string | null {
    const combined = `${title} ${summary}`;
    // Extract URL from "GET /api/orders" or similar
    const match = combined.match(/(?:GET|POST|PUT|DELETE)?\s*(\/[\w/-]+|\w+:\/\/[\w/.-]+)/i);
    return match ? match[1] : null;
  }

  private severityToNumber(severity: InsightSeverity): number {
    switch (severity) {
      case 'critical':
        return 3;
      case 'warning':
        return 2;
      case 'info':
        return 1;
      default:
        return 0;
    }
  }
}

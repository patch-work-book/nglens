/**
 * Execution Score Service
 * 
 * Calculates overall health/performance rating for an execution story.
 * Produces a score (0-100) and status (good/warning/critical).
 * 
 * Developers see this immediately:
 * - Green (Good): 80+
 * - Amber (Warning): 50-79
 * - Red (Critical): <50
 */

import { Injectable } from '@angular/core';
import type {
  ExecutionStory,
  ExecutionScore,
  ExecutionHealthStatus,
  ExecutionScoreChecklist,
  InsightMessage,
} from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class ExecutionScoreService {
  /**
   * Calculate execution score for a story.
   */
  calculateScore(story: ExecutionStory, insights: InsightMessage[]): ExecutionScore {
    // Evaluate each category
    const apiHealth = this.scoreApiHealth(story, insights);
    const renderHealth = this.scoreRenderHealth(story, insights);
    const stateManagementHealth = this.scoreStateManagementHealth(story, insights);
    const memoryHealth = this.scoreMemoryHealth(insights);

    // Compute overall score as weighted average
    const score = Math.round(
      (apiHealth * 0.3 + renderHealth * 0.3 + stateManagementHealth * 0.25 + memoryHealth * 0.15)
    );

    // Determine status
    const status = this.statusFromScore(score);

    // Build checklist
    const checks = this.buildChecklist(story, insights);

    // Generate summary
    const summary = this.generateSummary(score, status, checks);

    return {
      score: Math.max(0, Math.min(100, score)),
      status,
      apiHealth: Math.max(0, Math.min(100, apiHealth)),
      renderHealth: Math.max(0, Math.min(100, renderHealth)),
      stateManagementHealth: Math.max(0, Math.min(100, stateManagementHealth)),
      memoryHealth: Math.max(0, Math.min(100, memoryHealth)),
      checks,
      summary,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SCORING ALGORITHMS
  // ──────────────────────────────────────────────────────────────────────────

  private scoreApiHealth(story: ExecutionStory, insights: InsightMessage[]): number {
    let score = 100;

    // Deduct for duplicate APIs
    const duplicateApiInsights = insights.filter(i => i.category === 'duplicate-api');
    score -= duplicateApiInsights.length * 20;

    // Deduct for large payloads
    const largePayloadInsights = insights.filter(i => i.category === 'large-payload');
    score -= largePayloadInsights.length * 15;

    // Deduct for high API call count
    const apiCalls = story.steps.filter(s => s.type === 'data-fetch').length;
    if (apiCalls > 20) score -= 10;
    if (apiCalls > 30) score -= 10;

    // Bonus for batching patterns (multiple data fetches → single store update)
    const potentialBatches = this.detectBatchingPatterns(story);
    if (potentialBatches > 0) score -= 5; // Suggest optimization

    return Math.max(0, score);
  }

  private scoreRenderHealth(story: ExecutionStory, insights: InsightMessage[]): number {
    let score = 100;

    // Deduct for slow renders
    const slowRenderInsights = insights.filter(i => i.category === 'slow-render');
    score -= slowRenderInsights.length * 20;

    // Deduct for excessive renders
    const excessiveRenderInsights = insights.filter(i => i.category === 'excessive-renders');
    score -= Math.min(excessiveRenderInsights.length * 10, 30);

    // Check total render count
    const totalRenders = story.steps.reduce((sum, s) => sum + s.impact.totalRenderCount, 0);
    if (totalRenders > 100) score -= 15;
    if (totalRenders > 50) score -= 5;

    // Check average render duration
    const renderSteps = story.steps.filter(s => s.type === 'ui-update');
    if (renderSteps.length > 0) {
      const avgDuration = renderSteps.reduce((sum, s) => sum + s.duration, 0) / renderSteps.length;
      if (avgDuration > 16) score -= 10;
      if (avgDuration > 8) score -= 5;
    }

    return Math.max(0, score);
  }

  private scoreStateManagementHealth(story: ExecutionStory, insights: InsightMessage[]): number {
    let score = 100;

    // Deduct for infinite loops
    const infiniteLoopInsights = insights.filter(i => i.category === 'infinite-loop');
    score -= infiniteLoopInsights.length * 40;

    // Check for excessive state changes
    const stateUpdateSteps = story.steps.filter(s => s.type === 'state-update').length;
    if (stateUpdateSteps > 30) score -= 15;
    if (stateUpdateSteps > 50) score -= 10;

    // Bonus for well-structured state flow (few stores, clear patterns)
    const stores = new Set<string>();
    for (const step of story.steps) {
      for (const store of step.impact.stores.names) {
        stores.add(store);
      }
    }

    if (stores.size <= 3) score += 10; // Bonus for simplicity
    if (stores.size > 10) score -= 5; // Penalty for complexity

    return Math.max(0, Math.min(100, score));
  }

  private scoreMemoryHealth(insights: InsightMessage[]): number {
    let score = 100;

    // Deduct for memory leaks
    const leakInsights = insights.filter(i => i.category === 'memory-leak');
    score -= leakInsights.length * 50;

    // Deduct for performance issues (often related to memory)
    const perfInsights = insights.filter(i => i.category === 'performance-issue');
    score -= Math.min(perfInsights.length * 5, 20);

    return Math.max(0, score);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CHECKLIST GENERATION
  // ──────────────────────────────────────────────────────────────────────────

  private buildChecklist(story: ExecutionStory, insights: InsightMessage[]): ExecutionScoreChecklist {
    return {
      noDuplicateApis: !insights.some(i => i.category === 'duplicate-api'),
      goodRenderCount: !insights.some(i => i.category === 'excessive-renders'),
      reasonablePayloadSize: !insights.some(i => i.category === 'large-payload'),
      noMemoryLeaks: !insights.some(i => i.category === 'memory-leak'),
      noInfiniteLoops: !insights.some(i => i.category === 'infinite-loop'),
      noSlowRenders: !insights.some(i => i.category === 'slow-render'),
      noExcessiveRerenders: !insights.some(i => i.category === 'excessive-renders'),
    };
  }

  private statusFromScore(score: number): ExecutionHealthStatus {
    if (score >= 80) return 'good';
    if (score >= 50) return 'warning';
    return 'critical';
  }

  private generateSummary(
    score: number,
    status: ExecutionHealthStatus,
    checks: ExecutionScoreChecklist
  ): string {
    if (status === 'good') {
      return `Excellent (${score}/100)`;
    }

    if (status === 'warning') {
      const issues: string[] = [];
      if (!checks.noDuplicateApis) issues.push('Duplicate APIs');
      if (!checks.noSlowRenders) issues.push('Slow renders');
      if (!checks.noExcessiveRerenders) issues.push('Excessive renders');
      if (!checks.reasonablePayloadSize) issues.push('Large payloads');

      return `Issues detected (${score}/100): ${issues.join(', ')}`;
    }

    return `Critical issues (${score}/100)`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PATTERN DETECTION
  // ──────────────────────────────────────────────────────────────────────────

  private detectBatchingPatterns(story: ExecutionStory): number {
    // Count cases where multiple data fetches are followed by a single store update
    // This indicates non-optimal batching
    let patterns = 0;

    for (let i = 0; i < story.steps.length - 2; i++) {
      const step1 = story.steps[i];
      const step2 = story.steps[i + 1];
      const step3 = story.steps[i + 2];

      if (
        step1.type === 'data-fetch' &&
        step2.type === 'data-fetch' &&
        step3.type === 'state-update'
      ) {
        patterns++;
      }
    }

    return patterns;
  }
}

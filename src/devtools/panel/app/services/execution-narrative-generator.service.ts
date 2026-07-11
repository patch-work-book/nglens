/**
 * Execution Narrative Generator Service
 * 
 * Generates human-readable one-paragraph explanations of execution narratives.
 * This is the "signature feature" that makes developers say "wow, it explained what happened!"
 * 
 * Example output:
 * "Triggered by DashboardComponent.ngOnInit(). Six API requests were initiated: 
 *  Revenue, Orders, and User data completed successfully within 250ms. The 
 *  Dashboard store updated 12 properties, which triggered 3 signals and caused 
 *  18 components to re-render. Total execution time: 986ms. Observation: Revenue 
 *  Chart rendered twice (possible re-trigger). Score: 90 - Good performance."
 */

import { Injectable } from '@angular/core';
import type { ExecutionNarrative, Chapter } from '../../../../types/execution-narrative';

@Injectable({
  providedIn: 'root',
})
export class ExecutionNarrativeGeneratorService {
  /**
   * Generate one-paragraph explanation of an execution narrative.
   */
  generateNarrative(narrative: ExecutionNarrative): string {
    const paragraphs: string[] = [];

    // Part 1: Trigger
    const triggerPart = this.generateTriggerPart(narrative);
    paragraphs.push(triggerPart);

    // Part 2: Main flow (chapters)
    const flowPart = this.generateFlowPart(narrative);
    paragraphs.push(flowPart);

    // Part 3: Metrics summary
    const metricsPart = this.generateMetricsPart(narrative);
    paragraphs.push(metricsPart);

    // Part 4: Observations
    if (narrative.observations.length > 0) {
      const observationsPart = this.generateObservationsPart(narrative);
      paragraphs.push(observationsPart);
    }

    // Part 5: Score interpretation
    const scorePart = this.generateScorePart(narrative);
    paragraphs.push(scorePart);

    // Combine into one paragraph
    return paragraphs.filter(p => p.length > 0).join(' ');
  }

  /**
   * Generate trigger/entry point explanation.
   */
  private generateTriggerPart(narrative: ExecutionNarrative): string {
    const trigger = narrative.trigger || 'User action';

    // Normalize trigger
    let normalizedTrigger = trigger;
    if (trigger.includes('ngOnInit')) {
      normalizedTrigger = 'component initialization';
    } else if (trigger.includes('click') || trigger.includes('Click')) {
      normalizedTrigger = 'user click';
    } else if (trigger.includes('route') || trigger.includes('Route')) {
      normalizedTrigger = 'route navigation';
    }

    return `Triggered by ${normalizedTrigger}.`;
  }

  /**
   * Generate main flow explanation (chapters and their relationships).
   */
  private generateFlowPart(narrative: ExecutionNarrative): string {
    if (narrative.chapters.length === 0) {
      return '';
    }

    const parts: string[] = [];

    // Collect all metrics
    const totalApis = narrative.metrics.totalApiCalls;
    const totalComponents = narrative.metrics.totalComponents;
    const totalSignals = narrative.metrics.totalSignalEmissions;

    // Count APIs by status (simplified - all successful here)
    if (totalApis > 0) {
      parts.push(`${totalApis} API request${totalApis !== 1 ? 's' : ''} initiated`);

      // Describe which chapters had APIs
      const apiChapters = narrative.chapters.filter((ch: Chapter) => ch.metrics.apiCalls.count > 0);
      if (apiChapters.length > 0) {
        const apiNames = apiChapters.map((ch: Chapter) => ch.domain.name).join(', ');
        parts.push(`(${apiNames})`);
      }

      parts.push(`completed successfully`);
    }

    // Describe state updates
    const storeUpdateChapters = narrative.chapters.filter((ch: Chapter) => ch.metrics.storeUpdates.count > 0);
    if (storeUpdateChapters.length > 0) {
      const storeCount = storeUpdateChapters.reduce((sum: number, ch: Chapter) => sum + ch.metrics.storeUpdates.count, 0);
      const propCount = storeUpdateChapters.reduce((sum: number, ch: Chapter) => sum + ch.metrics.storeUpdates.propertiesChanged, 0);
      parts.push(
        `The store${storeCount !== 1 ? 's' : ''} updated ${propCount} properties across ${storeUpdateChapters.length} module${storeUpdateChapters.length !== 1 ? 's' : ''}`
      );
    }

    // Describe signals and renders
    if (totalSignals > 0 || totalComponents > 0) {
      const signalText = totalSignals > 0 ? `${totalSignals} signal${totalSignals !== 1 ? 's' : ''}` : '';
      const componentText = totalComponents > 0 ? `${totalComponents} component${totalComponents !== 1 ? 's' : ''} to re-render` : '';

      const combinedText = [signalText, componentText].filter(t => t.length > 0).join(' and caused ');
      if (combinedText.length > 0) {
        parts.push(`triggering ${combinedText}`);
      }
    }

    // Describe affected modules
    const moduleNames = narrative.chapters.map((ch: Chapter) => ch.domain.name).join(', ');
    if (moduleNames.length > 0) {
      parts.push(`across modules: ${moduleNames}`);
    }

    return parts.join('. ') + '.';
  }

  /**
   * Generate metrics summary (timing and counts).
   */
  private generateMetricsPart(narr: ExecutionNarrative): string {
    const duration = narr.duration;
    const parts: string[] = [];

    parts.push(`Total execution time: ${duration}ms`);

    // Add chapter timing if notable
    if (narr.chapters.length > 1) {
      const slowestChapter = narr.chapters.reduce((max: Chapter, ch: Chapter) =>
        ch.duration > max.duration ? ch : max
      );

      if (slowestChapter.duration > duration * 0.3) {
        // If one chapter takes > 30% of time, mention it
        parts.push(
          `${slowestChapter.domain.name} took the longest (${slowestChapter.duration}ms)`
        );
      }
    }

    return parts.join('. ') + '.';
  }

  /**
   * Generate observations (anomalies and interesting findings).
   */
  private generateObservationsPart(narr: ExecutionNarrative): string {
    const observations: string[] = [];

    narr.observations.slice(0, 3).forEach((obs: string) => {
      observations.push(`${obs}`);
    });

    if (observations.length === 0) {
      return '';
    }

    return `Observation${observations.length !== 1 ? 's' : ''}: ${observations.join(', ')}.`;
  }

  /**
   * Generate score interpretation.
   */
  private generateScorePart(narr: ExecutionNarrative): string {
    const score = narr.executionScore.score;
    const status = narr.executionScore.status;

    let statusText = 'Good performance';
    switch (status) {
      case 'good':
        statusText = 'Good performance';
        break;
      case 'warning':
        statusText = 'Performance with minor issues';
        break;
      case 'critical':
        statusText = 'Performance concerns';
        break;
    }

    // Add details about score breakdown
    const checks = narr.executionScore.checks;
    const issues: string[] = [];

    if (!checks.noDuplicateApis) {
      issues.push('duplicate APIs detected');
    }
    if (!checks.noSlowRenders) {
      issues.push('slow renders detected');
    }
    if (!checks.goodRenderCount) {
      issues.push('high render count');
    }
    if (!checks.reasonablePayloadSize) {
      issues.push('large payload');
    }

    if (issues.length > 0) {
      return `Score: ${score}/100 - ${statusText}. Issues: ${issues.join(', ')}.`;
    }

    return `Execution Score: ${score}/100 - ${statusText}.`;
  }

  /**
   * Generate narrative for a single chapter (used in inspector).
   */
  generateChapterNarrative(executionNarrative: ExecutionNarrative, chapterId: string): string {
    const chapter = executionNarrative.chapters.find((ch: Chapter) => ch.id === chapterId);
    if (!chapter) {
      return '';
    }

    const parts: string[] = [];

    // What
    parts.push(`${chapter.domain.name} Module Update`);

    // Why (from causality)
    if (chapter.causedBy) {
      parts.push(`triggered by ${chapter.causedBy.domain.name} completion`);
    }

    // What happened
    const apiCount = chapter.metrics.apiCalls.count;
    const storeUpdates = chapter.metrics.storeUpdates.propertiesChanged;
    const renders = chapter.metrics.componentRenders.count;
    const signals = chapter.metrics.signalEmissions.count;

    const actions: string[] = [];
    if (apiCount > 0) {
      actions.push(`${apiCount} API call${apiCount !== 1 ? 's' : ''}`);
    }
    if (storeUpdates > 0) {
      actions.push(`${storeUpdates} state update${storeUpdates !== 1 ? 's' : ''}`);
    }
    if (signals > 0) {
      actions.push(`${signals} signal${signals !== 1 ? 's' : ''} emitted`);
    }
    if (renders > 0) {
      actions.push(`${renders} component${renders !== 1 ? 's' : ''} rendered`);
    }

    if (actions.length > 0) {
      parts.push(`containing ${actions.join(', ')}`);
    }

    // Duration
    parts.push(`in ${chapter.duration}ms`);

    // Affected components
    if (chapter.affectedComponents.length > 0) {
      const compList = chapter.affectedComponents.slice(0, 3).join(', ');
      const moreText = chapter.affectedComponents.length > 3 ? ` and ${chapter.affectedComponents.length - 3} more` : '';
      parts.push(`affecting ${compList}${moreText}`);
    }

    // Combine
    let narr = parts.join(' ');

    // Add observations
    if (chapter.observations.length > 0) {
      narr += `. ${chapter.observations[0]}`;
    }

    narr += '.';

    return narr;
  }

  /**
   * Format duration in human-readable way.
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  /**
   * Generate a score breakdown explanation.
   */
  generateScoreBreakdown(narrative: ExecutionNarrative): string[] {
    const breakdown: string[] = [];
    const score = narrative.executionScore.score;

    // Base score
    breakdown.push(`Score: ${score}/100`);

    // Positive points
    const checks = narrative.executionScore.checks;
    if (checks.noDuplicateApis) {
      breakdown.push(`+20 No duplicate APIs`);
    }
    if (checks.goodRenderCount) {
      breakdown.push(`+20 Good render count`);
    }
    if (checks.noSlowRenders) {
      breakdown.push(`+20 Fast renders`);
    }
    if (checks.noMemoryLeaks) {
      breakdown.push(`+20 No memory leaks`);
    }

    // Negative points
    if (!checks.noDuplicateApis) {
      breakdown.push(`-10 Duplicate APIs detected`);
    }
    if (!checks.goodRenderCount) {
      breakdown.push(`-15 Excessive re-renders`);
    }
    if (!checks.noSlowRenders) {
      breakdown.push(`-10 Slow renders (>16ms)`);
    }
    if (!checks.reasonablePayloadSize) {
      breakdown.push(`-5 Large payload`);
    }

    return breakdown;
  }
}

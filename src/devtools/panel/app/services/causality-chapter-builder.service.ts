/**
 * Causality Chapter Builder Service
 * 
 * Replaces the old NarrativeBuilderService with causality-based chapter creation.
 * 
 * Process:
 * 1. Detect causality chains from ExecutionStory
 * 2. Generate human-readable intent names for each chain
 * 3. Transform chains into Chapter objects
 * 4. Build ExecutionNarrative with causality-based chapters
 * 
 * The difference:
 * OLD: Group by domain name (Revenue Module, Orders Module)
 * NEW: Group by causality intent (Load Revenue, Load Orders, Update User Context)
 */

import { Injectable } from '@angular/core';
import type { ExecutionStory } from '../../../../types/execution-intelligence';
import type { Chapter, ExecutionNarrative } from '../../../../types/execution-narrative';
import { CausalityChainDetectorService, type CausalityChain } from './causality-chain-detector.service';
import { IntentNameGeneratorService } from './intent-name-generator.service';

@Injectable({
  providedIn: 'root',
})
export class CausalityChapterBuilderService {
  constructor(
    private chainDetector: CausalityChainDetectorService,
    private intentGenerator: IntentNameGeneratorService
  ) {}

  /**
   * Build causality-based chapters from an ExecutionStory.
   */
  buildChapters(story: ExecutionStory): Chapter[] {
    // Step 1: Detect all causality chains
    const chains = this.chainDetector.detectChains(story);

    if (chains.length === 0) {
      // Fallback: if no chains detected, create one chapter per step
      return this.createFallbackChapters(story);
    }

    // Step 2: Transform chains into chapters
    const chapters: Chapter[] = chains.map((chain, idx) =>
      this.chainToChapter(chain, story, idx + 1)
    );

    // Step 3: Detect relationships (which chapters triggered which)
    this.detectChapterRelationships(chapters, chains);

    return chapters;
  }

  /**
   * Convert a CausalityChain into a Chapter.
   */
  private chainToChapter(chain: CausalityChain, story: ExecutionStory, sequenceNumber: number): Chapter {
    // Generate intent name for this chain
    const { name: intentName, confidence: intentConfidence } = this.intentGenerator.generateIntentName(chain);

    // Create business domain from intent
    const domain = {
      id: intentName.toLowerCase().replace(/\s+/g, '-'),
      name: intentName,
      icon: this.getIntentIcon(intentName),
      componentNames: chain.steps?.map(s => s.title) || [],
      serviceNames: [],
      apiEndpoints: [],
      confidence: intentConfidence,
    };

    // Extract changes from the chain steps
    const changes = this.extractChangesFromChain(chain.steps || []);

    // Get affected components from renders
    const affectedComponents = chain.renders.map(r => r.title);

    // Build subsections from chain steps, grouping duplicate consecutive renders
    const groupedSteps = this.groupConsecutiveDuplicateRenders(chain.steps || []);
    const subsections = groupedSteps.map((group, idx) => ({
      id: `subsection-${chain.id}-${idx}`,
      type: this.mapStepTypeToSubsectionType(group.type),
      label: group.count > 1 ? `${group.title} (${group.count}x)` : group.title,
      icon: this.getStepIcon(group.type),
      summary: group.summary,
      implementation: group.count > 1 ? `${group.title} rendered ${group.count} times` : group.title,
      duration: group.duration,
      changes: this.extractChangesFromChain([group.steps[0]]),
      causedBy: idx === 0 ? intentName : groupedSteps[idx - 1].title || intentName,
      triggers: idx < groupedSteps.length - 1 ? [groupedSteps[idx + 1]?.title || ''] : [],
      consumers: group.steps[0].impact?.directConsumers || [],
      observations: group.steps.flatMap((s: any) => s.stepInsights?.map((i: any) => i.description) || []),
    }));

    // Build chapter
    const chapter: Chapter = {
      id: chain.id,
      domain,
      sequenceNumber,
      summary: this.generateChapterSummary(chain),
      duration: chain.duration,
      startTime: chain.startTime,
      endTime: chain.endTime,
      stepIds: chain.stepIds,
      metrics: this.aggregateChainMetrics(chain),
      causedBy: null, // Will be set by relationship detection
      triggers: [],
      trigger: intentName,
      changes,
      affectedComponents,
      subsections,
      observations: this.generateChapterObservations(chain),
    };

    return chapter;
  }

  /**
   * Generate a summary sentence for a chapter.
   */
  private generateChapterSummary(chain: CausalityChain): string {
    const { name } = this.intentGenerator.generateIntentName(chain);

    const parts: string[] = [name];

    // Add details based on chain structure
    if (chain.trigger.type === 'data-fetch') {
      parts.push('from API');
    }

    if (chain.stateUpdates.length > 0) {
      parts.push(`updated store`);
    }

    if (chain.computations.length > 0) {
      parts.push(`emitted signals`);
    }

    if (chain.renders.length > 0) {
      parts.push(`rendered ${chain.renders.length} component${chain.renders.length !== 1 ? 's' : ''}`);
    }

    return parts.join(', ').replace(/,(?!.*,)/g, ' and');
  }

  /**
   * Get icon for an intent name.
   */
  private getIntentIcon(intentName: string): string {
    const lowerName = intentName.toLowerCase();

    if (lowerName.includes('load')) return '📥';
    if (lowerName.includes('update')) return '✏️';
    if (lowerName.includes('delete')) return '🗑️';
    if (lowerName.includes('create')) return '➕';
    if (lowerName.includes('search')) return '🔍';
    if (lowerName.includes('validate')) return '✓';
    if (lowerName.includes('user')) return '👤';
    if (lowerName.includes('order')) return '📦';
    if (lowerName.includes('revenue')) return '💰';
    if (lowerName.includes('setting')) return '⚙️';
    if (lowerName.includes('notification')) return '🔔';

    return '📌';
  }

  /**
   * Get icon for a step type.
   */
  private getStepIcon(stepType: string): string {
    const icons: Record<string, string> = {
      'data-fetch': '🌐',
      'state-update': '💾',
      'computation': '⚡',
      'ui-update': '🎨',
      'user-interaction': '👆',
      'navigation': '🧭',
      'background-task': '⏳',
      'error-handling': '⚠️',
      'validation': '✓',
    };
    return icons[stepType] || '📌';
  }

  /**
   * Map ExecutionStep type to Subsection type.
   */
  private mapStepTypeToSubsectionType(
    stepType: string
  ): 'api' | 'store' | 'signal' | 'component' | 'render' | 'computed' {
    switch (stepType) {
      case 'data-fetch':
        return 'api';
      case 'state-update':
        return 'store';
      case 'computation':
        return 'computed';
      case 'ui-update':
        return 'render';
      default:
        return 'computed';
    }
  }

  /**
   * Extract data changes from a chain or step.
   */
  private extractChangesFromChain(stepsOrChain: any[]): any[] {
    const changes: any[] = [];

    (stepsOrChain || []).forEach((item: any) => {
      const changes_obj = item.changes || item;

      if (changes_obj.modified?.properties) {
        changes_obj.modified.properties.forEach((prop: any) => {
          changes.push({
            entityType: 'Data',
            field: prop.key,
            before: prop.oldValue || 'undefined',
            after: prop.newValue || 'undefined',
            changeType: 'modified',
            humanReadable: `${prop.key}: ${prop.oldValue} → ${prop.newValue}`,
            affectedComponents: [],
          });
        });
      }

      if (changes_obj.added?.properties) {
        changes_obj.added.properties.forEach((prop: any) => {
          changes.push({
            entityType: 'Data',
            field: prop.key,
            before: 'undefined',
            after: prop.value,
            changeType: 'added',
            humanReadable: `${prop.key}: added (${prop.value})`,
            affectedComponents: [],
          });
        });
      }
    });

    return changes;
  }

  /**
   * Aggregate metrics from a chain.
   */
  private aggregateChainMetrics(chain: CausalityChain) {
    return {
      apiCalls: {
        count: chain.trigger.type === 'data-fetch' ? 1 : 0,
        endpoints: chain.trigger.type === 'data-fetch' ? [chain.trigger.title] : [],
        totalDuration: chain.trigger.type === 'data-fetch' ? chain.trigger.duration : 0,
        failures: 0,
      },
      storeUpdates: {
        count: chain.stateUpdates.length,
        storeNames: chain.stateUpdates.map(s => s.title),
        propertiesChanged: chain.stateUpdates.reduce(
          (sum: number, s: any) => sum + (s.changes?.modified?.count || 0),
          0
        ),
      },
      signalEmissions: {
        count: chain.computations.length,
        signalNames: chain.computations.map(c => c.title),
      },
      componentRenders: {
        count: chain.renders.length,
        componentNames: chain.renders.map(r => r.title),
        totalDuration: chain.renders.reduce((sum: number, r: any) => sum + r.duration, 0),
        slowRenders: chain.renders.filter((r: any) => r.duration > 16).length,
      },
      payloadSize: 0,
      payloadGrowth: 0,
    };
  }

  /**
   * Generate observations for a chapter.
   */
  private generateChapterObservations(chain: CausalityChain): string[] {
    const observations: string[] = [];

    // Slow operations
    if (chain.duration > 300) {
      observations.push(`⚠️ Slow execution (${chain.duration}ms)`);
    }

    // Slow renders
    const slowRenders = chain.renders.filter(r => r.duration > 16);
    if (slowRenders.length > 0) {
      observations.push(`⚠️ ${slowRenders.length} slow render${slowRenders.length !== 1 ? 's' : ''}`);
    }

    // Parallel execution (unusual)
    if (chain.isParallel) {
      observations.push('ℹ️ Parallel execution detected');
    }

    // Many steps (good for completeness)
    if (chain.completeness > 0.8) {
      observations.push('✓ Complete execution chain');
    }

    return observations;
  }

  /**
   * Detect relationships between chapters (which triggered which).
   */
  private detectChapterRelationships(chapters: Chapter[], chains: CausalityChain[]): void {
    // For now, chapters are sequential
    chapters.forEach((chapter, idx) => {
      if (idx > 0) {
        chapter.causedBy = chapters[idx - 1];
        chapters[idx - 1].triggers.push(chapter);
      }
    });
  }

  /**
   * Fallback: create chapters from individual steps if chain detection fails.
   */
  private createFallbackChapters(story: ExecutionStory): Chapter[] {
    return story.steps.slice(0, 10).map((step, idx) => {
      // Extract a meaningful name from the step title
      const cleanTitle = step.title
        .replace(/^_/, '')
        .replace(/Component$/, '')
        .replace(/Service$/, '')
        .replace(/\s+Rendered$/, '')
        .trim();

      const name = cleanTitle.length > 0 ? cleanTitle : `Step ${idx + 1}`;
      const icon = this.getStepIcon(step.type);

      return {
        id: `fallback-chapter-${idx}`,
        domain: {
          id: name.toLowerCase().replace(/\s+/g, '-'),
          name,
          icon,
          componentNames: [step.title],
          serviceNames: [],
          apiEndpoints: [],
          confidence: 0.5,
        },
        sequenceNumber: idx + 1,
        summary: step.summary,
        duration: step.duration,
        startTime: step.startTime,
        endTime: step.endTime,
        stepIds: [step.id],
        metrics: {
          apiCalls: { count: 0, endpoints: [], totalDuration: 0, failures: 0 },
          storeUpdates: { count: 0, storeNames: [], propertiesChanged: 0 },
          signalEmissions: { count: 0, signalNames: [] },
          componentRenders: { count: 0, componentNames: [], totalDuration: 0, slowRenders: 0 },
          payloadSize: 0,
          payloadGrowth: 0,
        },
        causedBy: null,
        triggers: [],
        trigger: 'Fallback',
        changes: [],
        affectedComponents: [],
        subsections: [],
        observations: [],
      };
    });
  }

  /**
   * Group consecutive duplicate renders to avoid repetition.
   * Example: [Render A, Render A, Render B, Render A] → [Render A (2x), Render B, Render A]
   */
  private groupConsecutiveDuplicateRenders(
    steps: any[]
  ): Array<{ title: string; type: string; count: number; duration: number; steps: any[]; summary: string }> {
    if (steps.length === 0) return [];

    const groups: Array<{ title: string; type: string; count: number; duration: number; steps: any[]; summary: string }> = [];
    let currentGroup = {
      title: steps[0].title,
      type: steps[0].type,
      count: 1,
      duration: steps[0].duration,
      steps: [steps[0]],
      summary: steps[0].summary,
    };

    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];
      // Check if it's a render and same component
      if (
        (currentGroup.type === 'ui-update' || step.type === 'ui-update') &&
        currentGroup.title === step.title
      ) {
        // Group consecutive duplicates
        currentGroup.count += 1;
        currentGroup.duration += step.duration;
        currentGroup.steps.push(step);
      } else {
        // Different step, save current group and start new one
        groups.push(currentGroup);
        currentGroup = {
          title: step.title,
          type: step.type,
          count: 1,
          duration: step.duration,
          steps: [step],
          summary: step.summary,
        };
      }
    }

    // Add last group
    groups.push(currentGroup);
    return groups;
  }
}

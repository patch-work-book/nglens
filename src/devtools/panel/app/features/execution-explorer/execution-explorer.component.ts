/**
 * Execution Explorer Component
 * 
 * Container that builds ExecutionNarrative from stories and passes to ExecutionReport.
 * 
 * Architecture:
 * ExecutionIntelligenceService (stories)
 *   → CausalityChainDetector (chains)
 *   → CausalityChapterBuilder (chapters)
 *   → ExecutionNarrativeGenerator (narrative text)
 *   → ExecutionNarrative (data model)
 *     → ExecutionReportComponent (UI)
 */
import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionStory } from '@nglens/types/execution-intelligence';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';
import type { CausalityChain } from '../../services/causality-chain-detector.service';
import { ExecutionIntelligenceService } from '../../services/execution-intelligence.service';
import { CausalityChainDetectorService } from '../../services/causality-chain-detector.service';
import { CausalityChapterBuilderService } from '../../services/causality-chapter-builder.service';
import { ExecutionNarrativeGeneratorService } from '../../services/execution-narrative-generator.service';
import { ExecutionReportComponent } from './execution-report.component';

@Component({
  selector: 'app-execution-explorer',
  standalone: true,
  imports: [CommonModule, ExecutionReportComponent],
  template: `
    <div class="h-full">
      <app-execution-report [narrative]="selectedNarrative()" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionExplorerComponent {
  private executionIntelligence = inject(ExecutionIntelligenceService);
  private chainDetector = inject(CausalityChainDetectorService);
  private chapterBuilder = inject(CausalityChapterBuilderService);
  private narrativeGenerator = inject(ExecutionNarrativeGeneratorService);

  // Build narratives from all stories
  readonly narrativeMap = computed(() => {
    const stories = this.executionIntelligence.executionStories();
    const narratives = new Map<string, ExecutionNarrative>();

    stories.forEach(story => {
      const chains = this.chainDetector.detectChains(story);
      const chapters = this.chapterBuilder.buildChapters(story);

      const totalApiCalls = chains.reduce((s: number, c: CausalityChain) => s + (c.trigger.type === 'data-fetch' ? 1 : 0), 0);
      const totalComponents = chains.reduce((s: number, c: CausalityChain) => s + c.renders.length, 0);
      const totalSignalEmissions = chains.reduce((s: number, c: CausalityChain) => s + c.computations.length, 0);

      const metrics = {
        totalApiCalls,
        totalComponents,
        totalRenders: totalComponents,
        totalPayloadSize: 0,
        totalSignalEmissions,
      };

      const trigger = this.extractTrigger(story);

      const narrative: ExecutionNarrative = {
        id: `narrative-${story.id}`,
        storyId: story.id,
        title: story.title,
        trigger,
        startTime: story.startTime,
        endTime: story.endTime,
        duration: story.duration,
        chapters,
        chapterCount: chapters.length,
        executionNarrative: this.narrativeGenerator.generateNarrative({
          id: `narrative-${story.id}`,
          storyId: story.id,
          title: story.title,
          trigger,
          startTime: story.startTime,
          endTime: story.endTime,
          duration: story.duration,
          chapters,
          chapterCount: chapters.length,
          executionNarrative: '',
          metrics,
          observations: [],
          executionScore: story.executionScore,
          insights: story.insights,
          originalStory: story,
        } as ExecutionNarrative),
        metrics,
        observations: [],
        executionScore: story.executionScore,
        insights: story.insights,
        originalStory: story,
      };

      narratives.set(story.sessionId, narrative);
    });

    return narratives;
  });

  // Auto-select first narrative
  readonly selectedNarrative = computed(() => {
    const narratives = this.narrativeMap();
    if (narratives.size === 0) {
      return null;
    }
    
    const first = narratives.values().next().value || null;
    return first;
  });

  private extractTrigger(story: ExecutionStory | { steps?: any[] }): string {
    if (!('steps' in story) || !story.steps || story.steps.length === 0) {
      return 'User action';
    }
    const firstStep = story.steps[0];
    return firstStep?.title || 'User action';
  }
}

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
import { ExecutionReportComponent } from './report/execution-report.component';

@Component({
  selector: 'app-execution-explorer',
  standalone: true,
  imports: [CommonModule, ExecutionReportComponent],
  template: `
    <div class="h-full flex flex-col">
      <!-- Horizontal Timeline (1 Line - Ultra Compact) -->
      @if (stableNarratives().length > 1) {
        <div class="flex-shrink-0 overflow-x-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-800/50 border-b border-gray-700 py-2 px-2">
          <div class="flex gap-2 min-w-min">
            @for (narrative of stableNarratives(); track narrative.id) {
              <button class="flex-shrink-0 px-2 py-1 rounded border text-[9px] whitespace-nowrap transition-all cursor-pointer select-none"
                      [ngClass]="selectedNarrativeId() === narrative.id 
                        ? 'border-blue-500 bg-blue-500/20 text-blue-200' 
                        : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-500 hover:bg-gray-800/70'"
                      (click)="selectNarrative(narrative.id)"
                      [title]="narrative.trigger + ' · ' + narrative.duration.toFixed(0) + 'ms'">
                {{ narrative.trigger }} {{ narrative.duration.toFixed(0) }}ms
              </button>
            }
          </div>
        </div>
      }

      <!-- Details Panel -->
      <div class="flex-1 overflow-auto">
        <app-execution-report [narrative]="selectedNarrative()" />
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionExplorerComponent {
  private executionIntelligence = inject(ExecutionIntelligenceService);
  private chainDetector = inject(CausalityChainDetectorService);
  private chapterBuilder = inject(CausalityChapterBuilderService);
  private narrativeGenerator = inject(ExecutionNarrativeGeneratorService);

  // Build narratives from all stories (debounced via effect)
  readonly narrativeMap = signal(new Map<string, ExecutionNarrative>());
  readonly selectedNarrativeId = signal<string | null>(null);
  private buildTimer: any;

  constructor() {
    // Use effect to debounce narrative rebuilds
    const stories = this.executionIntelligence.executionStories;
    
    // Watch for story changes with manual debounce
    let lastLength = 0;
    setInterval(() => {
      const currentStories = stories();
      if (currentStories.length !== lastLength) {
        lastLength = currentStories.length;
        clearTimeout(this.buildTimer);
        this.buildTimer = setTimeout(() => {
          this.rebuildNarratives(currentStories);
        }, 150);
      }
    }, 200);
  }

  private rebuildNarratives(stories: ExecutionStory[]): void {
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

      narratives.set(story.id, narrative);
    });

    this.narrativeMap.set(narratives);
  }

  readonly stableNarratives = computed(() => {
    return Array.from(this.narrativeMap().values());
  });

  readonly selectedNarrative = computed(() => {
    const narratives = this.narrativeMap();
    const id = this.selectedNarrativeId();
    
    // If a specific narrative is selected, return it
    if (id && narratives.has(id)) {
      return narratives.get(id) || null;
    }
    
    // Otherwise return the first one
    const first = narratives.values().next().value || null;
    return first;
  });

  selectNarrative(id: string): void {
    const current = this.selectedNarrativeId();
    this.selectedNarrativeId.set(current === id ? null : id);
  }

  private extractTrigger(story: ExecutionStory | { steps?: any[] }): string {
    if (!('steps' in story) || !story.steps || story.steps.length === 0) {
      return 'User action';
    }
    const firstStep = story.steps[0];
    return firstStep?.title || 'User action';
  }
}

/**
 * Execution Explorer Component (REDESIGNED)
 * 
 * New architecture: Wires NarrativeBuilder to transform ExecutionStory → ExecutionNarrative.
 * All 3 panels now work with narrative data instead of raw events.
 * 
 * Layout:
 * ┌──────────────────────────────────────────────────────────┐
 * │ Dashboard Bootstrap │ 986ms │ 6 APIs │ 18 Comp │ Score: 90 │
 * ├──────────────┬──────────────────────┬────────────────────┤
 * │ Sessions     │ Chapters (Tree)      │ Inspector          │
 * │ (Intent)     │ (Collapsible)        │ (Narrative-First)  │
 * │              │                      │                    │
 * │ 🟢 Dashboard │ ① ▼ Revenue Module   │ 📖 What Happened?  │
 * │   Bootstrap  │    ├─ API            │ [Paragraph]        │
 * │              │    ├─ Store          │                    │
 * │   986ms      │    └─ Renders        │ 🔗 Timeline        │
 * │              │                      │ 0ms → 986ms        │
 * │ 6 APIs       │ ② ▼ Orders Module    │                    │
 * │ 18 Comp      │    ...               │ 📊 Changes         │
 * │              │                      │ Revenue: [] → [6]  │
 * │ Score: 90    │                      │                    │
 * └──────────────┴──────────────────────┴────────────────────┘
 */

import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionSession, ExecutionStory } from '../../../../../types/execution-intelligence';
import type { ExecutionNarrative, Chapter, Subsection } from '../../../../../types/execution-narrative';
import type { CausalityChain } from '../../services/causality-chain-detector.service';
import { ExecutionIntelligenceService } from '../../services/execution-intelligence.service';
import { CausalityChainDetectorService } from '../../services/causality-chain-detector.service';
import { IntentNameGeneratorService } from '../../services/intent-name-generator.service';
import { CausalityChapterBuilderService } from '../../services/causality-chapter-builder.service';
import { CausalityNarrativeService } from '../../services/causality-narrative.service';
import { ExecutionNarrativeGeneratorService } from '../../services/execution-narrative-generator.service';
import { SessionsPanelComponent } from './sessions-panel.component';
import { ExecutionJournalComponent } from './execution-journal.component';
import { InspectorPanelComponent } from './inspector-panel.component';

@Component({
  selector: 'app-execution-explorer',
  standalone: true,
  imports: [CommonModule, SessionsPanelComponent, ExecutionJournalComponent, InspectorPanelComponent],
  template: `
    <div class="h-full flex flex-col bg-gray-900 text-xs overflow-hidden">
      <!-- Ultra-compact single-line header -->
      @if (selectedNarrative(); as narrative) {
        <div class="px-2 py-0.5 border-b border-gray-700 bg-gray-800 flex-shrink-0">
          <div class="flex items-center gap-3 text-2xs">
            <!-- Title -->
            <span class="font-semibold text-gray-100">🎯 {{ narrative.title }}</span>
            
            <!-- Metrics (compact) -->
            <span class="text-gray-400">{{ narrative.duration }}ms</span>
            @if (narrative.metrics.totalApiCalls > 0) {
              <span class="text-gray-400 cursor-help" title="API calls made to the server">🌐 {{ narrative.metrics.totalApiCalls }} API</span>
            }
            @if (narrative.metrics.totalComponents > 0) {
              <span class="text-gray-400 cursor-help" title="Components that re-rendered">📦 {{ narrative.metrics.totalComponents }} Renders</span>
            }
            
            <!-- Score (rightmost) -->
            <div [class]="getScoreClass(narrative.executionScore.status)" class="ml-auto px-1.5 py-0.5 rounded font-semibold text-2xs">
              {{ narrative.executionScore.score }}/100
            </div>
            
            <!-- Insights -->
            @if (narrative.insights.length > 0) {
              <span class="text-amber-400 text-2xs">⚠️ {{ narrative.insights.length }}</span>
            }
          </div>
        </div>
      }

      <!-- 3-column layout -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Left: Sessions Panel -->
        <div class="w-32 border-r border-gray-700 overflow-auto flex-shrink-0">
          <app-sessions-panel
            [sessions]="sessions()"
            [selectedSessionId]="selectedSessionId()"
            (sessionSelected)="onSessionSelected($event)"
          />
        </div>

        <!-- Center: Execution Journal -->
        <div class="flex-1 border-r border-gray-700 overflow-auto">
          <app-execution-journal
            [chapters]="selectedNarrative()?.chapters || []"
            [totalDuration]="selectedNarrative()?.duration || 0"
            [selectedChapterId]="selectedChapterId()"
            (chapterSelected)="onChapterSelected($event)"
          />
        </div>

        <!-- Right: Inspector Panel -->
        <div class="w-96 overflow-auto flex-shrink-0">
          <app-inspector-panel
            [chapter]="selectedChapter()"
            [subsection]="selectedSubsection()"
            (expandRawEvents)="onExpandRawEvents()"
          />
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionExplorerComponent {
  private executionIntelligence = inject(ExecutionIntelligenceService);
  private chainDetector = inject(CausalityChainDetectorService);
  private intentGenerator = inject(IntentNameGeneratorService);
  private chapterBuilder = inject(CausalityChapterBuilderService);
  private causalityNarrative = inject(CausalityNarrativeService);
  private narrativeGenerator = inject(ExecutionNarrativeGeneratorService);

  // UI State
  readonly selectedSessionId = signal<string | null>(null);
  readonly selectedChapterId = signal<string | null>(null);
  readonly selectedSubsectionId = signal<string | null>(null);

  // Data: Sessions
  readonly sessions = computed(() => {
    return this.executionIntelligence.executionSessions();
  });

  // Data: Stories with causality-based chapters
  readonly narrativeMap = computed(() => {
    const stories = this.executionIntelligence.executionStories();
    const narratives = new Map<string, ExecutionNarrative>();

    stories.forEach(story => {
      // Transform story → causality chains → chapters
      const chains = this.chainDetector.detectChains(story);
      const chapters = this.chapterBuilder.buildChapters(story);

      // Calculate metrics from chains
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

      // Build narrative with causality-based chapters
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

  // Data: Selected narrative
  readonly selectedNarrative = computed(() => {
    const sessionId = this.selectedSessionId();
    if (!sessionId) return null;

    return this.narrativeMap().get(sessionId) || null;
  });

  // Data: Selected chapter
  readonly selectedChapter = computed(() => {
    const chapterId = this.selectedChapterId();
    if (!chapterId) return null;

    const narrative = this.selectedNarrative();
    if (!narrative) return null;

    return narrative.chapters.find(ch => ch.id === chapterId) || null;
  });

  // Data: Selected subsection
  readonly selectedSubsection = computed(() => {
    const subsectionId = this.selectedSubsectionId();
    if (!subsectionId) return null;

    const chapter = this.selectedChapter();
    if (!chapter) return null;

    return chapter.subsections.find(sub => sub.id === subsectionId) || null;
  });

  // Event handlers
  onSessionSelected(session: ExecutionSession): void {
    this.selectedSessionId.set(session.id);
    this.selectedChapterId.set(null);
    this.selectedSubsectionId.set(null);
  }

  onChapterSelected(chapter: Chapter): void {
    this.selectedChapterId.set(chapter.id);
    this.selectedSubsectionId.set(null);
  }

  onSubsectionSelected(subsection: Subsection): void {
    this.selectedSubsectionId.set(subsection.id);
  }

  onExpandRawEvents(): void {
    console.log('Expand raw events (TODO: implement modal)');
  }

  getScoreClass(status: string): string {
    switch (status) {
      case 'good':
        return 'bg-green-600/30 text-green-300';
      case 'warning':
        return 'bg-yellow-600/30 text-yellow-300';
      case 'critical':
        return 'bg-red-600/30 text-red-300';
      default:
        return 'bg-gray-600/30 text-gray-300';
    }
  }

  private extractTrigger(story: ExecutionStory | { steps?: any[] }): string {
    if (!('steps' in story) || !story.steps || story.steps.length === 0) {
      return 'User action';
    }

    const firstStep = story.steps[0];
    if (firstStep?.title) {
      return firstStep.title;
    }

    return 'User action';
  }
}

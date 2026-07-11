/**
 * Execution Intelligence Service
 * 
 * Orchestrator for the entire Execution Intelligence pipeline.
 * Coordinates: Normalizer → Session Builder → Story Builder → Impact Analyzer → Insight Engine
 * 
 * This is the single entry point for transforming raw telemetry into actionable execution stories.
 */

import { Injectable, signal, computed } from '@angular/core';
import type {
  RuntimeEvent,
  ExecutionSession,
  ExecutionStory,
  ExecutionStep,
  InsightMessage,
} from '../../../../types/execution-intelligence';
import type { FlowEvent, RenderEvent } from '../../../../types/render-events';

import { EventNormalizerService } from './event-normalizer.service';
import { SessionBuilderService } from './session-builder.service';
import { StoryBuilderService } from './story-builder.service';
import { ImpactAnalyzerService } from './impact-analyzer.service';
import { RootCauseDetectorService } from './root-cause-detector.service';
import { DiffEngineService } from './diff-engine.service';
import { InsightEngineService } from './insight-engine.service';
import { ExecutionScoreService } from './execution-score.service';

@Injectable({ providedIn: 'root' })
export class ExecutionIntelligenceService {
  private normalizer = new EventNormalizerService();
  private sessionBuilder = new SessionBuilderService();
  private storyBuilder = new StoryBuilderService();
  private impactAnalyzer = new ImpactAnalyzerService();
  private rootCauseDetector = new RootCauseDetectorService();
  private diffEngine = new DiffEngineService();
  private insightEngine = new InsightEngineService();
  private scoreService = new ExecutionScoreService();

  // State signals
  private readonly rawFlowEvents = signal<FlowEvent[]>([]);
  private readonly rawRenderEvents = signal<RenderEvent[]>([]);

  // Processed state
  private readonly normalizedEvents = signal<RuntimeEvent[]>([]);
  private readonly sessions = signal<ExecutionSession[]>([]);
  private readonly stories = signal<ExecutionStory[]>([]);

  // Map for easy lookup
  private eventMap = new Map<string, RuntimeEvent>();

  // Computed
  readonly executionStories = computed(() => this.stories());
  readonly executionSessions = computed(() => this.sessions());
  readonly sessionCount = computed(() => this.sessions().length);
  readonly totalEvents = computed(() => this.normalizedEvents().length);

  constructor() {}

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Add flow events and process them through the pipeline.
   */
  addFlowEvents(events: FlowEvent[]): void {
    this.rawFlowEvents.update(current => [...current, ...events]);
    this.processPipeline();
  }

  /**
   * Add render events and process them through the pipeline.
   */
  addRenderEvents(events: RenderEvent[]): void {
    this.rawRenderEvents.update(current => [...current, ...events]);
    this.processPipeline();
  }

  /**
   * Add both types of events at once.
   */
  addEvents(flowEvents: FlowEvent[], renderEvents: RenderEvent[]): void {
    this.rawFlowEvents.update(current => [...current, ...flowEvents]);
    this.rawRenderEvents.update(current => [...current, ...renderEvents]);
    this.processPipeline();
  }

  /**
   * Get stories for a specific session.
   */
  getStoriesForSession(sessionId: string): ExecutionStory[] {
    return this.stories().filter(s => s.sessionId === sessionId);
  }

  /**
   * Get a specific story by ID.
   */
  getStory(storyId: string): ExecutionStory | undefined {
    return this.stories().find(s => s.id === storyId);
  }

  /**
   * Get a specific step by ID.
   */
  getStep(stepId: string): ExecutionStep | undefined {
    for (const story of this.stories()) {
      const step = story.steps.find(s => s.id === stepId);
      if (step) return step;
    }
    return undefined;
  }

  /**
   * Expand a step to show its underlying events.
   */
  expandStep(stepId: string): RuntimeEvent[] {
    const step = this.getStep(stepId);
    if (!step) return [];

    return step.eventIds
      .map(id => this.eventMap.get(id))
      .filter((e): e is RuntimeEvent => !!e);
  }

  /**
   * Get insights for a story.
   */
  getInsights(storyId: string): InsightMessage[] {
    const story = this.stories().find(s => s.id === storyId);
    return story?.insights || [];
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.rawFlowEvents.set([]);
    this.rawRenderEvents.set([]);
    this.normalizedEvents.set([]);
    this.sessions.set([]);
    this.stories.set([]);
    this.eventMap.clear();

    this.normalizer.reset();
    this.sessionBuilder.reset();
    this.storyBuilder.reset();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PIPELINE EXECUTION
  // ──────────────────────────────────────────────────────────────────────────

  private processPipeline(): void {
    // STAGE 1: Normalize
    const flowEvents = this.rawFlowEvents();
    const renderEvents = this.rawRenderEvents();

    const normalized = this.normalizer.normalizeBatch(flowEvents, renderEvents);
    this.normalizedEvents.set(normalized);

    // Rebuild event map for lookups
    this.eventMap.clear();
    for (const event of normalized) {
      this.eventMap.set(event.id, event);
    }

    // STAGE 2: Build Sessions
    const sessions = this.sessionBuilder.buildSessions(normalized);
    this.sessions.set(sessions);

    // STAGE 3: Build Stories
    const stories: ExecutionStory[] = [];
    for (const session of sessions) {
      // Get all events for this session
      const sessionEvents = session.eventIds
        .map(id => this.eventMap.get(id))
        .filter((e): e is RuntimeEvent => !!e);

      // Build story
      const story = this.storyBuilder.buildStory(session, sessionEvents, this.eventMap);

      // STAGE 4: Analyze Impact
      this.impactAnalyzer.analyzeStory(story, this.eventMap);

      // STAGE 5: Compute Diffs for each step
      for (const step of story.steps) {
        const stepEvents = step.eventIds
          .map(id => this.eventMap.get(id))
          .filter((e): e is RuntimeEvent => !!e);
        step.changes = this.diffEngine.computeDiff(stepEvents);
      }

      // STAGE 6: Detect Root Causes for each step
      for (const step of story.steps) {
        const stepEvent = this.eventMap.get(step.eventIds[0]);
        if (stepEvent) {
          step.rootCauseChain = this.rootCauseDetector.detectRootCause(
            stepEvent,
            sessionEvents,
            session.boundary
          );
        }
      }

      // STAGE 7: Generate Insights
      const insights = this.insightEngine.generateInsights(story, this.eventMap);
      story.insights = insights;

      // STAGE 8: Calculate Execution Score
      story.executionScore = this.scoreService.calculateScore(story, insights);

      stories.push(story);
    }

    this.stories.set(stories);
  }
}

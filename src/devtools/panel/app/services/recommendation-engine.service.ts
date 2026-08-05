import { Injectable, computed, signal } from '@angular/core';
import type {
  TrackByIssue,
  OnPushScore,
  OnPushFactor,
} from '../../../../types/recommendation-events';
import type { LeakEvent } from '../../../../types/leak-events';
import type { PollutionSourceMetrics } from '../../../../types/zone-pollution-events';
import type {
  ComponentHotspot,
  ComponentStats,
} from '../../../../types/panel';
import type { RenderEvent, RenderCause } from '../../../../types/render-events';

/**
 * Recommendation Types
 */
export type ActionKind = 'trackby' | 'onpush' | 'zone' | 'render-hotspot' | 'memory-cleanup';
export type ActionConfidence = 'High' | 'Medium' | 'Heuristic';
export type ActionDifficulty = 'Easy' | 'Medium' | 'Hard';
export type ActionGain = 'Large' | 'Medium' | 'Small';

export interface RecommendationAction {
  id: string;
  kind: ActionKind;
  title: string;
  componentName: string;
  source: string;
  confidence: ActionConfidence;
  evidence: string;
  difficulty: ActionDifficulty;
  expectedGain: ActionGain;
  suggestedFix: string;
  rankScore: number;
  snippet?: string;
}

export interface RecommendationEngineInput {
  trackByIssues: TrackByIssue[];
  onPushRecommendations: OnPushScore[];
  hotspots: ComponentHotspot[];
  zonePollutionSources: PollutionSourceMetrics[];
  leakEvents: LeakEvent[];
  componentStats?: ComponentStats[];
}

/**
 * RecommendationEngineService: Standalone service that generates actionable recommendations.
 * 
 * Responsibilities:
 * - Transform raw metrics (render events, leaks, zone pollution) into ranked recommendations
 * - Apply heuristic rules (CD-MER < 25%, renderFrequency > 1.0, etc.)
 * - Compute confidence, difficulty, and expected gain
 * - Deduplicate and rank by business impact
 * 
 * Consumed by:
 * - RecommendationsComponent (UI display)
 * - ExecutionIntelligenceService (for integration)
 */

@Injectable({ providedIn: 'root' })
export class RecommendationEngineService {
  private readonly input = signal<RecommendationEngineInput>({
    trackByIssues: [],
    onPushRecommendations: [],
    hotspots: [],
    zonePollutionSources: [],
    leakEvents: [],
    componentStats: [],
  });

  readonly recommendations = computed(() =>
    this.generateRecommendations(this.input())
  );

  readonly highConfidenceCount = computed(() =>
    this.recommendations().filter(r => r.confidence === 'High').length
  );

  readonly quickWinCount = computed(() =>
    this.recommendations().filter(r => r.difficulty === 'Easy' && r.expectedGain !== 'Small').length
  );

  /**
   * Update the input data for the engine.
   * Call this whenever raw metrics change (e.g., new render events, leak detection).
   */
  setInput(input: RecommendationEngineInput): void {
    this.input.set(input);
  }

  /**
   * Get top N quick wins (easy + high gain).
   */
  topQuickWins(limit = 3): RecommendationAction[] {
    const recommendations = this.recommendations();
    const quickWins = recommendations.filter(r =>
      r.difficulty === 'Easy' && r.expectedGain !== 'Small'
    );

    const ranked = quickWins.length >= limit
      ? quickWins
      : [
          ...quickWins,
          ...recommendations.filter(r => !quickWins.includes(r)),
        ];

    return ranked.slice(0, limit);
  }

  /**
   * Core generation logic: transform input into ranked recommendations.
   */
  private generateRecommendations(input: RecommendationEngineInput): RecommendationAction[] {
    // Identify components already covered by dedicated recommendations
    const onPushComponents = new Set(
      this.deduplicateOnPush(
        input.onPushRecommendations
          .filter(item => item.currentStrategy !== 'OnPush' && this.normalizedOnPushScore(item) >= 50)
      ).map(item => item.component)
    );

    const hotspotComponents = new Set(
      input.hotspots
        .filter(hotspot => hotspot.score >= 40)
        .map(h => h.componentName)
    );

    const excludeFromDiagnostics = new Set([...onPushComponents, ...hotspotComponents]);

    return [
      ...input.trackByIssues.map(issue => this.createTrackByAction(issue)),
      ...this.deduplicateOnPush(
        input.onPushRecommendations
          .filter(item => item.currentStrategy !== 'OnPush' && this.normalizedOnPushScore(item) >= 50)
      ).map(item => this.createOnPushAction(item)),
      ...input.zonePollutionSources
        .filter(source => source.severity !== 'low')
        .map(source => this.createZoneAction(source)),
      ...input.hotspots
        .filter(hotspot => hotspot.score >= 40)
        .map(hotspot => this.createHotspotAction(hotspot)),
      ...this.createMemoryActions(input.leakEvents),
      ...this.createRenderDiagnosticActions(input.componentStats ?? [], excludeFromDiagnostics),
    ].sort((a, b) => {
      if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
      return this.kindPriority(a.kind) - this.kindPriority(b.kind);
    });
  }

  private createTrackByAction(issue: TrackByIssue): RecommendationAction {
    const gain: ActionGain = issue.collectionSize >= 250 ? 'Large' : 'Medium';
    return {
      id: issue.id,
      kind: 'trackby',
      title: `Add trackBy for ${issue.collectionProperty}`,
      componentName: issue.componentName,
      source: issue.componentName,
      confidence: 'High',
      evidence: `${issue.collectionSize} items in "${issue.collectionProperty}" without a detected trackBy function.`,
      difficulty: 'Easy',
      expectedGain: gain,
      suggestedFix: 'Add a stable identity function or Angular track expression so unchanged rows are reused.',
      rankScore: 92 + Math.min(issue.collectionSize / 100, 12),
      snippet: `trackById = (_: number, item: { id: unknown }) => item.id;\n\n<li *ngFor="let item of ${issue.collectionProperty}; trackBy: trackById">...</li>`,
    };
  }

  private createOnPushAction(item: OnPushScore): RecommendationAction {
    const score = this.normalizedOnPushScore(item);
    const met = item.factors.filter((f: OnPushFactor) => f.met).length;
    const total = item.factors.length;
    const confidence: ActionConfidence = score >= 85 ? 'High' : score >= 70 ? 'Medium' : 'Heuristic';
    const gain: ActionGain = score >= 80 ? 'Large' : 'Medium';

    let evidence = `OnPush score ${score}/100. ${met}/${total} suitability factors matched while using ${item.currentStrategy} change detection.`;
    let suggestedFix = 'Switch to OnPush after checking that inputs use new references and local state updates still mark the view.';
    let title = `Consider ChangeDetectionStrategy.OnPush for ${item.component}`;

    if (item.cdMer !== undefined && item.cdCount !== undefined && item.cdCount >= 5) {
      evidence += ` Observed CD-MER is ${item.cdMer.toFixed(1)}% (${item.mutationCount} DOM mutations inside ${item.cdCount} CD cycles).`;
      if (item.cdMer < 25) {
        title = `Low Change Detection Efficiency (CD-MER: ${item.cdMer.toFixed(1)}%) in ${item.component}`;
        suggestedFix = `Low mutation efficiency detected! Switch to OnPush strategy or migrate to Signals to avoid executing this component's change detection unless dynamic bindings/inputs actually change.`;
      }
    }

    return {
      id: `onpush-${item.component}`,
      kind: 'onpush',
      title,
      componentName: item.component,
      source: item.component,
      confidence,
      evidence,
      difficulty: 'Easy',
      expectedGain: gain,
      suggestedFix,
      rankScore: 70 + score / 3,
      snippet: `@Component({\n  changeDetection: ChangeDetectionStrategy.OnPush\n})`,
    };
  }

  private createZoneAction(source: PollutionSourceMetrics): RecommendationAction {
    const confidence: ActionConfidence =
      source.severity === 'critical' || source.severity === 'high' ? 'High' : 'Medium';
    const gain: ActionGain = source.severity === 'critical' ? 'Large' : 'Medium';
    const owner = source.library ?? source.source;

    let cdRateStr = `${Math.round(source.cdCyclesPerMinute)}/min`;
    if (source.cdCyclesPerMinute >= 60) {
      cdRateStr = `${(source.cdCyclesPerMinute / 60).toFixed(1)}/sec`;
    }

    return {
      id: `zone-${source.source}`,
      kind: 'zone',
      title: `Move noisy ${source.source} work outside Angular`,
      componentName: owner,
      source: owner,
      confidence,
      evidence: `${cdRateStr} change-detection frequency from ${source.taskCount} ${source.type} task(s).`,
      difficulty: 'Medium',
      expectedGain: gain,
      suggestedFix: source.fixSuggestion ?? 'Wrap high-frequency async work in runOutsideAngular and re-enter Angular only when UI state changes.',
      rankScore: this.severityScore(source.severity) + Math.min(source.cdCyclesPerMinute / 4, 25),
      snippet: `this.ngZone.runOutsideAngular(() => {\n  // timer, scroll, or third-party callback\n});`,
    };
  }

  private createHotspotAction(hotspot: ComponentHotspot): RecommendationAction {
    return {
      id: `hotspot-${hotspot.componentName}`,
      kind: 'render-hotspot',
      title: `Review render hotspot`,
      componentName: hotspot.componentName,
      source: hotspot.componentName,
      confidence: hotspot.score >= 90 ? 'High' : hotspot.score >= 70 ? 'Medium' : 'Heuristic',
      evidence: `${hotspot.renderCount} renders, ${this.formatRenderRate(hotspot.renderFrequency)} frequency, ${hotspot.averageDuration.toFixed(1)}ms avg. Main cause: ${this.causeLabel(hotspot.primaryCause)}.`,
      difficulty: hotspot.primaryCause === 'parent' || hotspot.primaryCause === 'zone' ? 'Medium' : 'Hard',
      expectedGain: hotspot.score >= 80 ? 'Large' : 'Medium',
      suggestedFix: this.hotspotFix(hotspot.primaryCause),
      rankScore: 45 + hotspot.score / 2,
    };
  }

  private createMemoryActions(events: LeakEvent[]): RecommendationAction[] {
    const groups = new Map<string, { events: LeakEvent[]; sources: Set<string> }>();

    for (const event of events) {
      const key = `${event.componentName}::${event.leakType}`;
      let group = groups.get(key);
      if (!group) {
        group = { events: [], sources: new Set() };
        groups.set(key, group);
      }
      group.events.push(event);
      group.sources.add(event.source);
    }

    const actions: RecommendationAction[] = [];
    for (const [, group] of groups) {
      const representative = group.events[0];
      const count = group.events.length;
      const isSubscription = representative.leakType === 'subscription';
      const hasCritical = group.events.some(e => e.severity === 'CRITICAL');
      const sourcesPreview = Array.from(group.sources).slice(0, 3).join(', ');
      const moreSourcesLabel = group.sources.size > 3 ? ` (+${group.sources.size - 3} more)` : '';

      actions.push({
        id: `memory-group-${representative.componentName}-${representative.leakType}`,
        kind: 'memory-cleanup',
        title: `${count} ${this.leakTypeLabel(representative.leakType).toLowerCase()}${count > 1 ? 's' : ''} without detected cleanup in ${representative.componentName}`,
        componentName: representative.componentName,
        source: representative.componentName,
        confidence: isSubscription ? 'Medium' : 'Heuristic',
        evidence: `${count} ${this.leakTypeLabel(representative.leakType).toLowerCase()} resource${count > 1 ? 's' : ''} from: ${sourcesPreview}${moreSourcesLabel}.`,
        difficulty: 'Medium',
        expectedGain: count >= 10 ? 'Medium' : 'Small',
        suggestedFix: this.leakFix(representative.leakType),
        rankScore: hasCritical ? 76 : count >= 10 ? 65 : 58,
        snippet: isSubscription
          ? `this.stream$\n  .pipe(takeUntilDestroyed(this.destroyRef))\n  .subscribe();`
          : undefined,
      });
    }

    return actions;
  }

  private createRenderDiagnosticActions(
    stats: ComponentStats[],
    excludeComponents: Set<string>
  ): RecommendationAction[] {
    const actions: RecommendationAction[] = [];

    for (const stat of stats) {
      if (stat.renderCount < 3) continue;
      if (excludeComponents.has(stat.componentName)) continue;

      const topCause = this.getTopCauseFromBreakdown(stat.causesBreakdown);

      if (topCause === 'parent' && stat.renderCount >= 3) {
        actions.push({
          id: `render-cascade-${stat.componentName}`,
          kind: 'render-hotspot',
          title: `${stat.componentName} rendered ${stat.renderCount}× from parent cascade`,
          componentName: stat.componentName,
          source: stat.componentName,
          confidence: stat.renderCount >= 6 ? 'High' : 'Medium',
          evidence: `This component re-renders every time its parent does, even when its own inputs haven't changed.`,
          difficulty: 'Easy',
          expectedGain: stat.renderCount >= 6 ? 'Large' : 'Medium',
          suggestedFix: 'Add ChangeDetectionStrategy.OnPush to this component. It will only re-render when its @Input() references change or a signal it reads is written.',
          rankScore: 75 + Math.min(stat.renderCount, 20),
          snippet: `@Component({\n  changeDetection: ChangeDetectionStrategy.OnPush\n})`,
        });
      } else if (topCause === 'zone' && stat.renderCount >= 4) {
        actions.push({
          id: `render-zone-${stat.componentName}`,
          kind: 'render-hotspot',
          title: `${stat.componentName} rendered ${stat.renderCount}× from async/timers`,
          componentName: stat.componentName,
          source: stat.componentName,
          confidence: stat.renderCount >= 6 ? 'High' : 'Medium',
          evidence: `Each setTimeout/setInterval/HTTP callback triggers a Zone.js change detection cycle that re-renders this component.`,
          difficulty: 'Medium',
          expectedGain: stat.renderCount >= 8 ? 'Large' : 'Medium',
          suggestedFix: 'Use OnPush + Signals, or move timer/async logic outside Angular zone with NgZone.runOutsideAngular().',
          rankScore: 70 + Math.min(stat.renderCount, 20),
          snippet: `this.ngZone.runOutsideAngular(() => {\n  setInterval(() => {\n    // update state\n    this.ngZone.run(() => this.signal.set(newValue));\n  }, 5000);\n});`,
        });
      } else if (stat.renderCount >= 5) {
        actions.push({
          id: `render-excessive-${stat.componentName}`,
          kind: 'render-hotspot',
          title: `${stat.componentName} rendered ${stat.renderCount}× excessively`,
          componentName: stat.componentName,
          source: stat.componentName,
          confidence: stat.renderCount >= 8 ? 'High' : 'Heuristic',
          evidence: `This component re-renders too frequently. Each re-render recalculates the template and diffs the DOM.`,
          difficulty: 'Medium',
          expectedGain: 'Medium',
          suggestedFix: 'Use ChangeDetectionStrategy.OnPush and convert state to signals so Angular only marks this component dirty when its dependencies actually change.',
          rankScore: 60 + Math.min(stat.renderCount, 20),
        });
      }

      // Dynamic low CD-MER diagnostic
      if (stat.cdCount && stat.cdCount >= 5 && stat.cdMer !== undefined && stat.cdMer < 25) {
        actions.push({
          id: `render-cd-mer-low-${stat.componentName}`,
          kind: 'render-hotspot',
          title: `Low CD-MER (${stat.cdMer.toFixed(1)}%) in ${stat.componentName}`,
          componentName: stat.componentName,
          source: stat.componentName,
          confidence: stat.cdCount >= 10 ? 'High' : 'Medium',
          evidence: `CD-MER efficiency ratio is ${stat.cdMer.toFixed(1)}%. Checked ${stat.cdCount} times, only produced ${stat.mutationCount} mutations. Checks are wasteful.`,
          difficulty: 'Easy',
          expectedGain: 'Large',
          suggestedFix: 'Add ChangeDetectionStrategy.OnPush or convert view dependencies to Signals to prevent unnecessary checks.',
          rankScore: 82 + Math.min((100 - stat.cdMer) / 4, 18),
          snippet: `@Component({\n  changeDetection: ChangeDetectionStrategy.OnPush\n})`,
        });
      }
    }

    return actions;
  }

  // ── Helper methods ──

  private normalizedOnPushScore(item: OnPushScore): number {
    return Math.round(item.score <= 1 ? item.score * 100 : item.score);
  }

  private deduplicateOnPush(items: OnPushScore[]): OnPushScore[] {
    const best = new Map<string, OnPushScore>();
    for (const item of items) {
      const existing = best.get(item.component);
      if (!existing || this.normalizedOnPushScore(item) > this.normalizedOnPushScore(existing)) {
        best.set(item.component, item);
      }
    }
    return Array.from(best.values());
  }

  private severityScore(severity: PollutionSourceMetrics['severity']): number {
    switch (severity) {
      case 'critical': return 95;
      case 'high': return 82;
      case 'medium': return 68;
      case 'low': return 30;
      default: return 0;
    }
  }

  private kindPriority(kind: ActionKind): number {
    switch (kind) {
      case 'trackby': return 0;
      case 'onpush': return 1;
      case 'zone': return 2;
      case 'render-hotspot': return 3;
      case 'memory-cleanup': return 4;
    }
  }

  private causeLabel(cause: RenderCause['type'] | 'unknown'): string {
    switch (cause) {
      case 'signal': return 'signal update';
      case 'input': return 'input change';
      case 'zone': return 'async/DOM event';
      case 'parent': return 'parent cascade';
      case 'manual-cd': return 'manual change detection';
      default: return 'unknown';
    }
  }

  private hotspotFix(cause: RenderCause['type'] | 'unknown'): string {
    switch (cause) {
      case 'parent':
        return 'Stabilize inputs from the parent, add trackBy for child lists, and check whether the child can use OnPush.';
      case 'zone':
        return 'Find the high-frequency event, timer, or async callback and move noisy work outside Angular.';
      case 'signal':
        return 'Check computed signals and state writes so only meaningful value changes trigger rendering.';
      case 'input':
        return 'Avoid recreating arrays or objects in parent templates and pass stable references where possible.';
      case 'manual-cd':
        return 'Review detectChanges or markForCheck calls and remove repeated manual change detection.';
      default:
        return 'Open Render Inspector, select the component, and inspect the dominant render cause.';
    }
  }

  private leakTypeLabel(type: LeakEvent['leakType']): string {
    switch (type) {
      case 'subscription': return 'Subscription';
      case 'timer': return 'Timer';
      case 'event-listener': return 'Event listener';
      default: return 'Resource';
    }
  }

  private leakFix(type: LeakEvent['leakType']): string {
    switch (type) {
      case 'subscription':
        return 'Use takeUntilDestroyed, AsyncPipe, or explicit unsubscribe during component teardown.';
      case 'timer':
        return 'Store the timer handle and clear it in the component cleanup path.';
      case 'event-listener':
        return 'Remove the listener in the component cleanup path or use Renderer2/listener helpers that return cleanup functions.';
      default:
        return 'Clean up this resource in the component cleanup path.';
    }
  }

  private formatRenderRate(frequency: number): string {
    if (frequency > 1) return `${frequency.toFixed(1)}/sec`;
    return `${Math.round(frequency * 60)}/min`;
  }

  private getTopCauseFromBreakdown(breakdown: Record<RenderCause['type'], number>): RenderCause['type'] | 'unknown' {
    let maxCount = 0;
    let topCause: RenderCause['type'] | 'unknown' = 'unknown';
    for (const [cause, count] of Object.entries(breakdown)) {
      if (count > maxCount) {
        maxCount = count;
        topCause = cause as RenderCause['type'];
      }
    }
    return topCause;
  }
}

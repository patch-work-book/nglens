import type { LeakEvent } from '../../../../types/leak-events';
import type { ComponentHotspot, ComponentStats } from '../../../../types/panel';
import type { OnPushScore, TrackByIssue } from '../../../../types/recommendation-events';
import type { RenderCause } from '../../../../types/render-events';
import type { PollutionSourceMetrics } from '../../../../types/zone-pollution-events';

export type ActionConfidence = 'High' | 'Medium' | 'Heuristic';
export type ActionDifficulty = 'Easy' | 'Medium' | 'Hard';
export type ActionGain = 'Small' | 'Medium' | 'Large';
export type ActionKind = 'trackby' | 'onpush' | 'zone' | 'render-hotspot' | 'memory-cleanup';

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
  route?: string;
}

export interface RecommendationActionInput {
  trackByIssues: TrackByIssue[];
  onPushRecommendations: OnPushScore[];
  hotspots: ComponentHotspot[];
  zonePollutionSources: PollutionSourceMetrics[];
  leakEvents: LeakEvent[];
  componentStats?: ComponentStats[];
}

export function buildRecommendationActions(input: RecommendationActionInput): RecommendationAction[] {
  // Collect components that already have dedicated OnPush or hotspot actions
  // so renderDiagnosticActions won't duplicate them.
  const onPushComponents = new Set(
    deduplicateOnPush(
      input.onPushRecommendations
        .filter((item) => item.currentStrategy !== 'OnPush' && normalizedOnPushScore(item) >= 50)
    ).map((item) => item.component)
  );
  const hotspotComponents = new Set(
    input.hotspots
      .filter((hotspot) => hotspot.score >= 40)
      .map((h) => h.componentName)
  );
  const excludeFromDiagnostics = new Set([...onPushComponents, ...hotspotComponents]);

  return [
    ...input.trackByIssues.map(trackByAction),
    ...deduplicateOnPush(
      input.onPushRecommendations
        .filter((item) => item.currentStrategy !== 'OnPush' && normalizedOnPushScore(item) >= 50)
    ).map(onPushAction),
    ...input.zonePollutionSources
      .filter((source) => source.severity !== 'low')
      .map(zoneAction),
    ...input.hotspots
      .filter((hotspot) => hotspot.score >= 40)
      .map(hotspotAction),
    ...groupedMemoryActions(input.leakEvents),
    ...renderDiagnosticActions(input.componentStats ?? [], excludeFromDiagnostics),
  ].sort((a, b) => {
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return kindPriority(a.kind) - kindPriority(b.kind);
  });
}

export function topQuickWins(actions: RecommendationAction[], limit = 3): RecommendationAction[] {
  const quickWins = actions.filter((action) =>
    action.difficulty === 'Easy' && action.expectedGain !== 'Small'
  );

  const ranked = quickWins.length >= limit
    ? quickWins
    : [
        ...quickWins,
        ...actions.filter((action) => !quickWins.includes(action)),
      ];

  return ranked.slice(0, limit);
}

export function confidenceClass(confidence: ActionConfidence): string {
  switch (confidence) {
    case 'High':
      return 'text-green-300 bg-green-500/15 border-green-500/30';
    case 'Medium':
      return 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30';
    case 'Heuristic':
      return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
  }
}

export function difficultyClass(difficulty: ActionDifficulty): string {
  switch (difficulty) {
    case 'Easy':
      return 'text-green-300 bg-green-500/15 border-green-500/30';
    case 'Medium':
      return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
    case 'Hard':
      return 'text-red-300 bg-red-500/15 border-red-500/30';
  }
}

export function gainClass(gain: ActionGain): string {
  switch (gain) {
    case 'Large':
      return 'text-green-300 bg-green-500/15 border-green-500/30';
    case 'Medium':
      return 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30';
    case 'Small':
      return 'text-gray-300 bg-gray-700/60 border-gray-600/50';
  }
}

function trackByAction(issue: TrackByIssue): RecommendationAction {
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
    route: issue.route,
  };
}

function onPushAction(item: OnPushScore): RecommendationAction {
  const score = normalizedOnPushScore(item);
  const met = item.factors.filter((factor) => factor.met).length;
  const total = item.factors.length;
  const confidence: ActionConfidence = score >= 85 ? 'High' : score >= 70 ? 'Medium' : 'Heuristic';
  const gain: ActionGain = score >= 80 ? 'Large' : 'Medium';

  return {
    id: `onpush-${item.component}`,
    kind: 'onpush',
    title: 'Consider ChangeDetectionStrategy.OnPush',
    componentName: item.component,
    source: item.component,
    confidence,
    evidence: `OnPush score ${score}/100. ${met}/${total} suitability factors matched while using ${item.currentStrategy} change detection.`,
    difficulty: 'Easy',
    expectedGain: gain,
    suggestedFix: 'Switch to OnPush after checking that inputs use new references and local state updates still mark the view.',
    rankScore: 70 + score / 3,
    snippet: `@Component({\n  changeDetection: ChangeDetectionStrategy.OnPush\n})`,
    route: item.route,
  };
}

function zoneAction(source: PollutionSourceMetrics): RecommendationAction {
  const confidence: ActionConfidence =
    source.severity === 'critical' || source.severity === 'high' ? 'High' : 'Medium';
  const gain: ActionGain = source.severity === 'critical' ? 'Large' : 'Medium';
  const owner = source.library ?? source.source;

  return {
    id: `zone-${source.source}`,
    kind: 'zone',
    title: `Move noisy ${source.source} work outside Angular`,
    componentName: owner,
    source: owner,
    confidence,
    evidence: `${Math.round(source.cdCyclesPerMinute)} change-detection cycles/min from ${source.taskCount} ${source.type} task(s).`,
    difficulty: 'Medium',
    expectedGain: gain,
    suggestedFix: source.fixSuggestion ?? 'Wrap high-frequency async work in runOutsideAngular and re-enter Angular only when UI state changes.',
    rankScore: severityScore(source.severity) + Math.min(source.cdCyclesPerMinute / 4, 25),
    snippet: `this.ngZone.runOutsideAngular(() => {\n  // timer, scroll, or third-party callback\n});`,
    route: source.route,
  };
}

function hotspotAction(hotspot: ComponentHotspot): RecommendationAction {
  return {
    id: `hotspot-${hotspot.componentName}`,
    kind: 'render-hotspot',
    title: `Review render hotspot`,
    componentName: hotspot.componentName,
    source: hotspot.componentName,
    confidence: hotspot.score >= 90 ? 'High' : hotspot.score >= 70 ? 'Medium' : 'Heuristic',
    evidence: `${hotspot.renderCount} renders, ${hotspot.rendersPerMinute.toFixed(1)}/min, ${hotspot.averageDuration.toFixed(1)}ms avg. Main cause: ${causeLabel(hotspot.primaryCause)}.`,
    difficulty: hotspot.primaryCause === 'parent' || hotspot.primaryCause === 'zone' ? 'Medium' : 'Hard',
    expectedGain: hotspot.score >= 80 ? 'Large' : 'Medium',
    suggestedFix: hotspotFix(hotspot.primaryCause),
    rankScore: 45 + hotspot.score / 2,
    route: hotspot.route,
  };
}

function groupedMemoryActions(events: LeakEvent[]): RecommendationAction[] {
  // Group by component + leakType to avoid 1000+ individual cards
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
      title: `${count} ${leakTypeLabel(representative.leakType).toLowerCase()}${count > 1 ? 's' : ''} without detected cleanup in ${representative.componentName}`,
      componentName: representative.componentName,
      source: representative.componentName,
      confidence: isSubscription ? 'Medium' : 'Heuristic',
      evidence: `${count} ${leakTypeLabel(representative.leakType).toLowerCase()} resource${count > 1 ? 's' : ''} from: ${sourcesPreview}${moreSourcesLabel}.`,
      difficulty: 'Medium',
      expectedGain: count >= 10 ? 'Medium' : 'Small',
      suggestedFix: leakFix(representative.leakType),
      rankScore: hasCritical ? 76 : (count >= 10 ? 65 : 58),
      snippet: isSubscription
        ? `this.stream$\n  .pipe(takeUntilDestroyed(this.destroyRef))\n  .subscribe();`
        : undefined,
      route: representative.route,
    });
  }

  return actions;
}

function normalizedOnPushScore(item: OnPushScore): number {
  return Math.round(item.score <= 1 ? item.score * 100 : item.score);
}

/** Keep only the highest-scoring entry per component to avoid duplicate cards. */
function deduplicateOnPush(items: OnPushScore[]): OnPushScore[] {
  const best = new Map<string, OnPushScore>();
  for (const item of items) {
    const existing = best.get(item.component);
    if (!existing || normalizedOnPushScore(item) > normalizedOnPushScore(existing)) {
      best.set(item.component, item);
    }
  }
  return Array.from(best.values());
}

function severityScore(severity: PollutionSourceMetrics['severity']): number {
  switch (severity) {
    case 'critical': return 95;
    case 'high': return 82;
    case 'medium': return 68;
    case 'low': return 30;
  }
}

function kindPriority(kind: ActionKind): number {
  switch (kind) {
    case 'trackby': return 0;
    case 'onpush': return 1;
    case 'zone': return 2;
    case 'render-hotspot': return 3;
    case 'memory-cleanup': return 4;
  }
}

function causeLabel(cause: RenderCause['type'] | 'unknown'): string {
  switch (cause) {
    case 'signal': return 'signal update';
    case 'input': return 'input change';
    case 'zone': return 'async/DOM event';
    case 'parent': return 'parent cascade';
    case 'manual-cd': return 'manual change detection';
    default: return 'unknown';
  }
}

function hotspotFix(cause: RenderCause['type'] | 'unknown'): string {
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

function leakTypeLabel(type: LeakEvent['leakType']): string {
  switch (type) {
    case 'subscription': return 'Subscription';
    case 'timer': return 'Timer';
    case 'event-listener': return 'Event listener';
  }
}

function leakFix(type: LeakEvent['leakType']): string {
  switch (type) {
    case 'subscription':
      return 'Use takeUntilDestroyed, AsyncPipe, or explicit unsubscribe during component teardown.';
    case 'timer':
      return 'Store the timer handle and clear it in the component cleanup path.';
    case 'event-listener':
      return 'Remove the listener in the component cleanup path or use Renderer2/listener helpers that return cleanup functions.';
  }
}

function renderDiagnosticActions(stats: ComponentStats[], excludeComponents: Set<string>): RecommendationAction[] {
  const actions: RecommendationAction[] = [];

  for (const stat of stats) {
    if (stat.renderCount < 3) continue;
    if (excludeComponents.has(stat.componentName)) continue;

    const topCause = getTopCauseFromBreakdown(stat.causesBreakdown);

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
        route: stat.route,
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
        route: stat.route,
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
        route: stat.route,
      });
    }
  }

  return actions;
}

function getTopCauseFromBreakdown(breakdown: Record<string, number>): string {
  let winner = 'zone';
  let max = 0;
  for (const [type, count] of Object.entries(breakdown)) {
    if (count > max) { winner = type; max = count; }
  }
  return winner;
}

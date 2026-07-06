import { Injectable, signal, computed } from '@angular/core';
import type { RenderEvent, RenderCause, FlowEvent } from '../../../../types/render-events';
import type { LeakEvent } from '../../../../types/leak-events';
import type { TrackByIssue, OnPushScore } from '../../../../types/recommendation-events';
import type { PollutionSourceMetrics } from '../../../../types/zone-pollution-events';
import type {
  ComponentHotspot,
  ComponentStats,
  InteractionProfile,
  Issue,
  PerformanceSnapshot,
  SnapshotComparison,
} from '../../../../types/panel';

@Injectable({ providedIn: 'root' })
export class PanelState {
  // Connection
  readonly connectionState = signal<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  // Tracking
  readonly isTracking = signal(false);
  readonly trackingError = signal<string | null>(null);
  readonly degradedMode = signal(false);
  readonly clearOnRouteChange = signal(false);

  // Navigation
  readonly activeTab = signal<'overview' | 'rendering' | 'memory' | 'recommendations'>('overview');
  readonly selectedComponent = signal<string | null>(null);
  readonly selectedIssue = signal<Issue | null>(null);

  // Base raw data stores (private)
  private readonly rawRenderEvents = signal<RenderEvent[]>([]);
  private readonly rawFlowEvents = signal<FlowEvent[]>([]);
  private readonly rawLeakEvents = signal<LeakEvent[]>([]);
  private readonly rawTrackByIssues = signal<TrackByIssue[]>([]);
  private readonly rawOnPushRecommendations = signal<OnPushScore[]>([]);
  private readonly rawZonePollutionSources = signal<PollutionSourceMetrics[]>([]);

  // Navigation / Frame Selection
  readonly frames = signal<{ id: number; url: string; isTop: boolean }[]>([
    { id: 0, url: 'Top Window', isTop: true }
  ]);
  readonly selectedFrameId = signal<number>(0);

  // Data (computed based on current select frame ID)
  readonly renderEvents = computed(() => {
    const target = this.selectedFrameId();
    return this.rawRenderEvents().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });
  readonly flowEvents = computed(() => {
    const target = this.selectedFrameId();
    return this.rawFlowEvents().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });
  readonly leakEvents = computed(() => {
    const target = this.selectedFrameId();
    return this.rawLeakEvents().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });
  readonly trackByIssues = computed(() => {
    const target = this.selectedFrameId();
    return this.rawTrackByIssues().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });
  readonly onPushRecommendations = computed(() => {
    const target = this.selectedFrameId();
    return this.rawOnPushRecommendations().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });
  readonly zonePollutionSources = computed(() => {
    const target = this.selectedFrameId();
    return this.rawZonePollutionSources().filter(e => e.frameId === target || (!e.frameId && target === 0));
  });

  readonly snapshots = signal<PerformanceSnapshot[]>([]);

  // Computed: aggregate render events into per-component stats
  readonly componentStats = computed(() => this.aggregateStats(this.renderEvents()));

  // Computed: components exceeding 100 renders per minute
  readonly hotComponents = computed(() =>
    this.componentStats().filter(s => s.renderFrequency > 0.1 || s.renderCount > 1)
  );

  readonly componentHotspots = computed<ComponentHotspot[]>(() =>
    this.rankHotspots(this.componentStats())
  );

  readonly interactionProfiles = computed<InteractionProfile[]>(() =>
    this.buildInteractionProfiles(this.renderEvents())
  );

  readonly latestComparison = computed<SnapshotComparison | null>(() =>
    this.compareSnapshots(this.snapshots())
  );

  readonly criticalPollutionCount = computed<number>(() =>
    this.zonePollutionSources().filter(s => s.severity === 'critical').length
  );

  // ── Render Environment Profile (live, continuously updated) ────────────────

  /** Idle CD rate: renders per second with no user interaction (last 30s rolling window) */
  readonly idleCdRate = computed<number>(() => {
    const events = this.renderEvents();
    if (events.length < 2) return 0;
    // Count renders that have NO interaction attached (idle/timer-triggered)
    const idleEvents = events.filter(e => !e.interactionComponent);
    if (idleEvents.length < 2) return 0;
    const first = idleEvents[0].timestamp;
    const last = idleEvents[idleEvents.length - 1].timestamp;
    const spanSeconds = Math.max((last - first) / 1000, 1);
    return idleEvents.length / spanSeconds;
  });

  /** Component count by change detection strategy */
  readonly cdStrategyBreakdown = computed(() => {
    // Derive from component stats (available from render tracking)
    const total = this.componentStats().length;
    // We can't detect OnPush vs Default from render events alone in this context
    // Show total components discovered; the OnPush/Default breakdown requires App Map scan
    return { onPush: 0, default: 0, total, unknown: true };
  });

  /** Active zone pollution sources (from ZonePollutionDetector) */
  readonly activeZoneSources = computed(() => {
    return this.zonePollutionSources()
      .filter(s => s.severity !== 'low')
      .map(s => ({
        name: s.source,
        rate: s.cdCyclesPerMinute,
        severity: s.severity,
        fix: s.fixSuggestion ?? null,
      }));
  });

  /** Active reactive streams (subjects/signals emitting) from flow events */
  readonly activeStreams = computed(() => {
    const flows = this.flowEvents();
    const streamCounts = new Map<string, { count: number; lastTs: number; type: string }>();
    for (const f of flows) {
      if (f.type === 'subject-emit' || f.type === 'signal-write') {
        const key = f.label;
        const existing = streamCounts.get(key);
        if (existing) {
          existing.count++;
          existing.lastTs = f.timestamp;
        } else {
          streamCounts.set(key, { count: 1, lastTs: f.timestamp, type: f.type });
        }
      }
    }
    return Array.from(streamCounts.entries())
      .map(([label, data]) => ({ label, ...data }))
      .filter(s => s.count >= 2) // Only show streams that emitted 2+ times
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  });

  /** Recommendation for new component strategy based on environment */
  readonly environmentRecommendation = computed<string>(() => {
    const idleRate = this.idleCdRate();
    const zoneSources = this.activeZoneSources();
    const cdBreakdown = this.cdStrategyBreakdown();

    if (idleRate > 3 || zoneSources.length > 2) {
      return 'Use OnPush + Signals. This page has high idle change detection activity — Default CD components will re-render unnecessarily.';
    }
    if (cdBreakdown.default > cdBreakdown.onPush && cdBreakdown.total > 5) {
      return 'Use OnPush. Most components on this page use Default CD — adding another Default CD component increases cascade risk.';
    }
    if (zoneSources.some(s => s.name.includes('setInterval') || s.name.includes('WebSocket'))) {
      return 'Use OnPush + Signals + runOutsideAngular for timers. This page has periodic zone pollution that triggers global CD.';
    }
    if (idleRate <= 1 && zoneSources.length === 0) {
      return 'Environment is clean. OnPush + Signals is still recommended as best practice, but Default CD won\'t cause immediate issues here.';
    }
    return 'Use OnPush + Signals for optimal performance in this environment.';
  });

  readonly zonePollutionIssues = computed<Issue[]>(() =>
    this.zonePollutionSources()
      .filter(s => s.severity !== 'low')
      .map(s => this.pollutionSourceToIssue(s))
  );

  /** Render diagnostics: components re-rendering excessively, surfaced in Recommendations */
  readonly renderDiagnostics = computed<Issue[]>(() => {
    const stats = this.componentStats();
    const issues: Issue[] = [];
    for (const stat of stats) {
      if (stat.renderCount < 3) continue;
      const cause = this.getTopCauseType(stat.causesBreakdown);

      if (cause === 'parent' && stat.renderCount >= 3) {
        issues.push({
          id: `render-diag-${stat.componentName}-parent`,
          type: 'render-hot',
          componentName: stat.componentName,
          severity: stat.renderCount >= 6 ? 'CRITICAL' : 'WARNING',
          title: `${stat.componentName} rendered ${stat.renderCount}× from parent cascade`,
          description: `This component re-renders every time its parent does. Add ChangeDetectionStrategy.OnPush so it only re-renders when its inputs change.`,
          timestamp: stat.lastSeen,
          route: stat.route,
        });
      } else if (stat.renderCount >= 4) {
        issues.push({
          id: `render-diag-${stat.componentName}-excessive`,
          type: 'render-hot',
          componentName: stat.componentName,
          severity: stat.renderCount >= 8 ? 'CRITICAL' : 'WARNING',
          title: `${stat.componentName} rendered ${stat.renderCount}× in this session`,
          description: cause === 'zone'
            ? `Timers or async operations trigger excessive re-renders. Use OnPush + Signals, or run timers outside Angular zone.`
            : `This component re-renders too frequently. Use OnPush and ensure inputs use immutable references.`,
          timestamp: stat.lastSeen,
          route: stat.route,
        });
      }
    }
    return issues;
  });

  // Computed: per-component render count derived from cumulative render events
  readonly renderCountMap = computed<Map<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const event of this.renderEvents()) {
      counts.set(event.componentName, (counts.get(event.componentName) ?? 0) + 1);
    }
    return counts;
  });

  // Computed: all issues from all sources combined (OnPush excluded — lives in Recommendations only)
  readonly allIssues = computed<Issue[]>(() => this.collectIssues());

  /**
   * Resets all mutable state signals to their initial values.
   */
  clearAll(): void {
    this.connectionState.set('disconnected');
    this.isTracking.set(false);
    this.trackingError.set(null);
    this.degradedMode.set(false);
    this.activeTab.set('overview');
    this.selectedComponent.set(null);
    this.selectedIssue.set(null);
    this.rawRenderEvents.set([]);
    this.rawLeakEvents.set([]);
    this.rawTrackByIssues.set([]);
    this.rawOnPushRecommendations.set([]);
    this.snapshots.set([]);
    this.rawZonePollutionSources.set([]);
    this.frames.set([{ id: 0, url: 'Top Window', isTop: true }]);
    this.selectedFrameId.set(0);
  }

  captureSnapshot(label?: string): void {
    const snapshot = this.createSnapshot(label ?? this.nextSnapshotLabel());
    this.snapshots.update(current => {
      if (current.length === 0) return [snapshot];
      return [current[0], snapshot];
    });
  }

  clearSnapshots(): void {
    this.snapshots.set([]);
  }

  clearActivity(): void {
    this.rawRenderEvents.set([]);
    this.rawFlowEvents.set([]);
    this.rawLeakEvents.set([]);
    this.rawTrackByIssues.set([]);
    this.rawOnPushRecommendations.set([]);
    this.rawZonePollutionSources.set([]);
    this.selectedIssue.set(null);
    this.selectedComponent.set(null);
  }

  registerFrame(frameId: number, url: string, isTop: boolean): void {
    this.frames.update(current => {
      if (current.some(f => f.id === frameId)) {
        return current.map(f => f.id === frameId ? { ...f, url, isTop } : f);
      }
      return [...current, { id: frameId, url, isTop }];
    });
  }

  addRenderEvents(events: RenderEvent[], frameId: number): void {
    const eventsWithFrame = events.map(e => ({ ...e, frameId }));
    this.rawRenderEvents.update(current => [...current, ...eventsWithFrame]);
  }

  addLeakEvent(event: LeakEvent, frameId: number): void {
    this.rawLeakEvents.update(current => {
      // Deduplicate/accumulate leak events
      const index = current.findIndex(e => e.componentId === event.componentId && e.leakType === event.leakType && e.source === event.source && e.frameId === frameId);
      if (index !== -1) {
        const updated = [...current];
        updated[index] = { ...event, frameId };
        return updated;
      }
      return [...current, { ...event, frameId }];
    });
  }

  addTrackByIssue(issue: TrackByIssue, frameId: number): void {
    this.rawTrackByIssues.update(current => {
      // Deduplicate/accumulate trackBy issues including route
      const index = current.findIndex(e => e.componentName === issue.componentName && e.collectionProperty === issue.collectionProperty && e.frameId === frameId && e.route === issue.route);
      if (index !== -1) {
        const updated = [...current];
        updated[index] = { ...issue, frameId };
        return updated;
      }
      return [...current, { ...issue, frameId }];
    });
  }

  addOnPushResult(result: OnPushScore, frameId: number): void {
    this.rawOnPushRecommendations.update(current => {
      // Deduplicate/accumulate OnPush recommendations including route
      const index = current.findIndex(e => e.component === result.component && e.frameId === frameId && e.route === result.route);
      if (index !== -1) {
        const updated = [...current];
        updated[index] = { ...result, frameId };
        return updated;
      }
      return [...current, { ...result, frameId }];
    });
  }

  setZonePollutionSources(sources: PollutionSourceMetrics[], frameId: number): void {
    const sourcesWithFrame = sources.map(s => ({ ...s, frameId }));
    this.rawZonePollutionSources.update(current => {
      const otherFrames = current.filter(s => s.frameId !== frameId);
      const targetFrameSources = current.filter(s => s.frameId === frameId);

      const sourcesMap = new Map<string, PollutionSourceMetrics>();
      for (const s of targetFrameSources) {
        sourcesMap.set(s.source, s);
      }
      for (const s of sourcesWithFrame) {
        sourcesMap.set(s.source, s);
      }

      return [...otherFrames, ...Array.from(sourcesMap.values())];
    });
  }

  addFlowEvents(events: FlowEvent[], frameId: number): void {
    const eventsWithFrame = events.map(e => ({ ...e, frameId }));
    this.rawFlowEvents.update(current => [...current, ...eventsWithFrame]);
  }

  setTrackingError(message: string): void {
    this.trackingError.set(message);
    this.isTracking.set(false);
  }

  private nextSnapshotLabel(): string {
    const count = this.snapshots().length;
    if (count === 0) return 'Baseline';
    return 'Current run';
  }

  /**
   * Aggregates raw render events into per-component statistics.
   */
  private aggregateStats(events: RenderEvent[]): ComponentStats[] {
    if (events.length === 0) return [];

    const statsMap = new Map<string, {
      renderCount: number;
      totalDuration: number;
      causesBreakdown: Record<RenderCause['type'], number>;
      firstSeen: number;
      lastSeen: number;
      lastRoute?: string;
      cdCount: number;
      mutationCount: number;
      totalTemplateBindings: number;
      totalOutputListeners: number;
      hasHighFrequencyZonePollution: boolean;
      highFrequencyEvents: string[];
    }>();

    for (const event of events) {
      let entry = statsMap.get(event.componentName);
      if (!entry) {
        entry = {
          renderCount: 0,
          totalDuration: 0,
          causesBreakdown: { signal: 0, input: 0, zone: 0, parent: 0, 'manual-cd': 0 },
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
          lastRoute: event.route,
          cdCount: 0,
          mutationCount: 0,
          totalTemplateBindings: 0,
          totalOutputListeners: 0,
          hasHighFrequencyZonePollution: false,
          highFrequencyEvents: [],
        };
        statsMap.set(event.componentName, entry);
      }

      entry.renderCount++;
      entry.totalDuration += event.duration;
      if (event.timestamp < entry.firstSeen) entry.firstSeen = event.timestamp;
      if (event.timestamp > entry.lastSeen) {
        entry.lastSeen = event.timestamp;
        if (event.route) {
          entry.lastRoute = event.route;
        }
      }

      // Collect running maximum metrics from event payload
      if (event.cdCount !== undefined && event.cdCount > entry.cdCount) {
        entry.cdCount = event.cdCount;
      }
      if (event.mutationCount !== undefined && event.mutationCount > entry.mutationCount) {
        entry.mutationCount = event.mutationCount;
      }
      if (event.totalTemplateBindings !== undefined && event.totalTemplateBindings > entry.totalTemplateBindings) {
        entry.totalTemplateBindings = event.totalTemplateBindings;
      }
      if (event.totalOutputListeners !== undefined && event.totalOutputListeners > entry.totalOutputListeners) {
        entry.totalOutputListeners = event.totalOutputListeners;
      }
      if (event.hasHighFrequencyZonePollution !== undefined && event.hasHighFrequencyZonePollution) {
        entry.hasHighFrequencyZonePollution = true;
      }
      if (event.highFrequencyEvents !== undefined && event.highFrequencyEvents.length > entry.highFrequencyEvents.length) {
        entry.highFrequencyEvents = event.highFrequencyEvents;
      }

      for (const cause of event.causes) {
        entry.causesBreakdown[cause.type]++;
      }
    }

    const activeFlowEvents = this.flowEvents();
    const results: ComponentStats[] = [];
    for (const [componentName, entry] of statsMap) {
      const cd = entry.cdCount;
      const mut = entry.mutationCount || entry.renderCount; // fallback to render count
      const cdMer = cd > 0 ? (mut / cd) * 100 : 100;

      // Get all render events specifically for this component
      const componentRenders = events.filter(e => e.componentName === componentName);

      // 1. Route changes that actually caused this component to render (component rendered within 1000ms of any route change)
      const routeChangesCount = activeFlowEvents.filter(e => 
        e.type === 'route-change' && 
        componentRenders.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
      ).length;

      // 2. User interactions that actually caused this component to render 
      // (either a user-interaction flow event with a render within 1000ms, or the render itself specifies an interactionComponent/interactionTarget)
      const userInteractionsCount = activeFlowEvents.filter(e => 
        e.type === 'user-interaction' && 
        componentRenders.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
      ).length || componentRenders.filter(r => !!r.interactionComponent).length;

      // 3. Microtasks that actually caused this component to render (render causes contain microTask/Promise.then)
      const microTasksCount = componentRenders.reduce((sum, r) => {
        const hasMicrotask = r.causes.some(c => c.type === 'zone' && (c.source === 'Promise.then' || c.source?.includes('Promise') || c.source?.includes('microTask')));
        return sum + (hasMicrotask ? 1 : 0);
      }, 0);

      // 4. Server pushes that actually caused this component to render (http-response with a render within 1000ms, or render cause contains XMLHttpRequest/fetch/WebSocket)
      const serverPushesCount = activeFlowEvents.filter(e => 
        e.type === 'http-response' && 
        componentRenders.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
      ).length || componentRenders.reduce((sum, r) => {
        const hasServerPush = r.causes.some(c => c.type === 'zone' && (c.source === 'XMLHttpRequest' || c.source?.includes('fetch') || c.source?.includes('WebSocket')));
        return sum + (hasServerPush ? 1 : 0);
      }, 0);

      const totalTriggerEvents = routeChangesCount + userInteractionsCount + microTasksCount + serverPushesCount;
      const computedFrequency = totalTriggerEvents > 0 ? (entry.renderCount / totalTriggerEvents) : entry.renderCount;

      results.push({
        componentName,
        renderCount: entry.renderCount,
        renderFrequency: computedFrequency,
        averageDuration: entry.totalDuration / entry.renderCount,
        totalDuration: entry.totalDuration,
        causesBreakdown: entry.causesBreakdown,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        route: entry.lastRoute,
        cdCount: cd,
        mutationCount: mut,
        cdMer: Math.min(100, Math.max(0, cdMer)),
        triggerCount: totalTriggerEvents,
        totalTemplateBindings: entry.totalTemplateBindings,
        totalOutputListeners: entry.totalOutputListeners,
        hasHighFrequencyZonePollution: entry.hasHighFrequencyZonePollution,
        highFrequencyEvents: entry.highFrequencyEvents,
      });
    }

    return results;
  }

  private createSnapshot(label: string): PerformanceSnapshot {
    const stats = this.componentStats();
    const events = this.renderEvents();
    const renderCount = events.length;
    const totalRenderDuration = stats.reduce((sum, stat) => sum + stat.totalDuration, 0);
    const averageRenderDuration = renderCount > 0 ? totalRenderDuration / renderCount : 0;

    const activeFlowEvents = this.flowEvents();
    
    // Globally count active triggers that produced at least one render in the system
    const routeChangesCount = activeFlowEvents.filter(e => 
      e.type === 'route-change' && 
      events.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
    ).length;

    const userInteractionsCount = activeFlowEvents.filter(e => 
      e.type === 'user-interaction' && 
      events.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
    ).length || events.filter(r => !!r.interactionComponent).length;

    const microTasksCount = events.reduce((sum, r) => {
      const hasMicrotask = r.causes.some(c => c.type === 'zone' && (c.source === 'Promise.then' || c.source?.includes('Promise') || c.source?.includes('microTask')));
      return sum + (hasMicrotask ? 1 : 0);
    }, 0);

    const serverPushesCount = activeFlowEvents.filter(e => 
      e.type === 'http-response' && 
      events.some(r => Math.abs(r.timestamp - e.timestamp) <= 1000)
    ).length || events.reduce((sum, r) => {
      const hasServerPush = r.causes.some(c => c.type === 'zone' && (c.source === 'XMLHttpRequest' || c.source?.includes('fetch') || c.source?.includes('WebSocket')));
      return sum + (hasServerPush ? 1 : 0);
    }, 0);

    const totalTriggerEvents = routeChangesCount + userInteractionsCount + microTasksCount + serverPushesCount;
    const computedGlobalFrequency = totalTriggerEvents > 0 ? (renderCount / totalTriggerEvents) : 1;

    return {
      id: `snapshot-${Date.now()}`,
      label,
      createdAt: Date.now(),
      metrics: {
        issues: this.allIssues().length,
        components: stats.length,
        renders: renderCount,
        renderFrequency: computedGlobalFrequency,
        averageRenderDuration,
        totalRenderDuration,
        leaks: this.leakEvents().length,
        recommendations: this.trackByIssues().length + this.onPushRecommendations().length,
        hotspots: this.componentHotspots().filter(h => h.score >= 70).length,
      },
    };
  }

  private collectIssues(): Issue[] {
    const leaks = this.mapToIssues(this.leakEvents(), event => this.leakToIssue(event));
    const trackby = this.mapToIssues(this.trackByIssues(), issue => this.trackByToIssue(issue));
    const hot = this.mapToIssues(this.hotComponents(), stat => this.hotComponentToIssue(stat));
    const hotspots = this.mapToIssues(
      this.componentHotspots().filter(h => h.score >= 70),
      hotspot => this.hotspotToIssue(hotspot)
    );
    return [...leaks, ...trackby, ...hot, ...hotspots, ...this.zonePollutionIssues(), ...this.renderDiagnostics()];
  }

  private compareSnapshots(snapshots: PerformanceSnapshot[]): SnapshotComparison | null {
    if (snapshots.length < 2) return null;

    const baseline = snapshots[snapshots.length - 2];
    const current = snapshots[snapshots.length - 1];
    return {
      baseline,
      current,
      delta: this.metricDelta(baseline, current),
    };
  }

  private metricDelta(
    baseline: PerformanceSnapshot,
    current: PerformanceSnapshot
  ): PerformanceSnapshot['metrics'] {
    return {
      issues: current.metrics.issues - baseline.metrics.issues,
      components: current.metrics.components - baseline.metrics.components,
      renders: current.metrics.renders - baseline.metrics.renders,
      renderFrequency: current.metrics.renderFrequency - baseline.metrics.renderFrequency,
      averageRenderDuration: current.metrics.averageRenderDuration - baseline.metrics.averageRenderDuration,
      totalRenderDuration: current.metrics.totalRenderDuration - baseline.metrics.totalRenderDuration,
      leaks: current.metrics.leaks - baseline.metrics.leaks,
      recommendations: current.metrics.recommendations - baseline.metrics.recommendations,
      hotspots: current.metrics.hotspots - baseline.metrics.hotspots,
    };
  }

  private mapToIssues<T>(items: T[], mapper: (item: T) => Issue): Issue[] {
    return items.map(mapper);
  }

  private getTopCauseType(breakdown: Record<RenderCause['type'], number>): RenderCause['type'] {
    let winner: RenderCause['type'] = 'zone';
    let max = 0;
    for (const [type, count] of Object.entries(breakdown) as [RenderCause['type'], number][]) {
      if (count > max) { winner = type; max = count; }
    }
    return winner;
  }

  private rankHotspots(stats: ComponentStats[]): ComponentHotspot[] {
    return stats
      .map(stat => {
        const reasons: string[] = [];
        // Math.min(stat.renderFrequency / 120, 1) became very low under trigger density (e.g. 1.0 or 2.0).
        // Since trigger density usually operates in safe bounds [0, 5], we adjust the indicator score weights
        // so components with trigger frequency > 1.0 safely register higher hotspots.
        const renderRateScore = stat.renderFrequency >= 1.0
          ? Math.min(stat.renderFrequency * 20, 40)
          : Math.min(stat.renderFrequency / 120, 1) * 40;
        const durationScore = Math.min(stat.averageDuration / 16, 1) * 30;
        const totalCostScore = Math.min(stat.totalDuration / 250, 1) * 20;
        const cascadeScore = stat.causesBreakdown.parent > 5 ? 10 : 0;

        if (stat.renderFrequency > 1.0) reasons.push('excessive render frequency');
        if (stat.averageDuration > 16) reasons.push('slow average render time');
        if (stat.totalDuration > 250) reasons.push('high cumulative render cost');
        if (stat.causesBreakdown.parent > 5) reasons.push('frequent parent-triggered renders');
        if (reasons.length === 0) reasons.push('moderate render activity');

        return {
          componentName: stat.componentName,
          score: Math.round(Math.min(renderRateScore + durationScore + totalCostScore + cascadeScore, 100)),
          renderCount: stat.renderCount,
          renderFrequency: stat.renderFrequency,
          averageDuration: stat.averageDuration,
          totalDuration: stat.totalDuration,
          primaryCause: this.primaryCause(stat.causesBreakdown),
          reasons,
          route: stat.route,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  private buildInteractionProfiles(events: RenderEvent[]): InteractionProfile[] {
    if (events.length === 0) return [];

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const groups: RenderEvent[][] = [];
    let current: RenderEvent[] = [];

    for (const event of sorted) {
      const previous = current[current.length - 1];
      if (!previous || event.timestamp - previous.timestamp <= 750) {
        current.push(event);
      } else {
        groups.push(current);
        current = [event];
      }
    }
    if (current.length > 0) groups.push(current);

    return groups.slice(-25).map((group, index) => {
      const startTime = group[0].timestamp;
      const endTime = group[group.length - 1].timestamp;
      const componentNames = new Set(group.map(event => event.componentName));
      const totalRenderDuration = group.reduce((sum, event) => sum + event.duration, 0);
      const slowest = [...group].sort((a, b) => b.duration - a.duration)[0];
      const causeCounts = this.countCauses(group.flatMap(event => event.causes));

      return {
        id: `interaction-${startTime}-${index}`,
        label: `Interaction ${groups.length - groups.slice(-25).length + index + 1}`,
        startTime,
        endTime,
        duration: Math.max(endTime - startTime, slowest.duration),
        renderCount: group.length,
        componentCount: componentNames.size,
        totalRenderDuration,
        averageRenderDuration: totalRenderDuration / group.length,
        slowestComponent: slowest.componentName,
        dominantCause: this.primaryCause(causeCounts),
      };
    }).reverse();
  }

  private countCauses(causes: RenderCause[]): Record<string, number> {
    const counts: Record<string, number> = {
      signal: 0,
      input: 0,
      zone: 0,
      parent: 0,
      'manual-cd': 0,
    };
    for (const cause of causes) {
      counts[cause.type]++;
    }
    return counts;
  }

  private primaryCause(causes: Record<string, number>): RenderCause['type'] | 'unknown' {
    let winner: RenderCause['type'] | 'unknown' = 'unknown';
    let highest = 0;
    for (const [cause, count] of Object.entries(causes) as [RenderCause['type'], number][]) {
      if (count > highest) {
        winner = cause;
        highest = count;
      }
    }
    return winner;
  }

  private leakToIssue(event: LeakEvent): Issue {
    return {
      id: event.id,
      type: 'leak',
      componentName: event.componentName,
      severity: event.severity,
      title: `Possible leak risk in ${event.componentName}`,
      description: `Cleanup not detected for ${event.leakType} from "${event.source}" after component destruction.`,
      timestamp: event.detectedAt,
      route: event.route,
    };
  }

  private trackByToIssue(issue: TrackByIssue): Issue {
    return {
      id: issue.id,
      type: 'trackby',
      componentName: issue.componentName,
      severity: issue.severity,
      title: `Missing trackBy in ${issue.componentName}`,
      description: `Collection "${issue.collectionProperty}" has ${issue.collectionSize} items without trackBy.`,
      timestamp: Date.now(),
      route: issue.route,
    };
  }

  private hotComponentToIssue(stats: ComponentStats): Issue {
    return {
      id: `hot-${stats.componentName}`,
      type: 'render-hot',
      componentName: stats.componentName,
      severity: 'WARNING',
      title: `Hot component: ${stats.componentName}`,
      description: `Rendering ${Math.round(stats.renderFrequency)} times per minute (avg ${stats.averageDuration.toFixed(1)}ms).`,
      timestamp: stats.lastSeen,
      route: stats.route,
    };
  }

  private hotspotToIssue(hotspot: ComponentHotspot): Issue {
    return {
      id: `hotspot-${hotspot.componentName}`,
      type: 'hotspot',
      componentName: hotspot.componentName,
      severity: hotspot.score >= 90 ? 'CRITICAL' : 'WARNING',
      title: `Performance hotspot: ${hotspot.componentName}`,
      description: `${hotspot.score}/100 hotspot score from ${hotspot.reasons.join(', ')}.`,
      timestamp: Date.now(),
      route: hotspot.route,
    };
  }

  private pollutionSourceToIssue(source: PollutionSourceMetrics): Issue {
    const severityMap: Record<string, Issue['severity']> = {
      critical: 'CRITICAL',
      high: 'WARNING',
      medium: 'WARNING',
    };
    return {
      id: `zone-pollution-${source.source}`,
      type: 'zone-pollution',
      componentName: source.library ?? source.source,
      severity: severityMap[source.severity] ?? 'WARNING',
      title: `Zone pollution: ${source.library ?? source.source} (${Math.round(source.cdCyclesPerMinute)} CD/min)`,
      description: source.fixSuggestion ?? `${source.source} is triggering excessive change detection`,
      timestamp: source.lastSeen,
      route: source.route,
    };
  }
}

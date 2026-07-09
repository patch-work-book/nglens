import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { PanelState } from '../../state/panel.state';
import { displayName, formatRenderRate } from '../../utils/display-name';
import {
  buildRecommendationActions,
  confidenceClass,
  difficultyClass,
  gainClass,
  topQuickWins,
  type RecommendationAction,
} from '../../utils/recommendation-actions';
import type { ComponentHotspot, SnapshotComparison, Issue } from '../../../../../types/panel';
import type { RenderEvent } from '../../../../../types/render-events';

interface HealthSummary {
  label: string;
  detail: string;
  className: string;
  bannerClass: string;
  icon: string;
}

interface CompareMetric {
  label: string;
  baseline: string;
  current: string;
  delta: string;
  verdict: 'better' | 'worse' | 'same';
}

type EvidenceTab = 'hotspots' | 'environment' | 'compare';

@Component({
  selector: 'app-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
})
export class OverviewComponent {
  private readonly router = inject(Router);
  readonly state = inject(PanelState);
  readonly displayName = displayName;
  readonly confidenceClass = confidenceClass;
  readonly difficultyClass = difficultyClass;
  readonly gainClass = gainClass;

  // ── Collapse/Expand state ──
  readonly expanded = signal<{ issue: boolean; fix: boolean; env: boolean }>({ issue: false, fix: false, env: false });

  toggleSection(section: 'issue' | 'fix' | 'env'): void {
    this.expanded.update(s => ({ ...s, [section]: !s[section] }));
  }

  // ── Evidence Tab state ──
  readonly activeEvidenceTab = signal<EvidenceTab>('hotspots');

  readonly evidenceTabs = [
    { id: 'hotspots' as EvidenceTab, label: 'Hotspots', count: computed(() => this.state.componentHotspots().length) },
    { id: 'environment' as EvidenceTab, label: 'Environment', count: computed(() => this.activeZoneSources().length) },
    { id: 'compare' as EvidenceTab, label: 'Compare Runs', count: computed(() => this.state.snapshots().length) },
  ];

  readonly renderRateNumber = computed(() => {
    const events = this.state.renderEvents();
    if (events.length === 0) return 0;

    const activeFlowEvents = this.state.flowEvents();
    
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
    return totalTriggerEvents > 0 ? (events.length / totalTriggerEvents) : 1;
  });

  // ── Core computed data ──
  readonly actions = computed(() => buildRecommendationActions({
    trackByIssues: this.state.trackByIssues(),
    onPushRecommendations: this.state.onPushRecommendations(),
    hotspots: this.state.componentHotspots(),
    zonePollutionSources: this.state.zonePollutionSources(),
    leakEvents: this.state.leakEvents(),
  }));

  readonly quickWins = computed(() => topQuickWins(this.actions(), 3));
  readonly topAction = computed(() => this.quickWins()[0] ?? this.actions()[0] ?? null);
  readonly topHotspots = computed(() => this.state.componentHotspots().slice(0, 5));

  readonly issuesCount = computed(() => this.state.allIssues().length);
  readonly componentsCount = computed(() => this.state.componentStats().length);
  readonly memoryRiskCount = computed(() => this.state.leakEvents().length);
  readonly interactionsCount = computed(() => this.state.interactionProfiles().length);
  readonly highestHotspotScore = computed(() => this.topHotspots()[0]?.score ?? 0);

  readonly hasActivity = computed(() =>
    this.state.renderEvents().length > 0 ||
    this.state.leakEvents().length > 0 ||
    this.state.trackByIssues().length > 0 ||
    this.state.onPushRecommendations().length > 0 ||
    this.state.zonePollutionSources().length > 0
  );

  // ── Environment computeds ──
  readonly idleCdRate = computed(() => {
    const events = this.state.renderEvents();
    if (events.length === 0) return 0;
    const idleEvents = events.filter(e => !e.interactionComponent);
    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    const seconds = Math.max((last - first) / 1000, 1);
    return Number((idleEvents.length / seconds).toFixed(2));
  });

  readonly activeZoneSources = computed(() => {
    return this.state.zonePollutionSources().filter(source => source.severity !== 'low');
  });

  readonly environmentProfile = computed(() => {
    const idleRate = this.idleCdRate();
    const zoneSources = this.activeZoneSources().length;
    const hasHighActivity = idleRate > 5;
    const hasZonePollution = zoneSources > 0;

    if (hasZonePollution && hasHighActivity) return 'High Idle + Zone Pollution';
    if (hasZonePollution) return 'Zone Pollution Detected';
    if (hasHighActivity) return 'High Idle Activity';
    return 'Clean Environment';
  });

  readonly environmentHealthClass = computed(() => {
    const profile = this.environmentProfile();
    if (profile.includes('High Idle') && profile.includes('Zone')) return 'text-red-400';
    if (profile.includes('Zone') || profile.includes('High Idle')) return 'text-amber-400';
    return 'text-green-400';
  });

  // ── Issue computeds ──
  readonly topIssue = computed(() => {
    const criticalIssues = this.state.allIssues().filter(i => i.severity === 'CRITICAL');
    return criticalIssues[0] ?? null;
  });

  readonly impactEstimate = computed(() => {
    const topAction = this.topAction();
    if (!topAction) return 0;
    const match = topAction.expectedGain.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 15;
  });

  // ── Health Summary (Tier 1) ──
  readonly healthSummary = computed<HealthSummary>(() => {
    if (!this.hasActivity()) {
      return {
        label: 'Waiting for tracking data',
        detail: 'Start tracking, interact with your Angular page, then return here for analysis.',
        className: 'text-gray-200',
        bannerClass: 'banner-neutral',
        icon: '⏸',
      };
    }

    const topScore = this.topHotspots()[0]?.score ?? 0;
    const criticalMemory = this.state.leakEvents().some(e => e.severity === 'CRITICAL');
    const criticalZone = this.state.zonePollutionSources().some(s => s.severity === 'critical');

    if (topScore >= 90 || criticalMemory || criticalZone) {
      return {
        label: 'Critical Performance Issue',
        detail: 'Start with the highest-ranked fix. This recording contains a critical hotspot, zone trigger, or cleanup risk.',
        className: 'text-red-400',
        bannerClass: 'banner-red',
        icon: '🔴',
      };
    }

    if (topScore >= 70 || this.actions().length > 0) {
      return {
        label: 'Needs Review',
        detail: 'Actionable fixes ranked and ready. Start with quick wins for maximum impact.',
        className: 'text-amber-400',
        bannerClass: 'banner-amber',
        icon: '🟡',
      };
    }

    return {
      label: 'Healthy Performance',
      detail: 'No major hotspots detected. Keep this as a baseline before making changes.',
      className: 'text-green-400',
      bannerClass: 'banner-green',
      icon: '🟢',
    };
  });

  readonly bannerIssueSummary = computed<string | null>(() => {
    const hotspot = this.topHotspots()[0];
    if (!hotspot) return null;
    const cause = this.formatCauses(hotspot.primaryCause);
    const gain = this.impactEstimate();
    return `${displayName(hotspot.componentName)} (${formatRenderRate(hotspot.renderFrequency)}) from ${cause}${gain > 0 ? ` — ${gain}% gain if fixed` : ''}`;
  });

  // ── Navigation ──
  goToTab(tab: 'memory' | 'recommendations' | 'rendering'): void {
    this.state.activeTab.set(tab as any);
    this.router.navigate(['/' + tab]);
  }

  navigateToComponent(name: string): void {
    this.state.selectedComponent.set(name);
  }

  navigateToComponentInRenderTab(name: string): void {
    this.state.selectedComponent.set(name);
    this.state.activeTab.set('rendering');
    this.router.navigate(['/rendering']);
  }

  selectHotspot(hotspot: ComponentHotspot): void {
    this.state.selectedComponent.set(hotspot.componentName);
  }

  selectAction(action: RecommendationAction): void {
    this.state.selectedComponent.set(action.componentName);
    const matchingIssue = this.state.allIssues().find(issue =>
      issue.id === action.id ||
      issue.id === `zone-pollution-${action.componentName}` ||
      issue.id === `hotspot-${action.componentName}`
    );
    if (matchingIssue) {
      this.state.selectedIssue.set(matchingIssue);
    }
  }

  // ── Compare Runs ──
  saveBaseline(): void {
    this.state.clearSnapshots();
    this.state.captureSnapshot('Baseline');
  }

  captureCurrent(): void {
    if (this.state.snapshots().length === 0) return;
    this.state.captureSnapshot('Current');
  }

  resetComparison(): void {
    this.state.clearSnapshots();
  }

  comparisonStatus(): string {
    const count = this.state.snapshots().length;
    if (count === 0) return 'Save a baseline before comparing a later run.';
    if (count === 1) return 'Baseline saved. Capture current after the next run.';
    return 'Lower render cost, risk, and cleanup counts are better.';
  }

  comparisonMetrics(comparison: SnapshotComparison): CompareMetric[] {
    const baseline = comparison.baseline.metrics;
    const current = comparison.current.metrics;
    const delta = comparison.delta;

    return [
      this.lowerIsBetter('Render events', baseline.renders, current.renders, delta.renders),
      this.lowerIsBetter('Render frequency', baseline.renderFrequency, current.renderFrequency, delta.renderFrequency, '', (val) => formatRenderRate(val)),
      this.lowerIsBetter('Avg render cost', baseline.averageRenderDuration, current.averageRenderDuration, delta.averageRenderDuration, 'ms'),
      this.lowerIsBetter('Total render cost', baseline.totalRenderDuration, current.totalRenderDuration, delta.totalRenderDuration, 'ms'),
      this.lowerIsBetter('Open risks', baseline.issues, current.issues, delta.issues),
      this.lowerIsBetter('Cleanup risks', baseline.leaks, current.leaks, delta.leaks),
      this.lowerIsBetter('Render hotspots', baseline.hotspots, current.hotspots, delta.hotspots),
    ];
  }

  getMetricTooltip(label: string): string {
    switch (label) {
      case 'Render events':
        return 'Total count of component re-render events captured across the application.';
      case 'Render frequency':
        return 'The human-friendly re-rendering interval or frequency across all active components.';
      case 'Avg render cost':
        return 'The average CPU execution duration of a single rendering pass in milliseconds.';
      case 'Total render cost':
        return 'The cumulative CPU execution time spent rendering all active components.';
      case 'Open risks':
        return 'The total count of performance risk indicators and anti-patterns currently active.';
      case 'Cleanup risks':
        return 'The count of active memory cleanup risks (un-unsubscribed RxJS subscriptions, intervals, list keys, etc.).';
      case 'Render hotspots':
        return 'Components that re-render excessively, causing significant CPU bottlenecks.';
      default:
        return '';
    }
  }

  // ── Formatting helpers ──
  formatRenderRate(renderFrequency: number): string {
    return formatRenderRate(renderFrequency);
  }

  renderRate(): string {
    const events = this.state.renderEvents();
    if (events.length === 0) return '0.0';

    const activeFlowEvents = this.state.flowEvents();
    
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
    const rate = totalTriggerEvents > 0 ? (events.length / totalTriggerEvents) : 1;
    return rate.toFixed(1);
  }

  averageRenderDuration(): string {
    const events = this.state.renderEvents();
    if (events.length === 0) return '0.0';
    const total = events.reduce((sum, e) => sum + e.duration, 0);
    return (total / events.length).toFixed(1);
  }

  formatCauses(cause: string): string {
    const map: Record<string, string> = {
      zone: 'Zone Pollution',
      parent: 'Parent Cascade',
      input: 'Input Changes',
      signal: 'Signal Update',
      'manual-cd': 'Manual Trigger',
      unknown: 'Unknown',
    };
    return map[cause] || cause;
  }

  scoreClass(score: number): string {
    if (score >= 90) return 'text-red-400';
    if (score >= 70) return 'text-amber-400';
    if (score >= 40) return 'text-yellow-300';
    return 'text-green-400';
  }

  riskLabel(score: number): string {
    if (score >= 90) return 'critical';
    if (score >= 70) return 'high';
    if (score >= 40) return 'watch';
    return 'low';
  }

  causeLabel(cause: ComponentHotspot['primaryCause']): string {
    switch (cause) {
      case 'signal': return 'Signal';
      case 'input': return 'Input';
      case 'zone': return 'Zone';
      case 'parent': return 'Cascade';
      case 'manual-cd': return 'Manual CD';
      default: return 'Unknown';
    }
  }

  changeClass(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return 'text-green-300 bg-green-500/15 border-green-500/30';
      case 'worse': return 'text-red-300 bg-red-500/15 border-red-500/30';
      case 'same': return 'text-gray-300 bg-gray-700/25 border-gray-600/60';
    }
  }

  verdictClass(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return 'text-green-400';
      case 'worse': return 'text-red-400';
      case 'same': return 'text-gray-400';
    }
  }

  verdictLabel(verdict: CompareMetric['verdict']): string {
    switch (verdict) {
      case 'better': return '✓ Better';
      case 'worse': return '✗ Worse';
      case 'same': return '— Same';
    }
  }

  metricWhyLabel(label: string, verdict: CompareMetric['verdict']): string {
    if (verdict === 'same') return '';
    const better = verdict === 'better';
    switch (label) {
      case 'Render events': return better ? 'Fewer total re-renders' : 'More components re-rendering';
      case 'Render frequency': return better ? 'Lower render rate per minute' : 'Higher render rate — longer recording may skew this';
      case 'Avg render cost': return better ? 'Each render is faster' : 'Each render takes longer';
      case 'Total render cost': return better ? 'Less total CPU time in renders' : 'More total CPU time spent rendering';
      case 'Open risks': return better ? 'Fewer issues detected' : 'New issues surfaced';
      case 'Cleanup risks': return better ? 'Fewer memory leak risks' : 'New teardown issues appeared';
      case 'Render hotspots': return better ? 'Fewer high-frequency components' : 'More components rendering excessively';
      default: return '';
    }
  }

  // ── Private helpers ──
  private lowerIsBetter(
    label: string,
    baseline: number,
    current: number,
    delta: number,
    unit = '',
    formatFn?: (val: number) => string
  ): CompareMetric {
    return {
      label,
      baseline: formatFn ? formatFn(baseline) : this.fmtValue(baseline, unit),
      current: formatFn ? formatFn(current) : this.fmtValue(current, unit),
      delta: formatFn
        ? `${delta > 0 ? '+' : ''}${formatFn(delta)}`
        : this.fmtDelta(delta, unit),
      verdict: delta < 0 ? 'better' : delta > 0 ? 'worse' : 'same',
    };
  }

  private fmtValue(value: number, unit: string): string {
    const rounded = Math.abs(value) >= 10 || unit === ''
      ? Math.round(value).toString()
      : value.toFixed(1);
    return unit ? `${rounded}${unit}` : rounded;
  }

  private fmtDelta(value: number, unit: string): string {
    if (value === 0) return unit ? `0${unit}` : '0';
    const rounded = Math.abs(value) >= 10 || unit === ''
      ? Math.round(Math.abs(value)).toString()
      : Math.abs(value).toFixed(1);
    return `${value > 0 ? '+' : '-'}${rounded}${unit}`;
  }
}

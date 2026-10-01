/**
 * Overview — "Your application at a glance".
 *
 * A calm, evidence-first landing view. Every number here comes from a REAL
 * source (see the data map in each computed); nothing is fabricated. Where a
 * value cannot be honestly derived it is omitted or shown as an empty state.
 *
 * Notable honesty choices:
 *  - The "Capturing HH:MM:SS" timer uses PanelState.trackingStartedAt (a real
 *    wall-clock start), not a guess from event timestamps.
 *  - "Attention" items come from PanelState.allIssues() (the RecommendationEngine
 *    is a v2 stub that returns []), mapped CRITICAL→High / WARNING→Medium.
 *  - Recent-activity rows come from ExecutionSession (real renderCount /
 *    apiCallCount / componentCount / boundary / duration). Trigger labels are
 *    boundary-level only ("User interaction" / "Route change" / …) — we do not
 *    invent finer kinds like "Button click".
 *  - Duplicate-API count aggregates the real per-story `duplicate-api` insights.
 */
import { Component, inject, computed, signal, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { PanelState } from '../../state/panel.state';
import { ExecutionIntelligenceService } from '../../services/execution-intelligence.service';
import { displayName } from '../../utils/display-name';
import type { ExecutionSession } from '../../../../../types/execution-intelligence';

type TabTarget = 'rendering' | 'execution' | 'signals' | 'memory' | 'recommendations';
type AttentionSeverity = 'high' | 'medium' | 'low';
type AttentionAction = 'inspect-component' | 'open-memory' | 'open-execution';

interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  icon: 'render' | 'memory' | 'api';
  title: string;
  detail: string;
  targetComponent: string | null;
  action: AttentionAction;
  actionLabel: string;
}

interface ActivityRow {
  id: string;
  time: string;
  triggerLabel: string;   // boundary-level kind, e.g. "User interaction"
  triggerDetail: string;  // component / route context if any
  icon: 'user' | 'route' | 'bootstrap' | 'timer' | 'websocket' | 'other';
  duration: string;
  durationSlow: boolean;
  apis: number;
  renders: number;
  components: number;
}

@Component({
  selector: 'app-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.scss',
})
export class OverviewComponent implements OnDestroy {
  private readonly router = inject(Router);
  readonly state = inject(PanelState);
  readonly intelligence = inject(ExecutionIntelligenceService);
  readonly displayName = displayName;

  // ── Live clock tick (for the elapsed capturing timer + "N ago") ──
  private readonly now = signal(Date.now());
  private readonly ticker = setInterval(() => this.now.set(Date.now()), 1000);
  ngOnDestroy(): void { 
    clearInterval(this.ticker);
    this.detailModal.set(null); // Clear modal when leaving Overview
  }

  // ── Modal state (show detail before navigation) ──
  readonly detailModal = signal<AttentionItem | null>(null);

  // ── Capturing status ──
  readonly isCapturing = computed(() => this.state.isTracking());
  readonly captureElapsed = computed((): string | null => {
    const start = this.state.trackingStartedAt();
    if (start == null) return null;
    const secs = Math.max(0, Math.floor((this.now() - start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  });

  // ── Runtime snapshot counts (all real) ──
  readonly executionsCount = computed(() => this.intelligence.sessionCount());
  readonly renderCount = computed(() => this.state.renderEvents().length);
  readonly apiCallsCount = computed(() =>
    this.intelligence.executionSessions().reduce((sum, s) => sum + (s.apiCallCount ?? 0), 0),
  );
  /** Reactive events = signal writes + subject emits + store dispatches (real flow events). */
  readonly reactiveEventsCount = computed(() =>
    this.state.flowEvents().filter(f =>
      f.type === 'signal-write' || f.type === 'subject-emit' || f.type === 'store-dispatch',
    ).length,
  );
  /** Cleanup risks = leak-detector events (teardown not confirmed). Real. */
  readonly cleanupRiskCount = computed(() => this.state.leakEvents().length);

  readonly hasActivity = computed(() =>
    this.renderCount() > 0 ||
    this.executionsCount() > 0 ||
    this.cleanupRiskCount() > 0 ||
    this.state.allIssues().length > 0,
  );

  // ── Duplicate-API aggregate (across stories' real insights) ──
  readonly duplicateApiCount = computed(() => {
    let n = 0;
    for (const story of this.intelligence.executionStories()) {
      for (const ins of story.insights ?? []) {
        if (ins.category === 'duplicate-api') n++;
      }
    }
    return n;
  });

  // ── What needs your attention? (from allIssues + duplicate aggregate) ──
  readonly attentionItems = computed((): AttentionItem[] => {
    const items: AttentionItem[] = [];

    // Duplicate network calls (real aggregate). Only when detected.
    const dupes = this.duplicateApiCount();
    if (dupes > 0) {
      items.push({
        id: 'attn-duplicate-api',
        severity: 'high',
        icon: 'api',
        title: `${dupes} repeated API call${dupes === 1 ? '' : 's'}`,
        detail: 'Same request observed multiple times in a short period.',
        targetComponent: null,
        action: 'open-execution',
        actionLabel: 'Open Execution',
      });
    }

    // Render + memory issues from the real issue collection.
    for (const issue of this.state.allIssues()) {
      const severity = this.mapSeverity(issue.severity);
      if (severity === 'low') continue; // keep the list focused on what matters
      if (issue.type === 'leak') {
        items.push({
          id: issue.id,
          severity,
          icon: 'memory',
          title: issue.title,
          detail: issue.description,
          targetComponent: issue.componentName ?? null,
          action: 'open-memory',
          actionLabel: 'Open Memory',
        });
      } else if (issue.type === 'render-hot' || issue.type === 'hotspot') {
        items.push({
          id: issue.id,
          severity,
          icon: 'render',
          title: issue.title,
          detail: issue.description,
          targetComponent: issue.componentName ?? null,
          action: 'inspect-component',
          actionLabel: 'Inspect Component',
        });
      }
    }

    // High severity first, then medium; cap to keep the panel calm.
    const rank: Record<AttentionSeverity, number> = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
  });

  // ── Last activity (most recent session) ──
  readonly lastActivity = computed(() => {
    const sessions = this.intelligence.executionSessions();
    if (sessions.length === 0) return null;
    const last = sessions[sessions.length - 1];
    const comp = last.interactionComponent ? displayName(last.interactionComponent) : null;
    return {
      label: this.boundaryLabel(last),
      detail: comp ?? this.boundaryKind(last),
      ago: this.formatAgo(last.endTime),
    };
  });

  // ── Recent activity table (real per-session counts) ──
  readonly recentActivity = computed((): ActivityRow[] => {
    const sessions = [...this.intelligence.executionSessions()].reverse().slice(0, 6);
    return sessions.map(s => ({
      id: s.id,
      time: this.formatClock(s.startTime),
      triggerLabel: this.boundaryLabel(s),
      triggerDetail: s.interactionComponent ? displayName(s.interactionComponent) : this.boundaryKind(s),
      icon: this.boundaryIcon(s),
      duration: this.formatSpan(s.duration),
      durationSlow: s.duration >= 3000,
      apis: s.apiCallCount ?? 0,
      renders: s.renderCount ?? 0,
      components: s.componentCount ?? 0,
    }));
  });

  // ── Navigation cards (real routes) ──
  readonly navCards: Array<{ id: TabTarget; title: string; sub: string; icon: string }> = [
    { id: 'rendering', title: 'Components', sub: 'Why did this component render?', icon: 'components' },
    { id: 'execution', title: 'Execution', sub: 'What did this execution impact?', icon: 'execution' },
    { id: 'signals', title: 'Signals', sub: 'Why did reactive values change?', icon: 'signals' },
    { id: 'memory', title: 'Memory', sub: 'What is being retained?', icon: 'memory' },
  ];

  // ── Navigation + actions ──
  goToTab(tab: TabTarget): void {
    this.state.activeTab.set(tab);
    this.router.navigate(['/' + tab]);
  }

  openLastActivity(): void {
    this.goToTab('execution');
  }

  openActivityRow(_row: ActivityRow): void {
    // Rows represent execution sessions — send the developer to the Execution
    // tab to follow the full runtime story.
    this.goToTab('execution');
  }

  runAttention(item: AttentionItem): void {
    // Show the detail modal first, so the user can review before navigating
    this.detailModal.set(item);
  }

  /** Actually execute the attention action (called after modal review) */
  executeAttention(item: AttentionItem): void {
    this.detailModal.set(null); // Close modal
    switch (item.action) {
      case 'inspect-component':
        if (item.targetComponent) {
          this.state.selectedComponent.set(item.targetComponent);
        }
        this.goToTab('rendering');
        break;
      case 'open-memory':
        this.goToTab('memory');
        break;
      case 'open-execution':
        this.goToTab('execution');
        break;
    }
  }

  closeDetailModal(): void {
    this.detailModal.set(null);
  }

  // ── Honest label/format helpers ──
  private mapSeverity(sev: string): AttentionSeverity {
    if (sev === 'CRITICAL') return 'high';
    if (sev === 'WARNING') return 'medium';
    return 'low';
  }

  /** Boundary → a plain, honest trigger label (boundary-level granularity only). */
  private boundaryLabel(s: ExecutionSession): string {
    switch (s.boundary) {
      case 'user-interaction': return 'User interaction';
      case 'route-navigation': return 'Route change';
      case 'component-bootstrap': return 'Initial load';
      case 'timer': return 'Timer';
      case 'websocket': return 'WebSocket message';
      case 'background-task': return 'Background task';
      case 'manual-refresh': return 'Manual refresh';
      default: return 'Activity';
    }
  }
  private boundaryKind(s: ExecutionSession): string {
    switch (s.boundary) {
      case 'user-interaction': return 'User click';
      case 'route-navigation': return s.toRoute ? `→ ${s.toRoute}` : 'Route change';
      case 'component-bootstrap': return 'Initial load';
      case 'timer': return 'Timer fired';
      case 'websocket': return 'Socket message';
      default: return 'Runtime activity';
    }
  }
  private boundaryIcon(s: ExecutionSession): ActivityRow['icon'] {
    switch (s.boundary) {
      case 'user-interaction': return 'user';
      case 'route-navigation': return 'route';
      case 'component-bootstrap': return 'bootstrap';
      case 'timer': return 'timer';
      case 'websocket': return 'websocket';
      default: return 'other';
    }
  }

  private formatClock(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  private formatSpan(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }
  private formatAgo(ts: number): string {
    const secs = Math.max(0, Math.floor((this.now() - ts) / 1000));
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  }
}

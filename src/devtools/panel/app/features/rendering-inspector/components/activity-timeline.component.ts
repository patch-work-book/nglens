/**
 * ActivityTimelineComponent
 *
 * Multi-lane activity timeline for the selected action. Lays real events onto
 * time-proportional lanes so a developer can see the sequence: interaction →
 * API → state change → change detection → component renders.
 *
 * Data sources (all observed):
 * - flowEntries: interactions, API responses, signal writes, store dispatches
 * - timeline (render entries): component renders with depth + count
 *
 * Timing note: the x-axis uses real event timestamps (relative to the action
 * start). Per-render ms shown in tooltips is estimated and marked with ~.
 */
import { Component, input, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

interface RawTimelineEntry {
  id: string;
  timestamp: number;
  kind: 'flow' | 'render';
  icon: string;
  label: string;
  detail?: string;
  depth: number;
  duration?: number;
  count?: number;
}

interface RawFlowEntry {
  id: string;
  type: string;
  label: string;
  timestamp: number;
  icon?: string;
}

interface LaneEvent {
  id: string;
  label: string;
  icon: string;
  leftPct: number;
  widthPct: number;
  count?: number;
  duration?: number;
}

interface Lane {
  key: string;
  label: string;
  colorClass: string;
  events: LaneEvent[];
}

type TimelineFilter = 'all' | 'renders' | 'issues';

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tl">
      <div class="tl__header">
        <span class="tl__title">Timeline</span>
        <div class="tl__filters">
          <button class="tl__filter" [class.active]="filter() === 'all'" (click)="filter.set('all')">All Events</button>
          <button class="tl__filter" [class.active]="filter() === 'renders'" (click)="filter.set('renders')">Renders Only</button>
          <button class="tl__filter" [class.active]="filter() === 'issues'" (click)="filter.set('issues')">Issues Only</button>
        </div>
      </div>

      @if (lanes().length > 0) {
        <!-- Time axis -->
        <div class="tl__axis">
          @for (tick of ticks(); track tick) {
            <span class="tl__tick" [style.left.%]="(tick / totalMs()) * 100">{{ tick }}ms</span>
          }
        </div>

        <!-- Lanes -->
        <div class="tl__lanes">
          @for (lane of lanes(); track lane.key) {
            <div class="tl__lane">
              <span class="tl__lane-label">{{ lane.label }}</span>
              <div class="tl__lane-track">
                @for (ev of lane.events; track ev.id) {
                  <div class="tl__bar"
                       [class]="lane.colorClass"
                       [style.left.%]="ev.leftPct"
                       [style.width.%]="ev.widthPct"
                       [title]="tooltip(ev)"></div>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="tl__empty">No timeline events for this filter.</div>
      }
    </div>
  `,
  styles: [`
    .tl { display: flex; flex-direction: column; height: 100%; padding: 10px 12px; overflow: auto; }
    .tl__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .tl__title { font-size: 11px; font-weight: 700; color: var(--ri-text-bright); }
    .tl__filters { display: flex; gap: 1px; background: var(--ri-bg-card); border: 1px solid var(--ri-border); border-radius: 5px; padding: 2px; }
    .tl__filter {
      padding: 3px 8px; font-size: 9.5px; font-weight: 600; border: none;
      border-radius: 3px; cursor: pointer; color: var(--ri-text-muted); background: transparent;
    }
    .tl__filter:hover { color: var(--ri-text-secondary); }
    .tl__filter.active { background: var(--ri-accent-blue); color: var(--ri-text-bright); }

    .tl__axis { position: relative; height: 14px; margin-left: 120px; margin-bottom: 4px; }
    .tl__tick { position: absolute; font-size: 8px; color: var(--ri-text-muted); transform: translateX(-50%); }

    .tl__lanes { display: flex; flex-direction: column; gap: 3px; }
    .tl__lane { display: flex; align-items: center; height: 22px; }
    .tl__lane-label {
      width: 120px; flex-shrink: 0; font-size: 9.5px; color: var(--ri-text-secondary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 8px;
    }
    .tl__lane-track { position: relative; flex: 1; height: 100%; background: var(--ri-bg-deep); border-radius: 3px; }

    .tl__bar {
      position: absolute; top: 3px; height: 16px; min-width: 3px; border-radius: 2px; opacity: 0.85;
    }
    .tl__bar.lane--interaction { background: var(--ri-accent-purple); }
    .tl__bar.lane--api         { background: var(--ri-accent-cyan); }
    .tl__bar.lane--signal      { background: var(--ri-accent-green); }
    .tl__bar.lane--cd          { background: var(--ri-accent-amber); }
    .tl__bar.lane--render      { background: var(--ri-accent-red); }
    .tl__bar.lane--paint       { background: var(--ri-accent-blue); }

    .tl__empty { padding: 20px; text-align: center; color: var(--ri-text-muted); font-size: 10px; }
  `],
})
export class ActivityTimelineComponent {
  timeline = input<RawTimelineEntry[]>([]);
  flowEntries = input<RawFlowEntry[]>([]);
  actionStart = input<number>(0);

  readonly filter = signal<TimelineFilter>('all');

  /** Total span in ms across all events (min 1). */
  readonly totalMs = computed(() => {
    const all = [...this.timeline(), ...this.flowEntries()];
    if (all.length === 0) return 1;
    const start = this.startTs();
    let max = 0;
    for (const e of all) {
      const rel = e.timestamp - start + ((e as any).duration ?? 0);
      if (rel > max) max = rel;
    }
    return Math.max(1, max);
  });

  private readonly startTs = computed(() => {
    const all = [...this.timeline(), ...this.flowEntries()];
    if (all.length === 0) return this.actionStart();
    return Math.min(...all.map(e => e.timestamp));
  });

  readonly ticks = computed(() => {
    const total = this.totalMs();
    const step = total <= 100 ? 25 : total <= 500 ? 100 : Math.ceil(total / 5 / 50) * 50;
    const out: number[] = [];
    for (let t = 0; t <= total; t += step) out.push(t);
    return out;
  });

  readonly lanes = computed((): Lane[] => {
    const start = this.startTs();
    const total = this.totalMs();
    const f = this.filter();

    const pos = (ts: number, dur = 0) => ({
      leftPct: Math.max(0, Math.min(100, ((ts - start) / total) * 100)),
      widthPct: Math.max(1.2, Math.min(100, (Math.max(dur, 2) / total) * 100)),
    });

    // Build lane buckets
    const interaction: LaneEvent[] = [];
    const api: LaneEvent[] = [];
    const signal: LaneEvent[] = [];
    const cd: LaneEvent[] = [];
    const render: LaneEvent[] = [];

    // Flow entries → interaction / api / signal lanes
    if (f !== 'renders') {
      for (const flow of this.flowEntries()) {
        const p = pos(flow.timestamp);
        const ev: LaneEvent = { id: flow.id, label: flow.label, icon: flow.icon ?? '•', ...p };
        if (flow.type === 'http-response') api.push(ev);
        else if (flow.type === 'signal-write' || flow.type === 'subject-emit' || flow.type === 'store-dispatch') signal.push(ev);
        else if (flow.type === 'user-interaction' || flow.type === 'route-change') interaction.push(ev);
      }
    }

    // Render entries → render lane (+ derive a CD marker per render burst)
    for (const t of this.timeline()) {
      if (t.kind !== 'render') continue;
      // "Issues only" → keep re-rendered components (count > 1)
      if (f === 'issues' && (t.count ?? 1) <= 1) continue;
      const p = pos(t.timestamp, t.duration ?? 0);
      render.push({ id: t.id, label: t.label, icon: t.icon, count: t.count, duration: t.duration, ...p });
    }

    // Change-detection lane: a marker spanning the render activity window.
    if (render.length > 0 && f !== 'issues') {
      const left = Math.min(...render.map(r => r.leftPct));
      const right = Math.max(...render.map(r => r.leftPct + r.widthPct));
      cd.push({ id: 'cd-window', label: 'Change detection', icon: '🔄', leftPct: left, widthPct: Math.max(2, right - left) });
    }

    const built: Lane[] = [
      { key: 'interaction', label: 'User Interaction', colorClass: 'lane--interaction', events: interaction },
      { key: 'api', label: 'API Request', colorClass: 'lane--api', events: api },
      { key: 'signal', label: 'Signal / Store', colorClass: 'lane--signal', events: signal },
      { key: 'cd', label: 'Change Detection', colorClass: 'lane--cd', events: cd },
      { key: 'render', label: 'Component Renders', colorClass: 'lane--render', events: render },
    ];

    // Only show lanes that have events (cleaner UI).
    return built.filter(l => l.events.length > 0);
  });

  tooltip(ev: LaneEvent): string {
    let s = ev.label;
    if (ev.count && ev.count > 1) s += ` · ${ev.count}×`;
    if (ev.duration) s += ` · ~${ev.duration.toFixed(0)}ms (est)`;
    return s;
  }
}

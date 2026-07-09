import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import type { LeakEvent } from '../../../../../types/leak-events';

type LeakType = LeakEvent['leakType'];
type ViewMode = 'live' | 'destroyed';

interface LiveComponent {
  name: string;
  displayName: string;
  subscriptions: number;
  timers: number;
  listeners: number;
  total: number;
  status: 'healthy' | 'at-risk';
  riskReason: string | null;
}

interface DestroyedComponent {
  name: string;
  displayName: string;
  leaked: LeakEvent[];
  leakedCount: number;
  cleanedCount: number;
  severity: 'CRITICAL' | 'WARNING';
}

@Component({
  selector: 'app-memory',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './memory.component.html',
  styleUrl: './memory.component.scss',
})
export class MemoryComponent {
  readonly state = inject(PanelState);
  readonly viewMode = signal<ViewMode>('destroyed');

  // ── Live View: components currently active with their resource counts ──

  readonly liveComponents = computed<LiveComponent[]>(() => {
    const events = this.state.leakEvents();
    // Show all components with resources (both active and destroyed)
    const map = new Map<string, { subs: number; timers: number; listeners: number; hasDestroyed: boolean }>();

    for (const event of events) {
      const existing = map.get(event.componentName) ?? { subs: 0, timers: 0, listeners: 0, hasDestroyed: false };
      if (event.leakType === 'subscription') existing.subs++;
      else if (event.leakType === 'timer') existing.timers++;
      else existing.listeners++;
      if (event.lifecycleState === 'destroyed') existing.hasDestroyed = true;
      map.set(event.componentName, existing);
    }

    return Array.from(map.entries())
      .filter(([, counts]) => !counts.hasDestroyed) // Only show non-destroyed (still alive)
      .map(([name, counts]) => {
        const total = counts.subs + counts.timers + counts.listeners;
        const atRisk = total >= 5;
        return {
          name,
          displayName: displayName(name),
          subscriptions: counts.subs,
          timers: counts.timers,
          listeners: counts.listeners,
          total,
          status: atRisk ? 'at-risk' as const : 'healthy' as const,
          riskReason: atRisk ? `${total} resources — will leak if not cleaned on destroy` : null,
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  readonly totalActiveResources = computed(() =>
    this.liveComponents().reduce((s, c) => s + c.total, 0)
  );

  readonly atRiskCount = computed(() =>
    this.liveComponents().filter(c => c.status === 'at-risk').length
  );

  readonly totalLeakedCount = computed(() =>
    this.destroyedWithLeaks().reduce((sum, comp) => sum + comp.leakedCount, 0)
  );

  // ── Leak Report: components that were destroyed without cleanup ──

  readonly destroyedWithLeaks = computed<DestroyedComponent[]>(() => {
    const events = this.state.leakEvents();
    const destroyed = events.filter(e => e.lifecycleState === 'destroyed');

    const map = new Map<string, LeakEvent[]>();
    for (const event of destroyed) {
      const existing = map.get(event.componentName) ?? [];
      existing.push(event);
      map.set(event.componentName, existing);
    }

    return Array.from(map.entries())
      .map(([name, leaked]) => ({
        name,
        displayName: displayName(name),
        leaked,
        leakedCount: leaked.length,
        cleanedCount: 0,
        severity: leaked.some(e => e.severity === 'CRITICAL') ? 'CRITICAL' as const : 'WARNING' as const,
      }))
      .sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'CRITICAL' ? -1 : 1;
        return b.leakedCount - a.leakedCount;
      });
  });

  // ── Expand/collapse for leak details ──

  readonly expandedGroups = signal(new Set<string>());

  toggleGroup(name: string): void {
    const next = new Set(this.expandedGroups());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.expandedGroups.set(next);
  }

  isExpanded(name: string): boolean {
    return this.expandedGroups().has(name);
  }

  groupLeakEvents(events: LeakEvent[]): Array<{ key: string; type: LeakType; source: string; count: number }> {
    const map = new Map<string, { type: LeakType; source: string; count: number }>();
    for (const e of events) {
      const key = `${e.leakType}::${e.source}`;
      const existing = map.get(key);
      if (existing) { existing.count++; }
      else { map.set(key, { type: e.leakType, source: e.source, count: 1 }); }
    }
    return Array.from(map.entries())
      .map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Architect insight: detect systemic patterns ──

  readonly systemicPattern = computed<string | null>(() => {
    const live = this.liveComponents();
    const totalTimers = live.reduce((s, c) => s + c.timers, 0);
    const totalSubs = live.reduce((s, c) => s + c.subscriptions, 0);
    const atRisk = this.atRiskCount();

    if (totalTimers > 10 && atRisk > 2) {
      return `${totalTimers} active timers across ${atRisk} components. Consider a centralized polling service with automatic cleanup, instead of per-component setInterval calls.`;
    }
    if (totalSubs > 15) {
      return `${totalSubs} active subscriptions. Consider using takeUntilDestroyed() as a project-wide pattern, or migrate to signals to eliminate manual subscription management.`;
    }
    if (live.length > 5 && atRisk > Math.floor(live.length / 2)) {
      return `More than half of active components have high resource counts. This suggests missing cleanup patterns at the architecture level — consider a base component class with automatic teardown.`;
    }
    return null;
  });
}

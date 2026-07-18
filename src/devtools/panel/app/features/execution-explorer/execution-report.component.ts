/**
 * Execution Report - "Execution Timeline"
 * 
 * Horizontal waterfall showing WHEN things happened during an interaction.
 * Groups by phase: Interaction → APIs → Renders → Complete
 * Shows parallelism, bottlenecks, and timing gaps.
 * Handles page loads with 40+ APIs gracefully by grouping.
 */

import { Component, Input, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';

@Component({
  selector: 'app-execution-report',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="report">

      <!-- Header -->
      <div class="header">
        <div class="header-top">
          <span class="header-title">Execution Timeline</span>
          <span class="header-total">{{ duration() }}ms</span>
        </div>
        <div class="header-meta">
          {{ trigger() }} · {{ totalSteps() }} events · {{ uniqueComponents() }} components
        </div>
      </div>

      <!-- Overview Bar -->
      <div class="overview">
        <div class="overview-bar">
          @for (item of waterfall(); track item.id) {
            <div class="overview-tick" 
                 [class]="'type-' + item.type"
                 [style.left.%]="item.startPct" 
                 [style.width.%]="item.widthPct">
            </div>
          }
        </div>
        <div class="overview-labels">
          <span>0ms</span>
          <span>{{ Math.round(duration() / 2) }}ms</span>
          <span>{{ duration() }}ms</span>
        </div>
      </div>

      <!-- Unified Waterfall -->
      @if (waterfall().length > 0) {
        <div class="section">
          <div class="waterfall-header">
            <span class="wf-label">Event</span>
            <div class="wf-timeline-header">
              <span>0ms</span>
              <span>{{ Math.round(duration() / 2) }}ms</span>
              <span>{{ duration() }}ms</span>
            </div>
            <span class="wf-dur-label">Time</span>
          </div>
          <div class="waterfall">
            @for (item of waterfall(); track item.id) {
              <div class="wf-row" [class]="'type-' + item.type" [class.is-slow]="item.isSlow">
                <span class="wf-name" [title]="item.name">{{ item.name }}</span>
                <div class="wf-bar-track">
                  <div class="wf-bar" [style.left.%]="item.startPct" [style.width.%]="item.widthPct"></div>
                </div>
                <span class="wf-dur">{{ item.duration > 0 ? item.duration + 'ms' : '' }}</span>
              </div>
            }
          </div>
        </div>
      }

      <!-- Bottleneck -->
      @if (bottleneck()) {
        <div class="bottleneck">
          <span class="bottleneck-icon">⚠</span>
          <span class="bottleneck-text">{{ bottleneck() }}</span>
        </div>
      }

    </div>
  `,
  styles: [`
    .report {
      height: 100%; overflow-y: auto;
      background: rgb(30, 30, 30); color: rgb(204, 204, 204); font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Header */
    .header { padding: 10px 16px; border-bottom: 1px solid rgb(50, 50, 50); }
    .header-top { display: flex; justify-content: space-between; align-items: center; }
    .header-title { font-size: 12px; font-weight: 600; color: rgb(229, 229, 229); }
    .header-total { font-family: monospace; font-size: 12px; font-weight: 700; color: rgb(229, 229, 229); }
    .header-meta { font-size: 10px; color: rgb(128, 128, 128); margin-top: 3px; }

    /* Overview Bar */
    .overview { padding: 12px 16px; border-bottom: 1px solid rgb(50, 50, 50); }
    .overview-bar {
      position: relative; height: 20px; background: rgb(35, 35, 35);
      border-radius: 3px; overflow: hidden;
    }
    .overview-tick {
      position: absolute; top: 2px; height: 16px; min-width: 2px; border-radius: 1px; opacity: 0.7;
      &.type-api { background: rgba(59, 130, 246, 0.8); }
      &.type-render { background: rgba(168, 85, 247, 0.6); }
      &.type-store { background: rgba(234, 179, 8, 0.6); }
      &.type-signal { background: rgba(80, 200, 120, 0.6); }
    }
    .overview-labels {
      display: flex; justify-content: space-between; margin-top: 4px;
      font-size: 9px; color: rgb(100, 100, 100); font-family: monospace;
    }

    /* Waterfall */
    .section { padding: 8px 0; }
    .waterfall-header {
      display: flex; align-items: center; gap: 0; padding: 4px 16px;
      border-bottom: 1px solid rgb(50, 50, 50);
    }
    .wf-label { width: 200px; flex-shrink: 0; font-size: 9px; color: rgb(80, 80, 80); font-weight: 600; text-transform: uppercase; }
    .wf-timeline-header {
      flex: 1; display: flex; justify-content: space-between;
      font-size: 9px; color: rgb(80, 80, 80); font-family: monospace;
    }
    .wf-dur-label { width: 55px; flex-shrink: 0; text-align: right; font-size: 9px; color: rgb(100, 100, 100); }

    .waterfall { max-height: 500px; overflow-y: auto; }

    .wf-row {
      display: flex; align-items: center; padding: 0 16px; height: 24px;
      &:nth-child(even) { background: rgba(255, 255, 255, 0.015); }
      &:hover { background: rgba(255, 255, 255, 0.04); }
    }
    .wf-name {
      width: 200px; flex-shrink: 0; font-size: 10px; color: rgb(160, 160, 160);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      .type-api & { color: rgb(100, 160, 255); }
      .type-render & { color: rgb(200, 160, 255); }
      .type-store & { color: rgb(200, 170, 50); }
      .type-signal & { color: rgb(140, 200, 140); }
      .is-slow & { color: rgb(220, 90, 90); }
    }
    .wf-bar-track {
      flex: 1; height: 14px; position: relative; background: rgb(28, 28, 28);
      border-top: 1px solid rgb(40, 40, 40); border-bottom: 1px solid rgb(40, 40, 40);
    }
    .wf-bar {
      position: absolute; top: 2px; height: 10px; border-radius: 2px; min-width: 4px;
      opacity: 0.9;
      .type-api & { background: rgb(59, 130, 246); }
      .type-render & { background: rgb(147, 100, 220); }
      .type-store & { background: rgb(200, 160, 40); }
      .type-signal & { background: rgb(60, 180, 100); }
      .is-slow & { background: rgb(220, 70, 70); }
    }
    .wf-dur {
      width: 55px; flex-shrink: 0; text-align: right;
      font-family: monospace; font-size: 9px; color: rgb(80, 80, 80);
      .is-slow & { color: rgb(205, 100, 100); }
    }

    /* Bottleneck */
    .bottleneck {
      margin: 8px 16px; padding: 8px 12px; border-radius: 4px;
      background: rgba(205, 155, 0, 0.08); border: 1px solid rgba(205, 155, 0, 0.2);
      display: flex; align-items: center; gap: 6px;
    }
    .bottleneck-icon { font-size: 12px; }
    .bottleneck-text { font-size: 10px; color: rgb(205, 155, 0); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionReportComponent {
  Math = Math;

  @Input() set narrative(value: ExecutionNarrative | null) {
    if (value !== this.narrativeData()) {
      clearTimeout(this.debounceTimer);
      if (value === null) {
        // Clear immediately, no debounce
        this.narrativeData.set(null);
        this.cachedWaterfall = [];
        this.lastStepCount = 0;
      } else {
        this.debounceTimer = setTimeout(() => {
          this.narrativeData.set(value);
        }, 200);
      }
    }
  }

  readonly narrativeData = signal<ExecutionNarrative | null>(null);
  private debounceTimer: any;
  private lastStepCount = 0;
  private cachedWaterfall: any[] = [];

  // ─── Header ───
  readonly trigger = computed(() => this.narrativeData()?.trigger || 'No interaction');
  readonly duration = computed(() => this.narrativeData()?.duration || 0);
  readonly totalSteps = computed(() => this.narrativeData()?.originalStory?.steps?.length || 0);
  readonly uniqueComponents = computed(() => {
    const steps = this.narrativeData()?.originalStory?.steps || [];
    return new Set(steps.map((s: any) => s.title)).size;
  });

  // ─── Unified Waterfall ───
  readonly waterfall = computed(() => {
    const n = this.narrativeData();
    if (!n) {
      this.cachedWaterfall = [];
      this.lastStepCount = 0;
      return [];
    }

    const steps = n.originalStory?.steps || [];
    const total = n.duration || 1;
    const storyStart = n.originalStory?.startTime || 0;

    // If same step count, return cached (no flicker)
    if (steps.length === this.lastStepCount && this.cachedWaterfall.length > 0) {
      return this.cachedWaterfall;
    }

    // Only process new steps incrementally
    const newSteps = steps.slice(this.lastStepCount);
    this.lastStepCount = steps.length;

    newSteps.forEach((step: any) => {
      const title = step.title || '';
      const type = step.type || '';
      const itemStart = step.startTime || storyStart;
      const itemDur = step.duration || 0;

      // Determine type
      let category = 'render';
      if (type === 'data-fetch' || title.includes('GET ') || title.includes('POST ') || title.includes('Loaded')) {
        category = 'api';
      } else if (type === 'store-mutation' || title.includes('Store')) {
        category = 'store';
      } else if (type === 'state-update' || title.includes('Signal')) {
        category = 'signal';
      } else if (type === 'ui-update' || title.includes('Rendered') || title.includes('Component')) {
        category = 'render';
      }

      // Build display name
      let rawName = '';
      if (category === 'api') {
        rawName = step.summary || step.title || 'API';
      } else if (category === 'signal' && step.impact?.components?.names?.length > 0) {
        rawName = step.title + ' → ' + step.impact.components.names.slice(0, 3).join(', ');
      } else {
        rawName = step.title || step.summary || 'Unknown';
      }
      const displayName = rawName.replace(/^_/, '').replace(' Rendered', '').replace(' rendered', '');

      const startPct = total > 0 ? Math.max(0, ((itemStart - storyStart) / total) * 100) : 0;
      const widthPct = itemDur > 0 && total > 0 ? Math.max(1, (itemDur / total) * 100) : 2;

      // Group with last item if same name
      const last = this.cachedWaterfall[this.cachedWaterfall.length - 1];
      if (last && last.baseName === displayName && last.type === category) {
        last.groupCount++;
        last.name = `${displayName} (${last.groupCount}x)`;
        const endPct = startPct + widthPct;
        last.widthPct = Math.max(last.widthPct, endPct - last.startPct);
      } else {
        this.cachedWaterfall.push({
          id: `wf-${this.cachedWaterfall.length}`,
          name: displayName,
          baseName: displayName,
          type: category,
          startPct,
          widthPct,
          duration: itemDur,
          isSlow: itemDur > 300 || (category === 'render' && itemDur > 16),
          groupCount: 1,
        });
      }
    });

    return this.cachedWaterfall;
  });

  // ─── Bottleneck ───
  readonly bottleneck = computed((): string | null => {
    const n = this.narrativeData();
    if (!n) return null;

    const steps = n.originalStory?.steps || [];
    const total = n.duration || 0;

    // Find longest step
    let slowest: any = null;
    steps.forEach((step: any) => {
      if (!slowest || (step.duration || 0) > (slowest.duration || 0)) {
        slowest = step;
      }
    });

    if (slowest && slowest.duration > 100) {
      const pct = Math.round((slowest.duration / total) * 100);
      return `Bottleneck: ${slowest.title} (${slowest.duration}ms, ${pct}% of total)`;
    }

    // Check excessive renders
    const renderCounts = new Map<string, number>();
    steps.forEach((step: any) => {
      const title = step.title || '';
      if (title.includes('Rendered') || step.type === 'ui-update') {
        renderCounts.set(title, (renderCounts.get(title) || 0) + 1);
      }
    });

    let hottest = '';
    let hottestCount = 0;
    renderCounts.forEach((count, name) => {
      if (count > hottestCount) { hottest = name; hottestCount = count; }
    });

    if (hottestCount > 5) {
      return `${hottest} rendered ${hottestCount}x — consider OnPush or memoization`;
    }

    return null;
  });

}

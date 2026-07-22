/**
 * Execution Report - "Execution Timeline"
 * 
 * Horizontal waterfall showing WHEN things happened during an interaction.
 * Groups by phase: Interaction -> APIs -> Renders -> Complete
 * Shows parallelism, bottlenecks, and timing gaps.
 * Handles page loads with 40+ APIs gracefully by grouping.
 */

import { Component, Input, signal, computed, ChangeDetectionStrategy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';

/** Category metadata for filter dropdown */
interface FilterOption {
  key: string;
  label: string;
  color: string;
}

const CATEGORY_META: Record<string, FilterOption> = {
  api: { key: 'api', label: 'API', color: 'rgb(100, 160, 255)' },
  render: { key: 'render', label: 'Component', color: 'rgb(200, 160, 255)' },
  store: { key: 'store', label: 'State', color: 'rgb(200, 170, 50)' },
  signal: { key: 'signal', label: 'WebSocket / Signal', color: 'rgb(140, 200, 140)' },
};

@Component({
  selector: 'app-execution-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './execution-report.component.html',
  styleUrl: './execution-report.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionReportComponent {
  Math = Math;
  
  @Input() set narrative(value: ExecutionNarrative | null) {    
    if (value !== this.narrativeData()) {
      clearTimeout(this.debounceTimer);
      if (value === null) {
        this.narrativeData.set(null);
      } else {
        this.debounceTimer = setTimeout(() => {
          this.narrativeData.set(value);
        }, 200);
      }
    }
  }

  readonly narrativeData = signal<ExecutionNarrative | null>(null);
  private debounceTimer: any;
  private globalIdCounter = 0; // Unique ID counter to prevent duplicates

  formatTime(ms: number): string {
    if (ms >= 1000) {
      return (ms / 1000).toFixed(2) + 's';
    }
    return Math.round(ms) + 'ms';
  }

  readonly activeFilter = signal<string>('all');

  readonly availableFilters = computed((): FilterOption[] => {
    const items = this.waterfall();
    const types = new Set(items.map(i => i.type));
    return Object.values(CATEGORY_META).filter(opt => types.has(opt.key));
  });

  readonly filteredWaterfall = computed(() => {
    const filter = this.activeFilter();
    const items = this.waterfall();
    if (filter === 'all') return items;
    return items.filter(i => i.type === filter);
  });

  onFilterChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.activeFilter.set(value);
  }

  readonly trigger = computed(() => this.narrativeData()?.trigger || 'No interaction');
  readonly duration = computed(() => this.narrativeData()?.duration || 0);
  readonly totalSteps = computed(() => this.narrativeData()?.originalStory?.steps?.length || 0);
  readonly uniqueComponents = computed(() => {
    const steps = this.narrativeData()?.originalStory?.steps || [];
    return new Set(steps.map((s: any) => s.title)).size;
  });

  readonly waterfall = computed(() => {
    const n = this.narrativeData();
    
    if (!n) {
      return [];
    }

    const steps = n.originalStory?.steps || [];
    const total = n.duration || 1;
    const storyStart = n.originalStory?.startTime || 0;

    // Debug: Log first few steps to understand the structure
    if (steps.length > 0) {
      console.log('📊 First 3 steps:', steps.slice(0, 3).map((s: any) => ({
        title: s.title,
        type: s.type,
        duration: s.duration,
        hasComponents: !!s.impact?.components?.names?.length
      })));
    }

    const cachedWaterfall: any[] = [];

    // Track last counted timestamp per component name to coalesce rapid renders (matching Render Inspector's 50ms window)
    const lastCountedTs = new Map<string, number>();
    const SAME_CYCLE_MS = 50;

    steps.forEach((step: any) => {
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
      } else if (type === 'state-update' || type === 'signal-write' || title.includes('Signal') || title.includes('signal')) {
        // If the step has impacted components, treat it as a render (component re-rendered due to state change)
        if (step.impact?.components?.names?.length > 0) {
          category = 'render';
        } else {
          category = 'signal';
        }
      } else if (type === 'ui-update' || title.includes('Rendered') || title.includes('Component')) {
        category = 'render';
      }

      // Debug API detection
      if (category !== 'api' && (title.includes('GET ') || title.includes('POST ') || title.includes('Loaded') || title.includes('http') || type.includes('fetch') || type.includes('api'))) {
        console.log('⚠️ Step looks like API but categorized as', category, ':', { title, type });
      }

      // Build display names - for steps with multiple impacted components, create one entry per component
      const componentNames: string[] = [];
      if (category === 'api') {
        componentNames.push(step.summary || step.title || 'API');
      } else if (step.impact?.components?.names?.length > 0) {
        // Each component gets its own waterfall row
        step.impact.components.names.forEach((name: string) => {
          componentNames.push(name.replace(/^_/, '').replace(' Rendered', '').replace(' rendered', ''));
        });
      } else {
        componentNames.push(title || step.summary || 'Unknown');
      }

      // Create a waterfall entry for each component name
      componentNames.forEach((rawName: string) => {
        const displayName = rawName.replace(/^_/, '').replace(' Rendered', '').replace(' rendered', '');

        const startPct = total > 0 ? Math.max(0, ((itemStart - storyStart) / total) * 100) : 0;
        const widthPct = itemDur > 0 && total > 0 ? Math.max(1, (itemDur / total) * 100) : 2;

        // Group with last item if same name AND within 50ms coalescing window (matching Render Inspector deduplication)
        const last = cachedWaterfall[cachedWaterfall.length - 1];
        const cacheKey = `${displayName}-${category}`;
        const lastTs = lastCountedTs.get(cacheKey);
        const isDistinctRender = lastTs == null || (itemStart - lastTs) >= SAME_CYCLE_MS;

        if (last && last.baseName === displayName && last.type === category && isDistinctRender) {
          last.groupCount++;
          last.name = `${displayName} (${last.groupCount}x)`;
          const endPct = startPct + widthPct;
          last.widthPct = Math.max(last.widthPct, endPct - last.startPct);
          const newEndTime = Math.round((itemStart + itemDur - storyStart));
          if (newEndTime > last.endTime) {
            last.endTime = newEndTime;
          }
          lastCountedTs.set(cacheKey, itemStart);
        } else if (last && last.baseName === displayName && last.type === category && !isDistinctRender) {
          // Same render cycle (within 50ms), extend the bar width but don't increment count
          const endPct = startPct + widthPct;
          last.widthPct = Math.max(last.widthPct, endPct - last.startPct);
          last.duration = Math.max(last.duration, itemDur);
          const newEndTime = Math.round((itemStart + itemDur - storyStart));
          if (newEndTime > last.endTime) {
            last.endTime = newEndTime;
          }
        } else {
          const relativeEndTime = Math.round((itemStart + itemDur - storyStart));
          cachedWaterfall.push({
            id: `wf-${this.globalIdCounter++}`,
            name: displayName,
            baseName: displayName,
            type: category,
            startPct,
            widthPct,
            duration: itemDur,
            startTime: Math.round(itemStart - storyStart),
            endTime: relativeEndTime,
            isSlow: itemDur > 300 || (category === 'render' && itemDur > 16),
            groupCount: 1,
          });
          lastCountedTs.set(cacheKey, itemStart);
        }
      });
    });

    return cachedWaterfall;
  });

  readonly bottleneck = computed((): string | null => {
    const n = this.narrativeData();
    if (!n) return null;

    const steps = n.originalStory?.steps || [];
    const total = n.duration || 0;

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
      return `${hottest} rendered ${hottestCount}x - consider OnPush or memoization`;
    }

    return null;
  });
}

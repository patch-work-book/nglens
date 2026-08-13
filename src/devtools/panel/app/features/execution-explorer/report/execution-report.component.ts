/**
 * Execution Report Component — High-Density Grouped Swimlane Waterfall
 *
 * Transforms ExecutionNarrative into a grouped swimlane timeline with:
 * - Automatic batch grouping (parallel APIs, bootstrap cascades, signal bursts)
 * - Progressive disclosure (expand/collapse groups)
 * - Filter chips (All, Critical Path, Slow >16ms, Duplicates)
 * - Search across APIs, Signals, and Components
 * - Density toggle (Coalesced vs Expanded)
 * - Detail Inspector Drawer with timing, state diffs, and VS Code links
 * - Automated high-density issues alert box
 */

import { Component, Input, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, UpperCasePipe } from '@angular/common';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';
import {
  SwimlaneGroupingService,
  SwimlaneItem,
  SwimlaneGroup,
  SwimlaneResult,
} from '../../../services/swimlane-grouping.service';

type FilterMode = 'all' | 'critical' | 'slow' | 'duplicates';
type DensityMode = 'coalesced' | 'expanded';

@Component({
  selector: 'app-execution-report',
  standalone: true,
  imports: [CommonModule, UpperCasePipe],
  templateUrl: './execution-report.component.html',
  styleUrl: './execution-report.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionReportComponent {
  Math = Math;

  private readonly groupingService = inject(SwimlaneGroupingService);

  // ── Input ──
  @Input() set narrative(value: ExecutionNarrative | null) {
    if (value !== this._narrative()) {
      clearTimeout(this._debounceTimer);
      if (value === null) {
        this._narrative.set(null);
      } else {
        this._debounceTimer = setTimeout(() => {
          this._narrative.set(value);
        }, 80);
      }
    }
  }
  private _debounceTimer: any;
  private readonly _narrative = signal<ExecutionNarrative | null>(null);

  // ── State Signals ──
  readonly searchQuery = signal('');
  readonly activeFilter = signal<FilterMode>('all');
  readonly densityMode = signal<DensityMode>('coalesced');
  readonly expandedGroups = signal(new Set<string>());
  readonly selectedItem = signal<SwimlaneItem | null>(null);
  readonly hoveredItem = signal<SwimlaneItem | null>(null);

  // ── Derived: Build swimlane data from narrative ──
  readonly swimlaneData = computed((): SwimlaneResult | null => {
    const n = this._narrative();
    if (!n) return null;
    return this.groupingService.buildSwimlanes(n);
  });

  readonly trigger = computed((): string => {
    const n = this._narrative();
    return n?.trigger || 'No interaction';
  });

  // ── Derived: Apply filters and search ──
  readonly filteredResult = computed((): SwimlaneResult => {
    let data = this.swimlaneData();
    if (!data) {
      return { summary: { totalApis: 0, totalRenders: 0, totalSignals: 0, totalStoreUpdates: 0, duplicateApiCount: 0, totalDuration: 0, primaryBottleneck: null, bottleneckDuration: 0 }, lanes: [], issues: [], allItems: [], sessionDuration: 0 };
    }

    // Apply density mode: in expanded mode, flatten all groups
    if (this.densityMode() === 'expanded') {
      data = this.expandAllGroups(data);
    }

    // Apply filter
    const filter = this.activeFilter();
    switch (filter) {
      case 'critical':
        data = this.groupingService.filterCriticalPath(data);
        break;
      case 'slow':
        data = this.groupingService.filterSlow(data);
        break;
      case 'duplicates':
        data = this.groupingService.filterDuplicates(data);
        break;
    }

    // Apply search
    const query = this.searchQuery();
    if (query.trim()) {
      data = this.groupingService.filterByQuery(data, query);
    }

    return data;
  });

  // ── Actions ──

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  setFilter(mode: FilterMode): void {
    this.activeFilter.set(mode);
  }

  setDensity(mode: DensityMode): void {
    this.densityMode.set(mode);
  }

  toggleGroup(groupId: string): void {
    const next = new Set(this.expandedGroups());
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    this.expandedGroups.set(next);
  }

  isGroupExpanded(groupId: string): boolean {
    return this.expandedGroups().has(groupId);
  }

  selectItem(item: SwimlaneItem): void {
    const current = this.selectedItem();
    if (current?.id === item.id) {
      this.selectedItem.set(null);
    } else {
      this.selectedItem.set(item);
    }
  }

  clearSelection(): void {
    this.selectedItem.set(null);
  }

  hoverItem(item: SwimlaneItem | null): void {
    this.hoveredItem.set(item);
  }

  // ── Template Helpers ──

  isGroup(entry: SwimlaneItem | SwimlaneGroup): entry is SwimlaneGroup {
    return this.groupingService.isGroup(entry);
  }

  getEntryId(entry: SwimlaneItem | SwimlaneGroup): string {
    return entry.id;
  }

  getCategoryIcon(category: string): string {
    switch (category) {
      case 'api': return '🌐';
      case 'render': return '📦';
      case 'signal': return '⚡';
      case 'store': return '🗄';
      case 'interaction': return '🔘';
      default: return '•';
    }
  }

  getSourceFilePath(item: SwimlaneItem): string | null {
    if (!item || item.category !== 'render') return null;
    const name = item.title;
    if (!name) return null;
    const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/\s+component$/i, '');
    return `src/app/${kebab}/${kebab}.component.ts`;
  }

  openInVSCode(filePath: string): void {
    const url = `vscode://file/${filePath}`;
    window.open(url, '_blank');
  }

  formatTime(ms: number): string {
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms) + 'ms';
  }

  // ── Private Helpers ──

  /**
   * Expand all groups (flatten batch nodes into individual items).
   * Used in "Expanded" density mode.
   */
  private expandAllGroups(data: SwimlaneResult): SwimlaneResult {
    const expandedLanes = data.lanes.map(lane => {
      const flatEntries: Array<SwimlaneItem | SwimlaneGroup> = [];
      for (const entry of lane.entries) {
        if (this.groupingService.isGroup(entry)) {
          // Flatten group into individual items
          flatEntries.push(...(entry as SwimlaneGroup).items);
        } else {
          flatEntries.push(entry);
        }
      }
      return { ...lane, entries: flatEntries };
    });

    return { ...data, lanes: expandedLanes };
  }
}

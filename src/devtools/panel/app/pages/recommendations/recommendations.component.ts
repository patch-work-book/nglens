import { Component, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import {
  ActionConfidence,
  buildRecommendationActions,
  confidenceClass,
  difficultyClass,
  gainClass,
  type ActionConfidence,
  type ActionKind,
  type RecommendationAction,
} from '../../utils/recommendation-actions';

interface ComponentGroup {
  componentName: string;
  displayName: string;
  actions: RecommendationAction[];
  topKind: ActionKind;
  totalCount: number;
  highestConfidence: ActionConfidence;
  routes: string[];
}

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [NgClass],
  template: `
    <div class="h-full overflow-auto p-4 space-y-3">
      <!-- Summary -->
      <section class="border border-gray-800 rounded bg-gray-900 px-4 py-2.5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-xs font-semibold text-gray-100">Action Center</h2>
            <p class="text-[10px] text-gray-500">Grouped by component. Expand to see issues.</p>
          </div>
          <div class="flex gap-3">
            <div class="summary-cell">
              <span>Components</span>
              <strong>{{ componentGroups().length }}</strong>
            </div>
            <div class="summary-cell">
              <span>Total issues</span>
              <strong>{{ actions().length }}</strong>
            </div>
            <div class="summary-cell">
              <span>High confidence</span>
              <strong>{{ highConfidenceCount() }}</strong>
            </div>
            <div class="summary-cell">
              <span>Quick wins</span>
              <strong>{{ quickWinCount() }}</strong>
            </div>
          </div>
        </div>
      </section>

      <!-- Category filter tabs -->
      <div class="flex gap-1.5 flex-wrap">
        <button
          (click)="activeFilter.set('all')"
          class="filter-btn"
          [ngClass]="activeFilter() === 'all' ? 'filter-btn-active' : 'filter-btn-inactive'">
          All ({{ actions().length }})
        </button>
        @for (entry of kindCounts(); track entry.kind) {
          <button
            (click)="activeFilter.set(entry.kind)"
            class="filter-btn"
            [ngClass]="activeFilter() === entry.kind ? 'filter-btn-active' : 'filter-btn-inactive'">
            {{ kindLabel(entry.kind) }} ({{ entry.count }})
          </button>
        }
      </div>

      @if (filteredGroups().length === 0) {
        <div class="border border-green-800/50 rounded p-8 bg-green-900/15 text-center">
          <div class="text-green-300 font-semibold mb-1">No issues found</div>
          <div class="text-xs text-gray-400">Use the app while tracking to collect recommendation evidence.</div>
        </div>
      } @else {
        <!-- Component groups -->
        <div class="space-y-2">
          @for (group of filteredGroups(); track group.componentName; let i = $index) {
            <section class="border border-gray-800 rounded bg-gray-900 overflow-hidden">
              <!-- Component header (clickable to expand) -->
              <button
                type="button"
                class="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-800/50 transition-colors"
                (click)="toggleGroup(group.componentName)"
              >
                <!-- Index badge -->
                <div class="w-5 h-5 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-400 flex-shrink-0">
                  {{ i + 1 }}
                </div>
                <span class="text-[10px] text-gray-500">
                  {{ isExpanded(group.componentName) ? '▼' : '▶' }}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-semibold text-gray-100">{{ group.displayName }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                      {{ group.totalCount }} {{ group.totalCount === 1 ? 'issue' : 'issues' }}
                    </span>
                  </div>
                  <div class="flex gap-1.5 mt-1 items-center flex-wrap">
                    @for (action of group.actions.slice(0, 3); track action.id) {
                      <span class="kind-pill" [ngClass]="kindClass(action.kind)">
                        {{ kindLabel(action.kind) }}
                      </span>
                    }
                    @if (group.actions.length > 3) {
                      <span class="text-[10px] text-gray-500 mr-2">+{{ group.actions.length - 3 }} more</span>
                    }
                    @for (r of group.routes; track r) {
                      <span class="text-[9px] px-1.5 py-0.5 rounded-sm bg-indigo-950/50 text-indigo-300 border border-indigo-900/50 uppercase font-semibold tracking-wide">
                        🧭 {{ r }}
                      </span>
                    }
                  </div>
                </div>
                <span class="badge" [ngClass]="confidenceClass(group.highestConfidence)">
                  {{ group.highestConfidence }}
                </span>
              </button>

              <!-- Expanded: issues grouped by category -->
              @if (isExpanded(group.componentName)) {
                <div class="border-t border-gray-800 divide-y divide-gray-800/50">
                  @for (action of group.actions; track action.id; let subIdx = $index) {
                    <div class="px-4 py-3 pl-10">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="text-[10px] font-mono font-bold text-gray-500">#{{ i + 1 }}.{{ subIdx + 1 }}</span>
                            <span class="kind-pill" [ngClass]="kindClass(action.kind)">
                              {{ kindLabel(action.kind) }}
                            </span>
                            <span class="text-xs font-medium text-gray-100">{{ action.title }}</span>
                            @if (action.route) {
                              <span class="text-[9px] px-1.5 py-0.5 rounded bg-indigo-950/40 text-indigo-300 border border-indigo-900/40 font-semibold uppercase tracking-wider">
                                🧭 Route: {{ action.route }}
                              </span>
                            }
                          </div>
                          <p class="text-xs text-gray-400 mt-1">{{ action.evidence }}</p>
                          <p class="text-xs text-gray-500 mt-1 italic">Fix: {{ action.suggestedFix }}</p>
                        </div>
                        <div class="flex gap-1 flex-shrink-0">
                          <span class="badge" [ngClass]="confidenceClass(action.confidence)">
                            {{ action.confidence }}
                          </span>
                          <span class="badge" [ngClass]="gainClass(action.expectedGain)">
                            {{ action.expectedGain }}
                          </span>
                        </div>
                      </div>
                      @if (action.snippet) {
                        <pre class="snippet mt-2"><code>{{ action.snippet }}</code></pre>
                      }
                    </div>
                  }
                </div>
              }
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .summary-cell {
      background: rgb(31 41 55 / 0.45);
      border: 1px solid rgb(55 65 81 / 0.55);
      border-radius: 4px;
      padding: 4px 10px;
      min-width: 0;
      text-align: center;
    }

    .summary-cell span {
      display: block;
      color: #9ca3af;
      font-size: 9px;
      text-transform: uppercase;
      font-weight: 700;
    }

    .summary-cell strong {
      display: block;
      color: #f3f4f6;
      font-size: 14px;
      margin-top: 1px;
    }

    .badge,
    .kind-pill {
      border: 1px solid rgb(75 85 99 / 0.55);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      line-height: 1.2;
      white-space: nowrap;
    }

    .filter-btn {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: all 0.15s;
    }

    .filter-btn-active {
      background: rgb(59 130 246 / 0.2);
      border-color: rgb(59 130 246 / 0.5);
      color: #93c5fd;
    }

    .filter-btn-inactive {
      background: rgb(31 41 55 / 0.45);
      border-color: rgb(55 65 81 / 0.55);
      color: #9ca3af;
    }

    .filter-btn-inactive:hover {
      color: #d1d5db;
      border-color: rgb(75 85 99 / 0.7);
    }

    .snippet {
      margin: 0;
      max-height: 100px;
      overflow: auto;
      white-space: pre-wrap;
      background: rgb(3 7 18 / 0.7);
      border: 1px solid rgb(55 65 81 / 0.75);
      border-radius: 4px;
      color: #bfdbfe;
      font-size: 11px;
      line-height: 1.45;
      padding: 8px;
    }
  `],
})
export class RecommendationsComponent {
  readonly state = inject(PanelState);
  readonly displayName = displayName;
  readonly confidenceClass = confidenceClass;
  readonly difficultyClass = difficultyClass;
  readonly gainClass = gainClass;

  readonly activeFilter = signal<'all' | ActionKind>('all');
  readonly expandedComponents = signal<Set<string>>(new Set());

  readonly actions = computed(() => buildRecommendationActions({
    trackByIssues: this.state.trackByIssues(),
    onPushRecommendations: this.state.onPushRecommendations(),
    hotspots: this.state.componentHotspots(),
    zonePollutionSources: this.state.zonePollutionSources(),
    leakEvents: this.state.leakEvents(),
    componentStats: this.state.componentStats(),
  }));

  readonly highConfidenceCount = computed(() =>
    this.actions().filter(a => a.confidence === 'High').length
  );

  readonly quickWinCount = computed(() =>
    this.actions().filter(a => a.difficulty === 'Easy' && a.expectedGain !== 'Small').length
  );

  readonly kindCounts = computed(() => {
    const counts = new Map<ActionKind, number>();
    for (const action of this.actions()) {
      counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
  });

  readonly componentGroups = computed<ComponentGroup[]>(() => {
    const map = new Map<string, RecommendationAction[]>();
    for (const action of this.actions()) {
      const existing = map.get(action.componentName) ?? [];
      existing.push(action);
      map.set(action.componentName, existing);
    }

    const groups: ComponentGroup[] = [];
    for (const [componentName, actions] of map) {
      const confidencePriority = { 'High': 3, 'Medium': 2, 'Heuristic': 1 };
      const highest = actions.reduce((best, a) =>
        (confidencePriority[a.confidence] ?? 0) > (confidencePriority[best.confidence] ?? 0) ? a : best
      );

      const routes = Array.from(new Set(actions.map(a => a.route).filter(Boolean))) as string[];

      groups.push({
        componentName,
        displayName: displayName(componentName),
        actions,
        topKind: actions[0].kind,
        totalCount: actions.length,
        highestConfidence: highest.confidence,
        routes,
      });
    }

    return groups.sort((a, b) => {
      const confA = { 'High': 3, 'Medium': 2, 'Heuristic': 1 }[a.highestConfidence] ?? 0;
      const confB = { 'High': 3, 'Medium': 2, 'Heuristic': 1 }[b.highestConfidence] ?? 0;
      if (confB !== confA) return confB - confA;
      return b.totalCount - a.totalCount;
    });
  });

  readonly filteredGroups = computed<ComponentGroup[]>(() => {
    const filter = this.activeFilter();
    if (filter === 'all') return this.componentGroups();

    return this.componentGroups()
      .map(group => ({
        ...group,
        actions: group.actions.filter(a => a.kind === filter),
        totalCount: group.actions.filter(a => a.kind === filter).length,
      }))
      .filter(group => group.actions.length > 0);
  });

  toggleGroup(componentName: string): void {
    this.expandedComponents.update(set => {
      const next = new Set(set);
      if (next.has(componentName)) {
        next.delete(componentName);
      } else {
        next.add(componentName);
      }
      return next;
    });
  }

  isExpanded(componentName: string): boolean {
    return this.expandedComponents().has(componentName);
  }

  kindLabel(kind: ActionKind): string {
    switch (kind) {
      case 'trackby': return 'List';
      case 'onpush': return 'OnPush';
      case 'zone': return 'Zone';
      case 'render-hotspot': return 'Render';
      case 'memory-cleanup': return 'Memory';
    }
  }

  kindClass(kind: ActionKind): string {
    switch (kind) {
      case 'trackby': return 'text-orange-300 bg-orange-500/15 border-orange-500/30';
      case 'onpush': return 'text-purple-300 bg-purple-500/15 border-purple-500/30';
      case 'zone': return 'text-blue-300 bg-blue-500/15 border-blue-500/30';
      case 'render-hotspot': return 'text-amber-300 bg-amber-500/15 border-amber-500/30';
      case 'memory-cleanup': return 'text-red-300 bg-red-500/15 border-red-500/30';
    }
  }
}

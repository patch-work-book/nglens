import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgClass } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import {
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
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

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
import { Router } from '@angular/router';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';
import { PanelState } from '../../../state/panel.state';
import { ExecutionIntelligenceService } from '../../../services/execution-intelligence.service';
import {
  SwimlaneGroupingService,
  SwimlaneItem,
  SwimlaneGroup,
  SwimlaneResult,
  HighDensityIssue,
} from '../../../services/swimlane-grouping.service';
import { ExecutionImpactComponent } from '../impact/execution-impact.component';
import {
  buildStoryModel, buildStoryPhases, buildImpactFlow, buildStoryStats,
  type StoryPhaseModel, type StoryNode, type ImpactFlow, type StoryStats,
} from '../utils/story-model';
import { buildEventDetail, type EventDetail } from '../utils/event-detail';
import { buildExecutionImpact, type ExecutionImpact } from '../utils/execution-impact-model';
import { computeFocusChain } from '../utils/focus-chain';

type ExecutionView = 'story' | 'timeline' | 'bottomup';

type FilterMode = 'all' | 'critical' | 'slow' | 'duplicates';
type DensityMode = 'coalesced' | 'expanded';

@Component({
  selector: 'app-execution-report',
  standalone: true,
  imports: [CommonModule, UpperCasePipe, ExecutionImpactComponent],
  templateUrl: './execution-report.component.html',
  styleUrl: './execution-report.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionReportComponent {
  Math = Math;

  private readonly groupingService = inject(SwimlaneGroupingService);
  private readonly router = inject(Router);
  private readonly state = inject(PanelState);
  private readonly intelligence = inject(ExecutionIntelligenceService);

  /** Primary view: Story (follow the execution) or Timeline (timing/concurrency). */
  readonly viewMode = signal<ExecutionView>('story');
  setView(mode: ExecutionView): void { this.viewMode.set(mode); }

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

  // ── Story view model (evidence-first spine) ──
  // Built purely from the story's ordered steps + the session's execution graph
  // (for per-edge evidence). No fabricated relationships; missing edges surface
  // as Unknown inside buildStoryModel.
  readonly storyModel = computed((): StoryPhaseModel | null => {
    const n = this._narrative();
    const story = n?.originalStory;
    if (!story) return null;
    const graph = story.sessionId ? this.intelligence.getGraph(story.sessionId) : undefined;
    const flat = buildStoryModel(story.steps, graph, this.intelligence.getEventMap() as Map<any, any>);
    return buildStoryPhases(flat);
  });

  /** Impact-flow chips (User → Router → API → renders → State/Signals), with
   *  reactive lanes shown as "not observed" when empty. No fabricated chain. */
  readonly impactFlow = computed((): ImpactFlow | null => {
    const m = this.storyModel();
    return m ? buildImpactFlow(m) : null;
  });

  /** Left-rail / header counts. Duplicates + slow come from the existing
   *  swimlane detectors so we never re-derive a competing rule. */
  readonly storyStats = computed((): StoryStats | null => {
    const m = this.storyModel();
    if (!m) return null;
    const sw = this.swimlaneData();
    const slow = sw ? sw.allItems.filter(i => i.isSlow).length : 0;
    return buildStoryStats(m, { duplicates: sw?.summary.duplicateApiCount ?? 0, slow });
  });

  /** Execution Impact centerpiece: footprint + evidence-labelled impact tree. */
  readonly executionImpact = computed((): ExecutionImpact | null => {
    const m = this.storyModel();
    const s = this.storyStats();
    if (!m || !s) return null;
    const story = this._narrative()?.originalStory;
    const graph = story?.sessionId ? this.intelligence.getGraph(story.sessionId) : undefined;
    return buildExecutionImpact(m, s, graph);
  });

  /** Bottom-up view: every component with its total render count in this
   *  execution, sorted heaviest first. Reuses the phase rollup — real counts,
   *  no causal claim. */
  readonly bottomUp = computed((): Array<{ id: string; name: string; count: number }> => {
    const m = this.storyModel();
    if (!m) return [];
    const byName = new Map<string, { id: string; name: string; count: number }>();
    for (const p of m.phases) {
      if (p.category !== 'component') continue;
      for (const r of p.rollup) {
        const existing = byName.get(r.name);
        if (existing) existing.count += r.count;
        else byName.set(r.name, { id: r.node.id, name: r.name, count: r.count });
      }
    }
    return [...byName.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  /** Detail model for the currently selected node (right inspector). */
  readonly selectedDetail = computed((): EventDetail | null => {
    const stepId = this.selectedStepId();
    const m = this.storyModel();
    const n = this._narrative();
    const story = n?.originalStory;
    if (!stepId || !m || !story) return null;
    // Find the selected node across phases.
    let found: StoryNode | undefined;
    for (const p of m.phases) {
      const hit = p.nodes.find(x => x.id === stepId);
      if (hit) { found = hit; break; }
    }
    if (!found) return null;
    const graph = story.sessionId ? this.intelligence.getGraph(story.sessionId) : undefined;
    const eventMap = this.intelligence.getEventMap() as Map<string, any>;
    const event = found.eventId ? eventMap.get(found.eventId) : undefined;
    return buildEventDetail(found, event, graph, eventMap);
  });

  /** Shared selection projected as a step id, so the Story highlights the same
   *  item the Timeline has selected (single source of truth = selectedItem). */
  readonly selectedStepId = computed((): string | null => {
    const item = this.selectedItem();
    return item?.stepData?.id ?? null;
  });

  /**
   * Story node selected → set the SHARED selection to the matching swimlane
   * item (matched by step id) so Story and Timeline always agree (spec §13/§51).
   * If no swimlane item corresponds (e.g. an item filtered out), selection is
   * left unchanged rather than desynced.
   */
  selectStoryNode(node: StoryNode): void {
    const data = this.swimlaneData();
    const match = data?.allItems.find(i => i.stepData?.id === node.id);
    if (match) {
      this.selectedItem.set(this.selectedItem()?.id === match.id ? null : match);
      this.clearFocus(); // selection changed — drop any stale focus chain
    }
  }

  /** Select a Story node by its id (from an Impact-tree node click) so the
   *  developer moves into the detailed Story/Timeline with it selected. */
  selectStoryNodeById(id: string): void {
    const m = this.storyModel();
    if (!m) return;
    const node = m.phases.flatMap(p => p.nodes).find(n => n.id === id);
    if (node) this.selectStoryNode(node);
  }

  /** Inspect a component by display name (from the impact inspector). Reuses the
   *  shared cross-tab selection like the rest of the app. */
  inspectComponentByName(name: string): void {
    const clean = (name || '').replace(/\s+rendered$/i, '').trim();
    if (!clean) return;
    this.state.selectedComponent.set(clean);
    this.state.activeTab.set('rendering' as any);
    this.router.navigate(['/rendering']);
  }

  /** Jump-to-target from the left rail: select the relevant node so the spine
   *  highlights it and the inspector opens. All targets resolve to real events;
   *  a target with no matching data is a no-op (never a fabricated selection). */
  onStoryJump(target: 'first-api' | 'largest-render' | 'duplicates' | 'slowest' | 'last'): void {
    const m = this.storyModel();
    if (!m) return;
    const allNodes = m.phases.flatMap(p => p.nodes);
    let node: StoryNode | undefined;
    switch (target) {
      case 'first-api':
        node = allNodes.find(n => n.category === 'api');
        break;
      case 'largest-render': {
        // The component phase with the highest single-component count.
        let best: { node: StoryNode; count: number } | null = null;
        for (const p of m.phases) {
          if (p.category !== 'component') continue;
          const top = p.rollup[0];
          if (top && (!best || top.count > best.count)) best = { node: top.node, count: top.count };
        }
        node = best?.node;
        break;
      }
      case 'duplicates': {
        const dup = this.swimlaneData()?.allItems.find(i => i.isDuplicate);
        node = dup ? allNodes.find(n => n.id === dup.stepData?.id) : undefined;
        break;
      }
      case 'slowest':
        node = allNodes.filter(n => n.measuredMs != null).sort((a, b) => (b.measuredMs ?? 0) - (a.measuredMs ?? 0))[0];
        break;
      case 'last':
        node = allNodes[allNodes.length - 1];
        break;
    }
    if (node) this.selectStoryNode(node);
  }

  // ── Focus chain state (evidence-only) ──
  /** The focused event-id set + whether a real relationship exists. Null = off. */
  private readonly focusChainState = signal<{ ids: Set<string>; hasRelationship: boolean } | null>(null);

  /** Whether focus mode is active. */
  readonly focusActive = computed(() => this.focusChainState() !== null);
  /** True when the focused chain reaches beyond the selection (real edges). */
  readonly focusHasRelationship = computed(() => this.focusChainState()?.hasRelationship ?? false);

  /**
   * Story node ids in the focused chain (mapped from focused EVENT ids via each
   * node's eventId). Used by the impact view to keep focused rows bright and dim
   * the rest. Empty set when focus is off.
   */
  readonly focusedNodeIds = computed((): Set<string> => {
    const focus = this.focusChainState();
    const m = this.storyModel();
    if (!focus || !m) return new Set<string>();
    const out = new Set<string>();
    for (const p of m.phases) {
      for (const n of p.nodes) {
        if (n.eventId && focus.ids.has(n.eventId)) out.add(n.id);
      }
    }
    return out;
  });

  /**
   * Focus chain — the signature "select → follow" interaction, built ONLY on
   * real graph edges. We trace the selected event's ancestors + descendants
   * through the session graph; the union is the focused chain. When the event
   * has no edges, the chain is just itself and the UI says
   * "No causal relationship observed." — we never fabricate a chain.
   */
  onFocusChain(): void {
    const stepId = this.selectedStepId();
    const m = this.storyModel();
    const story = this._narrative()?.originalStory;
    if (!stepId || !m || !story?.sessionId) return;

    // Resolve the selected node's underlying event id.
    let eventId: string | null = null;
    for (const p of m.phases) {
      const hit = p.nodes.find(n => n.id === stepId);
      if (hit) { eventId = hit.eventId; break; }
    }
    if (!eventId) return;

    const graph = this.intelligence.getGraph(story.sessionId);
    if (!graph) { this.focusChainState.set(computeFocusChain(eventId, [], [])); return; }

    const engine = this.intelligence.getGraphEngine();
    const ancestors = graph.nodes.has(eventId) ? engine.getAncestors(graph, eventId).ancestorIds : [];
    const descendants = graph.nodes.has(eventId) ? engine.getDescendants(graph, eventId) : [];
    this.focusChainState.set(computeFocusChain(eventId, ancestors, descendants));
  }

  /** Exit focus mode (Clear button). */
  clearFocus(): void {
    this.focusChainState.set(null);
  }

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
    this.clearFocus();
  }

  clearSelection(): void {
    this.selectedItem.set(null);
    this.clearFocus();
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

  /**
   * The MEASURED duration of a swimlane item, in ms, or null when none exists.
   * SwimlaneItem.duration is span-based and is 0 for single-instant events; the
   * real measured value lives on the underlying runtime event (HTTP request
   * time, render estimate). We prefer the event's duration, fall back to the
   * item's own duration only when it is > 0, and return null otherwise — so the
   * UI shows "—" instead of a misleading "0ms".
   */
  measuredDuration(item: SwimlaneItem): number | null {
    const eventId = item?.stepData?.eventIds?.[0];
    const ev = eventId ? this.intelligence.getEvent(eventId) : undefined;
    if (ev?.duration != null && ev.duration > 0) return ev.duration;
    if (item?.duration != null && item.duration > 0) return item.duration;
    return null;
  }

  /** End offset = start offset + measured duration (falls back to item.endTime). */
  itemEndOffset(item: SwimlaneItem): number {
    const d = this.measuredDuration(item);
    return d != null ? item.startTime + d : item.endTime;
  }

  /**
   * Issue navigation (spec §34): jump to the first timeline item the issue
   * references, selecting it so the drawer opens and the row highlights.
   */
  selectIssue(issue: HighDensityIssue): void {
    const firstId = issue.relatedItemIds?.[0];
    if (!firstId) return;
    const data = this.swimlaneData();
    const target = data?.allItems.find(i => i.id === firstId);
    if (target) this.selectedItem.set(target);
  }

  /**
   * Inspect-in-Components navigation (spec §13/§33/§45): reuse the shared
   * cross-tab selection (PanelState.selectedComponent + activeTab) and router,
   * exactly like the Overview tab — no duplicate Components diagnostics here.
   */
  inspectInComponents(item: SwimlaneItem): void {
    if (!item || item.category !== 'render') return;
    // Strip the trailing "rendered" verb the swimlane may keep; use the class name.
    const name = (item.title || '').replace(/\s+rendered$/i, '').trim();
    if (!name) return;
    this.state.selectedComponent.set(name);
    this.state.activeTab.set('rendering' as any);
    this.router.navigate(['/rendering']);
  }

  // ── Evidence model (spec §8/§9/§10/§43) ────────────────────────────────────
  // ngLens directly MEASURES timing (durations, start/end) — that is Observed.
  // Relationships between steps (affected components, cause chains) are derived
  // from name-matching + temporal proximity — that is at most Correlated/Inferred,
  // never proven causality. When nothing supports a relationship, it is Unknown.

  /**
   * Evidence level for an item's own measured attributes (timing). Timing is
   * instrument-measured, so it is Observed.
   */
  timingEvidence(): { label: string; level: 'observed' | 'correlated' | 'inferred' | 'unknown' } {
    return { label: 'Observed', level: 'observed' };
  }

  /**
   * Evidence level for the "affected components" relationship. This comes from
   * impact analysis (name-matching + same-window co-occurrence), so it is
   * Correlated at best — not a proven causal edge.
   */
  affectedEvidence(): { label: string; level: 'observed' | 'correlated' | 'inferred' | 'unknown' } {
    return { label: 'Correlated', level: 'correlated' };
  }

  /**
   * Evidence level for a root-cause chain. Derived from the chain's own
   * confidence (0-1) when present; otherwise Inferred. Never "Observed" because
   * the chain is reconstructed from heuristics, not a directly captured edge.
   */
  causeEvidence(item: SwimlaneItem): { label: string; level: 'correlated' | 'inferred' | 'unknown' } {
    const conf = item?.stepData?.rootCauseChain?.rootCause?.confidence
      ?? item?.stepData?.confidence;
    if (typeof conf === 'number') {
      if (conf >= 0.75) return { label: 'Correlated', level: 'correlated' };
      if (conf >= 0.4) return { label: 'Inferred', level: 'inferred' };
      return { label: 'Unknown', level: 'unknown' };
    }
    return { label: 'Inferred', level: 'inferred' };
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

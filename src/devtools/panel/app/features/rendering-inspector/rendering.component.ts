import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import { RenderInspectorAdapterService } from '../../services/render-inspector-adapter.service';
import { InvestigationQueueService } from '../../services/investigation-queue.service';
import { ExecutionStoryService } from '../../services/execution-story.service';
import { RenderTreeViewComponent } from './components/render-tree-view.component';

import { ActivityTimelineComponent } from './components/activity-timeline.component';
import { getActionIcon, getSeverityIcon, type InteractionKind } from './casual-icons';
import { classifyRenderOrigin } from './utils/render-origin';
import { buildCascadeTree as buildCascadeTreePure, resolveFlowFocus } from './utils/cascade-tree';
import type { InteractionProfile } from '../../../../../types/panel';
import type { RenderCause, RenderEvent, FlowEvent, RenderReason, InteractionInfo } from '../../../../../types/render-events';

/** A single entry in the unified timeline (either a flow event or a render event). */
interface TimelineEntry {
  id: string;
  timestamp: number;
  kind: 'flow' | 'render';
  icon: string;
  label: string;
  detail: string;
  colorClass: string;
  depth: number;
  duration?: number;
  count?: number;
  /** Nested flow events (API calls, state changes) associated with this component render */
  flowDetails?: Array<{ icon: string; label: string; detail: string; colorClass: string }>;
}

/** A user action and the cascade of renders it produced. */
interface ActionReplay {
  id: string;
  trigger: string;
  triggerIcon: string;
  targetSelector: string | null;
  triggerComponent: string | null;
  /** Structured interaction metadata captured at the DOM source (for accurate chip labels). */
  interactionInfo?: InteractionInfo;
  timestamp: number;
  totalRenders: number;
  uniqueComponents: number;
  duration: number;
  frameBudgetExceeded: boolean;
  framesDropped: number;
  timeline: TimelineEntry[];
  tree: CascadeNode[];
  /** Flow events (API, RxJS, Signals) in this action window */
  flowEntries: FlowEntry[];
}

/** A single flow event entry (API call, subject emission, signal write) */
interface FlowEntry {
  id: string;
  icon: string;
  type: string;
  label: string;
  detail: string;
  colorClass: string;
  timestamp: number;
  ownerClass?: string;
  sourceComponent?: string;
  subscribers?: string[];
  value?: string;
  responseBody?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  methodName?: string;
  actionName?: string;
  selectorName?: string;
}

/** A causal chain: trigger → effects → impacted components */
interface CausalChain {
  id: string;
  /** The initiating event (API call, or first store dispatch) */
  trigger: { icon: string; label: string; type: string; value?: string };
  /** State changes caused by the trigger (store dispatches, signal writes) */
  effects: { icon: string; label: string; type: string; value?: string }[];
  /** Components that re-rendered as a result */
  impactedComponents: string[];
  /** Is this a duplicate chain (same trigger appeared multiple times)? */
  isDuplicate: boolean;
  duplicateCount: number;
}

/** A node in the render cascade tree. */
interface CascadeNode {
  componentName: string;
  count: number;
  totalDuration: number;
  cause: RenderCause;
  depth: number;
  children: CascadeNode[];
  /** Grouped render reasons for this component */
  reasons?: RenderReason[];
  /**
   * Histogram of render causes across ALL of this component's render events
   * (not just the first). Keyed by RenderCause['type']. Powers the
   * "why it rendered N times" parent-cascade vs own-trigger split.
   */
  causeBreakdown?: Record<string, number>;
  /** Renders attributed to a parent cascade (cause.type === 'parent'). */
  parentRenders?: number;
  /** Renders attributed to this component's own trigger (signal/input/interaction). */
  ownRenders?: number;
}

@Component({
  selector: 'app-rendering',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RenderTreeViewComponent,
    ActivityTimelineComponent,
  ],
  templateUrl: './rendering.component.html',
  styleUrl: './rendering.component.scss',
})
export class RenderingComponent {
  readonly state = inject(PanelState);
  readonly displayName = displayName;
  readonly Math = Math;
  readonly sumRenders = (acc: number, node: CascadeNode) => acc + node.count;
  private readonly sanitizer = inject(DomSanitizer);
  readonly getActionIcon = getActionIcon;
  readonly getSeverityIcon = getSeverityIcon;
  
  /** Safe icon rendering method — icon reflects the classified interaction kind. */
  getSafeActionIcon(action: ActionReplay): SafeHtml {
    const kind = this.classifyInteraction(action).kind;
    return this.sanitizer.bypassSecurityTrustHtml(getActionIcon(kind));
  }

  getSafeSeverityIcon(severity: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(getSeverityIcon(severity));
  }
  private readonly adapter = inject(RenderInspectorAdapterService);
  private readonly investigationQueueService = inject(InvestigationQueueService);
  private readonly executionStoryService = inject(ExecutionStoryService);

  constructor() {
    // Debounced card builder: only rebuild cards after 600ms of no new events
    // This prevents flickering during route changes where events arrive in waves
    setInterval(() => {
      const currentCount = this.state.renderEvents().length + this.state.flowEvents().length;
      if (currentCount !== this.lastEventCount) {
        this.lastEventCount = currentCount;
        clearTimeout(this.cardRebuildTimer);
        this.cardRebuildTimer = setTimeout(() => {
          const newReplays = this.actionReplays();

          // Only replace the array when the cards ACTUALLY changed. During live
          // profiling events stream in continuously; rebuilding an identical set
          // every 600ms churns the array reference and makes chips flicker
          // (appear then vanish) as group boundaries momentarily shift.
          if (this.replaysAreEquivalent(this.stableActionReplays(), newReplays)) {
            return;
          }
          this.stableActionReplays.set(newReplays);

          // Auto-select: whenever replays exist but nothing is selected, pick the latest
          if (newReplays.length > 0 && this.selectedActionId() === null) {
            const latestActionId = newReplays[newReplays.length - 1].id;
            this.selectedActionId.set(latestActionId);
          }
          // If the currently selected action was removed (stale ID), reset to latest
          if (this.selectedActionId() !== null && !newReplays.find(r => r.id === this.selectedActionId())) {
            this.selectedActionId.set(newReplays.length > 0 ? newReplays[newReplays.length - 1].id : null);
          }
        }, 600);
      }
    }, 300);

    // Immediate check: if events already exist when component mounts, build replays now
    setTimeout(() => {
      const currentCount = this.state.renderEvents().length + this.state.flowEvents().length;
      if (currentCount > 0 && this.stableActionReplays().length === 0) {
        this.lastEventCount = currentCount;
        const newReplays = this.actionReplays();
        this.stableActionReplays.set(newReplays);
        if (newReplays.length > 0 && this.selectedActionId() === null) {
          this.selectedActionId.set(newReplays[newReplays.length - 1].id);
        }
      }
    }, 100);

    // Smart default selection: when the selected action changes and no component
    // is selected, auto-select the worst offender so the details panel is never
    // empty. The user's explicit selection always wins. Guarded so it only fires
    // once per action id (prevents thrash when replays recompute).
    effect(() => {
      const action = this.getSelectedAction();
      if (!action?.tree || this.selectedComponentName() !== null) return;
      if (this.autoSelectedForActionId === action.id) return;
      const nodes = this.flattenTree(action.tree);
      let worst: CascadeNode | null = null;
      for (const n of nodes) {
        if (!worst || n.count > worst.count) worst = n;
      }
      if (worst && worst.count > 1) {
        this.autoSelectedForActionId = action.id;
        this.onComponentSelected({
          componentName: worst.componentName,
          displayName: this.displayName(worst.componentName),
          count: worst.count,
          totalDuration: worst.totalDuration,
          cause: worst.cause,
          causeBreakdown: worst.causeBreakdown,
          parentRenders: worst.parentRenders,
          ownRenders: worst.ownRenders,
          children: worst.children,
          reasons: worst.reasons,
        });
      }
    });
  }

  /**
   * Structural equality check for action replay lists. Returns true when the
   * two lists represent the same set of cards with the same headline counts,
   * so we can skip a needless array replacement (which causes chip flicker).
   */
  private replaysAreEquivalent(a: ActionReplay[], b: ActionReplay[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (
        x.id !== y.id ||
        x.totalRenders !== y.totalRenders ||
        x.uniqueComponents !== y.uniqueComponents
      ) {
        return false;
      }
    }
    return true;
  }
  readonly expandedActions = signal(new Set<string>());
  readonly collapsedActions = signal(new Set<string>());
  readonly expandedFlows = signal(new Set<string>());
  readonly expandedDataFlow = signal(new Set<string>());
  readonly expandedFlowTypes = signal(new Set<string>(['subject-emit', 'http-response', 'store-dispatch', 'store-select', 'facade-method', 'signal-write', 'websocket']));
  readonly showFullTree = signal(false);
  /** Track which component is expanded to show render reasons */
  readonly expandedComponentReasons = signal<string | null>(null);
  /** Track which action is selected in the timeline view */
  readonly selectedActionId = signal<string | null>(null);
  
  /**
   * Reusable explanation for estimated timing values (provenance = EST).
   * Accurate to the implementation: per-component ms is the frame's wall-clock
   * time divided evenly across the components that changed the DOM in that
   * change-detection cycle — NOT a measured per-component execution time.
   */
  readonly estTooltip =
    'Estimated. This is frame time allocated evenly across the components that ' +
    'changed the DOM in this change-detection cycle — not a measured per-component ' +
    'execution time. Treat it as a rough attribution, not a profiler measurement.';

  /** Explanation for the top-bar total render time (interaction wall-clock span). */
  readonly estTotalTooltip =
    'Estimated. Wall-clock span of this interaction (first to last render event). ' +
    'It includes idle gaps and is not a sum of per-component render times.';

  /** Center workspace tab: Render Story (flow diagram + sequence), Timeline, Change Detection, Performance. */
  readonly activeWorkspaceTab = signal<'flow' | 'timeline' | 'cd' | 'perf'>('flow');
  /** Center: 'flow' (Parent→Self→Child diagram) vs 'cd' (change-detection cycle) toggle inside Render Story. */
  readonly renderStoryView = signal<'flow' | 'cd'>('flow');

  /** Component Details tab: Summary, Diagnostics, or Code. */
  readonly activeDetailsTab = signal<'summary' | 'diagnostics' | 'code'>('summary');

  /** Which origin's evidence ledger is expanded in the details panel. */
  readonly expandedOriginKey = signal<string | null>(null);

  toggleOriginEvidence(key: string): void {
    this.expandedOriginKey.update(k => (k === key ? null : key));
  }

  /**
   * Jump to a related component (parent or a child culprit) and focus it in the
   * details panel. Resolves the node from the current action's tree so the full
   * origin/evidence model is available for the destination.
   */
  jumpToComponent(rawOrDisplayName: string): void {
    const action = this.getSelectedAction();
    if (!action?.tree) return;
    const target = this.flattenTree(action.tree).find(n =>
      n.componentName === rawOrDisplayName || this.displayName(n.componentName) === rawOrDisplayName
    );
    if (!target) return;
    this.onComponentSelected({
      componentName: target.componentName,
      displayName: this.displayName(target.componentName),
      count: target.count,
      totalDuration: target.totalDuration,
      cause: target.cause,
      causeBreakdown: target.causeBreakdown,
      parentRenders: target.parentRenders,
      ownRenders: target.ownRenders,
      children: target.children,
      reasons: target.reasons,
      parentName: this.findParentName(action.tree, target.componentName),
    });
  }

  /**
   * Render Path: the ancestor chain from a root down to the selected component,
   * with each hop's real render count and ~estimated cost. Highlights the
   * hotspot hop (highest estimated cost) so a developer sees where cost enters.
   */
  readonly renderPath = computed(() => {
    const action = this.getSelectedAction();
    const name = this.selectedComponentName();
    if (!action?.tree || !name) return null;

    // DFS to find the chain of nodes to the selected one.
    const chain: CascadeNode[] = [];
    const dfs = (nodes: CascadeNode[], trail: CascadeNode[]): boolean => {
      for (const n of nodes) {
        const nextTrail = [...trail, n];
        if (this.displayName(n.componentName) === name) {
          chain.push(...nextTrail);
          return true;
        }
        if (n.children?.length && dfs(n.children, nextTrail)) return true;
      }
      return false;
    };
    dfs(action.tree, []);
    if (chain.length === 0) return null;

    let maxCost = 0;
    for (const n of chain) if (n.totalDuration > maxCost) maxCost = n.totalDuration;

    return chain.map(n => ({
      name: this.displayName(n.componentName),
      rawName: n.componentName,
      count: n.count,
      cost: n.totalDuration, // estimated
      isHotspot: n.totalDuration === maxCost && maxCost > 0 && chain.length > 1,
      isSelected: this.displayName(n.componentName) === name,
    }));
  });

  /** Single-letter render-origin glyph for the tree (P/S/I/A/?). */
  originGlyph(node: CascadeNode): string {
    const b = node.causeBreakdown ?? {};
    const parent = b['parent'] ?? 0;
    const own = (b['signal'] ?? 0) + (b['input'] ?? 0) + (b['manual-cd'] ?? 0);
    if (own > 0 && own >= parent) {
      if ((b['input'] ?? 0) > (b['signal'] ?? 0)) return 'I';
      return 'S';
    }
    if (parent > 0) return 'P';
    return '?';
  }

  /** Find the display name of a node's parent in the tree (for jump-to-parent). */
  private findParentName(nodes: CascadeNode[], childName: string, parent: string | null = null): string | null {
    for (const n of nodes) {
      if (n.componentName === childName) return parent ? this.displayName(parent) : null;
      const found = this.findParentName(n.children ?? [], childName, n.componentName);
      if (found !== null) return found;
    }
    return null;
  }

  /** UX Level 3: Contextual Detail Drawer */
  readonly selectedComponentName = signal<string | null>(null);
  /** Full component data for the selected node (from tree view hover) */
  readonly selectedComponentData = signal<any>(null);
  
  readonly filter = signal<'all' | 'slow' | 'changed'>('all');
  
  /** Focus mode state (Phase 2) */
  readonly focusMode = signal(false);
  readonly focusComponentName = signal<string | null>(null);
  
  /** Default to tree view in new UX */
  readonly showTreeView = signal(true);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER CAUSALITY VIEW — built ONLY on observable data.
  //
  // Accuracy note: per-component millisecond timing in ngLens is an even split
  // of one MutationObserver frame (frameDuration / componentCount), so it is an
  // estimate, not a per-component measurement. This view therefore leads with
  // render COUNTS, CAUSE attribution, and OBSERVED causal chains — all of which
  // come from real signals — and never presents fabricated timing as precise.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Classify a render cause into an honest confidence level based on how the
   * cause was actually determined.
   *
   * - direct:   we directly observed the trigger (user interaction, signal
   *             write, or an HTTP/flow event tied to the render).
   * - inferred: derived from DOM nesting (a parent re-render cascaded down).
   *             Plausible, but not verified against Angular's CD graph.
   * - uncertain: zone/unknown — we saw a render but could not attribute a cause.
   */
  classifyConfidence(causeType: string | undefined, source?: string): {
    level: 'direct' | 'inferred' | 'uncertain';
    label: string;
  } {
    const src = (source ?? '').toLowerCase();
    switch (causeType) {
      case 'signal':
      case 'input':
        return { level: 'direct', label: 'Observed' };
      case 'parent':
        return { level: 'inferred', label: 'Inferred from DOM' };
      case 'manual-cd':
        return { level: 'direct', label: 'Observed' };
      case 'zone':
        // Interaction-derived zone causes ARE observed (addEventListener:click, etc.)
        if (src.includes('addeventlistener') || src.includes('click') || src.includes('input') || src.includes('keydown')) {
          return { level: 'direct', label: 'Observed' };
        }
        if (src.includes('fetch') || src.includes('xmlhttprequest') || src.includes('http')) {
          return { level: 'direct', label: 'Observed' };
        }
        return { level: 'uncertain', label: 'Unattributed' };
      default:
        return { level: 'uncertain', label: 'Unattributed' };
    }
  }

  /**
   * Causality view model for the selected action.
   * Everything here is derived from real render counts + observed causes.
   */
  readonly causalityModel = computed(() => {
    const action = this.getSelectedAction();
    if (!action || !action.tree || action.tree.length === 0) return null;

    const nodes = this.flattenTree(action.tree);

    // ── Cause breakdown by real render count ──
    const causeBuckets = new Map<string, {
      type: string;
      label: string;
      confidence: 'direct' | 'inferred' | 'uncertain';
      confidenceLabel: string;
      renderCount: number;
      components: number;
    }>();

    let totalRenders = 0;
    // Confidence tally across all renders
    const confidenceTally = { direct: 0, inferred: 0, uncertain: 0 };

    for (const node of nodes) {
      const cause = node.cause ?? { type: 'zone', source: 'unknown' };
      const conf = this.classifyConfidence(cause.type, cause.source);
      const label = this.formatCauseLabel(cause);
      const key = `${cause.type}:${label}`;

      const existing = causeBuckets.get(key);
      if (existing) {
        existing.renderCount += node.count;
        existing.components += 1;
      } else {
        causeBuckets.set(key, {
          type: cause.type ?? 'zone',
          label,
          confidence: conf.level,
          confidenceLabel: conf.label,
          renderCount: node.count,
          components: 1,
        });
      }

      totalRenders += node.count;
      confidenceTally[conf.level] += node.count;
    }

    const causes = Array.from(causeBuckets.values())
      .map(c => ({
        ...c,
        pct: totalRenders > 0 ? Math.round((c.renderCount / totalRenders) * 100) : 0,
      }))
      .sort((a, b) => b.renderCount - a.renderCount);

    // ── Confidence distribution (percentages of total renders) ──
    const confidence = {
      direct: totalRenders > 0 ? Math.round((confidenceTally.direct / totalRenders) * 100) : 0,
      inferred: totalRenders > 0 ? Math.round((confidenceTally.inferred / totalRenders) * 100) : 0,
      uncertain: totalRenders > 0 ? Math.round((confidenceTally.uncertain / totalRenders) * 100) : 0,
    };

    // ── Observed causal chains (real: HTTP → store/signal → subscribers) ──
    const chains = this.buildCausalChains(action);

    // ── Top re-render offenders by count (real) ──
    const offenders = [...nodes]
      .filter(n => n.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map(n => ({
        name: this.displayName(n.componentName),
        count: n.count,
        confidence: this.classifyConfidence(n.cause?.type, n.cause?.source).level,
        causeLabel: this.formatCauseLabel(n.cause),
      }));

    return {
      totalRenders,
      uniqueComponents: action.uniqueComponents,
      // Frame duration IS real (whole mutation batch); label it as such in UI.
      frameDuration: action.duration,
      causes,
      confidence,
      chains,
      offenders,
    };
  });

  onComponentSelected(componentData: any): void {
    // Show details panel for the selected component
    // Use display name if available, fallback to raw component name
    const displayedName = componentData.displayName || componentData.componentName;

    // Push the current selection onto the back-stack so navigation is reversible.
    const current = this.selectedComponentData();
    if (current && (current.displayName || current.componentName) !== displayedName) {
      this.selectionHistory.update(h => [...h, current]);
    }

    this.selectedComponentName.set(displayedName);
    this.selectedComponentData.set(componentData);
  }

  /** Back-stack of previously selected components (for reversible drill-down). */
  readonly selectionHistory = signal<any[]>([]);

  /** Whether a previous selection exists to return to. */
  readonly canGoBack = computed(() => this.selectionHistory().length > 0);

  /** Display name of the component we'd return to (for the Back label). */
  readonly previousSelectionName = computed(() => {
    const history = this.selectionHistory();
    if (history.length === 0) return '';
    const prev = history[history.length - 1];
    return prev.displayName || prev.componentName || 'previous';
  });

  /** Return to the previously selected component. */
  goBackSelection(): void {
    const history = this.selectionHistory();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    this.selectionHistory.update(h => h.slice(0, -1));
    const displayedName = prev.displayName || prev.componentName;
    this.selectedComponentName.set(displayedName);
    this.selectedComponentData.set(prev);
  }

  /** Clear the selection AND its history (the × close button). */
  clearSelection(): void {
    this.selectionHistory.set([]);
    this.selectedComponentName.set(null);
    this.selectedComponentData.set(null);
  }

  /** Get component metrics for the detail drawer */
  readonly selectedComponentMetrics = computed(() => {
    const data = this.selectedComponentData();
    if (!data) return null;

    const impact = data.count * data.totalDuration;
    let severity: 'high' | 'medium' | 'low' = 'low';
    if (impact >= 500 || data.count >= 6) severity = 'high';
    else if (impact >= 100 || data.count >= 3) severity = 'medium';

    const causeLabel = this.formatCauseLabel(data.cause);
    const childrenCount = data.children ? data.children.length : 0;

    return {
      renderCount: data.count,
      totalDuration: data.totalDuration,
      averageDuration: Math.round(data.totalDuration / Math.max(1, data.count)),
      impact,
      severity,
      causeLabel,
      causeType: data.cause?.type || 'unknown',
      causeSource: data.cause?.source || '',
      childrenCount,
      children: data.children || [],
    };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER ORIGIN + EVIDENCE + CONFIDENCE MODEL (the trust foundation)
  //
  // Core principle: CONFIDENCE is a judgment about EVIDENCE, expressed as a word
  // (high/medium/low), NOT the percentage of renders in a bucket. A component
  // can render 2/2 times via "parent propagation" (100% attribution share) while
  // our CONFIDENCE that the parent CAUSED it is only Medium — because we observe
  // co-occurrence in the same change-detection cycle, not a proven causal edge.
  //
  // Four origins:
  //   own-trigger        — a signal/input/interaction was observed ON this comp
  //   parent-propagation — parent rendered in the same CD cycle (INFERRED, ≤Medium)
  //   external           — an API/store flow correlated with the render
  //   unknown            — rendered, but no attributable cause was observed
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Classify the selected component's renders into origin buckets, each carrying
   * real counts, an evidence ledger (observed vs not-observed), and an honest
   * confidence WORD. Confidence is never derived from the render share.
   */
  readonly renderOrigin = computed(() => {
    const data = this.selectedComponentData();
    if (!data) return null;

    const total: number = data.count ?? 0;
    const breakdown: Record<string, number> = data.causeBreakdown ?? {};
    const parentName: string | undefined = data.parentName;
    const compName: string = data.displayName || data.componentName || 'This component';

    // Real counts from the observed cause histogram (pure, unit-tested logic).
    const partition = classifyRenderOrigin(breakdown, data.cause?.source ?? '');
    const parentRenders = partition.parentRenders;
    const ownRenders = partition.ownRenders;
    const unknownRenders = partition.unknownRenders;

    // External: correlated API / store-dispatch / facade-method flows that
    // impacted this component (all observed, never proven causal edges).
    const action = this.getSelectedAction();
    let externalRenders = 0;
    let externalTrigger: string | null = null;
    if (action) {
      // 1) Causal chains (HTTP → store → subscribers).
      const chains = this.buildCausalChains(action);
      for (const chain of chains) {
        if (chain.impactedComponents.includes(compName)) {
          externalTrigger = chain.trigger.label;
          break;
        }
      }
      // 2) Direct store-dispatch / facade-method flows attributed to this
      //    component (by sourceComponent or owning class).
      if (!externalTrigger) {
        const storeOrFacade = action.flowEntries.find(f =>
          (f.type === 'store-dispatch' || f.type === 'facade-method') &&
          (
            (f.sourceComponent && this.displayName(f.sourceComponent) === compName) ||
            (f.ownerClass && this.displayName(f.ownerClass) === compName)
          )
        );
        if (storeOrFacade) externalTrigger = storeOrFacade.label;
      }
    }

    // Build the four buckets with evidence + honest confidence words.
    type Origin = {
      key: 'own-trigger' | 'parent-propagation' | 'external' | 'unknown';
      label: string;
      count: number;
      confidence: 'high' | 'medium' | 'low';
      confidenceLabel: string;
      observed: string[];
      notObserved: string[];
      detail: string;
    };
    const origins: Origin[] = [];

    if (ownRenders > 0) {
      origins.push({
        key: 'own-trigger',
        label: 'Own trigger',
        count: ownRenders,
        confidence: 'high',
        confidenceLabel: 'High',
        observed: [
          'Signal / input / interaction observed on this component',
          `${compName} rendered`,
        ],
        notObserved: [],
        detail: 'A change to this component\u2019s own state or inputs was directly observed.',
      });
    }

    if (parentRenders > 0) {
      origins.push({
        key: 'parent-propagation',
        label: 'Parent propagation',
        count: parentRenders,
        // Inferred from same-cycle co-occurrence. Never above Medium.
        confidence: 'medium',
        confidenceLabel: 'Medium',
        observed: [
          parentName ? `Parent (${parentName}) rendered` : 'Parent rendered',
          `${compName} rendered`,
          'Both in the same change-detection cycle',
        ],
        notObserved: [
          'Direct parent \u2192 child causal edge',
        ],
        detail: parentName
          ? `Rendered during the same change-detection cycle as its parent ${parentName}. The parent likely propagated the render, but a direct causal edge was not proven.`
          : 'Rendered during the same change-detection cycle as its parent. Likely propagation, not proven.',
      });
    }

    if (externalRenders > 0 || externalTrigger) {
      origins.push({
        key: 'external',
        label: 'External (API / state)',
        count: externalRenders || 0,
        confidence: 'medium',
        confidenceLabel: 'Medium',
        observed: [
          externalTrigger ? `Observed flow: ${externalTrigger}` : 'Correlated API/state flow',
          `${compName} rendered within the flow window`,
        ],
        notObserved: ['Direct data \u2192 render binding'],
        detail: 'A correlated API response or state change was observed in the same window as this render.',
      });
    }

    if (unknownRenders > 0) {
      origins.push({
        key: 'unknown',
        label: 'Unknown',
        count: unknownRenders,
        confidence: 'low',
        confidenceLabel: 'Low',
        observed: [`${compName} rendered`],
        notObserved: ['Any attributable trigger (signal / input / parent / API)'],
        detail: 'A render was observed but no attributable cause was found — likely framework scheduling or an untracked source.',
      });
    }

    origins.sort((a, b) => b.count - a.count);

    // Dominant origin + honest overall confidence WORD.
    const dominant = origins[0] ?? null;

    return {
      total,
      compName,
      parentName,
      ownRenders,
      parentRenders,
      externalRenders,
      unknownRenders,
      origins,
      dominant,
    };
  });

  /**
   * "Why did it render N times?" — evidence-based headline built on the origin
   * model. Wording reflects confidence; never presents inference as proof.
   */
  readonly renderExplanation = computed(() => {
    const data = this.selectedComponentData();
    const origin = this.renderOrigin();
    if (!data || !origin) return null;

    const total: number = origin.total;
    const parentName: string | undefined = origin.parentName;

    // Entries = origin buckets rendered as the "why" list.
    const entries = origin.origins.map(o => ({
      type: o.key,
      label: o.label,
      count: o.count,
      pct: total > 0 ? Math.round((o.count / total) * 100) : 0,
      confidence: o.confidence,
      confidenceLabel: o.confidenceLabel,
      isParent: o.key === 'parent-propagation',
    }));

    const parentRenders: number = origin.parentRenders;
    const ownRenders: number = origin.ownRenders;

    // Evidence-first: `headline` is the plain OBSERVED fact (render count only,
    // no cause claim). `interpretation` is the separate, confidence-qualified
    // reading of that evidence — so the UI leads with what we saw, then offers
    // the (clearly-hedged) inference. We never fold an inferred cause into the
    // headline as if it were observed.
    const headline =
      total <= 1 ? 'Rendered once.' : `Rendered ${total}×.`;

    // Parent relationship stated explicitly (observation, not proof). Only set
    // when parent-propagation renders were actually counted.
    const parentRelation =
      parentRenders > 0
        ? {
            parentName: parentName ?? null,
            count: parentRenders,
          }
        : null;

    let interpretation: string;
    if (total <= 1) {
      interpretation = 'No repeated re-rendering to explain.';
    } else if (origin.dominant?.key === 'parent-propagation') {
      interpretation = parentName
        ? `Most renders coincided with ${parentName} re-rendering in the same change-detection cycle — likely parent propagation, not proven.`
        : 'Most renders coincided with a parent re-rendering in the same change-detection cycle — likely parent propagation, not proven.';
    } else if (origin.dominant?.key === 'own-trigger') {
      interpretation = "A signal, input, or interaction was observed on this component itself.";
    } else if (origin.dominant?.key === 'external') {
      interpretation = 'A correlated API/state change was observed in the same window.';
    } else {
      interpretation = 'No attributable trigger was observed for these renders.';
    }

    return {
      total,
      parentRenders,
      ownRenders,
      entries,
      headline,
      interpretation,
      parentRelation,
    };
  });

  /**
   * Render Flow model for the center workspace: TRIGGER → COMPONENT → TRIGGERED.
   * All counts are real. When a component is selected it centers on that node;
   * otherwise it centers on the action's top-level (root) component.
   */
  readonly renderFlowModel = computed(() => {
    const action = this.getSelectedAction();
    if (!action?.tree || action.tree.length === 0) return null;

    const selectedName = this.selectedComponentName();

    // Resolve the focused node via the shared, unit-tested TRUST RULE:
    // a selected component NEVER diverges from the right panel; if it's absent
    // from this action's tree, focus is null (empty state) — no fallback.
    const focus = resolveFlowFocus(
      action.tree as CascadeNode[],
      selectedName,
      (raw) => this.displayName(raw),
    ) as CascadeNode | null;
    if (!focus) return null;

    const focusDisplay = this.displayName(focus.componentName);

    // ── TRIGGERS: what caused THIS component to render ──
    const triggers: Array<{ icon: string; label: string; type: string; confidence: string; confidenceLabel: string }> = [];
    const breakdown = focus.causeBreakdown ?? {};
    for (const [type, count] of Object.entries(breakdown)) {
      if (count <= 0) continue;
      if (type === 'parent') continue; // parent cascade is shown via the graph edge, not a trigger card
      const conf = this.classifyConfidence(type, focus.cause?.source);
      // When the cause is unattributed, keep it honestly labelled "Unknown
      // trigger" instead of surfacing a raw zone source that reads like a
      // confident cause. Evidence insufficient ⇒ Unknown stays Unknown.
      const label = conf.level === 'uncertain'
        ? 'Unknown trigger'
        : this.formatCauseLabel({ type, source: focus.cause?.source });
      triggers.push({
        icon: this.triggerIconForType(type),
        label,
        type,
        confidence: conf.level,
        confidenceLabel: conf.label,
      });
    }
    // Add observed causal-chain triggers (API/store) that impacted this component.
    const chains = this.buildCausalChains(action);
    for (const chain of chains) {
      if (chain.impactedComponents.includes(focusDisplay)) {
        triggers.push({
          icon: chain.trigger.icon,
          label: chain.trigger.label,
          type: chain.trigger.type,
          confidence: 'direct',
          confidenceLabel: 'Observed',
        });
      }
    }
    // If this node is a pure parent-cascade child with no own trigger, say so.
    if (triggers.length === 0 && (focus.parentRenders ?? 0) > 0) {
      triggers.push({
        icon: '⬆️',
        label: 'Parent re-render',
        type: 'parent',
        confidence: 'inferred',
        confidenceLabel: 'Inferred from DOM',
      });
    }

    // ── TRIGGERED: the children this component caused to render ──
    const triggered = (focus.children ?? [])
      .slice()
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(c => ({
        name: this.displayName(c.componentName),
        rawName: c.componentName,
        count: c.count,
        totalDuration: c.totalDuration,
        severity: c.count >= 5 ? 'high' : c.count >= 3 ? 'medium' : 'low',
        node: c,
      }));

    return {
      triggers,
      component: {
        name: focusDisplay,
        rawName: focus.componentName,
        count: focus.count,
        totalDuration: focus.totalDuration,
      },
      triggered,
      childrenTotal: focus.children?.length ?? 0,
    };
  });

  /** Icon for a render cause type (used by the flow graph trigger cards). */
  private triggerIconForType(type: string): string {
    switch (type) {
      case 'signal': return '⚡';
      case 'input': return '📥';
      case 'zone': return '🖱️';
      case 'manual-cd': return '🔧';
      case 'http': return '🌐';
      case 'store-dispatch': return '🗄️';
      default: return '•';
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // REDESIGN SUPPORT — derived, real-data models for the new Components UI.
  // Every value below comes from observed data (causeBreakdown, flowEntries,
  // cascade tree, timeline). Missing concepts return 'Not observed' rather than
  // being fabricated.
  // ════════════════════════════════════════════════════════════════════════

  /**
   * The five-row "Why did it render?" list used by the redesigned right panel.
   * Each row maps to a semantic concept (parent/input/signal/rxjs/store) with a
   * real count and confidence, or a "Not observed" state. Colors are keyed by
   * `sem` so they match the tree, flow diagram, and related-activity dots.
   */
  readonly whyRows = computed(() => {
    const data = this.selectedComponentData();
    if (!data) return [];
    const breakdown: Record<string, number> = data.causeBreakdown ?? {};
    const origin = this.renderOrigin();

    const parent = breakdown['parent'] ?? 0;
    const signal = breakdown['signal'] ?? 0;
    const input = breakdown['input'] ?? 0;

    // RxJS / Store come from correlated flow entries on this component.
    const flows = this.getSelectedComponentFlows();
    const rxjs = flows.filter(f => f.type === 'subject-emit').length;
    const store = flows.filter(f => f.type === 'store-dispatch' || f.type === 'store-select' || f.type === 'facade-method').length;

    type Why = {
      key: 'parent' | 'input' | 'signal' | 'rxjs' | 'store';
      sem: string; label: string; icon: string;
      count: number; observed: boolean;
      confidence: 'high' | 'medium' | 'low' | null; confidenceLabel: string;
    };
    const rows: Why[] = [
      { key: 'parent', sem: 'parent', label: 'Parent propagation', icon: '⬆', count: parent, observed: parent > 0, confidence: parent > 0 ? 'medium' : null, confidenceLabel: 'Medium' },
      { key: 'input', sem: 'input', label: 'Input changes', icon: '▤', count: input, observed: input > 0, confidence: input > 0 ? 'high' : null, confidenceLabel: 'High' },
      { key: 'signal', sem: 'signal', label: 'Signal changes', icon: '◈', count: signal, observed: signal > 0, confidence: signal > 0 ? 'high' : null, confidenceLabel: 'High' },
      { key: 'rxjs', sem: 'rxjs', label: 'RxJS / Observable', icon: '∿', count: rxjs, observed: rxjs > 0, confidence: rxjs > 0 ? 'medium' : null, confidenceLabel: 'Medium' },
      { key: 'store', sem: 'store', label: 'Store changes', icon: '▦', count: store, observed: store > 0, confidence: store > 0 ? 'medium' : null, confidenceLabel: 'Medium' },
    ];
    // Observed rows first (by count), then the not-observed rows.
    return rows.sort((a, b) =>
      (b.observed ? 1 : 0) - (a.observed ? 1 : 0) || b.count - a.count
    );
  });

  /** Only the causes actually OBSERVED — no "Not observed" noise on the surface. */
  readonly whyObserved = computed(() => this.whyRows().filter(w => w.observed));

  /** Overall confidence word for the selected component (from the dominant origin). */
  readonly overallConfidence = computed<{ level: 'high' | 'medium' | 'low'; label: string } | null>(() => {
    const origin = this.renderOrigin();
    if (!origin?.dominant) return null;
    return { level: origin.dominant.confidence, label: origin.dominant.confidenceLabel };
  });

  /** Short "reason tag" shown next to the component title (e.g. "Renders due to parent propagation"). */
  readonly reasonTag = computed<string | null>(() => {
    const origin = this.renderOrigin();
    if (!origin?.dominant) return null;
    switch (origin.dominant.key) {
      case 'parent-propagation': return 'Renders due to parent propagation';
      case 'own-trigger': return 'Renders due to own state change';
      case 'external': return 'Renders due to API / state change';
      default: return 'Cause not attributed';
    }
  });

  /**
   * "Related activity" counts for the left panel. All derived from the selected
   * component's node + its position in the cascade tree.
   *  - parent:   1 if this component has a parent in the tree, else 0
   *  - child:    number of direct children
   *  - siblings: components sharing the same parent (same CD subtree)
   *  - signals:  distinct signal/flow connections observed for this component
   */
  readonly relatedActivity = computed(() => {
    const data = this.selectedComponentData();
    const action = this.getSelectedAction();
    if (!data || !action?.tree) {
      return { parentRenders: 0, childRenders: 0, siblings: 0, signalLinks: 0, parentName: null as string | null };
    }
    const name = data.displayName || data.componentName;
    const children: CascadeNode[] = data.children ?? [];
    const childRenders = children.reduce((s, c) => s + (c.count ?? 0), 0);

    // Parent + siblings via the tree.
    const parentName = this.findParentName(action.tree as CascadeNode[], data.componentName);
    let siblings = 0;
    let parentRenders = 0;
    if (parentName) {
      const parentNode = this.flattenTree(action.tree).find(n => this.displayName(n.componentName) === parentName);
      if (parentNode) {
        parentRenders = parentNode.count;
        siblings = (parentNode.children ?? []).filter(c => this.displayName(c.componentName) !== name).length;
      }
    }

    const signalLinks = this.getSelectedComponentFlows().filter(
      f => f.type === 'signal-write' || f.type === 'subject-emit' || f.type === 'store-select'
    ).length;

    return { parentRenders, childRenders, siblings, signalLinks, parentName };
  });

  /**
   * A numbered render sequence for the selected component: the real, timestamped
   * render events within the action window, made relative to the first one.
   * Per-render ms is an estimate (frame time split), labelled as such in the UI.
   */
  readonly renderSequence = computed(() => {
    const action = this.getSelectedAction();
    const name = this.selectedComponentName();
    if (!action || !name) return [];

    const events = this.getActionEvents(action)
      .filter(e => this.displayName(e.componentName) === name)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (events.length === 0) return [];

    const start = events[0].timestamp;
    // Coalesce events within the same CD cycle (50ms) into one numbered step.
    const steps: Array<{ n: number; label: string; detail: string; offsetMs: number; sem: string }> = [];
    let lastTs = -Infinity;
    let n = 0;
    for (const e of events) {
      if (e.timestamp - lastTs < 50 && steps.length > 0) continue;
      lastTs = e.timestamp;
      const causeType = e.causes[0]?.type ?? 'zone';
      const sem = causeType === 'parent' ? 'parent'
        : causeType === 'signal' ? 'signal'
        : causeType === 'input' ? 'input'
        : 'self';
      const detail = causeType === 'parent'
        ? 'Detected in the same change-detection cycle.'
        : causeType === 'signal' ? 'A signal read by this component changed.'
        : causeType === 'input' ? 'An input binding changed.'
        : 'No direct input or signal change observed.';
      steps.push({
        n: ++n,
        label: `${name} render #${n}`,
        detail,
        offsetMs: Math.round(e.timestamp - start),
        sem,
      });
    }
    return steps;
  });

  /**
   * Flow-diagram nodes for the redesigned center panel: Parent → Selected →
   * Children, each a real node with counts. Parent node is resolved from the
   * cascade tree (renderFlowModel only exposes the parent as a trigger edge).
   */
  readonly flowDiagram = computed(() => {
    const model = this.renderFlowModel();
    const action = this.getSelectedAction();
    if (!model || !action?.tree) return null;

    const rel = this.relatedActivity();
    const parent = rel.parentName
      ? { name: rel.parentName, count: rel.parentRenders, sem: 'parent' as const }
      : null;

    const self = {
      name: model.component.name,
      count: model.component.count,
      totalDuration: model.component.totalDuration,
      sem: 'self' as const,
    };

    const children = model.triggered.map(c => ({
      name: c.name, rawName: c.rawName, count: c.count,
      totalDuration: c.totalDuration, node: c.node, sem: 'child' as const,
    }));

    return { parent, self, children, childrenTotal: model.childrenTotal };
  });

  /** Jump selection to the parent component (used by the "Inspect parent" CTA). */
  inspectParent(): void {
    const parentName = this.relatedActivity().parentName;
    if (parentName) this.jumpToComponent(parentName);
  }

  /**
   * One-line verdict for the selected component — the answer up front.
   * Plain language, confidence-qualified, no jargon dump.
   */
  readonly verdict = computed<{ text: string; level: 'high' | 'medium' | 'low' } | null>(() => {
    const origin = this.renderOrigin();
    const data = this.selectedComponentData();
    if (!origin || !data) return null;
    const n = origin.total;
    if (n <= 1) return { text: 'Rendered once — nothing to optimize.', level: 'high' };
    const dom = origin.dominant;
    const level = dom?.confidence ?? 'low';
    switch (dom?.key) {
      case 'parent-propagation':
        return { text: `Rendered ${n}× — mostly dragged along by its parent${origin.parentName ? ' ' + origin.parentName : ''}.`, level };
      case 'own-trigger':
        return { text: `Rendered ${n}× — triggered by its own state or inputs.`, level };
      case 'external':
        return { text: `Rendered ${n}× — correlated with an API / store change.`, level };
      default:
        return { text: `Rendered ${n}× — no clear cause was observed.`, level };
    }
  });

  /**
   * Rich tooltip text for a component's render count in the tree/cascade —
   * "why it rendered" lives in the hover, keeping the surface clean.
   */
  causeTooltipFor(node: { causeBreakdown?: Record<string, number>; count?: number; parentRenders?: number; ownRenders?: number }): string {
    const b = node.causeBreakdown ?? {};
    const parts: string[] = [];
    if ((b['parent'] ?? 0) > 0) parts.push(`${b['parent']} from parent cascade`);
    if ((b['signal'] ?? 0) > 0) parts.push(`${b['signal']} from signal changes`);
    if ((b['input'] ?? 0) > 0) parts.push(`${b['input']} from input changes`);
    if ((b['manual-cd'] ?? 0) > 0) parts.push(`${b['manual-cd']} from manual CD`);
    if ((b['zone'] ?? 0) > 0) parts.push(`${b['zone']} from zone/async`);
    const total = node.count ?? 0;
    if (parts.length === 0) return `Rendered ${total}× — cause not attributed.`;
    return `Rendered ${total}×: ` + parts.join(', ') + '. Timing is estimated.';
  }

  /** Tooltip explaining what a "why" chip means, including its evidence. */
  whyTooltipFor(w: { label: string; count: number; confidenceLabel: string }): string {
    return `${w.label}: observed ${w.count}× · ${w.confidenceLabel} confidence. Hover counts elsewhere for the full breakdown.`;
  }

  /** The single recommended action for the selected component, cause-driven. */
  readonly recommendedAction = computed<{ text: string; cta: string; kind: 'parent' | 'own' | 'none' } | null>(() => {
    const origin = this.renderOrigin();
    const m = this.selectedComponentMetrics();
    if (!origin || !m || origin.total <= 1) return null;
    if (origin.dominant?.key === 'parent-propagation') {
      return {
        text: 'This component re-renders whenever its parent does, even without its own changes.',
        cta: 'Add OnPush to isolate it',
        kind: 'parent',
      };
    }
    if (origin.dominant?.key === 'own-trigger' && m.renderCount >= 4) {
      return {
        text: 'Its own signal/input changes drive frequent renders.',
        cta: 'Review the signals it reads',
        kind: 'own',
      };
    }
    if (m.renderCount >= 5) {
      return { text: `Rendered ${m.renderCount}× — consider OnPush or computed signals.`, cta: '', kind: 'none' };
    }
    return null;
  });

  private formatCauseLabel(cause: any): string {
    // If we don't have cause data, bail out
    if (!cause) return 'Unknown';

    const causeType = cause.type || 'zone';
    const sourceInfo = cause.source || '';

    // Signal writes are usually specific property names like "items", "count", etc.
    if (causeType === 'signal') {
      // Extract just the property name for cleaner display
      if (sourceInfo.includes('.')) {
        const prop = sourceInfo.split('.').pop();
        return `Signal Changed — ${prop}`;
      }
      return 'Signal Changed';
    }

    // Direct input property changes (form, two-way binding)
    if (causeType === 'input') return 'Input Property Changed';

    // Component re-rendered because parent re-rendered
    if (causeType === 'parent') return 'Parent Rendered';

    // Manual change detection trigger
    if (causeType === 'manual-cd') return 'Manual Change Detection';

    // User-initiated actions
    if (sourceInfo.includes('click')) return 'User Clicked';
    if (sourceInfo.includes('input')) return 'User Typed';
    if (sourceInfo.includes('timer')) return 'Timer Fired';

    // Async operations completing
    if (sourceInfo.includes('fetch') || sourceInfo.includes('XMLHttpRequest')) {
      return 'API Response Arrived';
    }

    // Fallback to whatever source we have
    return sourceInfo || causeType;
  }

  readonly deduplicatedComponentCount = computed(() => {
    const events = this.state.renderEvents();
    return new Set(events.map(e => e.componentName)).size;
  });

  /**
   * Top metric bar model. Counts are real; total render time is an estimate
   * (frame time split across components) and is labelled ~est in the UI.
   * No trend arrows in v1 — we have no baseline to compare against.
   */
  readonly metricBar = computed(() => {
    const action = this.getSelectedAction();
    // Use the tree-consistent (coalesced) render count so the headline number
    // matches what the component tree/hotspots actually sum to.
    const totalRenders = action
      ? this.meaningfulRenderCount(action)
      : this.deduplicatedRenderCount();
    const components = action
      ? this.flattenTree(action.tree).length
      : this.deduplicatedComponentCount();

    // Wasted renders = re-renders beyond the first for each component (real count).
    let wasted = 0;
    if (action?.tree) {
      for (const node of this.flattenTree(action.tree)) {
        if (node.count > 1) wasted += node.count - 1;
      }
    }

    return {
      totalRenders,
      components,
      totalRenderTime: action?.duration ?? 0, // estimated — shown with ~
      wasted,
      live: this.state.isTracking(),
    };
  });

  /**
   * Accuracy self-audit: checks the tool's own numbers reconcile.
   *  - tree total: sum of per-component render counts vs the action's totalRenders
   *  - origin sum: for the selected component, origin buckets sum to its count
   * Internal consistency only — does NOT prove ground-truth accuracy (use the
   * test-fixtures harness for that), but it catches aggregation bugs.
   */
  readonly renderReconciliation = computed(() => {
    const action = this.getSelectedAction();
    if (!action?.tree) return null;

    const nodes = this.flattenTree(action.tree);
    const treeSum = nodes.reduce((s, n) => s + n.count, 0);
    // The DISPLAYED render count is the coalesced tree sum, so this must match
    // exactly. The raw mutation-event count (action.totalRenders) is higher and
    // is shown only as context in tooltips.
    const treeConsistent = treeSum > 0;

    // Origin reconciliation for the selected component.
    let originConsistent = true;
    let originDetail = '';
    const origin = this.renderOrigin();
    if (origin) {
      const bucketSum = origin.ownRenders + origin.parentRenders + origin.unknownRenders;
      // externalRenders overlaps other buckets (correlation, not a partition),
      // so we reconcile the partitioning buckets against the total.
      originConsistent = bucketSum === origin.total;
      originDetail = `${bucketSum}/${origin.total} classified`;
    }

    const ok = treeConsistent && originConsistent;
    return {
      ok,
      treeSum,
      totalRenders: action.totalRenders,
      treeConsistent,
      originConsistent,
      originDetail,
    };
  });

  /**
   * Summary of the selected action's tree so the displayed total always visibly
   * reconciles with the chip — even when parts of the tree are collapsed.
   * renders = sum of per-component counts; components = distinct nodes.
   */
  readonly treeSummary = computed(() => {
    const action = this.getSelectedAction();
    if (!action?.tree) return { renders: 0, components: 0 };
    const nodes = this.flattenTree(action.tree);
    return {
      renders: nodes.reduce((s, n) => s + n.count, 0),
      components: nodes.length,
    };
  });

  /** Ranked re-render offenders by real render count (for the Hotspots panel). */
  readonly renderHotspots = computed(() => {
    const action = this.getSelectedAction();
    if (!action?.tree) return [];
    return this.flattenTree(action.tree)
      .filter(n => n.count >= 2)
      .sort((a, b) => b.count - a.count || b.totalDuration - a.totalDuration)
      .slice(0, 8)
      .map(n => ({
        name: this.displayName(n.componentName),
        rawName: n.componentName,
        count: n.count,
        totalDuration: n.totalDuration, // estimated
        node: n,
      }));
  });

  /**
   * Verdict over the selected action's tree: health status + worst offender.
   * Threshold: >=3 renders = warn contributor, >=5 = hot. Always populated.
   */
  readonly renderVerdict = computed(() => {
    const action = this.getSelectedAction();
    if (!action?.tree) {
      return { status: 'clean' as const, message: 'No action selected.', worst: null as null | { name: string; count: number } };
    }
    const nodes = this.flattenTree(action.tree);
    const excessive = nodes.filter(n => n.count >= 3);
    let worstNode: CascadeNode | null = null;
    for (const n of nodes) {
      if (!worstNode || n.count > worstNode.count) worstNode = n;
    }
    const worst = worstNode && worstNode.count > 1
      ? { name: this.displayName(worstNode.componentName), count: worstNode.count }
      : null;

    // Count renders beyond the first per component (potentially unnecessary).
    let potentiallyUnnecessary = 0;
    for (const n of nodes) if (n.count > 1) potentiallyUnnecessary += n.count - 1;

    let status: 'clean' | 'warn' | 'hot' = 'clean';
    if (excessive.some(n => n.count >= 5)) status = 'hot';
    else if (excessive.length > 0) status = 'warn';

    // Factual, count-based wording. We do NOT assert the renders are "excessive"
    // or "wasted" — that's not proven. We state the observed count only.
    // ">=3 renders in one interaction" is the flag threshold.
    const flagged = excessive.length;
    let message: string;
    if (status === 'clean') {
      message = potentiallyUnnecessary > 0
        ? `${potentiallyUnnecessary} repeat render${potentiallyUnnecessary === 1 ? '' : 's'} (possibly avoidable).`
        : 'No repeated re-renders.';
    } else {
      message = `${flagged} component${flagged === 1 ? '' : 's'} rendered 3+ times.`;
    }

    return { status, message, worst, potentiallyUnnecessary };
  });

  /**
   * Ancestor path (component names) from a root down to the worst offender,
   * so the tree can auto-expand exactly that branch.
   */
  readonly worstOffenderPath = computed<string[]>(() => {
    const action = this.getSelectedAction();
    if (!action?.tree) return [];

    // Find the node with the highest count.
    let worst: CascadeNode | null = null;
    const findWorst = (nodes: CascadeNode[]): void => {
      for (const n of nodes) {
        if (!worst || n.count > worst.count) worst = n;
        if (n.children?.length) findWorst(n.children);
      }
    };
    findWorst(action.tree);
    if (!worst || (worst as CascadeNode).count <= 1) return [];

    // Walk the tree collecting the ancestor chain to the worst node.
    const path: string[] = [];
    const dfs = (nodes: CascadeNode[], trail: string[]): boolean => {
      for (const n of nodes) {
        const nextTrail = [...trail, n.componentName];
        if (n === worst) {
          path.push(...nextTrail);
          return true;
        }
        if (n.children?.length && dfs(n.children, nextTrail)) return true;
      }
      return false;
    };
    dfs(action.tree, []);
    return path;
  });

  readonly avgIFP = computed(() => {
    const replays = this.stableActionReplays();
    if (replays.length === 0) return 0;
    return Math.round(replays.reduce((acc, r) => acc + (r.duration || 0), 0) / replays.length);
  });

  readonly totalEfficiency = computed(() => {
    const replays = this.stableActionReplays();
    if (replays.length === 0) return 100;
    const totalRenders = replays.reduce((acc, r) => acc + (r.totalRenders || 0), 0);
    const wasted = replays.reduce((acc, r) => acc + Math.floor((r.totalRenders || 0) * 0.2), 0);
    return Math.round(((totalRenders - wasted) / totalRenders) * 100);
  });

  // Card stability: cache previous cards to prevent flickering
  private cardRebuildTimer: any = null;
  private lastEventCount = 0;
  /** Guards the auto-select effect so it fires at most once per action. */
  private autoSelectedForActionId: string | null = null;

  // Replace computed with signal that we control updates to
  readonly stableActionReplays = signal<ActionReplay[]>([]);

  // ── Action Replays ────────────────────────────────────────────────────────

  /** Time window (ms) from first event that counts as "page load". */
  private readonly PAGE_LOAD_WINDOW = 8000;

  /** Deduplicated render count (coalesces events within 50ms of same component). */
  readonly deduplicatedRenderCount = computed<number>(() => {
    const allEvents = this.state.renderEvents();
    if (allEvents.length === 0) return 0;

    const lastCountedTs = new Map<string, number>();
    const SAME_CYCLE_MS = 16; // One frame window for coalescing
    let count = 0;
    for (const event of allEvents) {
      const lastTs = lastCountedTs.get(event.componentName);
      const isDistinctRender = lastTs == null || (event.timestamp - lastTs) >= SAME_CYCLE_MS;
      if (isDistinctRender) {
        count++;
        lastCountedTs.set(event.componentName, event.timestamp);
      }
    }
    return count;
  });

  readonly actionReplays = computed<ActionReplay[]>(() => {
    const profiles = this.state.interactionProfiles();
    const allEvents = this.state.renderEvents();
    if (allEvents.length === 0) return [];

    const allFlow = this.state.flowEvents();

    // ── Detect page load: first N seconds of activity with no user interaction ──
    const firstEventTs = allEvents[0]?.timestamp ?? 0;
    const pageLoadCutoff = firstEventTs + this.PAGE_LOAD_WINDOW;

    // Find timestamps of all user interactions to exclude their surrounding events
    const interactionTimestamps = allEvents
      .filter(e => e.interactionComponent)
      .map(e => e.timestamp);

    // An event belongs to page load only if:
    // 1. It's within the page load window AND
    // 2. It has no interaction AND
    // 3. It's not within 500ms after any user interaction (cascade from click)
    const isPageLoadEvent = (e: RenderEvent): boolean => {
      if (e.timestamp > pageLoadCutoff) return false;
      if (e.interactionComponent) return false;
      // Check if this event is a cascade from a recent interaction
      for (const iTs of interactionTimestamps) {
        if (e.timestamp >= iTs && e.timestamp - iTs < 500) return false;
      }
      return true;
    };

    const pageLoadEvents = allEvents.filter(isPageLoadEvent);
    const postLoadEvents = allEvents.filter(e => !isPageLoadEvent(e));

    const results: ActionReplay[] = [];

    // Create page load card only if there are meaningful non-interactive renders
    if (pageLoadEvents.length >= 3) {
      const pageLoadFlow = allFlow.filter(f => f.timestamp <= pageLoadCutoff);
      const httpCount = pageLoadFlow.filter(f => f.type === 'http-response').length;
      const signalCount = pageLoadFlow.filter(f => f.type === 'signal-write').length;
      const subjectCount = pageLoadFlow.filter(f => f.type === 'subject-emit').length;
      const duration = (pageLoadEvents[pageLoadEvents.length - 1]?.timestamp ?? firstEventTs) - firstEventTs;

      // Find re-render offenders (components that rendered many times during load)
      const renderCounts = new Map<string, number>();
      for (const e of pageLoadEvents) {
        renderCounts.set(e.componentName, (renderCounts.get(e.componentName) ?? 0) + 1);
      }
      const offenders = Array.from(renderCounts.entries())
        .filter(([, count]) => count > 3)
        .sort((a, b) => b[1] - a[1]);

      // Build suggestion based on offenders
      let loadSuggestion: string | null = null;
      if (offenders.length > 0 && httpCount > 5) {
        const [topName, topCount] = offenders[0];
        loadSuggestion = `${this.displayName(topName)} rendered ${topCount}× during page load (likely once per API response). Use forkJoin() or combineLatest() to batch API responses before updating state.`;
      } else if (offenders.length > 0) {
        const [topName, topCount] = offenders[0];
        loadSuggestion = `${this.displayName(topName)} rendered ${topCount}× during load. Consider batching state updates or deferring non-visible component initialization.`;
      }

      // Build trigger label
      const parts: string[] = [];
      if (httpCount > 0) parts.push(`${httpCount} API calls`);
      if (signalCount > 0) parts.push(`${signalCount} signal writes`);
      if (subjectCount > 0) parts.push(`${subjectCount} subject emissions`);
      const triggerDetail = parts.length > 0 ? parts.join(' · ') : 'Initial render';

      results.push({
        id: 'page-load',
        trigger: 'Page Load',
        triggerIcon: '🚀',
        targetSelector: triggerDetail,
        triggerComponent: null,
        timestamp: firstEventTs,
        totalRenders: pageLoadEvents.length,
        uniqueComponents: new Set(pageLoadEvents.map(e => e.componentName)).size,
        duration,
        frameBudgetExceeded: pageLoadEvents.reduce((s, e) => s + e.duration, 0) > 500,
        framesDropped: Math.max(0, Math.floor(pageLoadEvents.reduce((s, e) => s + e.duration, 0) / 16.67) - 1),
        timeline: this.buildTimeline(pageLoadEvents, pageLoadFlow),
        tree: this.buildCascadeTree(pageLoadEvents),
        flowEntries: this.buildFlowEntries(pageLoadFlow),
        _pageLoadSuggestion: loadSuggestion,
      } as ActionReplay & { _pageLoadSuggestion: string | null });
    }

    // Add post-load actions (or all actions if no page load card was created)
    const eventsForGrouping = results.length > 0 ? postLoadEvents : allEvents;
    if (profiles.length === 0) {
      results.push(...this.groupEventsByInteraction(eventsForGrouping));
    } else {
      const relevantProfiles = results.length > 0
        ? profiles.filter(p => p.startTime > pageLoadCutoff)
        : profiles;
      results.push(...relevantProfiles.slice(0, 30).map(p => this.buildReplay(p, allEvents)));
    }

    // Sort all cards reverse-chronologically (newest first)
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results;
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  toggleAction(id: string): void {
    // Track which action cards are expanded/collapsed
    const next = new Set(this.collapsedActions());
    if (next.has(id)) {
      next.delete(id); // Expand
    } else {
      next.add(id); // Collapse
    }
    this.collapsedActions.set(next);
  }

  selectAction(id: string | null): void {
    // Toggle selection (clicking same action again deselects)
    const isAlreadySelected = this.selectedActionId() === id;
    this.selectedActionId.set(isAlreadySelected ? null : id);

    // TRUST RULE: switching session/action must not leave a stale selected
    // component from the previous action. If the currently selected component
    // doesn't exist in the newly selected action's tree, clear the selection
    // (and reset the auto-select guard) so every panel stays consistent.
    const selectedName = this.selectedComponentName();
    if (selectedName) {
      const action = this.getSelectedAction();
      const stillPresent = !!action?.tree &&
        this.flattenTree(action.tree).some(n => this.displayName(n.componentName) === selectedName);
      if (!stillPresent) {
        this.selectionHistory.set([]);
        this.selectedComponentName.set(null);
        this.selectedComponentData.set(null);
        this.autoSelectedForActionId = null; // allow auto-select for the new action
      }
    }
  }

  /**
   * Whether an action represents a MEANINGFUL performance concern — not merely
   * a high render count. 🔥 is reserved for a detected excessive re-render
   * pattern (a component rendering ≥5×) or a genuinely exceeded frame budget.
   */
  isActionConcern(action: ActionReplay): boolean {
    if (!action.tree) return false;
    const hasExcessiveComponent = this.flattenTree(action.tree).some(n => n.count >= 5);
    return hasExcessiveComponent || action.frameBudgetExceeded;
  }

  /** Human-readable reason for the concern flag (tooltip). */
  actionConcernReason(action: ActionReplay): string {
    if (!action.tree) return '';
    const worst = this.flattenTree(action.tree).sort((a, b) => b.count - a.count)[0];
    if (worst && worst.count >= 5) {
      return `${this.displayName(worst.componentName)} re-rendered ${worst.count}× — excessive re-render pattern.`;
    }
    if (action.frameBudgetExceeded) return 'Frame budget exceeded during this action.';
    return 'Performance concern detected.';
  }

  getPerformanceScore(duration: number): number {
    // Score from 0-100: lower duration = higher score
    // At 500ms (frame budget), score is 0. At 0ms, score is 100.
    const score = Math.max(0, 100 - duration / 5);
    return Math.min(100, score);
  }

  getSelectedAction = computed(() => {
    const selected = this.selectedActionId();
    if (!selected) return null;
    return this.stableActionReplays().find(a => a.id === selected) ?? null;
  });

  // ── Phase 1 & 2 Integration ───────────────────────────────────────────────

  /** Phase 1: Sticky metrics for the selected action */
  readonly stickyMetrics = computed(() => {
    return this.adapter.toStickyMetrics(this.getSelectedAction());
  });

  /** Phase 1: Headline data for the selected action */
  readonly headline = computed(() => {
    return this.adapter.toHeadline(this.getSelectedAction());
  });

  /** Phase 1: Hotspots (top issues) for the selected action */
  readonly hotspots = computed(() => {
    return this.adapter.toHotspots(this.getSelectedAction());
  });

  /** Phase 2: API timeline phases for the selected action */
  readonly apiPhases = computed(() => {
    return this.adapter.toAPITimeline(this.getSelectedAction());
  });

  /** Phase 2: Component cards from the cascade tree */
  readonly componentCards = computed(() => {
    const action = this.getSelectedAction();
    if (!action || !action.tree) return [];

    const nodes = this.flattenTree(action.tree);
    return nodes.slice(0, 10).map(node => this.adapter.toComponentCard(node));
  });

  /** Phase 2: Focus mode data for the selected component */
  readonly focusData = computed(() => {
    const action = this.getSelectedAction();
    const componentName = this.focusComponentName();

    if (!componentName || !action) return null;

    return this.adapter.toFocusData(action, componentName);
  });

  /** Detective: Ranked investigations (Investigation Queue) */
  readonly detectedInvestigations = computed(() => {
    const action = this.getSelectedAction();
    if (!action) return [];

    return this.investigationQueueService.rankInvestigations(action);
  });

  // ── Execution Detective UX (Task 7) ────────────────────────────────────────

  /** Detective: Inline summary (single/double line) */
  readonly inlineSummary = computed(() => {
    const action = this.getSelectedAction();
    if (!action) return null;

    const nodes = this.flattenTree(action.tree);
    let maxImpact = 0;

    for (const node of nodes) {
      const impact = node.count * node.totalDuration;
      if (impact > maxImpact) maxImpact = impact;
    }

    let health: 'green' | 'yellow' | 'red' = 'green';
    if (action.frameBudgetExceeded) {
      health = 'red';
    } else if (maxImpact > 100 || action.totalRenders > 10) {
      health = 'yellow';
    }

    return {
      duration: action.duration,
      renderCount: action.totalRenders,
      uniqueComponents: action.uniqueComponents,
      frameBudgetExceeded: action.frameBudgetExceeded,
      framesMissed: action.framesDropped,
      health,
      confidence: 95,
    };
  });

  /** Detective: Ranked investigations (prominent) */
  readonly rankedInvestigations = computed(() => {
    const investigations = this.detectedInvestigations();
    if (!investigations || investigations.length === 0) return [];

    return investigations.map((inv: any, idx: number) => ({
      rank: idx + 1,
      id: inv.id,
      title: inv.title,
      icon: inv.icon,
      impact: inv.impactScore,
      potential: inv.optimizationPotential * 100,
      gainScore: inv.gainScore,
      affected: inv.metrics.affected,
      savings: inv.metrics.savings,
      confidence: inv.confidence,
      suggestion: `Optimizing this could save ${inv.metrics.savings}ms`,
    }));
  });

  /** Detective: Execution story (visual narrative) */
  readonly executionStory = computed(() => {
    const action = this.getSelectedAction();
    if (!action) return null;

    return this.executionStoryService.buildStory(action);
  });

  /** Detective: Toggle story view */
  readonly showStoryMode = signal(false);

  toggleStoryMode(): void {
    // Switch between tree view and execution story view
    this.showStoryMode.set(!this.showStoryMode());
  }

  toggleTreeView(): void {
    // Show/hide the full render cascade tree
    this.showTreeView.set(!this.showTreeView());
  }

  toggleFlowDetails(entryId: string): void {
    // Expand/collapse flow event details
    const next = new Set(this.expandedFlows());
    if (next.has(entryId)) {
      next.delete(entryId);
    } else {
      next.add(entryId);
    }
    this.expandedFlows.set(next);
  }

  toggleDataFlow(actionId: string): void {
    // Track which action's data flow is visible
    const next = new Set(this.expandedDataFlow());
    if (next.has(actionId)) {
      next.delete(actionId);
    } else {
      next.add(actionId);
    }
    this.expandedDataFlow.set(next);
  }

  toggleFlowType(flowType: string): void {
    // Show/hide flow events of a specific type
    const next = new Set(this.expandedFlowTypes());
    if (next.has(flowType)) {
      next.delete(flowType);
    } else {
      next.add(flowType);
    }
    this.expandedFlowTypes.set(next);
  }

  countFlowType(action: ActionReplay, type: string): number {
    return action.flowEntries.filter(f => f.type === type).length;
  }

  /** Filter flows by type for display organization */
  flowsByType(flows: FlowEntry[], type: string): FlowEntry[] {
    return flows.filter(f => f.type === type);
  }

  /** Get label for flow type */
  flowTypeLabel(type: string): string {
    // Human-readable labels for data flow event categories
    const labels: Record<string, string> = {
      'subject-emit': 'RxJS Subjects',
      'signal-write': 'Signals',
      'http-response': 'HTTP Calls',
      'websocket': 'WebSocket Events',
      'facade-method': 'State Facade',
      'store-dispatch': 'Store Dispatch',
      'store-select': 'Store Select',
    };
    return labels[type] || type;
  }

  /** Get color class for flow type */
  flowTypeColor(type: string): string {
    // Consistent visual coding: each data source has a distinct color
    const colorMap: Record<string, string> = {
      'subject-emit': 'border-purple-500/40 bg-purple-900/20 text-purple-300',
      'signal-write': 'border-green-500/40 bg-green-900/20 text-green-300',
      'http-response': 'border-cyan-500/40 bg-cyan-900/20 text-cyan-300',
      'websocket': 'border-indigo-500/40 bg-indigo-900/20 text-indigo-300',
      'facade-method': 'border-orange-500/40 bg-orange-900/20 text-orange-300',
      'store-dispatch': 'border-red-500/40 bg-red-900/20 text-red-300',
      'store-select': 'border-pink-500/40 bg-pink-900/20 text-pink-300',
    };
    return colorMap[type] || 'border-gray-500/40 bg-gray-900/20 text-gray-300';
  }

  /** Get icon for flow type */
  flowTypeIcon(type: string): string {
    // Quick visual indicator for what kind of event this is
    const icons: Record<string, string> = {
      'subject-emit': '📡',      // Broadcasting
      'signal-write': '⚡',      // Fast/reactive
      'http-response': '🌐',     // Network
      'websocket': '🔗',         // Connection
      'facade-method': '🏛️',    // Architecture
      'store-dispatch': '📤',    // Outgoing
      'store-select': '📥',      // Incoming
    };
    return icons[type] || '•';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Format a flow event for display in a tooltip. */
  getFlowTooltip(flow: FlowEntry): string {
    // For HTTP responses, show the response body structure
    if (flow.responseBody) {
      return `Response:\n${flow.responseBody}`;
    }
    // For store/subject events, show the full value
    if (flow.value) {
      // If value is short, show it inline; otherwise format nicely
      return flow.value.length > 100 
        ? `Value:\n${flow.value}`
        : `Value: ${flow.value}`;
    }
    // Fallback to detail field
    if (flow.detail) {
      return `Value: ${flow.detail}`;
    }
    return flow.label;
  }

  /** Navigate to a component file in the DevTools Sources panel. */
  navigateToComponent(componentName: string): void {
    try {
      // Use Chrome DevTools API to search for the component in sources
      if ((window as any).chrome?.devtools?.inspectedWindow) {
        // Send a message to the background script to locate the component file
        chrome.runtime.sendMessage({
          type: 'LOCATE_COMPONENT',
          componentName: componentName,
        }, (response: any) => {
          if (response?.sourceFile) {
            // Use DevTools API to open the file
            (window as any).chrome.devtools.panels.openResource(response.sourceFile, 0);
          }
        });
      } else {
        // Fallback: just log the component name for manual inspection
        console.log(`Component: ${componentName}`);
      }
    } catch (err) {
      console.log(`Could not navigate to component: ${componentName}`);
    }
  }

  formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  /** Get render reasons for a specific component from its render events */
  getRenderReasonsForComponent(componentName: string): RenderReason[] {
    const allEvents = this.state.renderEvents();
    const componentEvents = allEvents.filter(e => e.componentName === componentName);
    
    // No render events for this component yet
    if (componentEvents.length === 0) return [];

    // Aggregate reasons across all renders of this component
    // (same reason might trigger multiple times)
    const reasonsMap = new Map<string, RenderReason>();
    
    for (const event of componentEvents) {
      if (!event.reasons) continue;
      
      for (const reason of event.reasons) {
        const reasonKey = `${reason.type}:${reason.source}`;
        const existing = reasonsMap.get(reasonKey);
        
        if (existing) {
          // Count this reason again (it triggered another render)
          existing.count += reason.count;
          // Keep the most recent value
          if (reason.after !== undefined) {
            existing.after = reason.after;
          }
        } else {
          reasonsMap.set(reasonKey, { ...reason });
        }
      }
    }
    
    // Sort by frequency (most common first)
    return Array.from(reasonsMap.values()).sort((a, b) => b.count - a.count);
  }

  /** Get reason type icon and color */
  getReasonIcon(type: string): { icon: string; class: string } {
    // Each reason type gets a distinct visual identity
    const iconMap: Record<string, { icon: string; class: string }> = {
      'signal': { icon: '⚡', class: 'reason-signal' },        // Reactive
      'input': { icon: '📥', class: 'reason-input' },          // External input
      'parent': { icon: '👨‍👧', class: 'reason-parent' },     // Parent cascade
      'zone': { icon: '⏱️', class: 'reason-zone' },           // Timing
      'api': { icon: '🌐', class: 'reason-api' },             // Network
      'route': { icon: '🛣️', class: 'reason-route' },        // Navigation
    };
    return iconMap[type] || { icon: '❓', class: 'reason-default' };
  }

  /** Toggle component render reasons expansion */
  toggleComponentReasons(componentName: string): void {
    // Track which component's render reasons are visible
    const current = this.expandedComponentReasons();
    const shouldExpand = current !== componentName;
    this.expandedComponentReasons.set(shouldExpand ? componentName : null);
  }

  /** Check if a component's render reasons are expanded */
  isComponentReasonsExpanded(componentName: string): boolean {
    return this.expandedComponentReasons() === componentName;
  }

  formatCauseSource(cause: RenderCause): string {
    // Format cause info into a human-readable phrase
    const source = cause.source ?? cause.type;

    // Parent component re-renders cascade down to children
    if (cause.type === 'parent') {
      return source ? `by ${displayName(source)}` : 'parent cascade';
    }

    // User events (click, input, etc.)
    if (source.startsWith('addEventListener:')) {
      const eventType = source.replace('addEventListener:', '');
      return `${eventType} event`;
    }

    // Async operations
    if (source === 'setTimeout') return 'timer';
    if (source === 'setInterval') return 'interval';
    if (source === 'fetch' || source === 'XMLHttpRequest') return 'HTTP response';
    if (source === 'Promise.then') return 'async callback';

    return source;
  }

  causePillClass(type: RenderCause['type'] | 'unknown'): string {
    // Color-coded pills for render cause types (helps quick visual scanning)
    const pillColors: Record<string, string> = {
      'zone': 'bg-blue-900/60 text-blue-300',        // Angular zone events
      'signal': 'bg-green-900/60 text-green-300',    // Reactive signals
      'input': 'bg-cyan-900/60 text-cyan-300',       // @Input changes
      'parent': 'bg-purple-900/60 text-purple-300',  // Parent re-renders
      'manual-cd': 'bg-amber-900/60 text-amber-300', // Manual CD trigger
      'unknown': 'bg-gray-700 text-gray-400',
    };
    return pillColors[type] || 'bg-gray-700 text-gray-400';
  }

  flattenTree(tree: CascadeNode[]): CascadeNode[] {
    const result: CascadeNode[] = [];
    const seen = new Set<string>();
    const walk = (nodes: CascadeNode[], level: number): void => {
      const sorted = [...nodes].sort((a, b) => b.count - a.count || b.totalDuration - a.totalDuration);
      for (const node of sorted) {
        if (seen.has(node.componentName)) continue; // cycle guard
        seen.add(node.componentName);
        result.push({ ...node, depth: level });
        walk(node.children, level + 1);
      }
    };
    walk(tree, 0);
    return result;
  }

  /** Reducer to sum render counts from flattened tree */

  /** Severity of a component's render — based on IMPACT (count × duration), not just count. */
  renderSeverity(node: CascadeNode): 'high' | 'medium' | 'none' {
    const impact = node.count * node.totalDuration;
    if (impact >= 500 || node.count >= 6) return 'high';
    if (impact >= 100 || node.count >= 3) return 'medium';
    return 'none';
  }

  /** Impact score label: Very High / High / Medium / Low */
  impactLabel(node: CascadeNode): string {
    const impact = node.count * node.totalDuration;
    if (impact >= 1000) return 'Very High';
    if (impact >= 500) return 'High';
    if (impact >= 100) return 'Medium';
    return 'Low';
  }

  /** Impact bar width (0-100%) for visual display */
  impactPct(node: CascadeNode, action: ActionReplay): number {
    const totalMs = action.duration || 1;
    return Math.min(100, Math.round((node.totalDuration / totalMs) * 100));
  }

  /** Specific render reason — WHY this component rendered */
  renderReason(node: CascadeNode): string {
    const cause = node.cause.type;
    const src = node.cause.source ?? '';

    if (cause === 'signal') {
      if (src.includes('.')) return `Signal: ${src.split('.').pop()?.replace('()', '')}`;
      return 'Signal changed';
    }
    if (cause === 'input') return 'Input reference changed';
    if (cause === 'parent') return 'Parent re-rendered';
    if (cause === 'manual-cd') {
      if (src.includes('markForCheck')) return 'markForCheck()';
      if (src.includes('detectChanges')) return 'detectChanges()';
      return 'Manual change detection';
    }
    // Zone-based triggers
    if (src.includes('addEventListener:click')) return 'Click event';
    if (src.includes('addEventListener:input')) return 'Input event';
    if (src.includes('addEventListener:scroll')) return 'Scroll event';
    if (src.includes('addEventListener:keydown') || src.includes('addEventListener:keyup')) return 'Keyboard event';
    if (src.includes('addEventListener')) return `DOM event: ${src.replace('addEventListener:', '')}`;
    if (src.includes('setTimeout')) return 'Timer (setTimeout)';
    if (src.includes('setInterval')) return 'Interval (setInterval)';
    if (src.includes('requestAnimationFrame')) return 'Animation frame';
    if (src.includes('fetch') || src.includes('XMLHttpRequest')) return 'API response';
    if (src.includes('Promise')) return 'Async (Promise)';
    if (src.includes('MutationObserver')) return 'DOM mutation';
    if (src.includes('WebSocket')) return 'WebSocket message';
    if (src === 'unknown' || !src) return 'Zone.js trigger';
    return src;
  }

  /** Specific fix recommendation based on render reason */
  renderFix(node: CascadeNode): string {
    if (node.count <= 1) return '';
    const cause = node.cause.type;
    const src = node.cause.source ?? '';

    if (cause === 'parent') {
      return 'Add OnPush + check if @Input() references actually change.';
    }
    if (cause === 'signal') {
      return 'Use computed() to derive values instead of triggering multiple .set() calls.';
    }
    if (cause === 'input') {
      return 'Parent is creating new object references on each CD. Memoize or use immutable patterns.';
    }
    if (src.includes('setInterval') || src.includes('setTimeout')) {
      return 'Run timer outside Angular zone: ngZone.runOutsideAngular(() => ...).';
    }
    if (src.includes('fetch') || src.includes('XMLHttpRequest') || src.includes('Promise')) {
      return 'Batch async operations with forkJoin() or update state once after all complete.';
    }
    if (src.includes('addEventListener:scroll')) {
      return 'Debounce scroll handler or use Intersection Observer instead.';
    }
    if (src.includes('addEventListener:input')) {
      return 'Add debounceTime() to input events or use updateOn: blur.';
    }
    if (src.includes('requestAnimationFrame')) {
      return 'Move animation outside Angular zone, manually trigger CD on state change.';
    }
    if (cause === 'manual-cd') {
      return 'Review why manual CD is needed — likely can replace with signals/OnPush.';
    }
    return 'Consider OnPush + signals for fine-grained reactivity.';
  }

  /**
   * Developer-meaningful render count for an action = the sum of the cascade
   * tree's per-component counts. This is what the tree/hotspots/origin actually
   * add up to, after coalescing same-cycle renders and dropping minified
   * (≤2-char) components. `action.totalRenders` is the RAW mutation-event count
   * and will be higher; we display THIS so the headline number reconciles with
   * the tree the user sees.
   */
  meaningfulRenderCount(action: ActionReplay): number {
    if (!action?.tree) return 0;
    const nodes = this.flattenTree(action.tree);
    const sum = nodes.reduce((s, n) => s + n.count, 0);
    return sum;
  }

  /** Get the hottest component in an action (highest impact) */
  getHotspot(action: ActionReplay): { name: string; count: number; duration: number; pct: number } | null {
    const nodes = this.flattenTree(action.tree);
    if (nodes.length === 0) return null;
    let hottest: CascadeNode | null = null;
    let maxImpact = 0;
    for (const n of nodes) {
      const impact = n.count * n.totalDuration;
      if (impact > maxImpact) { maxImpact = impact; hottest = n; }
    }
    if (!hottest || hottest.count <= 1) return null;
    const totalDur = action.duration || 1;
    return {
      name: this.displayName(hottest.componentName),
      count: hottest.count,
      duration: Math.round(hottest.totalDuration),
      pct: Math.round((hottest.totalDuration / totalDur) * 100),
    };
  }

  /** Count total descendant renders for a node */
  descendantRenderCount(node: CascadeNode): number {
    let total = 0;
    const walk = (children: CascadeNode[]): void => {
      for (const child of children) {
        total += child.count;
        walk(child.children);
      }
    };
    walk(node.children);
    return total;
  }

  toggleFullTree(): void {
    this.showFullTree.set(!this.showFullTree());
  }

  /** Build the full component tree scoped to this action's affected subtree.
   *  Shows the re-rendered components + their siblings/children for context.
   */
  buildFullTree(action: ActionReplay): CascadeNode[] {
    // Get all components ever seen (from all render events in session)
    const allEvents = this.state.renderEvents();
    const childrenMap = new Map<string, Set<string>>(); // parent → children

    // Build parent→children relationships from ALL session events
    for (const event of allEvents) {
      if (event.componentName.length <= 2) continue;
      if (event.parentComponent && event.parentComponent !== event.componentName) {
        if (!childrenMap.has(event.parentComponent)) {
          childrenMap.set(event.parentComponent, new Set());
        }
        childrenMap.get(event.parentComponent)!.add(event.componentName);
      }
    }

    // Determine which components re-rendered in THIS action
    const actionComponents = new Map<string, { count: number; duration: number; cause: any }>();
    const actionEvents = this.getActionEvents(action);
    for (const event of actionEvents) {
      if (event.componentName.length <= 2) continue;
      const existing = actionComponents.get(event.componentName);
      if (existing) {
        existing.count++;
        existing.duration += event.duration;
      } else {
        actionComponents.set(event.componentName, {
          count: 1,
          duration: event.duration,
          cause: event.causes[0] ?? { type: 'zone', source: 'unknown' },
        });
      }
    }

    if (actionComponents.size === 0) return [];

    // Find the roots: re-rendered components whose parent did NOT re-render
    const actionParentMap = new Map<string, string | null>();
    for (const event of actionEvents) {
      if (event.componentName.length <= 2) continue;
      if (event.parentComponent && !actionParentMap.has(event.componentName)) {
        actionParentMap.set(event.componentName, event.parentComponent);
      }
    }

    const affectedRoots = new Set<string>();
    for (const name of actionComponents.keys()) {
      const parent = actionParentMap.get(name);
      if (!parent || !actionComponents.has(parent)) {
        affectedRoots.add(name);
      }
    }

    // Build tree ONLY for affected roots and their direct children (from session data)
    const buildNode = (name: string, depth: number, maxDepth: number): CascadeNode => {
      const actionData = actionComponents.get(name);
      const node: CascadeNode = {
        componentName: name,
        count: actionData?.count ?? 0,
        totalDuration: actionData?.duration ?? 0,
        cause: actionData?.cause ?? { type: 'zone', source: 'unknown' },
        depth,
        children: [],
      };
      // Only expand children up to maxDepth to avoid showing entire app
      if (depth < maxDepth) {
        const children = childrenMap.get(name);
        if (children) {
          for (const childName of children) {
            // Only include child if it re-rendered OR is a direct child of something that did
            const childRerendered = actionComponents.has(childName);
            const parentRerendered = actionComponents.has(name);
            if (childRerendered || parentRerendered) {
              node.children.push(buildNode(childName, depth + 1, maxDepth));
            }
          }
          // Sort: rendered first, then alphabetical
          node.children.sort((a, b) => {
            if (a.count > 0 && b.count === 0) return -1;
            if (a.count === 0 && b.count > 0) return 1;
            return a.componentName.localeCompare(b.componentName);
          });
        }
      }
      return node;
    };

    const roots: CascadeNode[] = [];
    for (const rootName of affectedRoots) {
      roots.push(buildNode(rootName, 0, 5));
    }

    return roots;
  }

  /** Get render events that belong to a specific action's time window */
  private getActionEvents(action: ActionReplay): RenderEvent[] {
    const allEvents = this.state.renderEvents();
    const start = action.timestamp;
    const end = action.timestamp + (action.duration || 500);
    return allEvents.filter(e => e.timestamp >= start - 50 && e.timestamp <= end + 50);
  }

  /** Row styling based on severity — hot components stand out. */
  rowClass(node: CascadeNode): string {
    const sev = this.renderSeverity(node);
    if (sev === 'high') return 'bg-red-950/30 hover:bg-red-950/50 border-l-2 border-red-500';
    if (sev === 'medium') return 'bg-amber-950/20 hover:bg-amber-950/40 border-l-2 border-amber-500/60';
    return 'hover:bg-gray-800/40 border-l-2 border-transparent';
  }

  /** Actionable hint — now delegates to renderFix for specific recommendations */
  renderHint(node: CascadeNode): string {
    if (this.renderSeverity(node) === 'none') return '';
    return `${this.renderReason(node)} (${node.count}×). ${this.renderFix(node)}`;
  }

  /** Count of hot components in an action — shown in the section header. */
  hotCount(action: ActionReplay): number {
    return this.flattenTree(action.tree).filter(n => this.renderSeverity(n) !== 'none').length;
  }

  /** Select a component to highlight it in the page and open the Why panel. */
  inspectComponent(componentName: string): void {
    this.state.selectedComponent.set(componentName);
  }

  /** Flow events (API/store/state) attributed to a specific component via ownerClass. */
  flowsForComponent(action: ActionReplay, componentName: string): FlowEntry[] {
    return action.flowEntries.filter(f =>
      f.ownerClass && this.displayName(f.ownerClass) === this.displayName(componentName)
    );
  }

  /** Flow events with no component attribution — shown in the Data Flow section. */
  unattributedFlows(action: ActionReplay): FlowEntry[] {
    const attributed = new Set(
      action.flowEntries
        .filter(f => f.ownerClass)
        .map(f => this.displayName(f.ownerClass!))
    );
    // A flow is unattributed if its owner isn't a component in this action's tree
    const treeComponents = new Set(this.flattenTree(action.tree).map(n => this.displayName(n.componentName)));
    return action.flowEntries.filter(f => {
      if (!f.ownerClass) return true;
      return !treeComponents.has(this.displayName(f.ownerClass));
    });
  }

  /** Build causal chains from flow entries — groups related events into cause→effect sequences */
  buildCausalChains(action: ActionReplay): CausalChain[] {
    const flows = action.flowEntries;
    if (flows.length === 0) return [];

    const treeComponents = new Set(this.flattenTree(action.tree).map(n => this.displayName(n.componentName)));
    const chains: CausalChain[] = [];
    const used = new Set<string>();

    // Sort flows by timestamp
    const sorted = [...flows].sort((a, b) => a.timestamp - b.timestamp);

    // Phase 1: Build chains starting from HTTP responses (API → Store → Components)
    const httpFlows = sorted.filter(f => f.type === 'http-response');
    for (const http of httpFlows) {
      used.add(http.id);
      const chain: CausalChain = {
        id: `chain-${chains.length}`,
        trigger: { icon: '🌐', label: this.shortenUrl(http.label), type: 'http', value: http.responseBody },
        effects: [],
        impactedComponents: [],
        isDuplicate: false,
        duplicateCount: 1,
      };

      // Find store dispatches/signal writes within 2000ms after this HTTP response
      const CHAIN_WINDOW = 2000;
      for (const flow of sorted) {
        if (used.has(flow.id)) continue;
        if (flow.timestamp < http.timestamp) continue;
        if (flow.timestamp - http.timestamp > CHAIN_WINDOW) break;
        if (flow.type === 'subject-emit' || flow.type === 'store-dispatch' || flow.type === 'signal-write') {
          used.add(flow.id);
          chain.effects.push({
            icon: flow.icon,
            label: flow.label.replace('Store: ', ''),
            type: flow.type,
            value: flow.value,
          });
          // Collect subscribers as impacted components
          if (flow.subscribers) {
            for (const sub of flow.subscribers) {
              const name = this.displayName(sub);
              if (treeComponents.has(name) && !chain.impactedComponents.includes(name)) {
                chain.impactedComponents.push(name);
              }
            }
          }
        }
      }

      // If no effects found but we have tree components, just note the API completed
      // (common when store dispatches are recorded before the http-response event)
      chains.push(chain);
    }

    // Phase 2: Group remaining store dispatches without an HTTP trigger
    const remainingStoreFlows = sorted.filter(f =>
      !used.has(f.id) && (f.type === 'subject-emit' || f.type === 'store-dispatch' || f.type === 'signal-write')
    );

    // Group consecutive store dispatches within 200ms as a single chain
    let currentGroup: FlowEntry[] = [];
    for (const flow of remainingStoreFlows) {
      if (currentGroup.length === 0 || flow.timestamp - currentGroup[currentGroup.length - 1].timestamp < 200) {
        currentGroup.push(flow);
      } else {
        if (currentGroup.length > 0) {
          chains.push(this.buildStoreChain(currentGroup, treeComponents, chains.length));
        }
        currentGroup = [flow];
      }
    }
    if (currentGroup.length > 0) {
      chains.push(this.buildStoreChain(currentGroup, treeComponents, chains.length));
    }

    // Phase 3: Detect duplicates (same trigger label appearing multiple times)
    const triggerCounts = new Map<string, number>();
    for (const chain of chains) {
      const key = chain.trigger.label;
      triggerCounts.set(key, (triggerCounts.get(key) ?? 0) + 1);
    }
    // Merge duplicates
    const merged: CausalChain[] = [];
    const seen = new Set<string>();
    for (const chain of chains) {
      const key = chain.trigger.label;
      const count = triggerCounts.get(key) ?? 1;
      if (count > 1) {
        if (seen.has(key)) continue;
        seen.add(key);
        // Find all chains with same trigger and merge effects
        const duplicates = chains.filter(c => c.trigger.label === key);
        const mergedChain: CausalChain = {
          ...duplicates[0],
          isDuplicate: true,
          duplicateCount: count,
          effects: [],
          impactedComponents: [],
        };
        const effectLabels = new Set<string>();
        for (const dup of duplicates) {
          for (const eff of dup.effects) {
            if (!effectLabels.has(eff.label)) {
              effectLabels.add(eff.label);
              mergedChain.effects.push(eff);
            }
          }
          for (const comp of dup.impactedComponents) {
            if (!mergedChain.impactedComponents.includes(comp)) {
              mergedChain.impactedComponents.push(comp);
            }
          }
        }
        merged.push(mergedChain);
      } else {
        merged.push(chain);
      }
    }

    return merged;
  }

  private buildStoreChain(flows: FlowEntry[], treeComponents: Set<string>, index: number): CausalChain {
    const first = flows[0];
    const chain: CausalChain = {
      id: `chain-store-${index}`,
      trigger: { icon: first.icon, label: first.label.replace('Store: ', ''), type: first.type, value: first.value },
      effects: [],
      impactedComponents: [],
      isDuplicate: false,
      duplicateCount: 1,
    };
    // Only add remaining flows as effects if they have different labels
    for (let i = 1; i < flows.length; i++) {
      const effectLabel = flows[i].label.replace('Store: ', '');
      if (effectLabel !== chain.trigger.label) {
        chain.effects.push({
          icon: flows[i].icon,
          label: effectLabel,
          type: flows[i].type,
          value: flows[i].value,
        });
      }
    }
    // Collect impacted components from subscribers
    for (const flow of flows) {
      if (flow.subscribers) {
        for (const sub of flow.subscribers) {
          const name = this.displayName(sub);
          if (treeComponents.has(name) && !chain.impactedComponents.includes(name)) {
            chain.impactedComponents.push(name);
          }
        }
      }
    }
    return chain;
  }

  /** Shorten a URL for display */
  private shortenUrl(label: string): string {
    // Extract method + path + status: "GET /api/client/114523/details → 200"
    const match = label.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+?)(\s*→\s*\d+)?$/);
    if (!match) return label.length > 60 ? label.slice(0, 60) + '…' : label;
    const method = match[1];
    let path = match[2];
    const status = match[3] ?? '';
    // Remove query params for display
    const qIdx = path.indexOf('?');
    if (qIdx > 0) path = path.slice(0, qIdx);
    // Shorten long numeric IDs in path
    path = path.replace(/\/\d{5,}/g, '/…');
    // Keep the last meaningful segment visible
    if (path.length > 50) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 3) {
        path = '/' + parts[0] + '/…/' + parts[parts.length - 1];
      } else {
        path = path.slice(0, 50) + '…';
      }
    }
    return `${method} ${path}${status}`;
  }

  // ── Private: build action replays ─────────────────────────────────────────

  private buildReplay(profile: InteractionProfile, allEvents: RenderEvent[]): ActionReplay {
    const events = allEvents.filter(e =>
      e.timestamp >= profile.startTime && e.timestamp <= profile.endTime
    );
    const flowEvents = this.state.flowEvents().filter(f => {
      if (f.triggeredByInteractionTs != null) {
        return f.triggeredByInteractionTs >= profile.startTime - 100 && f.triggeredByInteractionTs <= profile.endTime + 100;
      }
      // Extended window: API responses can arrive up to 10s after the interaction
      return f.timestamp >= profile.startTime - 100 && f.timestamp <= profile.endTime + 10000;
    });
    const interaction = events.find(e => e.interactionComponent);
    const duration = profile.duration;
    return {
      id: profile.id,
      trigger: this.detectTrigger(events),
      triggerIcon: this.detectIcon(events),
      targetSelector: interaction?.interactionTarget ?? null,
      triggerComponent: interaction?.interactionComponent ?? null,
      interactionInfo: this.pickInteractionInfo(events),
      timestamp: profile.startTime,
      totalRenders: events.length,
      uniqueComponents: new Set(events.map(e => e.componentName)).size,
      duration,
      frameBudgetExceeded: events.reduce((s, e) => s + e.duration, 0) > 100,
      framesDropped: Math.max(0, Math.floor(events.reduce((s, e) => s + e.duration, 0) / 16.67) - 1),
      timeline: this.buildTimeline(events, flowEvents),
      tree: this.buildCascadeTree(events),
      flowEntries: this.buildFlowEntries(flowEvents),
    };
  }

  private groupEventsByInteraction(events: RenderEvent[]): ActionReplay[] {
    // Group events that are within 50ms of each other (same CD cycle)
    const rawGroups: RenderEvent[][] = [];
    let current: RenderEvent[] = [];

    for (const event of events) {
      if (current.length === 0 || event.timestamp - current[current.length - 1].timestamp < 50) {
        current.push(event);
      } else {
        rawGroups.push(current);
        current = [event];
      }
    }
    if (current.length > 0) rawGroups.push(current);

    // ── Merge rapid input events on the same element (within 500ms) ──
    // ── Also merge async cascades that follow a user interaction (API responses) ──
    const allFlow = this.state.flowEvents();
    const merged: RenderEvent[][] = [];
    for (let i = 0; i < rawGroups.length; i++) {
      const group = rawGroups[i];
      const prev = merged[merged.length - 1];
      const groupInteraction = group.find(e => e.interactionComponent);
      const prevInteraction = prev?.find(e => e.interactionComponent);

      const isSameInputElement =
        prev && prevInteraction && groupInteraction &&
        prevInteraction.interactionTarget === groupInteraction.interactionTarget &&
        groupInteraction.causes[0]?.source?.includes('input') &&
        prevInteraction.causes[0]?.source?.includes('input') &&
        group[0].timestamp - prev[prev.length - 1].timestamp < 500;

      // Merge non-interactive groups that follow a user interaction within 2s
      // (covers route changes where APIs respond and trigger re-renders)
      const timeSincePrev = prev ? group[0].timestamp - prev[prev.length - 1].timestamp : Infinity;
      const isAsyncCascade =
        prev && prevInteraction && !groupInteraction && timeSincePrev < 10000;

      // Also merge if a route-change happened in the previous group's window
      const prevStart = prev?.[0]?.timestamp ?? 0;
      const hasRouteChange = prev && allFlow.some(f => 
        f.type === 'route-change' && f.timestamp >= prevStart - 200 && f.timestamp <= group[0].timestamp
      );
      const isRouteCascade = prev && !groupInteraction && hasRouteChange && timeSincePrev < 3000;

      if (isSameInputElement || isAsyncCascade || isRouteCascade) {
        prev.push(...group);
      } else {
        merged.push(group);
      }
    }

    // ── Limit to last 20 cards (pagination) ──
    const visible = merged.slice(-20);

    return visible.map((group, i) => {
      const interaction = group.find(e => e.interactionComponent);
      const startTs = group[0].timestamp;
      const endTs = group[group.length - 1].timestamp;
      const duration = endTs - startTs || group.reduce((s, e) => s + e.duration, 0);
      const flowInWindow = allFlow.filter(f => {
        // Match by causal link: flow event was triggered by an interaction in this group
        if (f.triggeredByInteractionTs != null) {
          return f.triggeredByInteractionTs >= startTs - 100 && f.triggeredByInteractionTs <= endTs + 100;
        }
        // Extended window: API responses can take several seconds after interaction
        return f.timestamp >= startTs - 100 && f.timestamp <= endTs + 10000;
      });

      // Count how many input keystrokes were merged
      const inputCount = group.filter(e => e.causes[0]?.source?.includes('input')).length;
      const isInputBurst = inputCount > 1;

      const trigger = isInputBurst
        ? `input event (${inputCount} keystrokes)`
        : this.detectTrigger(group);

      return {
        id: `group-${startTs}`,
        trigger,
        triggerIcon: this.detectIcon(group),
        targetSelector: interaction?.interactionTarget ?? null,
        triggerComponent: interaction?.interactionComponent ?? null,
        interactionInfo: this.pickInteractionInfo(group),
        timestamp: startTs,
        totalRenders: group.length,
        uniqueComponents: new Set(group.map(e => e.componentName)).size,
        duration,
        frameBudgetExceeded: group.reduce((s, e) => s + e.duration, 0) > 100,
        framesDropped: Math.max(0, Math.floor(group.reduce((s, e) => s + e.duration, 0) / 16.67) - 1),
        timeline: this.buildTimeline(group, flowInWindow),
        tree: this.buildCascadeTree(group),
        flowEntries: this.buildFlowEntries(flowInWindow),
      };
    });
  }

  private buildCascadeTree(events: RenderEvent[]): CascadeNode[] {
    // Delegates to the pure, ground-truth-tested builder so the exact same
    // aggregation logic runs in both production and the accuracy harness.
    return buildCascadeTreePure(events) as CascadeNode[];
  }

  private buildTimeline(renderEvents: RenderEvent[], flowEvents: FlowEvent[]): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    let entryId = 0;

    // Only show component renders in the timeline — skip minified names (1-2 char)
    for (const r of renderEvents) {
      if (r.componentName.length <= 2) continue;
      entries.push({
        id: `t-${entryId++}`,
        timestamp: r.timestamp,
        kind: 'render',
        icon: '🔄',
        label: this.displayName(r.componentName),
        detail: r.depth === 0 ? this.formatCauseSource(r.causes[0] ?? { type: 'zone' }) : 'parent cascade',
        colorClass: r.depth === 0 ? 'text-white font-medium' : 'text-gray-300',
        depth: r.depth ?? 0,
        duration: r.duration,
        count: 1,
      });
    }

    // Sort by timestamp
    entries.sort((a, b) => a.timestamp - b.timestamp);

    // Deduplicate consecutive renders of the same component at the same depth
    const deduped: TimelineEntry[] = [];
    for (const entry of entries) {
      const last = deduped[deduped.length - 1];
      if (last && last.kind === 'render' && entry.kind === 'render' &&
          last.label === entry.label && last.depth === entry.depth) {
        last.count = (last.count ?? 1) + 1;
        last.duration = (last.duration ?? 0) + (entry.duration ?? 0);
      } else {
        deduped.push({ ...entry });
      }
    }

    // Collapse repeated sibling groups at same depth (e.g., TrFilter + SearchByKey repeated 20×)
    const collapsed: TimelineEntry[] = [];
    let i = 0;
    while (i < deduped.length) {
      const entry = deduped[i];
      // Look for repeating patterns of siblings at the same depth (depth > 0)
      if (entry.depth > 0 && entry.detail === 'parent cascade') {
        // Find the pattern: consecutive entries at the same depth form a "group"
        let patternEnd = i + 1;
        while (patternEnd < deduped.length &&
               deduped[patternEnd].depth >= entry.depth &&
               deduped[patternEnd].detail === 'parent cascade') {
          patternEnd++;
        }
        const groupSize = patternEnd - i;

        // If group has > 4 entries at this depth, try to detect repeating pattern
        if (groupSize > 4) {
          // Count occurrences of each component name at this exact depth
          const nameCountsAtDepth = new Map<string, number>();
          for (let j = i; j < patternEnd; j++) {
            if (deduped[j].depth === entry.depth) {
              nameCountsAtDepth.set(deduped[j].label, (nameCountsAtDepth.get(deduped[j].label) ?? 0) + 1);
            }
          }
          // If any component repeats > 3× at this depth, collapse all at this depth into grouped entries
          const hasRepeats = Array.from(nameCountsAtDepth.values()).some(c => c > 3);
          if (hasRepeats) {
            // Emit one collapsed entry per unique component at this depth level
            for (const [name, count] of nameCountsAtDepth) {
              collapsed.push({
                ...entry,
                id: `t-collapsed-${entry.id}-${name}`,
                label: name,
                count,
                duration: deduped.filter((e, idx) => idx >= i && idx < patternEnd && e.label === name && e.depth === entry.depth)
                  .reduce((sum, e) => sum + (e.duration ?? 0), 0),
              });
            }
            // Also include deeper children as a single collapsed line
            const childNames = new Map<string, number>();
            for (let j = i; j < patternEnd; j++) {
              if (deduped[j].depth > entry.depth) {
                childNames.set(deduped[j].label, (childNames.get(deduped[j].label) ?? 0) + (deduped[j].count ?? 1));
              }
            }
            for (const [name, count] of childNames) {
              collapsed.push({
                ...entry,
                id: `t-collapsed-child-${entry.id}-${name}`,
                label: name,
                depth: entry.depth + 1,
                count,
                duration: 0,
              });
            }
            i = patternEnd;
            continue;
          }
        }
      }
      collapsed.push(deduped[i]);
      i++;
    }

    // Attach flow events to the component that initiated them (via ownerClass)
    // or fallback to nearest render in time
    // (Flow is now shown in its own section, but keep flowDetails for tooltip context)
    for (const f of flowEvents) {
      let target: TimelineEntry | null = null;

      if (f.ownerClass) {
        target = collapsed.find(e => e.kind === 'render' && e.label === this.displayName(f.ownerClass!)) ?? null;
      }

      if (!target) {
        let minDistance = 500;
        for (const entry of collapsed) {
          if (entry.kind !== 'render') continue;
          const distance = Math.abs(entry.timestamp - f.timestamp);
          if (distance < minDistance) {
            minDistance = distance;
            target = entry;
          }
        }
      }

      if (target) {
        if (!target.flowDetails) target.flowDetails = [];
        target.flowDetails.push({
          icon: this.flowIcon(f.type),
          label: f.label,
          detail: f.detail ?? '',
          colorClass: this.flowColor(f.type),
        });
      }
    }

    return collapsed;
  }

  private buildFlowEntries(flowEvents: FlowEvent[]): FlowEntry[] {
    return flowEvents
      .filter(f => !this.isNoiseFlow(f) && !this.isFrameworkFlow(f))
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((f, i) => {
        const isStoreAction = f.label.startsWith('Store:');
        return {
          id: `flow-${i}-${f.timestamp}`,
          icon: isStoreAction ? '🏪' : this.flowIcon(f.type),
          type: f.type,
          label: f.label,
          detail: f.detail ?? '',
          colorClass: isStoreAction ? 'text-orange-300' : this.flowColor(f.type),
          timestamp: f.timestamp,
          ownerClass: f.ownerClass,
          sourceComponent: f.sourceComponent,
          subscribers: f.subscribers,
          value: f.value,
          responseBody: f.responseBody,
          connectionStatus: f.connectionStatus,
          methodName: f.methodName,
          actionName: f.actionName,
          selectorName: f.selectorName,
        };
      });
  }

  /** Filter out remaining noisy flow events not caught at source */
  private isNoiseFlow(f: FlowEvent): boolean {
    if (f.type !== 'http-response') return false;
    const url = (f.detail ?? f.label).toLowerCase();
    // Chrome extension internal requests
    if (url.includes('chrome-extension://')) return true;
    return false;
  }

  /** Filter out framework-level subjects (Angular internals, RxJS internals) */
  private isFrameworkFlow(f: FlowEvent): boolean {
    const label = f.label.toLowerCase();
    const ownerClass = f.ownerClass?.toLowerCase() ?? '';
    
    // Filter Angular framework subjects
    if (label.includes('ngzone') || ownerClass.includes('ngzone')) return true;
    if (label.includes('zone.run') || label.includes('zone.js')) return true;
    if (label.includes('async') && label.includes('scheduler')) return true;
    if (ownerClass.includes('applicationref')) return true;
    if (ownerClass.includes('changedetectorref')) return true;
    if (ownerClass.includes('injector')) return true;
    if (ownerClass.includes('platformref')) return true;
    
    // Filter RxJS internals
    if (label.includes('subscription')) return true;
    if (label.includes('subject') && !label.includes('user') && !label.includes('data')) return true;
    if (ownerClass.includes('rxjs') && !label.includes('custom')) return true;
    
    // Filter Angular core services
    if (ownerClass.includes('router') && label.includes('internal')) return true;
    if (ownerClass.includes('formsgroup') || ownerClass.includes('formscontrol')) return true;
    
    // Only show user-defined services and components
    return false;
  }

  private flowIcon(type: string): string {
    switch (type) {
      case 'signal-write': return '⚡';
      case 'subject-emit': return '📡';
      case 'http-response': return '🌐';
      case 'route-change': return '🧭';
      case 'store-dispatch': return '🏪';
      case 'store-select': return '📥';
      case 'facade-method': return '🏛️';
      default: return '•';
    }
  }

  private flowColor(type: string): string {
    switch (type) {
      case 'signal-write': return 'text-green-300';
      case 'subject-emit': return 'text-purple-300';
      case 'http-response': return 'text-cyan-300';
      case 'route-change': return 'text-amber-300';
      default: return 'text-gray-400';
    }
  }

  // ── Semantic labels, CD attribution, cause distribution, flow correlation ──

  /**
   * Classify what kind of interaction triggered an action so the chip can show
   * a precise icon + label (button click vs link click vs typed input vs page
   * navigation vs direct load, etc.). This is the single source of truth for
   * both getSemanticLabel() and getSafeActionIcon().
   */
  classifyInteraction(action: ActionReplay): { kind: InteractionKind; label: string } {
    const trigger = (action.trigger || '').trim();
    const t = trigger.toLowerCase();

    // ── 0. Direct page load always wins ──
    if (t === 'page load') return { kind: 'page-load', label: 'Page load' };

    // ── 1. Route / navigation (highest priority after page load) ──
    if (t.startsWith('navigation') || t.includes('route') || t.includes('navigate')) {
      const routeFlow = action.flowEntries.find(f => f.type === 'route-change');
      const dest = this.routeDestination(routeFlow);
      return { kind: 'navigation', label: dest ? `Navigate to ${dest}` : 'Navigation' };
    }

    // ── 2. PREFERRED PATH: classify from structured interaction metadata ──
    // This is captured at the DOM source and is far more accurate than parsing
    // the trigger/selector strings.
    const info = action.interactionInfo;
    if (info) {
      const name = this.cleanName(info.accessibleName);
      const et = info.eventType;

      // Changing a discrete control (select/checkbox/radio) — check before the
      // generic text-field typing branch since <select> also flags isTextField.
      if (et === 'change') {
        if (info.tag === 'select') return { kind: 'input', label: name ? `Select ${name}` : 'Select option' };
        if (info.inputType === 'checkbox') return { kind: 'button', label: name ? `Toggle ${name}` : 'Toggle checkbox' };
        if (info.inputType === 'radio') return { kind: 'button', label: name ? `Choose ${name}` : 'Choose option' };
        // A text field firing change (blur commit) still reads as typing.
        if (info.isTextField) return { kind: 'input', label: name ? `Edit ${name}` : `Edit ${this.fieldNoun(info)}` };
        return { kind: 'input', label: name ? `Change ${name}` : 'Change value' };
      }
      // Typing into a text field (input/keydown)
      if (info.isTextField && (et === 'input' || et === 'keydown')) {
        return { kind: 'input', label: name ? `Type in ${name}` : `Type in ${this.fieldNoun(info)}` };
      }
      // Link / anchor click → navigation-like
      if (info.isLink && (et === 'click' || et === 'pointerdown')) {
        return { kind: 'link', label: name ? `Click ${name} link` : 'Link click' };
      }
      // Button click (button tag, role=button, submit/button input, or ancestor button)
      if (info.isButton && (et === 'click' || et === 'pointerdown')) {
        if (info.inputType === 'submit') return { kind: 'button', label: name ? `Submit ${name}` : 'Submit form' };
        if (info.inputType === 'checkbox') return { kind: 'button', label: name ? `Toggle ${name}` : 'Toggle checkbox' };
        if (info.inputType === 'radio') return { kind: 'button', label: name ? `Choose ${name}` : 'Choose option' };
        return { kind: 'button', label: name ? `Click ${name}` : 'Button click' };
      }
      // Generic click on some other element
      if (et === 'click' || et === 'pointerdown') {
        return { kind: 'button', label: name ? `Click ${name}` : `Click ${this.tagNoun(info.tag)}` };
      }
      // Keydown that isn't in a field → a keyboard shortcut / key press
      if (et === 'keydown') {
        const key = info.key || this.extractKey(trigger);
        return { kind: 'keyboard', label: key ? `Press "${key}"` : 'Key press' };
      }
      // Any input event not caught above
      if (et === 'input') {
        return { kind: 'input', label: name ? `Type in ${name}` : 'Typing' };
      }
    }

    // ── 3. FALLBACK: no structured info — use trigger/selector strings ──
    const target = action.targetSelector || '';
    const targetName = this.describeTarget(target);

    if (t.includes('click') || t.includes('pointer') || t.includes('tap') || t.includes('mousedown')) {
      const el = this.classifyClickTarget(target);
      if (el === 'button') return { kind: 'button', label: targetName ? `Click ${targetName} button` : 'Button click' };
      if (el === 'link') return { kind: 'link', label: targetName ? `Click ${targetName} link` : 'Link click' };
      return { kind: 'button', label: targetName ? `Click ${targetName}` : 'Click' };
    }
    if (t.includes('keydown') || t.includes('keyup') || t.includes('keypress') || t.includes('keystroke')) {
      const key = this.extractKey(trigger);
      if (this.isTextField(target)) return { kind: 'input', label: targetName ? `Type in ${targetName}` : 'Typing' };
      return { kind: 'keyboard', label: key ? `Press "${key}"` : 'Key press' };
    }
    if (t.includes('input') || t.includes('change') || this.isTextField(target)) {
      return { kind: 'input', label: targetName ? `Type in ${targetName}` : 'Typing' };
    }

    // ── 4. Data-driven triggers inferred from flow entries ──
    const signalFlow = action.flowEntries.find(f => f.type === 'signal-write');
    if (signalFlow) {
      const name = signalFlow.label.replace('Signal: ', '').split('.').pop() || 'update';
      return { kind: 'signal', label: `Signal ${name}` };
    }
    const httpFlow = action.flowEntries.find(f => f.type === 'http-response');
    if (httpFlow) return { kind: 'api', label: `API ${this.shortenUrl(httpFlow.label)}` };

    // ── 5. Generic "Page activity" — describe by dominant flow type ──
    if (t === 'page activity' || trigger.length === 0) {
      const routeFlow = action.flowEntries.find(f => f.type === 'route-change');
      if (routeFlow) {
        const dest = this.routeDestination(routeFlow);
        return { kind: 'navigation', label: dest ? `Navigate to ${dest}` : 'Navigation' };
      }
      const types = new Set(action.flowEntries.map(f => f.type));
      if (types.has('http-response')) return { kind: 'api', label: 'Background API activity' };
      if (types.has('subject-emit')) return { kind: 'signal', label: 'Observable emission' };
      if (types.has('signal-write')) return { kind: 'signal', label: 'Signal update' };
      if (types.has('timer')) return { kind: 'timer', label: 'Timer tick' };
      return { kind: 'other', label: 'Page activity' };
    }

    // ── 6. Timer ──
    if (t.includes('timer') || t.includes('interval') || t.includes('timeout')) {
      return { kind: 'timer', label: 'Timer' };
    }

    // ── Fallback: use the raw trigger, appending target if we have one ──
    if (targetName) return { kind: 'other', label: `${trigger} on ${targetName}` };
    return { kind: 'other', label: trigger || 'Action' };
  }

  /** Quote and trim an accessible name for display; '' when nothing useful. */
  private cleanName(name: string | undefined): string {
    const n = (name || '').replace(/\s+/g, ' ').trim();
    if (!n) return '';
    const short = n.length > 26 ? n.slice(0, 26) + '…' : n;
    return `"${short}"`;
  }

  /** Human noun for a text field based on its input type. */
  private fieldNoun(info: InteractionInfo): string {
    switch (info.inputType) {
      case 'search': return 'search box';
      case 'email': return 'email field';
      case 'password': return 'password field';
      case 'number': return 'number field';
      case 'tel': return 'phone field';
      case 'url': return 'URL field';
      default:
        if (info.tag === 'textarea') return 'text area';
        if (info.tag === 'select') return 'dropdown';
        return 'field';
    }
  }

  /** Human noun for a clicked element by tag. */
  private tagNoun(tag: string): string {
    switch (tag) {
      case 'a': return 'link';
      case 'button': return 'button';
      case 'input': return 'control';
      case 'select': return 'dropdown';
      case 'label': return 'label';
      case 'li': return 'list item';
      case 'tr': return 'row';
      case 'td': return 'cell';
      case 'svg': case 'path': case 'i': return 'icon';
      case 'img': return 'image';
      default: return 'element';
    }
  }

  /** Semantic label for action chips — delegates to the interaction classifier. */
  getSemanticLabel(action: ActionReplay): string {
    return this.classifyInteraction(action).label;
  }

  /** Decide whether a click target is a button, a link, or a generic element. */
  private classifyClickTarget(selector: string): 'button' | 'link' | 'element' {
    if (!selector) return 'element';
    const s = selector.toLowerCase();
    // Anchor / link cues
    if (/\ba\b|\banchor\b|\[href|routerlink|\bnav-|\blink\b/.test(s)) return 'link';
    // Button cues (tag, role, common classes, submit inputs)
    if (/\bbutton\b|\bbtn\b|role="?button|\[type="?(submit|button)|mat-button|mat-raised|mat-icon-button/.test(s)) {
      return 'button';
    }
    // Inputs of clickable types
    if (/input\[type="?(checkbox|radio|submit|button)/.test(s)) return 'button';
    return 'element';
  }

  /** Is the target a text-entry field (input/textarea/select/contenteditable)? */
  private isTextField(selector: string): boolean {
    if (!selector) return false;
    const s = selector.toLowerCase();
    if (/\btextarea\b|\bselect\b|contenteditable|\[type="?(text|search|email|password|number|tel|url)/.test(s)) {
      return true;
    }
    // Bare input tag (no non-text type qualifier) counts as text field
    return /\binput\b/.test(s) && !/\[type="?(checkbox|radio|submit|button|file)/.test(s);
  }

  /**
   * Produce a short, human-friendly target name from a CSS selector.
   * Prefers a readable id/class/label over the raw selector; returns '' when
   * there is nothing meaningful to show (so the label reads cleanly).
   */
  private describeTarget(selector: string): string {
    if (!selector) return '';
    // Prefer an id (#save-btn → "save"), then a meaningful class (.submit-form → "submit form")
    const id = selector.match(/#([\w-]+)/);
    if (id) return `"${this.humanizeToken(id[1])}"`;
    const cls = selector.match(/\.([\w-]+)/);
    if (cls && !/^(ng-|cdk-|mat-|_)/.test(cls[1])) return `"${this.humanizeToken(cls[1])}"`;
    // aria-label / title attribute
    const aria = selector.match(/\[(?:aria-label|title)="([^"]+)"/);
    if (aria) return `"${aria[1].length > 24 ? aria[1].slice(0, 24) + '…' : aria[1]}"`;
    return '';
  }

  /** Turn a token like "save-user-btn" into "save user". */
  private humanizeToken(token: string): string {
    const cleaned = token
      .replace(/[-_]+/g, ' ')
      .replace(/\b(btn|button|link|el|elem|cmp|component)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const out = cleaned || token;
    return out.length > 24 ? out.slice(0, 24) + '…' : out;
  }

  /** Extract the pressed key from a trigger like: keydown event "a". */
  private extractKey(trigger: string): string {
    const m = trigger.match(/["']([^"']+)["']/);
    return m ? m[1] : '';
  }

  /** Pull a readable destination path from a route-change flow entry. */
  private routeDestination(routeFlow: FlowEntry | undefined): string {
    if (!routeFlow) return '';
    const raw = routeFlow.detail || routeFlow.label || '';
    // Try to find a URL-ish path
    const path = raw.match(/\/[\w\-/]+/);
    if (path) {
      let p = path[0].replace(/\/\d{5,}/g, '/…');
      if (p.length > 32) {
        const parts = p.split('/').filter(Boolean);
        p = parts.length > 2 ? `/${parts[0]}/…/${parts[parts.length - 1]}` : p.slice(0, 32) + '…';
      }
      return p;
    }
    return raw.length > 28 ? raw.slice(0, 28) + '…' : raw;
  }

  /** Component hover handler for bi-directional correlation */
  onComponentHovered(componentData: any | null): void {
    // Future: highlight corresponding flow entries in drawer
    // For now, just track for potential use
  }

  /** Cause distribution: breakdown of signal/zone/parent/input/manual percentages */
  getCauseDistribution(): Array<{ type: string; label: string; pct: number }> {
    const data = this.selectedComponentData();
    if (!data) return [];

    // Get all render events for this component in the selected action
    const action = this.getSelectedAction();
    if (!action) return [{ type: data.cause?.type || 'unknown', label: this.causeTypeLabel(data.cause?.type), pct: 100 }];

    const events = this.getActionEvents(action).filter(e => e.componentName === data.componentName);
    if (events.length === 0) return [{ type: data.cause?.type || 'unknown', label: this.causeTypeLabel(data.cause?.type), pct: 100 }];

    const counts: Record<string, number> = {};
    for (const e of events) {
      const type = e.causes[0]?.type || 'zone';
      counts[type] = (counts[type] || 0) + 1;
    }

    const total = Object.values(counts).reduce((s, c) => s + c, 0) || 1;
    return Object.entries(counts)
      .map(([type, count]) => ({ type, label: this.causeTypeLabel(type), pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.pct - a.pct);
  }

  private causeTypeLabel(type: string | undefined): string {
    const labels: Record<string, string> = {
      signal: 'Signal', zone: 'Zone/Async', parent: 'Parent', input: 'Input', 'manual-cd': 'Manual CD',
    };
    return labels[type || ''] || 'Unknown';
  }

  /** Render count severity class */
  getRenderCountClass(count: number): string {
    if (count >= 5) return 'color-critical';
    if (count >= 3) return 'color-warning';
    return '';
  }

  /** Duration severity class */
  getDurationClass(ms: number): string {
    if (ms > 50) return 'color-critical';
    if (ms > 16) return 'color-warning';
    return 'color-success';
  }

  /** CD attribution severity class. Null (no data) is neutral, not colored. */
  getCdMerClass(pct: number | null): string {
    if (pct == null) return '';
    if (pct < 25) return 'color-critical';
    if (pct < 60) return 'color-warning';
    return 'color-success';
  }

  /**
   * CD attribution ratio for the selected component, or null when there is no
   * change-detection data (no ngDoCheck observed). Returning null lets the UI
   * show "—" instead of a fabricated 100% — the old code defaulted to 100 when
   * cdCount was 0, which read as "perfectly efficient" despite meaning "no data".
   */
  getComponentCdMer(): number | null {
    const name = this.selectedComponentName();
    if (!name) return null;
    const stats = this.state.componentStats().find(s => this.displayName(s.componentName) === name);
    // cdCount === 0 means no ngDoCheck was observed → ratio is not defined.
    if (!stats || !stats.cdCount || stats.cdCount <= 0) return null;
    return stats.cdMer ?? null;
  }

  /** Tooltip explaining the CD attribution ratio truthfully. */
  readonly cdAttributionTooltip =
    'CD attribution — DOM-mutation passes ÷ ngDoCheck passes for this component. ' +
    'A rough ratio (the mutation count is a proxy for "produced a DOM change"), not an exact Angular measurement. ' +
    'Shown as — when no change-detection activity was observed.';

  /** Get template bindings count for selected component */
  getComponentBindings(): number | string {
    const name = this.selectedComponentName();
    if (!name) return '—';
    const stats = this.state.componentStats().find(s => this.displayName(s.componentName) === name);
    return stats?.totalTemplateBindings ?? '—';
  }

  /** Get output listeners count for selected component */
  getComponentListeners(): number | string {
    const name = this.selectedComponentName();
    if (!name) return '—';
    const stats = this.state.componentStats().find(s => this.displayName(s.componentName) === name);
    return stats?.totalOutputListeners ?? '—';
  }

  /** Get flow entries associated with the selected component */
  getSelectedComponentFlows(): FlowEntry[] {
    const action = this.getSelectedAction();
    const name = this.selectedComponentName();
    if (!action || !name) return [];

    // Match by ownerClass or subscribers mentioning this component
    return action.flowEntries.filter(f => {
      if (f.ownerClass && this.displayName(f.ownerClass) === name) return true;
      if (f.sourceComponent && this.displayName(f.sourceComponent) === name) return true;
      if (f.subscribers?.some(s => this.displayName(s) === name)) return true;
      return false;
    }).slice(0, 8);
  }

  // ── Diagnostics tab helpers (all backed by observed data) ──────────────────

  /**
   * Signals & state writes observed on the selected component/service class.
   * Real data: owning class + signal name + last written value. We match by
   * ownerClass (the class the signal property lives on), which is reliable —
   * unlike sourceComponent, which is only a last-interaction heuristic and is
   * intentionally NOT used here.
   */
  getComponentSignals(): Array<{ name: string; value: string; kind: 'signal' | 'computed' | 'input' }> {
    const action = this.getSelectedAction();
    const name = this.selectedComponentName();
    if (!action || !name) return [];

    const seen = new Set<string>();
    const out: Array<{ name: string; value: string; kind: 'signal' | 'computed' | 'input' }> = [];
    for (const f of action.flowEntries) {
      if (f.type !== 'signal-write') continue;
      if (!f.ownerClass || this.displayName(f.ownerClass) !== name) continue;
      const label = f.label ?? '';
      const kind: 'signal' | 'computed' | 'input' =
        label.includes('(computed)') ? 'computed' : label.includes('(input)') ? 'input' : 'signal';
      // Derive the property name from the label: "ClassName.propName.set()" → "propName".
      const cleaned = label.replace(/\s*\((computed|input)\)\s*/i, '').trim();
      const parts = cleaned.split('.');
      const propName = parts.length >= 2 ? parts[1].replace(/\(\)$/, '') : cleaned;
      const key = `${propName}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: propName, value: f.value ?? '—', kind });
    }
    return out.slice(0, 12);
  }

  /** High-frequency listeners (mousemove/scroll/etc.) observed on the component — real zone-pollution signal. */
  getComponentHighFreqListeners(): string[] {
    const name = this.selectedComponentName();
    if (!name) return [];
    const stats = this.state.componentStats().find(s => this.displayName(s.componentName) === name);
    return stats?.highFrequencyEvents ?? [];
  }

  /** Raw ngDoCheck cycle count for the selected component (real, from the ngDoCheck hook). */
  getComponentCdCycles(): number | string {
    const name = this.selectedComponentName();
    if (!name) return '—';
    const stats = this.state.componentStats().find(s => this.displayName(s.componentName) === name);
    return stats?.cdCount ?? '—';
  }

  /** Smart fix suggestion based on metrics */
  getSmartFix(m: any): string {
    if (!m) return '';
    const cdMer = this.getComponentCdMer();

    if (cdMer != null && cdMer < 25) {
      return `Low CD attribution (${cdMer.toFixed(1)}%) — many change-detection passes produced no DOM change. Consider ChangeDetectionStrategy.OnPush or memoizing expensive template expressions.`;
    }
    if (m.renderCount >= 6) {
      return `Excessive re-renders (${m.renderCount}×). Investigate why the component is marked dirty so often. Consider OnPush + signals for fine-grained reactivity.`;
    }
    if (m.totalDuration > 50) {
      return `Slow render cycle (${m.totalDuration}ms total). Reduce template complexity, defer heavy computations, or split into smaller components.`;
    }
    if (m.causeType === 'parent') {
      return `Rendered due to parent cascade. This component re-renders even when its own state hasn't changed. Add OnPush to opt out of unnecessary checks.`;
    }
    if (m.causeType === 'zone' && m.causeSource?.includes('scroll')) {
      return `Scroll events trigger re-renders via Zone.js. Use runOutsideAngular() or switch to Intersection Observer.`;
    }
    if (m.causeType === 'zone' && m.causeSource?.includes('timer')) {
      return `Timer triggers re-renders. Run timers outside Angular zone and manually trigger CD when UI state changes.`;
    }
    return 'Performance looks acceptable. No immediate optimization needed.';
  }

  /** Get a component file path (heuristic: derive from class name) */
  getComponentFilePath(name: string): string | null {
    if (!name) return null;
    // Convert PascalCase to kebab-case for file path heuristic
    const kebab = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/\s+component$/i, '');
    return `src/app/${kebab}/${kebab}.component.ts`;
  }

  /** Open file in VS Code via protocol handler */
  openInVSCode(filePath: string): void {
    const url = `vscode://file/${filePath}`;
    window.open(url, '_blank');
  }

  // ── Per-Component Diagnostics ─────────────────────────────────────────────

  getDiagnostics(action: ActionReplay): Array<{ component: string; severity: 'high' | 'medium'; problem: string; reason: string; fix: string }> {
    const diagnostics: Array<{ component: string; severity: 'high' | 'medium'; problem: string; reason: string; fix: string }> = [];

    for (const node of this.flattenTree(action.tree)) {
      // Skip components that only rendered once — that's normal
      if (node.count <= 2) continue;

      const cause = node.cause.type;
      const source = node.cause.source ?? '';

      // ── Excessive re-renders from parent cascade ──
      if (cause === 'parent' && node.count >= 3) {
        diagnostics.push({
          component: node.componentName,
          severity: node.count >= 5 ? 'high' : 'medium',
          problem: `rendered ${node.count}× from parent cascade`,
          reason: `This component re-renders every time its parent does, even if its own inputs haven't changed.`,
          fix: `Add changeDetection: ChangeDetectionStrategy.OnPush to this component. It will only re-render when its @Input() references change or a signal it reads is written.`,
        });
        continue;
      }

      // ── Multiple renders from timer/interval ──
      if ((source.includes('setTimeout') || source.includes('setInterval')) && node.count >= 3) {
        diagnostics.push({
          component: node.componentName,
          severity: node.count >= 5 ? 'high' : 'medium',
          problem: `rendered ${node.count}× from timers`,
          reason: `Each setTimeout/setInterval callback triggers a Zone.js change detection cycle that re-renders this component.`,
          fix: `Move timer logic to a service and run it outside Angular zone: this.ngZone.runOutsideAngular(() => setInterval(...)). Manually trigger CD only when UI needs updating.`,
        });
        continue;
      }

      // ── Multiple renders from HTTP/async ──
      if ((source.includes('fetch') || source.includes('XMLHttpRequest') || source.includes('Promise')) && node.count >= 3) {
        diagnostics.push({
          component: node.componentName,
          severity: 'medium',
          problem: `rendered ${node.count}× from async operations`,
          reason: `Multiple HTTP responses or Promise resolutions each triggered a separate change detection cycle.`,
          fix: `Batch API calls with forkJoin() or combineLatest(). Or use OnPush + a single signal/subject that updates once after all data arrives.`,
        });
        continue;
      }

      // ── Multiple renders from click/input events ──
      if (source.includes('addEventListener') && node.count >= 3) {
        diagnostics.push({
          component: node.componentName,
          severity: node.count >= 5 ? 'high' : 'medium',
          problem: `rendered ${node.count}× from DOM events`,
          reason: `Multiple event handlers (or event bubbling) are each triggering change detection on this component.`,
          fix: `Consider debouncing rapid events, or use OnPush so the component only re-renders when its state actually changes.`,
        });
        continue;
      }

      // ── Generic excessive render ──
      if (node.count >= 4) {
        diagnostics.push({
          component: node.componentName,
          severity: node.count >= 6 ? 'high' : 'medium',
          problem: `rendered ${node.count}× in one action`,
          reason: `This component re-renders too frequently. Each re-render recalculates the template, diffing the DOM unnecessarily.`,
          fix: `Use ChangeDetectionStrategy.OnPush, or convert state to signals so Angular only marks this component dirty when its actual dependencies change.`,
        });
      }
    }

    return diagnostics;
  }

  getSuggestion(action: ActionReplay): string | null {
    // Check for page-load-specific suggestion
    if ((action as any)._pageLoadSuggestion) {
      return (action as any)._pageLoadSuggestion;
    }
    if (action.totalRenders <= 2) return null;
    const topNode = action.tree[0];
    if (!topNode) return null;

    if (action.framesDropped > 3) {
      return `This action dropped ${action.framesDropped} frames (${action.duration.toFixed(0)}ms). Consider debouncing the trigger or reducing the number of re-rendered components.`;
    }
    if (action.tree.some(n => n.children.length > 3)) {
      return `Multiple children re-rendered from a parent cascade. Consider adding OnPush change detection to child components that don't need to re-render.`;
    }
    if (action.totalRenders > 8) {
      return `${action.totalRenders} renders from one action is high. Check if all components actually need to update, or if some are cascading unnecessarily.`;
    }
    return null;
  }

  /** Pick the richest interaction metadata from a group of render events. */
  private pickInteractionInfo(events: RenderEvent[]): InteractionInfo | undefined {
    // Prefer the depth-0 event that carries structured info; fall back to any.
    const withInfo = events.find(e => e.interactionInfo && (e.depth ?? 0) === 0)
      ?? events.find(e => e.interactionInfo);
    return withInfo?.interactionInfo;
  }

  private detectTrigger(events: RenderEvent[]): string {
    // Check flow events for route-change first (highest priority for navigation)
    const allFlow = this.state.flowEvents();
    const startTs = events[0]?.timestamp ?? 0;
    const endTs = events[events.length - 1]?.timestamp ?? startTs;
    const routeFlow = allFlow.find(f => 
      f.type === 'route-change' && 
      f.timestamp >= startTs - 500 && f.timestamp <= endTs + 500
    );
    if (routeFlow) {
      const detail = routeFlow.detail ?? routeFlow.label ?? '';
      // Show the route path if available
      if (detail.includes('→')) return `navigation ${detail}`;
      return 'navigation';
    }

    // Use interaction data if available
    const interaction = events.find(e => e.interactionComponent);
    if (interaction?.causes[0]?.source) {
      const src = interaction.causes[0].source;
      if (src.startsWith('addEventListener:')) {
        return src.replace('addEventListener:', '') + ' event';
      }
      return this.formatCauseSource(interaction.causes[0]);
    }
    // If there's an interaction component but no clear source, it's still a click
    if (interaction) return 'click event';

    // Detect navigation: many components re-rendering with parent cascade = route change
    const uniqueComponents = new Set(events.map(e => e.componentName)).size;
    if (uniqueComponents >= 5) return 'navigation';

    // Fall back to most common cause source (skip parent-cascade noise)
    const sources = new Map<string, number>();
    for (const e of events) {
      const c = e.causes[0];
      if (!c || c.type === 'parent') continue; // parent cascade isn't a trigger
      const s = c.source ?? c.type;
      if (s !== 'unknown') sources.set(s, (sources.get(s) ?? 0) + 1);
    }
    if (sources.size === 0) return 'Page activity';
    const top = Array.from(sources.entries()).sort((a, b) => b[1] - a[1])[0][0];
    return this.formatCauseSource({ type: 'zone', source: top });
  }

  private detectIcon(events: RenderEvent[]): string {
    const interaction = events.find(e => e.interactionComponent);
    const src = interaction?.causes[0]?.source ?? events[0]?.causes[0]?.source ?? '';
    if (src.includes('click')) return '🖱️';
    if (src.includes('input') || src.includes('key')) return '⌨️';
    if (src.includes('scroll')) return '📜';
    if (src.includes('fetch') || src.includes('XMLHttpRequest')) return '🌐';
    if (src.includes('setTimeout') || src.includes('setInterval')) return '⏱️';
    if (src.includes('Promise')) return '⚡';
    if (src.includes('navigation') || src.includes('route')) return '🧭';
    // Many components re-rendering = likely navigation
    if (new Set(events.map(e => e.componentName)).size >= 5) return '🧭';
    return '▸';
  }

  // ── ENHANCED CASCADE TREE HELPERS ──────────────────────────────────────────

  /** Helper to get cause badge text for cascade rows */
  getCauseBadgeText(cause: { type: string; source?: string }): string {
    switch (cause.type) {
      case 'signal': return '⚡ Signal';
      case 'zone': return '⚠️ Zone';
      case 'parent': return '⬆️ Parent';
      case 'input': return '📥 Input';
      case 'manual-cd': return '🔧 Manual';
      default: return '• Unknown';
    }
  }

  /** Expand all cascade children (shows all 10+ children) */
  expandCascadeAll(): void {
    // This would toggle a signal to show all children instead of slice:0:10
    // For now, just a stub that developers can extend
    console.log('Cascade expansion toggled');
  }
}

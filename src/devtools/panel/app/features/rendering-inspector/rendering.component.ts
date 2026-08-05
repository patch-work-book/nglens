import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NgClass, TitleCasePipe } from '@angular/common';
import { PanelState } from '../../state/panel.state';
import { displayName } from '../../utils/display-name';
import { CommandService } from '../../services/command.service';
import { TooltipDirective } from '../../shared/tooltip.directive';
import type { InteractionProfile } from '../../../../../types/panel';
import type { RenderCause, RenderEvent, FlowEvent, RenderReason } from '../../../../../types/render-events';

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
}

@Component({
  selector: 'app-rendering',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  templateUrl: './rendering.component.html',
  styleUrl: './rendering.component.scss',
})
export class RenderingComponent {
  readonly state = inject(PanelState);
  readonly displayName = displayName;
  readonly Math = Math;
  private readonly commandService = inject(CommandService);

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
          const prevReplayCount = this.stableActionReplays().length;
          this.stableActionReplays.set(newReplays);
          
          // Auto-select the latest action ONLY on first load (when no action was previously selected)
          // After that, user selection is preserved even as new actions arrive
          if (newReplays.length > 0 && prevReplayCount === 0 && this.selectedActionId() === null) {
            const latestActionId = newReplays[newReplays.length - 1].id;
            this.selectedActionId.set(latestActionId);
          }
        }, 600);
      }
    }, 300);
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

  // Card stability: cache previous cards to prevent flickering
  private cachedCards: ActionReplay[] = [];
  private lastCardCount = 0;
  private cardRebuildTimer: any = null;
  private lastEventCount = 0;
  private hasAutoSelectedOnce = false;

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
    const SAME_CYCLE_MS = 50;
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
    const next = new Set(this.collapsedActions());
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    this.collapsedActions.set(next);
  }

  selectAction(id: string | null): void {
    this.selectedActionId.set(this.selectedActionId() === id ? null : id);
  }

  getPerformanceScore(duration: number): number {
    return Math.max(0, Math.min(100, 100 - duration / 5));
  }

  getSelectedAction = computed(() => {
    const selected = this.selectedActionId();
    if (!selected) return null;
    return this.stableActionReplays().find(a => a.id === selected) ?? null;
  });

  toggleFlowDetails(entryId: string): void {
    const next = new Set(this.expandedFlows());
    if (next.has(entryId)) { next.delete(entryId); } else { next.add(entryId); }
    this.expandedFlows.set(next);
  }

  toggleDataFlow(actionId: string): void {
    const next = new Set(this.expandedDataFlow());
    if (next.has(actionId)) { next.delete(actionId); } else { next.add(actionId); }
    this.expandedDataFlow.set(next);
  }

  toggleFlowType(flowType: string): void {
    const next = new Set(this.expandedFlowTypes());
    if (next.has(flowType)) { next.delete(flowType); } else { next.add(flowType); }
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
    switch (type) {
      case 'subject-emit': return 'RxJS Subjects';
      case 'signal-write': return 'Signals';
      case 'http-response': return 'HTTP Services';
      case 'websocket': return 'WebSocket';
      case 'facade-method': return 'State Management (Facade)';
      case 'store-dispatch': return 'Store Dispatch (NgRx)';
      case 'store-select': return 'Store Selectors (NgRx)';
      default: return type;
    }
  }

  /** Get color class for flow type */
  flowTypeColor(type: string): string {
    switch (type) {
      case 'subject-emit': return 'border-purple-500/40 bg-purple-900/20 text-purple-300';
      case 'signal-write': return 'border-green-500/40 bg-green-900/20 text-green-300';
      case 'http-response': return 'border-cyan-500/40 bg-cyan-900/20 text-cyan-300';
      case 'websocket': return 'border-indigo-500/40 bg-indigo-900/20 text-indigo-300';
      case 'facade-method': return 'border-orange-500/40 bg-orange-900/20 text-orange-300';
      case 'store-dispatch': return 'border-red-500/40 bg-red-900/20 text-red-300';
      case 'store-select': return 'border-pink-500/40 bg-pink-900/20 text-pink-300';
      default: return 'border-gray-500/40 bg-gray-900/20 text-gray-300';
    }
  }

  /** Get icon for flow type */
  flowTypeIcon(type: string): string {
    switch (type) {
      case 'subject-emit': return '📡';
      case 'signal-write': return '⚡';
      case 'http-response': return '🌐';
      case 'websocket': return '🔗';
      case 'facade-method': return '🏛️';
      case 'store-dispatch': return '📤';
      case 'store-select': return '📥';
      default: return '•';
    }
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
    
    if (componentEvents.length === 0) return [];

    // Merge all reasons from this component's render events
    const reasonsMap = new Map<string, RenderReason>();
    
    for (const event of componentEvents) {
      if (!event.reasons) continue;
      
      for (const reason of event.reasons) {
        const key = `${reason.type}:${reason.source}`;
        const existing = reasonsMap.get(key);
        
        if (existing) {
          existing.count += reason.count;
          // Keep the most recent value
          if (reason.after !== undefined) existing.after = reason.after;
        } else {
          reasonsMap.set(key, { ...reason });
        }
      }
    }
    
    return Array.from(reasonsMap.values()).sort((a, b) => b.count - a.count);
  }

  /** Get reason type icon and color */
  getReasonIcon(type: string): { icon: string; class: string } {
    const icons: Record<string, { icon: string; class: string }> = {
      'signal': { icon: '⚡', class: 'reason-signal' },
      'input': { icon: '📥', class: 'reason-input' },
      'parent': { icon: '👨‍👧', class: 'reason-parent' },
      'zone': { icon: '⏱️', class: 'reason-zone' },
      'api': { icon: '🌐', class: 'reason-api' },
      'route': { icon: '🛣️', class: 'reason-route' },
    };
    return icons[type] || { icon: '❓', class: 'reason-default' };
  }

  /** Toggle component render reasons expansion */
  toggleComponentReasons(componentName: string): void {
    const current = this.expandedComponentReasons();
    this.expandedComponentReasons.set(current === componentName ? null : componentName);
  }

  /** Check if a component's render reasons are expanded */
  isComponentReasonsExpanded(componentName: string): boolean {
    return this.expandedComponentReasons() === componentName;
  }

  formatCauseSource(cause: RenderCause): string {
    const src = cause.source ?? cause.type;
    if (cause.type === 'parent') {
      return src ? `by ${displayName(src)}` : 'parent cascade';
    }
    if (src.startsWith('addEventListener:')) return src.replace('addEventListener:', '') + ' event';
    if (src === 'setTimeout') return 'timer';
    if (src === 'setInterval') return 'interval';
    if (src === 'fetch' || src === 'XMLHttpRequest') return 'HTTP response';
    if (src === 'Promise.then') return 'async';
    return src;
  }

  causePillClass(type: RenderCause['type'] | 'unknown'): string {
    switch (type) {
      case 'zone': return 'bg-blue-900/60 text-blue-300';
      case 'signal': return 'bg-green-900/60 text-green-300';
      case 'input': return 'bg-cyan-900/60 text-cyan-300';
      case 'parent': return 'bg-purple-900/60 text-purple-300';
      case 'manual-cd': return 'bg-amber-900/60 text-amber-300';
      default: return 'bg-gray-700 text-gray-400';
    }
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
  sumRenders = (total: number, node: CascadeNode): number => total + node.count;

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
      return f.timestamp >= profile.startTime - 100 && f.timestamp <= profile.endTime + 2000;
    });
    const interaction = events.find(e => e.interactionComponent);
    const duration = profile.duration;
    return {
      id: profile.id,
      trigger: this.detectTrigger(events),
      triggerIcon: this.detectIcon(events),
      targetSelector: interaction?.interactionTarget ?? null,
      triggerComponent: interaction?.interactionComponent ?? null,
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
        prev && prevInteraction && !groupInteraction && timeSincePrev < 2000;

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
        // Fallback: time proximity for flow events without interaction stamp
        return f.timestamp >= startTs - 100 && f.timestamp <= endTs + 2000;
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
    // Build tree using the depth and parentComponent from instrumentation
    // Skip minified names (1-2 char) — they're not useful to developers
    const filteredEvents = events.filter(e => e.componentName.length > 2);
    const nodeMap = new Map<string, CascadeNode>();
    // Definitive parent per component (first non-null parent wins, ignoring self-parent)
    const parentOf = new Map<string, string>();
    // Track last counted render timestamp per component to coalesce a single
    // mount/CD cycle (Angular emits several DOM mutations for one render).
    const lastCountedTs = new Map<string, number>();
    const SAME_CYCLE_MS = 50;

    for (const event of filteredEvents) {
      const existing = nodeMap.get(event.componentName);
      const lastTs = lastCountedTs.get(event.componentName);
      // Only count as a distinct render if it's outside the same-cycle window
      const isDistinctRender = lastTs == null || (event.timestamp - lastTs) >= SAME_CYCLE_MS;

      if (existing) {
        if (isDistinctRender) {
          existing.count++;
          lastCountedTs.set(event.componentName, event.timestamp);
        }
        existing.totalDuration += event.duration;
      } else {
        nodeMap.set(event.componentName, {
          componentName: event.componentName,
          count: 1,
          totalDuration: event.duration,
          cause: event.causes[0] ?? { type: 'zone', source: 'unknown' },
          depth: event.depth ?? 0,
          children: [],
        });
        lastCountedTs.set(event.componentName, event.timestamp);
      }

      // Record a stable parent for this component (skip self-reference)
      const p = event.parentComponent;
      if (p && p !== event.componentName && !parentOf.has(event.componentName)) {
        parentOf.set(event.componentName, p);
      }
    }

    // Build parent→child relationships using the definitive parent map.
    // A node is a root if it has no parent in this action's node set.
    const roots: CascadeNode[] = [];
    for (const [name, node] of nodeMap) {
      const parentName = parentOf.get(name);
      // Guard against parent pointing to a node not in this set, or a cycle
      if (parentName && nodeMap.has(parentName) && !this.wouldCycle(name, parentName, parentOf)) {
        const parent = nodeMap.get(parentName)!;
        if (!parent.children.includes(node)) {
          parent.children.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Sort children by duration (most expensive first)
    const sortTree = (nodes: CascadeNode[]): void => {
      nodes.sort((a, b) => b.totalDuration - a.totalDuration);
      for (const n of nodes) sortTree(n.children);
    };
    sortTree(roots);

    return roots;
  }

  /** Detect whether linking child→parent would create a cycle. */
  private wouldCycle(child: string, parent: string, parentOf: Map<string, string>): boolean {
    let current: string | undefined = parent;
    const visited = new Set<string>();
    while (current) {
      if (current === child) return true;
      if (visited.has(current)) return true;
      visited.add(current);
      current = parentOf.get(current);
    }
    return false;
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
}

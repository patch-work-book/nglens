// src/instrumentation/render-tracker.ts
// Deep instrumentation: captures user interactions, builds parent→child cascade,
// filters Angular internals, and properly attributes causes.

import type { RenderEvent, RenderCause, EventBatch } from '../types/render-events';

const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

// ═══ Performance Safeguards ══════════════════════════════════════════════════

/** Max elements to scan during component discovery (covers large enterprise apps). */
const MAX_DISCOVERY_ELEMENTS = 5000;
/** Max components to process per frame — prevents jank on heavy DOM pages. */
const MAX_PENDING_PER_FRAME = 50;
/** Minimum ms between mutation processing — throttles on rapid DOM churn (32ms = 2 frames). */
const MIN_PROCESS_INTERVAL_MS = 32;
/** Max events kept in buffer before oldest are dropped. */
const MAX_EVENT_BUFFER = 500;

/** Third-party library component prefixes — collapsed into group entries. */
const THIRD_PARTY_PREFIXES = [
  'Ag', 'Mat', 'Cdk', 'Nz', 'Ion', 'Tui', 'Clr', 'Nb', 'Ngb',
  'P-', 'p-',  // PrimeNG
];

function isThirdPartyComponent(name: string): string | null {
  for (const prefix of THIRD_PARTY_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length + 2) {
      return prefix; // Return the library prefix for grouping
    }
  }
  return null;
}

/** Angular internal names that should never appear in user-facing render data. */
const INTERNAL_NAMES = new Set([
  'LContext', 'LView', 'TView', 'TNode', 'RNode', 'RElement',
  'ViewRef', 'TemplateRef', 'EmbeddedViewRef', 'ComponentRef',
  'NgModule', 'Injector', 'EnvironmentInjector', 'NodeInjector',
  'R3Injector', 'NullInjector', 'ChainedInjector',
  'Object', 'Function', 'Array',
]);

function isInternalName(name: string): boolean {
  if (!name || name.length === 0) return true;
  if (INTERNAL_NAMES.has(name)) return true;
  if (name.startsWith('ɵ') || name.startsWith('Ɵ') || name.startsWith('__')) return true;
  // Names that look like Angular internals
  if (name.includes('Context') && !name.includes('Component')) return true;
  return false;
}

/** Describes a captured user interaction (click, keydown, input). */
interface CapturedInteraction {
  type: string;           // 'click' | 'input' | 'keydown' | 'scroll'
  targetSelector: string; // e.g. 'button.dropdown-toggle'
  ownerComponent: string; // component that owns the target element
  timestamp: number;
}

export class RenderTracker {
  private static instance: RenderTracker | null = null;

  private readonly eventBuffer: RenderEvent[] = [];
  private isRunning = false;
  private batchSequence = 0;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private mutationObserver: MutationObserver | null = null;

  // User interaction tracking
  private lastInteraction: CapturedInteraction | null = null;
  private interactionTimeout: ReturnType<typeof setTimeout> | null = null;

  // Zone.js cause stack
  private readonly zoneCauseStack: RenderCause[] = [];
  private zoneCauseCleared = false;
  private originalZoneScheduleTask: any = null;
  private zoneDelegate: any = null;

  // Component registry: element → component name
  private readonly componentElements = new Map<Element, string>();
  // Pending mutations per frame
  private readonly pendingElements = new Map<Element, string>(); // element → component name
  private frameRequestId: number | null = null;
  private mutationStartTime: number | null = null;

  // Discovery
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private rootComponentElement: Element | null = null;
  
  // Initial discovery timeouts
  private initialDiscoveryTimeouts: ReturnType<typeof setTimeout>[] = [];

  private constructor() {}

  static getInstance(): RenderTracker {
    if (!RenderTracker.instance) {
      RenderTracker.instance = new RenderTracker();
    }
    return RenderTracker.instance;
  }

  start(): void {
    if (this.isRunning) return;

    this.detectRootComponent();
    this.discoverComponents();
    this.setupInteractionListener();
    this.setupMutationObserver();
    this.hookZoneJs();
    this.startBatching();
    this.startComponentDiscovery();
    this.isRunning = true;

    // Expose reference for FlowTracker to read lastInteraction
    (globalThis as any).__nglens_render_tracker_ref = this;

    // Aggressive discovery during first 3 seconds (page load components mounting)
    this.initialDiscoveryTimeouts.push(setTimeout(() => this.discoverComponents(), 200));
    this.initialDiscoveryTimeouts.push(setTimeout(() => this.discoverComponents(), 500));
    this.initialDiscoveryTimeouts.push(setTimeout(() => this.discoverComponents(), 1000));
    this.initialDiscoveryTimeouts.push(setTimeout(() => this.discoverComponents(), 2000));
  }

  stop(): void {
    if (!this.isRunning) return;
    this.flush();
    this.teardownInteractionListener();
    if (this.mutationObserver) { this.mutationObserver.disconnect(); this.mutationObserver = null; }
    this.stopBatching();
    this.stopComponentDiscovery();
    this.clearInitialDiscoveryTimeouts();
    this.cancelPendingFrame();
    this.unhookZoneJs();
    this.componentElements.clear();
    this.pendingElements.clear();
    this.rootComponentElement = null;
    this.lastInteraction = null;
    this.isRunning = false;
  }

  // CD-MER metrics counts
  private readonly componentCdCounts = new Map<string, number>();
  private readonly componentMutationCounts = new Map<string, number>();

  private hookComponentChangeDetection(ctorOrInstance: any, name: string): void {
    if (!ctorOrInstance) return;
    const proto = typeof ctorOrInstance === 'function' ? ctorOrInstance.prototype : ctorOrInstance.constructor?.prototype;
    if (!proto || proto.__nglens_cd_hooked__) return;

    proto.__nglens_cd_hooked__ = true;
    const originalDoCheck = proto.ngDoCheck;
    const tracker = this;

    proto.ngDoCheck = function (this: any, ...args: any[]) {
      if (tracker.isRunning) {
        tracker.incrementCdCount(name);
      }
      if (originalDoCheck) {
        return originalDoCheck.apply(this, args);
      }
    };
  }

  private incrementCdCount(name: string): void {
    this.componentCdCounts.set(name, (this.componentCdCounts.get(name) ?? 0) + 1);
  }

  private incrementMutationCount(name: string): void {
    this.componentMutationCounts.set(name, (this.componentMutationCounts.get(name) ?? 0) + 1);
  }

  getCdCount(name: string): number {
    return this.componentCdCounts.get(name) ?? 0;
  }

  getMutationCount(name: string): number {
    return this.componentMutationCounts.get(name) ?? 0;
  }

  getCdMer(name: string): number {
    const cd = this.getCdCount(name);
    const mut = this.getMutationCount(name);
    return cd > 0 ? (mut / cd) * 100 : 100;
  }

  getBuffer(): RenderEvent[] { return this.eventBuffer; }
  clearBuffer(): RenderEvent[] {
    this.componentCdCounts.clear();
    this.componentMutationCounts.clear();
    return this.eventBuffer.splice(0);
  }
  getIsRunning(): boolean { return this.isRunning; }

  // ═══ User Interaction Capture ═══════════════════════════════════════════════

  private interactionConsumed = false;
  private noRenderTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly onInteraction = (event: Event): void => {
    const target = event.target as Element | null;
    if (!target) return;

    const ownerComponent = this.findOwnerComponent(target);
    if (!ownerComponent || isInternalName(ownerComponent)) return;

    this.lastInteraction = {
      type: event.type,
      targetSelector: this.buildSelector(target),
      ownerComponent,
      timestamp: performance.now(),
    };
    this.interactionConsumed = false;

    // Keep interaction context alive for 300ms (covers the CD cycle that follows)
    if (this.interactionTimeout) clearTimeout(this.interactionTimeout);
    this.interactionTimeout = setTimeout(() => { this.lastInteraction = null; }, 300);

    // Check if this interaction produced any renders — if not, emit a "no-render" event
    if (this.noRenderTimeout) clearTimeout(this.noRenderTimeout);
    this.noRenderTimeout = setTimeout(() => {
      if (!this.interactionConsumed && this.isRunning) {
        this.eventBuffer.push({
          componentName: ownerComponent,
          timestamp: Date.now(),
          duration: 0,
          causes: [{ type: 'zone', source: `addEventListener:${event.type}` }],
          interactionComponent: ownerComponent,
          interactionTarget: this.buildSelector(target),
          parentComponent: null,
          depth: 0,
        });
      }
    }, 350);
  };

  private setupInteractionListener(): void {
    // Capture phase to get the event before Angular handles it
    document.addEventListener('click', this.onInteraction, true);
    document.addEventListener('input', this.onInteraction, true);
    document.addEventListener('keydown', this.onInteraction, true);
  }

  private teardownInteractionListener(): void {
    document.removeEventListener('click', this.onInteraction, true);
    document.removeEventListener('input', this.onInteraction, true);
    document.removeEventListener('keydown', this.onInteraction, true);
    if (this.interactionTimeout) { clearTimeout(this.interactionTimeout); this.interactionTimeout = null; }
    if (this.noRenderTimeout) { clearTimeout(this.noRenderTimeout); this.noRenderTimeout = null; }
  }

  private clearInitialDiscoveryTimeouts(): void {
    for (const timeoutId of this.initialDiscoveryTimeouts) {
      clearTimeout(timeoutId);
    }
    this.initialDiscoveryTimeouts = [];
  }

  private buildSelector(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const id = el.id ? `#${el.id}` : '';
    return `${tag}${id}${cls}`.slice(0, 60);
  }

  // ═══ Root & Component Discovery ═════════════════════════════════════════════

  private detectRootComponent(): void {
    this.rootComponentElement = document.querySelector('[ng-version]');
  }

  private startComponentDiscovery(): void {
    this.discoveryInterval = globalThis.setInterval(() => this.discoverComponents(), 3000);
  }

  private stopComponentDiscovery(): void {
    if (this.discoveryInterval !== null) { clearInterval(this.discoveryInterval); this.discoveryInterval = null; }
  }

  private cancelPendingFrame(): void {
    if (this.frameRequestId !== null) { cancelAnimationFrame(this.frameRequestId); this.frameRequestId = null; }
  }

  private discoverComponents(): void {
    const ng = (globalThis as any).ng;
    const hasDevApi = !!ng?.getComponent;
    const allElements = document.querySelectorAll('*');
    const limit = Math.min(allElements.length, MAX_DISCOVERY_ELEMENTS);

    for (let i = 0; i < limit; i++) {
      const el = allElements[i];
      if (this.componentElements.has(el)) continue;

      if (hasDevApi) {
        try {
          const component = ng.getComponent(el);
          if (component) {
            const name = this.resolveComponentName(component, el);
            if (name && !isInternalName(name)) {
              this.componentElements.set(el, name);
              this.hookComponentChangeDetection(component, name);
            }
            continue;
          }
        } catch { /* not a component */ }
      }

      // Production fallback via __ngContext__
      this.tryDiscoverViaLView(el);
    }
  }

  /**
   * Try to discover a single element as a component (used for newly-added DOM nodes).
   */
  private tryDiscoverElement(el: Element): void {
    if (this.componentElements.has(el)) return;
    const ng = (globalThis as any).ng;
    if (ng?.getComponent) {
      try {
        const component = ng.getComponent(el);
        if (component) {
          const name = this.resolveComponentName(component, el);
          if (name && !isInternalName(name)) {
            this.componentElements.set(el, name);
            this.hookComponentChangeDetection(component, name);
          }
          return;
        }
      } catch { /* not a component */ }
    }
    this.tryDiscoverViaLView(el);
  }

  /**
   * Resolves a meaningful component name. Prefers constructor.name if it's not
   * minified (>2 chars). Falls back to deriving from element tag name.
   */
  private resolveComponentName(component: any, el: Element): string {
    const ctorName = component.constructor?.name ?? '';
    // If constructor name looks valid (not minified), use it
    if (ctorName.length > 2 && !isInternalName(ctorName)) {
      return ctorName;
    }
    // Fallback: derive from element's tag name (e.g. app-sidebar-nav → AppSidebarNav)
    return this.nameFromTagName(el);
  }

  /**
   * Converts element tag name to PascalCase component name.
   * e.g. "app-sidebar-nav" → "AppSidebarNav"
   * Returns empty string for standard HTML elements (no hyphen = not a custom element).
   */
  private nameFromTagName(el: Element): string {
    const tag = el.tagName.toLowerCase();
    // Only custom elements (with hyphen) are Angular component hosts
    if (tag.includes('-')) {
      return tag
        .split('-')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    }
    // Standard HTML elements (div, button, span, etc.) are NOT components
    return '';
  }

  private tryDiscoverViaLView(el: Element): void {
    try {
      const ngCtx = (el as any).__ngContext__;
      if (!ngCtx) return;
      // Angular 20+: __ngContext__ can be a number (LView index) — skip
      if (typeof ngCtx === 'number') return;

      let name: string | null = null;
      let ctor: any = null;
      if (Array.isArray(ngCtx)) {
        // LView array — tView is at index 1, type holds the component constructor
        const tView = ngCtx[1];
        if (tView?.type && typeof tView.type === 'function') {
          ctor = tView.type;
          const typeName = tView.type.name ?? null;
          // Only accept names that look like components (>2 chars, not minified)
          if (typeName && typeName.length > 2) {
            name = typeName;
          }
        }
      }

      // If no valid name from LView, fall back to tag name
      if (!name || name.length <= 2) {
        name = this.nameFromTagName(el);
      }

      if (name && !isInternalName(name)) {
        this.componentElements.set(el, name);
        if (ctor) {
          this.hookComponentChangeDetection(ctor, name);
        }
      }
    } catch { /* ignore */ }
  }

  // ═══ MutationObserver ═══════════════════════════════════════════════════════

  private lastProcessTime = 0;

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.isRunning) return;
      if (this.mutationStartTime === null) {
        this.mutationStartTime = performance.now();
      }

      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (!target) continue;

        // Skip mutations inside <canvas> parents — canvas rendering is not DOM-observable
        if (target.closest('canvas') || target.tagName === 'CANVAS') continue;

        // Discover new components from added nodes (catches lazy-loaded/dynamic components)
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node instanceof Element) {
              this.tryDiscoverElement(node);
              // Also check children — Angular inserts component trees as one DOM operation
              const children = node.querySelectorAll('*');
              const childLimit = Math.min(children.length, 200);
              for (let ci = 0; ci < childLimit; ci++) {
                this.tryDiscoverElement(children[ci]);
              }
            }
          }
        }

        // Find the component host element that owns this mutation
        const entry = this.findOwnerEntry(target);
        if (entry && !this.isRootElement(entry.element)) {
          this.pendingElements.set(entry.element, entry.name);
        }
      }

      // Throttle: don't process more often than MIN_PROCESS_INTERVAL_MS
      const now = performance.now();
      if (this.pendingElements.size > 0 && this.frameRequestId === null) {
        const timeSinceLastProcess = now - this.lastProcessTime;
        if (timeSinceLastProcess >= MIN_PROCESS_INTERVAL_MS) {
          this.frameRequestId = requestAnimationFrame(() => {
            this.processPendingMutations();
            this.frameRequestId = null;
          });
        } else {
          // Schedule after the throttle window
          this.frameRequestId = requestAnimationFrame(() => {
            this.frameRequestId = requestAnimationFrame(() => {
              this.processPendingMutations();
              this.frameRequestId = null;
            });
          });
        }
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
  }

  // ═══ Mutation Processing — builds parent→child hierarchy ════════════════════

  private processPendingMutations(): void {
    this.lastProcessTime = performance.now();
    this.interactionConsumed = true; // This interaction produced renders
    const endTime = this.lastProcessTime;
    const startTime = this.mutationStartTime ?? endTime;
    // Cap frame duration at 32ms — anything longer is a measurement artifact
    // (stale mutationStartTime from throttle delay, tab background, etc.)
    const rawDuration = endTime - startTime;
    const frameDuration = Math.min(rawDuration, 32);

    // ── Safeguard: cap pending elements to prevent jank on heavy DOMs ──
    let elements = Array.from(this.pendingElements.entries());

    if (elements.length > MAX_PENDING_PER_FRAME) {
      // Collapse third-party library components into group entries
      const userComponents: [Element, string][] = [];
      const thirdPartyGroups = new Map<string, number>(); // prefix → count

      for (const [el, name] of elements) {
        const lib = isThirdPartyComponent(name);
        if (lib) {
          thirdPartyGroups.set(lib, (thirdPartyGroups.get(lib) ?? 0) + 1);
        } else {
          userComponents.push([el, name]);
        }
      }

      // Keep user components (up to cap), add summary entries for libraries
      elements = userComponents.slice(0, MAX_PENDING_PER_FRAME);

      // Emit one summary event per library group
      for (const [prefix, count] of thirdPartyGroups) {
        this.eventBuffer.push({
          componentName: `[${prefix}* library] ×${count}`,
          timestamp: endTime,
          duration: 0,
          causes: [{ type: 'parent', source: 'third-party library' }],
          depth: 1,
        });
      }
    }

    const componentCount = elements.length;
    const perComponentDuration = componentCount > 0 ? frameDuration / componentCount : 0;

    // Determine the cause — interaction events take priority over zone tasks
    const interaction = this.lastInteraction;
    const zoneCause: RenderCause = this.zoneCauseStack.length > 0
      ? this.zoneCauseStack[this.zoneCauseStack.length - 1]
      : { type: 'zone', source: 'unknown' };

    const primaryCause: RenderCause = interaction
      ? { type: 'zone', source: `addEventListener:${interaction.type}` }
      : zoneCause;

    // Build parent→child hierarchy
    const hierarchy = this.buildHierarchy(elements);

    for (const node of hierarchy) {
      this.incrementMutationCount(node.name);

      // Safe Extraction of Template Ivy Metrics on the main thread
      let totalBindings = 0;
      let totalListeners = 0;
      let hasHiFreqZonePollution = false;
      let hiFreqEvents: string[] = [];

      try {
        const ng = (globalThis as any).ng;
        if (ng && node.element) {
          const componentInstance = ng.getComponent(node.element);
          if (componentInstance) {
            const lViews = ng.getInternalComponents?.(node.element) || [];
            const lView = lViews[0] || (node.element as any).__ngContext__;
            const tView = lView ? lView[1] : null;

            if (tView) {
              totalBindings = tView.bindingStartIndex ? (lView.length - tView.bindingStartIndex) : 0;
              const nativeListeners = ng.getListeners?.(node.element) || [];
              totalListeners = nativeListeners.length;
              const hf = nativeListeners.filter((l: any) => 
                ['mousemove', 'scroll', 'pointermove', 'wheel'].includes(l.name)
              );
              hasHiFreqZonePollution = hf.length > 0;
              hiFreqEvents = hf.map((t: any) => t.name);
            }
          }
        }
      } catch { /* ignore parsing errors during runtime render passes */ }

      const event: RenderEvent = {
        componentName: node.name,
        timestamp: Date.now(),
        duration: Math.max(perComponentDuration, 0.01),
        causes: [node.depth === 0 ? primaryCause : { type: 'parent', source: node.parent ?? undefined }],
        interactionComponent: interaction?.ownerComponent ?? undefined,
        interactionTarget: interaction?.targetSelector ?? undefined,
        parentComponent: node.parent,
        depth: node.depth,
        cdCount: this.getCdCount(node.name),
        mutationCount: this.getMutationCount(node.name),
        totalTemplateBindings: totalBindings > 0 ? totalBindings : undefined,
        totalOutputListeners: totalListeners > 0 ? totalListeners : undefined,
        hasHighFrequencyZonePollution: hasHiFreqZonePollution ? true : undefined,
        highFrequencyEvents: hiFreqEvents.length > 0 ? hiFreqEvents : undefined,
      };
      this.eventBuffer.push(event);
    }

    // ── Safeguard: hard cap buffer to prevent memory growth ──
    if (this.eventBuffer.length > MAX_EVENT_BUFFER) {
      this.eventBuffer.splice(0, this.eventBuffer.length - MAX_EVENT_BUFFER);
    }

    this.pendingElements.clear();
    this.mutationStartTime = null;

    // Clear zone cause stack after frame
    if (!this.zoneCauseCleared) {
      this.zoneCauseCleared = true;
      requestAnimationFrame(() => {
        this.zoneCauseStack.length = 0;
        this.zoneCauseCleared = false;
      });
    }
  }

  // ═══ Hierarchy Builder ══════════════════════════════════════════════════════

  private buildHierarchy(elements: [Element, string][]): Array<{ name: string; element: Element; parent: string | null; depth: number }> {
    const result: Array<{ name: string; element: Element; parent: string | null; depth: number }> = [];

    for (const [element, name] of elements) {
      // Find the real parent component by walking UP the actual DOM tree,
      // looking for the nearest ancestor element that is a registered component.
      // This works across mutation batches (timer renders, async, etc.) because
      // it uses the persistent componentElements registry, not just same-batch elements.
      const { parent, depth } = this.findDomAncestorComponent(element);
      result.push({ name, element, parent, depth });
    }

    return result;
  }

  /**
   * Walks up the DOM from the given element to find the nearest ancestor that is
   * a registered component, and counts how many component ancestors exist (= depth).
   */
  private findDomAncestorComponent(element: Element): { parent: string | null; depth: number } {
    let current: Element | null = element.parentElement;
    let parent: string | null = null;
    let depth = 0;

    while (current) {
      const name = this.componentElements.get(current);
      if (name && !isInternalName(name)) {
        if (parent === null) {
          parent = name; // nearest ancestor component = direct parent
        }
        depth++;
      }
      current = current.parentElement;
    }

    return { parent, depth };
  }

  // ═══ Element Lookup ═════════════════════════════════════════════════════════

  private findOwnerEntry(element: Element): { element: Element; name: string } | null {
    const ng = (globalThis as any).ng;
    const hasDevApi = !!ng?.getComponent;
    let current: Element | null = element;
    let depth = 0;

    while (current) {
      try {
        const name = this.componentElements.get(current);
        if (name && !isInternalName(name)) return { element: current, name };

        // On-demand discovery: if element isn't registered yet, try to discover it now
        if (hasDevApi && !this.componentElements.has(current)) {
          const component = ng.getComponent(current);
          if (component) {
            const cName = this.resolveComponentName(component, current);
            if (cName && !isInternalName(cName)) {
              this.componentElements.set(current, cName);
              this.hookComponentChangeDetection(component, cName);
              return { element: current, name: cName };
            }
          }
        }
      } catch { /* skip this element — SVG or detached node */ }

      current = current.parentElement;
      depth++;
    }
    return null;
  }

  private _loggedUnresolved = false;

  private findOwnerComponent(element: Element): string | null {
    const entry = this.findOwnerEntry(element);
    return entry?.name ?? null;
  }

  private isRootElement(element: Element): boolean {
    return element === this.rootComponentElement;
  }

  // ═══ Zone.js Hook ═══════════════════════════════════════════════════════════

  private hookZoneJs(): void {
    const zone = (globalThis as any).Zone?.current;
    if (!zone) return;

    const zoneDelegate = zone._zoneDelegate;
    if (!zoneDelegate || typeof zoneDelegate.scheduleTask !== 'function') return;

    this.zoneDelegate = zoneDelegate;
    this.originalZoneScheduleTask = zoneDelegate.scheduleTask.bind(zoneDelegate);
    const tracker = this;
    const originalScheduleTask = this.originalZoneScheduleTask;

    zoneDelegate.scheduleTask = (targetZone: any, task: any): any => {
      const source = tracker.categorizeZoneTask(task);
      if (source) {
        // Don't push zone causes if we have a recent user interaction —
        // the interaction is the true cause, timer/promise are just consequences.
        if (!tracker.lastInteraction) {
          tracker.zoneCauseStack.push({ type: 'zone', source });
          if (tracker.zoneCauseStack.length > 30) {
            tracker.zoneCauseStack.splice(0, tracker.zoneCauseStack.length - 15);
          }
        }
      }
      return originalScheduleTask(targetZone, task);
    };
  }

  private unhookZoneJs(): void {
    if (this.originalZoneScheduleTask && this.zoneDelegate) {
      this.zoneDelegate.scheduleTask = this.originalZoneScheduleTask;
      this.originalZoneScheduleTask = null;
      this.zoneDelegate = null;
    }
    this.zoneCauseStack.length = 0;
  }

  private categorizeZoneTask(task: any): string | null {
    if (!task) return null;
    const src: string = task.source ?? '';
    const type: string = task.type ?? '';
    if (src.includes('setTimeout')) return 'setTimeout';
    if (src.includes('setInterval')) return 'setInterval';
    if (src.includes('XMLHttpRequest')) return 'XMLHttpRequest';
    if (src.includes('fetch')) return 'fetch';
    if (src.includes('addEventListener')) {
      const m = /addEventListener:(\w+)/.exec(src);
      return m ? `addEventListener:${m[1]}` : 'addEventListener';
    }
    if (type === 'microTask' || src.includes('Promise')) return 'Promise.then';
    if (src.includes('requestAnimationFrame')) return 'requestAnimationFrame';
    return src || null;
  }

  // ═══ Batching ══════════════════════════════════════════════════════════════

  private startBatching(): void {
    this.flushInterval = globalThis.setInterval(() => this.flush(), 100);
  }

  private stopBatching(): void {
    if (this.flushInterval !== null) { clearInterval(this.flushInterval); this.flushInterval = null; }
  }

  private flush(): void {
    const events = this.clearBuffer();
    if (events.length === 0) return;
    const batch: EventBatch = {
      events,
      batchTimestamp: performance.now(),
      sequenceNumber: ++this.batchSequence,
    };
    globalThis.dispatchEvent(new CustomEvent(PAGE_TO_CONTENT_EVENT, {
      detail: { eventId: `batch-${batch.sequenceNumber}-${Date.now()}`, type: 'EVENT_BATCH', payload: batch },
    }));
  }
}

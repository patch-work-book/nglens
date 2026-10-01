// src/instrumentation/render-tracker.ts
// Deep instrumentation: captures user interactions, builds parent→child cascade,
// filters Angular internals, and properly attributes causes.

import type { RenderEvent, RenderCause, EventBatch, RenderReason, FlowEvent, InteractionInfo } from '../types/render-events';

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
/** Time window to look back for related flow events (500ms covers most cascades) */
const FLOW_CORRELATION_WINDOW_MS = 500;

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
  type: string;           // 'click' | 'input' | 'keydown' | 'change' | 'pointerdown'
  targetSelector: string; // e.g. 'button.dropdown-toggle'
  ownerComponent: string; // component that owns the target element
  timestamp: number;
  /** Rich structured metadata for accurate chip labelling in the panel. */
  info: InteractionInfo;
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

  // Recent flow events for correlation with render reasons
  private recentFlowEvents: FlowEvent[] = [];
  private flowEventsCapacity = 200; // Keep last 200 flow events for correlation

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
    const tracker = this;

    // Hook ngDoCheck — fires on every CD cycle
    const originalDoCheck = proto.ngDoCheck;
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
    const rawTarget = event.target as Element | null;
    if (!rawTarget) return;

    // The literal event.target is often a nested <span>/<svg>/<i> inside the
    // real interactive control. Climb to the nearest meaningful element so the
    // captured metadata describes the button/link/field the user actually hit.
    const target = this.resolveInteractiveElement(rawTarget, event.type);

    // For keydown, ignore pure modifier presses (Shift/Ctrl/etc.) — they aren't
    // meaningful interactions on their own.
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (key && ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(key)) return;
    }

    const info = this.buildInteractionInfo(target, event);

    // Owner component is best-effort now — we still record the interaction even
    // when the target isn't inside a recognized component, because the metadata
    // (button/link/field + accessible name) is what labels the chip.
    const rawOwner = this.findOwnerComponent(target);
    const ownerComponent = rawOwner && !isInternalName(rawOwner) ? rawOwner : '';

    this.lastInteraction = {
      type: event.type,
      targetSelector: this.buildSelector(target),
      ownerComponent,
      timestamp: performance.now(),
      info,
    };
    this.interactionConsumed = false;

    // Keep interaction context alive for 600ms (covers slower CD cycles / async
    // work that lands after the event; the 300ms window dropped many renders).
    if (this.interactionTimeout) clearTimeout(this.interactionTimeout);
    this.interactionTimeout = setTimeout(() => { this.lastInteraction = null; }, 600);

    // Check if this interaction produced any renders — if not, emit a "no-render" event
    if (this.noRenderTimeout) clearTimeout(this.noRenderTimeout);
    this.noRenderTimeout = setTimeout(() => {
      if (!this.interactionConsumed && this.isRunning) {
        this.eventBuffer.push({
          componentName: ownerComponent || info.tag || 'interaction',
          timestamp: Date.now(),
          duration: 0,
          causes: [{ type: 'zone', source: `addEventListener:${event.type}` }],
          interactionComponent: ownerComponent || undefined,
          interactionTarget: this.buildSelector(target),
          interactionInfo: info,
          parentComponent: null,
          depth: 0,
        });
      }
    }, 350);
  };

  /**
   * Climb from the raw event target to the nearest element that represents the
   * actual interactive control (button, link, input, [role], etc.). Falls back
   * to the original target when nothing better is found.
   */
  private resolveInteractiveElement(el: Element, eventType: string): Element {
    // For typing/change events the target IS the field — don't climb.
    if (eventType === 'input' || eventType === 'change' || eventType === 'keydown') return el;
    const interactive = el.closest?.(
      'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], input, select, textarea, label, summary, [onclick]'
    );
    return (interactive as Element) || el;
  }

  /** Build rich structured metadata describing the interaction target. */
  private buildInteractionInfo(el: Element, event: Event): InteractionInfo {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute?.('type') || '').toLowerCase() || undefined;
    const role = (el.getAttribute?.('role') || '').toLowerCase() || undefined;

    const isLink = tag === 'a'
      ? el.hasAttribute('href')
      : (role === 'link' || !!el.closest?.('a[href]'));

    const isButton =
      tag === 'button' ||
      role === 'button' ||
      (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type || '')) ||
      (!isLink && !!el.closest?.('button, [role="button"]'));

    const isTextField =
      tag === 'textarea' ||
      (el as HTMLElement).isContentEditable === true ||
      (tag === 'input' && !['checkbox', 'radio', 'submit', 'button', 'reset', 'file', 'image', 'range', 'color'].includes(type || 'text')) ||
      (tag === 'select');

    const info: InteractionInfo = {
      eventType: event.type,
      tag,
      inputType: type,
      role,
      isLink,
      isButton,
      isTextField,
      accessibleName: this.accessibleName(el),
    };
    if (event.type === 'keydown') info.key = (event as KeyboardEvent).key;
    return info;
  }

  /**
   * Derive a short accessible name for an element, mirroring (loosely) the ARIA
   * name computation: aria-label → title → visible text → value/placeholder →
   * alt → name attribute. Kept short for display.
   */
  private accessibleName(el: Element): string {
    const clean = (s: string | null | undefined): string =>
      (s || '').replace(/\s+/g, ' ').trim().slice(0, 32);

    const aria = clean(el.getAttribute?.('aria-label'));
    if (aria) return aria;

    const title = clean(el.getAttribute?.('title'));
    if (title) return title;

    // Visible text (buttons/links) — prefer textContent but avoid huge blobs.
    const text = clean((el as HTMLElement).textContent);
    if (text && text.length <= 32) return text;
    if (text) return text.slice(0, 30) + '…';

    const val = clean((el as HTMLInputElement).value);
    if (val) return val;

    const placeholder = clean(el.getAttribute?.('placeholder'));
    if (placeholder) return placeholder;

    const alt = clean(el.getAttribute?.('alt'));
    if (alt) return alt;

    const name = clean(el.getAttribute?.('name'));
    if (name) return name;

    return '';
  }

  private setupInteractionListener(): void {
    // Capture phase to get the event before Angular handles it
    document.addEventListener('click', this.onInteraction, true);
    document.addEventListener('input', this.onInteraction, true);
    document.addEventListener('keydown', this.onInteraction, true);
    document.addEventListener('change', this.onInteraction, true);
  }

  private teardownInteractionListener(): void {
    document.removeEventListener('click', this.onInteraction, true);
    document.removeEventListener('input', this.onInteraction, true);
    document.removeEventListener('keydown', this.onInteraction, true);
    document.removeEventListener('change', this.onInteraction, true);
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
              // If this is near a router-outlet, schedule a re-discovery
              // (Angular may not have the component context ready yet)
              // Angular inserts route components as NEXT SIBLING of router-outlet
              if (node.tagName === 'ROUTER-OUTLET' || node.closest('router-outlet') || 
                  node.previousElementSibling?.tagName === 'ROUTER-OUTLET' ||
                  node.parentElement?.querySelector('router-outlet')) {
                this.scheduleRouteDiscovery();
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

  private routeDiscoveryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Re-discover components after a route change with slight delay for Angular to bootstrap */
  private scheduleRouteDiscovery(): void {
    if (this.routeDiscoveryTimer) clearTimeout(this.routeDiscoveryTimer);
    this.routeDiscoveryTimer = setTimeout(() => {
      this.discoverComponents();
      this.routeDiscoveryTimer = null;
    }, 100);
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
        interactionInfo: (node.depth === 0 && interaction) ? interaction.info : undefined,
        parentComponent: node.parent,
        depth: node.depth,
        cdCount: this.getCdCount(node.name),
        mutationCount: this.getMutationCount(node.name),
        totalTemplateBindings: totalBindings > 0 ? totalBindings : undefined,
        totalOutputListeners: totalListeners > 0 ? totalListeners : undefined,
        hasHighFrequencyZonePollution: hasHiFreqZonePollution ? true : undefined,
        highFrequencyEvents: hiFreqEvents.length > 0 ? hiFreqEvents : undefined,
        spatialMetadata: (node.element && node.element.isConnected) ? (() => {
          const rect = node.element.getBoundingClientRect();
          // Ensure we don't capture zero-rects for hidden or detached elements
          if (rect.width === 0 && rect.height === 0) return undefined;
          return {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            selector: this.buildSelector(node.element)
          };
        })() : undefined,
      };
      // Compute render reasons from causes + flow events
      event.reasons = this.computeRenderReasons(event);
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
    const entry = this.findInteractionOwner(element);
    return entry?.name ?? null;
  }

  /**
   * Find the component that "owns" a user interaction.
   * Unlike findOwnerEntry (which finds the nearest component for render tracking),
   * this prioritizes components that are meaningful interaction targets:
   * - Components with routerLink, (click), or navigation-related bindings
   * - Skips leaf/visual components (icons, maps, spinners) in favor of their parent
   */
  private findInteractionOwner(element: Element): { element: Element; name: string } | null {
    const ng = (globalThis as any).ng;
    const hasDevApi = !!ng?.getComponent;
    let current: Element | null = element;
    let firstFound: { element: Element; name: string } | null = null;
    let depth = 0;

    // Visual/leaf component patterns that are unlikely to be the interaction owner
    const LEAF_PATTERNS = /^(mat|ngx|cdk|icon|svg|img|badge|spinner|loader|tooltip|overlay|map|box|progress|avatar|chip)/i;

    while (current && depth < 20) {
      try {
        let name: string | undefined;
        
        // Check our cache first
        name = this.componentElements.get(current);
        
        // On-demand discovery
        if (!name && hasDevApi && !this.componentElements.has(current)) {
          const component = ng.getComponent(current);
          if (component) {
            const cName = this.resolveComponentName(component, current);
            if (cName && !isInternalName(cName)) {
              this.componentElements.set(current, cName);
              this.hookComponentChangeDetection(component, cName);
              name = cName;
            }
          }
        }

        if (name && !isInternalName(name)) {
          // First component found (closest to click target)
          if (!firstFound) {
            firstFound = { element: current, name };
          }

          // If this component looks like a meaningful container (not a leaf), use it
          const cleanName = name.replace(/^_+/, '').replace(/Component$/, '').toLowerCase();
          if (!LEAF_PATTERNS.test(cleanName)) {
            return { element: current, name };
          }
        }
      } catch { /* skip */ }

      current = current.parentElement;
      depth++;
    }

    // If we only found leaf components, return the first one found
    return firstFound;
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
        // Capture interaction component from event target if possible
        let triggerComp: string | null = null;
        if (source.startsWith('addEventListener') && task.data?.target instanceof Element) {
          triggerComp = tracker.findOwnerComponent(task.data.target);
        }

        // Don't push zone causes if we have a recent user interaction —
        // the interaction is the true cause, timer/promise are just consequences.
        if (!tracker.lastInteraction) {
          tracker.zoneCauseStack.push({ 
            type: 'zone', 
            source: triggerComp ? `${source} (in ${triggerComp})` : source 
          });
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

  // ═══ Flow Event Correlation (for Render Reasons) ═════════════════════════

  /** Called by orchestrator to inject flow events for correlation with renders */
  injectFlowEvent(event: FlowEvent): void {
    if (!this.isRunning) return;
    this.recentFlowEvents.push(event);
    // Keep only the last N flow events
    if (this.recentFlowEvents.length > this.flowEventsCapacity) {
      this.recentFlowEvents.shift();
    }
  }

  /** Compute render reasons from causes and recent flow events */
  private computeRenderReasons(event: RenderEvent): RenderReason[] {
    const reasons: Map<string, RenderReason> = new Map();

    if (!event.causes || event.causes.length === 0) {
      return [];
    }

    // Group causes by type
    for (const cause of event.causes) {
      const key = `${cause.type}:${cause.source || 'unknown'}`;
      let reason = reasons.get(key);

      if (!reason) {
        reason = {
          type: cause.type as any,
          source: cause.source || 'unknown',
          count: 0,
          colorClass: this.getReasonColorClass(cause.type),
        };
        reasons.set(key, reason);
      }
      reason.count++;
    }

    // Look for related flow events within the time window to add details
    const timeWindow = event.timestamp - FLOW_CORRELATION_WINDOW_MS;
    const relatedFlows = this.recentFlowEvents.filter(
      f => f.timestamp >= timeWindow && f.timestamp <= event.timestamp
    );

    // Enhance reasons with flow event details
    for (const reason of reasons.values()) {
      if (reason.type === 'signal') {
        // Find signal writes that match
        const signalWrites = relatedFlows.filter(
          f => f.type === 'signal-write' && f.propertyName === reason.source
        );
        if (signalWrites.length > 0) {
          const latest = signalWrites[signalWrites.length - 1];
          // Try to extract before/after if available
          if (latest.detail) {
            reason.after = latest.detail;
          }
        }
      } else if (reason.type === 'input') {
        // Find input changes
        const inputChanges = relatedFlows.filter(
          f => f.type === 'signal-write' && f.propertyName === reason.source && f.label?.includes('(input)')
        );
        if (inputChanges.length > 0) {
          const latest = inputChanges[inputChanges.length - 1];
          if (latest.detail) {
            reason.after = latest.detail;
          }
        }
      } else if (reason.type === 'parent') {
        // Parent render is already descriptive
      } else if (reason.type === 'zone') {
        // Zone task type is in source
      }
    }

    return Array.from(reasons.values());
  }

  private getReasonColorClass(causeType: string): string {
    switch (causeType) {
      case 'signal': return 'signal-color';
      case 'input': return 'input-color';
      case 'parent': return 'parent-color';
      case 'zone': return 'zone-color';
      case 'manual-cd': return 'manual-color';
      default: return 'default-color';
    }
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

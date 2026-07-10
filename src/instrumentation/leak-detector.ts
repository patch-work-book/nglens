/**
 * Leak Detector — Component Lifecycle Tracking
 *
 * Runs in the page's MAIN world. Hooks into Angular's component
 * creation/destruction lifecycle to track active components and
 * detect potential memory leaks (subscriptions, timers) that
 * survive component destruction.
 *
 * For Angular 17+, components use DestroyRef which can be intercepted.
 * This module patches Angular's component factory to intercept creation
 * and listens for DestroyRef callbacks to detect destruction.
 */

import type { ComponentLifecycle, LeakEvent, SubscriptionRecord, TimerRecord } from '../types/leak-events';
import type { PageMessage } from '../types/messages';

/** Custom event name for page-script → content-script communication */
const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

/** Unique ID counter for component instances */
let nextComponentId = 0;

/** Unique ID counter for subscription records */
let nextSubscriptionId = 0;

/** Unique ID counter for timer records */
let nextTimerId = 0;

/** Timers created just before Angular exposes a component instance can still belong to that component. */
const UNOWNED_TIMER_ADOPTION_WINDOW_MS = 2000;

/**
 * Generates a unique subscription record ID.
 */
function generateSubscriptionId(): string {
  return `sub_${nextSubscriptionId++}`;
}

/**
 * Generates a unique timer record ID.
 */
function generateTimerId(): string {
  return `timer_${nextTimerId++}`;
}

/**
 * Generates a unique component ID combining the component name
 * and a monotonically increasing counter.
 */
function generateComponentId(componentName: string): string {
  return `${componentName}_${nextComponentId++}`;
}

/**
 * LeakDetector tracks Angular component lifecycle events (creation and destruction)
 * and maintains a registry of active components. When a component is destroyed,
 * it triggers leak checking (actual leak detection logic is added in task 7.3).
 */
export class LeakDetector {
  private readonly activeComponents = new Map<string, ComponentLifecycle>();
  private running = false;
  private originalCreateComponent: ((...args: unknown[]) => unknown) | null = null;
  private patchedFactories = new WeakSet<object>();

  /**
   * Tracks the currently active component context. When a component is being
   * created or executing code, this holds its ID so that subscriptions and
   * timers created during that time can be associated with it.
   */
  private currentComponentId: string | null = null;

  /**
   * Stack-based context for nested component initialization.
   * Supports correct attribution when lifecycle hooks trigger nested
   * component creation (e.g., parent's ngAfterViewInit triggers child init).
   */
  private readonly contextStack: string[] = [];

  /**
   * Maps timer IDs (from setInterval/setTimeout) to the component that owns them.
   * Used to associate clearInterval/clearTimeout calls with the correct timer record.
   */
  private readonly timerToComponent = new Map<unknown, { componentId: string; recordId: string }>();

  /**
   * Timers observed without a component context. Angular often runs ngOnInit
   * before our MutationObserver can resolve the host element to a component,
   * so these candidates are adopted by the newly tracked component when the
   * stack or timing strongly suggests ownership.
   */
  private readonly unownedTimers = new Map<unknown, { record: TimerRecord; stack: string }>();

  /** Original setInterval function, stored for restoration on stop() */
  private originalSetInterval: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => number) | null = null;
  /** Original setTimeout function, stored for restoration on stop() */
  private originalSetTimeout: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => number) | null = null;
  /** Original clearInterval function, stored for restoration on stop() */
  private originalClearInterval: ((id?: number) => void) | null = null;
  /** Original clearTimeout function, stored for restoration on stop() */
  private originalClearTimeout: ((id?: number) => void) | null = null;
  /** Original Observable.prototype.subscribe, stored for restoration on stop() */
  private originalSubscribe: ((...args: unknown[]) => unknown) | null = null;
  /** Reference to the Observable prototype that was patched */
  private patchedObservableProto: { subscribe?: (...args: unknown[]) => unknown } | null = null;

  /**
   * Returns the current active components map.
   * Useful for external inspection and testing.
   */
  getActiveComponents(): ReadonlyMap<string, ComponentLifecycle> {
    return this.activeComponents;
  }

  /**
   * Returns whether the detector is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Starts the leak detector by hooking into Angular's component lifecycle,
   * subscription creation, and timer creation.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.hookComponentLifecycle();
    this.hookSubscriptionCreation();
    this.hookTimerCreation();
  }

  /**
   * Stops the leak detector, unhooks lifecycle/subscription/timer interception,
   * and clears all tracked state.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unhookComponentLifecycle();
    this.unhookSubscriptionCreation();
    this.unhookTimerCreation();
    this.activeComponents.clear();
    this.timerToComponent.clear();
    this.unownedTimers.clear();
    this.currentComponentId = null;
    this.contextStack.length = 0;
  }

  /**
   * Called when a new component instance is created.
   * Records the component in the activeComponents map with its
   * creation timestamp and empty subscription/timer arrays.
   * Sets this component as the current context for subscription/timer tracking.
   */
  onComponentCreated(componentId: string, componentName: string): void {
    const lifecycle: ComponentLifecycle = {
      componentId,
      componentName,
      createdAt: performance.now(),
      destroyedAt: null,
      subscriptions: [],
      timers: [],
    };
    this.activeComponents.set(componentId, lifecycle);
    this.adoptRecentUnownedTimers(componentId, lifecycle);
    // Set as current component context so subscriptions/timers created
    // during component initialization are associated with this component
    this.currentComponentId = componentId;
  }

  /**
   * Called when a component is destroyed.
   * Records the destruction timestamp and checks for surviving
   * subscriptions (CRITICAL) and timers (WARNING), emitting
   * LeakEvents for any detected leaks.
   */
  onComponentDestroyed(componentId: string): void {
    const lifecycle = this.activeComponents.get(componentId);
    if (!lifecycle) return;

    lifecycle.destroyedAt = performance.now();

    // Check for surviving subscriptions (CRITICAL severity)
    const activeSubscriptions = lifecycle.subscriptions.filter(s => !s.cleaned);
    for (const sub of activeSubscriptions) {
      this.emitLeakEvent({
        id: `leak-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        componentName: lifecycle.componentName,
        componentId,
        leakType: 'subscription',
        severity: 'CRITICAL',
        source: sub.source,
        createdAt: sub.createdAt,
        detectedAt: performance.now(),
        lifecycleState: 'destroyed',
      });
    }

    // Check for surviving timers (WARNING severity)
    const activeTimers = lifecycle.timers.filter(t => !t.cleared);
    for (const timer of activeTimers) {
      this.emitLeakEvent({
        id: `leak-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        componentName: lifecycle.componentName,
        componentId,
        leakType: 'timer',
        severity: 'WARNING',
        source: this.timerSourceLabel(timer.type),
        createdAt: timer.createdAt,
        detectedAt: performance.now(),
        lifecycleState: 'destroyed',
      });
    }

    // Remove from active components
    this.activeComponents.delete(componentId);
  }

  /**
   * Dispatches a LeakEvent to the content script via CustomEvent,
   * following the same pattern used for EVENT_BATCH.
   */
  private emitLeakEvent(event: LeakEvent): void {
    const message: PageMessage<LeakEvent> = {
      eventId: `leak-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'LEAK_EVENT',
      payload: {
        ...event,
      },
    };

    globalThis.dispatchEvent(
      new CustomEvent(PAGE_TO_CONTENT_EVENT, { detail: message })
    );
  }

  /**
   * Hooks into Angular's component creation/destruction lifecycle.
   *
   * Strategy for Angular 17+:
   * 1. Patch the global `ng` utilities to intercept component access
   * 2. Use MutationObserver to detect new Angular component elements
   * 3. For each new component, extract its instance via ng.getComponent()
   * 4. Register a DestroyRef.onDestroy() callback to detect destruction
   *
   * Falls back to patching ViewContainerRef.createComponent if available.
   */
  private hookComponentLifecycle(): void {
    this.hookViaAngularInternals();
    this.hookViaMutationObserver();
  }

  /**
   * Patches Observable.prototype.subscribe to record subscriptions with
   * component context. When subscribe is called, the returned Subscription
   * is wrapped so that unsubscribe calls are tracked as cleanup.
   */
  private hookSubscriptionCreation(): void {
    // Try to access rxjs Observable prototype from the page's global scope
    const rxjs = (globalThis as unknown as { rxjs?: { Observable?: { prototype?: ObservablePrototype } } }).rxjs;
    const observableProto = rxjs?.Observable?.prototype ?? this.findObservablePrototype();
    if (!observableProto || typeof observableProto.subscribe !== 'function') return;

    this.originalSubscribe = observableProto.subscribe;
    this.patchedObservableProto = observableProto;

    // Use a bound reference to avoid eslint no-this-alias
    const getState = () => ({
      running: this.running,
      currentComponentId: this.currentComponentId,
      activeComponents: this.activeComponents,
      originalSubscribe: this.originalSubscribe,
      inferSource: (obs: unknown) => this.inferSubscriptionSource(obs),
    });

    observableProto.subscribe = function patchedSubscribe(this: unknown, ...args: unknown[]): unknown {
      const state = getState();
      if (!state.originalSubscribe) return undefined;
      const subscription = state.originalSubscribe.apply(this, args) as SubscriptionLike;

      // Only track if we have an active component context and the detector is running
      if (!state.running || !state.currentComponentId) {
        return subscription;
      }

      const componentId = state.currentComponentId;
      const lifecycle = state.activeComponents.get(componentId);
      if (!lifecycle) return subscription;

      // Create a subscription record
      const record: SubscriptionRecord = {
        id: generateSubscriptionId(),
        source: state.inferSource(this),
        createdAt: performance.now(),
        cleaned: false,
        cleanedAt: null,
      };
      lifecycle.subscriptions.push(record);

      // Wrap unsubscribe to mark cleanup
      if (subscription && typeof subscription.unsubscribe === 'function') {
        const originalUnsubscribe = subscription.unsubscribe.bind(subscription);
        subscription.unsubscribe = () => {
          record.cleaned = true;
          record.cleanedAt = performance.now();
          originalUnsubscribe();
        };
      }

      return subscription;
    };
  }

  /**
   * Restores the original Observable.prototype.subscribe.
   */
  private unhookSubscriptionCreation(): void {
    if (this.patchedObservableProto && this.originalSubscribe) {
      this.patchedObservableProto.subscribe = this.originalSubscribe;
    }
    this.originalSubscribe = null;
    this.patchedObservableProto = null;
  }

  /**
   * Wraps setInterval/setTimeout to track timer ownership, and
   * clearInterval/clearTimeout to mark timer cleanup.
   */
  private hookTimerCreation(): void {
    // Store originals
    this.originalSetInterval = globalThis.setInterval.bind(globalThis);
    this.originalSetTimeout = globalThis.setTimeout.bind(globalThis);
    this.originalClearInterval = globalThis.clearInterval.bind(globalThis);
    this.originalClearTimeout = globalThis.clearTimeout.bind(globalThis);

    const getTimerState = () => ({
      running: this.running,
      currentComponentId: this.currentComponentId,
      activeComponents: this.activeComponents,
      timerToComponent: this.timerToComponent,
      originalSetInterval: this.originalSetInterval,
      originalSetTimeout: this.originalSetTimeout,
      originalClearInterval: this.originalClearInterval,
      originalClearTimeout: this.originalClearTimeout,
      markTimerCleared: (id: unknown) => this.markTimerCleared(id),
      trackTimer: (id: unknown, type: TimerRecord['type'], stack: string) => this.trackTimer(id, type, stack),
    });

    // Patch setInterval
    (globalThis as unknown as Record<string, unknown>)['setInterval'] = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): number => {
      const state = getTimerState();
      if (!state.originalSetInterval) return 0;
      const timerId = state.originalSetInterval(handler, timeout, ...args);
      state.trackTimer(timerId, 'interval', new Error().stack ?? '');

      return timerId;
    };

    // Patch setTimeout
    (globalThis as unknown as Record<string, unknown>)['setTimeout'] = (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ): number => {
      const state = getTimerState();
      if (!state.originalSetTimeout) return 0;
      const timerId = state.originalSetTimeout(handler, timeout, ...args);
      state.trackTimer(timerId, 'timeout', new Error().stack ?? '');

      return timerId;
    };

    // Patch clearInterval
    (globalThis as unknown as Record<string, unknown>)['clearInterval'] = (
      id?: number
    ): void => {
      const state = getTimerState();
      if (id !== undefined) {
        state.markTimerCleared(id);
      }
      if (state.originalClearInterval) state.originalClearInterval(id);
    };

    // Patch clearTimeout
    (globalThis as unknown as Record<string, unknown>)['clearTimeout'] = (
      id?: number
    ): void => {
      const state = getTimerState();
      if (id !== undefined) {
        state.markTimerCleared(id);
      }
      if (state.originalClearTimeout) state.originalClearTimeout(id);
    };
  }

  /**
   * Restores the original setInterval/setTimeout/clearInterval/clearTimeout.
   */
  private unhookTimerCreation(): void {
    if (this.originalSetInterval) {
      (globalThis as unknown as Record<string, unknown>)['setInterval'] = this.originalSetInterval;
    }
    if (this.originalSetTimeout) {
      (globalThis as unknown as Record<string, unknown>)['setTimeout'] = this.originalSetTimeout;
    }
    if (this.originalClearInterval) {
      (globalThis as unknown as Record<string, unknown>)['clearInterval'] = this.originalClearInterval;
    }
    if (this.originalClearTimeout) {
      (globalThis as unknown as Record<string, unknown>)['clearTimeout'] = this.originalClearTimeout;
    }
    this.originalSetInterval = null;
    this.originalSetTimeout = null;
    this.originalClearInterval = null;
    this.originalClearTimeout = null;
  }

  /**
   * Marks a timer as cleared by looking up its component association.
   */
  private markTimerCleared(timerId: unknown): void {
    const mapping = this.timerToComponent.get(timerId);
    if (!mapping) {
      const unowned = this.unownedTimers.get(timerId);
      if (unowned) {
        unowned.record.cleared = true;
        this.unownedTimers.delete(timerId);
      }
      return;
    }

    const lifecycle = this.activeComponents.get(mapping.componentId);
    if (lifecycle) {
      const timerRecord = lifecycle.timers.find(t => t.id === mapping.recordId);
      if (timerRecord) {
        timerRecord.cleared = true;
      }
    }
    this.timerToComponent.delete(timerId);
  }

  private trackTimer(timerId: unknown, type: TimerRecord['type'], stack: string): void {
    if (!this.running) return;

    const record: TimerRecord = {
      id: generateTimerId(),
      type,
      createdAt: performance.now(),
      cleared: false,
    };

    if (this.currentComponentId) {
      const componentId = this.currentComponentId;
      const lifecycle = this.activeComponents.get(componentId);
      if (lifecycle) {
        lifecycle.timers.push(record);
        this.timerToComponent.set(timerId, { componentId, recordId: record.id });
        return;
      }
    }

    if (!this.isLikelyInstrumentationTimer(stack)) {
      this.unownedTimers.set(timerId, { record, stack });
    }
  }

  private adoptRecentUnownedTimers(componentId: string, lifecycle: ComponentLifecycle): void {
    const componentName = lifecycle.componentName;
    const createdAt = lifecycle.createdAt;

    for (const [timerId, pending] of this.unownedTimers) {
      if (pending.record.cleared) {
        this.unownedTimers.delete(timerId);
        continue;
      }

      const closeToComponentCreation =
        Math.abs(createdAt - pending.record.createdAt) <= UNOWNED_TIMER_ADOPTION_WINDOW_MS;
      const stackMentionsComponent = pending.stack.includes(componentName);

      if (!stackMentionsComponent && !closeToComponentCreation) continue;

      lifecycle.timers.push(pending.record);
      this.timerToComponent.set(timerId, { componentId, recordId: pending.record.id });
      this.unownedTimers.delete(timerId);
    }
  }

  private isLikelyInstrumentationTimer(stack: string): boolean {
    const applicationFrames = stack
      .split('\n')
      .slice(1)
      .filter(line => !line.includes('chrome-extension://') && !line.includes('/page-script.js'))
      .filter(line => line.trim().length > 0);

    return stack.includes('chrome-extension://') && applicationFrames.length === 0;
  }

  private timerSourceLabel(type: TimerRecord['type']): string {
    return type === 'interval' ? 'setInterval' : 'setTimeout';
  }

  /**
   * Attempts to find the Observable prototype from rxjs loaded in the page.
   * Checks common module patterns (global rxjs, window.__rxjs__, etc.)
   */
  private findObservablePrototype(): ObservablePrototype | null {
    // Check for rxjs loaded as a global (common in Angular apps via webpack)
    const win = globalThis as unknown as Record<string, unknown>;

    // Try common global patterns
    const candidates = [
      (win['rxjs'] as { Observable?: { prototype?: ObservablePrototype } })?.Observable?.prototype,
      (win['Rx'] as { Observable?: { prototype?: ObservablePrototype } })?.Observable?.prototype,
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate.subscribe === 'function') {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Infers the source of a subscription from the Observable instance.
   * Attempts to extract a meaningful name from the observable's operator chain.
   */
  private inferSubscriptionSource(observable: unknown): string {
    if (!observable || typeof observable !== 'object') return 'unknown';

    const obs = observable as Record<string, unknown>;

    // Try to get source info from the observable's operator or source
    if (obs['source'] && typeof obs['source'] === 'object') {
      const source = obs['source'] as Record<string, unknown>;
      if (typeof source['constructor'] === 'function') {
        return source['constructor'].name ?? 'Observable';
      }
    }

    // Try constructor name
    if (typeof obs['constructor'] === 'function') {
      const name = (obs['constructor'] as { name?: string }).name;
      if (name && name !== 'Observable') return name;
    }

    return 'Observable';
  }

  /**
   * Sets the current component context. Used externally to associate
   * subscriptions/timers with a specific component during its execution.
   */
  setCurrentComponentContext(componentId: string | null): void {
    this.currentComponentId = componentId;
  }

  /**
   * Gets the current component context ID.
   */
  getCurrentComponentContext(): string | null {
    return this.currentComponentId;
  }

  /**
   * Pushes a component context onto the stack.
   * Used to wrap lifecycle hook execution so that subscriptions/timers
   * created during hooks are attributed to the correct component.
   */
  pushContext(componentId: string): void {
    this.contextStack.push(componentId);
    this.currentComponentId = componentId;
  }

  /**
   * Pops the current context from the stack, restoring the previous one.
   * If the stack is empty after popping, currentComponentId is set to null.
   */
  popContext(): void {
    this.contextStack.pop();
    this.currentComponentId = this.contextStack[this.contextStack.length - 1] ?? null;
  }

  /**
   * Patches lifecycle hooks on a component instance to wrap their execution
   * with push/pop context. This ensures subscriptions and timers created
   * during ngOnInit, ngAfterViewInit, etc. are attributed to the correct component.
   */
  private patchLifecycleHooks(component: ComponentInstance, componentId: string): void {
    const hooks = ['ngOnInit', 'ngAfterViewInit', 'ngAfterContentInit', 'ngDoCheck'] as const;

    for (const hook of hooks) {
      const original = component[hook];
      if (typeof original === 'function') {
        component[hook] = () => {
          this.pushContext(componentId);
          try {
            return (original as () => unknown).call(component);
          } finally {
            this.popContext();
          }
        };
      }
    }
  }

  /**
   * Attempts to hook into Angular's internal component creation by patching
   * the ViewContainerRef prototype's createComponent method.
   */
  private hookViaAngularInternals(): void {
    const ng = (globalThis as unknown as { ng?: NgGlobals }).ng;
    if (!ng) return;

    // Try to patch ViewContainerRef.createComponent via Angular's internal APIs
    // Angular 17+ exposes component creation through the framework's DI system
    try {
      const appRef = this.getApplicationRef(ng);
      if (appRef?.components) {
        // Track already-existing components
        for (const componentRef of appRef.components) {
          this.trackExistingComponent(componentRef, ng);
        }
      }
    } catch {
      // Angular internals may not be accessible; fall back to MutationObserver
    }
  }

  /**
   * Uses a MutationObserver to detect new Angular component elements
   * added to the DOM. When a new element with Angular component markers
   * is detected, it extracts the component instance and tracks it.
   */
  private mutationObserver: MutationObserver | null = null;

  private hookViaMutationObserver(): void {
    const ng = (globalThis as unknown as { ng?: NgGlobals }).ng;
    if (!ng?.getComponent) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      if (!this.running) return;

      for (const mutation of mutations) {
        this.processAddedNodes(mutation.addedNodes, ng);
        this.processRemovedNodes(mutation.removedNodes);
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Processes added DOM nodes from a mutation, checking each for
   * Angular component instances to track.
   */
  private processAddedNodes(nodes: NodeList, ng: NgGlobals): void {
    for (const node of Array.from(nodes)) {
      if (node instanceof HTMLElement) {
        this.checkAndTrackElement(node, ng);
        // Also check child elements for nested components
        const children = node.querySelectorAll('*');
        for (const child of Array.from(children)) {
          if (child instanceof HTMLElement) {
            this.checkAndTrackElement(child, ng);
          }
        }
      }
    }
  }

  /**
   * Processes removed DOM nodes and treats tracked component hosts as destroyed.
   * This catches components that do not implement ngOnDestroy and environments
   * where DestroyRef is not reachable through Angular's debug APIs.
   */
  private processRemovedNodes(nodes: NodeList): void {
    for (const node of Array.from(nodes)) {
      if (node instanceof HTMLElement) {
        this.destroyTrackedElement(node);
        const children = node.querySelectorAll('[data-nglens-tracked]');
        for (const child of Array.from(children)) {
          if (child instanceof HTMLElement) {
            this.destroyTrackedElement(child);
          }
        }
      }
    }
  }

  private destroyTrackedElement(element: HTMLElement): void {
    const componentId = element.dataset['nglensTracked'];
    if (!componentId) return;

    this.onComponentDestroyed(componentId);
    delete element.dataset['nglensTracked'];
  }

  /**
   * Checks if an element hosts an Angular component and tracks it if so.
   */
  private checkAndTrackElement(element: HTMLElement, ng: NgGlobals): void {
    try {
      const component = ng.getComponent(element);
      if (!component) return;

      // Avoid tracking the same component instance twice
      if (this.isAlreadyTracked(element)) return;

      const componentName = component.constructor?.name ?? 'UnknownComponent';
      // Skip minified/internal names — they produce useless leak reports
      if (componentName.length <= 2 || componentName === 'UnknownComponent') return;

      const componentId = generateComponentId(componentName);

      // Mark element as tracked
      this.markAsTracked(element, componentId);

      // Record creation
      this.onComponentCreated(componentId, componentName);

      // Patch lifecycle hooks to maintain context during hook execution
      this.patchLifecycleHooks(component, componentId);

      // Hook destruction via DestroyRef if available (Angular 17+)
      this.hookDestroyRef(element, componentId, ng);

      this.setCurrentComponentContext(null);
    } catch {
      // Element may not be an Angular component; skip silently
    }
  }

  /**
   * Tracks an existing component that was already in the DOM when
   * the detector started.
   */
  private trackExistingComponent(componentRef: ComponentRef, ng: NgGlobals): void {
    try {
      const instance = componentRef.instance;
      if (!instance) return;

      const element = componentRef.location?.nativeElement;
      if (!element || !(element instanceof HTMLElement)) return;

      if (this.isAlreadyTracked(element)) return;

      const componentName = instance.constructor?.name ?? 'UnknownComponent';
      // Skip minified/internal names
      if (componentName.length <= 2 || componentName === 'UnknownComponent') return;

      const componentId = generateComponentId(componentName);

      this.markAsTracked(element, componentId);
      this.onComponentCreated(componentId, componentName);
      this.patchLifecycleHooks(instance, componentId);
      this.hookDestroyRef(element, componentId, ng);
      this.setCurrentComponentContext(null);
    } catch {
      // Skip components that can't be tracked
    }
  }

  /**
   * Hooks into Angular's DestroyRef for a component to detect when
   * it is destroyed. For Angular 17+, DestroyRef is the standard
   * mechanism for cleanup callbacks.
   */
  private hookDestroyRef(
    element: HTMLElement,
    componentId: string,
    ng: NgGlobals
  ): void {
    try {
      // Angular 17+ provides DestroyRef via the injector
      const injector = ng.getOwningInjector?.(element);
      if (injector) {
        const destroyRef = injector.get?.(this.getDestroyRefToken(ng));
        if (this.isDestroyRef(destroyRef)) {
          destroyRef.onDestroy(() => {
            this.onComponentDestroyed(componentId);
          });
          return;
        }
      }

      // Fallback: use ngOnDestroy hook if the component implements it
      const component = ng.getComponent(element);
      if (component && typeof component.ngOnDestroy === 'function') {
        const originalOnDestroy = component.ngOnDestroy.bind(component);
        component.ngOnDestroy = () => {
          try {
            originalOnDestroy();
          } finally {
            this.onComponentDestroyed(componentId);
          }
        };
      }
    } catch {
      // DestroyRef not available; destruction won't be tracked for this component
    }
  }

  /**
   * Attempts to get the DestroyRef injection token from Angular's internals.
   */
  private getDestroyRefToken(ng: NgGlobals): unknown {
    // Angular 17+ exposes DestroyRef as a class that can be used as a token
    // Try to access it via the framework's exported symbols
    const angularCore = (globalThis as unknown as { [key: string]: unknown })['@angular/core'];
    if (angularCore && typeof angularCore === 'object' && 'DestroyRef' in angularCore) {
      return (angularCore as Record<string, unknown>)['DestroyRef'];
    }

    // Fallback: try to find it via ng APIs
    if (ng.ɵDestroyRef) {
      return ng.ɵDestroyRef;
    }

    return null;
  }

  /**
   * Gets the ApplicationRef instance from Angular's global utilities.
   */
  private getApplicationRef(ng: NgGlobals): ApplicationRef | null {
    try {
      // Angular dev mode exposes getComponent and other utilities
      // We can get ApplicationRef from the root element's injector
      const rootElement = document.querySelector('[ng-version]');
      if (!rootElement) return null;

      const injector = ng.getOwningInjector?.(rootElement as HTMLElement);
      if (!injector) return null;

      // Try to get ApplicationRef from the injector
      const appRef = injector.get?.(this.getApplicationRefToken());
      return this.isApplicationRef(appRef) ? appRef : null;
    } catch {
      return null;
    }
  }

  /**
   * Attempts to get the ApplicationRef injection token.
   */
  private getApplicationRefToken(): unknown {
    const angularCore = (globalThis as unknown as { [key: string]: unknown })['@angular/core'];
    if (angularCore && typeof angularCore === 'object' && 'ApplicationRef' in angularCore) {
      return (angularCore as Record<string, unknown>)['ApplicationRef'];
    }
    return null;
  }

  private isDestroyRef(value: unknown): value is DestroyRefInstance {
    return Boolean(value) &&
      typeof value === 'object' &&
      typeof (value as DestroyRefInstance).onDestroy === 'function';
  }

  private isApplicationRef(value: unknown): value is ApplicationRef {
    return Boolean(value) &&
      typeof value === 'object' &&
      Array.isArray((value as ApplicationRef).components);
  }

  /**
   * Checks if an element has already been tracked by this detector.
   */
  private isAlreadyTracked(element: HTMLElement): boolean {
    return 'nglensTracked' in element.dataset;
  }

  /**
   * Marks an element as tracked by this detector.
   */
  private markAsTracked(element: HTMLElement, componentId: string): void {
    element.dataset['nglensTracked'] = componentId;
  }

  /**
   * Unhooks all lifecycle interception and cleans up resources.
   */
  private unhookComponentLifecycle(): void {
    // Stop the MutationObserver
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // Remove tracking attributes from DOM elements
    if (typeof document !== 'undefined') {
      const trackedElements = document.querySelectorAll('[data-nglens-tracked]');
      for (const el of Array.from(trackedElements)) {
        if (el instanceof HTMLElement) {
          delete el.dataset['nglensTracked'];
        }
      }
    }

    // Reset state
    this.patchedFactories = new WeakSet<object>();
    this.originalCreateComponent = null;
  }
}

// --- Type Definitions for Angular Internals ---

interface NgGlobals {
  getComponent: (element: HTMLElement) => ComponentInstance | null;
  getOwningInjector?: (element: HTMLElement) => Injector | null;
  ɵDestroyRef?: unknown;
}

interface ComponentInstance {
  constructor?: { name?: string };
  ngOnDestroy?: () => void;
  [key: string]: unknown;
}

interface Injector {
  get?: (token: unknown) => unknown;
}

interface DestroyRefInstance {
  onDestroy: (callback: () => void) => void;
}

interface ComponentRef {
  instance: ComponentInstance | null;
  location?: { nativeElement: unknown };
}

interface ApplicationRef {
  components?: ComponentRef[];
}

// --- Type Definitions for Subscription/Timer Tracking ---

interface ObservablePrototype {
  subscribe: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface SubscriptionLike {
  unsubscribe: () => void;
  [key: string]: unknown;
}

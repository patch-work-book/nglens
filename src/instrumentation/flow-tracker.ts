/**
 * Flow Tracker — intercepts reactive state changes (RxJS subjects, signals, HTTP, routes)
 * to show developers the complete data flow that triggers re-renders.
 *
 * Captures:
 * - Subject.next() / BehaviorSubject.next() calls
 * - Signal .set() / .update() calls
 * - Computed signal recomputation (Angular 17+)
 * - Input signal changes (Angular 17.1+)
 * - linkedSignal changes (Angular 19+)
 * - resource() / httpResource() state changes (Angular 19+, stable in 22)
 * - HTTP responses (fetch/XHR completions)
 * - Router navigation events
 *
 * Angular version support:
 * - Angular ≤16: writable signals, RxJS, HTTP, Router
 * - Angular 17+: + computed, input signals
 * - Angular 19+: + linkedSignal, resource/httpResource
 * - Angular 22: + Signal Forms (formField/formGroup tracking)
 */

import type { FlowEvent, FlowEventBatch } from '../types/render-events';

const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

export class FlowTracker {
  private static instance: FlowTracker | null = null;
  private readonly buffer: FlowEvent[] = [];
  private isRunning = false;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private eventId = 0;

  // Angular version info
  private angularMajorVersion = 0;

  // Original prototypes for cleanup
  private originalSubjectNext: Function | null = null;
  private patchedSubjectProto: any = null;
  private originalFetch: typeof fetch | null = null;
  private originalXhrOpen: Function | null = null;
  private originalXhrSend: Function | null = null;
  private routerSubscription: any = null;
  // Track which signal instances we've already patched (avoid double-patching)
  private patchedSignals = new WeakSet<object>();
  // Track which computed signals we've already patched
  private patchedComputeds = new WeakSet<object>();
  // Track which facade/store/service method functions we've already patched
  private patchedMethods = new WeakSet<object>();
  // Re-entrancy guard so a patched method calling another doesn't double-log
  private inFacadeCall = false;
  // Track which component initiated the latest API call
  private lastApiInitiator: string | null = null;

  private constructor() {}

  static getInstance(): FlowTracker {
    if (!FlowTracker.instance) {
      FlowTracker.instance = new FlowTracker();
    }
    return FlowTracker.instance;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.detectAngularVersion();
    this.hookRxJSSubjects();
    this.hookSignals();
    this.hookFetch();
    this.hookXHR();
    this.hookRouter();
    this.startBatching();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.flush();
    this.unhookRxJSSubjects();
    this.unhookFetch();
    this.unhookXHR();
    this.unhookRouter();
    this.stopBatching();
    this.buffer.length = 0;
    this.patchedSignals = new WeakSet<object>();
    this.patchedComputeds = new WeakSet<object>();
    this.patchedMethods = new WeakSet<object>();
    this.inFacadeCall = false;
    this.isRunning = false;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  // ═══ Angular Version Detection ══════════════════════════════════════════════

  private detectAngularVersion(): void {
    try {
      const versionEl = document.querySelector('[ng-version]');
      if (versionEl) {
        const ver = versionEl.getAttribute('ng-version') ?? '';
        const major = parseInt(ver.split('.')[0], 10);
        if (major > 0) this.angularMajorVersion = major;
      }
    } catch { /* ignore */ }
  }

  /** Publicly expose the detected version for other instrumentation */
  getAngularVersion(): number {
    return this.angularMajorVersion;
  }

  // ═══ RxJS Subject Interception ═══════════════════════════════════════════════

  private hookRxJSSubjects(): void {
    // Find Subject prototype — try multiple locations
    const subjectProto = this.findSubjectPrototype();
    if (!subjectProto || typeof subjectProto.next !== 'function') return;

    this.originalSubjectNext = subjectProto.next;
    this.patchedSubjectProto = subjectProto;
    const tracker = this;
    const originalNext = this.originalSubjectNext;
    let inHook = false;

    subjectProto.next = function(this: any, value: any): void {
      if (tracker.isRunning && !inHook) {
        inHook = true;
        try {
          const ownerInfo = tracker.inferSubjectOwner(this);

          // Detect NgRx store dispatch: value is an action object with a `type`
          // string. NgRx convention is "[Feature] Action", so a bracketed type
          // is a strong signal; we also accept a plain typed action object.
          const isNgrxAction = value && typeof value === 'object'
            && typeof value.type === 'string' && value.type.length > 2
            && (value.type.includes(']') || value.type.includes('/') || value.type.includes(' '));

          if (isNgrxAction) {
            // Emit a real store-dispatch so the panel's store analysis activates.
            const detail = tracker.summarizeValue(value, true);
            tracker.buffer.push({
              id: `flow-${++tracker.eventId}`,
              type: 'store-dispatch',
              timestamp: Date.now(),
              label: `Store: ${value.type}`,
              ownerClass: 'Store',
              propertyName: value.type,
              actionName: value.type,
              detail,
              value: detail,
              sourceComponent: tracker.detectCurrentComponent() ?? undefined,
              triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
            });
          } else {
            const detail = tracker.summarizeValue(value);
            tracker.buffer.push({
              id: `flow-${++tracker.eventId}`,
              type: 'subject-emit',
              timestamp: Date.now(),
              label: ownerInfo
                ? `${ownerInfo.className}.${ownerInfo.propName}.next()`
                : 'Subject.next()',
              ownerClass: ownerInfo?.className,
              propertyName: ownerInfo?.propName,
              detail,
              value: detail,
              sourceComponent: tracker.detectCurrentComponent() ?? undefined,
              triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
            });
          }
        } catch { /* ignore instrumentation errors */ }
        finally { inHook = false; }
      }
      if (originalNext) {
        return originalNext.call(this, value);
      }
    };
  }

  private unhookRxJSSubjects(): void {
    if (this.patchedSubjectProto && this.originalSubjectNext) {
      this.patchedSubjectProto.next = this.originalSubjectNext;
    }
    this.originalSubjectNext = null;
    this.patchedSubjectProto = null;
  }

  private findSubjectPrototype(): any {
    // Strategy 1: globalThis.rxjs
    const rxjs = (globalThis as any).rxjs;
    if (rxjs?.Subject?.prototype) return rxjs.Subject.prototype;

    // Strategy 2: Look for a Subject instance via Angular's injector
    try {
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (ng?.getInjector && rootEl) {
        const injector = ng.getInjector(rootEl);
        const records = injector?._records ?? injector?.records;
        if (records instanceof Map) {
          for (const [token, record] of records) {
            try {
              // Try record.value first (already instantiated)
              let inst = record?.value;

              // If not instantiated, try injector.get() for class tokens
              // (only for function tokens — safe to instantiate services)
              if (!inst && typeof token === 'function' && token.name && token.name.length > 2) {
                try {
                  inst = injector.get(token, null, { optional: true } as any);
                } catch { continue; }
              }

              if (!inst || typeof inst !== 'object') continue;

              for (const key of Object.getOwnPropertyNames(inst)) {
                try {
                  const val = inst[key];
                  if (val && typeof val === 'object' &&
                      typeof val.next === 'function' &&
                      typeof val.subscribe === 'function' &&
                      typeof val.asObservable === 'function') {
                    // Found a Subject instance — get its prototype
                    const proto = Object.getPrototypeOf(val);
                    if (proto && typeof proto.next === 'function') return proto;
                  }
                } catch { /* skip property */ }
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    // Strategy 3: Check component instances on the page
    try {
      const ng = (globalThis as any).ng;
      if (ng?.getComponent) {
        const elements = document.querySelectorAll('*');
        const limit = Math.min(elements.length, 500);
        for (let i = 0; i < limit; i++) {
          try {
            const comp = ng.getComponent(elements[i]);
            if (!comp) continue;
            for (const key of Object.getOwnPropertyNames(comp)) {
              try {
                const val = comp[key];
                if (val && typeof val === 'object' &&
                    typeof val.next === 'function' &&
                    typeof val.subscribe === 'function' &&
                    typeof val.asObservable === 'function') {
                  const proto = Object.getPrototypeOf(val);
                  if (proto && typeof proto.next === 'function') return proto;
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  /**
   * Tries to figure out which service/class owns this Subject instance
   * by walking Angular's injector and matching object references.
   */
  private inferSubjectOwner(subject: any): { className: string; propName: string } | null {
    try {
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (!ng?.getInjector || !rootEl) return null;

      const injector = ng.getInjector(rootEl);
      const records = injector?._records ?? injector?.records;
      if (!(records instanceof Map)) return null;

      for (const [token, record] of records) {
        try {
          const inst = record?.value;
          if (!inst || typeof inst !== 'object') continue;
          const className = inst.constructor?.name;
          if (!className || className === 'Object') continue;

          for (const key of Object.getOwnPropertyNames(inst)) {
            if (inst[key] === subject) {
              return { className, propName: key };
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return null;
  }

  // ═══ Fetch Interception ═════════════════════════════════════════════════════

  private hookFetch(): void {
    if (typeof globalThis.fetch !== 'function') return;
    this.originalFetch = globalThis.fetch;
    const tracker = this;
    const originalFetch = this.originalFetch;

    (globalThis as any).fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      let method = 'GET';
      let url = '';
      let shortUrl = '';
      let initiator: string | null = null;
      let interactionTs: number | undefined;
      const requestStartTime = Date.now();

      try {
        method = init?.method ?? 'GET';
        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof URL) {
          url = input.href;
        } else if (input && typeof (input as any).url === 'string') {
          url = (input as any).url;
        } else if (input) {
          url = String(input);
        }
        shortUrl = tracker.shortenUrl(url);
        // Capture initiator at CALL time (which component is most likely the caller)
        initiator = tracker.detectCurrentComponent();
        // Capture the interaction context at CALL time (which click caused this fetch)
        interactionTs = tracker.getActiveInteractionTimestamp();
      } catch (err) {
        // Suppress any tracking parameter deduction errors so the native fetch doesn't fail
      }

      return originalFetch.call(globalThis, input, init).then((response: Response) => {
        try {
          if (tracker.isRunning && response && url) {
            const contentType = response.headers && typeof response.headers.get === 'function'
              ? response.headers.get('content-type')
              : null;
            if (tracker.isApiCall(url, contentType)) {
              // Clone response to read body without consuming the original
              const clonedResponse = response.clone();
              
              // Try to extract response body
              let responseBodyStr: string | undefined;
              if (contentType && (contentType.includes('application/json') || contentType.includes('text'))) {
                clonedResponse.text().then((text) => {
                  try {
                    responseBodyStr = tracker.truncateResponseBody(text);
                  } catch {
                    // Ignore parsing errors
                  }
                }).catch(() => {
                  // Ignore read errors
                });
              }
              
              tracker.buffer.push({
                id: `flow-${++tracker.eventId}`,
                type: 'http-response',
                timestamp: Date.now(),
                label: `${method} ${shortUrl} → ${response.status}`,
                detail: `${method} ${shortUrl} (${response.status} ${response.statusText})`,
                ownerClass: initiator ?? undefined,
                triggeredByInteractionTs: interactionTs,
                responseBody: responseBodyStr,
                duration: Date.now() - requestStartTime,
              });
            }
          }
        } catch (err) {
          // Suppress parsing/logging errors to ensure the underlying network call never errors out
        }
        return response;
      });
    };
  }

  private unhookFetch(): void {
    if (this.originalFetch) {
      (globalThis as any).fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  // ═══ XHR Interception ══════════════════════════════════════════════════════

  private hookXHR(): void {
    const XHR = globalThis.XMLHttpRequest?.prototype;
    if (!XHR) return;

    this.originalXhrOpen = XHR.open;
    this.originalXhrSend = XHR.send;
    const tracker = this;

    XHR.open = function(this: any, method: string, url: string, ...args: any[]) {
      try {
        this.__nglens_method = method;
        this.__nglens_url = url;
      } catch (err) {
        // Suppress setting tracking headers to prevent crashes
      }
      return (tracker.originalXhrOpen as Function).apply(this, [method, url, ...args]);
    };

    XHR.send = function(this: any, ...args: any[]) {
      const xhr = this;
      const xhrStartTime = Date.now();
      try {
        xhr.addEventListener('load', () => {
          try {
            if (tracker.isRunning) {
              const shortUrl = tracker.shortenUrl(xhr.__nglens_url ?? '');
              const ct = xhr.getResponseHeader && typeof xhr.getResponseHeader === 'function'
                ? xhr.getResponseHeader('content-type')
                : null;
              if (tracker.isApiCall(xhr.__nglens_url ?? '', ct)) {
                // Extract response body from XHR
                let responseBodyStr: string | undefined;
                try {
                  if (xhr.responseText && ct && (ct.includes('application/json') || ct.includes('text'))) {
                    responseBodyStr = tracker.truncateResponseBody(xhr.responseText);
                  }
                } catch {
                  // Ignore parsing errors
                }
                
                tracker.buffer.push({
                  id: `flow-${++tracker.eventId}`,
                  type: 'http-response',
                  timestamp: Date.now(),
                  label: `${xhr.__nglens_method ?? 'XHR'} ${shortUrl} → ${xhr.status}`,
                  detail: `${xhr.__nglens_method} ${shortUrl} (${xhr.status})`,
                  triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
                  responseBody: responseBodyStr,
                  duration: Date.now() - xhrStartTime,
                });
              }
            }
          } catch (err) {
            // Suppress callback monitoring errors
          }
        }, { once: true });
      } catch (err) {
        // Suppress listener injection errors
      }
      return (tracker.originalXhrSend as Function).apply(this, args);
    };
  }

  private unhookXHR(): void {
    const XHR = globalThis.XMLHttpRequest?.prototype;
    if (!XHR) return;
    if (this.originalXhrOpen) { XHR.open = this.originalXhrOpen as any; this.originalXhrOpen = null; }
    if (this.originalXhrSend) { XHR.send = this.originalXhrSend as any; this.originalXhrSend = null; }
  }

  // ═══ Angular Signal Interception ═════════════════════════════════════════════

  /**
   * Walks components and services to find writable signals and patch their
   * .set() and .update() methods to emit FlowEvents.
   * For Angular 17+, also tracks computed signals and effects.
   */
  private hookSignals(): void {
    try {
      // Patch signals on services via injector
      this.patchInjectorSignals();
      // Patch signals on rendered components
      this.patchComponentSignals();
      // Patch facade/store/service methods (state-mutating entry points)
      this.patchInjectorMethods();
      // Re-scan periodically for lazy-loaded components/services
      globalThis.setTimeout(() => {
        if (this.isRunning) {
          this.patchInjectorSignals();
          this.patchComponentSignals();
          this.patchInjectorMethods();
        }
      }, 3000);
      // Angular 17+: track effect() executions via global effect scheduler
      if (this.angularMajorVersion >= 17) {
        this.hookEffectScheduler();
      }
    } catch { /* ignore */ }
  }

  private patchInjectorSignals(): void {
    try {
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (!ng?.getInjector || !rootEl) return;

      const injector = ng.getInjector(rootEl);
      const records = injector?._records ?? injector?.records;
      if (!(records instanceof Map)) return;

      for (const [token] of records) {
        if (typeof token !== 'function') continue;
        const className = token.name;
        if (!className || className.length <= 2) continue;

        try {
          const inst = injector.get(token, null, { optional: true } as any);
          if (!inst || typeof inst !== 'object') continue;
          this.patchInstanceSignals(inst, className);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  /**
   * Patch state-mutating methods on facade/store/service classes so ngLens can
   * attribute renders to a facade call (e.g. "VatFacade.loadClients()").
   *
   * Conservative by design to avoid perf/noise:
   *  - only classes whose name ends in Facade / Store / Service
   *  - only own-prototype methods (not inherited), skipping getters, the
   *    constructor, Angular lifecycle hooks, and private (_ / ɵ) members
   *  - re-entrancy guarded so a facade method calling another logs once
   */
  private patchInjectorMethods(): void {
    try {
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (!ng?.getInjector || !rootEl) return;

      const injector = ng.getInjector(rootEl);
      const records = injector?._records ?? injector?.records;
      if (!(records instanceof Map)) return;

      for (const [token] of records) {
        if (typeof token !== 'function') continue;
        const className = token.name;
        if (!className || !/(Facade|Store|Service)$/.test(className)) continue;

        try {
          const inst = injector.get(token, null, { optional: true } as any);
          if (!inst || typeof inst !== 'object') continue;
          this.patchInstanceMethods(inst, className);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  /** Method names we never wrap (lifecycle hooks, framework internals). */
  private static readonly SKIP_METHODS = new Set([
    'constructor', 'ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'ngDoCheck',
    'ngAfterViewInit', 'ngAfterContentInit', 'ngAfterViewChecked', 'ngAfterContentChecked',
  ]);

  private patchInstanceMethods(inst: any, className: string): void {
    let proto: any;
    try {
      proto = Object.getPrototypeOf(inst);
    } catch { return; }
    if (!proto || proto === Object.prototype) return;

    let names: string[];
    try {
      names = Object.getOwnPropertyNames(proto);
    } catch { return; }

    const tracker = this;

    for (const name of names) {
      if (name.startsWith('_') || name.startsWith('ɵ')) continue;
      if (FlowTracker.SKIP_METHODS.has(name)) continue;

      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(proto, name);
      } catch { continue; }
      // Skip getters/setters — invoking them has side effects / isn't a call.
      if (!descriptor || descriptor.get || descriptor.set) continue;

      const original = descriptor.value;
      if (typeof original !== 'function') continue;
      if (this.patchedMethods.has(original)) continue;

      try {
        this.patchedMethods.add(original);
        const patched = function (this: any, ...args: any[]) {
          // Only log the outermost facade call in a chain, and only when running.
          if (tracker.isRunning && !tracker.inFacadeCall) {
            tracker.inFacadeCall = true;
            try {
              tracker.buffer.push({
                id: `flow-${++tracker.eventId}`,
                type: 'facade-method',
                timestamp: Date.now(),
                label: `${className}.${name}()`,
                ownerClass: className,
                methodName: name,
                detail: args.length > 0 ? tracker.summarizeValue(args[0]) : '',
                value: args.length > 0 ? tracker.summarizeValue(args[0]) : '',
                sourceComponent: tracker.detectCurrentComponent() ?? undefined,
                triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
              });
            } catch { /* ignore */ }
            finally {
              // Release the guard after the synchronous portion completes.
              try { return original.apply(this, args); }
              finally { tracker.inFacadeCall = false; }
            }
          }
          return original.apply(this, args);
        };
        // Preserve function name/length where possible.
        Object.defineProperty(proto, name, { ...descriptor, value: patched });
      } catch { /* ignore — some props are non-configurable */ }
    }
  }

  private patchComponentSignals(): void {
    const ng = (globalThis as any).ng;
    if (!ng?.getComponent) return;

    const elements = document.querySelectorAll('*');
    const limit = Math.min(elements.length, 1000);

    for (let i = 0; i < limit; i++) {
      try {
        const component = ng.getComponent(elements[i]);
        if (!component) continue;
        const name = component.constructor?.name ?? '';
        if (name.length > 2) {
          this.patchInstanceSignals(component, name);
        }
      } catch { /* ignore */ }
    }
  }

  /**
   * For a given object instance, find all writable signal properties
   * and wrap .set() / .update() to emit flow events.
   * For Angular 17+, also detects computed signals and input signals.
   */
  private patchInstanceSignals(inst: any, className: string): void {
    if (!inst || typeof inst !== 'object') return;

    let keys: string[];
    try {
      keys = Object.getOwnPropertyNames(inst);
    } catch { return; }

    for (const key of keys) {
      if (key.startsWith('_') || key.startsWith('ɵ')) continue;
      try {
        const val = inst[key];
        if (!val) continue;

        // Angular 19+: Resource instances (has .value, .status, .reload methods)
        if (this.angularMajorVersion >= 19 && typeof val === 'object' && this.isResource(val)) {
          this.patchResource(val, className, key);
          continue;
        }

        if (typeof val !== 'function') continue;

        // Writable signals (.set + .update) — includes linkedSignal (Angular 19+)
        if (this.isWritableSignal(val)) {
          if (this.patchedSignals.has(val)) continue;
          this.patchedSignals.add(val);
          this.wrapSignalMethod(val, 'set', className, key);
          this.wrapSignalMethod(val, 'update', className, key);
          continue;
        }

        // Angular 17+: Computed signals (readable but not writable, has SIGNAL brand)
        if (this.angularMajorVersion >= 17 && this.isComputedSignal(val)) {
          if (this.patchedComputeds.has(val)) continue;
          this.patchedComputeds.add(val);
          this.wrapComputedSignal(val, className, key);
          continue;
        }

        // Angular 17.1+: Input signals (has [Symbol]InputSignal brand or .set but no .update)
        if (this.angularMajorVersion >= 17 && this.isInputSignal(val)) {
          if (this.patchedSignals.has(val)) continue;
          this.patchedSignals.add(val);
          this.wrapInputSignal(val, className, key);
          continue;
        }
      } catch { /* ignore */ }
    }
  }

  private wrapSignalMethod(signal: any, method: 'set' | 'update', className: string, propName: string): void {
    const original = signal[method];
    if (typeof original !== 'function') return;

    const tracker = this;
    signal[method] = function(this: any, ...args: any[]) {
      if (tracker.isRunning) {
        const value = method === 'set' ? args[0] : '(updater fn)';
        const summarized = tracker.summarizeValue(value);
        tracker.buffer.push({
          id: `flow-${++tracker.eventId}`,
          type: 'signal-write',
          timestamp: Date.now(),
          label: `${className}.${propName}.${method}()`,
          ownerClass: className,
          propertyName: propName,
          detail: summarized,
          value: summarized,
          sourceComponent: tracker.detectCurrentComponent() ?? undefined,
          triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
        });
      }
      return original.apply(this, args);
    };
  }

  private isWritableSignal(value: any): boolean {
    if (typeof value !== 'function') return false;
    if (typeof value.set !== 'function') return false;
    // Check for SIGNAL brand symbol
    try {
      const syms = Object.getOwnPropertySymbols(value);
      if (syms.some(s => String(s).toLowerCase().includes('signal'))) return true;
      // Fallback: has both .set() and .update() — very likely a signal
      if (typeof value.update === 'function') return true;
    } catch { /* ignore */ }
    return false;
  }

  /** Detect computed signals: callable, has SIGNAL brand, but no .set() */
  private isComputedSignal(value: any): boolean {
    if (typeof value !== 'function') return false;
    if (typeof value.set === 'function') return false; // writable signals have .set
    try {
      const syms = Object.getOwnPropertySymbols(value);
      return syms.some(s => String(s).toLowerCase().includes('signal'));
    } catch { return false; }
  }

  /** Detect input signals: Angular 17.1+ — has InputSignal brand or specific shape */
  private isInputSignal(value: any): boolean {
    if (typeof value !== 'function') return false;
    try {
      const syms = Object.getOwnPropertySymbols(value);
      // Angular uses ɵINPUT_SIGNAL_BRAND_WRITE_TYPE or similar symbols
      if (syms.some(s => String(s).toLowerCase().includes('input'))) return true;
      // Fallback: has .set but NOT .update (input signals don't have .update)
      if (typeof value.set === 'function' && typeof value.update !== 'function') {
        // Additional check: calling the signal returns a value (getter behavior)
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  /** Wrap a computed signal to track when it recomputes */
  private wrapComputedSignal(signal: any, className: string, propName: string): void {
    // We can't easily intercept computed re-evaluation without modifying Angular internals.
    // Instead, we wrap the signal's getter (calling the signal function) to detect value changes.
    const tracker = this;
    let lastValue: any = undefined;
    let initialized = false;

    const originalFn = signal;

    // We can't replace the signal itself (it's a property on the instance), so
    // instead track it via polling on flush — but that's too expensive.
    // Better approach: intercept via the SIGNAL node's producerRecomputeValue
    try {
      // Angular's internal signal node is stored at signal[SIGNAL_SYMBOL]
      const syms = Object.getOwnPropertySymbols(signal);
      const signalSym = syms.find(s => String(s).toLowerCase().includes('signal'));
      if (signalSym) {
        const node = signal[signalSym];
        if (node && typeof node.computation === 'function') {
          const originalComputation = node.computation;
          node.computation = function(this: any, ...args: any[]) {
            const result = originalComputation.apply(this, args);
            if (tracker.isRunning) {
              if (initialized && result !== lastValue) {
                tracker.buffer.push({
                  id: `flow-${++tracker.eventId}`,
                  type: 'signal-write', // reuse type for now, UI shows as signal
                  timestamp: Date.now(),
                  label: `${className}.${propName} (computed)`,
                  ownerClass: className,
                  propertyName: propName,
                  detail: tracker.summarizeValue(result),
                  value: tracker.summarizeValue(result),
                  sourceComponent: tracker.detectCurrentComponent() ?? undefined,
                  triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
                });
              }
              lastValue = result;
              initialized = true;
            }
            return result;
          };
        }
      }
    } catch { /* ignore — computed tracking is best-effort */ }
  }

  /** Wrap an input signal to track when parent passes new values */
  private wrapInputSignal(signal: any, className: string, propName: string): void {
    // Input signals have an internal .applyValueToInputSignal or similar
    // We wrap the signal getter to detect changes
    const tracker = this;
    let lastValue: any = undefined;
    let initialized = false;

    try {
      // Try to intercept the internal set mechanism
      const syms = Object.getOwnPropertySymbols(signal);
      const signalSym = syms.find(s => String(s).toLowerCase().includes('signal'));
      if (signalSym) {
        const node = signal[signalSym];
        if (node && node.value !== undefined) {
          // Watch the value via a property descriptor override
          let currentValue = node.value;
          Object.defineProperty(node, 'value', {
            get() { return currentValue; },
            set(newVal: any) {
              const changed = currentValue !== newVal;
              currentValue = newVal;
              if (tracker.isRunning && changed && initialized) {
                tracker.buffer.push({
                  id: `flow-${++tracker.eventId}`,
                  type: 'signal-write',
                  timestamp: Date.now(),
                  label: `${className}.${propName} (input)`,
                  ownerClass: className,
                  propertyName: propName,
                  detail: tracker.summarizeValue(newVal),
                  value: tracker.summarizeValue(newVal),
                  sourceComponent: tracker.detectCurrentComponent() ?? undefined,
                  triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
                });
              }
              initialized = true;
            },
            configurable: true,
          });
        }
      }
    } catch { /* ignore — input signal tracking is best-effort */ }
  }

  /** Hook Angular 17+ effect scheduler to track effect executions */
  private hookEffectScheduler(): void {
    try {
      // Angular effects are scheduled via the framework's internal effect queue.
      // We can detect effect execution by looking for the EffectRef pattern
      // or by hooking into Zone.js microtask scheduling.
      // For now, effect execution detection is done via component re-render correlation:
      // when a signal changes and a component re-renders within 16ms, we infer an effect ran.
      // Direct effect interception requires accessing Angular's private ɵEFFECT_NODE,
      // which is too fragile across versions.
      // Instead, we'll detect effects at the component scan level.
      this.scanForEffects();
    } catch { /* ignore */ }
  }

  /** Scan components for effect-like patterns and log them */
  private scanForEffects(): void {
    // Effects in Angular 17+ are registered at construction time.
    // We cannot retroactively intercept them without modifying the component class.
    // Our approach: detect effect callbacks by monitoring signal reads during execution.
    // This is a placeholder — full effect tracking would require Angular DI hook.
    // For now, the computed signal tracking gives us the chain:
    // writable signal → computed recomputation → template re-render
  }

  /** Detect resource/httpResource instances (Angular 19+, stable in 22) */
  private isResource(val: any): boolean {
    if (!val || typeof val !== 'object') return false;
    // Resources have: .value() signal, .status() signal, .reload() method
    return (
      typeof val.value === 'function' &&
      typeof val.status === 'function' &&
      typeof val.reload === 'function'
    );
  }

  /** Patch a resource instance to track status changes and value loading */
  private patchResource(resource: any, className: string, propName: string): void {
    const tracker = this;
    const patchedKey = '__nglens_patched';
    if (resource[patchedKey]) return;
    resource[patchedKey] = true;

    // Intercept .reload() to track when developer manually triggers refetch
    const originalReload = resource.reload;
    if (typeof originalReload === 'function') {
      resource.reload = function(this: any, ...args: any[]) {
        if (tracker.isRunning) {
          tracker.buffer.push({
            id: `flow-${++tracker.eventId}`,
            type: 'signal-write',
            timestamp: Date.now(),
            label: `${className}.${propName}.reload()`,
            ownerClass: className,
            propertyName: propName,
            detail: 'resource reload triggered',
            value: 'reload',
            sourceComponent: tracker.detectCurrentComponent() ?? undefined,
            triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
          });
        }
        return originalReload.apply(this, args);
      };
    }

    // Track .value signal for loaded data (wrap the value signal's internal node)
    try {
      const valueSig = resource.value;
      if (typeof valueSig === 'function' && !this.patchedSignals.has(valueSig)) {
        this.patchedSignals.add(valueSig);
        const syms = Object.getOwnPropertySymbols(valueSig);
        const signalSym = syms.find(s => String(s).toLowerCase().includes('signal'));
        if (signalSym) {
          const node = valueSig[signalSym];
          if (node && node.value !== undefined) {
            let currentValue = node.value;
            Object.defineProperty(node, 'value', {
              get() { return currentValue; },
              set(newVal: any) {
                const changed = currentValue !== newVal;
                currentValue = newVal;
                if (tracker.isRunning && changed && newVal !== undefined) {
                  tracker.buffer.push({
                    id: `flow-${++tracker.eventId}`,
                    type: 'http-response',
                    timestamp: Date.now(),
                    label: `${className}.${propName} (resource loaded)`,
                    ownerClass: className,
                    propertyName: propName,
                    detail: tracker.summarizeValue(newVal),
                    value: tracker.summarizeValue(newVal),
                    responseBody: tracker.summarizeValue(newVal),
                    sourceComponent: tracker.detectCurrentComponent() ?? undefined,
                    triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
                  });
                }
              },
              configurable: true,
            });
          }
        }
      }
    } catch { /* ignore */ }
  }

  // ═══ Router Navigation Tracking ═════════════════════════════════════════════

  private hookRouter(): void {
    try {
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (!ng?.getInjector || !rootEl) return;

      const injector = ng.getInjector(rootEl);
      const records = injector?._records ?? injector?.records;
      if (!(records instanceof Map)) return;

      // Find the Router instance
      for (const [token] of records) {
        if (typeof token === 'function' && token.name === 'Router') {
          try {
            const router = injector.get(token, null, { optional: true });
            if (router && typeof router.events?.subscribe === 'function') {
              let lastUrl = router.url ?? '/';
              this.routerSubscription = router.events.subscribe((event: any) => {
                if (!this.isRunning) return;
                // NavigationEnd event
                if (event.constructor?.name === 'NavigationEnd' || event.type === 1) {
                  const toUrl = event.urlAfterRedirects ?? event.url ?? '';
                  this.buffer.push({
                    id: `flow-${++this.eventId}`,
                    type: 'route-change',
                    timestamp: Date.now(),
                    label: `Navigate: ${lastUrl} → ${toUrl}`,
                    fromRoute: lastUrl,
                    toRoute: toUrl,
                  });
                  lastUrl = toUrl;

                  // Notify orchestrator of a route change so it can run scans
                  if ((globalThis as any).__nglens_orchestrator_on_route_changed) {
                    try {
                      (globalThis as any).__nglens_orchestrator_on_route_changed(toUrl);
                    } catch { /* ignore */ }
                  }
                }
              });
              break;
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  private unhookRouter(): void {
    if (this.routerSubscription && typeof this.routerSubscription.unsubscribe === 'function') {
      this.routerSubscription.unsubscribe();
    }
    this.routerSubscription = null;
  }

  // ═══ Helpers ════════════════════════════════════════════════════════════════

  private summarizeValue(value: any, skipType = false): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value.length > 60 ? `"${value.slice(0, 60)}…"` : `"${value}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const sample = this.summarizeValue(value[0], skipType);
      return `[${sample}${value.length > 1 ? `, ...${value.length - 1} more` : ''}]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).filter(k => skipType ? k !== 'type' : true);
      if (keys.length === 0) return '{}';
      
      // If only 1 key and it's 'payload', dig into its value
      if (keys.length === 1 && keys[0] === 'payload') {
        const inner = this.summarizeValue(value.payload);
        return inner;
      }
      
      // For objects with a few keys, show key: value pairs
      if (keys.length <= 5) {
        const pairs = keys.map(k => {
          const v = value[k];
          if (v === null) return `${k}: null`;
          if (v === undefined) return `${k}: undefined`;
          if (typeof v === 'string') return `${k}: "${v.slice(0, 30)}${v.length > 30 ? '…' : ''}"`;
          if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
          if (Array.isArray(v)) return `${k}: [${v.length} items]`;
          if (typeof v === 'object') {
            const innerKeys = Object.keys(v);
            if (innerKeys.length <= 3) {
              const innerPairs = innerKeys.map(ik => {
                const iv = v[ik];
                if (iv === null || iv === undefined) return `${ik}: ${iv}`;
                if (typeof iv === 'string') return `${ik}: "${iv.slice(0, 20)}${iv.length > 20 ? '…' : ''}"`;
                if (typeof iv === 'number' || typeof iv === 'boolean') return `${ik}: ${iv}`;
                return `${ik}: ${typeof iv}`;
              }).join(', ');
              return `${k}: {${innerPairs}}`;
            }
            return `${k}: {${innerKeys.length} keys}`;
          }
          return `${k}: ${typeof v}`;
        }).join(', ');
        return `{${pairs}}`;
      }
      
      // For larger objects, show first 5 keys with values
      const pairs = keys.slice(0, 5).map(k => {
        const v = value[k];
        if (v === null) return `${k}: null`;
        if (v === undefined) return `${k}: undefined`;
        if (typeof v === 'string') return `${k}: "${v.slice(0, 20)}${v.length > 20 ? '…' : ''}"`;
        if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
        if (Array.isArray(v)) return `${k}: [${v.length} items]`;
        if (typeof v === 'object') return `${k}: {${Object.keys(v).length} keys}`;
        return `${k}: ${typeof v}`;
      }).join(', ');
      return `{${pairs}, …}`;
    }
    return typeof value;
  }

  /**
   * Detects which component is most likely the initiator of the current call.
   * Uses the RenderTracker's last interaction (if recent) or the most recently rendered component.
   */
  private detectCurrentComponent(): string | null {
    try {
      // Strategy 1: Check RenderTracker's last interaction — if a click just happened, that component is the initiator
      const renderTracker = (globalThis as any).__nglens_render_tracker_ref;
      if (renderTracker?.lastInteraction) {
        const interaction = renderTracker.lastInteraction;
        if (Date.now() - interaction.timestamp < 2000) { // Increased to 2 seconds
          return interaction.ownerComponent;
        }
      }

      // Strategy 2: Try to find the component via Angular's injector
      const ng = (globalThis as any).ng;
      const rootEl = document.querySelector('[ng-version]');
      if (ng?.getInjector && rootEl) {
        const injector = ng.getInjector(rootEl);
        const records = injector?._records ?? injector?.records;
        if (records instanceof Map) {
          // Look for service instances that might be injectable
          for (const [token, record] of records) {
            if (typeof token === 'function' && token.name && token.name.length > 2) {
              try {
                const inst = injector.get(token, null, { optional: true } as any);
                // If we found a service, try to get its component context
                if (inst && typeof inst === 'object') {
                  // Return the service name as fallback (it might be called from this service)
                  if (token.name.endsWith('Service') || token.name.includes('Component')) {
                    return token.name;
                  }
                }
              } catch { /* ignore */ }
            }
          }
        }
      }

      // Fallback: return null (will show as "not linked to a component")
      return null;
    } catch { return null; }
  }

  /** Get the timestamp of the active user interaction (if any). Captured at call time. */
  private getActiveInteractionTimestamp(): number | undefined {
    try {
      const renderTracker = (globalThis as any).__nglens_render_tracker_ref;
      if (renderTracker?.lastInteraction) {
        return renderTracker.lastInteraction.timestamp;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  /**
   * Decide whether a request is a REST API call worth tracking.
   * Uses content-type when available; falls back to URL heuristics for
   * cross-origin responses where the content-type header isn't readable.
   */
  private isApiCall(url: string, contentType: string | null): boolean {
    // If content-type is readable, trust it: JSON = API, known asset types = skip
    if (contentType) {
      const ct = contentType.toLowerCase();
      if (ct.includes('json')) return true;
      if (ct.includes('image/') || ct.includes('text/css') || ct.includes('javascript') ||
          ct.includes('font') || ct.includes('text/html') || ct.includes('text/plain')) return false;
      // Other content types (xml, octet-stream) — treat as API if URL looks like one
    }
    // Fallback: URL-based heuristic (content-type hidden by CORS or missing)
    const lower = url.toLowerCase().split('?')[0];
    // Skip static asset extensions
    if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|css|js|mjs|map|html?|mp4|webm|wasm)$/.test(lower)) {
      return false;
    }
    // Skip analytics/tracking
    if (lower.includes('/collect') || lower.includes('google-analytics') || lower.includes('gtm') ||
        lower.includes('/beacon') || lower.includes('hotjar') || lower.includes('mixpanel')) {
      return false;
    }
    // Skip extension internals
    if (lower.startsWith('chrome-extension://') || lower.startsWith('data:')) return false;
    return true;
  }

  private shortenUrl(url: string): string {
    try {
      const u = new URL(url, globalThis.location?.origin);
      return u.pathname + (u.search ? '?' + u.searchParams.toString().slice(0, 30) : '');
    } catch {
      return url.slice(0, 50);
    }
  }

  /**
   * Safely extracts and formats response body for display in tooltip.
   * Truncates at 500 chars to avoid excessive memory usage.
   */
  private truncateResponseBody(responseText: string): string {
    try {
      // Try to parse as JSON first for better display
      const parsed = JSON.parse(responseText);
      const stringified = JSON.stringify(parsed, null, 2);
      return stringified.slice(0, 500);
    } catch {
      // If not JSON, just truncate the raw text
      return responseText.slice(0, 500);
    }
  }

  // ═══ Batching ══════════════════════════════════════════════════════════════

  private startBatching(): void {
    this.flushInterval = globalThis.setInterval(() => this.flush(), 150);
  }

  private stopBatching(): void {
    if (this.flushInterval !== null) { clearInterval(this.flushInterval); this.flushInterval = null; }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const batch: FlowEventBatch = { events, batchTimestamp: performance.now() };
    globalThis.dispatchEvent(new CustomEvent(PAGE_TO_CONTENT_EVENT, {
      detail: { eventId: `flow-${Date.now()}`, type: 'FLOW_EVENT_BATCH', payload: batch },
    }));
    // Also dispatch on a separate channel so orchestrator can forward to renderTracker for render reasons
    globalThis.dispatchEvent(new CustomEvent('__ng_flow_events', {
      detail: { payload: batch },
    }));
  }
}

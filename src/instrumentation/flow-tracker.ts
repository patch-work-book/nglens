/**
 * Flow Tracker — intercepts reactive state changes (RxJS subjects, signals, HTTP, routes)
 * to show developers the complete data flow that triggers re-renders.
 *
 * Captures:
 * - Subject.next() / BehaviorSubject.next() calls
 * - Signal .set() / .update() calls
 * - HTTP responses (fetch/XHR completions)
 * - Router navigation events
 */

import type { FlowEvent, FlowEventBatch } from '../types/render-events';

const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

export class FlowTracker {
  private static instance: FlowTracker | null = null;
  private readonly buffer: FlowEvent[] = [];
  private isRunning = false;
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private eventId = 0;

  // Original prototypes for cleanup
  private originalSubjectNext: Function | null = null;
  private patchedSubjectProto: any = null;
  private originalFetch: typeof fetch | null = null;
  private originalXhrOpen: Function | null = null;
  private originalXhrSend: Function | null = null;
  private routerSubscription: any = null;
  // Track which signal instances we've already patched (avoid double-patching)
  private patchedSignals = new WeakSet<object>();
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
    this.isRunning = false;
  }

  clear(): void {
    this.buffer.length = 0;
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

          // Detect NgRx store dispatch: value is an action object with a `type` string
          const isNgrxAction = value && typeof value === 'object' && typeof value.type === 'string'
            && value.type.length > 2 && value.type.includes(']');

          let label: string;
          let detail: string;

          if (isNgrxAction) {
            label = `Store: ${value.type}`;
            detail = tracker.summarizeValue(value, true);
          } else {
            label = ownerInfo
              ? `${ownerInfo.className}.${ownerInfo.propName}.next()`
              : 'Subject.next()';
            detail = tracker.summarizeValue(value);
          }

          tracker.buffer.push({
            id: `flow-${++tracker.eventId}`,
            type: 'subject-emit',
            timestamp: Date.now(),
            label,
            ownerClass: isNgrxAction ? 'Store' : ownerInfo?.className,
            propertyName: isNgrxAction ? value.type : ownerInfo?.propName,
            detail,
            value: detail,
            sourceComponent: tracker.detectCurrentComponent() ?? undefined,
            triggeredByInteractionTs: tracker.getActiveInteractionTimestamp(),
          });
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
   */
  private hookSignals(): void {
    try {
      // Patch signals on services via injector
      this.patchInjectorSignals();
      // Patch signals on rendered components
      this.patchComponentSignals();
      // Re-scan periodically for lazy-loaded components/services
      globalThis.setTimeout(() => {
        if (this.isRunning) {
          this.patchInjectorSignals();
          this.patchComponentSignals();
        }
      }, 3000);
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
        if (!this.isWritableSignal(val)) continue;
        if (this.patchedSignals.has(val)) continue;
        this.patchedSignals.add(val);

        this.wrapSignalMethod(val, 'set', className, key);
        this.wrapSignalMethod(val, 'update', className, key);
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
      return `[${sample}${value.length > 1 ? ', ...' : ''}]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).filter(k => skipType ? k !== 'type' : true);
      if (keys.length === 0) return '{}';
      
      // For objects with a few keys, show key: value pairs
      if (keys.length <= 5) {
        const pairs = keys.map(k => {
          const v = value[k];
          if (v === null) return `${k}: null`;
          if (v === undefined) return `${k}: undefined`;
          if (typeof v === 'string') return `${k}: "${v.slice(0, 30)}${v.length > 30 ? '…' : ''}"`;
          if (typeof v === 'number' || typeof v === 'boolean') return `${k}: ${v}`;
          if (Array.isArray(v)) return `${k}: [${v.length} items]`;
          if (typeof v === 'object') return `${k}: {...}`;
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
        if (typeof v === 'object') return `${k}: {...}`;
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
  }
}

/**
 * E2E harness entry — bundles the REAL ngLens instrumentation and exposes it
 * to the Playwright test. Runs the actual RenderTracker/FlowTracker singletons
 * (the exact production code) so the test measures real behavior.
 *
 * IMPORTANT: the tracker flushes its internal eventBuffer every 100ms via a
 * CustomEvent (EVENT_BATCH on __ng_perf_to_content) and DRAINS the buffer. So
 * reading getBuffer() after a wait sees an emptied buffer. To measure what
 * ngLens actually REPORTS, we accumulate the emitted batches here — this is the
 * exact data the content script / panel would receive.
 */
import { RenderTracker } from '../src/instrumentation/render-tracker';
import { FlowTracker } from '../src/instrumentation/flow-tracker';

interface CapturedRenderEvent { componentName: string; depth?: number; causes: any[]; timestamp?: number; }

declare global {
  interface Window {
    __nglensE2E: {
      start: () => void;
      stop: () => void;
      getRenderEvents: () => CapturedRenderEvent[];
      getNgLensCounts: () => Record<string, number>;
      getGroundTruth: () => Record<string, number>;
      reset: () => void;
    };
    __gtRender: (name: string) => void;
  }
}

const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';
const SAME_CYCLE_MS = 50; // must match cascade-tree.ts

// ── Ground-truth capture ──
const groundTruth: Record<string, number> = {};
window.__gtRender = (name: string) => {
  groundTruth[name] = (groundTruth[name] ?? 0) + 1;
};

const renderTracker = RenderTracker.getInstance();
const flowTracker = FlowTracker.getInstance();

// ── Capture the REAL emitted render events (survives the 100ms flush/drain) ──
const capturedEvents: CapturedRenderEvent[] = [];
window.addEventListener(PAGE_TO_CONTENT_EVENT, (e: Event) => {
  const detail = (e as CustomEvent).detail;
  if (detail?.type === 'EVENT_BATCH' && detail.payload?.events) {
    for (const ev of detail.payload.events as CapturedRenderEvent[]) {
      capturedEvents.push({
        componentName: ev.componentName,
        depth: ev.depth,
        causes: ev.causes,
        timestamp: ev.timestamp,
      });
    }
  }
});

/** Coalesce captured ngLens events the same way buildCascadeTree does. */
function coalesceCounts(events: CapturedRenderEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const lastTs = new Map<string, number>();
  // Sort by timestamp so coalescing window is applied in order.
  const sorted = [...events].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  for (const e of sorted) {
    if (e.componentName.length <= 2) continue; // minified filter (matches production)
    const t = e.timestamp ?? 0;
    const prev = lastTs.get(e.componentName);
    const distinct = prev == null || t - prev >= SAME_CYCLE_MS;
    if (distinct) {
      counts[e.componentName] = (counts[e.componentName] ?? 0) + 1;
      lastTs.set(e.componentName, t);
    }
  }
  return counts;
}

window.__nglensE2E = {
  start: () => {
    renderTracker.start();
    flowTracker.start();
  },
  stop: () => {
    renderTracker.stop();
    flowTracker.stop();
  },
  getRenderEvents: () => [...capturedEvents],
  getNgLensCounts: () => coalesceCounts(capturedEvents),
  getGroundTruth: () => ({ ...groundTruth }),
  reset: () => {
    renderTracker.clearBuffer();
    capturedEvents.length = 0;
    for (const k of Object.keys(groundTruth)) delete groundTruth[k];
  },
};

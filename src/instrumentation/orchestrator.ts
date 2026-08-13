/**
 * Instrumentation Orchestrator — coordinates all page-script detectors.
 *
 * Listens for CustomEvents from the content script (forwarded panel commands)
 * and manages the lifecycle of all instrumentation modules:
 * - RenderTracker: records change detection cycles
 * - LeakDetector: tracks component lifecycle and detects leaks
 * - PerformanceGuard: monitors instrumentation overhead
 * - TrackByDetector: identifies missing trackBy in ngFor
 * - OnPushEngine: evaluates OnPush suitability
 * - SelectiveAnalyzer: gates deep analysis to selected component
 * - checkAngularVersion: verifies Angular 17+ support
 */

import { RenderTracker } from './render-tracker';
import { LeakDetector } from './leak-detector';
import { TrackByDetector } from './trackby-detector';
import { PerformanceGuard } from './performance-guard';
import { SelectiveAnalyzer } from './selective-analyzer';
import { TemplateExpressionTracker } from './template-expression-tracker';
import { FreezeDetector } from './freeze-detector';
import { ZonePollutionDetector } from './zone-pollution-detector';
import { FlowTracker } from './flow-tracker';
import { checkAngularVersion } from './version-check';

/** Event name used by the content script to dispatch commands to the page script */
const CONTENT_TO_PAGE_EVENT = '__ng_perf_to_page';

/** Event name used to send results back to the content script */
const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

// Module-level instances
const renderTracker = RenderTracker.getInstance();
const leakDetector = new LeakDetector();
const trackByDetector = new TrackByDetector();
const performanceGuard = PerformanceGuard.getInstance();
const selectiveAnalyzer = new SelectiveAnalyzer();
const templateExpressionTracker = new TemplateExpressionTracker(null);
const freezeDetector = new FreezeDetector();
const zonePollutionDetector = ZonePollutionDetector.getInstance();
const flowTracker = FlowTracker.getInstance();

type InstrumentationStartCandidate = {
  component: string;
  score: number;
  currentStrategy: 'Default';
  factors: Array<{ name: string; weight: number; met: boolean; description: string }>;
  recommendation: string;
  cdCount?: number;
  mutationCount?: number;
  cdMer?: number;
};

/**
 * Iterate Angular components up to a limit.
 * Failures in visitor are fatal (not silently ignored).
 */
function forEachAngularComponent(
  limit: number,
  visitor: (component: any, index: number) => void
): void {
  const ng = (globalThis as any).ng;
  if (!ng?.getComponent) return;

  const elements = document.querySelectorAll('*');
  const effectiveLimit = Math.min(elements.length, limit);

  for (let i = 0; i < effectiveLimit; i++) {
    const component = ng.getComponent(elements[i]);
    if (!component) continue;
    // Let errors bubble up - don't silently continue
    visitor(component, i);
  }
}

/**
 * Find Angular component by class name.
 * Returns null if not found or if Angular API unavailable.
 */
function findAngularComponentByName(name: string): any | null {
  const ng = (globalThis as any).ng;
  if (!ng?.getComponent) return null;

  const elements = document.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const component = ng.getComponent(elements[i]);
    if (!component) continue;

    const componentName = component.constructor?.name ?? '';
    if (componentName === name) {
      return component;
    }
  }

  return null;
}

function collectOnPushCandidates(limit: number): InstrumentationStartCandidate[] {
  const candidates: InstrumentationStartCandidate[] = [];

  forEachAngularComponent(limit, (component) => {
    const name = component.constructor?.name ?? 'Unknown';
    const cmp = component.constructor?.ɵcmp;
    if (!cmp) return;

    // Check if already using OnPush
    const isOnPush = cmp.onPush === true || cmp.changeDetection === 1;
    if (isOnPush) return;

    // Simple heuristic: count inputs
    const inputCount = cmp.inputs ? Object.keys(cmp.inputs).length : 0;

    // Change Detection Mutation Efficiency Ratio (CD-MER) metrics
    const cdCount = renderTracker.getCdCount(name);
    const mutationCount = renderTracker.getMutationCount(name);
    const cdMer = renderTracker.getCdMer(name);

    const hasCdData = cdCount >= 5;
    const isInefficient = hasCdData && cdMer < 25;

    const factors: Array<{ name: string; weight: number; met: boolean; description: string }> = [
      { name: 'Has inputs', weight: 0.3, met: inputCount > 0, description: `${inputCount} input(s)` },
      { name: 'Not using OnPush', weight: 0.25, met: true, description: 'Currently Default strategy' },
    ];

    if (hasCdData) {
      factors.push({
        name: 'Change Detection Efficiency',
        weight: 0.45,
        met: isInefficient,
        description: `CD-MER: ${cdMer.toFixed(1)}% (${mutationCount} muts in ${cdCount} CDs)`
      });
    }

    // Dynamic scoring adjustment based on CD-MER data
    let score = inputCount > 0 ? 75 : 40;
    if (isInefficient) {
      score = Math.min(100, score + Math.round((100 - cdMer) / 2));
    }

    candidates.push({
      component: name,
      score,
      currentStrategy: 'Default',
      factors,
      recommendation: isInefficient
        ? `Low Change Detection Efficiency! CD-MER is only ${cdMer.toFixed(1)}%. Checked ${cdCount} times but only mutated ${mutationCount} times. Recheck is wasteful. Switch to ChangeDetectionStrategy.OnPush.`
        : (inputCount > 0 ? 'Recommended: ChangeDetectionStrategy.OnPush' : 'Consider OnPush if data flows through inputs'),
      cdCount,
      mutationCount,
      cdMer,
    });
  });

  return candidates;
}

/**
 * Handles START_TRACKING command from the panel.
 * Starts all continuous detectors and runs one-time analyzers.
 *
 * All errors are caught here and reported to the panel.
 */
function handleStartTracking(): void {
  try {
    // Check Angular version (required)
    const versionResult = checkAngularVersion();
    if (!versionResult.supported) {
      dispatchToContent('ERROR', {
        message: versionResult.version
          ? `Angular ${versionResult.version} is not supported. Requires Angular 17+.`
          : 'Angular not detected on this page.',
      });
      return;
    }

    // Start all continuous detectors
    renderTracker.start();
    leakDetector.start();
    performanceGuard.start();
    freezeDetector.start();
    zonePollutionDetector.start();
    flowTracker.start();

    // Instrument components for template expression tracking
    forEachAngularComponent(200, (component, index) => {
      const name = component.constructor?.name ?? `Component_${index}`;
      templateExpressionTracker.instrumentComponent(component, name);
    });

    // Run one-time analyzers
    const trackByIssues = trackByDetector.analyze();
    if (trackByIssues.length > 0) {
      for (const issue of trackByIssues) {
        dispatchToContent('TRACKBY_ISSUE', { ...issue });
      }
    }

    // Run OnPush analysis
    const onPushCandidates = collectOnPushCandidates(500);
    for (const result of onPushCandidates) {
      dispatchToContent('ONPUSH_RESULT', { ...result });
    }

    // Check for Hydration Mismatches captured by sentinel
    const hydrationError = (window as any).__NGLENS_HYDRATION_ERROR__;
    if (hydrationError) {
      dispatchToContent('HYDRATION_MISMATCH', hydrationError);
    }

    dispatchToContent('TRACKING_STARTED', {
      timestamp: performance.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ngLens] Failed to start tracking:', message);
    dispatchToContent('ERROR', {
      message: `Tracking failed: ${message}`,
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

/**
 * Handles STOP_TRACKING command from the panel.
 * Stops all continuous detectors.
 */
function handleStopTracking(): void {
  try {
    // Dispatch final OnPush results before stopping
    const onPushCandidates = collectOnPushCandidates(500);
    for (const result of onPushCandidates) {
      dispatchToContent('ONPUSH_RESULT', { ...result });
    }

    // Stop all detectors
    renderTracker.stop();
    leakDetector.stop();
    performanceGuard.stop();
    freezeDetector.stop();
    zonePollutionDetector.stop();
    flowTracker.stop();
    templateExpressionTracker.setEnabled(false);

    dispatchToContent('TRACKING_STOPPED', {
      timestamp: performance.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ngLens] Error stopping tracking:', message);
  }
}

/**
 * Handles ROUTE_CHANGED event from Angular Router.
 * Re-runs on-demand analyzers for newly loaded components.
 */
function handleRouteChanged(toUrl: string): void {
  try {
    dispatchToContent('ROUTE_CHANGED', { timestamp: Date.now(), url: toUrl });

    // Re-run analyzers on newly loaded components
    const trackByIssues = trackByDetector.analyze();
    if (trackByIssues.length > 0) {
      for (const issue of trackByIssues) {
        dispatchToContent('TRACKBY_ISSUE', { ...issue });
      }
    }

    // Run OnPush analysis for new route
    const onPushCandidates = collectOnPushCandidates(500);
    for (const result of onPushCandidates) {
      dispatchToContent('ONPUSH_RESULT', { ...result });
    }

    // Re-instrument newly mounted components
    forEachAngularComponent(1000, (component, index) => {
      const name = component.constructor?.name ?? `Component_${index}`;
      templateExpressionTracker.instrumentComponent(component, name);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ngLens] Error analyzing route change:', message);
  }
}

/**
 * Handles SELECT_COMPONENT command from the panel.
 * Updates the SelectiveAnalyzer with the newly selected component.
 */
function handleSelectComponent(payload: { name: string } | null): void {
  const name = payload?.name ?? null;
  selectiveAnalyzer.setSelectedComponent(name);

  // Also instrument the selected component for template expression tracking
  if (name) {
    safeInvoke(() => {
      const component = findAngularComponentByName(name);
      if (component) {
        templateExpressionTracker.instrumentComponent(component, name);
      }
    });
  }
}

/**
 * Handles CLEAR_DATA command from the panel.
 * Resets all internal buffers without stopping tracking.
 */
function handleClearData(): void {
  renderTracker.clearBuffer();
  zonePollutionDetector.clear();
  flowTracker.clear();
  // LeakDetector doesn't expose a buffer clear — it tracks live components
  // TrackByDetector and OnPushEngine are on-demand analyzers, no persistent buffer
}

/**
 * Dispatches a message to the content script via CustomEvent.
 */
function dispatchToContent<T>(type: string, payload: T): void {
  const message = {
    eventId: `orch-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    payload,
  };

  globalThis.dispatchEvent(
    new CustomEvent(PAGE_TO_CONTENT_EVENT, { detail: message })
  );
}

/**
 * Handles incoming commands from the content script.
 * The content script dispatches these as CustomEvents on the CONTENT_TO_PAGE_EVENT channel.
 */
function handleCommand(event: Event): void {
  const customEvent = event as CustomEvent<{ type: string; payload?: unknown; eventId?: string }>;
  const message = customEvent.detail;
  if (!message?.type) return;

  // console.log('[ngLens orchestrator] Received command:', message.type);

  switch (message.type) {
    case 'START_TRACKING':
      handleStartTracking();
      break;
    case 'STOP_TRACKING':
      handleStopTracking();
      break;
    case 'SELECT_COMPONENT':
      handleSelectComponent(message.payload as { name: string } | null);
      break;
    case 'CLEAR_DATA':
      handleClearData();
      break;
    default:
      // Not a command for the orchestrator — ignore
      break;
  }
}

/**
 * Initializes the orchestrator by setting up event listeners for
 * panel commands dispatched by the content script.
 */
export function initOrchestrator(): void {
  globalThis.addEventListener(CONTENT_TO_PAGE_EVENT, handleCommand);
  (globalThis as any).__nglens_orchestrator_on_route_changed = handleRouteChanged;

  // Set up flow event forwarding: when flowTracker emits events, inject them into renderTracker
  setupFlowEventForwarding();
}

/**
 * Sets up event listener for flow events so they can be correlated with render reasons.
 * FlowTracker emits FlowEventBatch events on the page script side.
 */
function setupFlowEventForwarding(): void {
  const flowBatchEventName = '__ng_flow_events';
  
  globalThis.addEventListener(flowBatchEventName, ((event: any) => {
    const batch = event.detail?.payload;
    if (!batch?.events || !Array.isArray(batch.events)) return;
    
    // Inject each flow event into the render tracker for correlation
    for (const flowEvent of batch.events) {
      renderTracker.injectFlowEvent(flowEvent);
    }
  }) as EventListener);
}

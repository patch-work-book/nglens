/**
 * Page Script Orchestrator — runs in the page's MAIN world.
 *
 * Responsibilities:
 * 1. Listen for scan/detection requests from the content script via CustomEvents
 * 2. Detect Angular presence, version, and runtime mode
 * 3. Instantiate and run analyzers via the registry
 * 4. Enforce performance budget (CPU < 3%, memory < 50MB)
 * 5. Respect DOM traversal cap (1000 elements per pass)
 * 6. Dispatch results back to the content script via CustomEvents
 * 7. Initialize V2 real-time tracking orchestrator for START_TRACKING commands
 */

import type { AnalyzerResult, AnalyzerType, RuntimeMode } from '../types/analyzer';
import type { DetectionResult, PageMessage, ScanRequestPayload } from '../types/messages';
import type { PerformanceScore, PerformanceSubScore } from '../types/scoring';
import type { OverlayConfig } from '../types/overlay';
import { MAX_ELEMENTS_PER_SCAN } from '../utils/constants';
import { findAngularComponents } from '../utils/dom-utils';
import { createBudgetMonitor, type BudgetMonitor } from '../utils/performance-budget';
import { cleanupAllObservers } from '../utils/sampling';
import { runAnalyzers, getRegisteredCount } from '../analyzers';
import { initOrchestrator } from '@nglens/instrumentation/orchestrator';
import {
  injectOverlayStyles,
  showOverlay,
  hideOverlay,
  clearAllOverlays
} from './overlay-renderer';

// Side-effect imports: auto-register analyzers
import '../analyzers/performance-scorer';
import '../analyzers/dom-inspector';
import '../analyzers/production-analyzer';
import '../analyzers/enterprise-optimizer';
import '../analyzers/best-practices-detector';
import '../analyzers/subscription-leak-detector';
import '../analyzers/signals-analyzer';

// --- Event Constants ---
// These mirror the constants in message-bridge.ts but are defined locally
// since the page-script cannot import from the content script module.
const CONTENT_TO_PAGE_EVENT = '__ng_perf_to_page';
const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

// --- Budget Monitor (shared across scans) ---
let budgetMonitor: BudgetMonitor = createBudgetMonitor();

// --- Angular Detection ---

/**
 * Detects Angular presence on the current page.
 *
 * Detection logic:
 * - If `window.ng` exists → development mode
 * - If no `window.ng` but `[ng-version]` or `_nghost-*` attributes exist → production mode
 * - Otherwise → not Angular
 *
 * Also reads the Angular version from the `[ng-version]` attribute
 * and counts components using `findAngularComponents()` (capped at MAX_ELEMENTS_PER_SCAN).
 */
function detectAngular(): DetectionResult {
  const ng = (globalThis as unknown as { ng?: unknown }).ng;
  const ngVersionElement = document.querySelector('[ng-version]');
  const version = ngVersionElement?.getAttribute('ng-version') ?? null;

  // Check for Angular host attributes (production markers)
  const hasNgHostAttr = hasAngularHostAttributes();

  let isAngular = false;
  let mode: RuntimeMode | null = null;

  if (ng) {
    // Development mode: window.ng is available
    isAngular = true;
    mode = 'development';
  } else if (ngVersionElement || hasNgHostAttr) {
    // Production mode: Angular DOM markers present but no window.ng
    isAngular = true;
    mode = 'production';
  }

  // Count components (respects MAX_ELEMENTS_PER_SCAN cap)
  let componentCount = 0;
  if (isAngular) {
    const components = findAngularComponents(document);
    componentCount = components.length;
  }

  return {
    isAngular,
    version,
    mode,
    componentCount,
  };
}

/**
 * Checks if any element in the DOM has Angular host attributes (_nghost-*).
 * Scans up to MAX_ELEMENTS_PER_SCAN elements.
 */
function hasAngularHostAttributes(): boolean {
  const allElements = document.querySelectorAll('*');
  const limit = Math.min(allElements.length, MAX_ELEMENTS_PER_SCAN);

  for (let i = 0; i < limit; i++) {
    const el = allElements[i];
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('_nghost-')) {
        return true;
      }
    }
  }
  return false;
}

// --- Scan Orchestration ---

/**
 * Handles a SCAN_REQUEST message from the content script.
 *
 * Flow:
 * 1. Start performance budget tracking
 * 2. Run Angular detection
 * 3. Run requested analyzers via the orchestrator
 * 4. Check budget after scan
 * 5. Cleanup observers
 * 6. Dispatch results back to content script
 */
async function handleScanRequest(
  payload: ScanRequestPayload,
  eventId: string
): Promise<void> {
  // Start budget tracking
  budgetMonitor.reset();
  budgetMonitor.startTracking();

  try {
    // Step 1: Detect Angular
    const detection = detectAngular();

    // If no Angular detected, return early with empty results
    if (!detection.isAngular) {
      budgetMonitor.stopTracking();
      dispatchResult(eventId, 'SCAN_RESULTS', {
        detection,
        score: createEmptyScore(detection.mode),
        results: [],
        actionItems: [],
      });
      return;
    }

    // Step 2: Run analyzers (if any are registered)
    let results: AnalyzerResult[] = [];
    if (getRegisteredCount() > 0) {
      const analyzerTypes: AnalyzerType[] = payload.analyzers.length > 0
        ? payload.analyzers
        : []; // Empty array means runAnalyzers will run all registered

      results = await runAnalyzers(analyzerTypes, {
        mode: detection.mode ?? 'production',
        maxElements: payload.config?.maxElements ?? MAX_ELEMENTS_PER_SCAN,
        timeout: payload.config?.timeout,
      });
    }

    // Step 3: Check budget after scan
    budgetMonitor.stopTracking();
    const budgetStatus = budgetMonitor.checkBudget();

    // Step 4: Cleanup all MutationObservers
    cleanupAllObservers();

    // Step 5: Build and dispatch results
    const score = extractScoreFromResults(results, detection.mode);

    dispatchResult(eventId, 'SCAN_RESULTS', {
      detection,
      score,
      results,
      actionItems: [], // Action prioritizer is a separate service (task 5.1)
      metadata: {
        budgetStatus: {
          withinBudget: budgetStatus.withinBudget,
          cpuPercent: budgetStatus.cpuPercent,
          violations: budgetStatus.violations,
        },
      },
    });
  } catch (error: unknown) {
    // On error, stop tracking and report
    budgetMonitor.stopTracking();
    cleanupAllObservers();

    const message = error instanceof Error ? error.message : 'Unknown scan error';
    dispatchResult(eventId, 'ERROR', { message });
  }
}

/**
 * Handles a DETECTION_STATUS request — runs detection only and returns the result.
 */
function handleDetectionStatus(eventId: string): void {
  const detection = detectAngular();
  dispatchResult(eventId, 'DETECTION_STATUS', detection);
}

// --- Result Dispatch ---

/**
 * Dispatches a result back to the content script via CustomEvent.
 */
function dispatchResult<T>(eventId: string, type: string, payload: T): void {
  const message: PageMessage<T> = {
    eventId,
    type: type as PageMessage['type'],
    payload,
  };

  globalThis.dispatchEvent(
    new CustomEvent(PAGE_TO_CONTENT_EVENT, { detail: message })
  );
}

// --- Score Helpers ---

/**
 * Extracts the performance score from analyzer results.
 * If the performance-scorer analyzer ran, uses its result.
 * Otherwise returns an empty/default score.
 */
function extractScoreFromResults(
  results: AnalyzerResult[],
  mode: RuntimeMode | null
): PerformanceScore {
  const scorerResult = results.find((r) => r.analyzer === 'performance-scorer');

  if (scorerResult?.metadata?.score) {
    return scorerResult.metadata.score as PerformanceScore;
  }

  return createEmptyScore(mode);
}

/**
 * Creates an empty performance score (all zeros).
 */
function createEmptyScore(mode: RuntimeMode | null): PerformanceScore {
  const emptySubScore = (name: string, weight: number): PerformanceSubScore => ({
    name,
    score: 0,
    weight,
    details: 'No data available',
  });

  return {
    overall: 0,
    subScores: {
      changeDetection: emptySubScore('Change Detection', 0.4),
      componentTreeDepth: emptySubScore('Component Tree Depth', 0.2),
      templateComplexity: emptySubScore('Template Complexity', 0.2),
      detectedBottlenecks: emptySubScore('Detected Bottlenecks', 0.2),
    },
    timestamp: Date.now(),
    mode: mode ?? 'production',
  };
}

// --- Event Listener ---

/**
 * Main event listener for messages from the content script.
 * Listens on the CONTENT_TO_PAGE_EVENT channel.
 */
function handleContentMessage(event: Event): void {
  const customEvent = event as CustomEvent<PageMessage>;
  const message = customEvent.detail;

  if (!message?.type || !message?.eventId) {
    return;
  }

  switch (message.type) {
    case 'SCAN_REQUEST':
      handleScanRequest(
        message.payload as ScanRequestPayload,
        message.eventId
      );
      break;

    case 'DETECTION_STATUS':
      handleDetectionStatus(message.eventId);
      break;

    case 'OVERLAY_SHOW': {
      const config = message.payload as OverlayConfig;
      const overlayId = showOverlay(config);
      if (overlayId) {
        dispatchResult(message.eventId, 'SUCCESS', { overlayId });
      } else {
        dispatchResult(message.eventId, 'ERROR', {
          message: `Element not found: ${config.elementSelector}`
        });
      }
      break;
    }

    case 'OVERLAY_HIDE': {
      const { overlayId } = message.payload as { overlayId: string };
      hideOverlay(overlayId);
      dispatchResult(message.eventId, 'SUCCESS', {});
      break;
    }

    case 'OVERLAY_CLEAR_ALL': {
      clearAllOverlays();
      dispatchResult(message.eventId, 'SUCCESS', {});
      break;
    }

    case 'OVERLAY_PULSE': {
      const spatialData = message.payload as { top: number; left: number; width: number; height: number };
      showPulseHighlight(spatialData);
      dispatchResult(message.eventId, 'SUCCESS', {});
      break;
    }

    default:
      // Unknown message type — ignore
      break;
  }
}

// --- Initialization ---

function initialize(): void {
  // console.log('[ngLens page-script] Initializing...');

  // Inject overlay styles on page load
  injectOverlayStyles();

  // Listen for messages from content script
  globalThis.addEventListener(CONTENT_TO_PAGE_EVENT, handleContentMessage);

  // Initialize the instrumentation orchestrator (V2 command handling)
  try {
    initOrchestrator();
    // console.log('[ngLens page-script] Orchestrator initialized');
  } catch (err) {
    // console.error('[ngLens page-script] Orchestrator init failed:', err);
  }

  // Signal to the content script that the page-script is ready to receive commands
  // console.log('[ngLens page-script] Ready');
  globalThis.dispatchEvent(new CustomEvent('nglens-ready'));
}

// Start immediately
initialize();

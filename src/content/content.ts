/**
 * Content Script — runs in the isolated world.
 *
 * Responsibilities:
 * 1. Inject page-script.js into the page's MAIN world
 * 2. Relay messages between page script (CustomEvent) and background worker (chrome.runtime)
 * 3. Handle V1 MessageType protocol: SCAN_REQUEST, SCAN_RESULTS, OVERLAY_SHOW, OVERLAY_HIDE, DETECTION_STATUS, ERROR
 * 4. Handle V2 port-based panel commands: START_TRACKING, STOP_TRACKING, SELECT_COMPONENT, CLEAR_DATA
 * 5. Forward validated async page-script events to background for the DevTools panel
 * 6. Enforce PAGE_SCRIPT_TIMEOUT_MS for request/response commands
 */

import type { ExtensionMessage, MessageType, PageMessage } from '../types/messages';
import {
  isPageScriptAsyncEventType,
  isPageScriptResponseType,
  isPanelCommandType,
  normalizePageMessage,
} from '../utils/message-protocol';
import {
  dispatchToPage,
  generateEventId,
  listenFromPage,
  listenFromExtension,
  sendToBackground,
} from './message-bridge';

/** Page script response timeout in ms (inlined to avoid shared chunk with page-script) */
const PAGE_SCRIPT_TIMEOUT_MS = 3000;

// --- Page Script Injection ---

function injectPageScript(): void {
  const scriptUrl = chrome.runtime.getURL('page-script.js');
  const script = document.createElement('script');
  script.src = scriptUrl;
  script.type = 'module';
  document.documentElement.appendChild(script);
  script.onload = () => script.remove();
  script.onerror = () => {
    script.remove();
    reportError('Page script injection failed. Page access may be restricted.');
  };
}

// --- Error Reporting ---

function reportError(message: string): void {
  const errorMessage: ExtensionMessage<{ message: string }> = {
    type: 'ERROR',
    payload: { message },
    timestamp: Date.now(),
  };
  sendToBackground(errorMessage).catch(() => {
    // Background may not be ready yet; silently ignore
  });
}

// --- Pending Scan Tracking ---

interface PendingScan {
  eventId: string;
  timeoutId: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

const pendingScans = new Map<string, PendingScan>();

// --- Page Script Message Handler ---

function handlePageMessage(message: PageMessage): void {
  const { type, payload, eventId } = message;
  const pending = pendingScans.get(eventId);
  const isPendingResponse = Boolean(pending && isPageScriptResponseType(type));
  const isAsyncEvent = isPageScriptAsyncEventType(type);

  if (!isPendingResponse && !isAsyncEvent) {
    return;
  }

  // If this is a response to a pending scan, clear the timeout.
  if (pending) {
    clearTimeout(pending.timeoutId);
    pendingScans.delete(eventId);
    pending.resolve();
  }

  // Forward results to background worker
  const extensionMessage: ExtensionMessage = {
    type,
    payload,
    timestamp: Date.now(),
  };
  sendToBackground(extensionMessage).catch(() => {
    // Background not available; silently ignore
  });
}

// --- Extension Message Handler ---

function handleExtensionMessage(
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean | void {
  const { type, payload } = message;

  // --- V2: Panel commands forwarded from background ---
  if (isPanelCommandType(type)) {
    ensurePageScriptInjected();
    const eventId = generateEventId();
    dispatchToPageWithRetry(type, payload, eventId);
    sendResponse({ success: true, eventId });
    return true;
  }

  // --- V1: Existing message handling ---
  switch (type) {
    case 'SCAN_REQUEST': {
      ensurePageScriptInjected();
      const eventId = generateEventId();

      // Set up timeout for page script response
      const timeoutId = setTimeout(() => {
        if (pendingScans.has(eventId)) {
          pendingScans.delete(eventId);
          reportError(
            'Scan timed out. The page script did not respond. Try refreshing the page.'
          );
        }
      }, PAGE_SCRIPT_TIMEOUT_MS);

      // Track the pending scan
      pendingScans.set(eventId, {
        eventId,
        timeoutId,
        resolve: () => { /* resolved when page responds */ },
      });

      // Forward scan request to page script via CustomEvent
      dispatchToPage(type, payload, eventId);
      sendResponse({ success: true, eventId });
      return true;
    }

    case 'OVERLAY_SHOW':
    case 'OVERLAY_HIDE':
    case 'OVERLAY_CLEAR_ALL': {
      ensurePageScriptInjected();
      // Forward overlay commands to page script
      const eventId = generateEventId();
      dispatchToPage(type, payload, eventId);
      sendResponse({ success: true });
      return true;
    }

    case 'DETECTION_STATUS': {
      ensurePageScriptInjected();
      // Request detection status from page script
      const eventId = generateEventId();

      const timeoutId = setTimeout(() => {
        if (pendingScans.has(eventId)) {
          pendingScans.delete(eventId);
          reportError('Detection status request timed out.');
        }
      }, PAGE_SCRIPT_TIMEOUT_MS);

      pendingScans.set(eventId, {
        eventId,
        timeoutId,
        resolve: () => { /* resolved when page responds */ },
      });

      dispatchToPage(type, payload, eventId);
      sendResponse({ success: true, eventId });
      return true;
    }

    default:
      return;
  }
}

// --- nglens-event Handler (for async instrumentation events like DEGRADED_MODE) ---

function handleNglensEvent(event: Event): void {
  const customEvent = event as CustomEvent<{ type: string; payload?: unknown }>;
  const detail = customEvent.detail;
  if (!detail?.type) return;

  const message = normalizePageMessage({
    eventId: `legacy-${Date.now()}`,
    type: detail.type,
    payload: detail.payload,
  });
  if (!message || !isPageScriptAsyncEventType(message.type)) return;

  const extensionMessage: ExtensionMessage = {
    type: message.type,
    payload: message.payload,
    timestamp: Date.now(),
  };
  sendToBackground(extensionMessage).catch(() => {
    // Background not available; silently ignore
  });
}

// --- Initialization ---

/** Whether the page script has been injected */
let pageScriptInjected = false;

/**
 * Ensures the page script is injected. Only injects once.
 * Called lazily when the first message arrives that needs the page script.
 */
function ensurePageScriptInjected(): void {
  if (pageScriptInjected) return;
  pageScriptInjected = true;
  injectPageScript();
}

/**
 * Dispatches a message to the page script with retries to handle
 * the async loading delay of the page-script module.
 */
function dispatchToPageWithRetry(type: MessageType, payload: unknown, eventId: string): void {
  // Dispatch immediately (in case page-script is already loaded)
  dispatchToPage(type, payload, eventId);

  // Also retry after delays in case the page-script hasn't loaded yet
  setTimeout(() => dispatchToPage(type, payload, eventId), 200);
  setTimeout(() => dispatchToPage(type, payload, eventId), 500);
  setTimeout(() => dispatchToPage(type, payload, eventId), 1000);
}

function initialize(): void {
  // Do NOT inject page-script eagerly — it's 81KB and slows down every page.
  // Instead, inject lazily when the first scan/tracking command arrives.

  // Listen for messages from the page script (both V1 scan results and V2 async events)
  listenFromPage(handlePageMessage);

  // Listen for nglens-event CustomEvents from the page-script (async instrumentation events)
  globalThis.addEventListener('nglens-event', handleNglensEvent);

  // Listen for messages from the background worker / popup
  listenFromExtension(handleExtensionMessage);

  // Notify background about this frame load
  sendToBackground({
    type: 'FRAME_LOADED',
    payload: {
      url: window.location.href,
      isTop: window === window.top,
    },
    timestamp: Date.now(),
  }).catch(() => {
    // Background not ready; silently ignore
  });
}

// Start immediately
initialize();

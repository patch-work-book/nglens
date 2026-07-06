/**
 * Background Service Worker — extension lifecycle, session storage, and message coordination.
 *
 * Responsibilities:
 * 1. Route messages between content script and popup via message-router
 * 2. Manage tab lifecycle (navigation, removal) via tab-manager
 * 3. Persist scan results in chrome.storage.session
 * 4. Re-inject content script on navigation
 * 5. Track extension install event via analytics (pending consent)
 * 6. Manage port-based panel connections for DevTools panel
 */

import type { ExtensionMessage, MessageType } from '../types/messages';
import type { PortMessage } from '../types/port-messages';
import { analyticsService } from './analytics-instance';
import { routeMessage } from './message-router';
import { clearTabState, removeTabState } from './tab-manager';

// --- Panel Port Registry ---

/**
 * Maps tab IDs to their connected DevTools panel ports.
 * Used to forward messages between content scripts and the DevTools panel.
 */
export const panelPorts = new Map<number, chrome.runtime.Port>();

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'SCAN_REQUEST',
  'SCAN_RESULTS',
  'START_PROFILING',
  'STOP_PROFILING',
  'PROFILE_DATA',
  'PROFILE_COMPLETE',
  'STATE_REQUEST',
  'STATE_RESPONSE',
  'OVERLAY_SHOW',
  'OVERLAY_HIDE',
  'OVERLAY_CLEAR_ALL',
  'DETECTION_STATUS',
  'TAB_NAVIGATED',
  'ERROR',
  'ANALYTICS_CONSENT_CHANGED',
  'ANALYTICS_TRACK_EVENT',
  'START_TRACKING',
  'STOP_TRACKING',
  'TRACKING_STARTED',
  'TRACKING_STOPPED',
  'SELECT_COMPONENT',
  'CLEAR_DATA',
  'EVENT_BATCH',
  'LEAK_EVENT',
  'TRACKBY_ISSUE',
  'ONPUSH_RESULT',
  'DEGRADED_MODE',
  'ZONE_POLLUTION_EVENT',
  'ROUTE_CHANGED',
  'FLOW_EVENT_BATCH',
  'FRAME_LOADED',
]);

const ASYNC_EVENT_TYPES: ReadonlySet<string> = new Set([
  'EVENT_BATCH',
  'LEAK_EVENT',
  'TRACKBY_ISSUE',
  'ONPUSH_RESULT',
  'DEGRADED_MODE',
  'ROUTE_CHANGED',
  'TRACKING_STARTED',
  'TRACKING_STOPPED',
  'ERROR',
  'ZONE_POLLUTION_EVENT',
  'FLOW_EVENT_BATCH',
  'FRAME_LOADED',
]);

// --- Panel Port Connection Handling ---

/**
 * Listens for port connections from the DevTools panel.
 * Handles INIT message to register the port, forwards panel messages
 * to the content script, and cleans up on disconnect.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ngLens-panel') return;

  let tabId: number | null = null;

  port.onMessage.addListener(async (message: PortMessage) => {
    if (message.type === 'INIT') {
      tabId = message.tabId ?? null;
      if (tabId !== null) {
        panelPorts.set(tabId, port);
        port.postMessage({ type: 'CONNECTION_ACK', timestamp: Date.now() });
      }
    } else if (tabId !== null) {
      // Forward panel messages to content script on the inspected tab
      try {
        const response = await sendPanelMessageToContent(tabId, message);
        if (response) {
          port.postMessage(response);
        }
      } catch (err) {
        port.postMessage({
          type: 'ERROR',
          payload: { message: String(err) },
          timestamp: Date.now(),
        });
      }
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId !== null) {
      panelPorts.delete(tabId);
    }
  });
});

/**
 * Keeps track of registered frame IDs for each tab.
 * Used for broadcasting commands (like START_TRACKING) to all frames.
 */
const tabFrames = new Map<number, Set<number>>();

async function sendPanelMessageToContent(
  tabId: number,
  message: PortMessage
): Promise<unknown> {
  const forwardedMessage = {
    ...message,
    timestamp: Date.now(),
  };

  // If a specific frameId targets this command, send to that frame only
  if (typeof message.frameId === 'number') {
    try {
      return await chrome.tabs.sendMessage(tabId, forwardedMessage, { frameId: message.frameId });
    } catch {
      // Content script may not be ready in the target frame — inject programmatically.
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [message.frameId] },
          files: ['content.js'],
        });
        return await chrome.tabs.sendMessage(tabId, forwardedMessage, { frameId: message.frameId });
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  }

  // Otherwise, broadcast to all registered frames of this tab
  const frames = tabFrames.get(tabId) || new Set([0]);
  const promises = Array.from(frames).map(async (frameId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, forwardedMessage, { frameId });
    } catch (firstError) {
      if (!isPanelCommand(message.type)) {
        return { success: false, error: String(firstError) };
      }

      // Content script not ready in this frame — inject it programmatically.
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          files: ['content.js'],
        });
        return await chrome.tabs.sendMessage(tabId, { ...forwardedMessage, timestamp: Date.now() }, { frameId });
      } catch (innerError) {
        return { success: false, error: String(innerError) };
      }
    }
  });

  const results = await Promise.all(promises);
  return results[0] || { success: true };
}

function isPanelCommand(type: string): boolean {
  return (
    type === 'START_TRACKING' ||
    type === 'STOP_TRACKING' ||
    type === 'SELECT_COMPONENT' ||
    type === 'CLEAR_DATA'
  );
}

/**
 * Forwards a message to the panel port associated with the given tab ID.
 * No-op if no panel port is registered for the tab.
 */
export function forwardToPanel(tabId: number, message: unknown): void {
  const port = panelPorts.get(tabId);
  if (port) {
    port.postMessage(message);
  }
}

// --- Message Handling ---

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    const message = normalizeExtensionMessage(rawMessage);
    if (!message) {
      sendResponse({ success: false, error: 'Invalid or unsupported message.' });
      return false;
    }

    // Check if this is an async event from the content script that should be forwarded to the panel
    const senderTabId = sender.tab?.id;
    if (senderTabId != null && ASYNC_EVENT_TYPES.has(message.type)) {
      const port = panelPorts.get(senderTabId);

      // Track the frame if we have frameId
      const frameId = sender.frameId ?? 0;
      let frames = tabFrames.get(senderTabId);
      if (!frames) {
        frames = new Set<number>();
        tabFrames.set(senderTabId, frames);
      }
      frames.add(frameId);

      // Handle FRAME_LOADED for top-level frame specifically:
      // Clear state and send TAB_NAVIGATED to panel on real page load/reload
      if (message.type === 'FRAME_LOADED') {
        const payload = message.payload as { url: string; isTop: boolean } | null;
        if (payload?.isTop) {
          // Real document navigation/reload occurred!
          clearTabState(senderTabId).then(() => {
            tabFrames.delete(senderTabId);
            // Re-add top frame
            let freshFrames = tabFrames.get(senderTabId);
            if (!freshFrames) {
              freshFrames = new Set<number>();
              tabFrames.set(senderTabId, freshFrames);
            }
            freshFrames.add(0);

            if (port) {
              port.postMessage({
                type: 'TAB_NAVIGATED',
                payload: { url: payload.url || '' },
                tabId: senderTabId,
                timestamp: Date.now(),
              });
            }
          }).catch(() => { /* ignore */ });
        }
      }

      if (port) {
        port.postMessage({
          ...message,
          frameId,
          frameUrl: sender.url,
        });
        sendResponse({ success: true });
        return true;
      }
    }

    // Route the message asynchronously through the standard message router
    routeMessage(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    // Return true to indicate async sendResponse
    return true;
  }
);

function normalizeExtensionMessage(value: unknown): ExtensionMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type)) return null;

  return {
    type: value.type as MessageType,
    payload: value.payload,
    tabId: typeof value.tabId === 'number' && Number.isFinite(value.tabId)
      ? value.tabId
      : undefined,
    timestamp: typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
      ? value.timestamp
      : Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Tab Lifecycle ---

/**
 * Tab state clearing and navigation notifications are handled on real 
 * content script frame loads (on FRAME_LOADED with isTop === true) 
 * instead of the noisy tabs.onUpdated status transitions, preserving
 * accumulated findings across client-side SPA routing changes.
 */
chrome.tabs.onUpdated.addListener(
  async (tabId, changeInfo, tab) => {
    // Left as a no-op placeholder to avoid unnecessary clear-outs on SPA route updates
  }
);

/**
 * When a tab is closed, remove its stored state.
 */
chrome.tabs.onRemoved.addListener(async (tabId: number) => {
  await removeTabState(tabId);
  tabFrames.delete(tabId);
});

// --- Extension Install ---

/**
 * On first install, attempt to send the install event immediately if consent
 * is already granted. Otherwise, store a pending flag so the event is sent
 * later when consent is granted (handled in message-router.ts).
 * For 'update' or 'chrome_update' reasons, no flag is stored and no event is sent.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const enabled = await analyticsService.isEnabled();
    if (enabled) {
      // Consent already granted — send install event now
      const version = chrome.runtime.getManifest().version;
      await analyticsService.trackInstall(version);
    } else {
      // Consent not yet granted — store pending flag for later
      await chrome.storage.local.set({ analytics_install_pending: true });
    }
  }
  // For 'update' or 'chrome_update', do nothing — no install event should be sent
});

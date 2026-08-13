/**
 * Message Router — routing logic for scan requests and state queries.
 *
 * Handles:
 * - Forwarding SCAN_REQUEST from popup to content script
 * - Receiving SCAN_RESULTS from content script and storing in session
 * - Responding to state queries from popup (GET_TAB_STATE)
 * - Forwarding OVERLAY_SHOW/OVERLAY_HIDE to content script
 * - Forwarding DETECTION_STATUS requests
 * - Reporting ERROR messages to popup
 * - ANALYTICS_CONSENT_CHANGED: triggers pending install event on consent grant
 * - ANALYTICS_TRACK_EVENT: fires analytics events (e.g., analysis_run)
 */

import type { AnalyticsConsentPayload, AnalyticsTrackEventPayload } from '../types/analytics';
import type { ExtensionMessage, ScanResultsPayload } from '../types/messages';
import { analyticsService } from './analytics-instance';
import { getTabState, storeScanResults, updateTabState } from './tab-manager';

/**
 * Routes an incoming message from the content script or popup.
 * Returns a response payload or undefined if no response is needed.
 */
export async function routeMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  const { type, payload } = message;
  const tabId = message.tabId ?? sender.tab?.id;

  switch (type) {
    case 'SCAN_REQUEST':
      return forwardToContentScript(
        message,
        tabId,
        'Failed to communicate with content script. Try refreshing the page.'
      );

    case 'SCAN_RESULTS':
      return handleScanResults(payload as ScanResultsPayload, tabId);

    case 'DETECTION_STATUS':
      return forwardToContentScript(message, tabId, 'Failed to communicate with content script.');

    case 'OVERLAY_SHOW':
    case 'OVERLAY_HIDE':
    case 'OVERLAY_CLEAR_ALL':
    case 'OVERLAY_PULSE':
      return forwardToContentScript(message, tabId, 'Failed to forward message to content script.');

    case 'ERROR':
      return handleError(message, tabId);

    case 'STATE_REQUEST':
      return handleStateRequest(tabId);

    case 'ANALYTICS_CONSENT_CHANGED':
      return handleAnalyticsConsentChanged(payload as AnalyticsConsentPayload);

    case 'ANALYTICS_TRACK_EVENT':
      return handleAnalyticsTrackEvent(payload as AnalyticsTrackEventPayload);

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

/**
 * Handles SCAN_RESULTS received from the content script.
 * Stores results in session storage for the tab.
 */
async function handleScanResults(
  results: ScanResultsPayload,
  tabId: number | undefined
): Promise<unknown> {
  if (!tabId) {
    return { success: false, error: 'No tab ID for scan results' };
  }

  await storeScanResults(tabId, results);
  return { success: true };
}

/**
 * Forwards overlay messages to the content script.
 */
async function forwardToContentScript(
  message: ExtensionMessage,
  tabId: number | undefined,
  errorMessage: string
): Promise<unknown> {
  if (!tabId) {
    return { success: false, error: 'No active tab found' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error) {
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Handles ERROR messages from the content script.
 * Updates tab state with error info.
 */
async function handleError(
  message: ExtensionMessage,
  tabId: number | undefined
): Promise<unknown> {
  if (tabId) {
    await updateTabState(tabId, {
      detection: null,
    });
  }
  // Error is logged; popup can query state to see the issue
  return { success: true };
}

/**
 * Handles STATE_REQUEST from the popup — returns stored tab state.
 */
async function handleStateRequest(tabId: number | undefined): Promise<unknown> {
  if (!tabId) {
    return { success: false, error: 'No active tab found' };
  }

  const state = await getTabState(tabId);
  if (!state) {
    return { success: true, state: null };
  }

  return { success: true, state };
}

/**
 * Handles ANALYTICS_CONSENT_CHANGED messages from the popup.
 * When consent is granted, checks if there is a pending install event
 * (first install where consent was not yet granted) and sends it.
 */
async function handleAnalyticsConsentChanged(
  payload: AnalyticsConsentPayload
): Promise<unknown> {
  if (payload.consent === 'granted') {
    // Check if there's a pending install event waiting for consent
    try {
      const result = await chrome.storage.local.get('analytics_install_pending');
      if (result.analytics_install_pending === true) {
        // Clear the pending flag before sending
        await chrome.storage.local.remove('analytics_install_pending');

        const version = chrome.runtime.getManifest().version;
        await analyticsService.trackInstall(version);
      }
    } catch {
      // Storage read failure — non-critical, skip install tracking
    }
  }

  return { success: true };
}

/**
 * Handles ANALYTICS_TRACK_EVENT messages from the popup.
 * Routes to the appropriate AnalyticsService method based on eventName.
 */
async function handleAnalyticsTrackEvent(
  payload: AnalyticsTrackEventPayload
): Promise<unknown> {
  if (payload.eventName === 'analysis_run') {
    const version = chrome.runtime.getManifest().version;
    analyticsService.trackAnalysisRun(version);
  }

  return { success: true };
}

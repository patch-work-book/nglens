/**
 * Privacy and security constraints for the Angular Performance Inspector.
 *
 * This module provides:
 * - Documentation of all privacy guarantees (PRIVACY_POLICY constant)
 * - Development-time validation that unexpected external network requests are not made
 * - URL allowlist for the only permitted external navigation (angular.dev docs)
 * - Data sanitization helper that delegates to the serializer
 *
 * All analysis is performed locally in the browser.
 *
 * RELEASE NOTE (v1.2.0): usage analytics are DISABLED for this release via the
 * ANALYTICS_ENABLED_IN_RELEASE kill-switch in analytics-service.ts. The opt-in,
 * anonymous, fail-closed analytics code remains in the tree for a future
 * release but transmits nothing in v1.2.0. The only external interaction in
 * this release is opening angular.dev documentation links in new tabs.
 */

import { safeClone, CIRCULAR_REFERENCE_MARKER, DOM_NODE_MARKER, FUNCTION_MARKER } from './serializer';

// --- Privacy Policy ---

/**
 * Documents all privacy guarantees for the Angular Performance Inspector.
 * This constant serves as both runtime documentation and a reference for
 * Chrome Web Store reviewers.
 */
export const PRIVACY_POLICY = {
  /** Analysis data, source code, page URLs, and DOM content are not transmitted */
  noAnalysisDataExfiltration: true,

  /**
   * Usage analytics are DISABLED in this release (v1.2.0). The analytics code
   * exists but is turned off by the ANALYTICS_ENABLED_IN_RELEASE kill-switch in
   * analytics-service.ts, and no API secret is bundled, so nothing is sent.
   */
  analyticsDisabledInRelease: true,

  /** No external API calls are used for analysis functionality */
  noExternalAnalysisAPIs: true,

  /** No source code is collected or transmitted */
  noSourceCodeCollection: true,

  /** No DOM content is uploaded anywhere */
  noDOMUpload: true,

  /** All performance analysis runs locally in the page context */
  localAnalysisOnly: true,

  /** Help content is bundled with the extension (no network fetches) */
  bundledHelpContent: true,

  /** The only external navigation: opening angular.dev docs in new tabs */
  allowedExternalNavigation: 'angular.dev documentation links only',

  /** Storage is local to the browser profile */
  storageModel: 'chrome.storage.local/session (local browser profile)',

  /** Permissions used and their justification */
  permissions: {
    scripting: 'Inject the local analysis script into the inspected page for Angular API access',
    storage: 'Persist scan results and settings locally (no sync/cloud)',
  },

  /**
   * Host permissions used and their justification. These match manifest.json.
   * The broad http/https host access is required ONLY to inject the local
   * analysis script into the inspected page — it is not used to send data out.
   */
  hostPermissions: {
    'http://*/*': 'Inject the local analysis script into the inspected page (no data sent)',
    'https://*/*': 'Inject the local analysis script into the inspected page (no data sent)',
  },
} as const;

// --- Allowed Navigation ---

/** Allowed documentation URL patterns for external navigation */
const ALLOWED_DOC_PATTERNS: readonly RegExp[] = [
  /^https:\/\/angular\.dev\//,
  /^https:\/\/v\d+\.angular\.io\//,
  /^https:\/\/angular\.io\//,
];

/**
 * Checks whether a URL is an allowed external navigation target.
 * Only angular.dev documentation URLs are permitted.
 *
 * @param url - The URL to validate
 * @returns true if the URL is an allowed angular.dev documentation link
 */
export function isAllowedNavigation(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    // Validate it's a proper URL
    const parsed = new URL(url);

    // Only HTTPS is allowed
    if (parsed.protocol !== 'https:') {
      return false;
    }

    // Check against allowed patterns
    return ALLOWED_DOC_PATTERNS.some((pattern) => pattern.test(url));
  } catch {
    // Invalid URL
    return false;
  }
}

// --- Network Request Validation ---

/**
 * Development-time validation that no unexpected external network requests are being made.
 * This function checks for the presence of fetch/XHR calls to external URLs
 * by wrapping the global fetch and XMLHttpRequest to detect violations. The
 * opt-in Google Analytics endpoint is allowed because it is declared in the
 * manifest and guarded by consent.
 *
 * This is intended for development/testing use only — it does NOT intercept
 * requests at runtime in production (that would be too invasive).
 *
 * @returns An object with validation results and a cleanup function
 */
export function validateNoExternalRequests(): {
  violations: string[];
  startMonitoring: () => void;
  stopMonitoring: () => () => void;
} {
  const violations: string[] = [];
  let originalFetch: typeof globalThis.fetch | null = null;
  let originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;

  function isAllowedRequest(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'www.google-analytics.com' && parsed.pathname === '/mp/collect';
    } catch {
      return false;
    }
  }

  function startMonitoring(): void {
    // Wrap fetch
    originalFetch = globalThis.fetch;
    globalThis.fetch = function monitoredFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      let url: string;
      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = (input as Request).url;
      }
      if (!isAllowedRequest(url)) {
        violations.push(`fetch() called with URL: ${url}`);
      }
      // Still call original to not break functionality during testing
      return originalFetch!.call(globalThis, input, init);
    } as typeof globalThis.fetch;

    // Wrap XMLHttpRequest.open
    originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...args: unknown[]
    ): void {
      const urlStr = typeof url === 'string' ? url : url.href;
      if (!isAllowedRequest(urlStr)) {
        violations.push(`XMLHttpRequest.open() called with URL: ${urlStr}`);
      }
      originalXHROpen!.apply(this, [method, url, ...args] as unknown as Parameters<typeof XMLHttpRequest.prototype.open>);
    } as typeof XMLHttpRequest.prototype.open;
  }

  function stopMonitoring(): () => void {
    // Restore originals
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
    if (originalXHROpen) {
      XMLHttpRequest.prototype.open = originalXHROpen;
      originalXHROpen = null;
    }

    // Return a summary function
    return () => violations;
  }

  return { violations, startMonitoring, stopMonitoring };
}

// --- Data Sanitization ---

/**
 * Sanitizes data for export, ensuring no PII, DOM references, or sensitive
 * information is present in the output. Delegates to the serializer for
 * safe JSON handling.
 *
 * @param data - Any data to sanitize for export
 * @returns A plain, serializable object safe for export (or null if sanitization fails)
 */
export function sanitizeForExport(data: unknown): unknown {
  // Delegate to safeClone which handles:
  // - Circular references → "[Circular Reference]"
  // - DOM nodes → "[DOM Node]"
  // - Functions → "[Function]"
  // - Long strings → truncated at 500 chars
  const sanitized = safeClone(data);

  if (sanitized === null) {
    return null;
  }

  // Additional pass: strip any remaining keys that could contain PII patterns
  return stripSensitiveKeys(sanitized);
}

/**
 * Recursively removes keys that might contain sensitive information.
 * This is a defense-in-depth measure on top of the serializer's handling.
 */
function stripSensitiveKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripSensitiveKeys);
  }

  const result: Record<string, unknown> = {};
  const sensitiveKeyPatterns = /^(password|secret|token|cookie|authorization|credential|session_id|api_key|private_key)$/i;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (sensitiveKeyPatterns.test(key)) {
      result[key] = '[REDACTED]';
    } else if (value === CIRCULAR_REFERENCE_MARKER || value === DOM_NODE_MARKER || value === FUNCTION_MARKER) {
      // Keep markers as-is — they're already safe
      result[key] = value;
    } else {
      result[key] = stripSensitiveKeys(value);
    }
  }

  return result;
}

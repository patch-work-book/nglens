/**
 * ngLens - Angular Performance Analyzer
 * Copyright (c) 2026 ngLens Contributors
 * Licensed under MIT
 *
 * https://github.com/gowtham-labs/nglens
 *
 * Overlay Renderer Module
 *
 * Handles visual overlay creation, positioning, and lifecycle management.
 * Runs in the page script (main world) with full DOM access.
 */

import type { OverlayConfig } from '../types/overlay';
import type { Severity } from '../types/analyzer';

// --- Security: HTML escaping to prevent XSS from page-derived data ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Active overlays tracking
const activeOverlays = new Map<string, { element: HTMLElement; timeoutId?: number }>();
let overlayIdCounter = 0;
let stylesInjected = false;

/**
 * Inject overlay styles into the page (called once on page script load)
 */
export function injectOverlayStyles(): void {
  if (stylesInjected) return;

  const style = document.createElement('style');
  style.id = 'ng-lens-overlay-styles';
  style.textContent = `
    .ng-lens-overlay {
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      box-sizing: border-box;
    }

    .ng-lens-overlay.visible {
      opacity: 1;
    }

    .ng-lens-overlay.fading-out {
      opacity: 0;
    }

    .ng-lens-overlay-border {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border: 3px solid;
      border-radius: 4px;
      pointer-events: none;
    }

    .ng-lens-overlay.severity-critical .ng-lens-overlay-border {
      border-color: #d32f2f;
      box-shadow: 0 0 8px rgba(211, 47, 47, 0.4);
    }

    .ng-lens-overlay.severity-high .ng-lens-overlay-border {
      border-color: #f57c00;
      box-shadow: 0 0 8px rgba(245, 124, 0, 0.4);
    }

    .ng-lens-overlay.severity-medium .ng-lens-overlay-border {
      border-color: #fbc02d;
      box-shadow: 0 0 8px rgba(251, 192, 45, 0.4);
    }

    .ng-lens-overlay.severity-low .ng-lens-overlay-border {
      border-color: #1976d2;
      box-shadow: 0 0 8px rgba(25, 118, 210, 0.4);
    }

    .ng-lens-overlay.severity-info .ng-lens-overlay-border {
      border-color: #757575;
      box-shadow: 0 0 8px rgba(117, 117, 117, 0.4);
    }

    .ng-lens-overlay-label {
      position: absolute;
      top: -28px;
      left: 0;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      white-space: nowrap;
      pointer-events: auto;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .ng-lens-overlay-label:hover {
      background: rgba(0, 0, 0, 0.95);
    }

    .ng-lens-overlay-label strong {
      font-weight: 600;
      color: #fff;
    }

    .ng-lens-overlay-tooltip {
      display: none;
      position: absolute;
      top: -120px;
      left: 0;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      line-height: 1.5;
      max-width: 300px;
      white-space: normal;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      z-index: 1;
    }

    .ng-lens-overlay-label:hover + .ng-lens-overlay-tooltip {
      display: block;
    }

    .ng-lens-overlay-tooltip .tooltip-title {
      font-weight: 600;
      margin-bottom: 4px;
      color: #fff;
    }

    .ng-lens-overlay-tooltip .tooltip-recommendation {
      color: #bbb;
      margin-top: 4px;
      font-style: italic;
    }

    .ng-lens-pulse-highlight {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      background: rgba(255, 68, 68, 0.3);
      border: 2px solid #ff4444;
      box-sizing: border-box;
      border-radius: 4px;
      animation: ng-lens-pulse 1s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    @keyframes ng-lens-pulse {
      0% { opacity: 0; transform: scale(0.98); }
      20% { opacity: 0.8; transform: scale(1.02); }
      100% { opacity: 0; transform: scale(1.05); }
    }
  `;

  document.head.appendChild(style);
  stylesInjected = true;
}

/**
 * Get severity color for border styling
 */
function getSeverityColor(severity: Severity): string {
  const colors: Record<Severity, string> = {
    critical: '#d32f2f',
    high: '#f57c00',
    medium: '#fbc02d',
    low: '#1976d2',
    info: '#757575',
  };
  return colors[severity] || colors.info;
}

/**
 * Format overlay label text
 */
function formatOverlayLabel(config: OverlayConfig): string {
  return `<strong>${escapeHtml(config.componentName)}:</strong> ${escapeHtml(config.issueType)}`;
}

/**
 * Generate unique overlay ID
 */
function generateOverlayId(): string {
  return `ng-lens-overlay-${++overlayIdCounter}-${Date.now()}`;
}

/**
 * Create overlay DOM element with styling
 */
function createOverlay(config: OverlayConfig, overlayId: string): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = `ng-lens-overlay severity-${config.severity}`;
  overlay.setAttribute('data-overlay-id', overlayId);

  // Border element
  const border = document.createElement('div');
  border.className = 'ng-lens-overlay-border';
  overlay.appendChild(border);

  // Label element
  const label = document.createElement('div');
  label.className = 'ng-lens-overlay-label';
  label.innerHTML = formatOverlayLabel(config);
  label.onclick = () => hideOverlay(overlayId);
  overlay.appendChild(label);

  // Tooltip element (shown on hover)
  const tooltip = document.createElement('div');
  tooltip.className = 'ng-lens-overlay-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-title">${escapeHtml(config.issueType)}</div>
    <div class="tooltip-component">Component: ${escapeHtml(config.componentName)}</div>
    <div class="tooltip-recommendation">Click label to dismiss</div>
  `;
  overlay.appendChild(tooltip);

  return overlay;
}

/**
 * Position overlay over target element
 */
function positionOverlay(overlay: HTMLElement, targetElement: Element): void {
  const rect = targetElement.getBoundingClientRect();

  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

/**
 * Show overlay for a specific element
 * Returns overlay ID for later dismissal, or null if failed
 */
export function showOverlay(config: OverlayConfig): string | null {
  // Ensure styles are injected
  if (!stylesInjected) {
    injectOverlayStyles();
  }

  // Find target element
  const targetElement = document.querySelector(config.elementSelector);
  if (!targetElement) {
    // console.warn(`[ngLens] Element not found: ${config.elementSelector}`);
    return null;
  }

  // Generate unique ID
  const overlayId = generateOverlayId();

  // Create overlay element
  const overlay = createOverlay(config, overlayId);

  // Position overlay
  positionOverlay(overlay, targetElement);

  // Insert into DOM
  document.body.appendChild(overlay);

  // Trigger fade-in animation (after DOM insertion)
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });

  // Set auto-fade timeout if configured
  let timeoutId: number | undefined;
  if (config.autoFadeTimeout > 0) {
    timeoutId = window.setTimeout(() => {
      hideOverlay(overlayId);
    }, config.autoFadeTimeout);
  }

  // Track active overlay
  activeOverlays.set(overlayId, { element: overlay, timeoutId });

  return overlayId;
}

/**
 * Hide specific overlay by ID
 */
export function hideOverlay(overlayId: string): void {
  const tracked = activeOverlays.get(overlayId);
  if (!tracked) return;

  const { element, timeoutId } = tracked;

  // Clear timeout if exists
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  // Fade out animation
  element.classList.remove('visible');
  element.classList.add('fading-out');

  // Remove from DOM after animation
  setTimeout(() => {
    element.remove();
  }, 300); // Match CSS transition duration

  // Remove from tracking
  activeOverlays.delete(overlayId);
}

/**
 * Clear all active overlays
 */
export function clearAllOverlays(): void {
  const overlayIds = Array.from(activeOverlays.keys());
  overlayIds.forEach(id => hideOverlay(id));
}

/**
 * Shows a "pulse" highlight at specific spatial coordinates.
 * Used for the "Blast Radius" heatmap visualization.
 */
export function showPulseHighlight(spatialData: { top: number; left: number; width: number; height: number }): void {
  // Ensure styles are injected
  if (!stylesInjected) {
    injectOverlayStyles();
  }

  const pulse = document.createElement('div');
  pulse.className = 'ng-lens-pulse-highlight';
  pulse.style.top = `${spatialData.top}px`;
  pulse.style.left = `${spatialData.left}px`;
  pulse.style.width = `${spatialData.width}px`;
  pulse.style.height = `${spatialData.height}px`;

  document.body.appendChild(pulse);
  
  // Self-destruct after animation completes (1s matching @keyframes)
  setTimeout(() => {
    pulse.remove();
  }, 1000);
}

/**
 * Get count of active overlays
 */
export function getActiveOverlayCount(): number {
  return activeOverlays.size;
}

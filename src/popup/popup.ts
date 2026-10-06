/**
 * ngLens - Angular Performance Analyzer
 * Copyright (c) 2026 ngLens Contributors
 * Licensed under MIT
 *
 * Popup Control Panel (Simplified auto-start controls)
 */

import type { ExtensionMessage } from '../types/messages';
import { ANALYTICS_ENABLED_IN_RELEASE } from '../services/analytics-service';

const autoStartToggle = document.getElementById('autoStartToggle') as HTMLInputElement;

// Initialize
// Analytics is disabled for this release (see ANALYTICS_ENABLED_IN_RELEASE).
// When disabled, we neither prompt for consent nor expose the analytics toggle,
// so the UI never implies data collection that does not happen.
if (ANALYTICS_ENABLED_IN_RELEASE) {
  checkAndShowConsentPrompt();
  initAnalyticsToggle();
} else {
  hideAnalyticsControls();
}
initAutoStartScan();

// Auto Start Settings Management
async function initAutoStartScan() {
  if (!autoStartToggle) return;

  try {
    const result = await chrome.storage.local.get('auto_start_scan');
    autoStartToggle.checked = result['auto_start_scan'] === true;
  } catch (err) {
    console.error('Failed to init auto start setting:', err);
  }

  autoStartToggle.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ auto_start_scan: autoStartToggle.checked });
    } catch (err) {
      console.error('Failed to save auto start setting:', err);
    }
  });
}

// --- Consent Prompt ---

async function checkAndShowConsentPrompt(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('analytics_consent');
    const consent = result['analytics_consent'];
    if (consent === 'granted' || consent === 'denied') {
      return;
    }
    renderConsentPrompt();
  } catch { /* ignore */ }
}

function renderConsentPrompt(): void {
  const overlay = document.createElement('div');
  overlay.className = 'consent-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'consent-title');
  overlay.setAttribute('aria-describedby', 'consent-description');

  overlay.innerHTML = `
    <div class="consent-dialog">
      <div class="consent-title" id="consent-title">Usage Analytics</div>
      <div class="consent-description" id="consent-description">
        Help improve ngLens by sharing anonymous usage data. No personal information, page URLs, or analysis results are ever collected.
      </div>
      <div class="consent-buttons">
        <button class="consent-btn consent-btn-allow" id="consentAllow" aria-label="Allow anonymous usage analytics">
          Allow anonymous usage analytics
        </button>
        <button class="consent-btn consent-btn-deny" id="consentDeny" aria-label="No thanks">
          No thanks
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const allowBtn = document.getElementById('consentAllow') as HTMLButtonElement;
  const denyBtn = document.getElementById('consentDeny') as HTMLButtonElement;

  allowBtn.addEventListener('click', () => handleConsentChoice('granted', overlay));
  denyBtn.addEventListener('click', () => handleConsentChoice('denied', overlay));
  allowBtn.focus();
}

async function handleConsentChoice(consent: 'granted' | 'denied', overlay: HTMLElement): Promise<void> {
  await chrome.storage.local.set({ analytics_consent: consent });
  const message: ExtensionMessage = {
    type: 'ANALYTICS_CONSENT_CHANGED',
    payload: { consent },
    timestamp: Date.now(),
  };
  chrome.runtime.sendMessage(message);
  overlay.remove();

  const toggle = document.getElementById('analyticsToggle') as HTMLInputElement;
  if (toggle) {
    toggle.checked = consent === 'granted';
  }
}

// --- Analytics disabled for this release: hide the analytics UI ---

function hideAnalyticsControls(): void {
  // Hide the settings row container if present, else the toggle itself.
  const container = document.querySelector('.analytics-setting') as HTMLElement | null;
  if (container) {
    container.style.display = 'none';
    return;
  }
  const toggle = document.getElementById('analyticsToggle');
  const row = toggle?.closest('.analytics-setting') as HTMLElement | null;
  if (row) row.style.display = 'none';
  else if (toggle) (toggle as HTMLElement).style.display = 'none';
}

// --- Analytics Settings Toggle ---

async function initAnalyticsToggle(): Promise<void> {
  const toggle = document.getElementById('analyticsToggle') as HTMLInputElement;
  if (!toggle) return;

  try {
    const result = await chrome.storage.local.get('analytics_consent');
    toggle.checked = result['analytics_consent'] === 'granted';
  } catch {
    toggle.checked = false;
  }

  toggle.addEventListener('change', async () => {
    const newConsent: 'granted' | 'denied' = toggle.checked ? 'granted' : 'denied';
    await chrome.storage.local.set({ analytics_consent: newConsent });
    const message: ExtensionMessage = {
      type: 'ANALYTICS_CONSENT_CHANGED',
      payload: { consent: newConsent },
      timestamp: Date.now(),
    };
    chrome.runtime.sendMessage(message);
  });
}

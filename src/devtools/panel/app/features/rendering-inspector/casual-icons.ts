/**
 * Casual, hand-made SVG icons for the Render Inspector.
 * Simple, human-drawn style — not emoji, not polished icon sets.
 */

export const CasualIcons = {
  // Severity indicators
  severityHigh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>`,

  severityMedium: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M12 2 L22 20 H2 Z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`,

  severityLow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`,

  // Action triggers
  pageLoad: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4h16v16H4z"/>
    <path d="M9 9h6v6H9z"/>
    <path d="M4 14h5M15 14h5"/>
  </svg>`,

  click: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2l6 12H6z"/>
    <circle cx="12" cy="18" r="1"/>
  </svg>`,

  input: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <rect x="3" y="7" width="18" height="10" rx="1"/>
    <line x1="7" y1="12" x2="17" y2="12"/>
  </svg>`,

  timer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="13" r="9"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="13" x2="15" y2="13"/>
    <path d="M9 5h6"/>
  </svg>`,

  api: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="12 3 20 7 20 17 12 21 4 17 4 7 12 3"/>
    <line x1="12" y1="12" x2="20" y2="7"/>
    <line x1="12" y1="12" x2="12" y2="21"/>
    <line x1="12" y1="12" x2="4" y2="7"/>
  </svg>`,

  other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="12" r="1"/>
    <circle cx="19" cy="12" r="1"/>
    <circle cx="5" cy="12" r="1"/>
  </svg>`,

  // UI controls
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`,

  tree: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <circle cx="12" cy="5" r="1.5"/>
    <line x1="12" y1="6.5" x2="12" y2="11"/>
    <circle cx="7" cy="14" r="1.5"/>
    <circle cx="12" cy="14" r="1.5"/>
    <circle cx="17" cy="14" r="1.5"/>
    <line x1="12" y1="11" x2="7" y2="12.5"/>
    <line x1="12" y1="11" x2="12" y2="12.5"/>
    <line x1="12" y1="11" x2="17" y2="12.5"/>
  </svg>`,
};

/**
 * Get icon SVG by action trigger type
 */
export function getActionIcon(trigger: string): string {
  switch (trigger) {
    case 'Page Load':
      return CasualIcons.pageLoad;
    case 'Click':
      return CasualIcons.click;
    case 'Input':
      return CasualIcons.input;
    case 'Timer':
      return CasualIcons.timer;
    case 'API':
      return CasualIcons.api;
    default:
      return CasualIcons.other;
  }
}

/**
 * Get icon SVG by severity
 */
export function getSeverityIcon(severity: string): string {
  switch (severity) {
    case 'high':
      return CasualIcons.severityHigh;
    case 'medium':
      return CasualIcons.severityMedium;
    case 'low':
      return CasualIcons.severityLow;
    default:
      return CasualIcons.severityLow;
  }
}

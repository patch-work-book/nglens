/**
 * Diff Engine Service
 * 
 * Computes what changed during an execution step.
 * Never shows full JSON payloads by default.
 * Always shows: Added, Removed, Modified fields with before/after values.
 * 
 * Answers: "What changed?"
 */

import { Injectable } from '@angular/core';
import type { RuntimeEvent, DiffResult } from '../../../../types/execution-intelligence';

interface ValueChange {
  key: string;
  oldValue: any;
  newValue: any;
  type: string;
  magnitude?: number; // For numeric: percentage change
}

@Injectable({ providedIn: 'root' })
export class DiffEngineService {
  /**
   * Compute diff for a set of events.
   * Extracts before/after snapshots and computes the diff.
   */
  computeDiff(events: RuntimeEvent[]): DiffResult {
    // Find events that indicate state changes
    const stateChangeEvents = events.filter(e =>
      e.type === 'signal-write' ||
      e.type === 'subject-emit' ||
      e.type === 'store-dispatch' ||
      e.type === 'http-response'
    );

    if (stateChangeEvents.length === 0) {
      return this.createEmptyDiff();
    }

    // Collect all value snapshots
    const beforeSnapshot: Record<string, any> = {};
    const afterSnapshot: Record<string, any> = {};
    const changes: ValueChange[] = [];

    for (const event of stateChangeEvents) {
      if (event.valueSnapshot) {
        Object.assign(afterSnapshot, event.valueSnapshot);

        // Try to extract value history from metadata
        if (event.metadata?.['oldValue']) {
          Object.assign(beforeSnapshot, event.metadata['oldValue']);
        }
      }

      // Parse response body for HTTP events
      if (event.type === 'http-response' && event.responseBody) {
        try {
          const parsed = JSON.parse(event.responseBody);
          Object.assign(afterSnapshot, { response: parsed });
        } catch {
          // Not JSON, ignore
        }
      }
    }

    // Compute the diff
    const added: ValueChange[] = [];
    const removed: ValueChange[] = [];
    const modified: ValueChange[] = [];

    const allKeys = new Set<string>();
    for (const key of Object.keys(beforeSnapshot)) allKeys.add(key);
    for (const key of Object.keys(afterSnapshot)) allKeys.add(key);

    for (const key of allKeys) {
      const before = beforeSnapshot[key];
      const after = afterSnapshot[key];

      if (before === undefined && after !== undefined) {
        added.push({
          key,
          oldValue: undefined,
          newValue: after,
          type: typeof after,
        });
      } else if (before !== undefined && after === undefined) {
        removed.push({
          key,
          oldValue: before,
          newValue: undefined,
          type: typeof before,
        });
      } else if (!this.deepEqual(before, after)) {
        modified.push({
          key,
          oldValue: before,
          newValue: after,
          type: typeof after,
          magnitude: this.computeMagnitude(before, after),
        });
      }
    }

    // Generate summary
    const summary = this.generateSummary(added, removed, modified);

    return {
      added: {
        count: added.length,
        properties: added.map(c => ({
          key: c.key,
          value: this.formatValue(c.newValue),
          type: c.type,
        })),
      },
      removed: {
        count: removed.length,
        properties: removed.map(c => ({
          key: c.key,
          oldValue: this.formatValue(c.oldValue),
          type: c.type,
        })),
      },
      modified: {
        count: modified.length,
        properties: modified.map(c => ({
          key: c.key,
          oldValue: this.formatValue(c.oldValue),
          newValue: this.formatValue(c.newValue),
          type: c.type,
          magnitude: c.magnitude,
        })),
      },
      beforeSnapshot,
      afterSnapshot,
      summary,
    };
  }

  /**
   * Compute just the summary string without full snapshot.
   * Lightweight diff for quick display.
   */
  computeSummaryDiff(events: RuntimeEvent[]): string {
    const diff = this.computeDiff(events);
    return diff.summary;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private createEmptyDiff(): DiffResult {
    return {
      added: { count: 0, properties: [] },
      removed: { count: 0, properties: [] },
      modified: { count: 0, properties: [] },
      summary: 'No changes detected',
    };
  }

  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object' && a !== null && b !== null) {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;

      for (const key of keysA) {
        if (!this.deepEqual(a[key], b[key])) return false;
      }
      return true;
    }

    return false;
  }

  private computeMagnitude(oldValue: any, newValue: any): number | undefined {
    if (typeof oldValue === 'number' && typeof newValue === 'number') {
      if (oldValue === 0) return 100; // Infinite growth
      const change = ((newValue - oldValue) / Math.abs(oldValue)) * 100;
      return Math.round(change);
    }

    if (typeof oldValue === 'string' && typeof newValue === 'string') {
      const oldLen = oldValue.length;
      const newLen = newValue.length;
      if (oldLen === 0) return 100;
      return Math.round(((newLen - oldLen) / oldLen) * 100);
    }

    return undefined;
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }

    if (typeof value === 'string') {
      return value.length > 50 ? value.substring(0, 47) + '...' : value;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return `[${value.length} items]`;
      }
      const keys = Object.keys(value).slice(0, 3);
      return `{${keys.join(', ')}${keys.length < Object.keys(value).length ? ', ...' : ''}}`;
    }

    return String(value);
  }

  private generateSummary(
    added: ValueChange[],
    removed: ValueChange[],
    modified: ValueChange[]
  ): string {
    const parts: string[] = [];

    // Modified changes (most important)
    if (modified.length > 0) {
      const topModified = modified.slice(0, 2);
      const modifiedSummary = topModified
        .map(c => `${c.key}: ${this.formatValue(c.oldValue)} → ${this.formatValue(c.newValue)}`)
        .join(', ');
      parts.push(modifiedSummary);
    }

    // Added (secondary)
    if (added.length > 0) {
      parts.push(`+${added.length} field${added.length > 1 ? 's' : ''}`);
    }

    // Removed (secondary)
    if (removed.length > 0) {
      parts.push(`-${removed.length} field${removed.length > 1 ? 's' : ''}`);
    }

    return parts.join(', ') || 'No changes';
  }
}

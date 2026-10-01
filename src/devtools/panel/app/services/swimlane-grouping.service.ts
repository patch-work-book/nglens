/**
 * Swimlane Grouping Service
 *
 * Transforms high-density execution telemetry (40+ APIs, 20+ renders in page load)
 * into grouped swimlane items with progressive disclosure.
 *
 * Responsibilities:
 * 1. Event coalescing — merge rapid-fire events within <20ms windows
 * 2. Batch detection — identify parallel API bursts, component bootstrap cascades, signal microtask batches
 * 3. Duplicate API flagging — same URL requested >1× within 100ms
 * 4. Bottleneck identification — longest blocking item on the critical path
 * 5. Issue detection — un-coalesced parallel requests, excessive renders
 */

import { Injectable } from '@angular/core';
import type { ExecutionNarrative } from '@nglens/types/execution-narrative';

// ──────────────────────────────────────────────────────────────────────────────
// PUBLIC INTERFACES
// ──────────────────────────────────────────────────────────────────────────────

export type SwimlaneCategory = 'api' | 'render' | 'signal' | 'store' | 'interaction';

export interface SwimlaneItem {
  id: string;
  title: string;
  category: SwimlaneCategory;
  startTime: number;         // ms from session start
  endTime: number;
  duration: number;
  startPct: number;          // 0-100 for bar positioning
  widthPct: number;          // 0-100 for bar width
  isSlow: boolean;
  isBottleneck: boolean;
  isDuplicate: boolean;
  duplicateCount: number;
  /** Whether this bar's width is minimum-constrained (actual duration too small to display proportionally) */
  isMinWidthConstrained?: boolean;
  /** Original step data for detail drawer */
  stepData?: any;
}

export interface SwimlaneGroup {
  id: string;
  title: string;
  category: SwimlaneCategory;
  icon: string;
  itemCount: number;
  items: SwimlaneItem[];
  /** Aggregate metrics */
  totalDuration: number;
  startTime: number;
  endTime: number;
  startPct: number;
  widthPct: number;
  /** Whether this group is expanded (progressive disclosure) */
  expanded: boolean;
}

export interface SwimlaneLane {
  id: string;
  label: string;
  icon: string;
  category: SwimlaneCategory;
  /** Mix of individual items and batch groups */
  entries: Array<SwimlaneItem | SwimlaneGroup>;
  /** Total items (including those inside groups) */
  totalItemCount: number;
}

export interface HighDensityIssue {
  id: string;
  type: 'duplicate-api' | 'uncoalesced-parallel' | 'primary-bottleneck' | 'excessive-renders';
  severity: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  suggestion: string;
  /** Items involved in this issue */
  relatedItemIds: string[];
}

export interface SwimlaneResult {
  /** Session-level summary */
  summary: {
    totalApis: number;
    totalRenders: number;
    totalSignals: number;
    totalStoreUpdates: number;
    duplicateApiCount: number;
    totalDuration: number;
    primaryBottleneck: string | null;
    bottleneckDuration: number;
  };
  /** The 4 swimlane tracks */
  lanes: SwimlaneLane[];
  /** Detected issues */
  issues: HighDensityIssue[];
  /** All items flattened (for search/filter) */
  allItems: SwimlaneItem[];
  /** Total session duration for timeline scaling */
  sessionDuration: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// SERVICE IMPLEMENTATION
// ──────────────────────────────────────────────────────────────────────────────

/** Time window for grouping parallel events into a batch */
const BATCH_WINDOW_MS = 20;
/** Time window for detecting duplicate API calls */
const DUPLICATE_WINDOW_MS = 100;
/** Threshold for flagging un-coalesced parallel requests */
const PARALLEL_THRESHOLD = 10;
/** Slow render threshold (frame budget) */
const SLOW_RENDER_MS = 16;
/** Slow API threshold */
const SLOW_API_MS = 300;

@Injectable({ providedIn: 'root' })
export class SwimlaneGroupingService {

  /**
   * Transform an ExecutionNarrative into grouped swimlane data.
   */
  buildSwimlanes(narrative: ExecutionNarrative): SwimlaneResult {
    const steps = narrative.originalStory?.steps || [];
    const sessionStart = narrative.startTime || 0;
    const sessionDuration = narrative.duration || 1;

    // Step 1: Classify all steps into SwimlaneItems
    const allItems = this.classifySteps(steps, sessionStart, sessionDuration);

    // Step 2: Detect duplicates
    this.flagDuplicates(allItems);

    // Step 3: Identify bottleneck
    const bottleneck = this.findBottleneck(allItems);

    // Step 4: Group items into batches per lane
    const apiItems = allItems.filter(i => i.category === 'api');
    const renderItems = allItems.filter(i => i.category === 'render');
    const signalItems = allItems.filter(i => i.category === 'signal');
    const storeItems = allItems.filter(i => i.category === 'store');
    const interactionItems = allItems.filter(i => i.category === 'interaction');

    // Lane labels are plain text; the DevTools-style color accent on the lane
    // header carries the category, so no decorative emoji is needed (spec §39).
    const apiLane = this.buildLane('lane-api', 'Network', '', 'api', apiItems);
    const renderLane = this.buildLane('lane-render', 'Components', '', 'render', renderItems);
    const signalLane = this.buildLane('lane-signal', 'Signals', '', 'signal', signalItems);
    const storeLane = this.buildLane('lane-store', 'State', '', 'store', storeItems);

    // Build lanes array (only include lanes with items)
    const lanes: SwimlaneLane[] = [];
    if (interactionItems.length > 0) {
      lanes.push({
        id: 'lane-interaction',
        label: 'Trigger',
        icon: '',
        category: 'interaction',
        entries: interactionItems,
        totalItemCount: interactionItems.length,
      });
    }
    if (apiLane.totalItemCount > 0) lanes.push(apiLane);
    if (storeLane.totalItemCount > 0) lanes.push(storeLane);
    if (signalLane.totalItemCount > 0) lanes.push(signalLane);
    if (renderLane.totalItemCount > 0) lanes.push(renderLane);

    // Step 5: Detect issues
    const issues = this.detectIssues(allItems, apiItems, renderItems);

    // Step 6: Build summary
    const duplicateApiCount = apiItems.filter(i => i.isDuplicate).length;
    const summary = {
      totalApis: apiItems.length,
      totalRenders: renderItems.length,
      totalSignals: signalItems.length,
      totalStoreUpdates: storeItems.length,
      duplicateApiCount,
      totalDuration: sessionDuration,
      primaryBottleneck: bottleneck?.title || null,
      bottleneckDuration: bottleneck?.duration || 0,
    };

    return {
      summary,
      lanes,
      issues,
      allItems,
      sessionDuration,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STEP CLASSIFICATION
  // ──────────────────────────────────────────────────────────────────────────

  private classifySteps(steps: any[], sessionStart: number, sessionDuration: number): SwimlaneItem[] {
    const items: SwimlaneItem[] = [];
    let idCounter = 0;

    for (const step of steps) {
      const title = step.title || step.summary || 'Unknown';
      const type = step.type || '';
      const itemStart = (step.startTime || sessionStart) - sessionStart;
      const itemDur = step.duration || 0;
      const itemEnd = itemStart + itemDur;

      const category = this.categorize(type, title);

      // Compute percentage positions for waterfall bars
      const startPct = sessionDuration > 0 ? Math.max(0, (itemStart / sessionDuration) * 100) : 0;
      // For render items with very small durations, use a larger minimum width (1%)
      // for visibility. API and other events use 0.3% minimum for compact display.
      const minWidthPct = category === 'render' ? 1 : 0.3;
      const computedWidthPct = sessionDuration > 0 ? (itemDur / sessionDuration) * 100 : 0;
      const widthPct = Math.max(minWidthPct, computedWidthPct);
      const isMinWidthConstrained = computedWidthPct < minWidthPct;

      const isSlow = category === 'api'
        ? itemDur > SLOW_API_MS
        : category === 'render'
          ? itemDur > SLOW_RENDER_MS
          : false;

      // Extract display name — prefer detailed info for APIs
      let displayTitle = title;
      if (category === 'api') {
        // Try to get the full endpoint from step.summary or step detail
        // step.summary often has the actual URL like "GET /api/VatPotentialClients_Detailed_Domestic_V3"
        displayTitle = step.summary || step.detail || title;
        // Remove common verbose prefixes
        displayTitle = displayTitle.replace(/^(Loaded|Fetched|Received)\s*/i, '');
      } else if (category === 'render') {
        displayTitle = title.replace(/^_/, '').replace(/ Rendered$/i, '').replace(/ rendered$/i, '');
      }

      items.push({
        id: `swim-${idCounter++}`,
        title: displayTitle,
        category,
        startTime: itemStart,
        endTime: itemEnd,
        duration: itemDur,
        startPct,
        widthPct,
        isSlow,
        isBottleneck: false,
        isDuplicate: false,
        duplicateCount: 1,
        isMinWidthConstrained,
        stepData: step,
      });
    }

    return items;
  }

  private categorize(type: string, title: string): SwimlaneCategory {
    if (type === 'data-fetch' || title.includes('GET ') || title.includes('POST ') || title.includes('PUT ') || title.includes('DELETE ') || title.includes('Loaded')) {
      return 'api';
    }
    if (type === 'store-mutation' || type === 'store-dispatch' || title.includes('Store')) {
      return 'store';
    }
    if (type === 'state-update' || type === 'signal-write' || title.includes('Signal') || title.includes('signal')) {
      return 'signal';
    }
    if (type === 'user-interaction' || title.includes('Click') || title.includes('Action') || title.includes('Interaction')) {
      return 'interaction';
    }
    // Default: component render
    return 'render';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DUPLICATE DETECTION
  // ──────────────────────────────────────────────────────────────────────────

  private flagDuplicates(items: SwimlaneItem[]): void {
    const apiItems = items.filter(i => i.category === 'api');

    // Group by EXACT title — only truly identical URLs are duplicates.
    // Different endpoints that share a suffix (e.g. "V3 Loaded") are NOT duplicates.
    const urlMap = new Map<string, SwimlaneItem[]>();
    for (const item of apiItems) {
      const key = this.getDuplicateKey(item);
      const existing = urlMap.get(key) || [];
      existing.push(item);
      urlMap.set(key, existing);
    }

    // Flag duplicates (same exact URL requested >1× within DUPLICATE_WINDOW_MS)
    for (const [, group] of urlMap) {
      if (group.length <= 1) continue;

      // Sort by start time
      group.sort((a, b) => a.startTime - b.startTime);

      // Only flag if requests are within the time window (rapid-fire same request)
      let hasDuplicatesInWindow = false;
      for (let i = 1; i < group.length; i++) {
        const timeDiff = group[i].startTime - group[i - 1].startTime;
        if (timeDiff < DUPLICATE_WINDOW_MS) {
          hasDuplicatesInWindow = true;
          break;
        }
      }

      if (hasDuplicatesInWindow) {
        for (const item of group) {
          item.isDuplicate = true;
          item.duplicateCount = group.length;
        }
      }
    }
  }

  /**
   * Get a stable key for duplicate detection.
   * Uses the full title (which now contains the actual endpoint name).
   * Only strips trivial suffixes like status codes.
   */
  private getDuplicateKey(item: SwimlaneItem): string {
    // Use the full title as-is, just lowercase for comparison.
    // If the step has original event data with a URL, prefer that.
    const stepData = item.stepData;
    if (stepData?.eventIds?.[0]) {
      // If we have access to the original event label, use it
      const label = stepData.title || stepData.summary || '';
      if (label) return label.trim().toLowerCase();
    }
    return item.title.trim().toLowerCase();
  }

  private normalizeUrl(title: string): string {
    // Strip status codes, query params, and numeric IDs for grouping
    return title
      .replace(/\s*→\s*\d+$/, '')     // Remove "→ 200"
      .replace(/\?\S+/, '')            // Remove query params
      .replace(/\/\d+/g, '/:id')      // Normalize numeric path segments
      .trim()
      .toLowerCase();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BOTTLENECK IDENTIFICATION
  // ──────────────────────────────────────────────────────────────────────────

  private findBottleneck(items: SwimlaneItem[]): SwimlaneItem | null {
    if (items.length === 0) return null;

    // The bottleneck is the single longest-duration item that blocks paint
    let longest: SwimlaneItem | null = null;
    let maxDur = 0;

    for (const item of items) {
      if (item.duration > maxDur) {
        maxDur = item.duration;
        longest = item;
      }
    }

    if (longest && longest.duration > 50) {
      longest.isBottleneck = true;
    }

    return longest;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LANE BUILDING (with batch grouping)
  // ──────────────────────────────────────────────────────────────────────────

  private buildLane(id: string, label: string, icon: string, category: SwimlaneCategory, items: SwimlaneItem[]): SwimlaneLane {
    if (items.length === 0) {
      return { id, label, icon, category, entries: [], totalItemCount: 0 };
    }

    // Sort by start time
    const sorted = [...items].sort((a, b) => a.startTime - b.startTime);

    // Group items occurring within BATCH_WINDOW_MS of each other
    const entries: Array<SwimlaneItem | SwimlaneGroup> = [];
    let currentBatch: SwimlaneItem[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = currentBatch[currentBatch.length - 1];
      const curr = sorted[i];

      if (curr.startTime - prev.startTime <= BATCH_WINDOW_MS) {
        currentBatch.push(curr);
      } else {
        // Flush previous batch
        this.flushBatch(currentBatch, category, entries);
        currentBatch = [curr];
      }
    }
    // Flush last batch
    this.flushBatch(currentBatch, category, entries);

    return {
      id,
      label,
      icon,
      category,
      entries,
      totalItemCount: items.length,
    };
  }

  private flushBatch(batch: SwimlaneItem[], category: SwimlaneCategory, output: Array<SwimlaneItem | SwimlaneGroup>): void {
    if (batch.length === 0) return;

    // If batch has fewer than 3 items, emit individually (not worth grouping)
    if (batch.length < 3) {
      output.push(...batch);
      return;
    }

    // Create a group node
    const startTime = Math.min(...batch.map(i => i.startTime));
    const endTime = Math.max(...batch.map(i => i.endTime));
    const totalDuration = batch.reduce((sum, i) => sum + i.duration, 0);

    // Compute percentage positions for the group bar
    const firstItem = batch[0];
    const lastItem = batch[batch.length - 1];
    const startPct = firstItem.startPct;
    const widthPct = (lastItem.startPct + lastItem.widthPct) - firstItem.startPct;

    const groupTitle = this.getBatchTitle(category, batch.length);
    const groupIcon = this.getBatchIcon(category);

    output.push({
      id: `group-${category}-${startTime}`,
      title: groupTitle,
      category,
      icon: groupIcon,
      itemCount: batch.length,
      items: batch,
      totalDuration,
      startTime,
      endTime,
      startPct,
      widthPct,
      expanded: false,
    } as SwimlaneGroup);
  }

  private getBatchTitle(category: SwimlaneCategory, count: number): string {
    switch (category) {
      case 'api': return `Batch Network Calls (${count} items)`;
      case 'render': return `Component Bootstrap Cascade (${count} components)`;
      case 'signal': return `Signal Writes (${count} updates)`;
      case 'store': return `State Updates (${count} dispatches)`;
      default: return `Batch (${count} items)`;
    }
  }

  private getBatchIcon(_category: SwimlaneCategory): string {
    // No decorative icon; the group title + lane color convey category.
    return '';
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ISSUE DETECTION
  // ──────────────────────────────────────────────────────────────────────────

  private detectIssues(allItems: SwimlaneItem[], apiItems: SwimlaneItem[], renderItems: SwimlaneItem[]): HighDensityIssue[] {
    const issues: HighDensityIssue[] = [];
    let issueId = 0;

    // Issue 1: Duplicate API calls (same URL >1× within 100ms)
    const duplicates = apiItems.filter(i => i.isDuplicate);
    if (duplicates.length > 0) {
      const uniqueUrls = new Set(duplicates.map(i => this.normalizeUrl(i.title)));
      for (const url of uniqueUrls) {
        const group = duplicates.filter(i => this.normalizeUrl(i.title) === url);
        issues.push({
          id: `issue-${issueId++}`,
          type: 'duplicate-api',
          severity: 'warning',
          // Detection is a pure observation: identical URL requested more than
          // once inside the window. We do NOT assert a cause (the two calls may
          // be intentional) or prescribe a fix without evidence (spec §23).
          title: `Duplicate request: ${group[0].title}`,
          detail: `Same URL requested ${group.length}× within ${DUPLICATE_WINDOW_MS}ms. Cause not determined.`,
          suggestion: 'If unintended, deduplicating (e.g. shareReplay) may help — verify the calls are redundant first.',
          relatedItemIds: group.map(i => i.id),
        });
      }
    }

    // Issue 2: Un-coalesced parallel requests (>10 concurrent HTTP calls)
    const concurrentPeaks = this.findConcurrencyPeaks(apiItems);
    for (const peak of concurrentPeaks) {
      if (peak.count >= PARALLEL_THRESHOLD) {
        issues.push({
          id: `issue-${issueId++}`,
          type: 'uncoalesced-parallel',
          severity: 'warning',
          title: `${peak.count} concurrent HTTP calls at ${Math.round(peak.time)}ms`,
          detail: `Peak concurrency of ${peak.count} simultaneous requests may saturate the browser connection pool (limit: 6 per domain)`,
          suggestion: 'Batch requests with forkJoin() or stagger with concatMap()',
          relatedItemIds: peak.itemIds,
        });
      }
    }

    // Issue 3: Primary bottleneck blocking initial paint
    const bottleneck = allItems.find(i => i.isBottleneck);
    if (bottleneck && bottleneck.duration > 100) {
      issues.push({
        id: `issue-${issueId++}`,
        type: 'primary-bottleneck',
        severity: 'error',
        // Fact: this is the single longest-duration item observed. Whether it
        // actually blocked paint is not established here (no dependency graph).
        title: `Longest operation: ${bottleneck.title} (${Math.round(bottleneck.duration)}ms)`,
        detail: `Longest single operation observed in this execution. Blocking impact not established.`,
        suggestion: bottleneck.category === 'api'
          ? 'If this is on the render path, prefetching or progressive loading may help.'
          : 'If this delays paint, consider splitting the work or deferring non-critical parts.',
        relatedItemIds: [bottleneck.id],
      });
    }

    // Issue 4: Excessive component renders
    const renderCounts = new Map<string, SwimlaneItem[]>();
    for (const item of renderItems) {
      const key = item.title;
      const existing = renderCounts.get(key) || [];
      existing.push(item);
      renderCounts.set(key, existing);
    }
    for (const [name, group] of renderCounts) {
      if (group.length >= 5) {
        issues.push({
          id: `issue-${issueId++}`,
          type: 'excessive-renders',
          severity: 'warning',
          // Fact: render count only. We do not assert the cause (§10).
          title: `${name} rendered ${group.length}× in this execution`,
          detail: `${group.length} renders observed for this component. Cause not determined here — inspect it in Components.`,
          suggestion: 'If the repeats are avoidable, OnPush or stabler inputs may reduce them.',
          relatedItemIds: group.map(i => i.id),
        });
      }
    }

    return issues;
  }

  private findConcurrencyPeaks(apiItems: SwimlaneItem[]): Array<{ time: number; count: number; itemIds: string[] }> {
    if (apiItems.length < PARALLEL_THRESHOLD) return [];

    const peaks: Array<{ time: number; count: number; itemIds: string[] }> = [];

    // Sweep line algorithm: find peak concurrency
    const events: Array<{ time: number; type: 'start' | 'end'; itemId: string }> = [];
    for (const item of apiItems) {
      events.push({ time: item.startTime, type: 'start', itemId: item.id });
      events.push({ time: item.endTime, type: 'end', itemId: item.id });
    }
    events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

    let current = 0;
    let maxCount = 0;
    let maxTime = 0;
    const activeIds = new Set<string>();

    for (const ev of events) {
      if (ev.type === 'start') {
        current++;
        activeIds.add(ev.itemId);
        if (current > maxCount) {
          maxCount = current;
          maxTime = ev.time;
        }
      } else {
        current--;
        activeIds.delete(ev.itemId);
      }
    }

    if (maxCount >= PARALLEL_THRESHOLD) {
      // Find all items active at the peak time
      const peakIds = apiItems
        .filter(i => i.startTime <= maxTime && i.endTime >= maxTime)
        .map(i => i.id);
      peaks.push({ time: maxTime, count: maxCount, itemIds: peakIds });
    }

    return peaks;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FILTERING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Filter swimlane items by text query (searches title).
   */
  filterByQuery(result: SwimlaneResult, query: string): SwimlaneResult {
    if (!query.trim()) return result;

    const q = query.toLowerCase();
    const filteredItems = result.allItems.filter(i => i.title.toLowerCase().includes(q));
    const filteredIds = new Set(filteredItems.map(i => i.id));

    const filteredLanes = result.lanes.map(lane => ({
      ...lane,
      entries: lane.entries.filter(entry => {
        if ('items' in entry) {
          // Group: keep if any child matches
          return (entry as SwimlaneGroup).items.some(i => filteredIds.has(i.id));
        }
        return filteredIds.has((entry as SwimlaneItem).id);
      }),
      totalItemCount: lane.entries.reduce((sum, entry) => {
        if ('items' in entry) {
          return sum + (entry as SwimlaneGroup).items.filter(i => filteredIds.has(i.id)).length;
        }
        return sum + (filteredIds.has((entry as SwimlaneItem).id) ? 1 : 0);
      }, 0),
    })).filter(lane => lane.totalItemCount > 0);

    return { ...result, lanes: filteredLanes, allItems: filteredItems };
  }

  /**
   * Filter to critical path only (slow + bottleneck items).
   */
  filterCriticalPath(result: SwimlaneResult): SwimlaneResult {
    const criticalItems = result.allItems.filter(i => i.isSlow || i.isBottleneck);
    const criticalIds = new Set(criticalItems.map(i => i.id));

    const filteredLanes = result.lanes.map(lane => ({
      ...lane,
      entries: lane.entries.filter(entry => {
        if ('items' in entry) {
          return (entry as SwimlaneGroup).items.some(i => criticalIds.has(i.id));
        }
        return criticalIds.has((entry as SwimlaneItem).id);
      }),
      totalItemCount: criticalItems.filter(i => i.category === lane.category).length,
    })).filter(lane => lane.totalItemCount > 0);

    return { ...result, lanes: filteredLanes, allItems: criticalItems };
  }

  /**
   * Filter to slow items only (>16ms renders, >300ms APIs).
   */
  filterSlow(result: SwimlaneResult): SwimlaneResult {
    const slowItems = result.allItems.filter(i => i.isSlow);
    const slowIds = new Set(slowItems.map(i => i.id));

    const filteredLanes = result.lanes.map(lane => ({
      ...lane,
      entries: lane.entries.filter(entry => {
        if ('items' in entry) {
          return (entry as SwimlaneGroup).items.some(i => slowIds.has(i.id));
        }
        return slowIds.has((entry as SwimlaneItem).id);
      }),
      totalItemCount: slowItems.filter(i => i.category === lane.category).length,
    })).filter(lane => lane.totalItemCount > 0);

    return { ...result, lanes: filteredLanes, allItems: slowItems };
  }

  /**
   * Filter to duplicates only.
   */
  filterDuplicates(result: SwimlaneResult): SwimlaneResult {
    const dupItems = result.allItems.filter(i => i.isDuplicate || i.duplicateCount > 1);
    const dupIds = new Set(dupItems.map(i => i.id));

    const filteredLanes = result.lanes.map(lane => ({
      ...lane,
      entries: lane.entries.filter(entry => {
        if ('items' in entry) {
          return (entry as SwimlaneGroup).items.some(i => dupIds.has(i.id));
        }
        return dupIds.has((entry as SwimlaneItem).id);
      }),
      totalItemCount: dupItems.filter(i => i.category === lane.category).length,
    })).filter(lane => lane.totalItemCount > 0);

    return { ...result, lanes: filteredLanes, allItems: dupItems };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────────────────────────────────

  /** Type guard: is this entry a group? */
  isGroup(entry: SwimlaneItem | SwimlaneGroup): entry is SwimlaneGroup {
    return 'items' in entry && Array.isArray((entry as any).items);
  }
}

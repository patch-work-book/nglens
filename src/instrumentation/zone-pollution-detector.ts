/**
 * Zone Pollution Detector — production-ready singleton.
 *
 * Hooks Zone.js scheduleTask and intercepts ApplicationRef.tick() to correlate
 * async task sources with actual Angular change detection cycles.
 * Maintains a circular buffer of TaskRecords, computes per-source CD/min metrics,
 * classifies severity, and emits ranked pollution events to the content script.
 */

import type { TaskRecord, PollutionSourceMetrics, ZonePollutionEvent } from '../types/zone-pollution-events';
import {
  evictExpiredRecords,
  computeCdPerMinute,
  classifySeverity,
  rankSources,
  extractLibraryFromStack,
  getFixSuggestion,
  shouldAttributeCd,
  isInStartupPeriod,
} from './zone-pollution-utils';
import { PerformanceGuard } from './performance-guard';

const PAGE_TO_CONTENT_EVENT = '__ng_perf_to_content';

/** Maximum records held in the circular buffer */
const MAX_BUFFER_SIZE = 10_000;

/** Rolling window for metrics computation (60 seconds) */
const WINDOW_MS = 60_000;

/** Default batch emission interval */
const DEFAULT_BATCH_INTERVAL_MS = 100;

/** Reduced batch interval when overhead is high */
const DEGRADED_BATCH_INTERVAL_MS = 500;

/** CD attribution threshold — one frame at 60fps */
const CD_ATTRIBUTION_THRESHOLD_MS = 16;

/** Startup period duration — records stored but not emitted */
const STARTUP_DURATION_MS = 5_000;

/** Top N sources to emit per batch */
const TOP_SOURCES_LIMIT = 10;

export class ZonePollutionDetector {
  private static instance: ZonePollutionDetector | null = null;

  private isRunning = false;
  private startTime = 0;

  // Circular buffer of task records
  private buffer: TaskRecord[] = [];

  // Zone.js hook state
  private originalScheduleTask: any = null;
  private zoneDelegate: any = null;

  // ApplicationRef.tick interception
  private originalTick: ((...args: any[]) => any) | null = null;
  private tickTarget: any = null;

  // CD cycle tracking
  private lastCdTime = 0;

  // Batch interval
  private batchInterval: ReturnType<typeof setInterval> | null = null;
  private currentBatchIntervalMs = DEFAULT_BATCH_INTERVAL_MS;

  private constructor() {}

  static getInstance(): ZonePollutionDetector {
    if (!ZonePollutionDetector.instance) {
      ZonePollutionDetector.instance = new ZonePollutionDetector();
    }
    return ZonePollutionDetector.instance;
  }

  /** Start instrumentation. Called by Orchestrator on START_TRACKING. */
  start(): void {
    if (this.isRunning) return;

    // Zoneless detection: if Zone.js is not present, emit informational event and bail
    if (!this.isZoneJsPresent()) {
      this.emitZonelessEvent();
      return;
    }

    this.startTime = performance.now();
    this.isRunning = true;

    this.hookZoneScheduleTask();
    this.interceptTick();
    this.startBatching(DEFAULT_BATCH_INTERVAL_MS);
  }

  /** Stop instrumentation. Called by Orchestrator on STOP_TRACKING. */
  stop(): void {
    if (!this.isRunning) return;

    this.stopBatching();
    this.unhookZoneScheduleTask();
    this.restoreTick();

    this.isRunning = false;
  }

  /** Clear all buffered data without stopping. Called on CLEAR_DATA. */
  clear(): void {
    this.buffer = [];
    this.lastCdTime = 0;
  }

  // ─── Zone.js Hook ──────────────────────────────────────────────────────────

  private isZoneJsPresent(): boolean {
    return !!(globalThis as any).Zone?.current;
  }

  private hookZoneScheduleTask(): void {
    const zone = (globalThis as any).Zone?.current;
    if (!zone) return;

    const zoneDelegate = zone._zoneDelegate;
    if (!zoneDelegate || typeof zoneDelegate.scheduleTask !== 'function') return;

    this.zoneDelegate = zoneDelegate;
    this.originalScheduleTask = zoneDelegate.scheduleTask.bind(zoneDelegate);

    const self = this;
    const origFn = this.originalScheduleTask;

    zoneDelegate.scheduleTask = (targetZone: any, task: any): any => {
      self.recordTask(task);
      return origFn(targetZone, task);
    };
  }

  private unhookZoneScheduleTask(): void {
    if (this.originalScheduleTask && this.zoneDelegate) {
      this.zoneDelegate.scheduleTask = this.originalScheduleTask;
      this.originalScheduleTask = null;
      this.zoneDelegate = null;
    }
  }

  private recordTask(task: any): void {
    if (!task) return;

    const source = this.extractSource(task);
    const type = this.mapTaskType(task.type);
    const stack = this.getTaskStack(task);
    const library = extractLibraryFromStack(stack);

    const record: TaskRecord = {
      source,
      type,
      timestamp: performance.now(),
      triggeredCd: false,
      library,
    };

    this.insertIntoBuffer(record);
  }

  private getTaskStack(task: any): string {
    const creationLocation = typeof task.creationLocation === 'string' ? task.creationLocation : '';
    return creationLocation || (new Error().stack ?? '');
  }

  private extractSource(task: any): string {
    const taskSource: string = task.source ?? '';

    if (taskSource.includes('setTimeout')) return 'setTimeout';
    if (taskSource.includes('setInterval')) return 'setInterval';
    if (taskSource.includes('XMLHttpRequest')) return 'XMLHttpRequest';
    if (taskSource.includes('fetch')) return 'fetch';
    if (taskSource.includes('WebSocket')) return 'WebSocket';
    if (taskSource.includes('requestAnimationFrame')) return 'requestAnimationFrame';
    if (taskSource.includes('addEventListener')) {
      const match = /addEventListener:(\w+)/.exec(taskSource);
      return match ? `addEventListener:${match[1]}` : 'addEventListener';
    }
    if (task.type === 'microTask' || taskSource.includes('Promise')) return 'Promise.then';

    return taskSource || 'unknown';
  }

  private mapTaskType(type: string | undefined): TaskRecord['type'] {
    if (type === 'macroTask') return 'macroTask';
    if (type === 'microTask') return 'microTask';
    if (type === 'eventTask') return 'eventTask';
    return 'macroTask';
  }

  // ─── ApplicationRef.tick() Interception ────────────────────────────────────

  private interceptTick(): void {
    // Strategy 1: patch ApplicationRef prototype via ng debug API
    const ng = (globalThis as any).ng;

    // Try to get ApplicationRef from the root element's injector
    const appRoot = document.querySelector('[ng-version]') ?? document.querySelector('app-root');
    if (appRoot && ng?.getComponent) {
      try {
        const rootComponent = ng.getComponent(appRoot);
        if (rootComponent) {
          // Access injector via ɵinj or __ngContext__
          const injector = (rootComponent as any).__ngContext__?.injector
            ?? (appRoot as any).__ngContext__?.injector;
          if (injector) {
            const appRef = injector.get?.((globalThis as any).ng?.ɵApplicationRef);
            if (appRef && typeof appRef.tick === 'function') {
              this.tickTarget = appRef;
              this.originalTick = appRef.tick.bind(appRef);
              const self = this;
              appRef.tick = function (...args: any[]) {
                self.onTick();
                return self.originalTick!(...args);
              };
              return;
            }
          }
        }
      } catch {
        // Fall through to strategy 2
      }
    }

    // Strategy 2: Use ng.profiler if available
    if (ng?.profiler?.timeChangeDetection) {
      // Wrap the profiler's timeChangeDetection
      const originalTimeCD = ng.profiler.timeChangeDetection.bind(ng.profiler);
      const self = this;
      ng.profiler.timeChangeDetection = function (...args: any[]) {
        self.onTick();
        return originalTimeCD(...args);
      };
      this.tickTarget = ng.profiler;
      this.originalTick = originalTimeCD;
      return;
    }

    // Strategy 3: Patch ApplicationRef.prototype.tick if accessible
    try {
      const appRefProto = (globalThis as any).ng?.coreTokens?.ApplicationRef?.prototype;
      if (appRefProto && typeof appRefProto.tick === 'function') {
        this.tickTarget = appRefProto;
        this.originalTick = appRefProto.tick;
        const self = this;
        appRefProto.tick = function (this: any, ...args: any[]) {
          self.onTick();
          return self.originalTick!.apply(this, args);
        };
        return;
      }
    } catch {
      // No tick interception available — CD attribution will be heuristic-based
    }
  }

  private restoreTick(): void {
    if (this.originalTick && this.tickTarget) {
      if (this.tickTarget === (globalThis as any).ng?.profiler) {
        (globalThis as any).ng.profiler.timeChangeDetection = this.originalTick;
      } else if ('tick' in this.tickTarget) {
        this.tickTarget.tick = this.originalTick;
      }
      this.originalTick = null;
      this.tickTarget = null;
    }
  }

  private onTick(): void {
    const now = performance.now();
    this.lastCdTime = now;

    // Attribute recent tasks (within 16ms) as having triggered CD
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const record = this.buffer[i];
      if (record.triggeredCd) continue;
      if (shouldAttributeCd(record.timestamp, now, CD_ATTRIBUTION_THRESHOLD_MS)) {
        record.triggeredCd = true;
      } else if (now - record.timestamp > CD_ATTRIBUTION_THRESHOLD_MS) {
        // Records are ordered by time; once we pass the threshold, stop
        break;
      }
    }
  }

  // ─── Circular Buffer ───────────────────────────────────────────────────────

  private insertIntoBuffer(record: TaskRecord): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.buffer.push(record);
  }

  // ─── Batch Emission ────────────────────────────────────────────────────────

  private startBatching(intervalMs: number): void {
    this.currentBatchIntervalMs = intervalMs;
    this.batchInterval = globalThis.setInterval(() => this.processBatch(), intervalMs);
  }

  private stopBatching(): void {
    if (this.batchInterval !== null) {
      clearInterval(this.batchInterval);
      this.batchInterval = null;
    }
  }

  private processBatch(): void {
    const now = performance.now();

    // PerformanceGuard integration: if overhead > 3%, reduce batch frequency
    this.adjustBatchFrequency();

    // Startup period: store records but don't emit
    if (isInStartupPeriod(now, this.startTime, STARTUP_DURATION_MS)) {
      return;
    }

    // Evict expired records
    this.buffer = evictExpiredRecords(this.buffer, now, WINDOW_MS);

    if (this.buffer.length === 0) return;

    // Group records by source
    const sourceGroups = this.groupRecordsBySource(this.buffer);

    // Compute metrics per source
    const windowStart = Math.max(this.startTime + STARTUP_DURATION_MS, now - WINDOW_MS);
    const effectiveWindowMs = now - windowStart;

    const metrics: PollutionSourceMetrics[] = [];
    let totalCdCycles = 0;

    for (const [source, records] of sourceGroups) {
      const cdCount = records.filter(r => r.triggeredCd).length;
      totalCdCycles += cdCount;
      metrics.push(this.createSourceMetric(source, records, cdCount, effectiveWindowMs));
    }

    // Rank sources and take top 10
    const ranked = rankSources(metrics);
    const topSources = ranked.slice(0, TOP_SOURCES_LIMIT);

    // Emit event
    this.emitPollutionEvent({
      sources: topSources,
      totalCdCycles,
      windowDurationMs: effectiveWindowMs,
      timestamp: now,
    });
  }

  private groupRecordsBySource(records: TaskRecord[]): Map<string, TaskRecord[]> {
    const groups = new Map<string, TaskRecord[]>();
    for (const record of records) {
      const existing = groups.get(record.source);
      if (existing) {
        existing.push(record);
      } else {
        groups.set(record.source, [record]);
      }
    }
    return groups;
  }

  private createSourceMetric(
    source: string,
    records: TaskRecord[],
    cdCount: number,
    effectiveWindowMs: number
  ): PollutionSourceMetrics {
    const cdCyclesPerMinute = computeCdPerMinute(cdCount, effectiveWindowMs);
    const severity = classifySeverity(cdCyclesPerMinute);
    const lastRecord = records[records.length - 1];
    const library = records.find(r => r.library)?.library;

    const metric: PollutionSourceMetrics = {
      source,
      type: lastRecord.type,
      library,
      cdCyclesPerMinute,
      severity,
      taskCount: records.length,
      lastSeen: lastRecord.timestamp,
    };

    if (severity !== 'low') {
      metric.fixSuggestion = getFixSuggestion(source, library);
    }

    return metric;
  }

  private adjustBatchFrequency(): void {
    const guard = PerformanceGuard.getInstance();
    if (guard.isDegraded() && this.currentBatchIntervalMs !== DEGRADED_BATCH_INTERVAL_MS) {
      this.stopBatching();
      this.startBatching(DEGRADED_BATCH_INTERVAL_MS);
    }
  }

  // ─── Event Emission ────────────────────────────────────────────────────────

  private emitPollutionEvent(payload: ZonePollutionEvent): void {
    this.dispatchZoneEvent(payload, `zpd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  private emitZonelessEvent(): void {
    this.dispatchZoneEvent(
      {
        sources: [],
        totalCdCycles: 0,
        windowDurationMs: 0,
        timestamp: performance.now(),
        zonelessMode: true,
      },
      `zpd-zoneless-${Date.now()}`
    );
  }

  private dispatchZoneEvent(payload: any, eventId: string): void {
    const message = {
      eventId,
      type: 'ZONE_POLLUTION_EVENT',
      payload,
    };

    globalThis.dispatchEvent(
      new CustomEvent(PAGE_TO_CONTENT_EVENT, { detail: message })
    );
  }
}

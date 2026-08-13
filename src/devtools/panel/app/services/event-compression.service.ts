/**
 * Event Compression Service
 * 
 * Compresses 300-500 raw events into 5-10 meaningful execution stories.
 * Uses multiple strategies that compete to find the best compression.
 * 
 * Universal algorithm: works for any Angular application without configuration.
 */

import { Injectable } from '@angular/core';
import type { RuntimeEvent } from '../../../../types/execution-intelligence';

export interface ExecutionStory {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  eventCount: number;
  events: RuntimeEvent[];
  title: string;
  type: 'boundary' | 'activity-gap' | 'duration-capped' | 'event-capped' | 'pattern-collapsed' | 'api-dependency' | 'store-relationship' | 'service-sharing';
  metadata?: Record<string, any>;
}

interface CompressionStrategy {
  name: string;
  weight: number;
  splitEvents(events: RuntimeEvent[]): ExecutionStory[];
}

interface DetectedPattern {
  name: string;
  length: number;
  repetitions: number;
  totalEvents: number;
  confidence: number;
}

@Injectable({ providedIn: 'root' })
export class EventCompressionService {
  private readonly BOUNDARY_TYPES = [
    'user-interaction',
    'route-change',
    'websocket',
    'timer',
    'service-worker-message'
  ];

  private readonly BOUNDARY_MIN_GAP_MS = 50;
  private readonly ACTIVITY_GAP_MS = 2000;
  private readonly MAX_DURATION_MS = 5000;
  private readonly MAX_EVENTS_PER_STORY = 400;
  private readonly PATTERN_MIN_REPETITIONS = 2;
  private readonly PATTERN_TOLERANCE = 0.8;
  private readonly COMPONENT_HIERARCHY_WEIGHT = 0.5;
  private readonly SERVICE_SHARE_WEIGHT = 0.6;
  private readonly STORE_RELATIONSHIP_WEIGHT = 0.7;
  private readonly API_DEPENDENCY_WEIGHT = 0.8;

  compress(rawEvents: RuntimeEvent[]): ExecutionStory[] {
    if (rawEvents.length === 0) return [];

    // Phase 2: Try multiple strategies, pick best
    return this.universalCompress(rawEvents);
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE 2: MULTI-STRATEGY (RECOMMENDED)
  // ──────────────────────────────────────────────────────────────────────

  private universalCompress(rawEvents: RuntimeEvent[]): ExecutionStory[] {
    const strategies: CompressionStrategy[] = [
      {
        name: 'boundary-detection',
        weight: 0.9,
        splitEvents: (e) => this.splitByBoundaryEvents(e)
      },
      {
        name: 'activity-gap',
        weight: 0.8,
        splitEvents: (e) => this.splitByActivityGap(e, this.ACTIVITY_GAP_MS)
      },
      {
        name: 'api-dependency',
        weight: 0.85,
        splitEvents: (e) => this.splitByApiDependency(e)
      },
      {
        name: 'store-relationship',
        weight: 0.80,
        splitEvents: (e) => this.splitByStoreRelationship(e)
      },
      {
        name: 'service-sharing',
        weight: 0.75,
        splitEvents: (e) => this.splitByServiceSharing(e)
      },
      {
        name: 'duration-cap',
        weight: 0.7,
        splitEvents: (e) => this.splitByDuration(e, this.MAX_DURATION_MS)
      },
      {
        name: 'event-count-cap',
        weight: 0.6,
        splitEvents: (e) => this.splitByEventCount(e, this.MAX_EVENTS_PER_STORY)
      },
      {
        name: 'repetition-collapse',
        weight: 0.5,
        splitEvents: (e) => this.collapseRepetitivePatterns(e)
      }
    ];

    const results = strategies.map(strategy => {
      const stories = strategy.splitEvents(rawEvents);
      const score = this.scoreCompressionResult(stories, strategy.weight);
      return { strategy: strategy.name, stories, score };
    });

    results.sort((a, b) => b.score - a.score);
    const best = results[0];

    return best.stories;
  }

  private scoreCompressionResult(stories: ExecutionStory[], strategyWeight: number): number {
    const storyCount = stories.length;
    const target = 7;

    if (storyCount < 2 || storyCount > 50) return -1000;

    const countScore = Math.max(0, 20 - Math.abs(storyCount - target) * 2);

    const avgEventsPerStory =
      stories.reduce((sum, s) => sum + s.eventCount, 0) / storyCount;
    const distributionScore = Math.max(0, 15 - Math.abs(avgEventsPerStory - 300) / 100);

    const longStoryCount = stories.filter(s => s.eventCount > 1000).length;
    const outlierScore = Math.max(0, 15 - longStoryCount * 5);

    const totalScore = (countScore + distributionScore + outlierScore) * strategyWeight;

    return totalScore;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 1: BOUNDARY EVENTS (HIGHEST PRIORITY)
  // ──────────────────────────────────────────────────────────────────────

  private splitByBoundaryEvents(events: RuntimeEvent[]): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];

    for (const event of events) {
      if (this.isBoundaryEvent(event) && currentStory.length > 0) {
        stories.push(this.buildStory(currentStory, 'boundary'));
        currentStory = [event];
      } else {
        currentStory.push(event);
      }
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'boundary'));
    }

    return stories;
  }

  private isBoundaryEvent(event: RuntimeEvent): boolean {
    return this.BOUNDARY_TYPES.includes(event.type);
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 2: ACTIVITY GAPS (TIME-BASED)
  // ──────────────────────────────────────────────────────────────────────

  private splitByActivityGap(events: RuntimeEvent[], gapMs: number): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];
    let lastEventTime = 0;

    for (const event of events) {
      if (lastEventTime && event.timestamp - lastEventTime > gapMs) {
        if (currentStory.length > 0) {
          stories.push(this.buildStory(currentStory, 'activity-gap'));
        }
        currentStory = [];
      }

      currentStory.push(event);
      lastEventTime = event.timestamp;
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'activity-gap'));
    }

    return stories;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 3: DURATION CAP (TIME LIMIT)
  // ──────────────────────────────────────────────────────────────────────

  private splitByDuration(events: RuntimeEvent[], maxDurationMs: number): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];
    let storyStartTime: number | null = null;

    for (const event of events) {
      if (!storyStartTime) storyStartTime = event.timestamp;

      const duration = event.timestamp - storyStartTime;

      if (duration > maxDurationMs && currentStory.length > 0) {
        stories.push(this.buildStory(currentStory, 'duration-capped'));
        currentStory = [event];
        storyStartTime = event.timestamp;
      } else {
        currentStory.push(event);
      }
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'duration-capped'));
    }

    return stories;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 4: EVENT COUNT CAP (SIZE LIMIT)
  // ──────────────────────────────────────────────────────────────────────

  private splitByEventCount(events: RuntimeEvent[], maxEvents: number): ExecutionStory[] {
    const stories: ExecutionStory[] = [];

    for (let i = 0; i < events.length; i += maxEvents) {
      const batch = events.slice(i, i + maxEvents);
      stories.push(this.buildStory(batch, 'event-capped'));
    }

    return stories;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 3.5: API DEPENDENCY (CAUSALITY-BASED)
  // ──────────────────────────────────────────────────────────────────────

  private splitByApiDependency(events: RuntimeEvent[]): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];
    const apiEventIds = new Set<string>();

    for (const event of events) {
      if (event.type === 'http-request' || event.type === 'http-response') {
        if (currentStory.length > 0 && !this.isApiRelated(event, currentStory, apiEventIds)) {
          stories.push(this.buildStory(currentStory, 'api-dependency'));
          currentStory = [];
          apiEventIds.clear();
        }

        currentStory.push(event);
        apiEventIds.add(event.id);
      } else {
        currentStory.push(event);
      }
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'api-dependency'));
    }

    return stories;
  }

  private isApiRelated(event: RuntimeEvent, story: RuntimeEvent[], apiIds: Set<string>): boolean {
    if (apiIds.size === 0) return true;

    if (event.metadata?.['causedByEventId']) {
      return apiIds.has(event.metadata['causedByEventId'] as string);
    }

    if (event.type === 'http-response' && event.metadata?.['requestId']) {
      return true;
    }

    const timeSinceLastApi = event.timestamp - Math.max(...Array.from(apiIds).map(() => event.timestamp));
    return timeSinceLastApi < this.MAX_DURATION_MS;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 3.6: STORE RELATIONSHIP (STATE-BASED)
  // ──────────────────────────────────────────────────────────────────────

  private splitByStoreRelationship(events: RuntimeEvent[]): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];
    const storesInUse = new Set<string>();

    for (const event of events) {
      if (event.type === 'store-dispatch' || event.type === 'store-select') {
        const storeName = event.metadata?.['store'] as string;
        if (
          currentStory.length > 0 &&
          storeName &&
          !storesInUse.has(storeName) &&
          storesInUse.size > 0
        ) {
          stories.push(this.buildStory(currentStory, 'store-relationship'));
          currentStory = [];
          storesInUse.clear();
        }

        if (storeName) {
          storesInUse.add(storeName);
        }
        currentStory.push(event);
      } else {
        currentStory.push(event);
      }
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'store-relationship'));
    }

    return stories;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 3.7: SERVICE SHARING (DEPENDENCY-BASED)
  // ──────────────────────────────────────────────────────────────────────

  private splitByServiceSharing(events: RuntimeEvent[]): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let currentStory: RuntimeEvent[] = [];
    const servicesInUse = new Set<string>();

    for (const event of events) {
      const service = event.ownerClass || event.sourceComponent?.split('.')[0];

      if (
        currentStory.length > 0 &&
        service &&
        !servicesInUse.has(service) &&
        servicesInUse.size > 0
      ) {
        if (currentStory.length > this.MAX_EVENTS_PER_STORY) {
          stories.push(this.buildStory(currentStory, 'service-sharing'));
          currentStory = [];
          servicesInUse.clear();
        }
      }

      if (service) {
        servicesInUse.add(service);
      }
      currentStory.push(event);
    }

    if (currentStory.length > 0) {
      stories.push(this.buildStory(currentStory, 'service-sharing'));
    }

    return stories;
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 5: REPETITION COLLAPSE (PATTERN-BASED)
  // ──────────────────────────────────────────────────────────────────────

  private collapseRepetitivePatterns(events: RuntimeEvent[]): ExecutionStory[] {
    const stories: ExecutionStory[] = [];
    let i = 0;

    while (i < events.length) {
      const pattern = this.detectPattern(events, i);

      if (pattern && pattern.repetitions >= this.PATTERN_MIN_REPETITIONS) {
        const storyEvents = events.slice(i, i + pattern.totalEvents);
        stories.push({
          id: `pattern-${stories.length}`,
          startTime: storyEvents[0].timestamp,
          endTime: storyEvents[storyEvents.length - 1].timestamp,
          duration: storyEvents[storyEvents.length - 1].timestamp - storyEvents[0].timestamp,
          eventCount: pattern.totalEvents,
          events: storyEvents,
          title: `${pattern.repetitions}x ${pattern.name}`,
          type: 'pattern-collapsed',
          metadata: {
            patternName: pattern.name,
            singlePatternLength: pattern.length,
            repetitionCount: pattern.repetitions,
            confidence: pattern.confidence,
            compressedSample: events.slice(i, i + pattern.length)
          }
        });

        i += pattern.totalEvents;
      } else {
        const chunk = events.slice(i, Math.min(i + this.MAX_EVENTS_PER_STORY, events.length));
        stories.push(this.buildStory(chunk, 'event-capped'));
        i += chunk.length;
      }
    }

    return stories;
  }

  private detectPattern(events: RuntimeEvent[], startIdx: number): DetectedPattern | null {
    for (let patternLen = 20; patternLen < 200; patternLen += 10) {
      if (startIdx + patternLen * 2 >= events.length) break;

      let repetitions = 0;
      let idx = startIdx;

      while (
        idx + patternLen <= events.length &&
        this.isSimilarPattern(events, startIdx, idx, patternLen)
      ) {
        repetitions++;
        idx += patternLen;
      }

      if (repetitions >= this.PATTERN_MIN_REPETITIONS) {
        return {
          name: this.inferPatternName(events.slice(startIdx, startIdx + patternLen)),
          length: patternLen,
          repetitions,
          totalEvents: patternLen * repetitions,
          confidence: repetitions > 3 ? 0.95 : 0.7
        };
      }
    }

    return null;
  }

  private isSimilarPattern(
    events: RuntimeEvent[],
    idx1: number,
    idx2: number,
    len: number,
    tolerance: number = this.PATTERN_TOLERANCE
  ): boolean {
    let matches = 0;

    for (let i = 0; i < len; i++) {
      const e1 = events[idx1 + i];
      const e2 = events[idx2 + i];

      if (!e1 || !e2) return false;

      if (e1.type === e2.type) {
        matches++;
      } else if (e1.duration && e2.duration && Math.abs(e1.duration - e2.duration) < 100) {
        matches++;
      }
    }

    return matches / len >= tolerance;
  }

  private inferPatternName(patternEvents: RuntimeEvent[]): string {
    const hasApiCall = patternEvents.some(
      e => e.type === 'http-request' || e.type === 'http-response'
    );
    const hasRender = patternEvents.some(e => e.type === 'component-render');
    const hasSignalWrite = patternEvents.some(e => e.type === 'signal-write');
    const hasStoreDispatch = patternEvents.some(e => e.type === 'store-dispatch');

    if (hasApiCall && hasRender) return 'API + Render';
    if (hasApiCall && hasStoreDispatch) return 'API + Store';
    if (hasApiCall) return 'API Polling';
    if (hasSignalWrite && hasRender) return 'Signal Loop';
    if (hasRender) return 'Render Loop';
    if (hasStoreDispatch) return 'Store Updates';

    return 'Repetitive Pattern';
  }

  // ──────────────────────────────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────────────────────────────

  private buildStory(events: RuntimeEvent[], type: ExecutionStory['type']): ExecutionStory {
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    const startTime = firstEvent.timestamp;
    const endTime = lastEvent.timestamp;
    const duration = endTime - startTime;

    let title = 'Event Sequence';

    if (type === 'boundary' && firstEvent.type === 'user-interaction') {
      title = `User ${firstEvent.label || 'Interaction'}`;
    } else if (type === 'boundary' && firstEvent.type === 'route-change') {
      title = `Route Changed to ${(firstEvent.metadata?.['toRoute'] as string) || 'Unknown'}`;
    } else if (type === 'boundary' && firstEvent.type === 'timer') {
      title = 'Background Polling';
    } else if (type === 'activity-gap') {
      title = `Activity Session (${events.length} events)`;
    } else if (type === 'api-dependency') {
      const retries = this.countRetries(events);
      if (retries > 0) {
        title = `API Call with ${retries} Retries`;
      } else {
        title = 'API Operation';
      }
    } else if (type === 'store-relationship') {
      title = 'Store Update Cycle';
    } else if (type === 'service-sharing') {
      title = 'Service Operations';
    } else if (type === 'pattern-collapsed') {
      title = 'Collapsed Pattern';
    } else {
      title = `${events.length} Events (${duration.toFixed(0)}ms)`;
    }

    return {
      id: `story-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      startTime,
      endTime,
      duration,
      eventCount: events.length,
      events,
      title,
      type
    };
  }

  private countRetries(events: RuntimeEvent[]): number {
    let retries = 0;
    const failedRequests = new Set<string>();

    for (const event of events) {
      if (event.type === 'http-response' && event.metadata?.['status'] === 'error') {
        const url = event.label;
        if (failedRequests.has(url)) {
          retries++;
        }
        failedRequests.add(url);
      }
    }

    return retries;
  }
}

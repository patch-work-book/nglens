/**
 * Session Builder Service
 * 
 * Groups normalized events into execution sessions.
 * Each session represents ONE logical boundary: user click, route navigation, component bootstrap, etc.
 * 
 * Input: Normalized RuntimeEvents
 * Output: ExecutionSessions (grouped by triggeredByInteractionTs and boundary)
 */

import { Injectable } from '@angular/core';
import type {
  RuntimeEvent,
  SessionBoundary,
  ExecutionSession,
} from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class SessionBuilderService {
  private sessionCounter = 0;

  /**
   * Build sessions from normalized events.
   * 
   * Strategy:
   * 1. Identify boundary events (user-interaction, route-change, component-bootstrap, etc.)
   * 2. Group all subsequent events until the next boundary into a session
   * 3. Preserve chronological order and event relationships
   */
  buildSessions(normalizedEvents: RuntimeEvent[]): ExecutionSession[] {
    if (normalizedEvents.length === 0) {
      return [];
    }

    // Sort by timestamp to ensure chronological processing
    const sorted = [...normalizedEvents].sort((a, b) => a.timestamp - b.timestamp);

    const sessions: ExecutionSession[] = [];
    let currentSession: {
      boundary: SessionBoundary;
      boundaryEvent: RuntimeEvent;
      eventIds: string[];
      startTime: number;
      endTime: number;
      interactionTarget?: string;
      interactionComponent?: string;
      fromRoute?: string;
      toRoute?: string;
    } | null = null;

    for (const event of sorted) {
      const isBoundary = this.isBoundaryEvent(event);

      if (isBoundary) {
        // Save current session if exists
        if (currentSession) {
          sessions.push(this.createSession(currentSession));
        }

        // Start new session
        const boundary = event.causedByBoundary || this.inferBoundary(event);
        currentSession = {
          boundary,
          boundaryEvent: event,
          eventIds: [event.id],
          startTime: event.timestamp,
          endTime: event.timestamp,
          interactionTarget: event.metadata?.['interactionTarget'] as string | undefined,
          interactionComponent: event.sourceComponent,
          fromRoute: event.metadata?.['fromRoute'] as string | undefined,
          toRoute: event.route,
        };
      } else if (currentSession) {
        // Add to current session
        currentSession.eventIds.push(event.id);
        currentSession.endTime = Math.max(currentSession.endTime, event.timestamp);
      } else {
        // No current session and not a boundary: create orphan session
        // This handles stray events at the beginning
        const boundary = event.causedByBoundary || this.inferBoundary(event);
        currentSession = {
          boundary,
          boundaryEvent: event,
          eventIds: [event.id],
          startTime: event.timestamp,
          endTime: event.timestamp,
        };
      }
    }

    // Don't forget the last session
    if (currentSession) {
      sessions.push(this.createSession(currentSession));
    }

    return sessions;
  }

  /**
   * Build sessions grouped by interaction timestamp (alternative strategy).
   * Useful when events already have triggeredByInteractionTs populated.
   */
  buildSessionsByInteractionTs(normalizedEvents: RuntimeEvent[]): ExecutionSession[] {
    if (normalizedEvents.length === 0) {
      return [];
    }

    // Group events by their triggeredByInteractionTs
    const groupsMap = new Map<number, RuntimeEvent[]>();

    for (const event of normalizedEvents) {
      // If event has no triggeredByInteractionTs, treat it as a boundary event
      const ts = event.metadata?.['triggeredByInteractionTs'] as number | undefined ?? event.timestamp;
      
      if (!groupsMap.has(ts)) {
        groupsMap.set(ts, []);
      }
      groupsMap.get(ts)!.push(event);
    }

    // Convert groups to sessions
    const sessions: ExecutionSession[] = [];

    for (const [_ts, events] of groupsMap) {
      // Sort events within group by timestamp
      events.sort((a, b) => a.timestamp - b.timestamp);

      const boundaryEvent = events[0];
      const boundary = boundaryEvent.causedByBoundary || this.inferBoundary(boundaryEvent);

      const session: ExecutionSession = {
        id: `session-${++this.sessionCounter}`,
        boundary,
        startTime: events[0].timestamp,
        endTime: events[events.length - 1].timestamp,
        duration: events[events.length - 1].timestamp - events[0].timestamp,
        eventIds: events.map(e => e.id),
        eventCount: events.length,
        componentCount: this.countUnique(events, e => e.sourceComponent),
        renderCount: events.filter(e => e.type === 'component-render').length,
        apiCallCount: events.filter(e => e.type === 'http-request' || e.type === 'http-response').length,
        logicalStart: boundaryEvent,
      };

      sessions.push(session);
    }

    return sessions;
  }

  /**
   * Merge sessions that are closely related (e.g., route navigation followed immediately by bootstrap).
   * Optional optimization for reducing noise.
   */
  mergeSessions(
    sessions: ExecutionSession[],
    maxGapMs: number = 100
  ): ExecutionSession[] {
    if (sessions.length <= 1) {
      return sessions;
    }

    const merged: ExecutionSession[] = [];
    let current = sessions[0];

    for (let i = 1; i < sessions.length; i++) {
      const next = sessions[i];
      const gap = next.startTime - current.endTime;

      if (gap <= maxGapMs) {
        // Merge next into current
        current = {
          ...current,
          endTime: next.endTime,
          duration: next.endTime - current.startTime,
          eventIds: [...current.eventIds, ...next.eventIds],
          eventCount: current.eventCount + next.eventCount,
          componentCount: current.componentCount + next.componentCount,
          renderCount: current.renderCount + next.renderCount,
          apiCallCount: current.apiCallCount + next.apiCallCount,
        };
      } else {
        // Gap too large, save current and start new
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Reset the builder.
   */
  reset(): void {
    this.sessionCounter = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private isBoundaryEvent(event: RuntimeEvent): boolean {
    const boundaryTypes: RuntimeEvent['type'][] = [
      'user-interaction',
      'route-change',
      'websocket',
      'timer',
    ];
    return boundaryTypes.includes(event.type);
  }

  private inferBoundary(event: RuntimeEvent): SessionBoundary {
    switch (event.type) {
      case 'user-interaction':
        return 'user-interaction';
      case 'route-change':
        return 'route-navigation';
      case 'websocket':
        return 'websocket';
      case 'timer':
        return 'timer';
      case 'component-render':
        // Render events inside root components are bootstrap
        if (event.sourceComponent?.includes('RootComponent') || event.sourceComponent?.includes('AppComponent')) {
          return 'component-bootstrap';
        }
        return 'user-interaction'; // Default: assume user-triggered
      default:
        return 'user-interaction';
    }
  }

  private createSession(data: {
    boundary: SessionBoundary;
    boundaryEvent: RuntimeEvent;
    eventIds: string[];
    startTime: number;
    endTime: number;
    interactionTarget?: string;
    interactionComponent?: string;
    fromRoute?: string;
    toRoute?: string;
  }): ExecutionSession {
    return {
      id: `session-${++this.sessionCounter}`,
      boundary: data.boundary,
      startTime: data.startTime,
      endTime: data.endTime,
      duration: data.endTime - data.startTime,
      interactionTarget: data.interactionTarget,
      interactionComponent: data.interactionComponent,
      fromRoute: data.fromRoute,
      toRoute: data.toRoute,
      eventIds: data.eventIds,
      eventCount: data.eventIds.length,
      componentCount: 0, // Will be computed later
      renderCount: 0,    // Will be computed later
      apiCallCount: 0,   // Will be computed later
      logicalStart: data.boundaryEvent,
    };
  }

  private countUnique(events: RuntimeEvent[], selector: (e: RuntimeEvent) => string | undefined): number {
    const set = new Set<string>();
    for (const event of events) {
      const value = selector(event);
      if (value) {
        set.add(value);
      }
    }
    return set.size;
  }
}

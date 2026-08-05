/**
 * Root Cause Detector Service
 * 
 * Traces causality chains backwards from any event.
 * Answers: "Why did this happen?"
 * 
 * Never traverses outside logical boundaries.
 * Identifies the triggering event that started everything.
 */

import { Injectable } from '@angular/core';
import type {
  RuntimeEvent,
  RootCauseChain,
  CausalNode,
  SessionBoundary,
} from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class RootCauseDetectorService {
  /**
   * Detect the root cause chain for an event within a session.
   * Traverses backwards, never leaving the session boundaries.
   */
  detectRootCause(
    event: RuntimeEvent,
    sessionEvents: RuntimeEvent[],
    sessionBoundary: SessionBoundary
  ): RootCauseChain {
    // Find the boundary event (should be first chronologically)
    const boundaryEvent = sessionEvents.find(e => this.isBoundaryEvent(e, sessionBoundary));

    if (!boundaryEvent) {
      // Fallback: assume first event is boundary
      return this.createFallbackChain(event, sessionBoundary);
    }

    // Build causality chain by traversing backwards
    const chain = this.buildCausalChain(event, sessionEvents);

    return {
      startingBoundary: sessionBoundary,
      chain,
      rootCause: { eventId: boundaryEvent.id, timestamp: boundaryEvent.timestamp, type: boundaryEvent.type, label: boundaryEvent.label },
      summary: this.generateChainSummary(boundaryEvent, chain),
    };
  }

  /**
   * Build causality chain by traversing backwards from an event.
   */
  private buildCausalChain(targetEvent: RuntimeEvent, allEvents: RuntimeEvent[]): CausalNode[] {
    const chain: CausalNode[] = [];
    let current = targetEvent;

    while (current) {
      // Add current to chain
      chain.unshift({
        eventId: current.id,
        timestamp: current.timestamp,
        type: current.type,
        label: current.label,
        description: current.detail,
      });

      // Find the event that caused this one
      const parent = this.findParentEvent(current, allEvents);

      if (!parent || parent.id === current.id) {
        // No parent or circular reference: we've reached the root
        break;
      }

      current = parent;
    }

    return chain;
  }

  /**
   * Find the event that directly caused this event.
   * Uses temporal proximity and type relationships.
   */
  private findParentEvent(
    targetEvent: RuntimeEvent,
    allEvents: RuntimeEvent[]
  ): RuntimeEvent | null {
    const timeWindow = 1000; // ms: look for parent within 1s before

    // Filter to events that happened before this one
    const priorEvents = allEvents.filter(e => e.timestamp < targetEvent.timestamp);

    if (priorEvents.length === 0) {
      return null;
    }

    // Sort by recency (most recent first)
    priorEvents.sort((a, b) => b.timestamp - a.timestamp);

    // Find the most likely parent based on type patterns
    for (const candidate of priorEvents) {
      // Check if this could be a parent
      const isLikely = this.isLikelyParent(candidate, targetEvent);
      
      if (isLikely && targetEvent.timestamp - candidate.timestamp < timeWindow) {
        return candidate;
      }
    }

    // Fallback: return the most recent prior event
    return priorEvents[0] || null;
  }

  /**
   * Determine if one event is likely the parent of another.
   * Uses domain knowledge about Angular/RxJS/Store patterns.
   */
  private isLikelyParent(parent: RuntimeEvent, child: RuntimeEvent): boolean {
    // HTTP Response → Store/Signal update
    if (parent.type === 'http-response' && 
        (child.type === 'store-dispatch' || child.type === 'signal-write')) {
      return true;
    }

    // Store Dispatch → Signal update
    if (parent.type === 'store-dispatch' && child.type === 'signal-write') {
      return true;
    }

    // Signal Write → Component Render
    if (parent.type === 'signal-write' && child.type === 'component-render') {
      return true;
    }

    // Signal Write → Computed Signal Write
    if (parent.type === 'signal-write' && child.type === 'signal-write') {
      return true;
    }

    // Subject Emit → Store/Signal update
    if (parent.type === 'subject-emit' && 
        (child.type === 'store-dispatch' || child.type === 'signal-write')) {
      return true;
    }

    // Subject Emit → Component Render (via subscribers)
    if (parent.type === 'subject-emit' && child.type === 'component-render') {
      return parent.subscribers?.includes(child.sourceComponent || '') ?? false;
    }

    // Store Select → Store Dispatch
    if (parent.type === 'store-select' && child.type === 'store-dispatch') {
      return true;
    }

    // User Interaction → HTTP Request
    if (parent.type === 'user-interaction' && child.type === 'http-request') {
      return true;
    }

    // User Interaction → Store/Signal (direct update)
    if (parent.type === 'user-interaction' && 
        (child.type === 'store-dispatch' || child.type === 'signal-write')) {
      return true;
    }

    // Route Change → Component Render
    if (parent.type === 'route-change' && child.type === 'component-render') {
      return true;
    }

    // Any event → its most recent subscriber's render (temporal proximity)
    if (parent.subscribers?.includes(child.sourceComponent || '')) {
      return true;
    }

    // Fallback: if parent happened very recently, it's likely
    if (child.timestamp - parent.timestamp < 50) {
      return true;
    }

    return false;
  }

  /**
   * Check if an event is a session boundary.
   */
  private isBoundaryEvent(event: RuntimeEvent, boundary: SessionBoundary): boolean {
    switch (boundary) {
      case 'user-interaction':
        return event.type === 'user-interaction';
      case 'route-navigation':
        return event.type === 'route-change';
      case 'component-bootstrap':
        return event.type === 'component-render' && 
               ((event.sourceComponent?.includes('RootComponent') ?? false) ||
                (event.sourceComponent?.includes('AppComponent') ?? false));
      case 'websocket':
        return event.type === 'websocket';
      case 'timer':
        return event.type === 'timer';
      default:
        return false;
    }
  }

  /**
   * Generate human-readable summary of the causality chain.
   */
  private generateChainSummary(rootEvent: RuntimeEvent, chain: CausalNode[]): string {
    const steps = chain.map(n => this.nodeToPhrase(n)).join(' → ');
    return steps || 'Unknown trigger';
  }

  /**
   * Convert a causal node to a readable phrase.
   */
  private nodeToPhrase(node: CausalNode): string {
    switch (node.type) {
      case 'user-interaction':
        return 'User clicked';
      case 'route-change':
        return 'Route changed';
      case 'http-response':
        return 'API response';
      case 'http-request':
        return 'API request';
      case 'store-dispatch':
        return 'Store updated';
      case 'signal-write':
        return 'Signal updated';
      case 'subject-emit':
        return 'Subject emitted';
      case 'component-render':
        return `${node.label} rendered`;
      default:
        return node.label;
    }
  }

  /**
   * Fallback chain when boundary event is not found.
   */
  private createFallbackChain(event: RuntimeEvent, boundary: SessionBoundary): RootCauseChain {
    const rootCause: CausalNode = {
      eventId: event.id,
      timestamp: event.timestamp,
      type: event.type,
      label: boundary,
      description: `Session started with ${boundary}`,
    };

    return {
      startingBoundary: boundary,
      chain: [rootCause],
      rootCause,
      summary: boundary,
    };
  }
}

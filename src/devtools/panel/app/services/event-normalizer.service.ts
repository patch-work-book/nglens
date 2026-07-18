/**
 * Event Normalizer Service
 * 
 * CRITICAL: The first stage of the Execution Intelligence pipeline.
 * Converts heterogeneous event types (HTTP, RxJS, Signals, Renders, etc.)
 * into a unified RuntimeEvent contract.
 * 
 * Every layer after this deals with a consistent, normalized event model.
 */

import { Injectable } from '@angular/core';
import type { FlowEvent, RenderEvent } from '../../../../types/render-events';
import type { RuntimeEvent, SessionBoundary } from '../../../../types/execution-intelligence';

@Injectable({ providedIn: 'root' })
export class EventNormalizerService {
  private eventCounter = 0;
  private eventIdMap = new Map<string, string>(); // Track normalized ID for each raw event
  private correlationCounter = 0;
  private activeCorrelationId: string | null = null;

  /**
   * Set the active correlation ID for a batch of related events.
   * Called by the batch normalizer to group events from the same user interaction.
   */
  private generateCorrelationId(): string {
    return `corr-${++this.correlationCounter}-${Date.now()}`;
  }

  /**
   * Normalize a FlowEvent (HTTP, RxJS, Signals, Store, etc.) into a RuntimeEvent.
   */
  normalizeFlowEvent(flowEvent: FlowEvent): RuntimeEvent {
    const baseId = `flow-${flowEvent.id}`;
    const id = this.getOrCreateNormalizedId(baseId);

    // Determine type from FlowEvent.type
    const type = this.mapFlowEventType(flowEvent.type);

    // Determine boundary from flow event properties
    const boundary = this.inferBoundaryFromFlow(flowEvent);

    // Create label
    const label = flowEvent.label || this.buildFlowLabel(flowEvent);

    // Build normalized event
    const normalized: RuntimeEvent = {
      id,
      type,
      timestamp: flowEvent.timestamp,
      sourceComponent: flowEvent.sourceComponent,
      ownerClass: flowEvent.ownerClass,
      propertyName: flowEvent.propertyName,
      label,
      detail: flowEvent.detail,
      value: flowEvent.value,
      responseBody: flowEvent.responseBody,
      subscribers: flowEvent.subscribers,
      causedByBoundary: boundary,
      correlationId: this.activeCorrelationId || this.generateCorrelationId(),
      frameId: flowEvent.frameId,
      route: flowEvent.toRoute,
      metadata: {
        originalType: flowEvent.type,
        originalId: flowEvent.id,
        methodName: flowEvent.methodName,
        actionName: flowEvent.actionName,
        selectorName: flowEvent.selectorName,
        connectionStatus: flowEvent.connectionStatus,
      },
    };

    return normalized;
  }

  /**
   * Normalize a RenderEvent (component render) into a RuntimeEvent.
   */
  normalizeRenderEvent(renderEvent: RenderEvent): RuntimeEvent {
    const baseId = `render-${renderEvent.componentName}-${renderEvent.timestamp}`;
    const id = this.getOrCreateNormalizedId(baseId);

    // Render events are always "component-render" type
    const type = 'component-render' as const;

    // Infer boundary from render event's interaction context
    const boundary = this.inferBoundaryFromRender(renderEvent);

    // Create label: "DashboardComponent rendered"
    const label = `${renderEvent.componentName} rendered`;

    // Extract cause details
    const causeDetails = renderEvent.causes
      .map(c => c.source || c.type)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ');

    const normalized: RuntimeEvent = {
      id,
      type,
      timestamp: renderEvent.timestamp,
      duration: renderEvent.duration,
      sourceComponent: renderEvent.componentName,
      label,
      detail: causeDetails || 'Change detection triggered',
      subscribers: undefined, // Renders don't have subscribers in the traditional sense
      causedByBoundary: boundary,
      correlationId: this.activeCorrelationId || this.generateCorrelationId(),
      frameId: renderEvent.frameId,
      metadata: {
        originalType: 'render-event',
        componentName: renderEvent.componentName,
        parentComponent: renderEvent.parentComponent,
        depth: renderEvent.depth,
        interactionComponent: renderEvent.interactionComponent,
        interactionTarget: renderEvent.interactionTarget,
        causes: renderEvent.causes,
        cdCount: renderEvent.cdCount,
        mutationCount: renderEvent.mutationCount,
      },
    };

    return normalized;
  }

  /**
   * Batch normalize multiple events (preserves order).
   * Events in the same batch share a correlationId (they arrived together from one CD cycle).
   */
  normalizeBatch(flowEvents: FlowEvent[], renderEvents: RenderEvent[]): RuntimeEvent[] {
    // All events in a batch share a correlation ID (they're from the same interaction/CD cycle)
    this.activeCorrelationId = this.generateCorrelationId();

    const normalized: RuntimeEvent[] = [];

    // Add all flow events
    for (const fe of flowEvents) {
      normalized.push(this.normalizeFlowEvent(fe));
    }

    // Add all render events
    for (const re of renderEvents) {
      normalized.push(this.normalizeRenderEvent(re));
    }

    // Reset active correlation (next batch gets a new one)
    this.activeCorrelationId = null;

    // Sort by timestamp to maintain chronological order
    normalized.sort((a, b) => a.timestamp - b.timestamp);

    return normalized;
  }

  /**
   * Reset the normalizer (typically on session clear).
   */
  reset(): void {
    this.eventCounter = 0;
    this.eventIdMap.clear();
    this.correlationCounter = 0;
    this.activeCorrelationId = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private getOrCreateNormalizedId(baseId: string): string {
    if (this.eventIdMap.has(baseId)) {
      return this.eventIdMap.get(baseId)!;
    }
    const id = `normalized-event-${++this.eventCounter}`;
    this.eventIdMap.set(baseId, id);
    return id;
  }

  /**
   * Map FlowEvent.type to RuntimeEvent.type.
   */
  private mapFlowEventType(
    flowType: FlowEvent['type']
  ): RuntimeEvent['type'] {
    switch (flowType) {
      case 'http-response':
        return 'http-response';
      case 'subject-emit':
        return 'subject-emit';
      case 'signal-write':
        return 'signal-write';
      case 'route-change':
        return 'route-change';
      case 'user-interaction':
        return 'user-interaction';
      case 'websocket':
        return 'websocket';
      case 'store-dispatch':
        return 'store-dispatch';
      case 'store-select':
        return 'store-select';
      case 'facade-method':
        // Facade method calls are state updates
        return 'state-update' as any; // Not in original enum, will expand
      default:
        return 'subject-emit'; // Safe fallback
    }
  }

  /**
   * Infer the session boundary that triggered this flow event.
   * Uses triggeredByInteractionTs to link events to their origin.
   */
  private inferBoundaryFromFlow(flowEvent: FlowEvent): SessionBoundary | undefined {
    // If it's a user-interaction, it's the boundary itself
    if (flowEvent.type === 'user-interaction') {
      return 'user-interaction';
    }

    // If it's a route-change, that's a boundary
    if (flowEvent.type === 'route-change') {
      return 'route-navigation';
    }

    // If it's a websocket, that's a boundary
    if (flowEvent.type === 'websocket') {
      return 'websocket';
    }

    // Otherwise, we'll infer based on the source component
    // Components initializing (ngOnInit) typically start a bootstrap boundary
    if (flowEvent.sourceComponent?.includes('RootComponent') || flowEvent.sourceComponent?.includes('AppComponent')) {
      return 'component-bootstrap';
    }

    // If there's an interactionComponent, it was user-triggered
    if (flowEvent.sourceComponent) {
      return 'user-interaction';
    }

    return undefined;
  }

  /**
   * Infer the session boundary that triggered this render event.
   */
  private inferBoundaryFromRender(renderEvent: RenderEvent): SessionBoundary | undefined {
    // If there's an interaction target, it was user-triggered
    if (renderEvent.interactionComponent || renderEvent.interactionTarget) {
      return 'user-interaction';
    }

    // If component is root/app-level, likely bootstrap
    if (renderEvent.componentName.includes('RootComponent') || renderEvent.componentName.includes('AppComponent')) {
      return 'component-bootstrap';
    }

    // Check causes for zone pollution (timers, etc.)
    for (const cause of renderEvent.causes) {
      if (cause.type === 'zone') {
        if (cause.source?.includes('setInterval') || cause.source?.includes('setImmediate')) {
          return 'timer';
        }
        if (cause.source?.includes('WebSocket')) {
          return 'websocket';
        }
      }
    }

    return undefined;
  }

  /**
   * Build a human-readable label for a flow event if one doesn't exist.
   */
  private buildFlowLabel(event: FlowEvent): string {
    switch (event.type) {
      case 'http-response': {
        const method = event.detail?.split(' ')?.[0] || 'HTTP';
        const url = event.detail?.split(' ')?.[1] || 'API';
        return `${method} ${url}`;
      }
      case 'subject-emit': {
        const ownerClass = event.ownerClass || 'Service';
        const propName = event.propertyName || 'subject';
        return `${ownerClass}.${propName}.next()`;
      }
      case 'signal-write': {
        const propName = event.propertyName || 'signal';
        return `${propName} signal updated`;
      }
      case 'store-dispatch': {
        const actionName = event.actionName || event.methodName || 'action';
        return `Dispatch: ${actionName}`;
      }
      case 'store-select': {
        const selectorName = event.selectorName || 'selector';
        return `Select: ${selectorName}`;
      }
      case 'route-change': {
        return `Navigate: ${event.fromRoute} → ${event.toRoute}`;
      }
      case 'user-interaction': {
        return `User clicked ${event.targetSelector || 'element'}`;
      }
      case 'websocket': {
        return `WebSocket ${event.connectionStatus}`;
      }
      case 'facade-method': {
        const methodName = event.methodName || 'method';
        return `${event.ownerClass || 'Facade'}.${methodName}()`;
      }
      default:
        return event.label || 'Event';
    }
  }
}

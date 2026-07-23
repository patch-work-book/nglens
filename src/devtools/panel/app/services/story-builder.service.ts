/**
 * Story Builder Service
 * 
 * THE CORE DIFFERENTIATOR OF THE EXECUTION INTELLIGENCE ENGINE.
 * 
 * Transforms a stream of normalized events into a readable narrative.
 * 200 events → 15 meaningful execution steps.
 * 
 * Input: RuntimeEvents + ExecutionSession
 * Output: ExecutionStory with merged ExecutionSteps
 * 
 * Philosophy:
 * A "step" is NOT a single event. It's a SEMANTIC UNIT.
 * Example: "Revenue Updated" = HTTP Response + Store Dispatch + Signal Write + Component Render
 * 
 * How it works:
 * 1. Identify semantic patterns (http-response triggers store-dispatch triggers signal-write, etc.)
 * 2. Group related events into causal chains
 * 3. Create a high-level step for each chain
 * 4. Preserve event references for expansion/debugging
 */

import { Injectable } from '@angular/core';
import type {
  RuntimeEvent,
  ExecutionSession,
  ExecutionStep,
  ExecutionStory,
  ExecutionStepType,
  DiffResult,
  StoryGroup,
} from '../../../../types/execution-intelligence';

interface EventCluster {
  events: RuntimeEvent[];
  stepType: ExecutionStepType;
  title: string;
  summary: string;
  startTime: number;
  endTime: number;
}

@Injectable({ providedIn: 'root' })
export class StoryBuilderService {
  private stepCounter = 0;

  /**
   * Build an execution story from a session and its normalized events.
   * This is where 200 events become 15 meaningful steps.
   */
  buildStory(
    session: ExecutionSession,
    events: RuntimeEvent[],
    eventMap?: Map<string, RuntimeEvent>
  ): ExecutionStory {
    if (events.length === 0) {
      return this.createEmptyStory(session);
    }

    // Get full event objects if not provided
    const fullEvents = eventMap
      ? session.eventIds.map(id => eventMap.get(id)).filter(Boolean) as RuntimeEvent[]
      : events;

    // Sort by timestamp
    const sorted = [...fullEvents].sort((a, b) => a.timestamp - b.timestamp);

    // Cluster related events into semantic units
    const clusters = this.clusterEvents(sorted);

    // Convert clusters into execution steps
    const steps = clusters.map((cluster, index) => this.clusterToStep(cluster, index + 1, sorted));

    // Create story
    const story: ExecutionStory = {
      id: `story-${Date.now()}-${Math.random()}`,
      sessionId: session.id,
      boundary: session.boundary,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      title: this.generateStoryTitle(session, steps),
      summary: this.generateStorySummary(session, steps),
      steps,
      stepCount: steps.length,
      totalEventCount: fullEvents.length,
      insights: [], // Populated by Insight Engine
      executionScore: {
        score: 85,
        status: 'good',
        apiHealth: 85,
        renderHealth: 80,
        stateManagementHealth: 90,
        memoryHealth: 85,
        checks: {
          noDuplicateApis: true,
          goodRenderCount: true,
          reasonablePayloadSize: true,
          noMemoryLeaks: true,
          noInfiniteLoops: true,
          noSlowRenders: true,
          noExcessiveRerenders: true,
        },
        summary: 'Good',
      },
      affectedComponents: new Set(fullEvents.map(e => e.sourceComponent).filter(Boolean) as string[]),
      affectedServices: new Set(fullEvents.map(e => e.ownerClass).filter(Boolean) as string[]),
      affectedStores: new Set(),
    };

    return story;
  }

  /**
   * Build a grouped story (for large dashboards with 40+ APIs).
   * Groups steps by business entity (Revenue, Orders, User, etc.).
   */
  buildGroupedStory(story: ExecutionStory): ExecutionStory & { groups?: StoryGroup[] } {
    // For now, return ungrouped story
    // In future: analyze step titles to infer business entities
    return story;
  }

  /**
   * Reset the builder.
   */
  reset(): void {
    this.stepCounter = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CLUSTERING: The core algorithm for merging events into steps
  // ──────────────────────────────────────────────────────────────────────────

  private clusterEvents(sortedEvents: RuntimeEvent[]): EventCluster[] {
    const clusters: EventCluster[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i];

      if (processed.has(event.id)) {
        continue;
      }

      // Try to build a cluster starting from this event
      let cluster = this.tryBuildCluster(event, sortedEvents, processed, i);

      if (!cluster) {
        // Couldn't form a semantic cluster, create a singleton
        cluster = {
          events: [event],
          stepType: this.eventTypeToStepType(event.type),
          title: this.generateStepTitle(event),
          summary: event.label,
          startTime: event.timestamp,
          endTime: event.timestamp,
        };
      }

      clusters.push(cluster);

      // Mark all events in cluster as processed
      for (const e of cluster.events) {
        processed.add(e.id);
      }
    }

    return clusters;
  }

  /**
   * Try to build a semantic cluster starting from an event.
   * Returns null if event should be a singleton.
   */
  private tryBuildCluster(
    startEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    startIndex: number
  ): EventCluster | null {
    // Pattern 1: HTTP Response → Store Update → Signal Update → Render (Data Fetch pattern)
    if (startEvent.type === 'http-response') {
      const cluster = this.findDataFetchCluster(startEvent, allEvents, processed, startIndex);
      if (cluster) return cluster;
    }

    // Pattern 2: Signal Write → Computed → Renders (Computation pattern)
    if (startEvent.type === 'signal-write') {
      const cluster = this.findComputationCluster(startEvent, allEvents, processed, startIndex);
      if (cluster) return cluster;
    }

    // Pattern 3: Subject Emit → Renders (State Update pattern)
    if (startEvent.type === 'subject-emit') {
      const cluster = this.findStateUpdateCluster(startEvent, allEvents, processed, startIndex);
      if (cluster) return cluster;
    }

    // Pattern 4: User Interaction → ... → Renders (User Interaction pattern)
    if (startEvent.type === 'user-interaction') {
      const cluster = this.findUserInteractionCluster(startEvent, allEvents, processed, startIndex);
      if (cluster) return cluster;
    }

    // Pattern 5: Route Change → ... (Navigation pattern)
    if (startEvent.type === 'route-change') {
      const cluster = this.findNavigationCluster(startEvent, allEvents, processed, startIndex);
      if (cluster) return cluster;
    }

    // No semantic pattern found
    return null;
  }

  /**
   * Pattern: HTTP Response → Store Action/Signal → Component Renders
   * Merge these into a single "Data Fetch" step.
   */
  private findDataFetchCluster(
    httpEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    eventIndex: number
  ): EventCluster | null {
    const cluster: RuntimeEvent[] = [httpEvent];
    let currentTime = httpEvent.timestamp;
    const timeWindow = 500; // ms: look for related events within 500ms

    // Look forward for store updates, signal writes, renders
    for (let i = eventIndex + 1; i < allEvents.length; i++) {
      const nextEvent = allEvents[i];

      if (processed.has(nextEvent.id)) {
        continue;
      }

      // Stop if we've gone too far into the future
      if (nextEvent.timestamp - currentTime > timeWindow) {
        break;
      }

      // Include store dispatch, store select, signal write, renders
      if (
        nextEvent.type === 'store-dispatch' ||
        nextEvent.type === 'store-select' ||
        nextEvent.type === 'signal-write' ||
        nextEvent.type === 'component-render'
      ) {
        cluster.push(nextEvent);
        currentTime = nextEvent.timestamp;
      }
    }

    if (cluster.length > 1) {
      // Extract the resource being fetched from the HTTP URL
      const resource = this.extractResourceName(httpEvent.detail || httpEvent.label);

      // If the HTTP event has a duration (request time), the actual start is earlier
      const apiStartTime = httpEvent.duration 
        ? httpEvent.timestamp - httpEvent.duration 
        : cluster[0].timestamp;

      return {
        events: cluster,
        stepType: 'data-fetch',
        title: `${resource} Loaded`,
        summary: `${httpEvent.label}`,
        startTime: apiStartTime,
        endTime: cluster[cluster.length - 1].timestamp,
      };
    }

    return null;
  }

  /**
   * Pattern: Signal Write → Derived Signals → Component Renders
   */
  private findComputationCluster(
    signalEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    eventIndex: number
  ): EventCluster | null {
    const cluster: RuntimeEvent[] = [signalEvent];
    let currentTime = signalEvent.timestamp;
    const timeWindow = 200;

    for (let i = eventIndex + 1; i < allEvents.length; i++) {
      const nextEvent = allEvents[i];

      if (processed.has(nextEvent.id)) {
        continue;
      }

      if (nextEvent.timestamp - currentTime > timeWindow) {
        break;
      }

      // Include other signal writes or renders
      if (nextEvent.type === 'signal-write' || nextEvent.type === 'component-render') {
        cluster.push(nextEvent);
        currentTime = nextEvent.timestamp;
      }
    }

    if (cluster.length > 1) {
      const signalName = signalEvent.propertyName || 'Signal';

      return {
        events: cluster,
        stepType: 'computation',
        title: `${signalName} Updated`,
        summary: `Signal cascade triggered`,
        startTime: cluster[0].timestamp,
        endTime: cluster[cluster.length - 1].timestamp,
      };
    }

    return null;
  }

  /**
   * Pattern: Subject Emit → Component Renders
   */
  private findStateUpdateCluster(
    subjectEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    eventIndex: number
  ): EventCluster | null {
    const cluster: RuntimeEvent[] = [subjectEvent];
    let currentTime = subjectEvent.timestamp;
    const timeWindow = 300;

    for (let i = eventIndex + 1; i < allEvents.length; i++) {
      const nextEvent = allEvents[i];

      if (processed.has(nextEvent.id)) {
        continue;
      }

      if (nextEvent.timestamp - currentTime > timeWindow) {
        break;
      }

      if (nextEvent.type === 'component-render' || nextEvent.type === 'subject-emit') {
        cluster.push(nextEvent);
        currentTime = nextEvent.timestamp;
      }
    }

    if (cluster.length > 1) {
      const subjectName = subjectEvent.propertyName || 'State';

      return {
        events: cluster,
        stepType: 'state-update',
        title: `${subjectName} Updated`,
        summary: `Subject emitted and triggered renders`,
        startTime: cluster[0].timestamp,
        endTime: cluster[cluster.length - 1].timestamp,
      };
    }

    return null;
  }

  /**
   * Pattern: User Interaction → Service Call → Store/Signal → Renders
   */
  private findUserInteractionCluster(
    interactionEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    eventIndex: number
  ): EventCluster | null {
    const cluster: RuntimeEvent[] = [interactionEvent];
    let currentTime = interactionEvent.timestamp;
    const timeWindow = 2000; // User interactions can have long chains

    for (let i = eventIndex + 1; i < allEvents.length; i++) {
      const nextEvent = allEvents[i];

      if (processed.has(nextEvent.id)) {
        continue;
      }

      if (nextEvent.timestamp - currentTime > timeWindow) {
        break;
      }

      // Include everything that follows: HTTP, store, signals, renders
      if (
        nextEvent.type === 'http-request' ||
        nextEvent.type === 'http-response' ||
        nextEvent.type === 'store-dispatch' ||
        nextEvent.type === 'signal-write' ||
        nextEvent.type === 'component-render'
      ) {
        cluster.push(nextEvent);
        currentTime = nextEvent.timestamp;
      }
    }

    if (cluster.length > 1) {
      return {
        events: cluster,
        stepType: 'user-interaction',
        title: `User Action`,
        summary: interactionEvent.label,
        startTime: cluster[0].timestamp,
        endTime: cluster[cluster.length - 1].timestamp,
      };
    }

    return null;
  }

  /**
   * Pattern: Route Change → Initial Renders and APIs
   */
  private findNavigationCluster(
    routeEvent: RuntimeEvent,
    allEvents: RuntimeEvent[],
    processed: Set<string>,
    eventIndex: number
  ): EventCluster | null {
    const cluster: RuntimeEvent[] = [routeEvent];
    let currentTime = routeEvent.timestamp;
    const timeWindow = 3000; // Route navigation can take a while

    for (let i = eventIndex + 1; i < allEvents.length; i++) {
      const nextEvent = allEvents[i];

      if (processed.has(nextEvent.id)) {
        continue;
      }

      if (nextEvent.timestamp - currentTime > timeWindow) {
        break;
      }

      cluster.push(nextEvent);
      currentTime = nextEvent.timestamp;
    }

    if (cluster.length > 1) {
      const destination = routeEvent.route || routeEvent.detail || 'destination';

      return {
        events: cluster,
        stepType: 'navigation',
        title: `Navigated to ${destination}`,
        summary: routeEvent.label,
        startTime: cluster[0].timestamp,
        endTime: cluster[cluster.length - 1].timestamp,
      };
    }

    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONVERSION: Cluster → ExecutionStep
  // ──────────────────────────────────────────────────────────────────────────

  private clusterToStep(
    cluster: EventCluster,
    sequenceOrder: number,
    allEvents: RuntimeEvent[]
  ): ExecutionStep {
    const duration = cluster.endTime - cluster.startTime;

    const step: ExecutionStep = {
      id: `step-${++this.stepCounter}`,
      type: cluster.stepType,
      title: cluster.title,
      summary: cluster.summary,
      eventIds: cluster.events.map(e => e.id),
      startTime: cluster.startTime,
      endTime: cluster.endTime,
      duration,
      sequenceOrder,
      changes: this.computeDiff(cluster.events),
      impact: {
        components: { count: 0, names: [], renders: 0 },
        signals: { count: 0, names: [] },
        stores: { count: 0, names: [] },
        services: { count: 0, names: [] },
        rxjsChains: { count: 0, subscriptionCount: 0 },
        totalRenderCount: 0,
        averageRenderDuration: 0,
        totalDuration: 0,
        directConsumers: [],
        transitiveConsumers: [],
      },
      rootCauseChain: {
        startingBoundary: 'user-interaction',
        chain: [],
        rootCause: { eventId: cluster.events[0].id, timestamp: cluster.events[0].timestamp, type: cluster.events[0].type, label: cluster.events[0].label },
        summary: '',
      },
      compressedEventCount: cluster.events.length,
      isCompressed: cluster.events.length > 1,
      stepInsights: [],
      confidence: 0.9,
    };

    return step;
  }

  private computeDiff(events: RuntimeEvent[]): DiffResult {
    // Extract value changes from the cluster
    const modified: Array<{ key: string; oldValue: string; newValue: string; type: string }> = [];

    for (const event of events) {
      if (event.valueSnapshot) {
        // If we have structured values, compute diff
        for (const [key, value] of Object.entries(event.valueSnapshot)) {
          modified.push({
            key,
            oldValue: 'N/A',
            newValue: String(value),
            type: typeof value,
          });
        }
      }
    }

    return {
      added: { count: 0, properties: [] },
      removed: { count: 0, properties: [] },
      modified: { count: modified.length, properties: modified },
      summary: modified.map(m => `${m.key}: ${m.newValue}`).join(', ') || 'State updated',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TITLE & SUMMARY GENERATION
  // ──────────────────────────────────────────────────────────────────────────

  private eventTypeToStepType(eventType: RuntimeEvent['type']): ExecutionStepType {
    switch (eventType) {
      case 'http-request':
      case 'http-response':
        return 'data-fetch';
      case 'component-render':
        return 'ui-update';
      case 'signal-write':
      case 'subject-emit':
      case 'store-dispatch':
        return 'state-update';
      case 'route-change':
        return 'navigation';
      case 'user-interaction':
        return 'user-interaction';
      case 'websocket':
        return 'background-task';
      default:
        return 'computation';
    }
  }

  private generateStepTitle(event: RuntimeEvent): string {
    switch (event.type) {
      case 'http-response':
        return `${this.extractResourceName(event.label)} Loaded`;
      case 'signal-write':
        return `${event.propertyName || 'Signal'} Updated`;
      case 'store-dispatch':
        return `${event.metadata?.['actionName'] || 'Store'} Dispatched`;
      case 'component-render':
        return `${event.sourceComponent} Rendered`;
      default:
        return event.label;
    }
  }

  private generateStoryTitle(session: ExecutionSession, steps: ExecutionStep[]): string {
    if (session.boundary === 'route-navigation') {
      return `Navigate to ${session.toRoute || 'destination'}`;
    }
    if (session.boundary === 'user-interaction') {
      return `User Action`;
    }
    if (session.boundary === 'component-bootstrap') {
      return `Application Bootstrap`;
    }
    if (steps.length > 0) {
      return steps[0].title;
    }
    return 'Execution Session';
  }

  private generateStorySummary(session: ExecutionSession, steps: ExecutionStep[]): string {
    return `${steps.length} step${steps.length !== 1 ? 's' : ''} - ${session.eventCount} events - ${session.duration}ms`;
  }

  private extractResourceName(label: string): string {
    // Extract "Orders" from "GET /api/orders" or "Orders API"
    const match = label.match(/(?:GET|POST|PUT|DELETE)?\s*\/api\/(\w+)/i) ||
                  label.match(/(\w+)\s+API/i) ||
                  label.match(/Get\s+(\w+)/i);
    return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : 'Data';
  }

  private createEmptyStory(session: ExecutionSession): ExecutionStory {
    return {
      id: `story-${Date.now()}`,
      sessionId: session.id,
      boundary: session.boundary,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      title: 'Empty Session',
      summary: 'No events captured',
      steps: [],
      stepCount: 0,
      totalEventCount: 0,
      insights: [],
      executionScore: {
        score: 50,
        status: 'warning',
        apiHealth: 50,
        renderHealth: 50,
        stateManagementHealth: 50,
        memoryHealth: 50,
        checks: {
          noDuplicateApis: true,
          goodRenderCount: false,
          reasonablePayloadSize: true,
          noMemoryLeaks: true,
          noInfiniteLoops: true,
          noSlowRenders: false,
          noExcessiveRerenders: false,
        },
        summary: 'No events',
      },
      affectedComponents: new Set(),
      affectedServices: new Set(),
      affectedStores: new Set(),
    };
  }
}

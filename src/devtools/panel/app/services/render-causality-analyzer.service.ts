/**
 * Render Causality Analyzer
 *
 * CORE SERVICE: Stage 2 of the 3-stage pipeline.
 *
 * Takes normalized render events and answers: "Why did each component render?"
 *
 * Consolidates:
 * - SessionBuilder (group events into interactions)
 * - RenderStepBuilder (cluster renders by cause)
 * - RenderImpactAnalyzer (compute scope: how many components affected)
 * - RenderCauseTracer (trace causality: what triggered this render)
 * - RenderPerformanceScorer (assign health score)
 *
 * Output: RenderTimeline (list of render steps with causality + impact)
 *
 * NO pass-through logic. Each method adds real value.
 */

import { Injectable } from '@angular/core';
import type { RenderEvent, FlowEvent } from '../../../../types/render-events';
import type { RuntimeEvent } from '../../../../types/execution-intelligence';

// ============================================================================
// TYPES (Local to this service, not exported to other services)
// ============================================================================

interface RenderSession {
  id: string;
  boundary: 'user-interaction' | 'route-navigation' | 'component-bootstrap' | 'timer' | 'websocket' | 'background-task' | 'manual-refresh';
  startTime: number;
  endTime: number;
  eventIds: string[];
  renderCounts: Map<string, number>; // componentName → count
}

interface RenderStep {
  id: string;
  sessionId: string;
  timestamp: number;
  duration: number;
  componentName: string;
  renderCount: number;
  causes: string[]; // What triggered this render? ["parent-render", "signal-mutation", "http-response"]
  impactedComponents: string[]; // List of components that rendered as a result
  totalRenderCount: number; // This step caused N total renders (including cascade)
  hotspotSeverity: 'low' | 'medium' | 'high' | 'critical';
  healthScore: number; // 0-100, higher is better
}

interface RenderTimeline {
  sessions: RenderSession[];
  steps: RenderStep[];
  overallHealthScore: number;
  hotspotComponentCount: number;
}

// ============================================================================
// ANALYZER SERVICE
// ============================================================================

@Injectable({ providedIn: 'root' })
export class RenderCausalityAnalyzer {
  /**
   * Analyze normalized events and return render timeline with causality.
   */
  analyze(normalizedEvents: RuntimeEvent[]): RenderTimeline {
    // Step 1: Group events into sessions (user interactions, route changes, etc.)
    const sessions = this.buildSessions(normalizedEvents);

    // Step 2: For each session, identify render steps and their causes
    const steps: RenderStep[] = [];
    const componentStats = new Map<string, { renderCount: number; severity: string }>();

    for (const session of sessions) {
      const sessionEvents = normalizedEvents.filter(e => sessions.some(s => s.eventIds.includes(e.id)));
      const renderEvents = sessionEvents.filter(e => e.type === 'component-render');

      // Build render steps from events in this session
      const sessionSteps = this.buildRenderSteps(renderEvents, sessionEvents, session);
      steps.push(...sessionSteps);

      // Track component hotspots
      for (const step of sessionSteps) {
        const existing = componentStats.get(step.componentName) || { renderCount: 0, severity: 'low' };
        existing.renderCount += step.renderCount;
        existing.severity = this.calculateSeverity(existing.renderCount);
        componentStats.set(step.componentName, existing);
      }
    }

    // Step 3: Calculate overall health score
    const overallHealthScore = this.calculateOverallHealth(steps);
    const hotspotComponentCount = Array.from(componentStats.values()).filter(
      s => s.severity === 'high' || s.severity === 'critical'
    ).length;

    return {
      sessions,
      steps,
      overallHealthScore,
      hotspotComponentCount,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Session Building
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Group events into logical sessions (user interactions, route changes, etc.)
   *
   * A session is a boundary where the user or app initiated something:
   * - User clicks a button
   * - Page navigates to new route
   * - Bootstrap completes
   * - API response arrives
   * - Timer fires
   */
  private buildSessions(events: RuntimeEvent[]): RenderSession[] {
    const sessions: RenderSession[] = [];
    let currentSession: RenderSession | null = null;
    const SESSION_TIMEOUT_MS = 2000; // If no events for 2s, start new session

    for (const event of events) {
      // Determine if this event is a boundary event (starts a new session)
      const boundary = this.determineBoundary(event);

      // Check if we should create a new session
      if (!currentSession || this.shouldStartNewSession(currentSession, event, SESSION_TIMEOUT_MS)) {
        if (currentSession) {
          sessions.push(currentSession);
        }

        currentSession = {
          id: `session-${sessions.length}-${event.timestamp}`,
          boundary,
          startTime: event.timestamp,
          endTime: event.timestamp + (event.duration ?? 0),
          eventIds: [],
          renderCounts: new Map(),
        };
      }

      // Add event to current session
      currentSession.eventIds.push(event.id);
      currentSession.endTime = Math.max(currentSession.endTime, event.timestamp + (event.duration ?? 0));

      // Track render counts
      if (event.type === 'component-render') {
        const componentName = (event as any).componentName || 'unknown';
        const count = currentSession.renderCounts.get(componentName) || 0;
        currentSession.renderCounts.set(componentName, count + 1);
      }
    }

    if (currentSession) {
      sessions.push(currentSession);
    }

    return sessions;
  }

  private determineBoundary(event: RuntimeEvent): RenderSession['boundary'] {
    if (event.causedByBoundary) {
      // Use the boundary from the event
      return event.causedByBoundary as any;
    }

    // Heuristic: infer from event type
    if (event.type === 'http-response') return 'background-task';
    if (event.type === 'route-change') return 'route-navigation';
    if (event.type === 'user-interaction') return 'user-interaction';
    if (event.type === 'signal-write') return 'user-interaction'; // Optimistic
    if (event.type === 'timer') return 'timer';
    if (event.type === 'websocket') return 'websocket';

    return 'user-interaction'; // Default assumption
  }

  private shouldStartNewSession(currentSession: RenderSession, event: RuntimeEvent, timeout: number): boolean {
    const timeSinceLastEvent = event.timestamp - currentSession.endTime;
    return timeSinceLastEvent > timeout;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Render Step Building
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * From a set of render events, identify distinct "steps" (clusters of renders with common cause)
   *
   * Example:
   * - Time 100ms: User clicks button
   * - Time 105ms: HeaderComponent renders (cause: parent)
   * - Time 110ms: ListComponent renders (cause: parent)
   * - Time 115ms: ListItemComponent x5 render (cause: parent)
   *
   * This could be ONE step ("button click triggered render cascade") or multiple steps.
   * For Phase 2, we group by time window (50ms) and cause.
   */
  private buildRenderSteps(
    renderEvents: RuntimeEvent[],
    allSessionEvents: RuntimeEvent[],
    session: RenderSession
  ): RenderStep[] {
    const steps: RenderStep[] = [];
    const STEP_TIME_WINDOW_MS = 50;
    let currentStepRenders: RuntimeEvent[] = [];
    let lastEventTime = 0;

    for (const renderEvent of renderEvents) {
      // If this render is outside the time window from the last one, start a new step
      if (currentStepRenders.length > 0 && renderEvent.timestamp - lastEventTime > STEP_TIME_WINDOW_MS) {
        const step = this.buildStep(currentStepRenders, allSessionEvents, session);
        steps.push(step);
        currentStepRenders = [];
      }

      currentStepRenders.push(renderEvent);
      lastEventTime = renderEvent.timestamp;
    }

    // Don't forget the last step
    if (currentStepRenders.length > 0) {
      const step = this.buildStep(currentStepRenders, allSessionEvents, session);
      steps.push(step);
    }

    return steps;
  }

  private buildStep(
    renderEvents: RuntimeEvent[],
    allSessionEvents: RuntimeEvent[],
    session: RenderSession
  ): RenderStep {
    const firstRender = renderEvents[0] as any;
    const componentName = firstRender.componentName || 'unknown';

    // Trace what caused these renders
    const causes = this.traceCauses(renderEvents, allSessionEvents);

    // Find what components rendered as a result of this event
    const impactedComponents = this.findImpactedComponents(renderEvents);

    // Count total renders (including cascade)
    const totalRenderCount = renderEvents.length;

    // Assign severity
    const severity = this.calculateSeverity(totalRenderCount);

    // Calculate health score (lower render count = higher score)
    const healthScore = Math.max(0, 100 - totalRenderCount * 2);

    return {
      id: `step-${session.id}-${firstRender.timestamp}`,
      sessionId: session.id,
      timestamp: firstRender.timestamp,
      duration: Math.max(...renderEvents.map(e => e.timestamp + (e.duration ?? 0))) - firstRender.timestamp,
      componentName,
      renderCount: renderEvents.length,
      causes,
      impactedComponents,
      totalRenderCount,
      hotspotSeverity: severity,
      healthScore,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Causality Tracing
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Trace causality: what triggered these renders?
   *
   * Returns list of causes like: ["parent-render", "signal-mutation", "http-response"]
   */
  private traceCauses(renderEvents: RuntimeEvent[], allSessionEvents: RuntimeEvent[]): string[] {
    const causes = new Set<string>();
    const firstRenderTime = renderEvents[0].timestamp;

    // Look backwards in allSessionEvents (within 500ms) to find the trigger
    for (const event of allSessionEvents) {
      if (event.timestamp > firstRenderTime) break; // Only look backwards
      if (event.timestamp < firstRenderTime - 500) continue; // Only recent events

      if (event.type === 'user-interaction') {
        causes.add('user-interaction');
      } else if (event.type === 'http-response') {
        causes.add('http-response');
      } else if (event.type === 'signal-write') {
        causes.add('signal-mutation');
      } else if (event.type === 'timer') {
        causes.add('timer');
      } else if (event.type === 'component-render') {
        causes.add('parent-render');
      }
    }

    // If no cause found, default to unknown
    if (causes.size === 0) {
      causes.add('unknown');
    }

    return Array.from(causes);
  }

  /**
   * Find which components rendered as a result of this event.
   * Returns list of component names.
   */
  private findImpactedComponents(renderEvents: RuntimeEvent[]): string[] {
    const components = new Set<string>();
    for (const event of renderEvents) {
      const componentName = (event as any).componentName;
      if (componentName) {
        components.add(componentName);
      }
    }
    return Array.from(components);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Scoring
  // ──────────────────────────────────────────────────────────────────────────

  private calculateSeverity(renderCount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (renderCount <= 1) return 'low';
    if (renderCount <= 5) return 'medium';
    if (renderCount <= 15) return 'high';
    return 'critical';
  }

  private calculateOverallHealth(steps: RenderStep[]): number {
    if (steps.length === 0) return 100;

    // Average health score of all steps
    const avgScore = steps.reduce((sum, s) => sum + s.healthScore, 0) / steps.length;
    return Math.round(avgScore);
  }
}

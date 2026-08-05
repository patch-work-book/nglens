/**
 * Property 2: Preservation - Non-Trigger Message Handling Unchanged
 *
 * These property-based tests verify that dispatching non-trigger messages
 * (EVENT_BATCH, LEAK_EVENT, TRACKBY_ISSUE, ONPUSH_RESULT, DEGRADED_MODE)
 * produces the expected state mutations on the UNFIXED code.
 *
 * The tests directly exercise PanelState signal mutations as performed by
 * EventDispatcherService.dispatch() for non-trigger message types.
 * This validates the state layer independently of Angular DI.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PanelState } from '../src/devtools/panel/app/state/panel.state';
import type { RenderEvent, RenderCause } from '../src/types/render-events';
import type { LeakEvent } from '../src/types/leak-events';
import type { TrackByIssue, OnPushScore, OnPushFactor } from '../src/types/recommendation-events';
import type { PortMessage } from '../src/types/port-messages';

// Mock ExecutionIntelligenceService for tests
const mockExecutionIntelligenceService = {
  addRenderEvents: () => {},
  addFlowEvents: () => {},
  addEvents: () => {},
  clear: () => {},
  executionStories: { asReadonly: () => [] },
  executionSessions: { asReadonly: () => [] },
  executionGraphs: { asReadonly: () => new Map() },
  sessionCount: { asReadonly: () => 0 },
  totalEvents: { asReadonly: () => 0 },
  getStoriesForSession: () => [],
  getStory: () => undefined,
  getStep: () => undefined,
  expandStep: () => [],
  getInsights: () => [],
  getGraph: () => undefined,
  getGraphEngine: () => ({} as any),
};

// --- Arbitraries ---

const renderCauseTypeArb = fc.constantFrom<RenderCause['type']>(
  'signal', 'input', 'zone', 'parent', 'manual-cd'
);

const renderCauseArb: fc.Arbitrary<RenderCause> = fc.record({
  type: renderCauseTypeArb,
  source: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
});

const renderEventArb: fc.Arbitrary<RenderEvent> = fc.record({
  componentName: fc.string({ minLength: 1, maxLength: 50 }),
  timestamp: fc.nat({ max: 1_000_000_000 }),
  duration: fc.double({ min: 0.1, max: 1000, noNaN: true }),
  causes: fc.array(renderCauseArb, { minLength: 1, maxLength: 5 }),
});

const severityArb = fc.constantFrom<'CRITICAL' | 'WARNING' | 'INFO'>('CRITICAL', 'WARNING', 'INFO');

const leakTypeArb = fc.constantFrom<'subscription' | 'timer' | 'event-listener'>(
  'subscription', 'timer', 'event-listener'
);

const leakEventArb: fc.Arbitrary<LeakEvent> = fc.record({
  id: fc.uuid(),
  componentName: fc.string({ minLength: 1, maxLength: 50 }),
  componentId: fc.uuid(),
  leakType: leakTypeArb,
  severity: severityArb,
  source: fc.string({ minLength: 1, maxLength: 50 }),
  createdAt: fc.nat({ max: 1_000_000_000 }),
  detectedAt: fc.nat({ max: 1_000_000_000 }),
  lifecycleState: fc.constant('destroyed' as const),
});

const trackByIssueArb: fc.Arbitrary<TrackByIssue> = fc.record({
  id: fc.uuid(),
  componentName: fc.string({ minLength: 1, maxLength: 50 }),
  collectionProperty: fc.string({ minLength: 1, maxLength: 30 }),
  collectionSize: fc.nat({ max: 10000 }),
  severity: severityArb,
  recommendation: fc.string({ minLength: 1, maxLength: 100 }),
});

const onPushFactorArb: fc.Arbitrary<OnPushFactor> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 30 }),
  weight: fc.double({ min: 0, max: 1, noNaN: true }),
  met: fc.boolean(),
  description: fc.string({ minLength: 1, maxLength: 100 }),
});

const onPushScoreArb: fc.Arbitrary<OnPushScore> = fc.record({
  component: fc.string({ minLength: 1, maxLength: 50 }),
  score: fc.nat({ max: 100 }),
  currentStrategy: fc.constantFrom<'Default' | 'OnPush'>('Default', 'OnPush'),
  factors: fc.array(onPushFactorArb, { minLength: 0, maxLength: 5 }),
  recommendation: fc.string({ minLength: 1, maxLength: 100 }),
});

// --- Dispatch helper that replicates EventDispatcherService.dispatch() logic ---
// This mirrors the switch cases in event-dispatcher.service.ts for non-trigger messages.

function dispatchToState(state: PanelState, message: PortMessage): void {
  const frameId = message.frameId ?? 0;
  switch (message.type) {
    case 'EVENT_BATCH':
      state.addRenderEvents((message.payload as { events: RenderEvent[] }).events, frameId);
      break;
    case 'LEAK_EVENT':
      state.addLeakEvent(message.payload as LeakEvent, frameId);
      break;
    case 'TRACKBY_ISSUE':
      state.addTrackByIssue(message.payload as TrackByIssue, frameId);
      break;
    case 'ONPUSH_RESULT':
      state.addOnPushResult(message.payload as OnPushScore, frameId);
      break;
    case 'DEGRADED_MODE':
      state.degradedMode.set(true);
      break;
  }
}

// --- Property Tests ---

describe('Property 2: Preservation - Non-Trigger Message Handling Unchanged', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * EVENT_BATCH dispatching appends events to renderEvents.
   */
  describe('EVENT_BATCH preservation', () => {
    it('appends all events from a single batch to renderEvents', () => {
      fc.assert(
        fc.property(
          fc.array(renderEventArb, { minLength: 1, maxLength: 20 }),
          (events: RenderEvent[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            const message: PortMessage = {
              type: 'EVENT_BATCH',
              payload: { events },
              timestamp: Date.now(),
            };

            dispatchToState(state, message);

            const result = state.renderEvents();
            expect(result).toHaveLength(events.length);
            expect(result).toEqual(events.map(e => ({ ...e, frameId: 0 })));
          }
        ),
        { numRuns: 100 }
      );
    });

    it('accumulates events across multiple batches', () => {
      fc.assert(
        fc.property(
          fc.array(renderEventArb, { minLength: 1, maxLength: 10 }),
          fc.array(renderEventArb, { minLength: 1, maxLength: 10 }),
          (batch1: RenderEvent[], batch2: RenderEvent[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            dispatchToState(state, {
              type: 'EVENT_BATCH',
              payload: { events: batch1 },
              timestamp: Date.now(),
            });

            dispatchToState(state, {
              type: 'EVENT_BATCH',
              payload: { events: batch2 },
              timestamp: Date.now(),
            });

            const result = state.renderEvents();
            expect(result).toHaveLength(batch1.length + batch2.length);
            expect(result).toEqual([...batch1, ...batch2].map(e => ({ ...e, frameId: 0 })));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * LEAK_EVENT dispatching appends to leakEvents.
   */
  describe('LEAK_EVENT preservation', () => {
    it('appends leak event to leakEvents', () => {
      fc.assert(
        fc.property(leakEventArb, (leakEvent: LeakEvent) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const message: PortMessage = {
            type: 'LEAK_EVENT',
            payload: leakEvent,
            timestamp: Date.now(),
          };

          dispatchToState(state, message);

          const result = state.leakEvents();
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({ ...leakEvent, frameId: 0 });
        }),
        { numRuns: 100 }
      );
    });

    it('accumulates multiple leak events', () => {
      fc.assert(
        fc.property(
          fc.array(leakEventArb, { minLength: 2, maxLength: 10 }),
          (leakEvents: LeakEvent[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            for (const leakEvent of leakEvents) {
              dispatchToState(state, {
                type: 'LEAK_EVENT',
                payload: leakEvent,
                timestamp: Date.now(),
              });
            }

            const result = state.leakEvents();
            expect(result).toHaveLength(leakEvents.length);
            expect(result).toEqual(leakEvents.map(e => ({ ...e, frameId: 0 })));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * TRACKBY_ISSUE dispatching appends to trackByIssues.
   */
  describe('TRACKBY_ISSUE preservation', () => {
    it('appends trackBy issue to trackByIssues', () => {
      fc.assert(
        fc.property(trackByIssueArb, (trackByIssue: TrackByIssue) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const message: PortMessage = {
            type: 'TRACKBY_ISSUE',
            payload: trackByIssue,
            timestamp: Date.now(),
          };

          dispatchToState(state, message);

          const result = state.trackByIssues();
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({ ...trackByIssue, frameId: 0 });
        }),
        { numRuns: 100 }
      );
    });

    it('accumulates multiple trackBy issues', () => {
      fc.assert(
        fc.property(
          fc.array(trackByIssueArb, { minLength: 2, maxLength: 10 }),
          (issues: TrackByIssue[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            for (const issue of issues) {
              dispatchToState(state, {
                type: 'TRACKBY_ISSUE',
                payload: issue,
                timestamp: Date.now(),
              });
            }

            const result = state.trackByIssues();
            expect(result).toHaveLength(issues.length);
            expect(result).toEqual(issues.map(e => ({ ...e, frameId: 0 })));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * ONPUSH_RESULT dispatching appends to onPushRecommendations.
   */
  describe('ONPUSH_RESULT preservation', () => {
    it('appends onPush score to onPushRecommendations', () => {
      fc.assert(
        fc.property(onPushScoreArb, (onPushScore: OnPushScore) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const message: PortMessage = {
            type: 'ONPUSH_RESULT',
            payload: onPushScore,
            timestamp: Date.now(),
          };

          dispatchToState(state, message);

          const result = state.onPushRecommendations();
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({ ...onPushScore, frameId: 0 });
        }),
        { numRuns: 100 }
      );
    });

    it('accumulates multiple onPush scores', () => {
      fc.assert(
        fc.property(
          fc.array(onPushScoreArb, { minLength: 2, maxLength: 10 }),
          (scores: OnPushScore[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            for (const score of scores) {
              dispatchToState(state, {
                type: 'ONPUSH_RESULT',
                payload: score,
                timestamp: Date.now(),
              });
            }

            // Deduplicate scores in test because the state service deduplicates by component and route (under frame 0)
            const uniqueScores: OnPushScore[] = [];
            for (const s of scores) {
              const dupIndex = uniqueScores.findIndex(prev => prev.component === s.component && prev.route === s.route);
              if (dupIndex !== -1) {
                uniqueScores[dupIndex] = s;
              } else {
                uniqueScores.push(s);
              }
            }

            const result = state.onPushRecommendations();
            expect(result).toHaveLength(uniqueScores.length);
            expect(result).toEqual(uniqueScores.map(e => ({ ...e, frameId: 0 })));
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * DEGRADED_MODE dispatching sets degradedMode to true.
   */
  describe('DEGRADED_MODE preservation', () => {
    it('sets degradedMode to true', () => {
      fc.assert(
        fc.property(fc.nat(), (timestamp: number) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          expect(state.degradedMode()).toBe(false);

          const message: PortMessage = {
            type: 'DEGRADED_MODE',
            payload: null,
            timestamp,
          };

          dispatchToState(state, message);

          expect(state.degradedMode()).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it('degradedMode remains true after multiple dispatches', () => {
      fc.assert(
        fc.property(
          fc.array(fc.nat(), { minLength: 2, maxLength: 5 }),
          (timestamps: number[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            for (const ts of timestamps) {
              dispatchToState(state, {
                type: 'DEGRADED_MODE',
                payload: null,
                timestamp: ts,
              });
            }

            expect(state.degradedMode()).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   *
   * For all non-trigger messages, dispatching does not affect connectionState or isTracking.
   */
  describe('Non-trigger messages do not affect connection/tracking state', () => {
    it('EVENT_BATCH does not change connectionState or isTracking', () => {
      fc.assert(
        fc.property(
          fc.array(renderEventArb, { minLength: 1, maxLength: 5 }),
          (events: RenderEvent[]) => {
            const state = new PanelState(mockExecutionIntelligenceService as any);

            const initialConnectionState = state.connectionState();
            const initialIsTracking = state.isTracking();

            dispatchToState(state, {
              type: 'EVENT_BATCH',
              payload: { events },
              timestamp: Date.now(),
            });

            expect(state.connectionState()).toBe(initialConnectionState);
            expect(state.isTracking()).toBe(initialIsTracking);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('LEAK_EVENT does not change connectionState or isTracking', () => {
      fc.assert(
        fc.property(leakEventArb, (leakEvent: LeakEvent) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const initialConnectionState = state.connectionState();
          const initialIsTracking = state.isTracking();

          dispatchToState(state, {
            type: 'LEAK_EVENT',
            payload: leakEvent,
            timestamp: Date.now(),
          });

          expect(state.connectionState()).toBe(initialConnectionState);
          expect(state.isTracking()).toBe(initialIsTracking);
        }),
        { numRuns: 50 }
      );
    });

    it('TRACKBY_ISSUE does not change connectionState or isTracking', () => {
      fc.assert(
        fc.property(trackByIssueArb, (issue: TrackByIssue) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const initialConnectionState = state.connectionState();
          const initialIsTracking = state.isTracking();

          dispatchToState(state, {
            type: 'TRACKBY_ISSUE',
            payload: issue,
            timestamp: Date.now(),
          });

          expect(state.connectionState()).toBe(initialConnectionState);
          expect(state.isTracking()).toBe(initialIsTracking);
        }),
        { numRuns: 50 }
      );
    });

    it('ONPUSH_RESULT does not change connectionState or isTracking', () => {
      fc.assert(
        fc.property(onPushScoreArb, (score: OnPushScore) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const initialConnectionState = state.connectionState();
          const initialIsTracking = state.isTracking();

          dispatchToState(state, {
            type: 'ONPUSH_RESULT',
            payload: score,
            timestamp: Date.now(),
          });

          expect(state.connectionState()).toBe(initialConnectionState);
          expect(state.isTracking()).toBe(initialIsTracking);
        }),
        { numRuns: 50 }
      );
    });

    it('DEGRADED_MODE does not change connectionState or isTracking', () => {
      fc.assert(
        fc.property(fc.nat(), (timestamp: number) => {
          const state = new PanelState(mockExecutionIntelligenceService as any);

          const initialConnectionState = state.connectionState();
          const initialIsTracking = state.isTracking();

          dispatchToState(state, {
            type: 'DEGRADED_MODE',
            payload: null,
            timestamp,
          });

          expect(state.connectionState()).toBe(initialConnectionState);
          expect(state.isTracking()).toBe(initialIsTracking);
        }),
        { numRuns: 50 }
      );
    });
  });
});

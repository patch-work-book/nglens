import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { EventDispatcherService } from './event-dispatcher.service';
import { PanelState } from '../state/panel.state';
import type { PortMessage } from '../../../../types/port-messages';

/**
 * EventDispatcherService behavior tests.
 *
 * ngLens must open in an off state. Connecting the DevTools panel should only
 * establish the port; tracking starts when the user clicks Start.
 */

// Mock chrome APIs needed by Angular DI context
Object.defineProperty(globalThis, 'chrome', {
  value: {
    runtime: {
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
      })),
      lastError: null,
    },
    devtools: {
      inspectedWindow: { tabId: 1 },
    },
  },
  writable: true,
  configurable: true,
});

// Mock DevtoolsPortService with a spy on send()
const mockSend = vi.fn();
const mockDevtoolsPortService = {
  send: mockSend,
  connect: vi.fn(),
};

// Mock ExecutionIntelligenceService
const mockExecutionIntelligenceService = {
  addRenderEvents: vi.fn(),
  addFlowEvents: vi.fn(),
  clear: vi.fn(),
};

// We mock the inject() calls by directly constructing the service
// and patching its dependencies
function createTestService(): { service: EventDispatcherService; state: PanelState } {
  const state = new PanelState(mockExecutionIntelligenceService as any);

  // Create the service instance manually (bypassing Angular DI)
  const service = Object.create(EventDispatcherService.prototype) as EventDispatcherService;

  // Inject the state directly via the private field
  Object.defineProperty(service, 'state', {
    value: state,
    writable: true,
    configurable: true,
  });

  // Inject the execution intelligence service
  Object.defineProperty(service, '_executionIntelligence', {
    value: mockExecutionIntelligenceService,
    writable: true,
    configurable: true,
  });

  // Inject the port service (if the fix adds it, it will be used; on unfixed code this won't exist)
  Object.defineProperty(service, 'portService', {
    value: mockDevtoolsPortService,
    writable: true,
    configurable: true,
  });

  // Also try the injector-based lazy pattern (the fix might use this)
  Object.defineProperty(service, 'injector', {
    value: {
      get: () => mockDevtoolsPortService,
    },
    writable: true,
    configurable: true,
  });

  return { service, state };
}

describe('EventDispatcherService', () => {
  let service: EventDispatcherService;
  let state: PanelState;

  beforeEach(() => {
    vi.clearAllMocks();
    const testSetup = createTestService();
    service = testSetup.service;
    state = testSetup.state;
  });

  describe('default-off tracking behavior', () => {
    /**
     * Validates: Requirements 1.1, 1.2, 2.1
     *
     * For any CONNECTION_ACK message, dispatching it should connect the panel
     * without sending START_TRACKING.
     */
    it('should not send START_TRACKING after CONNECTION_ACK', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          (timestamp) => {
            vi.clearAllMocks();

            const message: PortMessage = {
              type: 'CONNECTION_ACK',
              payload: null,
              timestamp,
            };

            service.dispatch(message);

            expect(state.connectionState()).toBe('connected');
            expect(mockSend).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Validates: Requirements 2.2
     *
     * After CONNECTION_ACK, PanelState.isTracking should remain false.
     */
    it('should keep isTracking false after CONNECTION_ACK', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          (timestamp) => {
            // Reset state
            state.isTracking.set(false);

            const message: PortMessage = {
              type: 'CONNECTION_ACK',
              payload: null,
              timestamp,
            };

            service.dispatch(message);

            expect(state.isTracking()).toBe(false);
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * Validates: Requirements 2.1, 2.2
     *
     * After TAB_NAVIGATED while tracking is off, data should reset and tracking
     * should stay off until the user clicks Start.
     */
    it('should not send START_TRACKING after TAB_NAVIGATED when tracking was off', () => {
      // Set up connected state
      state.connectionState.set('connected');
      state.isTracking.set(false);

      const message: PortMessage = {
        type: 'TAB_NAVIGATED',
        payload: null,
        timestamp: Date.now(),
      };

      service.dispatch(message);

      expect(state.connectionState()).toBe('connected');
      expect(state.isTracking()).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should resume START_TRACKING after TAB_NAVIGATED when tracking was active', () => {
      state.connectionState.set('connected');
      state.isTracking.set(true);

      const message: PortMessage = {
        type: 'TAB_NAVIGATED',
        payload: null,
        timestamp: Date.now(),
      };

      service.dispatch(message);

      expect(state.connectionState()).toBe('connected');
      expect(state.isTracking()).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'START_TRACKING' })
      );
    });

    it('should keep render data after ROUTE_CHANGED by default', () => {
      state.rawRenderEvents.set([
        {
          componentName: 'DashboardComponent',
          timestamp: 100,
          duration: 1,
          causes: [{ type: 'zone' }],
        },
      ]);

      service.dispatch({
        type: 'ROUTE_CHANGED',
        payload: { timestamp: 200 },
        timestamp: Date.now(),
      });

      expect(state.renderEvents()).toHaveLength(1);
    });

    it('should clear captured activity after ROUTE_CHANGED when enabled', () => {
      state.clearOnRouteChange.set(true);
      state.selectedComponent.set('DashboardComponent');
      state.selectedIssue.set({
        id: 'issue-1',
        type: 'render-hot',
        componentName: 'DashboardComponent',
        severity: 'WARNING',
        title: 'Hot component',
        description: 'Rendering frequently',
        timestamp: 100,
      });
      state.rawRenderEvents.set([
        {
          componentName: 'DashboardComponent',
          timestamp: 100,
          duration: 1,
          causes: [{ type: 'zone' }],
        },
      ]);
      state.rawTrackByIssues.set([
        {
          id: 'trackby-1',
          componentName: 'ListComponent',
          collectionProperty: 'items',
          collectionSize: 120,
          severity: 'WARNING',
          recommendation: 'Add trackBy',
        },
      ]);
      state.rawOnPushRecommendations.set([
        {
          component: 'CardComponent',
          score: 75,
          currentStrategy: 'Default',
          factors: [],
          recommendation: 'Consider OnPush',
        },
      ]);
      state.rawZonePollutionSources.set([
        {
          source: 'setInterval',
          type: 'macroTask',
          cdCyclesPerMinute: 120,
          severity: 'high',
          taskCount: 10,
          lastSeen: 200,
        },
      ]);

      service.dispatch({
        type: 'ROUTE_CHANGED',
        payload: { timestamp: 200 },
        timestamp: Date.now(),
      });

      expect(state.renderEvents()).toEqual([]);
      expect(state.trackByIssues()).toEqual([]);
      expect(state.onPushRecommendations()).toEqual([]);
      expect(state.zonePollutionSources()).toEqual([]);
      expect(state.selectedComponent()).toBeNull();
      expect(state.selectedIssue()).toBeNull();
    });

    /**
     * Validates: Requirements 2.1, 2.2
     *
     * Simulate reconnect: disconnect → new CONNECTION_ACK should not auto-start.
     */
    it('should not send START_TRACKING after reconnect', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
          (timestamp) => {
            vi.clearAllMocks();

            // Simulate disconnect
            state.connectionState.set('disconnected');
            state.isTracking.set(false);

            // Simulate reconnect with new CONNECTION_ACK
            const message: PortMessage = {
              type: 'CONNECTION_ACK',
              payload: null,
              timestamp,
            };

            service.dispatch(message);

            expect(state.connectionState()).toBe('connected');
            expect(state.isTracking()).toBe(false);
            expect(mockSend).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});

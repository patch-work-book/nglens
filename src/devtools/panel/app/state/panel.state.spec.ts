import { describe, expect, it } from 'vitest';
import { PanelState } from './panel.state';

describe('PanelState', () => {
  it('computes latestComparison deltas from the last two snapshots', () => {
    const state = new PanelState();

    state.snapshots.set([
      {
        id: 's1',
        label: 'Baseline',
        createdAt: 1,
        metrics: {
          issues: 2,
          components: 3,
          renders: 10,
          renderFrequency: 60,
          averageRenderDuration: 4,
          totalRenderDuration: 40,
          leaks: 1,
          recommendations: 2,
          hotspots: 1,
        },
      },
      {
        id: 's2',
        label: 'Current run',
        createdAt: 2,
        metrics: {
          issues: 5,
          components: 4,
          renders: 14,
          renderFrequency: 84,
          averageRenderDuration: 5,
          totalRenderDuration: 70,
          leaks: 2,
          recommendations: 4,
          hotspots: 3,
        },
      },
    ]);

    const comparison = state.latestComparison();

    expect(comparison).not.toBeNull();
    expect(comparison?.delta).toEqual({
      issues: 3,
      components: 1,
      renders: 4,
      renderFrequency: 24,
      averageRenderDuration: 1,
      totalRenderDuration: 30,
      leaks: 1,
      recommendations: 2,
      hotspots: 2,
    });
  });

  it('returns null latestComparison when fewer than two snapshots exist', () => {
    const state = new PanelState();

    state.snapshots.set([
      {
        id: 's1',
        label: 'Baseline',
        createdAt: 1,
        metrics: {
          issues: 0,
          components: 0,
          renders: 0,
          renderFrequency: 0,
          averageRenderDuration: 0,
          totalRenderDuration: 0,
          leaks: 0,
          recommendations: 0,
          hotspots: 0,
        },
      },
    ]);

    expect(state.latestComparison()).toBeNull();
  });

  it('uses min and max render timestamps when capturing snapshot render rate', () => {
    const state = new PanelState();

    state.rawRenderEvents.set([
      {
        componentName: 'OutOfOrderComponent',
        timestamp: 60_000,
        duration: 4,
        causes: [{ type: 'zone' }],
      },
      {
        componentName: 'OutOfOrderComponent',
        timestamp: 0,
        duration: 6,
        causes: [{ type: 'zone' }],
      },
    ]);

    state.captureSnapshot('Out of order');

    expect(state.snapshots()[0].metrics.renderFrequency).toBe(1);
    expect(state.snapshots()[0].metrics.averageRenderDuration).toBe(5);
  });

  it('aggregates allIssues from leak, trackBy, hot, hotspot, and zone pollution sources', () => {
    const state = new PanelState();

    state.rawLeakEvents.set([
      {
        id: 'leak-1',
        componentName: 'DashboardComponent',
        componentId: 'c1',
        leakType: 'subscription',
        severity: 'WARNING',
        source: 'interval$',
        createdAt: 1,
        detectedAt: 2,
        lifecycleState: 'destroyed',
      },
    ]);

    state.rawTrackByIssues.set([
      {
        id: 'tb-1',
        componentName: 'ListComponent',
        collectionProperty: 'items',
        collectionSize: 50,
        severity: 'WARNING',
        recommendation: 'Add trackBy',
      },
    ]);

    state.rawOnPushRecommendations.set([
      {
        component: 'CardComponent',
        score: 0.7,
        currentStrategy: 'Default',
        factors: [],
        recommendation: 'Switch to OnPush',
      },
    ]);

    state.rawRenderEvents.set([
      {
        componentName: 'TableComponent',
        timestamp: 1000,
        duration: 20,
        causes: [{ type: 'parent' }],
      },
      {
        componentName: 'TableComponent',
        timestamp: 1000,
        duration: 20,
        causes: [{ type: 'zone' }],
      },
    ]);

    state.rawZonePollutionSources.set([
      {
        source: 'setInterval',
        type: 'macroTask',
        library: 'legacy-lib',
        cdCyclesPerMinute: 180,
        severity: 'medium',
        taskCount: 12,
        lastSeen: 3000,
        fixSuggestion: 'Move work outside Angular zone',
      },
    ]);

    const types = state.allIssues().map((issue) => issue.type);

    expect(types).toContain('leak');
    expect(types).toContain('trackby');
    expect(types).toContain('render-hot');
    expect(types).toContain('hotspot');
    expect(types).toContain('zone-pollution');
    expect(types).not.toContain('onpush');
  });
});

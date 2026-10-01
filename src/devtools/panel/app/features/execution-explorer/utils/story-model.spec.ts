import { describe, it, expect } from 'vitest';
import { buildStoryModel, buildStoryPhases, buildImpactFlow, buildStoryStats, categoryForStep } from './story-model';
import type { ExecutionStep, RuntimeEvent } from '@nglens/types/execution-intelligence';
import type { ExecutionGraph, GraphNode, GraphEdge } from '@nglens/types/execution-graph';

// ── Minimal builders ────────────────────────────────────────────────────────

function step(partial: Partial<ExecutionStep> & { id: string; type: ExecutionStep['type']; startTime: number }): ExecutionStep {
  return {
    id: partial.id,
    type: partial.type,
    title: partial.title ?? partial.id,
    summary: partial.summary ?? '',
    eventIds: partial.eventIds ?? [`ev-${partial.id}`],
    startTime: partial.startTime,
    endTime: partial.endTime ?? partial.startTime,
    duration: partial.duration ?? 0,
    sequenceOrder: partial.sequenceOrder ?? partial.startTime,
    changes: { added: { count: 0, properties: [] }, removed: { count: 0, properties: [] }, modified: { count: 0, properties: [] }, summary: '' },
    impact: {
      components: { count: 0, names: [], renders: 0 }, signals: { count: 0, names: [] },
      stores: { count: 0, names: [] }, services: { count: 0, names: [] },
      rxjsChains: { count: 0, subscriptionCount: 0 }, totalRenderCount: 0,
      averageRenderDuration: 0, totalDuration: 0, renderEfficiencyIndex: 100,
      maxCascadingDepth: 0, interactionToFinalPaint: 0, parasiticRenderRatio: 0,
      directConsumers: [], transitiveConsumers: [],
    },
    rootCauseChain: { startingBoundary: 'user-interaction', chain: [], rootCause: { eventId: '', timestamp: 0, type: 'user-interaction', label: '' }, summary: '' },
  } as ExecutionStep;
}

function graphWith(edges: Array<{ target: string; edge: GraphEdge }>): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();
  const ensure = (id: string): GraphNode => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, event: { id, type: 'component-render', timestamp: 0, label: id } as RuntimeEvent,
        correlationId: 'c', outEdges: [], inEdges: [], depth: 0, isRoot: true, isLeaf: true, subtreeSize: 1, criticalPathDuration: 0,
      });
    }
    return nodes.get(id)!;
  };
  const allEdges: GraphEdge[] = [];
  for (const { target, edge } of edges) {
    ensure(edge.sourceId);
    ensure(target).inEdges.push(edge);
    allEdges.push(edge);
  }
  return { sessionId: 's', nodes, edges: allEdges, roots: [], leaves: [], totalNodes: nodes.size, totalEdges: allEdges.length, maxDepth: 0, buildTime: 0 };
}

function edge(sourceId: string, targetId: string, type: GraphEdge['type'], confidence: number): GraphEdge {
  return { id: `${sourceId}->${targetId}`, sourceId, targetId, type, confidence, latency: 0, reason: '' };
}

describe('categoryForStep', () => {
  it('maps step types to spine categories', () => {
    expect(categoryForStep(step({ id: 'a', type: 'user-interaction', startTime: 0 }))).toBe('user');
    expect(categoryForStep(step({ id: 'b', type: 'navigation', startTime: 0 }))).toBe('router');
    expect(categoryForStep(step({ id: 'c', type: 'data-fetch', startTime: 0 }))).toBe('api');
    expect(categoryForStep(step({ id: 'd', type: 'state-update', startTime: 0 }))).toBe('state');
    expect(categoryForStep(step({ id: 'e', type: 'computation', startTime: 0 }))).toBe('signal');
    expect(categoryForStep(step({ id: 'f', type: 'ui-update', startTime: 0 }))).toBe('component');
  });
});

describe('buildStoryModel — evidence-first spine', () => {
  it('returns an empty model for no steps', () => {
    const m = buildStoryModel([], undefined);
    expect(m.nodes).toEqual([]);
    expect(m.presentCategories).toEqual([]);
  });

  it('orders nodes chronologically by sequenceOrder then startTime', () => {
    const steps = [
      step({ id: 's3', type: 'ui-update', startTime: 30, sequenceOrder: 3 }),
      step({ id: 's1', type: 'user-interaction', startTime: 10, sequenceOrder: 1 }),
      step({ id: 's2', type: 'data-fetch', startTime: 20, sequenceOrder: 2 }),
    ];
    const m = buildStoryModel(steps, undefined);
    expect(m.nodes.map(n => n.id)).toEqual(['s1', 's2', 's3']);
  });

  it('only includes categories that actually have steps (no empty lanes)', () => {
    const steps = [
      step({ id: 's1', type: 'data-fetch', startTime: 10, sequenceOrder: 1 }),
      step({ id: 's2', type: 'ui-update', startTime: 20, sequenceOrder: 2 }),
    ];
    const m = buildStoryModel(steps, undefined);
    // No user/router/state/signal steps present → not listed.
    expect(m.presentCategories).toEqual(['api', 'component']);
  });

  it('first node has no upstream claim (it is the observed start)', () => {
    const steps = [
      step({ id: 's1', type: 'user-interaction', startTime: 10, sequenceOrder: 1 }),
      step({ id: 's2', type: 'data-fetch', startTime: 20, sequenceOrder: 2 }),
    ];
    const m = buildStoryModel(steps, undefined);
    expect(m.nodes[0].upstream).toBeNull();
  });

  it('NEGATIVE CAUSALITY: with no graph, every non-first edge is Unknown (never fabricated)', () => {
    const steps = [
      step({ id: 's1', type: 'data-fetch', startTime: 10, sequenceOrder: 1 }),
      step({ id: 's2', type: 'ui-update', startTime: 20, sequenceOrder: 2 }),
    ];
    const m = buildStoryModel(steps, undefined);
    expect(m.nodes[1].upstream?.level).toBe('unknown');
  });

  it('uses the strongest incoming graph edge for a node\u2019s upstream evidence', () => {
    const steps = [
      step({ id: 's1', type: 'data-fetch', startTime: 10, sequenceOrder: 1, eventIds: ['api-1'] }),
      step({ id: 's2', type: 'ui-update', startTime: 20, sequenceOrder: 2, eventIds: ['render-1'] }),
    ];
    // Two competing incoming edges to render-1: a timing (Inferred) and a
    // subscriber (Correlated). The stronger (Correlated) must win.
    const graph = graphWith([
      { target: 'render-1', edge: edge('api-1', 'render-1', 'correlated', 0.9) },
      { target: 'render-1', edge: edge('api-1', 'render-1', 'consumed', 0.6) },
    ]);
    const m = buildStoryModel(steps, graph);
    expect(m.nodes[1].upstream?.level).toBe('correlated');
  });

  it('labels a DOM render-cascade edge as Inferred from DOM (not Observed)', () => {
    const steps = [
      step({ id: 's1', type: 'ui-update', startTime: 10, sequenceOrder: 1, eventIds: ['parent'] }),
      step({ id: 's2', type: 'ui-update', startTime: 12, sequenceOrder: 2, eventIds: ['child'] }),
    ];
    const graph = graphWith([{ target: 'child', edge: edge('parent', 'child', 'cascaded', 0.9) }]);
    const m = buildStoryModel(steps, graph);
    expect(m.nodes[1].upstream?.level).toBe('inferred');
    expect(m.nodes[1].upstream?.label.toLowerCase()).toContain('dom');
  });

  it('API timing is measured (per row) and component timing is NOT shown per row', () => {
    const eventMap = new Map<string, RuntimeEvent>([
      ['api-1', { id: 'api-1', type: 'http-response', timestamp: 0, duration: 84, label: 'POST /x → 200' } as RuntimeEvent],
      ['render-1', { id: 'render-1', type: 'component-render', timestamp: 0, duration: 50, label: 'X rendered' } as RuntimeEvent],
    ]);
    const steps = [
      step({ id: 's1', type: 'data-fetch', startTime: 10, sequenceOrder: 1, eventIds: ['api-1'] }),
      step({ id: 's2', type: 'ui-update', startTime: 20, sequenceOrder: 2, eventIds: ['render-1'] }),
    ];
    const m = buildStoryModel(steps, undefined, eventMap);
    const api = m.nodes.find(n => n.category === 'api')!;
    const comp = m.nodes.find(n => n.category === 'component')!;
    // API: measured, shown per row with status.
    expect(api.estimated).toBe(false);
    expect(api.measuredMs).toBe(84);
    expect(api.metric).toContain('84ms');
    expect(api.metric).toContain('200');
    // Component: estimate kept as a raw number for aggregation, but NO per-row
    // metric string (no fake "~1ms" under every component).
    expect(comp.estimated).toBe(true);
    expect(comp.estimatedMs).toBe(50);
    expect(comp.metric).toBeNull();
  });
});

describe('buildStoryPhases — chronological runtime phase trace', () => {
  it('returns no phases for an empty model', () => {
    const phases = buildStoryPhases({ nodes: [], presentCategories: [] });
    expect(phases.phases).toEqual([]);
  });

  it('groups contiguous same-category nodes into one phase (not a flat list)', () => {
    const steps = [
      step({ id: 'u', type: 'user-interaction', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'a', type: 'data-fetch', startTime: 10, sequenceOrder: 2 }),
      step({ id: 'c1', type: 'ui-update', startTime: 20, sequenceOrder: 3 }),
      step({ id: 'c2', type: 'ui-update', startTime: 21, sequenceOrder: 4 }),
      step({ id: 'c3', type: 'ui-update', startTime: 22, sequenceOrder: 5 }),
    ];
    const model = buildStoryModel(steps, undefined);
    const { phases } = buildStoryPhases(model);
    // 3 phases: Trigger, Network, Component activity (the 3 renders collapse).
    expect(phases.map(p => p.category)).toEqual(['user', 'api', 'component']);
    const comp = phases.find(p => p.category === 'component')!;
    expect(comp.nodes.length).toBe(3);
  });

  it('splits into separate phases when the category changes and returns (network → component → network)', () => {
    const steps = [
      step({ id: 'a1', type: 'data-fetch', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'c1', type: 'ui-update', startTime: 10, sequenceOrder: 2 }),
      step({ id: 'a2', type: 'data-fetch', startTime: 20, sequenceOrder: 3 }),
    ];
    const { phases } = buildStoryPhases(buildStoryModel(steps, undefined));
    expect(phases.map(p => p.category)).toEqual(['api', 'component', 'api']);
  });

  it('the 55-render case collapses to a per-component rollup (no 55 identical rows)', () => {
    // 3 components rendering repeatedly, all in one contiguous component phase.
    const steps: ExecutionStep[] = [];
    let t = 0;
    const emit = (name: string, times: number) => {
      for (let i = 0; i < times; i++) {
        steps.push(step({ id: `${name}-${i}`, type: 'ui-update', startTime: t, sequenceOrder: ++t, title: `${name} rendered`, eventIds: [`${name}-${i}`] }));
      }
    };
    emit('LayoutComponent', 1);
    emit('FintuaDropdownComponent', 5);
    emit('GraphCardComponent', 3);
    const { phases } = buildStoryPhases(buildStoryModel(steps, undefined));
    expect(phases.length).toBe(1);
    const comp = phases[0];
    expect(comp.total).toBe(9);           // 1 + 5 + 3 renders
    expect(comp.uniqueCount).toBe(3);     // 3 unique components
    // Rollup sorted by count desc, with per-component counts.
    expect(comp.rollup.map(r => `${r.name}×${r.count}`)).toEqual([
      'FintuaDropdownComponent×5',
      'GraphCardComponent×3',
      'LayoutComponent×1',
    ]);
    // But the underlying individual nodes are preserved for Expanded mode.
    expect(comp.nodes.length).toBe(9);
  });

  it('only lists phases that actually occurred (no empty categories)', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2 }),
    ];
    const { presentCategories } = buildStoryPhases(buildStoryModel(steps, undefined));
    expect(presentCategories).toEqual(['api', 'component']);
  });

  it('shows transition evidence ONCE at the phase boundary (not per row)', () => {
    const steps = [
      step({ id: 'p', type: 'ui-update', startTime: 0, sequenceOrder: 1, eventIds: ['parent'] }),
      step({ id: 'c', type: 'ui-update', startTime: 5, sequenceOrder: 2, eventIds: ['child'] }),
    ];
    // Same category ⇒ one phase; the cascade edge is internal, so it is NOT
    // surfaced as a repeated per-row badge. First phase has null upstream.
    const graph = graphWith([{ target: 'child', edge: edge('parent', 'child', 'cascaded', 0.9) }]);
    const { phases } = buildStoryPhases(buildStoryModel(steps, graph));
    expect(phases.length).toBe(1);
    expect(phases[0].upstream).toBeNull(); // first phase = observed start, no claim
  });

  it('NEGATIVE CAUSALITY: a phase transition with no cross-phase edge is Unknown', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['api'] }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2, eventIds: ['render'] }),
    ];
    // No edge into 'render' ⇒ the Network→Component transition is Unknown.
    const { phases } = buildStoryPhases(buildStoryModel(steps, undefined));
    const comp = phases.find(p => p.category === 'component')!;
    expect(comp.upstream?.level).toBe('unknown');
  });

  it('labels a real cross-phase DOM/timing transition as Inferred, never Observed', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['api'] }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2, eventIds: ['render'] }),
    ];
    const graph = graphWith([{ target: 'render', edge: edge('api', 'render', 'correlated', 0.9) }]);
    const { phases } = buildStoryPhases(buildStoryModel(steps, graph));
    const comp = phases.find(p => p.category === 'component')!;
    expect(comp.upstream?.level).toBe('inferred');
  });

  it('aggregates component timing at the phase level and omits sub-meaningful ms', () => {
    const eventMap = new Map<string, RuntimeEvent>([
      ['r1', { id: 'r1', type: 'component-render', timestamp: 0, duration: 30, label: 'A rendered' } as RuntimeEvent],
      ['r2', { id: 'r2', type: 'component-render', timestamp: 0, duration: 25, label: 'B rendered' } as RuntimeEvent],
    ]);
    const steps = [
      step({ id: 's1', type: 'ui-update', startTime: 0, sequenceOrder: 1, title: 'A rendered', eventIds: ['r1'] }),
      step({ id: 's2', type: 'ui-update', startTime: 1, sequenceOrder: 2, title: 'B rendered', eventIds: ['r2'] }),
    ];
    const { phases } = buildStoryPhases(buildStoryModel(steps, undefined, eventMap));
    const comp = phases[0];
    expect(comp.aggregateEstimated).toBe(true);
    expect(comp.aggregateMs).toBe(55); // 30 + 25, aggregated (not per-row)

    // Sub-meaningful total → no ms shown (avoids fake "~1ms").
    const tiny = new Map<string, RuntimeEvent>([
      ['t1', { id: 't1', type: 'component-render', timestamp: 0, duration: 0.4, label: 'T rendered' } as RuntimeEvent],
    ]);
    const tinySteps = [step({ id: 't', type: 'ui-update', startTime: 0, sequenceOrder: 1, title: 'T rendered', eventIds: ['t1'] })];
    const tinyPhase = buildStoryPhases(buildStoryModel(tinySteps, undefined, tiny)).phases[0];
    expect(tinyPhase.aggregateMs).toBeNull();
  });

  it('network phase aggregates measured request time', () => {
    const eventMap = new Map<string, RuntimeEvent>([
      ['a1', { id: 'a1', type: 'http-response', timestamp: 0, duration: 84, label: 'POST /x → 200' } as RuntimeEvent],
      ['a2', { id: 'a2', type: 'http-response', timestamp: 0, duration: 100, label: 'GET /y → 200' } as RuntimeEvent],
    ]);
    const steps = [
      step({ id: 's1', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['a1'] }),
      step({ id: 's2', type: 'data-fetch', startTime: 1, sequenceOrder: 2, eventIds: ['a2'] }),
    ];
    const net = buildStoryPhases(buildStoryModel(steps, undefined, eventMap)).phases[0];
    expect(net.aggregateEstimated).toBe(false);
    expect(net.aggregateMs).toBe(184);
  });
});

describe('buildImpactFlow — honest category presence', () => {
  it('includes present categories and marks State/Signals as NOT observed when absent', () => {
    const steps = [
      step({ id: 'u', type: 'user-interaction', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'a', type: 'data-fetch', startTime: 10, sequenceOrder: 2 }),
      step({ id: 'c', type: 'ui-update', startTime: 20, sequenceOrder: 3 }),
    ];
    const flow = buildImpactFlow(buildStoryPhases(buildStoryModel(steps, undefined)));
    const byCat = Object.fromEntries(flow.chips.map(c => [c.category, c]));
    // Observed lanes present.
    expect(byCat['user'].observed).toBe(true);
    expect(byCat['api'].observed).toBe(true);
    expect(byCat['component'].observed).toBe(true);
    // Reactive lanes always shown, but honestly marked not-observed (no fabricated chain).
    expect(byCat['state'].observed).toBe(false);
    expect(byCat['state'].count).toBe(0);
    expect(byCat['signal'].observed).toBe(false);
  });

  it('aggregates component renders across the flow chip', () => {
    const steps = [
      step({ id: 'c1', type: 'ui-update', startTime: 0, sequenceOrder: 1, title: 'A rendered', eventIds: ['c1'] }),
      step({ id: 'c2', type: 'ui-update', startTime: 1, sequenceOrder: 2, title: 'A rendered', eventIds: ['c2'] }),
      step({ id: 'c3', type: 'ui-update', startTime: 2, sequenceOrder: 3, title: 'B rendered', eventIds: ['c3'] }),
    ];
    const flow = buildImpactFlow(buildStoryPhases(buildStoryModel(steps, undefined)));
    const comp = flow.chips.find(c => c.category === 'component')!;
    expect(comp.count).toBe(3);
    expect(comp.uniqueCount).toBe(2);
  });
});

describe('buildStoryStats — counts + span', () => {
  it('counts renders/components/apis and computes wall-clock span', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 1000, sequenceOrder: 1 }),
      step({ id: 'c1', type: 'ui-update', startTime: 1100, sequenceOrder: 2, title: 'A rendered' }),
      step({ id: 'c2', type: 'ui-update', startTime: 1200, sequenceOrder: 3, title: 'B rendered' }),
    ];
    const stats = buildStoryStats(buildStoryPhases(buildStoryModel(steps, undefined)), { duplicates: 6, slow: 1 });
    expect(stats.apiCalls).toBe(1);
    expect(stats.renders).toBe(2);
    expect(stats.components).toBe(2);
    expect(stats.duplicates).toBe(6);
    expect(stats.slow).toBe(1);
    expect(stats.spanMs).toBe(200); // 1200 - 1000
  });
});

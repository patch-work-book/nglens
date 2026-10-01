import { describe, it, expect } from 'vitest';
import { buildExecutionImpact } from './execution-impact-model';
import { buildStoryModel, buildStoryPhases, buildStoryStats } from './story-model';
import type { ExecutionStep, RuntimeEvent } from '@nglens/types/execution-intelligence';
import type { ExecutionGraph, GraphNode, GraphEdge } from '@nglens/types/execution-graph';

function step(p: Partial<ExecutionStep> & { id: string; type: ExecutionStep['type']; startTime: number }): ExecutionStep {
  return {
    id: p.id, type: p.type, title: p.title ?? p.id, summary: p.summary ?? '',
    eventIds: p.eventIds ?? [`ev-${p.id}`], startTime: p.startTime, endTime: p.endTime ?? p.startTime,
    duration: p.duration ?? 0, sequenceOrder: p.sequenceOrder ?? p.startTime,
    changes: { added: { count: 0, properties: [] }, removed: { count: 0, properties: [] }, modified: { count: 0, properties: [] }, summary: '' },
    impact: { components: { count: 0, names: [], renders: 0 }, signals: { count: 0, names: [] }, stores: { count: 0, names: [] }, services: { count: 0, names: [] }, rxjsChains: { count: 0, subscriptionCount: 0 }, totalRenderCount: 0, averageRenderDuration: 0, totalDuration: 0, renderEfficiencyIndex: 100, maxCascadingDepth: 0, interactionToFinalPaint: 0, parasiticRenderRatio: 0, directConsumers: [], transitiveConsumers: [] },
    rootCauseChain: { startingBoundary: 'user-interaction', chain: [], rootCause: { eventId: '', timestamp: 0, type: 'user-interaction', label: '' }, summary: '' },
  } as ExecutionStep;
}

function graphWith(edges: Array<{ src: string; target: string; type: GraphEdge['type']; conf: number }>): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();
  const ensure = (id: string): GraphNode => {
    if (!nodes.has(id)) nodes.set(id, { id, event: { id, type: 'component-render', timestamp: 0, label: id } as RuntimeEvent, correlationId: 'c', outEdges: [], inEdges: [], depth: 0, isRoot: true, isLeaf: true, subtreeSize: 1, criticalPathDuration: 0 });
    return nodes.get(id)!;
  };
  const all: GraphEdge[] = [];
  for (const e of edges) {
    ensure(e.target);
    const edge: GraphEdge = { id: `${e.src}->${e.target}`, sourceId: e.src, targetId: e.target, type: e.type, confidence: e.conf, latency: 0, reason: '' };
    ensure(e.src).outEdges.push(edge);
    all.push(edge);
  }
  return { sessionId: 's', nodes, edges: all, roots: [], leaves: [], totalNodes: nodes.size, totalEdges: all.length, maxDepth: 0, buildTime: 0 };
}

function impactFrom(steps: ExecutionStep[], graph?: ExecutionGraph, extras?: { duplicates?: number; slow?: number }, eventMap?: Map<string, RuntimeEvent>) {
  const phases = buildStoryPhases(buildStoryModel(steps, graph, eventMap));
  const stats = buildStoryStats(phases, extras);
  return buildExecutionImpact(phases, stats, graph);
}

describe('buildExecutionImpact — evidence-labelled footprint', () => {
  it('produces the footprint counts + spine (trigger → api → render)', () => {
    const steps = [
      step({ id: 'u', type: 'user-interaction', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'a', type: 'data-fetch', startTime: 100, sequenceOrder: 2 }),
      step({ id: 'c', type: 'ui-update', startTime: 200, sequenceOrder: 3, title: 'X rendered' }),
    ];
    const imp = impactFrom(steps);
    expect(imp.footprint.apis).toBe(1);
    expect(imp.footprint.renders).toBe(1);
    expect(imp.spine.map(n => n.kind)).toEqual(['trigger', 'api', 'render']);
  });

  it('omits branches when there is no duplicate/slow data (no fabricated branch)', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1 }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2, title: 'X rendered' }),
    ];
    const imp = impactFrom(steps, undefined, { duplicates: 0, slow: 0 });
    const api = imp.spine.find(n => n.kind === 'api')!;
    expect(api.branches).toEqual([]);
  });

  it('adds a Duplicate branch only when duplicates were detected', () => {
    const steps = [step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1 })];
    const imp = impactFrom(steps, undefined, { duplicates: 6 });
    const api = imp.spine.find(n => n.kind === 'api')!;
    expect(api.branches.some(b => b.kind === 'duplicate')).toBe(true);
    expect(api.branches.find(b => b.kind === 'duplicate')!.detail).toContain('6');
  });

  it('adds a Slow branch only when a >300ms API exists', () => {
    const eventMap = new Map<string, RuntimeEvent>([
      ['a', { id: 'a', type: 'http-response', timestamp: 0, duration: 1156, label: 'POST /x → 200' } as RuntimeEvent],
    ]);
    const steps = [step({ id: 's1', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['a'] })];
    const imp = impactFrom(steps, undefined, {}, eventMap);
    const api = imp.spine.find(n => n.kind === 'api')!;
    expect(api.branches.some(b => b.kind === 'slow')).toBe(true);
    expect(api.branches.find(b => b.kind === 'slow')!.detail).toContain('1156ms');
  });

  it('CRITICAL: trigger→api / api→render links are Correlated/Inferred, NEVER Observed for timing edges', () => {
    const steps = [
      step({ id: 'u', type: 'user-interaction', startTime: 0, sequenceOrder: 1, eventIds: ['u'] }),
      step({ id: 'a', type: 'data-fetch', startTime: 10, sequenceOrder: 2, eventIds: ['a'] }),
      step({ id: 'c', type: 'ui-update', startTime: 20, sequenceOrder: 3, eventIds: ['c'], title: 'X rendered' }),
    ];
    // timing edges u→a and a→c
    const graph = graphWith([
      { src: 'u', target: 'a', type: 'correlated', conf: 0.9 },
      { src: 'a', target: 'c', type: 'correlated', conf: 0.9 },
    ]);
    const imp = impactFrom(steps, graph);
    const api = imp.spine.find(n => n.kind === 'api')!;
    const render = imp.spine.find(n => n.kind === 'render')!;
    expect(api.upstream?.level).not.toBe('observed');
    expect(render.upstream?.level).not.toBe('observed');
    expect(render.upstream?.level).toBe('inferred');
  });

  it('link is Unknown when the graph proves no cross-category edge (never a bare arrow)', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['a'] }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2, eventIds: ['c'], title: 'X rendered' }),
    ];
    const imp = impactFrom(steps, undefined); // no graph
    const render = imp.spine.find(n => n.kind === 'render')!;
    expect(render.upstream?.level).toBe('unknown');
  });

  it('a genuine captured "triggered" edge is allowed to read Observed (correctness of the mapping)', () => {
    const steps = [
      step({ id: 'a', type: 'data-fetch', startTime: 0, sequenceOrder: 1, eventIds: ['a'] }),
      step({ id: 'c', type: 'ui-update', startTime: 10, sequenceOrder: 2, eventIds: ['c'], title: 'X rendered' }),
    ];
    const graph = graphWith([{ src: 'a', target: 'c', type: 'triggered', conf: 1 }]);
    const imp = impactFrom(steps, graph);
    const render = imp.spine.find(n => n.kind === 'render')!;
    expect(render.upstream?.level).toBe('observed');
  });
});

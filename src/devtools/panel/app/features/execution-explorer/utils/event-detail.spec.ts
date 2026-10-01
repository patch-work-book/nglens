import { describe, it, expect } from 'vitest';
import { buildEventDetail } from './event-detail';
import type { StoryNode } from './story-model';
import type { RuntimeEvent } from '@nglens/types/execution-intelligence';
import type { ExecutionGraph, GraphNode, GraphEdge } from '@nglens/types/execution-graph';

function node(partial: Partial<StoryNode> & { id: string; category: StoryNode['category'] }): StoryNode {
  return {
    id: partial.id,
    eventId: partial.eventId ?? partial.id,
    category: partial.category,
    title: partial.title ?? partial.id,
    metric: partial.metric ?? null,
    estimated: partial.estimated ?? false,
    measuredMs: partial.measuredMs ?? null,
    estimatedMs: partial.estimatedMs ?? null,
    status: partial.status ?? null,
    upstream: partial.upstream ?? null,
    count: partial.count ?? null,
    timestamp: partial.timestamp ?? 0,
    gapToNextMs: partial.gapToNextMs ?? null,
  };
}

function graphWithOut(sourceId: string, edges: Array<{ target: string; type: GraphEdge['type']; conf: number }>, events: Record<string, RuntimeEvent>): ExecutionGraph {
  const nodes = new Map<string, GraphNode>();
  const ensure = (id: string): GraphNode => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id, event: events[id] ?? ({ id, type: 'component-render', timestamp: 0, label: id } as RuntimeEvent),
        correlationId: 'c', outEdges: [], inEdges: [], depth: 0, isRoot: true, isLeaf: true, subtreeSize: 1, criticalPathDuration: 0,
      });
    }
    return nodes.get(id)!;
  };
  const all: GraphEdge[] = [];
  const src = ensure(sourceId);
  for (const e of edges) {
    ensure(e.target);
    const edge: GraphEdge = { id: `${sourceId}->${e.target}`, sourceId, targetId: e.target, type: e.type, confidence: e.conf, latency: 0, reason: '' };
    src.outEdges.push(edge);
    all.push(edge);
  }
  return { sessionId: 's', nodes, edges: all, roots: [], leaves: [], totalNodes: nodes.size, totalEdges: all.length, maxDepth: 0, buildTime: 0 };
}

describe('buildEventDetail — evidence-correct inspector', () => {
  it('API event: shows measured duration/status/started/completed with Observed timing', () => {
    const n = node({ id: 'api', category: 'api', title: 'POST /x', status: '200', measuredMs: 1156, timestamp: 2000 });
    const event = { id: 'api', type: 'http-response', timestamp: 2000, duration: 1156, label: 'POST /x → 200' } as RuntimeEvent;
    const d = buildEventDetail(n, event, undefined);
    expect(d.rows.find(r => r.label === 'Status')?.value).toBe('200');
    expect(d.rows.find(r => r.label === 'Duration')?.value).toBe('1156ms');
    expect(d.rows.find(r => r.label === 'Duration')?.evidence).toBe('observed');
    // Started = completed - duration.
    expect(d.rows.find(r => r.label === 'Started')).toBeTruthy();
    expect(d.rows.find(r => r.label === 'Completed')).toBeTruthy();
  });

  it('Initiator is "Unknown (instrumented)" when not captured', () => {
    const n = node({ id: 'api', category: 'api', title: 'GET /y', measuredMs: 10, timestamp: 100 });
    const d = buildEventDetail(n, { id: 'api', type: 'http-response', timestamp: 100, duration: 10, label: 'GET /y' } as RuntimeEvent, undefined);
    expect(d.rows.find(r => r.label === 'Initiator')?.value).toBe('Unknown (instrumented)');
  });

  it('CRITICAL: an API→component relationship is Correlated/Inferred, never "Followed by (Observed)"', () => {
    const n = node({ id: 'api', category: 'api', title: 'POST /x', measuredMs: 100, timestamp: 0 });
    const events: Record<string, RuntimeEvent> = {
      api: { id: 'api', type: 'http-response', timestamp: 0, duration: 100, label: 'POST /x' } as RuntimeEvent,
      render: { id: 'render', type: 'component-render', timestamp: 187, label: 'VatPotentialComponent rendered' } as RuntimeEvent,
    };
    // The graph joins API→render with a timing edge (correlated => Inferred).
    const graph = graphWithOut('api', [{ target: 'render', type: 'correlated', conf: 0.9 }], events);
    const d = buildEventDetail(n, events['api'], graph, new Map(Object.entries(events)));
    // No "Observed" downstream group — timing edges are Inferred.
    expect(d.related.some(g => g.level === 'observed')).toBe(false);
    expect(d.related.some(g => g.heading.includes('Observed'))).toBe(false);
    const inferred = d.related.find(g => g.level === 'inferred');
    expect(inferred).toBeTruthy();
    expect(inferred!.items.some(i => i.label.includes('VatPotential'))).toBe(true);
  });

  it('a real captured "triggered" edge IS allowed to show Followed by (Observed)', () => {
    const n = node({ id: 'a', category: 'api', title: 'A', measuredMs: 5, timestamp: 0 });
    const events: Record<string, RuntimeEvent> = {
      a: { id: 'a', type: 'http-response', timestamp: 0, duration: 5, label: 'A' } as RuntimeEvent,
      b: { id: 'b', type: 'store-dispatch', timestamp: 1, label: 'Store: [X] Y' } as RuntimeEvent,
    };
    const graph = graphWithOut('a', [{ target: 'b', type: 'triggered', conf: 1 }], events);
    const d = buildEventDetail(n, events['a'], graph, new Map(Object.entries(events)));
    const observed = d.related.find(g => g.level === 'observed');
    expect(observed).toBeTruthy();
    expect(observed!.heading).toContain('Observed');
  });

  it('NEGATIVE: no out-edges → no related section (never fabricated)', () => {
    const n = node({ id: 'api', category: 'api', title: 'GET /z', measuredMs: 10, timestamp: 0 });
    const d = buildEventDetail(n, { id: 'api', type: 'http-response', timestamp: 0, duration: 10, label: 'GET /z' } as RuntimeEvent, undefined);
    expect(d.related).toEqual([]);
  });

  it('component node: enables Inspect-in-Components and shows render count', () => {
    const n = node({ id: 'c', category: 'component', title: 'FooComponent', count: 5, estimatedMs: 50, timestamp: 0 });
    const d = buildEventDetail(n, { id: 'c', type: 'component-render', timestamp: 0, duration: 50, label: 'FooComponent rendered' } as RuntimeEvent, undefined);
    expect(d.isComponent).toBe(true);
    expect(d.rows.find(r => r.label === 'Renders')?.value).toBe('5');
  });
});

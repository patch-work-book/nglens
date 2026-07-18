/**
 * Execution Graph Engine
 * 
 * The central engine of the Execution Intelligence Platform.
 * Builds a directed acyclic graph (DAG) from RuntimeEvents,
 * connecting them via causality edges.
 * 
 * Architecture position:
 * Event Normalizer → [THIS] → Session Builder → Story Builder
 * 
 * Responsibilities:
 * 1. Accept normalized RuntimeEvents
 * 2. Create GraphNodes from events
 * 3. Build GraphEdges using:
 *    - Explicit: causedByEventId (direct parent link)
 *    - Subscriber: event.subscribers → matching downstream renders
 *    - Timing: events within correlation window that share component/store
 *    - Cascade: parent render → child render (same frame, depth ordering)
 * 4. Expose query APIs for downstream consumers (Session Builder, Story Builder, UI)
 * 
 * Rules:
 * - No UI reads this directly (UI reads Stories/Reports built FROM this graph)
 * - Graph is rebuilt per session (not global)
 * - Edges have confidence scores (explicit=1.0, timing-inferred=0.6)
 */

import { Injectable, signal, computed } from '@angular/core';
import type { RuntimeEvent } from '@nglens/types/execution-intelligence';
import type {
  GraphNode,
  GraphEdge,
  EdgeType,
  ExecutionGraph,
  CriticalPath,
  BlastRadius,
  AncestryChain,
} from '@nglens/types/execution-graph';

/** Max time delta (ms) to consider two events causally related by timing */
const TIMING_WINDOW_MS = 150;

/** Max time delta for render cascades (parent → child in same CD cycle) */
const CASCADE_WINDOW_MS = 50;

@Injectable({ providedIn: 'root' })
export class ExecutionGraphEngineService {
  // ─── State ───
  private graphs = new Map<string, ExecutionGraph>();
  private edgeCounter = 0;

  // ─── Public signal for downstream consumers ───
  private readonly graphsSignal = signal<Map<string, ExecutionGraph>>(new Map());
  readonly currentGraphs = this.graphsSignal.asReadonly();

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API: Graph Building
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Build an execution graph from a batch of normalized events belonging to one session.
   */
  buildGraph(sessionId: string, events: RuntimeEvent[]): ExecutionGraph {
    const startTime = performance.now();

    // Step 1: Create nodes from events
    const nodes = new Map<string, GraphNode>();
    for (const event of events) {
      nodes.set(event.id, this.createNode(event));
    }

    // Step 2: Build edges using multiple strategies
    const edges: GraphEdge[] = [];

    // Strategy A: Explicit causedByEventId links (highest confidence)
    edges.push(...this.buildExplicitEdges(events, nodes));

    // Strategy B: Subscriber-based edges (signal/store → render)
    edges.push(...this.buildSubscriberEdges(events, nodes));

    // Strategy C: Timing + type pattern edges (API → Store → Signal → Render)
    edges.push(...this.buildTimingEdges(events, nodes));

    // Strategy D: Render cascade edges (parent → child in same CD cycle)
    edges.push(...this.buildCascadeEdges(events, nodes));

    // Step 3: Wire edges into nodes
    for (const edge of edges) {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (source && target) {
        source.outEdges.push(edge);
        target.inEdges.push(edge);
      }
    }

    // Step 4: Compute graph metadata
    const roots: string[] = [];
    const leaves: string[] = [];
    let maxDepth = 0;

    for (const node of nodes.values()) {
      node.isRoot = node.inEdges.length === 0;
      node.isLeaf = node.outEdges.length === 0;
      if (node.isRoot) roots.push(node.id);
      if (node.isLeaf) leaves.push(node.id);
    }

    // Step 5: Compute depths via BFS from roots
    this.computeDepths(nodes, roots);
    for (const node of nodes.values()) {
      maxDepth = Math.max(maxDepth, node.depth);
    }

    // Step 6: Compute subtree sizes and critical path durations
    this.computeSubtreeMetrics(nodes, leaves);

    const graph: ExecutionGraph = {
      sessionId,
      nodes,
      edges,
      roots,
      leaves,
      totalNodes: nodes.size,
      totalEdges: edges.length,
      maxDepth,
      buildTime: performance.now() - startTime,
    };

    this.graphs.set(sessionId, graph);
    this.graphsSignal.set(new Map(this.graphs));

    return graph;
  }

  /**
   * Clear all graphs.
   */
  clear(): void {
    this.graphs.clear();
    this.graphsSignal.set(new Map());
  }

  /**
   * Get a graph by session ID.
   */
  getGraph(sessionId: string): ExecutionGraph | undefined {
    return this.graphs.get(sessionId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PUBLIC API: Graph Queries
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get all ancestors of a node (trace back to root cause).
   */
  getAncestors(graph: ExecutionGraph, nodeId: string): AncestryChain {
    const chain: string[] = [];
    const visited = new Set<string>();

    let current = graph.nodes.get(nodeId);
    while (current) {
      if (visited.has(current.id)) break; // prevent cycles
      visited.add(current.id);
      chain.unshift(current.id);

      // Follow highest-confidence incoming edge
      const bestInEdge = current.inEdges
        .sort((a, b) => b.confidence - a.confidence)[0];

      if (!bestInEdge) break;
      current = graph.nodes.get(bestInEdge.sourceId);
    }

    const rootNode = graph.nodes.get(chain[0]);
    return {
      targetId: nodeId,
      ancestorIds: chain,
      rootCauseId: chain[0] || nodeId,
      rootCauseLabel: rootNode?.event.label || 'Unknown',
      explanation: this.buildAncestryExplanation(graph, chain),
    };
  }

  /**
   * Get all descendants of a node (what it triggered downstream).
   */
  getDescendants(graph: ExecutionGraph, nodeId: string): string[] {
    const descendants: string[] = [];
    const visited = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = graph.nodes.get(currentId);
      if (!node) continue;

      for (const edge of node.outEdges) {
        if (!visited.has(edge.targetId)) {
          descendants.push(edge.targetId);
          queue.push(edge.targetId);
        }
      }
    }

    return descendants;
  }

  /**
   * Get the critical path (longest duration chain from root to leaf).
   */
  getCriticalPath(graph: ExecutionGraph): CriticalPath {
    // Find root with longest critical path duration
    let bestRoot: GraphNode | null = null;
    let bestDuration = 0;

    for (const rootId of graph.roots) {
      const node = graph.nodes.get(rootId);
      if (node && node.criticalPathDuration > bestDuration) {
        bestDuration = node.criticalPathDuration;
        bestRoot = node;
      }
    }

    if (!bestRoot) {
      return {
        nodeIds: [],
        totalDuration: 0,
        bottleneckId: '',
        bottleneckDuration: 0,
        description: 'No critical path found',
      };
    }

    // Trace the critical path from root to leaf
    const path: string[] = [];
    let bottleneckId = bestRoot.id;
    let bottleneckDuration = bestRoot.event.duration || 0;
    let current: GraphNode | undefined = bestRoot;

    while (current) {
      path.push(current.id);

      const eventDuration = current.event.duration || 0;
      if (eventDuration > bottleneckDuration) {
        bottleneckDuration = eventDuration;
        bottleneckId = current.id;
      }

      // Follow the child with the longest critical path
      let nextNode: GraphNode | undefined;
      let nextDuration = -1;

      for (const edge of current.outEdges) {
        const child = graph.nodes.get(edge.targetId);
        if (child && child.criticalPathDuration > nextDuration) {
          nextDuration = child.criticalPathDuration;
          nextNode = child;
        }
      }

      current = nextNode;
    }

    const bottleneckNode = graph.nodes.get(bottleneckId);
    return {
      nodeIds: path,
      totalDuration: bestDuration,
      bottleneckId,
      bottleneckDuration,
      description: `Critical path: ${path.length} steps, bottleneck at ${bottleneckNode?.event.label || 'unknown'} (${bottleneckDuration}ms)`,
    };
  }

  /**
   * Get the blast radius of a node (how many things it affects).
   */
  getBlastRadius(graph: ExecutionGraph, nodeId: string): BlastRadius {
    const descendants = this.getDescendants(graph, nodeId);
    const affectedComponents = new Set<string>();
    let renders = 0;
    let storeUpdates = 0;
    let signalWrites = 0;
    let computedEvals = 0;
    let maxDepth = 0;

    for (const descId of descendants) {
      const node = graph.nodes.get(descId);
      if (!node) continue;

      const relativeDepth = node.depth - (graph.nodes.get(nodeId)?.depth || 0);
      maxDepth = Math.max(maxDepth, relativeDepth);

      switch (node.event.type) {
        case 'component-render':
          renders++;
          if (node.event.sourceComponent) affectedComponents.add(node.event.sourceComponent);
          break;
        case 'store-dispatch':
          storeUpdates++;
          break;
        case 'signal-write':
          signalWrites++;
          break;
        case 'computed-evaluation':
          computedEvals++;
          break;
      }
    }

    return {
      sourceId: nodeId,
      affectedNodeIds: descendants,
      affectedByType: { renders, storeUpdates, signalWrites, computedEvals },
      affectedComponents: [...affectedComponents],
      maxDepth,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Edge Building Strategies
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Strategy A: Explicit causedByEventId links.
   * Highest confidence (1.0) — the normalizer already identified the parent.
   */
  private buildExplicitEdges(events: RuntimeEvent[], nodes: Map<string, GraphNode>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const event of events) {
      if (event.causedByEventId && nodes.has(event.causedByEventId)) {
        edges.push(this.createEdge(
          event.causedByEventId,
          event.id,
          'triggered',
          1.0,
          'Explicit causedByEventId link',
          events,
        ));
      }
    }

    return edges;
  }

  /**
   * Strategy B: Subscriber-based edges.
   * If event A has subscribers [ComponentX, ComponentY], and later a render event
   * fires for ComponentX, create an edge A → render(ComponentX).
   */
  private buildSubscriberEdges(events: RuntimeEvent[], nodes: Map<string, GraphNode>): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const connectedPairs = new Set<string>();

    // Index: source events that have subscribers
    const eventsWithSubscribers = events.filter(e =>
      e.subscribers && e.subscribers.length > 0
    );

    // Index: render events by component name
    const rendersByComponent = new Map<string, RuntimeEvent[]>();
    for (const event of events) {
      if (event.type === 'component-render' && event.sourceComponent) {
        const existing = rendersByComponent.get(event.sourceComponent) || [];
        existing.push(event);
        rendersByComponent.set(event.sourceComponent, existing);
      }
    }

    for (const source of eventsWithSubscribers) {
      for (const subscriber of source.subscribers!) {
        const renders = rendersByComponent.get(subscriber) || [];
        for (const render of renders) {
          // Only connect if render happened AFTER the source (within window)
          const delta = render.timestamp - source.timestamp;
          if (delta >= 0 && delta <= TIMING_WINDOW_MS) {
            const pairKey = `${source.id}→${render.id}`;
            if (!connectedPairs.has(pairKey)) {
              connectedPairs.add(pairKey);
              edges.push(this.createEdge(
                source.id,
                render.id,
                'consumed',
                0.85,
                `Subscriber match: ${subscriber} consumed ${source.label}`,
                events,
              ));
            }
          }
        }
      }
    }

    return edges;
  }

  /**
   * Strategy C: Timing + type pattern edges.
   * Connects events in the canonical flow: API → Store → Signal → Render
   * Only if they're within TIMING_WINDOW_MS and share a component/domain.
   */
  private buildTimingEdges(events: RuntimeEvent[], nodes: Map<string, GraphNode>): GraphEdge[] {
    const edges: GraphEdge[] = [];
    const connectedPairs = new Set<string>();

    // Collect already-connected pairs from strategies A and B
    for (const node of nodes.values()) {
      for (const edge of node.outEdges) {
        connectedPairs.add(`${edge.sourceId}→${edge.targetId}`);
      }
    }

    // Sort by timestamp
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    // Canonical type ordering for causal inference
    const typeOrder: Record<string, number> = {
      'http-response': 0,
      'store-dispatch': 1,
      'signal-write': 2,
      'computed-evaluation': 3,
      'component-render': 4,
    };

    for (let i = 0; i < sorted.length; i++) {
      const source = sorted[i];
      const sourceOrder = typeOrder[source.type];
      if (sourceOrder === undefined) continue;

      for (let j = i + 1; j < sorted.length; j++) {
        const target = sorted[j];
        const delta = target.timestamp - source.timestamp;

        // Stop scanning once outside timing window
        if (delta > TIMING_WINDOW_MS) break;

        const targetOrder = typeOrder[target.type];
        if (targetOrder === undefined) continue;

        // Only connect downstream types (API → Store, not Store → API)
        if (targetOrder <= sourceOrder) continue;

        // Skip already connected pairs
        const pairKey = `${source.id}→${target.id}`;
        if (connectedPairs.has(pairKey)) continue;

        // Check for shared domain (component name or owner class)
        const sharedDomain = this.hasSharedDomain(source, target);

        if (sharedDomain || delta < 20) {
          connectedPairs.add(pairKey);
          edges.push(this.createEdge(
            source.id,
            target.id,
            'correlated',
            sharedDomain ? 0.7 : 0.5,
            sharedDomain
              ? `Timing + shared domain (${delta}ms delta)`
              : `Sequential timing (${delta}ms delta)`,
            events,
          ));
        }
      }
    }

    return edges;
  }

  /**
   * Strategy D: Render cascade edges.
   * Parent component render → child component render within CASCADE_WINDOW_MS.
   * Uses parentComponent field from RenderEvent metadata.
   */
  private buildCascadeEdges(events: RuntimeEvent[], nodes: Map<string, GraphNode>): GraphEdge[] {
    const edges: GraphEdge[] = [];

    const renders = events.filter(e => e.type === 'component-render');

    for (const child of renders) {
      const parentName = child.metadata?.['parentComponent'];
      if (!parentName) continue;

      // Find the parent render event
      const parentRender = renders.find(r =>
        r.sourceComponent === parentName &&
        r.id !== child.id &&
        Math.abs(child.timestamp - r.timestamp) <= CASCADE_WINDOW_MS &&
        r.timestamp <= child.timestamp
      );

      if (parentRender) {
        edges.push(this.createEdge(
          parentRender.id,
          child.id,
          'cascaded',
          0.9,
          `Render cascade: ${parentName} → ${child.sourceComponent}`,
          events,
        ));
      }
    }

    return edges;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE: Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private createNode(event: RuntimeEvent): GraphNode {
    return {
      id: event.id,
      event,
      correlationId: event.correlationId || event.id,
      sessionId: undefined,
      outEdges: [],
      inEdges: [],
      depth: 0,
      isRoot: true,
      isLeaf: true,
      subtreeSize: 1,
      criticalPathDuration: event.duration || 0,
    };
  }

  private createEdge(
    sourceId: string,
    targetId: string,
    type: EdgeType,
    confidence: number,
    reason: string,
    events: RuntimeEvent[],
  ): GraphEdge {
    const source = events.find(e => e.id === sourceId);
    const target = events.find(e => e.id === targetId);
    const latency = (target?.timestamp || 0) - ((source?.timestamp || 0) + (source?.duration || 0));

    return {
      id: `edge-${++this.edgeCounter}`,
      sourceId,
      targetId,
      type,
      confidence,
      latency: Math.max(0, latency),
      reason,
    };
  }

  /**
   * BFS from roots to compute depths.
   */
  private computeDepths(nodes: Map<string, GraphNode>, roots: string[]): void {
    const queue: Array<{ id: string; depth: number }> = roots.map(id => ({ id, depth: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = nodes.get(id);
      if (!node) continue;

      node.depth = depth;

      for (const edge of node.outEdges) {
        if (!visited.has(edge.targetId)) {
          queue.push({ id: edge.targetId, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * Bottom-up traversal from leaves to compute subtree sizes and critical path durations.
   */
  private computeSubtreeMetrics(nodes: Map<string, GraphNode>, leaves: string[]): void {
    const visited = new Set<string>();
    const queue = [...leaves];

    // Process leaves first, then work up
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;

      const node = nodes.get(id);
      if (!node) continue;

      // Check if all children have been processed
      const allChildrenProcessed = node.outEdges.every(e => visited.has(e.targetId));
      if (!allChildrenProcessed) {
        queue.push(id); // Re-queue, process later
        continue;
      }

      visited.add(id);

      // Compute subtree size
      let subtreeSize = 1;
      let maxChildCriticalPath = 0;

      for (const edge of node.outEdges) {
        const child = nodes.get(edge.targetId);
        if (child) {
          subtreeSize += child.subtreeSize;
          maxChildCriticalPath = Math.max(maxChildCriticalPath, child.criticalPathDuration);
        }
      }

      node.subtreeSize = subtreeSize;
      node.criticalPathDuration = (node.event.duration || 0) + maxChildCriticalPath;

      // Add parents to queue
      for (const edge of node.inEdges) {
        if (!visited.has(edge.sourceId)) {
          queue.push(edge.sourceId);
        }
      }
    }
  }

  /**
   * Check if two events share a domain (component, service, or property name).
   */
  private hasSharedDomain(a: RuntimeEvent, b: RuntimeEvent): boolean {
    // Same component
    if (a.sourceComponent && b.sourceComponent && a.sourceComponent === b.sourceComponent) {
      return true;
    }

    // Same owner class
    if (a.ownerClass && b.ownerClass && a.ownerClass === b.ownerClass) {
      return true;
    }

    // Source's component appears in target's subscribers
    if (a.sourceComponent && b.subscribers?.includes(a.sourceComponent)) {
      return true;
    }

    // Shared property name pattern (revenueStore → revenueSignal)
    if (a.propertyName && b.propertyName) {
      const aDomain = a.propertyName.replace(/store|signal|subject|service/gi, '').toLowerCase();
      const bDomain = b.propertyName.replace(/store|signal|subject|service/gi, '').toLowerCase();
      if (aDomain.length > 3 && aDomain === bDomain) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build a human-readable explanation of an ancestry chain.
   */
  private buildAncestryExplanation(graph: ExecutionGraph, chain: string[]): string {
    if (chain.length === 0) return 'No ancestry found';
    if (chain.length === 1) return 'Root event (no parent)';

    const parts: string[] = [];
    for (let i = 0; i < Math.min(chain.length, 4); i++) {
      const node = graph.nodes.get(chain[i]);
      if (node) {
        parts.push(node.event.label);
      }
    }

    if (chain.length > 4) {
      parts.push(`... (${chain.length - 4} more)`);
    }

    return parts.join(' → ');
  }
}

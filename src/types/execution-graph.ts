/**
 * Execution Graph — Core Data Model
 * 
 * The Execution Graph is the central data structure of the Execution Intelligence Platform.
 * It connects RuntimeEvents with causality edges, enabling:
 * - Ancestor queries: "What caused this render?"
 * - Descendant queries: "What did this API call trigger?"
 * - Critical path: "What's the slowest chain from trigger to completion?"
 * - Blast radius: "How many components does this store update affect?"
 * 
 * Architecture position:
 * Event Normalizer → [Execution Graph Engine] → Session Builder → Story Builder
 * 
 * Every RuntimeEvent becomes a GraphNode.
 * Every causal relationship becomes a GraphEdge.
 */

import type { RuntimeEvent, SessionBoundary } from './execution-intelligence';

// ──────────────────────────────────────────────────────────────────────────────
// GRAPH NODES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A node in the execution graph.
 * Wraps a RuntimeEvent with graph-specific metadata.
 */
export interface GraphNode {
  /** Same as RuntimeEvent.id */
  id: string;

  /** The underlying runtime event */
  event: RuntimeEvent;

  /** Correlation group — events with the same correlationId belong to one logical operation */
  correlationId: string;

  /** Session this node belongs to */
  sessionId?: string;

  /** Outgoing edges (this node → downstream nodes) */
  outEdges: GraphEdge[];

  /** Incoming edges (upstream nodes → this node) */
  inEdges: GraphEdge[];

  /** Graph traversal metadata */
  depth: number;                    // 0 = root/trigger, increases downstream
  isRoot: boolean;                  // true if no incoming edges (session trigger)
  isLeaf: boolean;                  // true if no outgoing edges (terminal render)

  /** Computed metrics (populated after graph is built) */
  subtreeSize: number;              // Total nodes in subtree (blast radius)
  criticalPathDuration: number;     // Longest path from this node to any leaf
}

// ──────────────────────────────────────────────────────────────────────────────
// GRAPH EDGES
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Edge types representing different causality relationships.
 */
export type EdgeType =
  | 'triggered'         // A directly triggered B (API response → store update)
  | 'consumed'          // A's output was consumed by B (signal → computed)
  | 'rendered'          // State change A caused render B
  | 'cascaded'          // Parent render A caused child render B
  | 'correlated'        // Same correlationId, timing-based inference
  | 'sequential';       // Time-sequential within same session, no direct link

/**
 * A directed edge connecting two graph nodes.
 * Represents "source caused/triggered target".
 */
export interface GraphEdge {
  /** Unique edge identifier */
  id: string;

  /** Source node (upstream — the cause) */
  sourceId: string;

  /** Target node (downstream — the effect) */
  targetId: string;

  /** Type of causal relationship */
  type: EdgeType;

  /** Confidence in this edge (0-1). High for explicit causedByEventId, lower for timing-inferred. */
  confidence: number;

  /** Time delta between source.endTime and target.startTime (ms) */
  latency: number;

  /** Why this edge was created (for debugging) */
  reason: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// GRAPH QUERIES — Return Types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Result of a critical path query.
 * The longest-duration path from a root to a leaf in the graph.
 */
export interface CriticalPath {
  /** Ordered list of node IDs from root to leaf */
  nodeIds: string[];

  /** Total duration of the critical path */
  totalDuration: number;

  /** The bottleneck node (longest single operation on the path) */
  bottleneckId: string;
  bottleneckDuration: number;

  /** Human-readable description */
  description: string;
}

/**
 * Result of a blast radius query.
 * Shows how many nodes are transitively affected by a given node.
 */
export interface BlastRadius {
  /** Source node */
  sourceId: string;

  /** All transitively affected nodes */
  affectedNodeIds: string[];

  /** Breakdown by type */
  affectedByType: {
    renders: number;
    storeUpdates: number;
    signalWrites: number;
    computedEvals: number;
  };

  /** Affected component names (deduplicated) */
  affectedComponents: string[];

  /** Total transitive depth */
  maxDepth: number;
}

/**
 * Result of an ancestry query.
 * Shows the causal chain leading to a specific node.
 */
export interface AncestryChain {
  /** Target node we're tracing back from */
  targetId: string;

  /** Ordered list of ancestor node IDs (root first, target last) */
  ancestorIds: string[];

  /** The root cause (first node in the chain) */
  rootCauseId: string;
  rootCauseLabel: string;

  /** Human-readable causal explanation */
  explanation: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// GRAPH INTERFACE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The complete execution graph for one session.
 */
export interface ExecutionGraph {
  /** Session this graph represents */
  sessionId: string;

  /** All nodes keyed by ID */
  nodes: Map<string, GraphNode>;

  /** All edges */
  edges: GraphEdge[];

  /** Root nodes (session triggers — nodes with no incoming edges) */
  roots: string[];

  /** Leaf nodes (terminal renders — nodes with no outgoing edges) */
  leaves: string[];

  /** Graph metadata */
  totalNodes: number;
  totalEdges: number;
  maxDepth: number;
  buildTime: number;              // How long graph construction took (ms)
}

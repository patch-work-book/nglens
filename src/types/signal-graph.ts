/**
 * Signal Dependency Graph — Data Model
 * 
 * Represents the reactive relationships between Signals, Computeds, and Effects
 * within a single Angular component or across the application.
 */

export type SignalNodeType = 'signal' | 'computed' | 'effect' | 'template' | 'resource';

export interface SignalNode {
  /** Unique ID (usually className.propertyName) */
  id: string;
  
  /** Human-readable label */
  label: string;
  
  /** Type of reactive node */
  type: SignalNodeType;
  
  /** Current value (serialized) */
  value: string;
  
  /** The component that owns this signal */
  ownerComponent: string;
  
  /** IDs of nodes that this node depends on (upstream) */
  producers: string[];
  
  /** IDs of nodes that depend on this node (downstream) */
  consumers: string[];
  
  /** Whether the signal is currently "dirty" */
  isDirty: boolean;
  
  /** Metadata for glitches (e.g. recalculation count in current tick) */
  recalculationCount: number;
}

export interface SignalEdge {
  sourceId: string;
  targetId: string;
  type: 'dependency' | 'propagation';
}

export interface SignalGraph {
  nodes: Map<string, SignalNode>;
  edges: SignalEdge[];
  
  /** Detected reactive glitches (diamond dependencies) */
  glitches: {
    nodeId: string;
    path: string[];
    redundantCalls: number;
  }[];
}

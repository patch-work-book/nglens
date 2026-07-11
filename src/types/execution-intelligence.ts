/**
 * Execution Intelligence Engine - Core Data Models
 * 
 * Architecture:
 * Runtime Events → Normalizer → Session Builder → Story Builder → Impact Analyzer → Insight Engine → UI
 * 
 * Philosophy:
 * - A session is ONE user intent (button click, route navigation, page load)
 * - An execution step is ONE merged story from multiple related events
 * - Never lose raw events (they're the source of truth, like git commits)
 * - Always preserve causality chains and impact analysis
 */

import type { FlowEvent, RenderEvent } from './render-events';

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 1: NORMALIZED EVENTS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Represents the starting point of an execution session.
 * These are logical boundaries defined by user interaction, navigation, or system events.
 */
export type SessionBoundary =
  | 'user-interaction'    // Button click, input change, form submit
  | 'route-navigation'    // Route change, navigation
  | 'component-bootstrap' // ngOnInit, initial load
  | 'timer'               // setTimeout, setInterval, requestAnimationFrame
  | 'websocket'           // WebSocket message
  | 'background-task'     // Web Worker, Service Worker, Scheduled task
  | 'manual-refresh';     // User-triggered refresh

/**
 * A unified runtime event interface.
 * All event types (HTTP, RxJS, Signals, Renders, etc.) are normalized into this contract.
 * Inserted by the Normalizer stage before Session Builder processes them.
 */
export interface RuntimeEvent {
  id: string;
  type:
    | 'http-request'
    | 'http-response'
    | 'subject-emit'
    | 'signal-write'
    | 'store-dispatch'
    | 'store-select'
    | 'component-render'
    | 'user-interaction'
    | 'route-change'
    | 'websocket'
    | 'timer'
    | 'computed-evaluation';

  timestamp: number;
  duration?: number;

  // Source identification
  sourceComponent?: string;      // Which component triggered this
  ownerClass?: string;           // Which service/store owns this
  propertyName?: string;         // Signal name, subject name, etc.

  // Human-readable label
  label: string;                 // "UserService.user$.next()", "GET /api/dashboard", etc.
  detail?: string;               // Additional context

  // Payload information
  value?: string;                // Stringified value being emitted/written
  valueSnapshot?: Record<string, any>; // Structured value for later analysis
  responseBody?: string;         // For HTTP responses

  // Reactivity graph
  subscribers?: string[];        // Components/services that consume this
  consumedBy?: string[];         // Explicit downstream consumers (computed)

  // Causality information
  causedByEventId?: string;      // Parent event that triggered this
  causedByBoundary?: SessionBoundary; // Logical boundary that initiated everything

  // Frame/context
  frameId?: number;
  route?: string;

  // Future extensibility
  metadata?: Record<string, any>;
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 2: SESSION BUILDER OUTPUT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * An execution session groups related events that occurred as a result of ONE logical boundary.
 * Examples:
 * - "User clicked Refresh button" → session of 40 API calls, 200 component renders
 * - "Route changed to Dashboard" → session of bootstrap APIs, initial renders
 * - "WebSocket message arrived" → session of store updates, re-renders
 */
export interface ExecutionSession {
  id: string;
  
  // Session identity
  boundary: SessionBoundary;
  startTime: number;
  endTime: number;
  duration: number;

  // User interaction context (if applicable)
  interactionTarget?: string;    // CSS selector of the element clicked
  interactionComponent?: string; // Component that owns the element

  // Route context
  fromRoute?: string;
  toRoute?: string;

  // Raw event stream (immutable)
  eventIds: string[];            // References to all normalized events in this session
  events?: RuntimeEvent[];        // Lazy-loaded full events (on demand)

  // Summary metadata (computed)
  eventCount: number;
  componentCount: number;
  renderCount: number;
  apiCallCount: number;

  // Boundaries for this session (never traverses outside these)
  logicalStart: RuntimeEvent;    // The boundary event that started this session
  relatedSessions?: string[];    // Other sessions triggered by this one (parent-child relationships)
}

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 3: STORY BUILDER OUTPUT
// ──────────────────────────────────────────────────────────────────────────────

/**
 * High-level semantic types for execution steps.
 * Not implementation details (Signal, Subject, HTTP), but business meaning (Data Fetch, State Update, etc.)
 */
export type ExecutionStepType =
  | 'data-fetch'        // HTTP request + response
  | 'state-update'      // Store action, signal write, subject emit
  | 'computation'       // Derived signal, computed, selector evaluation
  | 'ui-update'         // Component render
  | 'user-interaction'  // Button click, form input
  | 'navigation'        // Route change
  | 'background-task'   // WebSocket, timer, async work
  | 'validation'        // Form validation, data validation
  | 'error-handling';   // Error caught, error state updated

/**
 * An execution step is ONE merged story from multiple related events.
 * Example: "Revenue Updated" merges HTTP Response → Store Action → Signal Write → Component Render.
 * 
 * Think of it like a Git commit: the ExecutionStep is the commit, the events are the file changes.
 * UI should display steps. Developers click to expand and see the raw events.
 */
export interface ExecutionStep {
  id: string;
  
  // What is this step about? (High-level business meaning)
  type: ExecutionStepType;
  title: string;                 // "Revenue Updated", "Fetch Orders", etc.
  summary: string;               // One-line explanation
  
  // The story (merged events)
  eventIds: string[];            // References to original normalized events (immutable source of truth)
  events?: RuntimeEvent[];        // Lazy-loaded if user expands
  
  startTime: number;
  endTime: number;
  duration: number;
  
  // Step sequencing
  sequenceOrder: number;         // Position in the execution story (1st step, 2nd step, etc.)
  
  // What changed in this step?
  changes: DiffResult;           // Added/removed/modified properties
  
  // Who consumes this step's output?
  impact: ImpactMetrics;         // Downstream effects
  
  // Why did this step happen?
  rootCauseChain: RootCauseChain; // Full causality chain leading to this step
  
  // Performance assessment
  performanceMetrics?: {
    duration: number;
    isSlowRender?: boolean;       // > 16ms
    isFastRender?: boolean;       // < 5ms
    renderCost?: number;
  };
  
  // Smart compression and grouping
  compressedEventCount?: number; // If merged from N events, show N
  isCompressed?: boolean;         // If true, user can expand to see merged events
  
  // Insights specific to this step
  stepInsights?: InsightMessage[];
  
  // Data for AI/explanations (future-proof)
  confidence?: number;           // 0-1: how confident we are in this analysis
  explanation?: string;          // AI-generated explanation (empty if not yet implemented)
  
  // Relations to other steps
  childSteps?: string[];         // Other steps that depend on this one
  relatedSteps?: string[];       // Other steps in same session
}

// ──────────────────────────────────────────────────────────────────────────────
// IMPACT ANALYSIS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Computed downstream effects of an execution step.
 * Automatically calculated by Impact Analyzer.
 */
export interface ImpactMetrics {
  // Affected resources
  components: {
    count: number;
    names: string[];             // ["RevenueChart", "SummaryWidget", ...]
    renders: number;             // Total renders caused
  };
  
  signals: {
    count: number;
    names: string[];
  };
  
  stores: {
    count: number;
    names: string[];
  };
  
  services: {
    count: number;
    names: string[];
  };
  
  rxjsChains: {
    count: number;
    subscriptionCount: number;
  };
  
  // Performance impact
  totalRenderCount: number;
  averageRenderDuration: number;
  totalDuration: number;
  
  // Consumer tree
  directConsumers: string[];     // Immediate consumers
  transitiveConsumers: string[]; // All downstream consumers
}

// ──────────────────────────────────────────────────────────────────────────────
// ROOT CAUSE ANALYSIS
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Represents one node in the causality chain.
 * Example chain:
 * Button Click → UserService.search() → HTTP Request → Store Action → Signal Update → Component Render
 */
export interface CausalNode {
  eventId: string;
  stepId?: string;
  
  timestamp: number;
  type: RuntimeEvent['type'];
  
  label: string;
  description?: string;
  
  // How did this node happen?
  causedBy?: CausalNode;         // Recursive: parent in the chain
  causedByBoundary?: SessionBoundary;
  
  confidence?: number;           // 0-1: how sure we are of this causality
}

/**
 * Full root cause chain for an execution step.
 * Never traverses outside logical boundaries.
 */
export interface RootCauseChain {
  startingBoundary: SessionBoundary;
  
  // Linear chain from boundary to this step
  chain: CausalNode[];
  
  // The root cause (always the boundary)
  rootCause: CausalNode;
  
  // Summary for UI
  summary: string;  // "Started by user clicking 'Refresh'"
}

// ──────────────────────────────────────────────────────────────────────────────
// DIFF ENGINE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * What changed during an execution step.
 * Never show full JSON payloads by default, always compute a diff.
 */
export interface DiffResult {
  added: {
    count: number;
    properties: Array<{ key: string; value: string; type: string }>;
  };
  
  removed: {
    count: number;
    properties: Array<{ key: string; oldValue: string; type: string }>;
  };
  
  modified: {
    count: number;
    properties: Array<{
      key: string;
      oldValue: string;
      newValue: string;
      type: string;
      magnitude?: number;  // For numeric changes: percentage change
    }>;
  };
  
  // Raw payloads (expanded only on user request)
  beforeSnapshot?: Record<string, any>;
  afterSnapshot?: Record<string, any>;
  
  // Summary
  summary: string;  // "Revenue: 1000 → 1200, Orders: +5"
}

// ──────────────────────────────────────────────────────────────────────────────
// INSIGHTS & ANOMALY DETECTION
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Automatic insights generated by the Insight Engine.
 * Detect anomalies, anti-patterns, and performance issues.
 */
export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightCategory =
  | 'duplicate-api'       // Same API called multiple times
  | 'large-payload'       // API response too large
  | 'slow-render'         // Component render > 16ms
  | 'excessive-renders'   // Component rendered too many times
  | 'infinite-loop'       // Signal/subject emitting rapidly
  | 'memory-leak'         // Cleanup not detected
  | 'performance-issue'   // General performance concern
  | 'anti-pattern'        // Detected Angular anti-pattern
  | 'best-practice';      // Positive observation

export interface InsightMessage {
  id: string;
  
  category: InsightCategory;
  severity: InsightSeverity;
  
  title: string;          // "Duplicate API detected"
  description: string;    // "GET /dashboard was called 2 times in 50ms"
  
  affectedSteps?: string[]; // Which execution steps are affected
  affectedComponents?: string[];
  
  // Suggested action
  recommendation?: string;
  
  // Data for investigation
  evidence?: {
    timestamps?: number[];
    values?: any[];
    metrics?: Record<string, number>;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// EXECUTION STORY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * One complete execution story: a session transformed into a readable narrative.
 * 200 runtime events compressed into 15 execution steps.
 * This is what developers read.
 */
export interface ExecutionStory {
  id: string;
  
  // Context
  sessionId: string;
  boundary: SessionBoundary;
  
  startTime: number;
  endTime: number;
  duration: number;
  
  // High-level summary
  title: string;           // "Dashboard Bootstrap", "Search Results Loaded", etc.
  summary: string;         // One-sentence description
  
  // The narrative (merged into steps)
  steps: ExecutionStep[];  // Typically 5-20 steps, max 50
  stepCount: number;
  
  // Overall metrics
  totalEventCount: number; // Sum of all compressed events
  
  // Overall insights
  insights: InsightMessage[];
  
  // Score and health
  executionScore: ExecutionScore;
  
  // Metadata
  affectedComponents: Set<string>;
  affectedServices: Set<string>;
  affectedStores: Set<string>;
}

// ──────────────────────────────────────────────────────────────────────────────
// EXECUTION SCORE
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Overall health/performance rating for an execution story.
 * Developers see this immediately: "Good", "Warning", "Critical".
 */
export type ExecutionHealthStatus = 'good' | 'warning' | 'critical';

export interface ExecutionScoreChecklist {
  noDuplicateApis: boolean;
  goodRenderCount: boolean;
  reasonablePayloadSize: boolean;
  noMemoryLeaks: boolean;
  noInfiniteLoops: boolean;
  noSlowRenders: boolean;
  noExcessiveRerenders: boolean;
}

export interface ExecutionScore {
  score: number;           // 0-100
  status: ExecutionHealthStatus;
  
  // Breakdown by category
  apiHealth: number;
  renderHealth: number;
  stateManagementHealth: number;
  memoryHealth: number;
  
  // Checklist (for display)
  checks: ExecutionScoreChecklist;
  
  // Summary
  summary: string;         // "Good", "Small issues", "Critical performance problems"
}

// ──────────────────────────────────────────────────────────────────────────────
// STORY GROUP (For 40+ APIs, organize by business domain)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * For large dashboards (40+ APIs), group execution steps by business domain/entity.
 * Example: "Revenue" group contains all revenue-related APIs, stores, renders
 */
export interface StoryGroup {
  id: string;
  
  // Group identity
  name: string;           // "Revenue", "Orders", "User Profile"
  entity: string;        // The primary entity being managed
  
  // Steps in this group
  steps: ExecutionStep[];
  
  // Aggregated impact
  impact: ImpactMetrics;
  
  // Group-level insights
  insights: InsightMessage[];
}

export interface GroupedExecutionStory extends ExecutionStory {
  groups: StoryGroup[];  // Alternative view: steps organized by business domain
}

// ──────────────────────────────────────────────────────────────────────────────
// CONSUMER TREE (For "Who consumes this?" analysis)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Hierarchical view of data flowing through the system.
 * Answer: "What happens after this API response?"
 */
export interface ConsumerTreeNode {
  id: string;
  
  type: 'api' | 'store' | 'signal' | 'subject' | 'component' | 'service';
  name: string;
  label: string;
  
  // Hierarchical
  consumers: ConsumerTreeNode[];
  
  // Metrics
  impactCount: number;           // How many other things consume this
  renderCount?: number;          // If this is a component
}

// ──────────────────────────────────────────────────────────────────────────────
// FUTURE AI INTEGRATION (Design for it now)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Data structure for AI to explain sessions.
 * "Summarize this execution" → AI fills in explanation field.
 */
export interface AIExplainableData {
  story: ExecutionStory;
  
  // Structured data for AI consumption
  narrative: {
    title: string;
    summary: string;
    steps: Array<{
      sequence: number;
      action: string;           // What happened
      reason: string;           // Why it happened
      impact: string;           // What was affected
    }>;
  };
  
  anomalies: InsightMessage[];
  
  // AI-generated fields (empty initially)
  explanation?: string;          // "Dashboard loaded successfully. 6 APIs..."
  anomalyExplanations?: Record<string, string>; // Per-anomaly AI explanation
  recommendations?: string[];
}

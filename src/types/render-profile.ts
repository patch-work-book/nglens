/**
 * Render Profile Type System
 *
 * Models for profiling a single component's render cycle:
 * - RenderProfile: top-level profiling session
 * - ChangeDetectionCycle: a single CD cycle within the profile
 * - RenderSpan: a component's render within a CD cycle
 * - TimingMetrics: detailed timing breakdown (self vs. child time)
 *
 * These types enable the flame graph, component tree, and activity timeline views.
 */

import type { RenderCause, RenderReason } from './render-events';
import type { Confidence, Evidence } from './evidence';

/**
 * Top-level profiling session.
 * Represents one "user action" and all its effects across change detection cycles.
 *
 * Example:
 * - User clicks "Refresh" button
 * - RenderProfile captures the entire cascade:
 *   - CD cycle #1: AppComponent renders
 *   - CD cycle #2: DashboardComponent renders (child)
 *   - CD cycle #3: DataGridComponent renders (grandchild)
 */
export interface RenderProfile {
  /** Unique ID for this profile */
  id: string;

  /** When did this profile start? (user interaction or API response) */
  startTime: number;

  /** When did the effects settle? (last paint or timeout) */
  endTime: number;

  /** Total duration from trigger to final render */
  duration: number;

  /** What triggered this profile? (user click, API response, route change, etc.) */
  trigger: ProfileTrigger;

  /** All change detection cycles in this profile */
  changeDetectionCycles: ChangeDetectionCycle[];

  /** All components affected in this profile */
  components: ComponentProfile[];

  /** User interactions tracked (e.g., which element was clicked) */
  interactions: UserInteraction[];

  /** Performance issues detected during this profile */
  issues: PerformanceIssue[];

  /** Metadata */
  metadata: {
    /** Angular version (15, 16, 17, etc.) */
    angularVersion: number;
    /** Whether app is in dev or production mode */
    mode: 'development' | 'production';
    /** Whether zoneless mode is enabled */
    zoneless: boolean;
    /** Frame ID (for multi-frame support) */
    frameId: number;
  };
}

/**
 * What triggered this profiling session?
 */
export type ProfileTrigger =
  | { type: 'user-interaction'; element: string; eventType: 'click' | 'input' | 'keydown'; selector: string }
  | { type: 'api-response'; url: string; method: string; status: number }
  | { type: 'route-change'; from: string; to: string }
  | { type: 'signal-update'; signalName: string }
  | { type: 'timer'; duration: number; source: string }
  | { type: 'unknown' };

/**
 * A single Angular change detection cycle.
 * Usually very fast (1-5ms), but can spike if many components render.
 *
 * Example:
 * CD Cycle #12
 * - Duration: 8.3ms
 * - Renders: AppComponent (2.1ms), Dashboard (3.8ms), Table (2.4ms)
 * - Trigger: Signal update
 */
export interface ChangeDetectionCycle {
  /** Unique ID within this profile */
  id: string;

  /** Sequence number (CD Cycle #1, #2, etc.) */
  sequenceNumber: number;

  /** When did this CD cycle start? */
  startTime: number;

  /** When did this CD cycle end? (all component renders + DOM updates) */
  endTime: number;

  /** Total duration of this CD cycle */
  duration: number;

  /** What triggered this CD cycle? (signal, parent, zone task, etc.) */
  trigger?: TriggerEvidence;

  /** All component renders in this cycle (in order) */
  renders: RenderSpan[];

  /** Top-level components that rendered (others are descendants) */
  topLevelRenders: string[]; // component names

  /** Total components affected (including descendants) */
  componentCount: number;

  /** Whether this cycle was synchronous (<50ms) or async */
  isSynchronous: boolean;
}

/**
 * What triggered this change detection cycle?
 */
export interface TriggerEvidence {
  type: 'signal' | 'input' | 'parent' | 'zone' | 'api' | 'route' | 'unknown';
  source?: string;
  timestamp?: number;
}

/**
 * A single component's render span within a change detection cycle.
 * This is the primary unit for flame graph visualization.
 *
 * Example:
 * CustomerTableComponent
 * - Start: 2.1ms
 * - End: 5.5ms
 * - Duration: 3.4ms
 * - Self time: 0.8ms (component's own logic)
 * - Child time: 2.6ms (all children combined)
 */
export interface RenderSpan {
  /** Unique ID for this span */
  id: string;

  /** Component name */
  componentName: string;

  /** Start time relative to CD cycle start (ms) */
  startTime: number;

  /** End time relative to CD cycle start (ms) */
  endTime: number;

  /** Total duration (endTime - startTime) */
  duration: number;

  /** Time spent in this component's own logic (excluding children) */
  selfTime: number;

  /** Time spent in all children combined */
  childTime: number;

  /** Parent component (if nested) */
  parentId?: string;

  /** Child render spans (in order) */
  children: string[]; // IDs of child RenderSpans

  /** Why did this component render? */
  causes: RenderCause[];

  /** Grouped reasons (signal, input, parent, etc.) */
  reasons: RenderReason[];

  /** Evidence supporting the causality determination */
  evidence: Evidence[];

  /** Confidence in why this component rendered */
  confidence?: Confidence;

  /** Is this the top-level component in this cycle? */
  isTopLevel: boolean;

  /** Is this component a hotspot (slow or re-renders frequently)? */
  isHotspot: boolean;

  /** Severity: High (>16ms or re-renders often), Medium, Low */
  severity: 'high' | 'medium' | 'low' | 'none';

  /** Performance metrics for this component */
  metrics: ComponentMetrics;
}

/**
 * Detailed metrics for a component's render.
 */
export interface ComponentMetrics {
  /** How many times has this component rendered in this profile? */
  renderCount: number;

  /** Average render time for this component */
  averageRenderTime: number;

  /** Total time spent in this component across all renders */
  totalRenderTime: number;

  /** CD-MER: Change Detection Efficiency Ratio (mutations / CD cycles) */
  cdMer?: number;

  /** Number of @Input properties */
  inputCount: number;

  /** Number of @Output event emitters */
  outputCount: number;

  /** Number of template bindings */
  templateBindings: number;

  /** Whether component uses ChangeDetectionStrategy.OnPush */
  usesOnPush: boolean;

  /** Whether component has change detection hooked */
  hasCustomChangeDetection: boolean;
}

/**
 * Summary of a single component across this profile.
 * (Aggregation of all its RenderSpans)
 */
export interface ComponentProfile {
  /** Component name */
  componentName: string;

  /** Total times rendered in this profile */
  renderCount: number;

  /** Total time spent rendering this component */
  totalRenderTime: number;

  /** Average time per render */
  averageRenderTime: number;

  /** Self time (component's own logic) summed across all renders */
  totalSelfTime: number;

  /** Child time summed across all renders */
  totalChildTime: number;

  /** Primary reason for renders */
  primaryCause: RenderCause['type'];

  /** All causes in breakdown */
  causesBreakdown: Record<RenderCause['type'], number>;

  /** Is this a hotspot? */
  isHotspot: boolean;

  /** Parent components in the tree */
  parents: string[];

  /** Child components in the tree */
  children: string[];

  /** Performance metrics */
  metrics: ComponentMetrics;
}

/**
 * Timing metrics breakdown for a single render span.
 * Used in the flame graph to show proportional widths and details.
 */
export interface TimingMetrics {
  /** Total duration of this span */
  total: number;

  /** Time spent in this component's own logic */
  selfTime: number;

  /** Time spent in children */
  childTime: number;

  /** Percentage of parent's time (for visual proportions) */
  percentOfParent: number;

  /** Whether this is a slow render (>16ms) */
  isSlow: boolean;

  /** Frame budget exceeded? (>60fps = 16.67ms per frame) */
  frameBudgetExceeded: boolean;
}

/**
 * User interaction tracked during this profile.
 * Used in the activity timeline and interaction tracking.
 */
export interface UserInteraction {
  /** Event type: click, input, keydown, scroll */
  type: 'click' | 'input' | 'keydown' | 'scroll' | 'submit' | 'change';

  /** CSS selector of the element */
  selector: string;

  /** Component that owns this element */
  componentName: string;

  /** Timestamp when interaction occurred */
  timestamp: number;

  /** Event value (for input fields) */
  value?: string;

  /** Key pressed (for keydown) */
  key?: string;
}

/**
 * Performance issue detected during profiling.
 */
export interface PerformanceIssue {
  /** Issue ID */
  id: string;

  /** Severity */
  severity: 'critical' | 'warning' | 'info';

  /** Issue type */
  type: 'slow-render' | 'excessive-renders' | 'cd-inefficient' | 'memory-leak' | 'unnecessary-render';

  /** Which component is affected */
  componentName: string;

  /** Human-readable title */
  title: string;

  /** Detailed description */
  description: string;

  /** When was this detected? */
  timestamp: number;

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Aggregated summary of a profiling session.
 * Used for quick overview before drilling into details.
 */
export interface RenderProfileSummary {
  /** Profile ID */
  profileId: string;

  /** What triggered this profile? */
  trigger: string;

  /** Total duration */
  duration: number;

  /** Total components rendered */
  componentCount: number;

  /** Total renders (component A rendering 3 times = 3 counts) */
  renderCount: number;

  /** Slowest component */
  slowestComponent: string;

  /** Slowest render time */
  slowestRenderTime: number;

  /** Total frame budget exceeded? */
  frameBudgetExceeded: boolean;

  /** Any hotspots detected? */
  hasHotspots: boolean;

  /** Number of issues detected */
  issueCount: number;
}

/**
 * Flat timeline of all events for the activity lane view.
 * Used in the activity timeline component.
 */
export interface TimelineEvent {
  /** Unique ID */
  id: string;

  /** Event timestamp */
  timestamp: number;

  /** Event type: interaction, api, signal, computed, cd, dom, paint */
  type: 'interaction' | 'api' | 'signal' | 'computed' | 'cd' | 'dom' | 'paint';

  /** Human-readable label */
  label: string;

  /** Duration of this event (if applicable) */
  duration?: number;

  /** Component affected (if applicable) */
  componentName?: string;

  /** Icon/emoji for UI display */
  icon: string;

  /** Color/severity class */
  colorClass: string;

  /** Additional details */
  details?: Record<string, any>;
}

/**
 * Aggregated statistics about a profiling session.
 */
export interface ProfileStatistics {
  /** Total profiles run */
  profileCount: number;

  /** Average profile duration */
  averageDuration: number;

  /** Average component count per profile */
  averageComponentCount: number;

  /** Most common trigger type */
  commonTrigger: string;

  /** Average renders per profile */
  averageRenderCount: number;

  /** Percentage of profiles with frame budget exceeded */
  frameBudgetExceededPercentage: number;

  /** Most common hotspot component */
  commonHotspot: string;

  /** Total issues detected */
  totalIssues: number;
}

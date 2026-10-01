/**
 * Evidence and Confidence System
 *
 * The Render Inspector needs to explain *why* a component rendered and provide
 * confidence scoring backed by explicit evidence. This type system models evidence
 * collection, confidence calculation, and human-readable explanations.
 *
 * Key principle: Never present inferred causality as 100% certain. Always show
 * evidence strength and let developers understand the basis for our conclusions.
 */

/**
 * An individual piece of evidence supporting or reducing confidence in a causality claim.
 *
 * Example evidence items:
 * - "Signal changed 3ms before render" (strength: strong)
 * - "Component renders every time parent renders" (strength: strong)
 * - "Timer event detected in zone.js (likely setTimeout)" (strength: weak)
 * - "No obvious trigger detected" (strength: weak)
 */
export interface Evidence {
  /** Unique identifier for this evidence item */
  id: string;

  /** What kind of evidence is this? */
  type: EvidenceType;

  /** Human-readable description */
  description: string;

  /** How strong is this evidence? Direct > Strong > Weak */
  strength: 'direct' | 'strong' | 'weak';

  /** Where did this evidence come from? (e.g., "RenderTracker", "CausalityAnalyzer", "SignalTracker") */
  source: string;

  /** Timestamp when this evidence was collected (for timeline context) */
  timestamp?: number;

  /** The component this evidence is about (for scoping) */
  componentName?: string;

  /** Additional metadata (e.g., signal name, input name, API endpoint) */
  metadata?: Record<string, any>;

  /** How much does this evidence contribute to the confidence score? (0-1) */
  weight: number;

  /** Optional: direct quote or data from the source (e.g., "revenue$ emitted 0.12ms before render") */
  source_detail?: string;
}

/** Types of evidence we can collect */
export type EvidenceType =
  | 'direct-render-observation'      // We directly observed this component render
  | 'signal-timing'                  // Signal changed within correlation window
  | 'input-timing'                   // @Input changed within correlation window
  | 'parent-render-causality'        // Parent rendered first, then this component
  | 'zone-task-timing'               // Zone.js task within correlation window
  | 'api-response-timing'            // HTTP response within correlation window
  | 'route-change-timing'            // Route change within correlation window
  | 'user-interaction-trigger'       // User clicked/typed just before this render
  | 'perfect-timing'                 // No timing gaps in the causality chain
  | 'all-steps-successful'           // No failed steps in the chain
  | 'long-chain'                     // Chain has 4+ steps (intentional operation)
  | 'parallel-execution'             // Steps overlap in time (async pattern detected)
  | 'store-dispatch-timing'          // NgRx store dispatch within correlation window
  | 'subject-emit-timing'            // RxJS Subject.next() within correlation window
  | 'computed-update-timing'         // Computed/derived state update detected
  | 'no-timing-gaps'                 // Steps are tightly coupled
  | 'cd-mer-efficient'               // CD efficiency is good (low mutation count)
  | 'cd-mer-inefficient'             // CD efficiency is poor (high CD cycles with few mutations)
  | 'orphan-chain'                   // No clear trigger detected (heuristic inference)
  | 'external-callback'              // Likely caused by external library
  | 'unknown-trigger';               // Could not determine trigger

/**
 * Confidence score with supporting evidence and explanation.
 *
 * Never show just "94%" without context. Always include:
 * - Numerical score (0-100)
 * - Confidence level (High/Medium/Low)
 * - Evidence array explaining the reasoning
 * - Explanation paragraph
 */
export interface Confidence {
  /** Numerical score 0-100. Only use 50, 75, 85, 95 for truthful representation */
  score: number;

  /** Categorical level: High (80+), Medium (50-79), Low (<50) */
  level: 'high' | 'medium' | 'low';

  /** Evidence items supporting this confidence score */
  evidence: Evidence[];

  /** Human-readable explanation of the confidence score */
  explanation: string;

  /** Optional: counter-evidence or caveats */
  caveats?: string[];
}

/**
 * Confidence score for a single evidence type.
 * Used in calculations: sum(weight * strength_score) / sum(weight)
 */
export interface EvidenceWeight {
  type: EvidenceType;
  strength: 'direct' | 'strong' | 'weak';
  weight: number;
  strengthScore: number; // direct=1.0, strong=0.8, weak=0.4
}

/**
 * Configuration for confidence calculation.
 * Allows customization of evidence weights and thresholds.
 */
export interface ConfidenceConfig {
  /** Weight for each evidence type (defaults provided in factory) */
  evidenceWeights: Record<EvidenceType, number>;

  /** Threshold for "High" confidence (default: 80) */
  highThreshold: number;

  /** Threshold for "Medium" confidence (default: 50) */
  mediumThreshold: number;

  /** Minimum number of evidence items for confident reasoning (default: 1) */
  minEvidenceItems: number;

  /** Time window for correlation (default: 50ms for same CD cycle) */
  correlationWindow: number;

  /** Whether to penalize chains with gaps (default: true) */
  penalizeTimingGaps: boolean;
}

/** Default confidence configuration */
export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  evidenceWeights: {
    'direct-render-observation': 1.0,
    'signal-timing': 0.9,
    'input-timing': 0.9,
    'parent-render-causality': 0.85,
    'api-response-timing': 0.85,
    'user-interaction-trigger': 0.9,
    'zone-task-timing': 0.7,
    'route-change-timing': 0.85,
    'perfect-timing': 0.8,
    'all-steps-successful': 0.6,
    'long-chain': 0.7,
    'parallel-execution': 0.6,
    'store-dispatch-timing': 0.85,
    'subject-emit-timing': 0.85,
    'computed-update-timing': 0.8,
    'no-timing-gaps': 0.8,
    'cd-mer-efficient': 0.5,
    'cd-mer-inefficient': -0.3, // Reduces confidence
    'orphan-chain': 0.4,
    'external-callback': 0.3,
    'unknown-trigger': 0.2,
  },
  highThreshold: 80,
  mediumThreshold: 50,
  minEvidenceItems: 1,
  correlationWindow: 50, // ms
  penalizeTimingGaps: true,
};

/**
 * Result of evidence collection for a single component render.
 * Used to build confidence scores.
 */
export interface EvidenceReport {
  /** Which component is this report about? */
  componentName: string;

  /** When did this component render? */
  renderTimestamp: number;

  /** All evidence items collected */
  evidence: Evidence[];

  /** Final confidence score (calculated from evidence) */
  confidence: Confidence;

  /** Timeline of events (for visual representation) */
  timeline: EvidenceTimeline[];
}

/**
 * Timeline event for visualization of how evidence was collected.
 * Shows when various events occurred relative to the render.
 */
export interface EvidenceTimeline {
  timestamp: number;
  event: string; // e.g., "Signal changed", "User clicked", "API response", "Component rendered"
  type: 'trigger' | 'intermediate' | 'render';
  componentName?: string;
  detail?: string;
}

/**
 * Aggregated evidence summary for a causality chain.
 * Shows overall confidence in the chain's correctness.
 */
export interface ChainEvidenceSummary {
  /** The chain ID this summary is for */
  chainId: string;

  /** Total number of evidence items */
  evidenceCount: number;

  /** Breakdown by strength: how many direct/strong/weak items */
  strengthBreakdown: {
    direct: number;
    strong: number;
    weak: number;
  };

  /** Overall confidence in this chain */
  confidence: Confidence;

  /** Top 3 evidence items that support this chain */
  topEvidence: Evidence[];

  /** Any counter-evidence or caveats */
  caveats: string[];
}

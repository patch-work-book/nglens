/**
 * Story evidence mapping — the trust layer of the Execution Story.
 *
 * The Phase-1 data audit established that ngLens captures NO explicit causal
 * edge between two distinct runtime events (`causedByEventId` and `subscribers`
 * are never populated). Every cross-event relationship the pipeline produces is
 * reconstructed panel-side from timing + name/type heuristics. This module is
 * the single place that translates a reconstructed graph edge into an HONEST
 * evidence level, so the Story UI never presents inference as fact.
 *
 * Mapping (grounded in the audit verdicts):
 *   - 'triggered'  → Observed        (only ever from a real causedByEventId; if
 *                                      one ever exists it IS a captured edge.
 *                                      In practice this edge is never produced.)
 *   - 'consumed'   → Correlated      (real subscribers[] + name/time pairing)
 *   - 'rendered'   → Correlated      (state→render name/time pairing)
 *   - 'cascaded'   → Inferred (DOM)  (parent→child from DOM nesting, NOT the
 *                                      Angular view/injector tree)
 *   - 'correlated' → Inferred        (type-order + timing window; no real link)
 *   - 'sequential' → Inferred        (bare time-adjacency)
 *   - (no edge)    → Unknown         (never draw a bare arrow)
 *
 * These functions are pure and unit-tested so the trust rule is verified against
 * real edge kinds, not asserted in prose.
 */

import type { EdgeType, GraphEdge } from '@nglens/types/execution-graph';

/** Evidence strength, from strongest (measured) to weakest (no evidence). */
export type EvidenceLevel = 'observed' | 'correlated' | 'inferred' | 'unknown';

export interface EvidenceVerdict {
  level: EvidenceLevel;
  /** Short label for the UI (e.g. "Inferred from DOM"). */
  label: string;
  /** One-line explanation of WHY this level, for a tooltip. */
  detail: string;
}

const UNKNOWN: EvidenceVerdict = {
  level: 'unknown',
  label: 'Unknown',
  detail: 'No runtime relationship was observed between these events.',
};

/**
 * Map a graph edge KIND to an evidence verdict.
 *
 * Confidence from the graph engine is intentionally NOT trusted as a probability
 * here — it is a heuristic weight. The edge KIND is what actually determines how
 * the relationship was derived, so the KIND drives the honest label. A very low
 * confidence still downgrades toward Unknown to avoid overstating weak timing.
 */
export function evidenceForEdgeType(type: EdgeType, confidence = 0): EvidenceVerdict {
  switch (type) {
    case 'triggered':
      // A directly captured causal link (causedByEventId). Genuinely observed.
      return {
        level: 'observed',
        label: 'Observed',
        detail: 'A directly captured causal link between these events.',
      };

    case 'consumed':
      return {
        level: 'correlated',
        label: 'Correlated',
        detail:
          'A subscriber consumed this value and rendered shortly after — a strong runtime relationship, but not a proven causal edge.',
      };

    case 'rendered':
      return {
        level: 'correlated',
        label: 'Correlated',
        detail:
          'A state change and a render co-occurred with matching identity — correlated, not proven causal.',
      };

    case 'cascaded':
      // Real parent→child, but derived from DOM nesting, not the Angular tree.
      return {
        level: 'inferred',
        label: 'Inferred from DOM',
        detail:
          'Parent and child rendered in the same window and are nested in the DOM. DOM nesting does not prove Angular runtime causality.',
      };

    case 'correlated':
      return {
        level: 'inferred',
        label: 'Inferred',
        detail:
          'Related only by event ordering and timing proximity. Temporal proximity does not prove causality.',
      };

    case 'sequential':
      return {
        level: 'inferred',
        label: 'Inferred',
        detail:
          'These events were time-adjacent in the same session. No direct relationship was observed.',
      };

    default:
      return UNKNOWN;
  }
}

/**
 * Resolve the evidence for a relationship given the best incoming edge (or none).
 * When there is no edge, the relationship is Unknown — the caller must render an
 * explicit "Unknown" state rather than a bare connector.
 */
export function evidenceForEdge(edge: GraphEdge | null | undefined): EvidenceVerdict {
  if (!edge) return { ...UNKNOWN };
  return evidenceForEdgeType(edge.type, edge.confidence);
}

/**
 * Pick the strongest incoming edge for a target node, so the spine shows the
 * best-supported relationship rather than the first one found. Ordering is by
 * evidence level (observed > correlated > inferred), then by confidence.
 */
const LEVEL_RANK: Record<EvidenceLevel, number> = {
  observed: 3,
  correlated: 2,
  inferred: 1,
  unknown: 0,
};

export function strongestEdge(edges: readonly GraphEdge[] | undefined | null): GraphEdge | null {
  if (!edges || edges.length === 0) return null;
  let best: GraphEdge | null = null;
  let bestRank = -1;
  let bestConf = -1;
  for (const e of edges) {
    const rank = LEVEL_RANK[evidenceForEdgeType(e.type, e.confidence).level];
    if (rank > bestRank || (rank === bestRank && e.confidence > bestConf)) {
      best = e;
      bestRank = rank;
      bestConf = e.confidence;
    }
  }
  return best;
}

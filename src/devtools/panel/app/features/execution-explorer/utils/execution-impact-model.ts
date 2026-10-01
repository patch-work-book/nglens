/**
 * Execution Impact model — the centerpiece that answers
 * "what footprint did this one execution create?"
 *
 * It is NOT another event stream. It synthesises the already-collected data
 * into (a) a footprint summary (counts + span) and (b) a small evidence-labelled
 * impact tree: Trigger → API activity → [Duplicate calls | Slow request] →
 * Render impact.
 *
 * TRUST RULES (from the Phase-1 audit):
 *   - Every downstream link carries an honest evidence level. Trigger→API and
 *     API→Render are reconstructed from timing/name edges, so they are
 *     Correlated/Inferred — NEVER Observed. When the graph has no supporting
 *     cross-category edge, the link is Unknown (rendered as a plain chronological
 *     connector, not a causal arrow).
 *   - Branches appear ONLY when the underlying data exists (no empty "Duplicate"
 *     or "Slow" branch, no fabricated State→Signal chain).
 *   - Counts are real; span is wall-clock. No manufactured amplification unless
 *     a single real trigger bounds the execution.
 *
 * Pure + unit-tested; the UI renders exactly what this returns.
 */

import type { ExecutionGraph, GraphEdge } from '@nglens/types/execution-graph';
import type { StoryPhaseModel, StoryStats } from './story-model';
import { evidenceForEdgeType, type EvidenceVerdict, type EvidenceLevel } from './story-evidence';

export type ImpactNodeKind =
  | 'trigger'
  | 'api'
  | 'duplicate'
  | 'slow'
  | 'render';

export interface ImpactNode {
  kind: ImpactNodeKind;
  /** Heading, e.g. "API activity". */
  label: string;
  /** One-line stat, e.g. "10 requests", "54 renders · 22 components". */
  detail: string;
  /** Representative Story node to select when this impact node is clicked. */
  targetId: string | null;
  /**
   * Evidence for the link INTO this node from its parent in the tree. Null for
   * the root (trigger/first node). Correlated/Inferred/Unknown — never a bare
   * arrow and never Observed for a timing-derived link.
   */
  upstream: EvidenceVerdict | null;
  /** Branch nodes hanging off this node (duplicate / slow off the API node). */
  branches: ImpactNode[];
}

export interface ExecutionImpact {
  /** Footprint stat band. */
  footprint: {
    renders: number;
    apis: number;
    components: number;
    duplicates: number;
    slow: number;
    spanMs: number;
  };
  /**
   * The main impact spine (trigger → api → render), each with upstream evidence.
   * Only nodes with real data are included. Empty when nothing happened.
   */
  spine: ImpactNode[];
  /**
   * Amplification ratio (renders per trigger) — present ONLY when a single real
   * trigger (user/router) bounds the execution; otherwise null (show raw counts).
   */
  amplification: number | null;
}

const UNKNOWN: EvidenceVerdict = {
  level: 'unknown',
  label: 'Unknown',
  detail: 'No runtime relationship was observed between these stages.',
};

/**
 * Find the strongest cross-category evidence between two sets of event ids using
 * the session graph out-edges. Returns Unknown when the graph proves nothing —
 * we never invent a link from mere chronological adjacency.
 */
function crossEvidence(
  fromEventIds: Array<string | null>,
  toEventIds: Set<string>,
  graph: ExecutionGraph | undefined,
): EvidenceVerdict {
  if (!graph) return { ...UNKNOWN };
  let best: { level: EvidenceLevel; verdict: EvidenceVerdict; conf: number } | null = null;
  const rank: Record<EvidenceLevel, number> = { observed: 3, correlated: 2, inferred: 1, unknown: 0 };
  for (const src of fromEventIds) {
    if (!src) continue;
    const node = graph.nodes.get(src);
    if (!node) continue;
    for (const edge of node.outEdges as GraphEdge[]) {
      if (!toEventIds.has(edge.targetId)) continue;
      const v = evidenceForEdgeType(edge.type, edge.confidence);
      if (v.level === 'unknown') continue;
      if (!best || rank[v.level] > rank[best.level] || (rank[v.level] === rank[best.level] && edge.confidence > best.conf)) {
        best = { level: v.level, verdict: v, conf: edge.confidence };
      }
    }
  }
  return best ? best.verdict : { ...UNKNOWN };
}

export function buildExecutionImpact(
  phaseModel: StoryPhaseModel,
  stats: StoryStats,
  graph: ExecutionGraph | undefined,
): ExecutionImpact {
  const footprint = {
    renders: stats.renders,
    apis: stats.apiCalls,
    components: stats.components,
    duplicates: stats.duplicates,
    slow: stats.slow,
    spanMs: stats.spanMs,
  };

  // Collect representative nodes + event id sets per category.
  const allNodes = phaseModel.phases.flatMap(p => p.nodes);
  const triggerNode = allNodes.find(n => n.category === 'user' || n.category === 'router') ?? null;
  const apiNodes = allNodes.filter(n => n.category === 'api');
  const renderNodes = allNodes.filter(n => n.category === 'component');

  const apiEventIds = new Set(apiNodes.map(n => n.eventId).filter((x): x is string => !!x));
  const renderEventIds = new Set(renderNodes.map(n => n.eventId).filter((x): x is string => !!x));

  const spine: ImpactNode[] = [];

  // 1) Trigger (root — no upstream claim).
  if (triggerNode) {
    spine.push({
      kind: 'trigger',
      label: triggerNode.category === 'router' ? 'Navigation' : 'User / trigger',
      detail: triggerNode.title,
      targetId: triggerNode.id,
      upstream: null,
      branches: [],
    });
  }

  // 2) API activity.
  if (apiNodes.length > 0) {
    const branches: ImpactNode[] = [];

    // Duplicate branch — only when the existing detector flagged duplicates.
    if (stats.duplicates > 0) {
      branches.push({
        kind: 'duplicate',
        label: 'Duplicate calls',
        detail: `${stats.duplicates} repeated request${stats.duplicates === 1 ? '' : 's'}`,
        targetId: apiNodes[0].id, // representative; the rail's duplicate jump refines
        upstream: null, // structural fact about the API set, not a causal edge
        branches: [],
      });
    }
    // Slow branch — only when a slow API exists.
    const slowest = apiNodes
      .filter(n => n.measuredMs != null)
      .sort((a, b) => (b.measuredMs ?? 0) - (a.measuredMs ?? 0))[0];
    if (slowest && (slowest.measuredMs ?? 0) > 300) {
      branches.push({
        kind: 'slow',
        label: 'Slow request',
        detail: `${Math.round(slowest.measuredMs!)}ms`,
        targetId: slowest.id,
        upstream: null,
        branches: [],
      });
    }

    spine.push({
      kind: 'api',
      label: 'API activity',
      detail: `${apiNodes.length} request${apiNodes.length === 1 ? '' : 's'}`,
      targetId: apiNodes[0].id,
      upstream: triggerNode
        ? crossEvidence([triggerNode.eventId], apiEventIds, graph)
        : null,
      branches,
    });
  }

  // 3) Render impact.
  if (renderNodes.length > 0) {
    // Evidence for API→render (or trigger→render when no API): timing/name edges
    // ⇒ Correlated/Inferred at best, Unknown when the graph proves nothing.
    const fromIds = apiNodes.length > 0 ? [...apiEventIds] : [triggerNode?.eventId ?? null];
    spine.push({
      kind: 'render',
      label: 'Render impact',
      detail: `${footprint.renders} render${footprint.renders === 1 ? '' : 's'} · ${footprint.components} component${footprint.components === 1 ? '' : 's'}`,
      targetId: renderNodes.sort((a, b) => (b.count ?? 1) - (a.count ?? 1))[0]?.id ?? null,
      upstream: spine.length > 0 ? crossEvidence(fromIds, renderEventIds, graph) : null,
      branches: [],
    });
  }

  // Amplification only when a single real trigger bounds the execution.
  const amplification =
    triggerNode && footprint.renders > 0 ? footprint.renders : null;

  return { footprint, spine, amplification };
}

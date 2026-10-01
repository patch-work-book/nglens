/**
 * Event detail model — the right-hand inspector for a selected Story node.
 *
 * TRUST RULES (from the Phase-1 audit):
 *   - An event's OWN timing (HTTP status/duration) is measured → Observed.
 *   - Downstream relationships come from the reconstructed graph out-edges and
 *     are grouped by their REAL evidence level. A "Followed by (Observed)"
 *     heading appears ONLY when a genuine captured `triggered` edge exists —
 *     which today it never does — so downstream renders fall under
 *     "Potentially related (Correlated)" / "(Inferred)", never Observed.
 *   - Initiator is shown only when captured; otherwise "Unknown (instrumented)".
 *   - No relationship is invented. Empty → the section is simply absent.
 *
 * Pure and unit-tested: the UI renders exactly what this returns.
 */

import type { RuntimeEvent } from '@nglens/types/execution-intelligence';
import type { ExecutionGraph, GraphEdge } from '@nglens/types/execution-graph';
import type { StoryNode } from './story-model';
import { evidenceForEdgeType, type EvidenceLevel } from './story-evidence';

export interface DetailRow {
  label: string;
  value: string;
  /** Optional evidence level to tint the value (e.g. Observed for timing). */
  evidence?: EvidenceLevel;
}

export interface RelatedItem {
  /** The related node/event id (for selection + focus). */
  id: string;
  label: string;
  /** e.g. "54 renders", "5 calls". */
  detail: string | null;
}

export interface RelatedGroup {
  /** Evidence level shared by every item in this group. */
  level: EvidenceLevel;
  /** Heading, e.g. "Followed by (Observed)" / "Potentially related (Correlated)". */
  heading: string;
  items: RelatedItem[];
}

export interface EventDetail {
  category: StoryNode['category'];
  title: string;
  /** Key/value rows for the Details tab. */
  rows: DetailRow[];
  /** Related activity grouped by evidence level (strongest first). Never
   *  fabricated — empty when the graph has no supporting out-edges. */
  related: RelatedGroup[];
  /** True for render nodes (enables "Inspect in Components"). */
  isComponent: boolean;
  /** True for API nodes (enables "Copy request URL" / Response tab). */
  isApi: boolean;
  /** Raw request URL/label for API nodes (for copy). */
  requestLabel: string | null;
  /** Response body if captured (often absent — async race). */
  responseBody: string | null;
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

const LEVEL_ORDER: EvidenceLevel[] = ['observed', 'correlated', 'inferred'];
function headingFor(level: EvidenceLevel): string {
  switch (level) {
    case 'observed': return 'Followed by (Observed)';
    case 'correlated': return 'Potentially related (Correlated)';
    case 'inferred': return 'Potentially related (Inferred)';
    default: return 'Related';
  }
}

/**
 * Build the inspector detail for a selected node.
 *
 * @param node     the selected StoryNode.
 * @param event    the underlying RuntimeEvent (for status/duration/response).
 * @param graph    the session graph (for downstream related events).
 * @param eventMap resolve related event ids → their events for labels.
 */
export function buildEventDetail(
  node: StoryNode,
  event: RuntimeEvent | undefined,
  graph: ExecutionGraph | undefined,
  eventMap?: Map<string, RuntimeEvent>,
): EventDetail {
  const isApi = node.category === 'api';
  const isComponent = node.category === 'component';

  const rows: DetailRow[] = [];

  if (isApi) {
    if (node.status) rows.push({ label: 'Status', value: node.status });
    if (node.measuredMs != null) {
      // Measured request time → Observed.
      rows.push({ label: 'Duration', value: `${node.measuredMs}ms`, evidence: 'observed' });
      rows.push({ label: 'Started', value: fmtTime(node.timestamp - node.measuredMs) });
      rows.push({ label: 'Completed', value: fmtTime(node.timestamp) });
    } else {
      rows.push({ label: 'Started', value: fmtTime(node.timestamp) });
    }
    rows.push({ label: 'Type', value: event?.metadata?.['originalType'] === 'render-event' ? 'render' : 'fetch' });
    // Initiator: only when captured; otherwise explicitly Unknown (instrumented).
    const initiator = event?.ownerClass;
    rows.push({ label: 'Initiator', value: initiator ? initiator : 'Unknown (instrumented)' });
    // Timing evidence is the strongest thing we can assert about an API event.
    rows.push({ label: 'Evidence', value: 'Observed', evidence: 'observed' });
  } else if (isComponent) {
    rows.push({ label: 'Renders', value: String(node.count ?? 1) });
    if (node.estimatedMs != null && node.estimatedMs >= 1) {
      rows.push({ label: 'Time', value: `~${Math.round(node.estimatedMs)}ms est`, evidence: 'inferred' });
    }
    rows.push({ label: 'Started', value: fmtTime(node.timestamp) });
    rows.push({ label: 'Evidence', value: 'Observed (render occurred)', evidence: 'observed' });
  } else {
    rows.push({ label: 'Started', value: fmtTime(node.timestamp) });
    if (event?.ownerClass) rows.push({ label: 'Owner', value: event.ownerClass });
    if (event?.propertyName) rows.push({ label: 'Property', value: event.propertyName });
  }

  // ── Related activity from graph OUT-edges, grouped by real evidence level ──
  const related: RelatedGroup[] = [];
  const out: GraphEdge[] | undefined =
    node.eventId && graph ? graph.nodes.get(node.eventId)?.outEdges : undefined;

  if (out && out.length > 0) {
    const byLevel = new Map<EvidenceLevel, RelatedItem[]>();
    for (const edge of out) {
      const level = evidenceForEdgeType(edge.type, edge.confidence).level;
      if (level === 'unknown') continue;
      const target = eventMap?.get(edge.targetId);
      const label = target?.label ?? edge.targetId;
      const detail =
        target?.type === 'component-render' ? 'render' :
        target?.duration != null ? `${Math.round(target.duration)}ms` : null;
      const list = byLevel.get(level) ?? [];
      // De-dupe by label.
      if (!list.some(i => i.label === label)) {
        list.push({ id: edge.targetId, label, detail });
      }
      byLevel.set(level, list);
    }
    for (const level of LEVEL_ORDER) {
      const items = byLevel.get(level);
      if (items && items.length > 0) {
        related.push({ level, heading: headingFor(level), items });
      }
    }
  }

  return {
    category: node.category,
    title: node.title,
    rows,
    related,
    isComponent,
    isApi,
    requestLabel: isApi ? (event?.label ?? node.title) : null,
    responseBody: isApi ? (event?.responseBody ?? null) : null,
  };
}

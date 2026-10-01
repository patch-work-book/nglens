/**
 * Story model builder — turns an ExecutionStory into an ordered vertical spine.
 *
 * GROUNDING (Phase-1 audit): the ONLY reliable ordering ngLens has is the
 * chronological event/step sequence. Cross-event causality is reconstructed
 * heuristically, so this builder:
 *   - lays out one spine node per ExecutionStep, in chronological order;
 *   - derives the node CATEGORY from the step's own type (never invents a
 *     category with no backing events);
 *   - attaches, for each node, the evidence of its BEST incoming graph edge
 *     (Observed/Correlated/Inferred), or Unknown when no edge exists — it never
 *     draws a bare causal arrow.
 *
 * It is a pure function of (steps, graph, eventMap) so the trust rules are
 * unit-testable without Angular. The UI renders exactly what this returns.
 */

import type { ExecutionStep, RuntimeEvent } from '@nglens/types/execution-intelligence';
import type { ExecutionGraph, GraphEdge } from '@nglens/types/execution-graph';
import {
  type EvidenceVerdict,
  evidenceForEdge,
  strongestEdge,
} from './story-evidence';

/** High-level lane category a story node belongs to. Only categories that map
 *  to a real step type are ever produced. */
export type StoryCategory =
  | 'user'
  | 'router'
  | 'api'
  | 'state'
  | 'signal'
  | 'component'
  | 'other';

export interface StoryNode {
  /** Stable within one build: the step id (used for selection sync). */
  id: string;
  /** The first underlying event id (used to look up graph edges + selection). */
  eventId: string | null;
  category: StoryCategory;
  /** Compact display name (e.g. endpoint, component, signal). */
  title: string;
  /** Secondary metric line (e.g. "84ms · 200"). Component nodes carry NO ms
   *  here — per-component render timing is a frame-split estimate that reads as
   *  fake precision; component timing is only aggregated at the phase level. */
  metric: string | null;
  /** True when the node's metric is an estimate (render timing), not measured. */
  estimated: boolean;
  /** Raw measured duration in ms for API nodes (real request time), else null. */
  measuredMs: number | null;
  /** Raw estimated duration in ms for component nodes (frame-split), else null.
   *  Used only for phase-level aggregation, never shown per row. */
  estimatedMs: number | null;
  /** HTTP status for API nodes, if present. */
  status: string | null;
  /**
   * Evidence for the relationship FROM the previous node TO this node — i.e.
   * "how do we know this followed the one above?". The first node has no
   * upstream, so its evidence is null (it is the observed trigger/start).
   */
  upstream: EvidenceVerdict | null;
  /** Render count for component nodes (real), else null. */
  count: number | null;
  /** Absolute wall-clock timestamp of the step's start (ms epoch). */
  timestamp: number;
  /** Milliseconds from this node's start to the NEXT node's start (chronological
   *  gap, purely observed timing — asserts no causality). Null for the last. */
  gapToNextMs: number | null;
}

export interface StoryModel {
  nodes: StoryNode[];
  /** Categories actually present, in spine order (for a legend / focus control). */
  presentCategories: StoryCategory[];
}

/** Map an ExecutionStep.type to a spine category. Returns 'other' for anything
 *  we don't have a first-class lane for, so nothing is silently miscategorised. */
export function categoryForStep(step: ExecutionStep): StoryCategory {
  switch (step.type) {
    case 'user-interaction':
      return 'user';
    case 'navigation':
      return 'router';
    case 'data-fetch':
      return 'api';
    case 'state-update':
      return 'state';
    case 'computation':
      return 'signal';
    case 'ui-update':
      return 'component';
    default:
      return 'other';
  }
}

interface NodeMetric {
  metric: string | null;
  estimated: boolean;
  measuredMs: number | null;
  estimatedMs: number | null;
  status: string | null;
}

/** Compact metric line + raw numbers for a node, honest about observed vs
 *  estimated. Component nodes deliberately carry NO per-row ms string — the
 *  frame-split estimate is only meaningful in aggregate, so it is summed at the
 *  phase level instead of shown as a fake "~1ms" under every component. */
function metricForNode(
  category: StoryCategory,
  event: RuntimeEvent | undefined,
): NodeMetric {
  if (category === 'api') {
    // HTTP timing is MEASURED. Status lives inside the label/detail string.
    const measuredMs = event?.duration != null ? Math.round(event.duration) : null;
    const status = extractStatus(event);
    const parts = [measuredMs != null ? `${measuredMs}ms` : null, status].filter(Boolean);
    return {
      metric: parts.length ? parts.join(' · ') : null,
      estimated: false,
      measuredMs,
      estimatedMs: null,
      status,
    };
  }
  if (category === 'component') {
    // Frame-split estimate — kept as a raw number for phase aggregation only.
    const estimatedMs = event?.duration != null ? event.duration : null;
    return { metric: null, estimated: true, measuredMs: null, estimatedMs, status: null };
  }
  // state/signal/user/router: occurrence only, no fabricated metric.
  return { metric: null, estimated: false, measuredMs: null, estimatedMs: null, status: null };
}

/** Pull an HTTP status code out of an event label/detail if present. */
function extractStatus(event: RuntimeEvent | undefined): string | null {
  if (!event) return null;
  const text = `${event.label ?? ''} ${event.detail ?? ''}`;
  const m = text.match(/\b(\d{3})\b/);
  return m ? m[1] : null;
}

/**
 * Build the story spine from a story's steps and (optionally) its session graph.
 *
 * @param steps    the story's ordered ExecutionSteps (chronological).
 * @param graph    the session's ExecutionGraph, for incoming-edge evidence. May
 *                 be undefined — then every non-first node's upstream is Unknown.
 * @param eventMap lookup for the underlying RuntimeEvent of a step (by event id).
 */
export function buildStoryModel(
  steps: readonly ExecutionStep[] | undefined,
  graph: ExecutionGraph | undefined,
  eventMap?: Map<string, RuntimeEvent>,
): StoryModel {
  if (!steps || steps.length === 0) {
    return { nodes: [], presentCategories: [] };
  }

  // Order by the step's sequence, falling back to startTime, to guarantee a
  // stable chronological spine even if input order is not sorted.
  const ordered = [...steps].sort(
    (a, b) => (a.sequenceOrder - b.sequenceOrder) || (a.startTime - b.startTime),
  );

  const nodes: StoryNode[] = [];
  const present = new Set<StoryCategory>();

  ordered.forEach((step, index) => {
    const category = categoryForStep(step);
    present.add(category);

    const eventId = step.eventIds?.[0] ?? null;
    const event = eventId && eventMap ? eventMap.get(eventId) : undefined;

    // Render count for component steps = number of render events in the step.
    const count =
      category === 'component'
        ? Math.max(1, step.eventIds?.length ?? 1)
        : null;

    const { metric, estimated, measuredMs, estimatedMs, status } = metricForNode(category, event);

    // Upstream evidence: the strongest incoming graph edge to this node's event.
    // The first node in the spine is the observed start — no upstream claim.
    let upstream: EvidenceVerdict | null = null;
    if (index > 0) {
      const incoming: GraphEdge[] | undefined =
        eventId && graph ? graph.nodes.get(eventId)?.inEdges : undefined;
      const best = strongestEdge(incoming);
      // If the graph has no incoming edge for this node, the relationship to the
      // previous node is genuinely Unknown — never assert a bare arrow.
      upstream = evidenceForEdge(best);
    }

    nodes.push({
      id: step.id,
      eventId,
      category,
      title: cleanTitle(step, category),
      metric,
      estimated,
      measuredMs,
      estimatedMs,
      status,
      upstream,
      count,
      timestamp: step.startTime,
      gapToNextMs: null, // filled below once the next node's start is known
    });
  });

  // Fill chronological gaps (observed timing between consecutive events).
  for (let i = 0; i < nodes.length - 1; i++) {
    const gap = nodes[i + 1].timestamp - nodes[i].timestamp;
    nodes[i].gapToNextMs = gap >= 0 ? gap : null;
  }

  // Present categories in first-appearance (spine) order.
  const presentCategories: StoryCategory[] = [];
  for (const n of nodes) {
    if (!presentCategories.includes(n.category)) presentCategories.push(n.category);
  }

  return { nodes, presentCategories };
}

/** Trim verbose verbs/prefixes for a compact spine label. */
function cleanTitle(step: ExecutionStep, category: StoryCategory): string {
  const raw = step.title || step.summary || 'Event';
  if (category === 'component') {
    return raw.replace(/^_/, '').replace(/\s+rendered$/i, '').replace(/\s+Loaded$/i, '');
  }
  if (category === 'api') {
    return raw.replace(/^(Loaded|Fetched|Received)\s+/i, '');
  }
  return raw;
}

// ──────────────────────────────────────────────────────────────────────────
// PHASE MODEL — turns the flat spine into a chronological runtime trace.
//
// A "phase" is a contiguous run of same-category nodes in time order. This is
// what makes the Story read as "what happened" (Trigger → Network → Component
// activity → …) instead of a flat list of component observations. Grouping is
// purely chronological — it asserts NO causality between phases beyond order.
// Evidence for the transition INTO a phase is attached once, at the phase
// boundary, not repeated under every row.
// ──────────────────────────────────────────────────────────────────────────

/** A per-component render-count rollup within a component phase. */
export interface ComponentRollup {
  /** The representing node (first render of this component in the phase). */
  node: StoryNode;
  name: string;
  count: number;
}

export interface StoryPhase {
  /** Stable id derived from the first member node. */
  id: string;
  category: StoryCategory;
  /** The individual nodes in this phase, in time order (for Expanded mode). */
  nodes: StoryNode[];
  /** Total members (renders for a component phase, calls for network, etc.). */
  total: number;
  /** Unique component/entity count (meaningful for component phases). */
  uniqueCount: number;
  /** Per-component rollup (component phases only), sorted by count desc. */
  rollup: ComponentRollup[];
  /**
   * Evidence for the transition FROM the previous phase INTO this one — shown
   * once at the phase boundary. Null for the first phase (the observed start).
   * Unknown when no cross-phase graph edge supports the transition.
   */
  upstream: EvidenceVerdict | null;
  /**
   * Aggregate estimated duration for a component phase (sum of frame-split
   * estimates), or measured total for a network phase. Null when not meaningful
   * (e.g. sub-millisecond render estimates that would read as fake precision).
   */
  aggregateMs: number | null;
  /** Whether aggregateMs is an estimate (component) vs measured (network). */
  aggregateEstimated: boolean;
}

export interface StoryPhaseModel {
  phases: StoryPhase[];
  presentCategories: StoryCategory[];
}

/** Minimum summed render estimate below which we show NO ms (avoids fake "~1ms"). */
const MIN_MEANINGFUL_PHASE_MS = 2;

/**
 * Group an ordered StoryNode list into contiguous chronological phases.
 * A new phase starts whenever the category changes from the previous node.
 * The phase's `upstream` evidence comes from `buildStoryModel` (the strongest
 * incoming edge to the phase's FIRST node), so it reflects the real transition
 * evidence and is shown only once per boundary.
 */
export function buildStoryPhases(model: StoryModel): StoryPhaseModel {
  const nodes = model.nodes;
  if (nodes.length === 0) return { phases: [], presentCategories: [] };

  const phases: StoryPhase[] = [];
  let current: StoryNode[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const first = current[0];
    const category = first.category;

    // Per-component rollup for component phases (name → count).
    const rollupMap = new Map<string, ComponentRollup>();
    if (category === 'component') {
      for (const n of current) {
        const existing = rollupMap.get(n.title);
        if (existing) {
          existing.count += n.count ?? 1;
        } else {
          rollupMap.set(n.title, { node: n, name: n.title, count: n.count ?? 1 });
        }
      }
    }
    const rollup = [...rollupMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    // total = renders for component (sum of counts), else member count.
    const total =
      category === 'component'
        ? current.reduce((s, n) => s + (n.count ?? 1), 0)
        : current.length;

    // Aggregate ms: component = sum of frame-split estimates (only if meaningful);
    // network = sum of measured request durations. Others = none.
    let aggregateMs: number | null = null;
    let aggregateEstimated = false;
    if (category === 'component') {
      const sum = current.reduce((s, n) => s + (n.estimatedMs ?? 0), 0);
      aggregateMs = sum >= MIN_MEANINGFUL_PHASE_MS ? Math.round(sum) : null;
      aggregateEstimated = true;
    } else if (category === 'api') {
      const sum = current.reduce((s, n) => s + (n.measuredMs ?? 0), 0);
      aggregateMs = sum > 0 ? Math.round(sum) : null;
      aggregateEstimated = false;
    }

    phases.push({
      id: `phase-${first.id}`,
      category,
      nodes: current,
      total,
      uniqueCount: category === 'component' ? rollupMap.size : current.length,
      rollup,
      upstream: first.upstream, // transition evidence, shown once at the boundary
      aggregateMs,
      aggregateEstimated,
    });
    current = [];
  };

  for (const node of nodes) {
    if (current.length > 0 && node.category !== current[current.length - 1].category) {
      flush();
    }
    current.push(node);
  }
  flush();

  const presentCategories: StoryCategory[] = [];
  for (const p of phases) {
    if (!presentCategories.includes(p.category)) presentCategories.push(p.category);
  }

  return { phases, presentCategories };
}

// ──────────────────────────────────────────────────────────────────────────
// IMPACT FLOW + STATS — the compact "how much work did this cause" summary.
//
// These describe WHAT occurred during the execution (counts, aggregate time)
// and, for the reactive lanes, whether activity was observed at all. They make
// NO causal claim — the flow chips are chronological category presence, not
// proven edges. Lanes that are relevant but had no activity are returned with
// `observed:false` so the UI can honestly say "No activity observed".
// ──────────────────────────────────────────────────────────────────────────

export interface ImpactFlowChip {
  category: StoryCategory;
  /** True when at least one event of this category occurred in the execution. */
  observed: boolean;
  /** Count of events (renders for component, calls for api, etc.); 0 when absent. */
  count: number;
  /** Unique entities (components); equals count for others. */
  uniqueCount: number;
  /** Aggregate ms (measured for api, estimated for component); null otherwise. */
  aggregateMs: number | null;
  aggregateEstimated: boolean;
}

export interface ImpactFlow {
  /** Chips in canonical runtime order; absent-but-relevant lanes included with observed:false. */
  chips: ImpactFlowChip[];
}

/**
 * Canonical lanes the impact flow always considers, in runtime order. Reactive
 * lanes (state/signal) are ALWAYS shown — as "no activity observed" when empty —
 * because their absence is itself informative (and prevents a fabricated
 * State→Signal→Component chain). Trigger/router/api/component appear only when
 * present (their absence is not noteworthy).
 */
const ALWAYS_SHOWN_LANES: StoryCategory[] = ['state', 'signal'];
const FLOW_ORDER: StoryCategory[] = ['user', 'router', 'api', 'state', 'signal', 'component'];

export function buildImpactFlow(phaseModel: StoryPhaseModel): ImpactFlow {
  // Aggregate all phases of a given category (a category can appear in multiple
  // phases across the execution; the flow chip sums them).
  const byCat = new Map<StoryCategory, { count: number; unique: Set<string>; ms: number; estimated: boolean }>();
  for (const p of phaseModel.phases) {
    const agg = byCat.get(p.category) ?? { count: 0, unique: new Set<string>(), ms: 0, estimated: false };
    agg.count += p.total;
    if (p.category === 'component') {
      for (const r of p.rollup) agg.unique.add(r.name);
    } else {
      for (const n of p.nodes) agg.unique.add(n.title);
    }
    if (p.aggregateMs != null) {
      agg.ms += p.aggregateMs;
      agg.estimated = p.aggregateEstimated;
    }
    byCat.set(p.category, agg);
  }

  const chips: ImpactFlowChip[] = [];
  for (const cat of FLOW_ORDER) {
    const agg = byCat.get(cat);
    const present = !!agg && agg.count > 0;
    if (!present && !ALWAYS_SHOWN_LANES.includes(cat)) continue;
    chips.push({
      category: cat,
      observed: present,
      count: present ? agg!.count : 0,
      uniqueCount: present ? agg!.unique.size : 0,
      aggregateMs: present && agg!.ms > 0 ? agg!.ms : null,
      aggregateEstimated: present ? agg!.estimated : false,
    });
  }
  return { chips };
}

// ── Left-rail / header stats ────────────────────────────────────────────────

export interface StoryStats {
  apiCalls: number;
  renders: number;
  components: number;
  signals: number;
  rxjs: number;
  stateUpdates: number;
  duplicates: number;
  slow: number;
  /** Wall-clock span of the execution in ms (last event − first event). */
  spanMs: number;
}

/**
 * Left-rail / header counts. Counts come from the phase model (renders,
 * components, api, signal, state). Duplicates/slow come from the swimlane
 * summary/items when provided (the existing detectors), so we never re-derive
 * a competing duplicate rule.
 */
export function buildStoryStats(
  phaseModel: StoryPhaseModel,
  extras?: { duplicates?: number; slow?: number },
): StoryStats {
  let apiCalls = 0, renders = 0, signals = 0, stateUpdates = 0;
  const components = new Set<string>();
  for (const p of phaseModel.phases) {
    switch (p.category) {
      case 'api': apiCalls += p.total; break;
      case 'component':
        renders += p.total;
        for (const r of p.rollup) components.add(r.name);
        break;
      case 'signal': signals += p.total; break;
      case 'state': stateUpdates += p.total; break;
    }
  }
  // rxjs is folded into signal steps upstream (computation) — expose separately
  // only if a distinct lane exists; today it is 0 unless the pipeline emits it.
  const rxjs = 0;

  // Span from the flat node timestamps (first → last).
  const first = phaseModel.phases[0]?.nodes[0]?.timestamp ?? 0;
  const lastPhase = phaseModel.phases[phaseModel.phases.length - 1];
  const lastNode = lastPhase?.nodes[lastPhase.nodes.length - 1];
  const spanMs = lastNode ? Math.max(0, lastNode.timestamp - first) : 0;

  return {
    apiCalls,
    renders,
    components: components.size,
    signals,
    rxjs,
    stateUpdates,
    duplicates: extras?.duplicates ?? 0,
    slow: extras?.slow ?? 0,
    spanMs,
  };
}
/**
 * Pure cascade-tree builder.
 *
 * Extracted verbatim from RenderingComponent.buildCascadeTree so the exact
 * production aggregation logic can be run in isolation by the ground-truth
 * accuracy harness (no Angular DI required). Behavior MUST match the component.
 *
 * What this represents (accuracy note): a "render" here is a DOM-mutation batch
 * attributed to a component host by the render tracker — NOT a proven Angular
 * change-detection render. Same-cycle mutations within SAME_CYCLE_MS are
 * coalesced into one counted render; components with ≤2-char (minified) names
 * are dropped.
 */
import type { RenderEvent, RenderCause, RenderReason } from '../../../../../../types/render-events';

/** A node in the render cascade tree. */
export interface CascadeNode {
  componentName: string;
  count: number;
  totalDuration: number;
  cause: RenderCause;
  depth: number;
  children: CascadeNode[];
  reasons?: RenderReason[];
  /** Histogram of render causes across ALL of this component's counted renders. */
  causeBreakdown?: Record<string, number>;
  /** Renders attributed to a parent cascade (cause.type === 'parent'). */
  parentRenders?: number;
  /** Renders attributed to this component's own trigger (signal/input/interaction). */
  ownRenders?: number;
}

/** Coalescing window: several DOM mutations within this window = one render. */
export const SAME_CYCLE_MS = 50;

/** Detect whether linking child→parent would create a cycle. */
export function wouldCycle(child: string, parent: string, parentOf: Map<string, string>): boolean {
  let current: string | undefined = parent;
  const visited = new Set<string>();
  while (current) {
    if (current === child) return true;
    if (visited.has(current)) return true;
    visited.add(current);
    current = parentOf.get(current);
  }
  return false;
}

/**
 * Build the render cascade tree from a stream of RenderEvents.
 * This is the single source of truth for per-component render COUNTS,
 * the cause histogram, and the parent-vs-own render partition.
 */
export function buildCascadeTree(events: RenderEvent[]): CascadeNode[] {
  // Skip minified names (1-2 char) — they're not useful to developers
  const filteredEvents = events.filter(e => e.componentName.length > 2);
  const nodeMap = new Map<string, CascadeNode>();
  // Definitive parent per component (first non-null parent wins, ignoring self-parent)
  const parentOf = new Map<string, string>();
  // Track last counted render timestamp per component to coalesce a single
  // mount/CD cycle (Angular emits several DOM mutations for one render).
  const lastCountedTs = new Map<string, number>();

  for (const event of filteredEvents) {
    const existing = nodeMap.get(event.componentName);
    const lastTs = lastCountedTs.get(event.componentName);
    // Only count as a distinct render if it's outside the same-cycle window
    const isDistinctRender = lastTs == null || (event.timestamp - lastTs) >= SAME_CYCLE_MS;

    // Cause type of THIS render event (parent for deep nodes, real trigger for depth-0)
    const eventCauseType = event.causes[0]?.type ?? 'zone';

    if (existing) {
      if (isDistinctRender) {
        existing.count++;
        lastCountedTs.set(event.componentName, event.timestamp);
        // Accumulate the cause histogram only for distinct (counted) renders
        existing.causeBreakdown![eventCauseType] = (existing.causeBreakdown![eventCauseType] ?? 0) + 1;
      }
      existing.totalDuration += event.duration;
    } else {
      nodeMap.set(event.componentName, {
        componentName: event.componentName,
        count: 1,
        totalDuration: event.duration,
        cause: event.causes[0] ?? { type: 'zone', source: 'unknown' },
        depth: event.depth ?? 0,
        children: [],
        causeBreakdown: { [eventCauseType]: 1 },
      });
      lastCountedTs.set(event.componentName, event.timestamp);
    }

    // Record a stable parent for this component (skip self-reference)
    const p = event.parentComponent;
    if (p && p !== event.componentName && !parentOf.has(event.componentName)) {
      parentOf.set(event.componentName, p);
    }
  }

  // Build parent→child relationships using the definitive parent map.
  // A node is a root if it has no parent in this action's node set.
  const roots: CascadeNode[] = [];
  for (const [name, node] of nodeMap) {
    const parentName = parentOf.get(name);
    // Guard against parent pointing to a node not in this set, or a cycle
    if (parentName && nodeMap.has(parentName) && !wouldCycle(name, parentName, parentOf)) {
      const parent = nodeMap.get(parentName)!;
      if (!parent.children.includes(node)) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Derive parent-cascade vs own-trigger render counts from the histogram.
  for (const node of nodeMap.values()) {
    const breakdown = node.causeBreakdown ?? {};
    const parentRenders = breakdown['parent'] ?? 0;
    let ownRenders = 0;
    for (const [type, n] of Object.entries(breakdown)) {
      if (type !== 'parent') ownRenders += n;
    }
    node.parentRenders = parentRenders;
    node.ownRenders = ownRenders;
  }

  // Sort children by render count first (the real signal), then duration.
  const sortTree = (nodes: CascadeNode[]): void => {
    nodes.sort((a, b) => b.count - a.count || b.totalDuration - a.totalDuration);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);

  return roots;
}

/**
 * Flatten a cascade tree into a de-duplicated (by component name) node list.
 * Matches RenderingComponent.flattenTree.
 */
export function flattenCascadeTree(tree: CascadeNode[]): CascadeNode[] {
  const result: CascadeNode[] = [];
  const seen = new Set<string>();
  const walk = (nodes: CascadeNode[], level: number): void => {
    const sorted = [...nodes].sort((a, b) => b.count - a.count || b.totalDuration - a.totalDuration);
    for (const node of sorted) {
      if (seen.has(node.componentName)) continue; // cycle guard
      seen.add(node.componentName);
      result.push({ ...node, depth: level });
      walk(node.children, level + 1);
    }
  };
  walk(tree, 0);
  return result;
}

/**
 * Resolve which node the Render Flow should center on, given the currently
 * selected component name. This is the TRUST RULE that keeps the center graph
 * consistent with the right details panel:
 *
 *  - selected name matches a node  → that exact node
 *  - selected name present but NOT in the tree → null (empty state, NO fallback)
 *  - nothing selected → the highest-count root (safe preview only)
 *
 * The key correctness property: when a component is selected, this NEVER returns
 * a different component. A divergent focus would make the two panels disagree.
 *
 * @param tree      the action's cascade tree
 * @param selectedName the display name currently selected (or null)
 * @param displayNameOf maps a raw componentName to its display name
 */
export function resolveFlowFocus(
  tree: CascadeNode[],
  selectedName: string | null,
  displayNameOf: (raw: string) => string,
): CascadeNode | null {
  if (!tree || tree.length === 0) return null;
  const nodes = flattenCascadeTree(tree);
  if (selectedName) {
    return nodes.find(n => displayNameOf(n.componentName) === selectedName) ?? null;
  }
  return [...tree].sort((a, b) => b.count - a.count)[0] ?? null;
}

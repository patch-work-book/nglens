/**
 * Ground-truth fixtures for the ngLens accuracy harness.
 *
 * Each scenario is a synthetic RenderEvent stream whose CORRECT answer is known
 * BY CONSTRUCTION. Crucially, the events mirror what the REAL render tracker
 * emits, not an idealized model:
 *   - depth-0 events carry an interaction-zone cause ({type:'zone', source:'addEventListener:click'})
 *     or a bare-zone cause ({type:'zone', source:'setTimeout'|'unknown'})
 *   - deeper events carry {type:'parent'} (the tracker hardcodes this for depth>0)
 *   - the tracker NEVER emits 'signal'/'input'/'manual-cd' causes (documented gap)
 *
 * The harness runs the real buildCascadeTree + classifyRenderOrigin against these
 * and compares to `expected`, so measured accuracy reflects production behavior.
 */
import type { RenderEvent } from '../../../../../../types/render-events';

export interface ExpectedComponent {
  name: string;
  /** Expected coalesced render count in the tree. */
  count: number;
  /** Expected origin classification bucket for this component. */
  origin: 'own-trigger' | 'parent-propagation' | 'unknown';
  /** Expected confidence WORD for that origin. */
  confidence: 'high' | 'medium' | 'low';
}

export interface GroundTruthScenario {
  id: string;
  description: string;
  /** The capability this scenario primarily validates (for the report). */
  capability:
    | 'render-count'
    | 'coalescing'
    | 'tree-structure'
    | 'minified-filter'
    | 'own-trigger'
    | 'parent-propagation'
    | 'unknown-handling'
    | 'negative-causality';
  events: RenderEvent[];
  /** Total coalesced renders expected (sum of component counts). */
  expectedRenderCount: number;
  /** Distinct components expected in the tree. */
  expectedComponents: number;
  /** Per-component expectations. */
  expectedByComponent: ExpectedComponent[];
  /**
   * Components that MUST NOT appear attributed to a given origin (negative test).
   * e.g. an independent sibling render must NOT be classified as parent-propagation
   * of an unrelated component.
   */
  mustNotClaim?: Array<{ name: string; notOrigin: 'own-trigger' | 'parent-propagation' }>;
}

let ts = 1_000_000;
/** Monotonic timestamp helper; `gap` ms since previous event. */
function at(gap = 100): number {
  ts += gap;
  return ts;
}

function ev(partial: Partial<RenderEvent> & { componentName: string }): RenderEvent {
  return {
    timestamp: at(),
    duration: 1,
    causes: [{ type: 'zone', source: 'unknown' }],
    depth: 0,
    ...partial,
  } as RenderEvent;
}

/** Interaction-zone cause as the real tracker emits for depth-0 after a click. */
const clickCause = { type: 'zone' as const, source: 'addEventListener:click' };
/** Bare zone cause (timer/unknown) — no attributable trigger. */
const timerCause = { type: 'zone' as const, source: 'setTimeout' };
/** Parent cascade cause as the tracker hardcodes for depth>0. */
const parentCause = (parent: string) => ({ type: 'parent' as const, source: parent });

export const GROUND_TRUTH_SCENARIOS: GroundTruthScenario[] = [
  // ── 1. Single render ────────────────────────────────────────────────────
  {
    id: 'single-render',
    description: 'One component renders once from a click.',
    capability: 'render-count',
    events: [
      ev({ componentName: 'AlphaComponent', depth: 0, causes: [clickCause] }),
    ],
    expectedRenderCount: 1,
    expectedComponents: 1,
    expectedByComponent: [
      { name: 'AlphaComponent', count: 1, origin: 'own-trigger', confidence: 'high' },
    ],
  },

  // ── 2. Repeated renders coalesce within SAME_CYCLE_MS ─────────────────────
  {
    id: 'coalesce-same-cycle',
    description: 'Three DOM mutations within 50ms coalesce into ONE render.',
    capability: 'coalescing',
    events: [
      ev({ componentName: 'BetaComponent', timestamp: 2_000_000, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'BetaComponent', timestamp: 2_000_010, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'BetaComponent', timestamp: 2_000_020, depth: 0, causes: [clickCause] }),
    ],
    expectedRenderCount: 1,
    expectedComponents: 1,
    expectedByComponent: [
      { name: 'BetaComponent', count: 1, origin: 'own-trigger', confidence: 'high' },
    ],
  },

  // ── 3. Distinct renders beyond the coalescing window ──────────────────────
  {
    id: 'distinct-renders',
    description: 'Three renders spaced >50ms apart count as three.',
    capability: 'render-count',
    events: [
      ev({ componentName: 'GammaComponent', timestamp: 3_000_000, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'GammaComponent', timestamp: 3_000_100, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'GammaComponent', timestamp: 3_000_200, depth: 0, causes: [clickCause] }),
    ],
    expectedRenderCount: 3,
    expectedComponents: 1,
    expectedByComponent: [
      { name: 'GammaComponent', count: 3, origin: 'own-trigger', confidence: 'high' },
    ],
  },

  // ── 4. Parent cascade (nested) ────────────────────────────────────────────
  {
    id: 'parent-cascade',
    description: 'Parent renders (click) and a nested child renders as parent cascade.',
    capability: 'parent-propagation',
    events: [
      ev({ componentName: 'LayoutComponent', timestamp: 4_000_000, depth: 0, causes: [clickCause], parentComponent: null }),
      ev({ componentName: 'ChildComponent', timestamp: 4_000_010, depth: 1, causes: [parentCause('LayoutComponent')], parentComponent: 'LayoutComponent' }),
    ],
    expectedRenderCount: 2,
    expectedComponents: 2,
    expectedByComponent: [
      { name: 'LayoutComponent', count: 1, origin: 'own-trigger', confidence: 'high' },
      { name: 'ChildComponent', count: 1, origin: 'parent-propagation', confidence: 'medium' },
    ],
  },

  // ── 5. Minified component filtering ───────────────────────────────────────
  {
    id: 'minified-filter',
    description: 'Components with ≤2-char names are dropped entirely.',
    capability: 'minified-filter',
    events: [
      ev({ componentName: 'RealComponent', timestamp: 5_000_000, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'a', timestamp: 5_000_100, depth: 0, causes: [clickCause] }),
      ev({ componentName: 'xy', timestamp: 5_000_200, depth: 0, causes: [clickCause] }),
    ],
    expectedRenderCount: 1,
    expectedComponents: 1,
    expectedByComponent: [
      { name: 'RealComponent', count: 1, origin: 'own-trigger', confidence: 'high' },
    ],
  },

  // ── 6. Bare-zone render → Unknown (honest UNKNOWN handling) ───────────────
  {
    id: 'bare-zone-unknown',
    description: 'A render with a bare timer/zone cause and no interaction is Unknown.',
    capability: 'unknown-handling',
    events: [
      ev({ componentName: 'TimerComponent', timestamp: 6_000_000, depth: 0, causes: [timerCause] }),
    ],
    expectedRenderCount: 1,
    expectedComponents: 1,
    expectedByComponent: [
      { name: 'TimerComponent', count: 1, origin: 'unknown', confidence: 'low' },
    ],
  },

  // ── 7. Nested tree structure (3 levels) ──────────────────────────────────
  {
    id: 'nested-tree',
    description: 'Three-level nesting builds correct parent/child structure.',
    capability: 'tree-structure',
    events: [
      ev({ componentName: 'AppRoot', timestamp: 7_000_000, depth: 0, causes: [clickCause], parentComponent: null }),
      ev({ componentName: 'MidComponent', timestamp: 7_000_010, depth: 1, causes: [parentCause('AppRoot')], parentComponent: 'AppRoot' }),
      ev({ componentName: 'LeafComponent', timestamp: 7_000_020, depth: 2, causes: [parentCause('MidComponent')], parentComponent: 'MidComponent' }),
    ],
    expectedRenderCount: 3,
    expectedComponents: 3,
    expectedByComponent: [
      { name: 'AppRoot', count: 1, origin: 'own-trigger', confidence: 'high' },
      { name: 'MidComponent', count: 1, origin: 'parent-propagation', confidence: 'medium' },
      { name: 'LeafComponent', count: 1, origin: 'parent-propagation', confidence: 'medium' },
    ],
  },

  // ── 8. NEGATIVE causality: independent sibling must NOT be parent cascade ─
  {
    id: 'negative-independent-sibling',
    description: 'A sibling that renders from its own click is NOT parent-cascade of the other.',
    capability: 'negative-causality',
    events: [
      // Two siblings under the same shell, each triggered by its own click.
      ev({ componentName: 'SiblingA', timestamp: 8_000_000, depth: 1, causes: [clickCause], parentComponent: 'ShellComponent' }),
      ev({ componentName: 'SiblingB', timestamp: 8_000_100, depth: 1, causes: [clickCause], parentComponent: 'ShellComponent' }),
    ],
    expectedRenderCount: 2,
    expectedComponents: 2,
    expectedByComponent: [
      // Both have an interaction cause, so both are own-trigger — NOT parent cascade.
      { name: 'SiblingA', count: 1, origin: 'own-trigger', confidence: 'high' },
      { name: 'SiblingB', count: 1, origin: 'own-trigger', confidence: 'high' },
    ],
    mustNotClaim: [
      { name: 'SiblingA', notOrigin: 'parent-propagation' },
      { name: 'SiblingB', notOrigin: 'parent-propagation' },
    ],
  },
];

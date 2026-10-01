/**
 * Automated ground-truth accuracy harness.
 *
 * Runs the REAL ngLens analysis primitives — buildCascadeTree (the exact
 * function production delegates to) and classifyRenderOrigin (the exact origin
 * partition) — against synthetic RenderEvent streams whose correct answers are
 * known by construction. Produces PASS/FAIL, tags false positives/negatives,
 * and computes MEASURED accuracy percentages per capability.
 *
 * These numbers replace judgment-based estimates. They measure the ANALYSIS
 * layer (counting, coalescing, tree, origin classification). They do NOT measure
 * browser-level instrumentation timing (even-split duration) or live causality,
 * which require the manual browser harness — see ACCURACY-REPORT.md.
 */
import { describe, it, expect } from 'vitest';
import { buildCascadeTree, flattenCascadeTree, type CascadeNode } from './cascade-tree';
import { classifyRenderOrigin } from './render-origin';
import { GROUND_TRUTH_SCENARIOS, type GroundTruthScenario } from './ground-truth.fixtures';

/**
 * Reproduce the component's dominant-origin decision from a node, using the
 * SAME pure primitives the component uses (classifyRenderOrigin). This is the
 * real classification path, not a reimplementation of the rules.
 */
function dominantOrigin(node: CascadeNode): { origin: string; confidence: string } {
  const partition = classifyRenderOrigin(node.causeBreakdown ?? {}, node.cause?.source ?? '');
  const buckets: Array<{ key: string; count: number; confidence: string }> = [];
  if (partition.ownRenders > 0) buckets.push({ key: 'own-trigger', count: partition.ownRenders, confidence: partition.ownConfidence });
  if (partition.parentRenders > 0) buckets.push({ key: 'parent-propagation', count: partition.parentRenders, confidence: partition.parentConfidence });
  if (partition.unknownRenders > 0) buckets.push({ key: 'unknown', count: partition.unknownRenders, confidence: 'low' });
  buckets.sort((a, b) => b.count - a.count);
  const top = buckets[0] ?? { key: 'unknown', confidence: 'low' };
  return { origin: top.key, confidence: top.confidence };
}

// ── Result accumulation for the measured accuracy report ──
interface CapabilityTally { pass: number; total: number; }
const tally = new Map<string, CapabilityTally>();
const falsePositives: string[] = [];
const falseNegatives: string[] = [];

function record(capability: string, ok: boolean): void {
  const t = tally.get(capability) ?? { pass: 0, total: 0 };
  t.total += 1;
  if (ok) t.pass += 1;
  tally.set(capability, t);
}

function runScenario(scenario: GroundTruthScenario): void {
  const tree = buildCascadeTree(scenario.events);
  const flat = flattenCascadeTree(tree);

  // 1. Render count accuracy
  const actualRenderCount = flat.reduce((s, n) => s + n.count, 0);
  const countOk = actualRenderCount === scenario.expectedRenderCount;
  record(scenario.capability === 'render-count' ? 'render-count' : `${scenario.capability}:count`, countOk);
  record('render-count(all)', countOk);
  expect(actualRenderCount, `${scenario.id}: render count`).toBe(scenario.expectedRenderCount);

  // 2. Component count accuracy
  const componentsOk = flat.length === scenario.expectedComponents;
  record('component-count', componentsOk);
  expect(flat.length, `${scenario.id}: component count`).toBe(scenario.expectedComponents);

  // 3. Per-component origin + confidence accuracy
  for (const expected of scenario.expectedByComponent) {
    const node = flat.find(n => n.componentName === expected.name);
    const found = !!node;
    record('component-presence', found);
    expect(node, `${scenario.id}: component ${expected.name} present`).toBeTruthy();
    if (!node) { falseNegatives.push(`${scenario.id}: missing ${expected.name}`); continue; }

    const nodeCountOk = node.count === expected.count;
    record('per-component-count', nodeCountOk);
    expect(node.count, `${scenario.id}: ${expected.name} count`).toBe(expected.count);

    const { origin, confidence } = dominantOrigin(node);
    const originOk = origin === expected.origin;
    record('origin-classification', originOk);
    if (!originOk) {
      // A wrong origin that CLAIMS a cause (own/parent) when truth is unknown,
      // or claims the wrong cause, is a false positive.
      falsePositives.push(`${scenario.id}: ${expected.name} origin expected=${expected.origin} actual=${origin}`);
    }
    expect(origin, `${scenario.id}: ${expected.name} origin`).toBe(expected.origin);

    const confOk = confidence === expected.confidence;
    record('confidence-word', confOk);
    expect(confidence, `${scenario.id}: ${expected.name} confidence`).toBe(expected.confidence);
  }

  // 4. Negative-causality checks (must NOT claim a false origin)
  if (scenario.mustNotClaim) {
    for (const rule of scenario.mustNotClaim) {
      const node = flat.find(n => n.componentName === rule.name);
      const { origin } = node ? dominantOrigin(node) : { origin: 'unknown' };
      const ok = origin !== rule.notOrigin;
      record('negative-causality', ok);
      if (!ok) falsePositives.push(`${scenario.id}: ${rule.name} FALSELY classified as ${rule.notOrigin}`);
      expect(origin, `${scenario.id}: ${rule.name} must not be ${rule.notOrigin}`).not.toBe(rule.notOrigin);
    }
  }
}

describe('ngLens accuracy harness (measured, ground-truth)', () => {
  for (const scenario of GROUND_TRUTH_SCENARIOS) {
    it(`${scenario.id} — ${scenario.description}`, () => {
      runScenario(scenario);
    });
  }

  it('MEASURED ACCURACY REPORT', () => {
    const lines: string[] = [];
    const report: Record<string, { pass: number; total: number; pct: number }> = {};
    let grandPass = 0;
    let grandTotal = 0;

    for (const [capability, t] of [...tally.entries()].sort()) {
      const pct = t.total > 0 ? Math.round((t.pass / t.total) * 100) : 0;
      report[capability] = { pass: t.pass, total: t.total, pct };
      grandPass += t.pass;
      grandTotal += t.total;
      lines.push(`  ${capability.padEnd(28)} ${String(t.pass).padStart(3)}/${String(t.total).padEnd(3)}  ${pct}%`);
    }
    const overall = grandTotal > 0 ? Math.round((grandPass / grandTotal) * 100) : 0;

    // eslint-disable-next-line no-console
    console.log(
      '\n=== ngLens MEASURED ACCURACY (analysis layer) ===\n' +
      lines.join('\n') +
      `\n  ${'OVERALL'.padEnd(28)} ${String(grandPass).padStart(3)}/${String(grandTotal).padEnd(3)}  ${overall}%` +
      (falsePositives.length ? `\n\n  FALSE POSITIVES (${falsePositives.length}):\n` + falsePositives.map(f => `    - ${f}`).join('\n') : '\n\n  FALSE POSITIVES: 0') +
      (falseNegatives.length ? `\n  FALSE NEGATIVES (${falseNegatives.length}):\n` + falseNegatives.map(f => `    - ${f}`).join('\n') : '\n  FALSE NEGATIVES: 0') +
      '\n\n  Machine-readable: ' + JSON.stringify({ overall, falsePositives: falsePositives.length, falseNegatives: falseNegatives.length, report }) +
      '\n'
    );

    // The report itself always "passes"; it exists to emit measured numbers.
    // Individual capability failures surface in their own test cases above.
    expect(grandTotal).toBeGreaterThan(0);
  });
});

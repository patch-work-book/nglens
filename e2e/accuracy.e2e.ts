/**
 * END-TO-END accuracy measurement (zoneless + zoneful).
 *
 * Runs the REAL ngLens RenderTracker against a REAL Angular app in Chromium,
 * drives known interactions, then diffs ngLens's reported per-component render
 * counts against console.count ground truth captured from the app itself.
 *
 * Runs the SAME scenarios against both change-detection modes:
 *   - zoneless  (harness.html)
 *   - zoneful   (harness-zoneful.html)  ← what most production apps use
 *
 * Numbers here are measured, not assumed.
 */
import { test, expect } from '@playwright/test';

interface Counts { [component: string]: number; }

const MODES = [
  { mode: 'zoneless', url: '/harness.html' },
  { mode: 'zoneful', url: '/harness-zoneful.html' },
] as const;

// Accumulate measured results across all modes/scenarios for the final report.
const results: Array<{
  mode: string; scenario: string; component: string;
  expected: number; actual: number; kind: 'match' | 'fp' | 'fn' | 'mismatch';
}> = [];

function compare(mode: string, scenario: string, component: string, groundTruth: number, ngLens: number): void {
  let kind: 'match' | 'fp' | 'fn' | 'mismatch';
  if (groundTruth === ngLens) kind = 'match';
  else if (groundTruth === 0 && ngLens > 0) kind = 'fp';
  else if (groundTruth > 0 && ngLens === 0) kind = 'fn';
  else kind = 'mismatch';
  results.push({ mode, scenario, component, expected: groundTruth, actual: ngLens, kind });
}

for (const { mode, url } of MODES) {
  test.describe(`ngLens E2E accuracy — ${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(url);
      await page.waitForFunction(() => (window as any).__ngAppReady === true, { timeout: 15_000 });
      await page.waitForFunction(() => !!window.__nglensE2E, { timeout: 15_000 });
      await page.evaluate(() => window.__nglensE2E.start());
      await page.waitForTimeout(300);
      expect(errors, 'no page errors during bootstrap').toEqual([]);
    });

    async function measure(
      page: import('@playwright/test').Page,
      steps: () => Promise<void>,
    ): Promise<{ ngLens: Counts; groundTruth: Counts }> {
      await page.evaluate(() => window.__nglensE2E.reset());
      await steps();
      await page.waitForTimeout(400);
      return page.evaluate(() => ({
        ngLens: window.__nglensE2E.getNgLensCounts(),
        groundTruth: window.__nglensE2E.getGroundTruth(),
      }));
    }

    test('own-trigger: component updates its own signal', async ({ page }) => {
      const { ngLens, groundTruth } = await measure(page, async () => {
        for (let i = 0; i < 3; i++) { await page.click('#own-btn'); await page.waitForTimeout(80); }
      });
      compare(mode, 'own-trigger', 'OwnTriggerComponent', groundTruth['OwnTriggerComponent'] ?? 0, ngLens['OwnTriggerComponent'] ?? 0);
    });

    test('parent-cascade: parent bump re-renders default-CD child', async ({ page }) => {
      const { ngLens, groundTruth } = await measure(page, async () => {
        for (let i = 0; i < 3; i++) { await page.click('#parent-btn'); await page.waitForTimeout(80); }
      });
      compare(mode, 'parent-cascade', 'ParentCascadeComponent', groundTruth['ParentCascadeComponent'] ?? 0, ngLens['ParentCascadeComponent'] ?? 0);
      compare(mode, 'parent-cascade', 'CascadeChildComponent', groundTruth['CascadeChildComponent'] ?? 0, ngLens['CascadeChildComponent'] ?? 0);
    });

    test('onpush-stable: OnPush child must NOT re-render on unrelated parent bump', async ({ page }) => {
      const { ngLens, groundTruth } = await measure(page, async () => {
        for (let i = 0; i < 3; i++) { await page.click('#onpush-btn'); await page.waitForTimeout(80); }
      });
      compare(mode, 'onpush-stable', 'OnPushStableComponent', groundTruth['OnPushStableComponent'] ?? 0, ngLens['OnPushStableComponent'] ?? 0);
      compare(mode, 'onpush-stable', 'OnPushParentComponent', groundTruth['OnPushParentComponent'] ?? 0, ngLens['OnPushParentComponent'] ?? 0);
    });
  });
}

test.afterAll(async () => {
  const byMode = (m: string) => results.filter(r => r.mode === m);
  const summarize = (rows: typeof results) => {
    const total = rows.length;
    const matches = rows.filter(r => r.kind === 'match').length;
    const fp = rows.filter(r => r.kind === 'fp').length;
    const fn = rows.filter(r => r.kind === 'fn').length;
    const mismatch = rows.filter(r => r.kind === 'mismatch').length;
    const pct = total > 0 ? Math.round((matches / total) * 100) : 0;
    return { total, matches, fp, fn, mismatch, pct };
  };

  const lines: string[] = [];
  for (const { mode } of MODES) {
    const rows = byMode(mode);
    const s = summarize(rows);
    lines.push(`\n  ── ${mode.toUpperCase()} ──  ${s.matches}/${s.total} match (${s.pct}%) · FP=${s.fp} · FN=${s.fn} · mismatch=${s.mismatch}`);
    for (const r of rows) {
      lines.push(`    [${r.kind.toUpperCase().padEnd(8)}] ${r.scenario}/${r.component}: ground-truth=${r.expected} ngLens=${r.actual}`);
    }
  }

  const overall = summarize(results);
  const machine = {
    overallMatchPct: overall.pct,
    byMode: Object.fromEntries(MODES.map(({ mode }) => [mode, summarize(byMode(mode))])),
    results,
  };

  // eslint-disable-next-line no-console
  console.log(
    '\n=== ngLens END-TO-END MEASURED ACCURACY (instrumentation layer) ===' +
    lines.join('\n') +
    `\n\n  OVERALL: ${overall.matches}/${overall.total} (${overall.pct}%) · FP=${overall.fp} · FN=${overall.fn}` +
    '\n  Machine-readable: ' + JSON.stringify(machine) +
    '\n'
  );
});

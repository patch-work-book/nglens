import { describe, it, expect } from 'vitest';
import { computeFocusChain } from './focus-chain';

describe('computeFocusChain — evidence-only focus set', () => {
  it('includes self + ancestors + descendants', () => {
    const fc = computeFocusChain('sel', ['a1', 'a2'], ['d1']);
    expect([...fc.ids].sort()).toEqual(['a1', 'a2', 'd1', 'sel']);
    expect(fc.hasRelationship).toBe(true);
  });

  it('NEGATIVE: no edges → just self, hasRelationship false (UI shows "no causal relationship observed")', () => {
    const fc = computeFocusChain('sel', [], []);
    expect([...fc.ids]).toEqual(['sel']);
    expect(fc.hasRelationship).toBe(false);
  });

  it('treats ancestors/descendants that only contain the selection as no relationship', () => {
    // getAncestors returns the node itself as the chain root when isolated.
    const fc = computeFocusChain('sel', ['sel'], []);
    expect([...fc.ids]).toEqual(['sel']);
    expect(fc.hasRelationship).toBe(false);
  });

  it('empty selection → empty set, no relationship', () => {
    expect(computeFocusChain(null, ['a'], ['d']).ids.size).toBe(0);
    expect(computeFocusChain(undefined, [], []).hasRelationship).toBe(false);
  });

  it('de-dupes overlapping ancestor/descendant ids', () => {
    const fc = computeFocusChain('sel', ['x'], ['x', 'y']);
    expect([...fc.ids].sort()).toEqual(['sel', 'x', 'y']);
  });

  it('never adds a node not present in the provided (real) traversal arrays', () => {
    // The helper only ever unions what the graph traversal supplied — it cannot
    // invent an unrelated id.
    const fc = computeFocusChain('sel', ['a'], ['b']);
    expect(fc.ids.has('unrelated')).toBe(false);
  });
});

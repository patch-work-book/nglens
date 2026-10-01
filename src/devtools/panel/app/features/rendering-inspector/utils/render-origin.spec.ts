import { describe, it, expect } from 'vitest';
import { classifyRenderOrigin } from './render-origin';

describe('classifyRenderOrigin', () => {
  it('classifies a signal cause as own-trigger with High confidence', () => {
    const r = classifyRenderOrigin({ signal: 3 });
    expect(r.ownRenders).toBe(3);
    expect(r.parentRenders).toBe(0);
    expect(r.unknownRenders).toBe(0);
    expect(r.ownConfidence).toBe('high');
  });

  it('classifies an input cause as own-trigger', () => {
    const r = classifyRenderOrigin({ input: 2 });
    expect(r.ownRenders).toBe(2);
    expect(r.unknownRenders).toBe(0);
  });

  it('classifies a parent cause as parent-propagation and NEVER above Medium confidence', () => {
    const r = classifyRenderOrigin({ parent: 5 });
    expect(r.parentRenders).toBe(5);
    expect(r.ownRenders).toBe(0);
    // The core accuracy guarantee: inferred parent relationship is capped at medium.
    expect(r.parentConfidence).toBe('medium');
    expect(r.parentConfidence).not.toBe('high');
  });

  it('treats a bare zone cause (no interaction source) as unknown', () => {
    const r = classifyRenderOrigin({ zone: 4 }, 'setTimeout');
    expect(r.unknownRenders).toBe(4);
    expect(r.ownRenders).toBe(0);
    expect(r.parentRenders).toBe(0);
  });

  it('treats an interaction-sourced zone cause as own-trigger', () => {
    const r = classifyRenderOrigin({ zone: 2 }, 'addEventListener:click');
    expect(r.ownRenders).toBe(2);
    expect(r.unknownRenders).toBe(0);
  });

  it('recognises click / input / keydown interaction sources', () => {
    expect(classifyRenderOrigin({ zone: 1 }, 'click').ownRenders).toBe(1);
    expect(classifyRenderOrigin({ zone: 1 }, 'input event').ownRenders).toBe(1);
    expect(classifyRenderOrigin({ zone: 1 }, 'keydown').ownRenders).toBe(1);
  });

  it('partitions a mixed histogram so buckets sum to the total renders', () => {
    const breakdown = { signal: 2, parent: 3, zone: 1 }; // bare zone -> unknown
    const total = 6;
    const r = classifyRenderOrigin(breakdown, 'setInterval');
    expect(r.ownRenders + r.parentRenders + r.unknownRenders).toBe(total);
    expect(r.ownRenders).toBe(2);
    expect(r.parentRenders).toBe(3);
    expect(r.unknownRenders).toBe(1);
  });

  it('handles an empty histogram without throwing', () => {
    const r = classifyRenderOrigin({});
    expect(r.ownRenders).toBe(0);
    expect(r.parentRenders).toBe(0);
    expect(r.unknownRenders).toBe(0);
  });

  it('counts manual-cd as an own-trigger', () => {
    const r = classifyRenderOrigin({ 'manual-cd': 2 });
    expect(r.ownRenders).toBe(2);
  });
});

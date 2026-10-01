import { describe, it, expect } from 'vitest';
import {
  evidenceForEdgeType,
  evidenceForEdge,
  strongestEdge,
} from './story-evidence';
import type { GraphEdge } from '@nglens/types/execution-graph';

function edge(type: GraphEdge['type'], confidence: number): GraphEdge {
  return { id: `${type}-${confidence}`, sourceId: 'a', targetId: 'b', type, confidence, latency: 0, reason: '' };
}

describe('story-evidence — honest edge → evidence mapping', () => {
  it('maps an explicit captured link to Observed', () => {
    // 'triggered' is only ever produced from a real causedByEventId.
    expect(evidenceForEdgeType('triggered', 1.0).level).toBe('observed');
  });

  it('maps subscriber/render relationships to Correlated (not Observed)', () => {
    expect(evidenceForEdgeType('consumed', 0.85).level).toBe('correlated');
    expect(evidenceForEdgeType('rendered', 0.8).level).toBe('correlated');
  });

  it('maps a DOM render cascade to Inferred and labels it "from DOM"', () => {
    // DOM nesting does NOT prove Angular runtime causality (spec §10).
    const v = evidenceForEdgeType('cascaded', 0.9);
    expect(v.level).toBe('inferred');
    expect(v.label.toLowerCase()).toContain('dom');
  });

  it('maps timing/sequential relationships to Inferred (never Observed)', () => {
    // Temporal proximity does not prove causality.
    expect(evidenceForEdgeType('correlated', 0.7).level).toBe('inferred');
    expect(evidenceForEdgeType('sequential', 0.5).level).toBe('inferred');
  });

  it('NEGATIVE CAUSALITY: no edge → Unknown, never a fabricated arrow', () => {
    expect(evidenceForEdge(null).level).toBe('unknown');
    expect(evidenceForEdge(undefined).level).toBe('unknown');
  });

  it('never returns Observed for a purely timing-derived edge even at high confidence', () => {
    // A high heuristic confidence must NOT be laundered into "Observed".
    expect(evidenceForEdgeType('correlated', 0.99).level).not.toBe('observed');
    expect(evidenceForEdgeType('cascaded', 0.99).level).not.toBe('observed');
  });

  describe('strongestEdge — prefers the best-supported relationship', () => {
    it('picks the higher evidence level over a higher confidence', () => {
      // A 'consumed' (Correlated) beats a 'correlated' (Inferred) even if the
      // inferred one has higher raw confidence.
      const best = strongestEdge([edge('correlated', 0.95), edge('consumed', 0.6)]);
      expect(best?.type).toBe('consumed');
    });

    it('breaks ties within a level by confidence', () => {
      const best = strongestEdge([edge('correlated', 0.5), edge('correlated', 0.7)]);
      expect(best?.confidence).toBe(0.7);
    });

    it('returns null for no edges', () => {
      expect(strongestEdge([])).toBeNull();
      expect(strongestEdge(undefined)).toBeNull();
    });
  });
});

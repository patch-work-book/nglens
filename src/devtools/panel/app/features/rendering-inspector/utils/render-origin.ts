/**
 * Pure render-origin classification.
 *
 * Extracted from the rendering inspector so it can be unit-tested in isolation.
 * This is the CORE of ngLens's accuracy claim: it must NEVER present an inferred
 * (DOM-nesting) relationship as high confidence, and confidence must be a
 * judgment about evidence — not the percentage of renders in a bucket.
 */

export type OriginKey = 'own-trigger' | 'parent-propagation' | 'external' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';

export interface OriginPartition {
  ownRenders: number;
  parentRenders: number;
  unknownRenders: number;
  /** Confidence for the parent-propagation attribution (never above medium). */
  parentConfidence: Confidence;
  /** Confidence for own-trigger attribution. */
  ownConfidence: Confidence;
}

/**
 * Partition a component's render count into origin buckets from its observed
 * cause histogram. `causeBreakdown` keys are RenderCause types
 * ('signal' | 'input' | 'zone' | 'parent' | 'manual-cd').
 *
 * @param causeBreakdown histogram of observed causes across the component's renders
 * @param causeSource    the cause source string (used to tell interaction-zone from bare-zone)
 */
export function classifyRenderOrigin(
  causeBreakdown: Record<string, number>,
  causeSource = '',
): OriginPartition {
  const b = causeBreakdown ?? {};
  const src = (causeSource ?? '').toLowerCase();

  const parentRenders = b['parent'] ?? 0;
  const signalRenders = (b['signal'] ?? 0) + (b['input'] ?? 0) + (b['manual-cd'] ?? 0);
  const zoneRenders = b['zone'] ?? 0;

  // A zone cause that originates from a real user interaction is an own-trigger;
  // a bare zone cause with no attributable source is unknown.
  const interactionZone =
    zoneRenders > 0 &&
    (src.includes('addeventlistener') ||
      src.includes('click') ||
      src.includes('input') ||
      src.includes('keydown'));

  const ownRenders = signalRenders + (interactionZone ? zoneRenders : 0);
  const unknownRenders = interactionZone ? 0 : zoneRenders;

  return {
    ownRenders,
    parentRenders,
    unknownRenders,
    // Parent propagation is inferred from same-cycle co-occurrence — never High.
    parentConfidence: 'medium',
    ownConfidence: 'high',
  };
}

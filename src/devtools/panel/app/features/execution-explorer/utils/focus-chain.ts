/**
 * Focus chain — the "select → follow" trust set.
 *
 * Given a selected event and its graph ancestors + descendants (from the real
 * ExecutionGraph traversal — NOT timing guesses beyond what the graph already
 * encoded), this computes the set of event ids that make up the focused chain.
 *
 * TRUST RULE: the focus set contains ONLY the selected event plus events reached
 * through real graph edges. If the selected event has no edges, the set is just
 * itself and `hasRelationship` is false — the UI must then say
 * "No causal relationship observed." rather than pretend a chain exists.
 *
 * Pure + unit-tested; the report supplies the ancestor/descendant ids from
 * ExecutionGraphEngineService.getAncestors / getDescendants.
 */

export interface FocusChain {
  /** All event ids in the focused chain (self + real ancestors + descendants). */
  ids: Set<string>;
  /** True when at least one related event exists beyond the selection itself. */
  hasRelationship: boolean;
}

export function computeFocusChain(
  selectedEventId: string | null | undefined,
  ancestorIds: readonly string[] | undefined | null,
  descendantIds: readonly string[] | undefined | null,
): FocusChain {
  const ids = new Set<string>();
  if (!selectedEventId) return { ids, hasRelationship: false };

  ids.add(selectedEventId);
  for (const a of ancestorIds ?? []) if (a) ids.add(a);
  for (const d of descendantIds ?? []) if (d) ids.add(d);

  // A relationship exists only if the chain reaches beyond the selection itself.
  return { ids, hasRelationship: ids.size > 1 };
}

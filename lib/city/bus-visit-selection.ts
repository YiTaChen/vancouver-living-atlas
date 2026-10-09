import type { BusVisitSnapshot } from './bus-visit';

/** Resolve every visible selection and action against the active vehicle's
 * anchors. Saved choices may belong to a different cabin source or old visit. */
export function busVisitSelectedAnchor(
  snapshot: Pick<BusVisitSnapshot, 'aboard' | 'viewAnchor' | 'anchors'> | null,
  choice: string | null,
): string | null {
  const anchors = snapshot?.anchors ?? [];
  const preferred = snapshot?.aboard ? [snapshot.viewAnchor, choice] : [choice];
  for (const id of preferred)
    if (id && anchors.some((anchor) => anchor.id === id)) return id;
  return (
    anchors.find(
      (anchor) => anchor.kind === 'standing' && anchor.datum === 'feet',
    )?.id ??
    anchors[0]?.id ??
    null
  );
}

/** Combine exact, contiguous source fragments of one explicitly numbered block.
 * No centreline snapping, street-wide merging, or coordinate interpolation.
 */
export type BlockPoint = readonly [number, number];
export interface NumberedRoadInput {
  id: string;
  name: string;
  width: number;
  points: readonly BlockPoint[];
  level?: string;
}
export interface NumberedBlock {
  name: string;
  baseName: string;
  sourceIds: string[];
  width: number;
  points: BlockPoint[];
  length: number;
  sources: {
    id: string;
    startStation: number;
    endStation: number;
    reversed: boolean;
  }[];
}
const key = (p: BlockPoint) => `${p[0]},${p[1]}`;
const dist = (a: BlockPoint, b: BlockPoint) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const length = (points: readonly BlockPoint[]) =>
  points.slice(1).reduce((s, p, i) => s + dist(points[i], p), 0);

export function groupNumberedBlocks(
  roads: readonly NumberedRoadInput[],
  allowedBaseNames: readonly string[] = ['WATER ST', 'ROBSON ST'],
  maxBlockLength = 450,
): {
  blocks: NumberedBlock[];
  rejected: { ids: string[]; reason: string }[];
  ignored: string[];
} {
  if (!Number.isFinite(maxBlockLength) || maxBlockLength <= 0)
    throw new Error('Invalid block length guard');
  const groups = new Map<
    string,
    { name: string; baseName: string; roads: NumberedRoadInput[] }
  >();
  const ignored: string[] = [],
    rejected: { ids: string[]; reason: string }[] = [],
    blocks: NumberedBlock[] = [];
  const allowed = new Set(
    allowedBaseNames.map((s) => s.trim().replace(/\s+/g, ' ').toUpperCase()),
  );
  const ids = new Set<string>();
  for (const road of roads) {
    if (ids.has(road.id)) throw new Error(`Duplicate source id ${road.id}`);
    ids.add(road.id);
    const name = road.name
      .trim()
      .replace(/[–—]/g, '-')
      .replace(/\s*-\s*/g, '-')
      .replace(/\s+/g, ' ')
      .toUpperCase();
    const match = name.match(/^(\d+(?:-\d+)?) (.+)$/);
    if (!match || !allowed.has(match[2])) {
      ignored.push(road.id);
      continue;
    }
    if (
      road.points.length < 2 ||
      road.points.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
      !Number.isFinite(road.width) ||
      road.width <= 0
    ) {
      rejected.push({ ids: [road.id], reason: 'invalid-source' });
      continue;
    }
    // Different numbered labels, source widths and topology levels stay apart.
    const k = `${name}|${road.width}|${road.level ?? 'ground'}`;
    const g = groups.get(k) ?? { name, baseName: match[2], roads: [] };
    g.roads.push(road);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const ordered = [...g.roads].sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    const adjacency = new Map<string, NumberedRoadInput[]>();
    for (const road of ordered)
      for (const point of [road.points[0], road.points.at(-1)!]) {
        const k = key(point),
          list = adjacency.get(k) ?? [];
        list.push(road);
        adjacency.set(k, list);
      }
    const consumed = new Set<string>();
    for (const seed of ordered) {
      if (consumed.has(seed.id)) continue;
      const component: NumberedRoadInput[] = [],
        queue = [seed];
      consumed.add(seed.id);
      while (queue.length) {
        const r = queue.pop()!;
        component.push(r);
        for (const point of [r.points[0], r.points.at(-1)!])
          for (const other of adjacency.get(key(point)) ?? []) {
            if (!consumed.has(other.id)) {
              consumed.add(other.id);
              queue.push(other);
            }
          }
      }
      const sourceIds = component
        .map((r) => r.id)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (component.length < 2) {
        rejected.push({ ids: sourceIds, reason: 'no-exact-contiguous-peer' });
        continue;
      }
      const nodeKeys = new Set(
        component.flatMap((r) => [key(r.points[0]), key(r.points.at(-1)!)]),
      );
      const ends = [...nodeKeys].filter((k) => adjacency.get(k)!.length === 1);
      if (
        ends.length !== 2 ||
        [...nodeKeys].some((k) => adjacency.get(k)!.length > 2)
      ) {
        rejected.push({ ids: sourceIds, reason: 'branch-or-loop' });
        continue;
      }
      if (
        component.some((r) => length(r.points) < 1e-7) ||
        component.reduce((s, r) => s + length(r.points), 0) > maxBlockLength
      ) {
        rejected.push({ ids: sourceIds, reason: 'degenerate-or-too-long' });
        continue;
      }
      const first = ordered.find((r) => sourceIds.includes(r.id))!;
      let current = ends.includes(key(first.points[0]))
        ? key(first.points[0])
        : ends.includes(key(first.points.at(-1)!))
          ? key(first.points.at(-1)!)
          : ends.sort()[0];
      const seen = new Set<string>(),
        points: BlockPoint[] = [],
        sources: NumberedBlock['sources'] = [];
      let station = 0;
      while (seen.size < component.length) {
        const next = (adjacency.get(current) ?? []).find(
          (r) => !seen.has(r.id),
        );
        if (!next) break;
        seen.add(next.id);
        const reversed = key(next.points[0]) !== current,
          ps = reversed ? [...next.points].reverse() : [...next.points];
        const endStation = station + length(ps);
        sources.push({
          id: next.id,
          startStation: station,
          endStation,
          reversed,
        });
        station = endStation;
        points.push(...(points.length ? ps.slice(1) : ps));
        current = key(ps.at(-1)!);
      }
      if (seen.size !== component.length) {
        rejected.push({ ids: sourceIds, reason: 'incomplete-chain' });
        continue;
      }
      blocks.push({
        name: g.name,
        baseName: g.baseName,
        sourceIds: sources.map((s) => s.id),
        width: first.width,
        points,
        length: station,
        sources,
      });
    }
  }
  return {
    blocks: blocks.sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.sourceIds[0].localeCompare(b.sourceIds[0]),
    ),
    rejected,
    ignored,
  };
}

/** Original MIT. Immutable AABB broad phase preserving source iteration order.
 * No polygon/triangle arithmetic changes. XZ metre bounds [minX,minZ,maxX,maxZ].
 */
export function orderedBounds<T>(
  items: readonly T[],
  boundsOf: (item: T) => readonly number[],
  cellSize = 24,
  epsilon = 1e-8,
) {
  if (
    !(cellSize > 0) ||
    !Number.isFinite(cellSize) ||
    epsilon < 0 ||
    !Number.isFinite(epsilon)
  )
    throw new Error('Invalid bounds index');
  const cells = new Map<string, number[]>(),
    wide: number[] = [];
  const bounds = items.map((item) => boundsOf(item));
  const intersects = (a: readonly number[], b: readonly number[]) =>
    a[0] <= b[2] + epsilon &&
    a[2] >= b[0] - epsilon &&
    a[1] <= b[3] + epsilon &&
    a[3] >= b[1] - epsilon;
  const range = (b: readonly number[], pad: number) => [
    Math.floor((b[0] - pad) / cellSize),
    Math.floor((b[1] - pad) / cellSize),
    Math.floor((b[2] + pad) / cellSize),
    Math.floor((b[3] + pad) / cellSize),
  ];
  bounds.forEach((b, i) => {
    if (
      b.length !== 4 ||
      !b.every(Number.isFinite) ||
      b[0] > b[2] ||
      b[1] > b[3]
    )
      throw new Error('Invalid indexed bounds');
    const [x0, z0, x1, z1] = range(b, epsilon);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) {
      wide.push(i);
      return;
    }
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const key = `${x}:${z}`,
          list = cells.get(key) ?? [];
        list.push(i);
        cells.set(key, list);
      }
  });
  return {
    query(b: readonly number[]): T[] {
      if (
        b.length !== 4 ||
        !b.every(Number.isFinite) ||
        b[0] > b[2] ||
        b[1] > b[3]
      )
        throw new Error('Invalid query bounds');
      const [x0, z0, x1, z1] = range(b, 0);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096)
        return items.filter((_, i) => intersects(b, bounds[i]));
      let ids: readonly number[];
      if (x0 === x1 && z0 === z1 && !wide.length)
        ids = cells.get(`${x0}:${z0}`) ?? [];
      else {
        const seen = new Set(wide);
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++)
            for (const id of cells.get(`${x}:${z}`) ?? []) seen.add(id);
        ids = [...seen].sort((a, b) => a - b);
      }
      return ids.filter((i) => intersects(b, bounds[i])).map((i) => items[i]);
    },
  };
}

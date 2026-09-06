/** Original exact 3D top-K over a static local-XZ grid. Stable source-order ties
 * match Array.sort's existing behaviour; tree coordinates are never moved. */
export interface TreePoint {
  x: number;
  z: number;
  y: number;
  h: number;
}
export interface TreeCandidate<T> {
  t: T;
  d: number;
  ordinal: number;
}
interface Cell<T> {
  values: TreeCandidate<T>[];
  minY: number;
  maxY: number;
  gx: number;
  gz: number;
}
const worse = <T>(a: TreeCandidate<T>, b: TreeCandidate<T>) =>
  a.d > b.d || (a.d === b.d && a.ordinal > b.ordinal);
export class TreeSelection<T extends TreePoint> {
  private cells = new Map<string, Cell<T>>();
  stats = { cells: 0, tested: 0, within: 0, kept: 0 };
  constructor(
    trees: readonly T[],
    readonly cellSize = 96,
  ) {
    if (!Number.isFinite(cellSize) || cellSize <= 0)
      throw new Error('Invalid tree grid');
    trees.forEach((t, ordinal) => {
      if (![t.x, t.y, t.z, t.h].every(Number.isFinite)) return;
      const gx = Math.floor(t.x / cellSize),
        gz = Math.floor(t.z / cellSize),
        key = `${gx},${gz}`,
        y = t.y + t.h * 0.55;
      const cell = this.cells.get(key) || {
        values: [],
        minY: Infinity,
        maxY: -Infinity,
        gx,
        gz,
      };
      cell.values.push({ t, d: 0, ordinal });
      cell.minY = Math.min(cell.minY, y);
      cell.maxY = Math.max(cell.maxY, y);
      this.cells.set(key, cell);
    });
  }
  nearest(
    x: number,
    y: number,
    z: number,
    radius: number,
    limit: number,
  ): TreeCandidate<T>[] {
    this.stats = { cells: 0, tested: 0, within: 0, kept: 0 };
    if (
      ![x, y, z, radius, limit].every(Number.isFinite) ||
      radius <= 0 ||
      limit < 1
    )
      return [];
    limit = Math.floor(limit);
    const r2 = radius * radius,
      heap: TreeCandidate<T>[] = [];
    const siftDown = () => {
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        if (left >= heap.length) break;
        const right = left + 1,
          j =
            right < heap.length && worse(heap[right], heap[left])
              ? right
              : left;
        if (!worse(heap[j], heap[i])) break;
        [heap[i], heap[j]] = [heap[j], heap[i]];
        i = j;
      }
    };
    const visit = (cell: Cell<T> | undefined) => {
      if (!cell) return;
      const dx = Math.max(
          cell.gx * this.cellSize - x,
          0,
          x - (cell.gx + 1) * this.cellSize,
        ),
        dz = Math.max(
          cell.gz * this.cellSize - z,
          0,
          z - (cell.gz + 1) * this.cellSize,
        ),
        dy = Math.max(cell.minY - y, 0, y - cell.maxY);
      if (dx * dx + dy * dy + dz * dz >= r2) return;
      this.stats.cells++;
      for (const { t, ordinal } of cell.values) {
        this.stats.tested++;
        const d = (t.x - x) ** 2 + (t.y + t.h * 0.55 - y) ** 2 + (t.z - z) ** 2;
        if (d >= r2) continue;
        this.stats.within++;
        if (heap.length === limit) {
          const root = heap[0];
          if (d > root.d || (d === root.d && ordinal >= root.ordinal)) continue;
          heap[0] = { t, d, ordinal };
          siftDown();
        } else {
          heap.push({ t, d, ordinal });
          let i = heap.length - 1;
          while (i) {
            const p = (i - 1) >> 1;
            if (!worse(heap[i], heap[p])) break;
            [heap[i], heap[p]] = [heap[p], heap[i]];
            i = p;
          }
        }
      }
    };
    const x0 = Math.floor((x - radius) / this.cellSize),
      x1 = Math.floor((x + radius) / this.cellSize),
      z0 = Math.floor((z - radius) / this.cellSize),
      z1 = Math.floor((z + radius) / this.cellSize);
    // Also bounded for an accidental huge query radius.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > this.cells.size * 4)
      for (const c of this.cells.values()) visit(c);
    else
      for (let gx = x0; gx <= x1; gx++)
        for (let gz = z0; gz <= z1; gz++) visit(this.cells.get(`${gx},${gz}`));
    heap.sort((a, b) => a.d - b.d || a.ordinal - b.ordinal);
    this.stats.kept = heap.length;
    return heap;
  }
}

/** Leaf success alone must not reveal a tree while its bark is pending. */
export class TreeAssetBarrier {
  private pending = new Set(['leaf', 'bark']);
  private failed = false;
  get ready() {
    return !this.failed && this.pending.size === 0;
  }
  settle(asset: 'leaf' | 'bark', success: boolean) {
    if (!this.pending.delete(asset)) return this.ready;
    this.failed ||= !success;
    return this.ready;
  }
}

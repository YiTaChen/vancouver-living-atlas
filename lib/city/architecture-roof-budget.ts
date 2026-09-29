import {
  architectureWork,
  type ArchitectureBox,
  type ArchitecturePart,
} from './architecture-plan';

function partPriority(
  part: ArchitecturePart,
  focus: readonly [number, number, number],
) {
  const ring = part.polygon[0];
  let twiceArea = 0,
    x = 0,
    z = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
    x += a[0] / ring.length;
    z += a[1] / ring.length;
  }
  const distance2 =
    (focus[0] - x) ** 2 +
    (focus[1] - part.ground - part.height) ** 2 +
    (focus[2] - z) ** 2;
  // A cell-width floor keeps tiny nearby roofs from displacing a large roof.
  return {
    part,
    x,
    z,
    score: Math.abs(twiceArea) / Math.max(220 ** 2, distance2),
  };
}

/** Two inexpensive equipment boxes reach each eligible roof before secondary
 * cornices/vents consume the cell budget. Remaining geometry favors projected
 * roof prominence. The same hard instance limit and cooperative yields apply;
 * deferred CPU descriptors are also capped, at twice the cell instance limit. */
export function* roofCellWork(
  parts: readonly ArchitecturePart[],
  limit: number,
  focus: readonly [number, number, number],
): Generator<ArchitectureBox | null> {
  const priority: ReturnType<typeof partPriority>[] = [];
  for (const part of parts) {
    priority.push(partPriority(part, focus));
    yield null;
  }
  priority.sort(
    (a, b) =>
      b.score - a.score ||
      a.part.key.localeCompare(b.part.key) ||
      b.part.height - a.part.height ||
      a.x - b.x ||
      a.z - b.z,
  );
  const deferred: {
    trim: ArchitectureBox[];
    work: Generator<ArchitectureBox | null>;
  }[] = [];
  const deferredLimit = Math.max(0, limit * 2);
  let deferredCount = 0,
    emitted = 0;
  try {
    for (const { part } of priority) {
      const trim: ArchitectureBox[] = [];
      const work = architectureWork([part], 'roof');
      deferred.push({ trim, work });
      let primary = 0;
      while (primary < 2) {
        const next = work.next();
        if (next.done) break;
        const box = next.value;
        if (!box) {
          // Preserve the plan's per-edge/candidate checkpoints. Prefix trim is
          // only up to three simple boxes per edge; do not add a second yield
          // for each stored box and triple the frame-count streaming floor.
          yield null;
        } else if (box.kind === 'equipment') {
          if (emitted >= limit) return;
          primary++;
          emitted++;
          yield box;
        } else if (deferredCount < deferredLimit) {
          trim.push(box);
          deferredCount++;
        }
      }
    }
    for (const { trim, work } of deferred) {
      for (const box of trim) {
        if (emitted >= limit) return;
        emitted++;
        yield box;
      }
      // Secondary equipment is planned only for roofs whose priority reaches
      // the remaining budget; paused lower-priority generators are discarded.
      for (const box of work) {
        if (emitted >= limit) return;
        if (box) emitted++;
        yield box;
      }
    }
  } finally {
    for (const { work } of deferred) work.return(undefined);
  }
}

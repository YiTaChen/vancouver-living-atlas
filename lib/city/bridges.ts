import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import { project } from './geo';
// Junction elevations are solved once over the measured approach graph. Every
// joining route uses the same node elevation rather than dropping to the ground.
export function createBridgeApproaches(e: CityEngine) {
  e.data.bridgeSurfaces = [];
  const d = e.data.bridges;
  if (!d) return;
  const heights = new Map<string, number>(),
    fixed = new Set<string>(),
    adj = new Map<string, { id: string; weight: number }[]>();
  for (const n of d.nodes) {
    const [x, z] = project(n.coord),
      ground = e.elevation(x, z) + 1.12;
    heights.set(
      n.id,
      n.heightRule === 'deck' ? n.estimatedDeckM + 1.95 : ground,
    );
    if (n.heightRule === 'deck' || n.heightRule === 'terrain') fixed.add(n.id);
    adj.set(n.id, []);
  }
  for (const f of d.features) {
    const p = f.properties,
      a = p.kind + ':' + p.startNode,
      b = p.kind + ':' + p.endNode;
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.push({ id: b, weight: 1 / Math.max(1, p.lengthM) });
      adj.get(b)!.push({ id: a, weight: 1 / Math.max(1, p.lengthM) });
    }
  }
  for (let j = 0; j < 150; j++)
    for (const [id, ns] of adj)
      if (!fixed.has(id) && ns.length) {
        let w = 0,
          v = 0;
        ns.forEach((n) => {
          w += n.weight;
          v += heights.get(n.id)! * n.weight;
        });
        heights.set(id, v / w);
      }
  for (const s of d.mainSpines) {
    const width = s.kind === 'lions' ? 17 : s.kind === 'granville' ? 24 : 22;
    e.data.bridgeSurfaces.push({
      name:
        {
          lions: 'Lions Gate Bridge',
          granville: 'Granville Bridge',
          burrard: 'Burrard Bridge',
          cambie: 'Cambie Bridge',
        }[s.kind as string] || '',
      a: project(s.start),
      b: project(s.end),
      h0: s.estimatedDeckM + 1.95,
      h1: s.estimatedDeckM + 1.95,
      width,
    });
  }
  const road: number[] = [],
    edge: number[] = [],
    deck: number[] = [];
  for (const f of d.features) {
    const p = f.properties;
    if (p.role === 'main') continue;
    const ps = f.geometry.coordinates.map(project),
      h0 = heights.get(p.kind + ':' + p.startNode) || 0,
      h1 = heights.get(p.kind + ':' + p.endNode) || 0,
      total = p.lengthM;
    let done = 0;
    for (let i = 0; i < ps.length - 1; i++) {
      const a = ps[i],
        b = ps[i + 1],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.1) continue;
      const px = (b[1] - a[1]) / len,
        pz = -(b[0] - a[0]) / len,
        width = p.roadWidthM || 18,
        steps = Math.ceil(len / 15);
      for (let j = 0; j < steps; j++) {
        const t = j / steps,
          u = (j + 1) / steps,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t,
          xx = a[0] + (b[0] - a[0]) * u,
          zz = a[1] + (b[1] - a[1]) * u,
          y =
            p.role === 'causeway'
              ? e.elevation(x, z) + 1.05
              : THREE.MathUtils.lerp(h0, h1, (done + t * len) / total),
          yy =
            p.role === 'causeway'
              ? e.elevation(xx, zz) + 1.05
              : THREE.MathUtils.lerp(h0, h1, (done + u * len) / total);
        e.data.bridgeSurfaces.push({
          name:
            p.name ||
            (
              {
                lions: 'Lions Gate Bridge',
                granville: 'Granville Bridge',
                burrard: 'Burrard Bridge',
                cambie: 'Cambie Bridge',
              } as Record<string, string>
            )[p.kind] ||
            '',
          a: [x, z],
          b: [xx, zz],
          h0: y + 0.06,
          h1: yy + 0.06,
          width,
        });
        for (const [w, offset, dest] of [
          [width + 3, 0.02, edge],
          [width, 0.06, road],
        ] as [number, number, number[]][]) {
          for (const q of [
            [x - (px * w) / 2, y, z - (pz * w) / 2],
            [x + (px * w) / 2, y, z + (pz * w) / 2],
            [xx + (px * w) / 2, yy, zz + (pz * w) / 2],
            [x - (px * w) / 2, y, z - (pz * w) / 2],
            [xx + (px * w) / 2, yy, zz + (pz * w) / 2],
            [xx - (px * w) / 2, yy, zz - (pz * w) / 2],
          ])
            dest.push(q[0], q[1] + offset, q[2]);
        }
        if (p.role === 'approach')
          for (const sign of [-1, 1]) {
            const dx = ((px * (width + 3)) / 2) * sign,
              dz = ((pz * (width + 3)) / 2) * sign;
            for (const q of [
              [x + dx, y - 2, z + dz],
              [x + dx, y, z + dz],
              [xx + dx, yy, zz + dz],
              [x + dx, y - 2, z + dz],
              [xx + dx, yy, zz + dz],
              [xx + dx, yy - 2, zz + dz],
            ])
              deck.push(...q);
          }
      }
      done += len;
    }
  }
  for (const [pos, color] of [
    [road, 0x566669],
    [edge, 0xb3b4a3],
    [deck, 0x929d97],
  ] as [number[], number][]) {
    const m = new THREE.Mesh(
      e.geometry(pos),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.86,
        side: THREE.DoubleSide,
      }),
    );
    m.receiveShadow = true;
    m.castShadow = true;
    e.roads.add(m);
  }
  e.data.bridgeNodeHeights = Object.fromEntries(heights);
}

/** Resolve only locally reachable bridge surfaces so an underpass cannot teleport upward. */
export function bridgeSurface(
  e: CityEngine,
  x: number,
  z: number,
  previousY?: number,
): number | undefined {
  let best: number | undefined,
    distance = Infinity;
  for (const s of e.data.bridgeSurfaces || []) {
    const dx = s.b[0] - s.a[0],
      dz = s.b[1] - s.a[1],
      length2 = dx * dx + dz * dz,
      t = Math.max(
        0,
        Math.min(1, ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / length2),
      ),
      d = Math.hypot(x - s.a[0] - t * dx, z - s.a[1] - t * dz),
      y = s.h0 + (s.h1 - s.h0) * t;
    if (
      d < s.width / 2 - 0.65 &&
      d < distance &&
      (previousY === undefined || Math.abs(y - previousY) < 4)
    ) {
      best = y;
      distance = d;
    }
  }
  return best;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rings, project } from './geo';
import { fitBays, windowRows, type Profile } from './facade-profile';
import { replacedBuilding } from './replaced-buildings';
import type { CityEngine } from './engine';

type Facade = {
  r: number[][];
  x: number;
  z: number;
  ground: number;
  h: number;
  min: number;
  profile: Profile;
};
type Cell = {
  items: Facade[];
  bounds: THREE.Box3;
  mesh: THREE.Mesh | null;
  used: number;
};
/** Nearby architectural accents. Measured foundations are shared with the city body. */
export class FacadeDetails {
  cells: Cell[] = [];
  material = new THREE.MeshStandardMaterial({
    color: 0xbdc8c2,
    roughness: 0.58,
    metalness: 0.17,
  });
  last = new THREE.Vector3(Infinity, Infinity, Infinity);
  quality = '';
  tick = 0;
  constructor(
    private e: CityEngine,
    foundations: Map<string, number>,
  ) {
    const cells = new Map<string, Cell>();
    for (const f of e.data.buildings.features) {
      const p = f.properties,
        h = Number(p.height),
        min = Number(p.minHeight) || 0;
      if (h < 36 || h > 190 || replacedBuilding(p)) continue;
      const foundation = foundations.get(
        String(p.structureId ?? p.buildingId ?? p.id),
      );
      const profile = (e.data.buildingProfiles as Map<string, Profile>).get(
        String(p.structureId ?? p.buildingId ?? p.id),
      );
      if (foundation === undefined || !profile) continue;
      for (const polygon of rings(f)) {
        const r = polygon[0].slice(0, -1).map(project);
        if (r.length < 3 || r.length > 18) continue;
        const x = r.reduce((s, q) => s + q[0], 0) / r.length,
          z = r.reduce((s, q) => s + q[1], 0) / r.length;
        const key = Math.floor(x / 180) + ',' + Math.floor(z / 180);
        if (!cells.has(key))
          cells.set(key, {
            items: [],
            bounds: new THREE.Box3(),
            mesh: null,
            used: 0,
          });
        const cell = cells.get(key)!;
        cell.items.push({ r, x, z, ground: foundation, h, min, profile });
        for (const p of r) {
          cell.bounds.expandByPoint(
            new THREE.Vector3(p[0], foundation + min, p[1]),
          );
          cell.bounds.expandByPoint(
            new THREE.Vector3(p[0], foundation + h, p[1]),
          );
        }
      }
    }
    this.cells = [...cells.values()];
  }
  build(cell: Cell) {
    const list: THREE.BufferGeometry[] = [];
    for (const { r, ground, h, min, profile } of cell.items) {
      const area = r.reduce((s, a, i) => {
        const b = r[(i + 1) % r.length];
        return s + a[0] * b[1] - b[0] * a[1];
      }, 0);
      const residential = profile.balconies;
      for (let edge = 0; edge < r.length; edge++) {
        const a = r[edge],
          b = r[(edge + 1) % r.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 8 || length > 100) continue;
        const nx = (area > 0 ? dz : -dz) / length,
          nz = (area > 0 ? -dx : dx) / length,
          yaw = -Math.atan2(dz, dx);
        const box = (
          width: number,
          height: number,
          depth: number,
          u: number,
          y: number,
          offset: number,
        ) => {
          const g = new THREE.BoxGeometry(width, height, depth);
          g.rotateY(yaw);
          g.translate(
            a[0] + dx * u + nx * offset,
            ground + y,
            a[1] + dz * u + nz * offset,
          );
          list.push(g);
        };
        const grid = fitBays(profile, length),
          balcony = residential && edge % 2 === 0 && length < 55;
        for (const row of windowRows(profile, {
          minHeightM: min,
          heightM: h,
        })) {
          const y = profile.groundStoreyM + row * profile.storeyM;
          if (y < min + 0.2) continue;
          if (balcony) {
            const span = grid.endM - grid.originM;
            box(span, 0.16, 1.15, 0.5, y, 0.48);
            box(span, 0.075, 0.075, 0.5, y + 1.05, 1.035);
            for (let j = 0; j <= grid.count; j++)
              box(
                0.065,
                1.05,
                0.065,
                (grid.originM + j * grid.pitchM) / length,
                y + 0.525,
                1.035,
              );
          } else box(length, 0.11, 0.13, 0.5, y, 0.035);
        }
        if (!residential)
          for (let j = 1; j < grid.count; j++)
            box(
              profile.frameWidthM,
              h - min - 0.4,
              profile.frameDepthM,
              (grid.originM + j * grid.pitchM) / length,
              (h + min) / 2,
              0.055,
            );
        box(length, 0.5, 0.35, 0.5, h - 0.1, 0.04);
      }
    }
    if (!list.length) return;
    const geometry = mergeGeometries(list)!;
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = 'Facade reveals and balconies';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cell.mesh = mesh;
    this.e.buildings.add(mesh);
  }
  update() {
    const q = this.e.settings.buildings ? this.e.settings.quality : 'balanced';
    if (
      q === this.quality &&
      this.last.distanceToSquared(this.e.camera.position) < 20 * 20
    )
      return;
    this.quality = q;
    this.last.copy(this.e.camera.position);
    this.tick++;
    const range = q === 'ultra' ? 550 : q === 'high' ? 160 : 0;
    const selected = range
      ? this.cells
          .map((c) => ({ c, d: c.bounds.distanceToPoint(this.last) }))
          .filter((p) => p.d < range)
          .sort((a, b) => a.d - b.d)
          .slice(0, 24)
          .map((p) => p.c)
      : [];
    const active = new Set(selected);
    for (const c of selected) {
      if (!c.mesh) this.build(c);
      c.used = this.tick;
    }
    for (const c of this.cells) if (c.mesh) c.mesh.visible = active.has(c);
    const cached = this.cells
      .filter((c) => c.mesh)
      .sort((a, b) => b.used - a.used);
    for (const c of cached.slice(32)) {
      this.e.buildings.remove(c.mesh!);
      c.mesh!.geometry.dispose();
      c.mesh = null;
    }
    this.e.renderer.shadowMap.needsUpdate = true;
  }
  dispose() {
    this.material.dispose();
  }
}

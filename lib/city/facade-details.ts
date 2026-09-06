import * as THREE from 'three';
import { rings, project } from './geo';
import type { Profile } from './facade-profile';
import { IncrementalFacadeQueue } from './facade-queue';
import {
  createFacadePagePreparation,
  createFacadePreparationMetrics,
} from './facade-page-preparation';
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
  id: string;
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
  readonly preparationMetrics = createFacadePreparationMetrics();
  queue: IncrementalFacadeQueue;
  constructor(
    private e: CityEngine,
    foundations: Map<string, number>,
  ) {
    this.queue = new IncrementalFacadeQueue(e.buildings, this.material, {
      onShadowDirty: () => {
        e.renderer.shadowMap.needsUpdate = true;
      },
      // Resolve lazily: the shared warmer is created before the first visible
      // frame, after FacadeDetails construction and loading-only composer warmup.
      preparePage: createFacadePagePreparation(
        () => this.e.landmarkWarmup,
        this.e.buildings,
        this.preparationMetrics,
      ),
    });
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
            id: key,
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
  update() {
    const q = this.e.settings.buildings ? this.e.settings.quality : 'balanced';
    if (
      q !== this.quality ||
      this.last.distanceToSquared(this.e.camera.position) >= 20 * 20
    ) {
      this.quality = q;
      this.last.copy(this.e.camera.position);
      const range = q === 'ultra' ? 550 : q === 'high' ? 160 : 0;
      const selected = range
        ? this.cells
            .map((c) => ({ c, d: c.bounds.distanceToPoint(this.last) }))
            .filter((p) => p.d < range)
            .sort((a, b) => a.d - b.d)
            .slice(0, 24)
        : [];
      // Geometry is identical at High/Ultra. Only selection distance changes.
      this.queue.select(
        selected.map(({ c, d }) => ({
          id: c.id,
          items: c.items,
          version: 'facade-v1',
          priority: d,
        })),
      );
    }
    // Pump stays OUTSIDE the camera threshold guard, including stationary frames.
    this.queue.pump();
  }
  dispose() {
    this.queue.dispose();
    this.material.dispose();
  }
}

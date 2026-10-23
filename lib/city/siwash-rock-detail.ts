import * as THREE from 'three';
import {
  createSiwashRock,
  SIWASH_ROCK_PLACEMENT,
  type SiwashRockLevel,
} from './assets/siwash-rock';
import { project } from './geo';
import type { VisualQuality } from './quality';

interface SiwashRockHost {
  landmarks: THREE.Group;
  camera: THREE.Camera;
  settings: { quality: VisualQuality; buildings: boolean };
  renderer: { shadowMap: { needsUpdate: boolean } };
}

// Distances are to the surface bounds, not the distant city origin. Balanced
// retains the authored medium silhouette nearby; Auto supplies effective quality.
const RANGES = {
  balanced: { medium: 420, high: 0 },
  high: { medium: 900, high: 240 },
  ultra: { medium: 1500, high: 700 },
} as const;
const HYSTERESIS = 1.18;

/** Three tiny prebuilt opaque levels; no worker, streaming or frame-time mesh work. */
export class SiwashRockDetail {
  readonly holder = new THREE.Group();
  readonly levels: Record<SiwashRockLevel, THREE.Group>;
  readonly bounds: THREE.Box3;
  private current: SiwashRockLevel = 'low';
  private disposed = false;

  constructor(private e: SiwashRockHost) {
    this.holder.name = 'Siwash Rock';
    const placement = SIWASH_ROCK_PLACEMENT;
    const [x, z] = project([placement.lon, placement.lat]);
    this.holder.position.set(x, placement.baseY, z);
    this.holder.rotation.y = placement.yaw;
    this.levels = {
      low: createSiwashRock('low'),
      medium: createSiwashRock('medium'),
      high: createSiwashRock('high'),
    };
    for (const [level, group] of Object.entries(this.levels)) {
      group.visible = level === this.current;
      this.holder.add(group);
    }
    e.landmarks.add(this.holder);
    this.holder.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.holder);
    this.update();
  }

  get activeLevel(): SiwashRockLevel {
    return this.current;
  }

  update() {
    if (this.disposed) return;
    const visible = this.e.settings.buildings;
    const range = RANGES[this.e.settings.quality];
    const distance = this.bounds.distanceToPoint(this.e.camera.position);
    const highRange = range.high * (this.current === 'high' ? HYSTERESIS : 1);
    const mediumRange =
      range.medium * (this.current !== 'low' ? HYSTERESIS : 1);
    const next =
      range.high > 0 && distance < highRange
        ? 'high'
        : distance < mediumRange
          ? 'medium'
          : 'low';
    if (next !== this.current || visible !== this.holder.visible)
      this.e.renderer.shadowMap.needsUpdate = true;
    this.holder.visible = visible;
    if (next !== this.current) {
      this.levels[this.current].visible = false;
      this.levels[next].visible = true;
      this.current = next;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Remove first: the engine's final generic scene disposal must not release
    // these resources a second time. The owner holds no global registries.
    this.holder.removeFromParent();
    for (const group of Object.values(this.levels))
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) material.dispose();
      });
    this.holder.clear();
  }
}

import * as THREE from 'three';
import {
  ROCKET_CONFIGS,
  rocketDirection,
  type RocketKind,
  type RocketState,
} from '../rocket-state';

type Piece = {
  pivot: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  spin: THREE.Vector3;
  corners: THREE.Vector3[];
};

/** Reuses the actual vehicle sections: no replacement boxes and no shared-city assets. */
export class RocketWreckageVisual {
  private pieces: Piece[] = [];
  private lastTime = 0;
  private explosionApplied = false;
  private center = new THREE.Vector3();
  private inverse = new THREE.Quaternion();
  constructor(
    private kind: RocketKind,
    private root: THREE.Group,
    private segments: THREE.Group[],
    private upperEngine: THREE.Group,
  ) {}

  update(
    state: RocketState,
    surface: (x: number, z: number) => number,
  ): THREE.Vector3 | null {
    const wreck = state.wreckage;
    if (!wreck) return null;
    const config = ROCKET_CONFIGS[this.kind];
    if (!this.pieces.length) {
      const d = rocketDirection(wreck.attitude);
      const rotation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(d.x, d.y, d.z),
      );
      this.upperEngine.removeFromParent();
      this.segments[3].add(this.upperEngine);
      this.segments.forEach((segment, i) => {
        if (!state.boosterAttached && i < 3) return;
        const height = config.height * (i < 5 ? 0.11 + i * 0.14 : 0.85);
        const pivot = new THREE.Group();
        pivot.name = `Ruptured rocket section ${i + 1}`;
        pivot.add(segment);
        segment.position.y = -height;
        this.root.add(pivot);
        pivot.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3();
        const local = pivot.matrixWorld.clone().invert();
        segment.traverse((object) => {
          if (!(object instanceof THREE.Mesh) || !object.castShadow) return;
          object.geometry.computeBoundingBox();
          if (object.geometry.boundingBox)
            bounds.union(
              object.geometry.boundingBox
                .clone()
                .applyMatrix4(local.clone().multiply(object.matrixWorld)),
            );
        });
        const corners: THREE.Vector3[] = [];
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              corners.push(new THREE.Vector3(x, y, z));
        const angle = i * 2.399 + state.seed;
        const kick =
          0.5 +
          Math.min(
            3,
            Math.hypot(wreck.velocity.x, wreck.velocity.y, wreck.velocity.z) *
              0.08,
          );
        this.pieces.push({
          pivot,
          position: new THREE.Vector3(0, height, 0)
            .applyQuaternion(rotation)
            .add(
              new THREE.Vector3(
                wreck.position.x,
                wreck.position.y,
                wreck.position.z,
              ),
            ),
          velocity: new THREE.Vector3(
            wreck.velocity.x * 0.2 + Math.sin(angle) * kick,
            Math.max(0.6, -wreck.velocity.y * 0.12) + i * 0.2,
            wreck.velocity.z * 0.2 + Math.cos(angle) * kick,
          ),
          rotation: rotation.clone(),
          spin: new THREE.Vector3(
            0.22 + i * 0.045,
            Math.sin(angle) * 0.16,
            Math.cos(angle) * 0.4 + wreck.angularVelocity.roll * 0.12,
          ),
          corners,
        });
      });
      // Airborne breakup carries its actual upward momentum. A collision instead
      // dissipates the normal velocity, allowing the shell to buckle and settle.
      if (wreck.cause !== 'impact')
        for (const p of this.pieces)
          p.velocity
            .set(wreck.velocity.x, wreck.velocity.y, wreck.velocity.z)
            .addScaledVector(p.spin, 5);
      this.lastTime = wreck.time;
    }
    if (wreck.explosionTime !== null && !this.explosionApplied) {
      this.explosionApplied = true;
      this.pieces.forEach((p, i) => {
        const angle = state.seed + i * 2.399;
        p.velocity.add(
          new THREE.Vector3(
            Math.sin(angle) * 8,
            4 + i * 0.65,
            Math.cos(angle) * 8,
          ),
        );
        p.spin.multiplyScalar(2.2);
      });
    }
    let remaining = Math.min(0.25, Math.max(0, state.elapsed - this.lastTime));
    this.lastTime = state.elapsed;
    while (remaining > 1e-6) {
      const dt = Math.min(1 / 60, remaining);
      remaining -= dt;
      for (const p of this.pieces) {
        p.velocity.y -= 9.81 * dt;
        p.position.addScaledVector(p.velocity, dt);
        p.rotation.multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt),
          ),
        );
        // Support the rotated shell, including fins and engine bells. A sphere
        // based on tank radius lets a long section pass through terrain.
        let floor = -Infinity;
        for (const corner of p.corners) {
          const offset = corner.clone().applyQuaternion(p.rotation);
          floor = Math.max(
            floor,
            surface(p.position.x + offset.x, p.position.z + offset.z) -
              offset.y,
          );
        }
        if (p.position.y < floor) {
          p.position.y = floor;
          p.velocity.y =
            Math.abs(p.velocity.y) > 1.8 ? Math.abs(p.velocity.y) * 0.18 : 0;
          p.velocity.x *= Math.exp(-dt * 7);
          p.velocity.z *= Math.exp(-dt * 7);
          p.spin.multiplyScalar(Math.exp(-dt * 4));
        }
      }
    }
    this.center.set(0, 0, 0);
    this.inverse.copy(this.root.quaternion).invert();
    for (const p of this.pieces) {
      this.center.add(p.position);
      p.pivot.position
        .copy(p.position)
        .sub(
          new THREE.Vector3(
            state.position.x,
            state.position.y,
            state.position.z,
          ),
        )
        .applyQuaternion(this.inverse);
      p.pivot.quaternion.copy(this.inverse).multiply(p.rotation);
    }
    return this.center.multiplyScalar(1 / this.pieces.length);
  }
}

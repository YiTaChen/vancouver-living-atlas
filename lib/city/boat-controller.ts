import * as THREE from 'three';
import type { CityEngine } from './engine';
import { advanceBoat, initialBoatState, type BoatInput } from './boat-physics';
import { makeWake } from './wake';
import { waveHeight } from './water-world';
import { makeMotorboat } from './harbour-models';
import type { PlacementPoint } from './placement-geometry';

/** Player boat has independent helm and camera heading; wake never affects picking. */
export class BoatController {
  state = initialBoatState();
  model = makeMotorboat();
  wake: THREE.Mesh;
  lookYaw = 0;
  time = 0;
  pulse: { key: string; remaining: number } | null = null;
  constructor(public e: CityEngine) {
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    this.wake = makeWake();
    this.model.visible = this.wake.visible = false;
    e.scene.add(this.model, this.wake);
  }
  start(point: PlacementPoint) {
    if (
      !this.e.waterWorld.canOccupy(point.x, point.z, point.yaw, point.waterId)
    )
      return false;
    this.state = {
      ...initialBoatState(),
      x: point.x,
      z: point.z,
      yaw: point.yaw,
      surfaceId: point.waterId!,
    };
    this.lookYaw = 0;
    this.pulse = null;
    this.model.visible = true;
    return true;
  }
  stop() {
    this.model.visible = this.wake.visible = false;
    this.pulse = null;
  }
  update(
    dt: number,
    input: BoatInput,
    pitch: number,
    snap: boolean,
    distance = 18,
  ) {
    dt = Math.max(0, Math.min(0.1, dt));
    this.time += dt;
    if (this.pulse) {
      const key = this.pulse.key;
      if (!input.thrust)
        input.thrust = key === 'forward' ? 1 : key === 'backward' ? -1 : 0;
      if (!input.turn)
        input.turn = key === 'left' ? 1 : key === 'right' ? -1 : 0;
      this.pulse.remaining -= dt;
      if (this.pulse.remaining <= 0) this.pulse = null;
    }
    const surface = advanceBoat(this.state, input, dt, this.e.waterWorld);
    if (!surface) return;
    const s = this.state,
      fx = Math.sin(s.yaw),
      fz = Math.cos(s.yaw),
      rx = Math.cos(s.yaw),
      rz = -Math.sin(s.yaw);
    const height = (x: number, z: number) =>
      waveHeight(surface.kind, x, z, this.time);
    const bob = height(s.x, s.z),
      bow = height(s.x + fx * 3, s.z + fz * 3),
      stern = height(s.x - fx * 3, s.z - fz * 3);
    const port = height(s.x - rx, s.z - rz),
      starboard = height(s.x + rx, s.z + rz);
    this.model.position.set(s.x, surface.level + bob, s.z);
    this.model.rotation.set(
      Math.atan2(stern - bow, 6) - Math.min(0.06, Math.abs(s.speed) * 0.006),
      s.yaw,
      Math.atan2(starboard - port, 2) - s.yawRate * s.speed * 0.025,
      'YXZ',
    );
    const prop = this.model.userData.propeller;
    if (prop) prop.rotation.z += Math.abs(s.throttle) * dt * 55;
    this.wake.visible = Math.abs(s.speed) > 0.25;
    this.wake.position.set(
      s.x - fx * 3.2,
      surface.level + 0.035,
      s.z - fz * 3.2,
    );
    this.wake.rotation.y = s.yaw + (s.speed < 0 ? Math.PI : 0);
    this.wake.scale.setScalar(Math.min(1.5, Math.abs(s.speed) / 5));
    (this.wake.material as THREE.MeshBasicMaterial).opacity = Math.min(
      0.38,
      Math.abs(s.speed) * 0.055,
    );
    this.model.visible = distance > 3.5;
    const blend = THREE.MathUtils.smoothstep(distance, 0, 5);
    const yaw = s.yaw + this.lookYaw,
      dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const pos = this.model.position
      .clone()
      .addScaledVector(dir, -distance * blend)
      .add(new THREE.Vector3(0, 2.05 + distance * 0.275 * blend, 0));
    // Keep every point of the chase line over the same water body. This also
    // works along the regional shoreline, whose heights differ from core DEM.
    const origin = this.model.position,
      desired = pos.clone();
    const steps = Math.max(1, Math.ceil(distance / 2));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps,
        x = origin.x + (desired.x - origin.x) * t,
        z = origin.z + (desired.z - origin.z) * t;
      if (!this.e.waterWorld.canOccupy(x, z, 0, surface.id, 0, 0.4)) {
        const safe = (step - 1) / steps;
        pos.x = origin.x + (desired.x - origin.x) * safe;
        pos.z = origin.z + (desired.z - origin.z) * safe;
        break;
      }
    }
    if (snap || blend < 0.5) this.e.camera.position.copy(pos);
    else {
      const next = this.e.camera.position
        .clone()
        .lerp(pos, 1 - Math.exp(-dt * 5));
      this.e.camera.position.copy(
        this.e.waterWorld.at(next.x, next.z)?.id === surface.id ? next : pos,
      );
    }
    const target = this.model.position
      .clone()
      .addScaledVector(dir, 25 - blend * 19)
      .add(
        new THREE.Vector3(
          0,
          2.05 - blend * 0.85 - pitch * (25 - blend * 15),
          0,
        ),
      );
    this.e.camera.up.set(0, 1, 0);
    if (blend < 1) {
      const deckUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        this.model.quaternion,
      );
      this.e.camera.up.lerp(deckUp, (1 - blend) * 0.55).normalize();
    }
    this.e.camera.lookAt(target);
    this.e.controls.target.copy(target);
    this.e.camera.near = 0.08;
    this.e.camera.fov = THREE.MathUtils.lerp(58, 48, blend);
    this.e.camera.updateProjectionMatrix();
  }
}

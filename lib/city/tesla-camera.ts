import * as THREE from 'three';
import {
  TESLA_ROADSTER_ANCHORS,
  TESLA_ROADSTER_DIMENSIONS,
} from './assets/tesla-roadster-contract';
import type { TeslaPose } from './tesla-state';

export type TeslaView = 'chase' | 'cockpit';
export interface TeslaCameraFrame {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  near: number;
}

/** Chase uses a gravity-level horizon even on a vertical wall. Only the cabin
 * applies the complete vehicle attitude to the eye, forward and up vectors. */
export function teslaCameraFrame(
  pose: TeslaPose,
  view: TeslaView,
  options: {
    heading: number;
    distance: number;
    lookYaw: number;
    lookPitch: number;
    clearance?: number;
    wallNormal?: readonly [number, number, number];
  },
): TeslaCameraFrame {
  const center = new THREE.Vector3(...pose.position);
  const body = new THREE.Quaternion(...pose.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let position: THREE.Vector3, target: THREE.Vector3;
  if (view === 'cockpit') {
    position = new THREE.Vector3(...TESLA_ROADSTER_ANCHORS.driverEye);
    position.y -=
      TESLA_ROADSTER_DIMENSIONS.contactToCenter + (options.clearance ?? 0.06);
    position.applyQuaternion(body).add(center);
    const look = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(options.lookPitch, options.lookYaw, 0, 'YXZ'),
    );
    const forward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(look)
      .applyQuaternion(body);
    target = position.clone().add(forward);
    up.applyQuaternion(body);
  } else {
    const yaw = options.heading + options.lookYaw;
    const pitch = THREE.MathUtils.clamp(0.24 + options.lookPitch, -0.18, 1.15);
    const distance = THREE.MathUtils.clamp(options.distance, 3.8, 24);
    target = center.clone().add(new THREE.Vector3(0, 0.28, 0));
    position = target
      .clone()
      .add(
        new THREE.Vector3(
          -Math.sin(yaw) * Math.cos(pitch) * distance,
          Math.sin(pitch) * distance + 0.65,
          -Math.cos(yaw) * Math.cos(pitch) * distance,
        ),
      );
  }
  if (
    view === 'chase' &&
    options.wallNormal &&
    Math.abs(options.wallNormal[1]) < 0.5
  ) {
    const normal = new THREE.Vector3(...options.wallNormal).setY(0).normalize();
    const horizontal = position.clone().sub(target).setY(0);
    const inward = horizontal.dot(normal);
    if (inward < 0) horizontal.addScaledVector(normal, -inward);
    horizontal.addScaledVector(
      normal,
      options.distance * 0.8 * Math.max(0, 1 - Math.abs(options.lookYaw) / 1.7),
    );
    if (horizontal.lengthSq() > 0.001) {
      horizontal.setLength(options.distance * Math.cos(0.24));
      position.x = target.x + horizontal.x;
      position.z = target.z + horizontal.z;
    }
  }
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, target, up),
  );
  return {
    position,
    target,
    up,
    quaternion,
    fov: view === 'cockpit' ? 70 : 56,
    near: view === 'cockpit' ? 0.025 : 0.18,
  };
}

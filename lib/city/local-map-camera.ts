import * as THREE from 'three';
import type { CityEngine } from './engine';
import { localMapOffset } from './travel-camera';

export function enterLocalMap(e: CityEngine) {
  const nav = e.navigation;
  if (!nav || nav.mode === 'orbit') return false;
  const from = e.camera.position.clone();
  const fromQuaternion = e.camera.quaternion.clone();
  const target = nav.position.clone();
  const yaw = nav.yaw + (nav.mode === 'boat' ? nav.boat.lookYaw : 0);
  const offset = localMapOffset(yaw);
  const position = target
    .clone()
    .add(new THREE.Vector3(offset.x, offset.y, offset.z));
  position.y = Math.max(position.y, e.elevation(position.x, position.z) + 8);
  nav.setMode('orbit');
  e.settings = { ...e.settings, mode: 'orbit', autoRotate: false };
  e.controls.autoRotate = false;
  // Settle any old Orbit damping before installing the exact local center.
  const damping = e.controls.enableDamping;
  e.controls.enableDamping = false;
  e.controls.update();
  e.controls.enableDamping = damping;
  e.camera.position.copy(from);
  e.camera.quaternion.copy(fromQuaternion);
  e.controls.target.copy(target);
  e.controls.enabled = false;
  e.transition = {
    localMap: true,
    fromQuaternion,
    toQuaternion: new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0)),
    ),
    start: performance.now(),
    duration: 550,
    from,
    to: position,
    fromTarget: target.clone(),
    toTarget: target,
  };
  e.renderer.shadowMap.needsUpdate = true;
  return true;
}

/** A new explicit map action completes the short exit before taking over. */
export function finishLocalMapTransition(e: CityEngine) {
  if (!e.transition?.localMap) return;
  e.camera.position.copy(e.transition.to);
  e.controls.target.copy(e.transition.toTarget);
  e.transition = null;
  e.controls.enabled = true;
  e.controls.update();
}

import type { Camera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Drain public OrbitControls damping before assigning a deterministic QA pose. */
export function clearQAOrbitMomentum(controls: OrbitControls) {
  const damping = controls.enableDamping;
  const rotating = controls.autoRotate;
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.update();
  controls.enableDamping = damping;
  controls.autoRotate = rotating;
}
export function captureQAPose(camera: Camera, controls: OrbitControls) {
  return {
    camera: camera.position.toArray(),
    target: controls.target.toArray(),
  };
}
export function qaPoseError(
  camera: Camera,
  controls: OrbitControls,
  pose: ReturnType<typeof captureQAPose>,
) {
  return Math.max(
    Math.hypot(...camera.position.toArray().map((v, i) => v - pose.camera[i])),
    Math.hypot(...controls.target.toArray().map((v, i) => v - pose.target[i])),
  );
}

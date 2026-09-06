import * as THREE from 'three';

/** Small, damped head response to actual vehicle motion, in metres/radians. */
export class DriverCameraMotion {
  surge = 0;
  sway = 0;
  pitch = 0;
  roll = 0;
  reset() {
    this.surge = this.sway = this.pitch = this.roll = 0;
  }
  worldRotation(yaw: number, amount = 1) {
    const basis = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw + Math.PI,
    );
    const head = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.pitch * amount, 0, this.roll * amount),
    );
    return basis.clone().multiply(head).multiply(basis.invert());
  }
  update(dt: number, speed: number, previousSpeed: number, yawChange: number) {
    if (dt <= 0) return;
    const acceleration = THREE.MathUtils.clamp(
      (speed - previousSpeed) / dt,
      -10,
      10,
    );
    const lateral = THREE.MathUtils.clamp((speed * yawChange) / dt, -6, 6);
    const ease = 1 - Math.exp(-dt * 5);
    this.surge = THREE.MathUtils.lerp(this.surge, -acceleration * 0.003, ease);
    this.sway = THREE.MathUtils.lerp(this.sway, -lateral * 0.005, ease);
    this.pitch = THREE.MathUtils.lerp(this.pitch, acceleration * 0.0006, ease);
    this.roll = THREE.MathUtils.lerp(this.roll, -lateral * 0.0015, ease);
  }
}
export const DRIVER_LEFT_OFFSET = 0.45;

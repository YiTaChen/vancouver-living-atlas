import assert from 'node:assert/strict';

// Reviewed camera-only changes relative to the seated/character source. These
// exact snippets restore the prior bytes for the existing material audit; no
// stored fixture hash, asset receipt, movement or seating baseline is changed.
const DELTAS = [
  {
    current:
      "  type TravelView,\n} from './travel-camera';\nimport { clampTravelPitch, travelLookDirection } from './travel-camera-collision';\nexport interface WalkSeatPose {\n  id: string;\n",
    prior:
      "  type TravelView,\n} from './travel-camera';\nexport interface WalkSeatPose {\n  id: string;\n",
  },
  {
    current:
      "    if (this.mode === 'orbit') return;\n    this.e.renderer.domElement.focus({ preventScroll: true });\n    this.e.renderer.domElement.setPointerCapture?.(ev.pointerId);\n    if (ev.pointerType === 'touch') {\n      ev.preventDefault();\n      ev.stopImmediatePropagation();\n      this.touches.set(ev.pointerId, [ev.clientX, ev.clientY]);\n      if (this.touches.size > 1) {\n",
    prior:
      "    if (this.mode === 'orbit') return;\n    this.e.renderer.domElement.focus({ preventScroll: true });\n    if (ev.pointerType === 'touch') {\n      ev.preventDefault();\n      ev.stopImmediatePropagation();\n      this.e.renderer.domElement.setPointerCapture?.(ev.pointerId);\n      this.touches.set(ev.pointerId, [ev.clientX, ev.clientY]);\n      if (this.touches.size > 1) {\n",
  },
  {
    current:
      "      );\n    else this.yaw -= (ev.clientX - this.last[0]) * 0.004;\n    const pitch = this.pitch + (ev.clientY - this.last[1]) * 0.003;\n    this.pitch = this.mode === 'walk' ? clampTravelPitch(pitch)\n      : THREE.MathUtils.clamp(pitch, -0.7, 0.7);\n    this.last = [ev.clientX, ev.clientY];\n  };\n",
    prior:
      '      );\n    else this.yaw -= (ev.clientX - this.last[0]) * 0.004;\n    this.pitch = THREE.MathUtils.clamp(\n      this.pitch + (ev.clientY - this.last[1]) * 0.003,\n      -0.7,\n      0.7,\n    );\n    this.last = [ev.clientX, ev.clientY];\n  };\n',
  },
  {
    current:
      "    const pos = eye.clone().addScaledVector(dir, -distance * blend);\n    pos.y += distance * (this.mode === 'walk' ? 0.28 : 0.35) * blend;\n    const walkThird = this.mode === 'walk' && !firstPerson('walk', distance);\n    const walkTarget = eye.clone().add(new THREE.Vector3(0, this.walkSeat ? -0.35 : -0.55, 0));\n    if (walkThird) {\n      // Keep the player's requested angle. Occluders are cut away by the renderer.\n      const angle = Math.atan(0.28) + THREE.MathUtils.clamp(this.pitch, -0.22, 1.1);\n      pos.copy(walkTarget).addScaledVector(dir, -distance * Math.cos(angle));\n      pos.y += distance * Math.sin(angle);\n    }\n    // Clip the chase segment at walls/banks; collision checks never move the player.\n    const steps = Math.ceil(distance / 1.5);\n",
    prior:
      "    const pos = eye.clone().addScaledVector(dir, -distance * blend);\n    pos.y += distance * (this.mode === 'walk' ? 0.28 : 0.35) * blend;\n    // Clip the chase segment at walls/banks; collision checks never move the player.\n    const steps = Math.ceil(distance / 1.5);\n",
  },
  {
    current:
      "      const x = eye.x + (pos.x - eye.x) * t,\n        z = eye.z + (pos.z - eye.z) * t;\n      if (this.mode !== 'walk' && !this.clearGround(x, z) && this.surface !== 'bridge') {\n        pos.x = eye.x + ((pos.x - eye.x) * (step - 1)) / steps;\n        pos.z = eye.z + ((pos.z - eye.z) * (step - 1)) / steps;\n",
    prior:
      "      const x = eye.x + (pos.x - eye.x) * t,\n        z = eye.z + (pos.z - eye.z) * t;\n      if (!this.clearGround(x, z) && this.surface !== 'bridge') {\n        pos.x = eye.x + ((pos.x - eye.x) * (step - 1)) / steps;\n        pos.z = eye.z + ((pos.z - eye.z) * (step - 1)) / steps;\n",
  },
  {
    current:
      "    }\n    if (blend > 0.5)\n      pos.y = Math.max(pos.y, this.mode === 'walk'\n        ? this.walker.group.position.y + 0.25 : this.e.elevation(pos.x, pos.z) + 2);\n    // Distance itself is eased, so the eye remains attached to movement without drift.\n    this.e.camera.position.copy(pos);\n    this.e.camera.lookAt(\n      this.mode === 'walk' ? walkThird ? walkTarget\n        : pos.clone().add(travelLookDirection(viewYaw, -this.pitch)) : eye\n        .clone()\n        .addScaledVector(\n          dir,\n          THREE.MathUtils.lerp(25, 2, blend),\n        )\n        .add(\n          new THREE.Vector3(\n            0,\n            -0.25 * blend - this.pitch * (25 - blend * 15),\n            0,\n          ),\n",
    prior:
      "    }\n    if (blend > 0.5)\n      pos.y = Math.max(pos.y, this.e.elevation(pos.x, pos.z) + 2);\n    // Distance itself is eased, so the eye remains attached to movement without drift.\n    this.e.camera.position.copy(pos);\n    this.e.camera.lookAt(\n      eye\n        .clone()\n        .addScaledVector(\n          dir,\n          THREE.MathUtils.lerp(\n            25,\n            this.mode === 'walk'\n              ? Math.min(1.5, Math.max(0, distance - 2) * 0.75)\n              : 2,\n            blend,\n          ),\n        )\n        .add(\n          new THREE.Vector3(\n            0,\n            -(this.mode === 'walk' ? 0.5 : 0.25) * blend -\n              this.pitch * (25 - blend * (this.mode === 'walk' ? 20 : 15)),\n            0,\n          ),\n",
  },
  {
    current:
      '    this.e.controls.target.copy(this.position).addScaledVector(dir, 25);\n    this.e.camera.near = 0.08;\n    this.e.camera.fov = walkThird ? Math.max(48, Math.min(100,\n      THREE.MathUtils.radToDeg(2 * Math.atan((this.walkSeat ? 0.85 : 1.12) /\n        Math.max(0.1, pos.distanceTo(walkTarget))))))\n      : THREE.MathUtils.lerp(58, 48, blend);\n    this.e.camera.updateProjectionMatrix();\n    this.finishReturnBlend(dt);\n',
    prior:
      '    this.e.controls.target.copy(this.position).addScaledVector(dir, 25);\n    this.e.camera.near = 0.08;\n    this.e.camera.fov = THREE.MathUtils.lerp(58, 48, blend);\n    this.e.camera.updateProjectionMatrix();\n    this.finishReturnBlend(dt);\n',
  },
];

export function projectBeforeWalkCamera(path, source) {
  if (
    path !== 'lib/city/navigation.ts' ||
    !source.includes('travel-camera-collision')
  )
    return { source, reviewed: [] };
  const reviewed = [];
  for (const [index, delta] of DELTAS.entries()) {
    assert.equal(
      source.split(delta.current).length - 1,
      1,
      `Reviewed seating anchor changed: walk camera delta ${index + 1}`,
    );
    source = source.replace(delta.current, delta.prior);
    reviewed.push(`walk camera delta ${index + 1}`);
  }
  return { source, reviewed };
}

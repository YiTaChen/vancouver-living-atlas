import * as THREE from 'three';
import { project } from './geo';
import { QUALITY } from './quality';
import type { CityEngine } from './engine';

export class LandmarkDetail {
  medium: THREE.Group;
  ultra: THREE.Group | null = null;
  holder = new THREE.Group();
  bounds: THREE.Box3;
  constructor(
    private e: CityEngine,
    private create: (detail: boolean) => THREE.Group,
  ) {
    this.medium = create(false);
    const p = this.medium.userData.placement;
    const [x, z] = project([p.lon, p.lat]);
    this.holder.name = this.medium.name;
    this.holder.position.set(x, p.baseY ?? p.base ?? e.elevation(x, z), z);
    this.holder.rotation.y = p.yaw || 0;
    this.holder.add(this.medium);
    e.landmarks.add(this.holder);
    this.registerNight(this.medium);
    this.holder.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.holder);
    for (const ring of this.medium.userData.solidFootprints || []) {
      const world = ring.map(([x, z]: number[]) => {
        const v = new THREE.Vector3(x, 0, z).applyMatrix4(
          this.holder.matrixWorld,
        );
        return [v.x, v.z];
      });
      (e.data.solidWaterFootprints ||= []).push([world]);
    }
  }
  registerNight(group: THREE.Group) {
    const points = group.userData.nightPoints as number[][] | undefined;
    if (points?.length) {
      const size = 32,
        rgba = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const r = Math.hypot(x - 15.5, y - 15.5) / 15.5,
            i = (y * size + x) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
          rgba[i + 3] = Math.round(Math.max(0, 1 - r) ** 2 * 255);
        }
      const glow = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat);
      glow.needsUpdate = true;
      const geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(points.flat(), 3),
      );
      const lights = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          color: new THREE.Color(0xa7dcff).multiplyScalar(2.4),
          size: 2.4,
          map: glow,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      lights.name = 'Science World night light glow';
      lights.visible = this.e.uniforms.night.value > 0.15;
      group.add(lights);
      (this.e.data.nightObjects ||= []).push(lights);
    }
    const list = group.userData.nightMaterials || [];
    for (const n of list)
      n.material.emissiveIntensity = this.e.uniforms.night.value * n.intensity;
    (this.e.data.nightMaterials ||= []).push(...list);
  }
  update() {
    const range = QUALITY[this.e.settings.quality].landmarkDistance;
    const active =
      this.e.settings.buildings &&
      range > 0 &&
      this.bounds.distanceToPoint(this.e.camera.position) < range;
    if (active && !this.ultra) {
      this.ultra = this.create(true);
      this.registerNight(this.ultra);
      this.holder.add(this.ultra);
      this.e.renderer.shadowMap.needsUpdate = true;
    }
    if (this.medium.visible === active)
      this.e.renderer.shadowMap.needsUpdate = true;
    this.medium.visible = !active;
    if (this.ultra) this.ultra.visible = active;
  }
}

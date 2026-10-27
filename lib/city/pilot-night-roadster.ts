import * as THREE from 'three';
import type { NightStreetLighting } from './night-street-lighting';
import { vehicleSurfaceWeight } from './assets/vehicle-surface';

/** The player car is not part of the traffic receiver set. Reuse the existing
 * local street field for its private materials, with a single geographic fade
 * shared by the whole car. The field retains ownership of material hooks. */
export class PilotNightRoadster {
  readonly weight: THREE.IUniform<number> = { value: 0 };
  private readonly position = new THREE.Vector3();
  constructor(
    private readonly car: THREE.Object3D,
    private readonly roadster: THREE.Object3D,
    lighting: NightStreetLighting,
  ) {
    roadster.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        if (material instanceof THREE.MeshStandardMaterial)
          lighting.wrapMaterial(material, { pilotWeight: this.weight });
    });
  }
  update() {
    if (!this.car.visible || !this.roadster.visible || !this.roadster.parent) {
      this.weight.value = 0;
      return;
    }
    this.roadster.getWorldPosition(this.position);
    this.weight.value = vehicleSurfaceWeight(
      this.position.x,
      this.position.y,
      this.position.z,
    );
  }
  dispose() {
    this.weight.value = 0;
  }
}

import * as THREE from 'three';
import type { NightStreetLighting } from './night-street-lighting';
import { vehicleSurfaceWeight } from './assets/vehicle-surface';
import { installPilotRoadsterGrille } from './assets/roadster-grille';

/** The player car is not part of the traffic receiver set. Reuse the existing
 * local street field for its private materials, with a single geographic fade
 * shared by the whole car. The field retains ownership of material hooks. */
export class PilotNightRoadster {
  readonly weight: THREE.IUniform<number> = { value: 0 };
  private readonly position = new THREE.Vector3();
  private readonly grilleMaterial: THREE.MeshStandardMaterial | null;
  private grilleRestore: (() => void) | null = null;
  private readonly grilleDisposeListener = () => this.restoreGrille();
  constructor(
    private readonly car: THREE.Object3D,
    private readonly roadster: THREE.Object3D,
    lighting: NightStreetLighting,
  ) {
    const dark = roadster.getObjectByName('roadster/dark');
    this.grilleMaterial =
      dark instanceof THREE.Mesh &&
      dark.material instanceof THREE.MeshStandardMaterial
        ? dark.material
        : null;
    // Register before the night-field listener, while the grille wrapper is
    // installed after it: early material disposal then unwinds in reverse order.
    this.grilleMaterial?.addEventListener(
      'dispose',
      this.grilleDisposeListener,
    );
    try {
      roadster.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          if (material instanceof THREE.MeshStandardMaterial)
            lighting.wrapMaterial(material, { pilotWeight: this.weight });
      });
      if (this.grilleMaterial)
        this.grilleRestore = installPilotRoadsterGrille(this.grilleMaterial);
    } catch (error) {
      // Construction can fail, for example if the shared lighting field was
      // already disposed. No receiver exists to remove our early listener then.
      this.restoreGrille();
      throw error;
    }
  }
  private restoreGrille() {
    this.grilleMaterial?.removeEventListener(
      'dispose',
      this.grilleDisposeListener,
    );
    this.grilleRestore?.();
    this.grilleRestore = null;
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
    this.restoreGrille();
    this.weight.value = 0;
  }
}

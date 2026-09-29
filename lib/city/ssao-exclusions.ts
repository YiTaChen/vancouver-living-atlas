import * as THREE from 'three';

const materials = (mesh: THREE.Mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];
export function excludeFromSSAO(object: THREE.Object3D) {
  const drawable = object as THREE.Object3D & {
    isPoints?: boolean;
    isLine?: boolean;
    isLine2?: boolean;
  };
  return Boolean(
    // SSAOPass itself hides these, but its visibility restore lacks a finally.
    // Own their restoration too so a failed normal draw cannot hide them forever.
    drawable.isPoints ||
    drawable.isLine ||
    drawable.isLine2 ||
    object.userData.excludeFromSSAO ||
    object.userData.alphaFoliage ||
    (object instanceof THREE.Mesh &&
      materials(object).every(
        (material) => material.transparent && !material.depthWrite,
      )),
  );
}
function candidate(object: THREE.Object3D) {
  return (
    excludeFromSSAO(object) ||
    Boolean(object.userData.railVehicle || object.userData.harbourVehicle)
  );
}

/** Live scene-graph membership using public Three child events. In particular,
 * asynchronous GLBs and tree pools do not miss the initial AO snapshot. */
export class SSAOExclusions {
  private watched = new Set<THREE.Object3D>();
  private candidates = new Set<THREE.Object3D>();
  private disposed = false;
  readonly stats = { watchedObjects: 0, candidates: 0, hiddenLastPass: 0 };
  private added = (event: THREE.Object3DEventMap['childadded']) =>
    this.track(event.child);
  private removed = (event: THREE.Object3DEventMap['childremoved']) =>
    this.untrack(event.child);

  constructor(private scene: THREE.Scene) {
    this.track(scene);
  }
  private track(root: THREE.Object3D) {
    if (this.disposed) return;
    root.traverse((object) => {
      if (this.watched.has(object)) return;
      this.watched.add(object);
      object.addEventListener('childadded', this.added);
      object.addEventListener('childremoved', this.removed);
      if (candidate(object)) this.candidates.add(object);
    });
    this.stats.watchedObjects = this.watched.size;
    this.stats.candidates = this.candidates.size;
  }
  private untrack(root: THREE.Object3D) {
    root.traverse((object) => {
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
      this.candidates.delete(object);
      this.watched.delete(object);
    });
    this.stats.watchedObjects = this.watched.size;
    this.stats.candidates = this.candidates.size;
  }
  /** Explicit refresh for a previously ordinary opaque material changed to a
   * transparent/non-depth-writing one after attachment. Known fading vehicles
   * stay enrolled and are checked automatically on every pass. */
  refresh(root: THREE.Object3D) {
    if (this.disposed) return;
    root.traverse((object) => {
      if (!this.watched.has(object)) return;
      if (candidate(object)) this.candidates.add(object);
      else this.candidates.delete(object);
    });
    this.stats.candidates = this.candidates.size;
  }
  render<T>(draw: () => T): T {
    const hidden: THREE.Object3D[] = [];
    const override = this.scene.overrideMaterial;
    for (const object of this.candidates) {
      if (!object.visible || !excludeFromSSAO(object)) continue;
      hidden.push(object);
      object.visible = false;
    }
    this.stats.hiddenLastPass = hidden.length;
    try {
      return draw();
    } finally {
      hidden.forEach((object) => {
        object.visible = true;
      });
      // Three's override-normal draw lacks its own finally on render failure.
      this.scene.overrideMaterial = override;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of this.watched) {
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
    }
    this.watched.clear();
    this.candidates.clear();
    this.stats.watchedObjects =
      this.stats.candidates =
      this.stats.hiddenLastPass =
        0;
  }
}

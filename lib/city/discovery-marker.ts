import * as THREE from 'three';

export interface DiscoveryTarget {
  x: number;
  z: number;
  label: string;
}

/** One reusable, unlit destination marker. No textures, lights or shadow passes. */
export class DiscoveryMarker {
  readonly group = new THREE.Group();
  private readonly pin: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.group.name = 'discovery-destination';
    this.group.visible = false;
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd58a,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 24), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    this.pin = new THREE.Mesh(new THREE.OctahedronGeometry(0.65), material);
    this.pin.position.y = 3.6;
    this.group.add(ring, this.pin);
    scene.add(this.group);
  }

  place(target: DiscoveryTarget, elevation: number) {
    this.group.position.set(target.x, elevation, target.z);
  }

  update(time: number, visible: boolean) {
    this.group.visible = visible;
    if (!visible) return;
    this.pin.rotation.y = time * 0.0004;
    this.pin.position.y = 3.6 + Math.sin(time * 0.0018) * 0.16;
  }
}

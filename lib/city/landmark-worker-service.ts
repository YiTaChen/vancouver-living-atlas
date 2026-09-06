import * as THREE from 'three';
import {
  LandmarkWorkerClient,
  type LandmarkWorkerPort,
} from './landmark-worker-client';
import { unpackLandmark } from './landmark-geometry-packet.js';
import { applyScienceRedPanelMaterial } from './assets/science-entry';
import { applyCanadaMembraneMaterial } from './assets/canada-detail';

const shaders = {
  'science-red-v1': applyScienceRedPanelMaterial,
  'canada-membrane-v1': applyCanadaMembraneMaterial,
};
export function createLandmarkWorkerService() {
  return new LandmarkWorkerClient<THREE.Group>(
    () => {
      if (typeof Worker === 'undefined')
        throw new Error(
          'Module workers unavailable; medium landmarks retained',
        );
      return new Worker(new URL('./landmark.worker.ts', import.meta.url), {
        type: 'module',
        name: 'Vancouver landmark geometry',
      }) as unknown as LandmarkWorkerPort;
    },
    (packet) => unpackLandmark(THREE, packet, shaders),
  );
}

/** For decoded but uncommitted groups only; committed groups belong to Engine. */
export function disposeDetachedLandmark(group: THREE.Group) {
  group.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material)
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(material);
    if (mesh.customDepthMaterial) materials.add(mesh.customDepthMaterial);
    if (mesh.customDistanceMaterial) materials.add(mesh.customDistanceMaterial);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}

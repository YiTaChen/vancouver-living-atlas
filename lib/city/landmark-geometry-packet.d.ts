import type * as THREE from 'three';
export function packLandmark(
  three: typeof THREE,
  group: THREE.Group,
): { packet: unknown; transfer: ArrayBuffer[]; bytes: number };
export function unpackLandmark(
  three: typeof THREE,
  packet: unknown,
  shaders?: Record<string, (material: THREE.MeshStandardMaterial) => void>,
): THREE.Group;

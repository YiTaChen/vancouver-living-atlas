import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import detailedData from './tesla-roadster-detailed-data.json';
import {
  TESLA_ROADSTER_THRUSTERS,
  type TeslaModelQuality,
} from './tesla-roadster-contract';

export type TeslaMaterialRole =
  | 'paint'
  | 'hood'
  | 'carbon'
  | 'rubber'
  | 'white'
  | 'suede'
  | 'titanium'
  | 'glass'
  | 'headlight'
  | 'tail'
  | 'display'
  | 'accent';
export type TeslaMaterials = Record<TeslaMaterialRole, THREE.Material>;
type Point = readonly [number, number, number];
interface PackedPart {
  assembly: string;
  role: TeslaMaterialRole;
  positions: string;
  normals: string;
  colors?: string;
  indices: string;
  vertexCount: number;
  indexCount: number;
}
interface DetailedData {
  version: number;
  positionScale: number;
  rig: {
    nodes: {
      id: string;
      parent: string | null;
      position: Point;
      rotationQuaternion?: readonly number[];
    }[];
    steering: string;
    wing: string;
    roof: string;
    wheelSteers: string[];
    wheelRolls: string[];
    fans: string[];
    doors: Record<'left' | 'right', { id: string; axis: Point }>;
  };
  lods: Record<TeslaModelQuality, { triangles: number; parts: PackedPart[] }>;
}
const data = detailedData as unknown as DetailedData;

export interface TeslaGeometryLevel {
  root: THREE.Group;
  steering: THREE.Group;
  wheelSteers: THREE.Group[];
  wheelRolls: THREE.Group[];
  fans: THREE.Group[];
  wing: THREE.Group;
  wingNeutralY: number;
  doors: { object: THREE.Group; axis: THREE.Vector3 }[];
  roof: THREE.Group;
  roofNeutralY: number;
  triangles: number;
  meshes: number;
}

/** Decode only the requested tier. No network load, late attachment, or
 * frame-time geometry work is required by the local quantized dependency. */
function bytes(encoded: string, expected: number): Uint8Array {
  const decoded = atob(encoded);
  if (decoded.length !== expected)
    throw new Error('Invalid Roadster geometry payload');
  const result = new Uint8Array(expected);
  for (let i = 0; i < expected; i++) result[i] = decoded.charCodeAt(i);
  return result;
}
function geometry(part: PackedPart): THREE.BufferGeometry {
  const count = part.vertexCount * 3;
  const packedPositions = new DataView(bytes(part.positions, count * 2).buffer);
  const packedNormals = new Int8Array(bytes(part.normals, count).buffer);
  const positions = new Float32Array(count),
    normals = new Float32Array(count);
  for (let i = 0; i < count; i += 3) {
    for (let axis = 0; axis < 3; axis++)
      positions[i + axis] =
        packedPositions.getInt16((i + axis) * 2, true) * data.positionScale;
    const nx = packedNormals[i],
      ny = packedNormals[i + 1],
      nz = packedNormals[i + 2];
    const length = Math.hypot(nx, ny, nz);
    if (!length) throw new Error('Invalid Roadster normal');
    normals[i] = nx / length;
    normals[i + 1] = ny / length;
    normals[i + 2] = nz / length;
  }
  const packedIndices = new DataView(
    bytes(part.indices, part.indexCount * 2).buffer,
  );
  const indices = new Uint16Array(part.indexCount);
  for (let i = 0; i < indices.length; i++)
    indices[i] = packedIndices.getUint16(i * 2, true);
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (part.colors)
    result.setAttribute(
      'color',
      new THREE.BufferAttribute(bytes(part.colors, count), 3, true),
    );
  result.setIndex(new THREE.BufferAttribute(indices, 1));
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

/** Atlas's established ten-port flight rig includes two illustrative front
 * yaw collars; the detailed donor supplies eight directly observed ports. */
function yawHardware(segments: number): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [],
    up = new THREE.Vector3(0, 1, 0);
  for (const port of TESLA_ROADSTER_THRUSTERS) {
    if (port.kind !== 'yaw') continue;
    const part = new THREE.CylinderGeometry(
      port.radius,
      port.radius,
      0.018,
      segments,
      1,
      true,
    );
    part.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        up,
        new THREE.Vector3(...port.direction),
      ),
    );
    part.translate(...port.position);
    part.deleteAttribute('uv');
    const colors = new Uint8Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = 140;
      colors[i + 1] = 133;
      colors[i + 2] = 117;
    }
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    pieces.push(part);
  }
  const merged = mergeGeometries(pieces);
  pieces.forEach((part) => part.dispose());
  if (!merged) throw new Error('Failed to batch Roadster yaw ports');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/** Batched Blender-derived tiers preserve local pivots and independent
 * calipers. Geometry/material ownership remains with each cached tier/model. */
export function buildTeslaRoadsterLevel(
  quality: TeslaModelQuality,
  materials: TeslaMaterials,
): TeslaGeometryLevel {
  if (data.version !== 1 || data.positionScale !== 0.0001)
    throw new Error('Unsupported Roadster geometry version');
  const root = new THREE.Group(),
    nodes = new Map<string, THREE.Group>();
  root.name = 'Tesla detailed Rocket ' + quality;
  root.userData.source = 'tesla-roadster-2026';
  for (const node of data.rig.nodes) {
    const object = new THREE.Group();
    object.name = node.id;
    object.position.fromArray(node.position);
    if (node.rotationQuaternion)
      object.quaternion.fromArray(node.rotationQuaternion);
    nodes.set(node.id, object);
  }
  const get = (name: string) => {
    const object = nodes.get(name);
    if (!object) throw new Error('Missing Roadster assembly: ' + name);
    return object;
  };
  for (const node of data.rig.nodes)
    (node.parent ? get(node.parent) : root).add(get(node.id));
  let triangles = 0,
    meshes = 0;
  for (const part of data.lods[quality].parts) {
    const mesh = new THREE.Mesh(geometry(part), materials[part.role]);
    mesh.castShadow = part.role !== 'glass' && part.role !== 'headlight';
    mesh.receiveShadow = part.role !== 'glass';
    mesh.name = part.assembly + ':' + part.role;
    mesh.userData.semantic_role = part.role;
    mesh.userData.sourceAssembly = part.assembly;
    if (part.role === 'glass') mesh.userData.excludeFromSSAO = true;
    get(part.assembly).add(mesh);
    triangles += part.indexCount / 3;
    meshes++;
  }
  const yaw = new THREE.Mesh(
    yawHardware(quality === 'low' ? 6 : quality === 'medium' ? 8 : 12),
    materials.titanium,
  );
  yaw.name = 'body:inferred-yaw-port-hardware';
  yaw.castShadow = yaw.receiveShadow = true;
  yaw.userData.inferredPackaging = true;
  get('body').add(yaw);
  meshes++;
  triangles += yaw.geometry.index!.count / 3;
  const wing = get(data.rig.wing),
    roof = get(data.rig.roof);
  return {
    root,
    steering: get(data.rig.steering),
    wheelSteers: data.rig.wheelSteers.map(get),
    wheelRolls: data.rig.wheelRolls.map(get),
    fans: data.rig.fans.map(get),
    wing,
    wingNeutralY: wing.position.y,
    doors: Object.values(data.rig.doors).map((door) => ({
      object: get(door.id),
      axis: new THREE.Vector3(...door.axis).normalize(),
    })),
    roof,
    roofNeutralY: roof.position.y,
    triangles,
    meshes,
  };
}

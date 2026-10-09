import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export type CabinId = 'mark-v' | 'canada-line';
export interface CabinViewpoint {
  id: string;
  kind: 'seat' | 'standing';
  nodeId: string;
  offsetM: [number, number, number];
  positionM: [number, number, number];
  facingXZ: [number, number];
}
interface CabinLOD {
  level: 0 | 1;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  triangles: number;
  primitives: number;
  materialNames: string[];
}
export interface CabinDescriptor {
  id: CabinId;
  interiorId: string;
  exteriorId: string | null;
  seatCount: number;
  defaultViewpoint: string;
  viewpoints: CabinViewpoint[];
}
export interface CabinManifest {
  schemaVersion: 1;
  contract: 'skytrain-cabin-display-v1';
  scope: 'single-cabin-display';
  units: 'm';
  boardingEnabled: false;
  serviceEnabled: false;
  intercarTraversalEnabled: false;
  assets: { id: string; lods: CabinLOD[] }[];
  cabins: CabinDescriptor[];
}
type CabinGLTF = Pick<GLTF, 'scene' | 'animations'>;
export interface CabinOwner {
  group: THREE.Group;
  descriptor: CabinDescriptor;
  level: 0 | 1;
  mixer: THREE.AnimationMixer;
  resources: { file: string; sha256: string; bytes: number }[];
  dispose(): void;
}
export interface CabinAssetOptions {
  load?: (url: string, signal: AbortSignal) => Promise<CabinGLTF>;
  fetchManifest?: (signal: AbortSignal) => Promise<unknown>;
}
const BASE = '/models/blender/metro/';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid cabin metadata');
  return value as Record<string, unknown>;
}
const vector = (value: unknown, count: number) =>
  Array.isArray(value) &&
  value.length === count &&
  value.every((n) => typeof n === 'number' && Number.isFinite(n));
export function validateCabinManifest(value: unknown): CabinManifest {
  const manifest = record(value);
  if (
    manifest.schemaVersion !== 1 ||
    manifest.contract !== 'skytrain-cabin-display-v1' ||
    manifest.scope !== 'single-cabin-display' ||
    manifest.units !== 'm' ||
    manifest.boardingEnabled !== false ||
    manifest.serviceEnabled !== false ||
    manifest.intercarTraversalEnabled !== false ||
    !Array.isArray(manifest.assets) ||
    !Array.isArray(manifest.cabins)
  )
    throw new Error('Unsupported cabin display');
  const expected = [
    'mark-v-a-car-interior',
    'canada-line-shared-interior',
    'canada-line-endcar-exterior',
  ];
  if (manifest.assets.length !== expected.length)
    throw new Error('Incomplete cabin asset inventory');
  for (const [index, value] of manifest.assets.entries()) {
    const asset = record(value);
    if (
      asset.id !== expected[index] ||
      !Array.isArray(asset.lods) ||
      asset.lods.length !== 2
    )
      throw new Error('Unexpected cabin asset');
    for (const [level, value] of asset.lods.entries()) {
      const lod = record(value),
        name = `${String(asset.id)}.lod${level}.glb`;
      if (
        lod.level !== level ||
        lod.file !== name ||
        lod.url !== `${BASE}${name}` ||
        !/^[a-f0-9]{64}$/.test(String(lod.sha256)) ||
        !Number.isSafeInteger(lod.bytes) ||
        Number(lod.bytes) <= 0 ||
        Number(lod.bytes) > 1_500_000 ||
        !Number.isSafeInteger(lod.triangles) ||
        Number(lod.triangles) <= 0 ||
        Number(lod.triangles) > 12_000 ||
        !Number.isSafeInteger(lod.primitives) ||
        Number(lod.primitives) <= 0 ||
        !Array.isArray(lod.materialNames) ||
        !lod.materialNames.length ||
        !lod.materialNames.every((name) => typeof name === 'string')
      )
        throw new Error('Invalid cabin LOD');
    }
  }
  if (manifest.cabins.length !== 2)
    throw new Error('Incomplete cabin displays');
  for (const [index, value] of manifest.cabins.entries()) {
    const cabin = record(value),
      mark = index === 0;
    if (
      cabin.id !== (mark ? 'mark-v' : 'canada-line') ||
      cabin.interiorId !== expected[mark ? 0 : 1] ||
      cabin.exteriorId !== (mark ? null : expected[2]) ||
      cabin.seatCount !== (mark ? 22 : 20) ||
      cabin.defaultViewpoint !== 'standing' ||
      !Array.isArray(cabin.viewpoints) ||
      cabin.viewpoints.length !== Number(cabin.seatCount) + 1
    )
      throw new Error('Invalid cabin viewpoints');
    const ids = new Set<string>();
    for (const value of cabin.viewpoints) {
      const view = record(value);
      if (
        typeof view.id !== 'string' ||
        ids.has(view.id) ||
        typeof view.nodeId !== 'string' ||
        !vector(view.positionM, 3) ||
        !vector(view.offsetM, 3) ||
        !vector(view.facingXZ, 2) ||
        !['seat', 'standing'].includes(String(view.kind))
      )
        throw new Error('Invalid cabin camera');
      ids.add(view.id);
    }
    if (
      !ids.has('standing') ||
      cabin.viewpoints.filter((view) => record(view).kind === 'seat').length !==
        cabin.seatCount
    )
      throw new Error('Incomplete cabin cameras');
  }
  return value as CabinManifest;
}

/** The GLTFLoader material is kept intact: base colour, embedded PBR maps,
 * alpha, roughness, metalness and COLOR_0 multiplication retain artist intent. */
export function disposeCabinScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    bitmaps = new Set<ImageBitmap>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) {
          textures.add(value);
          if (
            typeof ImageBitmap !== 'undefined' &&
            value.source?.data instanceof ImageBitmap
          )
            bitmaps.add(value.source.data);
        }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  bitmaps.forEach((bitmap) => bitmap.close());
  scene.removeFromParent();
  scene.clear();
}

async function defaultLoad(
  url: string,
  signal: AbortSignal,
): Promise<CabinGLTF> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Cabin GLB request failed');
  const bytes = await response.arrayBuffer();
  if (signal.aborted)
    throw new DOMException('Cancelled cabin load', 'AbortError');
  // Parsing embedded textures is not abortable; the session disposes late results.
  return new GLTFLoader().parseAsync(bytes, BASE);
}

/** A display session owns one selected cabin only. Closing or changing its
 * model/LOD aborts fetches and releases all old resources, including late parses.
 * There is no global retained geometry or texture cache while the dialog closes. */
export class SkyTrainCabinAssets {
  private generation = 0;
  private disposed = false;
  private controller: AbortController | null = null;
  private owner: CabinOwner | null = null;
  private manifest: CabinManifest | null = null;
  private readonly load;
  private readonly fetchManifest;
  constructor(options: CabinAssetOptions = {}) {
    this.load = options.load ?? defaultLoad;
    this.fetchManifest =
      options.fetchManifest ??
      (async (signal: AbortSignal) => {
        const response = await fetch(`${BASE}manifest.json`, { signal });
        if (!response.ok) throw new Error('Cabin metadata request failed');
        return response.json();
      });
  }
  async open(id: CabinId, level: 0 | 1): Promise<CabinOwner | null> {
    if (this.disposed) return null;
    this.clear();
    const generation = this.generation,
      controller = new AbortController();
    this.controller = controller;
    const current = () =>
      !this.disposed &&
      generation === this.generation &&
      !controller.signal.aborted;
    const loaded: CabinGLTF[] = [];
    try {
      const manifest =
        this.manifest ??
        validateCabinManifest(await this.fetchManifest(controller.signal));
      if (!current()) return null;
      this.manifest = manifest;
      const descriptor = manifest.cabins.find((cabin) => cabin.id === id);
      if (!descriptor) throw new Error('Unknown cabin display');
      const ids = [
        descriptor.interiorId,
        ...(descriptor.exteriorId ? [descriptor.exteriorId] : []),
      ];
      // allSettled accounts for a successful sibling when another file fails.
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const asset = manifest.assets.find((asset) => asset.id === id)!;
          const lod = asset.lods[level];
          const gltf = await this.load(lod.url, controller.signal);
          loaded.push(gltf);
          const names = new Set<string>();
          gltf.scene.traverse((object) => {
            if (object instanceof THREE.Mesh)
              for (const material of Array.isArray(object.material)
                ? object.material
                : [object.material])
                names.add(material.name);
          });
          if (!lod.materialNames.every((name) => names.has(name)))
            throw new Error('Missing authored cabin materials');
          return gltf;
        }),
      );
      if (!current()) {
        loaded.forEach((gltf) => disposeCabinScene(gltf.scene));
        return null;
      }
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      const group = new THREE.Group();
      loaded.forEach((gltf) => group.add(gltf.scene));
      group.updateMatrixWorld(true);
      // Verify projection against loaded anchors, avoiding the duplicated vehicle
      // names between Canada exterior and interior by checking the interior only.
      const interior = (results[0] as PromiseFulfilledResult<CabinGLTF>).value
        .scene;
      for (const view of descriptor.viewpoints) {
        const node = interior.getObjectByName(view.nodeId);
        if (!node) throw new Error('Missing exported cabin camera');
        const actual = node
          .getWorldPosition(new THREE.Vector3())
          .add(new THREE.Vector3(...view.offsetM));
        if (actual.distanceTo(new THREE.Vector3(...view.positionM)) > 0.00001)
          throw new Error('Cabin camera differs from projection');
      }
      const mixer = new THREE.AnimationMixer(group);
      let released = false;
      const resources = ids.map((id) => {
        const lod = manifest.assets.find((asset) => asset.id === id)!.lods[
          level
        ];
        return { file: lod.file, sha256: lod.sha256, bytes: lod.bytes };
      });
      const owner: CabinOwner = {
        group,
        descriptor,
        level,
        mixer,
        resources,
        dispose() {
          if (released) return;
          released = true;
          mixer.stopAllAction();
          mixer.uncacheRoot(group);
          disposeCabinScene(group);
        },
      };
      this.owner = owner;
      return owner;
    } catch (error) {
      loaded.forEach((gltf) => disposeCabinScene(gltf.scene));
      if (!current()) return null;
      throw error;
    }
  }
  private clear() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    this.owner?.dispose();
    this.owner = null;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.manifest = null;
  }
}

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { busRoutePose, type BusRoute } from './city-buses';
import type { VisualQuality } from './quality';
import { BusCabinSurfaces } from './bus-cabin-surfaces';
import type { BusVisitProfile } from './bus-visit-policy';

const MANIFEST_URL = '/models/blender/bus/manifest.json';
const V2_MANIFEST_URL = '/models/blender/bus-v2/manifest.json';
const REFERENCE_MANIFEST_URL = '/models/blender/bus-closeup/manifest.json';
const ROLES = [
  'paint',
  'rubber',
  'glass',
  'lights',
  'panel',
  'seat',
  'rail',
  'floor',
] as const;
type Role = (typeof ROLES)[number];
type BusGLTF = Pick<GLTF, 'scene' | 'animations'>;
export type BusAssetLoader = (
  url: string,
  signal?: AbortSignal,
) => Promise<BusGLTF>;
interface BusLod {
  level: number;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  triangles: number;
  primitives: number;
}
export interface BusRuntimeManifest {
  schemaVersion: 1;
  packageId:
    | 'boardable-bus'
    | 'boardable-bus-v2-runtime-candidate'
    | 'boardable-bus-v2-closeup-quality';
  version: '1.0.0';
  units: 'm';
  vehicles: Record<string, unknown>[];
  assets: { id: string; lods: BusLod[] }[];
  [key: string]: unknown;
}
export interface BoardableBusOwner {
  /** Common Y-up, +Z-forward vehicle root; caller attaches and positions it. */
  group: THREE.Group;
  exteriorRoot: THREE.Object3D;
  interiorRoot: THREE.Object3D;
  animations: readonly THREE.AnimationClip[];
  mixer: THREE.AnimationMixer;
  manifest: BusRuntimeManifest;
  /** Manifest vehicle contract, not a scene object. Seat points are pelvis datums. */
  vehicle: Record<string, unknown>;
  /** Actual v2 rendered slab support; absent for the preserved v1 test contract. */
  cabinSurfaces?: BusCabinSurfaces;
  profile?: BusVisitProfile;
  requestedProfile?: BusVisitProfile;
  fallback?: boolean;
  /** Detach and release the visit. Shared template buffers belong to CityBusAssets. */
  dispose(): void;
}
export interface BusAssetsOptions {
  /** Production stage 2 keeps the pinned exterior and replaces only the cabin. */
  interiorVersion?: 'v1' | 'v2';
  load?: BusAssetLoader;
  fetchManifest?: () => Promise<unknown>;
  fetchReferenceManifest?: () => Promise<unknown>;
}
export interface BusRenderPolicy {
  quality: VisualQuality;
  compatible: boolean;
  allowNew: boolean;
}
interface NearCandidate {
  id: number;
  distance: number;
  pose: ReturnType<typeof busRoutePose>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid bus metadata record');
  return value as Record<string, unknown>;
}

/** Validate the production projection; never import the offline authoring package. */
function manifestContract(
  value: unknown,
  version: 'v1' | 'v2' | 'reference',
): BusRuntimeManifest {
  const m = record(value);
  const reference = version === 'reference',
    v2 = version !== 'v1',
    interiorId = reference
      ? 'city-bus-12m-interior-v2-closeup'
      : v2
        ? 'city-bus-12m-interior-v2-runtime'
        : 'city-bus-12m-interior';
  if (
    m.contract !==
      (reference
        ? 'boardable-bus-closeup-runtime-v1'
        : v2
          ? 'boardable-bus-runtime-v2'
          : 'boardable-bus-runtime-v1') ||
    m.schemaVersion !== 1 ||
    m.packageId !==
      (reference
        ? 'boardable-bus-v2-closeup-quality'
        : v2
          ? 'boardable-bus-v2-runtime-candidate'
          : 'boardable-bus') ||
    m.version !== '1.0.0' ||
    m.units !== 'm' ||
    !Array.isArray(m.assets) ||
    !Array.isArray(m.vehicles)
  )
    throw new Error('Unsupported bus manifest');
  const seen = new Set<string>();
  for (const assetValue of m.assets) {
    const asset = record(assetValue);
    if (
      !['city-bus-12m-exterior', interiorId].includes(String(asset.id)) ||
      seen.has(String(asset.id)) ||
      !Array.isArray(asset.lods)
    )
      throw new Error('Unexpected bus asset');
    seen.add(String(asset.id));
    const interior = asset.id === interiorId;
    const levels = interior ? [0, 1] : [0, 1, 2];
    if (asset.lods.length !== levels.length)
      throw new Error('Incomplete bus LOD inventory');
    for (const [index, lodValue] of asset.lods.entries()) {
      const lod = record(lodValue),
        expected = `${String(asset.id)}.lod${levels[index]}.glb`;
      if (
        lod.level !== levels[index] ||
        lod.file !== expected ||
        lod.url !==
          `/models/blender/${reference && interior ? 'bus-closeup' : v2 && interior ? 'bus-v2' : 'bus'}/${expected}` ||
        typeof lod.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(lod.sha256) ||
        !Number.isSafeInteger(lod.bytes) ||
        Number(lod.bytes) <= 0 ||
        Number(lod.bytes) >
          (reference && interior
            ? levels[index] === 0
              ? 9_000_000
              : 3_100_000
            : v2 && interior
              ? levels[index] === 0
                ? 1_572_864
                : 393_216
              : 1_000_000) ||
        !Number.isSafeInteger(lod.triangles) ||
        Number(lod.triangles) <= 0 ||
        Number(lod.triangles) >
          (reference && interior
            ? levels[index] === 0
              ? 300_000
              : 100_000
            : v2 && interior
              ? levels[index] === 0
                ? 12_000
                : 3_000
              : 10_000) ||
        !Number.isSafeInteger(lod.primitives) ||
        Number(lod.primitives) <= 0 ||
        (v2 && interior && lod.primitives !== (reference ? 13 : 11))
      )
        throw new Error('Invalid bus LOD descriptor');
    }
  }
  if (
    seen.size !== 2 ||
    m.vehicles.length !== 1 ||
    record(m.vehicles[0]).vehicleId !== 'city-bus-12m'
  )
    throw new Error('Incomplete bus vehicle contract');
  if (reference) {
    const textures = m.textures;
    if (!Array.isArray(textures) || textures.length !== 1)
      throw new Error('Invalid reference bus texture inventory');
    const texture = record(textures[0]);
    if (
      texture.textureId !== 'floor-speckle' ||
      texture.width !== 256 ||
      texture.height !== 256 ||
      texture.colorSpace !== 'sRGB' ||
      texture.semantic !== 'baseColor'
    )
      throw new Error('Unsupported reference bus texture');
  }
  return value as BusRuntimeManifest;
}

/** A source scene owns each unique resource once, even for multi-primitive nodes. */
function disposeSource(scene: THREE.Object3D) {
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
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  bitmaps.forEach((bitmap) => bitmap.close());
}

function textureDimensions(texture: THREE.Texture) {
  const image = texture.image as
    | { width?: number; height?: number }
    | undefined;
  return [image?.width, image?.height];
}

function roleOf(material: THREE.Material, reference = false): Role {
  const role = material.userData.semantic_role ?? material.name;
  if (
    !ROLES.includes(role as Role) ||
    !(material instanceof THREE.MeshStandardMaterial)
  )
    throw new Error('Unsupported bus semantic material');
  const textures = Object.values(material).filter(
    (v) => v instanceof THREE.Texture,
  );
  const floor = material.userData.shared_surface_id === 'bus-v2-floor';
  if (
    textures.length &&
    (!reference ||
      !floor ||
      textures.length !== 1 ||
      textures[0] !== material.map)
  )
    throw new Error('Unsupported bus semantic texture');
  if (reference && floor) {
    const map = material.map;
    if (
      !map ||
      map.colorSpace !== THREE.SRGBColorSpace ||
      textureDimensions(map).some((size) => size !== 256) ||
      map.flipY !== false ||
      map.channel !== 0 ||
      map.wrapS !== THREE.RepeatWrapping ||
      map.wrapT !== THREE.RepeatWrapping ||
      map.magFilter !== THREE.LinearFilter ||
      map.minFilter !== THREE.LinearMipmapLinearFilter
    )
      throw new Error('Invalid reference bus floor texture');
  }
  return role as Role;
}

function checkGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  if (
    !position ||
    position.itemSize !== 3 ||
    !normal ||
    normal.itemSize !== 3 ||
    normal.count !== position.count
  )
    throw new Error('Invalid bus position/normal geometry');
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute.count !== position.count)
      throw new Error('Misaligned bus vertex attributes');
    for (let i = 0; i < attribute.array.length; i++)
      if (!Number.isFinite(attribute.array[i]))
        throw new Error('Non-finite bus geometry');
  }
  if (geometry.index)
    for (const index of geometry.index.array)
      if (!Number.isSafeInteger(index) || index < 0 || index >= position.count)
        throw new Error('Invalid bus triangle index');
}

/**
 * Fixed four-bus near pool. Exterior1 and interior1 become shared material
 * batches; doors stay closed and wheels static. Every unrepresented route stays
 * with the legacy/far renderer, including during failures and pool overflow.
 */
export class CityBusAssets {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private disposed = false;
  private nearState: 'idle' | 'loading' | 'ready' | 'error' | 'disposed' =
    'idle';
  private nearIds = new Set<number>();
  private excluded = new Set<number>();
  private meshes: THREE.InstancedMesh[] = [];
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private referenceMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private templates = new Map<string, Promise<BusGLTF>>();
  private templateSignals = new Map<string, AbortSignal>();
  private sourceScenes = new Set<THREE.Object3D>();
  private manifest: Promise<BusRuntimeManifest> | null = null;
  private referenceManifest: Promise<BusRuntimeManifest> | null = null;
  private resolveReady!: () => void;
  private boardableOwner: BoardableBusOwner | null = null;
  private boardablePending: Promise<BoardableBusOwner> | null = null;
  private boardableSignal: AbortSignal | null = null;
  private boardableGeneration = 0;
  private boardableState = 'idle';
  private errors: string[] = [];
  private assetBytes = 0;
  private nearTriangles = 0;
  private updates = 0;
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3();
  private right = new THREE.Vector3();
  private roadRotation = new THREE.Matrix4();
  private transform = new THREE.Object3D();

  constructor(
    private readonly routes: readonly BusRoute[],
    parent: THREE.Object3D,
    private readonly options: BusAssetsOptions = {},
  ) {
    this.group.name = 'Source boardable buses: bounded near fleet';
    this.group.userData.provenance = {
      packageId:
        options.interiorVersion === 'v2'
          ? 'boardable-bus-v2-runtime-candidate'
          : 'boardable-bus',
      version: '1.0.0',
      project: 'Vancouver Living Atlas by YiTaChen',
      source: 'https://github.com/YiTaChen/vancouver-living-atlas',
      license:
        'Vancouver Living Atlas Noncommercial Research and Attribution 1.0',
    };
    this.group.visible = false;
    parent.add(this.group);
    // This promise settles after an eligible near update requests the pair,
    // or after disposal. Cold overview/hidden traffic performs no asset work.
    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  private loadManifest(): Promise<BusRuntimeManifest> {
    if (this.manifest) return this.manifest;
    const requested = Promise.resolve()
      .then(async () => {
        if (this.disposed) throw new Error('Bus assets disposed');
        if (this.options.fetchManifest) return this.options.fetchManifest();
        const response = await fetch(
          this.options.interiorVersion === 'v2'
            ? V2_MANIFEST_URL
            : MANIFEST_URL,
        );
        if (!response.ok)
          throw new Error(`Bus manifest load failed (${response.status})`);
        return response.json();
      })
      .then((value) =>
        manifestContract(value, this.options.interiorVersion ?? 'v1'),
      );
    const tracked: Promise<BusRuntimeManifest> = requested.catch((error) => {
      if (this.manifest === tracked) this.manifest = null;
      throw error;
    });
    this.manifest = tracked;
    return tracked;
  }

  private loadReferenceManifest(): Promise<BusRuntimeManifest> {
    if (this.referenceManifest) return this.referenceManifest;
    const requested = Promise.resolve()
      .then(async () => {
        if (this.disposed) throw new Error('Bus assets disposed');
        if (this.options.fetchReferenceManifest)
          return this.options.fetchReferenceManifest();
        const response = await fetch(REFERENCE_MANIFEST_URL);
        if (!response.ok)
          throw new Error(
            `Bus reference manifest load failed (${response.status})`,
          );
        return response.json();
      })
      .then((value) => manifestContract(value, 'reference'));
    const tracked = requested.catch((error) => {
      if (this.referenceManifest === tracked) this.referenceManifest = null;
      throw error;
    });
    this.referenceManifest = tracked;
    return tracked;
  }

  private requestNear() {
    if (this.nearState !== 'idle' || this.disposed) return;
    this.nearState = 'loading';
    void this.loadNear()
      .catch((error) => {
        if (!this.disposed) {
          this.nearState = 'error';
          this.report(error);
        }
      })
      .finally(() => this.resolveReady());
  }

  /** Suppression belongs to stable route IDs, never compacted instance slots. */
  setExcludedRoutes(ids: ReadonlySet<number>) {
    this.excluded = new Set(
      [...ids].filter(
        (id) => Number.isSafeInteger(id) && id >= 0 && id < this.routes.length,
      ),
    );
  }

  private report(error: unknown) {
    if (this.errors.length < 8)
      this.errors.push(error instanceof Error ? error.message : String(error));
  }

  private descriptor(
    manifest: BusRuntimeManifest,
    kind: 'exterior' | 'interior',
    level: number,
  ): BusLod {
    const descriptor = manifest.assets
      .find(
        (a) =>
          a.id ===
          (kind === 'interior' &&
          manifest.packageId === 'boardable-bus-v2-closeup-quality'
            ? 'city-bus-12m-interior-v2-closeup'
            : kind === 'interior' && this.options.interiorVersion === 'v2'
              ? 'city-bus-12m-interior-v2-runtime'
              : `city-bus-12m-${kind}`),
      )
      ?.lods.find((l) => l.level === level);
    if (!descriptor) throw new Error('Bus LOD unavailable');
    return descriptor;
  }

  private template(descriptor: BusLod, signal?: AbortSignal): Promise<BusGLTF> {
    const reference = descriptor.file.startsWith(
      'city-bus-12m-interior-v2-closeup.',
    );
    if (this.templateSignals.get(descriptor.file)?.aborted) {
      this.templates.delete(descriptor.file);
      this.templateSignals.delete(descriptor.file);
    }
    let promise = this.templates.get(descriptor.file);
    if (!promise) {
      if (reference && signal)
        this.templateSignals.set(descriptor.file, signal);
      promise = Promise.resolve()
        .then(() =>
          (
            this.options.load ??
            (async (url, activeSignal) => {
              if (!activeSignal) return new GLTFLoader().loadAsync(url);
              const response = await fetch(url, { signal: activeSignal });
              if (!response.ok)
                throw new Error('Bus reference GLB request failed');
              const bytes = await response.arrayBuffer();
              activeSignal.throwIfAborted();
              return new GLTFLoader().parseAsync(
                bytes,
                url.slice(0, url.lastIndexOf('/') + 1),
              );
            })
          )(
            `${descriptor.url}?v=${descriptor.sha256.slice(0, 12)}`,
            reference ? signal : undefined,
          ),
        )
        .then((gltf) => {
          if (this.disposed || (reference && signal?.aborted)) {
            disposeSource(gltf.scene);
            throw signal?.reason ?? new Error('Bus assets disposed');
          }
          let triangles = 0,
            primitives = 0;
          const geometries = new Set<THREE.BufferGeometry>();
          try {
            gltf.scene.traverse((object) => {
              if (!(object instanceof THREE.Mesh)) return;
              checkGeometry(object.geometry);
              geometries.add(object.geometry);
              for (const material of Array.isArray(object.material)
                ? object.material
                : [object.material])
                roleOf(material, reference);
              triangles +=
                (object.geometry.index?.count ??
                  object.geometry.getAttribute('position').count) / 3;
              primitives += Array.isArray(object.material)
                ? object.material.length
                : 1;
            });
            if (
              triangles !== descriptor.triangles ||
              primitives !== descriptor.primitives
            )
              throw new Error('Bus source geometry differs from manifest');
            // Near and parked meshes share vertex-color materials. COLOR_0 is
            // optional in glTF: white supplies its neutral multiplier once per
            // managed buffer, preserving authored PBR factors and existing color.
            for (const geometry of geometries)
              if (!geometry.getAttribute('color'))
                geometry.setAttribute(
                  'color',
                  new THREE.BufferAttribute(
                    new Float32Array(
                      geometry.getAttribute('position').count * 4,
                    ).fill(1),
                    4,
                  ),
                );
            this.sourceScenes.add(gltf.scene);
            this.assetBytes += descriptor.bytes;
            if (
              reference &&
              this.templateSignals.get(descriptor.file) === signal
            )
              this.templateSignals.delete(descriptor.file);
            return gltf;
          } catch (error) {
            disposeSource(gltf.scene);
            throw error;
          }
        });
      const requested = promise;
      promise = requested.catch((error) => {
        if (this.templates.get(descriptor.file) === promise) {
          this.templates.delete(descriptor.file);
          this.templateSignals.delete(descriptor.file);
        }
        throw error;
      });
      this.templates.set(descriptor.file, promise);
    }
    return promise;
  }

  private surfaceKey(source: THREE.Material, reference = false): string {
    const role = roleOf(source, reference);
    return this.options.interiorVersion === 'v2'
      ? `${role}:${String(source.userData.shared_surface_id ?? source.name)}`
      : role;
  }

  private material(
    source: THREE.Material,
    reference = false,
  ): THREE.MeshStandardMaterial {
    const role = roleOf(source, reference);
    const key = this.surfaceKey(source, reference),
      pool = reference ? this.referenceMaterials : this.materials;
    let shared = pool.get(key);
    if (!shared) {
      if (
        pool.size >=
        (reference ? 13 : this.options.interiorVersion === 'v2' ? 15 : 8)
      )
        throw new Error('Bus shared material cache budget exceeded');
      shared = (source as THREE.MeshStandardMaterial).clone();
      shared.name = `Bus shared ${reference ? 'reference ' : ''}${key}`;
      // The source's linear PBR factors, opacity, emissive intensity and side
      // remain intact. COLOR_0, if present, multiplies those source factors.
      shared.vertexColors = true;
      pool.set(key, shared);
    } else {
      const signature = (m: THREE.MeshStandardMaterial) =>
        JSON.stringify([
          ...m.color.toArray(),
          m.roughness,
          m.metalness,
          m.opacity,
          m.transparent,
          m.depthWrite,
          m.side,
          m.alphaTest,
          m.blending,
          ...m.emissive.toArray(),
          m.emissiveIntensity,
          m.map
            ? [
                m.map.name,
                m.map.colorSpace,
                m.map.wrapS,
                m.map.wrapT,
                m.map.minFilter,
                m.map.magFilter,
                m.map.flipY,
                m.map.channel,
                ...m.map.repeat.toArray(),
                ...m.map.offset.toArray(),
                m.map.rotation,
                ...textureDimensions(m.map),
              ]
            : null,
        ]);
      if (signature(shared) !== signature(source as THREE.MeshStandardMaterial))
        throw new Error(`Bus role ${role} has inconsistent material factors`);
    }
    return shared;
  }

  private async loadNear() {
    const manifest = await this.loadManifest();
    const results = await Promise.allSettled(
      ['exterior', 'interior'].map((kind) =>
        this.template(
          this.descriptor(manifest, kind as 'exterior' | 'interior', 1),
        ),
      ),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    if (this.disposed) return;
    const scenes = results.map(
      (r) => (r as PromiseFulfilledResult<BusGLTF>).value.scene,
    );
    const pieces = new Map<string, THREE.BufferGeometry[]>();
    const merged: THREE.BufferGeometry[] = [];
    try {
      for (const scene of scenes) {
        scene.updateMatrixWorld(true);
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          if (Array.isArray(object.material))
            throw new Error('Expected GLTF primitive meshes');
          const key = this.surfaceKey(object.material),
            source = object.geometry;
          this.material(object.material);
          const geometry = source.index
            ? source.toNonIndexed()
            : source.clone();
          const list = pieces.get(key) ?? [];
          list.push(geometry);
          pieces.set(key, list);
          geometry.applyMatrix4(object.matrixWorld);
          const count = geometry.getAttribute('position').count;
          for (const key of Object.keys(geometry.attributes))
            if (!['position', 'normal', 'color', 'uv'].includes(key))
              geometry.deleteAttribute(key);
          const originalColor = geometry.getAttribute('color'),
            rgba = new Float32Array(count * 4).fill(1);
          if (originalColor)
            for (let i = 0; i < count; i++) {
              rgba[i * 4] = originalColor.getX(i);
              rgba[i * 4 + 1] = originalColor.getY(i);
              rgba[i * 4 + 2] = originalColor.getZ(i);
              rgba[i * 4 + 3] =
                originalColor.itemSize === 4 ? originalColor.getW(i) : 1;
            }
          geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
          if (!geometry.getAttribute('uv'))
            geometry.setAttribute(
              'uv',
              new THREE.BufferAttribute(new Float32Array(count * 2), 2),
            );
          geometry.clearGroups();
        });
      }
      for (const role of ROLES)
        if (
          ![...pieces.keys()].some(
            (key) => key === role || key.startsWith(`${role}:`),
          )
        )
          throw new Error(`Missing bus role ${role}`);
      if (pieces.size > (this.options.interiorVersion === 'v2' ? 15 : 8))
        throw new Error('Bus shared material batch budget exceeded');
      for (const [key, list] of pieces) {
        const geometry = mergeGeometries(list);
        if (!geometry) throw new Error(`Could not merge bus ${key}`);
        merged.push(geometry);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        this.nearTriangles += geometry.getAttribute('position').count / 3;
        const mesh = new THREE.InstancedMesh(
          geometry,
          this.materials.get(key)!,
          4,
        );
        mesh.name = `Near bus shared ${key}`;
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (roleOf(mesh.material) === 'glass')
          mesh.userData.excludeFromSSAO = true;
        this.meshes.push(mesh);
      }
      this.group.add(...this.meshes);
      this.nearState = 'ready';
    } catch (error) {
      merged.forEach((g) => g.dispose());
      this.meshes.forEach((m) => m.dispose());
      this.meshes = [];
      this.nearTriangles = 0;
      throw error;
    } finally {
      [...pieces.values()].flat().forEach((g) => g.dispose());
    }
  }

  update(
    time: number,
    camera: THREE.Vector3,
    roadHeight: (x: number, z: number) => number,
    policy: BusRenderPolicy,
  ): Set<number> {
    this.updates++;
    const replaced = new Set<number>();
    if (this.disposed) return replaced;
    if (this.nearState === 'idle' && policy.allowNew) {
      for (let id = 0; id < this.routes.length; id++) {
        if (this.excluded.has(id)) continue;
        const pose = busRoutePose(this.routes[id], time, roadHeight);
        if (
          Number.isFinite(pose.y) &&
          Math.hypot(pose.x - camera.x, pose.y - camera.y, pose.z - camera.z) <
            80
        ) {
          this.requestNear();
          break;
        }
      }
    }
    if (this.nearState !== 'ready') return replaced;
    const candidates: NearCandidate[] = [];
    for (let id = 0; id < this.routes.length; id++) {
      if (this.excluded.has(id)) continue;
      const pose = busRoutePose(this.routes[id], time, roadHeight);
      if (![pose.x, pose.y, pose.z, pose.yaw].every(Number.isFinite)) continue;
      const distance = Math.hypot(
        pose.x - camera.x,
        pose.y - camera.y,
        pose.z - camera.z,
      );
      const existing = this.nearIds.has(id);
      if (distance >= (existing ? 110 : 80) || (!existing && !policy.allowNew))
        continue;
      candidates.push({ id, distance, pose });
    }
    const capacity = policy.compatible ? 2 : 4;
    candidates.sort((a, b) => a.distance - b.distance || a.id - b.id);
    const selected = candidates.slice(0, capacity).reverse();
    // Farthest-first instance order bounds transparent sorting to four actors.
    // It does not claim to solve all intersecting transparent surfaces.
    let count = 0;
    for (const { id, pose } of selected) {
      const dx = Math.sin(pose.yaw),
        dz = Math.cos(pose.yaw),
        halfAxle = 3.1,
        halfTrack = 1.13;
      const front = roadHeight(pose.x + dx * halfAxle, pose.z + dz * halfAxle),
        rear = roadHeight(pose.x - dx * halfAxle, pose.z - dz * halfAxle),
        right = roadHeight(pose.x + dz * halfTrack, pose.z - dx * halfTrack),
        left = roadHeight(pose.x - dz * halfTrack, pose.z + dx * halfTrack);
      if (![front, rear, right, left].every(Number.isFinite)) continue;
      const grade = (front - rear) / (2 * halfAxle),
        crossSlope = (right - left) / (2 * halfTrack);
      this.forward.set(dx, grade, dz).normalize();
      this.up
        .set(-dx * grade - dz * crossSlope, 1, -dz * grade + dx * crossSlope)
        .normalize();
      this.right.crossVectors(this.up, this.forward).normalize();
      this.roadRotation.makeBasis(this.right, this.up, this.forward);
      this.transform.quaternion.setFromRotationMatrix(this.roadRotation);
      this.transform.position.set(pose.x, (front + rear) / 2, pose.z);
      this.transform.updateMatrix();
      this.meshes.forEach((mesh) =>
        mesh.setMatrixAt(count, this.transform.matrix),
      );
      count++;
      replaced.add(id);
    }
    this.nearIds = replaced;
    for (const mesh of this.meshes) {
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = count > 0;
    }
    this.group.visible = count > 0;
    return new Set(replaced);
  }

  /** One live parked visit, coalesced loads, and a bounded reusable template cache. */
  loadBoardable(
    options: { signal?: AbortSignal; profile?: BusVisitProfile } = {},
  ): Promise<BoardableBusOwner> {
    if (this.disposed) return Promise.reject(new Error('Bus assets disposed'));
    if (options.signal?.aborted)
      return Promise.reject(
        options.signal.reason ?? new Error('Bus visit aborted'),
      );
    if (this.boardableOwner) return Promise.resolve(this.boardableOwner);
    if (this.boardablePending && !this.boardableSignal?.aborted)
      return this.boardablePending;
    const generation = ++this.boardableGeneration;
    this.boardableSignal = options.signal ?? null;
    this.boardableState = 'loading';
    const pending = this.createBoardable(
      options.signal,
      options.profile ?? 'budget',
    )
      .then((owner) => {
        if (
          this.disposed ||
          options.signal?.aborted ||
          generation !== this.boardableGeneration
        ) {
          owner.dispose();
          throw options.signal?.reason ?? new Error('Bus assets disposed');
        }
        this.boardableOwner = owner;
        this.boardableState = 'ready';
        return owner;
      })
      .catch((error) => {
        if (!this.disposed && generation === this.boardableGeneration) {
          this.boardableState = 'error';
          this.report(error);
        }
        throw error;
      })
      .finally(() => {
        if (this.boardablePending === pending) {
          this.boardablePending = null;
          this.boardableSignal = null;
        }
      });
    this.boardablePending = pending;
    return this.boardablePending;
  }

  private async createBoardable(
    signal?: AbortSignal,
    requestedProfile: BusVisitProfile = 'budget',
  ): Promise<BoardableBusOwner> {
    if (
      requestedProfile !== 'budget' &&
      this.options.interiorVersion === 'v2'
    ) {
      try {
        const manifest = await this.loadReferenceManifest();
        signal?.throwIfAborted();
        if (this.disposed) throw new Error('Bus assets disposed');
        return await this.createBoardableFrom(
          manifest,
          requestedProfile,
          requestedProfile,
          signal,
        );
      } catch (error) {
        if (this.disposed || signal?.aborted) throw error;
        this.report(error);
        // A parked visit remains available when the optional detail download
        // fails. The traffic pool's budget manifest and caps stay independent.
      }
    }
    const manifest = await this.loadManifest();
    return this.createBoardableFrom(
      manifest,
      'budget',
      requestedProfile,
      signal,
    );
  }

  private async createBoardableFrom(
    manifest: BusRuntimeManifest,
    profile: BusVisitProfile,
    requestedProfile: BusVisitProfile,
    signal?: AbortSignal,
  ): Promise<BoardableBusOwner> {
    const reference = profile !== 'budget';
    const results = await Promise.allSettled(
      ['exterior', 'interior'].map((kind) =>
        this.template(
          this.descriptor(
            manifest,
            kind as 'exterior' | 'interior',
            kind === 'interior' && profile === 'reference-lod1' ? 1 : 0,
          ),
          reference && kind === 'interior' ? signal : undefined,
        ),
      ),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    if (this.disposed) throw new Error('Bus assets disposed');
    signal?.throwIfAborted();
    const [exterior, interior] = results.map(
      (r) => (r as PromiseFulfilledResult<BusGLTF>).value,
    );
    const group = new THREE.Group(),
      exteriorRoot = exterior.scene.clone(true),
      interiorRoot = interior.scene.clone(true);
    const doors = manifest.vehicles[0].doors;
    if (!Array.isArray(doors) || doors.length !== 4)
      throw new Error('Incomplete boardable bus door contract');
    for (const value of doors) {
      const door = record(value),
        node = exteriorRoot.getObjectByName(String(door.nodeId)),
        clip = exterior.animations.find((c) => c.name === door.animationClip);
      if (
        !node ||
        !clip ||
        !Number.isFinite(clip.duration) ||
        clip.duration <= 0 ||
        !clip.tracks.some((t) => t.name === `${String(door.nodeId)}.position`)
      )
        throw new Error('Boardable bus door node/clip unavailable');
    }
    group.name = 'Parked boardable bus';
    group.userData.provenance = {
      ...this.group.userData.provenance,
      packageId: manifest.packageId,
      assetSource: manifest.source,
      profile,
      requestedProfile,
      fallback: profile !== requestedProfile,
    };
    for (const scene of [exteriorRoot, interiorRoot])
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const referenceMaterial = reference && scene === interiorRoot;
        const replace = (material: THREE.Material) =>
          this.material(material, referenceMaterial);
        object.material = Array.isArray(object.material)
          ? object.material.map(replace)
          : replace(object.material);
        if (
          roleOf(
            Array.isArray(object.material)
              ? object.material[0]
              : object.material,
            referenceMaterial,
          ) === 'glass'
        )
          object.userData.excludeFromSSAO = true;
        object.castShadow = false;
        object.receiveShadow = true;
      });
    group.add(exteriorRoot, interiorRoot);
    let cabinSurfaces: BusCabinSurfaces | undefined;
    if (this.options.interiorVersion === 'v2') {
      cabinSurfaces = new BusCabinSurfaces(interiorRoot, manifest.vehicles[0]);
      cabinSurfaces.validate();
    }
    const animations = exterior.animations,
      mixer = new THREE.AnimationMixer(group);
    let released = false;
    const owner: BoardableBusOwner = {
      group,
      exteriorRoot,
      interiorRoot,
      animations,
      mixer,
      manifest,
      vehicle: manifest.vehicles[0],
      cabinSurfaces,
      profile,
      requestedProfile,
      fallback: profile !== requestedProfile,
      dispose: () => {
        if (released) return;
        released = true;
        mixer.stopAllAction();
        mixer.uncacheRoot(group);
        group.removeFromParent();
        group.clear();
        if (this.boardableOwner === owner) {
          this.boardableOwner = null;
          if (!this.disposed) this.boardableState = 'idle';
        }
      },
    };
    return owner;
  }

  stats() {
    const count = this.meshes[0]?.count ?? 0;
    const textures = new Set<THREE.Texture>();
    for (const scene of this.sourceScenes)
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
      });
    return {
      status: this.nearState,
      nearActors: count,
      routeActors: this.routes.length,
      nearCapacity: 4,
      interiorVersion: this.options.interiorVersion ?? 'v1',
      allocatedBatches: this.meshes.length,
      /** Main beauty primitive estimate. Double-sided glass may submit twice. */
      populatedBatches: count ? this.meshes.length : 0,
      triangles: count * this.nearTriangles,
      textures: textures.size,
      materials: this.materials.size + this.referenceMaterials.size,
      referenceMaterials: this.referenceMaterials.size,
      templateCapacity: 6,
      boardableProfile: this.boardableOwner?.profile ?? null,
      boardableRequestedProfile: this.boardableOwner?.requestedProfile ?? null,
      boardableFallback: this.boardableOwner?.fallback ?? false,
      loadedTemplates: this.sourceScenes.size,
      assetBytes: this.assetBytes,
      boardableStatus: this.boardableState,
      boardableOwners: this.boardableOwner ? 1 : 0,
      updates: this.updates,
      errors: [...this.errors],
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resolveReady();
    this.nearState = 'disposed';
    this.boardableState = 'disposed';
    this.boardableOwner?.dispose();
    this.boardableOwner = null;
    this.group.removeFromParent();
    this.meshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.dispose();
    });
    this.meshes = [];
    this.group.clear();
    this.materials.forEach((material) => material.dispose());
    this.materials.clear();
    this.referenceMaterials.forEach((material) => material.dispose());
    this.referenceMaterials.clear();
    this.sourceScenes.forEach(disposeSource);
    this.sourceScenes.clear();
    this.templates.clear();
    this.templateSignals.clear();
    this.manifest = this.referenceManifest = null;
    this.nearIds.clear();
    this.excluded.clear();
  }
}

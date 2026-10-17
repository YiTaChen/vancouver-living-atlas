import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from '../../public/models/blender/street-furniture/manifest.json';
import type { DetailWorkBudget, SceneryMotionState } from './scenery-motion';
import type {
  FurnitureKind,
  FurniturePlacement,
} from './street-furniture-placement';

type Host = {
  camera: THREE.PerspectiveCamera;
  landmarks: THREE.Group;
  settings: { buildings: boolean; quality: string };
  disposed: boolean;
  compatibleGraphics?: boolean;
  sceneryMotion?: SceneryMotionState | null;
  detailWorkBudget?: DetailWorkBudget | null;
  prepareNightReceivers?(group: THREE.Object3D): void;
};
type Role = 'metal' | 'wood';
type Level = 0 | 1;
type Key = `${FurnitureKind}:${Level}`;
type Asset = (typeof manifest.assets)[number];
type AssetLod = Asset['lods'][number];
type TemplatePart = {
  role: Role;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};
type Batch = {
  mesh: THREE.InstancedMesh;
  admissions: THREE.InstancedBufferAttribute;
  triangles: number;
};
type Selection = { placement: FurniturePlacement; admitted: number };
type Request = {
  key: Key;
  kind: FurnitureKind;
  lod: AssetLod;
  attempts: number;
  retryAt: number;
  complete: boolean;
};
export type StreetFurnitureLoader = (url: string) => Promise<THREE.Object3D>;

const CAPACITY = 64;
const rolesFor = (kind: FurnitureKind): Role[] =>
  kind === 'cedar-bench' ? ['metal', 'wood'] : ['metal'];

export function streetFurnitureUrl(asset: Asset, lod: AssetLod) {
  return `${lod.url}?v=${lod.sha256.slice(0, 12)}`;
}

function materialKey(material: THREE.MeshStandardMaterial) {
  return [
    material.name,
    ...material.color.toArray(),
    material.metalness,
    material.roughness,
    ...material.emissive.toArray(),
    material.emissiveIntensity,
    material.opacity,
    material.side,
    material.vertexColors,
    material.flatShading,
  ].join(':');
}

/** Each request owns its scene, even when it resolves after the consumer died. */
function disposeSource(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    images = new Set<{ close?: () => void }>();
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) {
          textures.add(value);
          if (value.image) images.add(value.image);
        }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  images.forEach((image) => image.close?.());
}

/** Bake the glTF node transforms once. Indexed topology, UV metre units,
 * normals, tangents and authored PBR values survive this batching operation. */
export function flattenStreetFurniture(
  scene: THREE.Object3D,
  kind: FurnitureKind,
): TemplatePart[] {
  const pieces = new Map<Role, THREE.BufferGeometry[]>(),
    materials = new Map<Role, THREE.MeshStandardMaterial>(),
    result: TemplatePart[] = [];
  try {
    scene.updateMatrixWorld(true);
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material;
      if (
        node instanceof THREE.SkinnedMesh ||
        !(material instanceof THREE.MeshStandardMaterial) ||
        !rolesFor(kind).includes(material.name as Role) ||
        material.transparent ||
        material.opacity !== 1 ||
        Object.values(material).some((value) => value instanceof THREE.Texture)
      )
        throw new Error(
          'Street furniture requires static opaque texture-free PBR roles',
        );
      const role = material.name as Role;
      if (
        materials.has(role) &&
        materialKey(materials.get(role)!) !== materialKey(material)
      )
        throw new Error('A furniture role has inconsistent authored materials');
      if (!materials.has(role)) materials.set(role, material.clone());
      const geometry = node.geometry.clone();
      if (!pieces.has(role)) pieces.set(role, []);
      pieces.get(role)!.push(geometry);
      geometry.applyMatrix4(node.matrixWorld);
      geometry.clearGroups();
    });
    for (const role of rolesFor(kind)) {
      const source = pieces.get(role);
      if (!source?.length)
        throw new Error(`Missing street furniture ${role} role`);
      const geometry = mergeGeometries(source);
      if (!geometry)
        throw new Error(`Could not batch street furniture ${role}`);
      result.push({ role, geometry, material: materials.get(role)! });
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    return result;
  } catch (error) {
    result.forEach((part) => part.geometry.dispose());
    materials.forEach((material) => material.dispose());
    throw error;
  } finally {
    pieces.forEach((geometries) =>
      geometries.forEach((geometry) => geometry.dispose()),
    );
    disposeSource(scene);
  }
}

type FadeUniforms = {
  furnitureNow: { value: number };
  furnitureRange: { value: number };
};

/** Opaque ordered dithering keeps normal depth writing and one pass per role.
 * Complementary LOD coverage blends the two authored silhouettes at 24–34 m. */
function installFade(
  material: THREE.MeshStandardMaterial,
  uniforms: FadeUniforms,
) {
  // Preserve the source hook and call it with the same material receiver.
  // oxlint-disable-next-line typescript/unbound-method
  const original = material.onBeforeCompile,
    cacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float furnitureAdmission;
attribute float furnitureLevel;
varying vec3 vFurnitureWorld;
varying float vFurnitureAdmission;
varying float vFurnitureLevel;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 furnitureWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  furnitureWorld = instanceMatrix * furnitureWorld;
#endif
vFurnitureWorld = (modelMatrix * furnitureWorld).xyz;
vFurnitureAdmission = furnitureAdmission;
vFurnitureLevel = furnitureLevel;
#include <project_vertex>`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float furnitureNow;
uniform float furnitureRange;
varying vec3 vFurnitureWorld;
varying float vFurnitureAdmission;
varying float vFurnitureLevel;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float furnitureDistance = distance(cameraPosition, vFurnitureWorld);
float furnitureCoverage = (1.0 - smoothstep(furnitureRange - 24.0, furnitureRange, furnitureDistance))
  * smoothstep(0.0, 0.3, furnitureNow - vFurnitureAdmission);
vec2 furniturePixel = mod(floor(gl_FragCoord.xy), 4.0);
float furnitureThreshold = (4.0 * mod(2.0 * furniturePixel.x + 3.0 * furniturePixel.y, 4.0)
  + mod(2.0 * floor(furniturePixel.x / 2.0) + 3.0 * floor(furniturePixel.y / 2.0), 4.0) + 0.5) / 16.0;
if (furnitureThreshold >= furnitureCoverage) discard;
float furnitureLodBlend = smoothstep(24.0, 34.0, furnitureDistance);
if (vFurnitureLevel < 0.5 ? furnitureThreshold < furnitureLodBlend : furnitureThreshold >= furnitureLodBlend) discard;`,
      );
  };
  material.customProgramCacheKey = () =>
    `${cacheKey()}:street-furniture-fade-v1`;
  material.needsUpdate = true;
}

/** One small, fixed pool replaces unbounded per-camera geometry pages. Source
 * requests and geometry preparation start near the street under the shared
 * allowance. Prepared actors can change bounded matrix slots during travel. */
export class StreetFurniture {
  readonly group = new THREE.Group();
  private readonly loader: StreetFurnitureLoader;
  private readonly requests: Request[];
  private readonly batches = new Map<Key, Batch[]>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly uniforms: FadeUniforms = {
    furnitureNow: { value: 0 },
    furnitureRange: { value: 120 },
  };
  private readonly transform = new THREE.Object3D();
  private readonly previous = new Map<string, Selection>();
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private pending: { scene: THREE.Object3D; request: Request } | null = null;
  private loading = false;
  private disposed = false;
  private state: 'idle' | 'loading' | 'ready' | 'error' | 'disposed' = 'idle';
  private quality = '';
  private motionPolicy = '';
  private selectionAt = -Infinity;
  private version = '';
  private updates = 0;
  private uploads = 0;
  private failures = 0;
  private assetBytes = 0;
  private lastError: string | null = null;
  private lodCounts = [0, 0];
  private draws = 0;
  private triangles = 0;
  private candidates = 0;

  constructor(
    private readonly e: Host,
    private readonly placements: readonly FurniturePlacement[],
    loader?: StreetFurnitureLoader,
  ) {
    this.loader =
      loader ?? (async (url) => (await new GLTFLoader().loadAsync(url)).scene);
    this.requests = manifest.assets.flatMap((asset) =>
      asset.lods.map((lod) => ({
        key: `${asset.id}:${lod.level}` as Key,
        kind: asset.id as FurnitureKind,
        lod,
        attempts: 0,
        retryAt: 0,
        complete: false,
      })),
    );
    this.group.name = 'Source-selected downtown street furniture';
    this.group.visible = false;
    e.landmarks.add(this.group);
  }

  get ready() {
    return this.state === 'ready' && !this.disposed;
  }

  private allowance(work: () => void) {
    return this.e.detailWorkBudget
      ? this.e.detailWorkBudget.run(work, { admission: true })
      : (work(), true);
  }

  private fail(request: Request, error: unknown, now: number) {
    this.failures++;
    this.lastError = String(error);
    request.retryAt = now + 2000;
    if (request.attempts >= 2) this.state = 'error';
  }

  private load(request: Request, now: number) {
    this.state = 'loading';
    this.loading = true;
    request.attempts++;
    const asset = manifest.assets.find((asset) => asset.id === request.kind)!;
    void Promise.resolve()
      .then(() => this.loader(streetFurnitureUrl(asset, request.lod)))
      .then((scene) => {
        this.loading = false;
        if (this.disposed || this.e.disposed) disposeSource(scene);
        else this.pending = { scene, request };
      })
      .catch((error) => {
        this.loading = false;
        if (!this.disposed && !this.e.disposed) this.fail(request, error, now);
      });
  }

  private prepare(scene: THREE.Object3D, request: Request) {
    const parts = flattenStreetFurniture(scene, request.kind),
      batches: Batch[] = [],
      group = new THREE.Group(),
      newMaterials = new Map<string, THREE.MeshStandardMaterial>(),
      ownedMaterials = new Set(parts.map((part) => part.material));
    try {
      for (const part of parts) {
        const key = materialKey(part.material);
        let material = this.materials.get(key) ?? newMaterials.get(key);
        if (material) {
          part.material.dispose();
          ownedMaterials.delete(part.material);
        } else {
          material = part.material;
          installFade(material, this.uniforms);
          newMaterials.set(key, material);
        }
        const admissions = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY),
            1,
          ),
          levels = new THREE.InstancedBufferAttribute(
            new Float32Array(CAPACITY).fill(request.lod.level),
            1,
          );
        admissions.setUsage(THREE.DynamicDrawUsage);
        part.geometry.setAttribute('furnitureAdmission', admissions);
        part.geometry.setAttribute('furnitureLevel', levels);
        const mesh = new THREE.InstancedMesh(part.geometry, material, CAPACITY);
        mesh.name = `Street furniture ${request.key} ${part.role}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.visible = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        // SSAOPass overrides the beauty material, so it cannot reproduce the
        // admission/range/LOD discard. Avoid AO ghosts from fully faded props.
        mesh.userData.excludeFromSSAO = true;
        const triangles =
          (part.geometry.index?.count ??
            part.geometry.getAttribute('position').count) / 3;
        batches.push({ mesh, admissions, triangles });
        group.add(mesh);
      }
      this.e.prepareNightReceivers?.(group);
      // Publish only after all role buffers and shader receivers are prepared.
      this.batches.set(request.key, batches);
      newMaterials.forEach((material, key) =>
        this.materials.set(key, material),
      );
      this.group.add(...group.children.slice());
      request.complete = true;
      this.assetBytes += request.lod.bytes;
      if (this.requests.every((request) => request.complete)) {
        this.state = 'ready';
        this.selectionAt = -Infinity;
      }
    } catch (error) {
      parts.forEach((part) => part.geometry.dispose());
      batches.forEach(({ mesh }) => mesh.dispose());
      ownedMaterials.forEach((material) => material.dispose());
      throw error;
    }
  }

  private select(now: number, range: number, capacity: number) {
    const camera = this.e.camera.position,
      candidates = this.placements
        .map((placement) => ({
          placement,
          distance: Math.hypot(
            placement.x - camera.x,
            placement.y - camera.y,
            placement.z - camera.z,
          ),
          previous: this.previous.get(placement.id),
        }))
        // All source pools are already prepared before select can run. Moving
        // to another street only updates bounded instance matrices; stopping
        // those updates would leave static physical furniture invisible ahead.
        // Motion admission still gates every request and preparation below.
        .filter(({ distance }) => distance < range)
        .sort(
          (a, b) =>
            a.distance -
              (a.previous ? 6 : 0) -
              (b.distance - (b.previous ? 6 : 0)) ||
            a.placement.id.localeCompare(b.placement.id),
        );
    this.candidates = candidates.length;
    const selected = candidates.slice(0, capacity),
      version = JSON.stringify(
        selected.map(({ placement }) => placement.id).sort(),
      );
    const active = new Map<string, Selection>();
    for (const { placement, previous } of selected)
      active.set(placement.id, previous ?? { placement, admitted: now / 1000 });
    this.previous.clear();
    active.forEach((selection, id) => this.previous.set(id, selection));
    if (version === this.version) return;
    this.version = version;
    const rows = new Map<Key, Selection[]>();
    for (const { placement } of selected) {
      for (const lod of [0, 1] as const) {
        // Both small source LODs remain resident for each selected actor. The
        // fragment shader alone chooses coverage, so fast travel cannot outrun
        // a CPU selection interval and reveal a missing LOD or abrupt silhouette.
        const key: Key = `${placement.kind}:${lod}`;
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key)!.push(active.get(placement.id)!);
      }
    }
    this.lodCounts = [0, 0];
    this.draws = 0;
    this.triangles = 0;
    for (const [key, batches] of this.batches) {
      const selections = rows.get(key) ?? [];
      this.lodCounts[Number(key.slice(-1))] += selections.length;
      for (const { mesh, admissions, triangles } of batches) {
        mesh.count = selections.length;
        mesh.visible = selections.length > 0;
        if (!selections.length) continue;
        selections.forEach(({ placement: p, admitted }, index) => {
          this.transform.position.set(p.x, p.y, p.z);
          this.transform.rotation.set(0, p.yaw, 0);
          this.transform.updateMatrix();
          mesh.setMatrixAt(index, this.transform.matrix);
          admissions.setX(index, admitted);
        });
        mesh.instanceMatrix.needsUpdate = true;
        admissions.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.draws++;
        this.triangles += triangles * selections.length;
      }
    }
    this.uploads++;
  }

  update(force = false) {
    if (this.disposed || this.e.disposed) return;
    this.updates++;
    const motion = this.e.sceneryMotion,
      now = motion?.nowMs ?? performance.now(),
      quality = this.e.compatibleGraphics
        ? 'compatible'
        : this.e.settings.quality,
      range = quality === 'ultra' ? 150 : quality === 'high' ? 140 : 120,
      capacity =
        quality === 'ultra'
          ? 64
          : quality === 'high'
            ? 40
            : quality === 'compatible'
              ? 16
              : 24,
      policy = `${this.e.settings.buildings}:${quality}:${motion?.allowNewDetails ?? true}`;
    this.uniforms.furnitureNow.value = now / 1000;
    this.uniforms.furnitureRange.value = range;
    this.group.visible = this.e.settings.buildings && this.ready;
    if (!this.e.settings.buildings) return;
    const near = this.placements.some(
      (p) =>
        Math.hypot(
          p.x - this.e.camera.position.x,
          p.y - this.e.camera.position.y,
          p.z - this.e.camera.position.z,
        ) < range,
    );
    if (!this.ready) {
      if (this.state === 'error' || !near || !(motion?.allowNewDetails ?? true))
        return;
      if (this.pending) {
        this.allowance(() => {
          const { scene, request } = this.pending!;
          this.pending = null;
          try {
            this.prepare(scene, request);
          } catch (error) {
            this.fail(request, error, now);
          }
        });
      } else if (!this.loading) {
        const request = this.requests.find(
          (request) =>
            !request.complete && request.attempts < 2 && now >= request.retryAt,
        );
        if (request) this.allowance(() => this.load(request, now));
      }
      if (!this.ready) return;
      this.group.visible = true;
    }
    if (
      force ||
      policy !== this.motionPolicy ||
      quality !== this.quality ||
      (now - this.selectionAt >=
        Math.max(250, motion?.selectionIntervalMs ?? 250) &&
        this.last.distanceToSquared(this.e.camera.position) >= 4)
    ) {
      this.quality = quality;
      this.motionPolicy = policy;
      this.selectionAt = now;
      this.last.copy(this.e.camera.position);
      this.select(now, range, capacity);
    }
  }

  stats() {
    return {
      status: this.state,
      ready: this.ready,
      placements: this.placements.length,
      candidates: this.candidates,
      visible: this.group.visible ? this.previous.size : 0,
      visibleIds: this.group.visible ? [...this.previous.keys()] : [],
      // These are submissions, including the LOD discarded by opaque dithering;
      // an actual visible-triangle count would require a separate GPU query.
      submittedByLod: this.group.visible ? [...this.lodCounts] : [0, 0],
      drawCalls: this.group.visible ? this.draws : 0,
      triangles: this.group.visible ? this.triangles : 0,
      submittedTriangles: this.group.visible ? this.triangles : 0,
      batches: this.group.children.length,
      geometries: this.group.children.length,
      materials: this.materials.size,
      textures: 0,
      assetBytes: this.assetBytes,
      capacity: CAPACITY,
      pendingLoads: Number(this.loading),
      pendingPreparation: Number(!!this.pending),
      loadedAssets: this.requests.filter((request) => request.complete).length,
      attempts: this.requests.reduce(
        (sum, request) => sum + request.attempts,
        0,
      ),
      failures: this.failures,
      lastError: this.lastError,
      updates: this.updates,
      uploads: this.uploads,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.state = 'disposed';
    this.group.visible = false;
    this.group.removeFromParent();
    if (this.pending) disposeSource(this.pending.scene);
    this.pending = null;
    for (const batches of this.batches.values())
      for (const { mesh } of batches) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
    this.materials.forEach((material) => material.dispose());
    this.batches.clear();
    this.materials.clear();
    this.previous.clear();
    this.group.clear();
  }
}

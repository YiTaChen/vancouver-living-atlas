import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Based on Vancouver Living Atlas by YiTaChen.
 * Source: https://github.com/YiTaChen/vancouver-living-atlas
 * License: Vancouver Living Atlas Noncommercial Research and Attribution 1.0.
 * Consumer of tools/assets/city-life-pedestrians; editable Blender sources are
 * untouched. Background rigid-limb-v1 only: no skeleton, seating, or night light.
 */
export const PEDESTRIAN_VARIANTS = [
  'commuter',
  'raincoat',
  'runner',
  'tote',
] as const;
export type PedestrianVariant = (typeof PEDESTRIAN_VARIANTS)[number];
export type PedestrianLoader = (url: string) => Promise<THREE.Object3D>;
type Point3 = readonly [number, number, number];
type Key = `${PedestrianVariant}:${0 | 1}`;
export interface PedestrianRenderPose {
  actorId: string;
  position: Point3;
  yawRadians: number;
  /** Uniform root scale only. Ground/surface/collision validation is caller-owned. */
  scale?: number;
  variant?: PedestrianVariant;
  /** Caller can select the LOD explicitly, or use the 40/30 m hysteresis. */
  lod?: 0 | 1;
  distanceM?: number;
  visible?: boolean;
  phaseRadians: number;
  walkWeight?: number;
  lookYawRadians?: number;
  yieldWeight?: number;
  /** Multiplicative clothing/accessory tint; skin/hair retain authored colors. */
  tint?: Point3;
}

// Exact shared function from tools/assets/city-life-pedestrians/rigid-limb.glsl.
// Scalar pivots are already glTF Y-up metres; do not convert axes a second time.
export const PEDESTRIAN_RIGID_LIMB_GLSL = `
void pedestrianRigidLimb(
  inout vec3 position, inout vec3 normal, float limb, vec3 pivot,
  float phase, float walkWeight, float lookYaw, float yieldWeight
) {
  float walk = clamp(walkWeight, 0.0, 1.0);
  float yielding = clamp(yieldWeight, 0.0, 1.0);
  float angle = 0.0;
  if (limb > 1.5 && limb < 2.5) angle = -0.30 * sin(phase) * walk + 0.12 * yielding;
  if (limb > 2.5 && limb < 3.5) angle =  0.30 * sin(phase) * walk + 0.12 * yielding;
  if (limb > 3.5 && limb < 4.5) angle =  0.38 * sin(phase) * walk;
  if (limb > 4.5 && limb < 5.5) angle = -0.38 * sin(phase) * walk;
  bool head = limb > 0.5 && limb < 1.5;
  if (head) angle = clamp(lookYaw, -0.75, 0.75);
  float c = cos(angle), s = sin(angle);
  vec3 q = position - pivot;
  if (head) {
    q = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z);
    normal = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
  } else {
    q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
    normal = vec3(normal.x, c * normal.y - s * normal.z, s * normal.y + c * normal.z);
  }
  position = pivot + q;
  position.y += walk * (0.035 + 0.008 * (1.0 - cos(2.0 * phase)));
}
`;
const declarations = `
attribute float _limb;
attribute float _pivot_x;
attribute float _pivot_y;
attribute float _pivot_z;
attribute vec4 pedestrianPose;
${PEDESTRIAN_RIGID_LIMB_GLSL}
`;
const parameters = `_limb, vec3(_pivot_x, _pivot_y, _pivot_z),
  pedestrianPose.x, pedestrianPose.y, pedestrianPose.z, pedestrianPose.w`;
type AttributeDefaults = { defaultAttributeValues?: Record<string, number[]> };

/** Install on SSAOPass.normalMaterial (normal target also supplies AO depth),
 * or a separate depth override. Missing attributes have explicit neutral values:
 * unrelated city geometry keeps its original position/normal. Caller restores
 * before releasing the pass; material ownership remains with the caller.
 */
export function installPedestrianOverrideMaterial(material: THREE.Material) {
  const target = material as THREE.Material & AttributeDefaults;
  // Preserve hook identity for restoration; all invocations supply material.
  // oxlint-disable-next-line typescript/unbound-method
  const before = material.onBeforeCompile;
  // oxlint-disable-next-line typescript/unbound-method
  const cacheKey = material.customProgramCacheKey;
  const defaults = target.defaultAttributeValues;
  const installedDefaults = {
    ...defaults,
    _limb: [0],
    _pivot_x: [0],
    _pivot_y: [0],
    _pivot_z: [0],
    pedestrianPose: [0, 0, 0, 0],
  };
  target.defaultAttributeValues = installedDefaults;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.vertexShader = declarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
       if (any(notEqual(pedestrianPose.yzw, vec3(0.0)))) {
       vec3 pedestrianNormalDummy = vec3(0.0);
       pedestrianRigidLimb(pedestrianNormalDummy, objectNormal, ${parameters});
       }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       if (any(notEqual(pedestrianPose.yzw, vec3(0.0)))) {
       vec3 pedestrianPositionDummy = vec3(0.0);
       pedestrianRigidLimb(transformed, pedestrianPositionDummy, ${parameters});
       }`,
    );
  };
  // Used only for identity comparison, not an unbound invocation.
  // oxlint-disable-next-line typescript/unbound-method
  const installed = material.onBeforeCompile;
  const installedKey = () =>
    cacheKey.call(material) + '/city-life-rigid-limb-v1';
  material.customProgramCacheKey = installedKey;
  material.needsUpdate = true;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    if (material.onBeforeCompile === installed)
      material.onBeforeCompile = before;
    if (material.customProgramCacheKey === installedKey)
      material.customProgramCacheKey = cacheKey;
    if (target.defaultAttributeValues === installedDefaults)
      target.defaultAttributeValues = defaults;
    material.needsUpdate = true;
  };
}

function clothingMaterial() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  installPedestrianOverrideMaterial(material);
  // The original material is supplied explicitly below.
  // oxlint-disable-next-line typescript/unbound-method
  const deform = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    deform.call(material, shader, renderer);
    shader.vertexShader =
      'attribute float _palette; attribute vec3 pedestrianTint; varying vec3 vPedestrianTint;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float clothing = max(step(1.5, _palette) * (1.0 - step(3.5, _palette)),
                            step(5.5, _palette) * (1.0 - step(6.5, _palette)));
       vPedestrianTint = mix(vec3(1.0), pedestrianTint, clothing);`,
    );
    shader.fragmentShader =
      'varying vec3 vPedestrianTint;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.rgb *= vPedestrianTint;',
    );
  };
  material.name = 'City life / shared original vertex colors';
  return material;
}

function releaseScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(m);
      for (const value of Object.values(m))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  const images = new Set<{ close(): void }>();
  textures.forEach((t) => {
    const image: unknown = t.image;
    if (
      image &&
      typeof image === 'object' &&
      'close' in image &&
      typeof image.close === 'function'
    )
      images.add(image as { close(): void });
    t.dispose();
  });
  images.forEach((i) => i.close());
}

/** Conservative per-exported-vertex envelope, including rigid rotation and lift.
 * Used for real instanced frustum bounds, never the undeformed T-pose bounds.
 */
function animatedBounds(geometry: THREE.BufferGeometry) {
  const box = new THREE.Box3();
  const position = geometry.getAttribute('position');
  const limb = geometry.getAttribute('_limb');
  const px = geometry.getAttribute('_pivot_x'),
    py = geometry.getAttribute('_pivot_y'),
    pz = geometry.getAttribute('_pivot_z');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i),
      l = limb.getX(i);
    const head = l === 1;
    const angle = head
      ? 0.75
      : l >= 2 && l <= 3
        ? 0.42
        : l >= 4 && l <= 5
          ? 0.38
          : 0;
    const radius = head
      ? Math.hypot(x - px.getX(i), z - pz.getX(i))
      : Math.hypot(y - py.getX(i), z - pz.getX(i));
    const displacement = 2 * Math.sin(angle / 2) * radius + 0.002;
    box.expandByPoint(
      new THREE.Vector3(
        x - (head ? displacement : 0.002),
        y - (head ? 0.002 : displacement),
        z - displacement,
      ),
    );
    box.expandByPoint(
      new THREE.Vector3(
        x + (head ? displacement : 0.002),
        y + (head ? 0.002 : displacement) + 0.051,
        z + displacement,
      ),
    );
  }
  geometry.boundingBox = box;
  geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
}

function takeGeometry(
  scene: THREE.Object3D,
  variant: PedestrianVariant,
  lod: 0 | 1,
) {
  let owned: THREE.BufferGeometry | undefined;
  try {
    scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    if (meshes.length !== 1 || meshes[0] instanceof THREE.SkinnedMesh)
      throw new Error('Expected one original rigid-limb mesh');
    const mesh = meshes[0];
    if (
      mesh.matrixWorld.elements.some(
        (v, i) =>
          !Number.isFinite(v) || Math.abs(v - (i % 5 === 0 ? 1 : 0)) > 1e-6,
      )
    )
      throw new Error(
        'Rigid-limb pivots require identity glTF node transforms',
      );
    if (
      mesh.userData.assetId !== `pedestrian-${variant}` ||
      mesh.userData.animationContract !== 'rigid-limb-v1'
    )
      throw new Error('Pedestrian asset provenance/contract mismatch');
    const g = mesh.geometry,
      n = g.getAttribute('position')?.count;
    for (const [name, size] of [
      ['position', 3],
      ['normal', 3],
      ['color', 3],
      ['_limb', 1],
      ['_pivot_x', 1],
      ['_pivot_y', 1],
      ['_pivot_z', 1],
      ['_palette', 1],
    ] as const) {
      const a = g.getAttribute(name);
      if (!n || !a || a.count !== n || a.itemSize !== size)
        throw new Error(`Missing pedestrian attribute ${name}`);
      for (let i = 0; i < a.count; i++)
        for (let k = 0; k < a.itemSize; k++)
          if (!Number.isFinite(a.getComponent(i, k)))
            throw new Error('Nonfinite pedestrian attribute');
    }
    const triangles = (g.index?.count ?? n ?? 0) / 3;
    if (
      triangles > (lod === 0 ? 1000 : 250) ||
      triangles <= 0 ||
      g.groups.length > 1
    )
      throw new Error('Background geometry budget exceeded');
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    if (materials.length !== 1 || materials[0].transparent)
      throw new Error('Background pedestrians must be merged opaque');
    owned = g.clone();
    owned.userData = {
      ...g.userData,
      ...mesh.userData,
      sourcePackage: 'city-life-pedestrians',
    };
    animatedBounds(owned);
    return owned;
  } catch (error) {
    owned?.dispose();
    throw error;
  } finally {
    releaseScene(scene);
  }
}

function fallbackGeometry(variant: PedestrianVariant) {
  const height = { commuter: 1.78, raincoat: 1.67, runner: 1.86, tote: 1.6 }[
    variant
  ];
  const pieces: THREE.BufferGeometry[] = [];
  // Root, head, arms, legs; fallback remains cheap, opaque and visibly approximate.
  const parts = [
    [0, 0, 0.65, 0, 0.3, 0.35, 0.18, 0, 0, 0, 2],
    [1, 0, 0.91, 0, 0.2, 0.18, 0.18, 0, 0.82, 0, 1],
    [2, 0.21, 0.63, 0, 0.11, 0.31, 0.11, 0.21, 0.78, 0, 2],
    [3, -0.21, 0.63, 0, 0.11, 0.31, 0.11, -0.21, 0.78, 0, 2],
    [4, 0.09, 0.24, 0, 0.12, 0.48, 0.13, 0.09, 0.48, 0, 3],
    [5, -0.09, 0.24, 0, 0.12, 0.48, 0.13, -0.09, 0.48, 0, 3],
  ];
  for (const [limb, x, y, z, w, h, d, px, py, pz, palette] of parts) {
    const indexed = new THREE.BoxGeometry(w, h * height, d);
    const g = indexed.toNonIndexed();
    indexed.dispose();
    g.translate(x, y * height, z);
    g.deleteAttribute('uv');
    g.clearGroups();
    const n = g.getAttribute('position').count;
    for (const [key, value] of [
      ['_limb', limb],
      ['_pivot_x', px],
      ['_pivot_y', py * height],
      ['_pivot_z', pz],
      ['_palette', palette],
    ] as const)
      g.setAttribute(
        key,
        new THREE.Float32BufferAttribute(new Float32Array(n).fill(value), 1),
      );
    const color =
      palette === 1
        ? [0.65, 0.42, 0.28]
        : palette === 2
          ? [0.12, 0.24, 0.32]
          : [0.09, 0.12, 0.15];
    g.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        Array.from({ length: n }, () => color).flat(),
        3,
      ),
    );
    pieces.push(g);
  }
  const geometry = mergeGeometries(pieces)!;
  pieces.forEach((p) => p.dispose());
  geometry.userData = { sourcePackage: 'runtime-fallback', approximate: true };
  animatedBounds(geometry);
  return geometry;
}

type Batch = {
  mesh: THREE.InstancedMesh;
  pose: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  actorIds: string[];
  loaded: boolean;
};
const clamp = (v: number | undefined, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v! : 0));
function identityVariant(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++)
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return PEDESTRIAN_VARIANTS[(hash >>> 0) % PEDESTRIAN_VARIANTS.length];
}

/** Eight bounded batches, independent of controllers/navigation/camera modes.
 * The caller selects safe, same-surface actors and supplies stable ID/phase/pose.
 * No actor carries a geometry, material, texture, mixer, or renderer-owned AI.
 */
export class PedestrianRenderer {
  readonly group = new THREE.Group();
  readonly capacity: number;
  private readonly batches = new Map<Key, Batch>();
  private readonly material = clothingMaterial();
  private readonly depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  private readonly loader: PedestrianLoader;
  private readonly errors = new Map<Key, string>();
  private active = new Map<
    string,
    { variant: PedestrianVariant; lod: 0 | 1 }
  >();
  private pending: Promise<void> | null = null;
  private loading = false;
  private disposed = false;
  private rejected = 0;
  private readonly transform = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();
  private readonly box = new THREE.Box3();
  private readonly instanceBox = new THREE.Box3();

  constructor(options: { capacity?: number; loader?: PedestrianLoader } = {}) {
    this.capacity = options.capacity ?? 32;
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 32
    )
      throw new Error('Pedestrian capacity must be 1..32');
    this.loader =
      options.loader ??
      (async (url) => (await new GLTFLoader().loadAsync(url)).scene);
    installPedestrianOverrideMaterial(this.depth);
    this.group.name = 'City life / background pedestrians';
    this.group.userData.provenance = {
      attribution: 'Based on Vancouver Living Atlas by YiTaChen',
      sourceUrl: 'https://github.com/YiTaChen/vancouver-living-atlas',
      sourcePackage: 'tools/assets/city-life-pedestrians',
      license:
        'Vancouver Living Atlas Noncommercial Research and Attribution 1.0',
      animationContract: 'rigid-limb-v1',
    };
    for (const variant of PEDESTRIAN_VARIANTS)
      for (const lod of [0, 1] as const) {
        const geometry = fallbackGeometry(variant);
        const pose = new THREE.InstancedBufferAttribute(
          new Float32Array(this.capacity * 4),
          4,
        ).setUsage(THREE.DynamicDrawUsage);
        const tint = new THREE.InstancedBufferAttribute(
          new Float32Array(this.capacity * 3).fill(1),
          3,
        ).setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('pedestrianPose', pose);
        geometry.setAttribute('pedestrianTint', tint);
        const mesh = new THREE.InstancedMesh(
          geometry,
          this.material,
          this.capacity,
        );
        mesh.count = 0;
        mesh.visible = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.customDepthMaterial = this.depth;
        mesh.name = `City life / ${variant} / LOD${lod}`;
        this.batches.set(`${variant}:${lod}`, {
          mesh,
          pose,
          tint,
          actorIds: [],
          loaded: false,
        });
        this.group.add(mesh);
      }
  }

  /** Single bounded loading attempt; failed templates keep their fallback.
   * Late completions after disposal release GLTF resources without attaching.
   */
  load(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    this.loading = true;
    this.pending = Promise.all(
      [...this.batches].map(async ([key, batch]) => {
        const [variant, level] = key.split(':') as [PedestrianVariant, string];
        try {
          const scene = await this.loader(
            `/models/city-life-pedestrians/pedestrian-${variant}.lod${level}.glb`,
          );
          if (this.disposed) {
            releaseScene(scene);
            return;
          }
          const geometry = takeGeometry(scene, variant, Number(level) as 0 | 1);
          geometry.setAttribute('pedestrianPose', batch.pose);
          geometry.setAttribute('pedestrianTint', batch.tint);
          batch.mesh.geometry.dispose();
          batch.mesh.geometry = geometry;
          batch.loaded = true;
          batch.pose.needsUpdate = batch.tint.needsUpdate = true;
          this.updateBounds(batch);
        } catch (error) {
          if (!this.disposed) this.errors.set(key, String(error));
        }
      }),
    ).then(() => {
      this.loading = false;
    });
    return this.pending;
  }

  update(poses: readonly PedestrianRenderPose[]) {
    if (this.disposed) return;
    const next = new Map<string, { variant: PedestrianVariant; lod: 0 | 1 }>();
    this.rejected = 0;
    for (const batch of this.batches.values()) {
      batch.mesh.count = 0;
      batch.actorIds.length = 0;
    }
    for (const p of poses) {
      const scale = p.scale ?? 1;
      if (
        !p.actorId ||
        next.has(p.actorId) ||
        next.size >= this.capacity ||
        p.position.length !== 3 ||
        !p.position.every(Number.isFinite) ||
        !Number.isFinite(p.yawRadians) ||
        !Number.isFinite(p.phaseRadians) ||
        !Number.isFinite(scale) ||
        scale <= 0 ||
        scale > 2 ||
        (p.variant !== undefined && !PEDESTRIAN_VARIANTS.includes(p.variant)) ||
        (p.lod !== undefined && p.lod !== 0 && p.lod !== 1) ||
        (p.distanceM !== undefined &&
          (!Number.isFinite(p.distanceM) || p.distanceM < 0)) ||
        (p.tint !== undefined &&
          (p.tint.length !== 3 || !p.tint.every(Number.isFinite)))
      ) {
        this.rejected++;
        continue;
      }
      const previous = this.active.get(p.actorId);
      const variant =
        p.variant ?? previous?.variant ?? identityVariant(p.actorId);
      const lod =
        p.lod ??
        (p.distanceM === undefined
          ? (previous?.lod ?? 0)
          : p.distanceM >= (previous?.lod === 1 ? 30 : 40)
            ? 1
            : 0);
      next.set(p.actorId, { variant, lod });
      if (p.visible === false) continue;
      const batch = this.batches.get(`${variant}:${lod}`)!;
      const slot = batch.mesh.count++;
      this.transform.position.fromArray(p.position);
      this.transform.rotation.set(0, p.yawRadians, 0);
      this.transform.scale.setScalar(scale);
      this.transform.updateMatrix();
      batch.mesh.setMatrixAt(slot, this.transform.matrix);
      batch.pose.setXYZW(
        slot,
        p.phaseRadians % (Math.PI * 2),
        clamp(p.walkWeight, 0, 1),
        clamp(p.lookYawRadians, -0.75, 0.75),
        clamp(p.yieldWeight, 0, 1),
      );
      batch.tint.setXYZ(
        slot,
        ...((p.tint ?? [1, 1, 1]).map((v) => clamp(v, 0, 2)) as [
          number,
          number,
          number,
        ]),
      );
      batch.actorIds.push(p.actorId);
    }
    this.active = next;
    for (const batch of this.batches.values()) {
      batch.mesh.visible = batch.mesh.count > 0;
      if (batch.mesh.count) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.pose.needsUpdate = batch.tint.needsUpdate = true;
        this.updateBounds(batch);
      }
    }
    if (next.size && !this.pending) void this.load();
  }

  private updateBounds(batch: Batch) {
    this.box.makeEmpty();
    const local = batch.mesh.geometry.boundingBox!;
    for (let slot = 0; slot < batch.mesh.count; slot++) {
      batch.mesh.getMatrixAt(slot, this.matrix);
      this.box.union(this.instanceBox.copy(local).applyMatrix4(this.matrix));
    }
    batch.mesh.boundingBox = (batch.mesh.boundingBox ?? new THREE.Box3()).copy(
      this.box,
    );
    batch.mesh.boundingSphere = this.box.getBoundingSphere(
      batch.mesh.boundingSphere ?? new THREE.Sphere(),
    );
  }

  /** Slot is diagnostic only. Callers keep state by actorId across compaction. */
  actorSlot(actorId: string) {
    for (const [key, batch] of this.batches) {
      const slot = batch.actorIds.indexOf(actorId);
      if (slot >= 0) return { key, slot };
    }
    return null;
  }

  stats() {
    let visibleActors = 0,
      populatedBatches = 0,
      loadedTemplates = 0,
      triangles = 0,
      geometryBytes = 0;
    const buffers = new Set<ArrayBufferLike>();
    for (const batch of this.batches.values()) {
      visibleActors += batch.mesh.count;
      populatedBatches += Number(batch.mesh.count > 0);
      loadedTemplates += Number(batch.loaded);
      triangles +=
        (batch.mesh.count *
          (batch.mesh.geometry.index?.count ??
            batch.mesh.geometry.getAttribute('position').count)) /
        3;
      for (const a of [
        ...Object.values(batch.mesh.geometry.attributes),
        batch.mesh.geometry.index,
        batch.mesh.instanceMatrix,
      ]) {
        if (!a) continue;
        const array =
          a instanceof THREE.InterleavedBufferAttribute
            ? a.data.array
            : a.array;
        if (!buffers.has(array.buffer)) {
          buffers.add(array.buffer);
          geometryBytes += array.buffer.byteLength;
        }
      }
    }
    return {
      activeActors: this.active.size,
      visibleActors,
      capacity: this.capacity,
      rejectedInputs: this.rejected,
      allocatedBatches: this.batches.size,
      populatedBatches,
      /** Estimates describe owned buffers/active geometry, not measured GPU draws/VRAM. */
      triangles,
      geometryBytes,
      textures: 0,
      loadedTemplates,
      failedTemplates: this.errors.size,
      loading: this.loading,
      loadErrors: [...this.errors].map(([key, error]) => ({ key, error })),
      disposed: this.disposed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    for (const batch of this.batches.values()) {
      batch.mesh.dispose();
      batch.mesh.geometry.dispose();
    }
    this.batches.clear();
    this.active.clear();
    this.errors.clear();
    this.group.clear();
    this.material.dispose();
    this.depth.dispose();
  }
}

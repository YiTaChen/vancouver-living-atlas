import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ForestTree } from '../detailed-trees';
import { hash } from '../geo';

export const MATURE_TREE_SPECIES = ['maple', 'alder'] as const;
const ROOT = '/models/blender/mature-trees/';
type Tree = ForestTree & { y: number };
type Host = {
  vegetation: THREE.Group;
  disposed?: boolean;
  renderer: THREE.WebGLRenderer;
};
type Parts = {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  core: THREE.BufferGeometry | null;
};

/** Geometry-only parser: the four shared maps are loaded once by the owner,
 * rather than once per GLTF parser. Retains material names, alpha and extras. */
export function withoutTreeTextureReferences(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  if (
    view.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error('Invalid tree GLB');
  const jsonBytes = view.getUint32(12, true);
  if (
    view.getUint32(16, true) !== 0x4e4f534a ||
    20 + jsonBytes + 8 > buffer.byteLength
  )
    throw new Error('Missing GLB chunks');
  const data = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonBytes)),
  );
  delete data.images;
  delete data.textures;
  delete data.samplers;
  for (const material of data.materials ?? []) {
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture'])
      delete material[key];
    delete material.pbrMetallicRoughness?.baseColorTexture;
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture;
  }
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const binaryChunk = new Uint8Array(buffer, 20 + jsonBytes);
  const output = new ArrayBuffer(20 + padded + binaryChunk.length);
  const out = new DataView(output);
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, output.byteLength, true);
  out.setUint32(12, padded, true);
  out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(output, 20, padded).fill(32);
  new Uint8Array(output, 20, encoded.length).set(encoded);
  new Uint8Array(output, 20 + padded).set(binaryChunk);
  return output;
}

/** Normalize geometry exactly once; authored bark UV is for a 10m tree.
 * Runtime uses source h as its matrix scale, and h/10 for bark tile density. */
export function extractMatureTree(group: THREE.Group): Parts {
  const bark: THREE.BufferGeometry[] = [],
    leaves: THREE.BufferGeometry[] = [],
    core: THREE.BufferGeometry[] = [];
  const merged: THREE.BufferGeometry[] = [];
  let success = false;
  group.updateMatrixWorld(true);
  try {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (Array.isArray(object.material))
        throw new Error('Unexpected tree material array');
      const material = object.material as THREE.MeshStandardMaterial;
      const role = material.userData.semantic_role;
      const target =
        role === 'bark' ? bark : material.alphaTest >= 0.4 ? leaves : core;
      if (
        !['trunk', 'branches', 'foliage-core', 'foliage-cards'].includes(
          object.name,
        )
      )
        throw new Error('Unexpected tree node');
      const geometry = object.geometry
        .clone()
        .applyMatrix4(object.matrixWorld)
        .scale(0.1, 0.1, 0.1);
      target.push(geometry);
      geometry.userData.sourceColor = material.color.toArray();
      for (const name of Object.keys(geometry.attributes))
        if (!['position', 'normal', 'uv'].includes(name))
          geometry.deleteAttribute(name);
      for (const attribute of Object.values(
        geometry.attributes,
      ) as THREE.BufferAttribute[])
        if (!Array.from(attribute.array).every(Number.isFinite))
          throw new Error('Non-finite tree geometry');
      geometry.clearGroups();
    });
    if (!bark.length || !leaves.length) throw new Error('Missing tree roles');
    const merge = (parts: THREE.BufferGeometry[]) => {
      const geometry = mergeGeometries(parts, false);
      if (!geometry) throw new Error('Incompatible tree attributes');
      merged.push(geometry);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    };
    const result = {
      bark: merge(bark),
      leaves: merge(leaves),
      core: core.length ? merge(core) : null,
    };
    if (result.core)
      result.core.userData.sourceColor = core[0].userData.sourceColor;
    const bounds = result.bark
      .boundingBox!.clone()
      .union(result.leaves.boundingBox!);
    if (result.core) bounds.union(result.core.boundingBox!);
    if (
      Math.abs(bounds.min.y) > 0.002 ||
      Math.abs(bounds.max.y - 1) > 0.002 ||
      Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) > 0.5
    ) {
      throw new Error('Tree datum/envelope mismatch');
    }
    success = true;
    return result;
  } finally {
    if (!success) merged.forEach((g) => g.dispose());
    [...bark, ...leaves, ...core].forEach((g) => g.dispose());
    const materials = new Set<THREE.Material>(),
      geometries = new Set<THREE.BufferGeometry>();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          materials.add(m),
        );
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  }
}

export function installSourceHeightBarkUV(
  shader: Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0],
) {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <uv_vertex>',
    `#include <uv_vertex>
  #ifdef USE_INSTANCING
    float treeScale = length(instanceMatrix[1].xyz) / 10.0;
    #ifdef USE_MAP
      vMapUv *= treeScale;
    #endif
    #ifdef USE_NORMALMAP
      vNormalMapUv *= treeScale;
    #endif
    #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv *= treeScale;
    #endif
    #ifdef USE_METALNESSMAP
      vMetalnessMapUv *= treeScale;
    #endif
  #endif`,
  );
}

/** Bounded close-up replacement. Original medium/far trees and all source data
 * remain available. An incomplete/late load never hides a source tree. */
export class MatureTrees {
  readonly group = new THREE.Group();
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'disposed' = 'idle';
  count = 0;
  private pending: Promise<boolean> | null = null;
  private textures = new Set<THREE.Texture>();
  private materials = new Set<THREE.Material>();
  private pools: THREE.InstancedMesh[][] = [];
  private abort = new AbortController();
  constructor(private host: Host) {
    this.group.name = 'Blender mature trees: source-preserving near pool';
    host.vegetation.add(this.group);
  }
  load(): Promise<boolean> {
    if (this.status === 'disposed' || this.host.disposed)
      return Promise.resolve(false);
    if (this.pending) return this.pending;
    this.status = 'loading';
    this.pending = this.loadAssets();
    return this.pending;
  }
  private async loadAssets() {
    const parts: Parts[] = [];
    const texture = async (file: string, color: boolean) => {
      const map = await new THREE.TextureLoader().loadAsync(
        ROOT + 'textures/' + file,
      );
      if (this.status === 'disposed' || this.host.disposed) {
        map.dispose();
        throw new Error('Disposed tree load');
      }
      map.flipY = false;
      map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      map.anisotropy = Math.min(
        4,
        this.host.renderer.capabilities.getMaxAnisotropy(),
      );
      this.textures.add(map);
      return map;
    };
    try {
      const jobs = [
        ...MATURE_TREE_SPECIES.map(async (species) => {
          const response = await fetch(`${ROOT}mature-${species}.lod0.glb`, {
            signal: this.abort.signal,
          });
          if (!response.ok) throw new Error('Tree GLB unavailable');
          const gltf = await new GLTFLoader().parseAsync(
            withoutTreeTextureReferences(await response.arrayBuffer()),
            '',
          );
          const result = extractMatureTree(gltf.scene);
          parts.push(result);
          return result;
        }),
        texture('bark_basecolor.png', true),
        texture('bark_normal.png', false),
        texture('bark_orm.png', false),
        texture('leaf_atlas_rgba.png', true),
      ];
      // Wait for every task before freeing resources on partial failure.
      const results = await Promise.allSettled(jobs);
      if (
        results.some((r) => r.status === 'rejected') ||
        this.status === 'disposed' ||
        this.host.disposed
      )
        throw new Error('Tree assets incomplete');
      const values = results.map(
        (r) => (r as PromiseFulfilledResult<Parts | THREE.Texture>).value,
      );
      const [barkMap, normal, orm, leafMap] = values.slice(
        MATURE_TREE_SPECIES.length,
      ) as THREE.Texture[];
      if (parts.some((p) => p.core))
        throw new Error('Near broadleaf requires masked interior foliage');
      [barkMap, normal, orm].forEach((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
      });
      const bark = new THREE.MeshStandardMaterial({
        map: barkMap,
        normalMap: normal,
        roughnessMap: orm,
        metalnessMap: orm,
        roughness: 1,
        metalness: 0,
      });
      bark.onBeforeCompile = installSourceHeightBarkUV;
      bark.customProgramCacheKey = () => 'mature-tree-source-height-bark-v1';
      const leaf = new THREE.MeshStandardMaterial({
        map: leafMap,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.88,
      });
      const depth = new THREE.MeshDepthMaterial({
        map: leafMap,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        depthPacking: THREE.RGBADepthPacking,
      });
      [bark, leaf, depth].forEach((m) => this.materials.add(m));
      this.pools = (values.slice(0, MATURE_TREE_SPECIES.length) as Parts[]).map(
        (p) => {
          const pool = [
            new THREE.InstancedMesh(p.bark, bark, 48),
            new THREE.InstancedMesh(p.leaves, leaf, 48),
          ];
          pool.forEach((mesh, index) => {
            mesh.count = 0;
            mesh.castShadow = mesh.receiveShadow = true;
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            if (index === 1) {
              mesh.customDepthMaterial = depth;
              mesh.userData.alphaFoliage = true;
            }
            this.group.add(mesh);
          });
          return pool;
        },
      );
      this.status = 'ready';
      return true;
    } catch {
      parts.forEach((p) => Object.values(p).forEach((g) => g?.dispose()));
      this.textures.forEach((t) => t.dispose());
      this.textures.clear();
      if (this.status !== 'disposed') this.status = 'failed';
      return false;
    }
  }
  reset() {
    this.count = 0;
    this.pools.forEach((pool) =>
      pool.forEach((mesh) => {
        mesh.count = 0;
      }),
    );
  }
  add(tree: Tree) {
    if (
      this.status !== 'ready' ||
      this.host.disposed ||
      tree.conifer ||
      this.count >= 48 ||
      !(tree.h > 0)
    )
      return false;
    const species = hash(tree.seed + 791) > 0.5 ? 1 : 0,
      pool = this.pools[species];
    if (!pool || pool[0].count >= 48) return false;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(tree.x, tree.y, tree.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        hash(tree.seed) * Math.PI,
      ),
      new THREE.Vector3(tree.h, tree.h, tree.h),
    );
    pool.forEach((mesh) => {
      mesh.setMatrixAt(mesh.count++, matrix);
    });
    this.count++;
    return true;
  }
  finish() {
    this.pools.forEach((pool) =>
      pool.forEach((mesh) => {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }),
    );
    this.group.visible = this.count > 0;
  }
  state() {
    return {
      status: this.status,
      count: this.count,
      species: 2,
      templateHeightM: 10,
      textureCount: this.textures.size,
      maximumDraws: 4,
    };
  }
  dispose() {
    if (this.status === 'disposed') return;
    this.status = 'disposed';
    this.abort.abort();
    this.group.removeFromParent();
    this.pools.flat().forEach((m) => {
      m.geometry.dispose();
      m.dispose();
    });
    this.pools = [];
    this.materials.forEach((m) => m.dispose());
    this.materials.clear();
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
    this.count = 0;
  }
}

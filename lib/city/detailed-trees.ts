import {
  TreeSelection,
  TreeAssetBarrier,
  type TreeCandidate,
} from './tree-selection';
import * as THREE from 'three';
import { createTreeGeometry } from './assets/tree-geometry';
import { hash } from './geo';
import type { CityEngine } from './engine';
import { QUALITY, type VisualQuality } from './quality';

export interface ForestTree {
  x: number;
  z: number;
  h: number;
  conifer: boolean;
  seed: number;
  slots?: { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4 }[];
}
export function registerTree(
  t: ForestTree,
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
) {
  (t.slots ||= []).push({ mesh, index, matrix: matrix.clone() });
}

/** A bounded near-camera pool; distant instances keep their inexpensive geometry. */
export class DetailedTrees {
  group = new THREE.Group();
  pools: {
    trunk: THREE.InstancedMesh;
    foliage: THREE.InstancedMesh;
    count: number;
  }[] = [];
  hidden = new Set<ForestTree>();
  last = new THREE.Vector3(Infinity, Infinity, Infinity);
  quality: VisualQuality | null = null;
  trees: (ForestTree & { y: number; variant: number })[];
  private selection: TreeCandidate<
    ForestTree & { y: number; variant: number }
  >[] = [];
  private spatial: TreeSelection<ForestTree & { y: number; variant: number }>;
  private assetBarrier = new TreeAssetBarrier();
  private refresh = false;
  private disposed = false;
  private wantedPools = 0;
  private materials: {
    trunk: THREE.MeshStandardMaterial;
    leaf: THREE.MeshStandardMaterial;
    depth: THREE.MeshDepthMaterial;
  } | null = null;
  ready = false;
  assetsReady = false;
  constructor(
    private e: CityEngine,
    trees: ForestTree[],
  ) {
    this.trees = trees.map((t) =>
      Object.assign(t, {
        y: t.slots?.[0]?.matrix.elements[13] ?? e.elevation(t.x, t.z),
        variant: Math.floor(hash(t.seed + 92) * 3),
      }),
    );
    this.spatial = new TreeSelection(this.trees);
    this.group.name = 'Nearby textured trees';
    e.vegetation.add(this.group);
  }
  initialize() {
    if (this.ready || this.disposed || this.e.disposed) return;
    this.ready = true;
    const loader = new THREE.TextureLoader();
    const settled = (asset: 'leaf' | 'bark', success: boolean) => {
      if (this.disposed || this.e.disposed) return;
      this.assetsReady = this.assetBarrier.settle(asset, success);
      this.refresh = true;
    };
    const atlas = loader.load(
      '/textures/trees/leaf-atlas.png',
      () => settled('leaf', true),
      undefined,
      () => settled('leaf', false),
    );
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = Math.min(
      8,
      this.e.renderer.capabilities.getMaxAnisotropy(),
    );
    const bark = loader.load(
      '/textures/trees/bark-albedo.png',
      () => settled('bark', true),
      undefined,
      () => settled('bark', false),
    );
    bark.colorSpace = THREE.SRGBColorSpace;
    bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
    bark.anisotropy = atlas.anisotropy;
    this.e.extraTextures.add(atlas);
    this.e.extraTextures.add(bark);
    const trunkMat = new THREE.MeshStandardMaterial({
      map: bark,
      bumpMap: bark,
      bumpScale: 0.045,
      roughness: 1,
      vertexColors: true,
    });
    const leafMat = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.92,
    });
    // The source is RGB on a neutral checker, not RGBA. Remove the neutral matte
    // from filtered edge samples as well as rejecting the background. A binary
    // bright-pixel mask left white contamination around minified needles.
    const mask = (
      shader: Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0],
    ) => {
      shader.vertexShader =
        'attribute float aSolid; varying float vSolid;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSolid=aSolid;',
      );
      shader.fragmentShader = 'varying float vSolid;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef USE_MAP
 vec3 leafRGB = sampledDiffuseColor.rgb;
 float matte = min(leafRGB.r,min(leafRGB.g,leafRGB.b));
 float coverage = 1.0-matte;
 vec3 unmatte = max(vec3(0.),leafRGB-vec3(matte))/max(coverage,.001);
 diffuseColor.rgb *= mix(unmatte/max(leafRGB,vec3(.001)),vec3(1.),vSolid);
 diffuseColor.a *= mix(coverage,1.,vSolid);
#endif`,
      );
    };
    leafMat.onBeforeCompile = mask;
    leafMat.customProgramCacheKey = () => 'atlas-neutral-matte-leaf-v2';
    const depth = new THREE.MeshDepthMaterial({
      map: atlas,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      depthPacking: THREE.RGBADepthPacking,
    });
    depth.onBeforeCompile = mask;
    depth.customProgramCacheKey = () => 'atlas-neutral-matte-depth-v2';
    this.materials = { trunk: trunkMat, leaf: leafMat, depth };
  }
  /** At most one unchanged geometry factory per render update; High never
   * creates Ultra pools. Unbuilt pools leave their original tree slots visible. */
  private buildNextPool() {
    if (
      this.disposed ||
      this.e.disposed ||
      !this.assetsReady ||
      !this.materials ||
      this.pools.length >= this.wantedPools
    )
      return false;
    const index = this.pools.length,
      detail = index >= 6,
      local = index % 6;
    const geometry = createTreeGeometry(
      local >= 3,
      local % 3,
      detail ? 'ultra' : 'medium',
    );
    const trunk = new THREE.InstancedMesh(
      geometry.trunk,
      this.materials.trunk,
      240,
    );
    const foliage = new THREE.InstancedMesh(
      geometry.foliage,
      this.materials.leaf,
      240,
    );
    for (const m of [trunk, foliage]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
    foliage.customDepthMaterial = this.materials.depth;
    foliage.userData.alphaFoliage = true;
    // Dense append-only array: Engine's existing SSAO foliage enumeration stays valid.
    this.pools.push({ trunk, foliage, count: 0 });
    return true;
  }
  /** Terminal Engine teardown. Textures remain owned by Engine.extraTextures.
   * Once a pool exists its three materials are owned by scene traversal; before
   * that point no mesh can release them (e.g. failed/pending texture loads). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.assetsReady = false;
    this.wantedPools = 0;
    if (this.materials && this.pools.length === 0) {
      this.materials.trunk.dispose();
      this.materials.leaf.dispose();
      this.materials.depth.dispose();
    }
    this.materials = null;
  }
  update(force = false) {
    const quality = this.e.settings.trees
      ? this.e.settings.quality
      : 'balanced';
    const camera = this.e.camera.position;
    if (this.disposed || this.e.disposed) return;
    const changed =
      force ||
      quality !== this.quality ||
      this.last.distanceToSquared(camera) >= 18 * 18;
    if (changed) {
      this.quality = quality;
      this.last.copy(camera);
      this.selection =
        quality === 'balanced'
          ? []
          : this.spatial.nearest(
              camera.x,
              camera.y,
              camera.z,
              QUALITY[quality].treeDistance,
              quality === 'ultra' ? 1080 : 450,
            );
      this.e.data.treeSelection = { ...this.spatial.stats };
    }
    this.wantedPools = this.selection.length
      ? quality === 'ultra' && this.selection[0].d < 220 * 220
        ? 12
        : 6
      : 0;
    if (this.selection.length) this.initialize();
    const built = this.buildNextPool();
    if (!changed && !built && !this.refresh) return;
    this.refresh = false;
    const selected = this.assetsReady ? this.selection : [];
    for (const p of this.pools) p.count = 0;
    const next = new Set<ForestTree>(),
      dirty = new Set<THREE.InstancedMesh>();
    const dummy = new THREE.Object3D(),
      color = new THREE.Color(),
      zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < selected.length; i++) {
      const { t, d } = selected[i];
      const detail = quality === 'ultra' && d < 220 * 220 && i < 480 ? 1 : 0;
      const slot = (t.conifer ? 3 : 0) + t.variant;
      const pool = this.pools[detail * 6 + slot] || this.pools[slot];
      if (!pool) continue;
      if (pool.count >= 240) continue; // The original instance remains visible.
      next.add(t);
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, hash(t.seed) * Math.PI, 0);
      dummy.scale.setScalar(t.h);
      dummy.updateMatrix();
      pool.trunk.setMatrixAt(pool.count, dummy.matrix);
      pool.foliage.setMatrixAt(pool.count, dummy.matrix);
      color.setHSL(
        0.24 + hash(t.seed + 8) * 0.035,
        0.12,
        0.74 + hash(t.seed + 3) * 0.16,
      );
      pool.foliage.setColorAt(pool.count, color);
      pool.count++;
      if (!this.hidden.has(t))
        for (const slot of t.slots || []) {
          slot.mesh.setMatrixAt(slot.index, zero);
          dirty.add(slot.mesh);
        }
    }
    for (const t of this.hidden)
      if (!next.has(t))
        for (const slot of t.slots || []) {
          slot.mesh.setMatrixAt(slot.index, slot.matrix);
          dirty.add(slot.mesh);
        }
    this.hidden = next;
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
    for (const p of this.pools) {
      p.trunk.count = p.foliage.count = p.count;
      p.trunk.instanceMatrix.needsUpdate =
        p.foliage.instanceMatrix.needsUpdate = true;
      if (p.foliage.instanceColor) p.foliage.instanceColor.needsUpdate = true;
    }
    this.group.visible = quality !== 'balanced';
    this.e.renderer.shadowMap.needsUpdate = true;
    this.e.data.detailedTreeCount = next.size;
  }
}

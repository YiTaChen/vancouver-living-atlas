import {
  TreeSelection,
  TreeAssetBarrier,
  type TreeCandidate,
} from './tree-selection';
import * as THREE from 'three';
import { createTreeGeometry } from './assets/tree-geometry';
import { MatureTrees } from './assets/mature-trees';
import type {
  TreeLeafCandidate,
  TreeMaterialCandidate,
} from './assets/tree-material-candidate';
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
  private selectionAt = -Infinity;
  private motionPolicy = '';
  private lods = new Map<ForestTree, number>();
  private disposed = false;
  private wantedPools = 0;
  private leafCandidate: TreeLeafCandidate | null = null;
  private requestedMaterial: TreeMaterialCandidate = 'baseline';
  private activeMaterial: TreeMaterialCandidate = 'baseline';
  private geometryCandidate: 'baseline' | 'blender' = 'blender';
  private matureTrees: MatureTrees;
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
    this.matureTrees = new MatureTrees(e);
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
  /** Explicit QA opt-in. A failed or superseded load keeps the baseline; changing
   * this mode never regenerates geometry, instances, source seeds or LOD pools. */
  async setMaterialCandidate(mode: TreeMaterialCandidate): Promise<boolean> {
    if (process.env.VANCOUVER_VISUAL_QA !== '1') return false;
    if (
      this.disposed ||
      this.e.disposed ||
      !['baseline', 'leaf-rgba'].includes(mode)
    )
      return false;
    this.requestedMaterial = mode;
    if (mode === 'leaf-rgba') {
      if (!this.leafCandidate) {
        const { TreeLeafCandidate } =
          await import('./assets/tree-material-candidate');
        if (this.disposed || this.e.disposed || this.requestedMaterial !== mode)
          return false;
        this.leafCandidate ??= new TreeLeafCandidate(this.e);
      }
      if (
        !(await this.leafCandidate.load()) ||
        this.disposed ||
        this.e.disposed ||
        this.requestedMaterial !== mode
      )
        return false;
    }
    this.activeMaterial = mode;
    const materials =
      mode === 'leaf-rgba' ? this.leafCandidate!.materials : this.materials;
    if (materials)
      for (const pool of this.pools) {
        pool.foliage.material = materials.leaf;
        pool.foliage.customDepthMaterial = materials.depth;
      }
    this.e.renderer.shadowMap.needsUpdate = true;
    return true;
  }
  getMaterialCandidateState() {
    return {
      requested: this.requestedMaterial,
      active: this.activeMaterial,
      status: this.leafCandidate?.status ?? 'idle',
      extraTextures: this.leafCandidate ? 1 : 0,
    };
  }
  async setGeometryCandidate(mode: 'baseline' | 'blender') {
    if (
      process.env.VANCOUVER_VISUAL_QA !== '1' ||
      this.disposed ||
      this.e.disposed
    )
      return false;
    this.geometryCandidate = mode;
    if (mode === 'blender') await this.matureTrees.load();
    if (this.disposed || this.e.disposed) return false;
    this.update(true);
    return mode === 'baseline' || this.matureTrees.status === 'ready';
  }
  getGeometryCandidateState() {
    return { active: this.geometryCandidate, ...this.matureTrees.state() };
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
      this.activeMaterial === 'leaf-rgba'
        ? this.leafCandidate!.materials!.leaf
        : this.materials.leaf,
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
    foliage.customDepthMaterial =
      this.activeMaterial === 'leaf-rgba'
        ? this.leafCandidate!.materials!.depth
        : this.materials.depth;
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
    this.matureTrees.dispose();
    this.assetsReady = false;
    this.wantedPools = 0;
    if (
      this.materials &&
      (this.pools.length === 0 || this.activeMaterial === 'leaf-rgba')
    ) {
      if (this.pools.length === 0) this.materials.trunk.dispose();
      this.materials.leaf.dispose();
      this.materials.depth.dispose();
    }
    this.leafCandidate?.dispose(
      this.pools.length > 0 && this.activeMaterial === 'leaf-rgba',
    );
    this.materials = null;
  }
  update(force = false) {
    const quality = this.e.settings.trees
      ? this.e.settings.quality
      : 'balanced';
    const camera = this.e.camera.position;
    if (this.disposed || this.e.disposed) return;
    const motion = this.e.sceneryMotion,
      budget = this.e.detailWorkBudget;
    const policy = motion
      ? `${motion.auto}:${motion.allowNewDetails}:${motion.fast}:${motion.mode}`
      : '';
    const retainFlight =
      !!motion?.auto &&
      motion.mode === 'flight' &&
      quality === 'balanced' &&
      this.e.settings.trees;
    // Auto flight keeps bounded existing medium trees, never an Ultra/mature
    // population. Every omitted replacement restores its original far slot.
    const detailQuality = retainFlight ? 'high' : quality;
    const changed =
      force ||
      quality !== this.quality ||
      policy !== this.motionPolicy ||
      (this.last.distanceToSquared(camera) >= 18 * 18 &&
        (!motion ||
          motion.nowMs - this.selectionAt >= motion.selectionIntervalMs));
    if (changed) {
      this.quality = quality;
      this.motionPolicy = policy;
      this.selectionAt = motion?.nowMs ?? -Infinity;
      this.last.copy(camera);
      if (!motion)
        this.selection =
          detailQuality === 'balanced'
            ? []
            : this.spatial.nearest(
                camera.x,
                camera.y,
                camera.z,
                QUALITY[detailQuality].treeDistance,
                detailQuality === 'ultra' ? 1080 : 450,
              );
      else {
        const range = QUALITY[detailQuality].treeDistance,
          limit = detailQuality === 'ultra' ? 1080 : 450;
        const actual = (candidate: (typeof this.selection)[number]) => ({
          ...candidate,
          d:
            (candidate.t.x - camera.x) ** 2 +
            (candidate.t.y + candidate.t.h * 0.55 - camera.y) ** 2 +
            (candidate.t.z - camera.z) ** 2,
        });
        const retained = range
          ? this.selection.map(actual).filter(({ d }) => d < (range + 36) ** 2)
          : [];
        const known = new Set(retained.map(({ t }) => t));
        const ahead = motion.lookAheadXYZ;
        const proposed =
          range && !retainFlight && motion.allowNewDetails
            ? this.spatial.nearest(...ahead, range, limit).map(actual)
            : [];
        const admissionLimit =
          motion.auto && motion.fast ? 16 : motion.moving ? 48 : limit;
        this.selection = retained
          .concat(
            proposed
              .filter(({ t, d }) => !known.has(t) && d < (range + 60) ** 2)
              .slice(0, admissionLimit),
          )
          .slice(0, limit)
          .sort((a, b) => a.d - b.d || a.ordinal - b.ordinal);
      }
      this.e.data.treeSelection = { ...this.spatial.stats };
    }
    this.wantedPools = this.selection.length
      ? detailQuality === 'ultra' &&
        this.selection[0].d < (motion ? 240 * 240 : 220 * 220)
        ? 12
        : 6
      : 0;
    const allowNew = (motion?.allowNewDetails ?? true) && !retainFlight;
    if (this.selection.length && !this.ready && allowNew) {
      if (budget) budget.run(() => this.initialize(), { admission: true });
      else this.initialize();
    }
    // Browser comparisons rejected the mature broadleaf cost in High. Only
    // Ultra pays for this package, once an eligible close source tree exists.
    const useMatureTrees =
      detailQuality === 'ultra' && this.geometryCandidate === 'blender';
    if (
      useMatureTrees &&
      allowNew &&
      this.matureTrees.status === 'idle' &&
      this.selection.some(
        ({ t, d }) => !t.conifer && d < (motion ? 40 * 40 : 45 * 45),
      )
    ) {
      const load = () => {
        void this.matureTrees.load().then(() => {
          if (!this.disposed && !this.e.disposed) this.refresh = true;
        });
      };
      if (budget) budget.run(load, { admission: true });
      else load();
    }
    let built = false;
    if (allowNew && this.assetsReady && this.pools.length < this.wantedPools) {
      const build = () => {
        built = this.buildNextPool();
      };
      if (budget) budget.run(build, { admission: true });
      else build();
    }
    if (!changed && !built && !this.refresh) return;
    this.refresh = false;
    const rebuild = () => {
      const selected =
        this.assetsReady ||
        (useMatureTrees && this.matureTrees.status === 'ready')
          ? this.selection
          : [];
      this.matureTrees.reset();
      for (const p of this.pools) p.count = 0;
      const next = new Set<ForestTree>(),
        dirty = new Set<THREE.InstancedMesh>(),
        nextLods = new Map<ForestTree, number>();
      const dummy = new THREE.Object3D(),
        color = new THREE.Color(),
        zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < selected.length; i++) {
        const { t, d } = selected[i];
        if (
          useMatureTrees &&
          !t.conifer &&
          d <
            (motion ? (this.lods.get(t) === 2 ? 58 * 58 : 40 * 40) : 45 * 45) &&
          this.matureTrees.count < 8 &&
          this.matureTrees.add(t)
        ) {
          next.add(t);
          nextLods.set(t, 2);
          if (!this.hidden.has(t))
            for (const slot of t.slots || []) {
              slot.mesh.setMatrixAt(slot.index, zero);
              dirty.add(slot.mesh);
            }
          continue;
        }
        const detail =
          detailQuality === 'ultra' &&
          d <
            (motion
              ? this.lods.get(t) === 1
                ? 240 * 240
                : 200 * 200
              : 220 * 220) &&
          i < 480
            ? 1
            : 0;
        const slot = (t.conifer ? 3 : 0) + t.variant;
        const pool = this.pools[detail * 6 + slot] || this.pools[slot];
        if (!pool) continue;
        if (pool.count >= 240) continue; // The original instance remains visible.
        next.add(t);
        nextLods.set(t, detail);
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
      this.lods = nextLods;
      this.matureTrees.finish();
      for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
      for (const p of this.pools) {
        p.trunk.count = p.foliage.count = p.count;
        p.trunk.instanceMatrix.needsUpdate =
          p.foliage.instanceMatrix.needsUpdate = true;
        if (p.foliage.instanceColor) p.foliage.instanceColor.needsUpdate = true;
      }
      this.group.visible = next.size > 0;
      this.e.renderer.shadowMap.needsUpdate = true;
      this.e.data.detailedTreeCount = next.size;
      this.e.data.matureTreeAssets = this.getGeometryCandidateState();
    };
    if (budget) {
      if (!budget.run(rebuild)) this.refresh = true;
    } else rebuild();
  }
}

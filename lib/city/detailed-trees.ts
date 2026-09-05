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
  ready = false;
  assetsReady = false;
  constructor(
    private e: CityEngine,
    trees: ForestTree[],
  ) {
    this.trees = trees.map((t) =>
      Object.assign(t, {
        y: e.elevation(t.x, t.z),
        variant: Math.floor(hash(t.seed + 92) * 3),
      }),
    );
    this.group.name = 'Nearby textured trees';
    e.vegetation.add(this.group);
  }
  initialize() {
    if (this.ready) return;
    this.ready = true;
    const loader = new THREE.TextureLoader();
    const atlas = loader.load(
      '/textures/trees/leaf-atlas.png',
      () => {
        if (this.e.disposed) return;
        this.assetsReady = true;
        this.e.renderer.shadowMap.needsUpdate = true;
        this.update(true);
      },
      undefined,
      () => {
        this.assetsReady = false;
        if (!this.e.disposed) this.update(true);
      },
    );
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = Math.min(
      8,
      this.e.renderer.capabilities.getMaxAnisotropy(),
    );
    const bark = loader.load('/textures/trees/bark-albedo.png');
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
    // Image generator returned RGB with a neutral checker background. Decode its
    // chroma into coverage rather than displaying the checker or claiming RGBA.
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
 float coverage = 1.0-smoothstep(.56,.72,min(leafRGB.r,min(leafRGB.g,leafRGB.b)));
 diffuseColor.a *= mix(coverage,1.,vSolid);
#endif`,
      );
    };
    leafMat.onBeforeCompile = mask;
    leafMat.customProgramCacheKey = () => 'atlas-chroma-leaf-v1';
    const depth = new THREE.MeshDepthMaterial({
      map: atlas,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      depthPacking: THREE.RGBADepthPacking,
    });
    depth.onBeforeCompile = mask;
    depth.customProgramCacheKey = () => 'atlas-chroma-depth-v1';
    for (let detail = 0; detail < 2; detail++)
      for (let species = 0; species < 2; species++)
        for (let variant = 0; variant < 3; variant++) {
          const geometry = createTreeGeometry(
            !!species,
            variant,
            detail ? 'ultra' : 'medium',
          );
          const trunk = new THREE.InstancedMesh(geometry.trunk, trunkMat, 240);
          const foliage = new THREE.InstancedMesh(
            geometry.foliage,
            leafMat,
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
          foliage.customDepthMaterial = depth;
          foliage.userData.alphaFoliage = true;
          this.pools.push({ trunk, foliage, count: 0 });
        }
  }
  update(force = false) {
    const quality = this.e.settings.trees
      ? this.e.settings.quality
      : 'balanced';
    const camera = this.e.camera.position;
    if (
      !force &&
      quality === this.quality &&
      this.last.distanceToSquared(camera) < 18 * 18
    )
      return;
    this.quality = quality;
    this.last.copy(camera);
    const distance = QUALITY[quality].treeDistance;
    const selected =
      quality === 'balanced'
        ? []
        : this.trees
            .map((t) => ({
              t,
              d:
                (t.x - camera.x) ** 2 +
                (t.y + t.h * 0.55 - camera.y) ** 2 +
                (t.z - camera.z) ** 2,
            }))
            .filter((p) => p.d < distance * distance)
            .sort((a, b) => a.d - b.d)
            .slice(0, quality === 'ultra' ? 1080 : 450);
    if (selected.length) this.initialize();
    if (!this.assetsReady) selected.length = 0;
    for (const p of this.pools) p.count = 0;
    const next = new Set<ForestTree>(),
      dirty = new Set<THREE.InstancedMesh>();
    const dummy = new THREE.Object3D(),
      color = new THREE.Color(),
      zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < selected.length; i++) {
      const { t, d } = selected[i];
      const detail = quality === 'ultra' && d < 220 * 220 && i < 480 ? 1 : 0;
      const pool = this.pools[detail * 6 + (t.conifer ? 3 : 0) + t.variant];
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

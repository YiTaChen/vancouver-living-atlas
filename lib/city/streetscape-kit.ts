import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import streetKitManifest from '../../public/models/streetscape/manifest.json';
import type {
  StreetBayAsset,
  StreetBayPlacement,
} from './streetscape-placement';
import { streetBayCell, STREET_BAY_HEIGHT_M } from './streetscape-placement';
import {
  createShopPanelBatch,
  detailedShopPanels,
  shopIdentityFor,
  type ShopPanel,
} from './shopfront-identity';

export type StreetBaySource = {
  id: number;
  /** Original shop artwork remains stable between the fallback and both LODs. */
  identity?: number;
  placement: StreetBayPlacement;
  /** Toggles only this frontage's old ground detail. Upper windows remain. */
  setDetailed(active: boolean): void;
};
type Host = {
  camera: THREE.PerspectiveCamera;
  landmarks: THREE.Group;
  settings: { buildings: boolean; quality: string };
  renderer: { shadowMap: { needsUpdate: boolean } };
  disposed: boolean;
};
type Template = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}[];
type Key = `${StreetBayAsset}:${0 | 1}`;
type Cell = { id: string; sources: StreetBaySource[]; bounds: THREE.Box3 };
type Selection = { source: StreetBaySource; lod: 0 | 1 };
type Page = {
  group: THREE.Group;
  selections: Selection[];
  version: string;
  stamp: number;
};
export type StreetBayLoader = (url: string) => Promise<THREE.Object3D>;

function disposeMaterials(materials: Set<THREE.Material>) {
  const textures = new Set<THREE.Texture>();
  const images = new Set<{ close(): void }>();
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  textures.forEach((texture) => {
    // GLTFLoader can decode embedded maps to ImageBitmap; GPU disposal alone
    // does not close that owned CPU-side bitmap.
    const image = texture.image;
    if (
      image &&
      typeof image === 'object' &&
      'close' in image &&
      typeof image.close === 'function'
    )
      images.add(image as { close(): void });
    texture.dispose();
  });
  images.forEach((image) => image.close());
}

/** Preserve all glTF vertex attributes, material groups and node transforms.
 * Geometry receives each node's world matrix exactly once. The source scene is
 * static and its primitive buffers are released after the owned clone is made. */
export function flattenStreetBay(scene: THREE.Object3D): Template {
  const parts: Template = [];
  const originals = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    originals.add(object.geometry);
    (Array.isArray(object.material)
      ? object.material
      : [object.material]
    ).forEach((material) => ownedMaterials.add(material));
  });
  try {
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh)
        throw new Error('Street bay must be static');
      const geometry = object.geometry.clone();
      // Register ownership before any transform operation can fail.
      parts.push({ geometry, material: object.material });
      geometry.applyMatrix4(object.matrixWorld);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
    if (!parts.length) throw new Error('Street bay has no mesh primitives');
    for (const material of ownedMaterials) {
      if (material.transparent) material.depthWrite = false;
      // Environment comes from the live sky; no reflection or light is baked in.
      if (material instanceof THREE.MeshStandardMaterial)
        material.envMapIntensity = 0.45;
    }
  } catch (error) {
    parts.forEach((part) => part.geometry.dispose());
    originals.forEach((geometry) => geometry.dispose());
    disposeMaterials(ownedMaterials);
    throw error;
  }
  originals.forEach((geometry) => geometry.dispose());
  return parts;
}

/** Bounded, lazy, instanced street modules with an immediate procedural fallback.
 * GLBs do not change footprint, foundation, route, or collision geometry. */
export class StreetscapeKit {
  private readonly cells: Cell[];
  private readonly templates = new Map<Key, Template>();
  private readonly pages = new Map<string, Page>();
  private readonly active = new Map<string, Selection[]>();
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private quality = '';
  private loading = false;
  private loaded = false;
  private failed = false;
  private disposed = false;
  private stamp = 0;
  private readonly loader: StreetBayLoader;
  readonly group = new THREE.Group();

  constructor(
    private readonly e: Host,
    sources: StreetBaySource[],
    loader?: StreetBayLoader,
    private readonly identityMaterial?: THREE.MeshStandardMaterial,
  ) {
    this.loader =
      loader ?? (async (url) => (await new GLTFLoader().loadAsync(url)).scene);
    const cells = new Map<string, Cell>();
    for (const source of sources) {
      const p = source.placement,
        id = streetBayCell(p.x, p.z);
      if (!cells.has(id))
        cells.set(id, { id, sources: [], bounds: new THREE.Box3() });
      const cell = cells.get(id)!;
      cell.sources.push(source);
      cell.bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
      cell.bounds.expandByPoint(
        new THREE.Vector3(p.x, p.y + STREET_BAY_HEIGHT_M, p.z),
      );
    }
    this.cells = [...cells.values()];
    this.group.name = 'Original Blender street bay kit';
    e.landmarks.add(this.group);
  }

  private async load() {
    if (this.loading || this.loaded || this.failed || this.disposed) return;
    this.loading = true;
    const kinds: StreetBayAsset[] = ['heritage-shop-bay', 'modern-lobby-bay'];
    const results = await Promise.allSettled(
      kinds.flatMap((kind) =>
        [0, 1].map(async (level) => {
          const scene = await this.loader(
            `/models/streetscape/${kind}.lod${level}.glb?v=${streetKitManifest.assets
              .find((asset) => asset.id === kind)!
              .lods.find((lod) => lod.level === level)!
              .sha256.slice(0, 12)}`,
          );
          const parts = flattenStreetBay(scene);
          if (this.disposed || this.e.disposed) {
            this.disposeTemplates([parts]);
          } else this.templates.set(`${kind}:${level}` as Key, parts);
        }),
      ),
    );
    this.loading = false;
    if (this.disposed || this.e.disposed) return;
    this.failed = results.some((result) => result.status === 'rejected');
    this.loaded = !this.failed;
    // Failure never suppresses the existing storefronts. Release partial loads.
    if (this.failed) {
      this.disposeTemplates(this.templates.values());
      this.templates.clear();
    }
  }

  private select(quality: string) {
    this.active.clear();
    if (quality !== 'high' && quality !== 'ultra') return;
    const ultra = quality === 'ultra',
      range = ultra ? 210 : 140;
    const candidates = this.cells
      .map((cell) => ({
        cell,
        distance: cell.bounds.distanceToPoint(this.last),
      }))
      .filter(({ distance }) => distance < range)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, ultra ? 6 : 4)
      .flatMap(({ cell }) =>
        cell.sources.map((source) => {
          const p = source.placement;
          return {
            cell,
            source,
            distance: Math.hypot(
              this.last.x - p.x,
              this.last.y - p.y - 2,
              this.last.z - p.z,
            ),
          };
        }),
      )
      .filter(({ distance }) => distance < range)
      .sort((a, b) => a.distance - b.distance || a.source.id - b.source.id)
      .slice(0, ultra ? 36 : 24);
    let detailed = 0;
    for (const { cell, source, distance } of candidates) {
      const lod: 0 | 1 =
        distance < (ultra ? 50 : 38) && detailed < (ultra ? 10 : 6) ? 0 : 1;
      if (lod === 0) detailed++;
      if (!this.active.has(cell.id)) this.active.set(cell.id, []);
      this.active.get(cell.id)!.push({ source, lod });
    }
  }

  private version(selections: Selection[]) {
    return selections
      .map(({ source, lod }) => `${source.id}:${lod}`)
      .sort()
      .join(',');
  }

  private show(page: Page, visible: boolean) {
    if (page.group.visible === visible) return;
    page.group.visible = visible;
    page.selections.forEach(({ source }) => source.setDetailed(visible));
    this.e.renderer.shadowMap.needsUpdate = true;
  }

  private build(selections: Selection[]): Page {
    const group = new THREE.Group(),
      batches = new Map<Key, StreetBaySource[]>();
    for (const { source, lod } of selections) {
      const key: Key = `${source.placement.asset}:${lod}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key)!.push(source);
    }
    const transform = new THREE.Object3D();
    const identityPanels: ShopPanel[] = [];
    if (this.identityMaterial)
      for (const { source } of selections) {
        const p = source.placement;
        if (p.asset !== 'heritage-shop-bay') continue;
        transform.position.set(p.x, p.y, p.z);
        transform.rotation.set(0, p.yaw, 0);
        transform.updateMatrix();
        identityPanels.push(
          ...detailedShopPanels(
            source.identity ?? shopIdentityFor(`${p.x}:${p.z}:${p.yaw}`),
            transform.matrix,
          ),
        );
      }
    for (const [key, sources] of batches) {
      for (const part of this.templates.get(key)!) {
        const mesh = new THREE.InstancedMesh(
          part.geometry,
          part.material,
          sources.length,
        );
        sources.forEach((source, index) => {
          const p = source.placement;
          transform.position.set(p.x, p.y, p.z);
          transform.rotation.set(0, p.yaw, 0);
          transform.updateMatrix();
          mesh.setMatrixAt(index, transform.matrix);
        });
        const materials = Array.isArray(part.material)
          ? part.material
          : [part.material];
        // Conventional alpha glass must not produce an opaque canopy/window
        // shadow in the engine's depth pass.
        mesh.castShadow = !materials.every((material) => material.transparent);
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    }
    if (identityPanels.length)
      group.add(createShopPanelBatch(identityPanels, this.identityMaterial!));
    group.visible = false;
    this.group.add(group);
    return {
      group,
      selections,
      version: this.version(selections),
      stamp: ++this.stamp,
    };
  }

  private release(page: Page) {
    this.show(page, false);
    page.group.removeFromParent();
    page.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        // GLB template buffers are shared; each identity batch owns its tiny
        // instanced atlas attribute and plane buffer, but not the shared material.
        if (object.userData.streetIdentity) object.geometry.dispose();
        object.dispose();
      }
    });
  }

  update() {
    if (this.disposed || this.e.disposed) return;
    const quality = this.e.settings.buildings
      ? this.e.settings.quality
      : 'balanced';
    if (
      quality !== this.quality ||
      this.last.distanceToSquared(this.e.camera.position) > 12 * 12
    ) {
      this.quality = quality;
      this.last.copy(this.e.camera.position);
      this.select(quality);
    }
    for (const [id, page] of this.pages) {
      const selections = this.active.get(id);
      if (!selections || page.version !== this.version(selections))
        this.show(page, false);
    }
    if (!this.active.size) return;
    if (!this.loaded) {
      void this.load();
      return;
    }
    // At most one cell's bounded geometry allocation on a frame.
    for (const [id, selections] of this.active) {
      let page = this.pages.get(id);
      const version = this.version(selections);
      if (page?.version === version) {
        page.stamp = ++this.stamp;
        this.show(page, true);
        continue;
      }
      if (page) this.release(page);
      page = this.build(selections);
      this.pages.set(id, page);
      this.show(page, true);
      break;
    }
    while (this.pages.size > 12) {
      const cold = [...this.pages]
        .filter(([id]) => !this.active.has(id))
        .sort((a, b) => a[1].stamp - b[1].stamp)[0];
      if (!cold) break;
      this.release(cold[1]);
      this.pages.delete(cold[0]);
    }
  }

  snapshot() {
    const visible = [...this.pages.values()].filter(
      (page) => page.group.visible,
    );
    const candidatesByAsset = { 'heritage-shop-bay': 0, 'modern-lobby-bay': 0 };
    for (const cell of this.cells)
      for (const source of cell.sources)
        candidatesByAsset[source.placement.asset]++;
    return {
      loaded: this.loaded,
      loading: this.loading,
      failed: this.failed,
      candidatesByAsset,
      candidateBays: Object.values(candidatesByAsset).reduce(
        (sum, count) => sum + count,
        0,
      ),
      selectedBays: [...this.active.values()].reduce(
        (sum, selections) => sum + selections.length,
        0,
      ),
      pendingCells: [...this.active].filter(
        ([id, selections]) =>
          this.pages.get(id)?.version !== this.version(selections),
      ).length,
      cacheCells: this.pages.size,
      visibleCells: visible.length,
      visibleBays: visible.reduce(
        (sum, page) => sum + page.selections.length,
        0,
      ),
      lod0Bays: visible.reduce(
        (sum, page) =>
          sum +
          page.selections.filter((selection) => selection.lod === 0).length,
        0,
      ),
    };
  }

  private disposeTemplates(templates: Iterable<Template>) {
    const materials = new Set<THREE.Material>();
    for (const parts of templates)
      for (const part of parts) {
        part.geometry.dispose();
        (Array.isArray(part.material)
          ? part.material
          : [part.material]
        ).forEach((material) => materials.add(material));
      }
    disposeMaterials(materials);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pages.forEach((page) => this.release(page));
    this.pages.clear();
    this.active.clear();
    this.group.removeFromParent();
    this.disposeTemplates(this.templates.values());
    this.templates.clear();
  }
}

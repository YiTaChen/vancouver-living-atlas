import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  ArchitectureBox,
  ArchitectureRoofUnit,
} from './architecture-plan';
import { cityReliefMaterial } from './city-surface-material';
import {
  CITY_MATERIAL_SLOT,
  type CityMaterialLibrary,
} from './material-library';
import manifest from '../../public/models/blender/rooftop-equipment/manifest.json';

export const ROOFTOP_EQUIPMENT = {
  cells: 2,
  high: 24,
  ultra: 48,
  range: 550,
  near: 80,
  hysteresis: 15,
} as const;
export const ROOFTOP_TEMPLATES = manifest.assets;
type Template = (typeof ROOFTOP_TEMPLATES)[number];
type Piece = {
  geometry: THREE.BufferGeometry;
  role: string;
  color: THREE.Color;
};
export type RooftopLoader = (
  asset: Template,
  lod: 0 | 1,
) => Promise<THREE.Object3D>;
export type RoofAdmission = { id: string; distance: number };
type Selection = { lod: 0 | 1; limit: number };

/** Fixed metre geometry fits inside the original equipment's checked footprint.
 * The 2.5 m tall original plant remains intact, as does any truncated assembly. */
export function selectRooftopGroups(boxes: readonly ArchitectureBox[]) {
  const grouped = new Map<ArchitectureRoofUnit, number[]>();
  boxes.forEach((box, index) => {
    if (box.roofUnit) {
      const indices = grouped.get(box.roofUnit) ?? [];
      indices.push(index);
      grouped.set(box.roofUnit, indices);
    }
  });
  return [...grouped].flatMap(([unit, indices]) => {
    if (
      indices.length !== unit.boxCount ||
      unit.height > 1.4 + 1e-6 ||
      ![
        unit.x,
        unit.y,
        unit.z,
        unit.width,
        unit.height,
        unit.depth,
        unit.yaw,
      ].every(Number.isFinite) ||
      indices.filter((i) => boxes[i].kind === 'equipment').length !== 2
    )
      return [];
    const asset = [...ROOFTOP_TEMPLATES]
      .reverse()
      .find(
        (a) =>
          a.size[0] <= unit.width + 1e-6 &&
          a.size[2] <= unit.depth + 1e-6 &&
          a.size[1] <= unit.height + 0.315 + 1e-6,
      );
    return asset ? [{ unit, indices, asset }] : [];
  });
}

function disposeImported(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  for (const material of materials)
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    const image = t.image as { close?: () => void } | undefined;
    image?.close?.();
  });
}

/** The source uses two explicit roles and no images. Transform each imported
 * primitive once; retain authored tint, bind the engine's existing PBR atlas. */
export function extractRooftopGeometry(
  scene: THREE.Object3D,
  asset: Template,
  lod: 0 | 1,
): Piece[] {
  const pieces: Piece[] = [];
  try {
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object instanceof THREE.SkinnedMesh || Array.isArray(object.material))
        throw new Error('Static rooftop primitives required');
      const material = object.material as THREE.MeshStandardMaterial;
      if (
        !['shared-metal-housing', 'shared-metal-detail'].includes(material.name)
      )
        throw new Error('Unknown rooftop role');
      if (Object.values(material).some((v) => v instanceof THREE.Texture))
        throw new Error('Rooftop templates must not duplicate textures');
      if (object.matrixWorld.determinant() <= 0)
        throw new Error('Rooftop transform must preserve winding');
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      pieces.push({
        geometry,
        role: material.name,
        color: material.color.clone(),
      });
      for (const name of ['position', 'normal', 'uv', 'tangent']) {
        const attribute = geometry.getAttribute(name);
        if (!attribute || !Array.from(attribute.array).every(Number.isFinite))
          throw new Error(`Invalid rooftop ${name}`);
      }
      const vertices = geometry.getAttribute('position').count;
      geometry.setAttribute(
        'aReliefSize',
        new THREE.BufferAttribute(new Float32Array(vertices * 3).fill(1), 3),
      );
      geometry.setAttribute(
        'aReliefSurface',
        new THREE.BufferAttribute(
          new Float32Array(vertices).fill(CITY_MATERIAL_SLOT['painted-metal']),
          1,
        ),
      );
      geometry.clearGroups();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
    if (pieces.length !== 2 || new Set(pieces.map((p) => p.role)).size !== 2)
      throw new Error('Two rooftop roles required');
    const bounds = new THREE.Box3();
    let triangles = 0;
    for (const piece of pieces) {
      bounds.union(piece.geometry.boundingBox!);
      triangles +=
        (piece.geometry.index?.count ??
          piece.geometry.getAttribute('position').count) / 3;
    }
    if (triangles !== asset.lods[lod].triangles)
      throw new Error('Rooftop triangle contract');
    const expectedMin = [-asset.size[0] / 2, 0, -asset.size[2] / 2];
    const expectedMax = [asset.size[0] / 2, asset.size[1], asset.size[2] / 2];
    for (let i = 0; i < 3; i++)
      if (
        Math.abs(bounds.min.getComponent(i) - expectedMin[i]) > 1e-5 ||
        Math.abs(bounds.max.getComponent(i) - expectedMax[i]) > 1e-5
      )
        throw new Error('Rooftop metre datum contract');
    return pieces;
  } catch (error) {
    pieces.forEach((p) => p.geometry.dispose());
    throw error;
  } finally {
    disposeImported(scene);
  }
}

async function loadRooftop(asset: Template, lod: 0 | 1) {
  const file = asset.lods[lod];
  return (
    await new GLTFLoader().loadAsync(
      `/models/blender/rooftop-equipment/${file.file}?v=${file.sha256.slice(0, 12)}`,
    )
  ).scene;
}

/** Per-engine templates, at most two selected roof cells and six instanced
 * material batches per cell. Nothing loads in the initial distant overview. */
export class RooftopEquipment {
  readonly stats = {
    status: 'idle',
    readyTemplates: 0,
    selectedCells: 0,
    loadedTriangles: 0,
    failedLoads: 0,
  };
  private selection = new Map<string, Selection>();
  private templates = new Map<string, Piece[]>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private requested = new Set<string>();
  private dirty = new Set<string>();
  private disposed = false;
  constructor(
    private library: () => CityMaterialLibrary | null,
    private loader: RooftopLoader = loadRooftop,
  ) {}

  configure(cells: readonly RoofAdmission[], quality: string) {
    const next = new Map<string, Selection>();
    if (quality === 'high' || quality === 'ultra') {
      for (const cell of cells
        .filter(
          (c) =>
            Number.isFinite(c.distance) && c.distance < ROOFTOP_EQUIPMENT.range,
        )
        .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
        .slice(0, ROOFTOP_EQUIPMENT.cells)) {
        const old = this.selection.get(cell.id);
        const near =
          old?.lod === 0
            ? ROOFTOP_EQUIPMENT.near + ROOFTOP_EQUIPMENT.hysteresis
            : ROOFTOP_EQUIPMENT.near;
        next.set(cell.id, {
          lod: cell.distance < near ? 0 : 1,
          limit:
            (quality === 'ultra'
              ? ROOFTOP_EQUIPMENT.ultra
              : ROOFTOP_EQUIPMENT.high) / ROOFTOP_EQUIPMENT.cells,
        });
      }
    }
    for (const id of new Set([...this.selection.keys(), ...next.keys()])) {
      const a = this.selection.get(id),
        b = next.get(id);
      if (a?.lod !== b?.lod || a?.limit !== b?.limit) this.dirty.add(id);
    }
    this.selection = next;
    this.stats.selectedCells = next.size;
    if (next.size && !this.disposed) {
      const library = this.library();
      if (library)
        for (const { lod } of next.values())
          for (const asset of ROOFTOP_TEMPLATES)
            this.request(asset, lod, library);
    }
  }
  private request(asset: Template, lod: 0 | 1, library: CityMaterialLibrary) {
    const key = `${asset.id}/${lod}`;
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.stats.status = 'loading';
    void this.loader(asset, lod)
      .then((scene) => {
        if (this.disposed) {
          disposeImported(scene);
          return;
        }
        const pieces = extractRooftopGeometry(scene, asset, lod);
        this.templates.set(key, pieces);
        for (const piece of pieces) {
          const materialKey = `${piece.role}/${piece.color.getHexString()}`;
          if (!this.materials.has(materialKey)) {
            const material = cityReliefMaterial(library);
            material.name = `Blender rooftop ${piece.role}`;
            material.color.copy(piece.color);
            this.materials.set(materialKey, material);
          }
        }
        this.stats.readyTemplates = this.templates.size;
        this.stats.loadedTriangles += asset.lods[lod].triangles;
        this.stats.status =
          this.templates.size + this.stats.failedLoads < this.requested.size
            ? 'loading'
            : this.stats.failedLoads
              ? 'partial'
              : 'ready';
        for (const [id, selected] of this.selection)
          if (selected.lod === lod) this.dirty.add(id);
      })
      .catch(() => {
        if (this.disposed) return;
        this.stats.failedLoads++;
        this.stats.status =
          this.templates.size + this.stats.failedLoads < this.requested.size
            ? 'loading'
            : 'partial';
      });
  }
  takeInvalidated() {
    const ids = new Set(this.dirty);
    this.dirty.clear();
    return ids;
  }
  assemble(
    boxes: readonly ArchitectureBox[],
    cell: string,
    focus: THREE.Vector3,
  ) {
    const selected = this.selection.get(cell);
    if (!selected || this.disposed) return null;
    const groups = selectRooftopGroups(boxes)
      .sort(
        (a, b) =>
          (a.unit.x - focus.x) ** 2 +
            (a.unit.y - focus.y) ** 2 +
            (a.unit.z - focus.z) ** 2 -
            ((b.unit.x - focus.x) ** 2 +
              (b.unit.y - focus.y) ** 2 +
              (b.unit.z - focus.z) ** 2) ||
          a.unit.sourceKey.localeCompare(b.unit.sourceKey),
      )
      .filter((g) => this.templates.has(`${g.asset.id}/${selected.lod}`))
      .slice(0, selected.limit);
    const consumed = new Set<number>(),
      meshes: THREE.InstancedMesh[] = [];
    const byAsset = new Map<string, typeof groups>();
    for (const group of groups) {
      group.indices.forEach((i) => consumed.add(i));
      const list = byAsset.get(group.asset.id) ?? [];
      list.push(group);
      byAsset.set(group.asset.id, list);
    }
    const matrix = new THREE.Matrix4(),
      position = new THREE.Vector3(),
      rotation = new THREE.Quaternion();
    for (const [id, units] of byAsset)
      for (const piece of this.templates.get(`${id}/${selected.lod}`)!) {
        const material = this.materials.get(
          `${piece.role}/${piece.color.getHexString()}`,
        )!;
        const mesh = new THREE.InstancedMesh(
          piece.geometry,
          material,
          units.length,
        );
        mesh.name = `Blender rooftop ${id} LOD${selected.lod}/${piece.role}`;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.rooftopEquipment = true;
        units.forEach(({ unit }, index) => {
          position.set(unit.x, unit.y, unit.z);
          rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), unit.yaw);
          matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
          mesh.setMatrixAt(index, matrix);
        });
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        meshes.push(mesh);
      }
    return { consumed, meshes, units: groups.length, lod: selected.lod };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const pieces of this.templates.values())
      pieces.forEach((p) => p.geometry.dispose());
    this.materials.forEach((m) => m.dispose());
    this.templates.clear();
    this.materials.clear();
    this.selection.clear();
    this.dirty.clear();
    this.stats.status = 'disposed';
    this.stats.readyTemplates =
      this.stats.selectedCells =
      this.stats.loadedTriangles =
        0;
  }
}

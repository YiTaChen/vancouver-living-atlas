import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash } from './geo';

export interface TrafficRoute {
  a: number[];
  b: number[];
  length: number;
  speed: number;
  phase: number;
}

const roles = ['paint', 'glass', 'rubber'] as const;
type Role = (typeof roles)[number];
const palette = [0xdeddd4, 0x424e58, 0x83877d, 0x983f34, 0xcfb476, 0x314a57];
export const TRAFFIC_VEHICLE_ASSETS = [
  {
    model: 'sedan',
    lod: 0,
    hash: 'f15f54aa806023c354d02c7509e31029ae9a0991984d078bb562f55fd57f8eb8',
    bytes: 136820,
  },
  {
    model: 'sedan',
    lod: 1,
    hash: '66bc16c5b5094a4e08430f759d536a2858f172b130311f15300b13c3aa813822',
    bytes: 70956,
  },
  {
    model: 'sedan',
    lod: 2,
    hash: '6f92637cb715ee705cc38c27088020772c110985cb632efd51de2a68bf25a2d8',
    bytes: 18484,
  },
  {
    model: 'suv',
    lod: 0,
    hash: '013df7a8b6c1d0bb45a6dbe027035beee12356c1c2c1911a097fd36c5283c126',
    bytes: 137192,
  },
  {
    model: 'suv',
    lod: 1,
    hash: '1a2a3f9805144a7183b20aeef3702d93065fa934831cdfa78937c331287e155f',
    bytes: 71324,
  },
  {
    model: 'suv',
    lod: 2,
    hash: '0678933975fadd122fa56e6c5e96b655cb7eb3944b3a187cd9cf9b9934d89f09',
    bytes: 18468,
  },
] as const;
export function trafficVehicleUrl(
  asset: (typeof TRAFFIC_VEHICLE_ASSETS)[number],
) {
  return `/models/blender/traffic-cars/traffic-${asset.model}.lod${asset.lod}.glb?v=${asset.hash.slice(0, 12)}`;
}

/** Only three materials per engine. Wheel vertices retain their source anchors;
 * GPU rotation avoids four extra wheel draws for every model and LOD. */
function vehicleMaterial(role: Role) {
  const material = new THREE.MeshStandardMaterial({
    color: role === 'rubber' ? new THREE.Color(0.023, 0.028, 0.031) : 0xffffff,
    metalness: role === 'paint' ? 0.38 : role === 'glass' ? 0.08 : 0.02,
    roughness: role === 'paint' ? 0.3 : role === 'glass' ? 0.32 : 0.79,
    vertexColors: true,
  });
  material.name = `Traffic shared ${role}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 trafficWheel;
attribute float trafficTravel;
vec3 rotateTrafficWheel(vec3 p) {
  float a = trafficTravel / trafficWheel.w;
  float c = cos(a), s = sin(a);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
if (trafficWheel.w > 0.0) {
  objectNormal = rotateTrafficWheel(objectNormal);
  #ifdef USE_TANGENT
    objectTangent = rotateTrafficWheel(objectTangent);
  #endif
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
if (trafficWheel.w > 0.0) {
  transformed = trafficWheel.xyz + rotateTrafficWheel(transformed - trafficWheel.xyz);
}`,
      );
  };
  material.customProgramCacheKey = () => 'traffic-source-wheel-v1';
  return material;
}

/** The consumer owns each load, including malformed and late-arriving payloads. */
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
  images.forEach((bitmap) => bitmap.close?.());
}

/** Flatten source transforms, retain COLOR_0 and independent wheel pivots, and
 * merge only equivalent semantic materials. No silhouette simplification. */
export function trafficRoleGeometry(scene: THREE.Object3D) {
  const pieces: Record<Role, THREE.BufferGeometry[]> = {
      paint: [],
      glass: [],
      rubber: [],
    },
    merged = {} as Record<Role, THREE.BufferGeometry>;
  scene.updateMatrixWorld(true);
  try {
    scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material;
      if (Array.isArray(material) || !roles.includes(material.name as Role))
        throw new Error('Traffic asset has an unknown material role');
      if (
        Object.values(material).some((value) => value instanceof THREE.Texture)
      )
        throw new Error('Traffic assets must remain texture-free');
      const role = material.name as Role,
        original = node.geometry,
        geometry = original.index ? original.toNonIndexed() : original.clone();
      pieces[role].push(geometry);
      geometry.applyMatrix4(node.matrixWorld);
      // These surfaces have no textures. Retain normals and linear RGBA colors
      // explicitly; normalize unused attributes before merging source primitives.
      for (const key of Object.keys(geometry.attributes))
        if (!['position', 'normal', 'color'].includes(key))
          geometry.deleteAttribute(key);
      const count = geometry.getAttribute('position').count,
        color = geometry.getAttribute('color'),
        rgba = new Float32Array(count * 4).fill(1);
      if (color)
        for (let i = 0; i < count; i++) {
          rgba[i * 4] = color.getX(i);
          rgba[i * 4 + 1] = color.getY(i);
          rgba[i * 4 + 2] = color.getZ(i);
          rgba[i * 4 + 3] = color.itemSize === 4 ? color.getW(i) : 1;
        }
      geometry.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      let wheel: THREE.Object3D | null = node;
      while (
        wheel &&
        wheel !== scene &&
        wheel.userData.semantic_role !== 'wheel-assembly'
      )
        wheel = wheel.parent;
      const anchors = new Float32Array(count * 4);
      if (wheel?.userData.semantic_role === 'wheel-assembly') {
        const center = new THREE.Vector3().setFromMatrixPosition(
            wheel.matrixWorld,
          ),
          radius = Number(wheel.userData.wheel_radius_m);
        if (!(radius > 0 && radius < 1))
          throw new Error('Invalid traffic wheel radius');
        for (let i = 0; i < count; i++) {
          anchors[i * 4] = center.x;
          anchors[i * 4 + 1] = center.y;
          anchors[i * 4 + 2] = center.z;
          anchors[i * 4 + 3] = radius;
        }
      }
      geometry.setAttribute(
        'trafficWheel',
        new THREE.BufferAttribute(anchors, 4),
      );
      geometry.clearGroups();
    });
    for (const role of roles) {
      if (!pieces[role].length)
        throw new Error(`Missing traffic ${role} geometry`);
      const geometry = mergeGeometries(pieces[role]);
      if (!geometry) throw new Error(`Could not batch traffic ${role}`);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      merged[role] = geometry;
    }
    return merged;
  } catch (error) {
    Object.values(merged).forEach((geometry) => geometry.dispose());
    throw error;
  } finally {
    Object.values(pieces)
      .flat()
      .forEach((geometry) => geometry.dispose());
  }
}

type Batch = {
  model: string;
  lod: number;
  meshes: THREE.InstancedMesh[];
  triangles: number;
};
type Loader = (url: string) => Promise<Pick<GLTF, 'scene'>>;
export class TrafficVehicleAssets {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  readonly stats = {
    status: 'loading',
    enabled: true,
    actors: 0,
    lodCounts: [0, 0, 0],
    triangles: 0,
    drawCalls: 0,
    textures: 0,
    assetBytes: TRAFFIC_VEHICLE_ASSETS.reduce(
      (sum, asset) => sum + asset.bytes,
      0,
    ),
  };
  private disposed = false;
  private batches: Batch[] = [];
  private materials = roles.map(vehicleMaterial);
  private readonly models: string[];
  private readonly lastLod: Uint8Array;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly roadRotation = new THREE.Matrix4();

  constructor(
    private readonly routes: readonly TrafficRoute[],
    parent: THREE.Object3D,
    load: Loader = (url) => new GLTFLoader().loadAsync(url),
  ) {
    this.models = routes.map((_, i) => (hash(i + 91) < 0.28 ? 'suv' : 'sedan'));
    this.lastLod = new Uint8Array(routes.length).fill(2);
    this.group.name = 'Shared Blender traffic vehicles';
    this.group.userData.trafficVehicleAssets = this.stats;
    this.group.visible = false;
    parent.add(this.group);
    this.ready = this.load(load);
  }

  /** Fixed-camera QA comparison only; production always uses accepted assets. */
  setEnabled(enabled: boolean) {
    if (process.env.VANCOUVER_VISUAL_QA !== '1' || this.disposed) return false;
    this.stats.enabled = enabled;
    if (!enabled) {
      this.group.visible = false;
      this.stats.actors = this.stats.triangles = this.stats.drawCalls = 0;
      this.stats.lodCounts.fill(0);
    }
    return true;
  }

  private async load(load: Loader) {
    const results = await Promise.allSettled(
      TRAFFIC_VEHICLE_ASSETS.map(async (asset) => {
        const gltf = await load(trafficVehicleUrl(asset));
        try {
          if (this.disposed) return null;
          return { asset, geometry: trafficRoleGeometry(gltf.scene) };
        } finally {
          disposeSource(gltf.scene);
        }
      }),
    );
    if (
      this.disposed ||
      results.some((result) => result.status === 'rejected')
    ) {
      for (const result of results)
        if (result.status === 'fulfilled' && result.value)
          Object.values(result.value.geometry).forEach((geometry) =>
            geometry.dispose(),
          );
      if (!this.disposed) this.stats.status = 'error';
      return;
    }
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { asset, geometry } = result.value,
        population = this.models.filter(
          (model) => model === asset.model,
        ).length,
        capacity = Math.min(
          population,
          asset.lod === 0 ? 64 : asset.lod === 1 ? 192 : population,
        ),
        batch: Batch = {
          model: asset.model,
          lod: asset.lod,
          meshes: [],
          triangles: 0,
        };
      roles.forEach((role, index) => {
        const mesh = new THREE.InstancedMesh(
          geometry[role],
          this.materials[index],
          capacity,
        );
        mesh.name = `Traffic ${asset.model} LOD${asset.lod} ${role}`;
        mesh.count = 0;
        mesh.visible = false;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        geometry[role].setAttribute(
          'trafficTravel',
          new THREE.InstancedBufferAttribute(
            new Float32Array(capacity),
            1,
          ).setUsage(THREE.DynamicDrawUsage),
        );
        batch.triangles += geometry[role].getAttribute('position').count / 3;
        batch.meshes.push(mesh);
        this.group.add(mesh);
      });
      this.batches.push(batch);
    }
    this.stats.status = 'ready';
  }

  /** Returns false until all six templates are usable, preserving the old fleet.
   * Actor population, route phase/speed and elapsed-time semantics are unchanged. */
  update(
    time: number,
    camera: THREE.Vector3,
    roadHeight: (x: number, z: number) => number,
  ) {
    if (this.disposed || !this.stats.enabled || this.stats.status !== 'ready')
      return false;
    for (const batch of this.batches)
      for (const mesh of batch.meshes) mesh.count = 0;
    this.stats.lodCounts.fill(0);
    this.stats.triangles = 0;
    this.stats.drawCalls = 0;
    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i],
        phase = (route.phase + (time * route.speed) / route.length) % 1,
        x = THREE.MathUtils.lerp(route.a[0], route.b[0], phase),
        z = THREE.MathUtils.lerp(route.a[1], route.b[1], phase),
        y = roadHeight(x, z),
        distance = Math.hypot(camera.x - x, camera.y - y, camera.z - z),
        previous = this.lastLod[i];
      // Hysteresis avoids flickering at boundaries. Overflow falls back one LOD,
      // preserving every route actor while bounding expensive near geometry.
      let lod =
        distance < (previous === 0 ? 75 : 65)
          ? 0
          : distance < (previous < 2 ? 240 : 220)
            ? 1
            : 2;
      if (lod === 0 && this.stats.lodCounts[0] >= 64) lod = 1;
      if (lod === 1 && this.stats.lodCounts[1] >= 192) lod = 2;
      this.lastLod[i] = lod;
      const model = this.models[i],
        batch = this.batches.find(
          (item) => item.model === model && item.lod === lod,
        )!,
        slot = batch.meshes[0].count,
        yaw = Math.atan2(route.b[0] - route.a[0], route.b[1] - route.a[1]);
      let rootY = y;
      this.dummy.rotation.set(0, yaw, 0);
      if (lod < 2) {
        const halfAxle = model === 'suv' ? 1.39 : 1.35,
          halfTrack = model === 'suv' ? 0.81 : 0.785,
          dx = Math.sin(yaw),
          dz = Math.cos(yaw),
          front = roadHeight(x + dx * halfAxle, z + dz * halfAxle),
          rear = roadHeight(x - dx * halfAxle, z - dz * halfAxle),
          right = roadHeight(x + dz * halfTrack, z - dx * halfTrack),
          left = roadHeight(x - dz * halfTrack, z + dx * halfTrack),
          grade = (front - rear) / (2 * halfAxle),
          crossSlope = (right - left) / (2 * halfTrack);
        this.forward.set(dx, grade, dz).normalize();
        this.up
          .set(-dx * grade - dz * crossSlope, 1, -dz * grade + dx * crossSlope)
          .normalize();
        this.right.crossVectors(this.up, this.forward).normalize();
        this.roadRotation.makeBasis(this.right, this.up, this.forward);
        this.dummy.quaternion.setFromRotationMatrix(this.roadRotation);
        rootY = (front + rear) / 2;
      }
      this.dummy.position.set(x, rootY, z);
      this.dummy.updateMatrix();
      this.color.setHex(palette[Math.floor(hash(i) * palette.length)]);
      batch.meshes.forEach((mesh, roleIndex) => {
        mesh.setMatrixAt(slot, this.dummy.matrix);
        if (roleIndex === 0) mesh.setColorAt(slot, this.color);
        // Modulo limits long-running float precision loss; every wheel of a
        // template has the same radius and uses its own original center.
        const radius = model === 'suv' ? 0.35 : 0.32;
        mesh.geometry
          .getAttribute('trafficTravel')
          .setX(slot, (time * route.speed) % (Math.PI * 2 * radius));
        mesh.count++;
      });
      this.stats.lodCounts[lod]++;
      this.stats.triangles += batch.triangles;
    }
    for (const batch of this.batches)
      for (const mesh of batch.meshes) {
        mesh.visible = mesh.count > 0;
        if (!mesh.count) continue;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        (
          mesh.geometry.getAttribute(
            'trafficTravel',
          ) as THREE.InstancedBufferAttribute
        ).needsUpdate = true;
        this.stats.drawCalls++;
      }
    this.stats.actors = this.routes.length;
    this.group.visible = true;
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stats.status = 'disposed';
    this.group.removeFromParent();
    for (const batch of this.batches)
      for (const mesh of batch.meshes) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
    this.materials.forEach((material) => material.dispose());
    this.batches = [];
    this.group.clear();
  }
}

import * as THREE from 'three';

interface Floor {
  id: string;
  height: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
interface Obstacle {
  min: THREE.Vector3;
  max: THREE.Vector3;
}
export interface BusCabinFloor {
  surfaceId: string;
  heightM: number;
  standingAllowed: boolean;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid bus cabin support metadata');
  return value as Record<string, unknown>;
};
const point = (value: unknown): [number, number, number] => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new Error('Invalid bus cabin support point');
  return value as [number, number, number];
};

/** Fixed-anchor visits have no free walking. This support contract nevertheless
 * checks the rendered slab triangles, including both steps and door extensions;
 * metadata bounds alone cannot turn an empty gap into a floor. */
export class BusCabinSurfaces {
  private floors: Floor[] = [];
  private floorMeshes: THREE.Mesh[] = [];
  private obstacles: Obstacle[] = [];
  private ceiling: number;
  private ray = new THREE.Raycaster();
  constructor(
    private root: THREE.Object3D,
    vehicle: Record<string, unknown>,
  ) {
    if (!Array.isArray(vehicle.floorSurfaces))
      throw new Error('Missing bus cabin floors');
    for (const value of vehicle.floorSurfaces) {
      const surface = record(value);
      if (
        surface.frameId !== 'vehicle' ||
        !Array.isArray(surface.verticesM) ||
        surface.verticesM.length !== 4
      )
        throw new Error('Unsupported bus cabin floor frame');
      const vertices = surface.verticesM.map(point),
        height = vertices[0][1];
      if (vertices.some((p) => Math.abs(p[1] - height) > 1e-5))
        throw new Error('Bus cabin floor is not horizontal');
      this.floors.push({
        id: String(surface.surfaceId),
        height,
        minX: Math.min(...vertices.map((p) => p[0])),
        maxX: Math.max(...vertices.map((p) => p[0])),
        minZ: Math.min(...vertices.map((p) => p[2])),
        maxZ: Math.max(...vertices.map((p) => p[2])),
      });
    }
    const expected = [
      'low-floor',
      'rear-step-1',
      'rear-step-2',
      'raised-rear',
      'front-door-threshold-extension',
      'rear-door-threshold-extension',
    ];
    if (
      this.floors.length !== expected.length ||
      expected.some((id) => !this.floors.some((f) => f.id === id))
    )
      throw new Error('Incomplete bus cabin support inventory');
    this.ceiling = Number(record(vehicle.ceiling).undersideHeightM);
    if (!Number.isFinite(this.ceiling))
      throw new Error('Missing bus cabin ceiling');
    const collision = record(vehicle.collision);
    if (!Array.isArray(collision.primitives))
      throw new Error('Missing bus cabin collision');
    for (const value of collision.primitives) {
      const obstacle = record(value);
      if (obstacle.role !== 'obstacle' && obstacle.role !== 'shell') continue;
      if (obstacle.frameId !== 'vehicle' || obstacle.type !== 'box')
        throw new Error('Unsupported bus cabin obstacle');
      const bounds = record(obstacle.boundsM);
      this.obstacles.push({
        min: new THREE.Vector3(...point(bounds.min)),
        max: new THREE.Vector3(...point(bounds.max)),
      });
    }
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material;
      if (Array.isArray(material))
        throw new Error('Expected bus cabin primitive mesh');
      // The distinct yellow marking material shares a semantic floor role, but
      // only the authored slab surface supplies support.
      if (material.userData.shared_surface_id === 'bus-v2-floor')
        this.floorMeshes.push(object);
    });
    if (!this.floorMeshes.length)
      throw new Error('Missing actual bus cabin floor mesh');
  }

  private support(floor: Floor, x: number, z: number): number | null {
    this.root.updateWorldMatrix(true, true);
    const from = this.root.localToWorld(
        new THREE.Vector3(x, floor.height + 0.08, z),
      ),
      to = this.root.localToWorld(new THREE.Vector3(x, floor.height - 0.08, z));
    this.ray.set(from, to.clone().sub(from).normalize());
    this.ray.near = 0;
    this.ray.far = from.distanceTo(to);
    const inverse = this.root.matrixWorld.clone().invert();
    for (const hit of this.ray.intersectObjects(this.floorMeshes, false)) {
      const local = hit.point.clone().applyMatrix4(inverse),
        matrix = new THREE.Matrix3().getNormalMatrix(
          inverse.clone().multiply(hit.object.matrixWorld),
        ),
        normal = hit.face?.normal.clone().applyNormalMatrix(matrix);
      if (
        normal &&
        normal.y > 0.999 &&
        Math.abs(local.y - floor.height) <= 0.003
      )
        return local.y;
    }
    return null;
  }

  floorAt(x: number, z: number): BusCabinFloor | null {
    if (![x, z].every(Number.isFinite)) return null;
    const candidates = this.floors
      .filter(
        (f) =>
          x >= f.minX - 1e-6 &&
          x <= f.maxX + 1e-6 &&
          z >= f.minZ - 1e-6 &&
          z <= f.maxZ + 1e-6,
      )
      .sort((a, b) => b.height - a.height);
    for (const floor of candidates) {
      const height = this.support(floor, x, z);
      if (height !== null)
        return {
          surfaceId: floor.id,
          heightM: height,
          standingAllowed:
            this.ceiling - height >= 1.95 && !floor.id.startsWith('rear-step'),
        };
    }
    return null;
  }

  canStand(x: number, z: number, heightM = 1.95, radiusM = 0.25) {
    if (
      ![heightM, radiusM].every(Number.isFinite) ||
      heightM <= 0 ||
      radiusM <= 0
    )
      return false;
    const floor = this.floorAt(x, z);
    if (
      !floor ||
      !floor.standingAllowed ||
      this.ceiling - floor.heightM < heightM
    )
      return false;
    // The floor footprint is checked against actual triangles. Collision boxes
    // are conservative authored obstacles and never used as support surfaces.
    for (const [dx, dz] of [
      [-radiusM, 0],
      [radiusM, 0],
      [0, -radiusM],
      [0, radiusM],
    ]) {
      const edge = this.floorAt(x + dx, z + dz);
      if (!edge || Math.abs(edge.heightM - floor.heightM) > 0.003) return false;
    }
    return !this.obstacles.some(({ min, max }) => {
      if (max.y <= floor.heightM + 0.02 || min.y >= floor.heightM + heightM)
        return false;
      const dx = Math.max(min.x - x, 0, x - max.x),
        dz = Math.max(min.z - z, 0, z - max.z);
      return dx * dx + dz * dz < radiusM * radiusM;
    });
  }

  validate() {
    for (const floor of this.floors)
      for (const u of [0.02, 0.5, 0.98])
        for (const v of [0.02, 0.5, 0.98])
          if (
            this.support(
              floor,
              THREE.MathUtils.lerp(floor.minX, floor.maxX, u),
              THREE.MathUtils.lerp(floor.minZ, floor.maxZ, v),
            ) === null
          )
            throw new Error(
              `Actual bus cabin floor does not support ${floor.id}`,
            );
  }
}

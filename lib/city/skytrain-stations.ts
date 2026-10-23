/** Lazy, geographically anchored station interiors. Original authored layout is
 * retained in local street metres; the current terrain resolves world height.
 * Floors belong only to a station walker and never grant vehicle permissions. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { project } from './geo';
import {
  SKYTRAIN_STREET_ENTRANCES,
  makeStationStreetAccess,
  type StationStreetAccess,
  type StreetEntrance,
  type StationTerrainOpening,
} from './skytrain-street-access';
import {
  SKYTRAIN_STATIONS,
  type StationId,
  type LineId,
  type SkyTrainDirection,
} from './skytrain-network';

export type StationVector = [number, number, number];
export type StationQuaternion = [number, number, number, number];
export type StationLevel = 'entry' | 'platform';
export interface StationPoint {
  position: StationVector;
  surfaceId: string;
  layer: number;
  /** Local heading; +Z is zero. Add the station world's yaw for camera facing. */
  yaw: number;
}
export interface StationSeat {
  id: string;
  position: StationVector;
  seatHeight: number;
  yaw: number;
  stand: StationPoint;
}
export interface StationBoardingDoor {
  carIndex: number;
  /** Runtime door position in that carriage's actual rendered local frame. */
  carDoor: StationVector;
  /** Unmodified station-packet vector, retained for adapter provenance. */
  sourceCarDoor: StationVector;
  /** Station-local source sill, with the rendered-door longitudinal adapter. */
  threshold: StationVector;
  /** Supported station-local foot point, facing this door's platform edge. */
  waiting: StationPoint;
}
export interface StationFloor {
  id: string;
  level: string;
  kind: string;
  vertices: StationVector[];
  indices: number[];
}
export interface StationConnection {
  id: string;
  from: string;
  to: string;
  type: 'walk' | 'stairs' | 'elevator';
  start: StationVector;
  end: StationVector;
  width: number;
  treads: { id: string; vertices: StationVector[]; indices: number[] }[];
}
interface StationDoor {
  id: string;
  carIndex: number;
  side: 'left' | 'right';
  carOffset: StationVector;
  carQuaternion: StationQuaternion;
  carDoor: StationVector;
  sill: StationVector;
  edge: StationVector;
  waiting: StationVector;
  width: number;
}
export interface StationPlatform {
  id: string;
  line: LineId;
  direction: SkyTrainDirection;
  surfaceId: string;
  length: number;
  width: number;
  floorHeight: number;
  railHeight: number;
  position: StationVector;
  quaternion: StationQuaternion;
  motionSign: number;
  doors: StationDoor[];
}
export interface StationPart {
  id: string;
  position: StationVector;
  size: StationVector;
  yaw: number;
  material: string;
  role: string;
}
interface StationObstacle {
  id: string;
  position: StationVector;
  size: StationVector;
  yaw: number;
}
export interface RuntimeStationData {
  schema: 1;
  id: StationId;
  name: string;
  topology: string;
  source: {
    package: string;
    layout: string;
    sha256: string;
    map: string;
    geometry: string;
    accuracy: string;
  };
  lonlat: [number, number];
  quaternion: StationQuaternion;
  verticalDatum: string;
  floors: StationFloor[];
  entrances: {
    id: string;
    label: string;
    point: StationVector;
    surfaceId: string;
  }[];
  platforms: StationPlatform[];
  connections: StationConnection[];
  exclusions: {
    id: string;
    polygon: StationVector[];
    minY: number;
    maxY: number;
  }[];
  obstacles: StationObstacle[];
  parts: StationPart[];
}
export interface StationTrainStop {
  position: StationVector;
  quaternion: StationQuaternion;
  platformId: string;
  floorHeight: number;
  railHeight: number;
  doorSide: 'left' | 'right';
  motionSign: number;
  carOffset: StationVector;
  door: StationDoor;
}
export interface SkyTrainStationOptions {
  heightAt: (x: number, z: number) => number;
  /** Actual rendered walking support, including an existing public lobby. */
  streetHeightAt?: (x: number, z: number) => number;
  scene?: THREE.Scene;
  fetchStation?: (id: StationId, signal: AbortSignal) => Promise<unknown>;
}
const ids = new Set(SKYTRAIN_STATIONS.map((s) => s.id));
const finiteVector = (value: unknown, n = 3): value is StationVector =>
  Array.isArray(value) &&
  value.length === n &&
  value.every(
    (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 100_000,
  );
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid station metadata');
  return value as Record<string, unknown>;
};
function fail(): never {
  throw new Error('Invalid runtime station geometry');
}
export function validateRuntimeStation(
  value: unknown,
  expectedId?: StationId,
): RuntimeStationData {
  const d = record(value),
    source = record(d.source);
  if (
    d.schema !== 1 ||
    !ids.has(d.id as StationId) ||
    (expectedId && d.id !== expectedId) ||
    typeof d.name !== 'string' ||
    typeof d.topology !== 'string' ||
    !finiteVector(d.lonlat, 2) ||
    !finiteVector(d.quaternion, 4) ||
    Math.abs(Math.hypot(...d.quaternion) - 1) > 0.0001 ||
    source.package !== 'skytrain-stations-stage2' ||
    !/^[a-f0-9]{64}$/.test(String(source.sha256))
  )
    fail();
  const floors = d.floors;
  if (!Array.isArray(floors) || !floors.length || floors.length > 200) fail();
  const floorIds = new Set<string>();
  const checkTriangle = (value: unknown) => {
    const f = record(value),
      vertices = f.vertices,
      indices = f.indices;
    if (
      !Array.isArray(vertices) ||
      vertices.length < 3 ||
      vertices.length > 100 ||
      !vertices.every((v) => finiteVector(v)) ||
      !Array.isArray(indices) ||
      !indices.length ||
      indices.length > 300 ||
      indices.length % 3 !== 0 ||
      !indices.every(
        (i) => Number.isInteger(i) && i >= 0 && i < vertices.length,
      )
    )
      fail();
  };
  for (const raw of floors) {
    const f = record(raw);
    checkTriangle(f);
    if (
      typeof f.id !== 'string' ||
      !f.id ||
      floorIds.has(f.id) ||
      typeof f.level !== 'string' ||
      typeof f.kind !== 'string'
    )
      fail();
    floorIds.add(f.id);
  }
  if (
    !Array.isArray(d.platforms) ||
    !d.platforms.length ||
    d.platforms.length > 4
  )
    fail();
  const platformIds = new Set<string>();
  for (const raw of d.platforms) {
    const p = record(raw);
    if (
      typeof p.id !== 'string' ||
      platformIds.has(p.id) ||
      !floorIds.has(String(p.surfaceId)) ||
      !['expo', 'canada'].includes(String(p.line)) ||
      !['eastbound', 'westbound', 'northbound', 'southbound'].includes(
        String(p.direction),
      ) ||
      !finiteVector(p.position) ||
      !finiteVector(p.quaternion, 4) ||
      ![p.floorHeight, p.railHeight, p.length, p.width].every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      ) ||
      Number(p.width) < 2 ||
      Number(p.length) < 20 ||
      !Array.isArray(p.doors) ||
      !p.doors.length ||
      p.doors.length > 20
    )
      fail();
    platformIds.add(p.id);
    for (const rawDoor of p.doors) {
      const door = record(rawDoor);
      if (
        typeof door.id !== 'string' ||
        !Number.isInteger(door.carIndex) ||
        Number(door.carIndex) < 0 ||
        Number(door.carIndex) > 4 ||
        !['left', 'right'].includes(String(door.side)) ||
        !['carOffset', 'carDoor', 'sill', 'edge', 'waiting'].every((k) =>
          finiteVector(door[k]),
        ) ||
        !finiteVector(door.carQuaternion, 4) ||
        typeof door.width !== 'number' ||
        door.width < 0.6 ||
        door.width > 3
      )
        fail();
    }
  }
  if (
    !Array.isArray(d.entrances) ||
    !d.entrances.length ||
    d.entrances.length > 5
  )
    fail();
  for (const raw of d.entrances) {
    const e = record(raw);
    if (
      typeof e.id !== 'string' ||
      typeof e.label !== 'string' ||
      !finiteVector(e.point) ||
      !floorIds.has(String(e.surfaceId))
    )
      fail();
  }
  if (!Array.isArray(d.connections) || d.connections.length > 100) fail();
  for (const raw of d.connections) {
    const c = record(raw);
    if (
      typeof c.id !== 'string' ||
      !floorIds.has(String(c.from)) ||
      !floorIds.has(String(c.to)) ||
      !['walk', 'stairs', 'elevator'].includes(String(c.type)) ||
      !finiteVector(c.start) ||
      !finiteVector(c.end) ||
      typeof c.width !== 'number' ||
      c.width <= 0 ||
      !Array.isArray(c.treads) ||
      c.treads.length > 150
    )
      fail();
    for (const t of c.treads) checkTriangle(t);
  }
  if (
    !Array.isArray(d.parts) ||
    !d.parts.length ||
    d.parts.length > 1000 ||
    !Array.isArray(d.obstacles) ||
    d.obstacles.length > 100 ||
    !Array.isArray(d.exclusions) ||
    d.exclusions.length > 10
  )
    fail();
  for (const raw of [...d.parts, ...d.obstacles]) {
    const p = record(raw);
    if (
      typeof p.id !== 'string' ||
      !finiteVector(p.position) ||
      !finiteVector(p.size) ||
      p.size.some((v) => v <= 0) ||
      typeof p.yaw !== 'number' ||
      !Number.isFinite(p.yaw)
    )
      fail();
  }
  for (const raw of d.parts) {
    const p = record(raw);
    if (typeof p.material !== 'string' || typeof p.role !== 'string') fail();
  }
  for (const raw of d.exclusions) {
    const v = record(raw);
    if (
      !Array.isArray(v.polygon) ||
      v.polygon.length < 3 ||
      v.polygon.length > 12 ||
      !v.polygon.every((p) => finiteVector(p)) ||
      typeof v.minY !== 'number' ||
      typeof v.maxY !== 'number' ||
      !Number.isFinite(v.minY) ||
      !Number.isFinite(v.maxY) ||
      v.minY >= v.maxY
    )
      fail();
  }
  return value as RuntimeStationData;
}
function inside(point: StationVector, polygon: StationVector[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[2] > point[2] !== b[2] > point[2] &&
      point[0] < ((b[0] - a[0]) * (point[2] - a[2])) / (b[2] - a[2]) + a[0]
    )
      result = !result;
  }
  return result;
}
function triangleHeight(
  x: number,
  z: number,
  floor: StationFloor,
): number | null {
  for (let i = 0; i < floor.indices.length; i += 3) {
    const a = floor.vertices[floor.indices[i]],
      b = floor.vertices[floor.indices[i + 1]],
      c = floor.vertices[floor.indices[i + 2]];
    const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(den) < 1e-9) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
    // Authored decimal stair exports can separate consecutive tread edges by
    // one micrometre. This triangle-local tolerance closes only that seam.
    if (u >= -1e-5 && v >= -1e-5 && u + v <= 1 + 1e-5)
      return u * a[1] + v * b[1] + (1 - u - v) * c[1];
  }
  return null;
}
const copyPoint = (p: StationPoint): StationPoint => ({
  ...p,
  position: [...p.position],
});
function runtimeAccessSize(
  station: StationId,
  id: string,
  size: StationVector,
): StationVector {
  // Two display-export canopy supports span the complete public transfer
  // corridor. The integrated portal uses square columns at the same anchors;
  // original source dimensions and the other supports remain untouched.
  return station === 'waterfront' &&
    [
      'waterfront-expo-entry-post-3.4',
      'waterfront-canada-entry-post3.4',
    ].includes(id)
    ? [size[0], size[1], size[0]]
    : size;
}
const palette: Record<string, number> = {
  steel: 0x6a7780,
  yellow: 0xf2cd54,
  wood: 0x806447,
  brick: 0xa95d42,
  concrete: 0xb9b8b1,
  floor: 0xc4c3ba,
  wall: 0xd1d7d4,
  glass: 0x89b4c4,
  light: 0xf8f1cd,
  line: 0x005daa,
  tile: 0x939d9d,
  gate: 0x87989e,
  escalator: 0x354047,
};

/** Pure local stop metadata can be read while another interior is active. */
export function trainStopFor(
  data: RuntimeStationData,
  line: LineId,
  direction?: SkyTrainDirection,
): StationTrainStop {
  const p = data.platforms.find(
    (p) => p.line === line && (!direction || p.direction === direction),
  );
  if (!p) throw new Error('Unavailable station platform');
  const d = [...p.doors].sort(
    (a, b) =>
      a.carIndex - b.carIndex ||
      Math.abs(a.carDoor[2]) - Math.abs(b.carDoor[2]),
  )[0];
  return {
    position: [...p.position],
    quaternion: [...p.quaternion],
    platformId: p.id,
    floorHeight: p.floorHeight,
    railHeight: p.railHeight,
    doorSide: d.side,
    motionSign: p.motionSign,
    carOffset: [...d.carOffset],
    door: structuredClone(d),
  };
}
export function stationWorldPose(
  data: RuntimeStationData,
  heightAt: (x: number, z: number) => number,
  position: readonly number[] = [0, 0, 0],
  quaternion: readonly number[] = [0, 0, 0, 1],
): { position: StationVector; quaternion: StationQuaternion } {
  if (!finiteVector(position) || !finiteVector(quaternion, 4))
    throw new Error('Invalid station local pose');
  const [x, z] = project(data.lonlat),
    y = heightAt(x, z);
  if (!Number.isFinite(y))
    throw new Error('Station street terrain unavailable');
  const q = new THREE.Quaternion().fromArray(data.quaternion),
    p = new THREE.Vector3(position[0], position[1], position[2])
      .applyQuaternion(q)
      .add(new THREE.Vector3(x, y, z));
  return {
    position: p.toArray(),
    quaternion: q
      .multiply(new THREE.Quaternion().fromArray(quaternion))
      .toArray(),
  };
}

/** An owner exposes only foot origins on exact station-owned pedestrian floors.
 * Direction changes select the actual platform level and side independently. */
export class SkyTrainStationOwner {
  readonly group = new THREE.Group();
  readonly data: RuntimeStationData;
  readonly geometryData: RuntimeStationData;
  private readonly streetAccess: StationStreetAccess | null;
  readonly baseY: number;
  readonly origin: StationVector;
  readonly yaw: number;
  readonly floors: readonly StationFloor[];
  private readonly floorMap = new Map<string, StationFloor>();
  private readonly adjacency = new Map<string, Set<string>>();
  private readonly layerMap = new Map<string, number>();
  private readonly collisionObstacles: StationObstacle[];
  private readonly resources = new Set<
    THREE.BufferGeometry | THREE.Material | THREE.Texture
  >();
  private readonly bridge = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xb8c5cb }),
  );
  private readonly boardingMarker = new THREE.Group();
  private disposed = false;
  private benchSeatCache: readonly StationSeat[] | null = null;
  private readonly boardingDoorCache = new Map<
    string,
    readonly StationBoardingDoor[]
  >();
  constructor(
    data: RuntimeStationData,
    heightAt: (x: number, z: number) => number,
    quality: 'balanced' | 'high' | 'ultra' = 'balanced',
    readonly openWorld = false,
    streetHeightAt: (x: number, z: number) => number = heightAt,
  ) {
    this.data = validateRuntimeStation(data);
    this.streetAccess = openWorld
      ? makeStationStreetAccess(data, heightAt, streetHeightAt)
      : null;
    this.geometryData = this.streetAccess?.geometry ?? this.data;
    data = this.geometryData;
    this.collisionObstacles = data.obstacles.map((o) => ({
      ...o,
      size: runtimeAccessSize(data.id, o.id, o.size),
    }));
    const [x, z] = project(data.lonlat),
      y = heightAt(x, z);
    if (!Number.isFinite(y))
      throw new Error('Station street terrain unavailable');
    this.baseY = y;
    this.origin = [x, y, z];
    this.group.name = `skytrain-station-${data.id}`;
    this.group.position.set(x, y, z);
    this.group.quaternion.fromArray(data.quaternion);
    this.yaw = new THREE.Euler().setFromQuaternion(
      this.group.quaternion,
      'YXZ',
    ).y;
    const floors: StationFloor[] = data.floors.map((f) => ({
      ...f,
      vertices: f.vertices.map((p) => [...p]),
    }));
    const connect = (a: string, b: string) => {
      if (!this.adjacency.has(a)) this.adjacency.set(a, new Set());
      if (!this.adjacency.has(b)) this.adjacency.set(b, new Set());
      this.adjacency.get(a)!.add(b);
      this.adjacency.get(b)!.add(a);
    };
    for (const c of data.connections) {
      // The integrated Main Street station uses its clear east access route.
      // The authored west display branch remains in immutable source metadata,
      // but has no public walker links into the neighbouring city podium.
      if (
        !openWorld &&
        data.id === 'main-street-science-world' &&
        [c.from, c.to].some(
          (id) => id !== 'main-expo' && !id.startsWith('main-east'),
        )
      )
        continue;
      if (c.type === 'elevator') continue;
      let previous = c.from;
      for (const [i, t] of c.treads.entries()) {
        const id = `${c.id}:step:${i}`;
        floors.push({
          id,
          level: `${c.id}:stair`,
          kind: 'stair',
          vertices: t.vertices,
          indices: t.indices,
        });
        connect(previous, id);
        previous = id;
      }
      connect(previous, c.to);
    }
    floors.forEach((f, i) => {
      this.floorMap.set(f.id, f);
      this.layerMap.set(f.id, i + 1);
    });
    this.floors = floors;
    this.build(quality);
    this.bridge.visible = false;
    this.bridge.name = 'conditional-passenger-threshold';
    this.resources.add(this.bridge.geometry);
    this.resources.add(this.bridge.material);
    this.group.add(this.bridge);
    this.buildBoardingMarker();
    this.group.updateMatrixWorld(true);
  }
  toWorld(point: readonly number[] | StationPoint): StationVector {
    const p = Array.isArray(point) ? point : (point as StationPoint).position;
    return new THREE.Vector3(p[0], p[1], p[2])
      .applyQuaternion(this.group.quaternion)
      .add(this.group.position)
      .toArray();
  }
  toLocal(point: readonly number[]): StationVector {
    return new THREE.Vector3(point[0], point[1], point[2])
      .sub(this.group.position)
      .applyQuaternion(this.group.quaternion.clone().invert())
      .toArray();
  }
  /** Source-supported street thresholds; all returned coordinates are world metres. */
  streetEntrances(): readonly StreetEntrance[] {
    return this.streetAccess?.entrances ?? [];
  }
  terrainOpenings(): readonly StationTerrainOpening[] {
    return this.streetAccess?.openings ?? [];
  }
  /** Deterministic local QA route through the actual floor/tread graph. */
  streetRoutes() {
    return this.streetAccess?.routes ?? [];
  }
  tryEnterFromStreet(
    worldPosition: StationVector,
    maxSnap = 0.22,
  ): StationPoint | null {
    if (!this.streetAccess || !finiteVector(worldPosition) || this.disposed)
      return null;
    const local = this.toLocal(worldPosition);
    for (const e of this.streetAccess.entrances) {
      const threshold = this.toLocal(e.threshold),
        d = e.localDirection,
        dx = local[0] - threshold[0],
        dz = local[2] - threshold[2],
        along = dx * d[0] + dz * d[2],
        across = dx * d[2] - dz * d[0];
      if (along < -2.3 || along > 1.8 || Math.abs(across) > 1.45) continue;
      const foot = this.floorAt(local, e.surfaceId);
      if (
        foot &&
        Math.abs(foot.position[1] - local[1]) <= maxSnap &&
        this.supported(foot)
      )
        return foot;
    }
    return null;
  }
  streetExit(point: StationPoint): StationVector | null {
    if (!this.streetAccess || !this.isClearFoot(point)) return null;
    for (const e of this.streetAccess.entrances) {
      if (!this.floorAt(point.position, e.surfaceId)) continue;
      const threshold = this.toLocal(e.threshold),
        d = e.localDirection,
        along =
          (point.position[0] - threshold[0]) * d[0] +
          (point.position[2] - threshold[2]) * d[2];
      if (along <= -2.45) return this.toWorld(point);
    }
    return null;
  }
  worldWalk(from: StationPoint, dx: number, dz: number): StationPoint {
    const direction = new THREE.Vector3(dx, 0, dz).applyQuaternion(
      this.group.quaternion.clone().invert(),
    );
    return this.walk(from, direction.x, direction.z);
  }
  platform(line: LineId, direction?: SkyTrainDirection): StationPlatform {
    const p = this.geometryData.platforms.find(
      (p) => p.line === line && (!direction || p.direction === direction),
    );
    if (!p) throw new Error('Unavailable station platform');
    return p;
  }
  private chosenDoor(platform: StationPlatform) {
    return [...platform.doors].sort(
      (a, b) =>
        a.carIndex - b.carIndex ||
        Math.abs(a.carDoor[2]) - Math.abs(b.carDoor[2]),
    )[0];
  }
  passengerDoor(line: LineId, direction?: SkyTrainDirection): StationVector {
    return [...this.chosenDoor(this.platform(line, direction)).carDoor];
  }
  private point(
    position: StationVector,
    surfaceId: string,
    yaw = 0,
  ): StationPoint {
    const f = this.floorMap.get(surfaceId),
      y = f && triangleHeight(position[0], position[2], f);
    if (y === null || y === undefined)
      throw new Error('Station point is outside its floor');
    return {
      position: [position[0], y, position[2]],
      surfaceId,
      layer: this.layerMap.get(surfaceId)!,
      yaw,
    };
  }
  entry(line: LineId, direction?: SkyTrainDirection): StationPoint {
    const p = this.platform(line, direction);
    const reachable = new Set([p.surfaceId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of this.geometryData.connections) {
        if (reachable.has(c.from) && !reachable.has(c.to)) {
          reachable.add(c.to);
          changed = true;
        }
        if (reachable.has(c.to) && !reachable.has(c.from)) {
          reachable.add(c.from);
          changed = true;
        }
      }
    }
    const e =
      (!this.openWorld && this.geometryData.id === 'main-street-science-world'
        ? this.geometryData.entrances.find(
            (e) => e.id === 'main-east' && reachable.has(e.surfaceId),
          )
        : undefined) ??
      this.geometryData.entrances.find(
        (e) =>
          reachable.has(e.surfaceId) &&
          (line === 'expo' ? !e.id.includes('canada') : !e.id.includes('expo')),
      ) ??
      this.geometryData.entrances.find((e) => reachable.has(e.surfaceId));
    if (!e) throw new Error('Station entrance has no level connection');
    return this.safePoint(this.point(e.point, e.surfaceId));
  }
  spawn(
    level: StationLevel,
    line: LineId,
    direction?: SkyTrainDirection,
  ): StationPoint {
    if (level === 'entry') return this.entry(line, direction);
    return this.boardingPoint(line, direction);
  }
  accessPoint(
    level: StationLevel,
    line: LineId,
    direction?: SkyTrainDirection,
  ): StationPoint {
    if (level === 'entry') return this.entry(line, direction);
    const p = this.platform(line, direction),
      connections = this.geometryData.connections.filter(
        (c) => c.from === p.surfaceId || c.to === p.surfaceId,
      ),
      connection =
        (!this.openWorld && this.geometryData.id === 'main-street-science-world'
          ? connections.find((c) => c.id === 'main-expo--main-east-top-walk')
          : undefined) ?? connections[0];
    const f = this.floorMap.get(p.surfaceId)!;
    const raw = connection
      ? connection.from === p.surfaceId
        ? connection.start
        : connection.end
      : f.vertices[0];
    const center = f.vertices.reduce(
      (a, b) =>
        [
          a[0] + b[0] / f.vertices.length,
          a[1] + b[1] / f.vertices.length,
          a[2] + b[2] / f.vertices.length,
        ] as StationVector,
      [0, 0, 0] as StationVector,
    );
    const d = Math.hypot(center[0] - raw[0], center[2] - raw[2]) || 1;
    return this.safePoint(
      this.point(
        [
          raw[0] + ((center[0] - raw[0]) / d) * 0.8,
          raw[1],
          raw[2] + ((center[2] - raw[2]) / d) * 0.8,
        ],
        p.surfaceId,
        Math.atan2(raw[0] - center[0], raw[2] - center[2]),
      ),
    );
  }
  boardingPoint(line: LineId, direction?: SkyTrainDirection): StationPoint {
    const p = this.platform(line, direction),
      d = this.chosenDoor(p);
    return this.safePoint(
      this.point(
        d.waiting,
        p.surfaceId,
        Math.atan2(d.edge[0] - d.waiting[0], d.edge[2] - d.waiting[2]),
      ),
    );
  }
  /** All authored carriage doors retain their own nearby platform foot point.
   * Expo outer doors adapt the packet's +/-5.5 m to the retained cabin's
   * +/-4.9 m openings; source vectors and legacy default APIs are unchanged.
   * Match carIndex and carDoor to reuse the same exit when alighting. */
  boardingDoors(
    line: LineId,
    direction?: SkyTrainDirection,
  ): readonly StationBoardingDoor[] {
    if (this.disposed) return [];
    const platform = this.platform(line, direction);
    let doors = this.boardingDoorCache.get(platform.id);
    if (!doors) {
      doors = platform.doors.map((door) => {
        const carDoor: StationVector = [...door.carDoor];
        if (
          line === 'expo' &&
          Math.abs(Math.abs(carDoor[2]) - 5.5) < 0.0001
        )
          carDoor[2] = Math.sign(carDoor[2]) * 4.9;
        const shift = new THREE.Vector3(0, 0, carDoor[2] - door.carDoor[2])
          .applyQuaternion(new THREE.Quaternion(...door.carQuaternion))
          .applyQuaternion(new THREE.Quaternion(...platform.quaternion));
        const waiting = this.safePoint(
          this.point(
            new THREE.Vector3(...door.waiting).add(shift).toArray(),
            platform.surfaceId,
          ),
        );
        waiting.yaw = Math.atan2(
          door.edge[0] + shift.x - waiting.position[0],
          door.edge[2] + shift.z - waiting.position[2],
        );
        return {
          carIndex: door.carIndex,
          carDoor,
          sourceCarDoor: [...door.carDoor],
          threshold: new THREE.Vector3(...door.sill).add(shift).toArray(),
          waiting,
        };
      });
      this.boardingDoorCache.set(platform.id, doors);
    }
    // Static support is resolved once per platform; callers receive isolated
    // values so repeated nearby-door queries never mutate the cached inventory.
    return doors.map((door) => ({
      carIndex: door.carIndex,
      carDoor: [...door.carDoor],
      sourceCarDoor: [...door.sourceCarDoor],
      threshold: [...door.threshold],
      waiting: copyPoint(door.waiting),
    }));
  }
  trainStop(line: LineId, direction?: SkyTrainDirection): StationTrainStop {
    return trainStopFor(this.geometryData, line, direction);
  }
  /** Seats originate only from the station's rendered bench parts. Each front
   * has a verified clear floor point; tracks, stacked levels and prop-only
   * geometry can never become a stand location. */
  benchSeats(): readonly StationSeat[] {
    if (this.disposed) return [];
    if (this.benchSeatCache) return this.benchSeatCache;
    const result: StationSeat[] = [];
    for (const part of this.geometryData.parts) {
      if (
        !/bench/i.test(part.id) ||
        part.role !== 'static' ||
        part.size[1] > 0.35
      )
        continue;
      const alongX = part.size[0] > part.size[2];
      const length = alongX ? part.size[0] : part.size[2];
      const slots = Math.max(1, Math.floor(length / 0.6));
      const angle = (part.yaw * Math.PI) / 180;
      const rotate = (x: number, z: number): [number, number] => [
        x * Math.cos(angle) + z * Math.sin(angle),
        -x * Math.sin(angle) + z * Math.cos(angle),
      ];
      for (let slot = 0; slot < slots; slot++) {
        const along = (slot - (slots - 1) / 2) * 0.58;
        const [sx, sz] = rotate(alongX ? along : 0, alongX ? 0 : along);
        const floor = this.floorAt([
          part.position[0] + sx,
          part.position[1] - 0.46,
          part.position[2] + sz,
        ]);
        if (!floor) continue;
        const seatHeight =
          part.position[1] + part.size[1] / 2 - floor.position[1];
        if (seatHeight < 0.3 || seatHeight > 0.7) continue;
        for (const side of [-1, 1]) {
          const [fx, fz] = rotate(alongX ? 0 : side, alongX ? side : 0);
          const offset = (alongX ? part.size[2] : part.size[0]) / 2 + 0.45;
          const stand = this.floorAt(
            [
              floor.position[0] + fx * offset,
              floor.position[1],
              floor.position[2] + fz * offset,
            ],
            floor.surfaceId,
          );
          if (!stand || !this.supported(stand)) continue;
          const yaw = Math.atan2(fx, fz);
          stand.yaw = yaw;
          result.push({
            id: `${part.id}:${slot}:${side}`,
            position: [...floor.position],
            seatHeight,
            yaw,
            stand,
          });
        }
      }
    }
    this.benchSeatCache = result;
    return result;
  }
  canApproachSeat(seat: StationSeat, from: StationPoint) {
    if (
      seat.stand.surfaceId !== from.surfaceId ||
      seat.stand.layer !== from.layer ||
      new THREE.Vector3(...seat.stand.position).distanceTo(
        new THREE.Vector3(...from.position),
      ) >= 1.1
    )
      return false;
    const end = this.walk(
      from,
      seat.stand.position[0] - from.position[0],
      seat.stand.position[2] - from.position[2],
    );
    return (
      end.surfaceId === seat.stand.surfaceId &&
      new THREE.Vector3(...end.position).distanceTo(
        new THREE.Vector3(...seat.stand.position),
      ) < 0.08
    );
  }
  isClearFoot(point: StationPoint) {
    const floor = this.floorAt(point.position, point.surfaceId);
    return Boolean(
      floor && floor.layer === point.layer && this.supported(floor),
    );
  }
  floorAt(position: StationVector, surfaceId?: string): StationPoint | null {
    if (!finiteVector(position) || this.disposed) return null;
    const candidates = surfaceId
      ? [this.floorMap.get(surfaceId)].filter((f): f is StationFloor =>
          Boolean(f),
        )
      : this.floors;
    let best: StationPoint | null = null,
      delta = Infinity;
    for (const f of candidates) {
      const y = triangleHeight(position[0], position[2], f);
      if (y === null || Math.abs(y - position[1]) > 0.28) continue;
      const difference = Math.abs(y - position[1]);
      if (difference < delta) {
        best = {
          position: [position[0], y, position[2]],
          surfaceId: f.id,
          layer: this.layerMap.get(f.id)!,
          yaw: 0,
        };
        delta = difference;
      }
    }
    return best;
  }
  private blocked(p: StationVector, radius = 0.24) {
    for (const e of this.geometryData.exclusions)
      if (p[1] + 1.65 > e.minY && p[1] < e.maxY && inside(p, e.polygon))
        return true;
    for (const o of this.collisionObstacles) {
      if (
        p[1] + 1.7 <= o.position[1] - o.size[1] / 2 ||
        p[1] >= o.position[1] + o.size[1] / 2
      )
        continue;
      const yaw = (o.yaw * Math.PI) / 180,
        dx = p[0] - o.position[0],
        dz = p[2] - o.position[2],
        x = dx * Math.cos(yaw) - dz * Math.sin(yaw),
        z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (
        Math.abs(x) < o.size[0] / 2 + radius &&
        Math.abs(z) < o.size[2] / 2 + radius
      )
        return true;
    }
    return false;
  }
  private walkingCandidates(
    surfaceId: string,
    position: StationVector,
  ): string[] {
    const result = new Set([
      surfaceId,
      ...(this.adjacency.get(surfaceId) ?? []),
    ]);
    if (this.openWorld) {
      // Coplanar polygons that physically overlap are the same pedestrian
      // plane even when authored as separate corridor/turn primitives.
      for (const floor of this.floors) {
        if (floor.kind === 'stair') continue;
        const height = triangleHeight(position[0], position[2], floor);
        if (height !== null && Math.abs(height - position[1]) < 0.02)
          result.add(floor.id);
      }
      // Overlapping concourse/apron polygons are one continuous walking plane.
      // Follow only explicit flat links; stair tread chains remain incremental.
      for (const id of result) {
        const floor = this.floorMap.get(id);
        if (!floor || floor.kind === 'stair') continue;
        const near = [
          [0, 0],
          [0.3, 0],
          [-0.3, 0],
          [0, 0.3],
          [0, -0.3],
        ].some(([dx, dz]) => {
          const height = triangleHeight(
            position[0] + dx,
            position[2] + dz,
            floor,
          );
          return height !== null && Math.abs(height - position[1]) <= 0.28;
        });
        if (!near) continue;
        for (const next of this.adjacency.get(id) ?? []) result.add(next);
      }
    }
    return [...result];
  }
  private supported(point: StationPoint, radius = 0.24) {
    if (this.blocked(point.position, radius)) return false;
    const allowed = new Set(
      this.walkingCandidates(point.surfaceId, point.position),
    );
    for (const [dx, dz] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ]) {
      const v: [number, number, number] = [
        point.position[0] + dx,
        point.position[1],
        point.position[2] + dz,
      ];
      if (
        ![...allowed].some((id) => {
          const f = this.floorMap.get(id),
            y = f && triangleHeight(v[0], v[2], f);
          return y !== null && y !== undefined && Math.abs(y - v[1]) <= 0.28;
        })
      )
        return false;
    }
    return true;
  }
  private safePoint(point: StationPoint): StationPoint {
    if (this.supported(point)) return point;
    const f = this.floorMap.get(point.surfaceId)!;
    for (let r = 0.25; r <= 2.5; r += 0.25)
      for (let i = 0; i < 16; i++) {
        const x = point.position[0] + Math.cos((i * Math.PI) / 8) * r,
          z = point.position[2] + Math.sin((i * Math.PI) / 8) * r,
          y = triangleHeight(x, z, f);
        if (y === null) continue;
        const p = this.point([x, y, z], point.surfaceId, point.yaw);
        if (this.supported(p)) return p;
      }
    throw new Error('No clear station foot origin');
  }
  /** Swept small pedestrian steps prevent crossing a platform edge, track, wall,
   * a stacked level or a bench even if a single input frame is oversized. */
  walk(from: StationPoint, dx: number, dz: number): StationPoint {
    const initial = this.floorAt(from.position, from.surfaceId);
    if (
      !initial ||
      initial.layer !== from.layer ||
      ![dx, dz].every(Number.isFinite) ||
      Math.hypot(dx, dz) > 8 ||
      this.disposed
    )
      return copyPoint(from);
    let result = copyPoint(from);
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
    const attempt = (x: number, z: number) => {
      const allowed = this.walkingCandidates(result.surfaceId, [
        x,
        result.position[1],
        z,
      ]);
      const candidates = allowed
        .map((id) => ({ id, y: triangleHeight(x, z, this.floorMap.get(id)!) }))
        .filter(
          (candidate): candidate is { id: string; y: number } =>
            candidate.y !== null &&
            Math.abs(candidate.y - result.position[1]) <= 0.28,
        );
      if (this.openWorld)
        candidates.sort((a, b) => {
          const delta =
            Math.abs(a.y - result.position[1]) -
            Math.abs(b.y - result.position[1]);
          if (Math.abs(delta) > 1e-6) return delta;
          // A supported point inside the actual platform polygon belongs to
          // that platform even where its access passage is coplanar. Only its
          // identity changes; position and heading are retained exactly.
          return (
            Number(this.floorMap.get(b.id)?.kind === 'platform') -
            Number(this.floorMap.get(a.id)?.kind === 'platform')
          );
        });
      for (const { id, y } of candidates) {
        const next = this.point([x, y, z], id, from.yaw);
        if (this.supported(next)) {
          result = next;
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < steps; i++) {
      const sx = dx / steps,
        sz = dz / steps;
      if (!attempt(result.position[0] + sx, result.position[2] + sz)) {
        if (Math.abs(sx) > 1e-9)
          attempt(result.position[0] + sx, result.position[2]);
        if (Math.abs(sz) > 1e-9)
          attempt(result.position[0], result.position[2] + sz);
      }
    }
    return result;
  }
  setBoardingOpen(line: LineId, direction: SkyTrainDirection, open: boolean) {
    this.bridge.visible = false;
    this.boardingMarker.visible = false;
    if (!open || this.disposed) return;
    const d = this.chosenDoor(this.platform(line, direction));
    const delta = new THREE.Vector3(...d.sill).sub(
      new THREE.Vector3(...d.edge),
    );
    const length = Math.max(0.04, Math.hypot(delta.x, delta.z));
    this.bridge.scale.set(length + 0.08, 0.02, Math.min(1.3, d.width));
    this.bridge.position.set(
      (d.edge[0] + d.sill[0]) / 2,
      d.edge[1] + 0.012,
      (d.edge[2] + d.sill[2]) / 2,
    );
    this.bridge.rotation.y = -Math.atan2(delta.z, delta.x);
    this.bridge.visible = true;
    const waiting = this.boardingPoint(line, direction);
    this.boardingMarker.position.fromArray(waiting.position);
    this.boardingMarker.rotation.y = waiting.yaw;
    this.boardingMarker.userData.platformId = this.platform(line, direction).id;
    this.boardingMarker.userData.surfaceId = waiting.surfaceId;
    this.boardingMarker.visible = true;
  }
  private buildBoardingMarker() {
    this.boardingMarker.name = 'selected-platform-boarding-marker';
    this.boardingMarker.visible = false;
    // One unlit mesh is visible from either approach; it never creates a
    // walking surface or collision volume and stays on the safe waiting floor.
    const ring = new THREE.RingGeometry(0.38, 0.5, 32)
      .rotateX(-Math.PI / 2)
      .translate(0, 0.018, 0);
    const shape = new THREE.Shape();
    shape.moveTo(-0.3, 1.2);
    shape.lineTo(-0.2, 1.27);
    shape.lineTo(0, 0.99);
    shape.lineTo(0.2, 1.27);
    shape.lineTo(0.3, 1.2);
    shape.lineTo(0, 0.78);
    shape.closePath();
    const chevron = new THREE.ShapeGeometry(shape),
      geometry = mergeGeometries([ring, chevron])!,
      material = new THREE.MeshBasicMaterial({
        color: 0x39bdff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
      }),
      mesh = new THREE.Mesh(geometry, material);
    ring.dispose();
    chevron.dispose();
    mesh.name = 'boarding-ring-and-down-chevron';
    this.resources.add(geometry);
    this.resources.add(material);
    this.boardingMarker.add(mesh);
    this.sign(
      'SkyTrain',
      [0, 1.55, 0],
      0,
      1.5,
      0.28,
      '#086cad',
      this.boardingMarker,
      true,
    );
    this.group.add(this.boardingMarker);
  }
  private sign(
    text: string,
    position: StationVector,
    yaw = 0,
    width = 5,
    height = 0.62,
    color = '#073c62',
    parent: THREE.Object3D = this.group,
    billboard = false,
  ) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    if (!c) return;
    c.fillStyle = color;
    c.fillRect(0, 0, 1024, 128);
    c.fillStyle = '#fff';
    c.font = 'bold 57px system-ui,sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 512, 67, 990);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.resources.add(texture);
    if (billboard) {
      const material = new THREE.SpriteMaterial({
          map: texture,
          depthWrite: false,
        }),
        sprite = new THREE.Sprite(material);
      sprite.name = `station-sign-${text}`;
      sprite.position.fromArray(position);
      sprite.scale.set(width, height, 1);
      parent.add(sprite);
      this.resources.add(material);
      return;
    }
    const front = new THREE.PlaneGeometry(width, height),
      back = front.clone().rotateY(Math.PI),
      geometry = mergeGeometries([front, back])!;
    front.dispose();
    back.dispose();
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.FrontSide,
      }),
      mesh = new THREE.Mesh(geometry, material);
    mesh.name = `station-sign-${text}`;
    mesh.position.fromArray(position);
    mesh.rotation.y = yaw;
    parent.add(mesh);
    this.resources.add(material);
    this.resources.add(geometry);
  }
  private build(quality: 'balanced' | 'high' | 'ultra') {
    const parts: StationPart[] = this.geometryData.parts
      .filter(
        (p) =>
          p.role !== 'threshold' &&
          !(
            p.role === 'removable-roof' &&
            ['burrard', 'granville'].includes(this.geometryData.id)
          ),
      )
      .map((p) => ({
        ...p,
        size: runtimeAccessSize(this.geometryData.id, p.id, p.size),
        material:
          this.geometryData.id === 'granville' && p.role === 'stair-tread'
            ? 'escalator'
            : p.material,
      }));
    const add = (
      id: string,
      position: StationVector,
      size: StationVector,
      material: string,
      yaw = 0,
      role = 'detail',
    ) => parts.push({ id, position, size, material, yaw, role });
    if (
      !this.openWorld &&
      this.geometryData.id === 'main-street-science-world'
    ) {
      const floor = this.geometryData.floors.find((f) => f.id === 'main-expo')!,
        bounds = new THREE.Box3().setFromPoints(
          floor.vertices.map((p) => new THREE.Vector3(...p)),
        ),
        center = bounds.getCenter(new THREE.Vector3()),
        width = bounds.max.x - bounds.min.x - 0.2,
        z = bounds.min.z + 0.6,
        y = floor.vertices[0][1];
      add(
        'main-east-route-guide-panel',
        [center.x, y + 0.5, z],
        [width, 0.75, 0.08],
        'gate',
      );
      add(
        'main-east-route-guide-handrail',
        [center.x, y + 1.05, z],
        [width, 0.09, 0.12],
        'steel',
      );
      for (const x of [
        center.x - width / 2 + 0.1,
        center.x,
        center.x + width / 2 - 0.1,
      ])
        add(
          `main-east-route-guide-post-${x}`,
          [x, y + 0.55, z],
          [0.12, 1.1, 0.14],
          'steel',
        );
      this.collisionObstacles.push({
        id: 'main-east-public-route-guide',
        position: [center.x, y + 0.55, z],
        size: [width, 1.1, 0.14],
        yaw: 0,
      });
      this.sign(
        'EAST ENTRANCE · other end of platform',
        [center.x, y + 1.55, z],
        0,
        Math.min(6.5, width),
        0.4,
      );
    }
    if (this.openWorld) {
      const geometries = this.geometryData.floors
        .filter((f) => f.kind !== 'platform')
        .map((f) => {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(f.vertices.flat(), 3),
          );
          geometry.setIndex(f.indices);
          geometry.computeVertexNormals();
          return geometry;
        });
      if (geometries.length) {
        const geometry = mergeGeometries(geometries),
          material = new THREE.MeshStandardMaterial({
            color: palette.floor,
            side: THREE.DoubleSide,
            roughness: 0.85,
          });
        geometries.forEach((g) => g.dispose());
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'geographic-entrance-and-concourse-support';
        this.resources.add(geometry);
        this.resources.add(material);
        this.group.add(mesh);
      }
    }
    const sloped = new Map<string, THREE.Matrix4[]>();
    const beam = (
      material: string,
      a: THREE.Vector3,
      b: THREE.Vector3,
      width: number,
      height: number,
    ) => {
      const delta = b.clone().sub(a),
        length = delta.length();
      if (length < 0.01) return;
      const rotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          -Math.atan2(delta.y, Math.hypot(delta.x, delta.z)),
          Math.atan2(delta.x, delta.z),
          0,
          'YXZ',
        ),
      );
      const matrices = sloped.get(material) ?? [];
      matrices.push(
        new THREE.Matrix4().compose(
          a.clone().add(b).multiplyScalar(0.5),
          rotation,
          new THREE.Vector3(width, height, length),
        ),
      );
      sloped.set(material, matrices);
    };
    // Underground circulation needs opaque structure beyond its exact walking
    // triangles; without it an access stair looks out into the city/ocean.
    // These are representative shells around the source-backed access layout.
    // Every authored pedestrian opening and train portal is subtracted first.
    if (this.geometryData.id !== 'main-street-science-world') {
      const boundsFor = (vertices: StationVector[]) =>
        new THREE.Box3().setFromPoints(
          vertices.map((p) => new THREE.Vector3(...p)),
        );
      const walkBounds = [
        ...this.geometryData.floors.map((f) => boundsFor(f.vertices)),
        ...this.geometryData.connections
          .filter((c) => c.type === 'stairs' && c.treads.length)
          .map((c) => boundsFor(c.treads.flatMap((t) => t.vertices))),
      ];
      const stationBounds = new THREE.Box3().setFromPoints(
        this.floors.flatMap((f) =>
          f.vertices.map((v) => new THREE.Vector3(...v)),
        ),
      );
      const portalRun =
        Math.max(
          Math.abs(stationBounds.min.x),
          Math.abs(stationBounds.max.x),
          Math.abs(stationBounds.min.z),
          Math.abs(stationBounds.max.z),
        ) + 30;
      const clearance = walkBounds.map((box) => {
        box.min.x -= 0.04;
        box.min.z -= 0.04;
        box.max.x += 0.04;
        box.max.z += 0.04;
        box.min.y -= 0.025;
        box.max.y += 2.4;
        return box;
      });
      for (const p of this.geometryData.platforms) {
        const q = new THREE.Quaternion(...p.quaternion),
          vertices: THREE.Vector3[] = [];
        for (const x of [-1.6, 1.6])
          for (const z of [-portalRun, portalRun])
            for (const y of [p.floorHeight - 0.2, p.floorHeight + 3])
              vertices.push(
                new THREE.Vector3(x, y - p.position[1], z)
                  .applyQuaternion(q)
                  .add(new THREE.Vector3(...p.position)),
              );
        clearance.push(new THREE.Box3().setFromPoints(vertices));
      }
      const subtract = (box: THREE.Box3, cut: THREE.Box3) => {
        const intersection = box.clone().intersect(cut);
        if (
          intersection.isEmpty() ||
          intersection
            .getSize(new THREE.Vector3())
            .toArray()
            .some((s) => s < 1e-5)
        )
          return [box];
        const result: THREE.Box3[] = [],
          rest = box.clone();
        for (const axis of ['x', 'y', 'z'] as const) {
          if (intersection.min[axis] > rest.min[axis] + 1e-5) {
            const piece = rest.clone();
            piece.max[axis] = intersection.min[axis];
            result.push(piece);
          }
          rest.min[axis] = Math.max(rest.min[axis], intersection.min[axis]);
          if (intersection.max[axis] < rest.max[axis] - 1e-5) {
            const piece = rest.clone();
            piece.min[axis] = intersection.max[axis];
            result.push(piece);
          }
          rest.max[axis] = Math.min(rest.max[axis], intersection.max[axis]);
        }
        return result;
      };
      let enclosureBoxes: { id: string; box: THREE.Box3 }[] = [];
      const shell = (
        id: string,
        center: THREE.Vector3,
        size: THREE.Vector3,
      ) => {
        const half = size.clone().multiplyScalar(0.5);
        let boxes = [
          new THREE.Box3(center.clone().sub(half), center.clone().add(half)),
        ];
        for (const cut of clearance)
          boxes = boxes.flatMap((box) => subtract(box, cut));
        for (const [i, box] of boxes.entries()) {
          const span = box.getSize(new THREE.Vector3());
          if (span.toArray().some((s) => s < 0.015)) continue;
          enclosureBoxes.push({ id: `underground-${id}-${i}`, box });
        }
      };
      for (const f of this.geometryData.floors) {
        if (f.kind === 'platform' || f.vertices[0][1] >= -0.1) continue;
        const box = boundsFor(f.vertices),
          c = box.getCenter(new THREE.Vector3()),
          s = box.getSize(new THREE.Vector3()),
          y = c.y;
        shell(
          `${f.id}-floor`,
          new THREE.Vector3(c.x, y - 0.18, c.z),
          new THREE.Vector3(s.x + 0.2, 0.24, s.z + 0.2),
        );
        shell(
          `${f.id}-ceiling`,
          new THREE.Vector3(c.x, y + 3.15, c.z),
          new THREE.Vector3(s.x + 0.4, 0.18, s.z + 0.4),
        );
        for (const sign of [-1, 1]) {
          shell(
            `${f.id}-side-x-${sign}`,
            new THREE.Vector3(c.x + sign * (s.x / 2 + 0.1), y + 1.5, c.z),
            new THREE.Vector3(0.2, 3.2, s.z + 0.4),
          );
          shell(
            `${f.id}-side-z-${sign}`,
            new THREE.Vector3(c.x, y + 1.5, c.z + sign * (s.z / 2 + 0.1)),
            new THREE.Vector3(s.x + 0.4, 3.2, 0.2),
          );
        }
      }
      if (this.geometryData.id !== 'stadium-chinatown') {
        const c = stationBounds.getCenter(new THREE.Vector3()),
          s = stationBounds.getSize(new THREE.Vector3()),
          min = stationBounds.min.y - 1.2,
          max = 0.15;
        // Opaque structural backing below street level catches views between
        // adjacent access shells. Explicit entry/stair holes and rail portals
        // are preserved by the same clearance subtraction as the inner walls.
        shell(
          'street-backing',
          new THREE.Vector3(c.x, -0.18, c.z),
          new THREE.Vector3(s.x + 18, 0.2, s.z + 18),
        );
        for (const sign of [-1, 1]) {
          shell(
            `outer-backing-x-${sign}`,
            new THREE.Vector3(c.x + sign * (s.x / 2 + 9), (min + max) / 2, c.z),
            new THREE.Vector3(0.25, max - min, s.z + 18),
          );
          shell(
            `outer-backing-z-${sign}`,
            new THREE.Vector3(c.x, (min + max) / 2, c.z + sign * (s.z / 2 + 9)),
            new THREE.Vector3(s.x + 18, max - min, 0.25),
          );
        }
      }
      if (this.geometryData.id !== 'stadium-chinatown') {
        const platforms = this.geometryData.floors.filter(
          (f) => f.kind === 'platform',
        );
        for (const f of platforms) {
          const box = boundsFor(f.vertices),
            c = box.getCenter(new THREE.Vector3()),
            s = box.getSize(new THREE.Vector3()),
            alongX = s.x > s.z;
          for (const sign of [-1, 1])
            shell(
              `${f.id}-end-bulkhead-${sign}`,
              new THREE.Vector3(
                c.x + (alongX ? sign * (s.x / 2 + 0.3) : 0),
                c.y + 1.9,
                c.z + (alongX ? 0 : sign * (s.z / 2 + 0.3)),
              ),
              alongX
                ? new THREE.Vector3(0.2, 4, s.z + 12)
                : new THREE.Vector3(s.x + 12, 4, 0.2),
            );
        }
        // Short opaque track-side buffers hide the outside world beyond the
        // platform bulkheads; their rail portals remain physically unobstructed.
        for (const p of this.geometryData.platforms) {
          const q = new THREE.Quaternion(...p.quaternion),
            alongX = Math.abs(q.y) > 0.5,
            point = (x: number, y: number, z: number) =>
              new THREE.Vector3(x, y - p.position[1], z)
                .applyQuaternion(q)
                .add(new THREE.Vector3(...p.position));
          for (const sign of [-1, 1]) {
            const z = sign * (p.length / 2 + 12.5);
            for (const side of [-1, 1])
              shell(
                `${p.id}-rail-buffer-${sign}-${side}`,
                point(side * 1.95, p.floorHeight + 1.6, z),
                alongX
                  ? new THREE.Vector3(25, 3.6, 0.2)
                  : new THREE.Vector3(0.2, 3.6, 25),
              );
            for (const [name, y] of [
              ['roof', p.floorHeight + 3.5],
              ['base', p.floorHeight - 0.45],
            ] as const)
              shell(
                `${p.id}-rail-buffer-${sign}-${name}`,
                point(0, y, z),
                alongX
                  ? new THREE.Vector3(25, 0.2, 4.1)
                  : new THREE.Vector3(4.1, 0.2, 25),
              );
          }
        }
      }
      for (const flight of this.geometryData.connections.filter(
        (c) => c.type === 'stairs' && Math.min(c.start[1], c.end[1]) < -0.1,
      )) {
        const a = new THREE.Vector3(...flight.start),
          b = new THREE.Vector3(...flight.end),
          run = b.clone().sub(a);
        run.y = 0;
        const length = run.length();
        if (length < 0.1) continue;
        const lateral = new THREE.Vector3(run.z, 0, -run.x).normalize(),
          halfWidth =
            this.geometryData.id === 'granville'
              ? 2.2
              : flight.width / 2 + 0.22,
          center = a.clone().add(b).multiplyScalar(0.5),
          low = Math.min(a.y, b.y),
          high = Math.max(a.y, b.y);
        for (const sign of [-1, 1]) {
          const c = center
            .clone()
            .addScaledVector(lateral, sign * (halfWidth + 0.1));
          c.y = (low + high + 3.0) / 2;
          shell(
            `${flight.id}-shaft-${sign}`,
            c,
            Math.abs(run.z) > Math.abs(run.x)
              ? new THREE.Vector3(0.2, high - low + 3.4, length + 0.4)
              : new THREE.Vector3(length + 0.4, high - low + 3.4, 0.2),
          );
        }
        beam(
          'wall',
          a.clone().add(new THREE.Vector3(0, 3.15, 0)),
          b.clone().add(new THREE.Vector3(0, 3.15, 0)),
          flight.width + 0.16,
          0.16,
        );
        beam(
          'wall',
          a.clone().add(new THREE.Vector3(0, -0.22, 0)),
          b.clone().add(new THREE.Vector3(0, -0.22, 0)),
          flight.width + 0.16,
          0.16,
        );
      }
      // Adjacent shells share large coplanar areas. Merge only boxes with the
      // exact same other two extents, preserving every portal cut and hole.
      for (let pass = 0; pass < 3; pass++)
        for (const axis of ['x', 'y', 'z'] as const) {
          const others = (['x', 'y', 'z'] as const).filter((a) => a !== axis),
            grouped = new Map<string, typeof enclosureBoxes>();
          for (const item of enclosureBoxes) {
            const key = others
              .flatMap((a) => [item.box.min[a], item.box.max[a]])
              .map((v) => v.toFixed(5))
              .join(',');
            const group = grouped.get(key) ?? [];
            group.push(item);
            grouped.set(key, group);
          }
          enclosureBoxes = [];
          for (const group of grouped.values()) {
            group.sort((a, b) => a.box.min[axis] - b.box.min[axis]);
            let current = group[0];
            for (const next of group.slice(1)) {
              if (next.box.min[axis] <= current.box.max[axis] + 1e-5)
                current.box.max[axis] = Math.max(
                  current.box.max[axis],
                  next.box.max[axis],
                );
              else {
                enclosureBoxes.push(current);
                current = next;
              }
            }
            enclosureBoxes.push(current);
          }
        }
      for (const { id, box } of enclosureBoxes)
        add(
          id,
          box.getCenter(new THREE.Vector3()).toArray(),
          box.getSize(new THREE.Vector3()).toArray(),
          'wall',
        );
    }
    // Original geometry only: the black handrails, glazed balustrades and white
    // ribbed passage recall the official Granville escalator photographs. The
    // broad arrangement is representative, not a measured reproduction.
    for (const flight of this.geometryData.connections.filter(
      (c) => c.type === 'stairs',
    )) {
      const a = new THREE.Vector3(...flight.start),
        b = new THREE.Vector3(...flight.end),
        horizontal = b.clone().sub(a);
      horizontal.y = 0;
      const run = horizontal.length();
      if (run < 0.1) continue;
      const lateral = new THREE.Vector3(
        horizontal.z,
        0,
        -horizontal.x,
      ).normalize();
      const banks =
        this.geometryData.id === 'granville' ? [-1.35, 0, 1.35] : [0];
      for (const bank of banks) {
        if (bank !== 0)
          beam(
            'escalator',
            a
              .clone()
              .addScaledVector(lateral, bank)
              .add(new THREE.Vector3(0, 0.018, 0)),
            b
              .clone()
              .addScaledVector(lateral, bank)
              .add(new THREE.Vector3(0, 0.018, 0)),
            1.02,
            0.035,
          );
        for (const side of [-1, 1]) {
          const offset = bank + side * 0.58;
          beam(
            'escalator',
            a
              .clone()
              .addScaledVector(lateral, offset)
              .add(new THREE.Vector3(0, 0.94, 0)),
            b
              .clone()
              .addScaledVector(lateral, offset)
              .add(new THREE.Vector3(0, 0.94, 0)),
            0.075,
            0.085,
          );
          beam(
            'glass',
            a
              .clone()
              .addScaledVector(lateral, offset)
              .add(new THREE.Vector3(0, 0.48, 0)),
            b
              .clone()
              .addScaledVector(lateral, offset)
              .add(new THREE.Vector3(0, 0.48, 0)),
            0.035,
            0.82,
          );
          const center = a
            .clone()
            .add(b)
            .multiplyScalar(0.5)
            .addScaledVector(lateral, offset)
            .add(new THREE.Vector3(0, 0.5, 0));
          this.collisionObstacles.push({
            id: `${flight.id}-handrail-${bank}-${side}`,
            position: center.toArray(),
            size: [0.075, Math.abs(b.y - a.y) + 1.05, run],
            yaw: (Math.atan2(horizontal.x, horizontal.z) * 180) / Math.PI,
          });
        }
      }
      if (['granville', 'burrard'].includes(this.geometryData.id)) {
        const halfWidth = this.geometryData.id === 'granville' ? 2.12 : 1.5;
        for (let k = 0; k <= Math.ceil(run / 2); k++) {
          const p = a
            .clone()
            .lerp(b, k / Math.ceil(run / 2))
            .add(new THREE.Vector3(0, 2.86, 0));
          beam(
            'steel',
            p.clone().addScaledVector(lateral, -halfWidth),
            p.clone().addScaledVector(lateral, halfWidth),
            0.055,
            0.06,
          );
        }
        beam(
          'light',
          a.clone().add(new THREE.Vector3(0, 2.82, 0)),
          b.clone().add(new THREE.Vector3(0, 2.82, 0)),
          0.1,
          0.045,
        );
      }
    }
    const platformFloors = [
      ...new Set(this.geometryData.platforms.map((p) => p.surfaceId)),
    ].map((id) => this.floorMap.get(id)!);
    for (const [index, f] of platformFloors.entries()) {
      const bounds = new THREE.Box3().setFromPoints(
          f.vertices.map((v) => new THREE.Vector3(...v)),
        ),
        center = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3());
      const alongX = size.x > size.z,
        length = Math.max(size.x, size.z),
        width = Math.min(size.x, size.z),
        y = f.vertices[0][1];
      const line = this.geometryData.platforms.find(
          (p) => p.surfaceId === f.id,
        )!.line,
        heading = alongX ? Math.PI / 2 : 0;
      const label = line === 'expo' ? 'EXPO LINE' : 'CANADA LINE';
      this.sign(
        this.geometryData.name.toUpperCase(),
        [center.x, y + 2.35, center.z],
        heading,
        Math.min(width + 0.8, 6),
        0.6,
        line === 'expo' ? '#004b7d' : '#007d9f',
      );
      this.sign(
        `${label}   •   EXIT / SORTIE ↑`,
        [center.x, y + 2.7, center.z - (alongX ? 0 : length / 2 - 4)],
        heading,
        5,
        0.42,
      );
      for (
        let offset = -length / 2 + 3;
        offset < length / 2;
        offset += quality === 'balanced' ? 10 : 7
      ) {
        const x = center.x + (alongX ? offset : 0),
          z = center.z + (alongX ? 0 : offset);
        add(
          `light-${index}-${offset}`,
          [x, y + 3.25, z],
          alongX ? [3.6, 0.06, 0.22] : [0.22, 0.06, 3.6],
          'light',
        );
      }
      const tileStep = quality === 'balanced' ? 2 : 1.5;
      for (
        let offset = -length / 2 + tileStep;
        offset < length / 2;
        offset += tileStep
      )
        add(
          `tile-${index}-${offset}`,
          [
            center.x + (alongX ? offset : 0),
            y + 0.006,
            center.z + (alongX ? 0 : offset),
          ],
          alongX ? [0.012, 0.008, width] : [width, 0.008, 0.012],
          'tile',
        );
      if (
        !['main-street-science-world', 'stadium-chinatown'].includes(
          this.geometryData.id,
        )
      ) {
        const undergroundWall =
          this.geometryData.id === 'burrard' ||
          this.geometryData.id === 'granville';
        if (undergroundWall) {
          // Broad Dunsmuir tunnel character; no surveyed arch section is claimed.
          const vertices: number[] = [],
            indices: number[] = [],
            radiusX = (width + 11) / 2,
            radiusY = 4.5;
          for (let end = 0; end < 2; end++)
            for (let i = 0; i <= 24; i++) {
              const a = (i * Math.PI) / 24;
              vertices.push(
                center.x + 1.5 + Math.cos(a) * radiusX,
                y + 0.15 + Math.sin(a) * radiusY,
                center.z + (end ? 0.5 : -0.5) * (length + 2),
              );
            }
          for (let i = 0; i < 24; i++)
            indices.push(i, i + 1, i + 26, i, i + 26, i + 25);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(vertices, 3),
          );
          geometry.setIndex(indices);
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({
              color: this.geometryData.id === 'granville' ? 0xb4b7b5 : 0xc4bda9,
              roughness: 0.95,
              side: THREE.DoubleSide,
              emissive: 0x2b3030,
              emissiveIntensity: 0.65,
            }),
            arch = new THREE.Mesh(geometry, material);
          arch.name = `representative-dunsmuir-vault-${index}`;
          this.group.add(arch);
          this.resources.add(geometry);
          this.resources.add(material);
        } else {
          add(
            `platform-enclosure-${index}-left`,
            [
              center.x - (alongX ? 0 : width / 2 + 4),
              y + 1.6,
              center.z - (alongX ? width / 2 + 4 : 0),
            ],
            alongX ? [length + 3, 3.2, 0.25] : [0.25, 3.2, length + 3],
            this.geometryData.id === 'waterfront' ? 'brick' : 'wall',
          );
          add(
            `platform-enclosure-${index}-right`,
            [
              center.x + (alongX ? 0 : width / 2 + 4),
              y + 1.6,
              center.z + (alongX ? width / 2 + 4 : 0),
            ],
            alongX ? [length + 3, 3.2, 0.25] : [0.25, 3.2, length + 3],
            'wall',
          );
        }
      } else {
        for (let offset = -length / 2 + 4; offset < length / 2; offset += 6)
          add(
            `glass-canopy-${index}-${offset}`,
            [
              center.x + (alongX ? offset : 0),
              y + 3.5,
              center.z + (alongX ? 0 : offset),
            ],
            alongX ? [5.8, 0.08, width + 3] : [width + 3, 0.08, 5.8],
            'glass',
          );
      }
    }
    for (const e of this.geometryData.entrances) {
      if (this.openWorld) {
        const direction = this.streetAccess?.entrances.find(
          (entry) => entry.id === e.id,
        )?.localDirection ?? [0, 0, 1];
        this.sign(
          `${this.geometryData.name} / SkyTrain`,
          [e.point[0], e.point[1] + 2.55, e.point[2]],
          Math.atan2(-direction[0], -direction[2]),
          5,
          0.6,
        );
        continue;
      }
      const f = this.floorMap.get(e.surfaceId)!;
      const b = new THREE.Box3().setFromPoints(
          f.vertices.map((p) => new THREE.Vector3(...p)),
        ),
        s = b.getSize(new THREE.Vector3()),
        c = b.getCenter(new THREE.Vector3());
      const brick =
        this.geometryData.id === 'yaletown-roundhouse' ||
        this.geometryData.id === 'waterfront';
      add(
        `${e.id}-entry-roof`,
        [c.x, c.y + 3.5, c.z],
        [Math.max(4, s.x + 0.7), 0.18, Math.max(4, s.z + 0.7)],
        brick ? 'wood' : 'glass',
      );
      for (const sign of [-1, 1]) {
        const position: StationVector = [
          c.x + sign * Math.min(1.1, s.x / 2 - 0.3),
          c.y + 0.57,
          c.z,
        ];
        add(`${e.id}-reader-${sign}`, position, [0.3, 1.14, 1.2], 'gate');
        this.collisionObstacles.push({
          id: `${e.id}-reader-${sign}`,
          position,
          size: [0.3, 1.14, 1.2],
          yaw: 0,
        });
      }
      this.sign(
        `${this.geometryData.name}   /   SkyTrain`,
        [c.x, c.y + 2.55, c.z + 1.3],
        0,
        Math.min(6, s.x + 0.4),
        0.6,
      );
      this.sign(
        'ELEVATOR  ↕  PLATFORM',
        [c.x, c.y + 1.8, c.z - 1.3],
        0,
        Math.min(4, s.x),
        0.35,
        '#224e60',
      );
    }
    const groups = new Map<string, StationPart[]>();
    for (const p of parts) {
      const list = groups.get(p.material) ?? [];
      list.push(p);
      groups.set(p.material, list);
    }
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    this.resources.add(geometry);
    for (const [name, items] of groups) {
      const color = palette[name] ?? palette.concrete;
      const material =
        name === 'light'
          ? new THREE.MeshBasicMaterial({ color })
          : new THREE.MeshStandardMaterial({
              color,
              roughness: name === 'steel' ? 0.45 : 0.88,
              metalness: name === 'steel' ? 0.45 : 0.02,
              emissive: color,
              emissiveIntensity: name === 'glass' ? 0.3 : 0.25,
            });
      this.resources.add(material);
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      mesh.name = `station-instanced-${name}`;
      mesh.userData.stationPartIds = items.map((p) => p.id);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      const matrix = new THREE.Matrix4(),
        q = new THREE.Quaternion();
      items.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p.yaw * Math.PI) / 180);
        matrix.compose(
          new THREE.Vector3(...p.position),
          q,
          new THREE.Vector3(...p.size),
        );
        mesh.setMatrixAt(i, matrix);
      });
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    for (const [name, matrices] of sloped) {
      const color = palette[name] ?? palette.concrete;
      const material =
        name === 'light'
          ? new THREE.MeshBasicMaterial({ color })
          : new THREE.MeshStandardMaterial({
              color,
              roughness: name === 'escalator' ? 0.48 : 0.78,
              metalness: name === 'steel' ? 0.4 : 0.04,
              emissive: color,
              emissiveIntensity: 0.22,
            });
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      mesh.name = `station-escalator-${name}`;
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      this.resources.add(material);
      this.group.add(mesh);
    }
    // Local lamps affect the active station only by finite distance; no extra
    // ambient light is added to the whole city or its night exposure.
    for (const f of platformFloors) {
      const b = new THREE.Box3().setFromPoints(
          f.vertices.map((p) => new THREE.Vector3(...p)),
        ),
        c = b.getCenter(new THREE.Vector3()),
        s = b.getSize(new THREE.Vector3());
      for (const sign of quality === 'balanced' ? [0] : [-1, 1]) {
        const light = new THREE.PointLight(0xe1edf3, 16, 18, 2);
        light.position.set(
          c.x + (s.x > s.z ? sign * 8 : 0),
          c.y + 2.8,
          c.z + (s.z >= s.x ? sign * 12 : 0),
        );
        this.group.add(light);
      }
    }
  }
  stats() {
    let drawCalls = 0,
      instances = 0,
      triangles = 0;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        drawCalls++;
        const count = o instanceof THREE.InstancedMesh ? o.count : 1;
        instances += count;
        triangles +=
          ((o.geometry.index
            ? o.geometry.index.count
            : o.geometry.getAttribute('position').count) /
            3) *
          count;
      }
    });
    return {
      station: this.geometryData.id,
      drawCalls,
      instances,
      triangles,
      floors: this.floors.length,
      disposed: this.disposed,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.boardingDoorCache.clear();
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const r of this.resources) r.dispose();
    this.resources.clear();
    this.group.clear();
  }
}

/** Seven bounded station owners are loaded by proximity and retained in the
 * geographic world. Legacy scene-only load remains available for asset QA. */
export class SkyTrainStations {
  active: SkyTrainStationOwner | null = null;
  private readonly ownersById = new Map<StationId, SkyTrainStationOwner>();
  private readonly ownerRequests = new Map<
    StationId,
    Promise<SkyTrainStationOwner>
  >();
  private worldMode = false;
  private readonly cache = new Map<StationId, RuntimeStationData>();
  private controller: AbortController | null = null;
  private generation = 0;
  private disposed = false;
  private readonly dataRequests = new Set<AbortController>();
  constructor(private readonly options: SkyTrainStationOptions) {}
  get owners(): readonly SkyTrainStationOwner[] {
    return [...this.ownersById.values()];
  }
  get(id: StationId): SkyTrainStationOwner | null {
    return this.ownersById.get(id) ?? null;
  }
  /** Retain architecture at its geographic location, independently of active ride. */
  async ensure(
    id: StationId,
    quality: 'balanced' | 'high' | 'ultra' = 'balanced',
  ): Promise<SkyTrainStationOwner> {
    if (this.disposed || !ids.has(id))
      throw new Error('Unknown or disposed SkyTrain station');
    this.worldMode = true;
    const cached = this.ownersById.get(id);
    if (cached) return cached;
    const pending = this.ownerRequests.get(id);
    if (pending) return pending;
    const request = this.describe(id)
      .then((data) => {
        if (this.disposed) throw new Error('Station load superseded');
        const owner = new SkyTrainStationOwner(
          data,
          this.options.heightAt,
          quality,
          true,
          this.options.streetHeightAt,
        );
        this.ownersById.set(id, owner);
        this.options.scene?.add(owner.group);
        return owner;
      })
      .finally(() => this.ownerRequests.delete(id));
    this.ownerRequests.set(id, request);
    return request;
  }
  async updateProximity(
    worldPosition: StationVector,
    radius = 220,
    pinnedId?: StationId,
  ): Promise<void> {
    if (
      !finiteVector(worldPosition) ||
      !Number.isFinite(radius) ||
      radius < 0 ||
      this.disposed
    )
      return;
    const wanted = SKYTRAIN_STATIONS.filter(
      (station) =>
        station.id === pinnedId ||
        SKYTRAIN_STREET_ENTRANCES[station.id].some((entrance) => {
          const [x, z] = project(entrance.lonlat);
          return (
            Math.hypot(x - worldPosition[0], z - worldPosition[2]) <= radius
          );
        }),
    );
    await Promise.all(wanted.map((station) => this.ensure(station.id)));
  }
  /** Metadata-only prefetch never replaces or hides the current interior. */
  async describe(id: StationId): Promise<RuntimeStationData> {
    if (this.disposed || !ids.has(id))
      throw new Error('Unknown or disposed SkyTrain station');
    const cached = this.cache.get(id);
    if (cached) return cached;
    const controller = new AbortController();
    this.dataRequests.add(controller);
    try {
      const raw = await (this.options.fetchStation
        ? this.options.fetchStation(id, controller.signal)
        : fetch(`/models/skytrain-stations/${id}.json`, {
            signal: controller.signal,
          }).then((r) => {
            if (!r.ok) throw new Error(`Station layout ${r.status}`);
            return r.json() as Promise<unknown>;
          }));
      if (this.disposed || controller.signal.aborted)
        throw new Error('Station load superseded');
      const data = validateRuntimeStation(raw, id);
      this.cache.set(id, data);
      return data;
    } finally {
      this.dataRequests.delete(controller);
    }
  }
  async load(
    id: StationId,
    line: LineId,
    quality: 'balanced' | 'high' | 'ultra' = 'balanced',
  ): Promise<SkyTrainStationOwner> {
    if (this.disposed || !ids.has(id))
      throw new Error('Unknown or disposed SkyTrain station');
    if (this.worldMode) {
      const owner = await this.ensure(id, quality);
      if (!owner.data.platforms.some((p) => p.line === line))
        throw new Error('Line does not serve this station');
      this.active = owner;
      return owner;
    }
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    let data = this.cache.get(id);
    if (!data) {
      const raw = await (this.options.fetchStation
        ? this.options.fetchStation(id, controller.signal)
        : fetch(`/models/skytrain-stations/${id}.json`, {
            signal: controller.signal,
          }).then((r) => {
            if (!r.ok) throw new Error(`Station layout ${r.status}`);
            return r.json() as Promise<unknown>;
          }));
      data = validateRuntimeStation(raw, id);
      if (
        this.disposed ||
        generation !== this.generation ||
        controller.signal.aborted
      )
        throw new Error('Station load superseded');
      this.cache.set(id, data);
    }
    if (!data.platforms.some((p) => p.line === line))
      throw new Error('Line does not serve this station');
    const owner = new SkyTrainStationOwner(
      data,
      this.options.heightAt,
      quality,
    );
    if (
      this.disposed ||
      generation !== this.generation ||
      controller.signal.aborted
    ) {
      owner.dispose();
      throw new Error('Station load superseded');
    }
    const previous = this.active;
    this.active = owner;
    this.options.scene?.add(owner.group);
    previous?.dispose();
    return owner;
  }
  hide() {
    if (!this.worldMode && this.active) this.active.group.visible = false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    for (const c of this.dataRequests) c.abort();
    this.dataRequests.clear();
    this.active?.dispose();
    for (const owner of this.ownersById.values()) owner.dispose();
    this.ownersById.clear();
    this.ownerRequests.clear();
    this.active = null;
    this.cache.clear();
  }
}

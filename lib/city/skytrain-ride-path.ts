import * as THREE from 'three';
import { project } from './geo';
import {
  SKYTRAIN_LINES,
  SKYTRAIN_STATIONS,
  type LineId,
  type StationId,
} from './skytrain-network';
import type { RuntimeStationData } from './skytrain-stations';

export interface SkyTrainStopPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  motionSign: number;
}
interface RouteSegment {
  lineId: LineId;
  from: StationId;
  to: StationId;
  coordinates: [number, number][];
  planarLengthM: number;
  sourceShapeId?: string;
  sourceStopIds?: string[];
  direction?: string;
}
export interface SkyTrainRouteData {
  schema: 1;
  segments: RouteSegment[];
  source?: string;
  sourceSha256?: string;
  scope?: string;
}
export function validateSkyTrainRoutes(value: unknown): SkyTrainRouteData {
  const data = value as SkyTrainRouteData;
  const expected = new Set<string>();
  for (const line of ['expo', 'canada'] as const) {
    const stops = SKYTRAIN_LINES[line].stations;
    for (let i = 1; i < stops.length; i++) {
      expected.add(`${line}:${stops[i - 1]}:${stops[i]}`);
      expected.add(`${line}:${stops[i]}:${stops[i - 1]}`);
    }
  }
  if (
    !data ||
    data.schema !== 1 ||
    !Array.isArray(data.segments) ||
    data.segments.length !== 12 ||
    data.source !== 'translink-gtfs-26SEP_20261002-regional-skytrain' ||
    !/^[a-f0-9]{64}$/.test(data.sourceSha256 ?? '')
  )
    throw new Error('Invalid SkyTrain alignment');
  for (const segment of data.segments) {
    const key = `${segment.lineId}:${segment.from}:${segment.to}`;
    if (
      !expected.delete(key) ||
      !Number.isFinite(segment.planarLengthM) ||
      segment.planarLengthM <= 0 ||
      segment.planarLengthM > 5000 ||
      segment.direction !==
        (segment.lineId === 'expo'
          ? SKYTRAIN_LINES.expo.stations.indexOf(segment.from) <
            SKYTRAIN_LINES.expo.stations.indexOf(segment.to)
            ? 'eastbound'
            : 'westbound'
          : SKYTRAIN_LINES.canada.stations.indexOf(segment.from) <
              SKYTRAIN_LINES.canada.stations.indexOf(segment.to)
            ? 'southbound'
            : 'northbound') ||
      !/^\d+$/.test(segment.sourceShapeId ?? '') ||
      !Array.isArray(segment.sourceStopIds) ||
      segment.sourceStopIds.length !== 2 ||
      !segment.sourceStopIds.every(
        (id) => typeof id === 'string' && /^\d+$/.test(id),
      ) ||
      !Array.isArray(segment.coordinates) ||
      segment.coordinates.length < 2 ||
      segment.coordinates.length > 300 ||
      segment.coordinates.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every(Number.isFinite) ||
          p[0] < -123.18 ||
          p[0] > -123.05 ||
          p[1] < 49.25 ||
          p[1] > 49.31,
      )
    )
      throw new Error('Invalid SkyTrain alignment');
  }
  if (expected.size) throw new Error('Incomplete SkyTrain alignment');
  return data;
}
export async function loadSkyTrainRoutes(
  signal?: AbortSignal,
): Promise<SkyTrainRouteData> {
  const response = await fetch('/models/skytrain-routes.json', { signal });
  if (!response.ok) throw new Error('SkyTrain alignment unavailable');
  return validateSkyTrainRoutes(await response.json());
}

/** Offline station frames explicitly had unresolved world headings. Align the
 * whole frame to the retained GTFS tangent, preserving every local floor, door
 * and obstacle. Waterfront retains its authored perpendicular two-line layout. */
export function adaptSkyTrainStationFrame(
  data: RuntimeStationData,
  routes: SkyTrainRouteData,
): RuntimeStationData {
  const line =
    data.id === 'waterfront'
      ? 'expo'
      : SKYTRAIN_STATIONS.find((s) => s.id === data.id)!.lines[0];
  const stops = SKYTRAIN_LINES[line].stations,
    index = stops.indexOf(data.id),
    last = index === stops.length - 1;
  const segment = routes.segments.find(
    (s) =>
      s.lineId === line &&
      s.from === (last ? stops[index - 1] : data.id) &&
      s.to === (last ? data.id : stops[index + 1]),
  );
  if (!segment) throw new Error('Missing station track tangent');
  const points = segment.coordinates,
    a = project(points[last ? points.length - 2 : 0]),
    b = project(points[last ? points.length - 1 : 1]);
  const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const platform = data.platforms.find(
    (p) =>
      p.line === line &&
      p.direction === (line === 'expo' ? 'eastbound' : 'southbound'),
  )!;
  const local = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().fromArray(platform.quaternion),
    'YXZ',
  ).y;
  const quaternion = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading - local)
    .toArray();
  let lonlat = data.lonlat;
  if (data.id === 'main-street-science-world') {
    // The City selection point sits west of the two retained GTFS platform
    // anchors. Centring the elevated runtime frame between those anchors keeps
    // its rear cars/platform out of the neighbouring measured podium. Local
    // authored geometry and the source packet remain untouched.
    const reverse = routes.segments.find(
      (s) =>
        s.lineId === 'expo' && s.from === data.id && s.to === stops[index - 1],
    );
    const eastbound = points.at(-1),
      westbound = reverse?.coordinates[0];
    if (
      !eastbound ||
      !westbound ||
      ![...eastbound, ...westbound].every(Number.isFinite)
    )
      throw new Error('Missing Main Street platform anchors');
    lonlat = [
      (eastbound[0] + westbound[0]) / 2,
      (eastbound[1] + westbound[1]) / 2,
    ];
  }
  return {
    ...data,
    lonlat,
    quaternion,
    platforms: data.platforms.map((p) => ({
      ...p,
      motionSign:
        p.direction === 'eastbound' || p.direction === 'southbound' ? 1 : -1,
    })),
  };
}

/** Every trip uses the retained GTFS bends, with explicit authored platform
 * endpoints. Interpolated depths and final platform joins are game geometry. */
export class SkyTrainRidePath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  constructor(
    data: SkyTrainRouteData,
    line: LineId,
    from: StationId,
    to: StationId,
    readonly start: SkyTrainStopPose,
    readonly end: SkyTrainStopPose,
  ) {
    validateSkyTrainRoutes(data);
    for (const pose of [start, end])
      if (
        !pose ||
        !pose.position
          ?.toArray()
          .every((v) => Number.isFinite(v) && Math.abs(v) < 100_000) ||
        !pose.quaternion?.toArray().every(Number.isFinite) ||
        Math.abs(pose.quaternion.length() - 1) > 0.0001 ||
        ![1, -1].includes(pose.motionSign)
      )
        throw new Error('Invalid SkyTrain stop pose');
    if (start.motionSign !== end.motionSign)
      throw new Error('Inconsistent bidirectional train frame');
    const segment = data.segments.find(
      (item) => item.lineId === line && item.from === from && item.to === to,
    );
    if (!segment) throw new Error('No geographic SkyTrain segment');
    const source = segment.coordinates.map((coordinate) => {
      const [x, z] = project(coordinate);
      return new THREE.Vector3(x, 0, z);
    });
    const cumulative = [0];
    for (let i = 1; i < source.length; i++)
      cumulative.push(cumulative[i - 1] + source[i].distanceTo(source[i - 1]));
    const total = cumulative.at(-1)!;
    const forward = new THREE.Vector3(0, 0, start.motionSign).applyQuaternion(
      start.quaternion,
    );
    const finish = new THREE.Vector3(0, 0, end.motionSign).applyQuaternion(
      end.quaternion,
    );
    const points = [
      start.position.clone(),
      start.position.clone().addScaledVector(forward, 24),
    ];
    source.forEach((point, i) => {
      if (
        cumulative[i] < 80 ||
        total - cumulative[i] < 80 ||
        Math.hypot(point.x - start.position.x, point.z - start.position.z) <
          80 ||
        Math.hypot(point.x - end.position.x, point.z - end.position.z) < 80
      )
        return;
      point.y = THREE.MathUtils.lerp(
        start.position.y,
        end.position.y,
        cumulative[i] / total,
      );
      if (point.distanceTo(points.at(-1)!) > 4) points.push(point);
    });
    points.push(
      end.position.clone().addScaledVector(finish, -24),
      end.position.clone(),
    );
    this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    this.curve.arcLengthDivisions = 1200;
    this.length = this.curve.getLength();
  }
  sample(progress: number) {
    const u = THREE.MathUtils.clamp(
      Number.isFinite(progress) ? progress : 0,
      0,
      1,
    );
    const position = this.curve.getPointAt(u);
    const forward = this.curve
      .getTangentAt(u)
      .multiplyScalar(this.start.motionSign)
      .normalize();
    const rotation = new THREE.Matrix4().lookAt(
      new THREE.Vector3(),
      forward.clone().negate(),
      new THREE.Vector3(0, 1, 0),
    );
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotation);
    if (u === 0) quaternion.copy(this.start.quaternion);
    if (u === 1) quaternion.copy(this.end.quaternion);
    return { position, quaternion };
  }
}

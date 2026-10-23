import * as THREE from 'three';
import { project } from './geo';
import { SKYTRAIN_STREET_ENTRANCES } from './skytrain-street-access';
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
export interface SkyTrainPathPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
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
  if (data.authoredInterior) {
    // Place the maintained entrance hall at its official street anchor. The
    // entire local frame (including every train stop) moves together, so route
    // metadata and the live station use exactly the same world transform.
    const primary =
      data.entrances.find(
        (e) => e.id === data.authoredInterior!.primaryEntrance,
      ) ?? data.entrances[0];
    const mapping = data.authoredInterior.streetEntranceMap as
      | Record<string, string>
      | undefined;
    const ref =
      SKYTRAIN_STREET_ENTRANCES[data.id].find(
        (r) => r.id === primary.id || mapping?.[r.id] === primary.id,
      ) ?? SKYTRAIN_STREET_ENTRANCES[data.id][0];
    // Rebase local X/Z at the doorway so the street datum is sampled at the
    // entrance itself, not at a distant City selection point on sloping ground.
    const shift = (p: readonly number[]): [number, number, number] => [
      p[0] - primary.point[0],
      p[1],
      p[2] - primary.point[2],
    ];
    data = {
      ...data,
      floors: data.floors.map((f) => ({
        ...f,
        vertices: f.vertices.map(shift),
      })),
      entrances: data.entrances.map((e) => ({ ...e, point: shift(e.point) })),
      connections: data.connections.map((c) => ({
        ...c,
        start: shift(c.start),
        end: shift(c.end),
        treads: c.treads.map((t) => ({
          ...t,
          vertices: t.vertices.map(shift),
        })),
      })),
      parts: data.parts.map((p) => ({ ...p, position: shift(p.position) })),
      obstacles: data.obstacles.map((o) => ({
        ...o,
        position: shift(o.position),
      })),
      exclusions: data.exclusions.map((e) => ({
        ...e,
        polygon: e.polygon.map(shift),
      })),
      platforms: data.platforms.map((p) => ({
        ...p,
        position: shift(p.position),
        doors: p.doors.map((d) => ({
          ...d,
          sill: shift(d.sill),
          edge: shift(d.edge),
          waiting: shift(d.waiting),
        })),
      })),
      signs: data.signs?.map((s) => ({ ...s, position: shift(s.position) })),
    };
    lonlat = [...ref.lonlat];
  }
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

type HeightAt = (x: number, z: number) => number;

/** A wide transition matches position, tangent and curvature at both ends.
 * Short Catmull handles near unsurveyed station pivots create abrupt S bends. */
class QuinticJoinCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly start: THREE.Vector3,
    private readonly end: THREE.Vector3,
    private readonly startDerivative: THREE.Vector3,
    private readonly endDerivative: THREE.Vector3,
    private readonly startAcceleration: THREE.Vector3,
    private readonly endAcceleration: THREE.Vector3,
  ) {
    super();
    this.arcLengthDivisions = 1200;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return target
      .copy(this.start)
      .multiplyScalar(1 - 10 * t ** 3 + 15 * t ** 4 - 6 * t ** 5)
      .addScaledVector(
        this.startDerivative,
        t - 6 * t ** 3 + 8 * t ** 4 - 3 * t ** 5,
      )
      .addScaledVector(
        this.startAcceleration,
        0.5 * t ** 2 - 1.5 * t ** 3 + 1.5 * t ** 4 - 0.5 * t ** 5,
      )
      .addScaledVector(this.end, 10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5)
      .addScaledVector(
        this.endDerivative,
        -4 * t ** 3 + 7 * t ** 4 - 3 * t ** 5,
      )
      .addScaledVector(
        this.endAcceleration,
        0.5 * t ** 3 - t ** 4 + 0.5 * t ** 5,
      );
  }
}

class SourceSliceCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly source: THREE.Curve<THREE.Vector3>,
    private readonly from: number,
    private readonly to: number,
  ) {
    super();
    this.arcLengthDivisions = 2400;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return this.source.getPointAt(
      this.from + (this.to - this.from) * t,
      target,
    );
  }
}

/** Compose the retained horizontal alignment with a C2 vertical grade. The
 * plateau at either end protects the entire rigid consist inside the station;
 * a smooth depression provides terrain clearance without moving its stop. */
class UndergroundCurve extends THREE.Curve<THREE.Vector3> {
  private readonly baseLength: number;
  constructor(
    private readonly base: THREE.Curve<THREE.Vector3>,
    private readonly startY: number,
    private readonly endY: number,
    private readonly lead: number,
    readonly depression: number,
  ) {
    super();
    this.baseLength = base.getLength();
    this.arcLengthDivisions = 2400;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    this.base.getPointAt(t, target);
    const span = this.baseLength - 2 * this.lead,
      s = THREE.MathUtils.clamp(t * this.baseLength - this.lead, 0, span),
      ramp = Math.min(48, span / 3),
      integral = (x: number) => 2.5 * x ** 4 - 3 * x ** 5 + x ** 6,
      gradeDistance =
        s < ramp
          ? ramp * integral(s / ramp)
          : s > span - ramp
            ? span - ramp - ramp * integral((span - s) / ramp)
            : s - ramp / 2,
      x = s / span;
    target.y =
      this.startY +
      ((this.endY - this.startY) * gradeDistance) / (span - ramp) -
      this.depression * 64 * x ** 3 * (1 - x) ** 3;
    return target;
  }
}

/** Every trip retains the GTFS bends and exact authored platform stops. The
 * runtime depth is representative geometry, constrained by the real city
 * heightfield when supplied; it does not claim surveyed tunnel elevations. */
export class SkyTrainRidePath {
  private readonly sampleForward = new THREE.Vector3();
  private readonly sampleRotation = new THREE.Matrix4();
  private readonly sampleOrigin = new THREE.Vector3();
  private readonly sampleUp = new THREE.Vector3(0, 1, 0);
  readonly curve: THREE.Curve<THREE.Vector3>;
  readonly length: number;
  readonly terrainProfile: {
    depressionM: number;
    minimumTubeClearanceM: number;
    maximumPitchDegrees: number;
  } | null;
  constructor(
    data: SkyTrainRouteData,
    line: LineId,
    from: StationId,
    to: StationId,
    readonly start: SkyTrainStopPose,
    readonly end: SkyTrainStopPose,
    heightAt?: HeightAt,
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
    const forward = new THREE.Vector3(0, 0, start.motionSign).applyQuaternion(
      start.quaternion,
    );
    const finish = new THREE.Vector3(0, 0, end.motionSign).applyQuaternion(
      end.quaternion,
    );
    // Each articulated car must remain level until its own half length clears
    // the authored buffer: Expo65+8.5m, Canada47+10m, plus a small margin.
    const lead = line === 'expo' ? 75 : 65,
      sourceCurve = new THREE.CatmullRomCurve3(source, false, 'centripetal');
    // Source vertices can be densely clustered around a bend. A fine source
    // lookup prevents their uneven parameter spacing from changing ride speed.
    sourceCurve.arcLengthDivisions = 12000;
    const sourceLength = sourceCurve.getLength(),
      join = Math.min(340, sourceLength * 0.42),
      fraction = join / sourceLength,
      startXZ = new THREE.Vector3(start.position.x, 0, start.position.z),
      endXZ = new THREE.Vector3(end.position.x, 0, end.position.z),
      first = startXZ.clone().addScaledVector(forward, lead),
      last = endXZ.clone().addScaledVector(finish, -lead),
      base = new THREE.CurvePath<THREE.Vector3>();
    base.add(new THREE.LineCurve3(startXZ, first));
    if (sourceLength < 500) {
      // These two short source edges are nearly straight. Their unsurveyed
      // station pivots overlap a pair of cropped source joins; one continuous
      // transition prevents a reverse loop while preserving both platform axes.
      const distance = first.distanceTo(last);
      base.add(
        new QuinticJoinCurve(
          first,
          last,
          forward.clone().multiplyScalar(distance),
          finish.clone().multiplyScalar(distance),
          new THREE.Vector3(),
          new THREE.Vector3(),
        ),
      );
    } else {
      const a = sourceCurve.getPointAt(fraction),
        b = sourceCurve.getPointAt(1 - fraction),
        da = first.distanceTo(a) * 1.15,
        db = last.distanceTo(b) * 1.15,
        curvature = (t: number) =>
          sourceCurve
            .getTangentAt(t + 1 / sourceLength)
            .sub(sourceCurve.getTangentAt(t - 1 / sourceLength))
            .multiplyScalar(0.5);
      base.add(
        new QuinticJoinCurve(
          first,
          a,
          forward.clone().multiplyScalar(da),
          sourceCurve.getTangentAt(fraction).multiplyScalar(da),
          new THREE.Vector3(),
          curvature(fraction).multiplyScalar(da * da),
        ),
      );
      base.add(new SourceSliceCurve(sourceCurve, fraction, 1 - fraction));
      base.add(
        new QuinticJoinCurve(
          b,
          last,
          sourceCurve.getTangentAt(1 - fraction).multiplyScalar(db),
          finish.clone().multiplyScalar(db),
          curvature(1 - fraction).multiplyScalar(db * db),
          new THREE.Vector3(),
        ),
      );
    }
    base.add(new THREE.LineCurve3(last, endXZ));
    base.arcLengthDivisions = 6000;
    this.curve = new UndergroundCurve(
      base,
      start.position.y,
      end.position.y,
      lead,
      0,
    );
    this.terrainProfile = null;
    if (heightAt && ![from, to].includes('main-street-science-world')) {
      const sampleCount = Math.ceil(base.getLength()),
        halfLength = line === 'expo' ? 35.35 : 20.3,
        longitudinalCount = Math.ceil(halfLength),
        point = new THREE.Vector3(),
        tangent = new THREE.Vector3(),
        anchor = new THREE.Vector3(),
        quaternion = new THREE.Quaternion(),
        rotation = new THREE.Matrix4(),
        up = new THREE.Vector3(0, 1, 0),
        zero = new THREE.Vector3();
      let fitted = false;
      for (let depression = 0; depression <= 80; depression += 0.5) {
        const candidate = new UndergroundCurve(
          base,
          start.position.y,
          end.position.y,
          lead,
          depression,
        );
        let minimum = Infinity,
          maximumPitch = 0;
        for (let i = 0; i <= sampleCount; i++) {
          const t = i / sampleCount;
          candidate.getPoint(t, point);
          candidate.getTangent(t, tangent).normalize();
          maximumPitch = Math.max(
            maximumPitch,
            Math.abs(Math.asin(tangent.y)) * (180 / Math.PI),
          );
          rotation.lookAt(zero, tangent.multiplyScalar(-start.motionSign), up);
          quaternion.setFromRotationMatrix(rotation);
          for (let j = 0; j <= longitudinalCount; j++)
            for (const x of [-1.4, 0, 1.4]) {
              // Tube crown 1.4 + radius 3.5 also conservatively encloses the
              // lower actual train roof, including its rigid end overhang.
              anchor
                .set(
                  x,
                  4.9,
                  -halfLength + (2 * halfLength * j) / longitudinalCount,
                )
                .applyQuaternion(quaternion)
                .add(point);
              const ground = heightAt(anchor.x, anchor.z);
              if (!Number.isFinite(ground))
                throw new Error('Invalid SkyTrain terrain height');
              minimum = Math.min(minimum, ground - anchor.y);
            }
          // Retain 0.20m clearance plus 0.05m for finite sampling and the
          // separately tessellated eight-metre tunnel mesh.
          if (minimum < 0.25) break;
        }
        if (minimum >= 0.25) {
          this.curve = candidate;
          this.terrainProfile = {
            depressionM: depression,
            minimumTubeClearanceM: minimum,
            maximumPitchDegrees: maximumPitch,
          };
          fitted = true;
          break;
        }
      }
      if (!fitted)
        throw new Error(
          'SkyTrain terrain clearance cannot preserve station stops',
        );
    }
    this.length = this.curve.getLength();
  }
  sample(
    progress: number,
    target: SkyTrainPathPose = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    },
  ) {
    const u = THREE.MathUtils.clamp(
      Number.isFinite(progress) ? progress : 0,
      0,
      1,
    );
    this.curve.getPointAt(u, target.position);
    this.curve
      .getTangentAt(u, this.sampleForward)
      .multiplyScalar(this.start.motionSign)
      .normalize()
      .negate();
    this.sampleRotation.lookAt(
      this.sampleOrigin,
      this.sampleForward,
      this.sampleUp,
    );
    target.quaternion.setFromRotationMatrix(this.sampleRotation);
    if (u === 0) target.quaternion.copy(this.start.quaternion);
    if (u === 1) target.quaternion.copy(this.end.quaternion);
    return target;
  }
  /** Each articulated car follows its own physical arc distance. Cars beyond a
   * stop continue along that exact platform tangent, retaining their authored
   * spacing and door identity while the whole consist is stationary. */
  sampleDistance(distance: number, target?: SkyTrainPathPose) {
    if (!Number.isFinite(distance))
      throw new Error('Invalid SkyTrain arc distance');
    const pose = this.sample(distance / this.length, target);
    if (distance < 0 || distance > this.length) {
      const stop = distance < 0 ? this.start : this.end,
        excess = distance < 0 ? distance : distance - this.length;
      this.sampleForward
        .set(0, 0, stop.motionSign)
        .applyQuaternion(stop.quaternion);
      pose.position.addScaledVector(this.sampleForward, excess);
    }
    return pose;
  }
}

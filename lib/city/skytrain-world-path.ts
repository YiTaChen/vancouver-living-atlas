import * as THREE from 'three';
import { project } from './geo';
import type { LineId } from './skytrain-network';
import type { SkyTrainMotionPath } from './skytrain-motion-path';
import type { SkyTrainPathPose, SkyTrainStopPose } from './skytrain-ride-path';
import type { WorldSkyTrainRoute } from './skytrain-world-service';
export type { SkyTrainMotionPath } from './skytrain-motion-path';
export type { SkyTrainStopPose } from './skytrain-ride-path';
const UP = new THREE.Vector3(0, 1, 0),
  ZERO = new THREE.Vector3();
const smooth = (t: number) => t ** 3 * (10 + t * (-15 + 6 * t));
const poseTarget = (): SkyTrainPathPose => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
});
const travelForward = (stop: SkyTrainStopPose) =>
  new THREE.Vector3(0, 0, stop.motionSign)
    .applyQuaternion(stop.quaternion)
    .normalize();
function checkStop(stop: SkyTrainStopPose) {
  if (
    !stop.position.toArray().every(Number.isFinite) ||
    !stop.quaternion.toArray().every(Number.isFinite) ||
    Math.abs(stop.quaternion.length() - 1) > 1e-5 ||
    ![1, -1].includes(stop.motionSign)
  )
    throw new Error('Invalid SkyTrain motion stop');
}
class QuinticJoin extends THREE.Curve<THREE.Vector3> {
  constructor(
    private a: THREE.Vector3,
    private b: THREE.Vector3,
    private da: THREE.Vector3,
    private db: THREE.Vector3,
  ) {
    super();
    this.arcLengthDivisions = 1200;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return target
      .copy(this.a)
      .multiplyScalar(1 - smooth(t))
      .addScaledVector(this.b, smooth(t))
      .addScaledVector(this.da, t - 6 * t ** 3 + 8 * t ** 4 - 3 * t ** 5)
      .addScaledVector(this.db, -4 * t ** 3 + 7 * t ** 4 - 3 * t ** 5);
  }
}
class SourceSlice extends THREE.Curve<THREE.Vector3> {
  constructor(
    private source: THREE.Curve<THREE.Vector3>,
    private from: number,
    private to: number,
  ) {
    super();
    this.arcLengthDivisions = 1800;
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return this.source.getPointAt(
      this.from + (this.to - this.from) * t,
      target,
    );
  }
}
function curvePose(
  curve: THREE.Curve<THREE.Vector3>,
  distance: number,
  length: number,
  start: SkyTrainStopPose,
  end: SkyTrainStopPose,
  target = poseTarget(),
) {
  const u = THREE.MathUtils.clamp(distance / length, 0, 1),
    tangent = curve.getTangentAt(u).normalize();
  curve.getPointAt(u, target.position);
  target.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().lookAt(
      ZERO,
      tangent.multiplyScalar(-start.motionSign),
      UP,
    ),
  );
  if (distance <= 0 || distance >= length) {
    const stop = distance <= 0 ? start : end;
    target.position
      .copy(stop.position)
      .addScaledVector(
        travelForward(stop),
        distance <= 0 ? distance : distance - length,
      );
    target.quaternion.copy(stop.quaternion);
  }
  return target;
}

/** Full GTFS leg beyond the authored downtown network. Source bends remain in
 * the middle; wide endpoint joins preserve exact provided platform frames.
 * The terrain-relative vertical envelope is representative, never a survey. */
export class SkyTrainWorldPath implements SkyTrainMotionPath {
  readonly curve: THREE.Curve<THREE.Vector3>;
  readonly length: number;
  readonly sourceCoordinates: readonly (readonly [number, number])[];
  constructor(
    route: WorldSkyTrainRoute,
    segmentIndex: number,
    readonly start: SkyTrainStopPose,
    readonly end: SkyTrainStopPose,
    heightAt?: (x: number, z: number) => number,
  ) {
    checkStop(start);
    checkStop(end);
    if (start.motionSign !== end.motionSign)
      throw new Error('SkyTrain leg changes car orientation');
    const segment = route.segments[segmentIndex];
    if (!segment || segment.coordinates.length < 2)
      throw new Error('Missing full SkyTrain source leg');
    this.sourceCoordinates = segment.coordinates.map(
      (point) => [...point] as [number, number],
    );
    const points = segment.coordinates.map((coordinate, index) => {
      const [x, z] = project(coordinate),
        terrain = heightAt?.(x, z),
        fraction = index / (segment.coordinates.length - 1),
        y =
          terrain === undefined
            ? THREE.MathUtils.lerp(
                start.position.y,
                end.position.y,
                smooth(fraction),
              )
            : terrain + (route.lineId === 'expo' ? 10 : -16);
      if (![x, y, z].every(Number.isFinite))
        throw new Error('Invalid SkyTrain source height');
      return new THREE.Vector3(x, y, z);
    });
    const source = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    source.arcLengthDivisions = Math.max(4000, points.length * 40);
    const sourceLength = source.getLength(),
      lead = Math.min(route.lineId === 'expo' ? 75 : 65, sourceLength * 0.18),
      join = Math.min(280, sourceLength * 0.35),
      fraction = join / sourceLength,
      first = start.position
        .clone()
        .addScaledVector(travelForward(start), lead),
      last = end.position.clone().addScaledVector(travelForward(end), -lead),
      a = source.getPointAt(fraction),
      b = source.getPointAt(1 - fraction),
      da = first.distanceTo(a),
      db = last.distanceTo(b),
      curve = new THREE.CurvePath<THREE.Vector3>();
    curve.add(new THREE.LineCurve3(start.position.clone(), first));
    curve.add(
      new QuinticJoin(
        first,
        a,
        travelForward(start).multiplyScalar(da),
        source.getTangentAt(fraction).multiplyScalar(da),
      ),
    );
    curve.add(new SourceSlice(source, fraction, 1 - fraction));
    curve.add(
      new QuinticJoin(
        b,
        last,
        source.getTangentAt(1 - fraction).multiplyScalar(db),
        travelForward(end).multiplyScalar(db),
      ),
    );
    curve.add(new THREE.LineCurve3(last, end.position.clone()));
    curve.arcLengthDivisions = Math.max(6000, points.length * 40);
    this.curve = curve;
    this.length = curve.getLength();
  }
  sampleDistance(distance: number, target?: SkyTrainPathPose) {
    if (!Number.isFinite(distance))
      throw new Error('Invalid SkyTrain arc distance');
    return curvePose(
      this.curve,
      distance,
      this.length,
      this.start,
      this.end,
      target,
    );
  }
}

/** A tail-track crossover: continue beyond the true terminal, change parallel
 * tracks, stop with the whole consist clear, then reverse without spinning.
 * setPathPose's progress here is normalized terminal phase time; this class
 * eases both legs independently so velocity is zero at the actual reversal. */
export class SkyTrainTerminalPath implements SkyTrainMotionPath {
  readonly curve: THREE.Curve<THREE.Vector3>;
  readonly length: number;
  readonly tail: THREE.Vector3;
  private readonly outbound: THREE.Curve<THREE.Vector3>;
  private readonly incoming: THREE.Curve<THREE.Vector3>;
  private readonly outboundEnd: SkyTrainStopPose;
  private readonly incomingStart: SkyTrainStopPose;
  private readonly outboundLength: number;
  private readonly incomingLength: number;
  constructor(
    readonly start: SkyTrainStopPose,
    readonly end: SkyTrainStopPose,
    line: LineId,
  ) {
    checkStop(start);
    checkStop(end);
    if (
      start.motionSign === end.motionSign ||
      new THREE.Vector3(0, 0, 1)
        .applyQuaternion(start.quaternion)
        .dot(new THREE.Vector3(0, 0, 1).applyQuaternion(end.quaternion)) < 0.9
    )
      throw new Error(
        'Terminal crossover requires opposite service directions and the same car frame',
      );
    const forward = travelForward(start),
      finish = travelForward(end).negate(),
      tailDistance = line === 'expo' ? 220 : 200,
      lead = line === 'expo' ? 75 : 65,
      first = start.position.clone().addScaledVector(forward, lead),
      joined = end.position.clone().addScaledVector(finish, tailDistance - 50),
      joinLength = first.distanceTo(joined),
      outbound = new THREE.CurvePath<THREE.Vector3>();
    this.tail = end.position.clone().addScaledVector(finish, tailDistance);
    outbound.add(new THREE.LineCurve3(start.position.clone(), first));
    outbound.add(
      new QuinticJoin(
        first,
        joined,
        forward.clone().multiplyScalar(joinLength),
        finish.clone().multiplyScalar(joinLength),
      ),
    );
    outbound.add(new THREE.LineCurve3(joined, this.tail));
    outbound.arcLengthDivisions = 3000;
    this.outbound = outbound;
    this.incoming = new THREE.LineCurve3(this.tail, end.position.clone());
    this.outboundLength = outbound.getLength();
    this.incomingLength = this.incoming.getLength();
    this.length = this.outboundLength + this.incomingLength;
    const curve = new THREE.CurvePath<THREE.Vector3>();
    curve.add(outbound);
    curve.add(this.incoming);
    this.curve = curve;
    this.outboundEnd = {
      position: this.tail,
      quaternion: end.quaternion,
      motionSign: start.motionSign,
    };
    this.incomingStart = {
      position: this.tail,
      quaternion: end.quaternion,
      motionSign: end.motionSign,
    };
  }
  private branch(distance: number) {
    if (!Number.isFinite(distance))
      throw new Error('Invalid terminal phase distance');
    const t = THREE.MathUtils.clamp(distance / this.length, 0, 1),
      returning = t >= 0.5;
    return returning
      ? {
          curve: this.incoming,
          distance: this.incomingLength * smooth(2 * t - 1),
          length: this.incomingLength,
          start: this.incomingStart,
          end: this.end,
        }
      : {
          curve: this.outbound,
          distance: this.outboundLength * smooth(2 * t),
          length: this.outboundLength,
          start: this.start,
          end: this.outboundEnd,
        };
  }
  sampleDistance(distance: number, target?: SkyTrainPathPose) {
    const branch = this.branch(distance);
    return curvePose(
      branch.curve,
      branch.distance,
      branch.length,
      branch.start,
      branch.end,
      target,
    );
  }
  sampleCarDistance(
    distance: number,
    carOffset: number,
    target?: SkyTrainPathPose,
  ) {
    const branch = this.branch(distance);
    return curvePose(
      branch.curve,
      branch.distance + carOffset * branch.start.motionSign,
      branch.length,
      branch.start,
      branch.end,
      target,
    );
  }
}

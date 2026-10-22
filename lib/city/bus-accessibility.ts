import * as THREE from 'three';

type Point = [number, number, number];
export type BusAccessibilityPhase =
  | 'stowed'
  | 'kneeling'
  | 'deploying'
  | 'deployed'
  | 'retracting'
  | 'raising';
export type BusAccessibilityError =
  | 'front-door-closed'
  | 'landing-unavailable'
  | 'landing-too-steep'
  | 'landing-uneven'
  | 'ramp-obstructed'
  | 'clear-ramp-area'
  | 'bus-moved';
export interface BusRampGround {
  y: number;
  surfaceId: string;
  layer: number;
}
export interface BusRampSurface {
  frameId: 'world';
  /** Hinge-left, hinge-right, landing-right, landing-left. Metres, Y up. */
  verticesM: [Point, Point, Point, Point];
  normal: Point;
  landingSurfaceId: string;
  landingLayer: number;
  /** Geometry is exposed for future traversal; no free-walking route is registered. */
  walkingEnabled: false;
}
export interface BusAccessibilitySnapshot {
  phase: BusAccessibilityPhase;
  moving: boolean;
  bodyDropM: number;
  rampAngleRad: number;
  error: BusAccessibilityError | null;
  surface: BusRampSurface | null;
  representative: true;
  notFleetCertification: true;
}
type Sampler = (x: number, z: number) => BusRampGround | null;
interface RigMetadata {
  drop: number;
  length: number;
  width: number;
  hinge: Point;
  centerZ: number;
  rampName: string;
  wheelNames: string[];
}
interface NeutralNode {
  node: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  matrix: THREE.Matrix4;
  auto: boolean;
  world: THREE.Matrix4;
}
const capture = (node: THREE.Object3D): NeutralNode => ({
  node,
  position: node.position.clone(),
  quaternion: node.quaternion.clone(),
  scale: node.scale.clone(),
  matrix: node.matrix.clone(),
  auto: node.matrixAutoUpdate,
  world: node.matrixWorld.clone(),
});
const restore = (pose: NeutralNode) => {
  pose.node.position.copy(pose.position);
  pose.node.quaternion.copy(pose.quaternion);
  pose.node.scale.copy(pose.scale);
  pose.node.matrix.copy(pose.matrix);
  pose.node.matrixAutoUpdate = pose.auto;
};
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const vector = (value: unknown): value is Point =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const within = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
function metadata(value: unknown): RigMetadata | null {
  const m = object(value),
    r = object(m?.ramp);
  if (
    !m ||
    !r ||
    m.schemaVersion !== 1 ||
    m.representative !== true ||
    m.notFleetCertification !== true ||
    !within(m.kneelDropM, 0.02, 0.12) ||
    !within(r.lengthM, 0.8, 1.5) ||
    !within(r.widthM, 0.65, 1.1) ||
    r.nodeId !== 'boarding-ramp' ||
    r.rotationAxis !== '+Z' ||
    r.stowedAngleRad !== 0 ||
    !vector(r.hingeM) ||
    !Array.isArray(m.wheelNodeIds) ||
    m.wheelNodeIds.length !== 4 ||
    !m.wheelNodeIds.every((id) => typeof id === 'string') ||
    new Set(m.wheelNodeIds).size !== 4
  )
    return null;
  const expected = [
    'wheel-front-left',
    'wheel-front-right',
    'wheel-rear-left',
    'wheel-rear-right',
  ];
  const wheelNames = m.wheelNodeIds as string[];
  if (!expected.every((id) => wheelNames.includes(id))) return null;
  const center = r.centerOffsetM ?? [0, 0, 0];
  if (
    !vector(center) ||
    center[0] !== 0 ||
    center[1] !== 0 ||
    Math.abs(center[2]) > 0.25
  )
    return null;
  return {
    drop: m.kneelDropM,
    length: r.lengthM,
    width: r.widthM,
    hinge: [...r.hingeM],
    centerZ: center[2],
    rampName: r.nodeId,
    wheelNames,
  };
}
const smooth = (v: number) => v * v * (3 - 2 * v);
const point = (v: THREE.Vector3): Point => [v.x, v.y, v.z];
type Triangle = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
type GroundTriangles = (bounds: THREE.Box3) => readonly Triangle[] | null;

/** Clip a convex 3D polygon to a half-space, preserving its boundary order. */
function clipPolygon(
  points: THREE.Vector3[],
  normal: THREE.Vector3,
  offset: number,
) {
  const result: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = normal.dot(a) - offset,
      db = normal.dot(b) - offset;
    if (da >= 0) result.push(a);
    if (da >= 0 !== db >= 0) result.push(a.clone().lerp(b, da / (da - db)));
  }
  return result;
}

/** Continuous intersection with the entire deck's swept circular-sector
 * extrusion. Splitting into convex angular wedges avoids sparse ray tracks:
 * even a narrow obstacle between the centre and either edge is tested. */
function intersectsSector(
  triangle: Triangle,
  rig: RigMetadata,
  start: number,
  end: number,
) {
  const hinge = new THREE.Vector3(...rig.hinge);
  const original = triangle.map((p) => p.clone().sub(hinge));
  const zMin = rig.centerZ - rig.width / 2,
    zMax = rig.centerZ + rig.width / 2;
  let slab = clipPolygon(original, new THREE.Vector3(0, 0, 1), zMin);
  slab = clipPolygon(slab, new THREE.Vector3(0, 0, -1), -zMax);
  if (!slab.length) return false;
  const pieces = Math.ceil((end - start) / (Math.PI / 2));
  const radius2 = rig.length * rig.length;
  for (let i = 0; i < pieces; i++) {
    const a = start + ((end - start) * i) / pieces;
    const b = start + ((end - start) * (i + 1)) / pieces;
    let polygon = clipPolygon(
      slab,
      new THREE.Vector3(-Math.sin(a), Math.cos(a), 0),
      1e-7,
    );
    polygon = clipPolygon(
      polygon,
      new THREE.Vector3(Math.sin(b), -Math.cos(b), 0),
      1e-7,
    );
    if (!polygon.length) continue;
    let positive = false,
      negative = false,
      area = 0;
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j],
        q = polygon[(j + 1) % polygon.length];
      const dx = q.x - p.x,
        dy = q.y - p.y;
      const denominator = dx * dx + dy * dy;
      const t =
        denominator > 0
          ? THREE.MathUtils.clamp(-(p.x * dx + p.y * dy) / denominator, 0, 1)
          : 0;
      if ((p.x + t * dx) ** 2 + (p.y + t * dy) ** 2 <= radius2) return true;
      const cross = p.x * q.y - p.y * q.x;
      positive ||= cross > 1e-10;
      negative ||= cross < -1e-10;
      area += cross;
    }
    // A triangle can enclose the circular sector without any edge entering it.
    if (!(positive && negative) && Math.abs(area) > 1e-10) return true;
  }
  return false;
}

/** Conservative XZ footprint for the present ground walker, not a ramp route. */
export function rampContainsPoint(
  surface: BusRampSurface,
  x: number,
  z: number,
  radius = 0.3,
) {
  const [a, b, , d] = surface.verticesM;
  const along = new THREE.Vector2(d[0] - a[0], d[2] - a[2]);
  const across = new THREE.Vector2(b[0] - a[0], b[2] - a[2]);
  const offset = new THREE.Vector2(x - a[0], z - a[2]);
  const length = along.length(),
    width = across.length();
  if (length < 1e-5 || width < 1e-5) return false;
  const u = offset.dot(along) / length,
    v = offset.dot(across) / width;
  return (
    u > -radius && u < length + radius && v > -radius && v < width + radius
  );
}

/** Only the parked hybrid rig opts in. No timings or surface identities are
 * inferred for old buses. Construct after the owner has its final parked pose. */
export class BusAccessibility {
  private phase: BusAccessibilityPhase = 'stowed';
  private error: BusAccessibilityError | null = null;
  private elapsed = 0;
  private drop = 0;
  private angle = 0;
  private targetAngle = 0;
  private landing: BusRampSurface | null = null;
  private disposed = false;
  private rootPose: NeutralNode;
  private rampPose: NeutralNode;
  private wheels: NeutralNode[];
  private rampInRoot: THREE.Matrix4;
  private constructor(
    private root: THREE.Object3D,
    private rig: RigMetadata,
    ramp: THREE.Object3D,
    wheels: THREE.Object3D[],
    private ground: Sampler,
    private clearApproach: (surface: BusRampSurface) => boolean,
    private groundTriangles?: GroundTriangles,
  ) {
    this.rootPose = capture(root);
    this.rampPose = capture(ramp);
    this.wheels = wheels.map(capture);
    this.rampInRoot = root.matrixWorld
      .clone()
      .invert()
      .multiply(ramp.matrixWorld);
  }
  static create(
    root: THREE.Object3D,
    value: unknown,
    ground: Sampler,
    clearApproach: (surface: BusRampSurface) => boolean = () => true,
    groundTriangles?: GroundTriangles,
  ): BusAccessibility | null {
    const rig = metadata(value);
    if (!rig) return null;
    root.updateWorldMatrix(true, true);
    const names = [rig.rampName, ...rig.wheelNames],
      nodes: THREE.Object3D[] = [];
    for (const name of names) {
      const matches: THREE.Object3D[] = [];
      root.traverse((node) => {
        if (node.name === name) matches.push(node);
      });
      if (matches.length !== 1 || !matches[0].parent) return null;
      nodes.push(matches[0]);
    }
    const frame = root.matrixWorld
      .clone()
      .invert()
      .multiply(nodes[0].matrixWorld);
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    frame.decompose(p, q, s);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(root.matrixWorld);
    const scale = root.getWorldScale(new THREE.Vector3());
    if (
      p.distanceTo(new THREE.Vector3(...rig.hinge)) > 0.003 ||
      q.angleTo(new THREE.Quaternion()) > 1e-5 ||
      s.distanceTo(new THREE.Vector3(1, 1, 1)) > 1e-5 ||
      up.distanceTo(new THREE.Vector3(0, 1, 0)) > 1e-5 ||
      scale.distanceTo(new THREE.Vector3(1, 1, 1)) > 1e-5
    )
      return null;
    return new BusAccessibility(
      root,
      rig,
      nodes[0],
      nodes.slice(1),
      ground,
      clearApproach,
      groundTriangles,
    );
  }
  get moving() {
    return this.phase !== 'stowed' && this.phase !== 'deployed';
  }
  get stowed() {
    return this.phase === 'stowed';
  }
  /** Parking preference only: reuse endpoint/support validation without
   * animating the bus or inspecting a closed cabin's deployment sweep. */
  landingFits() {
    if (this.disposed || !this.stowed) return false;
    const previousError = this.error;
    const fits = this.plan(false) !== null;
    this.error = previousError;
    return fits;
  }
  blocksGround(x: number, z: number) {
    return (
      !this.stowed && !!this.landing && rampContainsPoint(this.landing, x, z)
    );
  }
  get aligned() {
    this.root.updateWorldMatrix(true, false);
    const expected = this.rootPose.world.clone();
    expected.elements[13] -= this.drop;
    return expected.elements.every(
      (v, i) => Math.abs(v - this.root.matrixWorld.elements[i]) < 1e-5,
    );
  }
  snapshot(): BusAccessibilitySnapshot {
    return {
      phase: this.phase,
      moving: this.moving,
      bodyDropM: this.drop,
      rampAngleRad: this.angle,
      error: this.error,
      surface:
        this.phase === 'deployed' && this.landing
          ? {
              ...this.landing,
              verticesM: this.landing.verticesM.map((p) => [
                ...p,
              ]) as BusRampSurface['verticesM'],
              normal: [...this.landing.normal],
            }
          : null,
      representative: true,
      notFleetCertification: true,
    };
  }
  deploy(frontOpen: boolean) {
    if (this.disposed || this.phase !== 'stowed') return false;
    this.error = null;
    if (!frontOpen) return this.reject('front-door-closed');
    if (!this.aligned) return this.reject('bus-moved');
    // Capture the real, already parked wheel poses for each new cycle.
    this.root.updateWorldMatrix(true, true);
    this.rootPose = capture(this.root);
    this.rampPose = capture(this.rampPose.node);
    this.wheels = this.wheels.map((pose) => capture(pose.node));
    this.rampInRoot = this.root.matrixWorld
      .clone()
      .invert()
      .multiply(this.rampPose.node.matrixWorld);
    const plan = this.plan();
    if (!plan) return false;
    if (!this.clearApproach(plan.surface))
      return this.reject('clear-ramp-area');
    if (!this.sweepClear(plan.angle))
      return this.reject(this.error ?? 'ramp-obstructed');
    this.targetAngle = plan.angle;
    this.landing = plan.surface;
    this.phase = 'kneeling';
    this.elapsed = 0;
    return true;
  }
  stow(frontOpen: boolean) {
    if (this.disposed || this.phase !== 'deployed') return false;
    this.error = null;
    if (!frontOpen) return this.reject('front-door-closed');
    if (!this.aligned) return this.reject('bus-moved');
    this.phase = 'retracting';
    this.elapsed = 0;
    return true;
  }
  update(dt: number, frontOpen = true) {
    if (this.disposed || !this.moving) return false;
    const previousError = this.error;
    if (!frontOpen || !this.aligned) {
      this.error = frontOpen ? 'bus-moved' : 'front-door-closed';
      return previousError !== this.error;
    }
    this.error = null;
    const phase = this.phase;
    this.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    const duration = phase === 'kneeling' || phase === 'raising' ? 0.8 : 1.2;
    const progress = Math.min(1, this.elapsed / duration),
      eased = smooth(progress);
    if (phase === 'kneeling') this.apply(this.rig.drop * eased, 0);
    if (phase === 'deploying')
      this.apply(this.rig.drop, this.targetAngle * eased);
    if (phase === 'retracting')
      this.apply(this.rig.drop, this.targetAngle * (1 - eased));
    if (phase === 'raising') this.apply(this.rig.drop * (1 - eased), 0);
    if (progress === 1) {
      this.phase = (
        {
          kneeling: 'deploying',
          deploying: 'deployed',
          retracting: 'raising',
          raising: 'stowed',
        } as const
      )[phase as 'kneeling' | 'deploying' | 'retracting' | 'raising'];
      this.elapsed = 0;
      if (this.phase === 'stowed') {
        // Release the temporary affine wheel locks so normal transforms work
        // again between cycles, including wheel animation or a new parked pose.
        restore(this.rootPose);
        restore(this.rampPose);
        this.wheels.forEach(restore);
        this.root.updateWorldMatrix(true, true);
        this.landing = null;
      }
    }
    return phase !== this.phase || previousError !== this.error;
  }
  /** Cleanup is immediate, but always folds at the lowered pose before raising. */
  reset() {
    this.apply(this.drop, 0);
    restore(this.rootPose);
    restore(this.rampPose);
    this.wheels.forEach(restore);
    this.root.updateWorldMatrix(true, true);
    this.drop = this.angle = this.elapsed = 0;
    this.phase = 'stowed';
    this.error = null;
    this.landing = null;
  }
  dispose() {
    if (!this.disposed) {
      this.reset();
      this.disposed = true;
    }
  }
  private reject(error: BusAccessibilityError) {
    this.error = error;
    return false;
  }
  private apply(drop: number, angle: number) {
    const world = new THREE.Vector3().setFromMatrixPosition(
      this.rootPose.world,
    );
    world.y -= drop;
    this.root.parent?.updateWorldMatrix(true, false);
    this.root.position.copy(
      this.root.parent ? this.root.parent.worldToLocal(world) : world,
    );
    this.root.updateMatrix();
    this.root.updateWorldMatrix(true, true);
    for (const pose of this.wheels) {
      if (!pose.node.parent) continue;
      const matrix = pose.node.parent.matrixWorld
        .clone()
        .invert()
        .multiply(pose.world);
      // Preserve full affine matrices, including transformed wheel parents.
      pose.node.matrixAutoUpdate = false;
      pose.node.matrix.copy(matrix);
      matrix.decompose(
        pose.node.position,
        pose.node.quaternion,
        pose.node.scale,
      );
    }
    this.rampPose.node.quaternion
      .copy(this.rampPose.quaternion)
      .multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          angle,
        ),
      );
    this.rampPose.node.updateMatrix();
    this.root.updateWorldMatrix(true, true);
    this.drop = drop;
    this.angle = angle;
  }
  private panel(angle: number, u: number, z: number) {
    const matrix = this.rootPose.world.clone();
    matrix.elements[13] -= this.rig.drop;
    return new THREE.Vector3(u, 0, this.rig.centerZ + z)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), angle)
      .applyMatrix4(this.rampInRoot)
      .applyMatrix4(matrix);
  }
  private floor(x: number, z: number) {
    const floor = this.ground(x, z);
    return floor &&
      Number.isFinite(floor.y) &&
      typeof floor.surfaceId === 'string' &&
      floor.surfaceId.length > 0 &&
      Number.isInteger(floor.layer)
      ? floor
      : null;
  }
  private plan(
    checkArc = true,
  ): { angle: number; surface: BusRampSurface } | null {
    const hinge = this.panel(0, 0, 0);
    let angle = Math.PI,
      landing: BusRampGround | null = null;
    for (let i = 0; i < 8; i++) {
      const end = this.panel(angle, this.rig.length, 0);
      landing = this.floor(end.x, end.z);
      if (!landing || !Number.isFinite(landing.y)) {
        this.reject('landing-unavailable');
        return null;
      }
      const drop = hinge.y - landing.y;
      // A representative operating envelope, not an accessibility certification.
      if (drop < -0.003 || drop > this.rig.length * Math.sin(Math.PI / 9)) {
        this.reject('landing-too-steep');
        return null;
      }
      angle = Math.PI + Math.asin(Math.max(0, drop) / this.rig.length);
    }
    if (!landing) return null;
    const half = this.rig.width / 2;
    const vertices = [
      this.panel(angle, 0, -half),
      this.panel(angle, 0, half),
      this.panel(angle, this.rig.length, half),
      this.panel(angle, this.rig.length, -half),
    ];
    const outward = vertices[2]
      .clone()
      .add(vertices[3])
      .multiplyScalar(0.5)
      .sub(hinge)
      .setY(0)
      .normalize();
    for (const z of [-half, 0, half]) {
      const end = this.panel(angle, this.rig.length, z);
      for (const beyond of [0, 0.08, 0.18]) {
        const p = end.clone().addScaledVector(outward, beyond),
          floor = this.floor(p.x, p.z);
        if (
          !floor ||
          floor.surfaceId !== landing.surfaceId ||
          floor.layer !== landing.layer ||
          Math.abs(floor.y - end.y) > 0.003
        ) {
          this.reject('landing-uneven');
          return null;
        }
      }
    }
    // Sample the complete deployment arc and deck width against real ground.
    // This rejects a raised curb penetrating the deck before its landing edge.
    for (let i = 0; checkArc && i <= 48; i++)
      for (const u of [0.15, 0.4, 0.7, 1])
        for (const z of [-half, 0, half]) {
          const p = this.panel((angle * i) / 48, this.rig.length * u, z);
          const floor = this.floor(p.x, p.z);
          if (!floor || floor.y > p.y + 0.003) {
            this.reject('ramp-obstructed');
            return null;
          }
        }
    const normal = vertices[1]
      .clone()
      .sub(vertices[0])
      .cross(vertices[3].clone().sub(vertices[0]))
      .normalize();
    if (normal.y < 0) normal.negate();
    return {
      angle,
      surface: {
        frameId: 'world',
        verticesM: vertices.map(point) as BusRampSurface['verticesM'],
        normal: point(normal),
        landingSurfaceId: landing.surfaceId,
        landingLayer: landing.layer,
        walkingEnabled: false,
      },
    };
  }
  private sweepClear(angle: number) {
    // Restrict the actual triangle set to the front ramp's swept volume once
    // per request. Do not raycast the full 278k-triangle cabin every frame.
    this.root.updateWorldMatrix(true, true);
    const region = new THREE.Box3().setFromPoints([
      new THREE.Vector3(
        this.rig.hinge[0] - this.rig.length - 0.02,
        this.rig.hinge[1] - 0.4,
        this.rig.hinge[2] + this.rig.centerZ - this.rig.width / 2 - 0.01,
      ),
      new THREE.Vector3(
        this.rig.hinge[0] + this.rig.length + 0.02,
        this.rig.hinge[1] + this.rig.length + 0.02,
        this.rig.hinge[2] + this.rig.centerZ + this.rig.width / 2 + 0.01,
      ),
    ]);
    let blocked = false;
    const inverse = this.root.matrixWorld.clone().invert();
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      box = new THREE.Box3();
    this.root.traverse((node) => {
      if (blocked) return;
      if (!(node instanceof THREE.Mesh)) return;
      for (let p: THREE.Object3D | null = node; p; p = p.parent)
        if (p === this.rampPose.node) return;
      const geometry = node.geometry,
        vertex = geometry.getAttribute('position');
      if (!vertex) return;
      const matrix = inverse.clone().multiply(node.matrixWorld),
        index = geometry.index;
      const surfaceId = !Array.isArray(node.material)
        ? String(node.material.userData.shared_surface_id)
        : '';
      for (let i = 0; i + 2 < (index?.count ?? vertex.count); i += 3) {
        a.fromBufferAttribute(vertex, index ? index.getX(i) : i).applyMatrix4(
          matrix,
        );
        b.fromBufferAttribute(
          vertex,
          index ? index.getX(i + 1) : i + 1,
        ).applyMatrix4(matrix);
        c.fromBufferAttribute(
          vertex,
          index ? index.getX(i + 2) : i + 2,
        ).applyMatrix4(matrix);
        box.setFromPoints([a, b, c]);
        // The retained cassette is an 8 mm floor finish with a 10.5 mm-high
        // edge marking. Exact authored component ranges include their tiny
        // perimeter bevels; only initial <=.12 rad contact is permissible.
        // These are representative simulation tolerances, not certification.
        const cassette =
          surfaceId === 'bus-v2-rubber' &&
          box.min.x >= -1.0805 &&
          box.max.x <= -0.4595 &&
          box.min.y >= 0.3595 &&
          box.max.y <= 0.3685 &&
          box.min.z >= 4.1245 &&
          box.max.z <= 5.0755;
        const marking =
          surfaceId === 'bus-v2-marking' &&
          box.min.y >= 0.367 &&
          box.max.y <= 0.371 &&
          box.min.x >= -1.0705 &&
          box.max.x <= -0.4695 &&
          ((box.min.z >= 4.1255 && box.max.z <= 4.1445) ||
            (box.min.z >= 5.0555 && box.max.z <= 5.0745));
        const entryEdge =
          surfaceId === 'bus-v2-marking' &&
          box.min.x >= -1.1425 &&
          box.max.x <= -1.0815 &&
          box.min.y >= 0.3595 &&
          box.max.y <= 0.3685 &&
          box.min.z >= 3.9995 &&
          box.max.z <= 5.2005;
        const stowFinish = cassette || marking || entryEdge;
        if (box.intersectsBox(region)) {
          if (
            intersectsSector(
              [a, b, c],
              this.rig,
              stowFinish ? 0.12 : 1e-5,
              angle,
            )
          ) {
            blocked = true;
            return;
          }
        }
      }
    });
    if (blocked) return false;
    const lowered = this.rootPose.world.clone();
    lowered.elements[13] -= this.rig.drop;
    const triangles = this.groundTriangles?.(
      region.clone().applyMatrix4(lowered),
    );
    if (!triangles) {
      this.reject('landing-unavailable');
      return false;
    }
    const groundToLocal = lowered.clone().invert();
    for (const triangle of triangles) {
      // Match the 3 mm authored surface-contact tolerance at the landing edge.
      const local = triangle.map((p) =>
        p
          .clone()
          .add(new THREE.Vector3(0, -0.003, 0))
          .applyMatrix4(groundToLocal),
      ) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      if (intersectsSector(local, this.rig, 1e-5, angle)) return false;
    }
    return true;
  }
}

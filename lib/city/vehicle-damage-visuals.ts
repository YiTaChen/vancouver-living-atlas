import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { installRoadsterFormGeometry } from './assets/roadster-form';

type Triple = readonly [number, number, number];
export interface VehicleDamageMark {
  /** Approximate impact position in the vehicle root's metres, +Z forward. */
  localPoint: Triple;
  /** Vehicle-body outward normal, NOT the obstacle's outward normal. */
  localNormal: Triple;
  severity: number;
  scrape: boolean;
  seed?: number;
}
export interface VehicleDamageVisualOptions {
  maxMarks?: number;
  maxDentDepthM?: number;
  filter?: (mesh: THREE.Mesh) => boolean;
}
type DentGeometry = {
  original: THREE.BufferGeometry;
  geometry: THREE.BufferGeometry;
  positions: Float32Array;
  normals: Float32Array;
  addedVertices: number;
  addedTriangles: number;
  refinedMarks: Set<VehicleDamageMark>;
};
type Projection = {
  mark: VehicleDamageMark;
  mesh: THREE.Mesh;
  point: THREE.Vector3;
  normal: THREE.Vector3;
};

const MAX_OWNED_MESHES = 18;
const MAX_MARK_TRIANGLES = 4096;
const MAX_REFINED_MESH_TRIANGLES = 384;
const MAX_REFINED_MESH_VERTICES = 1152;
const MAX_REFINED_TRIANGLES = 2048;
const MAX_REFINED_VERTICES = 6144;
const REFINEMENT_EDGE_M = 0.18;
// Gameplay hull contacts can sit above a low bumper and beyond its nose. The
// original Drive roadster's measured front hull contact is26.1cm from its real
// paint surface. This visual-only bound never changes physical collision rules.
const MAX_CONTACT_SNAP_M = 0.4;
const finiteTriple = (point: Triple) =>
  point?.length === 3 && point.every(Number.isFinite);
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

// DecalGeometry linearly clips normals with positions. Encode each source
// vertex's scalar Y displacement as a near-vertical unit direction, then decode
// after clipping: the resulting decal target follows the same painted triangle
// rather than re-evaluating a nonlinear form at each newly clipped vertex.
const FORM_ENCODING_SCALE = 10;
function encodedFormNormals(geometry: THREE.BufferGeometry) {
  const target = geometry.morphAttributes.position?.[0];
  if (!target || target.count !== geometry.getAttribute('position').count)
    throw new Error('Roadster damage requires the current body morph target');
  const data = new Float32Array(target.count * 3);
  for (let i = 0; i < target.count; i++) {
    data[i * 3] = target.getY(i) / FORM_ENCODING_SCALE;
    data[i * 3 + 1] = 1;
  }
  return new THREE.BufferAttribute(data, 3);
}

function bodyMesh(mesh: THREE.Mesh) {
  if (mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.SkinnedMesh)
    return false;
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  if (
    !materials.length ||
    materials.some(
      (material) =>
        !(material instanceof THREE.MeshStandardMaterial) ||
        material.transparent ||
        /rubber|glass|display|suede|leather/i.test(
          `${material.name} ${material.userData.semantic_role ?? ''}`,
        ),
    )
  )
    return false;
  for (let object: THREE.Object3D | null = mesh; object; object = object.parent)
    if (
      object.userData.vehicleDamageIgnore ||
      /wheel|steer|yoke|fan|jet|cockpit/i.test(object.name)
    )
      return false;
  // The legacy classic car's wheels do not carry semantic names.
  return !/CylinderGeometry|TorusGeometry/.test(mesh.geometry.type);
}

/** One bounded, texture-free surface-mark draw and inward visual dents per
 * personal car. Collision shapes are never modified. Source geometry/materials
 * are retained and restored before their owner is disposed.
 *
 * record() and explicit refresh() do all mesh inspection/geometry work. Call
 * refresh after a model/LOD visibility switch; idle update() does no traversal,
 * raycasting, allocation or buffer upload. The same capped history is replayed
 * against the newly visible geometry, so damage survives High/Low/Auto changes.
 */
export class VehicleDamageVisuals {
  readonly group = new THREE.Group();
  readonly marks: VehicleDamageMark[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly owned = new Map<THREE.Mesh, DentGeometry>();
  private readonly ray = new THREE.Raycaster();
  private readonly capacity: number;
  private readonly maxDepth: number;
  private readonly filter: (mesh: THREE.Mesh) => boolean;
  private readonly roadsterPaint?: THREE.Mesh;
  private disposed = false;
  private rebuilds = 0;
  private dentedVertices = 0;

  constructor(
    private readonly root: THREE.Group,
    options: VehicleDamageVisualOptions = {},
  ) {
    const roadsterPaint = root.getObjectByName('roadster/paint');
    if (
      roadsterPaint instanceof THREE.Mesh &&
      roadsterPaint.geometry.morphAttributes.position?.length === 1
    )
      this.roadsterPaint = roadsterPaint;
    this.capacity = Math.floor(
      clamp(Number.isFinite(options.maxMarks) ? options.maxMarks! : 20, 1, 24),
    );
    this.maxDepth = clamp(
      Number.isFinite(options.maxDentDepthM) ? options.maxDentDepthM! : 0.075,
      0,
      0.1,
    );
    this.filter = options.filter ?? bodyMesh;
    this.group.name = 'Bounded vehicle surface damage';
    this.group.userData.vehicleDamageIgnore = true;
    this.material = new THREE.MeshStandardMaterial({
      color: 0x949b9b,
      metalness: 0.5,
      roughness: 0.81,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.FrontSide,
    });
    this.material.name = 'Procedural exposed-metal scratches';
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute vec3 impactMark; varying vec3 vImpactMark; varying vec2 vImpactUv;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvImpactMark=impactMark; vImpactUv=uv;',
      );
      shader.fragmentShader =
        'varying vec3 vImpactMark; varying vec2 vImpactUv;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
 vec2 impactP=vImpactUv-.5;
 float impactGrain=sin(impactP.x*111.0+vImpactMark.z*13.0)*.014;
 float impactLines=abs(sin((impactP.y+impactGrain)*91.0+vImpactMark.z*17.0));
 float impactScratch=1.0-smoothstep(.12,.3,impactLines);
 float impactEdge=(1.0-smoothstep(.26,.5,abs(impactP.x))) * (1.0-smoothstep(.27,.5,abs(impactP.y)));
 float impactScuff=(1.0-smoothstep(.12,.46,length(impactP*vec2(.75,1.2))))*.42*(1.0-vImpactMark.y*.5);
 float impactAlpha=impactEdge*max(impactScratch*.9,impactScuff)*(.35+.65*vImpactMark.x);
 if(impactAlpha<.035)discard;
 diffuseColor.rgb*=mix(vec3(.13,.145,.15),vec3(1.04,1.07,1.08),impactScratch);
 diffuseColor.a*=impactAlpha;`,
      );
    };
    this.material.customProgramCacheKey = () => 'vehicle-surface-damage-v1';
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.onBeforeRender = () => {
      if (this.mesh.morphTargetInfluences?.length)
        this.mesh.morphTargetInfluences[0] =
          this.roadsterPaint?.morphTargetInfluences?.[0] ?? 0;
    };
    this.mesh.name = 'Surface-clipped vehicle scratches';
    this.mesh.userData.excludeFromSSAO = true;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    root.add(this.group);
  }

  private bodies() {
    const result: THREE.Mesh[] = [];
    const visit = (object: THREE.Object3D) => {
      if (
        object instanceof THREE.Mesh &&
        object !== this.mesh &&
        object.geometry.getAttribute('position') &&
        this.filter(object)
      )
        result.push(object);
    };
    // Cockpit rendering hides the outer vehicle root. Its selected model still
    // receives damage; only hidden sibling variants/LODs must be excluded.
    for (const child of this.root.children)
      if (child !== this.group) child.traverseVisible(visit);
    return result;
  }

  private project(
    mark: VehicleDamageMark,
    bodies: THREE.Mesh[],
  ): Projection | null {
    // Physical collision and the authored damage projection use the original
    // body. Decals later receive the same native morph target as the paint.
    const influences = this.roadsterPaint?.morphTargetInfluences;
    const weight = influences?.[0];
    if (influences) influences[0] = 0;
    try {
      return this.projectUndeformed(mark, bodies);
    } finally {
      if (influences && weight !== undefined) influences[0] = weight;
    }
  }

  private projectUndeformed(
    mark: VehicleDamageMark,
    bodies: THREE.Mesh[],
  ): Projection | null {
    const point = new THREE.Vector3().fromArray(mark.localPoint),
      normal = new THREE.Vector3().fromArray(mark.localNormal).normalize(),
      worldPoint = this.root.localToWorld(point.clone()),
      worldNormal = normal.clone().transformDirection(this.root.matrixWorld);
    this.ray.set(
      worldPoint.addScaledVector(worldNormal, 0.85),
      worldNormal.negate(),
    );
    this.ray.near = 0;
    this.ray.far = 1.7;
    const hit = this.ray.intersectObjects(bodies, false)[0];
    if (!hit?.face || !(hit.object instanceof THREE.Mesh))
      return this.nearestSurface(mark, bodies);
    const hitNormal = hit.face.normal
      .clone()
      .applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
      )
      .applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(
          this.root.matrixWorld.clone().invert(),
        ),
      )
      .normalize();
    if (hitNormal.dot(normal) < 0.25) return this.nearestSurface(mark, bodies);
    return {
      mark,
      mesh: hit.object,
      point: this.root.worldToLocal(hit.point.clone()),
      normal: hitNormal,
    };
  }

  /** A narrow panel may move completely off the original ray during denting,
   * or sit below the conservative hull's contact centre. Snap only to a real,
   * facing triangle within40cm; never create a hovering rectangle where no
   * body surface exists. This slow path runs on events only. */
  private nearestSurface(
    mark: VehicleDamageMark,
    bodies: THREE.Mesh[],
  ): Projection | null {
    const target = new THREE.Vector3().fromArray(mark.localPoint),
      outward = new THREE.Vector3().fromArray(mark.localNormal),
      toRoot = this.root.matrixWorld.clone().invert(),
      triangle = new THREE.Triangle(),
      closest = new THREE.Vector3(),
      normal = new THREE.Vector3();
    let distanceSq = MAX_CONTACT_SNAP_M ** 2,
      alignment = -Infinity,
      result: Projection | null = null;
    for (const mesh of bodies) {
      const transform = toRoot.clone().multiply(mesh.matrixWorld),
        p = mesh.geometry.getAttribute('position'),
        index = mesh.geometry.index,
        count = index?.count ?? p.count;
      for (let i = 0; i < count; i += 3) {
        triangle.a
          .fromBufferAttribute(p, index ? index.getX(i) : i)
          .applyMatrix4(transform);
        triangle.b
          .fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1)
          .applyMatrix4(transform);
        triangle.c
          .fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2)
          .applyMatrix4(transform);
        triangle.getNormal(normal);
        const candidateAlignment = normal.dot(outward);
        if (candidateAlignment < 0.25) continue;
        triangle.closestPointToPoint(target, closest);
        const candidate = closest.distanceToSquared(target);
        if (
          candidate < distanceSq - 1e-8 ||
          (Math.abs(candidate - distanceSq) <= 1e-8 &&
            candidateAlignment > alignment)
        ) {
          distanceSq = candidate;
          alignment = candidateAlignment;
          result = {
            mark,
            mesh,
            point: closest.clone(),
            normal: normal.clone(),
          };
        }
      }
    }
    return result;
  }

  record(event: VehicleDamageMark) {
    if (
      this.disposed ||
      !finiteTriple(event.localPoint) ||
      !finiteTriple(event.localNormal) ||
      !Number.isFinite(event.severity) ||
      event.severity <= 0 ||
      new THREE.Vector3().fromArray(event.localNormal).lengthSq() < 1e-8
    )
      return false;
    const mark: VehicleDamageMark = {
      localPoint: [...event.localPoint],
      localNormal: new THREE.Vector3()
        .fromArray(event.localNormal)
        .normalize()
        .toArray(),
      severity: clamp(event.severity),
      scrape: !!event.scrape,
      seed: Number.isFinite(event.seed) ? event.seed : this.rebuilds + 1,
    };
    this.root.updateWorldMatrix(true, true);
    if (!this.project(mark, this.bodies())) return false;
    this.marks.push(mark);
    if (this.marks.length > this.capacity) this.marks.shift();
    this.refresh();
    return true;
  }

  private own(mesh: THREE.Mesh): DentGeometry | null {
    const previous = this.owned.get(mesh);
    if (previous) return previous;
    if (this.owned.size >= MAX_OWNED_MESHES) return null;
    const original = mesh.geometry;
    const geometry = original.clone();
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const entry = {
      original,
      geometry,
      positions: new Float32Array(geometry.getAttribute('position').array),
      normals: new Float32Array(geometry.getAttribute('normal').array),
      addedVertices: 0,
      addedTriangles: 0,
      refinedMarks: new Set<VehicleDamageMark>(),
    };
    mesh.geometry = geometry;
    this.owned.set(mesh, entry);
    return entry;
  }

  /** Refine only long triangles touching a real impact volume. A large merged
   * Tesla batch can contain a two-triangle trim strip even at High. Whole-batch
   * subdivision would be both expensive and unrelated to the hit.
   *
   * Every attribute is interpolated; indexed/nonindexed topology, material
   * groups and drawRange remain represented. Unsupported interleaved, FP16 or
   * morph layouts keep their original topology rather than losing attributes.
   */
  private refine(
    mesh: THREE.Mesh,
    entry: DentGeometry,
    projections: Projection[],
  ) {
    const pending = projections.filter(
      ({ mark }) => !entry.refinedMarks.has(mark),
    );
    if (!pending.length) return;
    const geometry = entry.geometry,
      attributes = Object.entries(geometry.attributes);
    if (
      (Object.keys(geometry.morphAttributes).length > 0 &&
        mesh !== this.roadsterPaint) ||
      attributes.some(
        ([, attribute]) =>
          !(attribute instanceof THREE.BufferAttribute) ||
          attribute instanceof THREE.Float16BufferAttribute ||
          attribute.count !== geometry.getAttribute('position').count,
      ) ||
      geometry.groups.some(({ start, count }) => start % 3 || count % 3) ||
      geometry.drawRange.start % 3 ||
      (Number.isFinite(geometry.drawRange.count) &&
        geometry.drawRange.count % 3)
    )
      return;
    pending.forEach(({ mark }) => entry.refinedMarks.add(mark));
    const owned = [...this.owned.values()],
      totalVertices = owned.reduce(
        (sum, value) => sum + value.addedVertices,
        0,
      ),
      totalTriangles = owned.reduce(
        (sum, value) => sum + value.addedTriangles,
        0,
      ),
      indexed = geometry.index !== null,
      vertexCost = indexed ? 1 : 6,
      limit = Math.floor(
        Math.min(
          (MAX_REFINED_MESH_TRIANGLES - entry.addedTriangles) / 2,
          (MAX_REFINED_TRIANGLES - totalTriangles) / 2,
          (MAX_REFINED_MESH_VERTICES - entry.addedVertices) / vertexCost,
          (MAX_REFINED_VERTICES - totalVertices) / vertexCost,
        ),
      );
    if (limit <= 0) return;
    const toRoot = this.root.matrixWorld
        .clone()
        .invert()
        .multiply(mesh.matrixWorld),
      raw = new Map(
        attributes.map(([name, attribute]) => [
          name,
          Array.from((attribute as THREE.BufferAttribute).array),
        ]),
      ),
      position = raw.get('position')!,
      sourceCount =
        geometry.index?.count ?? geometry.getAttribute('position').count,
      output: number[] = [],
      prefix: number[] = [],
      triangle = new THREE.Triangle(),
      closest = new THREE.Vector3(),
      projected = new THREE.Vector3(),
      delta = new THREE.Vector3(),
      barycentric = new THREE.Vector3(),
      bestPoint = new THREE.Vector3();
    let splits = 0;
    const point = (index: number, target: THREE.Vector3) =>
      target.fromArray(position, index * 3).applyMatrix4(toRoot);
    const nearbyPoint = () => {
      let bestDistance = Infinity;
      for (const { point: center, normal, mark } of pending) {
        triangle.closestPointToPoint(center, closest);
        delta.copy(closest).sub(center);
        const axial = delta.dot(normal);
        if (Math.abs(axial) > 0.16) continue;
        projected.copy(delta).addScaledVector(normal, -axial);
        const distance = delta.lengthSq();
        if (
          projected.lengthSq() < (0.24 + mark.severity * 0.42) ** 2 &&
          distance < bestDistance
        ) {
          bestDistance = distance;
          bestPoint.copy(closest);
        }
      }
      return bestDistance < Infinity;
    };
    const split = (a: number, b: number, c: number) => {
      point(a, triangle.a);
      point(b, triangle.b);
      point(c, triangle.c);
      const edges = [
          triangle.a.distanceToSquared(triangle.b),
          triangle.b.distanceToSquared(triangle.c),
          triangle.c.distanceToSquared(triangle.a),
        ],
        longest = Math.max(...edges);
      if (
        splits >= limit ||
        longest <= REFINEMENT_EDGE_M ** 2 ||
        !nearbyPoint() ||
        Math.min(
          triangle.a.distanceToSquared(bestPoint),
          triangle.b.distanceToSquared(bestPoint),
          triangle.c.distanceToSquared(bestPoint),
        ) <=
          REFINEMENT_EDGE_M ** 2
      ) {
        output.push(a, b, c);
        return;
      }
      if (!triangle.getBarycoord(bestPoint, barycentric)) {
        output.push(a, b, c);
        return;
      }
      // Strictly interior insertion leaves every original shared edge intact.
      // An independently refined neighbor therefore cannot form a T-junction,
      // even when either mesh/global budget runs out halfway through a panel.
      barycentric.set(
        Math.max(0.06, barycentric.x),
        Math.max(0.06, barycentric.y),
        Math.max(0.06, barycentric.z),
      );
      barycentric.divideScalar(barycentric.x + barycentric.y + barycentric.z);
      const midpoint = position.length / 3;
      for (const [name, attribute] of attributes) {
        const values = raw.get(name)!;
        for (let component = 0; component < attribute.itemSize; component++) {
          const base = values[a * attribute.itemSize + component];
          values.push(
            base +
              (values[b * attribute.itemSize + component] - base) *
                barycentric.y +
              (values[c * attribute.itemSize + component] - base) *
                barycentric.z,
          );
        }
      }
      splits++;
      output.push(a, b, midpoint, b, c, midpoint, c, a, midpoint);
    };
    for (let offset = 0; offset < sourceCount; offset += 3) {
      prefix.push(output.length);
      const a = geometry.index ? geometry.index.getX(offset) : offset,
        b = geometry.index ? geometry.index.getX(offset + 1) : offset + 1,
        c = geometry.index ? geometry.index.getX(offset + 2) : offset + 2;
      if (
        offset < geometry.drawRange.start ||
        offset >= geometry.drawRange.start + geometry.drawRange.count
      )
        output.push(a, b, c);
      else split(a, b, c);
    }
    prefix.push(output.length);
    if (!splits) return;
    const next = geometry.clone();
    for (const [name, source] of attributes) {
      const attribute = source as THREE.BufferAttribute,
        values = raw.get(name)!,
        expanded = indexed
          ? values
          : output.flatMap((index) =>
              values.slice(
                index * attribute.itemSize,
                (index + 1) * attribute.itemSize,
              ),
            ),
        ArrayType = attribute.array.constructor as new (
          values: number[],
        ) => typeof attribute.array,
        data = new THREE.BufferAttribute(
          new ArrayType(expanded),
          attribute.itemSize,
          attribute.normalized,
        );
      data.name = attribute.name;
      data.usage = attribute.usage;
      data.gpuType = attribute.gpuType;
      next.setAttribute(name, attribute.clone().copy(data));
    }
    if (indexed) {
      const source = geometry.index!,
        needs32 =
          source.array instanceof Uint32Array || position.length / 3 > 65535,
        data = new THREE.BufferAttribute(
          needs32 ? new Uint32Array(output) : new Uint16Array(output),
          1,
        );
      data.name = source.name;
      data.usage = source.usage;
      data.gpuType = source.gpuType;
      next.setIndex(data);
    }
    const mapped = (offset: number) =>
      prefix[Math.min(prefix.length - 1, offset / 3)];
    next.clearGroups();
    for (const group of geometry.groups)
      next.addGroup(
        mapped(group.start),
        mapped(group.start + group.count) - mapped(group.start),
        group.materialIndex,
      );
    next.setDrawRange(
      mapped(geometry.drawRange.start),
      Number.isFinite(geometry.drawRange.count)
        ? mapped(geometry.drawRange.start + geometry.drawRange.count) -
            mapped(geometry.drawRange.start)
        : Infinity,
    );
    entry.addedVertices +=
      next.getAttribute('position').count -
      geometry.getAttribute('position').count;
    entry.addedTriangles += splits * 2;
    entry.geometry = next;
    entry.positions = new Float32Array(next.getAttribute('position').array);
    entry.normals = new Float32Array(next.getAttribute('normal').array);
    mesh.geometry = next;
    geometry.dispose();
  }

  private dent(mesh: THREE.Mesh, projections: Projection[]) {
    const entry = this.own(mesh);
    if (!entry) return;
    this.refine(mesh, entry, projections);
    const rootInverse = this.root.matrixWorld.clone().invert(),
      toRoot = rootInverse.clone().multiply(mesh.matrixWorld),
      toMesh = toRoot.clone().invert(),
      position = mesh.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute,
      normal = mesh.geometry.getAttribute('normal') as THREE.BufferAttribute,
      point = new THREE.Vector3(),
      offset = new THREE.Vector3(),
      delta = new THREE.Vector3();
    let dentedVertices = 0;
    for (let i = 0; i < position.count; i++) {
      point.fromArray(entry.positions, i * 3).applyMatrix4(toRoot);
      offset.set(0, 0, 0);
      for (const projection of projections) {
        // Equal-position seams and both faces of a thin trim bar receive the
        // same displacement, irrespective of their shading normal. The16cm
        // axial volume still excludes the opposite side of the vehicle.
        delta.copy(point).sub(projection.point);
        const axial = delta.dot(projection.normal);
        if (Math.abs(axial) > 0.16) continue;
        const radius = 0.24 + projection.mark.severity * 0.42,
          distance = delta.addScaledVector(projection.normal, -axial).length();
        if (distance >= radius) continue;
        const falloff = (1 - (distance / radius) ** 2) ** 2,
          depth =
            this.maxDepth *
            projection.mark.severity *
            falloff *
            (projection.mark.scrape ? 0.3 : 1);
        offset.addScaledVector(projection.normal, -depth);
      }
      if (offset.lengthSq() > 0) {
        offset.clampLength(0, this.maxDepth);
        point.add(offset);
        dentedVertices++;
      }
      point.applyMatrix4(toMesh);
      position.setXYZ(i, point.x, point.y, point.z);
      normal.setXYZ(
        i,
        entry.normals[i * 3],
        entry.normals[i * 3 + 1],
        entry.normals[i * 3 + 2],
      );
    }
    // Back off the complete displacement field together, preserving coincident
    // seams, if severe/repeated hits would invert or collapse any source face.
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      oldNormal = new THREE.Vector3(),
      newNormal = new THREE.Vector3(),
      edge = new THREE.Vector3(),
      index = mesh.geometry.index;
    const preservesFaces = () => {
      for (let i = 0; i < (index?.count ?? position.count); i += 3) {
        const ia = index ? index.getX(i) : i,
          ib = index ? index.getX(i + 1) : i + 1,
          ic = index ? index.getX(i + 2) : i + 2;
        a.fromArray(entry.positions, ia * 3);
        b.fromArray(entry.positions, ib * 3);
        c.fromArray(entry.positions, ic * 3);
        oldNormal.subVectors(b, a).cross(edge.subVectors(c, a));
        const oldArea2 = oldNormal.lengthSq();
        if (oldArea2 < 1e-18) continue;
        a.fromBufferAttribute(position, ia);
        b.fromBufferAttribute(position, ib);
        c.fromBufferAttribute(position, ic);
        newNormal.subVectors(b, a).cross(edge.subVectors(c, a));
        if (oldNormal.dot(newNormal) <= oldArea2 * 0.05) return false;
      }
      return true;
    };
    let attempts = 0;
    while (!preservesFaces()) {
      for (let i = 0; i < position.count; i++)
        position.setXYZ(
          i,
          attempts < 6
            ? (position.getX(i) + entry.positions[i * 3]) * 0.5
            : entry.positions[i * 3],
          attempts < 6
            ? (position.getY(i) + entry.positions[i * 3 + 1]) * 0.5
            : entry.positions[i * 3 + 1],
          attempts < 6
            ? (position.getZ(i) + entry.positions[i * 3 + 2]) * 0.5
            : entry.positions[i * 3 + 2],
        );
      if (attempts++ >= 6) {
        dentedVertices = 0;
        break;
      }
    }
    this.dentedVertices += dentedVertices;
    position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    if (mesh === this.roadsterPaint) this.rebuildRoadsterForm(mesh, entry);
    else {
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  }

  /** Three caches native morph data in a texture per geometry. A damage event
   * rebuilds only the owned clone so the texture is refreshed; the immutable
   * source geometry and the current morph weight stay intact. */
  private rebuildRoadsterForm(mesh: THREE.Mesh, entry: DentGeometry) {
    const previous = mesh.geometry;
    const next = previous.clone();
    const weight = mesh.morphTargetInfluences?.[0] ?? 0;
    installRoadsterFormGeometry(next);
    mesh.geometry = next;
    entry.geometry = next;
    mesh.updateMorphTargets();
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[0] = weight;
    previous.dispose();
  }

  refresh() {
    if (this.disposed) return;
    this.root.updateWorldMatrix(true, true);
    const retained = new Set(this.marks);
    for (const entry of this.owned.values())
      for (const mark of entry.refinedMarks)
        if (!retained.has(mark)) entry.refinedMarks.delete(mark);
    // Always project from the undamaged datum, not progressively shifted dents.
    for (const { geometry, positions, normals } of this.owned.values()) {
      (geometry.getAttribute('position') as THREE.BufferAttribute).copyArray(
        positions,
      );
      (geometry.getAttribute('normal') as THREE.BufferAttribute).copyArray(
        normals,
      );
      (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
        true;
      (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate =
        true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    const bodies = this.bodies(),
      projections = this.marks.flatMap((mark) => {
        const projection = this.project(mark, bodies);
        return projection ? [projection] : [];
      }),
      byMesh = new Map<THREE.Mesh, Projection[]>();
    this.dentedVertices = 0;
    for (const projection of projections) {
      if (!byMesh.has(projection.mesh)) byMesh.set(projection.mesh, []);
      byMesh.get(projection.mesh)!.push(projection);
    }
    for (const [mesh, hits] of byMesh) this.dent(mesh, hits);
    if (this.roadsterPaint && !byMesh.has(this.roadsterPaint)) {
      const entry = this.owned.get(this.roadsterPaint);
      if (entry) this.rebuildRoadsterForm(this.roadsterPaint, entry);
    }
    const positions: number[] = [],
      normals: number[] = [],
      uv: number[] = [],
      marks: number[] = [],
      formDeltas: number[] = [],
      worldToRoot = this.root.matrixWorld.clone().invert(),
      normalToRoot = new THREE.Matrix3().getNormalMatrix(worldToRoot),
      point = new THREE.Vector3(),
      normal = new THREE.Vector3(),
      encodedNormal = new THREE.Vector3();
    const encoded = new Map<THREE.BufferGeometry, THREE.BufferAttribute>();
    let hasRoadsterMarks = false;
    for (const projection of [...projections].reverse()) {
      if (positions.length >= MAX_MARK_TRIANGLES * 9) break;
      // Project along the actual body normal after deforming. An oblique narrow
      // bumper strip can move below the original horizontal collision ray.
      const surface = this.project(
        {
          ...projection.mark,
          localPoint: projection.point.toArray(),
          localNormal: projection.normal.toArray(),
        },
        [projection.mesh],
      );
      if (!surface) continue;
      const worldNormal = surface.normal
          .clone()
          .transformDirection(this.root.matrixWorld),
        worldPoint = this.root.localToWorld(surface.point.clone()),
        orientation = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            worldNormal,
          ),
        ),
        size = 0.25 + surface.mark.severity * 0.52,
        geometry = new DecalGeometry(
          surface.mesh,
          worldPoint,
          orientation,
          new THREE.Vector3(
            size * (surface.mark.scrape ? 1.8 : 1),
            size * 0.65,
            0.14,
          ),
        ),
        p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal'),
        tex = geometry.getAttribute('uv');
      let formGeometry: DecalGeometry | undefined;
      let formNormals: THREE.BufferAttribute | undefined;
      if (surface.mesh === this.roadsterPaint) {
        hasRoadsterMarks = true;
        const source = surface.mesh.geometry;
        let packed = encoded.get(source);
        if (!packed) {
          packed = encodedFormNormals(source);
          encoded.set(source, packed);
        }
        const originalNormal = source.getAttribute('normal');
        source.setAttribute('normal', packed);
        try {
          formGeometry = new DecalGeometry(
            surface.mesh,
            worldPoint,
            orientation,
            new THREE.Vector3(
              size * (surface.mark.scrape ? 1.8 : 1),
              size * 0.65,
              0.14,
            ),
          );
        } catch (error) {
          geometry.dispose();
          throw error;
        } finally {
          source.setAttribute('normal', originalNormal);
        }
        formNormals = formGeometry.getAttribute(
          'normal',
        ) as THREE.BufferAttribute;
        if (!formNormals || formNormals.count !== p.count) {
          formGeometry.dispose();
          geometry.dispose();
          throw new Error(
            'Roadster damage morph clipping produced incompatible geometry',
          );
        }
      }
      for (let i = 0; i < p.count; i += 3) {
        if (positions.length >= MAX_MARK_TRIANGLES * 9) break;
        normal.fromBufferAttribute(n, i).applyNormalMatrix(normalToRoot);
        if (normal.dot(surface.normal) < 0.2) continue;
        for (let j = i; j < i + 3; j++) {
          normal.fromBufferAttribute(n, j).applyNormalMatrix(normalToRoot);
          point
            .fromBufferAttribute(p, j)
            .applyMatrix4(worldToRoot)
            .addScaledVector(normal, 0.0015);
          positions.push(point.x, point.y, point.z);
          normals.push(normal.x, normal.y, normal.z);
          uv.push(tex.getX(j), tex.getY(j));
          if (formNormals) {
            encodedNormal
              .fromBufferAttribute(formNormals, j)
              .applyNormalMatrix(normalToRoot);
            const lift =
              Math.abs(encodedNormal.y) > 1e-8
                ? (FORM_ENCODING_SCALE * encodedNormal.x) / encodedNormal.y
                : 0;
            formDeltas.push(0, lift, 0);
          } else formDeltas.push(0, 0, 0);
          marks.push(
            surface.mark.severity,
            surface.mark.scrape ? 1 : 0,
            (surface.mark.seed ?? 1) % 997,
          );
        }
      }
      formGeometry?.dispose();
      geometry.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute(
      'impactMark',
      new THREE.Float32BufferAttribute(marks, 3),
    );
    if (hasRoadsterMarks && positions.length)
      installRoadsterFormGeometry(geometry, new Float32Array(formDeltas));
    else geometry.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    if (hasRoadsterMarks && positions.length) this.mesh.updateMorphTargets();
    else {
      this.mesh.morphTargetInfluences = undefined;
      this.mesh.morphTargetDictionary = undefined;
    }
    this.mesh.visible = positions.length > 0;
    this.rebuilds++;
  }

  /** No per-frame scene inspection; deformation/marks settle at event time. */
  update(_dt: number) {}

  reset() {
    if (this.disposed) return;
    this.marks.length = 0;
    for (const [mesh, entry] of this.owned) {
      if (mesh.geometry === entry.geometry) mesh.geometry = entry.original;
      entry.geometry.dispose();
    }
    this.owned.clear();
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry();
    this.mesh.morphTargetInfluences = undefined;
    this.mesh.morphTargetDictionary = undefined;
    this.mesh.visible = false;
    this.dentedVertices = 0;
  }

  stats() {
    return {
      marks: this.marks.length,
      capacity: this.capacity,
      ownedMeshes: this.owned.size,
      maximumOwnedMeshes: MAX_OWNED_MESHES,
      refinedVertices: [...this.owned.values()].reduce(
        (sum, value) => sum + value.addedVertices,
        0,
      ),
      refinedTriangles: [...this.owned.values()].reduce(
        (sum, value) => sum + value.addedTriangles,
        0,
      ),
      maximumRefinedVertices: MAX_REFINED_VERTICES,
      maximumRefinedTriangles: MAX_REFINED_TRIANGLES,
      maximumRefinedMeshVertices: MAX_REFINED_MESH_VERTICES,
      maximumRefinedMeshTriangles: MAX_REFINED_MESH_TRIANGLES,
      refinementHistoryEntries: [...this.owned.values()].reduce(
        (sum, value) => sum + value.refinedMarks.size,
        0,
      ),
      maximumRefinementHistoryEntries: MAX_OWNED_MESHES * this.capacity,
      dentedVertices: this.dentedVertices,
      triangles: this.mesh.geometry.getAttribute('position')?.count / 3 || 0,
      maximumTriangles: MAX_MARK_TRIANGLES,
      draws: this.mesh.visible ? 1 : 0,
      textures: 0,
      rebuilds: this.rebuilds,
      disposed: this.disposed,
    };
  }

  /** Dispose BEFORE the asset owner, so its original geometries are restored. */
  dispose() {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}

import * as THREE from 'three';
import {
  OCCLUDER_MIN,
  OCCLUDER_MAX,
  occluderBounds,
  type TravelOcclusionPart,
} from './travel-occluder-bounds';

export type { TravelOcclusionPart } from './travel-occluder-bounds';

const MAX_LENGTH = 32;
const CACHE_KEY = '|travel-full-occluder-v2';
const PROJECT = '#include <project_vertex>';
const CLIPPING = '#include <clipping_planes_fragment>';
type Compile = THREE.Material['onBeforeCompile'];
type ProgramKey = THREE.Material['customProgramCacheKey'];
type Point = readonly [number, number, number];
type AttributeDefaults = Record<string, number[]>;
type MaterialWithDefaults = THREE.Material & {
  defaultAttributeValues?: AttributeDefaults;
};

export interface TravelOcclusionOptions {
  enabled?: boolean;
  /** World-space margin around the sightline, bounded to 0.05–1.8 metres. */
  radius?: number;
  subjectHeight?: number;
  /** Zero disables the effect; any positive value removes whole obstructions. */
  strength?: number;
  /** Permit a coincident camera/torso point, for explicit near-view callers. */
  firstPerson?: boolean;
}

export interface TravelOcclusionParts {
  mesh: THREE.Mesh;
  parts: readonly TravelOcclusionPart[];
}

interface Patch {
  material: THREE.Material;
  before: Compile;
  key: ProgramKey;
  compile: Compile;
  cacheKey: ProgramKey;
  release: () => void;
}
interface GeometryMetadata {
  min: THREE.BufferAttribute;
  max: THREE.BufferAttribute;
  previousMin:
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  previousMax:
    | THREE.BufferAttribute
    | THREE.InterleavedBufferAttribute
    | undefined;
  pieces: number;
  sourceParts: readonly TravelOcclusionPart[] | undefined;
  owners: Set<WeakRef<GeometryPatch>>;
  pendingDisposal: boolean;
  disposed: () => void;
}
interface GeometryPatch {
  metadata: GeometryMetadata;
  release: () => void;
}
// The geometry, not an individual camera controller, owns uploaded metadata.
// Weak keys allow detached source buffers to be collected without owner dispose.
const metadataByGeometry = new WeakMap<
  THREE.BufferGeometry,
  GeometryMetadata
>();

interface CoverageOptions {
  object?: THREE.Mesh;
  vertexIndex?: number;
  instanceId?: number;
  normalPass?: boolean;
}

/** Removes complete logical walls, roofs or instances that obstruct the chase
 * sightline. Classification is per vertex against the piece's local bounds,
 * then constant across every fragment of that piece: no hole, border or dither.
 * Metadata is prepared once; update never traverses or raycasts the city.
 * Original material/geometry ownership, collision, opacity and sorting remain.
 */
export class TravelOcclusion {
  private readonly roots: readonly THREE.Object3D[];
  private readonly patches = new Map<THREE.Material, Patch>();
  private readonly geometryPatches = new WeakMap<
    THREE.BufferGeometry,
    GeometryPatch
  >();
  private readonly geometryReferences = new Set<WeakRef<GeometryPatch>>();
  private readonly meshes = new WeakSet<THREE.Object3D>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly unsupported = new WeakSet<THREE.Material>();
  private readonly uniforms = {
    uTravelCutawayEnabled: { value: 0 },
    uTravelCutawayStart: { value: new THREE.Vector3() },
    uTravelCutawayEnd: { value: new THREE.Vector3() },
    // sightline margin, preserved floor Y
    uTravelOccluderShape: { value: new THREE.Vector2() },
  };
  private disposed = false;
  private meshCount = 0;
  private unsupportedCount = 0;
  private shaderFailures = 0;
  private updates = 0;
  private length = 0;
  private readonly added = (event: THREE.Object3DEventMap['childadded']) => {
    if (!this.disposed && allowedAncestors(event.child))
      this.visit(event.child);
  };
  private readonly removed = (
    event: THREE.Object3DEventMap['childremoved'],
  ) => {
    this.unwatch(event.child);
  };
  private readonly detached = (
    event: THREE.Event<'removed', THREE.Object3D>,
  ) => {
    this.unwatch(event.target);
  };

  constructor(
    roots: readonly THREE.Object3D[] = [],
    parts: readonly TravelOcclusionParts[] = [],
  ) {
    this.roots = roots;
    // GIS source spans must precede generic component discovery: adjacent city
    // buildings can touch, and the whole city deliberately shares one draw.
    for (const binding of parts)
      this.registerParts(binding.mesh, binding.parts);
    this.refresh();
  }

  /** Source vertex spans isolate logical objects inside a merged city mesh. */
  registerParts(mesh: THREE.Mesh, parts: readonly TravelOcclusionPart[]) {
    if (!this.disposed) this.prepareGeometry(mesh.geometry, parts);
  }

  refresh(additionalRoots: readonly THREE.Object3D[] = this.roots) {
    if (this.disposed) return;
    for (const root of additionalRoots)
      if (allowedAncestors(root)) this.visit(root);
  }

  /** Release listeners/references only; the resource owner disposes its assets.
   * Successful attachment to a watched parent automatically enrolls them again. */
  releaseSubtree(root: THREE.Object3D) {
    if (!this.disposed) this.unwatch(root);
  }

  private visit(object: THREE.Object3D) {
    if (excluded(object)) return;
    if (!this.watched.has(object)) {
      this.watched.add(object);
      object.addEventListener('childadded', this.added);
      object.addEventListener('childremoved', this.removed);
      object.addEventListener('removed', this.detached);
    }
    if (object instanceof THREE.Mesh && !groundSurface(object)) {
      if (!this.meshes.has(object)) {
        this.meshes.add(object);
        this.meshCount++;
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (materials.some(eligibleMaterial))
        this.prepareGeometry(object.geometry);
      for (const material of materials) this.patch(material);
    }
    for (const child of object.children) this.visit(child);
  }

  private prepareGeometry(
    geometry: THREE.BufferGeometry,
    parts?: readonly TravelOcclusionPart[],
  ) {
    const previous = this.geometryPatches.get(geometry);
    let metadata = metadataByGeometry.get(geometry);
    if (!metadata) {
      const bounds = occluderBounds(geometry, parts);
      const previousMin = geometry.getAttribute(OCCLUDER_MIN);
      const previousMax = geometry.getAttribute(OCCLUDER_MAX);
      geometry.setAttribute(OCCLUDER_MIN, bounds.min);
      geometry.setAttribute(OCCLUDER_MAX, bounds.max);
      // This closure owns only geometry/metadata, never a controller or city.
      const disposed = () => {
        state.pendingDisposal = true;
        for (const owner of state.owners) owner.deref()?.release();
        state.owners.clear();
        geometry.removeEventListener('dispose', disposed);
        // Our listener can precede Three's renderer listener. Every synchronous
        // handler must enumerate the uploaded attrs before they are restored.
        queueMicrotask(() => {
          // A new owner can synchronously re-enroll an already-disposed source
          // before this callback. Its future render reuploads these same attrs.
          if (!state.pendingDisposal) return;
          if (geometry.getAttribute(OCCLUDER_MIN) === state.min) {
            if (previousMin) geometry.setAttribute(OCCLUDER_MIN, previousMin);
            else geometry.deleteAttribute(OCCLUDER_MIN);
          }
          if (geometry.getAttribute(OCCLUDER_MAX) === state.max) {
            if (previousMax) geometry.setAttribute(OCCLUDER_MAX, previousMax);
            else geometry.deleteAttribute(OCCLUDER_MAX);
          }
          if (metadataByGeometry.get(geometry) === state)
            metadataByGeometry.delete(geometry);
        });
      };
      const state: GeometryMetadata = {
        ...bounds,
        previousMin,
        previousMax,
        sourceParts: parts,
        owners: new Set(),
        pendingDisposal: false,
        disposed,
      };
      metadata = state;
      metadataByGeometry.set(geometry, state);
      geometry.addEventListener('dispose', disposed);
    } else {
      // Only module-owned metadata is reused; arbitrary preexisting attributes
      // with these names remain borrowed originals and are restored unchanged.
      if (parts !== undefined && metadata.sourceParts !== parts) {
        const bounds = occluderBounds(geometry, parts);
        metadata.min.copyArray(bounds.min.array);
        metadata.max.copyArray(bounds.max.array);
        metadata.min.needsUpdate = true;
        metadata.max.needsUpdate = true;
        metadata.pieces = bounds.pieces;
        metadata.sourceParts = parts;
      }
      if (metadata.pendingDisposal) {
        metadata.pendingDisposal = false;
        geometry.addEventListener('dispose', metadata.disposed);
      }
    }
    if (previous?.metadata === metadata) return;
    previous?.release();
    const controller = new WeakRef(this);
    const state = metadata;
    const release = () => {
      const owner = controller.deref();
      if (owner?.geometryPatches.get(geometry) === patch)
        owner.geometryPatches.delete(geometry);
      owner?.geometryReferences.delete(reference);
      state.owners.delete(reference);
      // The resource owner eventually disposes the geometry. Keep its uploaded
      // metadata attached for renderer buffer deletion and controller handoff.
    };
    const patch: GeometryPatch = { metadata: state, release };
    const reference = new WeakRef(patch);
    state.owners.add(reference);
    this.geometryPatches.set(geometry, patch);
    this.geometryReferences.add(reference);
  }

  private unwatch(object: THREE.Object3D) {
    if (this.watched.delete(object)) {
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
      object.removeEventListener('removed', this.detached);
      if (this.meshes.delete(object)) this.meshCount--;
    }
    for (const child of object.children) this.unwatch(child);
  }

  /** The normal/depth pass receives the identical whole-piece selection.
   * Missing bounds are zero/default attributes, so unrelated avatars and
   * pedestrians remain in SSAO even though it uses one override material. */
  prepareMaterial(
    material: THREE.Material,
    options?: { normalPass?: boolean },
  ): () => void {
    if (this.disposed) return noRelease;
    this.patch(material, options?.normalPass === true);
    return this.patches.get(material)?.release ?? noRelease;
  }

  private patch(material: THREE.Material, normalPass = false) {
    if (this.patches.has(material) || !eligibleMaterial(material)) return;
    if (material instanceof THREE.ShaderMaterial) {
      if (!this.unsupported.has(material)) {
        this.unsupported.add(material);
        this.unsupportedCount++;
      }
      return;
    }
    // oxlint-disable-next-line typescript/unbound-method
    const before = material.onBeforeCompile;
    // oxlint-disable-next-line typescript/unbound-method
    const key = material.customProgramCacheKey;
    const defaultsMaterial = material as MaterialWithDefaults;
    const previousDefaults = defaultsMaterial.defaultAttributeValues;
    const defaults = {
      ...previousDefaults,
      [OCCLUDER_MIN]: [0, 0, 0],
      [OCCLUDER_MAX]: [0, 0, 0],
    };
    // Generic GL attribute constants can survive unrelated shader programs.
    // Set explicit zero defaults instead of assuming a missing attribute is 0.
    defaultsMaterial.defaultAttributeValues = defaults;
    const uniforms = this.uniforms;
    const compile: Compile = (shader, renderer) => {
      before.call(material, shader, renderer);
      if (
        !shader.vertexShader.includes(PROJECT) ||
        !shader.fragmentShader.includes(CLIPPING)
      ) {
        this.shaderFailures++;
        return;
      }
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `
        attribute vec3 ${OCCLUDER_MIN};
        attribute vec3 ${OCCLUDER_MAX};
        varying float vTravelOccluderSelected;
        varying vec3 vTravelCutawayWorld;
        uniform float uTravelCutawayEnabled;
        uniform vec3 uTravelCutawayStart;
        uniform vec3 uTravelCutawayEnd;
        uniform vec2 uTravelOccluderShape;
        ${shader.vertexShader}`.replace(
        PROJECT,
        `
        mat4 travelOccluderTransform = mat4(1.0);
        #ifdef USE_BATCHING
          travelOccluderTransform = batchingMatrix * travelOccluderTransform;
        #endif
        #ifdef USE_INSTANCING
          travelOccluderTransform = instanceMatrix * travelOccluderTransform;
        #endif
        travelOccluderTransform = modelMatrix * travelOccluderTransform;
        vTravelCutawayWorld = (travelOccluderTransform * vec4(transformed, 1.0)).xyz;
        vTravelOccluderSelected = 0.0;
        vec3 travelOccluderSize = ${OCCLUDER_MAX} - ${OCCLUDER_MIN};
        // All-zero/missing bounds cannot select the avatar in an override pass.
        if (uTravelCutawayEnabled > 0.5
          && all(greaterThanEqual(travelOccluderSize, vec3(0.0)))
          && dot(travelOccluderSize, travelOccluderSize) > 0.00000001) {
          mat3 travelOccluderLinear = mat3(travelOccluderTransform);
          // Affine inverse rows handle rotation, nonuniform scale and shear.
          vec3 travelOccluderRow0 = cross(travelOccluderLinear[1], travelOccluderLinear[2]);
          vec3 travelOccluderRow1 = cross(travelOccluderLinear[2], travelOccluderLinear[0]);
          vec3 travelOccluderRow2 = cross(travelOccluderLinear[0], travelOccluderLinear[1]);
          float travelOccluderDet = dot(travelOccluderLinear[0], travelOccluderRow0);
          if (abs(travelOccluderDet) > 0.00000001) {
            vec3 travelOccluderOrigin = travelOccluderTransform[3].xyz;
            vec3 travelOccluderFrom = uTravelCutawayStart - travelOccluderOrigin;
            vec3 travelOccluderTo = uTravelCutawayEnd - travelOccluderOrigin;
            vec3 travelOccluderStart = vec3(dot(travelOccluderRow0, travelOccluderFrom),
              dot(travelOccluderRow1, travelOccluderFrom), dot(travelOccluderRow2, travelOccluderFrom)) / travelOccluderDet;
            vec3 travelOccluderEnd = vec3(dot(travelOccluderRow0, travelOccluderTo),
              dot(travelOccluderRow1, travelOccluderTo), dot(travelOccluderRow2, travelOccluderTo)) / travelOccluderDet;
            vec3 travelOccluderMargin = vec3(length(travelOccluderRow0), length(travelOccluderRow1),
              length(travelOccluderRow2)) * (uTravelOccluderShape.x / abs(travelOccluderDet));
            vec3 travelOccluderDelta = travelOccluderEnd - travelOccluderStart;
            vec3 travelOccluderSafeDelta = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), travelOccluderDelta))
              * max(abs(travelOccluderDelta), vec3(0.00001));
            vec3 travelOccluderA = (${OCCLUDER_MIN} - travelOccluderMargin - travelOccluderStart) / travelOccluderSafeDelta;
            vec3 travelOccluderB = (${OCCLUDER_MAX} + travelOccluderMargin - travelOccluderStart) / travelOccluderSafeDelta;
            vec3 travelOccluderNear = min(travelOccluderA, travelOccluderB);
            vec3 travelOccluderFar = max(travelOccluderA, travelOccluderB);
            float travelOccluderEnter = max(0.0, max(travelOccluderNear.x, max(travelOccluderNear.y, travelOccluderNear.z)));
            float travelOccluderExit = min(1.0, min(travelOccluderFar.x, min(travelOccluderFar.y, travelOccluderFar.z)));
            vTravelOccluderSelected = step(travelOccluderEnter, travelOccluderExit);
          }
        }
        ${PROJECT}`,
      );
      shader.fragmentShader = `
        varying float vTravelOccluderSelected;
        varying vec3 vTravelCutawayWorld;
        uniform float uTravelCutawayEnabled;
        uniform vec2 uTravelOccluderShape;
        ${shader.fragmentShader}`.replace(
        CLIPPING,
        `${CLIPPING}
        if (uTravelCutawayEnabled > 0.5 && vTravelOccluderSelected > 0.5
          && vTravelCutawayWorld.y > uTravelOccluderShape.y) discard;`,
      );
    };
    const cacheKey: ProgramKey = () => {
      // oxlint-disable-next-line typescript/unbound-method
      const current = material.onBeforeCompile;
      material.onBeforeCompile = before;
      try {
        return `${key.call(material)}${CACHE_KEY}${normalPass ? '-normal' : ''}`;
      } finally {
        material.onBeforeCompile = current;
      }
    };
    const release = () => {
      const patch = this.patches.get(material);
      if (patch?.compile !== compile) return;
      if (material.onBeforeCompile === compile)
        material.onBeforeCompile = before;
      if (material.customProgramCacheKey === cacheKey)
        material.customProgramCacheKey = key;
      if (defaultsMaterial.defaultAttributeValues === defaults) {
        if (previousDefaults)
          defaultsMaterial.defaultAttributeValues = previousDefaults;
        else delete defaultsMaterial.defaultAttributeValues;
      }
      material.removeEventListener('dispose', release);
      material.needsUpdate = true;
      this.patches.delete(material);
    };
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = cacheKey;
    material.addEventListener('dispose', release);
    material.needsUpdate = true;
    this.patches.set(material, {
      material,
      before,
      key,
      compile,
      cacheKey,
      release,
    });
  }

  update(
    cameraPosition: THREE.Vector3,
    subjectFeet: THREE.Vector3,
    options?: TravelOcclusionOptions,
  ) {
    if (this.disposed) return;
    this.updates++;
    if (
      options?.enabled === false ||
      !finitePoint(cameraPosition) ||
      !finitePoint(subjectFeet)
    ) {
      this.clear();
      return;
    }
    const radius = finiteClamp(options?.radius, 0.25, 0.05, 1.8);
    const height = finiteClamp(options?.subjectHeight, 1.1, 0.2, 2.2);
    const start = this.uniforms.uTravelCutawayStart.value;
    const end = this.uniforms.uTravelCutawayEnd.value;
    start.copy(cameraPosition);
    end.copy(subjectFeet);
    end.y += height;
    this.length = start.distanceTo(end);
    if (
      finiteClamp(options?.strength, 1, 0, 1) === 0 ||
      (this.length < 0.15 && !options?.firstPerson)
    ) {
      this.clear();
      return;
    }
    if (this.length > MAX_LENGTH) {
      start
        .sub(end)
        .multiplyScalar(MAX_LENGTH / this.length)
        .add(end);
      this.length = MAX_LENGTH;
    }
    this.uniforms.uTravelOccluderShape.value.set(radius, subjectFeet.y + 0.08);
    this.uniforms.uTravelCutawayEnabled.value = 1;
  }

  clear() {
    this.uniforms.uTravelCutawayEnabled.value = 0;
    this.length = 0;
  }

  /** Read-only CPU equivalent of the shader for a particular piece/instance.
   * Off-ray points on a selected piece are fully removed as well. Unregistered
   * geometry (such as an avatar in SSAO) always has zero coverage. */
  coverageAt(point: THREE.Vector3, options?: CoverageOptions): number {
    if (!this.uniforms.uTravelCutawayEnabled.value || !finitePoint(point))
      return 0;
    const shape = this.uniforms.uTravelOccluderShape.value;
    if (point.y <= shape.y) return 0;
    const object = options?.object;
    if (!object) return 0;
    const min = object.geometry.getAttribute(OCCLUDER_MIN);
    const max = object.geometry.getAttribute(OCCLUDER_MAX);
    const index = options?.vertexIndex ?? 0;
    if (!min || !max || index < 0 || index >= min.count || index >= max.count)
      return 0;
    const lower = new THREE.Vector3().fromBufferAttribute(min, index);
    const upper = new THREE.Vector3().fromBufferAttribute(max, index);
    const size = upper.clone().sub(lower);
    if (size.x < 0 || size.y < 0 || size.z < 0 || size.lengthSq() <= 1e-8)
      return 0;
    object.updateWorldMatrix(true, false);
    const transform = object.matrixWorld.clone();
    if (object instanceof THREE.InstancedMesh) {
      const instance = options?.instanceId ?? 0;
      if (instance < 0 || instance >= object.count) return 0;
      const matrix = new THREE.Matrix4();
      object.getMatrixAt(instance, matrix);
      transform.multiply(matrix);
    }
    if (Math.abs(transform.determinant()) <= 1e-8) return 0;
    const inverse = transform.invert();
    const elements = inverse.elements;
    const margin = new THREE.Vector3(
      Math.hypot(elements[0], elements[4], elements[8]),
      Math.hypot(elements[1], elements[5], elements[9]),
      Math.hypot(elements[2], elements[6], elements[10]),
    ).multiplyScalar(shape.x);
    lower.sub(margin);
    upper.add(margin);
    const start = this.uniforms.uTravelCutawayStart.value
      .clone()
      .applyMatrix4(inverse);
    const end = this.uniforms.uTravelCutawayEnd.value
      .clone()
      .applyMatrix4(inverse);
    let enter = 0,
      exit = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const delta = end[axis] - start[axis];
      const safe = (delta >= 0 ? 1 : -1) * Math.max(Math.abs(delta), 1e-5);
      const a = (lower[axis] - start[axis]) / safe;
      const b = (upper[axis] - start[axis]) / safe;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
    }
    return enter <= exit ? 1 : 0;
  }

  private geometrySnapshot() {
    let count = 0,
      pieces = 0;
    for (const reference of this.geometryReferences) {
      const patch = reference.deref();
      if (patch) {
        count++;
        pieces += patch.metadata.pieces;
      } else this.geometryReferences.delete(reference);
    }
    return { count, pieces };
  }

  snapshot() {
    return {
      active: this.uniforms.uTravelCutawayEnabled.value === 1,
      mode: 'full-occluder' as const,
      disposed: this.disposed,
      materialCount: this.patches.size,
      meshCount: this.meshCount,
      watchedObjects: this.watched.size,
      geometryCount: this.geometrySnapshot().count,
      pieceCount: this.geometrySnapshot().pieces,
      unsupportedMaterialCount: this.unsupportedCount,
      shaderFailures: this.shaderFailures,
      updates: this.updates,
      length: this.length,
      radius: this.uniforms.uTravelOccluderShape.value.x,
      strength: this.uniforms.uTravelCutawayEnabled.value,
      start:
        this.uniforms.uTravelCutawayStart.value.toArray() as unknown as Point,
      end: this.uniforms.uTravelCutawayEnd.value.toArray() as unknown as Point,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const object of this.watched) {
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
      object.removeEventListener('removed', this.detached);
    }
    this.watched.clear();
    this.meshCount = 0;
    for (const patch of this.patches.values()) patch.release();
    for (const reference of this.geometryReferences)
      reference.deref()?.release();
    this.geometryReferences.clear();
  }
}

function noRelease() {}
function eligibleMaterial(material: THREE.Material) {
  return (
    !material.transparent &&
    material.opacity >= 1 &&
    material.userData.travelOcclusion !== false
  );
}
function excluded(object: THREE.Object3D) {
  return (
    object.userData.travelOcclusion === false ||
    object.userData.cameraCollision === false ||
    object.userData.portalId != null
  );
}
function allowedAncestors(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (excluded(current)) return false;
    current = current.parent;
  }
  return true;
}
function finitePoint(point: THREE.Vector3) {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}
function finiteClamp(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.max(
    min,
    Math.min(
      max,
      value !== undefined && Number.isFinite(value) ? value : fallback,
    ),
  );
}

function groundSurface(object: THREE.Object3D) {
  return (
    object.userData.walkSurface === true ||
    object.userData.groundObstruction === true ||
    object.name.startsWith('Road paint ') ||
    object.name.startsWith('South motor ramp white edges ') ||
    object.name.startsWith('Northbound exit white edges ')
  );
}

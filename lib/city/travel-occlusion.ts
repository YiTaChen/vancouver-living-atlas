import * as THREE from 'three';

const MAX_LENGTH = 32;
const SUBJECT_RADIUS = 0.7;
const CACHE_KEY = '|travel-local-cutaway-v1';
const PROJECT = '#include <project_vertex>';
const CLIPPING = '#include <clipping_planes_fragment>';
type Compile = THREE.Material['onBeforeCompile'];
type ProgramKey = THREE.Material['customProgramCacheKey'];
type Point = readonly [number, number, number];

export interface TravelOcclusionOptions {
  enabled?: boolean;
  /** Radius around the player's torso, in metres; bounded to 0.25–1.8. */
  radius?: number;
  subjectHeight?: number;
  /** Fraction of covered pixels removed, without changing material opacity. */
  strength?: number;
  /** A short local opening also works when camera and torso coincide. */
  firstPerson?: boolean;
}

interface Patch {
  material: THREE.Material;
  before: Compile;
  key: ProgramKey;
  compile: Compile;
  cacheKey: ProgramKey;
  release: () => void;
}

/** A render-only opening along the chase camera's sightline. Supply world roots
 * without the player's avatar. Refresh when a loader adds geometry/materials;
 * update only writes a fixed set of uniforms, never traverses or raycasts.
 *
 * Existing material objects are retained so their live lighting/color/texture
 * updates continue. Materials deliberately shared with an excluded object must
 * not also be supplied through an eligible root. Collision, shadows, geometry,
 * opacity and transparent sorting are unchanged. */
export class TravelOcclusion {
  private readonly roots: readonly THREE.Object3D[];
  private readonly patches = new Map<THREE.Material, Patch>();
  private readonly meshes = new WeakSet<THREE.Object3D>();
  private readonly watched = new Set<THREE.Object3D>();
  private readonly unsupported = new WeakSet<THREE.Material>();
  private readonly uniforms = {
    uTravelCutawayEnabled: { value: 0 },
    uTravelCutawayStart: { value: new THREE.Vector3() },
    uTravelCutawayEnd: { value: new THREE.Vector3() },
    uTravelCutawayBoundsMin: { value: new THREE.Vector3() },
    uTravelCutawayBoundsMax: { value: new THREE.Vector3() },
    // near radius, torso radius, retained floor Y, strength
    uTravelCutawayShape: { value: new THREE.Vector4() },
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

  constructor(roots: readonly THREE.Object3D[] = []) {
    this.roots = roots;
    this.refresh();
  }

  /** Explicit refresh supports late-loaded stations, vehicles and landmarks.
   * Transparent materials, portal visuals and opted-out subtrees are ignored. */
  refresh(additionalRoots: readonly THREE.Object3D[] = this.roots) {
    if (this.disposed) return;
    for (const root of additionalRoots)
      if (allowedAncestors(root)) this.visit(root);
  }

  /** Release a staged/cancelled subtree's listeners and node references only.
   * Resource disposal remains with its owner; shared material hooks remain
   * installed. A later attachment to a watched parent enrolls it again. */
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
    if (object instanceof THREE.Mesh) {
      if (!this.meshes.has(object)) {
        this.meshes.add(object);
        this.meshCount++;
      }
      if (Array.isArray(object.material)) {
        for (const material of object.material) this.patch(material);
      } else this.patch(object.material);
    }
    for (const child of object.children) this.visit(child);
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

  /** Optional render override (SSAO normal/depth). Release before disposing the
   * pass, or let the material's own dispose event release its borrowed hook.
   * Normal passes remove the local obstruction without a lower-resolution
   * dither mismatch and preserve the player's body normals at the endpoint. */
  prepareMaterial(
    material: THREE.Material,
    options?: { normalPass?: boolean },
  ): () => void {
    if (this.disposed) return noRelease;
    this.patch(material, options?.normalPass === true);
    return this.patches.get(material)?.release ?? noRelease;
  }

  private patch(material: THREE.Material, normalPass = false) {
    if (
      this.patches.has(material) ||
      material.transparent ||
      material.opacity < 1 ||
      material.userData.travelOcclusion === false
    )
      return;
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
      // transformed already includes source deformation, morphing and skinning.
      // Match Three's worldpos_vertex order, including BatchedMesh/InstancedMesh.
      shader.vertexShader =
        `varying vec3 vTravelCutawayWorld;\n${shader.vertexShader}`.replace(
          PROJECT,
          `vec4 travelCutawayPosition = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          travelCutawayPosition = batchingMatrix * travelCutawayPosition;
        #endif
        #ifdef USE_INSTANCING
          travelCutawayPosition = instanceMatrix * travelCutawayPosition;
        #endif
        vTravelCutawayWorld = (modelMatrix * travelCutawayPosition).xyz;
        ${PROJECT}`,
        );
      shader.fragmentShader = `
        varying vec3 vTravelCutawayWorld;
        uniform float uTravelCutawayEnabled;
        uniform vec3 uTravelCutawayStart;
        uniform vec3 uTravelCutawayEnd;
        uniform vec3 uTravelCutawayBoundsMin;
        uniform vec3 uTravelCutawayBoundsMax;
        uniform vec4 uTravelCutawayShape;
        ${shader.fragmentShader}`.replace(
        CLIPPING,
        `${CLIPPING}
        if (uTravelCutawayEnabled > 0.5
          && all(greaterThanEqual(vTravelCutawayWorld, uTravelCutawayBoundsMin))
          && all(lessThanEqual(vTravelCutawayWorld, uTravelCutawayBoundsMax))
          && vTravelCutawayWorld.y > uTravelCutawayShape.z
          ${
            normalPass
              ? `&& !(distance(vTravelCutawayWorld.xz, uTravelCutawayEnd.xz) < ${SUBJECT_RADIUS.toFixed(2)}
            && vTravelCutawayWorld.y < uTravelCutawayShape.z + 2.2)`
              : ''
          }) {
          vec3 travelCutawayAxis = uTravelCutawayEnd - uTravelCutawayStart;
          float travelCutawayLengthSq = dot(travelCutawayAxis, travelCutawayAxis);
          float travelCutawayT = travelCutawayLengthSq > 0.0001
            ? dot(vTravelCutawayWorld - uTravelCutawayStart, travelCutawayAxis) / travelCutawayLengthSq : 0.0;
          // Do not cut background architecture beyond the player's torso.
          if (travelCutawayT <= 1.0) {
            float travelCutawayAlong = clamp(travelCutawayT, 0.0, 1.0);
            float travelCutawayRadius = mix(uTravelCutawayShape.x, uTravelCutawayShape.y, travelCutawayAlong);
            float travelCutawayDistance = distance(vTravelCutawayWorld,
              uTravelCutawayStart + travelCutawayAlong * travelCutawayAxis);
            float travelCutawayCoverage = (1.0 - smoothstep(0.7 * travelCutawayRadius,
              travelCutawayRadius, travelCutawayDistance)) * uTravelCutawayShape.w;
            ${
              normalPass
                ? `if (travelCutawayCoverage > 0.001) discard;`
                : `vec2 travelCutawayPixel = mod(floor(gl_FragCoord.xy), 4.0);
            float travelCutawayThreshold = (4.0 * mod(2.0 * travelCutawayPixel.x + 3.0 * travelCutawayPixel.y, 4.0)
              + mod(2.0 * floor(travelCutawayPixel.x / 2.0) + 3.0 * floor(travelCutawayPixel.y / 2.0), 4.0) + 0.5) / 16.0;
            if (travelCutawayThreshold < travelCutawayCoverage) discard;`
            }
          }
        }`,
      );
    };
    const cacheKey: ProgramKey = () => {
      // The default key reads this.onBeforeCompile. Present the preceding hook
      // while invoking the original key, retaining dynamic source variants too.
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
    const radius = finiteClamp(options?.radius, 0.9, 0.25, 1.8);
    const height = finiteClamp(options?.subjectHeight, 1.1, 0.2, 2.2);
    const strength = finiteClamp(options?.strength, 0.94, 0, 1);
    const start = this.uniforms.uTravelCutawayStart.value;
    const end = this.uniforms.uTravelCutawayEnd.value;
    start.copy(cameraPosition);
    end.copy(subjectFeet);
    end.y += height;
    this.length = start.distanceTo(end);
    if (strength === 0 || (this.length < 0.15 && !options?.firstPerson)) {
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
    const nearRadius = options?.firstPerson
      ? radius
      : Math.max(0.22, radius * 0.42);
    this.uniforms.uTravelCutawayShape.value.set(
      nearRadius,
      radius,
      subjectFeet.y + 0.08,
      strength,
    );
    this.uniforms.uTravelCutawayBoundsMin.value
      .copy(start)
      .min(end)
      .addScalar(-radius);
    this.uniforms.uTravelCutawayBoundsMax.value
      .copy(start)
      .max(end)
      .addScalar(radius);
    this.uniforms.uTravelCutawayEnabled.value = 1;
  }

  clear() {
    this.uniforms.uTravelCutawayEnabled.value = 0;
    this.length = 0;
  }

  /** Diagnostic coverage before screen-space dither; no scene inspection. */
  coverageAt(point: THREE.Vector3, options?: { normalPass?: boolean }): number {
    if (!this.uniforms.uTravelCutawayEnabled.value || !finitePoint(point))
      return 0;
    const start = this.uniforms.uTravelCutawayStart.value;
    const end = this.uniforms.uTravelCutawayEnd.value;
    const shape = this.uniforms.uTravelCutawayShape.value;
    if (point.y <= shape.z) return 0;
    if (
      options?.normalPass &&
      Math.hypot(point.x - end.x, point.z - end.z) < SUBJECT_RADIUS &&
      point.y < shape.z + 2.2
    )
      return 0;
    const dx = end.x - start.x,
      dy = end.y - start.y,
      dz = end.z - start.z;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const t =
      lengthSq > 0.0001
        ? ((point.x - start.x) * dx +
            (point.y - start.y) * dy +
            (point.z - start.z) * dz) /
          lengthSq
        : 0;
    if (t > 1) return 0;
    const along = Math.max(0, t);
    const radius = shape.x + (shape.y - shape.x) * along;
    const distance = Math.hypot(
      point.x - start.x - along * dx,
      point.y - start.y - along * dy,
      point.z - start.z - along * dz,
    );
    const edge = THREE.MathUtils.clamp((distance / radius - 0.7) / 0.3, 0, 1);
    return (1 - edge * edge * (3 - 2 * edge)) * shape.w;
  }

  snapshot() {
    const shape = this.uniforms.uTravelCutawayShape.value;
    return {
      active: this.uniforms.uTravelCutawayEnabled.value === 1,
      disposed: this.disposed,
      materialCount: this.patches.size,
      meshCount: this.meshCount,
      watchedObjects: this.watched.size,
      unsupportedMaterialCount: this.unsupportedCount,
      shaderFailures: this.shaderFailures,
      updates: this.updates,
      length: this.length,
      radius: shape.y,
      strength: shape.w,
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
  }
}

function noRelease() {}
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

/** Bounded station portal apertures in the existing city surfaces. A station
 * walker owns the corresponding physical floor; ordinary city physics is never
 * granted a platform, vehicle or underground navigation permission. */
import * as THREE from 'three';
import type { SkyTrainStationOwner } from './skytrain-stations';
import type { StationTerrainOpening } from './skytrain-street-access';
const STATIONS = 7;
const PER_STATION = 48;
const CAPACITY = STATIONS * PER_STATION;
// Splitting at owner boundaries costs at most STATIONS - 1 extra pages:
// sum(ceil(ownerCount / 48)) <= ceil(336 / 48) + 6 = 13.
const REGION_CAPACITY = 13;
const OPENING_SURFACE = 'aStationOpeningSurface';
type AttributeDefaults = Record<string, number[]>;
type MaterialWithDefaults = THREE.Material & {
  defaultAttributeValues?: AttributeDefaults;
};
const openingGeometry = new WeakMap<
  THREE.BufferGeometry,
  {
    attribute: THREE.BufferAttribute;
    previous:
      | THREE.BufferAttribute
      | THREE.InterleavedBufferAttribute
      | undefined;
    references: number;
    waterReferences: number;
  }
>();
const apertureUniformDeclarations = `
  uniform int uStationOpeningCount;
  uniform highp sampler2D uStationOpeningData;
  uniform vec4 uStationViewCutaway;
  uniform vec4 uStationViewCamera;
  uniform int uStationRegionCount;
  uniform vec4 uStationRegionBounds[${REGION_CAPACITY}];
  uniform vec4 uStationRegionRanges[${REGION_CAPACITY}];
  // Slab intersection uses the unnormalized camera-to-fragment ray. City
  // foreground requires the original source volume beyond t=1. Explicit sea
  // water yields to the same projected source silhouette on either side of it.
  bool stationOpeningRayBox(vec3 origin,vec3 delta,vec3 lower,vec3 upper,out float entry,out float exit) {
    bvec3 parallel=lessThan(abs(delta),vec3(0.000001));
    if((parallel.x && (origin.x<lower.x || origin.x>upper.x)) ||
       (parallel.y && (origin.y<lower.y || origin.y>upper.y)) ||
       (parallel.z && (origin.z<lower.z || origin.z>upper.z))) return false;
    vec3 safeDelta=vec3(parallel.x ? 1.0 : delta.x,parallel.y ? 1.0 : delta.y,parallel.z ? 1.0 : delta.z);
    vec3 a=(lower-origin)/safeDelta;
    vec3 b=(upper-origin)/safeDelta;
    vec3 near=min(a,b),far=max(a,b);
    if(parallel.x) { near.x=-1.0e20; far.x=1.0e20; }
    if(parallel.y) { near.y=-1.0e20; far.y=1.0e20; }
    if(parallel.z) { near.z=-1.0e20; far.z=1.0e20; }
    entry=max(max(near.x,near.y),near.z);
    exit=min(min(far.x,far.y),far.z);
    return exit>=max(entry,0.0);
  }`;
const apertureFragment = (world: string) => `
  vec3 stationViewRay=${world}-uStationViewCamera.xyz;
  bool stationProjectedView=uStationViewCamera.w>0.5 && dot(stationViewRay,stationViewRay)>0.000001;
  bool stationWaterSurface=vStationOpeningSurface>1.5;
  for(int stationRegionIndex=0;stationRegionIndex<${REGION_CAPACITY};stationRegionIndex++) {
    if(stationRegionIndex>=uStationRegionCount) break;
    vec4 stationBounds=uStationRegionBounds[stationRegionIndex];
    vec4 stationRange=uStationRegionRanges[stationRegionIndex];
    bool stationViewPage=uStationViewCutaway.w>0.5 && stationRange.x>=uStationViewCutaway.x && stationRange.x<uStationViewCutaway.x+uStationViewCutaway.y;
    float stationRegionMaxY=stationViewPage && uStationViewCamera.w<0.5 ? max(stationRange.w,uStationViewCutaway.z) : stationRange.w;
    vec2 stationDelta=abs(${world}.xz-stationBounds.xy);
    bool stationVerticalPage=stationDelta.x<=stationBounds.z && stationDelta.y<=stationBounds.w && ${world}.y>=stationRange.z && ${world}.y<=stationRegionMaxY;
    // With an actual camera, permanent and projected volumes both keep their
    // original source heights. Raising a vertical column would expose ocean
    // beyond the real projected silhouette. Ceiling-only callers retain the
    // old bounded vertical fallback. Only active pages run this broadphase.
    bool stationProjectedPage=false;
    if(stationViewPage && stationProjectedView) {
      float stationPageEntry,stationPageExit;
      stationProjectedPage=stationOpeningRayBox(uStationViewCamera.xyz,stationViewRay,
        vec3(stationBounds.x-stationBounds.z,stationRange.z,stationBounds.y-stationBounds.w),
        vec3(stationBounds.x+stationBounds.z,stationRange.w,stationBounds.y+stationBounds.w),stationPageEntry,stationPageExit) && (stationWaterSurface ? stationPageExit>0.0 : stationPageExit>1.00001);
    }
    if(!stationVerticalPage && !stationProjectedPage) continue;
    for(int stationLocalIndex=0;stationLocalIndex<${PER_STATION};stationLocalIndex++) {
      if(stationLocalIndex>=int(stationRange.y)) break;
      int stationOpeningIndex=int(stationRange.x)+stationLocalIndex;
      if(stationOpeningIndex>=uStationOpeningCount) break;
      vec4 r=texelFetch(uStationOpeningData,ivec2(0,stationOpeningIndex),0);
      vec4 p=texelFetch(uStationOpeningData,ivec2(1,stationOpeningIndex),0);
      vec2 delta=${world}.xz-r.xy;
      float across=dot(delta,p.xy);
      float along=dot(delta,vec2(-p.y,p.x));
      bool stationViewRow=uStationViewCutaway.w>0.5 && float(stationOpeningIndex)>=uStationViewCutaway.x && float(stationOpeningIndex)<uStationViewCutaway.x+uStationViewCutaway.y;
      float stationOpeningMaxY=stationViewRow && uStationViewCamera.w<0.5 ? max(p.w,uStationViewCutaway.z) : p.w;
      if(abs(across)<r.z && abs(along)<r.w && ${world}.y>=p.z && ${world}.y<=stationOpeningMaxY) discard;
      if(stationViewRow && stationProjectedPage) {
        vec2 stationCameraDelta=uStationViewCamera.xz-r.xy;
        vec3 stationCameraLocal=vec3(dot(stationCameraDelta,p.xy),uStationViewCamera.y,dot(stationCameraDelta,vec2(-p.y,p.x)));
        vec3 stationFragmentLocal=vec3(across,${world}.y,along);
        float stationRowEntry,stationRowExit;
        if(stationOpeningRayBox(stationCameraLocal,stationFragmentLocal-stationCameraLocal,
          vec3(-r.z,p.z,-r.w),vec3(r.z,p.w,r.w),stationRowEntry,stationRowExit) && (stationWaterSurface ? stationRowEntry>0.00001 : stationRowEntry>1.00001)) discard;
      }
    }
  }`;
interface MaterialPatch {
  material: THREE.Material;
  before: THREE.Material['onBeforeCompile'];
  key: THREE.Material['customProgramCacheKey'];
  patched: THREE.Material['onBeforeCompile'];
  patchedKey: THREE.Material['customProgramCacheKey'];
  release: () => void;
}
export interface SkyTrainWorldOpenings {
  /** Call only when new city/landmark geometry introduces new materials. */
  refresh(additionalRoots?: readonly THREE.Object3D[]): void;
  update(owners: readonly SkyTrainStationOwner[]): void;
  /** Reveal the active authored interior up to its chase/orbit camera, within
   * the unchanged source footprints. Null restores normal city/first person. */
  setViewCutaway(
    owner: SkyTrainStationOwner | null,
    ceilingY?: number,
    cameraPosition?: THREE.Vector3,
  ): void;
  /** Match a TravelOcclusion-prepared SSAO override for explicitly enrolled
   * city geometry. Unregistered station/avatar geometry fails closed. */
  prepareGroundMaterial(material: THREE.Material): () => void;
  dispose(): void;
}
/** Existing city slabs must yield to the complete authored passenger space,
 * including flat landings between flights and the entire multi-lane bank.
 * These volumes never patch the station's own walls, ceilings or stair slabs.
 */
export function stationCityOpenings(
  owner: SkyTrainStationOwner,
): readonly StationTerrainOpening[] {
  const original = owner.terrainOpenings();
  if (!owner.geometryData.authoredInterior) return original;
  const openings: StationTerrainOpening[] = original.filter(
    (opening) => !opening.id.endsWith('-authored-opening'),
  );
  const add = (
    id: string,
    polygon: THREE.Vector3[],
    minY: number,
    maxY: number,
  ) =>
    openings.push({
      id,
      stationId: owner.data.id,
      polygon: polygon.map((point) => owner.toWorld(point.toArray())),
      minY: owner.baseY + minY,
      maxY: owner.baseY + maxY,
    });
  // Each authored floor describes a bounded room or landing. Its footprint
  // also bounds the space above any intentionally carved stairwell in it.
  for (const floor of owner.data.floors) {
    const vertices = floor.vertices.map((point) => new THREE.Vector3(...point)),
      box = new THREE.Box3().setFromPoints(vertices),
      a = vertices[0],
      along = vertices[1]?.clone().sub(a).setY(0),
      across = vertices[3]?.clone().sub(a).setY(0),
      rectangular =
        vertices.length === 4 &&
        along &&
        across &&
        along.length() > 0.01 &&
        across.length() > 0.01 &&
        Math.abs(along.clone().normalize().dot(across.clone().normalize())) <
          1e-6 &&
        vertices[2].clone().sub(vertices[1]).setY(0).distanceTo(across) < 1e-6;
    // Keep a rotated rectangular passage's real end plane. Its axis-aligned
    // bounds would erase triangular pieces of the adjoining retained roof
    // beyond the new passage, even though its physical soffit ends earlier.
    const polygon = rectangular
      ? (() => {
          const u = along.clone().normalize().multiplyScalar(0.03),
            v = across.clone().normalize().multiplyScalar(0.03);
          return [
            vertices[0].clone().sub(u).sub(v),
            vertices[1].clone().add(u).sub(v),
            vertices[2].clone().add(u).add(v),
            vertices[3].clone().sub(u).add(v),
          ];
        })()
      : [
          new THREE.Vector3(box.min.x - 0.03, box.min.y, box.min.z - 0.03),
          new THREE.Vector3(box.min.x - 0.03, box.min.y, box.max.z + 0.03),
          new THREE.Vector3(box.max.x + 0.03, box.min.y, box.max.z + 0.03),
          new THREE.Vector3(box.max.x + 0.03, box.min.y, box.min.z - 0.03),
        ];
    add(
      `${floor.id}-authored-room-clearance`,
      polygon,
      box.min.y - 0.4,
      Math.max(
        box.max.y + 3.8,
        ...owner.geometryData.parts
          .filter(
            (part) =>
              part.id.startsWith(floor.id + '-') &&
              /(?:roof|ceiling|soffit)/i.test(part.role),
          )
          .map((part) => {
            const matrix = new THREE.Matrix4().compose(
              new THREE.Vector3(...part.position),
              part.quaternion
                ? new THREE.Quaternion(...part.quaternion)
                : new THREE.Quaternion().setFromAxisAngle(
                    new THREE.Vector3(0, 1, 0),
                    (part.yaw * Math.PI) / 180,
                  ),
              new THREE.Vector3(...part.size),
            );
            return (
              new THREE.Box3(
                new THREE.Vector3(-0.5, -0.5, -0.5),
                new THREE.Vector3(0.5, 0.5, 0.5),
              ).applyMatrix4(matrix).max.y + 0.15
            );
          }),
      ),
    );
  }
  // Each full bank has one structural underside even when its roof is a
  // curved vault. Never infer the bank's existence only from a flat soffit.
  for (const slab of owner.geometryData.parts) {
    if (slab.role !== 'floor' || !slab.id.endsWith('-underslab')) continue;
    const bankId = slab.id.replace(/-underslab$/, ''),
      soffit = owner.geometryData.parts.find(
        (part) => part.id === bankId + '-soffit',
      );
    const rotation = slab.quaternion
        ? new THREE.Quaternion(...slab.quaternion)
        : new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            (slab.yaw * Math.PI) / 180,
          ),
      center = new THREE.Vector3(...slab.position),
      a = new THREE.Vector3(0, 0, -slab.size[2] / 2)
        .applyQuaternion(rotation)
        .add(center),
      b = new THREE.Vector3(0, 0, slab.size[2] / 2)
        .applyQuaternion(rotation)
        .add(center),
      tangent = b.clone().sub(a).setY(0).normalize(),
      across = new THREE.Vector3(tangent.z, 0, -tangent.x),
      halfWidth = (soffit?.size[0] ?? slab.size[0]) / 2 + 0.03;
    if (tangent.lengthSq() < 0.5) continue;
    a.addScaledVector(tangent, -0.25);
    b.addScaledVector(tangent, 0.25);
    add(
      bankId + '-authored-bank-clearance',
      [
        a.clone().addScaledVector(across, -halfWidth),
        b.clone().addScaledVector(across, -halfWidth),
        b.clone().addScaledVector(across, halfWidth),
        a.clone().addScaledVector(across, halfWidth),
      ],
      Math.min(a.y, b.y) - 0.4,
      Math.max(a.y, b.y) + 4,
    );
  }
  // Unenclosed flights still have real full-width treads. In particular a
  // switchback's gap between its upper/lower landings cannot rely on the small
  // camera sight cone, nor on an aggregate underslab which may not exist.
  const contains = (opening: StationTerrainOpening, point: number[]) => {
    if (point[1] < opening.minY - 1e-6 || point[1] > opening.maxY + 1e-6)
      return false;
    const [a, b, c, d] = opening.polygon.map((p) => new THREE.Vector3(...p)),
      center = a.clone().add(c).multiplyScalar(0.5),
      along = b.clone().sub(a).setY(0),
      across = d.clone().sub(a).setY(0),
      delta = new THREE.Vector3(...point).sub(center).setY(0),
      length = along.length(),
      width = across.length();
    return (
      Math.abs(delta.dot(along.normalize())) <= length / 2 + 1e-6 &&
      Math.abs(delta.dot(across.normalize())) <= width / 2 + 1e-6
    );
  };
  for (const connection of owner.geometryData.connections) {
    if (!connection.treads.length) continue;
    const first = connection.treads[0].vertices.map(
        (p) => new THREE.Vector3(...p),
      ),
      origin = first[0],
      along = first[1].clone().sub(origin).setY(0).normalize(),
      across = new THREE.Vector3(along.z, 0, -along.x);
    if (along.lengthSq() < 0.5 || across.lengthSq() < 0.5) continue;
    let minAlong = Infinity,
      maxAlong = -Infinity,
      minAcross = Infinity,
      maxAcross = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const tread of connection.treads)
      for (const point of tread.vertices) {
        const delta = new THREE.Vector3(...point).sub(origin),
          u = delta.dot(along),
          v = delta.dot(across);
        minAlong = Math.min(minAlong, u);
        maxAlong = Math.max(maxAlong, u);
        minAcross = Math.min(minAcross, v);
        maxAcross = Math.max(maxAcross, v);
        minY = Math.min(minY, point[1]);
        maxY = Math.max(maxY, point[1]);
      }
    const polygon = [
        [minAlong - 0.03, minAcross - 0.03],
        [maxAlong + 0.03, minAcross - 0.03],
        [maxAlong + 0.03, maxAcross + 0.03],
        [minAlong - 0.03, maxAcross + 0.03],
      ].map(([u, v]) =>
        origin.clone().addScaledVector(along, u).addScaledVector(across, v),
      ),
      bottom = owner.baseY + minY - 0.4,
      top = owner.baseY + maxY + 3.8;
    // One existing full-bank/room volume containing all prism corners already
    // covers this flight. Keep that single bank row and the fixed GPU budget.
    if (
      openings.some((opening) =>
        polygon.every((point) => {
          const world = owner.toWorld(point.toArray());
          return (
            contains(opening, [world[0], bottom, world[2]]) &&
            contains(opening, [world[0], top, world[2]])
          );
        }),
      )
    )
      continue;
    add(
      `${connection.id}-authored-flight-clearance`,
      polygon,
      minY - 0.4,
      maxY + 3.8,
    );
  }
  return openings;
}
/** Chain material hooks, including architectural seed replacement, PBR atlases
 * and terrain finishing. Only matching world-space portal volumes are removed. */
export function applySkyTrainWorldOpenings(
  roots: readonly THREE.Object3D[],
  waterRoots: readonly THREE.Object3D[] = [],
): SkyTrainWorldOpenings {
  // Two RGBA texels per aperture avoid consuming hundreds of fragment
  // uniform vectors on the minimum supported WebGL2 hardware.
  const apertureData = new Float32Array(CAPACITY * 8),
    apertureTexture = new THREE.DataTexture(
      apertureData,
      2,
      CAPACITY,
      THREE.RGBAFormat,
      THREE.FloatType,
    ),
    bounds = Array.from({ length: REGION_CAPACITY }, () => new THREE.Vector4()),
    ranges = Array.from({ length: REGION_CAPACITY }, () => new THREE.Vector4()),
    count = { value: 0 },
    regionCount = { value: 0 },
    boundsUniform = { value: bounds },
    rangesUniform = { value: ranges },
    apertureUniform = { value: apertureTexture },
    viewUniform = { value: new THREE.Vector4() },
    cameraUniform = { value: new THREE.Vector4() },
    waterRootSet = new Set(waterRoots),
    patches = new Set<MaterialPatch>(),
    normalPatches = new Map<THREE.Material, () => void>(),
    seen = new Set<THREE.Material>(),
    watched = new Set<THREE.Object3D>(),
    geometryReleases = new Map<THREE.BufferGeometry, () => void>(),
    geometryKinds = new Map<THREE.BufferGeometry, boolean>();
  apertureTexture.minFilter = apertureTexture.magFilter = THREE.NearestFilter;
  apertureTexture.colorSpace = THREE.NoColorSpace;
  apertureTexture.generateMipmaps = false;
  apertureTexture.needsUpdate = true;
  let disposed = false;
  let previousOwners: readonly SkyTrainStationOwner[] = [];
  let ownerRows = new Map<
    SkyTrainStationOwner,
    { start: number; count: number }
  >();
  let viewOwner: SkyTrainStationOwner | null = null;
  let viewCeiling: number | undefined;
  let viewCamera: THREE.Vector3 | undefined;
  const updateView = () => {
    const span = viewOwner && ownerRows.get(viewOwner);
    if (
      !disposed &&
      span &&
      span.count > 0 &&
      viewOwner?.geometryData.authoredInterior &&
      Number.isFinite(viewCeiling)
    )
      viewUniform.value.set(span.start, span.count, viewCeiling!, 1);
    else viewUniform.value.set(0, 0, 0, 0);
    if (viewUniform.value.w && viewCamera)
      cameraUniform.value.set(viewCamera.x, viewCamera.y, viewCamera.z, 1);
    else cameraUniform.value.set(0, 0, 0, 0);
  };
  const bindUniforms = (
    shader: Parameters<THREE.Material['onBeforeCompile']>[0],
  ) => {
    shader.uniforms.uStationOpeningCount = count;
    shader.uniforms.uStationOpeningData = apertureUniform;
    shader.uniforms.uStationViewCutaway = viewUniform;
    shader.uniforms.uStationViewCamera = cameraUniform;
    shader.uniforms.uStationRegionCount = regionCount;
    shader.uniforms.uStationRegionBounds = boundsUniform;
    shader.uniforms.uStationRegionRanges = rangesUniform;
  };
  const updateGeometryMarker = (
    metadata: NonNullable<ReturnType<typeof openingGeometry.get>>,
  ) => {
    metadata.attribute.array.fill(
      metadata.references === metadata.waterReferences ? 2 : 1,
    );
    metadata.attribute.needsUpdate = true;
  };
  const enrollGeometry = (geometry: THREE.BufferGeometry, water: boolean) => {
    if (geometryReleases.has(geometry)) {
      // A geometry shared by water and ordinary objects fails closed to the
      // ordinary mask. Water privilege must never transfer to another object.
      if (!water && geometryKinds.get(geometry)) {
        geometryKinds.set(geometry, false);
        const metadata = openingGeometry.get(geometry)!;
        metadata.waterReferences--;
        updateGeometryMarker(metadata);
      }
      return;
    }
    const position = geometry.getAttribute('position');
    if (!position) return;
    let entry = openingGeometry.get(geometry);
    if (!entry) {
      const attribute = new THREE.Float32BufferAttribute(
        new Float32Array(position.count).fill(1),
        1,
      );
      entry = {
        attribute,
        previous: geometry.getAttribute(OPENING_SURFACE),
        references: 0,
        waterReferences: 0,
      };
      openingGeometry.set(geometry, entry);
      geometry.setAttribute(OPENING_SURFACE, attribute);
    }
    const metadata = entry;
    metadata.references++;
    if (water) metadata.waterReferences++;
    geometryKinds.set(geometry, water);
    updateGeometryMarker(metadata);
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      geometryReleases.delete(geometry);
      geometry.removeEventListener('dispose', release);
      if (geometryKinds.get(geometry)) metadata.waterReferences--;
      geometryKinds.delete(geometry);
      if (--metadata.references !== 0) {
        updateGeometryMarker(metadata);
        return;
      }
      if (geometry.getAttribute(OPENING_SURFACE) === metadata.attribute) {
        if (metadata.previous)
          geometry.setAttribute(OPENING_SURFACE, metadata.previous);
        else geometry.deleteAttribute(OPENING_SURFACE);
      }
      openingGeometry.delete(geometry);
    };
    geometryReleases.set(geometry, release);
    geometry.addEventListener('dispose', release);
  };
  const visit = (object: THREE.Object3D) => {
    if (disposed) return;
    if (!watched.has(object)) {
      watched.add(object);
      object.addEventListener('childadded', added);
      object.addEventListener('childremoved', removed);
    }
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      if (
        materials.every(
          (material) => !(material instanceof THREE.ShaderMaterial),
        )
      )
        enrollGeometry(
          object.geometry,
          (() => {
            for (
              let parent: THREE.Object3D | null = object;
              parent;
              parent = parent.parent
            )
              if (waterRootSet.has(parent)) return true;
            return false;
          })(),
        );
      for (const material of materials) {
        if (seen.has(material) || material instanceof THREE.ShaderMaterial)
          continue;
        seen.add(material);
        const before = material.onBeforeCompile,
          key = material.customProgramCacheKey,
          originalKey = key.call(material),
          defaultsMaterial = material as MaterialWithDefaults,
          previousDefaults = defaultsMaterial.defaultAttributeValues,
          defaults = previousDefaults ?? {},
          previousSurfaceDefault = defaults[OPENING_SURFACE],
          surfaceDefault = [0];
        defaults[OPENING_SURFACE] = surfaceDefault;
        defaultsMaterial.defaultAttributeValues = defaults;
        const patched: THREE.Material['onBeforeCompile'] = function (
          this: THREE.Material,
          shader,
          renderer,
        ) {
          before.call(this, shader, renderer);
          bindUniforms(shader);
          shader.vertexShader = `attribute float ${OPENING_SURFACE};
             varying float vStationOpeningSurface;
             varying vec3 vStationOpeningWorld;\n${shader.vertexShader}`.replace(
            '#include <project_vertex>',
            `
          vec4 stationOpeningPosition = vec4(transformed,1.0);
          #ifdef USE_INSTANCING
            stationOpeningPosition = instanceMatrix * stationOpeningPosition;
          #endif
          vStationOpeningWorld = (modelMatrix * stationOpeningPosition).xyz;
          vStationOpeningSurface = ${OPENING_SURFACE};
          #include <project_vertex>`,
          );
          shader.fragmentShader = `
          varying vec3 vStationOpeningWorld;
          varying float vStationOpeningSurface;
          ${apertureUniformDeclarations}
          ${shader.fragmentShader}`.replace(
            '#include <clipping_planes_fragment>',
            `
          #include <clipping_planes_fragment>
          if(vStationOpeningSurface>0.5) {
            ${apertureFragment('vStationOpeningWorld')}
          }`,
          );
        };
        const patchedKey = function (this: THREE.Material) {
          return `${originalKey}|skytrain-geographic-portals-texture-v8-view-${CAPACITY}-${REGION_CAPACITY}-${PER_STATION}`;
        };
        material.onBeforeCompile = patched;
        material.customProgramCacheKey = patchedKey;
        material.needsUpdate = true;
        const patch: MaterialPatch = {
          material,
          before,
          key,
          patched,
          patchedKey,
          release: () => {
            if (!patches.delete(patch)) return;
            seen.delete(material);
            material.removeEventListener('dispose', patch.release);
            if (defaults[OPENING_SURFACE] === surfaceDefault) {
              if (previousSurfaceDefault)
                defaults[OPENING_SURFACE] = previousSurfaceDefault;
              else delete defaults[OPENING_SURFACE];
            }
            if (
              !previousDefaults &&
              defaultsMaterial.defaultAttributeValues === defaults &&
              Object.keys(defaults).length === 0
            )
              delete defaultsMaterial.defaultAttributeValues;
            if (material.onBeforeCompile === patched)
              material.onBeforeCompile = before;
            if (material.customProgramCacheKey === patchedKey)
              material.customProgramCacheKey = key;
            material.needsUpdate = true;
          },
        };
        patches.add(patch);
        material.addEventListener('dispose', patch.release);
      }
    }
    for (const child of object.children) visit(child);
  };
  const unwatch = (object: THREE.Object3D) => {
    if (watched.delete(object)) {
      object.removeEventListener('childadded', added);
      object.removeEventListener('childremoved', removed);
    }
    for (const child of object.children) unwatch(child);
  };
  const added = (event: THREE.Object3DEventMap['childadded']) =>
    visit(event.child);
  const removed = (event: THREE.Object3DEventMap['childremoved']) =>
    unwatch(event.child);
  const refresh = (additionalRoots?: readonly THREE.Object3D[]) => {
    if (!disposed)
      for (const root of additionalRoots ?? [...roots, ...waterRoots])
        visit(root);
  };
  refresh();
  return {
    refresh,
    update(owners) {
      if (
        disposed ||
        (owners.length === previousOwners.length &&
          owners.every((owner, index) => owner === previousOwners[index]))
      )
        return;
      if (owners.length > STATIONS)
        throw new Error('SkyTrain station owner capacity exceeded');
      const nextData = new Float32Array(apertureData.length),
        nextBounds: THREE.Vector4[] = [],
        nextRanges: THREE.Vector4[] = [],
        nextOwnerRows = new Map<
          SkyTrainStationOwner,
          { start: number; count: number }
        >();
      let i = 0;
      for (const owner of owners) {
        const ownerStart = i;
        let start = i,
          box = new THREE.Box3(),
          minY = Infinity,
          maxY = -Infinity;
        const finishPage = () => {
          if (i === start) return;
          if (nextBounds.length === REGION_CAPACITY)
            throw new Error(
              'SkyTrain station aperture region capacity exceeded',
            );
          const center = box.getCenter(new THREE.Vector3()),
            size = box.getSize(new THREE.Vector3());
          nextBounds.push(
            new THREE.Vector4(center.x, center.z, size.x / 2, size.z / 2),
          );
          nextRanges.push(new THREE.Vector4(start, i - start, minY, maxY));
          start = i;
          box = new THREE.Box3();
          minY = Infinity;
          maxY = -Infinity;
        };
        for (const opening of stationCityOpenings(owner)) {
          const polygon = opening.polygon;
          if (polygon.length !== 4)
            throw new Error('Station portal must be a bounded quadrilateral');
          const a = new THREE.Vector3(...polygon[0]),
            b = new THREE.Vector3(...polygon[1]),
            d = new THREE.Vector3(...polygon[3]),
            width = Math.hypot(d.x - a.x, d.z - a.z),
            length = Math.hypot(b.x - a.x, b.z - a.z),
            center = a
              .clone()
              .add(new THREE.Vector3(...polygon[2]))
              .multiplyScalar(0.5);
          if (width < 0.01 || length < 0.01) continue;
          if (i === CAPACITY)
            throw new Error('SkyTrain entrance aperture capacity exceeded');
          nextData.set(
            [
              center.x,
              center.z,
              width / 2,
              length / 2,
              (d.x - a.x) / width,
              (d.z - a.z) / width,
              opening.minY,
              opening.maxY,
            ],
            i * 8,
          );
          for (const point of polygon)
            box.expandByPoint(new THREE.Vector3(...point));
          minY = Math.min(minY, opening.minY);
          maxY = Math.max(maxY, opening.maxY);
          i++;
          if (i - start === PER_STATION) finishPage();
        }
        finishPage();
        nextOwnerRows.set(owner, {
          start: ownerStart,
          count: i - ownerStart,
        });
      }
      // Commit only after all bounds/capacity checks succeed. A rejected
      // refresh retains the complete previous shader texture and page ranges.
      for (let page = 0; page < REGION_CAPACITY; page++) {
        bounds[page].copy(nextBounds[page] ?? new THREE.Vector4());
        ranges[page].copy(nextRanges[page] ?? new THREE.Vector4());
      }
      apertureData.set(nextData);
      apertureTexture.needsUpdate = true;
      count.value = i;
      regionCount.value = nextBounds.length;
      previousOwners = [...owners];
      ownerRows = nextOwnerRows;
      updateView();
    },
    setViewCutaway(owner, ceilingY, cameraPosition) {
      if (disposed) return;
      const validCamera =
        !cameraPosition ||
        cameraPosition
          .toArray()
          .every((value) => Number.isFinite(value) && Math.abs(value) <= 1e6);
      viewOwner = validCamera ? owner : null;
      viewCeiling = ceilingY;
      viewCamera = validCamera ? cameraPosition?.clone() : undefined;
      updateView();
    },
    prepareGroundMaterial(material) {
      if (disposed || seen.has(material)) return () => {};
      const existing = normalPatches.get(material);
      if (existing) return existing;
      // oxlint-disable-next-line typescript/unbound-method -- Borrowed hooks are restored by identity and invoked with .call.
      const before = material.onBeforeCompile;
      // oxlint-disable-next-line typescript/unbound-method -- Borrowed cache keys preserve the material receiver.
      const key = material.customProgramCacheKey;
      const defaultsMaterial = material as MaterialWithDefaults,
        previousDefaults = defaultsMaterial.defaultAttributeValues,
        defaults = previousDefaults ?? {},
        previousSurfaceDefault = defaults[OPENING_SURFACE],
        surfaceDefault = [0];
      // Mutate only our own default entry. TravelOcclusion owns the surrounding
      // map, so material disposal remains correct in either listener order.
      defaults[OPENING_SURFACE] = surfaceDefault;
      defaultsMaterial.defaultAttributeValues = defaults;
      const originalKey = key.call(material),
        patched: THREE.Material['onBeforeCompile'] = function (
          this: THREE.Material,
          shader,
          renderer,
        ) {
          before.call(this, shader, renderer);
          // TravelOcclusion supplies world coordinates for the override. The
          // separate city enrollment attribute also covers building roofs and
          // water, while missing attributes explicitly default to zero for the
          // avatar, train and authored station geometry.
          if (
            !shader.vertexShader.includes('vTravelCutawayWorld =') ||
            !shader.vertexShader.includes('#include <project_vertex>') ||
            !shader.fragmentShader.includes('varying vec3 vTravelCutawayWorld;')
          )
            return;
          bindUniforms(shader);
          shader.vertexShader = `attribute float ${OPENING_SURFACE};
             varying float vStationOpeningSurface;
             ${shader.vertexShader}`.replace(
            '#include <project_vertex>',
            `vStationOpeningSurface = ${OPENING_SURFACE};
               #include <project_vertex>`,
          );
          shader.fragmentShader = `varying float vStationOpeningSurface;
             ${apertureUniformDeclarations}\n${shader.fragmentShader}`.replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
             if(vStationOpeningSurface>0.5) {
               ${apertureFragment('vTravelCutawayWorld')}
             }`,
          );
        },
        patchedKey = function (this: THREE.Material) {
          return `${originalKey}|skytrain-city-portals-normal-v5-${CAPACITY}-${REGION_CAPACITY}-${PER_STATION}`;
        };
      let active = true;
      const release = () => {
        if (!active) return;
        active = false;
        normalPatches.delete(material);
        material.removeEventListener('dispose', release);
        if (defaults[OPENING_SURFACE] === surfaceDefault) {
          if (previousSurfaceDefault)
            defaults[OPENING_SURFACE] = previousSurfaceDefault;
          else delete defaults[OPENING_SURFACE];
        }
        if (
          !previousDefaults &&
          defaultsMaterial.defaultAttributeValues === defaults &&
          Object.keys(defaults).length === 0
        )
          delete defaultsMaterial.defaultAttributeValues;
        let changed = false;
        if (material.onBeforeCompile === patched) {
          material.onBeforeCompile = before;
          changed = true;
        }
        if (material.customProgramCacheKey === patchedKey) {
          material.customProgramCacheKey = key;
          changed = true;
        }
        if (changed) material.needsUpdate = true;
      };
      material.onBeforeCompile = patched;
      material.customProgramCacheKey = patchedKey;
      material.needsUpdate = true;
      material.addEventListener('dispose', release);
      normalPatches.set(material, release);
      return release;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      viewOwner = null;
      viewCeiling = undefined;
      viewCamera = undefined;
      ownerRows.clear();
      updateView();
      count.value = 0;
      regionCount.value = 0;
      for (const object of watched) {
        object.removeEventListener('childadded', added);
        object.removeEventListener('childremoved', removed);
      }
      watched.clear();
      for (const release of geometryReleases.values()) release();
      for (const release of normalPatches.values()) release();
      for (const patch of patches) patch.release();
      apertureTexture.dispose();
      previousOwners = [];
    },
  };
}

/** Bounded station portal apertures in the existing city surfaces. A station
 * walker owns the corresponding physical floor; ordinary city physics is never
 * granted a platform, vehicle or underground navigation permission. */
import * as THREE from 'three';
import type { SkyTrainStationOwner } from './skytrain-stations';
import type { StationTerrainOpening } from './skytrain-street-access';
const STATIONS = 7;
const PER_STATION = 48;
const CAPACITY = STATIONS * PER_STATION;
interface MaterialPatch {
  material: THREE.Material;
  before: THREE.Material['onBeforeCompile'];
  key: THREE.Material['customProgramCacheKey'];
  patched: THREE.Material['onBeforeCompile'];
  patchedKey: THREE.Material['customProgramCacheKey'];
}
export interface SkyTrainWorldOpenings {
  /** Call only when new city/landmark geometry introduces new materials. */
  refresh(additionalRoots?: readonly THREE.Object3D[]): void;
  update(owners: readonly SkyTrainStationOwner[]): void;
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
    const box = new THREE.Box3().setFromPoints(
      floor.vertices.map((point) => new THREE.Vector3(...point)),
    );
    add(
      `${floor.id}-authored-room-clearance`,
      [
        new THREE.Vector3(box.min.x - 0.03, box.min.y, box.min.z - 0.03),
        new THREE.Vector3(box.min.x - 0.03, box.min.y, box.max.z + 0.03),
        new THREE.Vector3(box.max.x + 0.03, box.min.y, box.max.z + 0.03),
        new THREE.Vector3(box.max.x + 0.03, box.min.y, box.min.z - 0.03),
      ],
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
  return openings;
}
/** Chain material hooks, including architectural seed replacement, PBR atlases
 * and terrain finishing. Only matching world-space portal volumes are removed. */
export function applySkyTrainWorldOpenings(
  roots: readonly THREE.Object3D[],
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
    bounds = Array.from({ length: STATIONS }, () => new THREE.Vector4()),
    ranges = Array.from({ length: STATIONS }, () => new THREE.Vector4()),
    count = { value: 0 },
    regionCount = { value: 0 },
    boundsUniform = { value: bounds },
    rangesUniform = { value: ranges },
    apertureUniform = { value: apertureTexture },
    patches: MaterialPatch[] = [],
    seen = new Set<THREE.Material>();
  apertureTexture.minFilter = apertureTexture.magFilter = THREE.NearestFilter;
  apertureTexture.colorSpace = THREE.NoColorSpace;
  apertureTexture.generateMipmaps = false;
  apertureTexture.needsUpdate = true;
  let disposed = false;
  let previousOwners: readonly SkyTrainStationOwner[] = [];
  const refresh = (additionalRoots?: readonly THREE.Object3D[]) => {
    if (disposed) return;
    for (const root of additionalRoots ?? roots)
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if (seen.has(material) || material instanceof THREE.ShaderMaterial)
            continue;
          seen.add(material);
          const before = material.onBeforeCompile,
            key = material.customProgramCacheKey,
            originalKey = key.call(material);
          const patched: THREE.Material['onBeforeCompile'] = function (
            this: THREE.Material,
            shader,
            renderer,
          ) {
            before.call(this, shader, renderer);
            shader.uniforms.uStationOpeningCount = count;
            shader.uniforms.uStationOpeningData = apertureUniform;
            shader.uniforms.uStationRegionCount = regionCount;
            shader.uniforms.uStationRegionBounds = boundsUniform;
            shader.uniforms.uStationRegionRanges = rangesUniform;
            shader.vertexShader =
              `varying vec3 vStationOpeningWorld;\n${shader.vertexShader}`.replace(
                '#include <project_vertex>',
                `
          vec4 stationOpeningPosition = vec4(transformed,1.0);
          #ifdef USE_INSTANCING
            stationOpeningPosition = instanceMatrix * stationOpeningPosition;
          #endif
          vStationOpeningWorld = (modelMatrix * stationOpeningPosition).xyz;
          #include <project_vertex>`,
              );
            shader.fragmentShader = `
          varying vec3 vStationOpeningWorld;
          uniform int uStationOpeningCount;
          uniform highp sampler2D uStationOpeningData;
          uniform int uStationRegionCount;
          uniform vec4 uStationRegionBounds[${STATIONS}];
          uniform vec4 uStationRegionRanges[${STATIONS}];
          ${shader.fragmentShader}`.replace(
              '#include <clipping_planes_fragment>',
              `
          #include <clipping_planes_fragment>
          for(int stationRegionIndex=0;stationRegionIndex<${STATIONS};stationRegionIndex++) {
            if(stationRegionIndex>=uStationRegionCount) break;
            vec4 stationBounds=uStationRegionBounds[stationRegionIndex];
            vec4 stationRange=uStationRegionRanges[stationRegionIndex];
            vec2 stationDelta=abs(vStationOpeningWorld.xz-stationBounds.xy);
            if(stationDelta.x>stationBounds.z || stationDelta.y>stationBounds.w || vStationOpeningWorld.y<stationRange.z || vStationOpeningWorld.y>stationRange.w) continue;
            for(int stationLocalIndex=0;stationLocalIndex<${PER_STATION};stationLocalIndex++) {
            if(stationLocalIndex>=int(stationRange.y)) break;
            int stationOpeningIndex=int(stationRange.x)+stationLocalIndex;
            if(stationOpeningIndex>=uStationOpeningCount) break;
            vec4 r=texelFetch(uStationOpeningData,ivec2(0,stationOpeningIndex),0);
            vec4 p=texelFetch(uStationOpeningData,ivec2(1,stationOpeningIndex),0);
            vec2 delta=vStationOpeningWorld.xz-r.xy;
            float across=dot(delta,p.xy);
            float along=dot(delta,vec2(-p.y,p.x));
            if(abs(across)<r.z && abs(along)<r.w && vStationOpeningWorld.y>=p.z && vStationOpeningWorld.y<=p.w) discard;
            }
          }`,
            );
          };
          const patchedKey = function (this: THREE.Material) {
            return `${originalKey}|skytrain-geographic-portals-texture-v3-${CAPACITY}`;
          };
          material.onBeforeCompile = patched;
          material.customProgramCacheKey = patchedKey;
          material.needsUpdate = true;
          patches.push({ material, before, key, patched, patchedKey });
        }
      });
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
      const nextData = new Float32Array(apertureData.length);
      let i = 0,
        region = 0;
      for (const owner of owners) {
        const start = i,
          box = new THREE.Box3();
        let minY = Infinity,
          maxY = -Infinity;
        for (const opening of stationCityOpenings(owner)) {
          if (i === CAPACITY)
            throw new Error('SkyTrain entrance aperture capacity exceeded');
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
        }
        if (i === start) continue;
        if (region === STATIONS || i - start > PER_STATION)
          throw new Error('SkyTrain station aperture region capacity exceeded');
        const center = box.getCenter(new THREE.Vector3()),
          size = box.getSize(new THREE.Vector3());
        bounds[region].set(center.x, center.z, size.x / 2, size.z / 2);
        ranges[region].set(start, i - start, minY, maxY);
        region++;
      }
      apertureData.set(nextData);
      apertureTexture.needsUpdate = true;
      count.value = i;
      regionCount.value = region;
      previousOwners = [...owners];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      count.value = 0;
      regionCount.value = 0;
      for (const patch of patches) {
        if (patch.material.onBeforeCompile === patch.patched)
          patch.material.onBeforeCompile = patch.before;
        if (patch.material.customProgramCacheKey === patch.patchedKey)
          patch.material.customProgramCacheKey = patch.key;
        patch.material.needsUpdate = true;
      }
      patches.length = 0;
      apertureTexture.dispose();
      previousOwners = [];
    },
  };
}

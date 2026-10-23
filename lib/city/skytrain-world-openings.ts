/** Bounded station portal apertures in the existing city surfaces. A station
 * walker owns the corresponding physical floor; ordinary city physics is never
 * granted a platform, vehicle or underground navigation permission. */
import * as THREE from 'three';
import type { SkyTrainStationOwner } from './skytrain-stations';
const CAPACITY = 96;
const STATIONS = 7;
const PER_STATION = 48;
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
/** Chain material hooks, including architectural seed replacement, PBR atlases
 * and terrain finishing. Only matching world-space portal volumes are removed. */
export function applySkyTrainWorldOpenings(
  roots: readonly THREE.Object3D[],
): SkyTrainWorldOpenings {
  const rectangles = Array.from(
      { length: CAPACITY },
      () => new THREE.Vector4(),
    ),
    parameters = Array.from({ length: CAPACITY }, () => new THREE.Vector4()),
    bounds = Array.from({ length: STATIONS }, () => new THREE.Vector4()),
    ranges = Array.from({ length: STATIONS }, () => new THREE.Vector4()),
    count = { value: 0 },
    regionCount = { value: 0 },
    boundsUniform = { value: bounds },
    rangesUniform = { value: ranges },
    rectUniform = { value: rectangles },
    parameterUniform = { value: parameters },
    patches: MaterialPatch[] = [],
    seen = new Set<THREE.Material>();
  let disposed = false;
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
            shader.uniforms.uStationOpeningRect = rectUniform;
            shader.uniforms.uStationOpeningParameters = parameterUniform;
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
          uniform vec4 uStationOpeningRect[${CAPACITY}];
          uniform vec4 uStationOpeningParameters[${CAPACITY}];
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
            vec4 r=uStationOpeningRect[stationOpeningIndex];
            vec4 p=uStationOpeningParameters[stationOpeningIndex];
            vec2 delta=vStationOpeningWorld.xz-r.xy;
            float across=dot(delta,p.xy);
            float along=dot(delta,vec2(-p.y,p.x));
            if(abs(across)<r.z && abs(along)<r.w && vStationOpeningWorld.y>=p.z && vStationOpeningWorld.y<=p.w) discard;
            }
          }`,
            );
          };
          const patchedKey = function (this: THREE.Material) {
            return `${originalKey}|skytrain-geographic-portals-v2-${CAPACITY}`;
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
      if (disposed) return;
      let i = 0,
        region = 0;
      for (const owner of owners) {
        const start = i,
          box = new THREE.Box3();
        let minY = Infinity,
          maxY = -Infinity;
        for (const opening of owner.terrainOpenings()) {
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
          rectangles[i].set(center.x, center.z, width / 2, length / 2);
          parameters[i].set(
            (d.x - a.x) / width,
            (d.z - a.z) / width,
            opening.minY,
            opening.maxY,
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
      count.value = i;
      regionCount.value = region;
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
    },
  };
}

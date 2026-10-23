import * as THREE from 'three';
import {
  STREET_SHOWCASE_GLSL,
  streetShowcaseWeight,
} from '../street-quality-profile';

/** Original, texture-free material finishing for the Robson/Burrard pilot.
 * Positions, normals, collision, animation and resource ownership are unchanged.
 * Every change is blended from the existing material in world space; moving a
 * vehicle beyond the district or above 300m restores its authored appearance.
 */
export type VehicleSurfaceRole =
  | 'roadster-paint'
  | 'paint'
  | 'metal'
  | 'rubber'
  | 'leather'
  | 'roadster-glass'
  | 'glazing'
  | 'rocket-paint'
  | 'rocket-black'
  | 'rocket-metal'
  | 'aircraft-batch'
  | 'crowd';

export const VEHICLE_SURFACE_ALTITUDE = Object.freeze({
  fullM: 150,
  offM: 300,
});

/** Also used by QA: source material is exact outside the appearance envelope. */
export function vehicleSurfaceWeight(x: number, y: number, z: number) {
  if (![x, y, z].every(Number.isFinite)) return 0;
  const t = THREE.MathUtils.clamp(
    (y - VEHICLE_SURFACE_ALTITUDE.fullM) /
      (VEHICLE_SURFACE_ALTITUDE.offM - VEHICLE_SURFACE_ALTITUDE.fullM),
    0,
    1,
  );
  return streetShowcaseWeight(x, z) * (1 - t * t * (3 - 2 * t));
}

const finish: Record<
  Exclude<VehicleSurfaceRole, 'aircraft-batch' | 'crowd'>,
  readonly [roughness: number, metalness: number]
> = {
  'roadster-paint': [0.23, 0.24],
  paint: [0.25, 0.25],
  metal: [0.25, 0.84],
  rubber: [0.94, 0],
  leather: [0.8, 0],
  'roadster-glass': [0.1, 0.04],
  glazing: [0.11, 0.08],
  'rocket-paint': [0.34, 0.08],
  'rocket-black': [0.54, 0.32],
  'rocket-metal': [0.29, 0.82],
};

const roadsterDetail = `
// Sub-pixel seams fade through derivatives, rather than shimmering at distance.
float atlasRoadsterLine(float distanceM, float halfWidthM) {
  float footprint=max(fwidth(distanceM),.0008);
  return 1.-smoothstep(halfWidthM,halfWidthM+footprint,abs(distanceM));
}
float atlasRoadsterPanel(vec3 p, vec3 n) {
  float side=smoothstep(.5,.86,abs(normalize(n).x));
  vec2 q=abs(vec2(p.z+.175,p.y-.575))-vec2(.61,.145);
  float door=length(max(q,0.))+min(max(q.x,q.y),0.)-.045;
  float seam=atlasRoadsterLine(door,.0032)*side;
  float top=smoothstep(.55,.92,normalize(n).y);
  float hood=atlasRoadsterLine(p.z-.7,.003)*
    (1.-smoothstep(.62,.76,abs(p.x)))*top;
  float deck=atlasRoadsterLine(p.z+.94,.003)*
    (1.-smoothstep(.64,.78,abs(p.x)))*top;
  return max(seam,max(hood,deck));
}
`;

/** Retains any earlier shader (traffic wheel rotation / pedestrian deformation).
 * No updates, renderer reference, textures or per-frame JS are required.
 * aircraft-batch expects the factory's per-vertex `assetSurface` rough/metal;
 * crowd expects the existing clothing hook's `_palette` vertex attribute.
 */
export function installVehicleSurface(
  material: THREE.MeshStandardMaterial,
  role: VehicleSurfaceRole,
) {
  // oxlint-disable-next-line typescript/unbound-method
  const previous = material.onBeforeCompile;
  // oxlint-disable-next-line typescript/unbound-method
  const previousKey = material.customProgramCacheKey;
  const local = role === 'roadster-paint';
  const batched = role === 'aircraft-batch';
  const crowd = role === 'crowd';
  const varyings = `varying vec3 vAtlasSurfaceWorld;
${local ? 'varying vec3 vAtlasSurfaceLocal; varying vec3 vAtlasSurfaceNormal;' : ''}
${batched ? 'varying vec2 vAtlasAssetSurface;' : ''}
${crowd ? 'varying float vAtlasSurfacePalette;' : ''}
`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${varyings}
${batched ? 'attribute vec2 assetSurface;' : ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 atlasSurfaceWorld=vec4(transformed,1.);
#ifdef USE_BATCHING
  atlasSurfaceWorld=batchingMatrix*atlasSurfaceWorld;
#endif
#ifdef USE_INSTANCING
  atlasSurfaceWorld=instanceMatrix*atlasSurfaceWorld;
#endif
vAtlasSurfaceWorld=(modelMatrix*atlasSurfaceWorld).xyz;
${local ? 'vAtlasSurfaceLocal=position; vAtlasSurfaceNormal=normal;' : ''}
${batched ? 'vAtlasAssetSurface=assetSurface;' : ''}
${crowd ? 'vAtlasSurfacePalette=_palette;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${varyings}\n${STREET_SHOWCASE_GLSL}
${local ? roadsterDetail : ''}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float atlasSurfaceWeight=atlasStreetShowcaseWeight(vAtlasSurfaceWorld.xz)*
  (1.-smoothstep(${VEHICLE_SURFACE_ALTITUDE.fullM.toFixed(1)},${VEHICLE_SURFACE_ALTITUDE.offM.toFixed(1)},vAtlasSurfaceWorld.y));
${
  local
    ? `float atlasRoadsterPanelAmount=atlasRoadsterPanel(vAtlasSurfaceLocal,vAtlasSurfaceNormal);
if(atlasSurfaceWeight>0.) {
  diffuseColor.rgb*=1.-atlasRoadsterPanelAmount*.77*atlasSurfaceWeight;
}`
    : ''
}
${
  crowd
    ? `float atlasCloth=max(step(1.5,vAtlasSurfacePalette)*(1.-step(3.5,vAtlasSurfacePalette)),
  step(5.5,vAtlasSurfacePalette)*(1.-step(6.5,vAtlasSurfacePalette)));
if(atlasSurfaceWeight>0.) {
  float atlasClothLuma=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
  diffuseColor.rgb=mix(diffuseColor.rgb,mix(diffuseColor.rgb,vec3(atlasClothLuma),.32)*.94,atlasCloth*atlasSurfaceWeight);
}`
    : ''
}
${
  role === 'roadster-glass' || role === 'glazing'
    ? `if(atlasSurfaceWeight>0.) {
  diffuseColor.rgb*=mix(vec3(1.),vec3(.72,.83,.9),atlasSurfaceWeight);
  ${role === 'roadster-glass' ? 'diffuseColor.a=mix(diffuseColor.a,.38,atlasSurfaceWeight);' : ''}
}`
    : ''
}`,
    );
    const surface = batched
      ? 'vAtlasAssetSurface'
      : crowd
        ? `vec2(mix(.91,.66,1.-step(.5,abs(vAtlasSurfacePalette-1.))) -
            .12*(1.-step(.5,abs(vAtlasSurfacePalette-4.))),0.)`
        : `vec2(${finish[role as keyof typeof finish][0]},${finish[role as keyof typeof finish][1]})`;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if(atlasSurfaceWeight>0.) roughnessFactor=mix(roughnessFactor,(${surface}).x,atlasSurfaceWeight);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
if(atlasSurfaceWeight>0.) metalnessFactor=mix(metalnessFactor,(${surface}).y,atlasSurfaceWeight);`,
      );
    if (role !== 'rubber' && role !== 'leather' && role !== 'crowd')
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
reflectedLight.indirectSpecular*=1.+atlasSurfaceWeight*.65;`,
      );
  };
  material.customProgramCacheKey = () =>
    `${previousKey.call(material)}/robson-burrard-surface-v1/${role}`;
  material.userData.streetSurface = {
    role,
    sourceOutsidePilot: true,
    altitudeFade: VEHICLE_SURFACE_ALTITUDE,
  };
  return material;
}

const contactShadowShape = Object.freeze({
  innerHalfWidthUv: 0.23,
  innerHalfLengthUv: 0.27,
  radiusUv: 0.1,
  fadeStartUv: -0.02,
  fadeEndUv: 0.12,
  coreOpacity: 1.2,
});

/** CPU reference for the analytic shadow footprint. Every plane border reaches
 * zero before clipping; the centre remains a little denser under the chassis. */
export function pilotContactShadowFalloff(u: number, v: number): number {
  if (![u, v].every(Number.isFinite)) return 0;
  const p = contactShadowShape;
  const x = Math.abs(u - 0.5) - p.innerHalfWidthUv;
  const y = Math.abs(v - 0.5) - p.innerHalfLengthUv;
  const distance =
    Math.hypot(Math.max(x, 0), Math.max(y, 0)) +
    Math.min(Math.max(x, y), 0) -
    p.radiusUv;
  const t = THREE.MathUtils.clamp(
    (distance - p.fadeStartUv) / (p.fadeEndUv - p.fadeStartUv),
    0,
    1,
  );
  return p.coreOpacity * (1 - t * t * (3 - 2 * t));
}

/** Reuses the existing single contact-shadow plane and Basic material. Only
 * pilot fragments receive a rounded, soft UV footprint; outside alpha, colour,
 * blending, depth policy and any earlier shader remain exactly as authored. */
export function installPilotContactShadow(material: THREE.MeshBasicMaterial) {
  // oxlint-disable-next-line typescript/unbound-method
  const previous = material.onBeforeCompile;
  // oxlint-disable-next-line typescript/unbound-method
  const previousKey = material.customProgramCacheKey;
  const varyings =
    'varying vec2 vAtlasContactUv; varying vec3 vAtlasContactWorld;';
  const p = contactShadowShape;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vAtlasContactUv=uv;
vec4 atlasContactWorld=vec4(transformed,1.);
#ifdef USE_BATCHING
  atlasContactWorld=batchingMatrix*atlasContactWorld;
#endif
#ifdef USE_INSTANCING
  atlasContactWorld=instanceMatrix*atlasContactWorld;
#endif
vAtlasContactWorld=(modelMatrix*atlasContactWorld).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n${varyings}\n${STREET_SHOWCASE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float atlasContactWeight=atlasStreetShowcaseWeight(vAtlasContactWorld.xz)*
  (1.-smoothstep(${VEHICLE_SURFACE_ALTITUDE.fullM.toFixed(1)},${VEHICLE_SURFACE_ALTITUDE.offM.toFixed(1)},vAtlasContactWorld.y));
if(atlasContactWeight>0.) {
  vec2 contactQ=abs(vAtlasContactUv-.5)-vec2(${p.innerHalfWidthUv},${p.innerHalfLengthUv});
  float contactDistance=length(max(contactQ,vec2(0.)))+min(max(contactQ.x,contactQ.y),0.)-${p.radiusUv};
  float contactFalloff=${p.coreOpacity}*(1.-smoothstep(${p.fadeStartUv},${p.fadeEndUv},contactDistance));
  diffuseColor.a=mix(diffuseColor.a,diffuseColor.a*contactFalloff,atlasContactWeight);
}`,
      );
  };
  material.customProgramCacheKey = () =>
    `${previousKey.call(material)}/robson-burrard-contact-shadow-v1`;
  return material;
}

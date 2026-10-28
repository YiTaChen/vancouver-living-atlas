import * as THREE from 'three';

/** A visual-only finish on the existing front intake. Coordinates are in the
 * original roadster dark mesh's metres; geometry, collision and draw count are
 * unchanged. The material is shared with other car pieces, so the narrow local
 * position and normal gate is essential. */
export function roadsterGrilleEligible(
  position: readonly [number, number, number],
  normal: readonly [number, number, number],
) {
  return (
    position.every(Number.isFinite) &&
    normal.every(Number.isFinite) &&
    Math.abs(position[0]) <= 0.55 &&
    position[1] >= 0.295 &&
    position[1] <= 0.435 &&
    position[2] >= 2.17 &&
    position[2] <= 2.34 &&
    normal[2] >= 0.85
  );
}

/** Compose after the existing local surface and night-field hooks. No material
 * values change; zero pilot weight takes the exact previous colour path. The
 * returned uninstaller never overwrites a later independently installed hook. */
export function installPilotRoadsterGrille(
  material: THREE.MeshStandardMaterial,
) {
  if (material.userData.streetSurface?.role !== 'leather') return () => {};
  // oxlint-disable-next-line typescript/unbound-method
  const previous = material.onBeforeCompile;
  // oxlint-disable-next-line typescript/unbound-method
  const previousKey = material.customProgramCacheKey;
  let active = true;
  const compile: THREE.Material['onBeforeCompile'] = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (!active) return;
    // The leather finish provides the spatial weight before this point. If an
    // upstream hook or Three changes its contract, keep the prior shader intact.
    if (
      !shader.vertexShader.includes('#include <project_vertex>') ||
      !shader.vertexShader.includes('#include <common>') ||
      !shader.fragmentShader.includes('#include <common>') ||
      !shader.fragmentShader.includes('#include <roughnessmap_fragment>') ||
      !shader.fragmentShader.includes('float atlasSurfaceWeight=')
    )
      return;
    const varyings =
      'varying vec3 vPilotGrillePosition; varying vec3 vPilotGrilleNormal;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\nvPilotGrillePosition=position; vPilotGrilleNormal=normal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// Compute derivatives outside the geographic branch: neighbouring fragments
// may straddle the pilot boundary, and GLSL derivatives must stay defined.
float pilotGrilleFootprint=max(fwidth(vPilotGrillePosition.y),0.001);
float pilotGrilleXFootprint=max(fwidth(vPilotGrillePosition.x),0.001);
float pilotGrilleY=vPilotGrillePosition.y;
float pilotGrilleX=abs(vPilotGrillePosition.x);
float pilotGrilleLine=min(min(abs(pilotGrilleY-.325),abs(pilotGrilleY-.365)),abs(pilotGrilleY-.405));
float pilotGrilleBars=(1.-smoothstep(.004,.004+pilotGrilleFootprint,pilotGrilleLine))*min(1.,.008/pilotGrilleFootprint);
float pilotGrilleTrim=(1.-smoothstep(.003,.003+pilotGrilleXFootprint,abs(pilotGrilleX-.53)))*min(1.,.006/pilotGrilleXFootprint);
float pilotGrilleMask=step(pilotGrilleX,.55)*step(.295,pilotGrilleY)*step(pilotGrilleY,.435)
  *step(2.17,vPilotGrillePosition.z)*step(vPilotGrillePosition.z,2.34)
  *step(.85,vPilotGrilleNormal.z);
if(atlasSurfaceWeight>0.) {
  float pilotGrilleFinish=max(pilotGrilleBars*.60,pilotGrilleTrim*.45)*pilotGrilleMask*atlasSurfaceWeight;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.115,.135,.145),pilotGrilleFinish);
}`,
      );
  };
  const key = () =>
    `${previousKey.call(material)}${active ? '/pilot-roadster-grille-v1' : ''}`;
  material.onBeforeCompile = compile;
  material.customProgramCacheKey = key;
  material.needsUpdate = true;
  return () => {
    if (!active) return;
    active = false;
    if (material.onBeforeCompile === compile)
      material.onBeforeCompile = previous;
    if (material.customProgramCacheKey === key)
      material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
  };
}

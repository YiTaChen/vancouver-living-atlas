import * as THREE from 'three';
import {
  installCityMaterialLibrary,
  type CityMaterialLibrary,
} from './material-library';

/** Existing pavement UVs are world metres / 3. */
export function cityGroundMaterial(library: CityMaterialLibrary, slot: number) {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    installCityMaterialLibrary(shader, library);
    shader.vertexShader = 'varying vec2 vGroundMetres;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvGroundMetres=uv*3.0;',
    );
    shader.fragmentShader =
      'varying vec2 vGroundMetres;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      CitySurface groundSurface=citySurface(${slot.toFixed(1)},vGroundMetres);
      diffuseColor.rgb=groundSurface.color;
      ${
        slot === 2
          ? `
      // Sidewalk construction joints are separate from the mineral finish used
      // on concrete walls. Metre-based placement needs no location exceptions.
      vec2 slab=vGroundMetres/1.5;
      vec2 slabAA=max(fwidth(slab),vec2(.001));
      vec2 slabEdge=min(fract(slab),1.0-fract(slab));
      float slabJoint=1.0-smoothstep(.0015,.0015+slabAA.x,slabEdge.x)*smoothstep(.0015,.0015+slabAA.y,slabEdge.y);
      float slabDetail=1.0-smoothstep(.05,.25,max(slabAA.x,slabAA.y));
      diffuseColor.rgb*=1.0-slabJoint*.25*slabDetail;`
          : ''
      }`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=groundSurface.roughness;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      'normal=citySurfaceNormal(groundSurface,-vViewPosition,normal,.55);',
    );
  };
  material.customProgramCacheKey = () => `city-ground-pbr-v1-${slot}`;
  return material;
}

/** Each instance supplies its semantic material and physical size. */
export function cityReliefMaterial(library: CityMaterialLibrary) {
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = (shader) => {
    installCityMaterialLibrary(shader, library);
    shader.vertexShader =
      'attribute vec3 aReliefSize; attribute float aReliefSurface; varying vec2 vReliefMetres; varying float vReliefSurface;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 metricPosition=position*aReliefSize;
      vec3 direction=abs(normal);
      vReliefMetres=direction.z>.5?metricPosition.xy:(direction.x>.5?metricPosition.zy:metricPosition.xz);
      vReliefSurface=aReliefSurface;`,
    );
    shader.fragmentShader =
      'varying vec2 vReliefMetres; varying float vReliefSurface;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      CitySurface reliefSurface=citySurface(max(0.0,vReliefSurface),vReliefMetres);
      int reliefSlot=int(clamp(floor(vReliefSurface+.5),0.0,7.0));
      if(vReliefSurface>=0.0) diffuseColor.rgb*=reliefSurface.color/max(uCityAverageColor[reliefSlot],vec3(.025));`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=vReliefSurface<0.0?.27:reliefSurface.roughness;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      '#include <metalnessmap_fragment>\nmetalnessFactor=vReliefSurface<0.0?.12:reliefSurface.metalness;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      'if(vReliefSurface>=0.0) normal=citySurfaceNormal(reliefSurface,-vViewPosition,normal,.6);',
    );
  };
  material.customProgramCacheKey = () => 'city-relief-pbr-v1';
  return material;
}

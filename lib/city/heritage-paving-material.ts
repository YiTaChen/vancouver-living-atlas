import * as THREE from 'three';
import {
  installCityMaterialLibrary,
  type CityMaterialLibrary,
} from './material-library';

/** Clipped Water Street corridor; authored PBR without frame-end seams. */
export function heritagePavingMaterial(
  base: THREE.MeshStandardMaterial,
  sidewalk: boolean,
  library: CityMaterialLibrary,
) {
  const material = base.clone();
  material.name = sidewalk
    ? 'Water Street brick footway'
    : 'Water Street brick carriageway';
  material.map = null;
  material.normalMap = null;
  material.color.setHex(0xffffff);
  material.onBeforeCompile = (shader) => {
    installCityMaterialLibrary(shader, library);
    shader.vertexShader =
      'attribute vec4 aHeritagePaving; varying vec2 vPavingMetres;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvPavingMetres=aHeritagePaving.xy;',
    );
    shader.fragmentShader =
      'varying vec2 vPavingMetres;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      CitySurface pavingSurface=citySurface(5.0,vPavingMetres);
      diffuseColor.rgb=pavingSurface.color;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=pavingSurface.roughness;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      'normal=citySurfaceNormal(pavingSurface,-vViewPosition,normal,.65);',
    );
  };
  material.customProgramCacheKey = () => `water-st-city-pbr-v2-${sidewalk}`;
  return material;
}

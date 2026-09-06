import * as THREE from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { withRendererState, withShaderCheck } from './renderer-state';

/** Loading-only. Actually renders the existing pipeline offscreen at its real size. */
export function warmComposer(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  scene: THREE.Scene,
  ssao: SSAOPass | null,
  fxaa: ShaderPass | null,
  shadows: boolean,
) {
  if (renderer.getContext().isContextLost())
    throw new Error('Graphics context unavailable');
  const passes = composer.passes.map((pass) => ({
    pass,
    enabled: pass.enabled,
    screen: pass.renderToScreen,
  }));
  const screen = composer.renderToScreen,
    read = composer.readBuffer,
    write = composer.writeBuffer;
  const override = scene.overrideMaterial;
  const visibility: [THREE.Object3D, boolean][] = [];
  scene.traverse((object) => visibility.push([object, object.visible]));
  try {
    withRendererState(renderer, () => {
      renderer.shadowMap.enabled = shadows;
      renderer.shadowMap.needsUpdate = shadows;
      composer.renderToScreen = false;
      if (ssao) ssao.enabled = true;
      // This directly exercises RenderPass -> normal/depth/AO -> OutputPass -> FXAA.
      // Do not call engine.renderScene(): that also starts landmark/tree LOD work.
      withShaderCheck(renderer, () => composer.render(0));
      if (fxaa) {
        // Final FXAA normally targets the canvas. Warm that distinct output-colour key
        // without drawing over the loading overlay, using public material/geometry APIs.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
        );
        geometry.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2),
        );
        const proxy = new THREE.Mesh(geometry, fxaa.material);
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        try {
          renderer.setRenderTarget(null);
          withShaderCheck(renderer, () =>
            renderer.compile(proxy, camera, new THREE.Scene()),
          );
        } finally {
          geometry.dispose();
        }
      }
    });
    if (renderer.getContext().isContextLost())
      throw new Error('Graphics context lost during pipeline preparation');
  } finally {
    // SSAOPass's own normal override lacks finally; restore even after a thrown draw.
    scene.overrideMaterial = override;
    visibility.forEach(([object, visible]) => {
      object.visible = visible;
    });
    passes.forEach(({ pass, enabled, screen }) => {
      pass.enabled = enabled;
      pass.renderToScreen = screen;
    });
    composer.renderToScreen = screen;
    composer.readBuffer = read;
    composer.writeBuffer = write;
  }
}

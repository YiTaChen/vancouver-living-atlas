import * as THREE from 'three';
import type { CityEngine } from './engine';
/** A bounded, subdivided sea patch gives close sailing geometric waves without tessellating the entire ocean. */
export function addSailingWaves(e: CityEngine) {
  const centre = { value: new THREE.Vector2() },
    active = { value: 0 },
    time = { value: 0 };
  const material = (e.water.material as THREE.MeshStandardMaterial).clone();
  const glsl = `float seaWave(vec2 p,float t){return .24*sin(p.x*.14+p.y*.09-t*1.15)+.13*sin(p.y*.29-p.x*.11-t*1.65)+.045*sin(p.x*.64+p.y*.3-t*2.4);}`;
  const decorate = (mat: THREE.MeshStandardMaterial, patch: boolean) => {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uWaveCentre = centre;
      s.uniforms.uWaveActive = active;
      s.uniforms.uWaveTime = time;
      const declarations =
        'uniform vec2 uWaveCentre;uniform float uWaveActive;uniform float uWaveTime;varying vec3 vSeaWorld;\n' +
        glsl +
        '\n';
      s.vertexShader = declarations + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvSeaWorld=(modelMatrix*vec4(position,1.)).xyz;${patch ? 'float f=1.-smoothstep(65.,88.,distance(vSeaWorld.xz,uWaveCentre));transformed.y+=seaWave(vSeaWorld.xz,uWaveTime)*f;' : ''}`,
      );
      s.fragmentShader = declarations + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>\n${patch ? 'if(distance(vSeaWorld.xz,uWaveCentre)>88.)discard;' : 'if(uWaveActive>.5&&distance(vSeaWorld.xz,uWaveCentre)<=88.)discard;'}`,
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\nfloat h=seaWave(vSeaWorld.xz,uWaveTime);vec3 n=normalize(vec3((h-seaWave(vSeaWorld.xz+vec2(.15,0.),uWaveTime))/.15,1.,(h-seaWave(vSeaWorld.xz+vec2(0.,.15),uWaveTime))/.15));normal=normalize(mat3(viewMatrix)*n);`,
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb*=.98+.025*sin(vSeaWorld.x*.055+vSeaWorld.z*.08+uWaveTime*.6);',
      );
    };
    mat.customProgramCacheKey = () =>
      patch ? 'harbour-wave-patch-1' : 'harbour-sea-1';
    mat.needsUpdate = true;
  };
  decorate(e.water.material as THREE.MeshStandardMaterial, false);
  decorate(material, true);
  const geometry = new THREE.PlaneGeometry(180, 180, 120, 120).rotateX(
    -Math.PI / 2,
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.1;
  mesh.visible = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  e.scene.add(mesh);
  return {
    update() {
      const boat = e.navigation?.boat,
        on = e.navigation?.mode === 'boat' && boat?.state.surfaceId === 'sea';
      active.value = on ? 1 : 0;
      mesh.visible = Boolean(on);
      // Shared simulation time keeps bow/stern response locked to visible crests.
      time.value = on ? boat!.time : e.uniforms.time.value;
      if (on) {
        centre.value.set(boat!.state.x, boat!.state.z);
        mesh.position.set(boat!.state.x, 0.1, boat!.state.z);
      }
    },
  };
}

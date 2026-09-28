import type * as THREE from 'three';

type Shader = Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];

/** Original analytic architectural surfacing, layered on the shared metre-based
 * pane mask. No image download, extra material or additional city draw call.
 * Interior parallax is an appearance approximation, not traversable rooms. */
export function installArchitectureSurface(shader: Shader) {
  shader.vertexShader =
    `varying vec3 vArchitectureWorld;
varying vec3 vArchitectureNormal;\n` + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    vArchitectureWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
    vArchitectureNormal=normalize(mat3(modelMatrix)*normal);
  `,
  );
  shader.fragmentShader =
    `varying vec3 vArchitectureWorld;
varying vec3 vArchitectureNormal;
float architectureHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float architectureNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(architectureHash(i),architectureHash(i+vec2(1,0)),f.x),
    mix(architectureHash(i+vec2(0,1)),architectureHash(i+vec2(1,1)),f.x),f.y);
}\n` + shader.fragmentShader;

  const mark = 'facadeNormal=uBrickWeights[facadeStyle]*(1.0-facadePane);';
  shader.fragmentShader = shader.fragmentShader.replace(
    mark,
    `${mark}
    // Each wall retains its shared floor/bay coordinates. Recess shading and
    // view-dependent interior shift therefore stay aligned with physical frames.
    vec2 paneUV=clamp((grid-bounds.xz)/max(vec2(.1),bounds.yw-bounds.xz),0.0,1.0);
    paneUV=mix(paneUV,clamp(vec2((grid.x-.08)/.84,
      (vFacade.y-vBaseWindow.x)/max(.1,vBaseWindow.y-vBaseWindow.x)),0.0,1.0),lowerPane);
    vec3 wallNormal=normalize(vArchitectureNormal);
    vec3 toEye=normalize(cameraPosition-vArchitectureWorld);
    vec3 alongWall=normalize(cross(vec3(0,1,0),wallNormal));
    float facing=max(.24,abs(dot(toEye,wallNormal)));
    vec2 shift=vec2(dot(toEye,alongWall),toEye.y)*(.17/facing);
    vec2 room=clamp(paneUV-shift,0.0,1.0);
    float roomSeed=architectureHash(cellId+vFacade.ww);
    vec3 roomColor=mix(vec3(.054,.067,.065),vec3(.20,.158,.108),roomSeed*.72);
    float sideWall=smoothstep(.02,.15,room.x)*(1.0-smoothstep(.83,.98,room.x));
    float ceiling=smoothstep(.025,.22,1.0-room.y);
    roomColor*=mix(.58,1.0,sideWall)*mix(.45,1.0,ceiling);
    float floorMask=1.0-smoothstep(.15,.28,room.y);
    roomColor=mix(roomColor,vec3(.20,.164,.118)*(0.8+roomSeed*.3),floorMask*.45);
    float curtain=step(.71,roomSeed)*(1.0-smoothstep(.2,.38,room.x));
    roomColor=mix(roomColor,vec3(.32,.31,.26),curtain*.7);
    float furnishing=(1.0-smoothstep(.13,.16,abs(room.x-(.30+roomSeed*.35))))
      *(1.0-smoothstep(.30,.35,room.y))*step(.11,room.y);
    roomColor*=1.0-furnishing*.42;
    float fresnel=pow(1.0-min(1.0,facing),3.0);
    vec3 skyTint=mix(vec3(.09,.145,.16),vec3(.29,.39,.41),smoothstep(.04,.95,paneUV.y));
    vec3 enrichedGlass=mix(roomColor,skyTint,.36+fresnel*.43);
    enrichedGlass*=.85+roomSeed*.28;
    float reveal=smoothstep(.0,.075,paneUV.x)*smoothstep(.0,.065,1.0-paneUV.y);
    enrichedGlass*=mix(.48,1.0,reveal);
    float divider=1.0-smoothstep(.009,.018+max(.002,fwidth(paneUV.x)),abs(paneUV.x-.5));
    enrichedGlass=mix(enrichedGlass,vec3(.09,.12,.12),divider*step(1.5,float(facadeStyle))*.45);
    // Large scale weathering, masonry variation and concrete joints. Noise is
    // deliberately low contrast; material scale remains in metres, not pixels.
    float weather=architectureNoise(vFacade.xy*vec2(.23,.11)+vFacade.ww);
    vec3 enrichedWall=wall*(.89+weather*.17);
    float footStain=(1.0-smoothstep(vLayout.w+.1,vLayout.w+2.4,vFacade.y));
    enrichedWall*=1.0-footStain*.12;
    if(facadeStyle>1){
      vec2 panel=fract(vFacade.xy/vec2(1.7,pattern.x));
      vec2 seamAA=max(fwidth(vFacade.xy/vec2(1.7,pattern.x)),vec2(.002));
      float panelSeam=1.0-smoothstep(.0,.009+seamAA.x,min(panel.x,1.0-panel.x));
      enrichedWall*=1.0-panelSeam*.13;
    }
    diffuseColor.rgb=mix(enrichedWall,enrichedGlass,facadePane);
  `,
  );
  // Roof UVs intentionally retain the old negative sentinel. World coordinates
  // add mineral grain, membrane bays and subdued material variation at any scale.
  const roof = `
    if(vFacade.x<0.0){
      vec2 roofUv=vArchitectureWorld.xz;
      float roofSeed=architectureHash(vec2(vFacade.w,18.0));
      float roofNoise=architectureNoise(roofUv*.9)+architectureNoise(roofUv*.13)*.65;
      vec3 roofBase=mix(vec3(.145,.175,.174),vec3(.285,.275,.239),roofSeed);
      vec2 roofGrid=fract(roofUv/3.8+roofSeed);
      vec2 roofAA=max(fwidth(roofUv/3.8),vec2(.002));
      float roofJoint=1.0-smoothstep(.0,.014+roofAA.x,min(roofGrid.x,1.0-roofGrid.x));
      roofJoint=max(roofJoint,1.0-smoothstep(.0,.014+roofAA.y,min(roofGrid.y,1.0-roofGrid.y)));
      diffuseColor.rgb=roofBase*(.87+roofNoise*.14)*(1.0-roofJoint*.11);
    }
  `;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <roughnessmap_fragment>',
    `${roof}\n#include <roughnessmap_fragment>`,
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    'roughnessFactor=vFacade.x>=0.0?mix(pattern.z,pattern.w,facadePane):.86;',
    `roughnessFactor=vFacade.x>=0.0?mix(pattern.z,pattern.w,facadePane):.91;
    roughnessFactor=clamp(roughnessFactor+(architectureNoise(vArchitectureWorld.xz*.3)-.5)*.09*(1.0-facadePane),.17,.96);`,
  );
}

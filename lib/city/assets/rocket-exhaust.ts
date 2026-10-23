import * as THREE from 'three';

/** Bounded 3D exhaust shells: no texture downloads, sprites or per-frame meshes. */
export function rocketExhaustGeometry(
  radius: number,
  length: number,
  core = false,
) {
  const rows = core ? 40 : 24;
  const profile = Array.from({ length: rows + 1 }, (_, i) => {
    const t = i / rows;
    const width = core
      ? radius * (0.82 + 0.11 * Math.cos(t * Math.PI * 12)) * (1 - t * 0.62)
      : radius * (0.88 + t * 1.12) * (1 - Math.max(0, t - 0.65) * 0.4);
    return new THREE.Vector2(width, (t - 0.5) * length);
  });
  return new THREE.LatheGeometry(profile, core ? 16 : 24);
}

export function rocketExhaustMaterial(core = false) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    // Five overlapping shells retain amber edges against the bright daytime city.
    blending: core ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uTime: { value: 0 }, uCore: { value: core ? 1 : 0 } },
    vertexShader: `
      uniform float uTime;
      uniform float uCore;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      void main() {
        vUv = uv;
        vec3 p = position;
        float t = uv.y;
        float phase = modelMatrix[3].x * .07 + modelMatrix[3].z * .11;
        float wave = sin(uv.x * 18.84956 + t * 19. - uTime * 21. + phase);
        p.xz *= 1. + wave * t * (.045 - uCore * .025);
        vec4 view = modelViewMatrix * vec4(p, 1.);
        vPositionView = view.xyz;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uCore;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vPositionView;
      float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
      }
      void main() {
        float t = vUv.y;
        float theta = vUv.x * 6.283185;
        vec2 flowUV=vec2(sin(theta)*3.+cos(theta)*2.,t*12.-uTime*9.);
        float flow=.65*noise(flowUV)+.35*noise(flowUV*2.1+vec2(3.4,uTime*.7));
        flow = .36 + .64 * smoothstep(.08,.9,flow);
        float edge = 1. - abs(dot(normalize(vNormalView), normalize(-vPositionView)));
        float tail = 1. - smoothstep(.55, 1., t);
        float shock = pow(max(0., cos(t * 37.69911)), 5.);
        vec3 hot = mix(vec3(1.4, 1.5, 1.6), vec3(1.45, .46, .035), smoothstep(.02, .45, t));
        vec3 outer = mix(hot, vec3(1.3, .13, .008), smoothstep(.22, .92, t));
        vec3 inner = mix(vec3(.85, 1.05, 1.3), vec3(1.2, .64, .14), t) * (.65 + shock * .5);
        float alpha = tail * mix((.28 + edge * .43) * flow, .17 + shock * .13, uCore);
        gl_FragColor = vec4(mix(outer, inner, uCore), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  material.name = core
    ? 'Titan blue-white exhaust shock cells'
    : 'Titan turbulent amber exhaust volume';
  return material;
}

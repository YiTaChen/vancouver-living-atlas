import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { sunAngle } from './clock';

export const ATMOSPHERES = ['clear', 'overcast'] as const;
export type AtmosphereMode = (typeof ATMOSPHERES)[number];
export function normalizeAtmosphere(value: unknown): AtmosphereMode {
  return value === 'overcast' ? 'overcast' : 'clear';
}

/** An authored coastal light palette, not live weather or an astronomical model.
 * All colors are linear Three Colors; texture/color-space conversion stays in
 * the existing renderer pipeline. Geometry and shadow-pass counts do not vary.
 */
export function sampleAtmosphere(hour: number, mode: AtmosphereMode = 'clear') {
  const angle = sunAngle(Number.isFinite(hour) ? hour : 16),
    altitude = Math.sin(angle),
    day = Math.max(0, altitude),
    night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.38),
    cloud = normalizeAtmosphere(mode) === 'overcast' ? 1 : 0,
    warmth =
      (1 - THREE.MathUtils.smoothstep(altitude, 0.04, 0.5)) *
      THREE.MathUtils.smoothstep(altitude, -0.2, 0.05),
    daylight = Math.sqrt(day),
    horizon = new THREE.Color(0x122838)
      .lerp(new THREE.Color(cloud ? 0xb7c5ca : 0xbad5e2), daylight)
      .lerp(new THREE.Color(0xd2a18c), warmth * (cloud ? 0.15 : 0.54)),
    zenith = new THREE.Color(0x080f22)
      .lerp(new THREE.Color(cloud ? 0x919fa9 : 0x7fb0d3), daylight)
      .lerp(new THREE.Color(0x646a8c), warmth * (cloud ? 0.12 : 0.32)),
    // Urban night fill represents aggregate building/street bounce; the dark
    // visible sky itself is too dim to use as the hemisphere light source.
    hemisphereSky = new THREE.Color(0x9eafbf).lerp(
      new THREE.Color(cloud ? 0xd4dce0 : 0xc6dfef),
      daylight,
    ),
    hemisphereGround = new THREE.Color(0x697783)
      .lerp(new THREE.Color(0x8c8373), daylight)
      .lerp(new THREE.Color(0xb5896d), warmth * 0.2),
    sunColor = new THREE.Color(0xfff2df).lerp(
      new THREE.Color(0xffad73),
      warmth * (1 - cloud * 0.7),
    );
  return {
    angle,
    day,
    night,
    cloud,
    warmth,
    horizon,
    zenith,
    hemisphereSky,
    hemisphereGround,
    sunColor,
    sunIntensity: 0.04 + day * 2.24 * (1 - cloud * 0.78),
    ambientIntensity: 0.4 + day * (1.42 + cloud * 0.3),
    environmentIntensity: 0.002 + day * 0.019,
    exposure: 1.06 + night * 0.1,
    fogDensity: 0.00004 + cloud * 0.000021 + warmth * 0.00001,
    // Preserve the physical clear-sky scattering, while coastal overcast gets
    // a broad neutral vault consistent with its diffuse illumination.
    skyMix: Math.max(
      cloud ? 0.88 : 0.36,
      1 - THREE.MathUtils.smoothstep(altitude, -0.1, 0.15),
    ),
    cloudCoverage: cloud ? 0.92 : 0.32,
    cloudDensity: cloud ? 0.82 : 0.23,
    celestialVisibility: cloud ? 0.12 : 1,
    environmentPhase: (altitude > 0.33
      ? 'day'
      : altitude > -0.09
        ? 'twilight'
        : 'night') as 'day' | 'twilight' | 'night',
  };
}
export type AtmosphereSample = ReturnType<typeof sampleAtmosphere>;

/** Extend the existing Sky draw, preserving Three's scattering and cloud shader.
 * The night palette keeps the sky continuous through sunset rather than hiding
 * the mesh at a threshold. Sun, moon and aurora remain separate existing draws.
 */
export function installAtmosphereSky(sky: Sky) {
  const material = sky.material;
  if (material.uniforms.atlasHorizon) return;
  material.uniforms.atlasHorizon = { value: new THREE.Color() };
  material.uniforms.atlasZenith = { value: new THREE.Color() };
  material.uniforms.atlasSkyMix = { value: 0 };
  material.fragmentShader =
    `uniform vec3 atlasHorizon, atlasZenith;
uniform float atlasSkyMix;\n` +
    material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `float atlasElevation = smoothstep(0.0, 0.55, max(0.0, direction.y));
    vec3 atlasVault = mix(atlasHorizon, atlasZenith, atlasElevation);
    texColor = mix(texColor, atlasVault, atlasSkyMix);
    gl_FragColor = vec4( texColor, 1.0 );`,
    );
  material.needsUpdate = true;
}

export function applyAtmosphereSky(sky: Sky, state: AtmosphereSample) {
  const u = sky.material.uniforms;
  u.sunPosition.value.set(
    Math.cos(state.angle) * 4500,
    Math.sin(state.angle) * 5000,
    1400,
  );
  u.turbidity.value = state.cloud ? 5.8 : 3;
  u.rayleigh.value = state.cloud ? 1.1 : 1.7;
  u.mieCoefficient.value = state.cloud ? 0.009 : 0.005;
  u.mieDirectionalG.value = 0.8;
  u.cloudCoverage.value = state.cloudCoverage;
  u.cloudDensity.value = state.cloudDensity;
  u.cloudScale.value = 0.00022;
  u.cloudElevation.value = 0.36;
  u.cloudSpeed.value = 0;
  u.showSunDisc.value = false;
  u.atlasHorizon.value.copy(state.horizon);
  u.atlasZenith.value.copy(state.zenith);
  u.atlasSkyMix.value = state.skyMix;
}

export const ATMOSPHERE_ENV_SIZE = 128;
export const ATMOSPHERE_ENV_LIMIT = 3;

/** Three roughness-aware PMREM snapshots. Clear/overcast and day/twilight/night
 * are authored phases, not exact per-minute reflections. A three-entry LRU
 * prevents time scrubbing/weather changes from growing GPU memory. The normal
 * 10 Hz lighting tick only looks up a map, and never generates one per frame.
 */
export class AtmosphereEnvironment {
  private targets = new Map<string, THREE.WebGLRenderTarget>();
  private disposed = false;
  constructor(
    private renderer: THREE.WebGLRenderer,
    private source: Sky,
  ) {}
  get(mode: AtmosphereMode, phase: AtmosphereSample['environmentPhase']) {
    if (this.disposed)
      throw new Error('Atmosphere environment has been disposed');
    mode = normalizeAtmosphere(mode);
    const key = `${mode}:${phase}`;
    const cached = this.targets.get(key);
    if (cached) {
      this.targets.delete(key);
      this.targets.set(key, cached);
      return cached;
    }
    const sky = this.source.clone();
    sky.material = this.source.material.clone();
    sky.visible = true;
    applyAtmosphereSky(
      sky,
      sampleAtmosphere(
        phase === 'day' ? 13.25 : phase === 'twilight' ? 19.8 : 23,
        mode,
      ),
    );
    const scene = new THREE.Scene();
    scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    let target: THREE.WebGLRenderTarget;
    try {
      target = pmrem.fromScene(scene, 0.04, 0.1, 40000, {
        size: ATMOSPHERE_ENV_SIZE,
      });
    } finally {
      sky.material.dispose();
      pmrem.dispose();
    }
    // Commit only a complete target. A failed generation leaves the previous
    // usable environment cached; it must never be evicted before its replacement.
    this.targets.set(key, target);
    while (this.targets.size > ATMOSPHERE_ENV_LIMIT) {
      const first = this.targets.keys().next().value!;
      this.targets.get(first)!.dispose();
      this.targets.delete(first);
    }
    return target;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.targets.forEach((target) => target.dispose());
    this.targets.clear();
  }
}

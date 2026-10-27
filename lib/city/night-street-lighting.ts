import * as THREE from 'three';

export const NIGHT_STREET_FIELD_SIZE = 512;
export const NIGHT_STREET_FIELD_MAX_BYTES = 1_048_576;

export interface NightStreetLamp {
  x: number;
  y: number;
  z: number;
  /** Actual adjacent street datum. Existing eight-metre poles default to y - 8.85. */
  groundY?: number;
}
export interface NightStreetRoad {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  width: number;
}
export interface NightStreetBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface NightStreetFieldOptions {
  lamps: readonly NightStreetLamp[];
  roads?: readonly NightStreetRoad[];
  bounds: NightStreetBounds;
  /** Root owns the urban boundary and complete park/wood/water polygon exclusions. */
  allowed: (x: number, z: number) => boolean;
  /** Smaller fields are useful for tests; production never exceeds the fixed budget. */
  size?: number;
  /** Source-local park pools never inherit the downtown road-wide fill. */
  sourceLocalOnly?: boolean;
  /** An independent bounded field, baked without its own material wrappers.
   * One owner installs both samplers using one world-position varying. */
  park?: Omit<NightStreetFieldOptions, 'park'>;
}
export interface NightStreetSample {
  street: number;
  warm: number;
  groundY: number | null;
  coverage: number;
}
export interface NightStreetLightingStats {
  size: number;
  textureBytes: number;
  textures: number;
  activeTexels: number;
  lampSources: number;
  roadSources: number;
  buildMs: number;
  wrappedMaterials: number;
  disabledLamps: number;
  warmStateBytes: number;
  disposed: boolean;
  nightAmount: number;
  activity: number;
  park?: NightStreetLightingStats;
  downtownTextureBytes?: number;
}

type Material = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
type Shader = Parameters<Material['onBeforeCompile']>[0];
type Wrapper = {
  material: Material;
  originalCompile: Material['onBeforeCompile'];
  originalKey: Material['customProgramCacheKey'];
  compile: Material['onBeforeCompile'];
  key: Material['customProgramCacheKey'];
  disposeListener: () => void;
};

const clamp = (value: number, lo = 0, hi = 1) =>
  Math.max(lo, Math.min(hi, value));
const smoothstep = (lo: number, hi: number, value: number) => {
  const t = clamp((value - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/** Authored aggregate evening activity, not individual shop opening schedules.
 * A periodic curve dims some urban window/frontage contribution after midnight
 * while the road-lighting field stays on. It has no midnight discontinuity.
 */
export function nightStreetActivity(hour: number) {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 23;
  const evening = 0.5 + 0.5 * Math.cos(((h - 20) * Math.PI) / 12);
  return 0.35 + 0.65 * evening ** 3;
}

/** Static, deliberately approximate urban light bounce. This is not physical GI
 * or a survey of municipal fixtures. One RGBA8 field supplies street fill, warm
 * lamp pools, premultiplied local ground height and coverage. No scene lights,
 * geometry, shadow maps or full-screen passes are created. The caller wraps
 * selected street/building materials, leaving nature receivers untouched.
 */
export class NightStreetLighting {
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    uAtlasNightField: THREE.IUniform<THREE.DataTexture>;
    uAtlasNightBounds: THREE.IUniform<THREE.Vector4>;
    uAtlasNightHeights: THREE.IUniform<THREE.Vector2>;
    uAtlasNightAmount: THREE.IUniform<number>;
    uAtlasNightActivity: THREE.IUniform<number>;
  };
  private readonly size: number;
  private readonly bounds: NightStreetBounds;
  private readonly bytes: Uint8Array;
  private readonly warm: Float32Array;
  private readonly lampXZ: Float64Array;
  private readonly park?: NightStreetLighting;
  private readonly disabledLamps = new Set<number>();
  private readonly wrappers = new Map<Material, Wrapper>();
  private disposed = false;
  private readonly fieldStats: {
    size: number;
    textureBytes: number;
    textures: number;
    activeTexels: number;
    lampSources: number;
    roadSources: number;
    buildMs: number;
  };

  constructor(options: NightStreetFieldOptions) {
    const start = performance.now();
    this.size = options.size ?? NIGHT_STREET_FIELD_SIZE;
    this.bounds = { ...options.bounds };
    const { minX, maxX, minZ, maxZ } = this.bounds;
    if (
      !Number.isInteger(this.size) ||
      this.size < 2 ||
      this.size > NIGHT_STREET_FIELD_SIZE ||
      ![minX, maxX, minZ, maxZ].every(Number.isFinite) ||
      maxX <= minX ||
      maxZ <= minZ
    )
      throw new Error('Invalid bounded night street field');
    const roads = options.roads ?? [];
    for (const lamp of options.lamps)
      if (
        ![lamp.x, lamp.y, lamp.z, lamp.groundY ?? lamp.y - 8.85].every(
          Number.isFinite,
        )
      )
        throw new Error('Invalid night street lamp');
    for (const road of roads)
      if (
        road.a.length !== 3 ||
        road.b.length !== 3 ||
        ![...road.a, ...road.b, road.width].every(Number.isFinite) ||
        road.width <= 0 ||
        road.width > 50
      )
        throw new Error('Invalid night street road');

    let minGround = Infinity,
      maxGround = -Infinity;
    const recordGround = (y: number) => {
      minGround = Math.min(minGround, y);
      maxGround = Math.max(maxGround, y);
    };
    options.lamps.forEach((lamp) =>
      recordGround(lamp.groundY ?? lamp.y - 8.85),
    );
    roads.forEach((road) => {
      recordGround(road.a[1]);
      recordGround(road.b[1]);
    });
    if (!Number.isFinite(minGround)) minGround = maxGround = 0;
    const heightRange = Math.max(1, maxGround - minGround),
      count = this.size * this.size,
      street = new Float32Array(count),
      warm = new Float32Array(count),
      heightSum = new Float32Array(count),
      heightWeight = new Float32Array(count),
      allowedStride = this.size + 2,
      allowed = new Int8Array(allowedStride * allowedStride).fill(-1),
      stepX = (maxX - minX) / this.size,
      stepZ = (maxZ - minZ) / this.size;
    const geographicAllowed = (i: number, j: number) => {
      const index = (j + 1) * allowedStride + i + 1;
      if (allowed[index] >= 0) return allowed[index] === 1;
      const x = minX + (i + 0.5) * stepX,
        z = minZ + (j + 0.5) * stepZ;
      const valid = options.allowed(x, z);
      allowed[index] = valid ? 1 : 0;
      return valid;
    };
    const cellAllowed = (i: number, j: number) => {
      // One-texel conservative border coverage keeps linear interpolation from
      // extending fields across park boundaries. Polygon holes belong to allowed.
      return (
        geographicAllowed(i, j) &&
        geographicAllowed(i - 1, j - 1) &&
        geographicAllowed(i + 1, j - 1) &&
        geographicAllowed(i - 1, j + 1) &&
        geographicAllowed(i + 1, j + 1)
      );
    };
    const raster = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      radius: number,
      apply: (index: number, x: number, z: number) => void,
    ) => {
      const firstX = Math.max(
          0,
          Math.floor((Math.min(x0, x1) - radius - minX) / stepX),
        ),
        lastX = Math.min(
          this.size - 1,
          Math.floor((Math.max(x0, x1) + radius - minX) / stepX),
        ),
        firstZ = Math.max(
          0,
          Math.floor((Math.min(z0, z1) - radius - minZ) / stepZ),
        ),
        lastZ = Math.min(
          this.size - 1,
          Math.floor((Math.max(z0, z1) + radius - minZ) / stepZ),
        );
      for (let j = firstZ; j <= lastZ; j++)
        for (let i = firstX; i <= lastX; i++)
          apply(
            j * this.size + i,
            minX + (i + 0.5) * stepX,
            minZ + (j + 0.5) * stepZ,
          );
    };
    const addGround = (index: number, y: number, weight: number) => {
      heightSum[index] += y * weight;
      heightWeight[index] += weight;
    };
    for (const road of roads) {
      const dx = road.b[0] - road.a[0],
        dz = road.b[2] - road.a[2],
        length2 = dx * dx + dz * dz,
        core = road.width / 2 + 2,
        radius = core + 10;
      raster(
        road.a[0],
        road.a[2],
        road.b[0],
        road.b[2],
        radius,
        (index, x, z) => {
          const t =
              length2 > 0
                ? clamp(((x - road.a[0]) * dx + (z - road.a[2]) * dz) / length2)
                : 0,
            distance = Math.hypot(
              x - road.a[0] - dx * t,
              z - road.a[2] - dz * t,
            ),
            fill = 1 - smoothstep(core, radius, distance);
          if (fill <= 0) return;
          street[index] = Math.max(street[index], fill);
          addGround(
            index,
            THREE.MathUtils.lerp(road.a[1], road.b[1], t),
            fill * 1.5,
          );
        },
      );
    }
    for (const lamp of options.lamps) {
      const ground = lamp.groundY ?? lamp.y - 8.85;
      raster(lamp.x, lamp.z, lamp.x, lamp.z, 32, (index, x, z) => {
        const distance = Math.hypot(x - lamp.x, z - lamp.z),
          broad = Math.max(0, 1 - distance / 32) ** 2,
          pool = Math.max(0, 1 - distance / 22) ** 2;
        if (broad <= 0) return;
        if (!options.sourceLocalOnly)
          street[index] = Math.max(street[index], broad * 0.28);
        // Retain the unclamped sum: subtracting a broken source from a clipped
        // value would incorrectly switch off the other overlapping lamp pools.
        warm[index] += pool;
        addGround(index, ground, broad);
      });
    }
    this.bytes = new Uint8Array(count * 4);
    let activeTexels = 0;
    for (let index = 0; index < count; index++) {
      // Mask only supported receivers, after baking. Adjacent border probes
      // reuse cached geographic points instead of re-testing every lamp overlap.
      if (
        heightWeight[index] <= 0 ||
        !cellAllowed(index % this.size, Math.floor(index / this.size))
      )
        continue;
      this.bytes[index * 4] = Math.round(clamp(street[index]) * 255);
      this.bytes[index * 4 + 1] = Math.round(clamp(warm[index]) * 255);
      this.bytes[index * 4 + 2] = Math.round(
        clamp(
          (heightSum[index] / heightWeight[index] - minGround) / heightRange,
        ) * 255,
      );
      this.bytes[index * 4 + 3] = 255;
      activeTexels++;
    }
    this.warm = warm;
    this.lampXZ = new Float64Array(options.lamps.length * 2);
    options.lamps.forEach((lamp, index) => {
      this.lampXZ[index * 2] = lamp.x;
      this.lampXZ[index * 2 + 1] = lamp.z;
    });
    this.texture = new THREE.DataTexture(
      this.bytes,
      this.size,
      this.size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.texture.name = 'Static downtown street light field';
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uAtlasNightField: { value: this.texture },
      uAtlasNightBounds: {
        value: new THREE.Vector4(
          minX,
          minZ,
          1 / (maxX - minX),
          1 / (maxZ - minZ),
        ),
      },
      uAtlasNightHeights: { value: new THREE.Vector2(minGround, heightRange) },
      uAtlasNightAmount: { value: 0 },
      uAtlasNightActivity: { value: nightStreetActivity(23) },
    };
    this.fieldStats = {
      size: this.size,
      textureBytes: this.bytes.byteLength,
      textures: 1,
      activeTexels,
      lampSources: options.lamps.length,
      roadSources: roads.length,
      buildMs: performance.now() - start,
    };
    if (options.park) {
      try {
        this.park = new NightStreetLighting({
          ...options.park,
          roads: [],
          sourceLocalOnly: true,
        });
        this.park.texture.name = 'Static source-local Stanley Park light field';
      } catch (error) {
        this.texture.dispose();
        throw error;
      }
    }
  }

  /** Pure uniform changes: street lighting remains active at midnight and no
   * new shader, texture, light or geometry is allocated during time scrubbing. */
  update(hour: number, nightAmount: number) {
    if (this.disposed) return;
    this.uniforms.uAtlasNightAmount.value = Number.isFinite(nightAmount)
      ? clamp(nightAmount)
      : 0;
    this.uniforms.uAtlasNightActivity.value = nightStreetActivity(hour);
    this.park?.update(hour, nightAmount);
  }

  /** Switch off one baked warm pool without rebuilding geometry/materials or
   * rerunning geographic masks. Only its finite 22m neighborhood is touched;
   * the aggregate street fill and immutable height/coverage datum are retained.
   * CPU state is one fixed float field plus two coordinates per source, never
   * a full field per lamp. The same texture and shader uniforms stay attached. */
  disableLamp(index: number): boolean {
    // Render/impact indices map into the concatenated downtown + park source
    // inventory. A park hit must never subtract a downtown source with index 0.
    if (
      !this.disposed &&
      Number.isInteger(index) &&
      index >= this.lampXZ.length / 2 &&
      this.park
    )
      return this.park.disableLamp(index - this.lampXZ.length / 2);
    if (
      this.disposed ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.lampXZ.length / 2 ||
      this.disabledLamps.has(index)
    )
      return false;
    this.disabledLamps.add(index);
    const { minX, maxX, minZ, maxZ } = this.bounds,
      x = this.lampXZ[index * 2],
      z = this.lampXZ[index * 2 + 1],
      stepX = (maxX - minX) / this.size,
      stepZ = (maxZ - minZ) / this.size,
      firstX = Math.max(0, Math.floor((x - 22 - minX) / stepX)),
      lastX = Math.min(this.size - 1, Math.floor((x + 22 - minX) / stepX)),
      firstZ = Math.max(0, Math.floor((z - 22 - minZ) / stepZ)),
      lastZ = Math.min(this.size - 1, Math.floor((z + 22 - minZ) / stepZ));
    let changed = false;
    for (let j = firstZ; j <= lastZ; j++)
      for (let i = firstX; i <= lastX; i++) {
        const texel = j * this.size + i;
        if (!this.bytes[texel * 4 + 3]) continue;
        const distance = Math.hypot(
            minX + (i + 0.5) * stepX - x,
            minZ + (j + 0.5) * stepZ - z,
          ),
          pool = Math.max(0, 1 - distance / 22) ** 2;
        if (pool === 0) continue;
        this.warm[texel] = Math.max(0, this.warm[texel] - pool);
        const next = Math.round(clamp(this.warm[texel]) * 255),
          channel = texel * 4 + 1;
        if (this.bytes[channel] !== next) {
          this.bytes[channel] = next;
          changed = true;
        }
      }
    if (changed) this.texture.needsUpdate = true;
    return true;
  }

  /** Matches the single linear-filtered field sample, including edge-normalized
   * height. It is QA support; production does not sample this on every frame. */
  sample(x: number, z: number): NightStreetSample {
    const { minX, maxX, minZ, maxZ } = this.bounds;
    const empty = { street: 0, warm: 0, groundY: null, coverage: 0 };
    if (
      this.disposed ||
      !Number.isFinite(x) ||
      !Number.isFinite(z) ||
      x < minX ||
      x > maxX ||
      z < minZ ||
      z > maxZ
    )
      return empty;
    const u = ((x - minX) / (maxX - minX)) * this.size - 0.5,
      v = ((z - minZ) / (maxZ - minZ)) * this.size - 0.5,
      i = Math.floor(u),
      j = Math.floor(v),
      fx = u - i,
      fz = v - j,
      channels = [0, 0, 0, 0];
    for (const [ox, oz, weight] of [
      [0, 0, (1 - fx) * (1 - fz)],
      [1, 0, fx * (1 - fz)],
      [0, 1, (1 - fx) * fz],
      [1, 1, fx * fz],
    ]) {
      const index =
        (clamp(j + oz, 0, this.size - 1) * this.size +
          clamp(i + ox, 0, this.size - 1)) *
        4;
      for (let channel = 0; channel < 4; channel++)
        channels[channel] += (this.bytes[index + channel] / 255) * weight;
    }
    const [street, warm, height, coverage] = channels,
      [minGround, heightRange] =
        this.uniforms.uAtlasNightHeights.value.toArray();
    return {
      street,
      warm,
      groundY:
        coverage > 0 ? minGround + (height / coverage) * heightRange : null,
      coverage,
    };
  }

  /** Independent QA access keeps existing downtown samples byte-for-byte. */
  samplePark(x: number, z: number): NightStreetSample {
    return (
      this.park?.sample(x, z) ?? {
        street: 0,
        warm: 0,
        groundY: null,
        coverage: 0,
      }
    );
  }

  /** Preserve each source's surface/wheel/facade shader and program identity.
   * Instanced and BatchedMesh transformations are applied after deformation.
   * The existing normal map and indirect AO remain in the normal PBR pipeline.
   */
  wrapMaterial(
    material: Material,
    options: {
      facade?: boolean;
      parkOnly?: boolean;
      pilotWeight?: THREE.IUniform<number>;
    } = {},
  ) {
    if (this.disposed)
      throw new Error('Night street lighting has been disposed');
    if (this.wrappers.has(material)) return false;
    // Preserve exact identities for disposal; both calls explicitly bind material.
    // oxlint-disable-next-line typescript/unbound-method
    const originalCompile = material.onBeforeCompile;
    // oxlint-disable-next-line typescript/unbound-method
    const originalKey = material.customProgramCacheKey;
    const facade = options.facade === true;
    const parkOnly = options.parkOnly === true;
    const pilotWeight = options.pilotWeight;
    const compile: Material['onBeforeCompile'] = (shader, renderer) => {
      originalCompile.call(material, shader, renderer);
      this.installShader(shader, facade, parkOnly, pilotWeight);
    };
    const key = () =>
      `${originalKey.call(material)}|atlas-night-street-v1-${facade ? 'facade' : 'surface'}${this.park ? '-park-v1' : ''}${parkOnly ? '-park-only' : ''}${pilotWeight ? '-pilot-receiver' : ''}`;
    const disposeListener = () => this.releaseMaterial(material);
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
    this.wrappers.set(material, {
      material,
      originalCompile,
      originalKey,
      compile,
      key,
      disposeListener,
    });
    material.addEventListener('dispose', disposeListener);
    return true;
  }

  private installShader(
    shader: Shader,
    facade: boolean,
    parkOnly: boolean,
    pilotWeight?: THREE.IUniform<number>,
  ) {
    Object.assign(shader.uniforms, this.uniforms);
    if (pilotWeight) shader.uniforms.uAtlasPilotReceiverWeight = pilotWeight;
    if (this.park)
      Object.assign(shader.uniforms, {
        uAtlasParkNightField: this.park.uniforms.uAtlasNightField,
        uAtlasParkNightBounds: this.park.uniforms.uAtlasNightBounds,
        uAtlasParkNightHeights: this.park.uniforms.uAtlasNightHeights,
      });
    shader.vertexShader =
      'varying vec3 vAtlasNightStreetWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 atlasNightWorld = vec4(transformed, 1.0);
      #ifdef USE_BATCHING
        atlasNightWorld = batchingMatrix * atlasNightWorld;
      #endif
      #ifdef USE_INSTANCING
        atlasNightWorld = instanceMatrix * atlasNightWorld;
      #endif
      vAtlasNightStreetWorld = (modelMatrix * atlasNightWorld).xyz;
    `,
    );
    shader.fragmentShader =
      `
      varying vec3 vAtlasNightStreetWorld;
      uniform sampler2D uAtlasNightField;
      uniform vec4 uAtlasNightBounds;
      uniform vec2 uAtlasNightHeights;
      uniform float uAtlasNightAmount, uAtlasNightActivity;
      ${pilotWeight ? 'uniform float uAtlasPilotReceiverWeight;' : ''}
      vec4 atlasNightFieldSample(vec2 worldXZ) {
        // Coherent day/outside branches avoid a field lookup without creating
        // another shader variant when the clock or camera location changes.
        ${parkOnly ? 'return vec4(0.0); // Preserve existing downtown terrain reception.' : ''}
        if (uAtlasNightAmount <= 0.001${pilotWeight ? ' || uAtlasPilotReceiverWeight <= 0.0' : ''}) return vec4(0.0);
        vec2 atlasUv = (worldXZ - uAtlasNightBounds.xy) * uAtlasNightBounds.zw;
        if (any(lessThan(atlasUv, vec2(0.0))) || any(greaterThan(atlasUv, vec2(1.0)))) return vec4(0.0);
        return texture2D(uAtlasNightField, atlasUv);
      }
      ${
        this.park
          ? `
      uniform sampler2D uAtlasParkNightField;
      uniform vec4 uAtlasParkNightBounds;
      uniform vec2 uAtlasParkNightHeights;
      vec4 atlasParkNightFieldSample(vec2 worldXZ) {
        if (uAtlasNightAmount <= 0.001${pilotWeight ? ' || uAtlasPilotReceiverWeight <= 0.0' : ''}) return vec4(0.0);
        vec2 atlasParkUv = (worldXZ - uAtlasParkNightBounds.xy) * uAtlasParkNightBounds.zw;
        if (any(lessThan(atlasParkUv, vec2(0.0))) || any(greaterThan(atlasParkUv, vec2(1.0)))) return vec4(0.0);
        return texture2D(uAtlasParkNightField, atlasParkUv);
      }`
          : ''
      }
    \n` + shader.fragmentShader;
    const hasFacade =
      facade &&
      shader.fragmentShader.includes('facadePane') &&
      shader.fragmentShader.includes('facadeLit');
    if (hasFacade)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Only existing lit windows inside the urban field get late-night dimming.
        vec4 atlasWindowField = atlasNightFieldSample(vAtlasNightStreetWorld.xz);
        facadeLit *= mix(1.0, 0.65 + 0.35 * uAtlasNightActivity, clamp(atlasWindowField.r, 0.0, 1.0));
      `,
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
      vec4 atlasField = atlasNightFieldSample(vAtlasNightStreetWorld.xz);
      float atlasGround = uAtlasNightHeights.x + (atlasField.b / max(atlasField.a, 0.0001)) * uAtlasNightHeights.y;
      float atlasHeight = vAtlasNightStreetWorld.y - atlasGround;
      float atlasHeightFade = smoothstep(-3.0, -1.0, atlasHeight) * (1.0 - smoothstep(3.2, 20.0, atlasHeight));
      vec3 atlasWorldNormal = inverseTransformDirection(normal, viewMatrix);
      float atlasFacing = 0.45 + 0.55 * max(0.0, atlasWorldNormal.y);
      float atlasFrontage = (1.0 - smoothstep(1.8, 5.0, atlasHeight)) * (1.0 - abs(atlasWorldNormal.y));
      vec3 atlasBounce = vec3(0.88, 0.85, 0.75) * atlasField.r * 0.16
        + vec3(1.0, 0.82, 0.60) * atlasField.g * 0.45
        + vec3(1.0, 0.76, 0.44) * atlasField.r * atlasFrontage * uAtlasNightActivity * 0.10;
      float atlasReceiver = ${hasFacade ? '(1.0 - facadePane)' : '1.0'}${pilotWeight ? ' * uAtlasPilotReceiverWeight' : ''};
      reflectedLight.indirectDiffuse += diffuseColor.rgb * atlasBounce * atlasFacing
        * atlasHeightFade * uAtlasNightAmount * atlasReceiver;
      ${
        hasFacade
          ? `
      float atlasLowerPane = facadePane * smoothstep(-1.0, 0.0, atlasHeight) * (1.0 - smoothstep(2.8, 4.5, atlasHeight));
      totalEmissiveRadiance += vec3(1.0, 0.76, 0.44) * atlasLowerPane * atlasField.r
        * uAtlasNightAmount * uAtlasNightActivity * 0.13;`
          : ''
      }
      ${
        this.park
          ? `
      // Only finite pools surrounding adopted municipal poles illuminate park
      // receivers. No road-wide or ambient term is introduced into the forest.
      vec4 atlasParkField = atlasParkNightFieldSample(vAtlasNightStreetWorld.xz);
      float atlasParkGround = uAtlasParkNightHeights.x + (atlasParkField.b / max(atlasParkField.a, 0.0001)) * uAtlasParkNightHeights.y;
      float atlasParkHeight = vAtlasNightStreetWorld.y - atlasParkGround;
      float atlasParkHeightFade = smoothstep(-3.0, -1.0, atlasParkHeight) * (1.0 - smoothstep(3.2, 20.0, atlasParkHeight));
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.82, 0.60)
        * atlasParkField.g * 0.45 * atlasFacing * atlasParkHeightFade
        * uAtlasNightAmount * atlasReceiver;`
          : ''
      }
    `,
    );
  }

  stats(): NightStreetLightingStats {
    const park = this.park?.stats();
    return {
      ...this.fieldStats,
      textureBytes: this.fieldStats.textureBytes + (park?.textureBytes ?? 0),
      textures: (this.disposed ? 0 : 1) + (park?.textures ?? 0),
      wrappedMaterials: this.wrappers.size,
      disabledLamps: this.disabledLamps.size + (park?.disabledLamps ?? 0),
      warmStateBytes:
        this.warm.byteLength +
        this.lampXZ.byteLength +
        (park?.warmStateBytes ?? 0),
      disposed: this.disposed,
      nightAmount: this.uniforms.uAtlasNightAmount.value,
      activity: this.uniforms.uAtlasNightActivity.value,
      ...(park
        ? { park, downtownTextureBytes: this.fieldStats.textureBytes }
        : {}),
    };
  }

  /** Detached, cancelled landmark groups dispose their materials. Drop their
   * references immediately instead of retaining them until engine teardown. */
  private releaseMaterial(material: Material) {
    const wrapper = this.wrappers.get(material);
    if (!wrapper) return;
    material.removeEventListener('dispose', wrapper.disposeListener);
    if (material.onBeforeCompile === wrapper.compile)
      material.onBeforeCompile = wrapper.originalCompile;
    if (material.customProgramCacheKey === wrapper.key)
      material.customProgramCacheKey = wrapper.originalKey;
    material.needsUpdate = true;
    this.wrappers.delete(material);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.uniforms.uAtlasNightAmount.value = 0;
    for (const material of this.wrappers.keys()) this.releaseMaterial(material);
    this.texture.dispose();
    this.park?.dispose();
  }
}

import * as THREE from 'three';
import {
  rocketPlanetFragmentShader,
  rocketPlanetVertexShader,
} from './rocket-space-shaders';

/** All environment distances use 1 unit = 100 km. Nearby vehicles must use this scale too. */
export const ROCKET_SPACE_METERS_TO_UNITS = 1 / 100_000;

const EARTH_RADIUS = 6_371_000 * ROCKET_SPACE_METERS_TO_UNITS;
const FAR_SKY = 900;
const radians = THREE.MathUtils.degToRad;

export type RocketCelestialBody = 'sun' | 'moon';
export interface RocketCelestialFocus {
  target: THREE.Vector3;
  direction: THREE.Vector3;
  fovDegrees: number;
  angularDiameterDegrees: number;
}

const noiseGLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                   mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                   mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0, amplitude = 0.5;
    for (int octave = 0; octave < 4; octave++) {
      value += amplitude * noise3(p);
      p = p * 2.03 + vec3(7.1, 11.7, 4.3);
      amplitude *= 0.5;
    }
    return value;
  }
`;

const sphereVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vLocal = normalize(position);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Original, deliberately coarse silhouettes: a recognizable Earth without downloaded imagery.
// These are illustrative coastlines, not a navigational or geographic dataset.
const continents: readonly (readonly [number, number][])[] = [
  [
    [-168, 72],
    [-151, 71],
    [-139, 69],
    [-129, 59],
    [-125, 54],
    [-123, 49],
    [-125, 43],
    [-122, 38],
    [-117, 32],
    [-113, 29],
    [-110, 24],
    [-105, 20],
    [-99, 17],
    [-92, 18],
    [-86, 16],
    [-83, 10],
    [-78, 8],
    [-77, 11],
    [-83, 22],
    [-88, 22],
    [-91, 29],
    [-82, 30],
    [-80, 26],
    [-80, 33],
    [-74, 39],
    [-65, 44],
    [-60, 53],
    [-65, 59],
    [-77, 63],
    [-84, 69],
    [-102, 75],
    [-126, 74],
    [-147, 73],
  ],
  [
    [-73, 60],
    [-48, 60],
    [-37, 65],
    [-20, 76],
    [-30, 83],
    [-49, 83],
    [-61, 77],
  ],
  [
    [-81, 12],
    [-72, 11],
    [-63, 10],
    [-51, 4],
    [-35, -6],
    [-40, -20],
    [-48, -28],
    [-53, -34],
    [-62, -41],
    [-67, -54],
    [-72, -52],
    [-75, -39],
    [-72, -29],
    [-78, -15],
    [-81, -3],
  ],
  [
    [-17, 36],
    [-6, 36],
    [4, 37],
    [13, 33],
    [24, 32],
    [34, 30],
    [43, 12],
    [51, 11],
    [44, -2],
    [40, -12],
    [34, -23],
    [27, -34],
    [18, -35],
    [12, -20],
    [8, -5],
    [-4, 5],
    [-16, 15],
  ],
  [
    [-10, 36],
    [-9, 44],
    [-1, 48],
    [-5, 55],
    [9, 59],
    [14, 70],
    [29, 71],
    [36, 66],
    [48, 70],
    [68, 72],
    [91, 77],
    [111, 73],
    [139, 72],
    [169, 67],
    [179, 58],
    [163, 51],
    [151, 59],
    [140, 51],
    [140, 43],
    [128, 39],
    [121, 26],
    [111, 21],
    [106, 9],
    [100, 1],
    [95, 9],
    [93, 20],
    [88, 22],
    [80, 7],
    [73, 19],
    [65, 25],
    [54, 25],
    [49, 15],
    [43, 13],
    [35, 29],
    [26, 36],
    [23, 41],
    [15, 44],
    [11, 36],
    [2, 43],
  ],
  [
    [112, -22],
    [115, -32],
    [128, -35],
    [139, -35],
    [146, -40],
    [153, -28],
    [146, -16],
    [136, -12],
    [130, -13],
    [122, -18],
  ],
  [
    [-180, -76],
    [-150, -72],
    [-120, -74],
    [-90, -70],
    [-67, -63],
    [-56, -69],
    [-30, -73],
    [0, -70],
    [35, -69],
    [65, -68],
    [100, -66],
    [135, -69],
    [170, -72],
    [180, -76],
    [180, -90],
    [-180, -90],
  ],
  [
    [47, -13],
    [50, -16],
    [49, -25],
    [44, -25],
    [44, -18],
  ],
  [
    [-9, 50],
    [-5, 50],
    [-2, 55],
    [-4, 59],
    [-7, 57],
  ],
  [
    [130, 31],
    [134, 34],
    [138, 36],
    [141, 41],
    [145, 44],
    [143, 38],
    [139, 34],
  ],
  [
    [95, 5],
    [102, -1],
    [106, -6],
    [111, -7],
    [115, -8],
    [119, -8],
    [113, -5],
    [105, -3],
    [99, 4],
  ],
  [
    [109, 7],
    [117, 7],
    [119, 0],
    [114, -4],
    [109, -1],
  ],
  [
    [130, -2],
    [140, -3],
    [151, -7],
    [146, -10],
    [136, -8],
  ],
  [
    [166, -35],
    [175, -39],
    [179, -42],
    [172, -46],
    [166, -46],
    [170, -40],
  ],
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function createLandMask(): THREE.DataTexture {
  const width = 1024;
  const height = 512;
  const pixels = new Uint8Array(width * height * 4);
  // Rasterize each polygon one row at a time. No DOM, network, image decoding or canvas required.
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  for (const polygon of continents) {
    const minLatitude = Math.min(...polygon.map((point) => point[1]));
    const maxLatitude = Math.max(...polygon.map((point) => point[1]));
    const start = Math.max(0, Math.floor(((minLatitude + 90) / 180) * height));
    const end = Math.min(
      height - 1,
      Math.ceil(((maxLatitude + 90) / 180) * height),
    );
    for (let y = start; y <= end; y++) {
      const latitude = ((y + 0.5) / height) * 180 - 90;
      const intersections: number[] = [];
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (yi > latitude !== yj > latitude) {
          intersections.push(((xj - xi) * (latitude - yi)) / (yj - yi) + xi);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const left = Math.max(
          0,
          Math.ceil(((intersections[i] + 180) / 360) * width),
        );
        const right = Math.min(
          width - 1,
          Math.floor(((intersections[i + 1] + 180) / 360) * width),
        );
        for (let x = left; x <= right; x++) {
          const offset = (y * width + x) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
        }
      }
    }
  }
  const texture = new THREE.DataTexture(
    pixels,
    width,
    height,
    THREE.RGBAFormat,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Lightweight, self-contained high-atmosphere / space backdrop.
 *
 * Coordinate contract: Y is local up; the launch point is near (0, 0, 0).
 * Distances are scaled by ROCKET_SPACE_METERS_TO_UNITS. Earth moves below the
 * origin as altitude grows, so neither the camera nor a locally added rocket
 * ever accumulates huge coordinates. The caller owns the renderer and rocket.
 */
export class RocketSpace {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.000001, 1_200);

  private readonly earth = new THREE.Group();
  private readonly landMask = createLandMask();
  private readonly sunDirection = new THREE.Vector3(
    -0.43,
    0.02,
    -0.9,
  ).normalize();
  private readonly moonDirection = new THREE.Vector3(
    0.75,
    0.16,
    -0.64,
  ).normalize();
  private readonly sun = new THREE.Group();
  private readonly moon: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly planetMaterial: THREE.ShaderMaterial;
  private readonly direction = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly ownedRoots: THREE.Object3D[] = [];
  private readonly sunEye = new THREE.Vector3();
  private altitudeMeters = 15_000;
  private disposed = false;

  constructor() {
    this.scene.name = 'Rocket space environment — 1 unit = 100 km';
    this.scene.background = new THREE.Color('#01030a');
    this.camera.name = 'Rocket space camera';

    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAir: { value: 1 },
        uSun: { value: this.sunDirection },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDirection;
        uniform float uAir;
        uniform vec3 uSun;
        void main() {
          vec3 ray = normalize(vDirection);
          float elevation = smoothstep(-0.20, 0.80, ray.y);
          vec3 zenith = vec3(0.007, 0.035, 0.115);
          vec3 horizon = vec3(0.17, 0.38, 0.62);
          vec3 air = mix(horizon, zenith, sqrt(elevation));
          float halo = pow(max(dot(ray, uSun), 0.0), 35.0);
          vec3 color = mix(vec3(0.0004, 0.0010, 0.0035), air, uAir);
          color += vec3(0.13, 0.10, 0.055) * halo * uAir;
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(FAR_SKY, 24, 16),
      this.skyMaterial,
    );
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    this.scene.add(sky);

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float starSize;
        attribute vec3 starColor;
        varying vec3 vColor;
        void main() {
          vColor = starColor;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = starSize;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vColor;
        void main() {
          float radius = length(gl_PointCoord - 0.5) * 2.0;
          if (radius > 1.0) discard;
          float alpha = pow(1.0 - radius, 1.8) * uOpacity;
          gl_FragColor = vec4(vColor, alpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const stars = new THREE.Points(this.createStars(), this.starMaterial);
    stars.renderOrder = -50;
    stars.frustumCulled = false;
    this.scene.add(stars);

    this.planetMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uLand: { value: this.landMask },
        uSun: { value: this.sunDirection },
        uCameraWorld: { value: new THREE.Matrix4() },
        uInverseProjection: { value: new THREE.Matrix4() },
        uEye: { value: new THREE.Vector3() },
        uEarthCenter: { value: this.earth.position },
        uWorldToEarth: { value: new THREE.Matrix3() },
        uRadius: { value: EARTH_RADIUS },
        uTime: { value: 0 },
      },
      vertexShader: rocketPlanetVertexShader,
      fragmentShader: rocketPlanetFragmentShader(noiseGLSL),
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const planet = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.planetMaterial,
    );
    planet.name = 'Analytic Earth, cloud deck and atmospheric limb';
    planet.userData = {
      celestialBody: 'earth',
      renderTechnique: 'analytic-ray-sphere',
      radiusMeters: 6_371_000,
      atmosphereHeightMeters: 18_000,
      antialiasing: 'screen-space-derivatives',
    };
    planet.frustumCulled = false;
    planet.renderOrder = -10;
    // The controller owns the final camera pose, and can overwrite it after
    // update(). Read the actual render camera here, immediately before drawing.
    planet.onBeforeRender = (_renderer, _scene, renderCamera) => {
      renderCamera.getWorldPosition(this.planetMaterial.uniforms.uEye.value);
      this.planetMaterial.uniforms.uCameraWorld.value.copy(
        renderCamera.matrixWorld,
      );
      this.planetMaterial.uniforms.uInverseProjection.value.copy(
        renderCamera.projectionMatrixInverse,
      );
      this.earth.updateMatrixWorld(true);
      this.planetMaterial.uniforms.uWorldToEarth.value
        .setFromMatrix4(this.earth.matrixWorld)
        .invert();
    };
    this.scene.add(planet);

    // Align the geographical latitude/longitude of Vancouver with local up.
    const latitude = radians(49.2827);
    const longitude = radians(-123.1207);
    const up = new THREE.Vector3(
      Math.cos(latitude) * Math.cos(longitude),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(longitude),
    );
    const east = new THREE.Vector3(
      -Math.sin(longitude),
      0,
      Math.cos(longitude),
    );
    const north = new THREE.Vector3(
      -Math.sin(latitude) * Math.cos(longitude),
      Math.cos(latitude),
      -Math.sin(latitude) * Math.sin(longitude),
    );
    const basis = new THREE.Matrix4().makeBasis(east, up, north).transpose();
    this.earth.quaternion.setFromRotationMatrix(basis);
    this.scene.add(this.earth);

    this.createSun();
    this.scene.add(this.sun);

    const moonMaterial = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: this.sunDirection } },
      vertexShader: sphereVertex,
      fragmentShader: /* glsl */ `
        varying vec3 vLocal;
        varying vec3 vNormal;
        uniform vec3 uSun;
        ${noiseGLSL}
        float craters(vec3 p) {
          float relief = 0.0;
          for (int i = 0; i < 18; i++) {
            float index = float(i);
            vec3 center = normalize(vec3(
              hash31(vec3(index, 3.1, 7.2)),
              hash31(vec3(index, 9.7, 2.4)),
              hash31(vec3(index, 5.3, 1.9))) * 2.0 - 1.0);
            float radius = 0.045 + hash31(vec3(index, 7.1, 3.9)) * 0.09;
            float distanceToCenter = length(p - center) / radius;
            float bowl = 1.0 - smoothstep(0.20, 0.94, distanceToCenter);
            float rim = exp(-pow((distanceToCenter - 0.96) * 9.0, 2.0));
            relief += rim * 0.16 - bowl * 0.12;
          }
          return relief;
        }
        void main() {
          vec3 p = normalize(vLocal);
          float mares = smoothstep(0.33, 0.62, fbm(p * 5.2));
          float detail = noise3(p * 150.0);
          vec3 albedo = mix(vec3(0.20, 0.21, 0.225), vec3(0.52, 0.51, 0.48), mares);
          albedo *= 0.86 + detail * 0.22 + craters(p);
          float light = max(dot(normalize(vNormal), uSun), 0.0);
          // A modest Earthshine floor keeps the dark lunar disc legible in the
          // observation view; direct illumination still follows the same Sun.
          gl_FragColor = vec4(albedo * (0.065 + light * 1.9), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const moonDistance = 460;
    const moonRadius = Math.tan(radians(0.518 / 2)) * moonDistance;
    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(moonRadius, 48, 32),
      moonMaterial,
    );
    this.moon.name = 'Moon — approximately 0.52 degree apparent diameter';
    this.moon.userData = {
      celestialBody: 'moon',
      angularDiameterDegrees: 0.518,
      radiusUnits: moonRadius,
      focusFovDegrees: 12,
      surface: 'procedural-craters-and-maria',
    };
    this.moon.position.copy(this.moonDirection).multiplyScalar(moonDistance);
    this.moon.renderOrder = -20;
    this.scene.add(this.moon);

    const sunlight = new THREE.DirectionalLight(0xfff3dc, 3.0);
    sunlight.name = 'Sunlight — shares the planetary shader direction';
    sunlight.position.copy(this.sunDirection).multiplyScalar(10);
    const earthshine = new THREE.HemisphereLight(0xdce8f3, 0x547496, 1.15);
    earthshine.name = 'Soft Earth bounce';
    const ambient = new THREE.AmbientLight(0xe6ecf4, 0.38);
    ambient.name = 'Space vehicle readability fill';
    const cameraFill = new THREE.DirectionalLight(0xeaf1ff, 1.25);
    cameraFill.name = 'Soft camera-side vehicle fill';
    // Standard-material vehicles need a little reflected light in this
    // environment without an HDR map. Keep a gentle shape-defining fill on the
    // actual render camera's upper right; the Sun and planetary shaders retain
    // their common physical direction. Scene callbacks run before opaque
    // vehicle rendering, unlike the transparent planet's draw callback.
    this.scene.onBeforeRender = (_renderer, _scene, renderCamera) => {
      cameraFill.position
        .set(0.6, 0.8, 1)
        .applyMatrix4(renderCamera.matrixWorld);
      renderCamera.getWorldPosition(cameraFill.target.position);
      cameraFill.updateMatrixWorld();
      cameraFill.target.updateMatrixWorld();
    };
    this.scene.add(
      sunlight,
      sunlight.target,
      earthshine,
      ambient,
      cameraFill,
      cameraFill.target,
    );

    this.ownedRoots.push(...this.scene.children);
    this.update(15_000, 0, 1, false);
  }

  update(
    altitudeMeters: number,
    elapsedSeconds: number,
    aspect: number,
    firstPerson: boolean,
    lookYaw = 0,
    lookPitch = 0,
  ): void {
    if (this.disposed) return;
    const altitude = Math.max(
      0,
      Number.isFinite(altitudeMeters) ? altitudeMeters : 0,
    );
    const time = Math.max(
      0,
      Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0,
    );
    const altitudeKm = altitude / 1000;
    this.altitudeMeters = altitude;
    const air = 1 - THREE.MathUtils.smoothstep(altitudeKm, 15, 90);
    this.earth.position.set(
      0,
      -EARTH_RADIUS - altitude * ROCKET_SPACE_METERS_TO_UNITS,
      0,
    );
    this.skyMaterial.uniforms.uAir.value = air;
    // Exposure adaptation: stars emerge gradually; they are subdued beside the bright Earth.
    this.starMaterial.uniforms.uOpacity.value =
      THREE.MathUtils.smoothstep(altitudeKm, 28, 105) * 0.86;
    this.planetMaterial.uniforms.uTime.value = time;

    const nextAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    const nextFov = firstPerson ? 65 : 58;
    if (this.camera.aspect !== nextAspect || this.camera.fov !== nextFov) {
      this.camera.aspect = nextAspect;
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    // Third-person camera is 90 m behind and 20 m above a vehicle at the origin.
    // First-person eye is at the origin; the integrator can position its cabin around it.
    if (firstPerson) this.camera.position.set(0, 0, 0);
    else this.camera.position.set(0, 0.0002, 0.0009);
    const yaw = Number.isFinite(lookYaw) ? lookYaw : 0;
    const offsetPitch = Number.isFinite(lookPitch) ? lookPitch : 0;
    const pitch = THREE.MathUtils.clamp(
      (firstPerson ? 0.1 : -0.219) + offsetPitch,
      -1.48,
      1.48,
    );
    this.direction.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    this.target.copy(this.camera.position).add(this.direction);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.sun.lookAt(this.camera.position);
  }

  /** Camera-only observation hint; does not rotate or move the simulated rocket. */
  getCelestialFocus(body: RocketCelestialBody): RocketCelestialFocus {
    const object = body === 'sun' ? this.sun : this.moon;
    const target = object.position.clone();
    return {
      target,
      direction: target
        .clone()
        .sub(this.camera.getWorldPosition(new THREE.Vector3()))
        .normalize(),
      fovDegrees: body === 'sun' ? 18 : 12,
      angularDiameterDegrees: body === 'sun' ? 0.533 : 0.518,
    };
  }

  /** A target just below the analytic horizon, suitable for a 55–58 degree Earth view. */
  getHorizonTarget(target = new THREE.Vector3()): THREE.Vector3 {
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const height =
      Math.max(1, this.altitudeMeters) * ROCKET_SPACE_METERS_TO_UNITS;
    const radius = EARTH_RADIUS + height;
    const depression = Math.acos(
      THREE.MathUtils.clamp(EARTH_RADIUS / radius, 0, 1),
    );
    const pitch = -depression - radians(4);
    const distance = Math.max(
      2,
      Math.sqrt(radius * radius - EARTH_RADIUS * EARTH_RADIUS),
    );
    return target
      .set(0, Math.sin(pitch), -Math.cos(pitch))
      .multiplyScalar(distance)
      .add(eye);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRender = () => {};
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const root of this.ownedRoots) {
      root.traverse((object) => {
        const renderable = object as THREE.Mesh;
        if (renderable.geometry) geometries.add(renderable.geometry);
        if (renderable.material) {
          for (const material of Array.isArray(renderable.material)
            ? renderable.material
            : [renderable.material]) {
            materials.add(material);
          }
        }
      });
      this.scene.remove(root);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.landMask.dispose();
    this.ownedRoots.length = 0;
  }

  private createStars(): THREE.BufferGeometry {
    const random = seededRandom(0x41544c41);
    const starCount = 2200;
    const positions = new Float32Array((starCount + 3) * 3);
    const sizes = new Float32Array(starCount + 3);
    const colors = new Float32Array((starCount + 3) * 3);
    for (let i = 0; i < starCount; i++) {
      const y = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - y * y);
      positions.set(
        [ring * Math.cos(angle) * 780, y * 780, ring * Math.sin(angle) * 780],
        i * 3,
      );
      const brightness = 0.35 + random() * 0.65;
      const tint = random();
      colors.set(
        [
          brightness,
          brightness * (0.82 + tint * 0.18),
          brightness * (0.7 + tint * 0.4),
        ],
        i * 3,
      );
      sizes[i] = random() < 0.035 ? 2.9 : 0.9 + random() * 1.25;
    }
    // Distant planets remain small points instead of oversized nearby decorative spheres.
    const planets = [
      { direction: [0.34, 0.21, -0.92], color: [1.0, 0.85, 0.56], size: 3.8 },
      { direction: [-0.12, 0.43, -0.89], color: [0.95, 0.49, 0.28], size: 2.5 },
      { direction: [0.61, 0.33, -0.72], color: [0.85, 0.84, 0.76], size: 2.9 },
    ];
    for (let i = 0; i < planets.length; i++) {
      const index = starCount + i;
      const direction = new THREE.Vector3()
        .fromArray(planets[i].direction)
        .normalize()
        .multiplyScalar(750);
      positions.set(direction.toArray(), index * 3);
      colors.set(planets[i].color, index * 3);
      sizes[index] = planets[i].size;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  private createSun(): void {
    const distance = 500;
    const angularRadius = radians(0.533 / 2);
    const radius = Math.tan(angularRadius) * distance;
    this.sun.name = 'Sun — approximately 0.53 degree apparent diameter';
    this.sun.userData = {
      celestialBody: 'sun',
      angularDiameterDegrees: 0.533,
      radiusUnits: radius,
      focusFovDegrees: 18,
      haloAngularDiameterDegrees: 3.2,
    };
    this.sun.position.copy(this.sunDirection).multiplyScalar(distance);
    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float aa = max(fwidth(r), 0.0005);
          float disk = 1.0 - smoothstep(1.0 / 6.0 - aa, 1.0 / 6.0 + aa, r);
          float halo = (exp(-r * 8.0) * 0.55 + exp(-r * 3.4) * 0.065)
            * (1.0 - smoothstep(0.88, 1.0, r));
          vec3 color = mix(vec3(1.0, 0.65, 0.30), vec3(1.0, 0.96, 0.83), disk);
          // Additive blending already multiplies by alpha; keep halo radiance
          // out of RGB so the glow is not accidentally attenuated a second time.
          gl_FragColor = vec4(color, min(1.0, disk + halo));
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    // Plane spans 6 disc diameters; the bright core retains its natural angular size.
    const sprite = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 12, radius * 12),
      material,
    );
    sprite.renderOrder = -30;
    sprite.onBeforeRender = (_renderer, _scene, renderCamera) => {
      renderCamera.getWorldPosition(this.sunEye);
      this.sun.lookAt(this.sunEye);
      this.sun.updateMatrixWorld(true);
    };
    this.sun.add(sprite);
  }
}

export default RocketSpace;

import * as THREE from 'three';
import type { VisualQuality } from './quality';

export type NightVehicleModel =
  | 'sedan'
  | 'sedan-fallback'
  | 'suv'
  | 'bus'
  | 'bus-fallback';
export interface TrafficNightLightFrame {
  nightAmount: number;
  quality: VisualQuality;
  compatible?: boolean;
  /** City lighting policy. Zero keeps an unlit park or outer district dark. */
  downtownAt: (x: number, z: number) => number;
  /** Actual asphalt height; undefined rejects a spill over a non-road surface. */
  roadHeight: (x: number, z: number) => number | undefined;
}

// Lamp coordinates come from the accepted GLB authoring sources, in the same
// +Z-forward tyre-contact frame. This pass never changes their shared glazing.
const fixtures = {
  sedan: {
    head: [0.594, 0.755, 2.307, 0.37, 0.12],
    tail: [0.594, 0.755, -2.207, 0.3, 0.12],
    spillLength: 11,
    spillWidth: 4.4,
  },
  // The original two-box traffic fallback is 4.3 m long. Its lights belong on
  // those actual bumpers, rather than the imported 4.5 m sedan's nose/tail.
  'sedan-fallback': {
    head: [0.594, 0.755, 2.154, 0.37, 0.12],
    tail: [0.594, 0.755, -2.154, 0.3, 0.12],
    spillLength: 11,
    spillWidth: 4.4,
  },
  suv: {
    head: [0.6138, 0.895, 2.382, 0.37, 0.12],
    tail: [0.6138, 0.895, -2.282, 0.3, 0.12],
    spillLength: 11,
    spillWidth: 4.4,
  },
  bus: {
    head: [0.82, 0.77, 6.124, 0.23, 0.14],
    tail: [1.02, 0.77, -6.323, 0.14, 0.26],
    spillLength: 13,
    spillWidth: 5.2,
  },
  'bus-fallback': {
    head: [0.87, 0.97, 6.133, 0.24, 0.16],
    tail: [0.92, 1.05, -6.334, 0.23, 0.33],
    spillLength: 13,
    spillWidth: 5.2,
  },
} as const;

const budget = {
  balanced: { capacity: 64, distance: 260 },
  high: { capacity: 96, distance: 340 },
  ultra: { capacity: 128, distance: 450 },
} as const;
const MAX_VEHICLES = 128;

function lampMaterial(color: number) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float lampStrength;\nvarying float trafficLampStrength;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntrafficLampStrength = lampStrength;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float trafficLampStrength;',
      )
      .replace(
        '#include <alphatest_fragment>',
        'diffuseColor.a *= trafficLampStrength;\n#include <alphatest_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'traffic-night-lamp-fade-v1';
  return material;
}

function lampGeometry() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute(
    'lampStrength',
    new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_VEHICLES * 2),
      1,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  return geometry;
}

/** One short, softly edged forward footprint. No canvas, bitmap or spotlight. */
function spillGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.22, 0, 0, 0.22, 0, 0, -0.5, 0, 1, 0.5, 0, 1],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
  );
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  geometry.computeVertexNormals();
  geometry.setAttribute(
    'spillStrength',
    new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_VEHICLES),
      1,
    ).setUsage(THREE.DynamicDrawUsage),
  );
  return geometry;
}

function spillMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      nightAmount: { value: 0 },
      color: { value: new THREE.Color(0xffe3b2) },
    },
    vertexShader: `
      attribute float spillStrength;
      varying vec2 footprintUv;
      varying float strength;
      void main() {
        footprintUv = uv;
        strength = spillStrength;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float nightAmount;
      uniform vec3 color;
      varying vec2 footprintUv;
      varying float strength;
      void main() {
        float edge = pow(max(0.0, 1.0 - abs(footprintUv.x * 2.0 - 1.0)), 1.4);
        float lengthFade = (1.0 - smoothstep(0.20, 1.0, footprintUv.y));
        float nearFade = smoothstep(0.0, 0.07, footprintUv.y);
        gl_FragColor = vec4(color, 0.19 * nightAmount * strength * edge * lengthFade * nearFade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    // A sampled planar footprint can be seen from both sides on steep streets.
    side: THREE.DoubleSide,
    forceSinglePass: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}

interface Candidate {
  model: NightVehicleModel;
  matrix: THREE.Matrix4;
  distance: number;
}

/** Three bounded instanced draws for the visible fleet. Callers submit the
 * vehicle's actual render transform, so route time, stops and grades cannot
 * diverge from the head/tail lamps. No object or material is allocated per car. */
export class TrafficNightLights {
  readonly group = new THREE.Group();
  readonly stats = {
    vehicles: 0,
    headLamps: 0,
    tailLamps: 0,
    spills: 0,
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    pointLights: 0,
    capacity: 0,
    nightAmount: 0,
    disposed: false,
  };
  private readonly heads = new THREE.InstancedMesh(
    lampGeometry(),
    lampMaterial(0xfff1d7),
    MAX_VEHICLES * 2,
  );
  private readonly tails = new THREE.InstancedMesh(
    lampGeometry(),
    lampMaterial(0xff291c),
    MAX_VEHICLES * 2,
  );
  private readonly spills = new THREE.InstancedMesh(
    spillGeometry(),
    spillMaterial(),
    MAX_VEHICLES,
  );
  private readonly candidates: Candidate[] = Array.from(
    { length: MAX_VEHICLES },
    () => ({ model: 'sedan', matrix: new THREE.Matrix4(), distance: 0 }),
  );
  private count = 0;
  private frame: TrafficNightLightFrame | null = null;
  private reach = 0;
  private readonly camera = new THREE.Vector3();
  private readonly position = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();
  private readonly local = new THREE.Object3D();
  private readonly world = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();

  constructor(parent: THREE.Object3D) {
    this.group.name = 'Shared traffic night lamps';
    this.group.userData.trafficNightLights = this.stats;
    this.heads.name = 'Traffic glowing headlamps';
    this.tails.name = 'Traffic glowing taillamps';
    this.spills.name = 'Downtown traffic headlamp footprints';
    for (const mesh of [this.heads, this.tails, this.spills]) {
      mesh.count = 0;
      mesh.visible = false;
      mesh.castShadow = mesh.receiveShadow = false;
      // Admission is already limited by camera distance; changing matrices do
      // not use a stale auto-computed instance bounding sphere.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 1;
    }
    this.group.add(this.heads, this.tails, this.spills);
    this.group.visible = false;
    parent.add(this.group);
  }

  beginFrame(camera: THREE.Vector3, frame: TrafficNightLightFrame) {
    if (this.stats.disposed) return;
    this.frame = frame;
    this.camera.copy(camera);
    this.count = 0;
    const tier = budget[frame.quality];
    this.stats.capacity = frame.compatible ? 40 : tier.capacity;
    this.reach = frame.compatible ? 240 : tier.distance;
    this.stats.nightAmount = Number.isFinite(frame.nightAmount)
      ? THREE.MathUtils.clamp(frame.nightAmount, 0, 1)
      : 0;
    this.clear();
    this.heads.material.opacity = this.stats.nightAmount * 0.92;
    this.tails.material.opacity = this.stats.nightAmount * 0.72;
    this.spills.material.uniforms.nightAmount.value = this.stats.nightAmount;
  }

  /** Copy immediately: renderer visitors reuse a single mutable matrix. */
  addVehicle(model: NightVehicleModel, matrix: THREE.Matrix4) {
    if (
      this.stats.disposed ||
      !this.frame ||
      this.stats.nightAmount <= 0.001 ||
      !matrix.elements.every(Number.isFinite)
    )
      return false;
    this.position.setFromMatrixPosition(matrix);
    const distance = this.camera.distanceToSquared(this.position);
    if (distance >= this.reach * this.reach) return false;
    let slot = this.count;
    if (slot >= this.stats.capacity) {
      slot = 0;
      for (let i = 1; i < this.count; i++)
        if (this.candidates[i].distance > this.candidates[slot].distance)
          slot = i;
      if (distance >= this.candidates[slot].distance) return false;
    } else this.count++;
    const candidate = this.candidates[slot];
    candidate.model = model;
    candidate.matrix.copy(matrix);
    candidate.distance = distance;
    return true;
  }

  private clear() {
    this.stats.vehicles =
      this.stats.headLamps =
      this.stats.tailLamps =
      this.stats.spills =
      this.stats.drawCalls =
      this.stats.triangles =
        0;
    for (const mesh of [this.heads, this.tails, this.spills]) {
      mesh.count = 0;
      mesh.visible = false;
    }
    this.group.visible = false;
  }

  endFrame() {
    const frame = this.frame;
    if (this.stats.disposed || !frame) return;
    for (let i = 0; i < this.count; i++) {
      const { model, matrix, distance } = this.candidates[i],
        fixture = fixtures[model],
        distanceM = Math.sqrt(distance),
        lampFade =
          1 -
          THREE.MathUtils.smoothstep(distanceM, this.reach * 0.75, this.reach);
      for (const [mesh, lamp, rear] of [
        [this.heads, fixture.head, false],
        [this.tails, fixture.tail, true],
      ] as const) {
        for (const sign of [-1, 1]) {
          this.local.position.set(lamp[0] * sign, lamp[1], lamp[2]);
          this.local.rotation.set(0, rear ? Math.PI : 0, 0);
          this.local.scale.set(lamp[3], lamp[4], 1);
          this.local.updateMatrix();
          this.world.multiplyMatrices(matrix, this.local.matrix);
          mesh.setMatrixAt(mesh.count, this.world);
          mesh.geometry
            .getAttribute('lampStrength')
            .setX(mesh.count++, lampFade);
        }
      }
      if (distanceM >= 120) continue;
      this.position.setFromMatrixPosition(matrix);
      const city = frame.downtownAt(this.position.x, this.position.z);
      if (!Number.isFinite(city) || city <= 0) continue;
      this.forward.set(0, 0, 1).transformDirection(matrix);
      this.forward.y = 0;
      this.forward.normalize();
      if (this.forward.lengthSq() < 0.5) continue;
      this.right.set(this.forward.z, 0, -this.forward.x);
      const start = fixture.head[2] + 0.35,
        length = fixture.spillLength,
        width = fixture.spillWidth,
        x = this.position.x + this.forward.x * start,
        z = this.position.z + this.forward.z * start,
        ground = frame.roadHeight(x, z),
        ahead = frame.roadHeight(
          x + this.forward.x * length,
          z + this.forward.z * length,
        ),
        left = frame.roadHeight(
          x - this.right.x * width * 0.5,
          z - this.right.z * width * 0.5,
        ),
        right = frame.roadHeight(
          x + this.right.x * width * 0.5,
          z + this.right.z * width * 0.5,
        );
      if (![ground, ahead, left, right].every(Number.isFinite)) continue;
      // Sample the same actual asphalt as the vehicle. Reject abrupt edge or
      // overpass changes; a footprint must never become a large floating beam.
      const grade = (ahead! - ground!) / length,
        crossSlope = (right! - left!) / width;
      if (Math.abs(grade) > 0.35 || Math.abs(crossSlope) > 0.25) continue;
      this.forward.y = grade;
      this.right.y = crossSlope;
      this.normal.crossVectors(this.forward, this.right).normalize();
      this.rotation.makeBasis(this.right, this.normal, this.forward);
      this.local.matrix.copy(this.rotation);
      this.local.matrix.scale(this.scale.set(width, 1, length));
      this.local.matrix.setPosition(x, ground! + 0.035, z);
      this.spills.setMatrixAt(this.spills.count, this.local.matrix);
      this.spills.geometry
        .getAttribute('spillStrength')
        .setX(
          this.spills.count++,
          THREE.MathUtils.clamp(city, 0, 1) *
            (1 - THREE.MathUtils.smoothstep(distanceM, 90, 120)),
        );
    }
    for (const mesh of [this.heads, this.tails, this.spills]) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = mesh.count > 0;
      if (mesh.count) this.stats.drawCalls++;
    }
    this.spills.geometry.getAttribute('spillStrength').needsUpdate = true;
    this.heads.geometry.getAttribute('lampStrength').needsUpdate = true;
    this.tails.geometry.getAttribute('lampStrength').needsUpdate = true;
    this.stats.vehicles = this.count;
    this.stats.headLamps = this.heads.count;
    this.stats.tailLamps = this.tails.count;
    this.stats.spills = this.spills.count;
    this.stats.triangles =
      (this.heads.count + this.tails.count + this.spills.count) * 2;
    this.group.visible = this.count > 0;
    this.frame = null;
  }

  dispose() {
    if (this.stats.disposed) return;
    this.stats.disposed = true;
    this.frame = null;
    this.clear();
    this.group.removeFromParent();
    for (const mesh of [this.heads, this.tails, this.spills]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    this.group.clear();
  }
}

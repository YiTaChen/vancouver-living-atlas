import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import {
  RailPath,
  makeRailPath,
  carriageOpacity,
  trainHeadDistance,
  type RailRouteData,
  type TrainKind,
} from './rail-path';

const UP = new THREE.Vector3(0, 1, 0);
const AXLE = new THREE.Vector3(1, 0, 0);
const box = (w: number, h: number, l: number, x = 0, y = 0, z = 0) =>
  new THREE.BoxGeometry(w, h, l).translate(x, y, z);
const cylinder = (
  r: number,
  h: number,
  x: number,
  y: number,
  z: number,
  horizontal = false,
) => {
  const g = new THREE.CylinderGeometry(r, r, h, 14);
  if (horizontal) g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
};
function colored(g: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color),
    a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) {
    a[i] = c.r;
    a[i + 1] = c.g;
    a[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function merge(parts: THREE.BufferGeometry[]) {
  const mixed = parts.some((g) => !g.index);
  const compatible = mixed
    ? parts.map((g) => (g.index ? g.toNonIndexed() : g))
    : parts;
  const geometry = mergeGeometries(compatible)!;
  new Set([...parts, ...compatible]).forEach((g) => g.dispose());
  return geometry;
}

interface RailCar {
  group: THREE.Group;
  body: THREE.Mesh;
  windows: THREE.Mesh;
  wheels: THREE.InstancedMesh;
  wheelPositions: THREE.Vector3[];
  wheelRadius: number;
  offset: number;
  length: number;
  materials: THREE.Material[];
}
export interface RailTrain {
  kind: TrainKind;
  path: RailPath;
  cars: RailCar[];
  speed: number;
  phase: number;
  length: number;
  head: number;
}
export interface Railway {
  group: THREE.Group;
  trains: RailTrain[];
  smoke: SteamPlume;
  elapsed: number;
}

/** Original authored stock, +Z is forward. One merged body and window mesh per car. */
function makeCar(
  kind: 'engine' | 'tender' | 'coach' | 'metro',
  offset: number,
): RailCar {
  const group = new THREE.Group(),
    parts: THREE.BufferGeometry[] = [],
    windows: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) =>
    parts.push(colored(g, color));
  const length =
    kind === 'engine' ? 14 : kind === 'tender' ? 9 : kind === 'coach' ? 20 : 17;
  const wheelRadius = kind === 'engine' ? 0.86 : 0.43;
  add(box(2.55, 0.38, length - 0.4, 0, 1.05), 0x232d32);
  add(box(0.25, 0.22, length + 0.8, 0, 0.98), 0x555c5c);
  if (kind === 'engine') {
    add(cylinder(1.13, 8.7, 0, 2.52, 1.2, true), 0x23352f);
    for (const z of [-2.5, 0, 2.5, 5.5])
      add(cylinder(1.16, 0.14, 0, 2.52, z, true), 0xbba16a);
    add(box(3.0, 2.5, 3.2, 0, 2.55, -4.45), 0x294339);
    add(box(3.3, 0.23, 3.6, 0, 3.91, -4.5), 0x202b2b);
    add(cylinder(0.4, 1.4, 0, 3.95, 4.55), 0x232a2b);
    add(cylinder(0.57, 0.18, 0, 4.65, 4.55), 0x4e5553);
    add(cylinder(0.46, 0.55, 0, 3.78, -0.6), 0xc3a568);
    add(cylinder(0.22, 0.38, 0, 3.68, 1.6), 0xc3a568);
    add(box(2.6, 0.18, 8.4, 0, 1.38, 1.2), 0x4b5651);
    add(box(3.0, 0.32, 0.8, 0, 1.15, 6.55), 0x995746);
    for (let i = -3; i <= 3; i++)
      add(box(0.09, 0.75, 0.22, i * 0.4, 0.76, 6.8), 0x8c5746);
    windows.push(
      box(0.025, 0.9, 1.8, -1.515, 3.1, -4.35),
      box(0.025, 0.9, 1.8, 1.515, 3.1, -4.35),
    );
    add(cylinder(0.32, 0.2, 0, 2.6, 5.7, true), 0xffedb5);
  } else if (kind === 'tender') {
    add(box(2.8, 1.95, 7.4, 0, 2.1), 0x294339);
    add(box(2.82, 0.14, 7.4, 0, 2.85), 0xc0a775);
    add(box(2.4, 0.18, 5.7, 0, 3.1), 0x252a2a);
    for (let i = 0; i < 18; i++)
      add(
        new THREE.IcosahedronGeometry(0.37, 0)
          .scale(1.3, 0.65, 1)
          .translate(
            ((i % 3) - 1) * 0.75,
            3.25,
            (Math.floor(i / 3) - 2.5) * 0.8,
          ),
        0x303333,
      );
  } else {
    const metro = kind === 'metro';
    add(
      box(metro ? 2.65 : 2.95, 2.55, length - 1, 0, 2.4),
      metro ? 0xcbd4d5 : 0x6b3737,
    );
    add(
      box(metro ? 2.68 : 2.98, 0.85, length - 1.1, 0, 2.9),
      metro ? 0x253f58 : 0xc7b88d,
    );
    add(
      box(metro ? 2.69 : 2.99, 0.16, length - 1.0, 0, 1.85),
      metro ? 0xe8b94b : 0xd2b884,
    );
    const roof = cylinder(metro ? 1.4 : 1.58, length - 0.5, 0, 0, 0, true);
    roof.scale(1, 0.23, 1).translate(0, 3.77, 0);
    add(roof, metro ? 0xa2acb0 : 0x34403e);
    for (const side of [-1, 1]) {
      for (let z = -length / 2 + 2; z < length / 2 - 1; z += 1.8)
        windows.push(
          box(0.035, 0.76, 1.23, side * (metro ? 1.355 : 1.51), 2.96, z),
        );
      for (const z of metro ? [-5.6, 0, 5.6] : [-8.35, 8.35])
        add(
          box(
            0.06,
            2.03,
            metro ? 1.15 : 0.62,
            side * (metro ? 1.37 : 1.515),
            2.37,
            z,
          ),
          metro ? 0xa8b9c3 : 0x443b36,
        );
    }
    windows.push(
      box(metro ? 2.2 : 0.65, 0.82, 0.035, 0, 2.95, (length - 1) / 2 + 0.02),
    );
    windows.push(
      box(metro ? 2.2 : 0.65, 0.82, 0.035, 0, 2.95, -(length - 1) / 2 - 0.02),
    );
    if (metro) {
      add(box(1.55, 0.24, 2.7, 0, 4.02, -2.2), 0x829299);
      add(box(1.55, 0.24, 2.7, 0, 4.02, 2.2), 0x829299);
      for (const side of [-1, 1])
        add(
          box(0.36, 0.18, 0.06, side * 0.89, 1.77, (length - 1) / 2 + 0.06),
          0xffecc6,
        );
    }
  }
  const bodyMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.28,
  });
  const body = new THREE.Mesh(merge(parts), bodyMaterial);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x7ea8b4,
    emissive: 0x99bfd0,
    emissiveIntensity: 0.13,
    metalness: 0.4,
    roughness: 0.23,
  });
  const glass = new THREE.Mesh(
    windows.length ? merge(windows) : new THREE.BufferGeometry(),
    windowMaterial,
  );
  group.add(body, glass);
  const wheelGeo = merge([
    colored(
      new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.18, 12).rotateZ(
        Math.PI / 2,
      ),
      0x242b2c,
    ),
    colored(box(0.2, wheelRadius * 1.7, 0.09), 0xadb4ad),
    colored(box(0.2, 0.09, wheelRadius * 1.7), 0xadb4ad),
  ]);
  const wheelPositions: THREE.Vector3[] = [];
  const axles =
    kind === 'engine'
      ? [-2.7, -0.9, 0.9, 2.7]
      : [
          -length * 0.32 - 0.7,
          -length * 0.32 + 0.7,
          length * 0.32 - 0.7,
          length * 0.32 + 0.7,
        ];
  for (const z of axles)
    for (const x of [-0.82, 0.82])
      wheelPositions.push(new THREE.Vector3(x, wheelRadius + 0.02, z));
  const wheelMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.5,
  });
  const wheels = new THREE.InstancedMesh(
    wheelGeo,
    wheelMaterial,
    wheelPositions.length,
  );
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wheels.frustumCulled = false;
  group.add(wheels);
  // Cached city shadows cannot follow moving stock. SSAO provides local contact.
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = false;
      o.receiveShadow = true;
      o.userData.railVehicle = true;
    }
  });
  return {
    group,
    body,
    windows: glass,
    wheels,
    wheelPositions,
    wheelRadius,
    offset,
    length,
    materials: [bodyMaterial, windowMaterial, wheelMaterial],
  };
}

function buildTrack(
  e: CityEngine,
  path: RailPath,
  elevated: boolean,
  group: THREE.Group,
) {
  const ballast: THREE.BufferGeometry[] = [],
    rails: THREE.BufferGeometry[] = [],
    supports: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4(),
    transform = new THREE.Object3D();
  const step = 6,
    a = new THREE.Vector3(),
    b = new THREE.Vector3();
  for (let s = 0; s < path.length; s += step) {
    path.sample(s, a);
    path.sample(Math.min(path.length, s + step), b);
    transform.position.copy(a).add(b).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      b.clone().sub(a).normalize(),
    );
    transform.updateMatrix();
    matrix.copy(transform.matrix);
    const length = a.distanceTo(b) + 0.07;
    if (elevated)
      ballast.push(box(3.65, 1.15, length, 0, -0.74).applyMatrix4(matrix));
    else {
      const ground = Math.min(e.elevation(a.x, a.z), e.elevation(b.x, b.z));
      const depth = Math.max(0.35, (a.y + b.y) / 2 - ground - 0.15);
      ballast.push(
        box(3.7, depth, length, 0, -0.15 - depth / 2).applyMatrix4(matrix),
      );
    }
    for (const side of [-1, 1])
      rails.push(
        box(0.09, 0.15, length, side * 0.7175, -0.075).applyMatrix4(matrix),
      );
  }
  const sleeperCount = Math.floor(path.length / (elevated ? 1 : 0.85));
  const sleepers = new THREE.InstancedMesh(
    box(2.45, 0.13, 0.24),
    new THREE.MeshStandardMaterial({
      color: elevated ? 0xb2b6af : 0x665a49,
      roughness: 1,
    }),
    sleeperCount,
  );
  for (let i = 0; i < sleeperCount; i++) {
    const s = ((i + 0.5) * path.length) / sleeperCount;
    path.sample(s, a);
    path.sample(Math.min(path.length, s + 0.5), b);
    transform.position.copy(a);
    transform.position.y -= 0.2;
    transform.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      b.sub(a).normalize(),
    );
    transform.updateMatrix();
    sleepers.setMatrixAt(i, transform.matrix);
  }
  if (elevated)
    for (let s = 12; s < path.length - 8; s += 26) {
      path.sample(s, a);
      const ground = e.elevation(a.x, a.z),
        height = a.y - ground - 1.3;
      if (height > 0.5)
        supports.push(box(1.25, height, 1.6, a.x, ground + height / 2, a.z));
    }
  for (const [parts, color] of [
    [ballast, elevated ? 0xa5aba7 : 0x7c8075],
    [rails, 0xaeb8b9],
    [supports, 0xadb2ad],
  ] as [THREE.BufferGeometry[], number][]) {
    if (!parts.length) continue;
    const mesh = new THREE.Mesh(
      merge(parts),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: color === 0xaeb8b9 ? 0.65 : 0,
      }),
    );
    mesh.receiveShadow = true;
    mesh.castShadow = elevated;
    group.add(mesh);
  }
  sleepers.receiveShadow = true;
  group.add(sleepers);
}

/** One draw call, fixed world-space pool; puffs stay behind when the engine turns. */
export class SteamPlume {
  readonly capacity = 96;
  mesh: THREE.Mesh;
  positions = new Float32Array(this.capacity * 3);
  sizes = new Float32Array(this.capacity);
  alphas = new Float32Array(this.capacity);
  ages = new Float32Array(this.capacity).fill(100);
  births = new Float32Array(this.capacity * 3);
  velocities = new Float32Array(this.capacity * 3);
  cursor = 0;
  emitIn = 0;
  emitted = 0;
  constructor() {
    const base = new THREE.PlaneGeometry(1, 1),
      geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index?.clone() || null;
    for (const [key, attribute] of Object.entries(base.attributes))
      geometry.setAttribute(key, attribute.clone());
    base.dispose();
    geometry.instanceCount = this.capacity;
    geometry.setAttribute(
      'puffPosition',
      new THREE.InstancedBufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      'puffSize',
      new THREE.InstancedBufferAttribute(this.sizes, 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      'puffAlpha',
      new THREE.InstancedBufferAttribute(this.alphas, 1).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: `
        attribute vec3 puffPosition; attribute float puffSize; attribute float puffAlpha;
        varying vec2 vPuffUv; varying float vPuffAlpha;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vPuffUv=uv; vPuffAlpha=puffAlpha;
          vec4 mvPosition=modelViewMatrix*vec4(puffPosition,1.0);
          mvPosition.xy+=position.xy*puffSize;
          gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec2 vPuffUv; varying float vPuffAlpha;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec2 p=vPuffUv*2.0-1.0;
          float r=length(p);
          float billow=0.86+0.14*sin(p.x*9.0+p.y*6.0)*sin(p.y*11.0-p.x*5.0);
          float alpha=exp(-3.7*r*r)*(1.0-smoothstep(0.7,1.0,r))*vPuffAlpha*billow;
          if(alpha<0.003) discard;
          gl_FragColor=vec4(vec3(0.96,0.975,0.98),alpha);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  update(
    dt: number,
    emitter: THREE.Vector3 | null,
    forward: THREE.Vector3,
    detailed: boolean,
  ) {
    this.emitIn -= dt;
    if (!emitter) this.emitIn = 0;
    else if (this.emitIn <= 0 && dt > 0) {
      this.emitIn += detailed ? 0.075 : 0.14;
      const i = this.cursor++ % this.capacity,
        k = i * 3;
      this.emitted++;
      this.ages[i] = 0;
      this.births[k] = emitter.x;
      this.births[k + 1] = emitter.y;
      this.births[k + 2] = emitter.z;
      this.velocities[k] =
        0.7 + forward.x * 0.5 + Math.sin(this.emitted * 2.3) * 0.3;
      this.velocities[k + 1] = 2.5 + (this.emitted % 5) * 0.11;
      this.velocities[k + 2] = 0.35 + forward.z * 0.5;
    }
    for (let i = 0; i < this.capacity; i++) {
      const age = (this.ages[i] += dt),
        k = i * 3;
      if (age >= 5.5) {
        this.alphas[i] = 0;
        continue;
      }
      this.positions[k] = this.births[k] + this.velocities[k] * age;
      this.positions[k + 1] = this.births[k + 1] + this.velocities[k + 1] * age;
      this.positions[k + 2] = this.births[k + 2] + this.velocities[k + 2] * age;
      this.sizes[i] = 1.65 + age * 2.2;
      this.alphas[i] =
        Math.min(1, age / 0.2) * Math.pow(1 - age / 5.5, 1.5) * 0.68;
    }
    for (const name of ['puffPosition', 'puffSize', 'puffAlpha'])
      this.mesh.geometry.attributes[name].needsUpdate = true;
  }
}

export function createRailway(e: CityEngine): Railway {
  const group = new THREE.Group();
  group.name = 'Railways';
  const trains: RailTrain[] = [];
  for (const route of e.data.railways.routes as RailRouteData[]) {
    const path = makeRailPath(route, (x, z) => e.elevation(x, z));
    buildTrack(e, path, route.kind === 'skytrain', group);
    const cars: RailCar[] = [];
    const types: ('engine' | 'tender' | 'coach' | 'metro')[] =
      route.kind === 'steam'
        ? ['engine', 'tender', 'coach', 'coach', 'coach', 'coach']
        : ['metro', 'metro', 'metro', 'metro'];
    let offset = 0;
    types.forEach((kind, i) => {
      const car = makeCar(kind, 0);
      if (i) offset += (cars[i - 1].length + car.length) / 2 + 0.8;
      car.offset = offset;
      cars.push(car);
      group.add(car.group);
    });
    trains.push({
      kind: route.kind,
      path,
      cars,
      speed: route.speed,
      phase: route.kind === 'steam' ? 0.42 : 0.57,
      length: offset + cars.at(-1)!.length / 2,
      head: 0,
    });
  }
  const smoke = new SteamPlume();
  group.add(smoke.mesh);
  e.scene.add(group);
  const railway = { group, trains, smoke, elapsed: 0 };
  updateRailway(e, railway, 0);
  return railway;
}
const back = new THREE.Vector3(),
  front = new THREE.Vector3(),
  forward = new THREE.Vector3(),
  right = new THREE.Vector3(),
  up = new THREE.Vector3();
const orientation = new THREE.Matrix4(),
  wheelTransform = new THREE.Object3D(),
  chimney = new THREE.Vector3(),
  smokeForward = new THREE.Vector3();
const axleBack = new THREE.Vector3(),
  axleFront = new THREE.Vector3(),
  axleForward = new THREE.Vector3(),
  axleRight = new THREE.Vector3(),
  axleUp = new THREE.Vector3(),
  inverseCar = new THREE.Quaternion(),
  spin = new THREE.Quaternion(),
  axleMatrix = new THREE.Matrix4();
export function updateRailway(
  e: Pick<CityEngine, 'settings'>,
  rail: Railway,
  delta: number,
) {
  const dt = Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.1) : 0;
  rail.elapsed += dt;
  let smoking = false;
  for (const train of rail.trains) {
    train.head = trainHeadDistance(
      rail.elapsed,
      train.speed,
      train.path.length,
      train.length,
      train.phase,
    );
    for (const car of train.cars) {
      const distance = train.head - car.offset;
      const opacity = carriageOpacity(
        distance,
        train.path.length,
        car.length / 2,
      );
      car.group.visible = opacity > 0.005;
      if (!car.group.visible) continue;
      train.path.sample(distance, car.group.position);
      train.path.sample(distance - car.length * 0.32, back);
      train.path.sample(distance + car.length * 0.32, front);
      forward.subVectors(front, back).normalize();
      right.crossVectors(UP, forward).normalize();
      up.crossVectors(forward, right);
      orientation.makeBasis(right, up, forward);
      car.group.quaternion.setFromRotationMatrix(orientation);
      for (const material of car.materials) {
        const fading = opacity < 0.999;
        if (material.transparent !== fading) {
          material.transparent = fading;
          material.needsUpdate = true;
        }
        material.depthWrite = !fading;
        material.opacity = opacity;
      }
      inverseCar.copy(car.group.quaternion).invert();
      car.wheelPositions.forEach((p, i) => {
        const along = distance + p.z;
        train.path.sample(along - 0.4, axleBack);
        train.path.sample(along + 0.4, axleFront);
        axleForward.subVectors(axleFront, axleBack).normalize();
        axleRight.crossVectors(UP, axleForward).normalize();
        axleUp.crossVectors(axleForward, axleRight);
        train.path.sample(along, wheelTransform.position);
        wheelTransform.position
          .addScaledVector(axleRight, p.x)
          .addScaledVector(axleUp, p.y)
          .sub(car.group.position)
          .applyQuaternion(inverseCar);
        axleMatrix.makeBasis(axleRight, axleUp, axleForward);
        wheelTransform.quaternion
          .setFromRotationMatrix(axleMatrix)
          .premultiply(inverseCar);
        spin.setFromAxisAngle(AXLE, distance / car.wheelRadius);
        wheelTransform.quaternion.multiply(spin);
        wheelTransform.updateMatrix();
        car.wheels.setMatrixAt(i, wheelTransform.matrix);
      });
      car.wheels.instanceMatrix.needsUpdate = true;
      if (
        train.kind === 'steam' &&
        car === train.cars[0] &&
        opacity > 0.85 &&
        train.speed > 0
      ) {
        chimney
          .set(0, 4.73, 4.55)
          .applyQuaternion(car.group.quaternion)
          .add(car.group.position);
        smokeForward.copy(forward);
        smoking = true;
      }
    }
  }
  rail.smoke.update(
    dt,
    smoking ? chimney : null,
    smokeForward,
    e.settings.quality === 'high',
  );
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LineId } from './skytrain-network';

/** Dimensions/door centres follow the existing reviewed cabin packages. These
 * original procedural exteriors are representative, not manufacturer CAD.
 * No cabin asset, texture, loader, canvas or interior is allocated for Orbit. */
export const SKYTRAIN_WORLD_STOCK = Object.freeze({
  expo: {
    length: 17.1,
    width: 2.65,
    height: 3.55,
    floor: 0.95,
    doorCenters: [-4.9, 0, 4.9],
    doorWidth: 1.52,
    offsets: [26.85, 8.95, -8.95, -26.85],
  },
  canada: {
    length: 20.5,
    width: 3,
    height: 3.75,
    floor: 1.1,
    doorCenters: [-6.4, 0, 6.4],
    doorWidth: 1.5,
    offsets: [10.5, -10.5],
  },
});
export interface WorldSkyTrainExterior {
  group: THREE.Group;
  cars: THREE.Group[];
  setDirection(motionSign: number): void;
  dispose(): void;
}
interface CarGeometry {
  body: THREE.BufferGeometry;
  windows: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry | null;
}
function colored(geometry: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color),
    positions = geometry.getAttribute('position'),
    colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}
function merge(parts: THREE.BufferGeometry[]) {
  const normalized = parts.map((part) =>
      part.index ? part.toNonIndexed() : part,
    ),
    geometry = mergeGeometries(normalized)!;
  for (const part of new Set([...parts, ...normalized])) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
const box = (size: [number, number, number], p: [number, number, number]) =>
  new THREE.BoxGeometry(...size).translate(...p);

function buildCar(line: LineId, cab: -1 | 0 | 1): CarGeometry {
  const stock = SKYTRAIN_WORLD_STOCK[line],
    halfW = stock.width / 2,
    halfL = stock.length / 2,
    body: THREE.BufferGeometry[] = [],
    windows: THREE.BufferGeometry[] = [],
    lamps: THREE.BufferGeometry[] = [];
  const add = (
    size: [number, number, number],
    p: [number, number, number],
    color: number,
  ) => body.push(colored(box(size, p), color));
  const glass = (size: [number, number, number], p: [number, number, number]) =>
    windows.push(colored(box(size, p), 0x31596b));
  // Rounded roof shoulders, recessed underframe and a raked observation nose.
  const section = [
      [-0.83, stock.floor - 0.2],
      [-1, stock.floor + 0.18],
      [-1, stock.height - 0.46],
      [-0.93, stock.height - 0.13],
      [-0.72, stock.height],
      [0.72, stock.height],
      [0.93, stock.height - 0.13],
      [1, stock.height - 0.46],
      [1, stock.floor + 0.18],
      [0.83, stock.floor - 0.2],
    ],
    positions: number[] = [],
    colors: number[] = [];
  const sections = [-halfL, -halfL + 0.8, halfL - 0.8, halfL];
  const vertex = (longitudinal: number, ring: number) => {
    const [x, y] = section[ring],
      end =
        longitudinal === 0 ? -1 : longitudinal === sections.length - 1 ? 1 : 0,
      nose = cab !== 0 && end === cab,
      taper = nose ? 0.9 : 1,
      z = sections[longitudinal] - end * (nose ? (y - stock.floor) * 0.2 : 0);
    return [x * halfW * taper, y, z];
  };
  const emit = (a: number[], b: number[], c: number[], color: number) => {
    const tint = new THREE.Color(color);
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  };
  for (let longitudinal = 0; longitudinal < sections.length - 1; longitudinal++)
    for (let i = 0; i < section.length; i++) {
      const j = (i + 1) % section.length,
        a = vertex(longitudinal, i),
        b = vertex(longitudinal, j),
        c = vertex(longitudinal + 1, j),
        d = vertex(longitudinal + 1, i),
        color = i === 9 ? 0x343d44 : i >= 2 && i <= 6 ? 0xbac6cc : 0xd6dfe1;
      emit(a, d, b, color);
      emit(b, d, c, color);
    }
  for (const end of [-1, 1])
    for (let i = 0; i < section.length; i++) {
      const a = vertex(end < 0 ? 0 : sections.length - 1, i),
        b = vertex(end < 0 ? 0 : sections.length - 1, (i + 1) % section.length),
        c = [
          0,
          (stock.floor + stock.height) / 2,
          end * (halfL - (cab === end ? 0.24 : 0)),
        ];
      if (end === 1) emit(a, c, b, cab === end ? 0x145080 : 0xcbd5d9);
      else emit(a, b, c, cab === end ? 0x145080 : 0xcbd5d9);
    }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  shell.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shell.computeVertexNormals();
  body.push(shell);
  add([stock.width * 0.83, 0.35, stock.length - 0.8], [0, 0.58, 0], 0x28343d);
  for (const side of [-1, 1]) {
    add(
      [0.045, 0.31, stock.length - 1.1],
      [side * (halfW + 0.01), stock.floor + 0.5, 0],
      0x154f7c,
    );
    add(
      [0.05, 0.065, stock.length - 1.1],
      [side * (halfW + 0.016), stock.floor + 0.7, 0],
      0xe4b93d,
    );
    // Black window surrounds are interrupted by real paired door leaves.
    const intervals: [number, number][] = [];
    let previous = -halfL + 0.95;
    for (const z of stock.doorCenters) {
      intervals.push([previous, z - stock.doorWidth / 2 - 0.13]);
      previous = z + stock.doorWidth / 2 + 0.13;
      add(
        [0.065, 2.09, stock.doorWidth + 0.09],
        [side * (halfW + 0.005), stock.floor + 1.045, z],
        line === 'canada' ? 0x175888 : 0xb8c8cf,
      );
      for (const leaf of [-1, 1]) {
        glass(
          [0.028, 1.12, stock.doorWidth / 2 - 0.1],
          [
            side * (halfW + 0.047),
            stock.floor + 1.37,
            z + (leaf * stock.doorWidth) / 4,
          ],
        );
        add(
          [0.035, 1.98, 0.025],
          [side * (halfW + 0.048), stock.floor + 1.05, z],
          0x617782,
        );
      }
    }
    intervals.push([previous, halfL - 0.95]);
    for (const [from, to] of intervals) {
      const count = Math.max(1, Math.round((to - from) / 1.6)),
        width = (to - from) / count;
      for (let i = 0; i < count; i++) {
        const z = from + (i + 0.5) * width;
        add(
          [0.045, 1.24, width - 0.04],
          [side * (halfW + 0.02), stock.floor + 1.4, z],
          0x142f42,
        );
        glass(
          [0.025, 1.1, width - 0.16],
          [side * (halfW + 0.05), stock.floor + 1.4, z],
        );
      }
    }
  }
  // Two bogies with separate steel axles and eight visible rubber/steel wheels.
  for (const bogie of [-1, 1]) {
    const z = bogie * stock.length * 0.31;
    add([1.8, 0.42, 2.3], [0, 0.44, z], 0x34424b);
    for (const axle of [-0.72, 0.72]) {
      body.push(
        colored(
          new THREE.CylinderGeometry(0.1, 0.1, 2.15, 8)
            .rotateZ(Math.PI / 2)
            .translate(0, 0.35, z + axle),
          0x78858b,
        ),
      );
      for (const side of [-1, 1])
        body.push(
          colored(
            new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12)
              .rotateZ(Math.PI / 2)
              .translate(side * 1.01, 0.35, z + axle),
            0x26323a,
          ),
        );
    }
  }
  for (const z of [-stock.length * 0.22, stock.length * 0.22]) {
    add([1.6, 0.21, 2.7], [0, stock.height + 0.09, z], 0x879ba5);
    for (let i = 0; i < 6; i++)
      add(
        [1.35, 0.027, 0.035],
        [0, stock.height + 0.21, z - 0.85 + i * 0.34],
        0x445963,
      );
  }
  for (const end of [-1, 1]) {
    add([0.22, 0.18, 0.65], [0, 0.65, end * (halfL + 0.08)], 0x4a5961);
    if (end !== cab) {
      add(
        [1.24, 1.85, 0.16],
        [0, stock.floor + 0.96, end * (halfL + 0.03)],
        0x253d48,
      );
      for (let i = 0; i < 5; i++)
        add(
          [1.3, 0.045, 0.03],
          [0, stock.floor + 0.2 + i * 0.35, end * (halfL + 0.12)],
          0x596a75,
        );
    }
  }
  if (cab) {
    // Observation glazing follows the sloped front rather than a flat box end.
    const pane = new THREE.PlaneGeometry(stock.width * 0.72, 1.18);
    pane.rotateX(-cab * 0.197);
    if (cab < 0) pane.rotateY(Math.PI);
    pane.translate(0, stock.floor + 1.48, cab * (halfL - 0.28));
    windows.push(colored(pane, 0x1b3446));
    add(
      [1.2, 0.18, 0.035],
      [0, stock.floor + 2.12, cab * (halfL - 0.43)],
      0x111f29,
    );
    for (const side of [-1, 1])
      lamps.push(
        colored(
          box(
            [0.32, 0.13, 0.035],
            [
              side * stock.width * 0.29,
              stock.floor + 0.49,
              cab * (halfL - 0.075),
            ],
          ),
          0xffffff,
        ),
      );
  }
  return {
    body: merge(body),
    windows: merge(windows),
    lamps: lamps.length ? merge(lamps) : null,
  };
}

/** One shared geometry/material owner for every autonomous train in the city. */
export class SkyTrainWorldExteriors {
  private readonly geometry = new Map<string, CarGeometry>();
  private readonly live = new Set<WorldSkyTrainExterior>();
  private readonly body = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.32,
  });
  private readonly glass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.38,
    emissive: 0x94b9cb,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  });
  private readonly headlight = new THREE.MeshBasicMaterial({
    color: 0xffedbf,
    toneMapped: false,
  });
  private readonly tailLight = new THREE.MeshBasicMaterial({
    color: 0xd6372e,
    toneMapped: false,
  });
  private disposed = false;
  setNight(night: number) {
    this.glass.emissiveIntensity =
      0.12 + THREE.MathUtils.clamp(night, 0, 1) * 0.6;
  }
  create(line: LineId): WorldSkyTrainExterior {
    if (this.disposed) throw new Error('SkyTrain exterior owner disposed');
    const stock = SKYTRAIN_WORLD_STOCK[line],
      group = new THREE.Group(),
      cars: THREE.Group[] = [],
      lamps: { mesh: THREE.Mesh; cab: number }[] = [];
    group.name = `World ${line === 'expo' ? 'Mark V inspired' : 'Canada Line'} exterior`;
    group.userData.exteriorOnly = true;
    for (const [index, offset] of stock.offsets.entries()) {
      const cab = index === 0 ? 1 : index === stock.offsets.length - 1 ? -1 : 0,
        key = `${line}:${cab}`;
      let source = this.geometry.get(key);
      if (!source) {
        source = buildCar(line, cab);
        this.geometry.set(key, source);
      }
      const car = new THREE.Group();
      car.name = `${line} articulated car ${index + 1}`;
      car.position.z = offset;
      car.userData.offset = offset;
      car.userData.doorCenters = [...stock.doorCenters];
      car.userData.cab = cab;
      const shell = new THREE.Mesh(source.body, this.body),
        windows = new THREE.Mesh(source.windows, this.glass);
      shell.name =
        'Rounded silver shell / blue-gold livery / paired doors / bogies / rooftop equipment';
      windows.name = 'Repeated side and observation glazing';
      car.add(shell, windows);
      if (source.lamps) {
        const lights = new THREE.Mesh(source.lamps, this.headlight);
        lights.name = 'Cab directional lamps';
        car.add(lights);
        lamps.push({ mesh: lights, cab });
      }
      car.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = false;
          object.receiveShadow = true;
          object.userData.railVehicle = true;
        }
      });
      cars.push(car);
      group.add(car);
    }
    const exterior: WorldSkyTrainExterior = {
      group,
      cars,
      setDirection: (motionSign) => {
        for (const lamp of lamps)
          lamp.mesh.material =
            lamp.cab === Math.sign(motionSign)
              ? this.headlight
              : this.tailLight;
      },
      dispose: () => {
        group.removeFromParent();
        group.clear();
        this.live.delete(exterior);
      },
    };
    exterior.setDirection(1);
    this.live.add(exterior);
    return exterior;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const exterior of this.live) exterior.dispose();
    for (const geometry of this.geometry.values()) {
      geometry.body.dispose();
      geometry.windows.dispose();
      geometry.lamps?.dispose();
    }
    this.geometry.clear();
    this.body.dispose();
    this.glass.dispose();
    this.headlight.dispose();
    this.tailLight.dispose();
  }
}

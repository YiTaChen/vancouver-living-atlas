import * as THREE from 'three';
import { createConventionCentre } from './assets/convention-centre';
import {
  createBCPlace,
  createHarbourCentre,
  createMarineBuilding,
} from './assets/secondary-landmarks';
import { LandmarkDetail } from './landmark-detail';
import {
  createScienceWorld,
  createCanadaPlace,
} from './assets/primary-landmarks';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { project, hash } from './geo';
import type { CityEngine } from './engine';

// All landmark meshes below are original parametric geometry. Dimensions and
// coordinates come from primary architectural references and public map data.
class Builder {
  groups = new Map<
    string,
    { material: THREE.MeshStandardMaterial; geometries: THREE.BufferGeometry[] }
  >();
  origin = new THREE.Vector3();
  yaw = 0;
  constructor(public engine: CityEngine) {}
  at(lon: number, lat: number, yaw = 0, base?: number) {
    const [x, z] = project([lon, lat]);
    this.origin.set(x, base ?? this.engine.elevation(x, z), z);
    this.yaw = yaw;
    return this;
  }
  add(
    g: THREE.BufferGeometry,
    color: number,
    x = 0,
    y = 0,
    z = 0,
    rot?: THREE.Euler,
    metal = 0.1,
  ) {
    const local = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(rot || new THREE.Euler()),
        new THREE.Vector3(1, 1, 1),
      ),
      world = new THREE.Matrix4().makeRotationY(this.yaw);
    world.setPosition(this.origin);
    g.applyMatrix4(world.multiply(local));
    g.deleteAttribute('uv');
    g = g.index ? g.toNonIndexed() : g;
    const key = color + ':' + metal;
    if (!this.groups.has(key))
      this.groups.set(key, {
        material: new THREE.MeshStandardMaterial({
          color,
          metalness: metal,
          roughness: metal > 0.3 ? 0.3 : 0.78,
        }),
        geometries: [],
      });
    this.groups.get(key)!.geometries.push(g);
  }
  box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z);
    // Share grounded decks and bridge columns with water navigation.
    if (this.origin.y + y - h / 2 < 2 && this.origin.y + y + h / 2 > 0) {
      const ring = [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ].map(([a, b]) => {
        const px = x + (a * w) / 2,
          pz = z + (b * d) / 2;
        return [
          this.origin.x + Math.cos(this.yaw) * px + Math.sin(this.yaw) * pz,
          this.origin.z - Math.sin(this.yaw) * px + Math.cos(this.yaw) * pz,
        ];
      });
      (this.engine.data.solidWaterFootprints ||= []).push([ring]);
    }
  }
  cylinder(
    rt: number,
    rb: number,
    h: number,
    color: number,
    x = 0,
    y = 0,
    z = 0,
    segments = 24,
  ) {
    this.add(new THREE.CylinderGeometry(rt, rb, h, segments), color, x, y, z);
  }
  beam(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number) {
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
    this.add(
      new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6),
      color,
      ...(a.clone().lerp(b, 0.5).toArray() as [number, number, number]),
      new THREE.Euler().setFromQuaternion(q),
    );
  }
  finish() {
    for (const { material, geometries } of this.groups.values()) {
      const merged = mergeGeometries(geometries);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, material);
      m.castShadow = true;
      m.receiveShadow = true;
      this.engine.landmarks.add(m);
      geometries.forEach((g) => g.dispose());
    }
  }
}
export function createLandmarks(engine: CityEngine) {
  const b = new Builder(engine),
    white = 0xe8e4d7,
    glass = 0x456d79;
  engine.landmarkDetails.push(new LandmarkDetail(engine, createScienceWorld));
  engine.landmarkDetails.push(new LandmarkDetail(engine, createCanadaPlace));
  engine.landmarkDetails.push(new LandmarkDetail(engine, createBCPlace));
  engine.landmarkDetails.push(new LandmarkDetail(engine, createHarbourCentre));
  engine.landmarkDetails.push(new LandmarkDetail(engine, createMarineBuilding));
  engine.landmarkDetails.push(
    new LandmarkDetail(engine, createConventionCentre),
  );
  // Vancouver House: widening upper floors and a white balcony lattice.
  b.at(-123.131029, 49.2749256, -0.78);
  b.box(49, 25, 49, glass, 0, 12.5, 0);
  for (let i = 0; i < 49; i++) {
    const t = i / 48,
      width = 15 + 29 * Math.pow(t, 0.55),
      shift = (1 - t) * 11,
      y = i * 3.2;
    b.box(width, 2.65, 34, glass, shift, y + 1.35, 0);
    b.box(width + 1.8, 0.5, 36.5, white, shift, y + 3, 0);
    for (let x = -width / 2; x < width / 2; x += 5.5) {
      b.box(0.38, 3.2, 0.5, white, x + shift, y + 1.6, -18);
      b.box(0.38, 3.2, 0.5, white, x + shift, y + 1.6, 18);
    }
  }
  // Burrard, Granville, and Cambie: bridge decks follow actual endpoints.
  for (const s of engine.data.bridges.mainSpines)
    bridge(b, engine, s.start, s.end, s.estimatedDeckM, s.kind);
  // Siwash Rock, the outcrop off Stanley Park's western cliffs.
  b.at(-123.15987, 49.30552, 0, 0);
  b.cylinder(4.2, 9.5, 17, 0x756d5b, 0, 8.5, 0, 7);
  b.cylinder(4, 4.8, 1.4, 0x56713b, 0, 17.5, 0, 7);
  b.cylinder(0, 3.6, 9, 0x2d523f, 0, 22, 0, 6);
  b.finish();
}
function bridge(
  b: Builder,
  e: CityEngine,
  a: number[],
  c: number[],
  deck: number,
  kind: string,
) {
  const p = project(a),
    q = project(c),
    length = Math.hypot(q[0] - p[0], q[1] - p[1]),
    yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
  const center = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  b.at(center[0], center[1], yaw, 0);
  const width = kind === 'lions' ? 20 : kind === 'granville' ? 27 : 25,
    color = kind === 'lions' ? 0x486e5e : 0xb3b2a2;
  b.box(width, 3.2, length, color, 0, deck, 0);
  if (kind !== 'lions') {
    b.box(width - 3, 0.3, length, 0x566668, 0, deck + 1.8, 0);
    b.box(0.45, 1.3, length, 0xe0daca, -width / 2, deck + 2.3, 0);
    b.box(0.45, 1.3, length, 0xe0daca, width / 2, deck + 2.3, 0);
    for (let z = -length / 2 + 14; z < length / 2; z += 18)
      b.box(0.35, 0.08, 8, 0xe4d6a1, 0, deck + 2, z);
  }
  if (kind === 'lions') {
    const south = -length / 2 + 187,
      north = south + 472;
    for (const z of [south, north]) {
      for (const x of [-10.8, 10.8]) {
        b.box(3.4, 111, 4, color, x, 74, z);
      }
      for (let y = 48; y < 127; y += 18) {
        // Leave the actual roadway/footways open through the tower. The
        // old y=66m crossbar lay directly across the 65.95m road surface.
        if (y > deck - 2 && y < deck + 8) continue;
        b.box(23, 2, 2, color, 0, y, z);
        if (y + 18 > 127) continue;
        b.beam(
          new THREE.Vector3(-10, y, z),
          new THREE.Vector3(10, y + 18, z),
          0.6,
          color,
        );
      }
    }
    for (const x of [-10.5, 10.5]) {
      for (let section = 0; section < 3; section++) {
        const start =
            section === 0 ? -length / 2 : section === 1 ? south : north,
          end = section === 0 ? south : section === 1 ? north : north + 187;
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 40; i++) {
          const z = start + ((end - start) * i) / 40,
            t = (z - south) / 472;
          let y =
            section === 1
              ? deck + 10 + 52 * Math.pow((t - 0.5) * 2, 2)
              : section === 0
                ? 65 + 61 * (i / 40)
                : 126 - 61 * (i / 40);
          points.push(new THREE.Vector3(x, y, z));
          if (i % 2 === 0)
            b.beam(
              new THREE.Vector3(x, deck + 2, z),
              new THREE.Vector3(x, y, z),
              0.21,
              0x4f7568,
            );
        }
        for (let i = 0; i < points.length - 1; i++)
          b.beam(points[i], points[i + 1], 0.52, color);
      }
    }
    for (let z = north + 200; z < length / 2; z += 90) {
      for (const x of [-7, 7])
        b.box(3.5, deck - 3, 5, color, x, (deck - 3) / 2, z);
      b.box(width, 3, 8, color, 0, deck - 4, z);
    }
  } else {
    for (
      let z = -length / 2 + 80;
      z < length / 2;
      z += kind === 'burrard' ? 140 : 95
    ) {
      for (const x of [-width * 0.3, width * 0.3])
        b.box(4.5, deck - 3, 6, color, x, (deck - 3) / 2, z);
      b.box(width, 3, 11, color, 0, deck - 4, z);
    }
    if (kind === 'burrard') {
      for (let z = -length * 0.34; z < length * 0.34; z += 22)
        for (const x of [-width * 0.37, width * 0.37]) {
          b.beam(
            new THREE.Vector3(x, deck - 2, z),
            new THREE.Vector3(x, deck - 11, z + 22),
            0.65,
            0x3b5556,
          );
          b.beam(
            new THREE.Vector3(x, deck - 11, z),
            new THREE.Vector3(x, deck - 2, z + 22),
            0.65,
            0x3b5556,
          );
          b.beam(
            new THREE.Vector3(x, deck - 11, z),
            new THREE.Vector3(x, deck - 11, z + 22),
            0.8,
            0x3b5556,
          );
        }
    }
    if (kind === 'burrard')
      for (const z of [-length * 0.2, length * 0.2]) {
        for (const x of [-width / 2, width / 2]) {
          b.box(5, 30, 7, 0xc0b69c, x, deck + 11, z);
          b.box(7, 3, 9, 0xd7ccaa, x, deck + 26, z);
        }
        b.box(width, 5, 6, 0xbfb497, 0, deck + 22, z);
      }
  }
}

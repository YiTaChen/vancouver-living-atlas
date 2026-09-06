/**
 * Original procedural harbour models. Copyright (c) 2026. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) licence.
 * No downloaded models, textures, logos, fonts, or other artwork.
 * Coordinates: metres; +Z is forward/bow, +Y is up.
 * Boats and the floatplane sit at waterline Y=0; helicopter skids sit at Y=0.
 * Each model uses at most four draw calls, including independently moving parts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Vec3 = readonly [number, number, number];
type Colour = THREE.ColorRepresentation;
type Profile = { z: number; rx: number; ry: number; y?: number };

const WHITE = 0xecebe2;
const CREAM = 0xf2eee1;
const METAL = 0xa6b0b2;
const DARK = 0x23353d;
const GLASS = 0x214554;
const TEAK = 0xad8255;
const RED = 0xb94835;
const ORANGE = 0xeb8c32;
const NAVY = 0x254553;

/** Accumulate colour-bearing geometry into one draw call; dispose intermediates. */
class Batch {
  private parts: THREE.BufferGeometry[] = [];

  add(source: THREE.BufferGeometry, colour?: Colour): void {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'color'].includes(attribute)) {
        geometry.deleteAttribute(attribute);
      }
    }
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    if (colour !== undefined || !geometry.hasAttribute('color')) {
      const c = new THREE.Color(colour ?? WHITE);
      const count = geometry.getAttribute('position').count;
      const colours = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colours[i * 3] = c.r;
        colours[i * 3 + 1] = c.g;
        colours[i * 3 + 2] = c.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    }
    this.parts.push(geometry);
  }

  box(size: Vec3, position: Vec3, colour: Colour, rotation?: Vec3): void {
    const geometry = new THREE.BoxGeometry(...size);
    if (rotation) {
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(...rotation),
      ));
    }
    geometry.translate(...position);
    this.add(geometry, colour);
  }

  ellipsoid(radius: Vec3, position: Vec3, colour: Colour, segments = 16): void {
    this.add(new THREE.SphereGeometry(1, segments, Math.max(6, segments / 2))
      .scale(...radius).translate(...position), colour);
  }

  cylinder(top: number, bottom: number, height: number, position: Vec3,
    colour: Colour, radial = 10, rotation?: Vec3): void {
    const geometry = new THREE.CylinderGeometry(top, bottom, height, radial);
    if (rotation) {
      geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(...rotation),
      ));
    }
    this.add(geometry.translate(...position), colour);
  }

  strut(a: Vec3, b: Vec3, radius: number, colour: Colour, radial = 6): void {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), radial);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), delta.normalize(),
    ));
    const midpoint = start.add(end).multiplyScalar(0.5);
    this.add(geometry.translate(midpoint.x, midpoint.y, midpoint.z), colour);
  }

  /** A plane with its outward normal initially pointing +Z. */
  window(width: number, height: number, position: Vec3, rotationY = 0,
    colour: Colour = GLASS): void {
    this.add(new THREE.PlaneGeometry(width, height)
      .rotateY(rotationY).translate(...position), colour);
  }

  quad(points: readonly Vec3[], colour: Colour): void {
    const positions = [...points[0], ...points[1], ...points[2],
      ...points[0], ...points[2], ...points[3]];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    this.add(geometry, colour);
  }

  finish(name: string, glazing = false): THREE.Mesh {
    if (!this.parts.length) throw new Error(`No geometry in ${name}`);
    const merged = mergeGeometries(this.parts, false);
    for (const geometry of this.parts) geometry.dispose();
    this.parts = [];
    if (!merged) throw new Error(`Could not merge ${name}`);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: glazing ? 0.21 : 0.57,
      metalness: glazing ? 0.28 : 0.10,
      // Opaque tinted glazing avoids sorting artefacts and draws only once.
      side: glazing ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (glazing) {
      material.emissive.setHex(0x082027);
      material.emissiveIntensity = 0.14;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Closed elliptical loft for curved fuselages. Stations run aft to forward. */
function fuselage(profiles: Profile[], sides = 20): THREE.BufferGeometry {
  const vertices: number[] = [];
  const triangles: number[] = [];
  for (const profile of profiles) {
    for (let i = 0; i < sides; i++) {
      const angle = i / sides * Math.PI * 2;
      vertices.push(Math.cos(angle) * profile.rx,
        (profile.y ?? 0) + Math.sin(angle) * profile.ry, profile.z);
    }
  }
  for (let j = 0; j < profiles.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i;
      const b = j * sides + (i + 1) % sides;
      const c = (j + 1) * sides + (i + 1) % sides;
      const d = (j + 1) * sides + i;
      // Counter-clockwise ring as seen from the nose.
      triangles.push(a, b, c, a, c, d);
    }
  }
  for (let i = 1; i < sides - 1; i++) {
    triangles.push(0, i + 1, i);
    const front = (profiles.length - 1) * sides;
    triangles.push(front, front + i, front + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}

/** A curved glass inset following the fuselage rather than intersecting it. */
function loftWindow(profiles: Profile[], fromZ: number, toZ: number,
  fromAngle: number, toAngle: number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const stepsZ = 8, stepsAngle = 7;
  for (let row = 0; row <= stepsZ; row++) {
    const z = THREE.MathUtils.lerp(fromZ, toZ, row / stepsZ);
    let index = 0;
    while (index < profiles.length - 2 && profiles[index + 1].z < z) index++;
    const a = profiles[index], b = profiles[index + 1];
    const t = THREE.MathUtils.clamp((z - a.z) / (b.z - a.z), 0, 1);
    const rx = THREE.MathUtils.lerp(a.rx, b.rx, t) + 0.025;
    const ry = THREE.MathUtils.lerp(a.ry, b.ry, t) + 0.025;
    const y = THREE.MathUtils.lerp(a.y ?? 0, b.y ?? 0, t);
    for (let column = 0; column <= stepsAngle; column++) {
      const angle = THREE.MathUtils.lerp(fromAngle, toAngle, column / stepsAngle);
      positions.push(rx * Math.cos(angle), y + ry * Math.sin(angle), z);
    }
  }
  for (let row = 0; row < stepsZ; row++) {
    for (let column = 0; column < stepsAngle; column++) {
      const a = row * (stepsAngle + 1) + column, b = a + 1;
      const d = (row + 1) * (stepsAngle + 1) + column, c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Rounded, flared, pointed marine hull; freeboard and draft straddle Y=0. */
function hull(length: number, beam: number, freeboard: number, draft: number,
  colour: Colour, underwater: Colour = 0x42616b, bowSheer = 0.18): THREE.BufferGeometry {
  const stations = [
    [-0.50, 0.76], [-0.465, 0.91], [-0.34, 0.99], [-0.12, 1],
    [0.15, 0.97], [0.31, 0.79], [0.425, 0.44], [0.49, 0.09], [0.50, 0.012],
  ];
  // Port deck, flared topside, waterline, rounded bilge, keel, starboard, deck.
  const ring = [
    [-0.95, 1], [-1, 0.62], [-0.98, 0.08], [-0.97, 0],
    [-0.88, -0.45], [-0.56, -0.88], [0, -1],
    [0.56, -0.88], [0.88, -0.45], [0.97, 0], [0.98, 0.08],
    [1, 0.62], [0.95, 1], [0, 1],
  ];
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const topColour = new THREE.Color(colour);
  const wetColour = new THREE.Color(underwater);
  const deckColour = topColour.clone().lerp(new THREE.Color(CREAM), 0.30);
  stations.forEach(([z, width]) => {
    const bow = Math.max(0, (z - 0.15) / 0.35);
    ring.forEach(([x, vertical]) => {
      const y = vertical >= 0
        ? vertical * freeboard * (1 + bow * bowSheer)
        : vertical * draft * (1 - bow * 0.45);
      // The foremost keel is raked aft underneath the bow's deck overhang.
      const rakedZ = z * length - bow * Math.max(0, -vertical) * length * 0.027;
      positions.push(x * width * beam / 2, y, rakedZ);
      const c = vertical < 0 ? wetColour : vertical === 1 ? deckColour : topColour;
      colours.push(c.r, c.g, c.b);
    });
  });
  for (let j = 0; j < stations.length - 1; j++) {
    for (let i = 0; i < ring.length; i++) {
      const a = j * ring.length + i;
      const b = j * ring.length + (i + 1) % ring.length;
      const c = (j + 1) * ring.length + (i + 1) % ring.length;
      const d = (j + 1) * ring.length + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  for (let i = 1; i < ring.length - 1; i++) {
    indices.push(0, i + 1, i);
    const last = (stations.length - 1) * ring.length;
    indices.push(last, last + i, last + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Extrude an X/Z deck footprint upward from a given base height. */
function polygonDeck(points: readonly (readonly [number, number])[], height: number,
  baseY: number, bevel = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height, steps: 1, curveSegments: 4,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  return geometry.rotateX(-Math.PI / 2).translate(0, baseY, 0);
}

function roundedDeck(width: number, length: number, height: number, radius: number,
  position: Vec3): THREE.BufferGeometry {
  const w = width / 2, l = length / 2, r = Math.min(radius, w, l);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -l);
  shape.lineTo(w - r, -l);
  shape.quadraticCurveTo(w, -l, w, -l + r);
  shape.lineTo(w, l - r);
  shape.quadraticCurveTo(w, l, w - r, l);
  shape.lineTo(-w + r, l);
  shape.quadraticCurveTo(-w, l, -w, l - r);
  shape.lineTo(-w, -l + r);
  shape.quadraticCurveTo(-w, -l, -w + r, -l);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: height, steps: 1, bevelEnabled: false, curveSegments: 5,
  }).rotateX(-Math.PI / 2).translate(...position);
}

function fin(points: readonly (readonly [number, number])[], thickness: number,
  x = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([z, y], i) => i === 0 ? shape.moveTo(-z, y) : shape.lineTo(-z, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
    .rotateY(Math.PI / 2).translate(x - thickness / 2, 0, 0);
}

function complete(group: THREE.Group, name: string, kind: string): THREE.Group {
  group.name = name;
  group.userData.kind = kind;
  group.userData.units = 'metres';
  group.userData.forward = '+Z';
  group.userData.up = '+Y';
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  group.userData.bounds = { min: bounds.min.toArray(), max: bounds.max.toArray() };
  let meshes = 0, triangles = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    }
  });
  group.userData.drawCalls = meshes;
  group.userData.triangles = triangles;
  return group;
}

/** Utility helicopter: ~13m airframe, 14m main rotor, four draws. */
export function makeHelicopter(): THREE.Group {
  const group = new THREE.Group();
  const body = new Batch(), glass = new Batch();
  const cabinProfiles: Profile[] = [
    { z: -2.8, rx: 0.37, ry: 0.46, y: 2.4 },
    { z: -1.5, rx: 1.08, ry: 1.0, y: 2.35 },
    { z: 0.4, rx: 1.30, ry: 1.18, y: 2.25 },
    { z: 2.3, rx: 1.27, ry: 1.13, y: 2.2 },
    { z: 3.9, rx: 0.92, ry: 0.86, y: 2.1 },
    { z: 4.65, rx: 0.28, ry: 0.33, y: 1.9 },
    { z: 4.8, rx: 0.035, ry: 0.07, y: 1.9 },
  ];
  body.add(fuselage(cabinProfiles), WHITE);
  body.add(fuselage([
    { z: -8.15, rx: 0.10, ry: 0.14, y: 2.45 },
    { z: -6.5, rx: 0.18, ry: 0.22, y: 2.58 },
    { z: -4.4, rx: 0.28, ry: 0.31, y: 2.6 },
    { z: -2.0, rx: 0.50, ry: 0.52, y: 2.45 },
  ], 14), RED);
  body.ellipsoid([0.78, 0.5, 1.65], [0, 3.27, -0.25], METAL);
  body.box([1.50, 0.14, 1.50], [0, 3.4, 0.65], DARK);
  for (const side of [-1, 1]) {
    // Continuous red belt, cabin door seams, flush side glazing and handles.
    body.box([0.06, 0.24, 4.1], [side * 1.26, 1.74, 0.7], RED);
    const sideAngles = side > 0 ? [-0.18, 0.68] : [Math.PI - 0.68, Math.PI + 0.18];
    glass.add(loftWindow(cabinProfiles, 0.0, 1.35, sideAngles[0], sideAngles[1]), GLASS);
    glass.add(loftWindow(cabinProfiles, 1.57, 2.86, sideAngles[0], sideAngles[1] + 0.08), GLASS);
    body.strut([side * 1.29, 1.28, 1.45], [side * 1.20, 2.9, 1.45], 0.028, DARK);
    body.strut([side * 1.19, 1.36, -0.12], [side * 1.17, 2.93, -0.12], 0.022, METAL);
    body.box([0.045, 0.035, 0.21], [side * 1.29, 1.91, 0.25], DARK);
    body.strut([side * 0.78, 1.43, -1.28], [side * 1.43, 0.25, -1.4], 0.07, METAL);
    body.strut([side * 0.88, 1.35, 2.05], [side * 1.43, 0.25, 2.22], 0.07, METAL);
    body.strut([side * 1.43, 0.105, -2.55], [side * 1.43, 0.105, 3.0], 0.095, DARK);
    body.strut([side * 1.43, 0.105, 3.0], [side * 1.43, 0.43, 3.64], 0.095, DARK);
    body.box([0.30, 0.06, 0.9], [side * 1.44, 0.92, 0.3], DARK);
    body.cylinder(0.14, 0.17, 0.5, [side * 0.47, 3.45, -1.68], DARK, 10, [Math.PI / 2, 0, 0]);
    body.ellipsoid([0.075, 0.075, 0.11], [side * 1.36, 2.15, 2.75], side < 0 ? 0xdf3d32 : 0x65b681, 8);
  }
  // Curved front windscreen halves, separated by an unpainted central mullion.
  for (const side of [-1, 1]) {
    const angles = side > 0 ? [0.08, 1.49] : [1.65, Math.PI - 0.08];
    glass.add(loftWindow(cabinProfiles, 2.99, 4.53, angles[0], angles[1]), 0x294e5c);
  }
  body.ellipsoid([0.13, 0.09, 0.08], [0, 1.42, 4.21], 0xffe2a4, 8);
  body.add(fin([[-8.18, 2.43], [-8.1, 4.45], [-7.47, 4.55], [-6.9, 2.52]], 0.12), RED);
  body.add(polygonDeck([[-1.55, -6.8], [1.55, -6.8], [1.32, -7.66], [-1.32, -7.66]], 0.095, 2.48), WHITE);
  body.strut([0, 3.35, 0.15], [0, 4.27, 0.15], 0.10, METAL);
  body.strut([0, 3.54, 1.53], [0, 4.13, 1.36], 0.025, DARK);
  group.add(body.finish('helicopter-airframe'), glass.finish('helicopter-glazing', true));

  const rotor = new THREE.Group(), blades = new Batch();
  rotor.name = 'main-rotor';
  rotor.position.set(0, 4.36, 0.15);
  blades.cylinder(0.31, 0.31, 0.20, [0, 0, 0], METAL, 14);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + 0.14;
    blades.add(polygonDeck([[-0.17, 0.5], [0.17, 0.5], [0.12, 7], [-0.12, 7]], 0.04, 0)
      .rotateY(angle), 0x33434a);
    blades.add(polygonDeck([[-0.125, 6.60], [0.125, 6.60], [0.12, 7], [-0.12, 7]], 0.044, 0.005)
      .rotateY(angle), 0xd3a44b);
  }
  rotor.add(blades.finish('main-rotor-blades'));
  group.add(rotor);
  const tailRotor = new THREE.Group(), tailBlades = new Batch();
  tailRotor.name = 'tail-rotor';
  tailRotor.position.set(0.27, 2.79, -7.88);
  tailBlades.cylinder(0.15, 0.15, 0.22, [0, 0, 0], METAL, 10, [0, 0, Math.PI / 2]);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    tailBlades.box([0.045, 0.95, 0.14], [0, Math.cos(angle) * 0.55, Math.sin(angle) * 0.55], DARK, [angle, 0, 0]);
  }
  tailRotor.add(tailBlades.finish('tail-rotor-blades'));
  group.add(tailRotor);
  group.userData.rotor = rotor;
  group.userData.tailRotor = tailRotor;
  group.userData.rotorAxis = 'y';
  group.userData.tailRotorAxis = 'x';
  group.userData.nominal = { airframeLength: 13, rotorDiameter: 14 };
  group.userData.origin = 'skid-ground-contact';
  return complete(group, 'Coastal utility helicopter', 'helicopter');
}

/** Original high-wing twin-float commuter plane: 15m long, 19m wingspan. */
export function makeSeaplane(): THREE.Group {
  const group = new THREE.Group(), body = new Batch(), glass = new Batch();
  const cabinProfiles: Profile[] = [
    { z: -7.1, rx: 0.13, ry: 0.17, y: 2.86 },
    { z: -5.0, rx: 0.42, ry: 0.52, y: 2.81 },
    { z: -2.2, rx: 0.82, ry: 0.89, y: 2.78 },
    { z: 1.4, rx: 0.98, ry: 1.04, y: 2.72 },
    { z: 3.8, rx: 0.95, ry: 1.01, y: 2.67 },
    { z: 5.05, rx: 0.78, ry: 0.80, y: 2.58 },
    { z: 6.5, rx: 0.67, ry: 0.68, y: 2.58 },
    { z: 6.9, rx: 0.60, ry: 0.60, y: 2.58 },
  ];
  body.add(fuselage(cabinProfiles), CREAM);
  body.cylinder(0.69, 0.69, 1.20, [0, 2.58, 6.10], RED, 18, [Math.PI / 2, 0, 0]);
  body.cylinder(0.60, 0.60, 0.12, [0, 2.58, 6.78], DARK, 18, [Math.PI / 2, 0, 0]);
  const wing = polygonDeck([
    [-9.5, 0.62], [-9.24, 1.58], [-2.0, 2.12], [2.0, 2.12], [9.24, 1.58],
    [9.5, 0.62], [9.36, -0.70], [2, -1.03], [-2, -1.03], [-9.36, -0.70],
  ], 0.17, 3.78, 0.035);
  const wingPositions = wing.getAttribute('position');
  for (let i = 0; i < wingPositions.count; i++) {
    wingPositions.setY(i, wingPositions.getY(i) + Math.abs(wingPositions.getX(i)) * 0.028);
  }
  wing.computeVertexNormals();
  body.add(wing, CREAM);
  for (const side of [-1, 1]) {
    body.box([0.62, 0.05, 2.14], [side * 8.32, 4.07, 0.32], RED);
    body.strut([side * 0.72, 2.12, 1.0], [side * 5.83, 3.98, 0.74], 0.062, METAL);
    body.strut([side * 0.75, 2.03, -0.35], [side * 5.83, 3.98, 0.21], 0.050, METAL);
    body.add(hull(8.5, 1.12, 0.50, 0.48, METAL, 0x48626d, 0.50)
      .translate(side * 2.12, 0, 0.70));
    body.box([0.80, 0.05, 5.3], [side * 2.12, 0.51, 0.48], DARK);
    for (const z of [-1.1, 2.5]) {
      body.strut([side * 0.70, 1.98, z], [side * 2.12, 0.57, z], 0.069, METAL);
      body.strut([side * 0.67, 2.03, z + 0.68], [side * 2.12, 0.57, z - 0.38], 0.05, METAL);
    }
    body.box([0.05, 0.22, 5.85], [side * 0.96, 2.44, 0.52], RED);
    for (const z of [-1.60, -0.37, 0.86, 2.09]) {
      glass.window(0.81, 0.62, [side * 0.972, 3.0, z], side * Math.PI / 2);
      body.strut([side * 0.986, 2.19, z - 0.52], [side * 0.986, 3.35, z - 0.52], 0.015, METAL);
    }
    glass.quad([
      [side * 0.96, 2.76, 2.79], [side * 0.81, 3.39, 2.73],
      [side * 0.66, 3.27, 4.29], [side * 0.89, 2.68, 4.31],
    ], GLASS);
    const angles = side > 0 ? [0.40, 1.49] : [1.65, Math.PI - 0.40];
    glass.add(loftWindow(cabinProfiles, 3.90, 5.03, angles[0], angles[1]), 0x2c505e);
    body.ellipsoid([0.06, 0.07, 0.09], [side * 9.43, 4.11, 0.9], side < 0 ? 0xe24a3c : 0x6ba980, 8);
  }
  body.add(polygonDeck([[-2.8, -5.0], [-0.85, -4.7], [0.85, -4.7], [2.8, -5.0],
    [2.70, -6.55], [-2.70, -6.55]], 0.12, 2.91), CREAM);
  body.add(fin([[-7.15, 2.8], [-6.93, 5.52], [-5.96, 5.88], [-4.6, 2.95]], 0.16), RED);
  body.add(fin([[-6.98, 3.42], [-6.87, 5.4], [-6.58, 5.52], [-6.22, 3.43]], 0.17), CREAM);
  body.box([0.055, 0.11, 0.88], [0.94, 2.48, 2.63], METAL);
  body.strut([0, 3.73, -0.2], [0, 4.57, -0.6], 0.020, DARK);
  body.cylinder(0.12, 0.12, 0.58, [0.50, 2.04, 5.52], DARK, 8, [0.23, 0, -0.2]);
  group.add(body.finish('seaplane-airframe-and-floats'), glass.finish('seaplane-glazing', true));
  const propeller = new THREE.Group(), blades = new Batch();
  propeller.name = 'propeller';
  propeller.position.set(0, 2.58, 7.08);
  blades.cylinder(0.025, 0.24, 0.53, [0, 0, 0.16], METAL, 14, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    blades.box([0.22, 1.55, 0.07], [-Math.sin(angle) * 1.0, Math.cos(angle) * 1.0, 0], DARK, [0, 0, angle]);
    blades.box([0.225, 0.20, 0.074], [-Math.sin(angle) * 1.68, Math.cos(angle) * 1.68, 0], 0xe0ac43, [0, 0, angle]);
  }
  propeller.add(blades.finish('seaplane-propeller'));
  group.add(propeller);
  group.userData.propeller = propeller;
  group.userData.propellerAxis = 'z';
  group.userData.nominal = { length: 15, wingspan: 19 };
  group.userData.waterline = 0;
  group.userData.origin = 'float-waterline';
  return complete(group, 'Coastal twin-float commuter plane', 'seaplane');
}

/** Pointed 250m cruise ship, 32m hull beam, ~50m above waterline; two draws. */
export function makeCruiseShip(): THREE.Group {
  const group = new THREE.Group(), body = new Batch(), glass = new Batch();
  body.add(hull(250, 32, 10, 7, WHITE, 0x805348, 0.20));
  body.add(roundedDeck(24, 185, 0.20, 7, [0, 10.12, -8]), TEAK);
  // Stepped accommodation with curved ends, balcony decks and modular glazing.
  for (let deck = 0; deck < 7; deck++) {
    const width = 26 - Math.max(0, deck - 3) * 1.65;
    const length = 189 - Math.max(0, deck - 2) * 11;
    const z = -10 - Math.max(0, deck - 3) * 2;
    const y = 10.35 + deck * 3.55;
    body.add(roundedDeck(width, length, 3.13, 5.3, [0, y, z]), deck % 2 ? CREAM : WHITE);
    body.add(roundedDeck(width + 1.5, length + 0.8, 0.23, 5.7, [0, y + 3.13, z]), WHITE);
    for (const side of [-1, 1]) {
      const x = side * (width / 2 + 0.015);
      const start = z - length / 2 + 7, end = z + length / 2 - 7;
      for (let windowZ = start; windowZ <= end; windowZ += 3.45) {
        glass.window(2.22, 1.24, [x, y + 1.72, windowZ], side * Math.PI / 2,
          (Math.floor(windowZ / 3.45) + deck) % 9 === 0 ? 0x6c7361 : GLASS);
      }
      if (deck > 0) {
        body.box([0.76, 0.16, length - 12], [side * (width / 2 + 0.36), y + 0.07, z], WHITE);
        body.box([0.065, 0.06, length - 12], [side * (width / 2 + 0.70), y + 1.0, z], METAL);
        body.box([0.045, 0.045, length - 12], [side * (width / 2 + 0.70), y + 0.53, z], WHITE);
        for (let railZ = start; railZ < end; railZ += 7.0) {
          body.box([0.06, 1.02, 0.06], [side * (width / 2 + 0.70), y + 0.50, railZ], WHITE);
          body.box([0.63, 0.76, 0.05], [side * (width / 2 + 0.31), y + 0.43, railZ], CREAM);
        }
      }
    }
  }
  // Lower portholes give the long tapered hull a readable scale.
  for (const side of [-1, 1]) {
    for (let z = -102; z <= 48; z += 6.5) {
      body.cylinder(0.33, 0.33, 0.06, [side * 15.56, 6.3, z], DARK, 10, [0, 0, Math.PI / 2]);
    }
    // Six enclosed orange lifeboats on each flank, with roofs and davits.
    for (let i = 0; i < 6; i++) {
      const z = -70 + i * 23;
      body.add(hull(9.0, 2.95, 1.0, 0.52, ORANGE, 0x9e4d28, 0.12)
        .translate(side * 14.40, 12.5, z));
      body.ellipsoid([1.16, 0.66, 3.28], [side * 14.40, 13.48, z - 0.2], CREAM, 12);
      glass.window(4.0, 0.39, [side * 15.57, 13.62, z], side * Math.PI / 2, 0x4e6265);
      for (const dz of [-2.3, 2.3]) {
        body.strut([side * 13.0, 15.9, z + dz], [side * 15.2, 15.1, z + dz], 0.10, WHITE);
        body.strut([side * 15.2, 15.1, z + dz], [side * 15.2, 13.6, z + dz], 0.035, DARK);
      }
    }
    // Promenade railing and mooring equipment on the open foredeck.
    body.strut([side * 13.4, 11.45, 75], [side * 6.0, 12.42, 108], 0.10, METAL);
    body.strut([side * 6.0, 12.42, 108], [0, 13.0, 123], 0.10, METAL);
    for (let i = 0; i < 5; i++) {
      const z = 79 + i * 6.2;
      const x = side * (12.8 - i * 1.4);
      body.strut([x, 10.7 + i * 0.21, z], [x, 11.56 + i * 0.21, z], 0.075, WHITE);
    }
    body.cylinder(0.52, 0.60, 0.75, [side * 4.0, 11.2, 107], DARK, 10);
    body.cylinder(0.45, 0.55, 0.68, [side * 5.5, 11.1, 96], METAL, 10);
    body.strut([side * 4.0, 11.2, 107], [side * 2.0, 11.9, 118], 0.07, DARK);
  }
  // Curved navigation bridge overhang and its continuous front glazing.
  body.add(roundedDeck(28.8, 10, 3.05, 2.7, [0, 28.10, 64]), WHITE);
  body.add(roundedDeck(29.6, 10.6, 0.32, 2.8, [0, 31.16, 64]), CREAM);
  glass.window(24.6, 1.45, [0, 29.75, 69.025]);
  for (let x = -10.5; x <= 10.5; x += 3.5) body.box([0.14, 1.57, 0.10], [x, 29.75, 69.08], WHITE);
  for (const side of [-1, 1]) glass.window(5.0, 1.45, [side * 14.41, 29.75, 64], side * Math.PI / 2);
  // Open upper decks, swimming pool, sun loungers, and elliptical funnel.
  body.add(roundedDeck(17, 82, 0.23, 4.5, [0, 35.05, -17]), TEAK);
  body.add(roundedDeck(10.6, 18.8, 0.35, 3.4, [0, 35.33, 3]), CREAM);
  glass.add(roundedDeck(8.2, 15.7, 0.08, 2.7, [0, 35.69, 3]), 0x4197a8);
  for (const side of [-1, 1]) {
    for (let z = -3; z < 14; z += 3.0) {
      body.box([0.77, 0.14, 1.75], [side * 6.5, 35.59, z], CREAM);
      body.box([0.77, 0.67, 0.12], [side * 6.5, 35.9, z - 0.73], 0x5b7f86, [-0.32, 0, 0]);
    }
  }
  body.add(new THREE.CylinderGeometry(4.7, 5.5, 9.1, 18).scale(0.60, 1, 1.22)
    .translate(0, 40.38, -34), NAVY);
  body.add(new THREE.CylinderGeometry(4.86, 4.82, 1.25, 18).scale(0.60, 1, 1.22)
    .translate(0, 45.05, -34), DARK);
  for (const side of [-1, 1]) {
    body.box([0.1, 0.50, 7.2], [side * 3.0, 41.8, -34], 0xc6a55c, [0, 0, side * 0.16]);
    body.ellipsoid([1.25, 1.25, 1.25], [side * 6.4, 36.5, -48], WHITE, 14);
  }
  body.strut([0, 35.7, 25], [0, 49.5, 25], 0.17, WHITE, 8);
  body.box([8.0, 0.20, 0.36], [0, 43.8, 25], WHITE);
  body.box([4.7, 0.22, 0.57], [0, 46.7, 25], METAL);
  body.ellipsoid([0.18, 0.24, 0.18], [0, 49.72, 25], 0xf0e6c2, 8);
  body.strut([-3.8, 35.8, 21], [0, 43.5, 25], 0.025, METAL);
  body.strut([3.8, 35.8, 21], [0, 43.5, 25], 0.025, METAL);
  // Stern terraces and teak swimming platform.
  for (let level = 0; level < 3; level++) {
    body.add(roundedDeck(21 - level * 2.7, 15, 0.35, 2.3,
      [0, 12.1 + level * 3.55, -105 + level * 3]), TEAK);
  }
  body.add(roundedDeck(18, 4, 0.55, 1.5, [0, 1.3, -122.8]), CREAM);
  group.add(body.finish('cruise-ship-hull-decks-and-fittings'), glass.finish('cruise-ship-glazing', true));
  group.userData.waterline = 0;
  group.userData.nominal = { length: 250, hullBeam: 32, heightAboveWater: 50 };
  group.userData.funnelTop = new THREE.Vector3(0, 45.75, -34);
  return complete(group, 'Pacific harbour cruise ship', 'cruise-ship');
}

/** Player-sized open launch with cockpit, windshield, skipper and outboard. */
export function makeMotorboat(): THREE.Group {
  const group = new THREE.Group(), body = new Batch(), glass = new Batch();
  body.add(hull(6.6, 2.4, 0.66, 0.45, WHITE, NAVY, 0.34));
  body.add(roundedDeck(1.93, 4.45, 0.07, 0.4, [0, 0.68, -0.5]), TEAK);
  body.add(roundedDeck(1.40, 1.17, 0.13, 0.3, [0, 0.85, 1.73]), CREAM);
  for (const side of [-1, 1]) {
    body.box([0.18, 0.16, 3.70], [side * 1.06, 0.78, -0.2], CREAM);
    body.strut([side * 1.02, 1.0, 0.75], [side * 0.64, 1.10, 2.36], 0.024, METAL);
    body.strut([side * 0.64, 1.10, 2.36], [0, 1.16, 3.02], 0.024, METAL);
    body.strut([side * 0.98, 0.75, 1.0], [side * 0.98, 1.02, 1.0], 0.021, METAL);
    body.strut([side * 0.63, 0.82, 2.36], [side * 0.63, 1.10, 2.36], 0.021, METAL);
    body.ellipsoid([0.045, 0.042, 0.08], [side * 0.9, 0.88, 1.47], side < 0 ? 0xe44d3f : 0x68b18c, 8);
    body.add(roundedDeck(0.54, 0.65, 0.16, 0.12, [side * 0.52, 0.95, -0.87]), CREAM);
    body.box([0.55, 0.46, 0.14], [side * 0.52, 1.23, -1.13], CREAM, [-0.08, 0, 0]);
  }
  body.box([1.90, 0.35, 0.47], [0, 0.96, -2.33], WHITE);
  body.add(roundedDeck(1.84, 0.51, 0.13, 0.13, [0, 1.15, -2.32]), 0xd8ddcd);
  body.box([0.79, 0.47, 0.40], [0.43, 1.02, 0.22], WHITE);
  glass.quad([[-0.99, 0.99, 0.66], [0.99, 0.99, 0.66], [0.86, 1.64, 0.14], [-0.86, 1.64, 0.14]], 0x4b7987);
  body.strut([-0.99, 0.99, 0.66], [-0.86, 1.64, 0.14], 0.023, METAL);
  body.strut([0.99, 0.99, 0.66], [0.86, 1.64, 0.14], 0.023, METAL);
  body.strut([-0.86, 1.64, 0.14], [0.86, 1.64, 0.14], 0.023, METAL);
  body.cylinder(0.22, 0.22, 0.045, [0.43, 1.23, -0.07], DARK, 12, [Math.PI / 3, 0, 0]);
  // Low-poly seated skipper; baked into the single opaque geometry.
  body.ellipsoid([0.22, 0.34, 0.19], [0.52, 1.40, -0.80], 0x466d7a, 10);
  body.ellipsoid([0.15, 0.18, 0.15], [0.52, 1.87, -0.77], 0xc39370, 10);
  body.ellipsoid([0.17, 0.065, 0.18], [0.52, 2.01, -0.75], DARK, 10);
  for (const side of [-1, 1]) {
    body.strut([0.52 + side * 0.17, 1.52, -0.75], [0.43 + side * 0.13, 1.25, -0.12], 0.060, 0x466d7a);
    body.strut([0.52 + side * 0.11, 1.12, -0.81], [0.52 + side * 0.12, 0.81, -0.26], 0.070, DARK);
  }
  // Sculpted outboard cowling, lower leg and small underwater propeller.
  body.ellipsoid([0.36, 0.50, 0.38], [0, 0.51, -3.30], DARK, 12);
  body.box([0.27, 0.98, 0.30], [0, -0.03, -3.45], METAL, [-0.12, 0, 0]);
  body.add(fin([[-3.30, -0.40], [-3.60, -0.40], [-3.57, -0.86]], 0.085), METAL);
  group.add(body.finish('motorboat-hull-and-cockpit'), glass.finish('motorboat-windshield', true));
  const propeller = new THREE.Group(), prop = new Batch();
  propeller.name = 'outboard-propeller';
  propeller.position.set(0, -0.52, -3.67);
  prop.ellipsoid([0.085, 0.085, 0.14], [0, 0, 0], METAL, 8);
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    prop.box([0.13, 0.30, 0.035], [-Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0], METAL, [0, 0, a]);
  }
  propeller.add(prop.finish('outboard-propeller-blades'));
  group.add(propeller);
  group.userData.propeller = propeller;
  group.userData.propellerAxis = 'z';
  group.userData.waterline = 0;
  group.userData.nominal = { length: 7, hullBeam: 2.4 };
  group.userData.driverSeat = new THREE.Vector3(0.52, 1.10, -0.80);
  return complete(group, 'Harbour motorboat', 'motorboat');
}

/** Deterministic original marina fleet; 8–16m motor and sailing yachts. */
export function makeMooredYacht(index = 0): THREE.Group {
  const n = Number.isFinite(index) ? Math.abs(Math.trunc(index)) % 45 : 0;
  const length = 8 + ((n * 5 + 4) % 9);
  const sailing = n % 3 !== 0;
  const beam = sailing ? 2.55 + (length - 8) * 0.145 : 2.80 + (length - 8) * 0.185;
  const freeboard = 0.67 + length * 0.017;
  const palettes = [WHITE, 0xe0e5df, 0x345363, 0xf1e8d6, 0xa5b6b8];
  const group = new THREE.Group(), body = new Batch(), glass = new Batch();
  body.add(hull(length, beam, freeboard, sailing ? 0.95 : 0.63, palettes[n % palettes.length], 0x385561, 0.18));
  body.add(roundedDeck(beam * 0.76, length * 0.77, 0.045, beam * 0.22,
    [0, freeboard + 0.045, -length * 0.055]), TEAK);
  const deckY = freeboard + 0.11;
  // Foredeck hatch, cleats, anchor, and perimeter railings.
  glass.add(roundedDeck(beam * 0.28, length * 0.11, 0.035, 0.12,
    [0, deckY + 0.025, length * 0.31]), GLASS);
  body.strut([0, deckY + 0.04, length * 0.43], [0, deckY + 0.07, length * 0.495], 0.025, METAL);
  for (const side of [-1, 1]) {
    const railX = side * beam * 0.45;
    body.strut([railX, deckY + 0.65, -length * 0.40], [railX, deckY + 0.65, length * 0.20], 0.017, METAL);
    body.strut([railX, deckY + 0.65, length * 0.20], [side * beam * 0.23, deckY + 0.74, length * 0.40], 0.017, METAL);
    body.strut([side * beam * 0.23, deckY + 0.74, length * 0.40], [0, deckY + 0.78, length * 0.49], 0.017, METAL);
    for (let i = 0; i < 5; i++) {
      const z = -length * 0.38 + i * length * 0.13;
      body.strut([railX, deckY - 0.035, z], [railX, deckY + 0.65, z], 0.016, METAL);
    }
    for (const z of [-length * 0.34, 0, length * 0.14]) {
      body.cylinder(0.10, 0.12, 0.53, [side * beam * 0.52, 0.62, z], n % 2 ? WHITE : NAVY, 8);
      body.strut([side * beam * 0.49, deckY + 0.46, z], [side * beam * 0.52, 0.83, z], 0.009, CREAM, 4);
    }
    for (const z of [-length * 0.40, length * 0.29]) {
      body.box([0.11, 0.065, 0.24], [side * beam * 0.37, deckY + 0.09, z], METAL);
    }
  }
  if (sailing) {
    body.add(roundedDeck(beam * 0.58, length * 0.44, 0.42, 0.6,
      [0, deckY, length * 0.015]), CREAM);
    body.add(roundedDeck(beam * 0.60, length * 0.42, 0.07, 0.60,
      [0, deckY + 0.42, length * 0.015]), WHITE);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) glass.window(length * 0.068, 0.22,
        [side * beam * 0.294, deckY + 0.26, length * (-0.12 + i * 0.12)], side * Math.PI / 2);
    }
    const mastZ = length * 0.018, mastTop = deckY + length * 1.26;
    body.strut([0, deckY + 0.40, mastZ], [0, mastTop, mastZ], 0.050, METAL, 8);
    body.strut([0, deckY + 1.86, mastZ], [0, deckY + 1.68, -length * 0.36], 0.06, METAL, 8);
    // Furled mainsail, spreaders and stays: moored boats carry no raised sails.
    body.strut([0, deckY + 1.93, mastZ], [0, deckY + 1.77, -length * 0.33], 0.12, n % 2 ? NAVY : CREAM, 8);
    body.strut([0, mastTop - 0.05, mastZ], [0, deckY + 0.09, length * 0.455], 0.010, DARK, 4);
    body.strut([0, mastTop - 0.05, mastZ], [0, deckY + 0.22, -length * 0.43], 0.010, DARK, 4);
    for (const side of [-1, 1]) {
      body.strut([0, deckY + length * 0.68, mastZ], [side * beam * 0.40, deckY + length * 0.68, mastZ], 0.022, METAL);
      body.strut([0, mastTop - 0.08, mastZ], [side * beam * 0.43, deckY, mastZ], 0.010, DARK, 4);
    }
    body.add(roundedDeck(beam * 0.62, length * 0.19, 0.06, 0.2,
      [0, deckY + 0.015, -length * 0.34]), DARK);
    body.cylinder(0.23, 0.23, 0.035, [0, deckY + 0.65, -length * 0.34], METAL, 12, [Math.PI / 2, 0, 0]);
  } else {
    body.add(fuselage([
      { z: -length * 0.26, rx: beam * 0.24, ry: 0.40, y: deckY + 0.49 },
      { z: -length * 0.15, rx: beam * 0.34, ry: 0.73, y: deckY + 0.57 },
      { z: length * 0.05, rx: beam * 0.32, ry: 0.80, y: deckY + 0.53 },
      { z: length * 0.18, rx: beam * 0.21, ry: 0.25, y: deckY + 0.34 },
      { z: length * 0.23, rx: 0.18, ry: 0.08, y: deckY + 0.23 },
    ], 16), WHITE);
    for (const side of [-1, 1]) {
      glass.quad([
        [side * beam * 0.338, deckY + 0.40, -length * 0.16],
        [side * beam * 0.275, deckY + 1.02, -length * 0.13],
        [side * beam * 0.249, deckY + 0.99, length * 0.045],
        [side * beam * 0.319, deckY + 0.40, length * 0.078],
      ], GLASS);
      glass.quad([
        [side * 0.03, deckY + 0.34, length * 0.182],
        [side * beam * 0.24, deckY + 0.35, length * 0.136],
        [side * beam * 0.231, deckY + 1.03, length * 0.015],
        [side * 0.03, deckY + 1.27, length * 0.012],
      ], GLASS);
    }
    body.add(roundedDeck(beam * 0.65, length * 0.25, 0.10, 0.42,
      [0, deckY + 1.22, -length * 0.065]), CREAM);
    body.strut([-beam * 0.22, deckY + 1.18, -length * 0.105],
      [-beam * 0.22, deckY + 2.34, -length * 0.125], 0.06, WHITE);
    body.strut([beam * 0.22, deckY + 1.18, -length * 0.105],
      [beam * 0.22, deckY + 2.34, -length * 0.125], 0.06, WHITE);
    body.box([beam * 0.49, 0.12, 0.18], [0, deckY + 2.34, -length * 0.125], WHITE);
    body.ellipsoid([0.28, 0.18, 0.28], [0, deckY + 2.57, -length * 0.125], CREAM, 10);
    body.add(roundedDeck(beam * 0.63, length * 0.12, 0.19, 0.20,
      [0, deckY + 0.10, -length * 0.34]), CREAM);
    body.add(roundedDeck(beam * 0.58, length * 0.13, 0.12, 0.20,
      [0, 0.29, -length * 0.475]), TEAK);
  }
  group.add(body.finish('yacht-hull-deck-and-rigging'), glass.finish('yacht-glazing', true));
  group.userData.waterline = 0;
  group.userData.nominal = { length, hullBeam: beam };
  group.userData.variant = n;
  return complete(group, `Moored ${sailing ? 'sailing' : 'motor'} yacht ${n}`,
    sailing ? 'sailing-yacht' : 'motor-yacht');
}

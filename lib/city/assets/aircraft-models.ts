/**
 * Original procedural flight assets, authored for Vancouver Living Atlas.
 * No external artwork, downloaded meshes, or shared runtime assets.
 * Metres; local forward = -Z, up = +Y. Landing surfaces rest at Y=0.
 * `cockpit` is a separate camera child: camera at its origin, looking down -Z.
 * Every geometry/material/texture is owned by the returned asset.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type AircraftKind = 'helicopter' | 'seaplane';
type V3 = readonly [number, number, number];
type Station = readonly [z: number, radiusX: number, radiusY: number, centreY: number];
export interface AircraftInstruments {
  airspeedNeedle: THREE.Object3D;
  altimeterNeedle: THREE.Object3D;
  verticalSpeedNeedle: THREE.Object3D;
  headingCard: THREE.Object3D;
  attitudeRoll: THREE.Object3D;
  attitudePitch: THREE.Object3D;
  powerNeedle: THREE.Object3D;
}
export interface AircraftAsset {
  group: THREE.Group;
  /** Rotate around each object's userData.spinAxis; all groups are at their hubs. */
  propellers: THREE.Object3D[];
  /** Main rotor translucent disc, initially hidden. Visible once rotor speed is high. */
  rotorBlur?: THREE.Object3D;
  cockpit: THREE.Group;
  /** Rotation around x/z animates the cyclic or yoke. */
  stick: THREE.Object3D;
  instruments: AircraftInstruments;
  /** Frees owned GPU resources, including the detached cockpit. */
  dispose: () => void;
}
export interface AircraftInstrumentState {
  airspeedKnots: number;
  altitudeMetres: number;
  verticalSpeedMetresPerSecond: number;
  /** Radians, positive pitch = nose up, positive roll = bank right. */
  pitch: number;
  roll: number;
  heading: number;
  /** 0...1 */
  power: number;
}

const C = {
  cream: 0xf3ede0, white: 0xf7f5ed, teal: 0x146877, tealLight: 0x37a3a4,
  orange: 0xe8752f, orangeLight: 0xffad52, glass: 0x254954, glassGlint: 0x769a9f,
  metal: 0xa8b5b9, dark: 0x27383c, black: 0x101b20, rubber: 0x202a2d,
  red: 0xf13b37, green: 0x38cf94, gold: 0xe5c188, seat: 0x6f7f79,
};

/** A small builder that converts coloured primitives into a single static mesh. */
class SolidBatch {
  private parts: THREE.BufferGeometry[] = [];
  add(source: THREE.BufferGeometry, colour: number): void {
    const g = source.index ? source.toNonIndexed() : source;
    if (source !== g) source.dispose();
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const col = new THREE.Color(colour), count = g.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    this.parts.push(g);
  }
  box(size: V3, pos: V3, colour: number, rotation: V3 = [0, 0, 0]): void {
    this.add(new THREE.BoxGeometry(...size)
      .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)))
      .translate(...pos), colour);
  }
  ball(size: V3, pos: V3, colour: number, segments = 20): void {
    this.add(new THREE.SphereGeometry(1, segments, 12).scale(...size).translate(...pos), colour);
  }
  tube(a: V3, b: V3, radius: number, colour: number, sides = 8): void {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), direction = vb.clone().sub(va);
    this.add(new THREE.CylinderGeometry(radius, radius, direction.length(), sides)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()))
      .translate(...va.add(vb).multiplyScalar(0.5).toArray()), colour);
  }
  cylinder(radiusTop: number, radiusBottom: number, length: number, pos: V3, colour: number,
    rotation: V3 = [0, 0, 0], sides = 18): void {
    this.add(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, sides)
      .applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)))
      .translate(...pos), colour);
  }
  quad(points: readonly V3[], colour: number): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      ...points[0], ...points[1], ...points[2], ...points[0], ...points[2], ...points[3],
    ], 3));
    g.computeVertexNormals();
    this.add(g, colour);
  }
  finish(name: string, kind: 'paint' | 'glass' | 'light' = 'paint'): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    if (!merged) throw new Error(`Empty aircraft batch: ${name}`);
    const material = kind === 'light'
      ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'glass' ? 0.14 : 0.48,
        metalness: kind === 'glass' ? 0.42 : 0.16, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    // Intentionally no point lights or shadow work: these assets also run on mobile.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

function loft(stations: readonly Station[], radial = 28): THREE.BufferGeometry {
  const p: number[] = [], indices: number[] = [];
  for (const [z, rx, ry, cy] of stations) for (let i = 0; i < radial; i++) {
    const a = i / radial * Math.PI * 2;
    p.push(Math.cos(a) * rx, cy + Math.sin(a) * ry, z);
  }
  for (let row = 0; row < stations.length - 1; row++) for (let i = 0; i < radial; i++) {
    const a = row * radial + i, b = row * radial + (i + 1) % radial;
    const c = b + radial, d = a + radial;
    indices.push(a, b, c, a, c, d);
  }
  for (let i = 1; i < radial - 1; i++) {
    indices.push(0, i + 1, i);
    const last = (stations.length - 1) * radial;
    indices.push(last, last + i, last + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function stationAt(stations: readonly Station[], z: number): Station {
  let i = 0;
  while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
  const a = stations[i], b = stations[i + 1], t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [z, THREE.MathUtils.lerp(a[1], b[1], t), THREE.MathUtils.lerp(a[2], b[2], t), THREE.MathUtils.lerp(a[3], b[3], t)];
}

/** Curved inset follows the aircraft's original section profile. */
function shellPatch(stations: readonly Station[], z0: number, z1: number, a0: number, a1: number, offset = 0.012): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], rows = 8, columns = 8;
  for (let r = 0; r <= rows; r++) {
    const [z, rx, ry, cy] = stationAt(stations, THREE.MathUtils.lerp(z0, z1, r / rows));
    for (let c = 0; c <= columns; c++) {
      const a = THREE.MathUtils.lerp(a0, a1, c / columns);
      positions.push(Math.cos(a) * (rx + offset), cy + Math.sin(a) * (ry + offset), z);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const a = r * (columns + 1) + c, b = a + 1, d = a + columns + 1;
    indices.push(a, b, d + 1, a, d + 1, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

/** Extruded flat polygon: XY contour, centred in its Z thickness. */
function plate(points: readonly (readonly [number, number])[], thickness: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }).translate(0, 0, -thickness / 2);
}

function textTexture(text: string, foreground: string, background?: string, width = 1024, height = 160): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) return undefined;
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  ctx.fillStyle = foreground; ctx.font = `600 ${Math.round(height * 0.63)}px Arial, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height / 2);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function addDecal(parent: THREE.Object3D, text: string, position: V3, size: readonly [number, number], rotationY: number, foreground: string): void {
  const texture = textTexture(text, foreground); if (!texture) return;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    toneMapped: false,
  }));
  mesh.position.set(...position); mesh.rotation.y = rotationY; mesh.name = text;
  parent.add(mesh);
}

/** Airfoil cross sections laid across the span. Each wing is a single geometry. */
function wing(side: number): THREE.BufferGeometry {
  const sections = [
    [0.72, 2.72, -0.67, 3.06], [2.6, 2.55, -0.58, 3.08], [5.8, 2.1, -0.36, 3.18], [7.5, 1.22, -0.06, 3.28],
  ];
  const ring = [[-.5, 0], [-.42, .072], [-.12, .105], [.25, .07], [.5, 0], [.23, -.022], [-.16, -.028], [-.43, -.022]];
  const positions: number[] = [], indices: number[] = [];
  for (const [span, chord, zc, y] of sections) for (const [z, h] of ring) positions.push(span * side, y + h * chord, zc + z * chord);
  for (let s = 0; s < sections.length - 1; s++) for (let r = 0; r < ring.length; r++) {
    const a = s * ring.length + r, b = s * ring.length + (r + 1) % ring.length;
    indices.push(a, b, b + ring.length, a, b + ring.length, a + ring.length);
  }
  const end = (sections.length - 1) * ring.length;
  for (let i = 1; i < ring.length - 1; i++) indices.push(end, end + i, end + i + 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals(); return g;
}

function buildSeaplane(): { group: THREE.Group; propellers: THREE.Object3D[] } {
  const group = new THREE.Group(); group.name = 'Pacific floatplane';
  const paint = new SolidBatch(), glass = new SolidBatch(), lights = new SolidBatch();
  const body: Station[] = [
    [-4.3, .22, .28, 2.17], [-4.05, .62, .6, 2.16], [-3.35, .71, .73, 2.17],
    [-2.48, .84, .96, 2.2], [-1.55, .91, 1.02, 2.2], [.65, .87, .9, 2.25],
    [1.65, .68, .71, 2.33], [3.05, .38, .43, 2.53], [4.52, .11, .22, 2.71], [4.7, .025, .075, 2.72],
  ];
  paint.add(loft(body), C.cream);
  paint.add(shellPatch(body, -3.9, 4.4, Math.PI, Math.PI * 2), C.teal);
  for (const side of [-1, 1]) {
    const angles = side === 1 ? [.06, .74] : [Math.PI - .74, Math.PI - .06];
    for (const [z0, z1] of [[-2.61, -1.71], [-1.5, -.57], [-.39, .53], [.72, 1.39]]) {
      glass.add(shellPatch(body, z0, z1, angles[0], angles[1], .026), C.glass);
      paint.add(shellPatch(body, z0, z0 + .027, angles[0] - .025, angles[1] + .035, .035), C.metal);
    }
    // Split windscreens, curved around the high nose.
    glass.add(shellPatch(body, -3.17, -2.69, side === 1 ? .37 : 1.67, side === 1 ? 1.47 : 2.77, .026), C.glass);
    paint.add(shellPatch(body, -3.89, 2.3, side === 1 ? -.014 : Math.PI - .038, side === 1 ? .038 : Math.PI + .014, .036), C.gold);
    // Door seam, latch and a small step below the pilot's door.
    paint.tube([side * .88, 1.66, -1.59], [side * .9, 2.47, -1.59], .013, C.dark);
    paint.tube([side * .82, 1.67, -2.64], [side * .88, 1.66, -1.59], .013, C.dark);
    paint.box([.047, .038, .19], [side * .911, 2.31, -1.76], C.metal);
    paint.box([.37, .06, .49], [side * 1.05, 1.24, -2.04], C.dark);
    paint.tube([side * .8, 1.67, -1.96], [side * 1.14, 1.25, -1.96], .035, C.metal);
    // Two long stepped floats. Bottom is exactly Y=0.
    const float: Station[] = [[-4.09, .015, .02, .4], [-3.72, .29, .22, .33], [-2.92, .43, .3, .3],
      [-.55, .43, .3, .3], [-.35, .4, .19, .4], [1.8, .32, .2, .39], [2.52, .11, .16, .41], [2.66, .01, .05, .43]];
    paint.add(loft(float, 16).translate(side * 1.48, 0, 0), C.metal);
    paint.box([.72, .035, 3.43], [side * 1.48, .613, -1.18], C.cream);
    for (const z of [-2.34, -.73, 1.08]) {
      paint.box([.41, .018, .47], [side * 1.48, .643, z], C.dark);
      paint.box([.29, .022, .33], [side * 1.48, .656, z], C.metal);
    }
    paint.tube([side * 1.48, .63, -2.02], [side * .58, 1.63, -1.87], .059, C.metal);
    paint.tube([side * 1.48, .6, 1.02], [side * .65, 1.66, .62], .059, C.metal);
    paint.tube([side * 1.48, .62, 1.02], [side * .6, 1.59, -1.81], .025, C.dark);
    // High wing, lift struts, separate flap/aileron lines, tip paint and lights.
    paint.add(wing(side), C.cream);
    paint.tube([side * .75, 1.73, -.2], [side * 4.4, 3.11, -.82], .062, C.metal);
    paint.tube([side * .75, 1.73, -.2], [side * 4.4, 3.11, .18], .041, C.metal);
    paint.tube([side * 1.82, 3.062, .58], [side * 6.9, 3.248, .57], .013, C.dark);
    paint.box([.23, .04, 1.25], [side * 7.22, 3.35, -.08], C.teal, [0, 0, side * .05]);
    lights.ball([.105, .065, .15], [side * 7.49, 3.33, -.36], side === -1 ? C.red : C.green, 12);
    // Tailplane horizontal stabiliser.
    const tail = plate([[0, -1.2], [2.44, -.61], [2.63, .1], [2.16, .48], [0, .35]], .105)
      .rotateX(-Math.PI / 2).translate(0, 2.75, 3.53);
    if (side === -1) tail.scale(-1, 1, 1);
    paint.add(tail, C.cream);
    paint.tube([side * .26, 2.48, 3.24], [side * 1.72, 2.69, 3.64], .024, C.metal);
    addDecal(group, 'PACIFIC AIR', [side * .888, 2.095, -.23], [1.53, .22], side * Math.PI / 2, '#f3ede0');
  }
  paint.tube([-1.48, .7, -1.94], [1.48, .7, -1.94], .053, C.metal);
  paint.tube([-1.48, .68, 1.02], [1.48, .68, 1.02], .053, C.metal);
  // A tall swept vertical fin in the aircraft's Y/Z plane.
  paint.add(plate([[2.4, 2.67], [3.05, 4.39], [3.56, 4.59], [4.6, 3.01], [4.63, 2.67]], .13)
    .rotateY(-Math.PI / 2), C.teal);
  paint.add(plate([[3.48, 4.36], [3.65, 4.28], [4.42, 3.16], [4.13, 3.2]], .15)
    .rotateY(-Math.PI / 2), C.cream);
  paint.tube([0, 3.15, .94], [0, 3.72, 1.33], .017, C.dark);
  paint.tube([-.34, 1.79, -3.72], [-.65, 1.51, -3.5], .072, C.dark);
  paint.cylinder(.37, .39, .2, [0, 2.16, -4.23], C.dark, [Math.PI / 2, 0, 0]);
  paint.ball([.3, .3, .46], [0, 2.16, -4.45], C.cream);
  lights.ball([.075, .075, .07], [0, 4.55, 3.54], C.white, 10);
  const prop = new THREE.Group(); prop.name = 'Seaplane propeller'; prop.position.set(0, 2.16, -4.45);
  prop.userData.spinAxis = 'z'; prop.userData.spinRate = 94;
  const propBatch = new SolidBatch();
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    propBatch.add(plate([[-.075, .15], [-.155, .67], [-.11, 1.32], [.05, 1.42], [.14, 1.27], [.08, .5]], .044)
      .rotateZ(a), C.dark);
    propBatch.box([.18, .13, .052], [-Math.sin(a) * 1.27, Math.cos(a) * 1.27, 0], C.gold, [0, 0, a]);
  }
  propBatch.ball([.14, .14, .18], [0, 0, -.11], C.metal);
  prop.add(propBatch.finish('Three-blade propeller'));
  group.add(paint.finish('Floatplane painted structure'), glass.finish('Floatplane curved glazing', 'glass'), lights.finish('Floatplane navigation lights', 'light'), prop);
  group.userData.dimensions = { length: 9.8, span: 15.2, height: 4.65 };
  return { group, propellers: [prop] };
}

function buildHelicopter(): { group: THREE.Group; propellers: THREE.Object3D[]; rotorBlur: THREE.Object3D } {
  const group = new THREE.Group(); group.name = 'Coastal helicopter';
  const paint = new SolidBatch(), glass = new SolidBatch(), lights = new SolidBatch();
  const body: Station[] = [[-3.34, .14, .18, 1.5], [-3.02, .67, .58, 1.75], [-2.4, 1.04, .91, 1.89],
    [-1.65, 1.18, 1.05, 1.94], [-.22, 1.16, 1.07, 1.96], [.91, .91, .78, 2.08], [1.72, .46, .46, 2.2], [2.03, .31, .29, 2.26]];
  paint.add(loft(body, 32), C.white);
  paint.add(shellPatch(body, -3.15, 1.65, Math.PI, Math.PI * 2), C.orange);
  paint.add(loft([[1.04, .48, .42, 2.1], [2.08, .34, .32, 2.31], [4.3, .19, .2, 2.73], [6.42, .085, .13, 3.1]], 20), C.orange);
  paint.ball([.65, .53, 1.1], [0, 2.81, .15], C.white);
  paint.ball([.5, .19, .82], [0, 3.16, .2], C.orange);
  paint.cylinder(.23, .23, .53, [0, 3.16, -1.05], C.dark);
  paint.cylinder(.091, .13, .65, [0, 3.39, -.87], C.metal);
  for (const side of [-1, 1]) {
    // Deep wraparound forward glazing, divided by white mullions.
    glass.add(shellPatch(body, -3.12, -2.06, side === 1 ? -.13 : 1.76, side === 1 ? 1.38 : 3.27, .025), C.glass);
    glass.add(shellPatch(body, -1.92, -.52, side === 1 ? .0 : 2.19, side === 1 ? .95 : Math.PI, .025), C.glass);
    glass.add(shellPatch(body, -.34, .58, side === 1 ? .11 : 2.24, side === 1 ? .9 : 3.03, .025), C.glass);
    paint.add(shellPatch(body, -2.82, 1.23, side === 1 ? -.09 : Math.PI + .05, side === 1 ? -.05 : Math.PI + .09, .035), C.gold);
    paint.tube([side * 1.18, 1.32, -.46], [side * 1.16, 2.69, -.46], .02, C.dark);
    paint.tube([side * 1.05, 1.29, -1.98], [side * 1.18, 1.32, -.46], .016, C.dark);
    paint.box([.045, .06, .27], [side * 1.195, 1.88, -.65], C.dark);
    paint.box([.038, .035, .21], [side * 1.222, 1.891, -.65], C.metal);
    // Tubular skids with raised forward and aft ends. Lowest point = 0.
    paint.tube([side * 1.31, .055, -2.26], [side * 1.31, .055, 1.42], .055, C.dark, 10);
    paint.tube([side * 1.31, .055, -2.26], [side * 1.31, .18, -2.68], .055, C.dark, 10);
    paint.tube([side * 1.31, .18, -2.68], [side * 1.31, .39, -2.96], .055, C.dark, 10);
    paint.tube([side * 1.31, .055, 1.42], [side * 1.31, .19, 1.74], .055, C.dark, 10);
    for (const z of [-1.6, .69]) {
      paint.tube([side * .69, .99, z], [side * 1.28, .13, z], .065, C.metal);
      paint.box([.21, .05, .53], [side * 1.32, .12, z], C.metal);
    }
    paint.tube([side * .69, .73, -1.6], [side * 1.02, .5, -1.6], .041, C.dark);
    paint.box([.41, .06, .64], [side * 1.12, .5, -1.45], C.dark);
    // Engine intake grilles and exhaust shrouds.
    paint.ball([.14, .19, .43], [side * .57, 2.86, .28], C.dark);
    for (let i = 0; i < 5; i++) paint.box([.035, .28, .027], [side * .677, 2.87, -.01 + i * .14], C.metal);
    paint.cylinder(.13, .14, .43, [side * .41, 2.91, 1.11], C.dark, [Math.PI / 2, 0, 0]);
    // Tail stabilisers and red/green lens housings.
    paint.add(plate([[0, -.42], [1.34, -.11], [1.39, .31], [0, .26]], .079)
      .rotateX(-Math.PI / 2).scale(side, 1, 1).translate(0, 2.7, 4.15), C.white);
    lights.ball([.08, .06, .095], [side * 1.38, 2.74, 4.12], side === -1 ? C.red : C.green, 12);
    addDecal(group, 'COASTAL', [side * 1.169, 1.66, -.17], [.94, .15], side * Math.PI / 2, '#f8f2e8');
  }
  paint.add(plate([[5.4, 2.98], [5.79, 4.27], [6.32, 4.63], [6.67, 4.48], [6.53, 2.57], [6.11, 2.18]], .13)
    .rotateY(-Math.PI / 2), C.orange);
  paint.add(plate([[5.97, 4.21], [6.31, 4.43], [6.51, 4.35], [6.45, 3.98]], .148)
    .rotateY(-Math.PI / 2), C.white);
  paint.tube([0, 2.86, -.98], [0, 3.05, -2.2], .034, C.dark);
  paint.ball([.14, .13, .12], [0, 1.22, -3.05], C.dark);
  lights.ball([.105, .091, .07], [0, 1.22, -3.142], C.white, 12);
  lights.ball([.067, .08, .065], [0, 4.65, 6.34], C.red, 12);
  // Articulated four-blade rotor, kept separate from its blur disc.
  const mainRotor = new THREE.Group(); mainRotor.name = 'Main rotor'; mainRotor.position.set(0, 3.72, -.87);
  mainRotor.userData.spinAxis = 'y'; mainRotor.userData.spinRate = 35;
  const rotor = new SolidBatch();
  rotor.cylinder(.24, .24, .12, [0, 0, 0], C.metal);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    rotor.add(plate([[.18, -.10], [1.02, -.13], [5.53, -.28], [5.69, .015], [5.39, .13], [.9, .075]], .033)
      .rotateX(-Math.PI / 2).rotateY(a), C.dark);
    rotor.box([.29, .04, .24], [Math.cos(a) * 5.43, .005, -Math.sin(a) * 5.43], C.gold, [0, a, 0]);
    rotor.tube([Math.cos(a) * .16, -.1, -Math.sin(a) * .16], [Math.cos(a) * .68, -.02, -Math.sin(a) * .68], .032, C.metal);
  }
  mainRotor.add(rotor.finish('Main rotor blades and linkage'));
  const rotorBlur = new THREE.Mesh(new THREE.RingGeometry(.42, 5.66, 72), new THREE.MeshBasicMaterial({
    color: 0x667b80, transparent: true, opacity: .1, depthWrite: false, side: THREE.DoubleSide,
  }));
  rotorBlur.rotation.x = -Math.PI / 2; rotorBlur.position.copy(mainRotor.position); rotorBlur.position.y += .014;
  rotorBlur.name = 'Main rotor motion disc'; rotorBlur.visible = false;
  // Tail rotor lies in Y/Z and spins about local X.
  const tail = new THREE.Group(); tail.name = 'Tail rotor'; tail.position.set(.26, 3.13, 6.38);
  tail.userData.spinAxis = 'x'; tail.userData.spinRate = 80;
  const tailBlades = new SolidBatch();
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    tailBlades.box([.045, 1.1, .12], [0, Math.cos(a) * .53, Math.sin(a) * .53], C.dark, [a, 0, 0]);
    tailBlades.box([.051, .15, .125], [0, Math.cos(a) * .98, Math.sin(a) * .98], C.gold, [a, 0, 0]);
  }
  tailBlades.ball([.15, .115, .115], [.035, 0, 0], C.metal);
  tail.add(tailBlades.finish('Tail rotor blades'));
  group.add(paint.finish('Helicopter painted structure'), glass.finish('Helicopter panoramic glazing', 'glass'),
    lights.finish('Helicopter navigation lenses', 'light'), mainRotor, tail, rotorBlur);
  group.userData.dimensions = { length: 10.9, rotorDiameter: 11.4, height: 4.74 };
  return { group, propellers: [mainRotor, tail], rotorBlur };
}

const PANEL_WIDTH = 1.54, PANEL_HEIGHT = .54, PANEL_Y = -.44, PANEL_Z = -1.32;
const GAUGE_R = .077;
const DIALS = {
  airspeed: [-.50, -.324], attitude: [-.273, -.324], altimeter: [-.046, -.324],
  power: [-.50, -.543], heading: [-.273, -.543], verticalSpeed: [-.046, -.543],
} as const;

function panelTexture(kind: AircraftKind): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas'); canvas.width = 1848; canvas.height = 648;
  const ctx = canvas.getContext('2d'); if (!ctx) return undefined;
  const sx = canvas.width / PANEL_WIDTH, sy = canvas.height / PANEL_HEIGHT;
  const x = (v: number) => (v + PANEL_WIDTH / 2) * sx;
  const y = (v: number) => (PANEL_Y + PANEL_HEIGHT / 2 - v) * sy;
  ctx.fillStyle = kind === 'seaplane' ? '#34433f' : '#303d42'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Fine panel edge and mounting screws provide scale without extra draw calls.
  ctx.strokeStyle = '#60716a'; ctx.lineWidth = 3; ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  for (const px of [22, canvas.width / 2, canvas.width - 22]) for (const py of [22, canvas.height - 22]) {
    ctx.fillStyle = '#97a4a0'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#27312f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px - 4, py + 3); ctx.lineTo(px + 4, py - 3); ctx.stroke();
  }
  const dial = (pos: readonly [number, number], label: string, numbers: readonly string[], unit: string, full = false): void => {
    const cx = x(pos[0]), cy = y(pos[1]), r = GAUGE_R * sx;
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = '#080e12'; ctx.beginPath(); ctx.arc(0, 0, r + 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#92a09e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#edf0dc';
    const sweep = full ? 360 : 280, start = full ? -90 : 130;
    for (let i = 0; i <= 40; i++) {
      const a = (start + sweep * i / 40) * Math.PI / 180;
      const outer = r * .89, inner = r * (i % 5 === 0 ? .70 : .80);
      ctx.lineWidth = i % 5 === 0 ? 2.6 : 1.4;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner); ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer); ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#edf0dd'; ctx.font = '17px Arial, sans-serif';
    numbers.forEach((n, i) => {
      const a = (start + sweep * i / (numbers.length - 1)) * Math.PI / 180;
      ctx.fillText(n, Math.cos(a) * r * .57, Math.sin(a) * r * .57);
    });
    ctx.font = 'bold 12px Arial, sans-serif'; ctx.fillStyle = '#a2b6ad'; ctx.fillText(unit, 0, r * .33);
    ctx.font = 'bold 16px Arial, sans-serif'; ctx.fillStyle = '#d9ded0'; ctx.fillText(label, 0, r + 28);
    ctx.restore();
  };
  dial(DIALS.airspeed, 'AIRSPEED', ['0', '40', '80', '120', '160', '200'], 'KNOTS');
  dial(DIALS.attitude, 'ATTITUDE', [], '', true);
  dial(DIALS.altimeter, 'ALTIMETER', ['0', '2', '4', '6', '8', '0'], 'FEET', true);
  dial(DIALS.power, kind === 'helicopter' ? 'ROTOR RPM' : 'ENGINE RPM', ['0', '1', '2', '3', '4'], 'RPM × 1000');
  dial(DIALS.heading, 'HEADING', [], '', true);
  dial(DIALS.verticalSpeed, 'VERT SPEED', ['−2', '−1', '0', '1', '2'], '1000 FT / MIN');
  // A compact original avionics stack: radio, navigation display, annunciators.
  const ax = x(.132), ay = y(-.219), aw = sx * .564;
  ctx.fillStyle = '#182321'; ctx.fillRect(ax, ay, aw, sy * .432);
  ctx.strokeStyle = '#697970'; ctx.lineWidth = 3; ctx.strokeRect(ax, ay, aw, sy * .432);
  const labels = ['COM 1  123.450', 'NAV 1  110.700'];
  labels.forEach((label, i) => {
    ctx.fillStyle = '#071813'; ctx.fillRect(ax + 15, ay + 16 + i * 49, aw - 30, 43);
    ctx.font = 'bold 26px monospace'; ctx.fillStyle = '#98e9aa'; ctx.textAlign = 'left'; ctx.fillText(label, ax + 31, ay + 46 + i * 49);
  });
  const nx = ax + 16, ny = ay + 128, nw = aw - 32, nh = 190;
  ctx.fillStyle = '#0c252b'; ctx.fillRect(nx, ny, nw, nh);
  ctx.strokeStyle = '#315852'; ctx.lineWidth = 2;
  for (let gx = 0; gx <= 8; gx++) { ctx.beginPath(); ctx.moveTo(nx + gx * nw / 8, ny); ctx.lineTo(nx + gx * nw / 8, ny + nh); ctx.stroke(); }
  for (let gy = 0; gy <= 4; gy++) { ctx.beginPath(); ctx.moveTo(nx, ny + gy * nh / 4); ctx.lineTo(nx + nw, ny + gy * nh / 4); ctx.stroke(); }
  ctx.fillStyle = '#4a7050'; ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx + 160, ny); ctx.lineTo(nx + 203, ny + 42); ctx.lineTo(nx + 151, ny + 72); ctx.lineTo(nx + 282, ny + 116); ctx.lineTo(nx + 375, ny + 148); ctx.lineTo(nx + nw, ny + 113); ctx.lineTo(nx + nw, ny + nh); ctx.lineTo(nx, ny + nh); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#dec475'; ctx.lineWidth = 3; ctx.setLineDash([11, 8]); ctx.beginPath(); ctx.moveTo(nx + 83, ny + 162); ctx.lineTo(nx + nw / 2, ny + 84); ctx.lineTo(nx + nw - 56, ny + 55); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f7e4a0'; ctx.beginPath(); ctx.moveTo(nx + nw / 2, ny + 65); ctx.lineTo(nx + nw / 2 - 12, ny + 101); ctx.lineTo(nx + nw / 2, ny + 93); ctx.lineTo(nx + nw / 2 + 12, ny + 101); ctx.closePath(); ctx.fill();
  ctx.font = '18px monospace'; ctx.fillStyle = '#cedbd0'; ctx.fillText('VANCOUVER HARBOUR', nx + 13, ny + 27);
  ctx.font = '15px monospace'; ctx.fillText('N ↑   •   2 NM', nx + 13, ny + nh - 10);
  ['FUEL', 'OIL', 'ELEC', 'PITOT'].forEach((label, i) => {
    const bx = ax + 26 + i * (aw - 39) / 4;
    ctx.fillStyle = i === 0 ? '#d4a75e' : '#6dbe93'; ctx.fillRect(bx, ay + 345, 21, 12);
    ctx.fillStyle = '#b8c9b7'; ctx.font = '14px Arial, sans-serif'; ctx.fillText(label, bx - 1, ay + 377);
  });
  ctx.font = 'bold 18px Arial, sans-serif'; ctx.fillStyle = '#dcd9c5'; ctx.textAlign = 'center';
  ctx.fillText(kind === 'helicopter' ? 'COASTAL  /  UTILITY FLIGHT' : 'PACIFIC  /  FLOATPLANE', x(.409), y(-.674));
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 2;
  return tex;
}

function needle(position: readonly [number, number], colour = C.white): THREE.Group {
  const group = new THREE.Group(); group.position.set(position[0], position[1], PANEL_Z + .018);
  const batch = new SolidBatch();
  batch.add(plate([[0, .065], [-.005, -.016], [.005, -.016]], .002), colour);
  batch.cylinder(.008, .008, .003, [0, 0, .003], C.metal, [Math.PI / 2, 0, 0], 16);
  group.add(batch.finish('Instrument pointer', 'light')); return group;
}

function compassTexture(): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 384;
  const ctx = canvas.getContext('2d'); if (!ctx) return undefined;
  ctx.fillStyle = '#101b1e'; ctx.fillRect(0, 0, 384, 384); ctx.translate(192, 192);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#ebeee0';
  for (let i = 0; i < 36; i++) {
    const a = i * Math.PI / 18; ctx.save(); ctx.rotate(a);
    ctx.strokeStyle = '#d9dfcf'; ctx.lineWidth = i % 3 === 0 ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(0, -163); ctx.lineTo(0, i % 3 === 0 ? -142 : -151); ctx.stroke();
    if (i % 3 === 0) {
      ctx.font = i % 9 === 0 ? 'bold 30px Arial' : '23px Arial';
      ctx.fillText(i % 9 === 0 ? ['N', 'E', 'S', 'W'][i / 9] : String(i), 0, -112);
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function buildCockpit(kind: AircraftKind): { cockpit: THREE.Group; stick: THREE.Object3D; instruments: AircraftInstruments } {
  const cockpit = new THREE.Group(); cockpit.name = `${kind} camera cockpit`;
  const shell = new SolidBatch(), details = new SolidBatch();
  const trim = kind === 'seaplane' ? C.teal : C.orange;
  // Surrounding coaming and door posts stay out of the central horizon view.
  shell.box([1.67, .085, .31], [0, -.135, -1.418], C.dark, [-.08, 0, 0]);
  shell.box([1.65, .62, .13], [0, -.474, -1.41], C.black, [-.045, 0, 0]);
  shell.box([1.62, .075, .11], [0, -.74, -1.313], C.metal);
  for (const side of [-1, 1]) {
    shell.tube([side * .855, -.83, -.48], [side * .829, -.25, -1.03], .035, C.dark);
    shell.tube([side * .829, -.25, -1.03], [side * .658, .618, -.742], .036, trim);
    shell.tube([side * .667, .601, -.75], [side * .795, .70, .25], .037, C.dark);
    shell.tube([side * .84, -.26, -1.00], [side * .92, -.32, .29], .033, C.dark);
    shell.box([.18, .12, 1.04], [side * .87, -.39, -.16], C.dark);
    details.box([.046, .017, .17], [side * .837, -.309, -.19], C.metal);
    // Seat shoulders at the edges of the frame, plus stitched bolsters and belt.
    shell.ball([.25, .29, .18], [side * .77, -.91, .03], C.seat, 14);
    details.tube([side * .62, -.79, -.062], [side * .81, -.995, -.116], .021, C.rubber);
    details.tube([side * .735, -.682, -.08], [side * .852, -.992, -.109], .004, C.gold);
  }
  // Overhead header and sun visors are high, leaving forward visibility open.
  shell.tube([-.68, .62, -.744], [.68, .62, -.744], .049, C.dark);
  shell.box([.40, .1, .038], [-.386, .565, -.731], C.dark, [.22, 0, 0]);
  shell.box([.40, .1, .038], [.386, .565, -.731], C.dark, [.22, 0, 0]);
  // The centre console includes switches, throttle/collective base and pedal hints.
  shell.box([.35, .40, .45], [.235, -.779, -.934], C.dark, [-.08, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const xx = .107 + i * .063;
    details.cylinder(.015, .015, .005, [xx, -.202, -1.247], C.metal, [Math.PI / 2, 0, 0], 12);
    details.tube([xx, -.203, -1.239], [xx, -.183, -1.217], .0048, C.white, 6);
  }
  for (const x of [-.56, -.31]) details.box([.15, .026, .14], [x, -1.10, -.93], C.metal, [-.37, 0, 0]);
  const panelMap = panelTexture(kind);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), new THREE.MeshBasicMaterial({
    map: panelMap ?? null, color: panelMap ? 0xffffff : 0x3d4b45, toneMapped: false,
  }));
  panel.position.set(0, PANEL_Y, PANEL_Z); panel.name = 'Six-pack instruments and avionics';
  const airspeedNeedle = needle(DIALS.airspeed), altimeterNeedle = needle(DIALS.altimeter);
  const verticalSpeedNeedle = needle(DIALS.verticalSpeed), powerNeedle = needle(DIALS.power, C.gold);
  // Heading card rotates inside a stationary bezel; the lubber line stays fixed.
  const headingCard = new THREE.Group(); headingCard.position.set(...DIALS.heading, PANEL_Z + .014);
  const compassMap = compassTexture();
  headingCard.add(new THREE.Mesh(new THREE.CircleGeometry(GAUGE_R * .91, 48), new THREE.MeshBasicMaterial({
    map: compassMap ?? null, color: compassMap ? 0xffffff : C.dark, toneMapped: false,
  })));
  details.tube([DIALS.heading[0], DIALS.heading[1] + .064, PANEL_Z + .022],
    [DIALS.heading[0], DIALS.heading[1] + .087, PANEL_Z + .022], .002, C.gold, 6);
  details.tube([DIALS.heading[0] - .02, DIALS.heading[1], PANEL_Z + .022],
    [DIALS.heading[0] + .02, DIALS.heading[1], PANEL_Z + .022], .002, C.gold, 6);
  // Artificial horizon uses a shallow sky/earth sphere. Pitch rotates the sphere,
  // bank rotates its parent; no per-frame canvas upload is required.
  const attitudeRoll = new THREE.Group(); attitudeRoll.position.set(...DIALS.attitude, PANEL_Z + .013);
  const attitudePitch = new THREE.Group();
  const skyEarth = new THREE.SphereGeometry(GAUGE_R * .91, 40, 24);
  const count = skyEarth.getAttribute('position').count, colours = new Float32Array(count * 3);
  const sky = new THREE.Color(0x347c9b), earth = new THREE.Color(0xa16b42);
  for (let i = 0; i < count; i++) {
    const colour = skyEarth.getAttribute('position').getY(i) >= 0 ? sky : earth;
    colours.set([colour.r, colour.g, colour.b], i * 3);
  }
  skyEarth.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const attitudeSphere = new THREE.Mesh(skyEarth, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  attitudePitch.add(attitudeSphere); attitudeRoll.add(attitudePitch);
  // Flatten at the outer group so the rotating sphere remains behind the fixed mark.
  attitudeRoll.scale.z = .06;
  const horizonMarks = new SolidBatch();
  for (const s of [-1, 1]) horizonMarks.tube([s * .011, 0, .071], [s * .052, 0, .071], .0012, C.white, 6);
  for (const yy of [-.027, -.014, .014, .027]) horizonMarks.tube([-.014, yy, Math.sqrt(.069 ** 2 - yy ** 2)], [.014, yy, Math.sqrt(.069 ** 2 - yy ** 2)], .0009, C.white, 6);
  attitudePitch.add(horizonMarks.finish('Attitude pitch bars', 'light'));
  details.tube([DIALS.attitude[0] - .042, DIALS.attitude[1], PANEL_Z + .027], [DIALS.attitude[0] - .014, DIALS.attitude[1], PANEL_Z + .027], .002, C.gold, 6);
  details.tube([DIALS.attitude[0] + .014, DIALS.attitude[1], PANEL_Z + .027], [DIALS.attitude[0] + .042, DIALS.attitude[1], PANEL_Z + .027], .002, C.gold, 6);
  details.tube([DIALS.attitude[0] - .014, DIALS.attitude[1], PANEL_Z + .027], [DIALS.attitude[0], DIALS.attitude[1] - .007, PANEL_Z + .027], .002, C.gold, 6);
  details.tube([DIALS.attitude[0], DIALS.attitude[1] - .007, PANEL_Z + .027], [DIALS.attitude[0] + .014, DIALS.attitude[1], PANEL_Z + .027], .002, C.gold, 6);
  // A control object is independent so the caller can animate bank/pitch feedback.
  const stick = new THREE.Group(); stick.name = kind === 'seaplane' ? 'Pilot yoke' : 'Pilot cyclic';
  const controls = new SolidBatch();
  if (kind === 'seaplane') {
    stick.position.set(-.35, -.58, -.93);
    controls.tube([0, 0, -.31], [0, 0, 0], .023, C.metal, 12);
    controls.box([.19, .055, .055], [0, 0, 0], C.dark);
    for (const side of [-1, 1]) {
      controls.tube([side * .07, -.006, 0], [side * .135, .065, .007], .017, C.dark, 12);
      controls.tube([side * .135, .065, .007], [side * .135, .125, .007], .022, C.dark, 12);
      controls.ball([.023, .011, .025], [side * .135, .13, .007], C.metal, 10);
    }
    controls.box([.055, .04, .006], [0, .001, .032], C.teal);
    details.tube([.218, -.585, -1.06], [.22, -.431, -1.02], .009, C.metal, 8);
    details.ball([.026, .022, .029], [.22, -.423, -1.02], C.dark, 12);
    details.tube([.291, -.585, -1.06], [.29, -.463, -1.02], .009, C.metal, 8);
    details.ball([.025, .022, .029], [.29, -.455, -1.02], C.red, 12);
  } else {
    stick.position.set(-.33, -.80, -.87);
    controls.tube([0, 0, 0], [.017, .242, -.08], .016, C.metal, 12);
    controls.tube([.017, .242, -.08], [.017, .328, -.04], .026, C.dark, 12);
    controls.ball([.034, .035, .031], [.017, .337, -.037], C.dark, 12);
    controls.ball([.009, .007, .006], [.035, .354, -.011], C.red, 10);
    controls.box([.027, .008, .015], [.002, .36, -.039], C.metal);
    // Collective lever sits at the left edge of the pilot seat.
    details.tube([-.686, -.966, -.17], [-.689, -.727, -.45], .017, C.metal, 10);
    details.tube([-.689, -.727, -.45], [-.689, -.684, -.518], .026, C.dark, 10);
  }
  stick.add(controls.finish(kind === 'seaplane' ? 'Yoke grip and column' : 'Cyclic grip and column'));
  cockpit.add(shell.finish('Cockpit enclosure and coaming'), details.finish('Cockpit hardware'), panel,
    airspeedNeedle, altimeterNeedle, verticalSpeedNeedle, powerNeedle, headingCard, attitudeRoll, stick);
  cockpit.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.frustumCulled = false; object.castShadow = false; object.receiveShadow = false;
    }
  });
  const instruments = { airspeedNeedle, altimeterNeedle, verticalSpeedNeedle, powerNeedle, headingCard, attitudeRoll, attitudePitch };
  updateAircraftInstruments(instruments, { airspeedKnots: 0, altitudeMetres: 0, verticalSpeedMetresPerSecond: 0, pitch: 0, roll: 0, heading: 0, power: 0 });
  return { cockpit, stick, instruments };
}

/** Update geometric pointers only. Heading/pitch/roll in radians; call each frame. */
export function updateAircraftInstruments(instruments: AircraftInstruments, state: AircraftInstrumentState): void {
  const clamp = THREE.MathUtils.clamp;
  instruments.airspeedNeedle.rotation.z = THREE.MathUtils.degToRad(140 - clamp(state.airspeedKnots / 200, 0, 1) * 280);
  instruments.altimeterNeedle.rotation.z = -(state.altitudeMetres * 3.28084 / 1000) * Math.PI * 2;
  instruments.verticalSpeedNeedle.rotation.z = -clamp(state.verticalSpeedMetresPerSecond * 196.8504 / 2000, -1, 1) * THREE.MathUtils.degToRad(140);
  instruments.powerNeedle.rotation.z = THREE.MathUtils.degToRad(140 - clamp(state.power, 0, 1) * 280);
  instruments.headingCard.rotation.z = state.heading;
  instruments.attitudeRoll.rotation.z = state.roll;
  instruments.attitudePitch.rotation.x = clamp(state.pitch, -Math.PI / 2, Math.PI / 2);
}

function disposeAircraft(group: THREE.Group, cockpit: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  for (const root of [group, cockpit]) root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose()); materials.forEach((material) => material.dispose()); geometries.forEach((geometry) => geometry.dispose());
  group.removeFromParent(); cockpit.removeFromParent();
}

export function makeAircraft(kind: AircraftKind): AircraftAsset {
  const exterior = kind === 'helicopter' ? buildHelicopter() : buildSeaplane();
  const interior = buildCockpit(kind);
  return { ...exterior, ...interior, dispose: () => disposeAircraft(exterior.group, interior.cockpit) };
}

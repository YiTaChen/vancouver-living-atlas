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
type Station = readonly [
  z: number,
  radiusX: number,
  radiusY: number,
  centreY: number,
];
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
  cream: 0xf3ede0,
  white: 0xf7f5ed,
  teal: 0x146877,
  tealLight: 0x37a3a4,
  orange: 0xe8752f,
  orangeLight: 0xffad52,
  glass: 0x254954,
  glassGlint: 0x769a9f,
  metal: 0xa8b5b9,
  dark: 0x27383c,
  black: 0x101b20,
  rubber: 0x202a2d,
  red: 0xf13b37,
  green: 0x38cf94,
  gold: 0xe5c188,
  seat: 0x6f7f79,
};

/** A small builder that converts coloured primitives into a single static mesh. */
class SolidBatch {
  private parts: THREE.BufferGeometry[] = [];
  add(source: THREE.BufferGeometry, colour: number): void {
    const g = source.index ? source.toNonIndexed() : source;
    if (source !== g) source.dispose();
    for (const key of Object.keys(g.attributes))
      if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const col = new THREE.Color(colour),
      count = g.getAttribute('position').count;
    const colours = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colours.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    this.parts.push(g);
  }
  box(size: V3, pos: V3, colour: number, rotation: V3 = [0, 0, 0]): void {
    this.add(
      new THREE.BoxGeometry(...size)
        .applyMatrix4(
          new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(...rotation),
          ),
        )
        .translate(...pos),
      colour,
    );
  }
  ball(size: V3, pos: V3, colour: number, segments = 20): void {
    this.add(
      new THREE.SphereGeometry(1, segments, 12)
        .scale(...size)
        .translate(...pos),
      colour,
    );
  }
  tube(a: V3, b: V3, radius: number, colour: number, sides = 8): void {
    const va = new THREE.Vector3(...a),
      vb = new THREE.Vector3(...b),
      direction = vb.clone().sub(va);
    this.add(
      new THREE.CylinderGeometry(radius, radius, direction.length(), sides)
        .applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.normalize(),
          ),
        )
        .translate(...va.add(vb).multiplyScalar(0.5).toArray()),
      colour,
    );
  }
  cylinder(
    radiusTop: number,
    radiusBottom: number,
    length: number,
    pos: V3,
    colour: number,
    rotation: V3 = [0, 0, 0],
    sides = 18,
  ): void {
    this.add(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, length, sides)
        .applyMatrix4(
          new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(...rotation),
          ),
        )
        .translate(...pos),
      colour,
    );
  }
  quad(points: readonly V3[], colour: number): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          ...points[0],
          ...points[1],
          ...points[2],
          ...points[0],
          ...points[2],
          ...points[3],
        ],
        3,
      ),
    );
    g.computeVertexNormals();
    this.add(g, colour);
  }
  finish(
    name: string,
    kind: 'paint' | 'glass' | 'light' = 'paint',
  ): THREE.Mesh {
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    if (!merged) throw new Error(`Empty aircraft batch: ${name}`);
    const material =
      kind === 'light'
        ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })
        : new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: kind === 'glass' ? 0.14 : 0.48,
            metalness: kind === 'glass' ? 0.42 : 0.16,
            side: THREE.DoubleSide,
          });
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    // Intentionally no point lights or shadow work: these assets also run on mobile.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

function loft(stations: readonly Station[], radial = 28): THREE.BufferGeometry {
  const p: number[] = [],
    indices: number[] = [];
  for (const [z, rx, ry, cy] of stations)
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      p.push(Math.cos(a) * rx, cy + Math.sin(a) * ry, z);
    }
  for (let row = 0; row < stations.length - 1; row++)
    for (let i = 0; i < radial; i++) {
      const a = row * radial + i,
        b = row * radial + ((i + 1) % radial);
      const c = b + radial,
        d = a + radial;
      indices.push(a, b, c, a, c, d);
    }
  for (let i = 1; i < radial - 1; i++) {
    indices.push(0, i + 1, i);
    const last = (stations.length - 1) * radial;
    indices.push(last, last + i, last + i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function stationAt(stations: readonly Station[], z: number): Station {
  let i = 0;
  while (i < stations.length - 2 && z > stations[i + 1][0]) i++;
  const a = stations[i],
    b = stations[i + 1],
    t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return [
    z,
    THREE.MathUtils.lerp(a[1], b[1], t),
    THREE.MathUtils.lerp(a[2], b[2], t),
    THREE.MathUtils.lerp(a[3], b[3], t),
  ];
}

/** Curved inset follows the aircraft's original section profile. */
function shellPatch(
  stations: readonly Station[],
  z0: number,
  z1: number,
  a0: number,
  a1: number,
  offset = 0.012,
): THREE.BufferGeometry {
  const positions: number[] = [],
    indices: number[] = [],
    rows = 8,
    columns = 8;
  for (let r = 0; r <= rows; r++) {
    const [z, rx, ry, cy] = stationAt(
      stations,
      THREE.MathUtils.lerp(z0, z1, r / rows),
    );
    for (let c = 0; c <= columns; c++) {
      const a = THREE.MathUtils.lerp(a0, a1, c / columns);
      positions.push(
        Math.cos(a) * (rx + offset),
        cy + Math.sin(a) * (ry + offset),
        z,
      );
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c,
        b = a + 1,
        d = a + columns + 1;
      indices.push(a, b, d + 1, a, d + 1, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Extruded flat polygon: XY contour, centred in its Z thickness. */
function plate(
  points: readonly (readonly [number, number])[],
  thickness: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) =>
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y),
  );
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  }).translate(0, 0, -thickness / 2);
}

function textTexture(
  text: string,
  foreground: string,
  background?: string,
  width = 1024,
  height = 160,
): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.fillStyle = foreground;
  ctx.font = `600 ${Math.round(height * 0.63)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addDecal(
  parent: THREE.Object3D,
  text: string,
  position: V3,
  size: readonly [number, number],
  rotationY: number,
  foreground: string,
): void {
  const texture = textTexture(text, foreground);
  if (!texture) return;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(...size),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      toneMapped: false,
    }),
  );
  mesh.position.set(...position);
  mesh.rotation.y = rotationY;
  mesh.name = text;
  parent.add(mesh);
}

/** Airfoil cross sections laid across the span. Each wing is a single geometry. */
function wing(side: number): THREE.BufferGeometry {
  const sections = [
    [0.72, 2.72, -0.67, 3.06],
    [2.6, 2.55, -0.58, 3.08],
    [5.8, 2.1, -0.36, 3.18],
    [7.5, 1.22, -0.06, 3.28],
  ];
  const ring = [
    [-0.5, 0],
    [-0.42, 0.072],
    [-0.12, 0.105],
    [0.25, 0.07],
    [0.5, 0],
    [0.23, -0.022],
    [-0.16, -0.028],
    [-0.43, -0.022],
  ];
  const positions: number[] = [],
    indices: number[] = [];
  for (const [span, chord, zc, y] of sections)
    for (const [z, h] of ring)
      positions.push(span * side, y + h * chord, zc + z * chord);
  for (let s = 0; s < sections.length - 1; s++)
    for (let r = 0; r < ring.length; r++) {
      const a = s * ring.length + r,
        b = s * ring.length + ((r + 1) % ring.length);
      indices.push(a, b, b + ring.length, a, b + ring.length, a + ring.length);
    }
  const end = (sections.length - 1) * ring.length;
  for (let i = 1; i < ring.length - 1; i++)
    indices.push(end, end + i, end + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function buildSeaplane(): { group: THREE.Group; propellers: THREE.Object3D[] } {
  const group = new THREE.Group();
  group.name = 'Pacific floatplane';
  const paint = new SolidBatch(),
    glass = new SolidBatch(),
    lights = new SolidBatch();
  const body: Station[] = [
    [-4.3, 0.22, 0.28, 2.17],
    [-4.05, 0.62, 0.6, 2.16],
    [-3.35, 0.71, 0.73, 2.17],
    [-2.48, 0.84, 0.96, 2.2],
    [-1.55, 0.91, 1.02, 2.2],
    [0.65, 0.87, 0.9, 2.25],
    [1.65, 0.68, 0.71, 2.33],
    [3.05, 0.38, 0.43, 2.53],
    [4.52, 0.11, 0.22, 2.71],
    [4.7, 0.025, 0.075, 2.72],
  ];
  paint.add(loft(body), C.cream);
  paint.add(shellPatch(body, -3.9, 4.4, Math.PI, Math.PI * 2), C.teal);
  for (const side of [-1, 1]) {
    const angles = side === 1 ? [0.06, 0.74] : [Math.PI - 0.74, Math.PI - 0.06];
    for (const [z0, z1] of [
      [-2.61, -1.71],
      [-1.5, -0.57],
      [-0.39, 0.53],
      [0.72, 1.39],
    ]) {
      glass.add(shellPatch(body, z0, z1, angles[0], angles[1], 0.026), C.glass);
      paint.add(
        shellPatch(
          body,
          z0,
          z0 + 0.027,
          angles[0] - 0.025,
          angles[1] + 0.035,
          0.035,
        ),
        C.metal,
      );
    }
    // Split windscreens, curved around the high nose.
    glass.add(
      shellPatch(
        body,
        -3.17,
        -2.69,
        side === 1 ? 0.37 : 1.67,
        side === 1 ? 1.47 : 2.77,
        0.026,
      ),
      C.glass,
    );
    paint.add(
      shellPatch(
        body,
        -3.89,
        2.3,
        side === 1 ? -0.014 : Math.PI - 0.038,
        side === 1 ? 0.038 : Math.PI + 0.014,
        0.036,
      ),
      C.gold,
    );
    // Door seam, latch and a small step below the pilot's door.
    paint.tube(
      [side * 0.88, 1.66, -1.59],
      [side * 0.9, 2.47, -1.59],
      0.013,
      C.dark,
    );
    paint.tube(
      [side * 0.82, 1.67, -2.64],
      [side * 0.88, 1.66, -1.59],
      0.013,
      C.dark,
    );
    paint.box([0.047, 0.038, 0.19], [side * 0.911, 2.31, -1.76], C.metal);
    paint.box([0.37, 0.06, 0.49], [side * 1.05, 1.24, -2.04], C.dark);
    paint.tube(
      [side * 0.8, 1.67, -1.96],
      [side * 1.14, 1.25, -1.96],
      0.035,
      C.metal,
    );
    // Two long stepped floats. Bottom is exactly Y=0.
    const float: Station[] = [
      [-4.09, 0.015, 0.02, 0.4],
      [-3.72, 0.29, 0.22, 0.33],
      [-2.92, 0.43, 0.3, 0.3],
      [-0.55, 0.43, 0.3, 0.3],
      [-0.35, 0.4, 0.19, 0.4],
      [1.8, 0.32, 0.2, 0.39],
      [2.52, 0.11, 0.16, 0.41],
      [2.66, 0.01, 0.05, 0.43],
    ];
    paint.add(loft(float, 16).translate(side * 1.48, 0, 0), C.metal);
    paint.box([0.72, 0.035, 3.43], [side * 1.48, 0.613, -1.18], C.cream);
    for (const z of [-2.34, -0.73, 1.08]) {
      paint.box([0.41, 0.018, 0.47], [side * 1.48, 0.643, z], C.dark);
      paint.box([0.29, 0.022, 0.33], [side * 1.48, 0.656, z], C.metal);
    }
    paint.tube(
      [side * 1.48, 0.63, -2.02],
      [side * 0.58, 1.63, -1.87],
      0.059,
      C.metal,
    );
    paint.tube(
      [side * 1.48, 0.6, 1.02],
      [side * 0.65, 1.66, 0.62],
      0.059,
      C.metal,
    );
    paint.tube(
      [side * 1.48, 0.62, 1.02],
      [side * 0.6, 1.59, -1.81],
      0.025,
      C.dark,
    );
    // High wing, lift struts, separate flap/aileron lines, tip paint and lights.
    paint.add(wing(side), C.cream);
    paint.tube(
      [side * 0.75, 1.73, -0.2],
      [side * 4.4, 3.11, -0.82],
      0.062,
      C.metal,
    );
    paint.tube(
      [side * 0.75, 1.73, -0.2],
      [side * 4.4, 3.11, 0.18],
      0.041,
      C.metal,
    );
    paint.tube(
      [side * 1.82, 3.062, 0.58],
      [side * 6.9, 3.248, 0.57],
      0.013,
      C.dark,
    );
    paint.box([0.23, 0.04, 1.25], [side * 7.22, 3.35, -0.08], C.teal, [
      0,
      0,
      side * 0.05,
    ]);
    lights.ball(
      [0.105, 0.065, 0.15],
      [side * 7.49, 3.33, -0.36],
      side === -1 ? C.red : C.green,
      12,
    );
    // Tailplane horizontal stabiliser.
    const tail = plate(
      [
        [0, -1.2],
        [2.44, -0.61],
        [2.63, 0.1],
        [2.16, 0.48],
        [0, 0.35],
      ],
      0.105,
    )
      .rotateX(-Math.PI / 2)
      .translate(0, 2.75, 3.53);
    if (side === -1) tail.scale(-1, 1, 1);
    paint.add(tail, C.cream);
    paint.tube(
      [side * 0.26, 2.48, 3.24],
      [side * 1.72, 2.69, 3.64],
      0.024,
      C.metal,
    );
    addDecal(
      group,
      'PACIFIC AIR',
      [side * 0.888, 2.095, -0.23],
      [1.53, 0.22],
      (side * Math.PI) / 2,
      '#f3ede0',
    );
  }
  paint.tube([-1.48, 0.7, -1.94], [1.48, 0.7, -1.94], 0.053, C.metal);
  paint.tube([-1.48, 0.68, 1.02], [1.48, 0.68, 1.02], 0.053, C.metal);
  // A tall swept vertical fin in the aircraft's Y/Z plane.
  paint.add(
    plate(
      [
        [2.4, 2.67],
        [3.05, 4.39],
        [3.56, 4.59],
        [4.6, 3.01],
        [4.63, 2.67],
      ],
      0.13,
    ).rotateY(-Math.PI / 2),
    C.teal,
  );
  paint.add(
    plate(
      [
        [3.48, 4.36],
        [3.65, 4.28],
        [4.42, 3.16],
        [4.13, 3.2],
      ],
      0.15,
    ).rotateY(-Math.PI / 2),
    C.cream,
  );
  paint.tube([0, 3.15, 0.94], [0, 3.72, 1.33], 0.017, C.dark);
  paint.tube([-0.34, 1.79, -3.72], [-0.65, 1.51, -3.5], 0.072, C.dark);
  paint.cylinder(0.37, 0.39, 0.2, [0, 2.16, -4.23], C.dark, [
    Math.PI / 2,
    0,
    0,
  ]);
  paint.ball([0.3, 0.3, 0.46], [0, 2.16, -4.45], C.cream);
  lights.ball([0.075, 0.075, 0.07], [0, 4.55, 3.54], C.white, 10);
  const prop = new THREE.Group();
  prop.name = 'Seaplane propeller';
  prop.position.set(0, 2.16, -4.45);
  prop.userData.spinAxis = 'z';
  prop.userData.spinRate = 94;
  const propBatch = new SolidBatch();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    propBatch.add(
      plate(
        [
          [-0.075, 0.15],
          [-0.155, 0.67],
          [-0.11, 1.32],
          [0.05, 1.42],
          [0.14, 1.27],
          [0.08, 0.5],
        ],
        0.044,
      ).rotateZ(a),
      C.dark,
    );
    propBatch.box(
      [0.18, 0.13, 0.052],
      [-Math.sin(a) * 1.27, Math.cos(a) * 1.27, 0],
      C.gold,
      [0, 0, a],
    );
  }
  propBatch.ball([0.14, 0.14, 0.18], [0, 0, -0.11], C.metal);
  prop.add(propBatch.finish('Three-blade propeller'));
  group.add(
    paint.finish('Floatplane painted structure'),
    glass.finish('Floatplane curved glazing', 'glass'),
    lights.finish('Floatplane navigation lights', 'light'),
    prop,
  );
  group.userData.dimensions = { length: 9.8, span: 15.2, height: 4.65 };
  return { group, propellers: [prop] };
}

function buildHelicopter(): {
  group: THREE.Group;
  propellers: THREE.Object3D[];
  rotorBlur: THREE.Object3D;
} {
  const group = new THREE.Group();
  group.name = 'Coastal helicopter';
  const paint = new SolidBatch(),
    glass = new SolidBatch(),
    lights = new SolidBatch();
  const body: Station[] = [
    [-3.34, 0.14, 0.18, 1.5],
    [-3.02, 0.67, 0.58, 1.75],
    [-2.4, 1.04, 0.91, 1.89],
    [-1.65, 1.18, 1.05, 1.94],
    [-0.22, 1.16, 1.07, 1.96],
    [0.91, 0.91, 0.78, 2.08],
    [1.72, 0.46, 0.46, 2.2],
    [2.03, 0.31, 0.29, 2.26],
  ];
  paint.add(loft(body, 32), C.white);
  paint.add(shellPatch(body, -3.15, 1.65, Math.PI, Math.PI * 2), C.orange);
  paint.add(
    loft(
      [
        [1.04, 0.48, 0.42, 2.1],
        [2.08, 0.34, 0.32, 2.31],
        [4.3, 0.19, 0.2, 2.73],
        [6.42, 0.085, 0.13, 3.1],
      ],
      20,
    ),
    C.orange,
  );
  paint.ball([0.65, 0.53, 1.1], [0, 2.81, 0.15], C.white);
  paint.ball([0.5, 0.19, 0.82], [0, 3.16, 0.2], C.orange);
  paint.cylinder(0.23, 0.23, 0.53, [0, 3.16, -1.05], C.dark);
  paint.cylinder(0.091, 0.13, 0.65, [0, 3.39, -0.87], C.metal);
  for (const side of [-1, 1]) {
    // Deep wraparound forward glazing, divided by white mullions.
    glass.add(
      shellPatch(
        body,
        -3.12,
        -2.06,
        side === 1 ? -0.13 : 1.76,
        side === 1 ? 1.38 : 3.27,
        0.025,
      ),
      C.glass,
    );
    glass.add(
      shellPatch(
        body,
        -1.92,
        -0.52,
        side === 1 ? 0.0 : 2.19,
        side === 1 ? 0.95 : Math.PI,
        0.025,
      ),
      C.glass,
    );
    glass.add(
      shellPatch(
        body,
        -0.34,
        0.58,
        side === 1 ? 0.11 : 2.24,
        side === 1 ? 0.9 : 3.03,
        0.025,
      ),
      C.glass,
    );
    paint.add(
      shellPatch(
        body,
        -2.82,
        1.23,
        side === 1 ? -0.09 : Math.PI + 0.05,
        side === 1 ? -0.05 : Math.PI + 0.09,
        0.035,
      ),
      C.gold,
    );
    paint.tube(
      [side * 1.18, 1.32, -0.46],
      [side * 1.16, 2.69, -0.46],
      0.02,
      C.dark,
    );
    paint.tube(
      [side * 1.05, 1.29, -1.98],
      [side * 1.18, 1.32, -0.46],
      0.016,
      C.dark,
    );
    paint.box([0.045, 0.06, 0.27], [side * 1.195, 1.88, -0.65], C.dark);
    paint.box([0.038, 0.035, 0.21], [side * 1.222, 1.891, -0.65], C.metal);
    // Tubular skids with raised forward and aft ends. Lowest point = 0.
    paint.tube(
      [side * 1.31, 0.055, -2.26],
      [side * 1.31, 0.055, 1.42],
      0.055,
      C.dark,
      10,
    );
    paint.tube(
      [side * 1.31, 0.055, -2.26],
      [side * 1.31, 0.18, -2.68],
      0.055,
      C.dark,
      10,
    );
    paint.tube(
      [side * 1.31, 0.18, -2.68],
      [side * 1.31, 0.39, -2.96],
      0.055,
      C.dark,
      10,
    );
    paint.tube(
      [side * 1.31, 0.055, 1.42],
      [side * 1.31, 0.19, 1.74],
      0.055,
      C.dark,
      10,
    );
    for (const z of [-1.6, 0.69]) {
      paint.tube(
        [side * 0.69, 0.99, z],
        [side * 1.28, 0.13, z],
        0.065,
        C.metal,
      );
      paint.box([0.21, 0.05, 0.53], [side * 1.32, 0.12, z], C.metal);
    }
    paint.tube(
      [side * 0.69, 0.73, -1.6],
      [side * 1.02, 0.5, -1.6],
      0.041,
      C.dark,
    );
    paint.box([0.41, 0.06, 0.64], [side * 1.12, 0.5, -1.45], C.dark);
    // Engine intake grilles and exhaust shrouds.
    paint.ball([0.14, 0.19, 0.43], [side * 0.57, 2.86, 0.28], C.dark);
    for (let i = 0; i < 5; i++)
      paint.box(
        [0.035, 0.28, 0.027],
        [side * 0.677, 2.87, -0.01 + i * 0.14],
        C.metal,
      );
    paint.cylinder(0.13, 0.14, 0.43, [side * 0.41, 2.91, 1.11], C.dark, [
      Math.PI / 2,
      0,
      0,
    ]);
    // Tail stabilisers and red/green lens housings.
    paint.add(
      plate(
        [
          [0, -0.42],
          [1.34, -0.11],
          [1.39, 0.31],
          [0, 0.26],
        ],
        0.079,
      )
        .rotateX(-Math.PI / 2)
        .scale(side, 1, 1)
        .translate(0, 2.7, 4.15),
      C.white,
    );
    lights.ball(
      [0.08, 0.06, 0.095],
      [side * 1.38, 2.74, 4.12],
      side === -1 ? C.red : C.green,
      12,
    );
    addDecal(
      group,
      'COASTAL',
      [side * 1.169, 1.66, -0.17],
      [0.94, 0.15],
      (side * Math.PI) / 2,
      '#f8f2e8',
    );
  }
  paint.add(
    plate(
      [
        [5.4, 2.98],
        [5.79, 4.27],
        [6.32, 4.63],
        [6.67, 4.48],
        [6.53, 2.57],
        [6.11, 2.18],
      ],
      0.13,
    ).rotateY(-Math.PI / 2),
    C.orange,
  );
  paint.add(
    plate(
      [
        [5.97, 4.21],
        [6.31, 4.43],
        [6.51, 4.35],
        [6.45, 3.98],
      ],
      0.148,
    ).rotateY(-Math.PI / 2),
    C.white,
  );
  paint.tube([0, 2.86, -0.98], [0, 3.05, -2.2], 0.034, C.dark);
  paint.ball([0.14, 0.13, 0.12], [0, 1.22, -3.05], C.dark);
  lights.ball([0.105, 0.091, 0.07], [0, 1.22, -3.142], C.white, 12);
  lights.ball([0.067, 0.08, 0.065], [0, 4.65, 6.34], C.red, 12);
  // Articulated four-blade rotor, kept separate from its blur disc.
  const mainRotor = new THREE.Group();
  mainRotor.name = 'Main rotor';
  mainRotor.position.set(0, 3.72, -0.87);
  mainRotor.userData.spinAxis = 'y';
  mainRotor.userData.spinRate = 35;
  const rotor = new SolidBatch();
  rotor.cylinder(0.24, 0.24, 0.12, [0, 0, 0], C.metal);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    rotor.add(
      plate(
        [
          [0.18, -0.1],
          [1.02, -0.13],
          [5.53, -0.28],
          [5.69, 0.015],
          [5.39, 0.13],
          [0.9, 0.075],
        ],
        0.033,
      )
        .rotateX(-Math.PI / 2)
        .rotateY(a),
      C.dark,
    );
    rotor.box(
      [0.29, 0.04, 0.24],
      [Math.cos(a) * 5.43, 0.005, -Math.sin(a) * 5.43],
      C.gold,
      [0, a, 0],
    );
    rotor.tube(
      [Math.cos(a) * 0.16, -0.1, -Math.sin(a) * 0.16],
      [Math.cos(a) * 0.68, -0.02, -Math.sin(a) * 0.68],
      0.032,
      C.metal,
    );
  }
  mainRotor.add(rotor.finish('Main rotor blades and linkage'));
  const rotorBlur = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 5.66, 72),
    new THREE.MeshBasicMaterial({
      color: 0x667b80,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  rotorBlur.rotation.x = -Math.PI / 2;
  rotorBlur.position.copy(mainRotor.position);
  rotorBlur.position.y += 0.014;
  rotorBlur.name = 'Main rotor motion disc';
  rotorBlur.visible = false;
  // Tail rotor lies in Y/Z and spins about local X.
  const tail = new THREE.Group();
  tail.name = 'Tail rotor';
  tail.position.set(0.26, 3.13, 6.38);
  tail.userData.spinAxis = 'x';
  tail.userData.spinRate = 80;
  const tailBlades = new SolidBatch();
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    tailBlades.box(
      [0.045, 1.1, 0.12],
      [0, Math.cos(a) * 0.53, Math.sin(a) * 0.53],
      C.dark,
      [a, 0, 0],
    );
    tailBlades.box(
      [0.051, 0.15, 0.125],
      [0, Math.cos(a) * 0.98, Math.sin(a) * 0.98],
      C.gold,
      [a, 0, 0],
    );
  }
  tailBlades.ball([0.15, 0.115, 0.115], [0.035, 0, 0], C.metal);
  tail.add(tailBlades.finish('Tail rotor blades'));
  group.add(
    paint.finish('Helicopter painted structure'),
    glass.finish('Helicopter panoramic glazing', 'glass'),
    lights.finish('Helicopter navigation lenses', 'light'),
    mainRotor,
    tail,
    rotorBlur,
  );
  group.userData.dimensions = {
    length: 10.9,
    rotorDiameter: 11.4,
    height: 4.74,
  };
  return { group, propellers: [mainRotor, tail], rotorBlur };
}

const PANEL_WIDTH = 1.54,
  PANEL_HEIGHT = 0.54,
  PANEL_Y = -0.44,
  PANEL_Z = -1.32;
const GAUGE_R = 0.077;
const DIALS = {
  airspeed: [-0.5, -0.324],
  attitude: [-0.273, -0.324],
  altimeter: [-0.046, -0.324],
  power: [-0.5, -0.543],
  heading: [-0.273, -0.543],
  verticalSpeed: [-0.046, -0.543],
} as const;

function panelTexture(kind: AircraftKind): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = 1848;
  canvas.height = 648;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const sx = canvas.width / PANEL_WIDTH,
    sy = canvas.height / PANEL_HEIGHT;
  const x = (v: number) => (v + PANEL_WIDTH / 2) * sx;
  const y = (v: number) => (PANEL_Y + PANEL_HEIGHT / 2 - v) * sy;
  ctx.fillStyle = kind === 'seaplane' ? '#34433f' : '#303d42';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Fine panel edge and mounting screws provide scale without extra draw calls.
  ctx.strokeStyle = '#60716a';
  ctx.lineWidth = 3;
  ctx.strokeRect(9, 9, canvas.width - 18, canvas.height - 18);
  for (const px of [22, canvas.width / 2, canvas.width - 22])
    for (const py of [22, canvas.height - 22]) {
      ctx.fillStyle = '#97a4a0';
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#27312f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 4, py + 3);
      ctx.lineTo(px + 4, py - 3);
      ctx.stroke();
    }
  const dial = (
    pos: readonly [number, number],
    label: string,
    numbers: readonly string[],
    unit: string,
    full = false,
  ): void => {
    const cx = x(pos[0]),
      cy = y(pos[1]),
      r = GAUGE_R * sx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#080e12';
    ctx.beginPath();
    ctx.arc(0, 0, r + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#92a09e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#edf0dc';
    const sweep = full ? 360 : 280,
      start = full ? -90 : 130;
    for (let i = 0; i <= 40; i++) {
      const a = ((start + (sweep * i) / 40) * Math.PI) / 180;
      const outer = r * 0.89,
        inner = r * (i % 5 === 0 ? 0.7 : 0.8);
      ctx.lineWidth = i % 5 === 0 ? 2.6 : 1.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#edf0dd';
    ctx.font = '17px Arial, sans-serif';
    numbers.forEach((n, i) => {
      const a = ((start + (sweep * i) / (numbers.length - 1)) * Math.PI) / 180;
      ctx.fillText(n, Math.cos(a) * r * 0.57, Math.sin(a) * r * 0.57);
    });
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.fillStyle = '#a2b6ad';
    ctx.fillText(unit, 0, r * 0.33);
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillStyle = '#d9ded0';
    ctx.fillText(label, 0, r + 28);
    ctx.restore();
  };
  dial(
    DIALS.airspeed,
    'AIRSPEED',
    ['0', '40', '80', '120', '160', '200'],
    'KNOTS',
  );
  dial(DIALS.attitude, 'ATTITUDE', [], '', true);
  dial(
    DIALS.altimeter,
    'ALTIMETER',
    ['0', '2', '4', '6', '8', '0'],
    'FEET',
    true,
  );
  dial(
    DIALS.power,
    kind === 'helicopter' ? 'ROTOR RPM' : 'ENGINE RPM',
    ['0', '1', '2', '3', '4'],
    'RPM × 1000',
  );
  dial(DIALS.heading, 'HEADING', [], '', true);
  dial(
    DIALS.verticalSpeed,
    'VERT SPEED',
    ['−2', '−1', '0', '1', '2'],
    '1000 FT / MIN',
  );
  // A compact original avionics stack: radio, navigation display, annunciators.
  const ax = x(0.132),
    ay = y(-0.219),
    aw = sx * 0.564;
  ctx.fillStyle = '#182321';
  ctx.fillRect(ax, ay, aw, sy * 0.432);
  ctx.strokeStyle = '#697970';
  ctx.lineWidth = 3;
  ctx.strokeRect(ax, ay, aw, sy * 0.432);
  const labels = ['COM 1  123.450', 'NAV 1  110.700'];
  labels.forEach((label, i) => {
    ctx.fillStyle = '#071813';
    ctx.fillRect(ax + 15, ay + 16 + i * 49, aw - 30, 43);
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#98e9aa';
    ctx.textAlign = 'left';
    ctx.fillText(label, ax + 31, ay + 46 + i * 49);
  });
  const nx = ax + 16,
    ny = ay + 128,
    nw = aw - 32,
    nh = 190;
  ctx.fillStyle = '#0c252b';
  ctx.fillRect(nx, ny, nw, nh);
  ctx.strokeStyle = '#315852';
  ctx.lineWidth = 2;
  for (let gx = 0; gx <= 8; gx++) {
    ctx.beginPath();
    ctx.moveTo(nx + (gx * nw) / 8, ny);
    ctx.lineTo(nx + (gx * nw) / 8, ny + nh);
    ctx.stroke();
  }
  for (let gy = 0; gy <= 4; gy++) {
    ctx.beginPath();
    ctx.moveTo(nx, ny + (gy * nh) / 4);
    ctx.lineTo(nx + nw, ny + (gy * nh) / 4);
    ctx.stroke();
  }
  ctx.fillStyle = '#4a7050';
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(nx + 160, ny);
  ctx.lineTo(nx + 203, ny + 42);
  ctx.lineTo(nx + 151, ny + 72);
  ctx.lineTo(nx + 282, ny + 116);
  ctx.lineTo(nx + 375, ny + 148);
  ctx.lineTo(nx + nw, ny + 113);
  ctx.lineTo(nx + nw, ny + nh);
  ctx.lineTo(nx, ny + nh);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#dec475';
  ctx.lineWidth = 3;
  ctx.setLineDash([11, 8]);
  ctx.beginPath();
  ctx.moveTo(nx + 83, ny + 162);
  ctx.lineTo(nx + nw / 2, ny + 84);
  ctx.lineTo(nx + nw - 56, ny + 55);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f7e4a0';
  ctx.beginPath();
  ctx.moveTo(nx + nw / 2, ny + 65);
  ctx.lineTo(nx + nw / 2 - 12, ny + 101);
  ctx.lineTo(nx + nw / 2, ny + 93);
  ctx.lineTo(nx + nw / 2 + 12, ny + 101);
  ctx.closePath();
  ctx.fill();
  ctx.font = '18px monospace';
  ctx.fillStyle = '#cedbd0';
  ctx.fillText('VANCOUVER HARBOUR', nx + 13, ny + 27);
  ctx.font = '15px monospace';
  ctx.fillText('N ↑   •   2 NM', nx + 13, ny + nh - 10);
  ['FUEL', 'OIL', 'ELEC', 'PITOT'].forEach((label, i) => {
    const bx = ax + 26 + (i * (aw - 39)) / 4;
    ctx.fillStyle = i === 0 ? '#d4a75e' : '#6dbe93';
    ctx.fillRect(bx, ay + 345, 21, 12);
    ctx.fillStyle = '#b8c9b7';
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText(label, bx - 1, ay + 377);
  });
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.fillStyle = '#dcd9c5';
  ctx.textAlign = 'center';
  ctx.fillText(
    kind === 'helicopter'
      ? 'COASTAL  /  UTILITY FLIGHT'
      : 'PACIFIC  /  FLOATPLANE',
    x(0.409),
    y(-0.674),
  );
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

function needle(
  position: readonly [number, number],
  colour = C.white,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(position[0], position[1], PANEL_Z + 0.018);
  const batch = new SolidBatch();
  batch.add(
    plate(
      [
        [0, 0.065],
        [-0.005, -0.016],
        [0.005, -0.016],
      ],
      0.002,
    ),
    colour,
  );
  batch.cylinder(
    0.008,
    0.008,
    0.003,
    [0, 0, 0.003],
    C.metal,
    [Math.PI / 2, 0, 0],
    16,
  );
  group.add(batch.finish('Instrument pointer', 'light'));
  return group;
}

function compassTexture(): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.fillStyle = '#101b1e';
  ctx.fillRect(0, 0, 384, 384);
  ctx.translate(192, 192);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ebeee0';
  for (let i = 0; i < 36; i++) {
    const a = (i * Math.PI) / 18;
    ctx.save();
    ctx.rotate(a);
    ctx.strokeStyle = '#d9dfcf';
    ctx.lineWidth = i % 3 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -163);
    ctx.lineTo(0, i % 3 === 0 ? -142 : -151);
    ctx.stroke();
    if (i % 3 === 0) {
      ctx.font = i % 9 === 0 ? 'bold 30px Arial' : '23px Arial';
      ctx.fillText(
        i % 9 === 0 ? ['N', 'E', 'S', 'W'][i / 9] : String(i),
        0,
        -112,
      );
    }
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildCockpit(kind: AircraftKind): {
  cockpit: THREE.Group;
  stick: THREE.Object3D;
  instruments: AircraftInstruments;
} {
  const cockpit = new THREE.Group();
  cockpit.name = `${kind} camera cockpit`;
  const shell = new SolidBatch(),
    details = new SolidBatch();
  const trim = kind === 'seaplane' ? C.teal : C.orange;
  // Surrounding coaming and door posts stay out of the central horizon view.
  shell.box([1.67, 0.085, 0.31], [0, -0.135, -1.418], C.dark, [-0.08, 0, 0]);
  shell.box([1.65, 0.62, 0.13], [0, -0.474, -1.41], C.black, [-0.045, 0, 0]);
  shell.box([1.62, 0.075, 0.11], [0, -0.74, -1.313], C.metal);
  for (const side of [-1, 1]) {
    shell.tube(
      [side * 0.855, -0.83, -0.48],
      [side * 0.829, -0.25, -1.03],
      0.035,
      C.dark,
    );
    shell.tube(
      [side * 0.829, -0.25, -1.03],
      [side * 0.658, 0.618, -0.742],
      0.036,
      trim,
    );
    shell.tube(
      [side * 0.667, 0.601, -0.75],
      [side * 0.795, 0.7, 0.25],
      0.037,
      C.dark,
    );
    shell.tube(
      [side * 0.84, -0.26, -1.0],
      [side * 0.92, -0.32, 0.29],
      0.033,
      C.dark,
    );
    shell.box([0.18, 0.12, 1.04], [side * 0.87, -0.39, -0.16], C.dark);
    details.box([0.046, 0.017, 0.17], [side * 0.837, -0.309, -0.19], C.metal);
    // Seat shoulders at the edges of the frame, plus stitched bolsters and belt.
    shell.ball([0.25, 0.29, 0.18], [side * 0.77, -0.91, 0.03], C.seat, 14);
    details.tube(
      [side * 0.62, -0.79, -0.062],
      [side * 0.81, -0.995, -0.116],
      0.021,
      C.rubber,
    );
    details.tube(
      [side * 0.735, -0.682, -0.08],
      [side * 0.852, -0.992, -0.109],
      0.004,
      C.gold,
    );
  }
  // Overhead header and sun visors are high, leaving forward visibility open.
  shell.tube([-0.68, 0.62, -0.744], [0.68, 0.62, -0.744], 0.049, C.dark);
  shell.box([0.4, 0.1, 0.038], [-0.386, 0.565, -0.731], C.dark, [0.22, 0, 0]);
  shell.box([0.4, 0.1, 0.038], [0.386, 0.565, -0.731], C.dark, [0.22, 0, 0]);
  // The centre console includes switches, throttle/collective base and pedal hints.
  shell.box([0.35, 0.4, 0.45], [0.235, -0.779, -0.934], C.dark, [-0.08, 0, 0]);
  for (let i = 0; i < 5; i++) {
    const xx = 0.107 + i * 0.063;
    details.cylinder(
      0.015,
      0.015,
      0.005,
      [xx, -0.202, -1.247],
      C.metal,
      [Math.PI / 2, 0, 0],
      12,
    );
    details.tube(
      [xx, -0.203, -1.239],
      [xx, -0.183, -1.217],
      0.0048,
      C.white,
      6,
    );
  }
  for (const x of [-0.56, -0.31])
    details.box([0.15, 0.026, 0.14], [x, -1.1, -0.93], C.metal, [-0.37, 0, 0]);
  const panelMap = panelTexture(kind);
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({
      map: panelMap ?? null,
      color: panelMap ? 0xffffff : 0x3d4b45,
      toneMapped: false,
    }),
  );
  panel.position.set(0, PANEL_Y, PANEL_Z);
  panel.name = 'Six-pack instruments and avionics';
  const airspeedNeedle = needle(DIALS.airspeed),
    altimeterNeedle = needle(DIALS.altimeter);
  const verticalSpeedNeedle = needle(DIALS.verticalSpeed),
    powerNeedle = needle(DIALS.power, C.gold);
  // Heading card rotates inside a stationary bezel; the lubber line stays fixed.
  const headingCard = new THREE.Group();
  headingCard.position.set(...DIALS.heading, PANEL_Z + 0.014);
  const compassMap = compassTexture();
  headingCard.add(
    new THREE.Mesh(
      new THREE.CircleGeometry(GAUGE_R * 0.91, 48),
      new THREE.MeshBasicMaterial({
        map: compassMap ?? null,
        color: compassMap ? 0xffffff : C.dark,
        toneMapped: false,
      }),
    ),
  );
  details.tube(
    [DIALS.heading[0], DIALS.heading[1] + 0.064, PANEL_Z + 0.022],
    [DIALS.heading[0], DIALS.heading[1] + 0.087, PANEL_Z + 0.022],
    0.002,
    C.gold,
    6,
  );
  details.tube(
    [DIALS.heading[0] - 0.02, DIALS.heading[1], PANEL_Z + 0.022],
    [DIALS.heading[0] + 0.02, DIALS.heading[1], PANEL_Z + 0.022],
    0.002,
    C.gold,
    6,
  );
  // Artificial horizon uses a shallow sky/earth sphere. Pitch rotates the sphere,
  // bank rotates its parent; no per-frame canvas upload is required.
  const attitudeRoll = new THREE.Group();
  attitudeRoll.position.set(...DIALS.attitude, PANEL_Z + 0.013);
  const attitudePitch = new THREE.Group();
  const skyEarth = new THREE.SphereGeometry(GAUGE_R * 0.91, 40, 24);
  const count = skyEarth.getAttribute('position').count,
    colours = new Float32Array(count * 3);
  const sky = new THREE.Color(0x347c9b),
    earth = new THREE.Color(0xa16b42);
  for (let i = 0; i < count; i++) {
    const colour = skyEarth.getAttribute('position').getY(i) >= 0 ? sky : earth;
    colours.set([colour.r, colour.g, colour.b], i * 3);
  }
  skyEarth.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const attitudeSphere = new THREE.Mesh(
    skyEarth,
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  );
  attitudePitch.add(attitudeSphere);
  attitudeRoll.add(attitudePitch);
  // Flatten at the outer group so the rotating sphere remains behind the fixed mark.
  attitudeRoll.scale.z = 0.06;
  const horizonMarks = new SolidBatch();
  for (const s of [-1, 1])
    horizonMarks.tube(
      [s * 0.011, 0, 0.071],
      [s * 0.052, 0, 0.071],
      0.0012,
      C.white,
      6,
    );
  for (const yy of [-0.027, -0.014, 0.014, 0.027])
    horizonMarks.tube(
      [-0.014, yy, Math.sqrt(0.069 ** 2 - yy ** 2)],
      [0.014, yy, Math.sqrt(0.069 ** 2 - yy ** 2)],
      0.0009,
      C.white,
      6,
    );
  attitudePitch.add(horizonMarks.finish('Attitude pitch bars', 'light'));
  details.tube(
    [DIALS.attitude[0] - 0.042, DIALS.attitude[1], PANEL_Z + 0.027],
    [DIALS.attitude[0] - 0.014, DIALS.attitude[1], PANEL_Z + 0.027],
    0.002,
    C.gold,
    6,
  );
  details.tube(
    [DIALS.attitude[0] + 0.014, DIALS.attitude[1], PANEL_Z + 0.027],
    [DIALS.attitude[0] + 0.042, DIALS.attitude[1], PANEL_Z + 0.027],
    0.002,
    C.gold,
    6,
  );
  details.tube(
    [DIALS.attitude[0] - 0.014, DIALS.attitude[1], PANEL_Z + 0.027],
    [DIALS.attitude[0], DIALS.attitude[1] - 0.007, PANEL_Z + 0.027],
    0.002,
    C.gold,
    6,
  );
  details.tube(
    [DIALS.attitude[0], DIALS.attitude[1] - 0.007, PANEL_Z + 0.027],
    [DIALS.attitude[0] + 0.014, DIALS.attitude[1], PANEL_Z + 0.027],
    0.002,
    C.gold,
    6,
  );
  // A control object is independent so the caller can animate bank/pitch feedback.
  const stick = new THREE.Group();
  stick.name = kind === 'seaplane' ? 'Pilot yoke' : 'Pilot cyclic';
  const controls = new SolidBatch();
  if (kind === 'seaplane') {
    stick.position.set(-0.35, -0.58, -0.93);
    controls.tube([0, 0, -0.31], [0, 0, 0], 0.023, C.metal, 12);
    controls.box([0.19, 0.055, 0.055], [0, 0, 0], C.dark);
    for (const side of [-1, 1]) {
      controls.tube(
        [side * 0.07, -0.006, 0],
        [side * 0.135, 0.065, 0.007],
        0.017,
        C.dark,
        12,
      );
      controls.tube(
        [side * 0.135, 0.065, 0.007],
        [side * 0.135, 0.125, 0.007],
        0.022,
        C.dark,
        12,
      );
      controls.ball(
        [0.023, 0.011, 0.025],
        [side * 0.135, 0.13, 0.007],
        C.metal,
        10,
      );
    }
    controls.box([0.055, 0.04, 0.006], [0, 0.001, 0.032], C.teal);
    details.tube(
      [0.218, -0.585, -1.06],
      [0.22, -0.431, -1.02],
      0.009,
      C.metal,
      8,
    );
    details.ball([0.026, 0.022, 0.029], [0.22, -0.423, -1.02], C.dark, 12);
    details.tube(
      [0.291, -0.585, -1.06],
      [0.29, -0.463, -1.02],
      0.009,
      C.metal,
      8,
    );
    details.ball([0.025, 0.022, 0.029], [0.29, -0.455, -1.02], C.red, 12);
  } else {
    stick.position.set(-0.33, -0.8, -0.87);
    controls.tube([0, 0, 0], [0.017, 0.242, -0.08], 0.016, C.metal, 12);
    controls.tube(
      [0.017, 0.242, -0.08],
      [0.017, 0.328, -0.04],
      0.026,
      C.dark,
      12,
    );
    controls.ball([0.034, 0.035, 0.031], [0.017, 0.337, -0.037], C.dark, 12);
    controls.ball([0.009, 0.007, 0.006], [0.035, 0.354, -0.011], C.red, 10);
    controls.box([0.027, 0.008, 0.015], [0.002, 0.36, -0.039], C.metal);
    // Collective lever sits at the left edge of the pilot seat.
    details.tube(
      [-0.686, -0.966, -0.17],
      [-0.689, -0.727, -0.45],
      0.017,
      C.metal,
      10,
    );
    details.tube(
      [-0.689, -0.727, -0.45],
      [-0.689, -0.684, -0.518],
      0.026,
      C.dark,
      10,
    );
  }
  stick.add(
    controls.finish(
      kind === 'seaplane' ? 'Yoke grip and column' : 'Cyclic grip and column',
    ),
  );
  cockpit.add(
    shell.finish('Cockpit enclosure and coaming'),
    details.finish('Cockpit hardware'),
    panel,
    airspeedNeedle,
    altimeterNeedle,
    verticalSpeedNeedle,
    powerNeedle,
    headingCard,
    attitudeRoll,
    stick,
  );
  cockpit.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
  const instruments = {
    airspeedNeedle,
    altimeterNeedle,
    verticalSpeedNeedle,
    powerNeedle,
    headingCard,
    attitudeRoll,
    attitudePitch,
  };
  updateAircraftInstruments(instruments, {
    airspeedKnots: 0,
    altitudeMetres: 0,
    verticalSpeedMetresPerSecond: 0,
    pitch: 0,
    roll: 0,
    heading: 0,
    power: 0,
  });
  return { cockpit, stick, instruments };
}

/** Update geometric pointers only. Heading/pitch/roll in radians; call each frame. */
export function updateAircraftInstruments(
  instruments: AircraftInstruments,
  state: AircraftInstrumentState,
): void {
  const clamp = THREE.MathUtils.clamp;
  instruments.airspeedNeedle.rotation.z = THREE.MathUtils.degToRad(
    140 - clamp(state.airspeedKnots / 200, 0, 1) * 280,
  );
  instruments.altimeterNeedle.rotation.z =
    -((state.altitudeMetres * 3.28084) / 1000) * Math.PI * 2;
  instruments.verticalSpeedNeedle.rotation.z =
    -clamp((state.verticalSpeedMetresPerSecond * 196.8504) / 2000, -1, 1) *
    THREE.MathUtils.degToRad(140);
  instruments.powerNeedle.rotation.z = THREE.MathUtils.degToRad(
    140 - clamp(state.power, 0, 1) * 280,
  );
  instruments.headingCard.rotation.z = state.heading;
  instruments.attitudeRoll.rotation.z = state.roll;
  instruments.attitudePitch.rotation.x = clamp(
    state.pitch,
    -Math.PI / 2,
    Math.PI / 2,
  );
}

function disposeAircraft(group: THREE.Group, cockpit: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  for (const root of [group, cockpit])
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const list = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture) textures.add(value);
      }
    });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  group.removeFromParent();
  cockpit.removeFromParent();
}

export function makeAircraft(kind: AircraftKind): AircraftAsset {
  const exterior = kind === 'helicopter' ? buildHelicopter() : buildSeaplane();
  const interior = buildCockpit(kind);
  return {
    ...exterior,
    ...interior,
    dispose: () => disposeAircraft(exterior.group, interior.cockpit),
  };
}

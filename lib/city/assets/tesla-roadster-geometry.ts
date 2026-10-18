import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  TESLA_ROADSTER_ANCHORS,
  TESLA_ROADSTER_THRUSTERS,
  TESLA_ROADSTER_FANS,
  type TeslaModelQuality,
} from './tesla-roadster-contract';

type P = [number, number, number];
export type TeslaMaterialRole =
  | 'paint'
  | 'hood'
  | 'carbon'
  | 'rubber'
  | 'white'
  | 'suede'
  | 'titanium'
  | 'glass'
  | 'headlight'
  | 'tail'
  | 'display'
  | 'accent';
export type TeslaMaterials = Record<TeslaMaterialRole, THREE.Material>;
export interface TeslaGeometryLevel {
  root: THREE.Group;
  steering: THREE.Group;
  wheelSteers: THREE.Group[];
  wheelRolls: THREE.Group[];
  fans: THREE.Group[];
  wing: THREE.Group;
  triangles: number;
  meshes: number;
}

/** Original manually authored surfaces; no Tesla mesh, CAD or texture is used. */
class Parts {
  private batches = new Map<TeslaMaterialRole, THREE.BufferGeometry[]>();
  constructor(
    private parent: THREE.Group,
    private materials: TeslaMaterials,
    private segments: number,
  ) {}

  add(
    role: TeslaMaterialRole,
    geometry: THREE.BufferGeometry,
    p: P = [0, 0, 0],
    r: P = [0, 0, 0],
  ) {
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...p),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const attribute of Object.keys(flat.attributes))
      if (!['position', 'normal'].includes(attribute))
        flat.deleteAttribute(attribute);
    if (!flat.hasAttribute('normal')) flat.computeVertexNormals();
    const batch = this.batches.get(role) ?? [];
    batch.push(flat);
    this.batches.set(role, batch);
  }

  box(role: TeslaMaterialRole, size: P, p: P, r: P = [0, 0, 0]) {
    this.add(role, new THREE.BoxGeometry(...size), p, r);
  }

  oval(role: TeslaMaterialRole, size: P, p: P, r: P = [0, 0, 0]) {
    const geometry = new THREE.SphereGeometry(
      1,
      this.segments,
      Math.max(5, this.segments / 2),
    );
    geometry.scale(...size);
    this.add(role, geometry, p, r);
  }

  beam(role: TeslaMaterialRole, a: P, b: P, radius: number) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b),
      delta = end.clone().sub(start),
      geometry = new THREE.CylinderGeometry(
        radius,
        radius,
        delta.length(),
        Math.max(5, this.segments / 3),
      );
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    this.add(role, geometry, start.lerp(end, 0.5).toArray() as P);
  }

  surface(
    role: TeslaMaterialRole,
    rows: number,
    columns: number,
    point: (v: number, u: number) => P,
    reverse = false,
  ) {
    const positions: number[] = [],
      indices: number[] = [];
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++)
        positions.push(...point(j / rows, i / columns));
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++) {
        const a = j * (columns + 1) + i,
          b = a + 1,
          c = a + columns + 1,
          d = c + 1;
        indices.push(...(reverse ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    this.add(role, geometry);
  }

  finish(name: string) {
    for (const [role, pieces] of this.batches) {
      const merged = mergeGeometries(pieces);
      pieces.forEach((geometry) => geometry.dispose());
      if (!merged) throw new Error(`Tesla geometry could not merge ${role}`);
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.materials[role]);
      mesh.name = `${name}:${role}`;
      mesh.userData.semantic_role = role;
      mesh.castShadow = role !== 'glass' && role !== 'headlight';
      mesh.receiveShadow = role !== 'glass';
      if (role === 'glass') mesh.userData.excludeFromSSAO = true;
      this.parent.add(mesh);
    }
    this.batches.clear();
  }
}

// z, half-width, shoulder, hood/deck centre. Sharp patch boundaries preserve
// the revised 2026 faceted wedge rather than the rounded 2017 red concept.
const SECTIONS = [
  [-2.3, 0.87, 0.76, 0.71],
  [-2.12, 0.99, 0.84, 0.79],
  [-1.39, 1.02, 0.9, 0.86],
  [-0.8, 0.95, 0.87, 0.82],
  [0, 0.91, 0.82, 0.79],
  [0.7, 0.96, 0.94, 0.83],
  [1.39, 1.02, 0.89, 0.68],
  [2.05, 0.98, 0.71, 0.56],
  [2.3, 0.89, 0.6, 0.51],
] as const;

function section(z: number) {
  const end = SECTIONS.findIndex((p) => p[0] >= z),
    i = Math.max(1, end < 0 ? SECTIONS.length - 1 : end),
    a = SECTIONS[i - 1],
    b = SECTIONS[i],
    t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
  return {
    width: THREE.MathUtils.lerp(a[1], b[1], t),
    shoulder: THREE.MathUtils.lerp(a[2], b[2], t),
    center: THREE.MathUtils.lerp(a[3], b[3], t),
  };
}

function arch(z: number) {
  const dz = Math.min(Math.abs(z - 1.39), Math.abs(z + 1.39));
  return dz < 0.39 ? 0.35 + Math.sqrt(0.39 ** 2 - dz ** 2) : 0.2;
}

function hoodHalfWidth(z: number) {
  return 0.61 + THREE.MathUtils.clamp((z - 0.7) / 1.6, 0, 1) * 0.13;
}

function fenderY(z: number, x: number) {
  const s = section(z),
    inner = z > 0.7 ? hoodHalfWidth(z) : z < -1.57 ? 0.76 : 0.77,
    innerY = z >= -1.57 && z <= 0.7 ? 0.855 : s.center,
    top = Math.max(s.shoulder, arch(z) + 0.035),
    t = THREE.MathUtils.clamp((Math.abs(x) - inner) / (s.width - inner), 0, 1);
  // The broad inner facet breaks sharply into a raised outer wing.
  const facet =
    t <= 2 / 3
      ? innerY + Math.min(0.025, top - innerY) * t * 1.5
      : THREE.MathUtils.lerp(
          innerY + Math.min(0.025, top - innerY),
          top,
          (t - 2 / 3) * 3,
        );
  // The inboard part of a raised front wing must also clear the wide tyre;
  // an outer-only arch would let the tread protrude through the chine.
  return Math.max(facet, arch(z) + 0.014 - Math.max(0, 0.79 - Math.abs(x)) * 2);
}

function lampPoint(v: number, u: number, sign: number, inset: number): P {
  const z = 2.13 - v * 0.4,
    x = THREE.MathUtils.lerp(0.735 + v * 0.12, 0.895 + v * 0.01, u);
  return [sign * x, fenderY(z, x) + inset, z];
}

export function buildTeslaRoadsterLevel(
  quality: TeslaModelQuality,
  materials: TeslaMaterials,
): TeslaGeometryLevel {
  const detail = quality === 'high' ? 3 : quality === 'medium' ? 2 : 1,
    around = detail === 3 ? 32 : detail === 2 ? 20 : 12,
    along = detail * 20,
    root = new THREE.Group(),
    body = new Parts(root, materials, around);
  root.name = `Tesla Roadster Rocket 2026:${quality}`;

  // Hood centre and distinct side chines are separate crease patches.
  body.surface('hood', along / 2, detail * 5, (v, u) => {
    const z = 0.7 + v * 1.6,
      s = section(z),
      x = u * 2 - 1;
    return [x * hoodHalfWidth(z), s.center + 0.012 * x * x, z];
  });
  // Rear canopy leaves a real cabin opening; deck begins behind that opening.
  body.surface('paint', detail * 8, detail * 6, (v, u) => {
    const z = -2.3 + v * 0.73,
      s = section(z),
      x = u * 2 - 1;
    return [x * 0.76, s.center + 0.012 * x * x, z];
  });
  for (const sign of [-1, 1]) {
    // A narrow real panel gap outlines the central rear-narrow/front-wide hood.
    for (let piece = 0; piece < detail * 6; piece++) {
      const za = 0.7 + (piece / (detail * 6)) * 1.6,
        zb = 0.7 + ((piece + 1) / (detail * 6)) * 1.6;
      body.beam(
        'carbon',
        [sign * hoodHalfWidth(za), section(za).center + 0.013, za],
        [sign * hoodHalfWidth(zb), section(zb).center + 0.013, zb],
        0.0018,
      );
    }
    // Analytic strips meet the lamp aperture exactly; coarse-grid cell masking
    // would create jagged black teeth around the recess at lower levels.
    for (const [start, end, strip] of [
      [-2.3, 0.7, 'full'],
      [0.7, 1.73, 'full'],
      [1.73, 2.13, 'inner'],
      [1.73, 2.13, 'outer'],
      [2.13, 2.3, 'full'],
    ] as const)
      body.surface(
        'paint',
        Math.max(2, Math.ceil((end - start) * detail * 10)),
        detail * 3,
        (v, u) => {
          const z = THREE.MathUtils.lerp(start, end, v),
            s = section(z),
            lampT = THREE.MathUtils.clamp((2.13 - z) / 0.4, 0, 1),
            inner =
              strip === 'outer'
                ? 0.895 + lampT * 0.01
                : z > 0.7
                  ? hoodHalfWidth(z)
                  : z < -1.57
                    ? 0.76
                    : 0.77,
            outer = strip === 'inner' ? 0.735 + lampT * 0.12 : s.width,
            x = THREE.MathUtils.lerp(inner, outer, u);
          return [sign * x, fenderY(z, x), z];
        },
        sign < 0,
      );
    // The lower boundary follows each wheel opening, leaving actual air behind it.
    body.surface(
      'paint',
      along * 2,
      detail * 2,
      (v, u) => {
        const z = -2.3 + 4.6 * v,
          s = section(z),
          lower = arch(z),
          top = Math.max(s.shoulder, lower + 0.035);
        return [
          sign * (s.width - 0.026 * Math.sin(u * Math.PI)),
          THREE.MathUtils.lerp(top, lower, u),
          z,
        ];
      },
      sign < 0,
    );
    body.box('carbon', [0.11, 0.14, 1.93], [sign * 0.895, 0.24, 0]);
    // Flush panels and angular side inlet, not a decorative body covering wheels.
    body.surface(
      'carbon',
      2,
      2,
      (v, u) => [
        sign * (0.95 + 0.014 * u),
        0.33 + 0.33 * u,
        -0.9 + v * (0.22 - 0.12 * u),
      ],
      sign < 0,
    );
    body.beam(
      'carbon',
      [sign * 0.932, 0.33, 0.62],
      [sign * 0.943, 0.79, 0.71],
      0.0035,
    );
    body.beam(
      'carbon',
      [sign * 0.948, 0.34, -0.73],
      [sign * 0.95, 0.8, -0.83],
      0.0035,
    );
    body.box('titanium', [0.01, 0.022, 0.16], [sign * 0.945, 0.773, -0.52]);
    body.box('accent', [0.012, 0.015, 0.075], [sign * 0.991, 0.69, 0.94]);
    // Fine wheel-arch strip follows the opening instead of intersecting its tyre.
    for (const axle of [-1.39, 1.39])
      body.surface(
        'titanium',
        around,
        1,
        (v, u) => {
          const theta = v * Math.PI,
            z = axle + Math.cos(theta) * (0.391 + 0.009 * u),
            s = section(z);
          return [
            sign * (s.width + 0.002),
            0.35 + Math.sin(theta) * (0.391 + 0.009 * u),
            z,
          ];
        },
        sign > 0,
      );
  }

  // Nose: central dark intake and shallow triangular hidden headlights.
  body.box('carbon', [1.49, 0.18, 0.15], [0, 0.375, 2.22]);
  body.box('carbon', [1.8, 0.035, 0.28], [0, 0.202, 2.15]);
  for (const sign of [-1, 1]) {
    body.surface(
      'paint',
      detail * 5,
      detail * 4,
      (v, u) => [
        sign * (0.74 + 0.045 * v + u * (0.2 - 0.1 * v)),
        THREE.MathUtils.lerp(0.51 + 0.13 * u, 0.2 + 0.012 * u, v) +
          0.018 * Math.sin(v * Math.PI),
        2.3 - 0.1 * u - 0.1 * v * v + 0.05 * Math.sin(v * Math.PI),
      ],
      sign < 0,
    );
    // Real cut-out in the chine, with a dark floor and walls below the paint.
    body.surface(
      'carbon',
      detail * 5,
      detail * 4,
      (v, u) => lampPoint(v, u, sign, -0.03),
      sign > 0,
    );
    body.surface(
      'headlight',
      detail * 5,
      detail * 4,
      (v, u) => lampPoint(0.06 + v * 0.88, 0.11 + u * 0.75, sign, -0.022),
      sign > 0,
    );
    for (const edge of [0, 1]) {
      body.surface(
        'carbon',
        detail * 5,
        1,
        (v, u) => lampPoint(v, edge, sign, -0.03 * u),
        sign > 0,
      );
      body.surface(
        'carbon',
        1,
        detail * 4,
        (v, u) => lampPoint(edge, u, sign, -0.03 * v),
        sign < 0,
      );
    }
  }
  body.surface('paint', 1, detail * 6, (v, u) => [
    (u * 2 - 1) * 0.74,
    0.51 - 0.03 * v,
    2.3 + 0.02 * v,
  ]);
  body.box('titanium', [1.46, 0.007, 0.012], [0, 0.525, 2.304]);

  // Continuous full-width taillight, four rear nozzles and diffuser fins.
  body.box('carbon', [1.74, 0.22, 0.14], [0, 0.565, -2.23]);
  body.box('tail', [1.755, 0.025, 0.016], [0, 0.748, -2.307]);
  body.box('titanium', [0.41, 0.14, 0.018], [0, 0.585, -2.314]);
  body.box('carbon', [0.375, 0.11, 0.005], [0, 0.585, -2.327]);
  for (const x of [-0.76, -0.43, 0.43, 0.76])
    body.box('carbon', [0.026, 0.18, 0.58], [x, 0.22, -1.98], [-0.15, 0, 0]);
  body.box('carbon', [1.6, 0.045, 3.86], [0, 0.255, 0]);
  body.box('rubber', [0.033, 0.075, 3.46], [-0.78, 0.193, 0]);
  body.box('rubber', [0.033, 0.075, 3.46], [0.78, 0.193, 0]);

  const nozzle = (point: P, direction: P, radius: number) => {
    const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(...direction),
      ),
      geometry = new THREE.CylinderGeometry(
        radius * 1.15,
        radius * 0.62,
        0.105,
        around,
        1,
        true,
      ),
      ring = new THREE.TorusGeometry(
        radius,
        0.009,
        Math.max(4, detail * 3),
        around,
      );
    geometry.applyQuaternion(q);
    ring.rotateX(Math.PI / 2);
    ring.applyQuaternion(q);
    body.add('titanium', geometry, point);
    body.add('titanium', ring, [
      point[0] + direction[0] * 0.05,
      point[1] + direction[1] * 0.05,
      point[2] + direction[2] * 0.05,
    ]);
    const dark = new THREE.CircleGeometry(radius * 0.67, around);
    dark.rotateX(-Math.PI / 2);
    dark.applyQuaternion(q);
    body.add('carbon', dark, [
      point[0] - direction[0] * 0.049,
      point[1] - direction[1] * 0.049,
      point[2] - direction[2] * 0.049,
    ]);
  };
  for (const port of TESLA_ROADSTER_THRUSTERS)
    nozzle([...port.position], [...port.direction], port.radius);

  body.surface('carbon', 1, detail * 8, (v, u) => [
    (u * 2 - 1) * 0.87,
    THREE.MathUtils.lerp(0.81, 0.855, v),
    THREE.MathUtils.lerp(0.68, 0.735, v),
  ]);
  // Gold canopy: original smooth patches inside a sharply creased white body.
  body.surface(
    'glass',
    detail * 7,
    detail * 12,
    (v, u) => {
      const x = u * 2 - 1;
      return [
        x * THREE.MathUtils.lerp(0.87, 0.625, v),
        THREE.MathUtils.lerp(0.855, 1.215, v) + 0.018 * (1 - x * x),
        THREE.MathUtils.lerp(0.735, -0.12, v),
      ];
    },
    true,
  );
  body.surface(
    'carbon',
    detail * 8,
    detail * 10,
    (v, u) => {
      const x = u * 2 - 1;
      return [
        x * THREE.MathUtils.lerp(0.625, 0.595, v),
        1.215 - 0.055 * v + 0.023 * (1 - x * x),
        -0.12 - v * 0.82,
      ];
    },
    true,
  );
  body.surface('suede', detail * 8, detail * 10, (v, u) => {
    const x = u * 2 - 1;
    return [
      x * THREE.MathUtils.lerp(0.625, 0.595, v),
      1.205 - 0.055 * v + 0.023 * (1 - x * x),
      -0.12 - v * 0.82,
    ];
  });
  body.surface(
    'glass',
    detail * 5,
    detail * 9,
    (v, u) => {
      const x = u * 2 - 1;
      return [
        x * THREE.MathUtils.lerp(0.595, 0.515, v),
        THREE.MathUtils.lerp(1.16, 0.87, v),
        -0.94 - v * 0.63,
      ];
    },
    true,
  );
  for (const sign of [-1, 1]) {
    body.surface(
      'glass',
      detail * 6,
      detail * 6,
      (v, u) => {
        const z = -1.45 + v * 2.185,
          topY =
            z < -0.94
              ? 0.855 + ((z + 1.45) * 0.305) / 0.51
              : z > -0.12
                ? 1.215 - ((z + 0.12) * 0.36) / 0.855
                : 1.16 + ((z + 0.94) * 0.055) / 0.82,
          topX =
            z < -0.94
              ? 0.77 - ((z + 1.45) * 0.175) / 0.51
              : z > -0.12
                ? 0.625 + ((z + 0.12) * 0.245) / 0.855
                : 0.595 + ((z + 0.94) * 0.03) / 0.82;
        return [
          sign *
            THREE.MathUtils.lerp(
              THREE.MathUtils.lerp(0.772, 0.87, (z + 1.45) / 2.185),
              topX,
              u,
            ),
          THREE.MathUtils.lerp(0.855, topY, u),
          z,
        ];
      },
      sign > 0,
    );
    body.beam(
      'titanium',
      [sign * 0.875, 0.851, 0.74],
      [sign * 0.625, 1.215, -0.12],
      0.012,
    );
    body.beam(
      'carbon',
      [sign * 0.625, 1.215, -0.12],
      [sign * 0.595, 1.16, -0.94],
      0.023,
    );
    body.beam(
      'paint',
      [sign * 0.595, 1.16, -0.94],
      [sign * 0.77, 0.855, -1.45],
      0.034,
    );
  }
  body.beam('carbon', [-0.61, 1.216, -0.12], [0.61, 1.216, -0.12], 0.023);
  body.beam('carbon', [-0.58, 1.16, -0.94], [0.58, 1.16, -0.94], 0.022);

  // Full driver cockpit. A plain closed passenger-side cover represents Rocket's
  // single-seat layout; it does not invent an unseen pressure-vessel arrangement.
  body.box('carbon', [1.53, 0.065, 1.7], [0, 0.32, -0.18]);
  body.box('carbon', [0.59, 0.065, 1.16], [-0.405, 0.51, -0.22]);
  body.box('titanium', [0.017, 0.008, 1.0], [-0.405, 0.547, -0.22]);
  body.oval('carbon', [0.78, 0.075, 0.16], [0, 0.777, 0.58]);
  body.box('suede', [1.4, 0.033, 0.22], [0, 0.827, 0.61]);
  body.box('carbon', [1.43, 0.11, 0.065], [0, 0.715, 0.525]);
  body.box('titanium', [1.39, 0.006, 0.01], [0, 0.769, 0.484]);
  body.box('carbon', [0.2, 0.17, 0.8], [0, 0.405, -0.12]);
  body.oval('white', [0.11, 0.085, 0.42], [0, 0.518, -0.22]);
  body.box('suede', [0.125, 0.009, 0.22], [0, 0.595, -0.29]);
  for (const sign of [-1, 1]) {
    body.box('carbon', [0.043, 0.27, 1.4], [sign * 0.794, 0.56, -0.18]);
    body.box('suede', [0.04, 0.073, 1.31], [sign * 0.77, 0.727, -0.16]);
    body.beam(
      'white',
      [sign * 0.745, 0.59, 0.32],
      [sign * 0.745, 0.54, -0.66],
      0.022,
    );
    body.beam(
      'accent',
      [sign * 0.749, 0.606, 0.32],
      [sign * 0.749, 0.55, -0.66],
      0.006,
    );
    body.beam(
      'titanium',
      [sign * 0.735, 0.59, 0.21],
      [sign * 0.73, 0.47, 0.02],
      0.009,
    );
  }
  const driverX = TESLA_ROADSTER_ANCHORS.seatPelvis[0];
  body.oval('carbon', [0.272, 0.058, 0.37], [driverX, 0.399, -0.36]);
  body.oval(
    'white',
    [0.235, 0.08, 0.295],
    [driverX, 0.463, -0.34],
    [-0.075, 0, 0],
  );
  body.oval(
    'suede',
    [0.166, 0.012, 0.235],
    [driverX, 0.531, -0.31],
    [-0.075, 0, 0],
  );
  body.oval(
    'carbon',
    [0.255, 0.36, 0.074],
    [driverX, 0.716, -0.667],
    [-0.16, 0, 0],
  );
  body.oval(
    'white',
    [0.234, 0.323, 0.08],
    [driverX, 0.721, -0.638],
    [-0.16, 0, 0],
  );
  body.oval(
    'suede',
    [0.15, 0.238, 0.014],
    [driverX, 0.711, -0.547],
    [-0.16, 0, 0],
  );
  for (const sign of [-1, 1]) {
    body.oval(
      'suede',
      [0.055, 0.258, 0.07],
      [driverX + sign * 0.205, 0.69, -0.565],
      [-0.16, 0, sign * 0.11],
    );
    body.oval(
      'white',
      [0.042, 0.052, 0.28],
      [driverX + sign * 0.219, 0.499, -0.36],
    );
  }
  body.oval(
    'white',
    [0.165, 0.124, 0.061],
    [driverX, 1.026, -0.702],
    [-0.13, 0, 0],
  );
  body.box(
    'carbon',
    [0.045, 0.47, 0.013],
    [driverX + 0.137, 0.744, -0.536],
    [0, 0, -0.11],
  );
  if (detail > 1)
    for (let row = 0; row < detail * 6; row++)
      for (const side of [-1, 1])
        body.box(
          'carbon',
          [0.009, 0.003, 0.002],
          [
            driverX + side * (0.065 + row * 0.002),
            0.66 + row * 0.013,
            -0.53 - row * 0.002,
          ],
        );
  // Centre display plus two small forward displays, as described by Tesla.
  body.box('carbon', [0.324, 0.224, 0.024], [0, 0.79, 0.448], [-0.16, 0, 0]);
  body.box('display', [0.299, 0.195, 0.004], [0, 0.791, 0.432], [-0.16, 0, 0]);
  for (const x of [0.247, 0.575]) {
    body.box('carbon', [0.168, 0.064, 0.025], [x, 0.859, 0.536], [-0.16, 0, 0]);
    body.box('display', [0.151, 0.048, 0.004], [x, 0.86, 0.519], [-0.16, 0, 0]);
    body.box('white', [0.055, 0.004, 0.003], [x - 0.027, 0.861, 0.515]);
  }
  body.box(
    'titanium',
    [0.047, 0.07, 0.014],
    [driverX + 0.12, 0.389, 0.42],
    [-0.36, 0, 0],
  );
  body.box(
    'rubber',
    [0.072, 0.075, 0.017],
    [driverX - 0.02, 0.394, 0.43],
    [-0.36, 0, 0],
  );
  body.beam('carbon', [driverX, 0.768, 0.3], [driverX, 0.719, 0.53], 0.031);
  body.box('carbon', [0.158, 0.035, 0.068], [0, 1.123, -0.02], [-0.2, 0, 0]);
  body.box('titanium', [0.145, 0.026, 0.004], [0, 1.121, -0.058]);
  body.finish('body');

  const steering = new THREE.Group();
  steering.name = 'steer-by-wire-yoke';
  steering.position.fromArray(TESLA_ROADSTER_ANCHORS.steeringWheel);
  root.add(steering);
  const yoke = new Parts(steering, materials, around),
    rim = new THREE.CatmullRomCurve3(
      [
        [-0.166, 0.074, 0],
        [-0.145, 0.102, 0],
        [0.145, 0.102, 0],
        [0.166, 0.074, 0],
        [0.166, -0.073, 0],
        [0.137, -0.09, 0],
        [-0.137, -0.09, 0],
        [-0.166, -0.073, 0],
      ].map((p) => new THREE.Vector3(...p)),
      true,
      'centripetal',
    );
  yoke.add(
    'white',
    new THREE.TubeGeometry(rim, around * 2, 0.013, detail * 3 + 3, true),
  );
  yoke.box('carbon', [0.163, 0.135, 0.055], [0, 0.005, -0.004]);
  yoke.box('suede', [0.12, 0.095, 0.009], [0, 0.007, -0.035]);
  for (const sign of [-1, 1]) {
    yoke.box(
      'carbon',
      [0.04, 0.146, 0.045],
      [sign * 0.15, 0, 0.001],
      [0, 0, sign * 0.04],
    );
    yoke.box('titanium', [0.024, 0.026, 0.009], [sign * 0.116, 0.04, -0.028]);
    yoke.box('titanium', [0.023, 0.005, 0.005], [sign * 0.116, -0.023, -0.027]);
  }
  yoke.finish('yoke');

  const wheelSteers: THREE.Group[] = [],
    wheelRolls: THREE.Group[] = [];
  for (const axle of [1.39, -1.39])
    for (const sign of [-1, 1]) {
      const steer = new THREE.Group(),
        roll = new THREE.Group();
      steer.position.set(sign * 0.896, 0.35, axle);
      steer.name = `${axle > 0 ? 'front' : 'rear'}-${sign > 0 ? 'left' : 'right'}-steer`;
      roll.name = `${steer.name}-roll`;
      steer.add(roll);
      root.add(steer);
      if (axle > 0) wheelSteers.push(steer);
      wheelRolls.push(roll);
      const wheel = new Parts(roll, materials, around),
        profile = [
          [0.258, -0.116],
          [0.307, -0.124],
          [0.342, -0.103],
          [0.35, -0.065],
          [0.35, 0.065],
          [0.342, 0.103],
          [0.307, 0.124],
          [0.258, 0.116],
        ].map((p) => new THREE.Vector2(...p)),
        tyre = new THREE.LatheGeometry(profile, around);
      tyre.rotateZ(Math.PI / 2);
      wheel.add('rubber', tyre);
      const sideX = sign * 0.116;
      const disk = new THREE.CylinderGeometry(0.242, 0.242, 0.012, around);
      disk.rotateZ(Math.PI / 2);
      wheel.add('titanium', disk, [sideX - sign * 0.035, 0, 0]);
      const ring = new THREE.TorusGeometry(
        0.273,
        0.011,
        Math.max(4, detail * 3),
        around,
      );
      ring.rotateY(Math.PI / 2);
      wheel.add('titanium', ring, [sideX, 0, 0]);
      for (let spoke = 0; spoke < 6; spoke++) {
        const angle = (spoke * Math.PI) / 3,
          end: P = [sideX, Math.cos(angle) * 0.266, Math.sin(angle) * 0.266],
          rootPoint: P = [
            sideX + sign * 0.006,
            Math.cos(angle + 0.1) * 0.062,
            Math.sin(angle + 0.1) * 0.062,
          ];
        wheel.beam('carbon', rootPoint, end, 0.017);
        wheel.beam(
          'titanium',
          rootPoint,
          [
            sideX + sign * 0.003,
            Math.cos(angle + 0.16) * 0.261,
            Math.sin(angle + 0.16) * 0.261,
          ],
          0.007,
        );
      }
      const hub = new THREE.CylinderGeometry(0.058, 0.058, 0.037, around);
      hub.rotateZ(Math.PI / 2);
      wheel.add('carbon', hub, [sideX, 0, 0]);
      if (detail > 1)
        for (let bolt = 0; bolt < 6; bolt++) {
          const theta = (bolt * Math.PI) / 3,
            fastener = new THREE.CylinderGeometry(0.006, 0.006, 0.005, 6);
          fastener.rotateZ(Math.PI / 2);
          wheel.add('titanium', fastener, [
            sideX + sign * 0.02,
            Math.cos(theta) * 0.038,
            Math.sin(theta) * 0.038,
          ]);
        }
      wheel.finish(steer.name);
    }

  // Four rear fans are described on camera; duct placement and blades remain
  // illustrative without a dimensioned underbody drawing.
  const fans: THREE.Group[] = [];
  const housing = new Parts(root, materials, around);
  for (const [index, position] of TESLA_ROADSTER_FANS.entries()) {
    const point: P = [...position],
      rimGeometry = new THREE.TorusGeometry(
        0.267,
        0.022,
        detail * 3 + 3,
        around,
      );
    rimGeometry.rotateX(Math.PI / 2);
    housing.add('carbon', rimGeometry, point);
    const fan = new THREE.Group();
    fan.position.fromArray(point);
    fan.name = `illustrative-underbody-fan-${index}`;
    const blades = new Parts(fan, materials, around);
    for (let blade = 0; blade < 7; blade++)
      blades.surface('titanium', detail * 3, 2, (v, u) => {
        const radius = 0.047 + v * 0.207,
          theta = (blade * Math.PI * 2) / 7 + v * 0.51 + u * (0.44 - v * 0.13);
        return [
          Math.cos(theta) * radius,
          -0.017 + u * 0.017,
          Math.sin(theta) * radius,
        ];
      });
    blades.oval('titanium', [0.051, 0.025, 0.051], [0, -0.005, 0]);
    blades.finish('fan-rotor');
    root.add(fan);
    fans.push(fan);
  }
  housing.finish('underbody-fan-housing');

  const wing = new THREE.Group();
  wing.name = 'active-rear-wing';
  wing.position.set(0, 0.74, -1.975);
  const aero = new Parts(wing, materials, around);
  aero.box('paint', [1.76, 0.032, 0.27], [0, 0.036, 0]);
  aero.box('carbon', [1.69, 0.011, 0.24], [0, 0.013, 0]);
  for (const sign of [-1, 1]) {
    aero.box(
      'paint',
      [0.022, 0.065, 0.29],
      [sign * 0.87, 0.05, 0],
      [0, 0, sign * -0.13],
    );
    aero.box('carbon', [0.04, 0.125, 0.075], [sign * 0.51, -0.05, 0.03]);
  }
  aero.finish('active-wing');
  root.add(wing);
  let triangles = 0,
    meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    triangles +=
      (object.geometry.index?.count ??
        object.geometry.getAttribute('position').count) / 3;
    meshes++;
  });
  return {
    root,
    steering,
    wheelSteers,
    wheelRolls,
    fans,
    wing,
    triangles,
    meshes,
  };
}

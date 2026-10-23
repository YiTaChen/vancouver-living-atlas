import * as THREE from 'three';
import { interior } from './builder.mjs';
import { carveFloorRect } from './geometry-utils.mjs';

const TRANS = 'https://www.translink.ca';
const COMMONS = 'https://commons.wikimedia.org/wiki/File:';
const references = {
  burrard: [
    {
      url: `${TRANS}/news/2022/october/translink%20to%20replace%20burrard%20skytrain%20station%20escalators`,
      note: 'Five existing escalators, mall connections and elevator on all levels; planned 2021 expansion was rescoped.',
    },
    {
      url: `${COMMONS}Burrard_Station_Concourse_2018.jpg`,
      note: 'Wpcpey, CC BY-SA 4.0: glazed steel-truss ticket atrium and grey masonry.',
    },
    {
      url: `${COMMONS}Burrard_Station_platforms.jpg`,
      note: 'Ymblanter, CC BY-SA 4.0: enclosed single-track vault, pale panels, red rails and yellow tactiles.',
    },
    {
      url: 'https://buzzer.translink.ca/wp-content/uploads/2022/10/The-escalators-and-stairs-to-street-level-at-Burrard-Station.jpg',
      note: 'TransLink: street staircase and single escalator under glazed canopy.',
    },
    {
      url: 'https://www.shutterstock.com/image-photo/vancouver-canada-june-8-2026-260nw-2795618041.jpg',
      note: 'Actual 2026 gate-hall photograph: low grid ceiling, curved pale wall panels and separate Platform 1/2 signs; distinct from unpaid glass atrium.',
    },
  ],
  granville: [
    {
      url: `${TRANS}/news/2018/may/granville%20station%20escalators`,
      note: 'Original Big 3 are three parallel 35 m escalators. Published length is not horizontal run.',
    },
    {
      url: 'https://www.youtube.com/watch?v=8CBF36YWAa4',
      note: 'TransLink 2020: original six comprise Bay corridor pair, Big 3, and short escalator/stair connecting platform levels.',
    },
    {
      url: 'https://buzzer.translink.ca/2018/05/granville-escalator-replacement-project-set-to-begin-on-may-26/',
      note: 'Three additional Dunsmuir escalators and elevator remain independently usable.',
    },
    {
      url: `${COMMONS}Granville_Station_escalator_2026.JPG`,
      note: 'Canmenwalker, CC BY 4.0: enclosed triple escalator shaft, pale panels, red rails, curved acoustic vault.',
    },
    {
      url: `${COMMONS}Granville_station_access_2018.jpg`,
      note: 'Wpcpey, CC BY-SA 4.0: tiled lower Dunsmuir faregate hall; only part of the triple bank is visible.',
    },
    {
      url: 'https://dailyhive.com/vancouver/skytrain-granville-station-escalator-replacement-entrance-closure',
      note: 'TransLink cutaway and Kenneth Chan photographs: original circulation split; Dunsmuir has a tiled triple shaft and faregates at its bottom, beside the elevator.',
    },
    {
      url: 'https://buzzer.translink.ca/2023/12/artworks-at-four-skytrain-stations-celebrate-contemporary-black-canadian-art-and-artists/',
      note: 'Official Dunsmuir shaft photograph: three parallel escalators, tall tiled rectangular walls and glass upper passage.',
    },
    {
      url: `${COMMONS}Granville_Station_Platform_2026.JPG`,
      note: 'Canmenwalker, CC BY 4.0: single-track vaulted platform and red wall handrail.',
    },
    {
      url: 'https://sitings.ca/wp-content/uploads/2025/08/Granville-Station-Brochure-Aug-2025.pdf',
      note: 'Page 6 primary photographs: bottom-of-bank retail hub and split to platform 1 / platform 2.',
    },
  ],
};

function preserveRailContract(b) {
  b.s.anchors = b.base.anchors
    .filter((a) => ['vehicle-root-stop', 'platform-door'].includes(a.kind))
    .map((a) => structuredClone(a));
  b.s.instances = [];
  b.s.moduleReferences = [];
  b.s.thresholdBridges = b.base.thresholdBridges ?? [];
  b.s.runtimeChecks = [];
  b.tracks();
  for (const f of b.base.floorSurfaces.filter((f) => f.kind === 'platform')) {
    b.platform(f.surfaceId, { columns: false, roof: false });
  }
}

function entrance(b, id, label, floor, point) {
  b.entrance(id, label, floor, point);
  b.s.anchors.push({
    id: `${id}-anchor`,
    nodeId: `anchor-${id}`,
    frameId: b.s.stationId,
    pointM: [...point],
    kind: 'entrance-exit',
  });
}

/** The original hall has round stainless columns. Its panelled cylinder uses
 * the maintained box renderer; each visible face also retains its real collider.
 * Diameter and placement are inferred from photographs, not surveyed anchors. */
function roundConcourseColumn(b, id, [x, y, z], height, radius = 0.32) {
  b.box(
    id,
    [x, y + height / 2, z],
    [0.43, height, 0.43],
    'stainless',
    'column-core',
    0,
    true,
  );
  const faces = 16,
    chord = 2 * radius * Math.tan(Math.PI / faces);
  for (let i = 0; i < faces; i++) {
    const angle = (i / faces) * Math.PI * 2;
    b.box(
      `${id}-stainless-face-${i}`,
      [
        x + radius * Math.sin(angle),
        y + height / 2,
        z + radius * Math.cos(angle),
      ],
      [chord + 0.004, height, 0.025],
      'stainless',
      'column-panel',
      (angle * 180) / Math.PI,
      true,
    );
  }
}

function finishWithStairwells(b) {
  // Cut landing slabs where a flight enters them. Preserve real underpasses
  // once the bank is above standing headroom, rather than removing a corridor
  // underneath an unrelated elevated portion of the same bank.
  for (const c of b.s.connections.filter((c) => c.treadSurfaces?.length)) {
    // Individual stair enclosures need sloping wall tops as well as banks.
    // A full-height bounding wall over the complete run can falsely intersect
    // another real bank that passes above its lower, deeper section.
    const ids = new Set([
      `${c.connectionId}-shaft-wall--1`,
      `${c.connectionId}-shaft-wall-1`,
    ]);
    const wall = b.s.geometryParts.find((p) => ids.has(p.id));
    if (wall) {
      b.s.geometryParts = b.s.geometryParts.filter((p) => !ids.has(p.id));
      b.s.obstacles = b.s.obstacles.filter((p) => !ids.has(p.id));
      const a = new THREE.Vector3(...c.startPointM),
        z = new THREE.Vector3(...c.endPointM);
      const run = Math.hypot(z.x - a.x, z.z - a.z),
        pieces = Math.ceil(run / 0.25);
      const side = new THREE.Vector3(z.z - a.z, 0, a.x - z.x).normalize();
      const yaw = (Math.atan2(z.x - a.x, z.z - a.z) * 180) / Math.PI;
      for (let i = 0; i < pieces; i++) {
        const p = a.clone().lerp(z, i / pieces),
          q = a.clone().lerp(z, (i + 1) / pieces);
        for (const sign of [-1, 1]) {
          const center = p
            .clone()
            .add(q)
            .multiplyScalar(0.5)
            .addScaledVector(side, sign * (c.clearWidthM / 2 + 0.1));
          center.y += 1.5;
          b.box(
            `${c.connectionId}-sloping-wall-${i}-${sign}`,
            center.toArray(),
            [0.2, Math.abs(q.y - p.y) + 3.4, run / pieces + 0.025],
            wall.material,
            'wall',
            yaw,
            true,
          );
        }
      }
    }
    const lowerY = Math.min(c.startPointM[1], c.endPointM[1]);
    const upperY = Math.max(c.startPointM[1], c.endPointM[1]);
    for (const floor of b.s.floorSurfaces.filter(
      (f) =>
        f.verticesM.every((p) => Math.abs(p[1] - lowerY) < 0.001) ||
        f.verticesM.every((p) => Math.abs(p[1] - upperY) < 0.001),
    )) {
      const low = floor.verticesM.every((p) => Math.abs(p[1] - lowerY) < 0.001);
      const points = c.treadSurfaces
        .filter((t) =>
          low
            ? t.verticesM[0][1] <= lowerY + 2
            : t.verticesM[0][1] >= upperY - 2,
        )
        .flatMap((t) => t.verticesM);
      const cut = {
        minX: Math.min(...points.map((p) => p[0])),
        maxX: Math.max(...points.map((p) => p[0])),
        minZ: Math.min(...points.map((p) => p[2])),
        maxZ: Math.max(...points.map((p) => p[2])),
      };
      const minX = Math.min(...floor.verticesM.map((p) => p[0])),
        maxX = Math.max(...floor.verticesM.map((p) => p[0]));
      const minZ = Math.min(...floor.verticesM.map((p) => p[2])),
        maxZ = Math.max(...floor.verticesM.map((p) => p[2]));
      if (
        Math.min(maxX, cut.maxX) - Math.max(minX, cut.minX) > 0.001 &&
        Math.min(maxZ, cut.maxZ) - Math.max(minZ, cut.minZ) > 0.001
      )
        carveFloorRect(b.s, floor.surfaceId, cut);
    }
  }
  return b.finish({ encloseElevators: true });
}

// A shallow elliptical vault, constructed as continuous panels with visible ribs.
// Each panel is actual geometry, not a floating arch that leaves the tunnel open.
function vault(
  b,
  id,
  a,
  c,
  width,
  { spring = 2.25, rise = 1.15, segments = 12, ribSpacing = 4 } = {},
) {
  const av = new THREE.Vector3(...a),
    cv = new THREE.Vector3(...c);
  const run = Math.hypot(cv.x - av.x, cv.z - av.z);
  const side = new THREE.Vector3(cv.z - av.z, 0, av.x - cv.x).normalize();
  const arc = (t, angle) =>
    av
      .clone()
      .lerp(cv, t)
      .addScaledVector(side, (Math.cos(angle) * width) / 2)
      .add(new THREE.Vector3(0, spring + Math.sin(angle) * rise, 0))
      .toArray();
  for (let j = 0; j < segments; j++) {
    const left = new THREE.Vector3(...arc(0, (Math.PI * j) / segments));
    const right = new THREE.Vector3(...arc(0, (Math.PI * (j + 1)) / segments));
    const start = left.clone().add(right).multiplyScalar(0.5);
    const end = new THREE.Vector3(...arc(1, (Math.PI * j) / segments))
      .add(new THREE.Vector3(...arc(1, (Math.PI * (j + 1)) / segments)))
      .multiplyScalar(0.5);
    const zAxis = end.clone().sub(start).normalize();
    const chord = right.clone().sub(left),
      xAxis = chord
        .clone()
        .addScaledVector(zAxis, -chord.dot(zAxis))
        .normalize();
    const yAxis = zAxis.clone().cross(xAxis).normalize();
    const rotation = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis),
    );
    b.box(
      `${id}-vault-panel-${j}`,
      start.clone().add(end).multiplyScalar(0.5).toArray(),
      [chord.length() + 0.045, 0.12, start.distanceTo(end)],
      'acoustic',
      'ceiling',
      0,
      false,
      rotation.toArray(),
    );
  }
  for (let k = 0; k <= Math.ceil(run / ribSpacing); k++) {
    const t = Math.min(1, (k * ribSpacing) / run);
    for (let j = 0; j < segments; j++)
      b.beam(
        `${id}-arch-${k}-${j}`,
        arc(t, (Math.PI * j) / segments),
        arc(t, (Math.PI * (j + 1)) / segments),
        0.095,
        0.11,
        'steel',
        'ceiling',
      );
  }
}

function bank(
  b,
  id,
  from,
  to,
  a,
  z,
  lanes,
  { width = 1.25, pitch = 1.65, vaulted = true, shaftHeight = 2.35 } = {},
) {
  const tangent = new THREE.Vector3(z[0] - a[0], 0, z[2] - a[2]).normalize();
  const lateral = new THREE.Vector3(tangent.z, 0, -tangent.x);
  for (let n = 0; n < lanes; n++) {
    const offset = (n - (lanes - 1) / 2) * pitch;
    const start = new THREE.Vector3(...a)
      .addScaledVector(lateral, offset)
      .toArray();
    const end = new THREE.Vector3(...z)
      .addScaledVector(lateral, offset)
      .toArray();
    b.flight(`${id}-${n + 1}`, from, to, start, end, width, {
      kind: 'escalator',
      enclosed: false,
    });
  }
  const wholeWidth = (lanes - 1) * pitch + width + 0.7;
  b.shaft(id, a, z, wholeWidth, {
    material: 'cream',
    height: shaftHeight,
    roof: false,
  });
  // The wall follows the sloping shaft; a single tall bounding box would seal
  // unrelated corridors that pass above a deep section of the escalators.
  const wallIds = new Set([`${id}-shaft-wall--1`, `${id}-shaft-wall-1`]);
  b.s.geometryParts = b.s.geometryParts.filter((p) => !wallIds.has(p.id));
  b.s.obstacles = b.s.obstacles.filter((p) => !wallIds.has(p.id));
  const wallRun = Math.hypot(z[0] - a[0], z[2] - a[2]),
    pieces = Math.ceil(wallRun);
  const wallYaw = (Math.atan2(z[0] - a[0], z[2] - a[2]) * 180) / Math.PI;
  for (let n = 0; n < pieces; n++) {
    const p = new THREE.Vector3(...a).lerp(new THREE.Vector3(...z), n / pieces);
    const q = new THREE.Vector3(...a).lerp(
      new THREE.Vector3(...z),
      (n + 1) / pieces,
    );
    for (const side of [-1, 1]) {
      const center = p
        .clone()
        .add(q)
        .multiplyScalar(0.5)
        .addScaledVector(lateral, side * (wholeWidth / 2 + 0.1));
      center.y += (shaftHeight - 0.2) / 2;
      b.box(
        `${id}-sloping-sidewall-${n}-${side}`,
        center.toArray(),
        [
          0.2,
          Math.abs(q.y - p.y) + shaftHeight + 0.2,
          wallRun / pieces + 0.025,
        ],
        'cream',
        'wall',
        wallYaw,
        true,
      );
    }
  }
  if (vaulted)
    vault(b, id, a, z, wholeWidth, { spring: shaftHeight, rise: 1.1 });
  else
    b.beam(
      `${id}-rectangular-soffit`,
      [a[0], a[1] + shaftHeight, a[2]],
      [z[0], z[1] + shaftHeight, z[2]],
      wholeWidth + 0.2,
      0.16,
      'cream',
      'soffit',
    );
  for (const sign of [-1, 1]) {
    const p = new THREE.Vector3(...a)
      .addScaledVector(lateral, sign * (wholeWidth / 2 - 0.08))
      .add(new THREE.Vector3(0, 0.95, 0));
    const q = new THREE.Vector3(...z)
      .addScaledVector(lateral, sign * (wholeWidth / 2 - 0.08))
      .add(new THREE.Vector3(0, 0.95, 0));
    b.beam(
      `${id}-red-wall-rail-${sign}`,
      p.toArray(),
      q.toArray(),
      0.055,
      0.065,
      'red',
      'handrail',
    );
  }
}

function platformShell(
  b,
  id,
  y,
  { westDoors = [], northOpen = true, southOpen = false } = {},
) {
  // Existing track and door positions remain unchanged. All access is on the
  // passenger side, never through the train's protected envelope.
  b.room(`${id}-platform-back`, [0, y, 0], 4.5, 74, {
    height: 3.0,
    material: 'cream',
    roof: false,
    doors: {
      west: westDoors,
      east: [[-37, 37]],
      north: northOpen ? [[-2.25, 2.25]] : [],
      south: southOpen ? [[-2.25, 2.25]] : [],
    },
  });
  b.box(
    `${id}-opposite-track-wall`,
    [5.6, y + 0.9, 0],
    [0.25, 4.2, 86],
    'black',
    'wall',
  );
  vault(b, id, [1.55, y, -43], [1.55, y, 43], 8.15, {
    spring: 2.6,
    rise: 1.3,
  });
  b.beam(
    `${id}-platform-edge-light`,
    [2.1, y + 2.3, -37],
    [2.1, y + 2.3, 37],
    0.16,
    0.06,
    'light',
    'ceiling',
  );
  const cuts = [...westDoors].sort((a, c) => a[0] - c[0]);
  let start = -37;
  for (const [p, q] of [...cuts, [37, 37]]) {
    if (p > start)
      b.beam(
        `${id}-red-rail-${start}`,
        [-2.15, y + 0.95, start],
        [-2.15, y + 0.95, p],
        0.055,
        0.065,
        'red',
        'handrail',
      );
    start = Math.max(start, q);
  }
  for (let z = -33; z <= 33; z += 6) {
    b.box(
      `${id}-wall-joint-${z}`,
      [-2.34, y + 1.1, z],
      [0.025, 2.2, 0.025],
      'steel',
      'detail',
    );
    b.box(
      `${id}-poster-${z}`,
      [5.45, y + 1.15, z],
      [0.035, 1.4, 1.15],
      z % 12 ? 'cream' : 'expo',
      'detail',
    );
  }
  b.sign(
    `${b.s.name.replace(' Station', '')}  ·  ${id.endsWith('upper') ? 'Platform 1 · Waterfront' : 'Platform 2 · King George / Production Way–University'}`,
    [-2.15, y + 2.0, 6],
    Math.PI / 2,
    5.2,
    0.36,
  );
  b.sign('Exit  ↑  Elevator  ↕', [-2.1, y + 2.0, -26], Math.PI / 2, 2.9, 0.34);
  b.box(
    `${id}-help-point`,
    [-2.1, y + 1.05, 15],
    [0.2, 1.65, 0.55],
    'yellow',
    'detail',
  );
  // Real station photos show benches along the passenger-side wall, away from
  // access portals. Use authored seat anchors so these are actually usable.
  for (const z of [
    westDoors.some(([a, z]) => a - 2 < -15 && z + 2 > -15) ? -4 : -15,
    22,
  ])
    b.bench(`${id}-bench-${z}`, [-1.7, y, z], 2.4, 90, { material: 'steel' });
}

function ticketFurniture(
  b,
  id,
  center,
  { tiled = false, grid = true, gates = true } = {},
) {
  const [x, y, z] = center;
  for (let i = 0; i < 3; i++) {
    b.box(
      `${id}-ticket-machine-${i}`,
      [x - 6.5 + i * 1.2, y + 1, z - 4],
      [0.95, 2, 0.55],
      'steel',
      'ticket-machine',
      0,
      true,
    );
    b.box(
      `${id}-ticket-screen-${i}`,
      [x - 6.5 + i * 1.2, y + 1.32, z - 3.7],
      [0.56, 0.55, 0.035],
      'expo',
      'detail',
    );
  }
  for (let i = 0; gates && i < 6; i++) {
    b.box(
      `${id}-faregate-${i}`,
      [x - 4 + i * 1.6, y + 0.48, z + 2],
      [0.24, 0.96, 1.25],
      'steel',
      'faregate',
      0,
      true,
    );
    b.box(
      `${id}-compass-reader-${i}`,
      [x - 4 + i * 1.6, y + 0.98, z + 1.62],
      [0.23, 0.06, 0.3],
      'expo',
      'detail',
    );
  }
  b.sign('Expo Line  ↓  Platforms 1 & 2', [x, y + 2.45, z + 3.7], 0, 6, 0.42);
  b.sign(
    'Compass tickets  ·  Tap in / Tap out',
    [x - 5, y + 2.4, z - 3.65],
    0,
    4.5,
    0.34,
  );
  // A restrained tile/ceiling grid establishes the two different ticket halls.
  if (grid) {
    for (let u = -8; u <= 8; u += 2)
      b.box(
        `${id}-ceiling-grid-x-${u}`,
        [x + u, y + 3.13, z],
        [0.025, 0.025, 13.5],
        'steel',
        'ceiling',
      );
    for (let v = -6; v <= 6; v += 2)
      b.box(
        `${id}-ceiling-grid-z-${v}`,
        [x, y + 3.13, z + v],
        [20, 0.025, 0.025],
        'steel',
        'ceiling',
      );
  }
  if (tiled)
    for (const u of [-5, 5])
      b.box(
        `${id}-square-column-${u}`,
        [x + u, y + 1.5, z - 1.5],
        [0.55, 3, 0.55],
        'cream',
        'column',
        0,
        true,
      );
  else
    for (const u of [-8, 8])
      b.box(
        `${id}-steel-column-${u}`,
        [x + u, y + 1.55, z],
        [0.42, 3.1, 0.42],
        'steel',
        'column',
        0,
        true,
      );
}

function glazedAtrium(b, id, center) {
  const [x, y, z] = center,
    length = 14;
  for (const side of [-1, 1]) {
    b.box(
      `${id}-glass-side-${side}`,
      [x + side * 11.1, y + 5, z],
      [0.08, 5, length],
      'glass',
      'wall',
    );
    b.beam(
      `${id}-glass-roof-${side}`,
      [x + side * 11.1, y + 7.5, z],
      [x, y + 9, z],
      length,
      0.06,
      'glass',
      'ceiling',
    );
  }
  // The glazed atrium is enclosed at both gable ends as well as the sides.
  // Narrow panes follow the pitched top profile without a rectangular sheet
  // projecting through the roof. Their lower edge meets the masonry enclosure.
  for (const end of [-1, 1]) {
    for (let u = -10.5; u <= 10.5; u += 1) {
      const top = 9 - (1.5 * Math.min(11, Math.abs(u) + 0.5)) / 11;
      b.box(
        `${id}-gable-pane-${end}-${u}`,
        [x + u, y + (2.5 + top) / 2, z + end * 7.1],
        [1.005, top - 2.5, 0.07],
        'glass',
        'wall',
      );
    }
    for (let u = -11; u <= 11; u += 3.6666666667) {
      const top = 9 - (1.5 * Math.abs(u)) / 11;
      b.beam(
        `${id}-gable-mullion-${end}-${u}`,
        [x + u, y + 2.5, z + end * 7.1],
        [x + u, y + top, z + end * 7.1],
        0.075,
        0.075,
        'steel',
        'detail',
      );
    }
  }
  for (let v = -7; v <= 7; v += 3.5) {
    b.beam(
      `${id}-truss-left-${v}`,
      [x - 11, y + 7.5, z + v],
      [x, y + 9, z + v],
      0.12,
      0.12,
      'steel',
      'ceiling',
    );
    b.beam(
      `${id}-truss-right-${v}`,
      [x, y + 9, z + v],
      [x + 11, y + 7.5, z + v],
      0.12,
      0.12,
      'steel',
      'ceiling',
    );
    b.beam(
      `${id}-truss-tie-${v}`,
      [x - 11, y + 7.5, z + v],
      [x + 11, y + 7.5, z + v],
      0.12,
      0.12,
      'steel',
      'ceiling',
    );
    for (const u of [-11, 11])
      b.box(
        `${id}-glass-mullion-${u}-${v}`,
        [x + u, y + 4.7, z + v],
        [0.11, 7.5, 0.11],
        'steel',
        'detail',
      );
  }
  for (let v = -5; v <= 5; v += 5)
    b.box(
      `${id}-pendant-${v}`,
      [x, y + 6.8, z + v],
      [0.4, 0.22, 0.4],
      'light',
      'ceiling',
    );
}

function translateSourceXZ(source, dx, dz, dy = 0) {
  const s = structuredClone(source),
    shift = (p) => {
      if (p) {
        p[0] += dx;
        p[1] += dy;
        p[2] += dz;
      }
    };
  for (const f of s.floorSurfaces) for (const p of f.verticesM) shift(p);
  for (const p of s.geometryParts) shift(p.centerM);
  for (const o of s.obstacles) {
    shift(o.centerM);
    shift(o.boundsM?.min);
    shift(o.boundsM?.max);
  }
  for (const c of s.connections) {
    shift(c.startPointM);
    shift(c.endPointM);
    for (const t of c.treadSurfaces ?? [])
      for (const p of t.verticesM) shift(p);
  }
  for (const e of s.entrances) shift(e.pointM);
  for (const p of s.platforms) {
    p.floorHeightM += dy;
    p.railHeightM += dy;
    shift(p.stopPosition.translationM);
    for (const d of p.doorAlignmentPoints)
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ])
        shift(d[key]);
    for (const r of p.waitingRegions ?? [])
      for (const q of r.polygonM) shift(q);
  }
  for (const x of s.trackExclusionVolumes) {
    for (const p of x.footprintM) shift(p);
    x.minY += dy;
    x.maxY += dy;
  }
  for (const level of s.levels) level.floorHeightM += dy;
  for (const x of s.anchors) shift(x.pointM);
  for (const x of s.thresholdBridges ?? []) {
    shift(x.storedTransform?.translationM);
    shift(x.deployedTransform?.translationM);
    for (const p of x.deployedFloor?.verticesM ?? []) shift(p);
    for (const p of x.sequence ?? []) shift(p.translationM);
  }
  return s;
}
function offsetArchitecture(b, dx, dz) {
  const at = (p) => [p[0] + dx, p[1], p[2] + dz];
  return {
    s: b.s,
    room: (id, p, ...args) => b.room(id, at(p), ...args),
    box: (id, p, ...args) => b.box(id, at(p), ...args),
    beam: (id, p, q, ...args) => b.beam(id, at(p), at(q), ...args),
    sign: (text, p, ...args) => b.sign(text, at(p), ...args),
    bench: (id, p, ...args) => b.bench(id, at(p), ...args),
  };
}

export function rebuildBurrard(source) {
  // OSM platform outlines 923508924/925 are approximate, but constrain the
  // platform's horizontal relation to the independently mapped street doors.
  const dx = 30.91594085,
    dz = -61.64833383;
  const originalPlatform = source.floorSurfaces.find(
    (f) => f.surfaceId === 'burrard-upper',
  );
  const oldX =
    (Math.min(...originalPlatform.verticesM.map((p) => p[0])) +
      Math.max(...originalPlatform.verticesM.map((p) => p[0]))) /
    2;
  const oldZ =
    (Math.min(...originalPlatform.verticesM.map((p) => p[2])) +
      Math.max(...originalPlatform.verticesM.map((p) => p[2]))) /
    2;
  const translated = translateSourceXZ(
    source,
    dx - oldX,
    dz - oldZ,
    -14 -
      source.floorSurfaces.find((f) => f.surfaceId === 'burrard-upper')
        .verticesM[0][1],
  );
  const b = interior(
    translated,
    'burrard-reference-interior-v2',
    references.burrard,
  );
  preserveRailContract(b);
  const upperY = b.originalFloor('burrard-upper').verticesM[0][1],
    lowerY = b.originalFloor('burrard-lower').verticesM[0][1];
  const shell = offsetArchitecture(b, dx, dz);
  platformShell(shell, 'burrard-upper', upperY);
  platformShell(shell, 'burrard-lower', lowerY, {
    northOpen: false,
    westDoors: [[-25.5, -23]],
  });
  const upper = 'burrard-upper-hub',
    lower = 'burrard-lower-hub',
    edgeX = dx - 2.25,
    northZ = dz - 37,
    upperWidth = 14.75,
    upperCenterX = dx - 6.625;
  b.floor(
    upper,
    [upperCenterX, upperY, northZ - 5],
    upperWidth,
    10,
    'landing',
    'burrard-upper-level',
  );
  b.room(upper, [upperCenterX, upperY, northZ - 5], upperWidth, 10, {
    height: 2.5,
    material: 'cream',
    roof: false,
    doors: { west: [[-5, 5]], south: [[-6.1, 8.125]] },
  });
  vault(
    b,
    upper,
    [upperCenterX, upperY, northZ - 10],
    [upperCenterX, upperY, northZ],
    upperWidth,
  );
  b.walk(
    'burrard-upper-platform-portal',
    upper,
    'burrard-upper',
    [dx - 0.75, upperY, northZ],
    [dx - 0.75, upperY, northZ],
    3,
  );
  const lowerMinX = dx - 14,
    lowerWidth = edgeX - lowerMinX,
    lowerCenterX = (edgeX + lowerMinX) / 2;
  b.floor(
    lower,
    [lowerCenterX, lowerY, northZ + 6],
    lowerWidth,
    16,
    'landing',
    'burrard-lower-level',
  );
  b.room(lower, [lowerCenterX, lowerY, northZ + 6], lowerWidth, 16, {
    height: 2.6,
    material: 'cream',
    roof: false,
    doors: { east: [[5.5, 8]] },
  });
  const stairX = 24,
    escalatorX = 27;
  b.flight(
    'burrard-interplatform-stairs',
    upper,
    lower,
    [stairX, upperY, northZ],
    [stairX, lowerY, northZ + 12],
    2.4,
    { material: 'cream' },
  );
  b.flight(
    'burrard-interplatform-escalator',
    upper,
    lower,
    [escalatorX, upperY, northZ],
    [escalatorX, lowerY, northZ + 12],
    1.3,
    { kind: 'escalator', material: 'cream' },
  );
  for (const [i, a, c, p, q] of [
    [0, lowerMinX, stairX - 1.4, northZ - 2, northZ + 14],
    [1, stairX + 1.4, escalatorX - 0.85, northZ - 2, northZ + 14],
    [2, escalatorX + 0.85, edgeX, northZ - 2, northZ + 14],
    [3, stairX - 1.4, escalatorX + 0.85, northZ - 2, northZ],
    [4, stairX - 1.4, escalatorX + 0.85, northZ + 12, northZ + 14],
  ])
    if (c > a)
      b.box(
        `${lower}-ceiling-${i}`,
        [(a + c) / 2, lowerY + 2.6, (p + q) / 2],
        [c - a, 0.18, q - p],
        'cream',
        'ceiling',
      );
  const lowerPortalZ = northZ + 12.75;
  b.walk(
    'burrard-lower-platform-portal',
    lower,
    'burrard-lower',
    [edgeX, lowerY, lowerPortalZ],
    [edgeX, lowerY, lowerPortalZ],
    2.4,
  );
  const hall = 'burrard-ticket-atrium',
    street = 'burrard-street-plaza',
    y = -6.5;
  b.floor(hall, [-1, y, -105], 22, 14, 'concourse', hall);
  b.room(hall, [-1, y, -105], 22, 14, {
    height: 2.5,
    material: 'concrete',
    roof: false,
    doors: {
      south: [[-8, 1]],
      north: [
        [-5.1, -1.2],
        [3, 7],
      ],
      west: [[-2.5, 2.5]],
      east: [
        [-3, 3],
        [4, 6.5],
      ],
    },
  });
  glazedAtrium(b, hall, [-1, y, -105]);
  ticketFurniture(b, hall, [-1, y, -105], { grid: false, gates: false });
  bank(
    b,
    'burrard-main-escalator-bank',
    hall,
    upper,
    [10, y, -105],
    [23, upperY, -105],
    3,
  );
  b.fareGates(
    'burrard-upper-platform-gates',
    [25, upperY, -103.5],
    [-3.6, -2, -0.4, 1.2, 2.8],
    90,
  );
  b.sign(
    'Fare Paid Zone  ·  Platforms 1 / 2',
    [25.2, upperY + 2.25, -104],
    Math.PI / 2,
    5,
    0.42,
  );
  b.floor(street, [-5, 0, -89.3], 18, 6, 'entrance', street);
  b.flight(
    'burrard-street-stairs',
    street,
    hall,
    [-3, 0, -92.3],
    [-3, y, -105],
    4.6,
    { enclosed: false },
  );
  b.flight(
    'burrard-street-escalator',
    street,
    hall,
    [-7.8, 0, -92.3],
    [-7.8, y, -105],
    1.3,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft(
    'burrard-street-retaining-walls',
    [-5, 0, -92.3],
    [-5, y, -105],
    10.2,
    { material: 'concrete', roof: false },
  );
  entrance(
    b,
    'burrard-burrard-street-entry',
    'Burrard Street / park stair and escalator',
    street,
    [-5, 0, -87.8],
  );
  b.s.entrances.at(-1).inwardDirectionM = [0, 0, -1];
  // The mapped park node is the bottom of the public 27-step stair, not its
  // street head. Three nine-step flights retain the photographed intermediate
  // landings; the lower sunken plaza enters the atrium on the same level.
  const parkHead = 'burrard-park-street',
    parkPlaza = 'burrard-park-plaza';
  const parkX = -4.89,
    parkZ = -140.78,
    parkTopY = -1.995183215;
  b.floor(
    parkHead,
    [parkX, parkTopY, parkZ - 0.4],
    3.8,
    0.9,
    'entrance',
    parkHead,
  );
  entrance(
    b,
    'burrard-park-entry',
    'Art Phillips Park public stair head',
    parkHead,
    [parkX, parkTopY, parkZ],
  );
  b.s.entrances.at(-1).inwardDirectionM = [0, 0, 1];
  b.floor(parkPlaza, [-4.16, y, -116.09], 7.2, 8.18, 'concourse', hall);
  b.room(parkPlaza, [-4.16, y, -116.09], 7.2, 8.18, {
    height: 3.6,
    material: 'concrete',
    roof: false,
    doors: { north: [[-2.4, 1.1]], south: [[-1.8, 1.8]] },
  });
  b.walk('burrard-park-atrium-door', parkPlaza, hall, [-4.16, y, -112]);
  let from = parkHead;
  for (let i = 0; i < 3; i++) {
    const z0 = parkZ + i * 9.04,
      z1 = z0 + 2.52;
    const y0 = parkTopY + ((y - parkTopY) * i) / 3,
      y1 = parkTopY + ((y - parkTopY) * (i + 1)) / 3;
    const to = i === 2 ? parkPlaza : `burrard-park-intermediate-${i + 1}`;
    if (i < 2) {
      b.floor(to, [parkX, y1, z1 + 3.26], 3.8, 6.52, 'landing', parkPlaza);
      b.room(to, [parkX, y1, z1 + 3.26], 3.8, 6.52, {
        height: 2.1,
        material: 'concrete',
        roof: false,
        doors: { north: [[-1.9, 1.9]], south: [[-1.9, 1.9]] },
      });
    }
    b.flight(
      `burrard-park-stairs-${i + 1}`,
      from,
      to,
      [parkX, y0, z0],
      [parkX, y1, z1],
      3.2,
      { enclosed: false },
    );
    b.shaft(
      `burrard-park-retaining-walls-${i + 1}`,
      [parkX, y0, z0],
      [parkX, y1, z1],
      3.8,
      { material: 'concrete', roof: false },
    );
    from = to;
  }
  for (const [id, center, width, length, door, join] of [
    [
      'royal-centre',
      [-16, y, -105],
      8,
      5,
      { east: [[-2, 2]], west: [[-2, 2]] },
      [-12, y, -105],
    ],
    [
      'bentall-centre',
      [4, y, -116],
      5,
      8,
      { north: [[-2, 2]], south: [[-2, 2]] },
      [4, y, -112],
    ],
  ]) {
    const f = `burrard-${/** @type {string} */ (id)}-passage`;
    b.floor(f, center, width, length, 'walk', hall);
    b.room(f, center, width, length, { doors: door });
    b.walk(`${f}-atrium-door`, f, hall, join);
  }
  const liftStreetY = -0.917488;
  const lx = 20.11245854,
    entryZ = -94.67004044,
    lz = entryZ - 2.6;
  const liftStreet = 'burrard-accessible-street',
    liftHall = 'burrard-lift-hall',
    liftUpper = 'burrard-lift-upper',
    liftLower = 'burrard-lift-lower';
  for (const [floor, fy] of [
    [liftStreet, liftStreetY],
    [liftHall, y],
    [liftUpper, upperY],
    [liftLower, lowerY],
  ])
    b.floor(floor, [lx, fy, lz], 4, 6, 'lift-landing', floor);
  b.room('burrard-accessible-station-house', [lx, liftStreetY, lz], 4, 6, {
    height: 3.2,
    material: 'cream',
    doors: { south: [[-1.2, 1.2]] },
  });
  b.fareGates(
    'burrard-accessible-street-gates',
    [lx, liftStreetY, entryZ - 0.6],
    [-0.9, 0.9],
  );
  entrance(
    b,
    'burrard-accessible-entry',
    'Burrard Street elevator entrance',
    liftStreet,
    [lx, liftStreetY, entryZ],
  );
  b.s.entrances.at(-1).inwardDirectionM = [0, 0, -1];
  b.elevator(
    'burrard-lift-street-concourse',
    liftStreet,
    liftHall,
    [lx, liftStreetY, lz],
    [lx, y, lz],
  );
  b.elevator(
    'burrard-lift-concourse-upper',
    liftHall,
    liftUpper,
    [lx, y, lz],
    [lx, upperY, lz],
  );
  b.elevator(
    'burrard-lift-upper-lower',
    liftUpper,
    liftLower,
    [lx, upperY, lz],
    [lx, lowerY, lz],
  );
  const hallCross = 'burrard-atrium-lift-passage';
  b.floor(
    hallCross,
    [(10 + lx + 2) / 2, y, -100],
    lx + 2 - 10,
    2.4,
    'walk',
    hall,
  );
  b.room(hallCross, [(10 + lx + 2) / 2, y, -100], lx + 2 - 10, 2.4, {
    height: 2.7,
    doors: {
      west: [[-1.2, 1.2]],
      south: [[lx - (10 + lx + 2) / 2 - 1.2, lx - (10 + lx + 2) / 2 + 1.2]],
    },
  });
  b.walk('burrard-lift-hall-passage', liftHall, hallCross, [lx, y, -99]);
  b.walk('burrard-lift-passage-atrium', hallCross, hall, [10, y, -100]);
  b.walk('burrard-upper-lift-hub', liftUpper, upper, [
    lx,
    upperY,
    northZ - 0.5,
  ]);
  b.walk('burrard-lower-lift-hub', liftLower, lower, [lx, lowerY, lz + 2]);
  b.s.authoredInterior.primaryEntrance = 'burrard-burrard-street-entry';
  b.s.authoredInterior.streetEntranceMap = {
    'burrard-plaza': 'burrard-burrard-street-entry',
    'burrard-elevator': 'burrard-accessible-entry',
    'burrard-park': 'burrard-park-entry',
  };
  b.s.authoredInterior.escalatorCount = 5;
  b.s.authoredInterior.platformCalibration = {
    source:
      'OSM approximate platform ways 923508924/925 and mapped entrance nodes 5324651728/9198420892',
    platformCenterM: [dx, 0, dz],
    representativePlatformDepthsM: [-14, -20],
    sectionBasis:
      '27 observed/mapped park steps constrain sunken atrium section; platform assembly lowered rigidly by5m to retain plausible main-bank slope. Not a surveyed elevation.',
    carLocalCoordinatesUnchanged: true,
    undergroundBends: 'representative',
  };
  b.s.authoredInterior.routeSummary =
    'Mapped Burrard Street entry → unpaid glass atrium → main triple bank → platform-level faregates → upper Waterfront platform; separate short stairs/escalator → lower outbound platform. Mapped lift house has its own street gates.';
  return finishWithStairwells(b);
}

export function rebuildGranville(source) {
  const platformCenter = [82.48954321, 0, -38.6735285];
  const old = source.floorSurfaces.find(
    (f) => f.surfaceId === 'granville-upper',
  );
  const oldX =
    (Math.min(...old.verticesM.map((p) => p[0])) +
      Math.max(...old.verticesM.map((p) => p[0]))) /
    2;
  const oldZ =
    (Math.min(...old.verticesM.map((p) => p[2])) +
      Math.max(...old.verticesM.map((p) => p[2]))) /
    2;
  const b = interior(
    translateSourceXZ(
      source,
      platformCenter[0] - oldX,
      platformCenter[2] - oldZ,
    ),
    'granville-reference-interior-v3',
    references.granville,
  );
  preserveRailContract(b);
  const upperY = b.originalFloor('granville-upper').verticesM[0][1],
    lowerY = b.originalFloor('granville-lower').verticesM[0][1];
  const [px, , pz] = platformCenter,
    westX = px - 2.25;
  const mainX = 75.2,
    mainTopZ = -100,
    mainEndZ = mainTopZ + Math.sqrt(35 ** 2 - (-3 - upperY) ** 2),
    mainHubZ = mainEndZ + 5;
  const dx = 69.56010356,
    dz = -72.27427749,
    dStreetY = -2.07414,
    dEntryY = dStreetY - 3;
  const dBankX = 61.46,
    dTopZ = -84.43,
    dEndZ = -58.74,
    dHubZ = dEndZ + 5;
  // OSM constrains the independent Dunsmuir entrance/turns/bank direction. It
  // does not survey depths, widths or the unmarked original bank's exact axis.
  for (const [id, y] of [
    ['granville-upper', upperY],
    ['granville-lower', lowerY],
  ])
    platformShell(offsetArchitecture(b, px, pz), id, y, {
      northOpen: false,
      westDoors: [
        [mainHubZ - 2 - pz, mainHubZ + 2 - pz],
        [dHubZ - 2 - pz, dHubZ + 2 - pz],
      ],
    });
  const full = (w) => [[-w / 2, w / 2]];
  const rect = (
    id,
    x0,
    x1,
    z0,
    z1,
    y,
    kind,
    doors,
    roof = true,
    height = 3,
  ) => {
    const center = [(x0 + x1) / 2, y, (z0 + z1) / 2];
    b.floor(id, center, x1 - x0, z1 - z0, kind, id);
    b.room(id, center, x1 - x0, z1 - z0, {
      height,
      material: 'cream',
      roof,
      doors,
    });
    return id;
  };
  const ramp = (id, start, end, width) => {
    const alongX = start[0] !== end[0],
      minX = Math.min(start[0], end[0]),
      maxX = Math.max(start[0], end[0]),
      minZ = Math.min(start[2], end[2]),
      maxZ = Math.max(start[2], end[2]);
    b.floor(
      id,
      [(minX + maxX) / 2, start[1], (minZ + maxZ) / 2],
      alongX ? maxX - minX : width,
      alongX ? width : maxZ - minZ,
      'walk',
      id,
    );
    const floor = b.s.floorSurfaces.find((f) => f.surfaceId === id);
    for (const p of floor.verticesM)
      p[1] =
        start[1] +
        (end[1] - start[1]) *
          (alongX
            ? (p[0] - start[0]) / (end[0] - start[0])
            : (p[2] - start[2]) / (end[2] - start[2]));
    b.s.geometryParts = b.s.geometryParts.filter((p) => p.id !== `floor-${id}`);
    b.shaft(`${id}-enclosure`, start, end, width, { height: 2.6 });
    b.s.geometryParts = b.s.geometryParts.filter(
      (p) => p.id !== `${id}-enclosure-underslab`,
    );
    b.beam(
      `floor-${id}`,
      [start[0], start[1] - 0.1, start[2]],
      [end[0], end[1] - 0.1, end[2]],
      width,
      0.2,
      'floor',
      'floor',
    );
    return id;
  };
  const mall = rect(
    'granville-mall-entrance',
    -8,
    -2,
    -105.05,
    -77.5,
    0,
    'entrance',
    {
      north: [[-2, 2]],
      south: full(6),
      east: [
        [1.275, 5.275],
        [7.775, 13.775],
      ],
    },
  );
  entrance(
    b,
    'granville-mall-entry',
    'Granville Street / Hudson’s Bay / Pacific Centre',
    mall,
    [-5, 0, -104.8],
  );
  const bay = rect(
    'granville-bay-bottom-landing',
    10,
    16,
    -84.5,
    -77.5,
    -3,
    'landing',
    { west: full(7), north: full(6) },
  );
  bank(
    b,
    'granville-bay-corridor-pair',
    mall,
    bay,
    [-2.6, 0, -81],
    [10.6, -3, -81],
    2,
  );
  // The original entrance retains a separate enclosed bank. The original mall
  // corridor's hidden bend and shaft offset are representative, not OSM claims.
  const originalNorth = rect(
    'granville-original-mall-passage',
    10,
    16,
    -106,
    -84.5,
    -3,
    'walk',
    { south: full(6), east: [[-10.75, -6.75]] },
    true,
    2.6,
  );
  b.walk('granville-bay-mall-passage', bay, originalNorth, [13, -3, -84.5]);
  const originalCross = rect(
    'granville-original-mall-crosspassage',
    16,
    72,
    -108,
    -102,
    -3,
    'walk',
    { west: [[-1, 3]], east: full(6), south: [[23, 28]] },
  );
  b.walk(
    'granville-original-mall-turn',
    originalNorth,
    originalCross,
    [16, -3, -104],
  );
  const hall = rect(
    'granville-original-ticket-hall',
    72,
    83.5,
    -110,
    -100,
    -3,
    'concourse',
    { west: [[-3, 5]], south: [[mainX - 77.75 - 2.8, mainX - 77.75 + 2.8]] },
    true,
    3.2,
  );
  b.walk('granville-mall-ticket-hall', originalCross, hall, [72, -3, -106]);
  roundConcourseColumn(
    b,
    'granville-original-ticket-hall-round-column',
    [77.75, -3, -106.3],
    3.2,
  );
  for (let i = 0; i < 3; i++)
    b.box(
      `granville-original-ticket-machine-${i}`,
      [78 + i * 1.2, -2, -109.4],
      [0.95, 2, 0.55],
      'steel',
      'ticket-machine',
      0,
      true,
    );
  b.fareGates(
    'granville-original-faregates',
    [77.7, -3, -102.2],
    [-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8],
  );
  b.sign('Expo Line  ↓  Platforms 1 & 2', [77.7, -0.55, -101.5], 0, 5.2, 0.4);
  const mainUpper = rect(
    'granville-upper-hub',
    64.5,
    westX,
    mainEndZ,
    mainEndZ + 10,
    upperY,
    'landing',
    {
      north: [
        [mainX - (64.5 + westX) / 2 - 2.8, mainX - (64.5 + westX) / 2 + 2.8],
      ],
      west: [[-4.5, 0.1]],
      east: [[-2, 2]],
    },
    false,
    2.8,
  );
  const mainLower = rect(
    'granville-lower-hub',
    49.5,
    westX,
    mainEndZ,
    mainEndZ + 10,
    lowerY,
    'landing',
    {
      south: [[76 - (49.5 + westX) / 2 - 2, 76 - (49.5 + westX) / 2 + 2]],
      east: [[-2, 2]],
    },
    false,
    2.8,
  );
  bank(
    b,
    'granville-big-three',
    hall,
    mainUpper,
    [mainX, -3, mainTopZ],
    [mainX, upperY, mainEndZ],
    3,
  );
  b.flight(
    'granville-interplatform-stairs',
    mainUpper,
    mainLower,
    [64.5, upperY, mainHubZ - 3.1],
    [52.5, lowerY, mainHubZ - 3.1],
    2.4,
  );
  b.flight(
    'granville-interplatform-escalator',
    mainUpper,
    mainLower,
    [64.5, upperY, mainHubZ - 0.75],
    [52.5, lowerY, mainHubZ - 0.75],
    1.3,
    { kind: 'escalator' },
  );
  for (const [id, target, y] of [
    [mainUpper, 'granville-upper', upperY],
    [mainLower, 'granville-lower', lowerY],
  ])
    b.walk(
      `${id}-platform-portal`,
      id,
      target,
      [westX, y, mainHubZ],
      [westX, y, mainHubZ],
      4,
    );
  b.box(
    'granville-upper-hub-ceiling',
    [(64.5 + westX) / 2, upperY + 2.8, mainHubZ],
    [westX - 64.5, 0.18, 10.2],
    'cream',
    'ceiling',
  );
  b.box(
    'granville-lower-hub-ceiling',
    [(64.5 + westX) / 2, lowerY + 2.8, mainHubZ],
    [westX - 64.5, 0.18, 10.2],
    'cream',
    'ceiling',
  );
  b.box(
    'granville-retail-kiosk',
    [68, upperY + 1.05, mainEndZ + 0.8],
    [2.8, 2.1, 1.35],
    'black',
    'retail',
    0,
    true,
  );
  b.sign(
    'Platform 1  ·  Waterfront  →',
    [74, upperY + 2.1, mainHubZ - 3.7],
    0,
    5,
    0.38,
  );
  b.sign(
    '← Platform 2  ·  King George / Production Way–University',
    [70, upperY + 2.1, mainHubZ + 3.7],
    0,
    6.5,
    0.38,
  );
  const sx = 22.61400566,
    sz = -30.86257589,
    seymourStreetY = 1.21093,
    seymourDoorY = 1.2336301520610071;
  // Whitfield2013 Figure59 shows a street-facing NW entry recess, then a right
  // turn NE down the stair. OSM locates the stair head, not its street facade.
  // Seven metres to the SE is inferred from that photograph and the current
  // Bay-building footprint; it is deliberately not labelled an OSM door node.
  const seymour = rect(
    'granville-seymour-entrance',
    sx - 3,
    sx + 3,
    sz - 3,
    sz + 7,
    seymourStreetY,
    'entrance',
    { east: [[-3.9, -0.1]], south: [[-2, 2]] },
  );
  // The city sample at the inferred facade is22.7mm above the retained stair
  // head. Keep the stair fixed and express that normal threshold explicitly.
  carveFloorRect(b.s, seymour, {
    minX: sx - 3,
    maxX: sx + 3,
    minZ: sz + 6,
    maxZ: sz + 7.1,
  });
  const seymourForecourt = b.floor(
    'granville-seymour-street-recess-threshold',
    [sx, seymourDoorY, sz + 6.5],
    6,
    1,
    'entrance',
    'granville-seymour-street-recess-threshold',
  );
  b.walk(
    'granville-seymour-recess-threshold',
    seymourForecourt,
    seymour,
    [sx, seymourDoorY, sz + 6],
    [sx, seymourStreetY, sz + 6],
  );
  entrance(
    b,
    'granville-seymour-entry',
    'Seymour Street staircase',
    seymourForecourt,
    [sx, seymourDoorY, sz + 7],
  );
  b.sign(
    'Granville Station',
    [sx, seymourStreetY + 2.65, sz + 7.05],
    Math.PI,
    4,
    0.4,
  );
  const sBottom = rect(
    'granville-seymour-bottom-landing',
    sx + 11,
    58,
    sz - 3,
    sz + 3,
    dStreetY,
    'landing',
    { west: full(6), east: full(6) },
  );
  b.flight(
    'granville-seymour-stairs',
    seymour,
    sBottom,
    [sx + 2.4, seymourStreetY, sz],
    [sx + 11.6, dStreetY, sz],
    3.2,
  );
  const sEast = rect(
    'granville-seymour-east-passage',
    58,
    71,
    sz - 3,
    sz + 3,
    dStreetY,
    'walk',
    { west: full(6), north: [[2.5, 6.5]] },
  );
  b.walk('granville-seymour-east-turn', sBottom, sEast, [58, dStreetY, sz]);
  const sNorth = rect(
    'granville-seymour-north-passage',
    67,
    71,
    -85,
    sz - 3,
    dStreetY,
    'walk',
    {
      south: full(4),
      north: full(4),
      west: [[dz - 2 - (-85 + sz - 3) / 2, dz + 2 - (-85 + sz - 3) / 2]],
      east: [
        [-85 - (-85 + sz - 3) / 2, -81 - (-85 + sz - 3) / 2],
        [-76 - (-85 + sz - 3) / 2, -68.5 - (-85 + sz - 3) / 2],
      ],
    },
  );
  b.walk('granville-seymour-north-turn', sEast, sNorth, [69, dStreetY, sz - 3]);
  const sTurn = rect(
    'granville-seymour-ticket-turn',
    67,
    74.5,
    -85,
    -81,
    dStreetY,
    'landing',
    {
      west: full(4),
      south: full(7.5),
      north: [
        [-3.75, -2.75],
        [-2.25, 0.75],
      ],
    },
  );
  b.walk('granville-seymour-ticket-east-turn', sNorth, sTurn, [
    71,
    dStreetY,
    -83,
  ]);
  const sRamp = ramp(
    'granville-seymour-ticket-passage',
    [70, dStreetY, -85],
    [70, -3, -100],
    3,
  );
  b.walk('granville-seymour-ticket-ramp', sTurn, sRamp, [70, dStreetY, -85]);
  const sCorner = rect(
    'granville-seymour-ticket-corner',
    68.5,
    72,
    -104,
    -100,
    -3,
    'landing',
    { north: full(3.5), south: full(3.5), east: full(4) },
  );
  b.walk('granville-seymour-ticket-corner', sRamp, sCorner, [70, -3, -100]);
  b.walk('granville-seymour-ticket-door', sCorner, hall, [72, -3, -102]);
  // The mapped entrance runs southwest/source-X, then turns north and east
  // through the level -1 hall before the independent Dunsmuir triple shaft.
  const dHall = rect(
    'granville-dunsmuir-street-hall',
    dx,
    dx + 1.8,
    dz - 3.75,
    dz + 3.75,
    dStreetY,
    'entrance',
    { west: full(7.5), east: full(7.5), north: full(1.8), south: full(1.8) },
    true,
    3.2,
  );
  entrance(
    b,
    'granville-dunsmuir-entry',
    'Dunsmuir Street / Hudson accessible entrance',
    dHall,
    [dx, dStreetY, dz],
  );
  b.walk('granville-dunsmuir-upper-mall-branch', dHall, sNorth, [
    dx + 0.45,
    dStreetY,
    dz,
  ]);
  const dEntry = rect(
    'granville-dunsmuir-entry-lower-hall',
    51.76,
    dx - 5.4,
    dz - 3,
    dz + 3,
    dEntryY,
    'landing',
    { east: full(6), north: [[-6.2, -2.2]] },
    true,
    3.2,
  );
  b.flight(
    'granville-dunsmuir-entry-stairs',
    dHall,
    dEntry,
    [dx, dStreetY, dz],
    [dx - 5.4, dEntryY, dz],
    3.2,
  );
  const dNorth = rect(
    'granville-dunsmuir-entry-north-passage',
    49.76,
    53.76,
    -84.43,
    dz - 3,
    dEntryY,
    'walk',
    { south: [[0, 2]], north: full(4) },
    true,
    3.2,
  );
  b.walk('granville-dunsmuir-entry-turn-north', dEntry, dNorth, [
    52.76,
    dEntryY,
    dz - 3,
  ]);
  const dTop = rect(
    'granville-dunsmuir-bank-top-hall',
    49.76,
    64.5,
    -87.43,
    -81.43,
    dEntryY,
    'concourse',
    {
      south: [
        [-7.37, -3.37],
        [dBankX - 57.13 - 2.8, dBankX - 57.13 + 2.8],
      ],
    },
    false,
    5.2,
  );
  b.box(
    'granville-dunsmuir-bank-top-hall-ceiling',
    [57.13, dEntryY + 5.2, -85.93],
    [14.94, 0.18, 3.2],
    'cream',
    'ceiling',
  );
  b.walk('granville-dunsmuir-entry-turn-east', dNorth, dTop, [
    51.76,
    dEntryY,
    -84.43,
  ]);
  b.box(
    'granville-dunsmuir-top-hall-square-column',
    [56.5, dEntryY + 2.6, -86.5],
    [0.65, 5.2, 0.65],
    'tile',
    'column',
    0,
    true,
  );
  const dUpper = rect(
    'granville-dunsmuir-upper-hub',
    57,
    westX,
    dEndZ,
    dEndZ + 10,
    upperY,
    'landing',
    {
      north: [
        [dBankX - (57 + westX) / 2 - 2.8, dBankX - (57 + westX) / 2 + 2.8],
      ],
      west: [[-3.2, 0.1]],
      east: [[-2, 2]],
    },
    true,
    2.8,
  );
  const dLower = rect(
    'granville-dunsmuir-lower-hub',
    42,
    westX,
    dEndZ,
    dEndZ + 10,
    lowerY,
    'landing',
    {
      north: [[76 - (42 + westX) / 2 - 2, 76 - (42 + westX) / 2 + 2]],
      east: [[-2, 2]],
    },
    false,
    2.8,
  );
  bank(
    b,
    'granville-dunsmuir-main-triple',
    dTop,
    dUpper,
    [dBankX, dEntryY, dTopZ],
    [dBankX, upperY, dEndZ],
    3,
    { vaulted: false, shaftHeight: 5.2 },
  );
  b.fareGates(
    'granville-dunsmuir-upper-hub-faregates',
    [72, upperY, dHubZ],
    [-3.2, -1.6, 0, 1.6, 3.2],
    90,
  );
  b.box(
    'granville-dunsmuir-farehall-square-column',
    [67.5, upperY + 1.4, dHubZ + 3.25],
    [0.65, 2.8, 0.65],
    'tile',
    'column',
    0,
    true,
  );
  b.box(
    'granville-dunsmuir-ticket-machine',
    [58, upperY + 1, dEndZ + 8.8],
    [0.55, 2, 0.95],
    'steel',
    'ticket-machine',
    0,
    true,
  );
  b.flight(
    'granville-dunsmuir-interplatform-stairs',
    dUpper,
    dLower,
    [57, upperY, dHubZ - 1.6],
    [45, lowerY, dHubZ - 1.6],
    2.4,
  );
  b.box(
    'granville-dunsmuir-lower-hub-ceiling',
    [(57 + westX) / 2, lowerY + 2.8, dHubZ],
    [westX - 57, 0.18, 10.2],
    'cream',
    'ceiling',
  );
  for (const [id, target, y] of [
    [dUpper, 'granville-upper', upperY],
    [dLower, 'granville-lower', lowerY],
  ])
    b.walk(
      `${id}-platform-portal`,
      id,
      target,
      [westX, y, dHubZ],
      [westX, y, dHubZ],
      4,
    );
  const liftZ = -56;
  b.elevator(
    'granville-dunsmuir-lift-upper',
    sNorth,
    dUpper,
    [dx, dStreetY, liftZ],
    [dx, upperY, liftZ],
  );
  b.elevator(
    'granville-dunsmuir-lift-lower',
    dUpper,
    dLower,
    [dx, upperY, liftZ],
    [dx, lowerY, liftZ],
  );
  const lowLink = rect(
    'granville-lower-platform-hub-passage',
    74,
    78,
    mainEndZ + 10,
    dEndZ,
    lowerY,
    'walk',
    { north: full(4), south: full(4) },
    true,
    2.8,
  );
  b.walk('granville-lower-original-hub-link', mainLower, lowLink, [
    76,
    lowerY,
    mainEndZ + 10,
  ]);
  b.walk('granville-lower-dunsmuir-hub-link', lowLink, dLower, [
    76,
    lowerY,
    dEndZ,
  ]);
  const unpaidWest = rect(
    'granville-unpaid-mall-crosspassage',
    -2,
    16,
    -91,
    -87,
    0,
    'walk',
    { west: full(4), east: full(4) },
  );
  const unpaid = ramp(
    'granville-unpaid-hudson-passage',
    [16, 0, -89],
    [66, dStreetY, -89],
    4,
  );
  b.walk('granville-unpaid-original-entry', mall, unpaidWest, [-2, 0, -89]);
  b.walk('granville-unpaid-west-turn', unpaidWest, unpaid, [16, 0, -89]);
  const unpaidNorth = rect(
    'granville-unpaid-dunsmuir-passage',
    66,
    68,
    -91,
    -80,
    dStreetY,
    'walk',
    { west: [[-5.5, -1.5]], east: [[0.5, 4.5]], south: full(2) },
  );
  b.walk('granville-unpaid-hudson-turn', unpaid, unpaidNorth, [
    66,
    dStreetY,
    -89,
  ]);
  b.walk('granville-unpaid-dunsmuir-hall', unpaidNorth, sNorth, [
    67.5,
    dStreetY,
    -85,
  ]);
  for (const [id, direction] of [
    ['granville-mall-entry', [0, 0, 1]],
    ['granville-seymour-entry', [0, 0, -1]],
    ['granville-dunsmuir-entry', [-1, 0, 0]],
  ])
    b.s.entrances.find((e) => e.entranceId === id).inwardDirectionM = direction;
  b.s.authoredInterior.primaryEntrance = 'granville-mall-entry';
  b.s.authoredInterior.streetEntranceMap = {
    'granville-street': 'granville-mall-entry',
    'seymour-street': 'granville-seymour-entry',
    'dunsmuir-street': 'granville-dunsmuir-entry',
  };
  b.s.authoredInterior.escalatorCount = 9;
  b.s.authoredInterior.officialBigThreeLengthM = 35;
  b.s.authoredInterior.concourseColumns = {
    original:
      'Photographed round stainless ticket-hall column; faceted panel geometry, diameter and position inferred.',
    dunsmuir:
      'Photographed square tiled concourse columns; selected clear hall positions and dimensions inferred.',
    platform: 'No added platform-vault columns.',
  };
  b.s.authoredInterior.platformCalibration = {
    source:
      'OSM approximate platform ways551342757/923508926; mapped street nodes889550073/1248731632 and Seymour way138641322',
    platformCenterM: platformCenter,
    carLocalCoordinatesUnchanged: true,
    undergroundBends: 'representative',
    streetHeightBasis:
      'Current city DEM at mapped street portals; underground section inferred.',
  };
  b.s.authoredInterior.mappedDunsmuirPath = {
    entranceDirectionM: [-1, 0, 0],
    entryHallM: [54.45, dEntryY, -71.69],
    northTurnM: [51.76, dEntryY, -85],
    bankHeadM: [dBankX, dEntryY, dTopZ],
    bankFootM: [dBankX, upperY, dEndZ],
    sourceWays: ['138641324', '138641331', '138641330', '138641320'],
    qualification:
      'Horizontal topology/direction constrained by OSM; step runs, widths, exact shaft axis and elevations inferred.',
  };
  b.s.authoredInterior.seymourStreetRecess = {
    photo:
      'https://digital.lib.washington.edu/server/api/core/bitstreams/e7c27087-87fd-476e-ab80-87d30d24c2ac/content',
    photoDetail:
      'Michelle Marie Whitfield2013, Turn Left at the Station, Figure59 (PDF page73 / printed59). Street-facing recess, right turn to descending stairs.',
    mappedStairHead: {
      coordinatesLonLat: [-123.1161381, 49.2827226],
      sourcePointM: [sx, seymourStreetY, sz],
      source: 'https://www.openstreetmap.org/way/138641322',
    },
    inferredStreetDoor: {
      sourcePointM: [sx, seymourDoorY, sz + 7],
      coordinatesLonLat: [-123.11606963320845, 49.282678332362714],
      streetThresholdHeightM: seymourDoorY - seymourStreetY,
      inwardDirectionM: [0, 0, -1],
      basis:
        'Street-facing portal derived7m SE from mapped stair head, photograph and Bay-building footprint; street-door coordinate and recess dimensions are inferred, not an independently mapped doorway.',
    },
  };
  b.s.authoredInterior.routeSummary =
    'Granville Street → original Bay pair / mall ticket hall → independent 35m vaulted Big3 → platforms. Seymour joins the unpaid upper mall passage. Dunsmuir enters southwest to a lower unpaid hall, turns north/east to its distinct rectangular triple shaft, then reaches bottom faregates and the same three-level elevator.';
  b.s.authoredInterior.unverifiedDetails = [
    'OSM platform polygons explicitly say location approximate. The original Big3 hidden mall bend/parallel shaft offset is representative, not measured; only its35m sloping length and grouping are published.',
    'Dunsmuir follows the mapped entry direction and corridor/bank turns; the 3m entry descent, shaft rise/run components and hall widths are inferred. The one elevator serves street and both platforms via two graph edges, not two separate lifts.',
  ];
  return finishWithStairwells(b);
}

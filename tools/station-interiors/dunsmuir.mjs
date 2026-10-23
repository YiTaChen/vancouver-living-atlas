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
    const originalLevel = b.base.levels.find((l) => l.levelId === f.levelId);
    if (originalLevel) b.s.levels.push(structuredClone(originalLevel));
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

function finishWithStairwells(b) {
  // A landing under ascending treads would win the runtime's coplanar floor
  // selection and let the walker continue beneath the visible staircase.
  // Remove that footprint from both walking triangles and the actual slab.
  for (const c of b.s.connections.filter((c) => c.treadSurfaces?.length)) {
    const lowerId =
      c.startPointM[1] < c.endPointM[1] ? c.fromSurfaceId : c.toSurfaceId;
    const lower = b.s.floorSurfaces.find((f) => f.surfaceId === lowerId);
    const points = c.treadSurfaces.flatMap((t) => t.verticesM);
    const cut = {
      minX: Math.min(...points.map((p) => p[0])),
      maxX: Math.max(...points.map((p) => p[0])),
      minZ: Math.min(...points.map((p) => p[2])),
      maxZ: Math.max(...points.map((p) => p[2])),
    };
    const minX = Math.min(...lower.verticesM.map((p) => p[0])),
      maxX = Math.max(...lower.verticesM.map((p) => p[0]));
    const minZ = Math.min(...lower.verticesM.map((p) => p[2])),
      maxZ = Math.max(...lower.verticesM.map((p) => p[2]));
    if (
      Math.min(maxX, cut.maxX) - Math.max(minX, cut.minX) > 0.001 &&
      Math.min(maxZ, cut.maxZ) - Math.max(minZ, cut.minZ) > 0.001
    )
      carveFloorRect(b.s, lowerId, cut);
  }
  return b.finish();
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
    height: 2.25,
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
    [0.25, 3.6, 86],
    'black',
    'wall',
  );
  vault(b, id, [1.55, y, -43], [1.55, y, 43], 8.15, {
    spring: 2.25,
    rise: 1.15,
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
  for (const z of [-15, 22])
    b.bench(`${id}-bench-${z}`, [-1.7, y, z], 2.4, 90, { material: 'steel' });
}

function ticketFurniture(b, id, center, { tiled = false, grid = true } = {}) {
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
  for (let i = 0; i < 6; i++) {
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

function originalHub(b, id, upperY, lowerY, { retail = false } = {}) {
  const upper = `${id}-upper-hub`,
    lower = `${id}-lower-hub`;
  b.floor(
    upper,
    [-5.875, upperY, -42],
    16.25,
    10,
    'landing',
    `${id}-upper-level`,
  );
  b.room(upper, [-5.875, upperY, -42], 16.25, 10, {
    height: 2.35,
    material: 'cream',
    roof: false,
    doors: {
      north: [
        [-7.2, -3],
        [-2, 4.5],
      ],
      south: [[3.625, 8.125]],
      west: [
        [-3, 0],
        [1.5, 4],
      ],
    },
  });
  vault(b, upper, [-5.875, upperY, -47], [-5.875, upperY, -37], 16.25, {
    spring: 2.35,
    rise: 1.2,
  });
  b.floor(
    lower,
    [-12.875, lowerY, -42],
    30.25,
    10,
    'landing',
    `${id}-lower-level`,
  );
  b.room(lower, [-12.875, lowerY, -42], 30.25, 10, {
    height: 2.6,
    material: 'cream',
    roof: false,
    doors: {
      north: [[-0.125, 3.875]],
      south: [[10.625, 15.125]],
      west: [
        [-3, 0],
        [1.5, 4],
      ],
    },
  });
  // The lower hall's ceiling must not slice through the descending connector.
  // Its western portion is already enclosed by the stair/escalator soffits.
  b.box(
    `${lower}-ceiling`,
    [-5.375, lowerY + 2.6, -42],
    [15.25, 0.18, 10.2],
    'cream',
    'ceiling',
  );
  b.walk(
    `${id}-upper-platform-portal`,
    upper,
    `${id}-upper`,
    [0, upperY, -37],
    [0, upperY, -37],
    4.5,
  );
  b.walk(
    `${id}-lower-platform-portal`,
    lower,
    `${id}-lower`,
    [0, lowerY, -37],
    [0, lowerY, -37],
    4.5,
  );
  b.flight(
    `${id}-interplatform-stairs`,
    upper,
    lower,
    [-14, upperY, -43.5],
    [-26, lowerY, -43.5],
    2.4,
    { material: 'cream' },
  );
  b.flight(
    `${id}-interplatform-escalator`,
    upper,
    lower,
    [-14, upperY, -39.5],
    [-26, lowerY, -39.5],
    1.3,
    { kind: 'escalator', material: 'cream' },
  );
  b.sign(
    '←  Platform 2  ·  King George / Production Way–University',
    [-9, upperY + 2.0, -38],
    0,
    6.8,
    0.38,
  );
  b.sign(
    'Platform 1  ·  Waterfront  →',
    [-2, upperY + 2.05, -38],
    0,
    4.2,
    0.38,
  );
  if (retail) {
    b.box(
      `${id}-retail-kiosk`,
      [-9.1, upperY + 1.12, -45.6],
      [3.2, 2.24, 1.6],
      'black',
      'retail',
      0,
      true,
    );
    b.box(
      `${id}-retail-door`,
      [-9.1, upperY + 0.95, -44.75],
      [1.25, 1.9, 0.04],
      'glass',
      'detail',
    );
    b.box(
      `${id}-red-service-panel`,
      [-6.9, upperY + 1.1, -45.0],
      [0.65, 2.2, 0.12],
      'red',
      'detail',
    );
    b.sign('Station shop', [-9.1, upperY + 2.2, -44.74], 0, 2.8, 0.28);
  }
  return { upper, lower };
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

export function rebuildBurrard(source) {
  const b = interior(
    source,
    'burrard-reference-interior-v1',
    references.burrard,
  );
  preserveRailContract(b);
  const upperY = b.originalFloor('burrard-upper').verticesM[0][1];
  const lowerY = b.originalFloor('burrard-lower').verticesM[0][1];
  platformShell(b, 'burrard-upper', upperY);
  platformShell(b, 'burrard-lower', lowerY);
  const hubs = originalHub(b, 'burrard', upperY, lowerY);
  const hall = 'burrard-ticket-atrium',
    street = 'burrard-street-plaza',
    y = -2.6;
  b.floor(hall, [-5, y, -68], 22, 14, 'concourse', hall);
  b.room(hall, [-5, y, -68], 22, 14, {
    height: 2.5,
    material: 'concrete',
    roof: false,
    doors: {
      north: [[-5.5, 5.5]],
      south: [
        [-8, -4],
        [-3.5, 3.5],
      ],
      west: [[-2.5, 2.5]],
      east: [[-2.5, 2.5]],
    },
  });
  glazedAtrium(b, hall, [-5, y, -68]);
  ticketFurniture(b, hall, [-5, y, -68], { grid: false });
  bank(
    b,
    'burrard-main-escalator-bank',
    hall,
    hubs.upper,
    [-5, y, -61],
    [-5, upperY, -47],
    3,
  );
  b.floor(street, [-5, 0, -85], 18, 6, 'entrance', street);
  b.flight(
    'burrard-street-stairs',
    street,
    hall,
    [-7, 0, -82],
    [-7, y, -75],
    4.6,
    { enclosed: false },
  );
  b.flight(
    'burrard-street-escalator',
    street,
    hall,
    [-2.2, 0, -82],
    [-2.2, y, -75],
    1.3,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft('burrard-street-retaining-walls', [-5, 0, -82], [-5, y, -75], 10.2, {
    material: 'concrete',
    roof: false,
  });
  b.sign('Burrard Station  ·  Expo Line', [-5, 2.5, -82.5], 0, 7.5, 0.55);
  entrance(
    b,
    'burrard-burrard-street-entry',
    'Burrard Street / park stair and escalator',
    street,
    [-5, 0, -87.8],
  );

  // Mall doors belong to the same concourse, rather than creating a second
  // independent staircase down to the other train platform.
  for (const [name, x, label] of [
    ['royal-centre', -20, 'Royal Centre'],
    ['bentall-centre', 10, 'Bentall Centre'],
  ]) {
    const floor = `burrard-${name}-passage`;
    b.floor(floor, [x, y, -68], 8, 5, 'walk', hall);
    b.room(floor, [x, y, -68], 8, 5, {
      height: 3,
      doors: { west: [[-2, 2]], east: [[-2, 2]] },
    });
    const edge = x < -5 ? -16 : 6;
    b.walk(
      `${floor}-atrium-door`,
      floor,
      hall,
      [edge, y, -68],
      [edge, y, -68],
      4,
    );
    b.sign(`${label}  ↔`, [x, y + 2.25, -68], 0, 4, 0.36);
  }
  const liftStreet = 'burrard-accessible-street',
    liftHall = 'burrard-lift-hall',
    liftUpper = 'burrard-lift-upper',
    liftLower = 'burrard-lift-lower';
  for (const [floor, levelY, levelId] of [
    [liftStreet, 0, street],
    [liftHall, y, hall],
    [liftUpper, upperY, 'burrard-upper-level'],
    [liftLower, lowerY, 'burrard-lower-level'],
  ])
    b.floor(floor, [-11, levelY, -57], 4, 6, 'landing', levelId);
  b.elevator(
    'burrard-lift-street-concourse',
    liftStreet,
    liftHall,
    [-11, 0, -57],
    [-11, y, -57],
  );
  b.elevator(
    'burrard-lift-concourse-upper',
    liftHall,
    liftUpper,
    [-11, y, -57],
    [-11, upperY, -57],
  );
  b.elevator(
    'burrard-lift-upper-lower',
    liftUpper,
    liftLower,
    [-11, upperY, -57],
    [-11, lowerY, -57],
  );
  // Enclosed lift passages stay outside the main bank and join its landings.
  for (const [target, fy, endZ, width] of [
    [hall, y, -61, 4],
    [hubs.upper, upperY, -47, 4],
    [hubs.lower, lowerY, -47, 4],
  ]) {
    const floor = `${target}-lift-passage`,
      z = (-60 + endZ) / 2;
    b.floor(floor, [-11, fy, z], width, Math.abs(endZ + 60), 'walk', target);
    b.room(floor, [-11, fy, z], width, Math.abs(endZ + 60), {
      height: 2.7,
      doors: { north: [[-2, 2]], south: [[-2, 2]] },
    });
    const landing =
      target === hall
        ? liftHall
        : target === hubs.upper
          ? liftUpper
          : liftLower;
    b.walk(`${floor}-lift`, landing, floor, [-11, fy, -60]);
    b.walk(`${floor}-join`, floor, target, [-11, fy, endZ]);
  }
  entrance(
    b,
    'burrard-accessible-entry',
    'Burrard Street elevator entrance',
    liftStreet,
    [-11, 0, -57],
  );
  b.s.entrances[0].inwardDirectionM = [0, 0, 1];
  b.s.authoredInterior.primaryEntrance = 'burrard-burrard-street-entry';
  b.s.authoredInterior.streetEntranceMap = {
    'burrard-plaza': 'burrard-burrard-street-entry',
  };
  b.s.authoredInterior.escalatorCount = 5;
  b.s.authoredInterior.routeSummary =
    'Shared glass ticket atrium → three main escalators → upper Waterfront platform; short stairs/escalator → lower outbound platform. Street stair/single escalator and one elevator system.';
  return finishWithStairwells(b);
}

export function rebuildGranville(source) {
  const b = interior(
    source,
    'granville-reference-interior-v1',
    references.granville,
  );
  preserveRailContract(b);
  const upperY = b.originalFloor('granville-upper').verticesM[0][1];
  const lowerY = b.originalFloor('granville-lower').verticesM[0][1];
  platformShell(b, 'granville-upper', upperY, { southOpen: true });
  platformShell(b, 'granville-lower', lowerY, { southOpen: true });
  const hubs = originalHub(b, 'granville', upperY, lowerY, { retail: true });
  const hall = 'granville-original-ticket-hall',
    mall = 'granville-mall-entrance',
    seymour = 'granville-seymour-entrance',
    y = -3;
  b.floor(hall, [-5, y, -85], 22, 14, 'concourse', hall);
  b.room(hall, [-5, y, -85], 22, 14, {
    height: 3.2,
    material: 'cream',
    doors: { north: [[-3.5, 3.5]], south: [[-3.5, 3.5]], east: [[-2, 2]] },
  });
  ticketFurniture(b, hall, [-5, y, -85]);
  // A 17 m representative rise and 30.594 m run give the published 35 m
  // sloping length without pretending either component was surveyed.
  const run = Math.sqrt(35 ** 2 - (y - upperY) ** 2);
  const bottomZ = -46,
    topZ = bottomZ - run;
  const bankLanding = 'granville-big-three-top-landing';
  b.floor(
    bankLanding,
    [-5, y, (-78 + topZ) / 2],
    6.5,
    Math.abs(-78 - topZ),
    'landing',
    hall,
  );
  b.room(bankLanding, [-5, y, (-78 + topZ) / 2], 6.5, Math.abs(-78 - topZ), {
    height: 3,
    material: 'cream',
    roof: true,
    doors: { north: [[-3.25, 3.25]], south: [[-3.25, 3.25]] },
  });
  b.walk(
    'granville-hall-big-three-landing',
    hall,
    bankLanding,
    [-5, y, -78],
    [-5, y, -78],
    6.5,
  );
  bank(
    b,
    'granville-big-three',
    bankLanding,
    hubs.upper,
    [-5, y, topZ],
    [-5, upperY, bottomZ],
    3,
  );
  b.floor(mall, [-5, 0, -102], 14, 6, 'entrance', mall);
  b.room(mall, [-5, 0, -102], 14, 6, {
    height: 3.2,
    doors: { north: [[-4, 4]], south: [[-3.5, 3.5]], east: [[-2, 2]] },
  });
  bank(
    b,
    'granville-bay-corridor-pair',
    mall,
    hall,
    [-5, 0, -99],
    [-5, y, -92],
    2,
  );
  entrance(
    b,
    'granville-mall-entry',
    'Granville Street / Hudson’s Bay / Pacific Centre',
    mall,
    [-5, 0, -104.8],
  );
  // Relative street-door offsets come from the reference entrance coordinates;
  // the hallway bends between them remain explicitly representative.
  const sx = 27.247,
    sz = -25.409;
  b.floor(seymour, [sx + 1, 0, sz], 6, 8, 'entrance', seymour);
  b.room(seymour, [sx + 1, 0, sz], 6, 8, {
    height: 3.2,
    doors: { east: [[-3, 3]], west: [[-2, 2]] },
  });
  const sLanding = 'granville-seymour-bottom-landing',
    sPassage = 'granville-seymour-ticket-passage',
    sCross = 'granville-seymour-ticket-crosspassage';
  b.floor(sLanding, [sx - 12, y, sz], 4, 8, 'landing', hall);
  b.room(sLanding, [sx - 12, y, sz], 4, 8, {
    height: 3,
    doors: { east: [[-2, 2]], north: [[-2, 2]] },
  });
  b.flight(
    'granville-seymour-stairs',
    seymour,
    sLanding,
    [sx - 2, 0, sz],
    [sx - 10, y, sz],
    3.2,
    { material: 'cream' },
  );
  b.floor(
    sPassage,
    [sx - 12, y, (-85 + sz - 4) / 2],
    4,
    sz - 4 + 85,
    'walk',
    hall,
  );
  const seymourLength = sz - 4 + 85;
  b.room(sPassage, [sx - 12, y, (-85 + sz - 4) / 2], 4, seymourLength, {
    height: 3,
    doors: {
      north: [[-2, 2]],
      south: [[-2, 2]],
      west: [[-seymourLength / 2, -seymourLength / 2 + 2]],
    },
  });
  b.walk('granville-seymour-landing-passage', sLanding, sPassage, [
    sx - 12,
    y,
    sz - 4,
  ]);
  const crossWidth = sx - 10 - 6,
    crossX = (sx - 10 + 6) / 2;
  b.floor(sCross, [crossX, y, -85], crossWidth, 4, 'walk', hall);
  b.room(sCross, [crossX, y, -85], crossWidth, 4, {
    height: 3,
    doors: { west: [[-2, 2]], south: [[crossWidth / 2 - 4, crossWidth / 2]] },
  });
  b.walk('granville-seymour-passage-turn', sPassage, sCross, [sx - 12, y, -85]);
  b.walk('granville-seymour-ticket-hall-door', sCross, hall, [6, y, -85]);
  b.sign('Seymour Street  ↑', [sx - 1, 2.4, sz], Math.PI / 2, 4.5, 0.42);
  entrance(b, 'granville-seymour-entry', 'Seymour Street staircase', seymour, [
    sx,
    0,
    sz,
  ]);

  // Independent Hudson/Dunsmuir branch: the official 2023 shaft photograph
  // shows all three escalators together, within a tall tiled rectangular shaft.
  const dHall = 'granville-dunsmuir-street-hall',
    dUpper = 'granville-dunsmuir-upper-hub',
    dLower = 'granville-dunsmuir-lower-hub';
  const dx = 49.108,
    dz = -69.667,
    bankEndX = dx - 41;
  b.floor(dHall, [dx, 0, dz], 14, 18, 'concourse', dHall);
  b.room(dHall, [dx, 0, dz], 14, 18, {
    height: 3.2,
    material: 'cream',
    doors: { west: [[-4.5, 4.5]], south: [[-4, 4]], north: [[-4, 4]] },
  });
  // This upper hall is unpaid. Actual photographs place Dunsmuir's faregates
  // below the triple bank, beside the elevator, at the platform access level.
  for (const u of [-5, 5])
    b.box(
      `${dHall}-square-column-${u}`,
      [dx + u, 1.5, dz + 4],
      [0.55, 3, 0.55],
      'cream',
      'column',
      0,
      true,
    );
  b.sign(
    'Expo Line  ↓  Escalators and elevator',
    [dx, 2.4, dz - 4.5],
    0,
    5.2,
    0.4,
  );
  entrance(
    b,
    'granville-dunsmuir-entry',
    'Dunsmuir Street / Hudson accessible entrance',
    dHall,
    [dx, 0, dz + 7.8],
  );
  const dUpperWidth = bankEndX + 14,
    dLowerWidth = bankEndX + 28;
  b.floor(
    dUpper,
    [(bankEndX - 14) / 2, upperY, dz],
    dUpperWidth,
    10,
    'landing',
    'granville-upper-level',
  );
  b.room(dUpper, [(bankEndX - 14) / 2, upperY, dz], dUpperWidth, 10, {
    height: 2.7,
    material: 'cream',
    doors: {
      east: [[-3, 3]],
      west: [[-3, 0]],
      north: [[dUpperWidth / 2 - 4, dUpperWidth / 2]],
      south: [[-13 - (bankEndX - 14) / 2, -9 - (bankEndX - 14) / 2]],
    },
  });
  b.floor(
    dLower,
    [(bankEndX - 28) / 2, lowerY, dz],
    dLowerWidth,
    10,
    'landing',
    'granville-lower-level',
  );
  b.room(dLower, [(bankEndX - 28) / 2, lowerY, dz], dLowerWidth, 10, {
    height: 2.7,
    material: 'cream',
    roof: false,
    doors: {
      north: [[dLowerWidth / 2 - 4, dLowerWidth / 2]],
      south: [[-13 - (bankEndX - 28) / 2, -9 - (bankEndX - 28) / 2]],
    },
  });
  b.box(
    `${dLower}-ceiling`,
    [(bankEndX - 13) / 2, lowerY + 2.7, dz],
    [bankEndX + 13, 0.18, 10.2],
    'cream',
    'ceiling',
  );
  bank(
    b,
    'granville-dunsmuir-main-triple',
    dHall,
    dUpper,
    [dx - 7, 0, dz],
    [bankEndX, upperY, dz],
    3,
    { vaulted: false, shaftHeight: 5.2 },
  );
  for (let i = 0; i < 6; i++) {
    const z = dz - 4 + i * 1.6;
    b.box(
      `${dUpper}-faregate-${i}`,
      [bankEndX - 3, upperY + 0.48, z],
      [1.25, 0.96, 0.24],
      'steel',
      'faregate',
      0,
      true,
    );
    b.box(
      `${dUpper}-compass-reader-${i}`,
      [bankEndX - 2.62, upperY + 0.98, z],
      [0.3, 0.06, 0.23],
      'expo',
      'detail',
    );
  }
  for (let i = 0; i < 2; i++) {
    b.box(
      `${dUpper}-ticket-machine-${i}`,
      [bankEndX - 7 - i * 1.3, upperY + 1, dz + 4.3],
      [0.95, 2, 0.55],
      'steel',
      'ticket-machine',
      0,
      true,
    );
    b.box(
      `${dUpper}-ticket-screen-${i}`,
      [bankEndX - 7 - i * 1.3, upperY + 1.32, dz + 3.98],
      [0.56, 0.55, 0.035],
      'expo',
      'detail',
    );
  }
  b.sign(
    'Exit to Dunsmuir Street  ↑   Elevator  ↖',
    [bankEndX - 4, upperY + 2.35, dz],
    Math.PI / 2,
    6,
    0.42,
  );
  b.flight(
    'granville-dunsmuir-interplatform-stairs',
    dUpper,
    dLower,
    [-14, upperY, dz - 1.5],
    [-26, lowerY, dz - 1.5],
    2.4,
    { material: 'cream' },
  );
  for (const [levelY, target, levelId] of [
    [upperY, hubs.upper, 'granville-upper-level'],
    [lowerY, hubs.lower, 'granville-lower-level'],
  ]) {
    const passage = `granville-dunsmuir-platform-passage-${levelY}`,
      length = -47 - (dz + 5);
    b.floor(
      passage,
      [-11, levelY, (dz + 5 - 47) / 2],
      4,
      length,
      'walk',
      levelId,
    );
    b.room(passage, [-11, levelY, (dz + 5 - 47) / 2], 4, length, {
      height: 2.7,
      doors: { north: [[-2, 2]], south: [[-2, 2]] },
    });
    b.walk(
      `${passage}-dunsmuir`,
      levelY === upperY ? dUpper : dLower,
      passage,
      [-11, levelY, dz + 5],
    );
    b.walk(`${passage}-platform-hub`, passage, target, [-11, levelY, -47]);
  }
  const liftZ = dz - 6.2,
    liftUpper = 'granville-dunsmuir-lift-upper-hall',
    liftLower = 'granville-dunsmuir-lift-lower-hall';
  for (const [floor, levelY, target] of [
    [liftUpper, upperY, dUpper],
    [liftLower, lowerY, dLower],
  ]) {
    b.floor(
      floor,
      [(bankEndX + dx + 2) / 2, levelY, liftZ],
      dx + 2 - bankEndX,
      4,
      'walk',
      target,
    );
    b.room(
      floor,
      [(bankEndX + dx + 2) / 2, levelY, liftZ],
      dx + 2 - bankEndX,
      4,
      {
        height: 2.7,
        doors: {
          west: [[-2, 2]],
          south: [[-(dx + 2 - bankEndX) / 2, -(dx + 2 - bankEndX) / 2 + 4]],
        },
      },
    );
    // A four metre corner landing joins the north side of the lower bank hub.
    const turn = `${floor}-turn`;
    b.floor(turn, [bankEndX - 2, levelY, liftZ + 1.2], 4, 4, 'landing', target);
    b.room(turn, [bankEndX - 2, levelY, liftZ + 1.2], 4, 4, {
      height: 2.7,
      doors: { east: [[-2, 2]], south: [[-2, 2]] },
    });
    b.walk(`${floor}-turn`, floor, turn, [bankEndX, levelY, liftZ]);
    b.walk(`${turn}-bank-hub`, turn, target, [bankEndX - 2, levelY, dz - 5]);
  }
  b.elevator(
    'granville-dunsmuir-lift-upper',
    dHall,
    liftUpper,
    [dx, 0, liftZ],
    [dx, upperY, liftZ],
  );
  b.elevator(
    'granville-dunsmuir-lift-lower',
    liftUpper,
    liftLower,
    [dx, upperY, liftZ],
    [dx, lowerY, liftZ],
  );
  b.sign(
    'Platform 1  ·  Waterfront  →',
    [-9, upperY + 2.1, dz + 3.8],
    0,
    4.6,
    0.4,
  );
  b.sign(
    '←  Platform 2  ·  King George / Production Way–University',
    [-9, upperY + 2.1, dz - 3.8],
    0,
    6.5,
    0.4,
  );

  // Unpaid Hudson Mall connection links the two entrance groups; no same-paid-
  // platform Canada Line transfer is implied. Turns/extents are representative.
  const cross = 'granville-unpaid-mall-crosspassage',
    link = 'granville-unpaid-hudson-passage',
    mallWidth = dx;
  b.floor(cross, [(2 + dx + 2) / 2, 0, -102], mallWidth, 4, 'walk', mall);
  b.room(cross, [(2 + dx + 2) / 2, 0, -102], mallWidth, 4, {
    height: 3,
    doors: { west: [[-2, 2]], south: [[mallWidth / 2 - 4, mallWidth / 2]] },
  });
  b.walk('granville-mall-crosspassage-door', mall, cross, [2, 0, -102]);
  const mallLength = dz - 9 + 102;
  b.floor(link, [dx, 0, (-102 + dz - 9) / 2], 4, mallLength, 'walk', mall);
  b.room(link, [dx, 0, (-102 + dz - 9) / 2], 4, mallLength, {
    height: 3,
    doors: {
      north: [[-2, 2]],
      south: [[-2, 2]],
      west: [[-mallLength / 2, -mallLength / 2 + 2]],
    },
  });
  b.walk('granville-unpaid-crosspassage-turn', cross, link, [dx, 0, -102]);
  b.walk('granville-unpaid-dunsmuir-hall', link, dHall, [dx, 0, dz - 9]);
  b.sign('Dunsmuir Street  ·  Elevator  →', [20, 2.3, -102], 0, 4.4, 0.36);
  b.sign(
    'Granville Street / Seymour Street  ←',
    [dx, 2.3, dz - 9],
    0,
    4.6,
    0.36,
  );
  for (const [id, direction] of [
    ['granville-mall-entry', [0, 0, 1]],
    ['granville-seymour-entry', [-1, 0, 0]],
    ['granville-dunsmuir-entry', [0, 0, -1]],
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
  b.s.authoredInterior.routeSummary =
    'Original Granville/Seymour ticket hall → enclosed Big 3 → upper platform and short connector to lower platform; independent unpaid Dunsmuir/Hudson hall → tiled triple bank → lower faregate hall beside the elevator; unpaid mall connection.';
  b.s.authoredInterior.unverifiedDetails = [
    'All subterranean bends, positions, widths, floor offsets and unpaid corridor extents are representative; Dunsmuir lower-platform stair routing remains unmeasured.',
  ];
  return finishWithStairwells(b);
}

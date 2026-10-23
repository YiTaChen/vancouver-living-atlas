import { interior } from './builder.mjs';
import { resizeIsland, carveFloorRect } from './geometry-utils.mjs';
import * as THREE from 'three';

const references = [
  {
    url: 'https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/waterfront_station_elevator_map.pdf',
    note: 'Heritage hall serves both lines; Granville entrance serves Canada Line; Howe access serves Expo only.',
  },
  {
    url: 'https://buzzer.translink.ca/2009/07/the-buzzer-rides-the-canada-line/',
    note: 'Operator photographs: southwest heritage-hall entrance, escalator to separate ticketing concourse, platform descent at far side.',
  },
  {
    url: 'https://buzzer.translink.ca/2008/12/canada-line-photos-waterfront-station/',
    note: 'Operator construction photographs distinguish concourse, platform and under-Cordova passage.',
  },
  {
    url: 'https://www.flickr.com/photos/viriyincy/4000151862',
    note: 'Photograph of installed station diagram; separate perpendicular island platforms and heritage-hall interchange.',
  },
  {
    url: 'https://commons.wikimedia.org/wiki/File:Expo_Line_platform_of_Waterfront_station.jpg',
    note: 'Actual Expo island: large cream columns, low metallic soffit, long fluorescent strips and red rails.',
  },
  {
    url: 'https://commons.wikimedia.org/wiki/File:Waterfront_Station_Canada_Line_Platform_2025.JPG',
    note: 'Actual Canada island: dark track walls, pale modular ceiling, rectangular floor tiles and central escalator well.',
  },
];

function ceilingOpening(b, id, cut) {
  const p = b.s.geometryParts.find((p) => p.id === id);
  if (!p) return;
  const x0 = p.centerM[0] - p.sizeM[0] / 2,
    x1 = p.centerM[0] + p.sizeM[0] / 2,
    z0 = p.centerM[2] - p.sizeM[2] / 2,
    z1 = p.centerM[2] + p.sizeM[2] / 2,
    a = Math.max(x0, cut.minX),
    c = Math.min(x1, cut.maxX),
    d = Math.max(z0, cut.minZ),
    e = Math.min(z1, cut.maxZ);
  if (c <= a || e <= d) return;
  b.s.geometryParts = b.s.geometryParts.filter((q) => q !== p);
  [
    [x0, a, z0, z1],
    [c, x1, z0, z1],
    [a, c, z0, d],
    [a, c, e, z1],
  ].forEach(([xx, xxx, zz, zzz], i) => {
    if (xxx > xx && zzz > zz)
      b.box(
        `${id}-opening-${i}`,
        [(xx + xxx) / 2, p.centerM[1], (zz + zzz) / 2],
        [xxx - xx, p.sizeM[1], zzz - zz],
        p.material,
        p.role,
      );
  });
}

export function rebuildWaterfront(source) {
  source = structuredClone(source);
  resizeIsland(source, 'waterfront-expo', 8.6);
  resizeIsland(source, 'waterfront-canada', 8.6);
  const b = interior(source, 'waterfront-2026-10-23-v1', references);
  b.s.layoutKind =
    'heritage-hall-two-independent-islands-under-cordova-transfer';
  b.s.authoredInterior.primaryEntrance = 'cordova-lobby';
  b.s.authoredInterior.streetEntranceMap = {
    'cordova-lobby': 'cordova-lobby',
    'granville-canada': 'granville-canada',
  };
  b.tracks();
  b.platform('waterfront-expo', { columns: false });
  b.platform('waterfront-canada', { columns: false });

  // The public heritage hall is the transfer, not a fictional platform bridge.
  b.floor(
    'waterfront-heritage-hall',
    [0, 0, -61],
    64,
    18,
    'concourse',
    'heritage-hall',
    'floor',
  );
  b.room('waterfront-heritage-hall', [0, 0, -61], 64, 18, {
    height: 8.5,
    material: 'cream',
    doors: {
      north: [[-4, 4]],
      south: [
        [-29, -19],
        [-6, 3],
      ],
    },
  });
  b.entrance(
    'cordova-lobby',
    'Cordova Street · heritage station hall',
    'waterfront-heritage-hall',
    [0, 0, -68],
  );
  b.s.entrances.at(-1).inwardDirectionM = [0, 0, 1];
  for (const x of [-26, -13, 13, 26])
    for (const z of [-67, -55]) {
      b.box(
        `heritage-column-${x}-${z}`,
        [x, 3.8, z],
        [0.85, 7.6, 0.85],
        'cream',
        'column',
        0,
        true,
      );
      b.box(
        `heritage-capital-${x}-${z}`,
        [x, 7.5, z],
        [1.35, 0.38, 1.35],
        'cream',
        'detail',
      );
    }
  for (const x of [-20, -8, 8, 20])
    b.box(
      `heritage-light-${x}`,
      [x, 7.7, -61],
      [4, 0.08, 0.4],
      'light',
      'ceiling',
    );
  b.sign('Waterfront', [0, 3.6, -65], 0, 6, 0.8, '#243e51');
  b.sign('Expo Line  ←     Canada Line  →', [0, 2.7, -54], 0, 7, 0.5);
  b.sign('Cordova Street  ↑  Exit', [0, 2.7, -69], Math.PI, 5, 0.45);

  // Expo paid mezzanine and a broad short descent to its single island.
  b.floor('waterfront-expo-fare-hall', [-24, -2.5, -45.5], 9, 5, 'concourse');
  b.room('waterfront-expo-fare-hall', [-24, -2.5, -45.5], 9, 5, {
    material: 'cream',
    doors: { north: [[-4, 4]], south: [[-3, 3]] },
  });
  b.fareGates(
    'waterfront-expo-fares',
    [-24, -2.5, -46.1],
    [-3.25, -1.6, 0, 1.6, 3.25],
  );
  b.flight(
    'waterfront-expo-hall-stairs',
    'waterfront-heritage-hall',
    'waterfront-expo-fare-hall',
    [-26, 0, -52],
    [-26, -2.5, -48],
    2.1,
    { enclosed: false },
  );
  b.flight(
    'waterfront-expo-hall-escalator',
    'waterfront-heritage-hall',
    'waterfront-expo-fare-hall',
    [-22.6, 0, -52],
    [-22.6, -2.5, -48],
    1.1,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft('waterfront-expo-hall-bank', [-24, 0, -52], [-24, -2.5, -48], 8, {
    material: 'cream',
  });
  b.flight(
    'waterfront-expo-platform-stairs',
    'waterfront-expo-fare-hall',
    'waterfront-expo',
    [-25.3, -2.5, -43],
    [-25.3, -7, -35],
    2.2,
    { enclosed: false },
  );
  b.flight(
    'waterfront-expo-platform-escalator',
    'waterfront-expo-fare-hall',
    'waterfront-expo',
    [-22.6, -2.5, -43],
    [-22.6, -7, -35],
    1.05,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft(
    'waterfront-expo-platform-bank',
    [-24, -2.5, -43],
    [-24, -7, -35],
    5.4,
    { material: 'cream' },
  );
  b.floor(
    'waterfront-expo-lift-lower',
    [-19.8, -7, -55],
    2.8,
    4,
    'lift-landing',
  );
  b.floor('waterfront-expo-lift-aisle', [-19.8, -7, -45], 1.8, 16, 'corridor');
  b.room('waterfront-expo-lift-aisle', [-19.8, -7, -45], 1.8, 16, {
    material: 'cream',
    doors: { north: [[-0.9, 0.9]], south: [[-0.9, 0.9]] },
  });
  b.walk(
    'expo-lift-landing-aisle',
    'waterfront-expo-lift-lower',
    'waterfront-expo-lift-aisle',
    [-19.8, -7, -53],
  );
  b.walk(
    'expo-lift-aisle-platform',
    'waterfront-expo-lift-aisle',
    'waterfront-expo',
    [-19.8, -7, -37],
  );
  b.elevator(
    'waterfront-expo-lift',
    'waterfront-heritage-hall',
    'waterfront-expo-lift-lower',
    [-19.8, 0, -55],
    [-19.8, -7, -55],
  );
  b.sign('Platforms 1 / 2  ↓', [-24, 0.1, -44], 0, 5, 0.45, '#004b7d');

  // Southwest Canada Line entrance opens onto its own concourse under Cordova.
  b.floor('waterfront-canada-transfer-arrival', [-2, -7, -37], 6, 4, 'landing');
  b.flight(
    'waterfront-canada-lobby-stairs',
    'waterfront-heritage-hall',
    'waterfront-canada-transfer-arrival',
    [-3.4, 0, -52],
    [-3.4, -7, -39],
    2.2,
    { enclosed: false },
  );
  b.flight(
    'waterfront-canada-lobby-escalator',
    'waterfront-heritage-hall',
    'waterfront-canada-transfer-arrival',
    [-0.8, 0, -52],
    [-0.8, -7, -39],
    1.1,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft('waterfront-canada-lobby-bank', [-2, 0, -52], [-2, -7, -39], 5.9, {
    material: 'white',
  });
  b.floor('waterfront-under-cordova-passage', [-2, -7, -18], 6, 34, 'corridor');
  b.room('waterfront-under-cordova-passage', [-2, -7, -18], 6, 34, {
    height: 3.4,
    material: 'white',
    doors: { north: [[-3, 3]], south: [[-3, 3]] },
  });
  b.walk(
    'canada-arrival-to-passage',
    'waterfront-canada-transfer-arrival',
    'waterfront-under-cordova-passage',
    [-2, -7, -35],
  );
  b.floor(
    'waterfront-canada-north-concourse',
    [-3, -7, 5],
    14,
    12,
    'concourse',
  );
  b.room('waterfront-canada-north-concourse', [-3, -7, 5], 14, 12, {
    height: 4,
    material: 'white',
    doors: { north: [[-2, 4]], east: [[0.3, 5.8]] },
  });
  b.fareGates(
    'waterfront-canada-north-fares',
    [-3, -7, 1.6],
    [-5.6, -3.7, -1.85, 0, 1.85, 3.7, 5.6],
  );
  b.walk(
    'canada-passage-to-fares',
    'waterfront-under-cordova-passage',
    'waterfront-canada-north-concourse',
    [-2, -7, -1],
  );
  for (const x of [-7, -3, 1])
    b.box(
      'canada-concourse-light-' + x,
      [x, -3.15, 5],
      [0.2, 0.06, 8],
      'light',
      'ceiling',
    );
  for (const x of [-7, 1])
    b.box(
      'canada-concourse-steel-column-' + x,
      [x, -5.05, 3],
      [0.55, 3.9, 0.55],
      'steel',
      'column',
      0,
      true,
    );
  b.sign(
    'Canada Line  ↓   Platforms 3 / 4',
    [-3, -4.5, 6],
    0,
    6,
    0.45,
    '#007d9f',
  );
  b.sign('Expo Line / Cordova Street  ↑', [-2, -4.5, -20], Math.PI, 5, 0.42);
  for (const [suffix, z, width, kind] of [
    ['stairs', 6.5, 2.1, 'stairs'],
    ['up', 8.5, 1.05, 'escalator'],
    ['down', 10, 1.05, 'escalator'],
  ])
    b.flight(
      `waterfront-canada-north-${suffix}`,
      'waterfront-canada-north-concourse',
      'waterfront-canada',
      [4, -7, z],
      [15, -13, z],
      width,
      { kind, enclosed: false },
    );
  b.shaft('waterfront-canada-north-bank', [4, -7, 8], [15, -13, 8], 5.4, {
    material: 'white',
  });
  b.floor('waterfront-canada-lift-lower', [1, -13, 11], 3, 4, 'lift-landing');
  b.floor('waterfront-canada-lift-passage', [6, -13, 12], 8, 1.8, 'corridor');
  b.room('waterfront-canada-lift-passage', [6, -13, 12], 8, 1.8, {
    material: 'white',
    doors: { west: [[-0.9, 0.9]], east: [[-0.9, 0.9]] },
  });
  b.walk(
    'canada-lift-lower-passage',
    'waterfront-canada-lift-lower',
    'waterfront-canada-lift-passage',
    [2, -13, 12],
  );
  b.walk(
    'canada-lift-passage-platform',
    'waterfront-canada-lift-passage',
    'waterfront-canada',
    [10, -13, 12],
  );
  b.elevator(
    'waterfront-canada-north-lift',
    'waterfront-canada-north-concourse',
    'waterfront-canada-lift-lower',
    [1, -7, 10],
    [1, -13, 10],
  );

  // Independent Granville Street entrance at the south end of the same island.
  b.floor('waterfront-granville-pavilion', [74, 0, 8], 8, 10, 'entrance');
  b.room('waterfront-granville-pavilion', [74, 0, 8], 8, 10, {
    height: 3.7,
    material: 'glass',
    doors: { east: [[-2, 2]], west: [[-3, 3]] },
  });
  b.entrance(
    'granville-canada',
    'Granville / Hastings · Canada Line',
    'waterfront-granville-pavilion',
    [77, 0, 8],
  );
  b.s.entrances.at(-1).inwardDirectionM = [-1, 0, 0];
  b.floor('waterfront-canada-south-concourse', [55, -7, 8], 6, 10, 'concourse');
  b.room('waterfront-canada-south-concourse', [55, -7, 8], 6, 10, {
    height: 3.6,
    material: 'white',
    doors: { east: [[-3, 3]], west: [[-3, 3]] },
  });
  b.fareGates(
    'waterfront-canada-south-fares',
    [55, -7, 8],
    [-3.65, -1.8, 0, 1.8, 3.65],
    90,
  );
  for (const [suffix, z, width, kind] of [
    ['stairs', 6.6, 2.1, 'stairs'],
    ['up', 9, 1.1, 'escalator'],
  ]) {
    b.flight(
      `waterfront-granville-${suffix}`,
      'waterfront-granville-pavilion',
      'waterfront-canada-south-concourse',
      [70, 0, z],
      [58, -7, z],
      width,
      { kind, enclosed: false },
    );
    b.flight(
      `waterfront-canada-south-${suffix}`,
      'waterfront-canada-south-concourse',
      'waterfront-canada',
      [52, -7, z],
      [41, -13, z],
      width,
      { kind, enclosed: false },
    );
  }
  b.shaft('waterfront-granville-bank', [70, 0, 8], [58, -7, 8], 5.8, {
    material: 'white',
  });
  b.shaft('waterfront-canada-south-bank', [52, -7, 8], [41, -13, 8], 5.4, {
    material: 'white',
  });
  b.sign(
    'Waterfront · Canada Line',
    [74, 2.5, 8],
    Math.PI / 2,
    5,
    0.5,
    '#007d9f',
  );

  // Observed platform architecture. These structural panels stay present in
  // first person; the renderer clips upper fragments for the overhead avatar.
  for (const x of [-32.2, -15.8])
    b.box(
      'expo-track-wall-' + x,
      [x, -5.3, 0],
      [0.22, 3.4, 78],
      'acoustic',
      'wall',
    );
  for (let z = -27; z <= 30; z += 12) {
    b.box(
      'waterfront-expo-column-' + z,
      [-24, -5.35, z],
      [0.8, 3.3, 0.95],
      'cream',
      'column',
      0,
      true,
    );
    b.sign('Waterfront', [-23.57, -4.8, z], Math.PI / 2, 2, 0.32, '#ece9dc');
  }
  for (const x of [-26.5, -21.5])
    b.box(
      'expo-long-light-' + x,
      [x, -3.65, 0],
      [0.17, 0.06, 72],
      'light',
      'ceiling',
    );
  for (const z of [-20, 16])
    b.bench('waterfront-expo-' + z, [-24, -7, z], 2.4, 90);
  for (const z of [-0.4, 16.4]) {
    b.box(
      'canada-dark-track-wall-' + z,
      [32, -10.8, z],
      [48, 4.4, 0.22],
      'acoustic',
      'wall',
    );
    b.box(
      'canada-wall-light-' + z,
      [32, -9.8, z],
      [44, 0.06, 0.12],
      'light',
      'ceiling',
    );
  }
  for (let x = 12; x <= 52; x += 1.5)
    b.box(
      'canada-floor-joint-' + x,
      [x, -12.994, 8],
      [0.014, 0.008, 6],
      'tile',
      'detail',
    );
  for (const z of [6.5, 8, 9.5])
    b.box(
      'canada-floor-long-joint-' + z,
      [32, -12.994, z],
      [44, 0.008, 0.014],
      'tile',
      'detail',
    );
  for (let x = 19; x < 40; x += 9) {
    b.box(
      'waterfront-canada-column-' + x,
      [x, -11.3, 8],
      [0.5, 3.4, 0.5],
      'white',
      'column',
      0,
      true,
    );
    b.box(
      'waterfront-canada-column-band-' + x,
      [x, -10.7, 8],
      [0.51, 0.22, 0.51],
      'canada',
      'detail',
    );
    b.sign('Waterfront', [x, -10.3, 8], Math.PI / 2, 2.6, 0.4, '#007d9f');
  }
  b.bench('waterfront-canada', [32, -13, 8], 2.4, 0, { material: 'steel' });
  for (let x = 13; x < 54; x += 4)
    b.box(
      'canada-ceiling-grid-' + x,
      [x, -9.48, 8],
      [0.035, 0.03, 12],
      'steel',
      'ceiling',
    );
  for (const z of [3, 5, 7, 9, 11, 13])
    b.box(
      'canada-ceiling-long-grid-' + z,
      [32, -9.48, z],
      [44, 0.03, 0.035],
      'steel',
      'ceiling',
    );
  for (let x = 16; x < 54; x += 6)
    b.box(
      'canada-hung-light-' + x,
      [x, -9.7, 8],
      [3.8, 0.06, 0.2],
      'light',
      'ceiling',
    );
  for (const p of b.s.geometryParts) {
    if (p.role === 'trackbed') p.material = 'ballast';
    if (p.id.startsWith('floor-waterfront-expo')) p.material = 'warmfloor';
    if (p.id === 'waterfront-expo-ceiling') p.material = 'panel';
  }
  b.box(
    'waterfront-expo-structural-base',
    [-24, -8.55, 0],
    [17, 0.24, 76],
    'ballast',
    'floor',
  );
  b.box(
    'waterfront-canada-structural-base',
    [32, -14.65, 8],
    [46, 0.24, 17],
    'ballast',
    'floor',
  );
  for (let z = -31; z < 37; z += 2) {
    b.box(
      'expo-floor-grout-' + z,
      [-24, -6.993, z],
      [8.6, 0.008, 0.012],
      'tile',
      'detail',
    );
    b.box(
      'expo-ceiling-panel-joint-' + z,
      [-24, -3.505, z],
      [16.6, 0.025, 0.025],
      'steel',
      'ceiling',
    );
  }
  for (const x of [-27, -25, -23, -21])
    b.box(
      'expo-floor-long-grout-' + x,
      [x, -6.993, 0],
      [0.012, 0.008, 74],
      'tile',
      'detail',
    );
  // The framed poster rhythm and service duct are visible in the real track
  // wall photograph. Artwork is original neutral geometry, not copied adverts.
  for (const x of [-32.05, -15.95])
    for (let z = -29; z < 33; z += 3.2) {
      b.box(
        `expo-ad-frame-${x}-${z}`,
        [x, -5.5, z],
        [0.08, 1.85, 1.35],
        'black',
        'detail',
      );
      b.box(
        `expo-ad-art-${x}-${z}`,
        [x + (x < -24 ? 0.05 : -0.05), -5.5, z],
        [0.025, 1.64, 1.14],
        Math.round(z) % 2 ? 'poster' : 'cream',
        'detail',
      );
    }
  for (const z of [-0.25, 16.25])
    for (let x = 13; x < 53; x += 3.3) {
      b.box(
        `canada-ad-frame-${z}-${x}`,
        [x, -11.2, z],
        [1.5, 1.8, 0.08],
        'black',
        'detail',
      );
      b.box(
        `canada-ad-art-${z}-${x}`,
        [x, -11.2, z + (z < 8 ? 0.05 : -0.05)],
        [1.3, 1.6, 0.025],
        Math.round(x) % 2 ? 'poster' : 'cream',
        'detail',
      );
    }
  for (const p of b.s.platforms) {
    const q = new THREE.Quaternion(...p.stopPosition.rotationQuaternionXYZW),
      stop = new THREE.Vector3(...p.stopPosition.translationM),
      at = (x, y, z) =>
        new THREE.Vector3(x, y - stop.y, z)
          .applyQuaternion(q)
          .add(stop)
          .toArray();
    for (const end of [-1, 1]) {
      const z = end * (p.lengthM / 2 + 24);
      for (const side of [-1, 1])
        b.box(
          `${p.platformId}-portal-wall-${end}-${side}`,
          at(side * 1.95, p.floorHeightM + 1.45, z),
          [0.2, 3.8, 48],
          'acoustic',
          'wall',
          0,
          false,
          q.toArray(),
        );
      b.box(
        `${p.platformId}-portal-roof-${end}`,
        at(0, p.floorHeightM + 3.4, z),
        [4.1, 0.2, 48],
        'acoustic',
        'ceiling',
        0,
        false,
        q.toArray(),
      );
      b.box(
        `${p.platformId}-portal-base-${end}`,
        at(0, p.railHeightM - 0.35, z),
        [4.1, 0.2, 48],
        'ballast',
        'floor',
        0,
        false,
        q.toArray(),
      );
    }
  }
  b.sign('Platform 1 / 2  ·  Expo Line', [-24, -4.4, 4], 0, 5, 0.45, '#004b7d');
  b.sign(
    'Platform 3 / 4  ·  Canada Line',
    [32, -10.4, 8],
    Math.PI / 2,
    5,
    0.45,
    '#007d9f',
  );
  b.s.transferRoutes = [
    {
      id: 'expo-to-canada-via-heritage-hall',
      fromStationLineId: 'waterfront:expo',
      toStationLineId: 'waterfront:canada',
      viaSurfaceIds: [
        'waterfront-expo',
        'waterfront-expo-fare-hall',
        'waterfront-heritage-hall',
        'waterfront-canada-transfer-arrival',
        'waterfront-under-cordova-passage',
        'waterfront-canada-north-concourse',
        'waterfront-canada',
      ],
      connectionGraphAuthoritative: true,
      status:
        'Public hall transfer with separate paid concourses; representative dimensions',
    },
  ];
  // Real stairwell holes remove the phantom flat floor underneath the lower
  // steps. Both rendered slabs and passenger triangles have the same openings.
  carveFloorRect(b.s, 'waterfront-expo', {
    minX: -26.9,
    maxX: -21.1,
    minZ: -43,
    maxZ: -35,
  });
  carveFloorRect(b.s, 'waterfront-canada', {
    minX: 4,
    maxX: 15,
    minZ: 5.1,
    maxZ: 10.9,
  });
  carveFloorRect(b.s, 'waterfront-canada', {
    minX: 41,
    maxX: 52,
    minZ: 5.1,
    maxZ: 10.9,
  });
  ceilingOpening(b, 'waterfront-canada-ceiling', {
    minX: 3.7,
    maxX: 16,
    minZ: 5,
    maxZ: 11.1,
  });
  for (const p of [...b.s.geometryParts].filter((p) =>
    p.id.startsWith('waterfront-canada-ceiling-opening-'),
  ))
    ceilingOpening(b, p.id, { minX: 40, maxX: 52.4, minZ: 5, maxZ: 11.1 });
  // Suspended ceiling grid/lights must share the same holes as the panel slab.
  b.s.geometryParts = b.s.geometryParts.filter(
    (p) =>
      !(
        p.role === 'ceiling' &&
        p.id.startsWith('canada-') &&
        p.centerM[0] < 16
      ),
  );
  return b.finish();
}

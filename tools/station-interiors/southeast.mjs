import { interior } from './builder.mjs';
import { carveFloorRect } from './geometry-utils.mjs';

const REF = {
  stadiumStairs:
    'https://www.translink.ca/plans-and-projects/projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement',
  stadiumThird:
    'https://buzzer.translink.ca/2017/08/this-is-why-theres-an-unused-third-platform-at-stadium-chinatown-skytrain-station/',
  stadiumMap:
    'https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf',
  stadiumAbove:
    'https://commons.wikimedia.org/wiki/File:Stadium_Chinatown_from_above.jpg',
  stadiumExistingPlan:
    'https://www.ianbryane.com/samples/stadium-chinatown-station',
  yaletownBuild:
    'https://buzzer.translink.ca/2008/12/canada-line-photos-yaletown-station-construction/',
  yaletownPhotos:
    'https://canadalinephotos.blogspot.com/search/label/Yaletown%20-%20Roundhouse',
  yaletownGates:
    'https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility',
  yaletownEscalators:
    'https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/',
  yaletownStairAudit:
    'https://cityhallwatch.wordpress.com/2024/12/03/walking-audit-all-canada-line-stations-davidowicz/',
  yaletownPermit:
    'https://vancouver.ca/files/cov/development-permit-board-jul-17-06.pdf',
};

/** Closed stair support: the player cannot walk through a floating flight. */
function supportedFlight(b, id, from, to, start, end, width, options = {}) {
  b.flight(id, from, to, start, end, width, {
    ...options,
    ...(options.kind === 'escalator' ? {} : { nosingMaterial: 'yellow' }),
  });
  const c = b.s.connections.at(-1),
    y0 = Math.min(start[1], end[1]) - 0.22;
  const yaw =
    (Math.atan2(end[0] - start[0], end[2] - start[2]) * 180) / Math.PI;
  for (const [i, tread] of c.treadSurfaces.entries()) {
    const p = tread.verticesM.reduce(
      (a, v) => a.map((x, k) => x + v[k] / 4),
      [0, 0, 0],
    );
    // Collision hull sits below the riser envelope so the pedestrian capsule
    // can climb a step without its radius hitting the following riser block.
    const h = Math.max(0.12, p[1] - y0 - 0.52);
    b.box(
      `${id}-solid-support-${i}`,
      [p[0], y0 + h / 2, p[2]],
      [width, h, c.treadRunM + 0.003],
      'concrete',
      'stair-support',
      yaw,
      true,
    );
    const visibleHeight = Math.max(0.12, p[1] - y0 - 0.16);
    b.box(
      `${id}-closed-riser-fill-${i}`,
      [p[0], y0 + visibleHeight / 2, p[2]],
      [width, visibleHeight, c.treadRunM + 0.003],
      'concrete',
      'stair-support',
      yaw,
    );
  }
}

function keepPlatform(b, id) {
  b.platform(id, { columns: false, roof: false });
  b.tracks();
}

function gateRow(b, prefix, z, y, centres, accessible = []) {
  for (const [i, x] of centres.entries()) {
    const width = accessible.includes(i) ? 1.1 : 0.76;
    for (const side of [-1, 1]) {
      b.box(
        `${prefix}-${i}-pedestal-${side}`,
        [x + side * (width / 2 + 0.13), y + 0.49, z],
        [0.22, 0.98, 0.84],
        'steel',
        'fare-gate',
        0,
        true,
      );
      b.box(
        `${prefix}-${i}-reader-${side}`,
        [x + side * (width / 2 + 0.13), y + 1.02, z - 0.24],
        [0.19, 0.09, 0.25],
        'black',
        'detail',
      );
      // Open glass leaves remain visible at the sides of a traversable gate.
      b.box(
        `${prefix}-${i}-glass-${side}`,
        [x + side * (width / 2 - 0.03), y + 0.58, z + 0.17],
        [0.025, 0.72, 0.44],
        'glass',
        'fare-gate-leaf',
      );
    }
    if (accessible.includes(i))
      b.sign('Accessible  ♿', [x, y + 1.36, z + 0.1], 0, 1.04, 0.2);
  }
}

function stripedColumn(b, id, x, y, z, height = 3.4) {
  b.box(
    id,
    [x, y + height / 2, z],
    [0.42, height, 0.42],
    'cream',
    'column',
    0,
    true,
  );
  for (let band = 0.55, i = 0; band < height - 0.15; band += 0.54, i++) {
    b.box(
      `${id}-blue-band-${i}`,
      [x, y + band, z],
      [0.43, 0.28, 0.43],
      'line',
      'detail',
    );
  }
}

function redRail(b, id, a, end) {
  b.beam(id, a, end, 0.055, 0.065, 'red', 'handrail');
}

function alignPlatformAssembly(source, surfaceId, centre) {
  const s = structuredClone(source),
    f = s.floorSurfaces.find((f) => f.surfaceId === surfaceId);
  const xs = f.verticesM.map((v) => v[0]),
    zs = f.verticesM.map((v) => v[2]);
  const shift = [
    centre[0] - (Math.min(...xs) + Math.max(...xs)) / 2,
    centre[1] - f.verticesM[0][1],
    centre[2] - (Math.min(...zs) + Math.max(...zs)) / 2,
  ];
  const point = (p) => p.map((v, i) => v + shift[i]);
  for (const floor of s.floorSurfaces)
    floor.verticesM = floor.verticesM.map(point);
  for (const part of s.geometryParts) part.centerM = point(part.centerM);
  for (const anchor of s.anchors) anchor.pointM = point(anchor.pointM);
  for (const level of s.levels) level.floorHeightM += shift[1];
  for (const p of s.platforms) {
    p.stopPosition.translationM = point(p.stopPosition.translationM);
    p.floorHeightM += shift[1];
    p.railHeightM += shift[1];
    for (const d of p.doorAlignmentPoints)
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ])
        d[key] = point(d[key]);
    for (const region of p.waitingRegions ?? [])
      region.polygonM = region.polygonM.map(point);
  }
  for (const v of s.trackExclusionVolumes) {
    v.footprintM = v.footprintM.map(point);
    v.minY += shift[1];
    v.maxY += shift[1];
  }
  for (const bridge of s.thresholdBridges ?? []) {
    for (const key of ['storedTransform', 'deployedTransform'])
      bridge[key].translationM = point(bridge[key].translationM);
    bridge.deployedFloor.verticesM = bridge.deployedFloor.verticesM.map(point);
    for (const phase of bridge.sequence ?? [])
      phase.translationM = point(phase.translationM);
  }
  return s;
}

/** Mapped northwest mouths, transition and viaduct join the retained station
 * beds. Section dimensions are inferred; maintained train/rail centres stay
 * aligned instead of pretending the approximate OSM lateral offsets are exact. */
function stadiumNorthwestGuideways(b) {
  const prefix = 'stadium-northwest-guideway-';
  b.s.geometryParts = b.s.geometryParts.filter(
    (p) =>
      !p.id.startsWith(prefix) &&
      !b.s.platforms.some((s) =>
        p.id.startsWith(`${s.platformId}-approach-trackbed-`),
      ),
  );
  for (const p of b.s.platforms) {
    const x = p.stopPosition.translationM[0],
      railY = p.railHeightM,
      outside = x < 2.77 ? -1 : 1,
      id = `${prefix}${p.direction}`;
    for (const [section, fromZ, toZ] of [
      ['tunnel', 14, 25],
      ['portal-transition', 25, 39],
      ['viaduct', 39, 53.25],
    ]) {
      const z = (fromZ + toZ) / 2,
        length = toZ - fromZ;
      b.box(
        `${p.platformId}-approach-trackbed-${section}`,
        [x, railY - 0.27, z],
        [2.9, 0.4, length + 0.02],
        'concrete',
        'trackbed',
      );
      for (const side of [-1, 1])
        b.box(
          `${id}-${section}-rail-${side}`,
          [x + side * 0.7175, railY - 0.035, z],
          [0.07, 0.07, length + 0.02],
          'steel',
          'rail',
        );
      if (section !== 'tunnel') {
        b.box(
          `${id}-${section}-maintenance-walk`,
          [x + outside * 1.87, railY - 0.12, z],
          [0.85, 0.24, length],
          'concrete',
          'maintenance-walk',
        );
        b.box(
          `${id}-${section}-outer-parapet`,
          [x + outside * 2.35, railY + 0.3, z],
          [0.18, 0.84, length],
          'concrete',
          'parapet',
        );
        b.box(
          `${id}-${section}-outer-handrail`,
          [x + outside * 2.35, railY + 1.02, z],
          [0.055, 0.065, length],
          'steel',
          'handrail',
        );
        for (let zz = fromZ + 0.2, i = 0; zz < toZ; zz += 2.5, i++)
          b.box(
            `${id}-${section}-outer-post-${i}`,
            [x + outside * 2.35, railY + 0.76, zz],
            [0.055, 0.52, 0.055],
            'steel',
            'handrail',
          );
      }
    }
    // Short real-mouth lining, with an open portal face. Do not roof the
    // photographed open-air guideway outside the mapped tunnel boundary.
    for (const side of [-1, 1])
      b.box(
        `${id}-tunnel-wall-${side}`,
        [x + side * 2.1, railY + 1.98, 19.5],
        [0.22, 4.5, 11.2],
        'concrete',
        'wall',
        0,
        true,
      );
    b.box(
      `${id}-tunnel-roof`,
      [x, railY + 4.2, 19.5],
      [4.42, 0.3, 11.2],
      'concrete',
      'ceiling',
    );
    for (const side of [-1, 1])
      b.box(
        `${id}-portal-jamb-${side}`,
        [x + side * 2.1, railY + 1.98, 25],
        [0.34, 4.5, 0.5],
        'concrete',
        'wall',
        0,
        true,
      );
  }
  b.s.authoredInterior.northwestGuidewayInference = {
    originalMappedRecords:
      'tools/station-interiors/references/stadium-northwest-guideways-20261023.json',
    reference:
      'docs/qa/station-interiors-20261023/stadium-guideway-evidence.md',
    tunnelMouthZM: 25,
    viaductStartZM: 39,
    retainedBedStartZM: 53.2,
    authoredRangeZM: [14, 53.25],
    sectionStatus:
      'Longitudinal boundaries follow mapped railway tags; concrete thickness, maintenance walk and lining dimensions are representative, not surveyed.',
    lateralStatus:
      'Maintained train/rail centres are preserved. Approximate OSM tunnel-mouth centres differ by 0.69m westbound / 0.84m eastbound; rendered rails must not drift away from the train.',
  };
}

export function rebuildStadium(source) {
  const b = interior(
    alignPlatformAssembly(source, 'stadium-expo', [2.77, -8, 96.2]),
    'stadium-mapped-circulation-v4',
    [
      {
        url: REF.stadiumStairs,
        note: 'Official main stair photo: enclosed concrete hall, red rails, yellow nosings, adjacent escalator and wood ceiling.',
      },
      {
        url: REF.stadiumThird,
        note: 'One public island and a fenced spare side platform/third track, without public graph links.',
      },
      {
        url: REF.stadiumMap,
        note: 'Beatty upper, Keefer concourse and Expo Boulevard lower entrances.',
      },
      {
        url: REF.stadiumAbove,
        note: 'Daylight island, white steel trusses and pale curved canopies.',
      },
      {
        url: REF.stadiumExistingPlan,
        note: "Existing Platform Configuration credited to TransLink, separate from the portfolio's proposed expansion drawings.",
      },
      {
        url: 'https://www.openstreetmap.org/way/569211454',
        note: 'Mapped Beatty stair horizontal endpoints; about 13 m run.',
      },
      {
        url: 'https://www.openstreetmap.org/way/569211456',
        note: 'Mapped concourse-to-platform stair endpoints; about 8 m run.',
      },
      {
        url: 'https://www.openstreetmap.org/way/87222779',
        note: 'Mapped restricted platform polygon determines west side and longitudinal centre near Z=96 m.',
      },
      {
        url: 'https://www.openstreetmap.org/way/379898651',
        note: 'Northeast tunnel ends at mapped Z24.9; transition and viaduct continue into the station. Section dimensions are inferred.',
      },
      {
        url: 'https://www.openstreetmap.org/way/551763179',
        note: 'Southwest tunnel ends at mapped Z25.1; retained rail centres preserve the actual train alignment.',
      },
      {
        url: 'https://www.openstreetmap.org/node/5476795075',
        note: 'Mapped main lift is at source X3.989/Z20.600, beside the entrance bank. The earlier unmeasured X7.1 put its lower bypass too close to a running track.',
      },
      {
        url: 'https://commons.wikimedia.org/wiki/File:TransLink_SkyTrain_approaches_Stadium-Chinatown_station_in_Vancouver,_British_Columbia,_Canada.png',
        note: 'Tim Adams, 2013, CC BY 3.0; viewed original photograph. Concrete rail decks, service walks and parapets continue beyond the station in the open air.',
      },
    ],
  );
  b.s.layoutKind = 'mapped-daylit-island-plus-restricted-west-side-platform';
  keepPlatform(b, 'stadium-expo');
  stadiumNorthwestGuideways(b);
  // Rebuilds also receive our previous authored source. Recreate the spare
  // track once instead of copying it as retained regular-service track work.
  b.s.geometryParts = b.s.geometryParts.filter(
    (p) => !p.id.startsWith('stadium-spare-'),
  );
  const street = b.floor(
    'stadium-beatty-street',
    [2.6, 0, 3.95],
    12,
    7.9,
    'entrance',
    'stadium-street',
  );
  const concourse = b.floor(
    'stadium-main-concourse',
    [2, -4.5, 26.685],
    13,
    12.37,
    'concourse',
    'stadium-concourse',
  );
  const approach = b.floor(
    'stadium-west-platform-approach',
    [2.77, -8, 49.915],
    6.2,
    18.57,
    'corridor',
    'stadium-expo-level',
  );
  b.walk(
    'stadium-island-west-approach',
    approach,
    'stadium-expo',
    [2.77, -8, 59.2],
  );
  supportedFlight(
    b,
    'stadium-beatty-main-stair',
    street,
    concourse,
    [0.5, 0, 7.7],
    [1.41, -4.5, 20.74],
    4.4,
    // The photographed centre handrail divides this wide physical flight.
    // Use its east walking lane for navigation, retaining the mapped axis
    // and every physical tread/rail at their original coordinates.
    { enclosed: false, walkLaneOffsetM: 0.9 },
  );
  supportedFlight(
    b,
    'stadium-beatty-up-escalator',
    concourse,
    street,
    [6.31, -4.5, 20.74],
    [5.4, 0, 7.7],
    1.15,
    { kind: 'escalator', enclosed: false },
  );
  supportedFlight(
    b,
    'stadium-concourse-island-stair',
    concourse,
    approach,
    [2.16, -4.5, 32.87],
    [2.44, -8, 40.83],
    2.6,
    { enclosed: false },
  );
  supportedFlight(
    b,
    'stadium-island-up-escalator',
    approach,
    concourse,
    [5.34, -8, 40.83],
    [5.06, -4.5, 32.87],
    1.05,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft(
    'stadium-island-access-well',
    [3.55, -8, 40.83],
    [3.27, -4.5, 32.87],
    5.1,
    { material: 'concrete', height: 3.6 },
  );
  b.room('stadium-beatty-pavilion', [2.6, 0, 3.85], 12, 7.7, {
    material: 'concrete',
    height: 3.7,
    doors: { north: [[-4.8, 4.8]], south: [[-5.8, 5.8]] },
  });
  // Tall constant-height enclosure keeps the upper lift bypass and stair
  // flights inside the real building rather than exposing a floating slope.
  for (const x of [-3.5, 8.7])
    b.box(
      `stadium-beatty-shaft-wall-${x}`,
      [x, -0.45, 14.22],
      [0.2, 8.1, 13.04],
      'concrete',
      'wall',
      0,
      true,
    );
  b.box(
    'stadium-beatty-shaft-ceiling',
    [2.6, 3.6, 14.22],
    [12.4, 0.18, 13.04],
    'wood',
    'ceiling',
  );
  b.room('stadium-ticket-hall', [2, -4.5, 26.805], 13, 12.13, {
    material: 'concrete',
    height: 8.1,
    doors: { north: [[-5.8, 6.3]], south: [[-3, 5.8]], east: [[1.2, 5.2]] },
  });
  b.room('stadium-west-platform-passage', [2.77, -8, 50.015], 6.2, 18.37, {
    material: 'concrete',
    height: 3.4,
    doors: { north: [[-3, 3]], south: [[-3, 3]] },
  });
  b.entrance('stadium-beatty-entry', 'Beatty Street', street, [0, 0, 0.2]);
  gateRow(
    b,
    'stadium-main-gate',
    27.8,
    -4.5,
    [-2, -0.6, 0.8, 2.2, 3.6, 5.3],
    [0, 5],
  );
  for (let x = -3.2, i = 0; x <= 8.3; x += 0.28, i++)
    b.box(
      `stadium-beatty-timber-slat-${i}`,
      [x, 3.55, 10.35],
      [0.14, 0.12, 20.7],
      'wood',
      'ceiling',
    );
  for (const side of [-1, 1]) {
    b.box(
      `stadium-beatty-high-window-${side}`,
      [side < 0 ? -3.4 : 8.6, 2.3, 9],
      [0.045, 1.5, 16],
      'glass',
      'window',
    );
    redRail(
      b,
      `stadium-beatty-red-wall-rail-${side}`,
      [0.5 + side * 2.12, 0.93, 7.7],
      [1.41 + side * 2.12, -3.57, 20.74],
    );
  }
  redRail(
    b,
    'stadium-beatty-red-centre-rail',
    [0.5, 0.93, 7.7],
    [1.41, -3.57, 20.74],
  );
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    b.box(
      `stadium-beatty-centre-rail-post-${i}`,
      [0.5 + 0.91 * t, 0.48 - 4.5 * t, 7.7 + 13.04 * t],
      [0.055, 0.9, 0.055],
      'red',
      'handrail',
      0,
      true,
    );
  }
  b.sign(
    '↑ Exit  Beatty Street     BC Place',
    [2, -0.7, 20.5],
    Math.PI,
    7.1,
    0.48,
    '#e6e8df',
  );
  b.sign('Expo Line  ↓  Platforms 1 · 2', [3.1, -1.9, 32.65], 0, 5.4, 0.42);
  b.sign('Stadium–Chinatown', [1, 2.8, 0.05], Math.PI, 6.4, 0.5);
  const keefer = b.floor(
    'stadium-keefer-entry',
    [10.17, -4.5, 30.01],
    3.34,
    4,
    'entrance',
    'stadium-concourse',
  );
  b.walk('stadium-keefer-hall-link', keefer, concourse, [8.5, -4.5, 30.01]);
  b.room('stadium-keefer-hall', [10.17, -4.5, 30.01], 3.34, 4, {
    material: 'concrete',
    height: 3.3,
    doors: { west: [[-1.7, 1.7]], east: [[-1.7, 1.7]] },
  });
  b.entrance(
    'stadium-keefer-entry',
    'Keefer Place · Chinatown',
    keefer,
    [11.84, -4.5, 30.01],
  );
  b.sign(
    'Stadium–Chinatown   體育館／華埠（唐人街）',
    [11.88, -1.9, 30.01],
    Math.PI / 2,
    4.8,
    0.36,
  );
  b.sign('Lost Property', [8.35, -2.15, 25.4], Math.PI / 2, 2.5, 0.3);

  // The three-stop lift is beside the main access bank. Its unmeasured cabin
  // width is kept clear of the photographed stair/escalator lanes.
  const liftX = 3.98869237;
  const upperLift = b.floor(
    'stadium-lift-upper',
    [liftX, 0, 20.6],
    2.2,
    3,
    'lift-landing',
    'stadium-street',
  );
  // The level bypass stays east of the inclined escalator's complete body
  // envelope. Its earlier west edge at X=6.1 put the deck/guard through the
  // upper half of that flight. These inferred inner bounds fit inside the
  // retained east shaft wall at X=8.7; the mapped lift itself stays fixed.
  const upperHallX = 7.55,
    upperHallWidth = 1.7;
  const upperLiftHall = b.floor(
    'stadium-lift-upper-hall',
    [upperHallX, 0, 14.15],
    upperHallWidth,
    12.9,
    'corridor',
    'stadium-street',
  );
  b.walk('stadium-lift-street-link', street, upperLiftHall, [
    upperHallX,
    0,
    7.7,
  ]);
  const upperLiftCross = b.floor(
    'stadium-lift-upper-cross-hall',
    [(liftX + upperHallX) / 2, 0, 20.6],
    upperHallX - liftX + 0.1,
    2.2,
    'corridor',
    'stadium-street',
  );
  b.walk('stadium-lift-upper-cross-link', upperLiftHall, upperLiftCross, [
    upperHallX,
    0,
    20.6,
  ]);
  b.walk('stadium-lift-upper-door', upperLiftCross, upperLift, [
    liftX + 1,
    0,
    20.6,
  ]);
  for (const x of [
    upperHallX - upperHallWidth / 2 - 0.05,
    upperHallX + upperHallWidth / 2 + 0.05,
  ])
    b.box(
      `stadium-upper-lift-bypass-guard-${x}`,
      [x, 0.5, 13.55],
      [0.06, 1, 11.7],
      'glass',
      'balustrade',
      0,
      true,
    );
  const midLift = b.floor(
    'stadium-lift-mid',
    [liftX, -4.5, 21.6],
    2.2,
    3,
    'lift-landing',
    'stadium-concourse',
  );
  b.walk('stadium-lift-mid-concourse-link', midLift, concourse, [
    liftX,
    -4.5,
    22.5,
  ]);
  const lowerLift = b.floor(
    'stadium-lift-lower',
    [liftX, -8, 20.6],
    2.2,
    3,
    'lift-landing',
    'stadium-expo-level',
  );
  const lowerHall = b.floor(
    'stadium-lift-lower-hall',
    [0.05, -8, 35],
    1.1,
    17.6,
    'corridor',
    'stadium-expo-level',
  );
  const lowerBranch = b.floor(
    'stadium-lift-lower-branch',
    [2.77, -8, 24.3],
    6.2,
    6.2,
    'corridor',
    'stadium-expo-level',
  );
  b.walk('stadium-lift-lower-door', lowerLift, lowerBranch, [liftX, -8, 22]);
  b.walk(
    'stadium-lift-lower-branch-hall',
    lowerBranch,
    lowerHall,
    [0.05, -8, 26.5],
  );
  b.walk('stadium-lift-lower-island-link', lowerHall, approach, [0.05, -8, 43]);
  b.box(
    'stadium-lower-lift-bypass-west-wall',
    [-0.6, -6.4, 35],
    [0.2, 3.2, 17.6],
    'concrete',
    'wall',
    0,
    true,
  );
  b.box(
    'stadium-lower-lift-bypass-ceiling',
    [0.05, -4.8, 35],
    [1.3, 0.2, 17.6],
    'concrete',
    'ceiling',
  );
  b.elevator(
    'stadium-main-lift-street-concourse',
    upperLift,
    midLift,
    [liftX, 0, 20.6],
    [liftX, -4.5, 20.6],
  );
  b.elevator(
    'stadium-main-lift-concourse-platform',
    midLift,
    lowerLift,
    [liftX, -4.5, 20.6],
    [liftX, -8, 20.6],
  );

  const eastLanding = b.floor(
    'stadium-expo-east-landing',
    [2.77, -8, 132.6],
    7,
    1.2,
    'landing',
    'stadium-expo-level',
  );
  const eastMid = b.floor(
    'stadium-expo-east-mid',
    [2.6, -10.4, 142],
    7,
    3,
    'landing',
    'stadium-east-access',
  );
  const eastStreet = b.floor(
    'stadium-expo-boulevard',
    [2.43, -12.85, 155.745],
    7,
    11.49,
    'entrance',
    'stadium-expo-boulevard',
  );
  b.walk(
    'stadium-island-east-landing',
    'stadium-expo',
    eastLanding,
    [2.77, -8, 133.2],
  );
  supportedFlight(
    b,
    'stadium-expo-east-upper-stair',
    eastLanding,
    eastMid,
    [2.77, -8, 133.2],
    [2.6, -10.4, 140.5],
    4.8,
    { enclosed: true, material: 'concrete' },
  );
  supportedFlight(
    b,
    'stadium-expo-east-lower-stair',
    eastMid,
    eastStreet,
    [2.6, -10.4, 143.5],
    [2.43, -12.85, 150],
    4.8,
    { enclosed: true, material: 'concrete' },
  );
  b.room('stadium-expo-east-mid-enclosure', [2.6, -10.4, 142], 5.2, 3, {
    material: 'concrete',
    doors: { north: [[-2.4, 2.4]], south: [[-2.4, 2.4]] },
  });
  b.room(
    'stadium-expo-boulevard-enclosure',
    [2.43, -12.85, 155.745],
    7,
    11.49,
    {
      material: 'concrete',
      doors: { north: [[-2.4, 2.4]], south: [[-2.8, 2.8]] },
    },
  );
  b.entrance(
    'stadium-expo-boulevard-entry',
    'Expo Boulevard · Rogers Arena',
    eastStreet,
    [2.43, -12.85, 161.49],
  );
  b.sign(
    'Exit ↓  Expo Boulevard · Rogers Arena',
    [2.77, -5.7, 132.5],
    0,
    5.8,
    0.36,
  );

  for (let z = 64, i = 0; z < 132; z += 10.5, i++) {
    for (const side of [-1, 1])
      b.box(
        `stadium-canopy-column-${i}-${side}`,
        [2.77 + side * 1.25, -6.2, z],
        [0.23, 3.6, 0.23],
        'cream',
        'column',
        0,
        true,
      );
    b.beam(
      `stadium-truss-top-${i}`,
      [-12, -3.25, z],
      [10, -3.25, z],
      0.12,
      0.14,
      'cream',
      'truss',
    );
    b.beam(
      `stadium-truss-bottom-${i}`,
      [-12, -4.45, z],
      [10, -4.45, z],
      0.12,
      0.14,
      'cream',
      'truss',
    );
    for (let x = -12, n = 0; x < 10; x += 2, n++)
      b.beam(
        `stadium-truss-diagonal-${i}-${n}`,
        [x, n % 2 ? -3.25 : -4.45, z],
        [Math.min(x + 2, 10), n % 2 ? -4.45 : -3.25, z],
        0.085,
        0.09,
        'cream',
        'truss',
      );
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++)
      b.box(
        `stadium-curved-canopy-${side}-${i}`,
        [
          2.77 + side * (0.5 + i * 0.85),
          -4.36 + Math.sin((i * Math.PI) / 6) * 0.45,
          96.2,
        ],
        [0.9, 0.12, 74],
        'cream',
        'ceiling',
        0,
        false,
        [
          0,
          0,
          Math.sin(side * (i - 1.5) * 0.07),
          Math.cos(side * (i - 1.5) * 0.07),
        ],
      );
    b.box(
      `stadium-platform-light-${side}`,
      [2.77 + side * 2.7, -4.55, 96.2],
      [0.1, 0.055, 74],
      'light',
      'ceiling',
    );
    b.box(
      `stadium-retaining-wall-${side}`,
      [side < 0 ? -12.2 : 10.2, -6.45, 96.2],
      [0.3, 4.5, 82],
      'concrete',
      'wall',
      0,
      true,
    );
  }
  // The actual spare polygon is on the west side. It has no walkable floor,
  // entrance or graph edge, even though its structure remains visible.
  b.box(
    'stadium-spare-trackbed',
    [-10.3, -9.22, 96.2],
    [2.9, 0.4, 80],
    'concrete',
    'trackbed',
  );
  for (const dx of [-0.7175, 0.7175])
    b.box(
      `stadium-spare-rail-${dx}`,
      [-10.3 + dx, -8.985, 96.2],
      [0.07, 0.07, 80],
      'steel',
      'rail',
    );
  b.box(
    'stadium-restricted-spare-platform',
    [-7.2, -8.15, 96.2],
    [3, 0.3, 80],
    'concrete',
    'restricted-platform',
  );
  b.box(
    'stadium-restricted-spare-tactile',
    [-8.5, -7.985, 96.2],
    [0.35, 0.025, 80],
    'yellow',
    'detail',
  );
  for (let z = 56.2, i = 0; z <= 136.2; z += 3.4, i++)
    b.box(
      `stadium-spare-fence-post-${i}`,
      [-4.8, -7.2, z],
      [0.055, 1.6, 0.055],
      'steel',
      'restricted-fence',
      0,
      true,
    );
  b.box(
    'stadium-spare-fence-mesh',
    [-4.8, -7.2, 96.2],
    [0.035, 1.5, 80],
    'glass',
    'restricted-fence',
    0,
    true,
  );
  b.sign(
    'Restricted · No public access',
    [-4.75, -6.9, 98],
    Math.PI / 2,
    3,
    0.32,
  );
  for (let z = 70; z <= 122; z += 25)
    b.sign('Stadium–Chinatown', [2.77, -4.6, z], 0, 4.8, 0.4);
  // Keep seating in the island's central furniture strip between canopy bays,
  // leaving the two boarding/walking edges and the access wells clear.
  for (const z of [79, 110])
    b.bench(`stadium-island-seat-${z}`, [2.77, -8, z], 2.4, 90, {
      material: 'steel',
    });
  b.s.authoredInterior.primaryEntrance = 'stadium-beatty-entry';
  b.s.authoredInterior.streetEntranceMap = {
    'beatty-upper': 'stadium-beatty-entry',
    'pacific-lower': 'stadium-expo-boulevard-entry',
    'keefer-place': 'stadium-keefer-entry',
  };
  b.s.authoredInterior.raisedStreetApproaches = {
    'keefer-place': {
      topLonLat: [-123.109792, 49.2799124],
      stairBottomLonLat: [-123.1097145, 49.2798668],
      deckLonLat: [
        [-123.1096174, 49.2798108],
        [-123.1096652, 49.2797771],
        [-123.1096709, 49.2797741],
        [-123.109698, 49.279757],
      ],
      risers: 20,
      source:
        'https://www.openstreetmap.org/way/367513829; https://www.openstreetmap.org/way/367513830',
      heightBasis:
        'External stairhead and bottom use project terrain. The mapped concrete approach meets the inferred raised concourse; its residual grade is representative, not surveyed.',
    },
  };
  b.s.entrances[0].inwardDirectionM = [0, 0, 1];
  b.s.entrances[1].inwardDirectionM = [-1, 0, 0];
  b.s.entrances[1].streetAttachmentStatus =
    'Raised concourse/pedestrian bridge: attach to the public deck surface, not raw terrain underneath';
  b.s.entrances[2].inwardDirectionM = [0, 0, -1];
  b.s.authoredInterior.publicPlatformTopology =
    'one public island; restricted west side platform has no public walking edges';
  b.s.authoredInterior.mappedHorizontalBasis = {
    origin: 'Beatty Street mapped doorway',
    yawDegrees: 45.8078,
    upperStairRunM: 13.07,
    lowerStairRunM: 7.965,
    sparePlatformCentreM: [-7.2, -8, 96.2],
    entranceSeparationM: 161.5,
  };
  b.s.authoredInterior.verticalInference = {
    status:
      'Photo/terrain-corroborated representative scale; not surveyed station floor elevations',
    mainStairPhotoTreadsApprox: 27,
    mainStairRiseM: 4.5,
    mainConcourseYM: -4.5,
    lowerStairRiseM: 3.5,
    platformYM: -8,
    expoDoorYM: -12.85,
    groundDemSamplesM: {
      beattyDoor: 17.047,
      upperStairStart: 15.4729,
      upperStairEnd: 10.9838,
      expoDoor: 4.1926,
      keeferGround: 7.5479,
    },
    groundDemSource:
      'Project public/data/terrain.json via tests/helpers/city-elevation.mjs; samples describe terrain, not bridge or station slab heights',
    keeferAttachment:
      'Raised concourse/bridge entrance. Its public floor cannot be rebound directly to the lower ground DEM; follow the official elevator/ramp approach.',
  };
  b.s.authoredInterior.unverifiedDetails = [
    'Vertical scale is inferred from an approximately 27-tread official main-stair photograph and corroborating city DEM drop near 4.49 m; these are not surveyed interior elevations.',
    'Island length retains the original 74 m train-facing profile and is centred on the mapped spare-platform extent; the exact public platform outline is not mapped.',
    'Lift cabin and surrounding clearances remain representative; mapped elevator point does not specify its complete footprint.',
    'The mapped lift replaces the X7.1 guess. Adjacent escalator spacing, 2.6m lower stair width, 5.1m shaft width and lower bypass are representative clearances inside the island between the running tracks.',
    'Northwest rail-support thickness, maintenance-walk width and tunnel-lining shape are representative; mapped tunnel/bridge boundaries determine the supported longitudinal extents, not a surveyed cross-section.',
  ];
  return b.finish({ encloseElevators: true });
}

export function rebuildYaletown(source) {
  const b = interior(
    alignPlatformAssembly(source, 'yaletown-canada', [0, -16.2, 0]),
    'yaletown-opening-plan-v3',
    [
      {
        url: REF.yaletownBuild,
        note: 'Official construction photos: two reversing entrance stair flights perpendicular to the platform.',
      },
      {
        url: REF.yaletownPhotos,
        note: 'Tafyrn & Seamora opening photographs; IMG_1084 records the installed Lower Concourse Level fire-evacuation plan: separate street/concourse and concourse/platform lift cores.',
      },
      {
        url: 'http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1084.jpg',
        note: 'Photographed existing-condition evacuation plan, not a proposed station design. Constrains circulation topology and compass orientation; dimensions are inferred.',
      },
      {
        url: REF.yaletownGates,
        note: 'June 2026: five fare gates, including two accessible gates.',
      },
      {
        url: REF.yaletownEscalators,
        note: '2019 official report confirms both platform-to-concourse escalators operate up.',
      },
      {
        url: REF.yaletownStairAudit,
        note: 'First-hand 2024 audit: 57 street-to-concourse and41 concourse-to-platform stairs; elevations inferred from normal riser proportions.',
      },
      {
        url: 'https://www.openstreetmap.org/way/229833347',
        note: 'Mapped reversing entry passage constrains axis; street doors independently mapped, platform polygon explicitly approximate.',
      },
      {
        url: 'https://www.openstreetmap.org/way/988151952',
        note: 'Concrete exterior footway leaves mapped lift door 9133604358 towards the southeast; the passenger enters the street lift towards the northwest, not out into the pavement.',
      },
      {
        url: 'https://canadalinephotos.blogspot.com/2009/08/2009-08-07-yaletown-roundhouse-station.html',
        note: 'Pre-opening exterior photographs IMG_3630/3632 show the separate glazed lift tower at the pavilion corner, beside the main stair entrance.',
      },
    ],
  );
  b.s.layoutKind = 'mapped-island-perpendicular-switchback-and-two-lift-cores';
  keepPlatform(b, 'yaletown-canada');
  // The standalone 2.9m stair shaft leaves real track-edge aisles. The old
  // X=±2 waiting centres clipped its enclosing wall with the capsule radius;
  // author the clear origins directly rather than relying on safePoint() to
  // relocate a blocked passenger after loading the station. The train/edge/sill
  // datums and each doorway's longitudinal position stay unchanged.
  for (const p of b.s.platforms)
    for (const door of p.doorAlignmentPoints)
      door.stationWaitingPointM = [
        Math.sign(door.platformEdgePointM[0]) * 2.3,
        door.stationWaitingPointM[1],
        door.stationWaitingPointM[2],
      ];
  b.s.authoredInterior.boardingWaitingOrigins = {
    lateralXM: [-2.3, 2.3],
    reason:
      'Capsule-clear track-edge aisles beside the standalone platform stair shaft; contained inside the retained waiting regions.',
    unchanged:
      'Train poses, carriage-local doors, station sills, platform edges, rail heights and threshold bridges.',
  };
  // Preserve the complete two-sided train interface, with an actual central
  // opening for the descending bank instead of a walkable floor beneath it.
  const island = b.s.floorSurfaces.find(
    (f) => f.surfaceId === 'yaletown-canada',
  );
  island.verticesM = [
    [-3, -16.2, -22],
    [-3, -16.2, 22],
    [3, -16.2, 22],
    [3, -16.2, -22],
  ];
  island.indices = [0, 1, 2, 0, 2, 3];
  b.s.geometryParts = b.s.geometryParts.filter(
    (p) =>
      p.id !== 'floor-yaletown-canada' &&
      !p.id.startsWith('floor-yaletown-canada-cut-'),
  );
  b.box(
    'floor-yaletown-canada',
    [0, -16.35, 0],
    [6, 0.3, 44],
    'floor',
    'floor',
  );

  // Geographic reference: mapped stairs door relative to the approximate island
  // centre. +X is across the platform; +Z is towards its southeast end.
  const entryPoint = [10.98302147, 0, -11.24587495];
  const liftDoor = [13.53119298, 0, -7.1318336];
  // The mapped concrete approach is southeast of the lift door. Keep the
  // cabin inside/northwest of that doorway, rather than on the public pavement.
  // Its precise footprint is representative; the doorway and outside bearing
  // are independently constrained by OSM nodes 9133604358/9133604359.
  const liftCentre = [liftDoor[0], 0, liftDoor[2] - 1.2];
  const street = b.floor(
    'yaletown-davie-street',
    [12.3, 0, -13.2],
    3.4,
    7.2,
    'entrance',
    'yaletown-street',
  );
  const streetLift = b.floor(
    'yaletown-street-lift-lobby',
    [liftDoor[0], 0, liftDoor[2] - 0.5],
    4,
    4.4,
    'lift-landing',
    'yaletown-street',
  );
  const turn = b.floor(
    'yaletown-entry-turn-landing',
    [23.5, -4.65, -12.5],
    3,
    9,
    'landing',
    'yaletown-entry-landing',
  );
  const unpaid = b.floor(
    'yaletown-unpaid-concourse',
    [10.15, -9.4, -9.3],
    8.3,
    11,
    'concourse',
    'yaletown-concourse',
  );
  const lowerLiftHall = b.floor(
    'yaletown-street-lift-concourse-hall',
    [liftDoor[0] - 0.5, -9.4, liftCentre[2]],
    4,
    3,
    'lift-landing',
    'yaletown-concourse',
  );
  // The true street-lift core occupies the inside corner of the lower entrance
  // branch. The returning escalator must discharge beside it, with an open
  // lower-concourse passage around its south side, never through the cabin.
  const entryEscalatorLanding = b.floor(
    'yaletown-entry-escalator-bottom-landing',
    [15.3, -9.4, -7.2],
    2.4,
    4,
    'landing',
    'yaletown-concourse',
  );
  b.walk(
    'yaletown-entry-escalator-unpaid-hall',
    entryEscalatorLanding,
    unpaid,
    [14.2, -9.4, -6.2],
  );
  b.box(
    'yaletown-entry-escalator-lobby-east-wall',
    [16.6, -7.85, -6.6],
    [0.2, 3.1, 3],
    'wall',
    'wall',
    0,
    true,
  );
  b.box(
    'yaletown-entry-escalator-lobby-south-wall',
    [15.3, -7.85, -5.1],
    [2.6, 3.1, 0.2],
    'wall',
    'wall',
    0,
    true,
  );
  b.box(
    'yaletown-entry-escalator-lobby-ceiling',
    [15.3, -6.2, -7.2],
    [2.6, 0.2, 4.2],
    'cream',
    'ceiling',
  );
  b.walk('yaletown-street-lift-unpaid-hall', lowerLiftHall, unpaid, [
    liftDoor[0] - 1.7,
    -9.4,
    liftCentre[2],
  ]);
  // The long paid hall lies above the island. Circulation passes either side of
  // its real stairwell, with the second lift at the other end of this hall.
  const north = b.floor(
    'yaletown-paid-north-landing',
    [0, -9.4, -16.5],
    12,
    5,
    'concourse',
    'yaletown-concourse',
  );
  const west = b.floor(
    'yaletown-paid-west-aisle',
    [-4.5, -9.4, 1],
    3,
    30,
    'concourse',
    'yaletown-concourse',
  );
  const east = b.floor(
    'yaletown-paid-east-aisle',
    [4.5, -9.4, 1],
    3,
    30,
    'concourse',
    'yaletown-concourse',
  );
  const rear = b.floor(
    'yaletown-paid-rear-landing',
    [0, -9.4, 18.5],
    12,
    5,
    'concourse',
    'yaletown-concourse',
  );
  const centre = b.floor(
    'yaletown-paid-centre',
    [0, -9.4, 1.5],
    6,
    2,
    'concourse',
    'yaletown-concourse',
  );
  b.walk('yaletown-unpaid-paid-gate-route', unpaid, east, [6, -9.4, -9.3]);
  for (const [name, aisle, x] of [
    ['west', west, -4.5],
    ['east', east, 4.5],
  ]) {
    b.walk(`yaletown-${name}-north-link`, aisle, north, [x, -9.4, -14]);
    b.walk(`yaletown-${name}-rear-link`, aisle, rear, [x, -9.4, 16]);
    b.walk(`yaletown-${name}-centre-link`, aisle, centre, [
      Math.sign(x) * 3,
      -9.4,
      1.5,
    ]);
  }
  // Plan and OSM agree that the entry switchback is perpendicular to the island.
  supportedFlight(
    b,
    'yaletown-upper-entry-stair',
    street,
    turn,
    [14, 0, -13.2],
    [22, -4.65, -13.2],
    2.6,
    { enclosed: false },
  );
  supportedFlight(
    b,
    'yaletown-upper-entry-escalator',
    turn,
    street,
    [22, -4.65, -15.2],
    [14, 0, -15.2],
    1.05,
    { kind: 'escalator', enclosed: false },
  );
  supportedFlight(
    b,
    'yaletown-lower-entry-stair',
    turn,
    unpaid,
    [22, -4.65, -10.5],
    [14.3, -9.4, -10.5],
    2.35,
    { enclosed: false },
  );
  supportedFlight(
    b,
    'yaletown-lower-entry-escalator',
    entryEscalatorLanding,
    turn,
    [15.4, -9.4, -8.65],
    [22.8, -4.65, -8.65],
    0.95,
    { kind: 'escalator', enclosed: false },
  );
  b.box(
    'yaletown-entry-shaft-side--1',
    [19, -3.1, -16.5],
    [10.4, 12.6, 0.2],
    'wall',
    'wall',
    0,
    true,
  );
  for (const [id, center, size] of [
    ['west', [13.95, -3.1, -7.8], [0.3, 12.6, 0.2]],
    ['east', [20.35, -3.1, -7.8], [7.7, 12.6, 0.2]],
    ['lintel', [15.3, -1.7, -7.8], [2.4, 9.8, 0.2]],
  ])
    b.box(
      `yaletown-entry-shaft-side-1-${String(id)}`,
      center,
      size,
      'wall',
      'wall',
      0,
      true,
    );
  b.box(
    'yaletown-entry-turn-wall',
    [25.1, -3.1, -12.15],
    [0.2, 12.6, 8.9],
    'wall',
    'wall',
    0,
    true,
  );
  b.box(
    'yaletown-entry-shaft-roof',
    [19, 3.1, -12.15],
    [12.4, 0.2, 8.9],
    'cream',
    'ceiling',
  );
  b.box(
    'yaletown-switchback-divider',
    [18, -4.65, -11.7],
    [8, 4.4, 0.16],
    'wall',
    'wall',
    0,
    true,
  );
  b.room('yaletown-glass-headhouse', [17.5, 0, -12.15], 15, 8.5, {
    material: 'glass',
    height: 3.3,
    doors: {
      west: [[-4, 3.9]],
      east: [[-4, 3.9]],
      south: [[liftDoor[0] - 17.5 - 1.1, liftDoor[0] - 17.5 + 1.1]],
    },
  });
  b.box(
    'yaletown-headhouse-timber-soffit',
    [17.5, 3.13, -12.15],
    [15, 0.16, 8.5],
    'wood',
    'ceiling',
  );
  for (let x = 10.3, i = 0; x < 25; x += 1.8, i++) {
    b.beam(
      `yaletown-headhouse-roof-beam-${i}`,
      [x, 2.98, -16.4],
      [x, 2.98, -7.9],
      0.14,
      0.18,
      'steel',
      'detail',
    );
    for (const z of [-16.35, -7.95]) {
      if (z > -8 && Math.abs(x - liftDoor[0]) < 1.2) continue;
      b.box(
        `yaletown-headhouse-mullion-${i}-${z}`,
        [x, 1.5, z],
        [0.09, 3, 0.09],
        'steel',
        'detail',
      );
    }
  }
  b.entrance(
    'yaletown-davie-mainland-entry',
    'Davie Street · main stairs',
    street,
    entryPoint,
  );
  b.entrance(
    'yaletown-street-lift-entry',
    'Davie Street · independent lift entrance',
    streetLift,
    liftDoor,
  );
  b.s.entrances[0].inwardDirectionM = [1, 0, 0];
  b.s.entrances[1].inwardDirectionM = [0.023717, 0, -0.999719];
  // Street photographs show the lift as a distinct taller glazed corner tower.
  // The lower open portal is completed by the shared cabin/landing enclosure;
  // these upper panels preserve its visible mass without obstructing the door.
  b.room(
    'yaletown-street-lift-tower-upper',
    [liftCentre[0], 2.8, liftCentre[2]],
    2.55,
    2.55,
    { height: 2.2, material: 'glass' },
  );
  for (const dx of [-1.275, 1.275])
    b.box(
      `yaletown-street-lift-tower-upright-${dx}`,
      [liftCentre[0] + dx, 2.5, liftCentre[2] + 1.275],
      [0.16, 5, 0.16],
      'steel',
      'column',
      0,
      true,
    );
  b.sign('Yaletown–Roundhouse', [10, 2.7, -12.1], -Math.PI / 2, 6.4, 0.48);
  b.sign('Canada Line  ↓', [14, 2.4, -12.1], -Math.PI / 2, 4, 0.42);
  b.room('yaletown-concourse-enclosure', [0, -9.4, 1], 12, 40, {
    material: 'wall',
    height: 3.3,
    doors: { east: [[-15.8, -4.8]] },
  });
  b.room('yaletown-unpaid-hall-enclosure', [10.15, -9.4, -9.3], 8.3, 11, {
    material: 'wall',
    height: 3.3,
    doors: { west: [[-5, 5]], east: [[-5, 5]] },
  });
  // Five photographed 2026 gate lanes, with wider first and last lanes.
  for (const [i, z] of [-13, -11.1, -9.5, -7.9, -6].entries()) {
    const width = i === 0 || i === 4 ? 1.1 : 0.76;
    for (const side of [-1, 1]) {
      const zz = z + side * (width / 2 + 0.13);
      b.box(
        `yaletown-2026-fare-gate-${i}-pedestal-${side}`,
        [7.2, -8.91, zz],
        [0.84, 0.98, 0.22],
        'steel',
        'fare-gate',
        0,
        true,
      );
      b.box(
        `yaletown-2026-fare-gate-${i}-reader-${side}`,
        [7.44, -8.38, zz],
        [0.25, 0.09, 0.19],
        'black',
        'detail',
      );
      b.box(
        `yaletown-2026-fare-gate-${i}-glass-${side}`,
        [7.03, -8.82, z + side * (width / 2 - 0.03)],
        [0.44, 0.72, 0.025],
        'glass',
        'fare-gate-leaf',
      );
    }
  }
  b.sign(
    'Trains  ↓  Waterfront · Richmond / YVR',
    [6.6, -6.8, -9.3],
    Math.PI / 2,
    7,
    0.42,
  );
  for (const z of [-13.8, -12.8])
    b.box(
      `yaletown-ticket-machine-${z}`,
      [11.8, -8.55, z],
      [0.65, 1.7, 0.45],
      'steel',
      'ticket-machine',
      0,
      true,
    );
  // Lower bank and second lift occupy the island axis, on opposite ends of the
  // paid hall, as shown on the installed fire plan. No corridor crosses a rail.
  supportedFlight(
    b,
    'yaletown-platform-stair',
    'yaletown-canada',
    centre,
    [0, -16.2, 14],
    [0, -9.4, 2.5],
    2.9,
    { enclosed: false, walkLaneOffsetM: 0.7 },
  );
  // IMG_1074 shows the continuous central stainless divider. Keep the physical
  // 2.9 m / 41-riser stair and use an actual side lane for the navigation axis.
  b.beam(
    'yaletown-platform-stair-central-handrail',
    [0, -16.2 + 0.95, 14],
    [0, -9.4 + 0.95, 2.5],
    0.055,
    0.065,
    'steel',
    'handrail',
  );
  const platformStair = b.s.connections.at(-1);
  for (const i of [0, 8, 16, 24, 32, 40]) {
    const tread = platformStair.treadSurfaces[i],
      p = tread.verticesM.reduce(
        (sum, v) => sum.map((n, axis) => n + v[axis] / 4),
        [0, 0, 0],
      ),
      t = (14 - p[2]) / 11.5,
      railY = -16.2 + t * 6.8 + 0.95,
      height = railY - p[1];
    b.box(
      `yaletown-platform-stair-central-post-${i}`,
      [0, p[1] + height / 2, p[2]],
      [0.065, height, 0.065],
      'steel',
      'handrail',
      0,
      true,
    );
  }
  supportedFlight(
    b,
    'yaletown-platform-up-escalator',
    'yaletown-canada',
    north,
    [0.65, -16.2, 0.5],
    [0.65, -9.4, -14],
    1.05,
    { kind: 'escalator', enclosed: false },
  );
  supportedFlight(
    b,
    'yaletown-platform-added-escalator',
    'yaletown-canada',
    north,
    [-0.65, -16.2, 0.5],
    [-0.65, -9.4, -14],
    1.05,
    { kind: 'escalator', enclosed: false },
  );
  b.shaft(
    'yaletown-platform-escalator-shaft',
    [0, -16.2, 0.5],
    [0, -9.4, -14],
    2.8,
    { height: 3.5, material: 'wall' },
  );
  b.shaft(
    'yaletown-platform-stair-shaft',
    [0, -16.2, 14],
    [0, -9.4, 2.5],
    3.4,
    { height: 3.5, material: 'wall' },
  );
  b.elevator(
    'yaletown-lift-street-concourse',
    streetLift,
    lowerLiftHall,
    liftCentre,
    [liftCentre[0], -9.4, liftCentre[2]],
  );
  b.elevator(
    'yaletown-lift-concourse-platform',
    rear,
    'yaletown-canada',
    [0, -9.4, 18],
    [0, -16.2, 18],
  );
  b.sign(
    'Way out  ↑  Davie Street / Mainland Street',
    [0, -14, 0.9],
    Math.PI,
    5.8,
    0.4,
  );
  // Platform enclosure and finishes, based on opening-era photographs.
  for (const side of [-1, 1]) {
    b.box(
      `yaletown-charcoal-track-wall-${side}`,
      [side * 6.6, -14.3, 0],
      [0.22, 6.4, 46],
      'black',
      'wall',
      0,
      true,
    );
    b.box(
      `yaletown-track-wall-name-band-${side}`,
      [side * 6.45, -13.8, 0],
      [0.035, 0.42, 9],
      'line',
      'detail',
    );
    for (let z = -18, i = 0; z <= 18; z += 4.5, i++) {
      b.box(
        `yaletown-track-ad-frame-${side}-${i}`,
        [side * 6.43, -14.05, z],
        [0.035, 1.42, 1.8],
        'steel',
        'advertisement-frame',
      );
      b.box(
        `yaletown-track-ad-panel-${side}-${i}`,
        [side * 6.4, -14.05, z],
        [0.025, 1.25, 1.61],
        i % 2 ? 'cream' : 'line',
        'detail',
      );
    }
    b.box(
      `yaletown-platform-edge-soffit-${side}`,
      [side * 2.23, -12.85, 0],
      [1.5, 0.16, 44],
      'cream',
      'ceiling',
      0,
      false,
      [0, 0, Math.sin(-side * 0.085), Math.cos(-side * 0.085)],
    );
    b.box(
      `yaletown-platform-edge-light-${side}`,
      [side * 2.89, -13, 0],
      [0.085, 0.055, 44],
      'light',
      'ceiling',
    );
    for (const [end, z, length] of [
      ['north', -18.65, 6.7],
      ['south', 19.1, 5.8],
    ])
      b.box(
        `yaletown-platform-centre-soffit-${side}-${end}`,
        [side * 0.74, -12.6, z],
        [1.45, 0.16, length],
        'cream',
        'ceiling',
      );
    b.sign(
      side < 0 ? '← Waterfront' : 'YVR–Airport / Richmond →',
      [side * 6.31, -13.55, 8],
      side < 0 ? Math.PI / 2 : -Math.PI / 2,
      4,
      0.32,
    );
  }
  for (const [i, z] of [
    [0, -16],
    [1, 1.5],
  ])
    stripedColumn(b, `yaletown-striped-island-column-${i}`, 0, -16.2, z);
  // Walkthrough photographs show pale metal waiting seats against the island
  // spine. Exact furniture offsets are representative, between column bays.
  for (const z of [-19])
    b.bench(`yaletown-island-seat-${z}`, [0, -16.2, z], 2.4, z > 0 ? 180 : 0, {
      material: 'steel',
    });
  for (const [i, z] of [
    [0, -19],
    [1, 20.4],
  ]) {
    b.sign('Yaletown–Roundhouse', [0, -13.05, z], 0, 4.9, 0.38);
    b.box(
      `yaletown-arrival-board-${i}`,
      [0, -13.65, z + 1.3],
      [2.5, 0.36, 0.12],
      'black',
      'arrival-board',
    );
    b.sign(
      'Waterfront     2 min',
      [0, -13.65, z + 1.22],
      Math.PI,
      2.2,
      0.22,
      '#090d0f',
    );
  }
  b.s.authoredInterior.platformStairDivider = {
    photo:
      'http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1074.jpg',
    physicalWidthM: 2.9,
    risers: 41,
    walkLaneOffsetM: 0.7,
    railHeightM: 0.95,
    status:
      'Photographed central stainless divider is physical. Rail/post dimensions and the side walking line are representative, not surveyed. Signs occupy flat end bays outside both lower access wells and lift core.',
  };
  // Circular bored-tunnel rings at each track end; openings remain train-clear.
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      for (let ring = 0; ring < 4; ring++) {
        const cz = end * (23.5 + ring * 1.1),
          cx = side * 4.7,
          cy = -15.1,
          radius = 2.25;
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8,
            a2 = ((i + 1) * Math.PI) / 8;
          b.beam(
            `yaletown-bored-tunnel-${side}-${end}-${ring}-${i}`,
            [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz],
            [cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, cz],
            0.13,
            0.16,
            'concrete',
            'tunnel-ring',
          );
        }
      }
  b.s.authoredInterior.primaryEntrance = 'yaletown-davie-mainland-entry';
  b.s.authoredInterior.streetEntranceMap = {
    'davie-mainland': 'yaletown-davie-mainland-entry',
    'davie-elevator': 'yaletown-street-lift-entry',
  };
  b.s.authoredInterior.publicPlatformTopology =
    'one island, with perpendicular upper switchback and separate street/concourse and concourse/platform lift shafts';
  b.s.authoredInterior.verticalInference = {
    status:
      'First-hand stair counts constrain representative proportions; not surveyed slab elevations',
    streetToConcourseStairs: 57,
    upperFlightTreads: 28,
    lowerEntryFlightTreads: 29,
    streetToConcourseRiseM: 9.4,
    concourseToPlatformStairs: 41,
    concourseToPlatformRiseM: 6.8,
    concourseYM: -9.4,
    platformYM: -16.2,
    countSource: REF.yaletownStairAudit,
  };
  b.s.authoredInterior.horizontalInference = {
    status:
      'Existing photographed evacuation plan and OSM passage constrain topology and axes; metre dimensions remain representative',
    source:
      'http://www.seataf.com/blogs/canadaline/2009-08-18/images/IMG_1084.jpg',
    caution:
      '2009 photographed Lower Concourse Level plan is an existing-condition reference, not a measured CAD drawing. Active platform centre derives from OSM approximate polygon.',
  };
  b.s.authoredInterior.streetLiftApproach = {
    doorwayNode: 9133604358,
    exteriorFootway: 988151952,
    exteriorNextNode: 9133604359,
    exteriorNextLonLat: [-123.1218337, 49.2744856],
    inwardBearingDegrees: 315.8903568785,
    source:
      'https://www.openstreetmap.org/way/988151952; http://www.seataf.com/blogs/canadaline/2009-08-07/images/IMG_3630.jpg',
    status:
      'Mapped doorway/approach fixes the entrance side. Cabin size, tower height and inset pavilion portal remain representative, not surveyed.',
  };
  b.s.authoredInterior.unverifiedDetails = [
    'The 28/29 division of the observed57 upper steps is inferred; exact widths and riser heights are not surveyed.',
    'The installed evacuation plan establishes two separate lift cores. Exact shaft dimensions and the intervening passage widths remain representative.',
  ];
  b.s.provenance.depthStatus = b.s.authoredInterior.verticalInference.status;
  b.s = carveFloorRect(b.s, 'yaletown-canada', {
    minX: -1.7,
    maxX: 1.7,
    minZ: -14,
    maxZ: 0.5,
  });
  b.s = carveFloorRect(b.s, 'yaletown-canada', {
    minX: -1.7,
    maxX: 1.7,
    minZ: 2.5,
    maxZ: 14,
  });
  b.s = carveFloorRect(b.s, entryEscalatorLanding, {
    minX: 15.4,
    maxX: 16.6,
    minZ: -9.2,
    maxZ: -8.1,
  });
  b.s = carveFloorRect(b.s, turn, {
    minX: 22,
    maxX: 22.8,
    minZ: -9.2,
    maxZ: -8.1,
  });
  return b.finish({ encloseElevators: true });
}

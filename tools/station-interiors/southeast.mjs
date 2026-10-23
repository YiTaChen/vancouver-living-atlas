import { interior } from './builder.mjs';

const REF = {
  stadiumStairs: 'https://www.translink.ca/plans-and-projects/projects/maintenance-and-upgrade-program/rail-projects/elevator-and-escalator-replacement',
  stadiumThird: 'https://buzzer.translink.ca/2017/08/this-is-why-theres-an-unused-third-platform-at-stadium-chinatown-skytrain-station/',
  stadiumMap: 'https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/stadium_chinatown_station_elevator_map.pdf',
  stadiumAbove: 'https://commons.wikimedia.org/wiki/File:Stadium_Chinatown_from_above.jpg',
  stadiumExistingPlan: 'https://www.ianbryane.com/samples/stadium-chinatown-station',
  yaletownBuild: 'https://buzzer.translink.ca/2008/12/canada-line-photos-yaletown-station-construction/',
  yaletownPhotos: 'https://canadalinephotos.blogspot.com/search/label/Yaletown%20-%20Roundhouse',
  yaletownGates: 'https://www.translink.ca/news/2026/june/new%20fare%20gates%20installed%20at%20yaletown%20roundhouse%20station%20to%20improve%20customer%20flow%20and%20accessibility',
  yaletownEscalators: 'https://buzzer.translink.ca/2019/08/the-first-new-canada-line-train-arrives-and-new-escalator-opens/',
};

/** Closed stair support: the player cannot walk through a floating flight. */
function supportedFlight(b, id, from, to, start, end, width, options = {}) {
  b.flight(id, from, to, start, end, width, options);
  const c = b.s.connections.at(-1), y0 = Math.min(start[1], end[1]) - .22;
  const yaw = Math.atan2(end[0] - start[0], end[2] - start[2]) * 180 / Math.PI;
  for (const [i, tread] of c.treadSurfaces.entries()) {
    const p = tread.verticesM.reduce((a, v) => a.map((x, k) => x + v[k] / 4), [0, 0, 0]);
    // Collision hull sits below the riser envelope so the pedestrian capsule
    // can climb a step without its radius hitting the following riser block.
    const h = Math.max(.12, p[1] - y0 - .52);
    b.box(`${id}-solid-support-${i}`, [p[0], y0 + h / 2, p[2]], [width, h, c.treadRunM + .003], 'concrete', 'stair-support', yaw, true);
    const visibleHeight = Math.max(.12, p[1] - y0 - .16);
    b.box(`${id}-closed-riser-fill-${i}`, [p[0], y0 + visibleHeight / 2, p[2]], [width, visibleHeight, c.treadRunM + .003], 'concrete', 'stair-support', yaw);
    if (options.kind !== 'escalator') {
      b.box(`${id}-yellow-nosing-${i}`, [p[0], p[1] + .005, p[2] - Math.sign(end[2] - start[2]) * c.treadRunM * .44], [width, .012, .035], 'yellow', 'detail', yaw);
    }
  }
}

function keepPlatform(b, id) {
  b.platform(id, { columns: false, roof: false });
  const f = b.base.floorSurfaces.find(v => v.surfaceId === id);
  const level = b.base.levels.find(v => v.levelId === f.levelId);
  if (level) b.s.levels.push(structuredClone(level));
  b.tracks();
}

function gateRow(b, prefix, z, y, centres, accessible = []) {
  for (const [i, x] of centres.entries()) {
    const width = accessible.includes(i) ? 1.1 : .76;
    for (const side of [-1, 1]) {
      b.box(`${prefix}-${i}-pedestal-${side}`, [x + side * (width / 2 + .13), y + .49, z], [.22, .98, .84], 'steel', 'fare-gate', 0, true);
      b.box(`${prefix}-${i}-reader-${side}`, [x + side * (width / 2 + .13), y + 1.02, z - .24], [.19, .09, .25], 'black', 'detail');
      // Open glass leaves remain visible at the sides of a traversable gate.
      b.box(`${prefix}-${i}-glass-${side}`, [x + side * (width / 2 - .03), y + .58, z + .17], [.025, .72, .44], 'glass', 'fare-gate-leaf');
    }
    if (accessible.includes(i)) b.sign('Accessible  ♿', [x, y + 1.36, z + .1], 0, 1.04, .2);
  }
}

function stripedColumn(b, id, x, y, z, height = 3.4) {
  b.box(id, [x, y + height / 2, z], [.42, height, .42], 'cream', 'column', 0, true);
  for (let band = .55, i = 0; band < height - .15; band += .54, i++) {
    b.box(`${id}-blue-band-${i}`, [x, y + band, z], [.43, .28, .43], 'line', 'detail');
  }
}

function redRail(b, id, a, end) {
  b.beam(id, a, end, .055, .065, 'red', 'handrail');
}

function alignStadiumPlatform(source) {
  const s = structuredClone(source), f = s.floorSurfaces.find(f => f.surfaceId === 'stadium-expo');
  const xs = f.verticesM.map(v => v[0]), zs = f.verticesM.map(v => v[2]);
  const shift = [2.77 - (Math.min(...xs) + Math.max(...xs)) / 2, -8 - f.verticesM[0][1], 96.2 - (Math.min(...zs) + Math.max(...zs)) / 2];
  const point = p => p.map((v, i) => v + shift[i]);
  for (const floor of s.floorSurfaces) floor.verticesM = floor.verticesM.map(point);
  for (const part of s.geometryParts) part.centerM = point(part.centerM);
  for (const level of s.levels) level.floorHeightM += shift[1];
  for (const p of s.platforms) {
    p.stopPosition.translationM = point(p.stopPosition.translationM);
    p.floorHeightM += shift[1];
    p.railHeightM += shift[1];
    for (const d of p.doorAlignmentPoints) for (const key of ['stationSillPointM', 'platformEdgePointM', 'stationWaitingPointM']) d[key] = point(d[key]);
  }
  for (const v of s.trackExclusionVolumes) { v.footprintM = v.footprintM.map(point); v.minY += shift[1]; v.maxY += shift[1]; }
  for (const bridge of s.thresholdBridges ?? []) {
    for (const key of ['storedTransform', 'deployedTransform']) bridge[key].translationM = point(bridge[key].translationM);
    bridge.deployedFloor.verticesM = bridge.deployedFloor.verticesM.map(point);
    for (const phase of bridge.sequence ?? []) phase.translationM = point(phase.translationM);
  }
  return s;
}

export function rebuildStadium(source) {
  const b = interior(alignStadiumPlatform(source), 'stadium-mapped-circulation-v3', [
    { url: REF.stadiumStairs, note: 'Official main stair photo: enclosed concrete hall, red rails, yellow nosings, adjacent escalator and wood ceiling.' },
    { url: REF.stadiumThird, note: 'One public island and a fenced spare side platform/third track, without public graph links.' },
    { url: REF.stadiumMap, note: 'Beatty upper, Keefer concourse and Expo Boulevard lower entrances.' },
    { url: REF.stadiumAbove, note: 'Daylight island, white steel trusses and pale curved canopies.' },
    { url: REF.stadiumExistingPlan, note: 'Existing Platform Configuration credited to TransLink, separate from the portfolio\'s proposed expansion drawings.' },
    { url: 'https://www.openstreetmap.org/way/569211454', note: 'Mapped Beatty stair horizontal endpoints; about 13 m run.' },
    { url: 'https://www.openstreetmap.org/way/569211456', note: 'Mapped concourse-to-platform stair endpoints; about 8 m run.' },
    { url: 'https://www.openstreetmap.org/way/87222779', note: 'Mapped restricted platform polygon determines west side and longitudinal centre near Z=96 m.' },
  ]);
  b.s.layoutKind = 'mapped-daylit-island-plus-restricted-west-side-platform';
  keepPlatform(b, 'stadium-expo');
  // Rebuilds also receive our previous authored source. Recreate the spare
  // track once instead of copying it as retained regular-service track work.
  b.s.geometryParts = b.s.geometryParts.filter(p => !p.id.startsWith('stadium-spare-'));
  const street = b.floor('stadium-beatty-street', [2.6, 0, 3.95], 12, 7.9, 'entrance', 'stadium-street');
  const concourse = b.floor('stadium-main-concourse', [2, -4.5, 26.685], 13, 12.37, 'concourse', 'stadium-concourse');
  const approach = b.floor('stadium-west-platform-approach', [3.4, -8, 49.915], 7, 18.57, 'corridor', 'stadium-expo-level');
  b.walk('stadium-island-west-approach', approach, 'stadium-expo', [2.77, -8, 59.2]);
  supportedFlight(b, 'stadium-beatty-main-stair', street, concourse, [.5, 0, 7.7], [1.41, -4.5, 20.74], 4.4, { enclosed: false });
  supportedFlight(b, 'stadium-beatty-up-escalator', concourse, street, [5.31, -4.5, 20.74], [4.4, 0, 7.7], 1.15, { kind: 'escalator', enclosed: false });
  supportedFlight(b, 'stadium-concourse-island-stair', concourse, approach, [2.16, -4.5, 32.87], [2.44, -8, 40.83], 3.5, { enclosed: false });
  supportedFlight(b, 'stadium-island-up-escalator', approach, concourse, [5.34, -8, 40.83], [5.06, -4.5, 32.87], 1.05, { kind: 'escalator', enclosed: false });
  b.shaft('stadium-island-access-well', [3.55, -8, 40.83], [3.27, -4.5, 32.87], 7, { material: 'concrete', height: 3.6 });
  b.room('stadium-beatty-pavilion', [2.6, 0, 3.85], 12, 7.7, { material: 'concrete', height: 3.7, doors: { north: [[-4.8, 4.8]], south: [[-5.8, 5.8]] } });
  // Tall constant-height enclosure keeps the upper lift bypass and stair
  // flights inside the real building rather than exposing a floating slope.
  for (const x of [-3.5, 8.7]) b.box(`stadium-beatty-shaft-wall-${x}`, [x, -.45, 14.22], [.2, 8.1, 13.04], 'concrete', 'wall', 0, true);
  b.box('stadium-beatty-shaft-ceiling', [2.6, 3.6, 14.22], [12.4, .18, 13.04], 'wood', 'ceiling');
  b.room('stadium-ticket-hall', [2, -4.5, 26.805], 13, 12.13, { material: 'concrete', height: 8.1, doors: { north: [[-5.8, 6.3]], south: [[-3, 5.8]], east: [[1.2, 5.2]] } });
  b.room('stadium-west-platform-passage', [3.4, -8, 50.015], 7, 18.37, { material: 'concrete', height: 3.4, doors: { north: [[-3.3, 3.3]], south: [[-3.3, 3.3]] } });
  b.entrance('stadium-beatty-entry', 'Beatty Street', street, [0, 0, .2]);
  gateRow(b, 'stadium-main-gate', 27.8, -4.5, [-2, -.6, .8, 2.2, 3.6, 5.3], [0, 5]);
  for (let x = -3.2, i = 0; x <= 8.3; x += .28, i++) b.box(`stadium-beatty-timber-slat-${i}`, [x, 3.55, 10.35], [.14, .12, 20.7], 'wood', 'ceiling');
  for (const side of [-1, 1]) {
    b.box(`stadium-beatty-high-window-${side}`, [side < 0 ? -3.4 : 8.6, 2.3, 9], [.045, 1.5, 16], 'glass', 'window');
    redRail(b, `stadium-beatty-red-wall-rail-${side}`, [.5 + side * 2.12, .93, 7.7], [1.41 + side * 2.12, -3.57, 20.74]);
  }
  redRail(b, 'stadium-beatty-red-centre-rail', [.5, .93, 7.7], [1.41, -3.57, 20.74]);
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    b.box(`stadium-beatty-centre-rail-post-${i}`, [.5 + .91 * t, .48 - 4.5 * t, 7.7 + 13.04 * t], [.055, .9, .055], 'red', 'handrail');
  }
  b.sign('↑ Exit  Beatty Street     BC Place', [2, -.7, 20.5], Math.PI, 7.1, .48, '#e6e8df');
  b.sign('Expo Line  ↓  Platforms 1 · 2', [3.1, -1.9, 32.65], 0, 5.4, .42);
  b.sign('Stadium–Chinatown', [1, 2.8, .05], Math.PI, 6.4, .5);
  const keefer = b.floor('stadium-keefer-entry', [10.17, -4.5, 30.01], 3.34, 4, 'entrance', 'stadium-concourse');
  b.walk('stadium-keefer-hall-link', keefer, concourse, [8.5, -4.5, 30.01]);
  b.room('stadium-keefer-hall', [10.17, -4.5, 30.01], 3.34, 4, { material: 'concrete', height: 3.3, doors: { west: [[-1.7, 1.7]], east: [[-1.7, 1.7]] } });
  b.entrance('stadium-keefer-entry', 'Keefer Place · Chinatown', keefer, [11.84, -4.5, 30.01]);
  b.sign('Stadium–Chinatown   體育館／華埠（唐人街）', [11.88, -1.9, 30.01], Math.PI / 2, 4.8, .36);
  b.sign('Lost Property', [8.35, -2.15, 25.4], Math.PI / 2, 2.5, .3);

  // The three-stop lift is beside the main access bank. Its unmeasured cabin
  // width is kept clear of the photographed stair/escalator lanes.
  const upperLift = b.floor('stadium-lift-upper', [7.1, 0, 20.6], 2.2, 3, 'lift-landing', 'stadium-street');
  const upperLiftHall = b.floor('stadium-lift-upper-hall', [7.1, 0, 14.15], 2, 12.9, 'corridor', 'stadium-street');
  b.walk('stadium-lift-street-link', street, upperLiftHall, [7.1, 0, 7.7]);
  b.walk('stadium-lift-upper-door', upperLiftHall, upperLift, [7.1, 0, 20.6]);
  for (const x of [6.05, 8.15]) b.box(`stadium-upper-lift-bypass-guard-${x}`, [x, .5, 14.15], [.06, 1, 12.9], 'glass', 'balustrade');
  const midLift = b.floor('stadium-lift-mid', [7.1, -4.5, 21.6], 2.2, 3, 'lift-landing', 'stadium-concourse');
  b.walk('stadium-lift-mid-concourse-link', midLift, concourse, [7.1, -4.5, 22.5]);
  const lowerLift = b.floor('stadium-lift-lower', [7.1, -8, 20.6], 2.2, 3, 'lift-landing', 'stadium-expo-level');
  const lowerHall = b.floor('stadium-lift-lower-hall', [6.3, -8, 32.6], 1.2, 22.4, 'corridor', 'stadium-expo-level');
  const lowerBranch = b.floor('stadium-lift-lower-branch', [6.6, -8, 21.6], 2.4, 2, 'corridor', 'stadium-expo-level');
  b.walk('stadium-lift-lower-door', lowerLift, lowerBranch, [7.1, -8, 21.6]);
  b.walk('stadium-lift-lower-branch-hall', lowerBranch, lowerHall, [6.3, -8, 22.1]);
  b.walk('stadium-lift-lower-island-link', lowerHall, approach, [6.3, -8, 43]);
  b.elevator('stadium-main-lift-street-concourse', upperLift, midLift, [7.1, 0, 20.6], [7.1, -4.5, 20.6]);
  b.elevator('stadium-main-lift-concourse-platform', midLift, lowerLift, [7.1, -4.5, 20.6], [7.1, -8, 20.6]);

  const eastLanding = b.floor('stadium-expo-east-landing', [2.77, -8, 133.1], 7, .2, 'landing', 'stadium-expo-level');
  const eastMid = b.floor('stadium-expo-east-mid', [2.6, -10.4, 142], 7, 3, 'landing', 'stadium-east-access');
  const eastStreet = b.floor('stadium-expo-boulevard', [2.43, -12.85, 155.745], 7, 11.49, 'entrance', 'stadium-expo-boulevard');
  b.walk('stadium-island-east-landing', 'stadium-expo', eastLanding, [2.77, -8, 133.2]);
  supportedFlight(b, 'stadium-expo-east-upper-stair', eastLanding, eastMid, [2.77, -8, 133.2], [2.6, -10.4, 140.5], 4.8, { enclosed: true, material: 'concrete' });
  supportedFlight(b, 'stadium-expo-east-lower-stair', eastMid, eastStreet, [2.6, -10.4, 143.5], [2.43, -12.85, 150], 4.8, { enclosed: true, material: 'concrete' });
  b.room('stadium-expo-east-mid-enclosure', [2.6, -10.4, 142], 5.2, 3, { material: 'concrete', doors: { north: [[-2.4, 2.4]], south: [[-2.4, 2.4]] } });
  b.room('stadium-expo-boulevard-enclosure', [2.43, -12.85, 155.745], 7, 11.49, { material: 'concrete', doors: { north: [[-2.4, 2.4]], south: [[-2.8, 2.8]] } });
  b.entrance('stadium-expo-boulevard-entry', 'Expo Boulevard · Rogers Arena', eastStreet, [2.43, -12.85, 161.49]);
  b.sign('Exit ↓  Expo Boulevard · Rogers Arena', [2.77, -5.7, 132.5], 0, 5.8, .36);

  for (let z = 64, i = 0; z < 132; z += 10.5, i++) {
    for (const side of [-1, 1]) b.box(`stadium-canopy-column-${i}-${side}`, [2.77 + side * 1.25, -6.2, z], [.23, 3.6, .23], 'cream', 'column', 0, true);
    b.beam(`stadium-truss-top-${i}`, [-12, -3.25, z], [10, -3.25, z], .12, .14, 'cream', 'truss');
    b.beam(`stadium-truss-bottom-${i}`, [-12, -4.45, z], [10, -4.45, z], .12, .14, 'cream', 'truss');
    for (let x = -12, n = 0; x < 10; x += 2, n++) b.beam(`stadium-truss-diagonal-${i}-${n}`, [x, n % 2 ? -3.25 : -4.45, z], [Math.min(x + 2, 10), n % 2 ? -4.45 : -3.25, z], .085, .09, 'cream', 'truss');
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) b.box(`stadium-curved-canopy-${side}-${i}`, [2.77 + side * (.5 + i * .85), -4.36 + Math.sin(i * Math.PI / 6) * .45, 96.2], [.9, .12, 74], 'cream', 'ceiling', 0, false, [0, 0, Math.sin(side * (i - 1.5) * .07), Math.cos(side * (i - 1.5) * .07)]);
    b.box(`stadium-platform-light-${side}`, [2.77 + side * 2.7, -4.55, 96.2], [.10, .055, 74], 'light', 'ceiling');
    b.box(`stadium-retaining-wall-${side}`, [side < 0 ? -12.2 : 10.2, -6.45, 96.2], [.3, 4.5, 82], 'concrete', 'wall', 0, true);
  }
  // The actual spare polygon is on the west side. It has no walkable floor,
  // entrance or graph edge, even though its structure remains visible.
  b.box('stadium-spare-trackbed', [-10.3, -9.22, 96.2], [2.9, .4, 80], 'concrete', 'trackbed');
  for (const dx of [-.7175, .7175]) b.box(`stadium-spare-rail-${dx}`, [-10.3 + dx, -8.985, 96.2], [.07, .07, 80], 'steel', 'rail');
  b.box('stadium-restricted-spare-platform', [-7.2, -8.15, 96.2], [3, .3, 80], 'concrete', 'restricted-platform');
  b.box('stadium-restricted-spare-tactile', [-8.5, -7.985, 96.2], [.35, .025, 80], 'yellow', 'detail');
  for (let z = 56.2, i = 0; z <= 136.2; z += 3.4, i++) b.box(`stadium-spare-fence-post-${i}`, [-4.8, -7.2, z], [.055, 1.6, .055], 'steel', 'restricted-fence', 0, true);
  b.box('stadium-spare-fence-mesh', [-4.8, -7.2, 96.2], [.035, 1.5, 80], 'glass', 'restricted-fence', 0, true);
  b.sign('Restricted · No public access', [-4.75, -6.9, 98], Math.PI / 2, 3, .32);
  for (let z = 70; z <= 122; z += 25) b.sign('Stadium–Chinatown', [2.77, -4.6, z], 0, 4.8, .4);
  // Keep seating in the island's central furniture strip between canopy bays,
  // leaving the two boarding/walking edges and the access wells clear.
  for (const z of [79, 110]) b.bench(`stadium-island-seat-${z}`, [2.77, -8, z], 2.4, 90, { material: 'steel' });
  b.s.authoredInterior.primaryEntrance = 'stadium-beatty-entry';
  b.s.authoredInterior.streetEntranceMap = { 'beatty-upper': 'stadium-beatty-entry', 'pacific-lower': 'stadium-expo-boulevard-entry', 'keefer-place': 'stadium-keefer-entry' };
  b.s.entrances[0].inwardDirectionM = [0, 0, 1];
  b.s.entrances[1].inwardDirectionM = [-1, 0, 0];
  b.s.entrances[1].streetAttachmentStatus = 'Raised concourse/pedestrian bridge: attach to the public deck surface, not raw terrain underneath';
  b.s.entrances[2].inwardDirectionM = [0, 0, -1];
  b.s.authoredInterior.publicPlatformTopology = 'one public island; restricted west side platform has no public walking edges';
  b.s.authoredInterior.mappedHorizontalBasis = { origin: 'Beatty Street mapped doorway', yawDegrees: 45.8078, upperStairRunM: 13.07, lowerStairRunM: 7.965, sparePlatformCentreM: [-7.2, -8, 96.2], entranceSeparationM: 161.5 };
  b.s.authoredInterior.verticalInference = {
    status: 'Photo/terrain-corroborated representative scale; not surveyed station floor elevations',
    mainStairPhotoTreadsApprox: 27,
    mainStairRiseM: 4.5,
    mainConcourseYM: -4.5,
    lowerStairRiseM: 3.5,
    platformYM: -8,
    expoDoorYM: -12.85,
    groundDemSamplesM: { beattyDoor: 17.047, upperStairStart: 15.4729, upperStairEnd: 10.9838, expoDoor: 4.1926, keeferGround: 7.5479 },
    groundDemSource: 'Project public/data/terrain.json via tests/helpers/city-elevation.mjs; samples describe terrain, not bridge or station slab heights',
    keeferAttachment: 'Raised concourse/bridge entrance. Its public floor cannot be rebound directly to the lower ground DEM; follow the official elevator/ramp approach.',
  };
  b.s.authoredInterior.unverifiedDetails = ['Vertical scale is inferred from an approximately 27-tread official main-stair photograph and corroborating city DEM drop near 4.49 m; these are not surveyed interior elevations.', 'Island length retains the original 74 m train-facing profile and is centred on the mapped spare-platform extent; the exact public platform outline is not mapped.', 'Lift cabin and surrounding clearances remain representative; mapped elevator point does not specify its complete footprint.'];
  return b.finish();
}

export function rebuildYaletown(source) {
  const b = interior(source, 'yaletown-reference-switchback-v1', [
    { url: REF.yaletownBuild, note: 'Official construction photos: two reversing entrance stair flights and landing, separate platform stairs and escalator.' },
    { url: REF.yaletownPhotos, note: 'Original walkthrough photographs: island spine, full concrete shafts, blue/white column bands and charcoal track walls.' },
    { url: REF.yaletownGates, note: 'June 2026: five fare gates, including two accessible gates.' },
    { url: REF.yaletownEscalators, note: '2019 official report confirms both platform-to-concourse escalators operate up.' },
  ]);
  b.s.layoutKind = 'underground-island-with-switchback-entry-and-fare-concourse';
  keepPlatform(b, 'yaletown-canada');
  // A U-shaped public surface leaves an actual stairwell opening. Keeping a
  // walkable rectangle below ascending treads would trap the runtime walker
  // under the flight while the visible stairs appeared to be traversable.
  const island = b.s.floorSurfaces.find(f => f.surfaceId === 'yaletown-canada');
  island.verticesM = [];
  island.indices = [];
  for (const [xmin, xmax, zmin, zmax] of [[-3, -1.7, -22, 22], [1.7, 3, -22, 22], [-1.7, 1.7, -18, 22]]) {
    const n = island.verticesM.length;
    island.verticesM.push([xmin, -15, zmin], [xmin, -15, zmax], [xmax, -15, zmax], [xmax, -15, zmin]);
    island.indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  const street = b.floor('yaletown-davie-street', [0, 0, -29], 10, 8, 'entrance', 'yaletown-street');
  const streetLift = b.floor('yaletown-street-lift-lobby', [0, 0, -34.5], 10, 3, 'lift-landing', 'yaletown-street');
  b.walk('yaletown-street-lift-lobby-link', street, streetLift, [0, 0, -33]);
  const turn = b.floor('yaletown-entry-turn-landing', [0, -4.1, -15.5], 10, 3, 'landing', 'yaletown-entry-landing');
  const unpaid = b.floor('yaletown-unpaid-concourse', [0, -8.2, -26], 12, 2, 'concourse', 'yaletown-concourse');
  const west = b.floor('yaletown-paid-west-aisle', [-4.15, -8.2, -29.75], 3.7, 5.5, 'concourse', 'yaletown-concourse');
  const east = b.floor('yaletown-paid-east-aisle', [4.15, -8.2, -29.75], 3.7, 5.5, 'concourse', 'yaletown-concourse');
  const paid = b.floor('yaletown-paid-rear-landing', [0, -8.2, -34.25], 12, 3.5, 'concourse', 'yaletown-concourse');
  b.walk('yaletown-west-fare-gate-route', unpaid, west, [-3.65, -8.2, -27]);
  b.walk('yaletown-east-fare-gate-route', unpaid, east, [3.65, -8.2, -27]);
  b.walk('yaletown-west-paid-landing-route', west, paid, [-3.65, -8.2, -32.5]);
  b.walk('yaletown-east-paid-landing-route', east, paid, [3.65, -8.2, -32.5]);

  // Reversing upper flights have a real shared landing and full-height shaft walls.
  supportedFlight(b, 'yaletown-upper-entry-stair', street, turn, [-2.4, 0, -25], [-2.4, -4.1, -17], 2.6, { enclosed: false });
  supportedFlight(b, 'yaletown-upper-entry-escalator', turn, street, [-.1, -4.1, -17], [-.1, 0, -25], 1.05, { kind: 'escalator', enclosed: false });
  supportedFlight(b, 'yaletown-lower-entry-stair', turn, unpaid, [2.25, -4.1, -17], [2.25, -8.2, -25], 2.35, { enclosed: false });
  supportedFlight(b, 'yaletown-lower-entry-escalator', unpaid, turn, [4.1, -8.2, -25], [4.1, -4.1, -17], .95, { kind: 'escalator', enclosed: false });
  for (const side of [-1, 1]) b.box(`yaletown-entry-shaft-side-${side}`, [side * 5.1, -2.5, -19.5], [.2, 11.4, 11.2], 'wall', 'wall', 0, true);
  b.box('yaletown-entry-shaft-turn-wall', [0, -2.5, -13.9], [10.4, 11.4, .2], 'wall', 'wall', 0, true);
  b.box('yaletown-entry-shaft-roof', [0, 3.1, -19.5], [10.4, .2, 11.2], 'cream', 'ceiling');
  b.box('yaletown-switchback-divider', [.75, -3.9, -21], [.16, 3.4, 8], 'wall', 'wall', 0, true);
  for (const side of [-1, 1]) b.box(`yaletown-shaft-horizontal-tile-band-${side}`, [side * 4.98, -3.8, -19.5], [.025, .38, 10.5], 'cream', 'detail');
  b.room('yaletown-glass-headhouse', [0, 0, -30.5], 10, 11, { material: 'glass', height: 3.3, doors: { north: [[-3.7, 3.7]], south: [[-4.8, 4.8]] } });
  b.box('yaletown-headhouse-timber-soffit', [0, 3.13, -30.5], [10, .16, 11], 'wood', 'ceiling');
  for (let z = -35.8, i = 0; z < -25; z += 1.8, i++) {
    b.beam(`yaletown-headhouse-roof-beam-${i}`, [-5, 2.98, z], [5, 2.98, z], .14, .18, 'steel', 'detail');
    for (const side of [-1, 1]) b.box(`yaletown-headhouse-mullion-${i}-${side}`, [side * 4.96, 1.5, z], [.09, 3, .09], 'steel', 'detail');
  }
  b.entrance('yaletown-davie-mainland-entry', 'Davie Street · Mainland Street', streetLift, [0, 0, -35.8]);
  b.sign('Yaletown–Roundhouse', [0, 2.7, -36], Math.PI, 6.4, .48);
  b.sign('Canada Line  ↓', [0, 2.4, -25.2], 0, 4, .42);
  b.sign('Way out  ↑  Davie Street', [0, -1.7, -16.9], Math.PI, 4.9, .36);
  b.room('yaletown-concourse-enclosure', [0, -8.2, -30.5], 12, 11, { material: 'wall', height: 3.3, doors: { south: [[-4.8, 4.8]] } });
  gateRow(b, 'yaletown-2026-fare-gate', -28.3, -8.2, [-4.9, -3.3, 2.9, 4.1, 5.2], [0, 4]);
  b.sign('Trains  ↓   Waterfront · Richmond / YVR', [0, -5.6, -27], 0, 6.3, .42);
  for (const x of [-4.7, -3.7]) {
    b.box(`yaletown-ticket-machine-${x}`, [x, -7.35, -25.55], [.65, 1.7, .45], 'steel', 'ticket-machine', 0, true);
    b.box(`yaletown-ticket-screen-${x}`, [x, -7.16, -25.3], [.42, .45, .025], 'black', 'detail');
  }

  // Lower bank opens into the island, with a solid central spine and edge walkways.
  supportedFlight(b, 'yaletown-platform-stair', 'yaletown-canada', paid, [0, -15, -18], [0, -8.2, -32.5], 1.25, { enclosed: false });
  supportedFlight(b, 'yaletown-platform-up-escalator', 'yaletown-canada', paid, [1.01, -15, -18], [1.01, -8.2, -32.5], .75, { kind: 'escalator', enclosed: false });
  supportedFlight(b, 'yaletown-platform-added-escalator', 'yaletown-canada', paid, [-1.01, -15, -18], [-1.01, -8.2, -32.5], .75, { kind: 'escalator', enclosed: false });
  b.shaft('yaletown-platform-shaft', [0, -15, -18], [0, -8.2, -32.5], 2.9, { height: 3.5, material: 'wall' });
  // Below-concourse corridor allows the one aligned lift shaft to reach the island.
  const lowerLift = b.floor('yaletown-platform-lift-lobby', [0, -15, -34.5], 6, 3, 'lift-landing', 'yaletown-canada-level');
  for (const side of [-1, 1]) {
    const corridor = b.floor(`yaletown-lift-platform-aisle-${side}`, [side * 2.35, -15, -27.5], 1.3, 11, 'corridor', 'yaletown-canada-level');
    b.walk(`yaletown-lift-lobby-aisle-${side}`, lowerLift, corridor, [side * 2.35, -15, -33]);
    b.walk(`yaletown-lift-aisle-island-${side}`, corridor, 'yaletown-canada', [side * 2.35, -15, -22]);
    b.box(`yaletown-lower-lift-corridor-wall-${side}`, [side * 3.1, -13.4, -28.5], [.2, 3.2, 14], 'wall', 'wall', 0, true);
    b.box(`yaletown-lower-lift-corridor-ceiling-${side}`, [side * 2.35, -11.8, -27.5], [1.5, .15, 11], 'cream', 'ceiling');
  }
  b.elevator('yaletown-lift-street-concourse', streetLift, paid, [0, 0, -34.5], [0, -8.2, -34.5]);
  b.elevator('yaletown-lift-concourse-platform', paid, lowerLift, [0, -8.2, -34.5], [0, -15, -34.5]);
  b.sign('Way out  ↑  Davie Street / Mainland Street', [0, -12.8, -17.8], Math.PI, 5.8, .4);

  // Platform enclosure and finishes, based on opening-era photographs.
  for (const side of [-1, 1]) {
    b.box(`yaletown-charcoal-track-wall-${side}`, [side * 6.6, -13.1, 0], [.22, 6.4, 46], 'black', 'wall', 0, true);
    b.box(`yaletown-track-wall-name-band-${side}`, [side * 6.45, -12.6, 0], [.035, .42, 9], 'line', 'detail');
    for (let z = -18, i = 0; z <= 18; z += 4.5, i++) {
      b.box(`yaletown-track-ad-frame-${side}-${i}`, [side * 6.43, -12.85, z], [.035, 1.42, 1.8], 'steel', 'advertisement-frame');
      b.box(`yaletown-track-ad-panel-${side}-${i}`, [side * 6.40, -12.85, z], [.025, 1.25, 1.61], i % 2 ? 'cream' : 'line', 'detail');
    }
    b.box(`yaletown-platform-edge-soffit-${side}`, [side * 2.23, -11.65, 0], [1.5, .16, 44], 'cream', 'ceiling', 0, false, [0, 0, Math.sin(-side * .085), Math.cos(-side * .085)]);
    b.box(`yaletown-platform-edge-light-${side}`, [side * 2.89, -11.8, 0], [.085, .055, 44], 'light', 'ceiling');
    b.box(`yaletown-platform-centre-soffit-${side}`, [side * .74, -11.4, 2], [1.45, .16, 40], 'cream', 'ceiling');
    // Keep the lower stairwell open; only the unoccupied portion receives a lid.
    b.s.geometryParts.at(-1).centerM[2] = 4;
    b.s.geometryParts.at(-1).sizeM[2] = 36;
    b.sign(side < 0 ? '← Waterfront' : 'YVR–Airport / Richmond →', [side * 6.31, -12.35, 8], side < 0 ? Math.PI / 2 : -Math.PI / 2, 4, .32);
  }
  for (let z = -8, i = 0; z <= 17; z += 8.5, i++) stripedColumn(b, `yaletown-striped-island-column-${i}`, 0, -15, z);
  // Walkthrough photographs show pale metal waiting seats against the island
  // spine. Exact furniture offsets are representative, between column bays.
  for (const z of [-3.8, 13]) b.bench(`yaletown-island-seat-${z}`, [0, -15, z], 2.4, 90, { material: 'steel' });
  for (let z = -12, i = 0; z <= 16; z += 14, i++) {
    b.sign('Yaletown–Roundhouse', [0, -11.85, z], 0, 4.9, .38);
    b.box(`yaletown-arrival-board-${i}`, [0, -12.45, z + 1.3], [2.5, .36, .12], 'black', 'arrival-board');
    b.sign('Waterfront     2 min', [0, -12.45, z + 1.22], Math.PI, 2.2, .22, '#090d0f');
  }
  // Circular bored-tunnel rings at each track end; openings remain train-clear.
  for (const side of [-1, 1]) for (const end of [-1, 1]) for (let ring = 0; ring < 4; ring++) {
    const cz = end * (23.5 + ring * 1.1), cx = side * 4.7, cy = -13.9, radius = 2.25;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, a2 = (i + 1) * Math.PI / 8;
      b.beam(`yaletown-bored-tunnel-${side}-${end}-${ring}-${i}`, [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cz], [cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, cz], .13, .16, 'concrete', 'tunnel-ring');
    }
  }
  b.s.authoredInterior.layoutConstraint = 'Existing train/door offsets retained. Widths remain representative; narrow central stair/escalator bank preserves the two existing edge walkways.';
  b.s.authoredInterior.publicPlatformTopology = 'one island; central circulation spine does not separate the two boarding edges into independent side platforms';
  b.s.authoredInterior.primaryEntrance = 'yaletown-davie-mainland-entry';
  b.s.authoredInterior.streetEntranceMap = { 'davie-mainland': 'yaletown-davie-mainland-entry' };
  b.s.entrances[0].inwardDirectionM = [0, 0, 1];
  return b.finish();
}

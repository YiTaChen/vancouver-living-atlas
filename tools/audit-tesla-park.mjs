/** Offline CPU audit of actual rendered ground and source-owned Tesla geometry.
 * No browser, WebGL, downloads or runtime imports of this audit are required.
 * Run: node tools/audit-tesla-park.mjs [--output /absolute/report.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ROOT,
  THREE,
  ts,
  createFixture,
  load,
  readData,
  geo,
  sourceHashes,
} from './causeway-cpu.mjs';

const outputIndex = process.argv.indexOf('--output');
const output =
  outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
function canonicalBlock(file, start, end, context, suffix = '') {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const from = source.indexOf(start),
    to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing canonical block ${file}`);
  const code = ts.transpileModule(source.slice(from, to) + suffix, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  // oxlint-disable-next-line typescript/no-implied-eval -- Offline execution of the repository's canonical TypeScript fixture, never external input.
  return new Function(...Object.keys(context), code)(...Object.values(context));
}
function prepareCollisionSources(e) {
  const profile = load('lib/city/facade-profile.ts'),
    roof = load('lib/city/building-roof.ts'),
    { replacedBuilding } = load('lib/city/replaced-buildings.ts');
  // Execute the current source's exact preparation prefix, stopping before its
  // purely visual merged facade buffer/material construction.
  canonicalBlock(
    'lib/city/building-bodies.ts',
    '  const parts:',
    '  const positions:',
    {
      e,
      ...geo,
      ...profile,
      ...roof,
      replacedBuilding,
    },
  );
  const { lakeSurfaces, WaterWorld } = load('lib/city/water-world.ts');
  const surfaces = lakeSurfaces(e.data.context, (x, z) => e.elevation(x, z));
  e.data.waterSurfaces = surfaces;
  const woodPolys = e.data.context.features
    .filter((f) => f.properties.class === 'wood')
    .flatMap((f) => geo.rings(f).map((p) => p.map((r) => r.map(geo.project))));
  const waters = surfaces.map((s) => s.polygon),
    beaches = e.data.context.features
      .filter((f) => f.properties.class === 'beach')
      .flatMap((f) =>
        geo.rings(f).map((p) => p.map((r) => r.map(geo.project))),
      );
  const trees = canonicalBlock(
    'lib/city/environment.ts',
    '  const trees:',
    '  const conifer =',
    {
      e,
      ...geo,
      woodPolys,
      waters,
      beaches,
    },
    '\nreturn trees;',
  );
  e.detailedTrees = {
    trees: trees.map((tree) => ({ ...tree, y: e.elevation(tree.x, tree.z) })),
  };
  const landmarks = load('lib/city/landmark-footprints.json');
  e.data['context-land'] = readData('context-land.geojson');
  e.waterWorld = new WaterWorld(
    e.landPolys,
    e.data['context-land'],
    surfaces,
    e.data.buildings,
    landmarks,
    e.beachGround,
  );
  for (const p of e.data.beachCoast.groundObstacleFootprints)
    e.waterWorld.addObstacle(p);
  for (const p of e.data.solidWaterFootprints ?? [])
    e.waterWorld.addObstacle(p);
  e.landmarkDetails = [];
  e.settings = { buildings: true };
  e.streetFurniture = null;
  e.data.streetLampPoints = load(
    'lib/city/road-decorations.ts',
  ).roadDecorations(e, e.data.roadGraph);
  return {
    trees: trees.length,
    buildingVolumes: e.data.flightBuildingVolumes.length,
    pitchedRoofs: e.data.buildingRoofs.size,
    lamps: e.data.streetLampPoints.length,
    protectedSurfaces: e.data.travelSurfaces.surfaces.length,
    bridgeSolids: e.data.flightBridgeVolumes?.length ?? 0,
    waterEdges: e.waterWorld.edges.size,
  };
}
function mergeActualGroundPaths(e) {
  const paths = [];
  e.roads.traverse((mesh) => {
    if (
      mesh instanceof THREE.Mesh &&
      mesh.userData.groundPath &&
      !mesh.userData.protectedSurface
    )
      paths.push(mesh);
  });
  if (!paths.length) return 0;
  const geometry = mergeGeometries(paths.map((mesh) => mesh.geometry));
  if (!geometry) throw new Error('Canonical merged ground paths failed');
  const merged = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  merged.userData.walkSurface = true;
  merged.userData.groundPath = true;
  e.roads.add(merged);
  for (const mesh of paths) {
    e.roads.remove(mesh);
    mesh.geometry.dispose();
  }
  return paths.length;
}

// Nature merges these exact draped trails into the rendered ground mesh. The
// general causeway fixture returns them separately to audit their individual IDs.
const started = performance.now();
const fixture = createFixture();
const { e, groundPathMeshes } = fixture;
e.roads.add(...groundPathMeshes);
mergeActualGroundPaths(e);
const inventory = prepareCollisionSources(e);
const { CityTeslaWorld } = load('lib/city/tesla-city-world.ts');
const { createTesla, stepTesla } = load('lib/city/tesla-state.ts');
const { createTeslaRoadsterShape } = load('lib/city/tesla-shape.ts');
const shape = createTeslaRoadsterShape();
const world = new CityTeslaWorld(e);
const park = e.parkPolys.find((p) => p.name === 'Stanley Park');
const cases = [];
const seeds = [];
const pointAt = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const projectEdge = (edge) => {
  const a = e.data.roadGraph.nodes[edge.a].point,
    b = e.data.roadGraph.nodes[edge.b].point;
  return {
    a,
    b,
    yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
    length: Math.hypot(b[0] - a[0], b[1] - a[1]),
  };
};
for (const edge of e.data.roadGraph.edges
  .filter((ed) => ed.names.some((n) => /stanley park drive/i.test(n)))
  .sort((a, b) => b.length - a.length)) {
  const { a, b, yaw, length } = projectEdge(edge),
    point = pointAt(a, b, 0.2);
  if (length < 18 || !geo.inPolygon(point, park.poly)) continue;
  if (
    seeds.some(
      (s) => Math.hypot(s.point[0] - point[0], s.point[1] - point[1]) < 75,
    )
  )
    continue;
  seeds.push({
    kind: 'road',
    id: `Stanley Park Drive edge:${edge.id}`,
    point,
    yaw,
    maxDistance: Math.min(25, length * 0.55),
    source: {
      edgeId: edge.id,
      names: edge.names,
      sourceIds: edge.sourceIds,
      a,
      b,
    },
  });
  if (seeds.length === 8) break;
}
const { isParkTrail } = load('lib/city/park-paths.ts').prepareParkPaths(e);
const trails = [];
for (const feature of e.data.paths.features) {
  if (!isParkTrail(feature)) continue;
  for (const line of geo.lines(feature)) {
    const points = line.map(geo.project);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length >= 25) trails.push({ feature, a, b, length });
    }
  }
}
for (const t of trails.sort((a, b) => b.length - a.length)) {
  const point = pointAt(t.a, t.b, 0.3),
    yaw = Math.atan2(t.b[0] - t.a[0], t.b[1] - t.a[1]);
  if (
    seeds.some(
      (s) =>
        s.kind === 'path' &&
        Math.hypot(s.point[0] - point[0], s.point[1] - point[1]) < 200,
    )
  )
    continue;
  const source = {
    id: t.feature.properties.id,
    name: t.feature.properties.name,
    surface: t.feature.properties.surface,
    a: t.a,
    b: t.b,
  };
  seeds.push({
    kind: 'path',
    id: `Trail ${source.id} ${source.name ?? ''}`,
    point,
    yaw,
    maxDistance: Math.min(15, t.length * 0.35),
    source,
  });
  const turf = [point[0] + Math.cos(yaw) * 9, point[1] - Math.sin(yaw) * 9];
  if (geo.inPolygon(turf, park.poly))
    seeds.push({
      kind: 'turf',
      id: `Turf beside ${source.id}`,
      point: turf,
      yaw,
      maxDistance: 12,
      source,
    });
  if (seeds.filter((s) => s.kind === 'path').length === 4) break;
}
const baseSweep = world.sweep.bind(world);
let activeCase;
world.sweep = (query) => {
  const hit = baseSweep(query);
  if (
    activeCase &&
    hit &&
    activeCase.hits.filter((h) => h.phase === activeCase.phase).length < 16
  )
    activeCase.hits.push(
      structuredClone({ phase: activeCase.phase, query, hit }),
    );
  return hit;
};
const hydrate = (spawn, yaw) => {
  const s = createTesla(spawn.pose.position, yaw, spawn.contact);
  s.quaternion = [...spawn.pose.quaternion];
  return s;
};
for (const seed of seeds) {
  const item = { seed, hits: [], phase: 'setup', reports: [], samples: [] };
  cases.push(item);
  activeCase = item;
  const [x, z] = seed.point,
    y = e.elevation(x, z);
  let state;
  if (seed.kind === 'road') {
    const spawn = world.groundPoseNear([x, y + 1, z], shape, seed.yaw, 0);
    if (!spawn) {
      item.setup = 'no complete verified asphalt pose';
      continue;
    }
    state = hydrate(spawn, seed.yaw);
    item.spawn = spawn;
  } else {
    const pose = {
      position: [x, y + 5, z],
      quaternion: [0, Math.sin(seed.yaw / 2), 0, Math.cos(seed.yaw / 2)],
    };
    if (world.sweep({ from: pose, to: pose, shape })) {
      item.setup = 'actual obstacle at clear-air seed';
      continue;
    }
    state = createTesla(pose.position, seed.yaw);
    state.quaternion = [...pose.quaternion];
    state.flightAssist = false;
    item.dropOrigin = structuredClone(state);
    for (let i = 0; i < 420 && state.mode !== 'ground'; i++) {
      const r = stepTesla(state, {}, 1 / 60, world, shape);
      if (r.environmentFailures) {
        item.setup = 'failed world query during natural descent';
        break;
      }
    }
    if (state.mode !== 'ground') {
      item.setup = 'natural descent has no complete floor ownership';
      item.final = state;
      continue;
    }
  }
  item.setup = 'fresh actual floor owned';
  item.initial = structuredClone(state);
  item.phase = 'forward';
  let stuck = 0,
    dist = 0,
    collisions = 0,
    transitions = 0,
    failures = 0;
  for (let i = 0; i < 360 && dist < seed.maxDistance; i++) {
    const before = state.position.slice();
    const r = stepTesla(state, { throttle: 0.12 }, 1 / 60, world, shape);
    const delta = Math.hypot(
      state.position[0] - before[0],
      state.position[2] - before[2],
    );
    dist += delta;
    collisions += r.collisions;
    transitions += r.transitions;
    failures += r.environmentFailures;
    stuck = delta < 0.00005 && r.collisions ? stuck + 1 : 0;
    if (i % 15 === 0)
      item.samples.push({ i, state: structuredClone(state), report: r });
    if (stuck >= 15 || failures) break;
  }
  item.forward = {
    distance: dist,
    collisions,
    transitions,
    failures,
    state: structuredClone(state),
    stuck: stuck >= 15,
  };
  item.phase = 'brake';
  for (let i = 0; i < 60; i++)
    stepTesla(state, { brake: true }, 1 / 60, world, shape);
  item.stop = structuredClone(state);
  item.phase = 'reverse';
  const reverseStart = state.position.slice();
  let reverseHits = 0;
  for (let i = 0; i < 60; i++)
    reverseHits += stepTesla(
      state,
      { throttle: -0.12 },
      1 / 60,
      world,
      shape,
    ).collisions;
  item.reverse = {
    distance: Math.hypot(
      state.position[0] - reverseStart[0],
      state.position[2] - reverseStart[2],
    ),
    collisions: reverseHits,
    state: structuredClone(state),
  };
  item.phase = 'vortex';
  const vault = structuredClone(item.initial),
    motionPoints = [];
  let motion = null,
    stuntCollisions = 0,
    completed = false,
    landed = false;
  for (let i = 0; i < 300 && !landed; i++) {
    const r = stepTesla(vault, { vortex: i === 0 }, 1 / 60, world, shape);
    motion ??= vault.vortex;
    if (r.collisions && motion?.elapsedS !== 1.4)
      stuntCollisions += r.collisions;
    if (motion?.elapsedS === 1.4) completed = true;
    if (i % 4 === 0) motionPoints.push(vault.position.slice());
    landed = completed && vault.mode === 'ground';
    if (stuntCollisions || r.environmentFailures) break;
  }
  item.vortex = {
    completed,
    landed,
    stuntCollisions,
    final: structuredClone(vault),
  };
  item.phase = 'done';
  const points = [
    item.initial.position,
    item.forward.state.position,
    item.reverse.state.position,
    ...motionPoints,
  ];
  const box = new THREE.Box3()
    .setFromPoints(points.map((p) => new THREE.Vector3(...p)))
    .expandByScalar(10);
  item.faces = world.nearby(box).faces.map((f) => ({
    surfaceId: f.surfaceId,
    triangleId: f.triangleId,
    kind: f.kind,
    triangle: f.triangle,
    normal: f.normal,
    adherable: f.adherable,
    supportGroup: f.supportGroup,
  }));
  console.log(
    JSON.stringify({
      id: seed.id,
      kind: seed.kind,
      setup: item.setup,
      initial: item.initial.position,
      forward: dist,
      stuck: item.forward.stuck,
      collisions,
      transitions,
      reverse: item.reverse.distance,
      reverseHits,
      mode: state.mode,
      vortex: item.vortex,
      firstHit: item.hits[0]?.hit?.surfaceId,
      faces: item.faces.length,
    }),
  );
}
activeCase = null;
const report = {
  kind: 'canonical-Stanley-Park-Tesla-ground-audit-v1',
  provenance: {
    executionHashes: Object.fromEntries(
      [
        'tools/audit-tesla-park.mjs',
        'lib/city/tesla-state.ts',
        'lib/city/tesla-world.ts',
        'lib/city/tesla-city-world.ts',
        'lib/city/tesla-shape.ts',
      ].map((file) => [
        file,
        createHash('sha256')
          .update(fs.readFileSync(path.join(ROOT, file)))
          .digest('hex'),
      ]),
    ),
    limitations: [
      'No medium landmark meshes, runtime furniture or architecture details; roads, all draped trails, terrain, source-owned trees, lamps, buildings, protected decks and water are retained.',
      'Trail/turf seed uses initially clear air and natural descent; no fabricated ground mode/contact.',
    ],
    sourceHashes: sourceHashes(),
  },
  shape,
  inventory,
  elapsedMs: performance.now() - started,
  cases,
};
const reportPath =
  output ?? path.join(ROOT, 'work/tesla-diagnostics/park-ground-audit.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report));
const fixtureIndex = process.argv.indexOf('--fixture-output');
if (fixtureIndex >= 0) {
  const fixturePath = path.resolve(process.argv[fixtureIndex + 1]);
  const compact = {
    kind: 'actual-Stanley-Park-Tesla-floor-v1',
    provenance: report.provenance,
    shape,
    cases: cases
      .filter((c) => c.initial)
      .map((c) => ({
        seed: c.seed,
        initial: c.initial,
        faces: c.faces,
        observed: {
          forward: c.forward,
          reverse: c.reverse,
          stop: c.stop,
          vortex: c.vortex,
        },
      })),
  };
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(compact));
}
console.log(
  JSON.stringify({
    report: reportPath,
    elapsedMs: report.elapsedMs,
    cases: cases.length,
    prepared: cases.filter((c) => c.initial).length,
    stuck: cases.filter((c) => c.forward?.stuck).map((c) => c.seed.id),
  }),
);
world.dispose();

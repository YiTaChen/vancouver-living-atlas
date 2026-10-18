/** Offline CPU audit of actual rendered ground and source-owned Tesla geometry.
 * No browser, WebGL, downloads or runtime imports of this audit are required.
 * Run: node tools/audit-tesla-world.mjs [--output /absolute/report.json]
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
const queriesOnly = process.argv.includes('--queries-only');
const output =
  outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : null;
const round = (value) => Math.round(value * 1000) / 1000;
const timed = (fn) => {
  const start = performance.now();
  const value = fn();
  return { value, ms: round(performance.now() - start) };
};
const distribution = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    meanMs: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p50Ms: round(sorted[Math.floor(sorted.length * 0.5)]),
    p95Ms: round(sorted[Math.floor(sorted.length * 0.95)]),
    maxMs: round(sorted.at(-1)),
  };
};
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

const fixture = timed(() => createFixture());
const { e } = fixture.value;
const sourcePreparation = timed(() => ({
  mergedPathSources: mergeActualGroundPaths(e),
  ...prepareCollisionSources(e),
}));
const executionHashes = Object.fromEntries(
  [
    'lib/city/tesla-world.ts',
    'lib/city/tesla-city-world.ts',
    'lib/city/tesla-state.ts',
    'lib/city/tesla-camera.ts',
    'lib/city/tesla-controller.ts',
    'lib/city/tesla-shape.ts',
    'lib/city/assets/tesla-roadster-contract.ts',
    'tools/audit-tesla-world.mjs',
  ].map((file) => {
    return [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(ROOT, file)))
        .digest('hex'),
    ];
  }),
);
const { CityTeslaWorld } = load('lib/city/tesla-city-world.ts');
const { teslaCameraFrame } = load('lib/city/tesla-camera.ts');
const { createTesla, stepTesla } = load('lib/city/tesla-state.ts');
const { createTeslaRoadsterShape } = load('lib/city/tesla-shape.ts');
const shape = createTeslaRoadsterShape();
const heapBeforeConstructor = process.memoryUsage().heapUsed;
const constructor = timed(() => new CityTeslaWorld(e));
const world = constructor.value;
const initialStats = world.stats();
const [x, z] = geo.project([-123.1258, 49.2831]);
const y = (e.data.roadRelief?.(x, z) ?? e.elevation(x, z)) + 1.05;
const robsonEdges = e.data.roadGraph.edges.filter((edge) =>
  edge.names.some((name) => /robson/i.test(name)),
);
const onEdge = (edge, x, z) => {
  const a = e.data.roadGraph.nodes[edge.a].point,
    b = e.data.roadGraph.nodes[edge.b].point,
    dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)),
  );
  const point = [a[0] + dx * t, a[1] + dz * t];
  return {
    point,
    gap: Math.hypot(point[0] - x, point[1] - z),
    yaw: Math.atan2(dx, dz),
  };
};
const edge = robsonEdges.toSorted((a, b) => {
  return onEdge(a, x, z).gap - onEdge(b, x, z).gap;
})[0];
const a = e.data.roadGraph.nodes[edge.a].point,
  b = e.data.roadGraph.nodes[edge.b].point,
  yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
const realRobson = onEdge(edge, x, z);
const [roadX, roadZ] = realRobson.point,
  roadY =
    (e.data.roadRelief?.(roadX, roadZ) ?? e.elevation(roadX, roadZ)) + 1.05;
const spawn = timed(() =>
  world.groundPoseNear([roadX, roadY, roadZ], shape, yaw, 0),
);
const spawnStats = world.stats();
const queryTimes = {
  support: [],
  sweep: [],
  physics: [],
  cameraRay: [],
  cameraMotion: [],
  cameraPair: [],
  physicsPlusCamera: [],
};
const collisionSamples = [];
const visitedContacts = new Map();
let drivenDistance = 0,
  stepFailures = 0;
const realSweep = world.sweep.bind(world);
let captureCollision = false;
world.sweep = (query) => {
  const hit = realSweep(query);
  if (captureCollision && hit && collisionSamples.length < 12)
    collisionSamples.push({
      hit,
      from: query.from,
      to: query.to,
      ignored: query.ignoreSurfaceId,
    });
  return hit;
};
let state = null,
  physicsReport = null;
if (spawn.value) {
  const { pose, contact } = spawn.value;
  state = createTesla(pose.position, yaw, contact);
  state.quaternion = [...pose.quaternion];
  const cameraOptions = {
    heading: yaw,
    distance: 7.5,
    lookYaw: 0,
    lookPitch: 0,
    clearance: shape.clearance,
  };
  const cameraPosition = teslaCameraFrame(
    state,
    'chase',
    cameraOptions,
  ).position.clone();
  for (let i = 0; i < 240; i++) {
    const before = [...state.position];
    queryTimes.support.push(
      timed(() =>
        world.support({
          pose,
          shape,
          maxDistance: 1.03,
          adhesion: true,
          preferredSurfaceId: contact.surfaceId,
        }),
      ).ms,
    );
    queryTimes.sweep.push(
      timed(() =>
        world.sweep({
          from: pose,
          to: {
            ...pose,
            position: [
              pose.position[0] + 0.05,
              pose.position[1],
              pose.position[2],
            ],
          },
          shape,
        }),
      ).ms,
    );
    if (!queriesOnly) {
      captureCollision = true;
      const step = timed(() =>
        stepTesla(state, { throttle: 0.2 }, 1 / 60, world, shape),
      );
      captureCollision = false;
      queryTimes.physics.push(step.ms);
      physicsReport = step.value;
      const cameraPair = timed(() => {
        const frame = teslaCameraFrame(state, 'chase', {
          ...cameraOptions,
          heading: state.heading,
          wallNormal: state.mode === 'wall' ? state.contact?.normal : undefined,
        });
        const ray = timed(() =>
          world.cameraSweep(
            frame.target.toArray(),
            frame.position.toArray(),
            0.2,
          ),
        );
        queryTimes.cameraRay.push(ray.ms);
        if (ray.value)
          frame.position.lerpVectors(
            frame.target,
            frame.position,
            Math.max(0.03, ray.value.fraction - 0.035),
          );
        const motion = timed(() =>
          world.cameraSweep(
            cameraPosition.toArray(),
            frame.position.toArray(),
            0.12,
          ),
        );
        queryTimes.cameraMotion.push(motion.ms);
        cameraPosition.lerp(
          frame.position,
          motion.value ? 1 : 1 - Math.exp(-12 / 60),
        );
      });
      queryTimes.cameraPair.push(cameraPair.ms);
      queryTimes.physicsPlusCamera.push(step.ms + cameraPair.ms);
      drivenDistance += Math.hypot(
        ...state.position.map((v, j) => v - before[j]),
      );
      stepFailures += step.value.environmentFailures;
      if (state.contact && !visitedContacts.has(state.contact.surfaceId))
        visitedContacts.set(state.contact.surfaceId, {
          frame: i,
          position: [...state.position],
          ...state.contact,
        });
    }
  }
}
const coverage = [];
for (const [name, ll] of [
  ['Robson', [-123.1258, 49.2831]],
  ['Water Street', [-123.1082, 49.2849]],
  ['Beach Avenue', [-123.1349, 49.2764]],
  ['Burrard Street', [-123.1298, 49.2804]],
  ['Stanley Park ground', [-123.145, 49.3]],
]) {
  const [cx, cz] = geo.project(ll),
    cy = (e.data.roadRelief?.(cx, cz) ?? e.elevation(cx, cz)) + 1.05;
  const term = name.split(' ')[0].toLowerCase();
  let nearest = null;
  for (const edge of e.data.roadGraph.edges) {
    if (
      name === 'Stanley Park ground' ||
      edge.width < 5 ||
      e.data.roadGraph.nodes[edge.a].level !== 'ground' ||
      !edge.names.some((name) => name.toLowerCase().includes(term))
    )
      continue;
    const a = e.data.roadGraph.nodes[edge.a].point,
      b = e.data.roadGraph.nodes[edge.b].point,
      dx = b[0] - a[0],
      dz = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / (dx * dx + dz * dz)),
    );
    const p = [a[0] + dx * t, a[1] + dz * t],
      gap = Math.hypot(p[0] - cx, p[1] - cz);
    if (!nearest || gap < nearest.gap)
      nearest = {
        point: p,
        gap,
        yaw: Math.atan2(dx, dz),
        names: edge.names,
        width: edge.width,
      };
  }
  const rx = nearest?.point[0] ?? cx,
    rz = nearest?.point[1] ?? cz,
    ry = (e.data.roadRelief?.(rx, rz) ?? e.elevation(rx, rz)) + 1.05;
  const result = timed(() =>
    world.groundPoseNear([rx, ry, rz], shape, nearest?.yaw ?? yaw, 0),
  );
  coverage.push({
    name,
    geographicInput: [cx, cy, cz],
    roadCenterline: nearest,
    ms: result.ms,
    roadSpawn: !!result.value,
    position: result.value?.pose.position ?? null,
    contact: result.value?.contact ?? null,
  });
}
const churn = [];
for (let i = 0; i < 96; i++) {
  const px = -2500 + (i % 16) * 300,
    pz = -2200 + Math.floor(i / 16) * 600;
  const pose = { position: [px, 180, pz], quaternion: [0, 0, 0, 1] };
  churn.push(
    timed(() =>
      world.sweep({
        from: pose,
        to: { ...pose, position: [px + 1, 180, pz] },
        shape,
      }),
    ).ms,
  );
}
// Preserve the original 0.2-throttle/four-second timing and cache samples above.
// This separate untimed leg catches the real 127m seam that short timing missed.
const cacheChurn = { ...distribution(churn), stats: world.stats() };
let extendedMotionProof = null;
if (!queriesOnly && spawn.value) {
  const { pose, contact } = spawn.value,
    extendedState = createTesla(pose.position, yaw, contact),
    initialPosition = [...pose.position],
    contacts = new Map(),
    seams = [
      [115, 160],
      [175, 210],
      [300, 340],
    ].map(([fromM, toM]) => ({
      fromM,
      toM,
      frames: 0,
      collisions: 0,
      transitions: 0,
      nonGroundFrames: 0,
      attachmentFrames: 0,
    }));
  extendedState.quaternion = [...pose.quaternion];
  const forwardProgress = () =>
    (extendedState.position[0] - initialPosition[0]) * Math.sin(yaw) +
    (extendedState.position[2] - initialPosition[2]) * Math.cos(yaw);
  let distance = 0,
    collisions = 0,
    transitions = 0,
    environmentFailures = 0,
    nonGroundFrames = 0,
    attachmentFrames = 0,
    maximumSpeedMps = 0;
  for (let frame = 0; frame < 600; frame++) {
    const before = [...extendedState.position],
      priorProgress = forwardProgress(),
      result = stepTesla(extendedState, { throttle: 1 }, 1 / 60, world, shape);
    distance += Math.hypot(
      ...extendedState.position.map((value, i) => value - before[i]),
    );
    collisions += result.collisions;
    transitions += result.transitions;
    environmentFailures += result.environmentFailures;
    nonGroundFrames += Number(extendedState.mode !== 'ground');
    attachmentFrames += Number(!!extendedState.attachment);
    maximumSpeedMps = Math.max(
      maximumSpeedMps,
      Math.hypot(...extendedState.velocity),
    );
    for (const seam of seams)
      if (forwardProgress() >= seam.fromM && priorProgress <= seam.toM) {
        seam.frames++;
        seam.collisions += result.collisions;
        seam.transitions += result.transitions;
        seam.nonGroundFrames += Number(extendedState.mode !== 'ground');
        seam.attachmentFrames += Number(!!extendedState.attachment);
      }
    if (extendedState.contact && !contacts.has(extendedState.contact.surfaceId))
      contacts.set(extendedState.contact.surfaceId, {
        frame,
        position: [...extendedState.position],
        ...extendedState.contact,
      });
  }
  extendedMotionProof = {
    durationS: 10,
    throttle: 1,
    correctnessOnly: true,
    drivenDistance: round(distance),
    forwardDistance: round(forwardProgress()),
    collisions,
    transitions,
    environmentFailures,
    nonGroundFrames,
    attachmentFrames,
    maximumSpeedMps: round(maximumSpeedMps),
    distinctContacts: contacts.size,
    contacts: [...contacts.values()],
    seams,
    passed:
      forwardProgress() > 360 &&
      environmentFailures === 0 &&
      collisions === 0 &&
      nonGroundFrames === 0 &&
      attachmentFrames === 0 &&
      seams.every(
        (seam) =>
          seam.frames > 0 &&
          seam.collisions === 0 &&
          seam.nonGroundFrames === 0 &&
          seam.attachmentFrames === 0,
      ),
    finalPose: {
      position: [...extendedState.position],
      quaternion: [...extendedState.quaternion],
      velocity: [...extendedState.velocity],
      mode: extendedState.mode,
      contact: extendedState.contact,
      attachment: extendedState.attachment,
    },
  };
}
const report = {
  audit: 'actual-repo Tesla CPU world',
  queriesOnly,
  executionHashes,
  shape,
  timestamp: new Date().toISOString(),
  limitations: [
    'No GPU/browser work. Visual landmark medium meshes and asynchronously loaded furniture assets are omitted; source buildings, surveyed/generated trees, measured lamps, exact rendered core terrain/roads/shoreline and causeway protected floors are included.',
    'CPU ground fixture mirrors the existing causeway-cpu canonical engine extraction. Timing is local wall-clock and includes JIT/GC; it is not an FPS guarantee.',
  ],
  preparation: {
    groundFixtureMs: fixture.ms,
    collisionSourcePreparationMs: sourcePreparation.ms,
    ...sourcePreparation.value,
  },
  constructorMs: constructor.ms,
  heapBeforeConstructorMB: round(heapBeforeConstructor / 1024 ** 2),
  heapAtReportMB: round(process.memoryUsage().heapUsed / 1024 ** 2),
  initialStats,
  robson: {
    spawnMs: spawn.ms,
    found: !!spawn.value,
    input: [x, y, z],
    actualRoadInput: [roadX, roadY, roadZ],
    hintToActualRoadDistance: realRobson.gap,
    pose: spawn.value?.pose ?? null,
    contact: spawn.value?.contact ?? null,
    stats: spawnStats,
  },
  timing: Object.fromEntries(
    Object.entries(queryTimes)
      .filter(([, values]) => values.length)
      .map(([name, values]) => [name, distribution(values)]),
  ),
  collisionSamples,
  motionProof: {
    drivenDistance: round(drivenDistance),
    environmentFailures: stepFailures,
    distinctContacts: visitedContacts.size,
    contacts: [...visitedContacts.values()],
  },
  extendedMotionProof,
  finalState: state
    ? {
        mode: state.mode,
        position: state.position,
        contact: state.contact,
        physicsReport,
      }
    : null,
  coverage,
  cacheChurn,
  sourceHashes: sourceHashes(),
};
world.dispose();
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify(
    { ...report, sourceHashes: report.sourceHashes.length },
    null,
    2,
  ),
);
if (
  !spawn.value ||
  (!queriesOnly && !extendedMotionProof?.passed) ||
  initialStats.cachedFaces !== 0 ||
  world.stats().cachedTiles !== 0
)
  process.exitCode = 1;

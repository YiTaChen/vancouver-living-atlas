/** Reproducible ordinary Drive geometry/CCD audit on current Park Drive roads.
 * Run: node tools/audit-stanley-drive.mjs [--output work/stanley-drive-current.json]
 * Native browser handling and protected source routes have separate acceptance.
 */
import fs from 'node:fs';
import { compileFunction } from 'node:vm';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import {
  ROOT,
  ts,
  createFixture,
  load,
  geo,
  sourceHashes,
} from './causeway-cpu.mjs';
const began = performance.now();
const speedFlag = process.argv.indexOf('--speeds');
const speeds =
  speedFlag >= 0
    ? process.argv[speedFlag + 1].split(',').map(Number)
    : [50, 120, 205];
const dtFlag = process.argv.indexOf('--dt');
const frameDt = dtFlag >= 0 ? Number(process.argv[dtFlag + 1]) : 1 / 30;
if (
  !speeds.length ||
  speeds.some((v) => !Number.isFinite(v) || v < 1 || v > 260) ||
  !Number.isFinite(frameDt) ||
  frameDt <= 0 ||
  frameDt > 1 / 15
)
  throw new Error('Use finite speeds 1–260km/h and dt 0–1/15s');
const { e, nav } = createFixture();
const source = fs.readFileSync(
  path.join(ROOT, 'lib/city/environment.ts'),
  'utf8',
);
const begin = source.indexOf('  const trees:'),
  end = source.indexOf('  const conifer =', begin);
if (begin < 0 || end <= begin)
  throw new Error('Canonical Nature tree block changed');
const projectPolys = (name) =>
  e.data.context.features
    .filter((f) => f.properties.class === name)
    .flatMap((f) => geo.rings(f).map((p) => p.map((r) => r.map(geo.project))));
const code = ts.transpileModule(source.slice(begin, end) + '\nreturn trees;', {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const context = {
  e,
  ...geo,
  woodPolys: projectPolys('wood'),
  beaches: projectPolys('beach'),
  waters: e.data.waterPolys,
};
e.settings = { trees: true, quality: 'balanced', buildings: true };
e.detailedTrees = {
  trees: compileFunction(
    code,
    Object.keys(context),
  )(...Object.values(context)).map((t) => ({ ...t, y: e.elevation(t.x, t.z) })),
  syncBroken() {},
};
load('lib/city/environment.ts').reconcileParkRoadTrees(
  e,
  e.detailedTrees.trees,
);
e.data.streetLampPoints = [];
const world = new (load('lib/city/vehicle-impact-world.ts').VehicleImpactWorld)(
  e,
);
e.vehicleImpacts = world;
const originalSweep = world.sweep.bind(world);
let observed = [];
world.sweep = (q) => {
  const h = originalSweep(q);
  if (h) observed.push(h);
  return h;
};
nav.condition = new (load('lib/city/vehicle-condition.ts').VehicleCondition)(
  e,
  nav.car,
  1550,
  0.7,
);
nav.mode = 'drive';
const initialSourceHashes = sourceHashes();
// Audit the currently rendered ordinary road graph. Protected source routes have separate full acceptance.
const graph = e.data.roadGraph;
const selected = new Set(
  graph.edges
    .filter((ed) => ed.names.some((n) => /stanley park drive/i.test(n)))
    .map((ed) => ed.id),
);
const routes = [];
for (const path of graph.paths) {
  let current;
  function flush() {
    if (current?.points.length > 1) routes.push(current);
    current = undefined;
  }
  for (let i = 0; i < path.edgeIds.length; i++) {
    const id = path.edgeIds[i];
    if (!selected.has(id)) {
      flush();
      continue;
    }
    if (!current)
      current = { path: path.id, points: [path.points[i]], edges: [] };
    current.points.push(path.points[i + 1]);
    current.edges.push(id);
  }
  flush();
}
const routeSetHash = createHash('sha256')
  .update(JSON.stringify(routes))
  .digest('hex');
function prepare(route, reverse) {
  const points = reverse ? [...route.points].reverse() : route.points;
  const edges = reverse ? [...route.edges].reverse() : route.edges;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++)
    cumulative.push(
      cumulative.at(-1) +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  function at(distance, offset) {
    let i = cumulative.findIndex((n, j) => j > 0 && n >= distance - 1e-8);
    if (i < 0) i = points.length - 1;
    const a = points[i - 1],
      b = points[i],
      length = cumulative[i] - cumulative[i - 1];
    const f = Math.min(1, Math.max(0, (distance - cumulative[i - 1]) / length));
    const dx = (b[0] - a[0]) / length,
      dz = (b[1] - a[1]) / length;
    return {
      point: [
        a[0] + (b[0] - a[0]) * f + dz * offset,
        a[1] + (b[1] - a[1]) * f - dx * offset,
      ],
      yaw: Math.atan2(dx, dz),
      edge: edges[i - 1],
    };
  }
  return { length: cumulative.at(-1), at };
}
const shape = { halfExtents: [1, 0.65, 2.4], clearance: 0.02 };
function seed(p, yaw, speed, edgeId) {
  nav.position.set(p[0], nav.roadHeight(...p), p[1]);
  nav.yaw = yaw;
  nav.car.rotation.y = yaw;
  nav.speed = speed;
  nav.surface = 'ground';
  nav.surfaceId = undefined;
  nav.surfaceLayer = undefined;
  // This is an explicit source-owned placement pick, never a nearest-Y floor
  // choice. Subsequent frames must traverse actual entry/exit gates normally.
  const sourceIds =
    graph.edges[edgeId]?.sourceIds.map((id) => Number(id.split(':')[0])) ?? [];
  if (
    e.data.prospectOverpass?.segments.some((s) =>
      sourceIds.includes(s.sourceId),
    )
  ) {
    const hit = e.data.travelSurfaces
      .lookup(...p)
      .find(
        (h) =>
          h.surfaceId === 'park:prospect-overpass' &&
          h.layer === 2 &&
          h.allowedModes.includes('drive'),
      );
    if (hit) {
      nav.position.y = hit.y;
      nav.surface = 'bridge';
      nav.surfaceId = hit.surfaceId;
      nav.surfaceLayer = hit.layer;
    }
  }
}
function pose() {
  return {
    position: [nav.position.x, nav.position.y + 0.7, nav.position.z],
    quaternion: nav.car.quaternion.toArray(),
  };
}
const cases = [];
for (const route of routes)
  for (const reverse of [false, true]) {
    const measured = prepare(route, reverse);
    if (measured.length < 12) continue;
    for (const offset of [0, 1.5, -1.5])
      for (const speedKmh of speeds) {
        const speed = speedKmh / 3.6,
          dt = frameDt;
        world.broken.clear();
        nav.condition.repair(0);
        let start;
        // An initial pose must itself be clear. No point is placed inside a tree,
        // bridge parapet, water or a forbidden building to manufacture a stall.
        for (
          let distance = 5;
          distance < Math.min(60, measured.length - 5);
          distance += 1
        ) {
          const p = measured.at(distance, offset);
          seed(p.point, p.yaw, speed, p.edge);
          if (
            !nav.clearGround(...p.point) ||
            originalSweep({ from: pose(), to: pose(), shape })
          )
            continue;
          start = distance;
          break;
        }
        if (start === undefined) {
          cases.push({
            path: route.path,
            reverse,
            offset,
            speedKmh,
            length: measured.length,
            skipped: 'no-clear-start-within-first60m',
          });
          continue;
        }
        const startPoint = measured.at(start, offset),
          endDistance = measured.length - 0.5;
        if (Math.ceil((endDistance - start) / (speed * dt)) > 30000)
          throw new Error('Audit parameters exceed the complete-route frame budget');
        let distance = start,
          moved = 0,
          frames = 0,
          failed;
        while (distance < endDistance - 1e-7 && frames++ < 30000) {
          const nextDistance = Math.min(endDistance, distance + speed * dt),
            p = measured.at(nextDistance, offset);
          const before = nav.position.clone(),
            previousYaw = nav.car.rotation.y;
          const identity = {
            surface: nav.surface,
            surfaceId: nav.surfaceId,
            surfaceLayer: nav.surfaceLayer,
          };
          const dx = p.point[0] - before.x,
            dz = p.point[1] - before.z;
          nav.yaw = Math.atan2(dx, dz);
          nav.speed = speed;
          observed = [];
          const wanted = Math.hypot(dx, dz);
          nav.move(dx, dz);
          const actual = nav.position.clone(),
            travel = Math.hypot(actual.x - before.x, actual.z - before.z);
          moved += travel;
          if (
            Math.hypot(actual.x - p.point[0], actual.z - p.point[1]) > 0.025 ||
            nav.speed < speed * 0.9
          ) {
            const speedAfter = nav.speed;
            const first = observed[0],
              physical = first && world.obstacle(first.surfaceId);
            const prop = physical && world.props.get(physical.id);
            const contacts = observed.slice(0, 3);
            // Replay the exact same accepted input from the same prior state using
            // actual legacy surface permissions alone, without any prop registry.
            nav.position.copy(before);
            nav.yaw = Math.atan2(dx, dz);
            nav.speed = speed;
            nav.car.rotation.y = previousYaw;
            Object.assign(nav, identity);
            e.vehicleImpacts = undefined;
            nav.move(dx, dz);
            const permissionTravel = Math.hypot(
              nav.position.x - before.x,
              nav.position.z - before.z,
            );
            e.vehicleImpacts = world;
            const building = nav.collisions
              .get(
                Math.floor(p.point[0] / 80) + ',' + Math.floor(p.point[1] / 80),
              )
              ?.some((poly) => geo.inPolygon(p.point, poly));
            failed = {
              distance,
              edge: p.edge,
              from: before.toArray(),
              target: p.point,
              actual: actual.toArray(),
              wanted,
              travel,
              speedAfter,
              first,
              contacts,
              physical,
              treeSeed:
                prop?.kind === 'tree'
                  ? e.detailedTrees.trees[Number(prop.id.split(':')[1])].seed
                  : undefined,
              propAsphaltY: prop
                ? e.data.roadSurface.sample(
                    prop.position[0],
                    prop.position[2],
                    prop.position[1] + 1.05,
                  )
                : undefined,
              permissionTravel,
              permissionsAllowFullStep: permissionTravel + 0.02 >= wanted,
              targetAsphaltY: e.data.roadSurface.sample(
                ...p.point,
                e.elevation(...p.point) + 1.05,
              ),
              targetClear: nav.clearGround(...p.point),
              targetOnLand: e.onLand(...p.point),
              targetWater: e.data.waterPolys.some((poly) =>
                geo.inPolygon(p.point, poly),
              ),
              targetBuilding: !!building,
              lonLat: geo.unproject(before.x, before.z),
            };
            break;
          }
          nav.car.position.copy(nav.position);
          nav.car.rotation.y = nav.yaw;
          distance = nextDistance;
        }
        if (!failed && distance < endDistance - 1e-7)
          failed = {
            kind: 'frame-budget',
            distance,
            endDistance,
            frames,
          };
        cases.push({
          path: route.path,
          reverse,
          offset,
          speedKmh,
          dt,
          edges: route.edges,
          stableSourceIds: [
            ...new Set(route.edges.flatMap((id) => graph.edges[id].sourceIds)),
          ].sort((a, b) => a.localeCompare(b)),
          length: measured.length,
          start,
          startPoint: startPoint.point,
          frames,
          moved,
          completed: !failed,
          sourceGeometryStatus: 'current-runtime',
          damage: nav.condition.damage.overall,
          failed,
        });
      }
  }
const byStop = {};
for (const c of cases.filter((c) => c.failed)) {
  const f = c.failed;
  const key =
    f.kind ?? f.physical?.kind ??
    (f.targetWater
      ? 'water'
      : f.targetBuilding
        ? 'building'
        : !f.targetOnLand
          ? 'shoreline'
          : 'surface-permission');
  byStop[key] = (byStop[key] ?? 0) + 1;
}
const finalHashes = sourceHashes();
const finalHashMap = new Map(finalHashes.map((r) => [r.file, r.sha256]));
for (const initial of initialSourceHashes)
  if (finalHashMap.get(initial.file) !== initial.sha256)
    throw new Error('Source changed during audit: ' + initial.file);
const shortRoutes = routes
  .map((r) => ({
    path: r.path,
    lengthM: prepare(r, false).length,
    sourceIds: [...new Set(r.edges.flatMap((id) => graph.edges[id].sourceIds))],
  }))
  .filter((r) => r.lengthM < 12);
const report = {
  sourceStable: true,
  auditScript: {
    file: 'tools/audit-stanley-drive.mjs',
    sha256: createHash('sha256')
      .update(fs.readFileSync(new URL(import.meta.url)))
      .digest('hex'),
  },
  sourceHashes: finalHashes,
  kind: 'current-rendered-Stanley-Drive-continuous-bidirectional-route-audit',
  elapsedMs: performance.now() - began,
  speedsKmh: speeds,
  dt: frameDt,
  sourceRouteSetHash: routeSetHash,
  sourceRouteSet:
    'Current runtime named Park Drive ordinary graph; protected source routes are tested separately',
  fixtureScope:
    'Canonical terrain, buildings, protected road/rails and actual retained tree colliders; street lamps are not populated by this CPU fixture. Native scene acceptance includes the complete runtime prop population.',
  note: 'Source-owned polyline centre/lane target replay uses actual ordinary navigation CCD and permissions. It is a route-feasibility audit, not a claim about human high-speed cornering or input steering.',
  routes: routes.length - shortRoutes.length,
  graphRoutes: routes.length,
  shortRoutesNotReplayed: shortRoutes,
  adjustedEntries: cases.filter((c) => c.start !== undefined && c.start > 5)
    .length,
  cases: cases.length,
  completed: cases.filter((c) => c.completed).length,
  skipped: cases.filter((c) => c.skipped).length,
  failed: cases.filter((c) => c.failed).length,
  damaged: cases.filter((c) => c.damage > 0).length,
  drivenPrefixDistanceM: cases.reduce((n, c) => n + (c.moved || 0), 0),
  byStop,
  treeClearance: e.data.stanleyTreeRoadClearance,
  replays: cases,
};
const outputFlag = process.argv.indexOf('--output');
const output =
  outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : 'work/stanley-drive-current.json';
fs.mkdirSync(path.dirname(path.resolve(ROOT, output)), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, output), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ...report,
      sourceHashes: undefined,
      treeClearance: { ...report.treeClearance, excludedTrees: undefined },
      replays: report.replays.filter((c) => c.failed).slice(0, 4),
    },
    null,
    2,
  ),
);
world.dispose();
if (report.failed || report.skipped || report.adjustedEntries || report.damaged)
  process.exitCode = 1;

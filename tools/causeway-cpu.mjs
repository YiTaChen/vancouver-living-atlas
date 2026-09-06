/** MIT. Portable canonical CPU fixture. Install beside tools/audit-causeway.mjs.
 * Node24 + the project's installed three/typescript/delaunator. No work snapshot,
 * browser, WebGL, remote API, shell, image loading or extra package is required.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const rootArg = process.argv.indexOf('--root');
export const ROOT = path.resolve(
  rootArg >= 0
    ? process.argv[rootArg + 1]
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const require = createRequire(path.join(ROOT, 'package.json'));
export const ts = require('typescript'),
  THREE = require('three');
const cache = new Map(),
  sourceFiles = new Set();
export const readData = (name) => {
  const file = path.join(ROOT, 'public/data', name);
  sourceFiles.add(file);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
export function load(relative) {
  const file = path.resolve(ROOT, relative);
  sourceFiles.add(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  if (file.endsWith('.json')) {
    module.exports = JSON.parse(fs.readFileSync(file, 'utf8'));
    return module.exports;
  }
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (id) => {
    if (!id.startsWith('.')) return require(id);
    let p = path.resolve(path.dirname(file), id);
    if (p.endsWith('.json')) {
      sourceFiles.add(p);
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
    if (!p.endsWith('.ts')) p += '.ts';
    return load(path.relative(ROOT, p));
  };
  vm.runInThisContext(
    `(function(require,module,exports,__filename,__dirname){${output}\n})`,
    { filename: file },
  )(localRequire, module, module.exports, file, path.dirname(file));
  return module.exports;
}
export const geo = load('lib/city/geo.ts');
function actualEngineMethods() {
  const file = path.join(ROOT, 'lib/city/engine.ts'),
    source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    ),
    wanted = new Set([
      'elevation',
      'rawElevation',
      'onLand',
      'geometry',
      'ribbon',
      'makeLand',
    ]);
  sourceFiles.add(file);
  const methods = [];
  function visit(n) {
    if (ts.isMethodDeclaration(n) && wanted.has(n.name.getText(source)))
      methods.push(n.getText(source));
    ts.forEachChild(n, visit);
  }
  visit(source);
  if (methods.length !== wanted.size)
    throw new Error('Canonical CPU method extraction failed');
  const code = ts.transpileModule(
    `export const methods={${methods.join(',\n')}}`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const D = require('delaunator'),
    context = { THREE, ...geo, Delaunator: D.default ?? D },
    module = { exports: {} };
  new Function(...Object.keys(context), 'module', 'exports', code)(
    ...Object.values(context),
    module,
    module.exports,
  );
  return module.exports.methods;
}
/** Execute only Nature's current source shoreline-strip construction. Trees,
 * textures and unrelated overlays are not needed for this CPU ground fixture. */
function createActualShoreStrips(e) {
  const file = path.join(ROOT, 'lib/city/environment.ts');
  sourceFiles.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('  const shorePos:'),
    end = source.indexOf('  // Trails', start);
  if (start < 0 || end < 0)
    throw new Error('Canonical shoreline source extraction failed');
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  new Function('e', 'THREE', 'lines', 'project', code)(
    e,
    THREE,
    geo.lines,
    geo.project,
  );
}

export function createFixture({ harmonize = true } = {}) {
  const geometry = load('lib/city/causeway-geometry.ts'),
    captures = [],
    build = geometry.buildCausewayGeometry;
  geometry.buildCausewayGeometry = (...args) => {
    const result = build(...args);
    captures.push({ input: args[0], options: args[1], result });
    return result;
  };
  const e = {
    data: {},
    scene: new THREE.Scene(),
    roads: new THREE.Group(),
    terrain: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(42, 1.5, 0.08, 45000),
    controls: { target: new THREE.Vector3(), enabled: false },
    stats: {},
    renderer: {
      domElement: {
        addEventListener() {},
        removeEventListener() {},
        focus() {},
        style: {},
        dataset: {},
      },
    },
    roadMaterials: new Map([
      ['sidewalk-concrete', new THREE.MeshStandardMaterial()],
      ['asphalt-fine', new THREE.MeshStandardMaterial()],
    ]),
    ...actualEngineMethods(),
  };
  e.scene.add(e.roads, e.terrain, e.camera);
  for (const name of [
    'paths',
    'roads',
    'buildings',
    'land',
    'parks',
    'context',
  ])
    e.data[name] = readData(name + '.geojson');
  for (const name of ['bridges', 'trees'])
    e.data[name] = readData(name + '.json');
  e.data.elevation = readData('terrain.json');
  e.data.bridgeSurfaces = [];
  e.data.originalLandPolys = e.data.land.features.flatMap((f) =>
    geo.rings(f).map((p) => p.map((r) => r.map(geo.project))),
  );
  e.data.beachCoast = readData('beach-coast.json');
  e.beachGround = new (load('lib/city/beach-ground.ts').BeachGround)(
    e.data.beachCoast,
  );
  e.landPolys = e.data.beachCoast.land.features.flatMap((f) =>
    geo.rings(f).map((p) => p.map((r) => r.map(geo.project))),
  );
  e.parkPolys = e.data.parks.features.flatMap((f) =>
    geo.rings(f).map((p) => ({
      name: f.properties.name ?? f.properties.park_name ?? '',
      poly: p.map((r) => r.map(geo.project)),
    })),
  );
  // Same relevant initialization order as Engine.load: land, prepare, roads,
  // Causeway bridges, nature's ground paths, road index, then StreetNavigation.
  e.makeLand();
  load('lib/city/causeway.ts').prepareCauseway(e);
  load('lib/city/road-surfaces.ts').createRoadSurfaces(e);
  load('lib/city/causeway-meshes.ts').createCausewayMeshes(e);
  const coastalMesh = new THREE.Mesh(
    e.geometry(e.data.beachCoast.pathPositions),
    new THREE.MeshBasicMaterial(),
  );
  coastalMesh.userData.walkSurface = true;
  coastalMesh.userData.groundPath = true;
  e.roads.add(coastalMesh);
  e.data.groundPathSources = [
    {
      id: 'coastal-paths',
      kind: 'path',
      level: 'ground',
      positions: Array.from(
        coastalMesh.geometry.getAttribute('position').array,
      ),
    },
  ];
  const groundSourceIds = new Set([
    44032491, 74267973, 115939816, 363686270, 648864806, 381179591, 863811845,
  ]);
  const groundPathMeshes = [];
  const coastalPaths = new Set(e.data.beachCoast.replacementPathIds);
  for (const f of e.data.paths.features) {
    if (coastalPaths.has(Number(f.properties.sourceId ?? f.properties.id)))
      continue;
    if (
      e.data.causeway.excludedPathIds.has(
        Number(f.properties.sourceId ?? f.properties.id),
      )
    )
      continue;
    for (const line of geo.lines(f)) {
      const mesh = e.ribbon(
        line.map(geo.project),
        f.properties.width || 2.5,
        0,
        1.5,
      );
      mesh.userData.walkSurface = true;
      mesh.userData.groundPath = true;
      mesh.userData.auditPathId = Number(
        f.properties.sourceId ?? f.properties.id,
      );
      groundPathMeshes.push(mesh);
      if (groundSourceIds.has(mesh.userData.auditPathId))
        e.data.groundPathSources.push({
          id: `OSM:${mesh.userData.auditPathId}`,
          kind: 'path',
          level: 'ground',
          positions: Array.from(mesh.geometry.getAttribute('position').array),
        });
    }
  }
  createActualShoreStrips(e);
  if (harmonize) load('lib/city/harmonize-ground.ts').harmonizeGround(e);
  e.data.waterPolys = load('lib/city/water-world.ts')
    .lakeSurfaces(e.data.context, (x, z) => e.elevation(x, z))
    .map((s) => s.polygon);
  const { GroundSurfaceIndex } = load('lib/city/ground-surface.ts'),
    asphalt = [];
  e.roads.traverse((m) => {
    if (
      m instanceof THREE.Mesh &&
      m.userData.asphaltSurface &&
      !m.userData.protectedSurface
    )
      asphalt.push(m);
  });
  e.data.roadSurface = new GroundSurfaceIndex(asphalt);
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const nav = new (load('lib/city/navigation.ts').StreetNavigation)(e);
  e.navigation = nav;
  return {
    e,
    nav,
    index: e.data.travelSurfaces,
    road: captures[0],
    paths: captures[1],
    groundPathMeshes,
    geo,
    THREE,
  };
}
export function samplePolyline(points, step = 0.75) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let j = 1; j <= count; j++)
      out.push([
        a[0] + ((b[0] - a[0]) * j) / count,
        a[1] + ((b[1] - a[1]) * j) / count,
      ]);
  }
  return out;
}
export function replay(fixture, label, points, mode, identity, expected) {
  const { nav, index } = fixture,
    first = points[0],
    hit = identity
      ? index
          .lookup(...first)
          .find(
            (h) => h.surfaceId === identity && h.allowedModes.includes(mode),
          )
      : undefined;
  if (identity && !hit)
    return {
      label,
      valid: false,
      error: 'Missing known allowed start surface',
      identity,
      first,
    };
  // Seed exactly the state fields committed by startAt, bypass its camera/HUD work.
  nav.mode = mode;
  nav.position.set(
    first[0],
    hit?.y ??
      (mode === 'walk' ? nav.groundHeight(...first) : nav.roadHeight(...first)),
    first[1],
  );
  nav.surface = identity ? 'bridge' : 'ground';
  nav.surfaceId = identity;
  nav.surfaceLayer = identity ? 1 : undefined;
  nav.speed = 0;
  let maxPositionError = 0,
    maxYError = 0,
    travelled = 0,
    steps = 0,
    failed;
  const changes = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      before = nav.position.clone(),
      from = nav.surfaceId ?? 'ground';
    nav.yaw = Math.atan2(p[0] - before.x, p[1] - before.z);
    nav.move(p[0] - before.x, p[1] - before.z);
    steps++;
    travelled += Math.hypot(
      nav.position.x - before.x,
      nav.position.z - before.z,
    );
    const error = Math.hypot(nav.position.x - p[0], nav.position.z - p[1]);
    maxPositionError = Math.max(maxPositionError, error);
    if ((nav.surfaceId ?? 'ground') !== from)
      changes.push({ at: i, from, to: nav.surfaceId ?? 'ground' });
    const top = index
      .lookup(nav.position.x, nav.position.z)
      .find(
        (h) => h.surfaceId === nav.surfaceId && h.allowedModes.includes(mode),
      );
    if (top) maxYError = Math.max(maxYError, Math.abs(nav.position.y - top.y));
    if (error > 0.02) {
      failed = {
        at: i,
        target: p,
        actual: nav.position.toArray(),
        currentSurface: nav.surfaceId ?? 'ground',
        targetHits: index.lookup(...p),
        groundY: nav.groundHeight(...p),
        clearGround: nav.clearGround(...p),
        error,
      };
      break;
    }
  }
  return {
    label,
    mode,
    valid: !failed && (!expected || (nav.surfaceId ?? 'ground') === expected),
    steps,
    travelled,
    maxPositionError,
    maxYError,
    changes,
    failed,
    expectedFinalIdentity: expected,
    finalSurfaceId: nav.surfaceId ?? 'ground',
    finalPosition: nav.position.toArray(),
  };
}
export function sourceHashes() {
  return [...sourceFiles].sort().map((file) => {
    const data = fs.readFileSync(file);
    return {
      file: path.relative(ROOT, file),
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  });
}

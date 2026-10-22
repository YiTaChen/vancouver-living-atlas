import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const { prepareStanleySouthRamp } = await import(
  cityModule('stanley-south-ramp')
);
const { createSouthCausewayNetwork } = await import(
  cityModule('south-profile')
);
const { project } = await import(cityModule('geo'));
const source = JSON.parse(
  readFileSync(
    new URL('../lib/city/stanley-south-ramp-source.json', import.meta.url),
  ),
);
const south = JSON.parse(
  readFileSync(new URL('../lib/city/south-profile-data.json', import.meta.url)),
);
const canonical = createSouthCausewayNetwork(south, project).segments.map(
  (s) => ({ ...s, surfaceId: 'lions:road', layer: 1 }),
);
const before = structuredClone(canonical);
const p = prepareStanleySouthRamp({
  project,
  segments: canonical,
  groundRoadTop: () => 5,
});

test('versioned legal source chain is connected, keeps exact OSM XY and never mutates canonical South source/profile', () => {
  assert.deepEqual(
    source.route.wayIds,
    [42000574, 116061627, 604336387, 116061617],
  );
  assert.equal(source.attribution.license, 'ODbL 1.0');
  assert.match(source.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    p.points.length,
    source.ways.reduce((n, w) => n + w.coordinates.length, 0) - 3,
  );
  const points = source.ways.flatMap((w, i) =>
    w.coordinates.slice(i ? 1 : 0).map(project),
  );
  assert.deepEqual(p.points, points);
  assert.deepEqual(canonical, before);
  assert.ok(
    p.segments.every(
      (s) => s.width === 4.5 && s.layer === 0 && s.surfaceId === 'ground',
    ),
  );
  assert.deepEqual(
    [...new Set(p.segments.map((s) => s.sourceId))],
    source.route.wayIds,
    'each baked span retains its actual primary way ID',
  );
  assert.equal(p.geometry.buffers.rails.length, 0);
  assert.ok(p.geometry.buffers.asphalt.length > 0);
});

test('rail opening is confined to the documented terminal motor ramp and affected West source/identity', () => {
  const id = {
    routeId: 'causeway-south-west',
    surfaceId: 'lions:road',
    layer: 1,
    sourceId: 363687651,
  };
  const terminal = project(source.ways.at(-1).coordinates[2]);
  assert.equal(p.railAllowed(id, ...terminal), false);
  assert.equal(
    p.railAllowed({ ...id, sourceId: 363693711 }, ...terminal),
    true,
  );
  assert.equal(
    p.railAllowed({ ...id, routeId: 'lions:south:walk-entry' }, ...terminal),
    true,
  );
  assert.equal(p.railAllowed({ ...id, layer: 2 }, ...terminal), true);
  assert.equal(
    p.railAllowed({ ...id, surfaceId: 'ground' }, ...terminal),
    true,
  );
  assert.equal(p.railAllowed(id, terminal[0] + 20, terminal[1]), true);
  assert.equal(
    p.railAllowed(id, ...p.points[0]),
    true,
    'underpass-side rail remains intact',
  );
  const openings = p.shoulderOpenings(id);
  assert.ok(openings.length > 0);
  assert.ok(openings.every((poly) => poly.outer.length === 4));
  for (const changed of [
    { sourceId: 363693711 },
    { surfaceId: 'other' },
    { layer: 2 },
    { routeId: 'other' },
  ])
    assert.deepEqual(p.shoulderOpenings({ ...id, ...changed }), []);
});

test('finite two-way drive gate joins only the documented ground/main floor and keeps mainline centre outside its trigger', () => {
  const c = p.connections[0];
  assert.equal(c.id, 'stanley-south-legal-motor-ramp');
  assert.deepEqual(c.from, { surfaceId: 'ground', layer: 0 });
  assert.deepEqual(c.to, { surfaceId: 'lions:road', layer: 1 });
  assert.deepEqual(c.allowedModes, ['drive']);
  assert.equal(c.twoWay, true);
  assert.equal(c.geometry.kind, 'gate');
  assert.ok(
    Math.abs(
      Math.hypot(
        c.geometry.a[0] - c.geometry.b[0],
        c.geometry.a[1] - c.geometry.b[1],
      ) - 4.5,
    ) < 1e-7,
  );
  const join = p.merge,
    terminalEnd = p.segments.at(-1);
  assert.ok(Math.abs(terminalEnd.h1 - p.mergeTopY) < 1e-5);
  assert.ok(p.gate.station < p.terminalStart + p.terminalLength - 1);
  assert.ok(
    Math.hypot(join[0] - p.gate.point[0], join[1] - p.gate.point[1]) > 1,
  );
  assert.deepEqual(p.qaRoutes.southEntry.identity, {
    surfaceId: 'ground',
    layer: 0,
  });
  assert.ok(p.qaRoutes.southEntry.points.length > p.points.length);
  const length = (points) =>
    points
      .slice(1)
      .reduce(
        (sum, point, i) =>
          sum + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]),
        0,
      );
  assert.ok(
    Math.abs(
      length(p.qaRoutes.southEntry.points) -
        length(p.qaRoutes.southRail.points) -
        104,
    ) < 1e-7,
  );
  assert.deepEqual(
    p.qaRoutes.southRail.identity,
    p.qaRoutes.southEntry.identity,
  );
  assert.deepEqual(
    p.qaRoutes.southRail.reverseIdentity,
    p.qaRoutes.southEntry.reverseIdentity,
  );
  assert.deepEqual(
    p.qaRoutes.southRail.sourceIds,
    p.qaRoutes.southEntry.sourceIds,
  );
  assert.deepEqual(
    p.qaRoutes.southRail.points.at(-1),
    p.qaRoutes.southEntry.points.at(-1),
  );
});

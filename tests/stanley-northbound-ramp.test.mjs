import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFixture, load, THREE, geo } from '../tools/causeway-cpu.mjs';
const { e, nav, road, paths } = createFixture(),
  p = e.data.stanleyNorthboundRamp,
  source = JSON.parse(
    fs.readFileSync(
      new URL(
        '../lib/city/stanley-northbound-ramp-source.json',
        import.meta.url,
      ),
    ),
  ),
  publicRoads = fs.readFileSync(
    new URL('../public/data/roads.geojson', import.meta.url),
    'utf8',
  );
e.settings = { trees: true, buildings: true, quality: 'balanced' };
e.detailedTrees = { trees: [], syncBroken() {} };
e.data.streetLampPoints = [];
e.vehicleImpacts = new (load(
  'lib/city/vehicle-impact-world.ts',
).VehicleImpactWorld)(e);
nav.condition = new (load('lib/city/vehicle-condition.ts').VehicleCondition)(
  e,
  nav.car,
  1550,
  0.7,
);
const { buildCausewayGeometry, createCausewayTriangleLookup } = load(
  'lib/city/causeway-geometry.ts',
);
function replay(points, identity, kmh) {
  const first = points[0],
    h = e.data.travelSurfaces
      .lookup(...first)
      .find(
        (h) =>
          h.surfaceId === identity.surfaceId &&
          h.layer === identity.layer &&
          h.allowedModes.includes('drive'),
      );
  if (identity.surfaceId === 'ground')
    assert(
      e.data.roadSurface.sample(...first, e.elevation(...first) + 1.05) !==
        undefined,
      'Park approach begins on actual ordinary asphalt',
    );
  else assert(h, 'actual protected start');
  nav.mode = 'drive';
  nav.surface = h ? 'bridge' : 'ground';
  nav.surfaceId = h?.surfaceId;
  nav.surfaceLayer = h?.layer;
  nav.position.set(first[0], h?.y ?? nav.roadHeight(...first), first[1]);
  nav.yaw = Math.atan2(points[1][0] - first[0], points[1][1] - first[1]);
  nav.car.position.copy(nav.position);
  nav.car.rotation.y = nav.yaw;
  nav.speed = 0;
  nav.condition.repair(0);
  const floors = [nav.surfaceId ?? 'ground'];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]),
      n = Math.ceil(l / (kmh / 3.6 / 30));
    for (let j = 1; j <= n; j++) {
      const q = [
          a[0] + ((b[0] - a[0]) * j) / n,
          a[1] + ((b[1] - a[1]) * j) / n,
        ],
        dx = q[0] - nav.position.x,
        dz = q[1] - nav.position.z;
      nav.yaw = Math.atan2(dx, dz);
      nav.car.rotation.y = nav.yaw;
      nav.speed = kmh / 3.6;
      nav.move(dx, dz);
      assert(
        Math.hypot(nav.position.x - q[0], nav.position.z - q[1]) < 0.025,
        JSON.stringify({
          kmh,
          q,
          position: nav.position.toArray(),
          floor: nav.surfaceId,
          layer: nav.surfaceLayer,
          damage: nav.condition.damage,
        }),
      );
      assert(nav.speed >= (kmh / 3.6) * 0.99);
      nav.car.position.copy(nav.position);
      const f = nav.surfaceId ?? 'ground';
      if (f !== floors.at(-1)) floors.push(f);
    }
    length += l;
  }
  assert.equal(nav.condition.damage.overall, 0);
  return { floors, length };
}

test('primary northbound ramp source and runtime graph correction preserve exact surveyed input and bounded floor identities', () => {
  assert(p);
  assert.deepEqual(source.route.wayIds, [41998500, 877408904]);
  assert.deepEqual(
    source.ways.map((w) => w.version),
    [18, 3],
  );
  assert.deepEqual(
    p.points,
    source.ways.flatMap((w, i) =>
      w.coordinates.slice(i ? 1 : 0).map(geo.project),
    ),
  );
  assert.deepEqual(
    JSON.parse(publicRoads).features[1693].geometry.coordinates,
    source.route.citySourceCoordinates,
  );
  assert.equal(
    fs.readFileSync(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
    publicRoads,
  );
  assert(Math.abs(p.length - 120.80897617192394) < 1e-6);
  assert(p.geometry.buffers.asphalt.length / 9 <= 8192);
  assert(
    p.segments.every((s) => s.surfaceId === 'lions:road' && s.layer === 1),
  );
  assert.equal(p.connections[0].id, 'stanley-northbound-legal-motor-ramp');
  assert.deepEqual(p.connections[0].from, { surfaceId: 'ground', layer: 0 });
  assert.deepEqual(p.connections[0].to, { surfaceId: 'lions:road', layer: 1 });
  assert(p.connections[0].twoWay);
  assert(p.entry.station > 13 && p.entry.station < 16);
  const route = p.qaRoutes.northbound.points;
  let pavedApproach = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      count = Math.ceil(length / 0.25);
    for (let j = 0; j <= count; j++) {
      const x = a[0] + ((b[0] - a[0]) * j) / count,
        z = a[1] + ((b[1] - a[1]) * j) / count;
      assert(
        e.data.roadSurface.sample(x, z, e.elevation(x, z) + 1.05) !== undefined,
        `actual Park approach asphalt is continuous at ${x},${z}`,
      );
    }
    pavedApproach += length;
    if (Math.hypot(b[0] - p.points[0][0], b[1] - p.points[0][1]) < 1e-6) break;
  }
  assert(pavedApproach > 19.9 && pavedApproach < 20.1);
});

test('finite northbound entry stays wholly outside the retained Park main lanes and never captures the reproduced reverse lane passage', () => {
  const gate = p.connections[0].geometry;
  for (let j = 0; j <= 20; j++) {
    const x = gate.a[0] + ((gate.b[0] - gate.a[0]) * j) / 20,
      z = gate.a[1] + ((gate.b[1] - gate.a[1]) * j) / 20;
    assert.equal(
      e.data.roadSurface.sample(x, z, e.elevation(x, z) + 1.05),
      undefined,
      'entry gate must not cut across actual ordinary main asphalt',
    );
    const ramp = e.data.travelSurfaces
      .lookup(x, z)
      .find((h) => h.routeId === 'stanley:northbound-motor-ramp');
    assert(ramp);
    assert(Math.abs(ramp.y - (e.data.roadRelief(x, z) + 1.05)) <= 0.025);
  }
  const reproducedMainLane = [
    [-1076.7033, -2526.6695],
    [-1076.9824, -2527.0389],
  ];
  for (const kmh of [50, 120, 205])
    for (const reverse of [false, true]) {
      const result = replay(
        reverse ? [...reproducedMainLane].reverse() : reproducedMainLane,
        { surfaceId: 'ground', layer: 0 },
        kmh,
      );
      assert.deepEqual(result.floors, ['ground']);
    }
});

test('new northbound paving has no skinny steep ridges, shares unchanged lower planes and retains actual green-cycle grade', () => {
  const ramp = createCausewayTriangleLookup(p.geometry),
    main = createCausewayTriangleLookup(road.result),
    id = { surfaceId: 'lions:road', layer: 1 };
  let n = 0,
    max = 0;
  for (const t of p.geometry.topTriangles) {
    if (t.buffer !== 'asphalt') continue;
    const v = p.geometry.buffers.asphalt.slice(t.offset, t.offset + 9),
      normal = new THREE.Vector3(...v.slice(3, 6))
        .sub(new THREE.Vector3(...v.slice(0, 3)))
        .cross(
          new THREE.Vector3(...v.slice(6, 9)).sub(
            new THREE.Vector3(...v.slice(0, 3)),
          ),
        )
        .normalize();
    assert(normal.y > 0.92, JSON.stringify({ v, normal: normal.toArray() }));
    for (const w of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1 / 3, 1 / 3, 1 / 3],
    ]) {
      const x = v[0] * w[0] + v[3] * w[1] + v[6] * w[2],
        z = v[2] * w[0] + v[5] * w[1] + v[8] * w[2],
        a = main.heightAt(x, z, id, 'road'),
        b = ramp.heightAt(x, z, id, 'road');
      if (a && b) {
        n++;
        max = Math.max(max, Math.abs(a.y - b.y));
      }
    }
  }
  assert(n > 20);
  assert(max <= 0.025, `shared main actual plane ${max}`);
  const c = source.relatedWays.find((w) => w.id === 1252160597);
  assert(c.nodeIds.includes(source.ways[0].nodeIds.at(-1)));
  assert.equal(c.version, 4);
  const xy = geo.project(c.coordinates[1]),
    r = ramp.heightAt(...xy, id, 'road');
  assert(r);
  assert(Math.abs(p.pathTop(1252160597, ...xy, -100) - r.y) < 1e-6);
  assert.equal(p.pathTop(1252160599, ...xy, -123), -123);
  const crossing = e.data.travelSurfaces.surfaces.filter(
    (s) => s.sourceId === 1252160597,
  );
  assert(crossing.length);
  assert(
    crossing.every(
      (s) =>
        s.surfaceId === 'lions:east-walk' &&
        s.layer === 1 &&
        s.allowedModes.includes('walk') &&
        s.allowedModes.includes('drive'),
    ),
  );
});
test('only the mapped green crossing conforms exactly to the motor road while unrelated shared path triangles and modes remain unchanged', () => {
  const before = buildCausewayGeometry(paths.input, paths.options),
    actual = paths.result,
    ramp = createCausewayTriangleLookup(p.geometry),
    id = { surfaceId: 'lions:road', layer: 1 };
  // The independent, source-owned south crossing is already part of the scene.
  load('lib/city/stanley-northbound-crossing.ts').conformStanleyNorthboundWalk(
    e,
    before,
  );
  for (const [i, section] of before.perSegment.entries())
    if (section.segment.sourceId !== 1252160597)
      assert.deepEqual(actual.perSegment[i].asphalt, section.asphalt);
  for (const buffer of Object.keys(before.buffers))
    if (buffer !== 'asphalt')
      assert.deepEqual(actual.buffers[buffer], before.buffers[buffer]);
  assert.deepEqual(
    actual.surfaces.map((s) => [
      s.sourceId,
      s.routeId,
      s.surfaceId,
      s.layer,
      s.kind,
      s.allowedModes,
    ]),
    before.surfaces.map((s) => [
      s.sourceId,
      s.routeId,
      s.surfaceId,
      s.layer,
      s.kind,
      s.allowedModes,
    ]),
  );
  let count = 0,
    maxDelta = 0,
    retainedBoundaryDelta = 0;
  for (const t of actual.topTriangles) {
    if (
      t.buffer !== 'asphalt' ||
      !t.identities.some((i) => i.sourceId === 1252160597)
    )
      continue;
    const v = actual.buffers.asphalt.slice(t.offset, t.offset + 9),
      normal = new THREE.Vector3(...v.slice(3, 6))
        .sub(new THREE.Vector3(...v.slice(0, 3)))
        .cross(
          new THREE.Vector3(...v.slice(6, 9)).sub(
            new THREE.Vector3(...v.slice(0, 3)),
          ),
        )
        .normalize();
    assert(normal.y > 0.92, JSON.stringify({ v, normal: normal.toArray() }));
    for (const w of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
      [1 / 3, 1 / 3, 1 / 3],
    ]) {
      const x = v[0] * w[0] + v[3] * w[1] + v[6] * w[2],
        z = v[2] * w[0] + v[5] * w[1] + v[8] * w[2],
        top = ramp.heightAt(x, z, id, 'road');
      if (!top) continue;
      const delta = Math.abs(v[1] * w[0] + v[4] * w[1] + v[7] * w[2] - top.y),
        interior = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4).every(
          (angle) =>
            ramp.heightAt(
              x + Math.cos(angle) * 0.002,
              z + Math.sin(angle) * 0.002,
              id,
              'road',
            ),
        );
      // Original outer cycle-verge heights remain physical at the clip edge;
      // measure canonical agreement only beyond a 2mm boundary sampling band.
      if (interior) {
        count++;
        maxDelta = Math.max(maxDelta, delta);
      } else retainedBoundaryDelta = Math.max(retainedBoundaryDelta, delta);
    }
  }
  assert(count > 50);
  assert(
    retainedBoundaryDelta < 0.032,
    `retained source verge seam ${retainedBoundaryDelta}`,
  );
  assert(
    maxDelta < 0.000025,
    `green crossing physical plane delta ${maxDelta}`,
  );
  const empty = buildCausewayGeometry(paths.input, paths.options),
    snapshot = structuredClone(empty);
  load('lib/city/stanley-south-ramp.ts').conformMergePaving(
    empty,
    p.geometry,
    () => -100,
    new Set(),
  );
  assert.deepEqual(
    empty,
    snapshot,
    'an empty source selector must preserve all actual geometry',
  );
});

test('actual North motor paving keeps a smooth urban grade and clears the real car body over the former artificial crest', () => {
  const ramp = createCausewayTriangleLookup(p.geometry),
    identity = { surfaceId: 'lions:road', layer: 1 };
  let station = 0;
  const spans = p.points.slice(1).map((b, i) => {
    const a = p.points[i],
      length = Math.hypot(b[0] - a[0], b[1] - a[1]),
      start = station;
    station += length;
    return { a, b, length, start };
  });
  const sample = (s, x = 0, z = 0) => {
    const span = spans.find((p) => p.start + p.length >= s) || spans.at(-1),
      t = Math.max(0, Math.min(1, (s - span.start) / span.length)),
      dx = (span.b[0] - span.a[0]) / span.length,
      dz = (span.b[1] - span.a[1]) / span.length,
      xx = span.a[0] + (span.b[0] - span.a[0]) * t + dz * x + dx * z,
      zz = span.a[1] + (span.b[1] - span.a[1]) * t - dx * x + dz * z,
      top = ramp.heightAt(xx, zz, identity, 'road');
    assert(top, `actual motor road supports car footprint ${s},${x},${z}`);
    return top.y;
  };
  let maximumGrade = 0;
  for (let s = 0.25; s < station - 0.25; s += 0.25)
    maximumGrade = Math.max(
      maximumGrade,
      Math.abs(sample(s + 0.25) - sample(s - 0.25)) / 0.5,
    );
  assert(maximumGrade <= 0.14, `actual source grade ${maximumGrade}`);
  assert(p.verticalProfile.maxCenterGrade <= 0.14);
  assert.equal(p.verticalProfile.startM, 40);
  for (let s = 100; s <= 109; s += 0.5) {
    const tyres = [
        [-0.896, -1.39],
        [0.896, -1.39],
        [-0.896, 1.39],
        [0.896, 1.39],
      ].map(([x, z]) => ({ x, z, y: sample(s, x, z) })),
      mean = tyres.reduce((sum, v) => sum + v.y, 0) / 4,
      roll =
        tyres.reduce((sum, v) => sum + v.x * (v.y - mean), 0) /
        tyres.reduce((sum, v) => sum + v.x * v.x, 0),
      pitch =
        tyres.reduce((sum, v) => sum + v.z * (v.y - mean), 0) /
        tyres.reduce((sum, v) => sum + v.z * v.z, 0);
    for (const x of [-1.14, 0, 1.14])
      for (const z of [-2.34, -1.17, 0, 1.17, 2.34])
        assert(
          sample(s, x, z) - (mean + roll * x + pitch * z) < 0.04,
          `actual paving must not project into the low car body at station ${s}`,
        );
  }
});

test('the real central-source shoulder at the North merge is physically cut only within the source ramp corridor', () => {
  const original = buildCausewayGeometry(road.input, {
      ...road.options,
      shoulderOpenings: (id) =>
        id.routeId === 'causeway-central' && id.sourceId === 257712148
          ? []
          : road.options.shoulderOpenings(id),
    }),
    point = [
      (-1156.215087890625 - 1154.8704833984375 - 1158.3331298828125) / 3,
      (-2587.515625 - 2594.741455078125 - 2586.30615234375) / 3,
    ];
  const contains = (vertices) => {
    for (let i = 0; i < vertices.length; i += 9) {
      const a = vertices.slice(i, i + 3),
        b = vertices.slice(i + 3, i + 6),
        c = vertices.slice(i + 6, i + 9),
        det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]),
        u =
          ((point[0] - a[0]) * (c[2] - a[2]) -
            (point[1] - a[2]) * (c[0] - a[0])) /
          det,
        v =
          ((b[0] - a[0]) * (point[1] - a[2]) -
            (b[2] - a[2]) * (point[0] - a[0])) /
          det;
      if (u >= 0 && v >= 0 && u + v <= 1) return true;
    }
    return false;
  };
  assert(
    original.surfaces.some(
      (s) =>
        s.sourceId === 257712148 &&
        s.kind === 'shoulder' &&
        contains(s.triangles),
    ),
    'the reproduced raised central shoulder exists before the finite source opening',
  );
  assert(
    !road.result.surfaces.some(
      (s) =>
        s.sourceId === 257712148 &&
        s.kind === 'shoulder' &&
        contains(s.triangles),
    ),
    'the actual blocking shoulder is absent after the physical cut',
  );
  assert.deepEqual(road.result.buffers.asphalt, original.buffers.asphalt);
  let unchanged = 0;
  for (const [i, section] of original.perSegment.entries()) {
    const t = section.segment;
    if (
      t.sourceId !== 257712148 ||
      Math.min(
        Math.hypot(t.a[0] - p.merge[0], t.a[1] - p.merge[1]),
        Math.hypot(t.b[0] - p.merge[0], t.b[1] - p.merge[1]),
      ) > 45
    ) {
      assert.deepEqual(road.result.perSegment[i].shoulder, section.shoulder);
      unchanged++;
    }
  }
  assert(unchanged > 100);
  const primary = source.relatedWays.find((w) => w.id === 257712148);
  assert.equal(primary.version, 29);
  assert.equal(primary.nodeIds.at(-1), source.route.endNode);
  assert(p.shoulderSourceIds.includes(257712148));
  assert.deepEqual(p.rampEntry.lowerSourceIds, [325793279]);
});

for (const reverse of [false, true])
  for (const kmh of [50, 120, 205])
    test(`full Park approach -> primary northbound ramp -> lower Causeway ${reverse ? 'reverse' : 'forward'} ${kmh}km/h`, () => {
      const q = p.qaRoutes.northbound,
        r = replay(
          reverse ? [...q.points].reverse() : q.points,
          reverse ? q.reverseIdentity : q.identity,
          kmh,
        );
      assert.deepEqual(
        r.floors,
        reverse ? ['lions:road', 'ground'] : ['ground', 'lions:road'],
      );
      assert(r.length > 160);
    });

test('northbound cycle crossing remains walkable on its original floor and the opposite Causeway barrier remains physical', () => {
  const c = source.relatedWays
    .find((w) => w.id === 1252160597)
    .coordinates.map(geo.project);
  for (const reverse of [false, true]) {
    const points = reverse ? [...c].reverse() : c,
      first = points[0],
      h = e.data.travelSurfaces
        .lookup(...first)
        .find(
          (h) =>
            h.surfaceId === 'lions:east-walk' &&
            h.layer === 1 &&
            h.allowedModes.includes('walk'),
        );
    assert(h);
    nav.mode = 'walk';
    nav.surface = 'bridge';
    nav.surfaceId = h.surfaceId;
    nav.surfaceLayer = h.layer;
    nav.position.set(first[0], h.y, first[1]);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.15);
      for (let j = 1; j <= n; j++) {
        const q = [
          a[0] + ((b[0] - a[0]) * j) / n,
          a[1] + ((b[1] - a[1]) * j) / n,
        ];
        nav.yaw = Math.atan2(q[0] - nav.position.x, q[1] - nav.position.z);
        nav.move(q[0] - nav.position.x, q[1] - nav.position.z);
        assert(
          Math.hypot(nav.position.x - q[0], nav.position.z - q[1]) < 0.025,
        );
        assert.equal(nav.surfaceId, 'lions:east-walk');
      }
    }
  }
  const s = e.data.causeway.segments.find(
      (s) =>
        s.routeId === 'causeway-north' &&
        s.sourceId === 325793279 &&
        s.s0 === 0,
    ),
    dx = s.b[0] - s.a[0],
    dz = s.b[1] - s.a[1],
    l = Math.hypot(dx, dz),
    n = [dz / l, -dx / l],
    q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz))
      .toArray(),
    hit = e.vehicleImpacts.sweep({
      from: { position: [s.a[0], s.h0 + 0.7, s.a[1]], quaternion: q },
      to: {
        position: [s.a[0] + n[0] * 15, s.h0 + 0.7, s.a[1] + n[1] * 15],
        quaternion: q,
      },
      shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
    });
  assert(hit?.surfaceId.startsWith('guardrail:'));
});
test.after(() => {
  e.vehicleImpacts.dispose();
  nav.condition.dispose();
});

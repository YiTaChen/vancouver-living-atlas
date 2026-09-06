/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid). Portable integration regression audit, run with Node24. */
import fs from 'node:fs';
import {
  ROOT,
  createFixture,
  geo,
  samplePolyline,
  replay,
  sourceHashes,
} from './causeway-cpu.mjs';
import { auditGeometry } from './causeway-geometry-audit.mjs';
const fixture = createFixture(),
  { e, nav, index } = fixture;
const pathSegments = e.data.causewayPathSegments;
const results = [];
function allowed(s, mode) {
  const p = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  return index
    .lookup(...p)
    .some((h) => h.surfaceId === s.surfaceId && h.allowedModes.includes(mode));
}
function run(label, points, mode, id, expected = id) {
  try {
    return replay(fixture, label, samplePolyline(points), mode, id, expected);
  } catch (error) {
    return { label, valid: false, error: String(error) };
  }
}
const chunks = [];
for (const s of pathSegments) {
  if (!allowed(s, 'walk')) continue;
  const last = chunks.at(-1);
  if (
    last &&
    last.routeId === s.routeId &&
    last.surfaceId === s.surfaceId &&
    Math.hypot(
      last.segments.at(-1).b[0] - s.a[0],
      last.segments.at(-1).b[1] - s.a[1],
    ) < 1e-6
  )
    last.segments.push(s);
  else
    chunks.push({ routeId: s.routeId, surfaceId: s.surfaceId, segments: [s] });
}
for (const [i, c] of chunks.entries()) {
  const points = [c.segments[0].a, ...c.segments.map((s) => s.b)];
  for (const reverse of [false, true]) {
    const path = reverse ? [...points].reverse() : points,
      last = path.at(-1);
    const atGroundGate = e.data.causewayConnections.some(
      (g) =>
        g.geometry.kind === 'gate' &&
        g.to.surfaceId === c.surfaceId &&
        Math.hypot(
          (g.geometry.a[0] + g.geometry.b[0]) / 2 - last[0],
          (g.geometry.a[1] + g.geometry.b[1]) / 2 - last[1],
        ) < 1e-6,
    );
    results.push(
      run(
        `upper-walk:${c.routeId}:chunk${i}:${reverse ? 'reverse' : 'forward'}`,
        path,
        'walk',
        c.surfaceId,
        atGroundGate ? 'ground' : c.surfaceId,
      ),
    );
  }
}
// Reproduce the existing drive audit in both directions, with exact source bends.
const roadGroups = new Map();
for (const s of [
  ...e.data.causeway.segments,
  ...e.data.causeway.main.segments,
]) {
  const a = roadGroups.get(s.routeId) ?? [];
  a.push(s);
  roadGroups.set(s.routeId, a);
}
for (const [name, segs] of roadGroups) {
  const points = [segs[0].a, ...segs.map((s) => s.b)];
  for (const reverse of [false, true]) {
    const path = reverse ? [...points].reverse() : points,
      last = path.at(-1);
    const gate = e.data.causewayConnections.some(
      (g) =>
        g.allowedModes.includes('drive') &&
        g.geometry.kind === 'gate' &&
        Math.hypot(
          (g.geometry.a[0] + g.geometry.b[0]) / 2 - last[0],
          (g.geometry.a[1] + g.geometry.b[1]) / 2 - last[1],
        ) < 1e-6,
    );
    results.push(
      run(
        `upper-drive:${name}:${reverse ? 'reverse' : 'forward'}`,
        path,
        'drive',
        'lions:road',
        gate ? 'ground' : 'lions:road',
      ),
    );
  }
}
// Source-node chain junctions across different physical surface identities.
function nativeSource(id) {
  const seg = pathSegments.filter((s) => s.sourceId === id);
  return {
    segments: seg,
    points: [seg[0].a, ...seg.map((s) => s.b)],
    surfaceId: seg[0].surfaceId,
  };
}
function meet(a, b) {
  const endA = a.at(-1),
    firstB = b[0];
  if (Math.hypot(endA[0] - firstB[0], endA[1] - firstB[1]) > 1e-6)
    throw new Error('Join source orientation mismatch');
  return [...a, ...b.slice(1)];
}
for (const [from, to, reverseTo] of [
  [1277976049, 70954671, false],
  [1349155147, 70954672, false],
  [1349155154, 1349155153, false],
]) {
  const a = nativeSource(from),
    b = nativeSource(to),
    pa = a.points,
    pb = reverseTo ? [...b.points].reverse() : b.points;
  const whole = meet(pa, pb),
    windowStart = Math.max(0, pa.length - 5),
    windowEnd = Math.min(whole.length, pa.length + 5),
    window = whole.slice(windowStart, windowEnd);
  results.push(
    run(
      `upper-junction:${from}->${to}`,
      window,
      'walk',
      a.surfaceId,
      b.surfaceId,
    ),
  );
  results.push(
    run(
      `upper-junction:${to}->${from}`,
      [...window].reverse(),
      'walk',
      b.surfaceId,
      a.surfaceId,
    ),
  );
}
// Actual entry/exit gates. Both actual source sides are entered by crossing the
// finite gate, not by teleporting onto an upper floor for the success assertion.
for (const gate of e.data.causewayConnections.filter(
  (c) => c.geometry.kind === 'gate',
)) {
  const g = gate.geometry,
    c = [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2],
    dx = g.b[0] - g.a[0],
    dz = g.b[1] - g.a[1],
    len = Math.hypot(dx, dz);
  const into = [(g.fromSide * dz) / len, (-g.fromSide * dx) / len];
  const a = [c[0] - into[0] * 2, c[1] - into[1] * 2],
    b = [c[0] + into[0] * 2, c[1] + into[1] * 2];
  const mode = gate.allowedModes[0];
  results.push(
    run(
      `gate:${gate.id}:ground->upper`,
      [a, c, b],
      mode,
      undefined,
      gate.to.surfaceId,
    ),
  );
  results.push(
    run(
      `gate:${gate.id}:upper->ground`,
      [b, c, a],
      mode,
      gate.to.surfaceId,
      'ground',
    ),
  );
}
// Lower paths must stay ground even where an exact upper footprint contains XY.
for (const id of [
  363686270, 648864806, 44032491, 115939816, 74267973, 120254690, 975314385,
  975314386,
]) {
  const f = e.data.paths.features.find(
    (f) => Number(f.properties.sourceId ?? f.properties.id) === id,
  );
  if (!f) {
    results.push({
      label: `lower:${id}`,
      valid: false,
      error: 'Missing lower path',
    });
    continue;
  }
  for (const line of geo.lines(f))
    for (const reverse of [false, true]) {
      const p = line.map(geo.project);
      if (reverse) p.reverse();
      const r = run(
        `lower:${id}:${reverse ? 'reverse' : 'forward'}`,
        p,
        'walk',
        undefined,
      );
      r.valid &&= r.changes?.every((c) => !index.surfaceIds.has(c.to)) ?? false;
      results.push(r);
    }
}
// Explicit foot=no owners remain disallowed even at an allowed crossing overlap.
const denied = [];
for (const id of [
  70954674, 1074018477, 877408899, 1349155152, 1349155151, 1349155149,
  1349155148,
]) {
  const owners = index.surfaces.filter((s) => s.sourceId === id),
    unexpected = owners.filter(
      (s) =>
        s.allowedModes.includes('walk') || s.allowedModes.includes('drive'),
    ).length;
  denied.push({
    sourceId: id,
    owners: owners.length,
    valid: owners.length > 0 && unexpected === 0,
    unexpected,
  });
}
const westNode = geo.project([-123.1427047, 49.3132136]);
const westGateSamples = [
  [0, 0],
  [0.001, 0],
  [-0.001, 0],
  [0, 0.001],
  [0, -0.001],
].map((offset) => {
  const point = [westNode[0] + offset[0], westNode[1] + offset[1]];
  return {
    offset,
    groundTop: nav.groundHeight(...point),
    upperTop: index
      .lookup(...point)
      .find((h) => h.surfaceId === 'lions:west:walk-entry')?.y,
  };
});
const geometry = auditGeometry(fixture);
const report = {
  kind: 'Actual canonical StreetNavigation.move/protectedStep + exact rendered road/path/slab triangles; CPU-only',
  root: ROOT,
  valid:
    results.every((r) => r.valid) &&
    denied.every((r) => r.valid) &&
    geometry.valid,
  scope:
    'Actual land triangulation, City pavement, restored source path ribbons, building/landmark collision footprints, lakes, protected upper floors, real navigation constructor and movement. No camera/HUD/browser/FPS claim.',
  results,
  denied,
  westGateSamples,
  geometry,
  summary: {
    checks: results.length,
    passed: results.filter((r) => r.valid).length,
    failed: results.filter((r) => !r.valid).map((r) => r.label),
  },
  sourceHashes: sourceHashes(),
};
const output = process.argv.indexOf('--output');
if (output >= 0)
  fs.writeFileSync(
    process.argv[output + 1],
    JSON.stringify(report, null, 2) + '\n',
  );
console.log(
  JSON.stringify(
    {
      valid: report.valid,
      summary: report.summary,
      westGateSamples,
      geometry,
      failures: results.filter((r) => !r.valid),
    },
    null,
    2,
  ),
);
nav.destroy();
if (!report.valid) process.exitCode = 1;

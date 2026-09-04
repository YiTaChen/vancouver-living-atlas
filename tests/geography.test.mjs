import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(
  new URL('../lib/city/geo.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const geo = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
const read = (n) =>
  JSON.parse(
    fs.readFileSync(new URL('../public/data/' + n, import.meta.url), 'utf8'),
  );
const naive = (p, r) => {
  let result = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i],
      b = r[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
};
test('exact indexed coast and park classification agrees with independent ray crossing', () => {
  const land = read('land.geojson').features.flatMap((f) =>
      geo
        .rings(f)
        .flat()
        .map((r) => r.map(geo.project)),
    ),
    parks = read('parks.geojson').features.flatMap((f) =>
      geo
        .rings(f)
        .flat()
        .map((r) => r.map(geo.project)),
    );
  let checks = 0;
  for (const r of [...land, ...parks]) {
    for (let i = 0; i < 120; i++) {
      const a = r[Math.floor(geo.hash(i + 42) * r.length)],
        p = [
          a[0] + (geo.hash(i + 6) - 0.5) * 200,
          a[1] + (geo.hash(i + 7) - 0.5) * 200,
        ];
      assert.equal(geo.inside(p, r), naive(p, r));
      checks++;
    }
    for (const p of r.filter((_, i) => i % 19 === 0)) {
      assert.equal(geo.inside(p, r), naive(p, r));
      checks++;
    }
  }
  assert.ok(checks > 8000);
});
test('terrain grid is complete and preserves Stanley Park relief', () => {
  const d = read('terrain.json');
  assert.equal(d.heights.length, d.width * d.height);
  assert.ok(d.heights.every(Number.isFinite));
  assert.ok(Math.max(...d.heights) > 75 && Math.max(...d.heights) < 80);
  assert.ok(Math.min(...d.heights) >= 0);
  assert.deepEqual(d.bounds, [-123.165, 49.267, -123.095, 49.315]);
});
test('reconciled buildings have valid vertical intervals and modern landmark heights', () => {
  const d = read('buildings.geojson');
  assert.equal(d.features.length, 7630);
  for (const f of d.features) {
    assert.ok(f.properties.height > f.properties.minHeight);
    assert.ok(Number.isFinite(f.properties.base));
  }
  assert.ok(d.features.some((f) => f.properties.height === 201));
  assert.ok(d.features.some((f) => f.properties.height === 188));
  const r = read('reconciliation-report.json');
  assert.equal(r.outputFeatures ?? r.outputSolids ?? d.features.length, 7630);
});
test('bridge main spines connect each shoreline in the intended bearing', () => {
  const d = read('bridges.json');
  assert.equal(d.mainSpines.length, 4);
  const burrard = d.mainSpines.find((s) => s.kind === 'burrard');
  assert.ok(burrard.end[0] < -123.143);
  const lions = d.mainSpines.find((s) => s.kind === 'lions');
  assert.ok(lions.end[1] > 49.323);
  assert.ok(d.nodes.length >= 45);
});
test('regional mask includes north mainland and excludes Burrard Inlet', () => {
  const ps = read('context-land.geojson').features.flatMap((f) =>
    geo.rings(f).map((p) => p.map((r) => r.map(geo.project))),
  );
  const on = (c) => ps.some((p) => geo.inPolygon(geo.project(c), p));
  assert.equal(on([-123.08, 49.34]), true);
  assert.equal(on([-123.12, 49.303]), false);
  assert.equal(on([-123.15, 49.25]), true);
});
const bridgeSource = ts
  .transpileModule(
    fs.readFileSync(new URL('../lib/city/bridges.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext } },
  )
  .outputText.replace(/^import .*;\n/gm, '');
const { bridgeSurface } = await import(
  'data:text/javascript;base64,' + Buffer.from(bridgeSource).toString('base64')
);
test('bridge travel crosses water at deck height and preserves underpass separation', () => {
  const d = read('bridges.json');
  for (const s of d.mainSpines) {
    const a = geo.project(s.start),
      b = geo.project(s.end),
      y = s.estimatedDeckM + 1.95,
      e = { data: { bridgeSurfaces: [{ a, b, h0: y, h1: y, width: 20 }] } },
      x = (a[0] + b[0]) / 2,
      z = (a[1] + b[1]) / 2;
    assert.equal(bridgeSurface(e, x, z, y), y);
    assert.equal(bridgeSurface(e, x, z, 2), undefined);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.equal(
      bridgeSurface(
        e,
        x + ((b[1] - a[1]) / length) * 13,
        z - ((b[0] - a[0]) / length) * 13,
        y,
      ),
      undefined,
    );
  }
});
test('approach gradients interpolate continuously instead of dropping at segment ends', () => {
  const e = {
    data: {
      bridgeSurfaces: [
        { a: [0, 0], b: [100, 0], h0: 10, h1: 20, width: 18 },
        { a: [100, 0], b: [200, 0], h0: 20, h1: 30, width: 18 },
      ],
    },
  };
  for (let x = 1, previous = 10; x < 200; x++) {
    const y = bridgeSurface(e, x, 0, previous);
    assert.ok(Math.abs(y - (10 + x * 0.1)) < 1e-7);
    previous = y;
  }
});

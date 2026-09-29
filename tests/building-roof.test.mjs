import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { planPitchedRoof, pitchedRoofTriangles, roofFrame } = await import(
  cityModule('building-roof')
);
const { createProfile, facadeTemplates, windowRows, groundGlazing } =
  await import(cityModule('facade-profile'));
const { architectureWork } = await import(cityModule('architecture-plan'));
const { inPolygon } = await import(cityModule('geo'));
const rectangle = [
  [0, 0],
  [12, 0],
  [12, 8],
  [0, 8],
];
const plan = (polygon = [rectangle], overrides = {}) =>
  planPitchedRoof(
    polygon,
    overrides.height ?? 8,
    overrides.min ?? 0,
    overrides.tag === undefined ? 'Pitched' : overrides.tag,
    overrides.source ?? 'cov-2009',
    overrides.parts ?? 1,
  );

test('pitched tags retain inherited maximum height, footprint and source epoch', () => {
  const original = JSON.stringify(rectangle);
  const roof = plan();
  assert.ok(roof);
  assert.equal(roof.ridgeHeight, 8);
  assert.ok(roof.eaveHeight >= 2.7 && roof.eaveHeight < 8);
  assert.equal(roof.sourceDataset, 'cov-2009');
  assert.equal(roof.sourceEpoch, 2009);
  assert.equal(
    plan([rectangle], { tag: 'gabled', source: 'OpenStreetMap' }).sourceEpoch,
    null,
  );
  const triangles = pitchedRoofTriangles(roof, 11.25);
  assert.equal(triangles.length, 6);
  assert.equal(
    Math.max(...triangles.flatMap((t) => t.vertices.map((v) => v[1]))),
    19.25,
  );
  for (const t of triangles) {
    assert.ok(Math.abs(Math.hypot(...t.normal) - 1) < 1e-9);
    assert.ok(t.normal.every(Number.isFinite));
    if (t.roof) assert.ok(t.normal[1] > 0.5);
    for (const [x, y, z] of t.vertices)
      assert.ok(x >= 0 && x <= 12 && z >= 0 && z <= 8 && y <= 19.25);
  }
  assert.equal(JSON.stringify(rectangle), original);
});

test('uncertain or compound footprints conservatively keep the flat representation', () => {
  for (const tag of ['flat', 'Complex', 'hipped', 'unknown', null])
    assert.equal(plan([rectangle], { tag }), null);
  assert.equal(plan([rectangle], { parts: 2 }), null);
  assert.equal(plan([rectangle], { min: 2 }), null);
  assert.equal(plan([rectangle], { height: 30 }), null);
  assert.equal(
    plan([
      rectangle,
      [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
      ],
    ]),
    null,
  );
  assert.equal(
    plan([
      [
        [0, 0],
        [12, 0],
        [7, 3],
        [0, 8],
      ],
    ]),
    null,
  );
  assert.equal(
    plan([
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
    ]),
    null,
  );
});

test('roof coordinates follow a diagonal footprint and retain phase after reversal', () => {
  const angle = 0.63,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const ring = rectangle.map(([x, z]) => [
    900 + c * x - s * z,
    330 + s * x + c * z,
  ]);
  const a = roofFrame(ring),
    b = roofFrame([...ring].reverse());
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs(a.axis[i] - b.axis[i]) < 1e-8);
    assert.ok(Math.abs(a.origin[i] - b.origin[i]) < 1e-8);
  }
  assert.ok(Math.abs(a.axis[0] - c) < 1e-8);
  assert.ok(Math.abs(a.axis[1] - s) < 1e-8);
  const uv = ring.map(([x, z]) => [
    x * a.axis[0] + z * a.axis[1] - a.origin[0],
    -x * a.axis[1] + z * a.axis[0] - a.origin[1],
  ]);
  assert.ok(
    Math.abs(uv[0][1] - uv[1][1]) < 1e-8,
    'the long eave and roof seams align',
  );
  const roof = plan([ring]);
  for (const t of pitchedRoofTriangles(roof, 0))
    if (t.roof) assert.ok(t.normal[1] > 0);
});

test('sixth domestic family adds human-scale windows without changing commercial or heritage families', () => {
  const p = createProfile({
    key: 'house',
    heightM: 8,
    footprintAreaM2: 96,
    center: [-500, 100],
  });
  assert.equal(facadeTemplates.length, 6);
  assert.equal(p.kind, 'domestic-cladding');
  assert.equal(p.styleIndex, 5);
  assert.equal(p.storeyM, 2.85);
  assert.ok(windowRows(p, { minHeightM: 0, heightM: 6 }).includes(0));
  assert.deepEqual(
    groundGlazing(p, { minHeightM: 0, heightM: 8 }, 0, [1.18, 1.18, 1.18]),
    [0, 0],
  );
  assert.equal(
    createProfile({
      key: 'warehouse',
      heightM: 8,
      footprintAreaM2: 900,
      center: [-500, 100],
    }).kind,
    'lowrise-masonry',
  );
  assert.equal(
    createProfile({
      key: 'heritage',
      heightM: 8,
      footprintAreaM2: 96,
      center: [1000, 200],
    }).kind,
    'heritage-brick',
  );
});

test('domestic eave strips stay inside acute and concave source footprints', () => {
  const polygons = [
    [
      [0, 0],
      [5.2506, 8.3791],
      [0, 11.6997],
    ],
    [
      [0, 0],
      [12, 0],
      [12, 4],
      [5, 4],
      [5, 10],
      [0, 10],
    ],
  ];
  let total = 0;
  for (const ring of polygons) {
    const profile = createProfile({
      key: 'domestic',
      heightM: 8.82,
      footprintAreaM2: 100,
      center: [-500, 100],
    });
    const boxes = [
      ...architectureWork(
        [
          {
            key: 'domestic',
            polygon: [ring],
            ground: 0,
            height: 8.82,
            minHeight: 0,
            profile,
            roof: true,
          },
        ],
        'roof',
      ),
    ].filter(Boolean);
    total += boxes.length;
    for (const box of boxes) {
      const c = Math.cos(box.yaw),
        s = Math.sin(box.yaw);
      for (const u of [-0.5, 0.5])
        for (const v of [-0.5, 0.5])
          assert.ok(
            inPolygon(
              [
                box.x + u * box.width * c + v * box.depth * s,
                box.z - u * box.width * s + v * box.depth * c,
              ],
              [ring],
            ),
          );
    }
  }
  assert.ok(
    total > 0,
    'safe strips still render while escaped corners are skipped',
  );
});

test('pitched and domestic roofs never receive flat HVAC or trim above the inherited envelope', () => {
  const profile = createProfile({
    key: 'house',
    heightM: 8,
    footprintAreaM2: 96,
    center: [-500, 100],
  });
  const roof = plan();
  const part = {
    key: 'house',
    polygon: [rectangle],
    ground: 10,
    height: 8,
    minHeight: 0,
    profile,
    roof: true,
    roofEaveHeight: roof.eaveHeight,
  };
  const boxes = [...architectureWork([part], 'roof')].filter(Boolean);
  assert.ok(boxes.length > 0);
  assert.ok(
    boxes.every(
      (b) => b.kind === 'cornice' && b.y + b.height / 2 <= 10 + roof.eaveHeight,
    ),
  );
  const street = [...architectureWork([part], 'street')].filter(Boolean);
  assert.ok(street.every((b) => b.y + b.height / 2 <= 10 + roof.eaveHeight));
  assert.equal(
    [
      ...architectureWork([{ ...part, roofExclusions: [[rectangle]] }], 'roof'),
    ].filter(Boolean).length,
    0,
    'higher source parts still suppress hidden domestic roof trim',
  );
});

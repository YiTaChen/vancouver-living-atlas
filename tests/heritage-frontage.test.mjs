import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { heritageFrontage, HERITAGE_RELIEF } = await import(
  cityModule('heritage-frontage')
);
const { createProfile } = await import(cityModule('facade-profile'));
const { createStreetfronts } = await import(cityModule('streetfronts'));
const { unproject } = await import(cityModule('geo'));
const profile = createProfile({
  key: 'heritage-fixture',
  heightM: 24,
  footprintAreaM2: 640,
  center: [1016, 110],
});
const extent = { heightM: 24, minHeightM: 0 };
const openings = [4, 12, 20, 28].map((center) => ({ center, threshold: 11.6 }));
const build = (pavement = () => 11.58, list = openings, size = 32) =>
  heritageFrontage(size, 10, profile, extent, list, pavement);

test('heritage relief leaves complete fallback openings and physical upper sills clear', () => {
  const parts = build();
  assert.ok(
    parts.length > 20,
    'course, bases and piers form a continuous frontage',
  );
  const upperPane =
    10 + profile.groundStoreyM + profile.pane[2] * profile.storeyM;
  for (const p of parts) {
    assert.ok(p.width > 0 && p.height > 0 && p.depth > 0);
    assert.ok(p.offset + p.depth / 2 <= HERITAGE_RELIEF.maxProjection + 1e-8);
    assert.ok(p.u - p.width / 2 >= 0 && p.u + p.width / 2 <= 32);
    assert.ok(
      p.y + p.height / 2 < upperPane - 0.17,
      'below existing sill bottom',
    );
    if (!p.kind.startsWith('course'))
      for (const o of openings)
        assert.ok(
          p.u + p.width / 2 <=
            o.center - HERITAGE_RELIEF.openingHalfWidth + 1e-8 ||
            p.u - p.width / 2 >=
              o.center + HERITAGE_RELIEF.openingHalfWidth - 1e-8,
          'no pier or base across a shop/door',
        );
  }
});

test('relief bases follow measured pavement and reject missing or steep spans', () => {
  const slope = (u) => 11.55 + u * 0.004;
  for (const p of build(slope).filter((p) => p.kind === 'plinth')) {
    const left = p.u - p.width / 2,
      right = p.u + p.width / 2;
    assert.ok(Math.abs(p.y - p.height / 2 - (slope(left) - 0.03)) < 1e-8);
    assert.ok(
      p.y + p.height / 2 >= slope(right),
      'bottom embedded and top above pavement',
    );
  }
  const interrupted = build((u) => (u > 7.8 && u < 8.2 ? null : 11.58));
  assert.equal(
    interrupted.filter(
      (p) => !p.kind.startsWith('course') && Math.abs(p.u - 8) < 0.1,
    ).length,
    0,
  );
  const steep = build((u) => 11.58 + (u > 8 ? 0.3 : 0));
  assert.equal(
    steep.filter((p) => !p.kind.startsWith('course') && Math.abs(p.u - 8) < 0.1)
      .length,
    0,
  );
  assert.equal(
    build(() => null).filter((p) => !p.kind.startsWith('course')).length,
    0,
  );
  assert.equal(
    build(() => 9).filter((p) => !p.kind.startsWith('course')).length,
    0,
  );
});

test('frontage plan stays bounded, deterministic and limited to validated heritage ground edges', () => {
  assert.deepEqual(
    build(),
    build(() => 11.58, [...openings].reverse()),
  );
  assert.deepEqual(
    build(() => 11.58, []),
    [],
  );
  assert.deepEqual(
    build(() => 11.58, openings, 76),
    [],
  );
  assert.deepEqual(
    heritageFrontage(
      32,
      10,
      { ...profile, kind: 'midrise-grid' },
      extent,
      openings,
      () => 11.58,
    ),
    [],
  );
  assert.deepEqual(
    heritageFrontage(
      32,
      10,
      profile,
      { ...extent, minHeightM: 3 },
      openings,
      () => 11.58,
    ),
    [],
  );
  assert.ok(
    build(
      () => 11.58,
      Array.from({ length: 9 }, (_, i) => ({
        center: 4 + i * 8,
        threshold: 11.6,
      })),
      75,
    ).length <= HERITAGE_RELIEF.maximumBoxesPerEdge,
  );
});

function canvas() {
  return {
    width: 0,
    height: 0,
    getContext: () =>
      new Proxy(
        {},
        {
          get: (o, k) => o[k] ?? (() => {}),
          set: (o, k, v) => {
            o[k] = v;
            return true;
          },
        },
      ),
  };
}
function fixture() {
  const roads = new THREE.Group();
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 2).rotateX(-Math.PI / 2),
  );
  pavement.position.set(1016, 11.58, 98.95);
  pavement.userData.walkSurface = true;
  roads.add(pavement);
  const feature = {
    properties: { id: 'heritage-fixture', height: 24, minHeight: 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [1000, 100],
          [1032, 100],
          [1032, 120],
          [1000, 120],
          [1000, 100],
        ].map(([x, z]) => unproject(x, z)),
      ],
    },
  };
  return {
    camera: new THREE.PerspectiveCamera(),
    roads,
    landmarks: new THREE.Group(),
    extraTextures: new Set(),
    compatibleGraphics: false,
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
    elevation: () => 10.4,
    waterWorld: { solidAt: () => false },
    data: {
      buildings: { features: [feature] },
      buildingFoundations: new Map([['heritage-fixture', 10]]),
      buildingProfiles: new Map([['heritage-fixture', profile]]),
    },
  };
}

test('opaque finishes share a spatial draw while GLB toggles hide only their own fallback', (t) => {
  t.mock.method(
    THREE.TextureLoader.prototype,
    'load',
    () => new THREE.Texture(),
  );
  const prior = globalThis.document;
  globalThis.document = { createElement: canvas };
  try {
    const host = fixture();
    const kit = createStreetfronts(host);
    const relief = [];
    host.landmarks.traverse((o) => {
      if (o.userData.heritageRelief) relief.push(o);
    });
    assert.equal(
      relief.length,
      1,
      'different stone/paint/sash colors share one cell mesh',
    );
    const mesh = relief[0];
    assert.equal(mesh.instanceColor.count, mesh.count);
    const colors = new Set(
      Array.from({ length: mesh.count }, (_, i) =>
        Array.from(mesh.instanceColor.array.slice(i * 3, i * 3 + 3)).join(','),
      ),
    );
    assert.ok(
      colors.size >= 8,
      'batch consolidation retains distinct finishes',
    );
    const sources = kit.cells.flatMap((cell) => cell.sources);
    assert.equal(sources.length, 4);
    const before = mesh.instanceMatrix.array.slice();
    sources[0].setDetailed(true);
    const owned = new Set(
      sources[0].handles.filter((h) => h.mesh === mesh).map((h) => h.index),
    );
    assert.ok(owned.size > 0);
    for (let i = 0; i < mesh.count; i++) {
      const matrix = Array.from(
        mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16),
      );
      if (owned.has(i)) assert.equal(matrix[0], 0);
      else
        assert.deepEqual(
          matrix,
          Array.from(before.slice(i * 16, i * 16 + 16)),
          'parent relief and neighboring shops remain visible',
        );
    }
    sources[0].setDetailed(false);
    assert.deepEqual(mesh.instanceMatrix.array, before);
    kit.dispose();
  } finally {
    globalThis.document = prior;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createStreetfronts } = await import(cityModule('streetfronts'));
const { createProfile } = await import(cityModule('facade-profile'));
const { unproject } = await import(cityModule('geo'));
function canvas() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return new Proxy(
        {},
        {
          get: (o, k) => o[k] ?? (() => {}),
          set: (o, k, v) => {
            o[k] = v;
            return true;
          },
        },
      );
    },
  };
}
function fixture({
  fullPavement = false,
  height = 11.58,
  solidAt = () => false,
  duplicate = false,
} = {}) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(8, 13, -6);
  const roads = new THREE.Group();
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(fullPavement ? 36 : 4, 2).rotateX(-Math.PI / 2),
  );
  pavement.position.set(fullPavement ? 16 : 8, height, -1.05);
  pavement.userData.walkSurface = true;
  roads.add(pavement);
  const feature = {
    properties: { id: 'modern-fixture', height: 90, minHeight: 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [32, 0],
          [32, 20],
          [0, 20],
          [0, 0],
        ].map(([x, z]) => unproject(x, z)),
      ],
    },
  };
  return {
    camera,
    roads,
    landmarks: new THREE.Group(),
    extraTextures: new Set(),
    compatibleGraphics: false,
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
    elevation: () => 10.4,
    waterWorld: { solidAt },
    data: {
      buildings: { features: duplicate ? [feature, feature] : [feature] },
      buildingFoundations: new Map([['modern-fixture', 10]]),
      buildingProfiles: new Map([
        [
          'modern-fixture',
          createProfile({
            key: 'modern-fixture',
            heightM: 90,
            footprintAreaM2: 2500,
            center: [16, 10],
          }),
        ],
      ]),
    },
  };
}
function placements(host) {
  const kit = createStreetfronts(host);
  const sources = kit.cells
    .flatMap((cell) => cell.sources)
    .map((source) => source.placement);
  kit.dispose();
  return sources;
}
test('off-center modern bay uses actual clear pavement, and a duplicate source edge stays one bay', () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: canvas };
  try {
    const sources = placements(fixture({ duplicate: true }));
    assert.equal(sources.length, 1);
    assert.equal(sources[0].asset, 'modern-lobby-bay');
    assert.ok(
      Math.abs(sources[0].x - 8) < 1e-5,
      'quarter point is on existing pavement',
    );
    assert.ok(
      Math.abs(sources[0].z + 0.015) < 1e-5,
      'placement remains on original wall',
    );
    assert.ok(
      Math.abs(sources[0].y - 11.6) < 1e-5,
      'unscaled asset sits above measured pavement',
    );
    const centered = placements(fixture({ fullPavement: true }));
    assert.equal(centered.length, 1);
    assert.ok(
      Math.abs(centered[0].x - 16) < 1e-5,
      'center remains first choice',
    );
  } finally {
    globalThis.document = prior;
  }
});
test('off-center search cannot bypass upper-window clearance, jamb obstruction, or canopy pavement', () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: canvas };
  try {
    assert.equal(
      placements(fixture({ height: 11.9 })).length,
      0,
      'first upper window remains clear',
    );
    assert.equal(
      placements(fixture({ solidAt: (x, z) => x < 9 && z < 0 })).length,
      0,
      'blocked jamb is rejected',
    );
    const noTip = fixture();
    noTip.roads.children[0].geometry = new THREE.PlaneGeometry(4, 0.6).rotateX(
      -Math.PI / 2,
    );
    noTip.roads.children[0].position.z = -0.55;
    assert.equal(
      placements(noTip).length,
      0,
      'canopy may not project over non-pavement',
    );
  } finally {
    globalThis.document = prior;
  }
});

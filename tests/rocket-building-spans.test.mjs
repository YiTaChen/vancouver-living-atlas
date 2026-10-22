import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { unproject } = await import(cityModule('geo'));
const { createRocket } = await import(cityModule('rocket-state'));
const { RocketEffects } = await import(cityModule('rocket-effects'));

test('compound building parts retain local damage centres and a failed rooftop collapses its actual mesh after an immediate crash', () => {
  const features = [0, 1000].map((offset, i) => ({
    properties: {
      id: `part-${i}`,
      buildingId: 'shared-structure',
      height: 8,
      minHeight: 0,
      roof: 'Flat',
      source: 'cov-2009',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [12, 0],
          [12, 8],
          [0, 8],
          [0, 0],
        ].map(([x, z]) => unproject(x + offset, z)),
      ],
    },
  }));
  const e = {
    data: { buildings: { features }, roadRelief: () => 10.4 },
    elevation: () => 10.4,
    buildings: new THREE.Group(),
    scene: new THREE.Scene(),
    extraTextures: new Set(),
    uniforms: { night: { value: 0 } },
    renderer: { shadowMap: { needsUpdate: false } },
    stats: {},
    compatibleGraphics: true,
    settings: { quality: 'balanced' },
    container: { clientHeight: 800 },
    geometry(positions, normals, colors, uv) {
      const g = new THREE.BufferGeometry();
      for (const [name, values, size] of [
        ['position', positions, 3],
        ['normal', normals, 3],
        ['color', colors, 3],
        ['uv', uv, 2],
      ])
        g.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
      return g;
    },
  };
  e.scene.add(e.buildings);
  const originalLoad = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    createBuildingBodies(e);
    const parts = e.data.rocketBuildingParts;
    assert.equal(parts.length, 2);
    assert.equal(parts[0].key, parts[1].key);
    assert(Math.abs(parts[0].center[0] - 6) < 1e-6);
    assert(Math.abs(parts[1].center[0] - 1006) < 1e-6);
    const pos = e.data.rocketBuildingMesh.geometry.getAttribute('position'),
      original = Array.from(pos.array);
    const s = createRocket('large', 1006, 18.45, 4, {
      kind: 'roof-small',
      groundY: 10,
    });
    s.phase = 'crashed';
    s.buildProgress = 1;
    s.supportCollapsed = true;
    s.supportIntegrity = 0;
    const effects = new RocketEffects(e, s);
    for (let i = 0; i < 20; i++) effects.update(0.1, s);
    effects.beforeRender();
    effects.afterRender();
    assert.equal(effects.damaged, 1);
    assert.deepEqual(
      Array.from(pos.array).slice(0, parts[0].count * 3),
      original.slice(0, parts[0].count * 3),
    );
    assert.notDeepEqual(
      Array.from(pos.array).slice(parts[1].start * 3),
      original.slice(parts[1].start * 3),
    );
    assert(effects.debris > 0);
    effects.dispose();
    assert.deepEqual(Array.from(pos.array), original);
  } finally {
    THREE.TextureLoader.prototype.load = originalLoad;
  }
});

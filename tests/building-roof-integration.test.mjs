import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { unproject } = await import(cityModule('geo'));

test('merged bodies retain flight envelopes and source features while using sixth-family pitched geometry', () => {
  const features = ['Pitched', 'Flat', 'Pitched'].map((roof, index) => ({
    properties: {
      id: `fixture-${index}`,
      buildingId: `fixture-${index}`,
      height: index === 2 ? undefined : 8,
      minHeight: 0,
      roof,
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
        ].map(([x, z]) => unproject(x - 500 + index * 40, z + 100)),
      ],
    },
  }));
  const original = JSON.stringify(features);
  const e = {
    data: { buildings: { features }, roadRelief: () => 10.4 },
    elevation: () => 10.4,
    buildings: new THREE.Group(),
    extraTextures: new Set(),
    uniforms: { night: { value: 0 } },
    renderer: { shadowMap: {} },
    stats: {},
    geometry(positions, normals, colors, uv) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.Float32BufferAttribute(colors, 3),
      );
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return geometry;
    },
  };
  const load = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  try {
    createBuildingBodies(e);
    assert.equal(JSON.stringify(features), original);
    assert.equal(e.data.buildingRoofs.size, 1);
    assert.ok(
      !e.data.buildingRoofs.has('fixture-2'),
      'fallback-height bodies keep flat roofs',
    );
    assert.equal(e.data.buildingRoofs.get('fixture-0').sourceEpoch, 2009);
    assert.ok(
      e.data.flightBuildingVolumes.every((v) => v.minY === 10 && v.maxY === 18),
    );
    const mesh = e.buildings.children.find((m) => m.isMesh);
    assert.equal(
      e.buildings.children.filter((m) => m.isMesh).length,
      1,
      'no additional body draw',
    );
    const g = mesh.geometry,
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv;
    assert.equal(
      p.count / 3,
      34,
      'gable adds only four triangles over flat rectangle',
    );
    for (const attribute of Object.values(g.attributes)) {
      assert.equal(attribute.count, p.count);
      assert.ok([...attribute.array].every(Number.isFinite));
    }
    let slope = 0;
    for (let i = 0; i < p.count; i++) {
      assert.ok(p.getY(i) <= 18.00001 && p.getY(i) >= 9.99999);
      assert.equal(g.attributes.aStyle.getX(i), 5);
      if (uv.getY(i) === -2) {
        assert.ok(n.getY(i) > 0 && n.getY(i) < 1);
        slope++;
      }
    }
    assert.equal(slope, 12);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mesh.material.onBeforeCompile(shader, {});
    assert.equal(shader.uniforms.uPattern.value.length, 6);
    assert.match(shader.fragmentShader, /uPattern\[6\]/);
    assert.match(
      shader.fragmentShader,
      /clamp\(floor\(vFacade.z\+\.5\),0.0,5.0\)/,
    );
    assert.match(
      shader.fragmentShader,
      /dot\(vArchitectureWorld.xz,vLayout.xy\)/,
    );
    e.facadeDetails.dispose();
    g.dispose();
    mesh.material.dispose();
    e.extraTextures.forEach((t) => t.dispose());
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
});

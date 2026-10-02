import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createBuildingBodies } = await import(cityModule('building-bodies'));
const { project, unproject } = await import(cityModule('geo'));
const { FLAT_ROOF_FINISHES, selectFlatRoofFinish } = await import(
  cityModule('building-surface-palette')
);
const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, message);
const linear = (srgb) =>
  srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;

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
  const footprints = features.map((feature) =>
    feature.geometry.coordinates[0].slice(0, -1).map(project),
  );
  const bounds = footprints.map((ring) => ({
    minX: Math.min(...ring.map(([x]) => x)),
    maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)),
    maxZ: Math.max(...ring.map(([, z]) => z)),
  }));
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
    assert.equal(e.data.flightBuildingVolumes.length, features.length);
    e.data.flightBuildingVolumes.forEach((volume, index) => {
      assert.equal(volume.polygon.length, 1);
      assert.equal(volume.polygon[0].length, footprints[index].length);
      for (const [x, z] of footprints[index]) {
        assert.ok(
          volume.polygon[0].some(
            (p) => Math.abs(p[0] - x) < 1e-7 && Math.abs(p[1] - z) < 1e-7,
          ),
          `${features[index].properties.buildingId} retains its source flight footprint`,
        );
      }
    });
    const mesh = e.buildings.children.find((m) => m.isMesh);
    assert.equal(
      e.buildings.children.filter((m) => m.isMesh).length,
      1,
      'no additional body draw',
    );
    const g = mesh.geometry,
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv,
      roofFinish = g.attributes.aRoofFinish;
    assert.ok(roofFinish, 'merged body carries its roof-finish scalar');
    assert.equal(roofFinish.itemSize, 1);
    assert.equal(roofFinish.count, p.count);
    assert.equal(
      p.count / 3,
      34,
      'gable adds only four triangles over flat rectangle',
    );
    for (const attribute of Object.values(g.attributes)) {
      assert.equal(attribute.count, p.count);
      assert.ok([...attribute.array].every(Number.isFinite));
    }
    const finishesByBuilding = features.map(() => new Set());
    const verticesByBuilding = features.map(() => 0);
    let slope = 0;
    for (let i = 0; i < p.count; i++) {
      assert.ok(p.getY(i) <= 18.00001 && p.getY(i) >= 9.99999);
      assert.equal(g.attributes.aStyle.getX(i), 5);
      const sourceIndex = bounds.findIndex(
        (b) =>
          p.getX(i) >= b.minX - 1e-4 &&
          p.getX(i) <= b.maxX + 1e-4 &&
          p.getZ(i) >= b.minZ - 1e-4 &&
          p.getZ(i) <= b.maxZ + 1e-4,
      );
      assert.ok(
        sourceIndex >= 0,
        'body vertex stays within a source footprint',
      );
      const finish = roofFinish.getX(i);
      assert.ok(Number.isInteger(finish));
      assert.ok(finish >= 0 && finish < FLAT_ROOF_FINISHES.length);
      finishesByBuilding[sourceIndex].add(finish);
      verticesByBuilding[sourceIndex]++;
      if (uv.getY(i) === -2) {
        assert.ok(n.getY(i) > 0 && n.getY(i) < 1);
        slope++;
      }
    }
    assert.equal(slope, 12);
    assert.deepEqual(
      verticesByBuilding,
      [42, 30, 30],
      'roof metadata neither expands nor drops the pitched/flat body geometry',
    );
    features.forEach((feature, index) => {
      const key = feature.properties.buildingId,
        profile = e.data.buildingProfiles.get(key);
      assert.ok(profile, `${key} retains its shared source-building profile`);
      assert.deepEqual(
        [...finishesByBuilding[index]],
        [selectFlatRoofFinish(profile.kind, profile.seed)],
        `${key} carries one finish across walls, roof and gables`,
      );
    });
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mesh.material.onBeforeCompile(shader, {});
    assert.match(shader.vertexShader, /attribute float aRoofFinish/);
    assert.match(shader.vertexShader, /vRoofFinish\s*=\s*aRoofFinish/);
    assert.match(shader.fragmentShader, /uniform vec4 uFlatRoofFinish\[3\]/);
    assert.match(
      shader.fragmentShader,
      /roughnessFactor\s*=\s*uFlatRoofFinish\[[^\n]+\]\.w/,
      'flat-roof shading consumes the selected finish roughness',
    );
    const finishUniforms = shader.uniforms.uFlatRoofFinish.value;
    assert.equal(finishUniforms.length, FLAT_ROOF_FINISHES.length);
    FLAT_ROOF_FINISHES.forEach((finish, index) => {
      const tuple = finishUniforms[index];
      assert.ok(tuple.isVector4);
      const expectedRGB = finish.colorSRGB.map(linear);
      [tuple.x, tuple.y, tuple.z].forEach((component, channel) =>
        near(
          component,
          expectedRGB[channel],
          `${finish.id} converts sRGB to linear once`,
        ),
      );
      near(
        tuple.w,
        finish.roughness,
        `${finish.id} retains its authored roughness`,
      );
    });
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

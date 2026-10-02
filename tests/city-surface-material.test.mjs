import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createRoadSurfaces } = await import(cityModule('road-surfaces'));
const { createStreetfronts } = await import(cityModule('streetfronts'));
const { createProfile } = await import(cityModule('facade-profile'));
const { getCityMaterialLibrary } = await import(cityModule('material-library'));
const { unproject } = await import(cityModule('geo'));

function shaderFor(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
}
function geometry(position, normal, color, uv) {
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(position, 3),
  );
  if (normal)
    buffer.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  else buffer.computeVertexNormals();
  if (color)
    buffer.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  if (uv) buffer.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return buffer;
}
function release(host) {
  const geometries = new Set(),
    materials = new Set();
  for (const root of [host.roads, host.landmarks].filter(Boolean))
    root.traverse((o) => {
      if (o.isMesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
  for (const item of [...geometries, ...materials, ...host.extraTextures])
    item.dispose();
}

test('real pavement creation shares one atlas across asphalt, concrete and clipped brick without changing ground height', (t) => {
  const loads = [];
  t.mock.method(THREE.TextureLoader.prototype, 'load', (url) => {
    loads.push(url);
    return new THREE.Texture();
  });
  const road = (name, from, to) => ({
    properties: { name, class: 'Residential', width: 10 },
    geometry: {
      type: 'LineString',
      coordinates: [from, to].map((p) => unproject(...p)),
    },
  });
  const host = {
    roads: new THREE.Group(),
    roadMaterials: new Map(),
    extraTextures: new Set(),
    stats: {},
    elevation: (x, z) => 10 + x * 0.002 + z * 0.003,
    data: {
      trees: { trees: [] },
      roads: {
        features: [
          road('WATER ST', [0, 0], [60, 0]),
          road('OTHER ST', [700, 0], [760, 0]),
        ],
      },
    },
    geometry,
  };
  const source = JSON.stringify(host.data.roads);
  createRoadSurfaces(host);
  assert.equal(JSON.stringify(host.data.roads), source);
  assert.equal(loads.length, 3);
  const library = getCityMaterialLibrary(host);
  assert.equal(loads.length, 3);
  assert.equal(host.extraTextures.size, 3);
  const authored = host.roads.children.filter((m) =>
    m.name.includes('Water Street brick'),
  );
  assert.ok(authored.some((m) => m.name.includes('road')));
  assert.ok(authored.some((m) => m.name.includes('footways')));
  assert.ok(
    host.roads.children.some((m) => m.name.includes('Connected road pavement')),
  );
  assert.ok(
    host.roads.children.some((m) => m.name.includes('Clipped sidewalks')),
  );
  for (const mesh of host.roads.children.filter(
    (m) => m.userData.walkSurface,
  )) {
    const p = mesh.geometry.attributes.position;
    const offset = mesh.userData.asphaltSurface ? 1.05 : 1.18;
    for (let i = 0; i < p.count; i++)
      assert.ok(
        Math.abs(p.getY(i) - host.elevation(p.getX(i), p.getZ(i)) - offset) <
          2e-6,
      );
    const shader = shaderFor(mesh.material);
    assert.equal(shader.uniforms.uCityColor.value, library.color);
    assert.equal(shader.uniforms.uCityNormal.value, library.normal);
    assert.equal(shader.uniforms.uCityORM.value, library.orm);
    assert.equal(mesh.castShadow, false);
    if (mesh.geometry.attributes.aHeritagePaving)
      assert.equal(mesh.geometry.attributes.aHeritagePaving.count, p.count);
    else {
      const uv = mesh.geometry.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        assert.ok(Math.abs(uv.getX(i) * 3 - p.getX(i)) < 1e-4);
        assert.ok(Math.abs(uv.getY(i) * 3 - p.getZ(i)) < 1e-4);
      }
    }
  }
  for (const curb of host.roads.children.filter((m) =>
    m.name.includes('Road-facing curb'),
  )) {
    const p = curb.geometry.attributes.position,
      uv = curb.geometry.attributes.uv;
    for (let i = 0; i < p.count; i += 3) {
      const span = Math.hypot(
        p.getX(i + 1) - p.getX(i),
        p.getZ(i + 1) - p.getZ(i),
      );
      assert.ok(
        Math.abs((uv.getX(i + 1) - uv.getX(i)) * 3 - span) < 1e-4,
        'curb material metres agree with its physical length',
      );
    }
    assert.ok(
      Math.abs(
        Math.max(...Array.from({ length: uv.count }, (_, i) => uv.getY(i))) *
          3 -
          0.13,
      ) < 1e-6,
    );
  }
  release(host);
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
test('different facade cells own their instance size and semantic buffers, preserving only the selected GLB fallback toggle', (t) => {
  t.mock.method(
    THREE.TextureLoader.prototype,
    'load',
    () => new THREE.Texture(),
  );
  const previous = globalThis.document;
  globalThis.document = { createElement: canvas };
  const host = {
    camera: new THREE.PerspectiveCamera(),
    roads: new THREE.Group(),
    landmarks: new THREE.Group(),
    extraTextures: new Set(),
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
    compatibleGraphics: false,
    elevation: () => 10.4,
    waterWorld: { solidAt: () => false },
    data: {
      buildings: { features: [] },
      buildingFoundations: new Map(),
      buildingProfiles: new Map(),
    },
  };
  try {
    for (const [n, x, width] of [
      [0, 1000, 24],
      [1, 1360, 32],
    ]) {
      const id = `relief-cell-${n}`;
      host.data.buildings.features.push({
        properties: { id, height: 24, minHeight: 0 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [x, 100],
              [x + width, 100],
              [x + width, 120],
              [x, 120],
              [x, 100],
            ].map((p) => unproject(...p)),
          ],
        },
      });
      host.data.buildingFoundations.set(id, 10);
      host.data.buildingProfiles.set(
        id,
        createProfile({
          key: id,
          heightM: 24,
          footprintAreaM2: width * 20,
          center: [x + width / 2, 110],
        }),
      );
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width + 4, 2).rotateX(-Math.PI / 2),
      );
      floor.position.set(x + width / 2, 11.58, 98.95);
      floor.userData.walkSurface = true;
      host.roads.add(floor);
    }
    const source = JSON.stringify(host.data.buildings);
    const kit = createStreetfronts(host);
    assert.equal(JSON.stringify(host.data.buildings), source);
    const cells = [];
    host.landmarks.traverse((o) => {
      if (o.userData.heritageRelief) cells.push(o);
    });
    assert.equal(cells.length, 2);
    assert.notEqual(
      cells[0].count,
      cells[1].count,
      'fixtures require unequal allocation sizes',
    );
    assert.equal(cells[0].material, cells[1].material);
    assert.notEqual(cells[0].geometry, cells[1].geometry);
    for (const name of ['aReliefSize', 'aReliefSurface'])
      assert.notEqual(
        cells[0].geometry.attributes[name].array,
        cells[1].geometry.attributes[name].array,
      );
    const matrix = new THREE.Matrix4(),
      scale = new THREE.Vector3(),
      quaternion = new THREE.Quaternion(),
      translation = new THREE.Vector3();
    for (const mesh of cells) {
      const size = mesh.geometry.attributes.aReliefSize,
        semantic = mesh.geometry.attributes.aReliefSurface;
      assert.ok(
        size.isInstancedBufferAttribute && semantic.isInstancedBufferAttribute,
      );
      assert.equal(size.count, mesh.count);
      assert.equal(semantic.count, mesh.count);
      assert.deepEqual(new Set(semantic.array), new Set([-1, 1, 6]));
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        matrix.decompose(translation, quaternion, scale);
        assert.ok(Math.abs(scale.x - size.getX(i)) < 1e-6);
        assert.ok(Math.abs(scale.y - size.getY(i)) < 1e-6);
        assert.ok(Math.abs(scale.z - size.getZ(i)) < 1e-6);
      }
    }
    const before = cells.map((m) => ({
      matrix: m.instanceMatrix.array.slice(),
      size: m.geometry.attributes.aReliefSize.array.slice(),
      surface: m.geometry.attributes.aReliefSurface.array.slice(),
    }));
    const selected = kit.cells
      .flatMap((c) => c.sources)
      .find((s) => s.placement.x < 1200);
    assert.ok(selected);
    const owned = new Set(
      selected.handles.filter((h) => h.mesh === cells[0]).map((h) => h.index),
    );
    assert.ok(owned.size > 0);
    selected.setDetailed(true);
    for (let i = 0; i < cells[0].count; i++) {
      const matrix = cells[0].instanceMatrix.array.slice(i * 16, i * 16 + 16);
      if (owned.has(i)) assert.equal(matrix[0], 0);
      else
        assert.deepEqual(matrix, before[0].matrix.slice(i * 16, i * 16 + 16));
    }
    assert.deepEqual(cells[1].instanceMatrix.array, before[1].matrix);
    cells.forEach((mesh, i) => {
      assert.deepEqual(
        mesh.geometry.attributes.aReliefSize.array,
        before[i].size,
      );
      assert.deepEqual(
        mesh.geometry.attributes.aReliefSurface.array,
        before[i].surface,
      );
    });
    selected.setDetailed(false);
    cells.forEach((mesh, i) =>
      assert.deepEqual(mesh.instanceMatrix.array, before[i].matrix),
    );
    const shader = shaderFor(cells[0].material);
    assert.equal(
      shader.uniforms.uCityColor.value,
      getCityMaterialLibrary(host).color,
    );
    assert.match(shader.vertexShader, /metricPosition=position\*aReliefSize/);
    kit.dispose();
  } finally {
    release(host);
    globalThis.document = previous;
  }
});

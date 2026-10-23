import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';

const {
  createSiwashClosedRockPositions,
  createSiwashMainlandSkirtPositions,
  SIWASH_CLOSED_ROCK_ISLANDS,
  SIWASH_MAINLAND_SHORE_WINDOW,
} = await import(cityModule('siwash-coast'));
const { project, lines, inPolygon } = await import(cityModule('geo'));
const coast = JSON.parse(readFileSync('public/data/beach-coast.json')),
  sourceBytes = JSON.stringify(coast),
  sourceLines = coast.shoreline.features.flatMap((feature) => lines(feature)),
  selected = sourceLines.filter((line) =>
    createSiwashClosedRockPositions(line, cityElevation),
  );

// Exercise the actual Nature constructor and its unchanged fallback. The
// null adapter is the original per-segment ribbon path, so all other source
// shorelines must retain exact geometry bytes and mesh/material identities.
const source = readFileSync('lib/city/environment.ts', 'utf8'),
  start = source.indexOf('  const shorePos:'),
  end = source.indexOf('  // Trails', start);
assert(start >= 0 && end > start);
const code = ts.transpileModule(
  `
  import * as THREE from '${import.meta.resolve('three')}';
  import { lines, project } from '${cityModule('geo')}';
  export function construct(e, createSiwashClosedRockPositions, createSiwashMainlandSkirtPositions) {
    ${source.slice(start, end)}
  }
`,
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { construct } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
function renderShore(
  line,
  adapter,
  skirtAdapter = createSiwashMainlandSkirtPositions,
) {
  const terrain = new THREE.Group(),
    e = {
      terrain,
      elevation: cityElevation,
      data: {
        beachCoast: {
          shoreline: {
            features: [
              {
                type: 'Feature',
                properties: {},
                geometry: {
                  type: Array.isArray(line[0]?.[0])
                    ? 'MultiLineString'
                    : 'LineString',
                  coordinates: line,
                },
              },
            ],
          },
        },
      },
      geometry(positions) {
        const geometry = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        );
        geometry.computeVertexNormals();
        return geometry;
      },
    };
  construct(e, adapter, skirtAdapter);
  return {
    meshes: terrain.children,
    dispose() {
      for (const mesh of terrain.children) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}

test('only the two actual closed Siwash source islands become compact, finite rock volumes within their own footprint', () => {
  assert.equal(selected.length, 2);
  for (const [index, line] of selected.entries()) {
    const points = line.slice(0, -1).map(project),
      polygon = [points],
      positions = createSiwashClosedRockPositions(line, cityElevation),
      expected = SIWASH_CLOSED_ROCK_ISLANDS[index],
      bounds = [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ];
    assert.equal(line.length, expected.vertices);
    assert.equal(positions.length % 9, 0);
    let topArea = 0;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 9) {
      a.fromArray(positions, i);
      b.fromArray(positions, i + 3);
      c.fromArray(positions, i + 6);
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      assert(normal.lengthSq() > 1e-10, 'every triangle has real area');
      const planArea =
        Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
      if (planArea > 1e-8) {
        topArea += planArea;
        assert(normal.y > 0, 'cap faces up');
        assert(
          inPolygon([(a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3], polygon),
        );
      }
    }
    assert(
      Math.abs(topArea - expected.areaM2) < 0.001,
      'triangulation covers the exact source island',
    );
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = positions.slice(i, i + 3);
      assert([x, y, z].every(Number.isFinite));
      assert(
        x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3],
        'no radial strips extend over water',
      );
      assert(y >= 0.1 && y <= 2.351);
      assert(
        points.some((point) => point[0] === x && point[1] === z),
        'side/cap vertices remain on original source vertices',
      );
    }
    assert.equal(positions.length / 9, line.length - 3 + (line.length - 1) * 2);
  }
  assert.equal(JSON.stringify(coast), sourceBytes);
});

test('all actual shoreline lines outside the two islands and local mainland window remain byte-identical through the production Nature constructor', () => {
  let unchanged = 0;
  for (const line of sourceLines) {
    if (selected.includes(line)) continue;
    if (
      line.some(
        (point, i) =>
          i > 0 &&
          createSiwashMainlandSkirtPositions(line[i - 1], point, cityElevation),
      )
    )
      continue;
    const actual = renderShore(line, createSiwashClosedRockPositions),
      original = renderShore(
        line,
        () => null,
        () => null,
      );
    try {
      assert.equal(actual.meshes.length, 2);
      for (let i = 0; i < 2; i++) {
        assert.deepEqual(
          actual.meshes[i].geometry.getAttribute('position').array,
          original.meshes[i].geometry.getAttribute('position').array,
        );
        assert.deepEqual(
          actual.meshes[i].geometry.getAttribute('normal').array,
          original.meshes[i].geometry.getAttribute('normal').array,
        );
        assert.equal(
          actual.meshes[i].material.color.getHex(),
          original.meshes[i].material.color.getHex(),
        );
        assert.deepEqual(
          actual.meshes[i].userData,
          original.meshes[i].userData,
        );
      }
      unchanged++;
    } finally {
      actual.dispose();
      original.dispose();
    }
  }
  assert(unchanged >= sourceLines.length - 4);
  assert.equal(JSON.stringify(coast), sourceBytes);
});

const mainlandSegments = sourceLines
    .filter((line) => !selected.includes(line))
    .flatMap((line) => line.slice(1).map((point, i) => [line[i], point])),
  skirtSegments = mainlandSegments.filter(([a, b]) =>
    createSiwashMainlandSkirtPositions(a, b, cityElevation),
  ),
  outsideSegments = mainlandSegments.filter(
    ([a, b]) => !createSiwashMainlandSkirtPositions(a, b, cityElevation),
  );

test('actual local mainland segments become finite vertical source-edge faces without horizontal fingers or added offshore floors', () => {
  assert(skirtSegments.length > 10);
  for (const segment of skirtSegments) {
    const [a, b] = segment.map(project),
      positions = createSiwashMainlandSkirtPositions(...segment, cityElevation),
      actual = renderShore(segment, createSiwashClosedRockPositions);
    try {
      assert.equal(positions.length, 18, 'two triangles per existing segment');
      const rock = actual.meshes.find(
        (mesh) => mesh.userData.groundShoreKind === 'rock',
      );
      assert.deepEqual(
        rock.geometry.getAttribute('position').array,
        new Float32Array(positions),
      );
      for (let i = 0; i < positions.length; i += 3) {
        const [x, y, z] = positions.slice(i, i + 3);
        assert([x, y, z].every(Number.isFinite));
        assert(
          (x === a[0] && z === a[1]) || (x === b[0] && z === b[1]),
          'every vertex is exactly on the actual source edge',
        );
        assert(
          y === 0.1 ||
            Math.abs(y - (Math.max(0.7, cityElevation(x, z)) + 1.15)) < 1e-9,
        );
      }
      for (let i = 0; i < positions.length; i += 9) {
        const pa = new THREE.Vector3().fromArray(positions, i),
          pb = new THREE.Vector3().fromArray(positions, i + 3),
          pc = new THREE.Vector3().fromArray(positions, i + 6),
          normal = pb.sub(pa).cross(pc.sub(pa));
        assert(normal.lengthSq() > 0.01);
        assert(
          Math.abs(normal.y) < 1e-8,
          'vertical face has no horizontal walkable area',
        );
      }
    } finally {
      actual.dispose();
    }
  }
  const w = SIWASH_MAINLAND_SHORE_WINDOW;
  assert.equal(
    createSiwashMainlandSkirtPositions(
      [w.minLon - 0.00001, w.minLat],
      [w.minLon, w.minLat],
      cityElevation,
    ),
    null,
    'even partly outside segments retain their original renderer',
  );
  assert.equal(JSON.stringify(coast), sourceBytes);
});

test('all actual segments outside the local mainland window preserve exact original render position and normal bytes', () => {
  assert(outsideSegments.length > skirtSegments.length);
  const actual = renderShore(outsideSegments, createSiwashClosedRockPositions),
    original = renderShore(
      outsideSegments,
      () => null,
      () => null,
    );
  try {
    assert.equal(actual.meshes.length, 2);
    for (let i = 0; i < 2; i++) {
      for (const attribute of ['position', 'normal'])
        assert.deepEqual(
          actual.meshes[i].geometry.getAttribute(attribute).array,
          original.meshes[i].geometry.getAttribute(attribute).array,
        );
      assert.deepEqual(actual.meshes[i].userData, original.meshes[i].userData);
    }
  } finally {
    actual.dispose();
    original.dispose();
  }
  assert.equal(JSON.stringify(coast), sourceBytes);
});

test('the actual production island wiring merges compact rock caps into the original two-draw shoreline batches', () => {
  for (const line of selected) {
    const actual = renderShore(line, createSiwashClosedRockPositions);
    try {
      assert.equal(actual.meshes.length, 2);
      const rock = actual.meshes.find(
          (mesh) => mesh.userData.groundShoreKind === 'rock',
        ),
        wall = actual.meshes.find(
          (mesh) => mesh.userData.groundShoreKind === 'seawall',
        );
      assert.equal(wall.geometry.getAttribute('position').count, 0);
      assert.deepEqual(
        rock.geometry.getAttribute('position').array,
        new Float32Array(createSiwashClosedRockPositions(line, cityElevation)),
      );
      assert.equal(rock.material.transparent, false);
      assert.equal(rock.userData.walkSurface, true);
    } finally {
      actual.dispose();
    }
  }
  for (const line of selected) {
    assert.equal(
      createSiwashClosedRockPositions(line.slice(0, -1), cityElevation),
      null,
      'open fragments retain the original renderer',
    );
    const shifted = line.map(([lon, lat]) => [lon + 0.01, lat]);
    assert.equal(
      createSiwashClosedRockPositions(shifted, cityElevation),
      null,
      'no geographic expansion',
    );
  }
});

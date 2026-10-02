import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {
  heritageFrames,
  partitionHeritagePaving,
  frameCoordinate,
  pavingCoverage,
} = await import(cityModule('heritage-paving'));
const { addStreetMeshes } = await import(cityModule('street-meshes'));
const { heritagePavingMaterial } = await import(
  cityModule('heritage-paving-material')
);
const graph = {
  nodes: [
    { point: [0, 0], level: 'ground' },
    { point: [50, 0], level: 'ground' },
    { point: [100, 0], level: 'bridge' },
  ],
  edges: [
    {
      a: 0,
      b: 1,
      length: 50,
      width: 10,
      corridorWidth: 16,
      names: ['WATER ST'],
    },
    {
      a: 1,
      b: 2,
      length: 50,
      width: 12,
      corridorWidth: 16,
      names: ['CORDOVA ST'],
    },
    {
      a: 2,
      b: 1,
      length: 50,
      width: 10,
      corridorWidth: 14,
      names: ['WATER ST'],
    },
  ],
};
test('heritage paving is restricted to named ground-level Water Street envelopes', () => {
  const frames = heritageFrames(graph);
  assert.equal(frames.length, 1);
  assert.deepEqual(frameCoordinate(frames[0], 20, 7), [20, 7]);
  assert.equal(pavingCoverage(20, 7, 50, frames[0].roadHalf), false);
  assert.equal(pavingCoverage(20, 7, 50, frames[0].sidewalkHalf), true);
  assert.equal(pavingCoverage(-1, 0, 50, 8), false);
  assert.equal(pavingCoverage(51, 0, 50, 8), false);
});
test('material partition preserves every existing vertex/UV/height exactly once', () => {
  const positions = [
    0, 2, 0, 10, 3, 0, 10, 3, 6, 100, 4, 100, 112, 5, 100, 112, 5, 112,
  ];
  const uv = [0, 0, 3, 0, 3, 2, 33, 33, 37, 33, 37, 37];
  const { plain, heritage } = partitionHeritagePaving(
    positions,
    uv,
    heritageFrames(graph),
    true,
  );
  assert.deepEqual(heritage.positions, positions.slice(0, 9));
  assert.deepEqual(plain.positions, positions.slice(9));
  assert.deepEqual([...heritage.uv, ...plain.uv], uv);
  assert.equal(heritage.paving.length, 12);
  assert.deepEqual(heritage.paving, [0, 0, 50, 8, 10, 0, 50, 8, 10, 6, 50, 8]);
  assert.deepEqual(
    partitionHeritagePaving(positions, uv, [], true).plain.positions,
    positions,
  );
});
test('road cell batching preserves auxiliary paving coordinates across cell boundaries', () => {
  const e = {
    roads: new THREE.Group(),
    geometry(positions, _color, _normals, uv) {
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3),
      );
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      return g;
    },
  };
  const positions = [
    0, 0, 0, 5, 0, 0, 5, 0, 5, 700, 0, 0, 705, 0, 0, 705, 0, 5,
  ];
  const attributes = Array.from({ length: 24 }, (_, i) => i);
  const material = new THREE.MeshStandardMaterial();
  addStreetMeshes(
    e,
    positions,
    material,
    'fixture',
    Array(12).fill(0),
    true,
    false,
    false,
    false,
    { aHeritagePaving: { array: attributes, itemSize: 4 } },
  );
  assert.equal(e.roads.children.length, 2);
  e.roads.children.forEach((mesh, i) => {
    assert.deepEqual(
      [...mesh.geometry.getAttribute('aHeritagePaving').array],
      attributes.slice(i * 12, i * 12 + 12),
    );
    assert.equal(mesh.userData.walkSurface, true);
    assert.equal(mesh.castShadow, false);
    mesh.geometry.dispose();
  });
  material.dispose();
});
test('paving shader shares authored PBR maps and keeps clipped geometry free of frame-end fading', () => {
  const library = {
    color: new THREE.Texture(),
    normal: new THREE.Texture(),
    orm: new THREE.Texture(),
    ready: { value: 1 },
  };
  const obsoleteMap = new THREE.Texture();
  const base = new THREE.MeshStandardMaterial({
    map: obsoleteMap,
    normalMap: obsoleteMap,
    roughness: 0.94,
  });
  let disposedTextures = 0;
  for (const texture of [library.color, library.normal, library.orm])
    texture.addEventListener('dispose', () => disposedTextures++);
  for (const sidewalk of [false, true]) {
    const material = heritagePavingMaterial(base, sidewalk, library);
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {},
    };
    material.onBeforeCompile(shader, null);
    assert.equal(material.map, null);
    assert.equal(material.normalMap, null);
    assert.equal(shader.uniforms.uCityColor.value, library.color);
    assert.equal(shader.uniforms.uCityNormal.value, library.normal);
    assert.equal(shader.uniforms.uCityORM.value, library.orm);
    assert.equal(shader.uniforms.uCityReady, library.ready);
    assert.match(shader.vertexShader, /vPavingMetres=aHeritagePaving.xy/);
    assert.match(shader.fragmentShader, /citySurface\(5.0,vPavingMetres\)/);
    assert.match(
      shader.fragmentShader,
      /citySurfaceNormal\(pavingSurface,-vViewPosition,normal,.65\)/,
    );
    assert.doesNotMatch(
      shader.fragmentShader,
      /envelope|vHeritagePaving|smoothstep\(vPaving/,
    );
    assert.match(shader.fragmentShader, /#include <lights_fragment_begin>/);
    assert.notEqual(
      material.customProgramCacheKey(),
      base.customProgramCacheKey(),
    );
    material.dispose();
  }
  assert.equal(
    disposedTextures,
    0,
    'temporary pavement materials do not release engine-owned atlas textures',
  );
  base.dispose();
  obsoleteMap.dispose();
  for (const texture of [library.color, library.normal, library.orm])
    texture.dispose();
});

const frame = (a, b, width = 10) => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    origin: a,
    tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
    length,
    roadHalf: width / 2,
    sidewalkHalf: width / 2 + 3,
  };
};
const height = (x, z) => 12 + x * 0.13 - z * 0.08;
const sourceUV = (x, z) => [4 + x * 0.31 + z * 0.07, 8 - x * 0.12 + z * 0.47];
const source = (triangles) => ({
  positions: triangles.flatMap((triangle) =>
    triangle.flatMap(([x, z]) => [x, height(x, z), z]),
  ),
  uv: triangles.flatMap((triangle) =>
    triangle.flatMap(([x, z]) => sourceUV(x, z)),
  ),
});
const triangleList = (surface) =>
  Array.from({ length: surface.positions.length / 9 }, (_, i) =>
    [0, 3, 6].map((j) => [
      surface.positions[i * 9 + j],
      surface.positions[i * 9 + j + 2],
    ]),
  );
const signedArea = ([a, b, c]) =>
  ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
const area = (surface) =>
  triangleList(surface).reduce(
    (sum, triangle) => sum + Math.abs(signedArea(triangle)),
    0,
  );
function pointInTriangle(point, triangle) {
  const distances = triangle.map((a, i) => {
    const b = triangle[(i + 1) % 3];
    return (
      (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
    );
  });
  return (
    distances.every((v) => v >= -1e-8) || distances.every((v) => v <= 1e-8)
  );
}
function positiveOverlap(a, b) {
  for (const polygon of [a, b])
    for (let i = 0; i < 3; i++) {
      const from = polygon[i],
        to = polygon[(i + 1) % 3],
        length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length < 1e-9) continue;
      const nx = -(to[1] - from[1]) / length,
        nz = (to[0] - from[0]) / length,
        aa = a.map(([x, z]) => x * nx + z * nz),
        bb = b.map(([x, z]) => x * nx + z * nz);
      if (
        Math.min(Math.max(...aa), Math.max(...bb)) -
          Math.max(Math.min(...aa), Math.min(...bb)) <=
        1e-8
      )
        return false;
    }
  return true;
}
function verifyPartition(input, frames, result) {
  const output = [
    ...triangleList(result.plain),
    ...triangleList(result.heritage),
  ];
  assert(
    Math.abs(area(input) - area(result.plain) - area(result.heritage)) < 1e-8,
    'clipping conserves the total projected source area',
  );
  for (const surface of [result.plain, result.heritage]) {
    assert.equal(surface.positions.length / 3, surface.uv.length / 2);
    for (let i = 0; i < surface.positions.length; i += 3) {
      const [x, y, z] = surface.positions.slice(i, i + 3),
        expectedUV = sourceUV(x, z);
      assert(
        Math.abs(y - height(x, z)) < 1e-9,
        'new vertices remain on the source draped plane',
      );
      assert(Math.abs(surface.uv[(i / 3) * 2] - expectedUV[0]) < 1e-9);
      assert(Math.abs(surface.uv[(i / 3) * 2 + 1] - expectedUV[1]) < 1e-9);
    }
  }
  for (let i = 0; i < output.length; i++) {
    assert(signedArea(output[i]) > 0, 'triangle winding remains unchanged');
    for (let j = 0; j < i; j++)
      assert(
        !positiveOverlap(output[i], output[j]),
        'plain and heritage triangle interiors never overlap',
      );
  }
  assert.equal(
    result.heritage.paving.length,
    (result.heritage.positions.length / 3) * 4,
  );
  for (let i = 0; i < result.heritage.paving.length; i += 4) {
    const [u, v, length, half] = result.heritage.paving.slice(i, i + 4);
    assert(
      u >= -1e-8 && u <= length + 1e-8 && Math.abs(v) <= half + 1e-8,
      'every emitted heritage vertex lies in its own material frame',
    );
  }
  for (const triangle of triangleList(result.heritage)) {
    const center = triangle.reduce(
      (sum, p) => [sum[0] + p[0] / 3, sum[1] + p[1] / 3],
      [0, 0],
    );
    assert(
      frames.some((f) =>
        pavingCoverage(...frameCoordinate(f, ...center), f.length, f.roadHalf),
      ),
    );
  }
  return output;
}

test('a draped triangle crossing adjacent Water frames stays entirely brick at x48 and x52', () => {
  const frames = [frame([0, 0], [50, 0]), frame([50, 0], [100, 0])];
  const input = source([
    [
      [48, -4],
      [54, -4],
      [48, 4],
    ],
  ]);
  const result = partitionHeritagePaving(
    input.positions,
    input.uv,
    frames,
    false,
  );
  verifyPartition(input, frames, result);
  assert.equal(result.plain.positions.length, 0);
  assert.equal(area(result.heritage), 24);
  for (const point of [
    [48.1, 0],
    [49.99, -2],
    [50.01, -2],
    [52, -3],
  ])
    assert(
      triangleList(result.heritage).some((triangle) =>
        pointInTriangle(point, triangle),
      ),
    );
});

test('overlapping rectangles are a union with no duplicated geometry, including reverse frame order', () => {
  const frames = [
    frame([0, 0], [12, 0]),
    frame([8, 0], [20, 0]),
    frame([0, 0], [12, 0]),
  ];
  const input = source([
    [
      [-2, -7],
      [22, -7],
      [22, 7],
    ],
    [
      [-2, -7],
      [22, 7],
      [-2, 7],
    ],
  ]);
  for (const order of [frames, [...frames].reverse()]) {
    const result = partitionHeritagePaving(
      input.positions,
      input.uv,
      order,
      false,
    );
    verifyPartition(input, order, result);
    assert(Math.abs(area(result.heritage) - 200) < 1e-8);
    assert(Math.abs(area(result.plain) - 136) < 1e-8);
  }
});

test('bent corridor union covers both arms and shared corner once while keeping exterior corners plain', () => {
  const frames = [frame([0, 0], [10, 0], 4), frame([10, 0], [10, 10], 4)];
  const input = source([
    [
      [-3, -3],
      [13, -3],
      [13, 13],
    ],
    [
      [-3, -3],
      [13, 13],
      [-3, 13],
    ],
  ]);
  const result = partitionHeritagePaving(
    input.positions,
    input.uv,
    frames,
    false,
  );
  verifyPartition(input, frames, result);
  assert(
    Math.abs(area(result.heritage) - 76) < 1e-8,
    'two 40 m² arms less their 4 m² overlap',
  );
  for (const point of [
    [4, 0],
    [9, 1],
    [10, 8],
  ])
    assert(
      triangleList(result.heritage).some((triangle) =>
        pointInTriangle(point, triangle),
      ),
    );
  for (const point of [
    [2, 4],
    [11, -1],
    [11, 11],
  ]) {
    assert(
      triangleList(result.plain).some((triangle) =>
        pointInTriangle(point, triangle),
      ),
    );
    assert(
      !triangleList(result.heritage).some((triangle) =>
        pointInTriangle(point, triangle),
      ),
    );
  }
});

test('rotated corridor clipping preserves heights and UVs and leaves distant geometry untouched', () => {
  const frames = [frame([2, 3], [12, 13], 4), frame([12, 13], [20, 11], 5)];
  const input = source([
    [
      [-5, -5],
      [25, -5],
      [25, 20],
    ],
    [
      [-5, -5],
      [25, 20],
      [-5, 20],
    ],
  ]);
  const distant = source([
    [
      [1000, 1000],
      [1010, 1000],
      [1010, 1010],
    ],
  ]);
  const combined = {
    positions: [...input.positions, ...distant.positions],
    uv: [...input.uv, ...distant.uv],
  };
  const result = partitionHeritagePaving(
    combined.positions,
    combined.uv,
    frames,
    false,
  );
  verifyPartition(combined, frames, result);
  assert.deepEqual(result.plain.positions.slice(-9), distant.positions);
  assert.deepEqual(result.plain.uv.slice(-6), distant.uv);
  const expectedArea = Math.hypot(10, 10) * 4 + Math.hypot(8, -2) * 5;
  assert(
    area(result.heritage) > expectedArea - 25 &&
      area(result.heritage) < expectedArea,
    'rotated rectangles overlap at the bend and are not double counted',
  );
});

test('touching a frame along an edge does not subdivide or recolor a wholly outside triangle', () => {
  const frames = [frame([0, 0], [10, 0], 4)];
  for (const triangle of [
    [
      [0, 2],
      [10, 2],
      [5, 8],
    ],
    [
      [10, -2],
      [15, -2],
      [10, 2],
    ],
  ]) {
    const input = source([triangle]);
    const result = partitionHeritagePaving(
      input.positions,
      input.uv,
      frames,
      false,
    );
    assert.deepEqual(result.plain.positions, input.positions);
    assert.deepEqual(result.plain.uv, input.uv);
    assert.equal(result.heritage.positions.length, 0);
  }
});

test('draped clockwise triangles preserve their winding through diagonal partial clipping', () => {
  const frames = [frame([0, 0], [10, 10], 3)];
  const input = source([
    [
      [-2, -2],
      [-2, 12],
      [12, 12],
    ],
  ]);
  const result = partitionHeritagePaving(
    input.positions,
    input.uv,
    frames,
    false,
  );
  const output = [
    ...triangleList(result.plain),
    ...triangleList(result.heritage),
  ];
  assert(output.length > 1);
  assert(output.every((triangle) => signedArea(triangle) < 0));
  assert(
    Math.abs(area(input) - area(result.plain) - area(result.heritage)) < 1e-8,
  );
});

test('deterministic samples through a multi-bend union match exact corridor membership', () => {
  const frames = [
    frame([0, 0], [9, 4], 5),
    frame([9, 4], [18, -2], 4),
    frame([18, -2], [26, 5], 6),
    frame([5, 5], [20, 5], 4),
  ];
  const input = source([
    [
      [-4, -8],
      [30, -8],
      [30, 12],
    ],
    [
      [-4, -8],
      [30, 12],
      [-4, 12],
    ],
  ]);
  const result = partitionHeritagePaving(
    input.positions,
    input.uv,
    frames,
    false,
  );
  verifyPartition(input, frames, result);
  let seed = 271828;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const heritage = triangleList(result.heritage),
    plain = triangleList(result.plain);
  for (let i = 0; i < 400; i++) {
    const point = [-4 + random() * 34, -8 + random() * 20];
    const covered = frames.some((f) =>
      pavingCoverage(...frameCoordinate(f, ...point), f.length, f.roadHalf),
    );
    assert.equal(
      heritage.some((triangle) => pointInTriangle(point, triangle)),
      covered,
    );
    assert.equal(
      plain.some((triangle) => pointInTriangle(point, triangle)),
      !covered,
    );
  }
});

test('numbered Water Street source blocks share the paving treatment without substring false positives', () => {
  const names = [
    'WATER ST',
    '200-300 WATER ST',
    '200 WATER ST',
    ' 200 – 300  water st ',
    'EDGEWATER ST',
    '200-300 WATER ST EXTENSION',
    'WATER STATION',
    'WATER ST BRIDGE',
  ];
  const edges = names.map((name, id) => ({
    ...graph.edges[0],
    id,
    names: [name],
  }));
  assert.equal(heritageFrames({ ...graph, edges }).length, 4);
});

test('the unchanged Gastown matched-camera spawn is covered by its actual numbered Water Street frame', async () => {
  const { readFileSync } = await import('node:fs');
  const { cityRoadGraph } = await import(cityModule('street-layout'));
  const roads = JSON.parse(
    readFileSync(
      new URL('../public/data/roads.geojson', import.meta.url),
      'utf8',
    ),
  );
  const trees = JSON.parse(
    readFileSync(new URL('../public/data/trees.json', import.meta.url), 'utf8'),
  );
  const frames = heritageFrames(cityRoadGraph(roads, trees.trees));
  const spawn = [1366.7869627374403, 178.97473000017513];
  const matching = frames.filter((f) =>
    pavingCoverage(...frameCoordinate(f, ...spawn), f.length, f.roadHalf),
  );
  assert.equal(
    matching.length,
    1,
    'the existing QA camera lies on the 200–300 block',
  );
  assert(Math.abs(matching[0].roadHalf - 4.2) < 1e-8);
  const start = [1704.4201986244195, 273.28826168075756];
  const end = [1415.0585986383298, 192.48575031961587];
  for (let i = 0; i <= 300; i++) {
    const x = start[0] + ((end[0] - start[0]) * i) / 300;
    const z = start[1] + ((end[1] - start[1]) * i) / 300;
    assert(
      frames.some((f) =>
        pavingCoverage(...frameCoordinate(f, x, z), f.length, f.roadHalf),
      ),
      'existing Water endurance route remains within the brick corridor union',
    );
  }
});

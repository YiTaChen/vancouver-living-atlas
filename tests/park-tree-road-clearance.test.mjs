import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { cityModule } from './helpers/city-modules.mjs';

const {
  clearParkAsphaltTrees,
  roadTreeTrunkHalfExtent,
  PARK_TREE_ROAD_LIMITS,
} = await import(cityModule('park-tree-road-clearance'));
const scope = [
  [
    [
      [-100, -100],
      [100, -100],
      [100, 100],
      [-100, 100],
    ],
  ],
];
const candidate = (x, z, seed = -1, h = 10) => ({
  x,
  z,
  seed,
  h,
  conifer: true,
});
const surface = (positions, extra = {}) => ({
  positions,
  asphaltSurface: true,
  ...extra,
});
function rectangle(x0, z0, x1, z1, extra = {}) {
  return surface(
    [x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1],
    extra,
  );
}
const environmentSource = readFileSync(
  new URL('../lib/city/environment.ts', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'environment.ts',
  environmentSource,
  ts.ScriptTarget.Latest,
  true,
);
const adapterSource = ast.statements
  .find(
    (n) =>
      ts.isFunctionDeclaration(n) && n.name?.text === 'reconcileParkRoadTrees',
  )
  .getText(ast);
const adapterCode = ts.transpileModule(adapterSource.replace('export ', ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const reconcileParkRoadTrees = runInNewContext(
  `${adapterCode};reconcileParkRoadTrees;`,
  { THREE, clearParkAsphaltTrees },
);

test('ordinary asphalt excludes municipal and procedural trunks while retaining near-road overhanging crowns and exact source identities', () => {
  const rawMunicipal = Object.freeze([
    Object.freeze([-123.14, 49.3, 10, '', 'THUJA']),
  ]);
  const trees = [
    candidate(0, 5, 0),
    candidate(2.9, 6),
    candidate(3.49, 7),
    candidate(3.51, 8),
    candidate(5, 9, -3, 30),
  ];
  const before = structuredClone(trees);
  const { retained, excluded, stats } = clearParkAsphaltTrees(
    trees,
    [rectangle(-3, 0, 3, 20)],
    scope,
    rawMunicipal.length,
  );
  assert.deepEqual(retained, [trees[3], trees[4]]);
  assert.strictEqual(retained[0], trees[3]);
  assert.deepEqual(
    trees,
    before,
    'input candidates and their coordinates remain untouched',
  );
  assert.deepEqual(
    rawMunicipal,
    [[-123.14, 49.3, 10, '', 'THUJA']],
    'surveyed public data stays untouched',
  );
  assert.equal(excluded[0].source, 'municipal');
  assert.equal(excluded[0].sourceIndex, 0);
  assert.equal(excluded[1].source, 'generated');
  assert.equal(excluded[1].sourceIndex, null);
  assert.equal(stats.municipalExcluded, 1);
  assert.equal(stats.generatedExcluded, 2);
  assert.equal(stats.complete, true);
  assert.equal(roadTreeTrunkHalfExtent(10), 0.5);
});

test('actual asphalt holes, diagonal edges and finite endpoints do not become enclosing road rectangles', () => {
  const island = candidate(0, 10),
    endpoint = candidate(0, 20.6),
    nearEnd = candidate(0, 20.49),
    side = candidate(-5, 10);
  const roads = [
    rectangle(-6, 0, -3, 20),
    rectangle(3, 0, 6, 20),
    rectangle(-3, 0, 3, 3),
    rectangle(-3, 17, 3, 20),
  ];
  const result = clearParkAsphaltTrees(
    [island, endpoint, nearEnd, side],
    roads,
    scope,
  );
  assert.deepEqual(result.retained, [island, endpoint]);
  const diagonal = surface([0, 0, 0, 10, 0, 0, 0, 0, 10]);
  assert.equal(
    clearParkAsphaltTrees([candidate(8, 8)], [diagonal], scope).excluded.length,
    0,
  );
  assert.equal(
    clearParkAsphaltTrees([candidate(5.1, 5.1)], [diagonal], scope).excluded
      .length,
    1,
  );
});

test('protected bridges, pedestrian paths, outside-park trees and park polygon holes remain unchanged', () => {
  const trees = [
    candidate(0, 0),
    candidate(20, 0),
    candidate(110, 0),
    candidate(40, 0),
  ];
  const roads = [
    rectangle(-3, -3, 3, 3, { protectedSurface: true }),
    rectangle(17, -3, 23, 3, { asphaltSurface: false }),
    rectangle(107, -3, 113, 3),
    rectangle(37, -3, 43, 3),
  ];
  const parkWithHole = [
    [
      scope[0][0],
      [
        [35, -5],
        [45, -5],
        [45, 5],
        [35, 5],
      ],
    ],
  ];
  const result = clearParkAsphaltTrees(trees, roads, parkWithHole);
  assert.deepEqual(result.retained, trees);
  assert.equal(
    result.stats.triangles,
    2,
    'only ordinary asphalt inside scope bounds is indexed',
  );
});

test('indexed draw ranges, world transforms and interleaved position attributes select exactly the rendered footprint', () => {
  const positions = new Float32Array([
    99, 0, 0, 0, 99, 10, 0, 0, 99, 0, 0, 10, 99, 30, 0, 0, 99, 40, 0, 0, 99, 30,
    0, 10,
  ]);
  const matrix = new THREE.Matrix4().makeTranslation(20, 5, 20).elements;
  const indexed = surface(positions, {
    stride: 4,
    offset: 1,
    vertexCount: 6,
    indices: new Uint16Array([0, 1, 2, 3, 4, 5]),
    start: 3,
    count: 3,
    matrix,
  });
  const excluded = candidate(52, 22),
    notDrawn = candidate(22, 22);
  assert.deepEqual(
    clearParkAsphaltTrees([excluded, notDrawn], [indexed], scope).retained,
    [notDrawn],
  );
});

test('environment adapter filters before both LODs/colliders, preserves raw survey data and retained XY, and records stable municipal source indices', () => {
  const roads = new THREE.Group(),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.InterleavedBufferAttribute(
      new THREE.InterleavedBuffer(
        new Float32Array([1, -3, 0, 0, 1, 3, 0, 0, 1, 3, 0, 20, 1, -3, 0, 20]),
        4,
      ),
      3,
      1,
    ),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.x = 10;
  mesh.userData.asphaltSurface = true;
  roads.add(mesh);
  const raw = Object.freeze([Object.freeze([-123.14, 49.3, 10])]),
    retained = candidate(15, 8, 0),
    trees = [candidate(10, 5, 0), candidate(11, 8), retained],
    originalArray = trees;
  const e = {
    roads,
    parkPolys: [{ name: 'Stanley Park', poly: scope[0] }],
    data: { trees: { trees: raw } },
  };
  const report = reconcileParkRoadTrees(e, trees);
  assert.strictEqual(trees, originalArray);
  assert.deepEqual(trees, [retained]);
  assert.strictEqual(trees[0], retained);
  assert.deepEqual([retained.x, retained.z], [15, 8]);
  assert.strictEqual(e.data.trees.trees, raw);
  assert.equal(report.excludedTrees[0].sourceIndex, 0);
  assert.equal(report.excluded, 2);
  const call = environmentSource.indexOf('  reconcileParkRoadTrees(e, trees);');
  assert.ok(call > environmentSource.indexOf('  const conifer ='));
  assert.ok(call < environmentSource.indexOf('  const cells = new Map'));
  assert.ok(call < environmentSource.indexOf('registerTree(t,'));
  assert.ok(call < environmentSource.indexOf('new DetailedTrees(e, trees)'));
  geometry.dispose();
  mesh.material.dispose();
});

test('construction is bounded and an incomplete pathological footprint fails closed without hiding trees', () => {
  const hugeScope = [
    [
      [
        [-1e6, -1e6],
        [1e6, -1e6],
        [1e6, 1e6],
        [-1e6, 1e6],
      ],
    ],
  ];
  const tree = candidate(0, 0),
    result = clearParkAsphaltTrees(
      [tree],
      [rectangle(-1e6, -1e6, 1e6, 1e6)],
      hugeScope,
    );
  assert.equal(result.stats.complete, false);
  assert.deepEqual(result.retained, [tree]);
  assert.ok(
    result.stats.cellReferences <= PARK_TREE_ROAD_LIMITS.cellReferences,
  );
  assert.ok(result.stats.triangles <= PARK_TREE_ROAD_LIMITS.triangles);
  const manyRoads = Array.from({ length: 1000 }, (_, i) =>
    rectangle(i * 64, 0, i * 64 + 6, 20),
  );
  const bigScope = [
    [
      [
        [-100, -100],
        [65000, -100],
        [65000, 100],
        [-100, 100],
      ],
    ],
  ];
  const local = clearParkAsphaltTrees([candidate(2, 8)], manyRoads, bigScope);
  assert.equal(local.excluded.length, 1);
  assert.ok(
    local.stats.testedTriangles < 10,
    'query touches local cells rather than scanning 2000 triangles',
  );
});

test('frozen actual Stanley asphalt removes the two native generated blockers and conflicting surveyed trunks at unchanged source XY', async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/stanley-tree-road-clearance.json', import.meta.url),
      'utf8',
    ),
  );
  const { project } = await import(cityModule('geo'));
  assert.equal(fixture.cases.length, 4);
  const preserved = JSON.stringify(fixture);
  for (const item of fixture.cases) {
    const { x, z } = item.tree;
    const localScope = [
      [
        [
          [x - 100, z - 100],
          [x + 100, z - 100],
          [x + 100, z + 100],
          [x - 100, z + 100],
        ],
      ],
    ];
    const result = clearParkAsphaltTrees(
      [item.tree],
      [surface(item.triangles)],
      localScope,
      fixture.municipalSourceCount,
    );
    assert.equal(
      result.excluded.length,
      1,
      `actual ${item.source} seed ${item.tree.seed} intersects rendered asphalt`,
    );
    assert.equal(result.excluded[0].source, item.source);
    assert.equal(result.excluded[0].sourceIndex, item.sourceIndex);
    if (item.raw)
      assert.deepEqual(
        project(item.raw),
        [x, z],
        'municipal raw survey and renderer coordinates agree exactly',
      );
    assert.deepEqual(
      clearParkAsphaltTrees(
        [item.tree],
        [surface(item.triangles, { protectedSurface: true })],
        localScope,
      ).retained,
      [item.tree],
    );
  }
  assert.equal(
    JSON.stringify(fixture),
    preserved,
    'frozen source coordinates, raw survey and asphalt data are immutable inputs',
  );
});

test('only explicitly tagged Prospect asphalt checks the trunk height and preserves genuinely clear below-deck trees', () => {
  const deck = rectangle(-3, 0, 3, 20, {
    protectedSurface: true,
    parkTreeClearance: true,
    matrix: new THREE.Matrix4().makeTranslation(0, 20, 0).elements,
  });
  const below = candidate(0, 5, 0, 10),
    tall = candidate(0, 6, 1, 21),
    above = candidate(0, 7, 2, 5),
    roof = candidate(0, 8, 3, 5),
    distant = candidate(30, 5, 4, 30);
  let heightQueries = 0;
  const base = (_x, z) => {
    heightQueries++;
    return z === 7 ? 22 : z === 8 ? 21.59 : 0;
  };
  const result = clearParkAsphaltTrees(
    [below, tall, above, roof, distant],
    [deck],
    scope,
    5,
    base,
  );
  assert.deepEqual(result.retained, [below, above, distant]);
  assert.equal(result.stats.prospectExcluded, 2);
  assert.equal(result.stats.heightAwareTriangles, 2);
  assert.equal(
    heightQueries,
    4,
    'ground elevation is queried lazily only for actual tagged XY overlaps',
  );
  for (const tree of result.excluded) {
    assert.equal(tree.reason, 'stanley-prospect-asphalt-trunk-overlap');
    assert.deepEqual(tree.roadHeightRange, [20, 20]);
  }
  assert.equal(
    clearParkAsphaltTrees(
      [tall],
      [{ ...deck, parkTreeClearance: false }],
      scope,
      5,
      () => 0,
    ).excluded.length,
    0,
    'existing Causeway/Lions protected decks are excluded',
  );
  assert.deepEqual(
    clearParkAsphaltTrees([tall], [deck], scope, 5).retained,
    [tall],
    'unknown ground elevation cannot hide a potentially clear below-deck tree',
  );
});

test('a sloping tagged deck is height-clipped at the trunk XY rather than using an entire triangle height bound', () => {
  const sloping = surface([0, 0, 0, 10, 100, 0, 10, 100, 10], {
    protectedSurface: true,
    parkTreeClearance: true,
  });
  const clear = candidate(9, 1, 0, 5),
    tall = candidate(9, 2, 1, 14),
    outside = candidate(1, 9, 2, 30);
  const result = clearParkAsphaltTrees(
    [clear, tall, outside],
    [sloping],
    scope,
    3,
    (_x, z) => (z === 2 ? 85 : 0),
  );
  assert.deepEqual(result.retained, [clear, outside]);
  assert.ok(result.excluded[0].roadHeightRange[0] > 80);
  assert.ok(result.excluded[0].roadHeightRange[1] < 100);
  assert.equal(result.excluded[0].groundY, 85);
});

test('environment adapter includes the explicit Prospect tag and uses the same ground elevation as retained tree visuals', () => {
  const roads = new THREE.Group(),
    positions = rectangle(-3, 0, 3, 20).positions;
  const geometry = new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const deck = new THREE.Mesh(geometry);
  deck.position.y = 20;
  deck.userData = {
    asphaltSurface: true,
    protectedSurface: true,
    parkTreeClearance: true,
  };
  roads.add(deck);
  const below = candidate(0, 5, 0, 10),
    tall = candidate(0, 8, 1, 21),
    trees = [below, tall];
  const raw = [
      [-123.14, 49.3, 10],
      [-123.14, 49.3, 21],
    ],
    snapshot = JSON.stringify(raw);
  const e = {
    roads,
    parkPolys: [{ name: 'Stanley Park', poly: scope[0] }],
    data: { trees: { trees: raw } },
    elevation: () => 0,
  };
  const report = reconcileParkRoadTrees(e, trees);
  assert.deepEqual(trees, [below]);
  assert.strictEqual(trees[0], below);
  assert.equal(report.prospectExcluded, 1);
  assert.equal(report.excludedTrees[0].sourceIndex, 1);
  assert.equal(JSON.stringify(raw), snapshot);
  geometry.dispose();
  deck.material.dispose();
});

test('actual corrected Prospect bridge geometry keeps a clear 5m under-deck tree and excludes a tall future municipal trunk', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        './fixtures/stanley-prospect-tree-clearance.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const { x, z } = fixture.short,
    localScope = [
      [
        [
          [x - 20, z - 20],
          [x + 20, z - 20],
          [x + 20, z + 20],
          [x - 20, z + 20],
        ],
      ],
    ];
  const tagged = surface(fixture.triangle, {
    protectedSurface: true,
    parkTreeClearance: true,
  });
  const result = clearParkAsphaltTrees(
    [fixture.short, fixture.tall],
    [tagged],
    localScope,
    fixture.municipalSourceCount,
    () => fixture.baseY,
  );
  assert.deepEqual(result.retained, [fixture.short]);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].sourceIndex, fixture.tall.seed);
  assert.equal(
    result.excluded[0].reason,
    'stanley-prospect-asphalt-trunk-overlap',
  );
  assert.ok(
    result.excluded[0].roadHeightRange[0] > 70,
    'actual corrected primary-source bridge is above its unchanged Causeway',
  );
});

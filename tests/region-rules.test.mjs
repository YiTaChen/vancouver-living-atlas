import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  data,
  fingerprints,
  prepareParts,
  streetfrontCandidates,
  sorted,
  inventory,
  summarizeStructures,
  createProfile,
  cityRoadGraph,
  heritageFrames,
  CITY_REGION_RULES,
  CITY_REGION_SELECTORS,
  createRegionSelectors,
  legacyFacade,
  legacyFrontHeight,
  legacyFrontRegion,
  legacyPaving,
} from './helpers/region-rule-audit.mjs';
const baseline = JSON.parse(
  readFileSync(
    new URL('./fixtures/region-rule-baseline.json', import.meta.url),
    'utf8',
  ),
);
const legacy = {
  heritageFacade: legacyFacade,
  heritageStreetfrontHeight: legacyFrontHeight,
  heritageStreetfrontRegion: legacyFrontRegion,
};
function shuffled(values) {
  const result = [...values];
  let seed = 2707;
  for (let i = result.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const framesByGeometry = (frames, digits) =>
  frames
    .map((f) => {
      const points = [
        f.origin,
        [
          f.origin[0] + f.tangent[0] * f.length,
          f.origin[1] + f.tangent[1] * f.length,
        ],
      ]
        .map((p) =>
          p.map((v) => (digits === undefined ? v : +v.toFixed(digits))),
        )
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return JSON.stringify({
        points,
        roadHalf: f.roadHalf,
        sidewalkHalf: f.sidewalkHalf,
      });
    })
    .sort();

test('source fingerprints, stable identities and exact legacy match counts are pinned', () => {
  assert.deepEqual(fingerprints, baseline.fingerprints);
  assert.deepEqual(inventory(), baseline);
});

test('every source structure and candidate polygon retains its legacy selection without source mutation', () => {
  const before = JSON.stringify(data),
    parts = prepareParts(data.buildings.features),
    structures = summarizeStructures(parts);
  for (const structure of structures.values()) {
    assert.equal(
      CITY_REGION_SELECTORS.heritageFacade(structure),
      legacyFacade(structure),
      structure.key,
    );
    assert.equal(
      createProfile(structure).kind === 'heritage-brick',
      legacyFacade(structure),
      structure.key,
    );
  }
  const selected = streetfrontCandidates(data.buildings.features, structures);
  assert.deepEqual(
    selected,
    streetfrontCandidates(data.buildings.features, structures, legacy),
  );
  assert.deepEqual(
    sorted(
      [...structures.values()]
        .filter(CITY_REGION_SELECTORS.heritageFacade)
        .map((s) => s.key),
    ),
    baseline.facade.structureIds,
  );
  assert.deepEqual(
    selected.map((s) => s.partId),
    baseline.streetfront.partIds,
  );
  assert.equal(
    JSON.stringify(data),
    before,
    'rules must never rewrite source geometry/heights/collision inputs',
  );
});

test('shuffled building features and multipart inputs preserve complete profiles and selected source IDs', () => {
  const original = summarizeStructures(prepareParts(data.buildings.features)),
    reordered = summarizeStructures(
      shuffled(prepareParts(shuffled(data.buildings.features))),
    );
  const profiles = (structures) =>
    [...structures.values()]
      .map((s) => [s.key, createProfile(s)])
      .sort(([a], [b]) => a.localeCompare(b));
  assert.deepEqual(profiles(reordered), profiles(original));
  assert.deepEqual(
    streetfrontCandidates(shuffled(data.buildings.features), reordered),
    streetfrontCandidates(data.buildings.features, original),
  );
});

test('all four neighboring boundaries and facade/storefront height gates retain their distinct semantics', () => {
  const points = [
    [700, 200],
    [1850, 200],
    [1000, -70],
    [1000, 540],
    [700, -70],
    [1850, 540],
  ];
  for (const center of points) {
    assert.equal(
      CITY_REGION_SELECTORS.heritageFacade({
        key: 'edge',
        center,
        heightM: 24,
      }),
      false,
    );
    assert.equal(
      CITY_REGION_SELECTORS.heritageStreetfrontRegion(center, 'edge'),
      true,
    );
  }
  for (const center of [
    [699.999, 200],
    [1850.001, 200],
    [1000, -70.001],
    [1000, 540.001],
    [0, 0],
    [2300, 800],
  ]) {
    assert.equal(
      CITY_REGION_SELECTORS.heritageFacade({
        key: 'neighbor',
        center,
        heightM: 24,
      }),
      false,
    );
    assert.equal(
      CITY_REGION_SELECTORS.heritageStreetfrontRegion(center, 'neighbor'),
      false,
    );
  }
  for (const heightM of [6.999, 7, 34, 34.001, 47.999, 48]) {
    const structure = { key: 'interior', center: [1000, 200], heightM };
    assert.equal(CITY_REGION_SELECTORS.heritageFacade(structure), heightM < 48);
    for (const minHeight of [0, 0.001, 2])
      assert.equal(
        CITY_REGION_SELECTORS.heritageStreetfrontHeight(heightM, minHeight),
        legacyFrontHeight(heightM, minHeight),
      );
  }
});

test('source-ID configuration is bounded by the same region/name/height rules and compiled once', () => {
  const rules = structuredClone(CITY_REGION_RULES);
  rules.gastown.facade.sources = {
    include: ['inside', 'outside'],
    exclude: ['blocked'],
  };
  rules.gastown.streetfront.sources = { exclude: ['blocked'] };
  rules.waterStreet.sources = { include: ['29:0'], exclude: ['private'] };
  const selectors = createRegionSelectors(rules),
    inside = { key: 'inside', center: [1000, 200], heightM: 24 };
  assert.equal(selectors.heritageFacade(inside), true);
  assert.equal(selectors.heritageFacade({ ...inside, key: 'unknown' }), false);
  assert.equal(
    selectors.heritageFacade({ ...inside, key: 'outside', center: [699, 200] }),
    false,
  );
  assert.equal(selectors.heritageFacade({ ...inside, heightM: 48 }), false);
  assert.equal(
    selectors.heritageStreetfrontRegion(inside.center, 'blocked'),
    false,
  );
  const edge = { names: ['WATER ST'], sourceIds: ['29:0'], length: 30 };
  assert.equal(selectors.waterStreetPaving(edge, 'ground'), true);
  assert.equal(
    selectors.waterStreetPaving({ ...edge, names: ['CORDOVA ST'] }, 'ground'),
    false,
  );
  assert.equal(
    selectors.waterStreetPaving(
      { ...edge, sourceIds: ['29:0', 'private'] },
      'ground',
    ),
    false,
  );
  assert.equal(
    selectors.waterStreetPaving({ ...edge, sourceIds: ['other'] }, 'ground'),
    false,
  );
  rules.gastown.bounds[0] = 1100;
  rules.gastown.facade.sources.include.length = 0;
  rules.waterStreet.name = 'CORDOVA ST';
  assert.equal(selectors.heritageFacade(inside), true);
  assert.equal(selectors.waterStreetPaving(edge, 'ground'), true);
  assert.equal(createRegionSelectors(rules).heritageFacade(inside), false);
});

test('street-name normalization cannot bleed into neighboring streets, bridges or short edges', () => {
  for (const name of [
    'WATER ST',
    'water st',
    '200 WATER ST',
    '200–300 water st',
    ' 200 — 300  WATER   ST ',
    'CORDOVA ST',
    'ALEXANDER ST',
    'POWELL ST',
    'EDGEWATER ST',
    'WATER STATION',
    'WATER ST EXTENSION',
    '200-300 WATER ST BRIDGE',
    '200 300 WATER ST',
    '200- WATER ST',
    'WATER STREET',
    '',
  ]) {
    for (const level of ['ground', 'bridge', 'tunnel']) {
      for (const length of [0, 0.1, 0.100001, 50]) {
        const edge = { names: [name], length, sourceIds: [] };
        assert.equal(
          CITY_REGION_SELECTORS.waterStreetPaving(edge, level),
          legacyPaving(edge, level),
          `${name}/${level}/${length}`,
        );
      }
    }
  }
});

test('real Water Street edges, widths and frame coordinates remain exact and graph input is unchanged', () => {
  const graph = cityRoadGraph(data.roads, data.trees.trees),
    before = JSON.stringify(graph),
    edges = graph.edges.filter((e) => legacyPaving(e, graph.nodes[e.a].level)),
    expected = edges.map((edge) => {
      const a = graph.nodes[edge.a].point,
        b = graph.nodes[edge.b].point,
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return {
        origin: a,
        tangent: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
        length,
        roadHalf: edge.width / 2,
        sidewalkHalf: edge.corridorWidth / 2,
      };
    });
  assert.deepEqual(heritageFrames(graph), expected);
  assert.deepEqual(
    sorted(edges.flatMap((e) => e.sourceIds)),
    baseline.paving.sourceIds,
  );
  assert.deepEqual(
    framesByGeometry(
      heritageFrames({ ...graph, edges: shuffled(graph.edges) }),
    ),
    framesByGeometry(expected),
  );
  assert.equal(
    JSON.stringify(graph),
    before,
    'selection must not change road graph, corridor width or collision geometry',
  );
});

test('reordering source road features preserves selected paving geometry despite positional graph source IDs', () => {
  const original = heritageFrames(cityRoadGraph(data.roads, data.trees.trees)),
    reordered = heritageFrames(
      cityRoadGraph(
        { ...data.roads, features: shuffled(data.roads.features) },
        data.trees.trees,
      ),
    );
  // Graph IDs are legacy feature-array positions; compare actual source geometry,
  // independent of frame direction and <1 micrometre floating-point snap noise.
  assert.deepEqual(
    framesByGeometry(reordered, 6),
    framesByGeometry(original, 6),
  );
});

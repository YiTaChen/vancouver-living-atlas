/** A01–A04 reproducible CPU evidence. Does not modify any source or runtime file. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { compileFunction } from 'node:vm';
import {
  ROOT,
  sources,
  textFile,
  jsonFile,
  load,
  elevationMethods,
} from './cpu-modules.mjs';
export const PACKAGE = 'tools/assets/city-scale-audit';
export const digest = (v) => createHash('sha256').update(v).digest('hex');
const round = (n) => Number(n.toFixed(8));
const histogram = (xs) =>
  Object.fromEntries(
    [...new Set(xs)]
      .sort((a, b) => (a < b ? -1 : Number(a > b)))
      .map((v) => [v, xs.filter((x) => x === v).length]),
  );
const near = (a, b, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(a - b) <= tolerance,
    `${a} != ${b} (tolerance ${tolerance})`,
  );
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const geo = load('lib/city/geo.ts');
const facade = load('lib/city/facade-profile.ts');
const roofs = load('lib/city/building-roof.ts');
const palette = load('lib/city/building-surface-palette.ts');
const { replacedBuilding } = load('lib/city/replaced-buildings.ts');
export function checkPolygon(polygon) {
  assert.ok(polygon.length > 0, 'missing outer ring');
  for (const ring of polygon) {
    assert.ok(ring.length >= 4, 'ring needs 3 corners plus closure');
    assert.deepEqual(ring[0], ring.at(-1), 'unclosed source ring');
    assert.ok(
      ring.every((p) => p.length >= 2 && p.slice(0, 2).every(Number.isFinite)),
      'nonfinite coordinate',
    );
  }
}
function area(ring) {
  return (
    Math.abs(
      sum(
        ring.map((a, i) => {
          const b = ring[(i + 1) % ring.length];
          return a[0] * b[1] - b[0] * a[1];
        }),
      ),
    ) / 2
  );
}
function sourceTokens(name, tokens) {
  const s = textFile(name);
  for (const t of tokens)
    assert.ok(s.includes(t), `consumer contract changed: ${name}: ${t}`);
}
export function auditBuildings(data, elevation, rules) {
  const ids = new Set(),
    prepared = [],
    excluded = [],
    rawTags = [],
    sourceKinds = [];
  let polygonParts = 0,
    holes = 0;
  for (const [featureIndex, f] of data.features.entries()) {
    const p = f.properties,
      sourceId = String(p.id);
    assert.ok(
      p.id !== undefined && sourceId.length && !ids.has(sourceId),
      `missing/duplicate source id: ${sourceId}`,
    );
    ids.add(sourceId);
    rawTags.push(String(p.roof));
    sourceKinds.push(p.source);
    assert.ok(
      Number.isFinite(p.height) &&
        Number.isFinite(p.base) &&
        Number.isFinite(p.minHeight),
      `invalid source interval: ${sourceId}`,
    );
    assert.ok(
      p.minHeight >= 0 && p.height > p.minHeight,
      `bad height interval: ${sourceId}`,
    );
    if (p.source === 'OpenStreetMap')
      assert.ok(
        p.structureId && p.sourceIds.length && p.baseSource && p.reconciliation,
        `missing derived provenance ${sourceId}`,
      );
    const rawPolygons = geo.rings(f);
    for (const polygon of rawPolygons) {
      checkPolygon(polygon);
      polygonParts++;
      holes += polygon.length - 1;
    }
    const h = Math.max(2, Number(p.height ?? p.hgt_agl ?? 8)),
      min = Math.max(0, Number(p.minHeight) || 0);
    const reason =
      !Number.isFinite(h) || h > 350 || min >= h
        ? 'invalid-runtime-height'
        : replacedBuilding(p)
          ? 'named-landmark-or-seabus-replacement'
          : null;
    if (reason) {
      excluded.push({ sourceId, reason });
      continue;
    }
    for (const [polygonIndex, raw] of rawPolygons.entries()) {
      const polygon = raw.map((r) => r.slice(0, -1).map(geo.project)),
        ring = polygon[0];
      if (ring.length < 3) continue;
      const center = [
        sum(ring.map((p) => p[0])) / ring.length,
        sum(ring.map((p) => p[1])) / ring.length,
      ];
      const key = facade.structureKey(
        p,
        ring
          .map((q) => q.map((n) => n.toFixed(3)).join(','))
          .sort((a, b) => (a < b ? -1 : Number(a > b)))
          .join(';'),
      );
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      prepared.push({
        structureId: key,
        heightM: h,
        minHeightM: min,
        footprintAreaM2: area(ring),
        center,
        polygon,
        featureIndex,
        polygonIndex,
        p,
        sourceId,
        boundsXZ: [
          Math.min(...xs),
          Math.min(...zs),
          Math.max(...xs),
          Math.max(...zs),
        ],
      });
    }
  }
  const structures = facade.summarizeStructures(prepared);
  const reversed = facade.summarizeStructures([...prepared].reverse());
  const first = new Map(),
    last = new Map(),
    counts = new Map();
  for (const p of prepared) {
    if (!first.has(p.structureId)) first.set(p.structureId, p);
    last.set(p.structureId, p);
    counts.set(p.structureId, (counts.get(p.structureId) ?? 0) + 1);
  }
  const profiles = new Map();
  for (const [key, structure] of structures) {
    const profile = facade.createProfile(structure);
    assert.deepEqual(
      profile,
      facade.createProfile(reversed.get(key)),
      `profile order instability ${key}`,
    );
    profiles.set(key, profile);
  }
  const datumOrderSensitive = [];
  for (const [key, p] of first) {
    const other = last.get(key),
      y0 = elevation(...p.center) - 0.4,
      y1 = elevation(...other.center) - 0.4;
    if (Math.abs(y0 - y1) > 0.000001)
      datumOrderSensitive.push({
        structureId: key,
        firstSourceId: p.sourceId,
        lastSourceId: other.sourceId,
        firstFoundationM: round(y0),
        reversedFoundationM: round(y1),
        deltaM: round(y1 - y0),
      });
  }
  const records = prepared.map((part) => {
    const {
      p,
      structureId: key,
      polygon,
      center,
      heightM: height,
      minHeightM: min,
    } = part;
    const profile = profiles.get(key),
      foundation = elevation(...first.get(key).center) - 0.4;
    const roof = roofs.planPitchedRoof(
      polygon,
      height,
      min,
      p.roof,
      p.source,
      counts.get(key),
    );
    let roofResult = 'flat-fallback';
    if (roof) {
      roofResult = roof.kind;
      near(roof.ridgeHeight, height);
      const triangles = roofs.pitchedRoofTriangles(roof, foundation);
      assert.equal(triangles.length, 6);
      assert.ok(
        triangles.every(
          (t) =>
            t.vertices.flat().every(Number.isFinite) &&
            t.normal.every(Number.isFinite),
        ),
      );
      const ys = triangles.flatMap((t) => t.vertices.map((v) => v[1]));
      near(Math.max(...ys), foundation + height);
      assert.ok(roof.eaveHeight >= 2.7 && roof.eaveHeight < height);
    }
    const finish = palette.selectFlatRoofFinish(profile.kind, profile.seed);
    assert.ok(finish >= 0 && finish <= 2);
    assert.ok(
      Math.abs(foundation + height - (foundation + min) - (height - min)) <
        1e-9,
    );
    return {
      sourceId: part.sourceId,
      structureId: key,
      sourceIds: p.sourceIds ?? [p.id],
      sourceDataset: p.source,
      featureIndex: part.featureIndex,
      polygonIndex: part.polygonIndex,
      sourcePolygonSha256: digest(
        JSON.stringify(
          geo.rings(data.features[part.featureIndex])[part.polygonIndex],
        ),
      ),
      sourceRoof: p.roof,
      sourceBaseM: p.base,
      sourceHeightM: p.height,
      sourceMinHeightM: p.minHeight,
      displayHeightM: height,
      displayMinHeightM: min,
      sourceVolumeY: [round(p.base + p.minHeight), round(p.base + p.height)],
      displayFoundationM: round(foundation),
      displayVolumeY: [round(foundation + min), round(foundation + height)],
      foundationSourceId: first.get(key).sourceId,
      foundationPolygonIndex: first.get(key).polygonIndex,
      centerXZ: center.map(round),
      boundsXZ: part.boundsXZ.map(round),
      outerAreaM2: round(part.footprintAreaM2),
      holes: polygon.length - 1,
      profileKind: profile.kind,
      seed: profile.seed,
      roofResult,
      ...(roof
        ? {
            eaveHeightM: round(roof.eaveHeight),
            sourceRoofEpoch: roof.sourceEpoch,
          }
        : { flatFinish: palette.FLAT_ROOF_FINISHES[finish].id }),
      appearanceConfidence:
        'representative; source roof geometry tag is not measured material',
    };
  });
  for (const [kind, expected] of Object.entries(
    rules.buildings.roof.finishSlots,
  )) {
    const slots = [0, 0, 0];
    for (let seed = 0; seed < 20; seed++)
      slots[palette.selectFlatRoofFinish(kind, seed)]++;
    assert.deepEqual(slots, expected);
  }
  for (const seed of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(palette.selectFlatRoofFinish('heritage-brick', seed), 1);
  const materialFields = [
    ...new Set(
      data.features.flatMap((f) =>
        Object.keys(f.properties).filter((k) =>
          /roof.?material|roof.?finish/i.test(k),
        ),
      ),
    ),
  ];
  return {
    records,
    summary: {
      status: 'pass',
      sourceFeatures: data.features.length,
      sourcePolygonParts: polygonParts,
      sourceHoles: holes,
      uniqueFeatureIds: ids.size,
      datasets: histogram(sourceKinds),
      roofTags: histogram(rawTags),
      acceptedPolygonParts: records.length,
      structures: structures.size,
      profiles: histogram(records.map((r) => r.profileKind)),
      roofGeometry: histogram(records.map((r) => r.roofResult)),
      flatFinishes: histogram(
        records.filter((r) => r.flatFinish).map((r) => r.flatFinish),
      ),
      sourceRoofMaterialFields: materialFields,
      excludedFeatures: excluded,
      minSourceHeightM: Math.min(...records.map((r) => r.sourceHeightM)),
      maxSourceHeightM: Math.max(...records.map((r) => r.sourceHeightM)),
      defaultHeightUses: 0,
      heightClampExamples: records
        .filter((r) => r.sourceHeightM !== r.displayHeightM)
        .map((r) => ({
          sourceId: r.sourceId,
          sourceHeightM: r.sourceHeightM,
          displayHeightM: r.displayHeightM,
        })),
      checks: [
        'unique feature IDs and OSM provenance fields',
        'closed finite source rings (not a full polygon validity/overlap test)',
        'valid vertical intervals and source top/thickness distinction',
        'actual source profile/roof/palette functions',
        'actual engine elevation including BeachGround override',
        'profile and finish stability under reversed part order',
        'roof ridge inside inherited height envelope',
      ],
      datumOrderSensitivity: {
        count: datumOrderSensitive.length,
        records: datumOrderSensitive,
        action:
          'Preserve source order and current first-part shared foundation; do not change datum as part of material work.',
      },
    },
  };
}
export function measureGlb(relative) {
  sources.add(relative);
  const bytes = fs.readFileSync(path.join(ROOT, relative));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12),
    d = JSON.parse(bytes.subarray(20, 20 + length).toString());
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const binOffset = 28 + length;
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  function accessor(i) {
    const a = d.accessors[i],
      view = d.bufferViews[a.bufferView];
    assert.equal(
      a.componentType,
      5126,
      'floating POSITION/UV required for this coupon audit',
    );
    const n = { VEC2: 2, VEC3: 3 }[a.type],
      start = binOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    assert.ok(n && !a.sparse);
    return Array.from({ length: a.count }, (_, j) =>
      Array.from({ length: n }, (_, k) =>
        bytes.readFloatLE(start + j * (view.byteStride ?? n * 4) + k * 4),
      ),
    );
  }
  const bounds = new THREE.Box3(),
    uvBounds = [Infinity, Infinity, -Infinity, -Infinity];
  let vertices = 0,
    triangles = 0,
    primitives = 0;
  function visit(i, parent, chain = new Set()) {
    assert.ok(!chain.has(i), 'cyclic GLB nodes');
    const next = new Set(chain).add(i),
      n = d.nodes[i];
    const matrix = n.matrix
      ? new THREE.Matrix4().fromArray(n.matrix)
      : new THREE.Matrix4().compose(
          new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
          new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
          new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
        );
    matrix.premultiply(parent);
    if (n.mesh !== undefined)
      for (const p of d.meshes[n.mesh].primitives) {
        assert.equal(p.mode ?? 4, 4);
        primitives++;
        const points = accessor(p.attributes.POSITION);
        vertices += points.length;
        for (const point of points) {
          assert.ok(point.every(Number.isFinite));
          bounds.expandByPoint(
            new THREE.Vector3(...point).applyMatrix4(matrix),
          );
        }
        for (const uv of accessor(p.attributes.TEXCOORD_0)) {
          assert.ok(uv.every(Number.isFinite));
          uvBounds[0] = Math.min(uvBounds[0], uv[0]);
          uvBounds[1] = Math.min(uvBounds[1], uv[1]);
          uvBounds[2] = Math.max(uvBounds[2], uv[0]);
          uvBounds[3] = Math.max(uvBounds[3], uv[1]);
        }
        triangles +=
          (p.indices === undefined
            ? points.length
            : d.accessors[p.indices].count) / 3;
      }
    for (const child of n.children ?? []) visit(child, matrix, next);
  }
  for (const i of d.scenes[d.scene ?? 0].nodes) visit(i, new THREE.Matrix4());
  const embeddedImageBytes = sum(
    (d.images ?? []).map((i) => {
      assert.ok(i.bufferView !== undefined);
      return d.bufferViews[i.bufferView].byteLength;
    }),
  );
  return {
    file: relative,
    sha256: digest(bytes),
    bytes: bytes.length,
    geometryAndContainerBytes: bytes.length - embeddedImageBytes,
    embeddedImageBytes,
    vertices,
    triangles,
    primitives,
    boundsM: {
      min: bounds.min.toArray().map(round),
      max: bounds.max.toArray().map(round),
      size: bounds.getSize(new THREE.Vector3()).toArray().map(round),
    },
    uvBounds: uvBounds.map(round),
    samplers: d.samplers,
    materials: d.materials.map((m) => ({
      name: m.name,
      alphaMode: m.alphaMode ?? 'OPAQUE',
    })),
    status: 'pass',
  };
}
function auditGround(terrain, rules) {
  assert.equal(terrain.heights.length, terrain.width * terrain.height);
  assert.ok(terrain.heights.every(Number.isFinite));
  near(Math.min(...terrain.heights), terrain.min);
  near(Math.max(...terrain.heights), terrain.max);
  const city = jsonFile('tools/assets/city-materials/catalog.json'),
    runtime = jsonFile('public/materials/city/manifest.json');
  const surfaces = city.materials.map((m) => {
    assert.deepEqual(
      m.tileMeters,
      runtime.materials.find((r) => r.id === m.id).tileMeters,
    );
    assert.ok(m.tileMeters.every((n) => n > 0 && Number.isFinite(n)));
    return {
      id: m.id,
      tileMeters: m.tileMeters,
      coupons: rules.ground.couponSizesM.map((size) => ({
        sizeM: size,
        repeatCount: size.map((n, i) => round(n / m.tileMeters[i])),
        status: 'numeric-plan-only',
      })),
    };
  });
  const old = jsonFile('tools/assets/vegetation_ground/manifest.json');
  const coupons = [0, 1, 2].map((lod) => {
    const id = `soil_grass_slope_lod${lod}`,
      record = old.assets.find((a) => a.id === id),
      measured = measureGlb(`tools/assets/vegetation_ground/${record.file}`);
    measured.boundsM.size.forEach((n, i) =>
      near(n, rules.ground.existingSlopeSizeXYZM[i], 1e-6),
    );
    assert.equal(measured.triangles, record.triangles);
    assert.equal(measured.bytes, record.bytes);
    assert.ok(
      measured.samplers.every((s) => s.wrapS === 33071 && s.wrapT === 10497),
    );
    assert.deepEqual(measured.uvBounds, [0, 0, 1, 1]);
    assert.ok(
      measured.materials.every(
        (m) => m.alphaMode === 'OPAQUE' && m.name === 'soil_grass_edge',
      ),
    );
    return measured;
  });
  const maps = old.maps
    .filter((m) => /maps\/(soil|grass)/.test(m.file))
    .map((m) => {
      const file = `tools/assets/vegetation_ground/${m.file}`;
      sources.add(file);
      const b = fs.readFileSync(path.join(ROOT, file));
      assert.ok(
        b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      );
      assert.equal(digest(b), m.sha256);
      assert.equal(b.length, m.bytes);
      const width = b.readUInt32BE(16),
        height = b.readUInt32BE(20);
      assert.equal(width, 512);
      assert.equal(height, 512);
      return {
        file,
        sha256: m.sha256,
        width,
        height,
        fileBytes: b.length,
        rgba8FullMipEstimateBytes: Math.ceil((width * height * 4 * 4) / 3),
      };
    });
  const unique = [...new Map(maps.map((m) => [m.sha256, m])).values()];
  const meta = jsonFile('public/data/terrain-metadata.json');
  assert.equal(meta.width, terrain.width);
  assert.deepEqual(meta.source, terrain.source);
  return {
    status: 'partial',
    numericChecks: 'pass',
    terrain: {
      width: terrain.width,
      height: terrain.height,
      samples: terrain.heights.length,
      minM: terrain.min,
      maxM: terrain.max,
      source: terrain.source,
      limitations: terrain.limitations,
    },
    existingSurfaces: surfaces,
    existingCoupons: coupons,
    groundMaps: maps,
    uniqueMapCount: unique.length,
    uniqueRgba8MipEstimateBytes: sum(
      unique.map((m) => m.rgba8FullMipEstimateBytes),
    ),
    groundSurfacePlans: ['soil', 'grass', 'soil_grass_edge'].map((id) => ({
      id,
      tileMeters: [2, 2],
      couponRepeatCounts: [
        { sizeM: [2, 2], repeat: [1, 1] },
        { sizeM: [10, 10], repeat: [5, 5] },
      ],
      wrap: id.endsWith('edge') ? ['clamp', 'repeat'] : ['repeat', 'repeat'],
      tenMetreEdgeConstraint: id.endsWith('edge')
        ? 'Do not repeat U five times; preserve a single 2m transition band or explicit blend mapping.'
        : null,
    })),
    gaps: [
      {
        id: 'a02-ten-metre-coupon',
        status: 'not_run',
        detail:
          'No 10x10m exported/reimported coupon or new four-light Cycles CPU matrix was made in this audit.',
      },
      {
        id: 'a02-sand-and-path',
        status: 'not_run',
        detail:
          'Existing city catalog provides concrete/asphalt/street-brick; ground candidate provides soil/grass/edge. No new sand surface or path-material replacement is justified or delivered.',
      },
      {
        id: 'a02-consumer',
        status: 'not_run',
        detail:
          'No drape, exclusion, navigation or renderer adoption; original terrain and coast remain authoritative.',
      },
    ],
    renders: {
      status: 'not_run',
      reason:
        'This package measures existing coupon binaries and records research requirements; it does not fabricate Cycles or WebGL evidence.',
    },
  };
}
function auditClock(rules) {
  const { CityClock, DEFAULT_CLOCK } = load('lib/city/clock.ts'),
    { NightSkyCycle } = load('lib/city/sky-state.ts'),
    { sampleAtmosphere } = load('lib/city/atmosphere.ts'),
    { waveHeight } = load('lib/city/water-world.ts');
  const { createBuses, updateBuses } = load('lib/city/city-buses.ts'),
    { trainHeadDistance } = load('lib/city/rail-path.ts');
  assert.deepEqual(DEFAULT_CLOCK, rules.clock.default);
  const timeline = rules.clock.cityHoursAtElapsedSeconds.map(
    ([seconds, expected]) => {
      const c = new CityClock();
      c.tick(0);
      c.tick(seconds * 1000);
      near(c.hour, expected);
      return { realElapsedSeconds: seconds, cityHour: c.hour };
    },
  );
  for (const frames of [1, 30, 60, 120]) {
    const c = new CityClock();
    c.tick(0);
    for (let i = 1; i <= frames; i++) c.tick((i * 60000) / frames);
    near(c.hour, 15);
  }
  const hidden = new CityClock();
  hidden.tick(0);
  hidden.setVisible(false, 1000);
  const held = hidden.hour;
  hidden.tick(61000);
  near(hidden.hour, held);
  hidden.setVisible(true, 62000);
  hidden.tick(63000);
  near(hidden.hour, held + 300 / 3600);
  const cycles = new NightSkyCycle(0.123);
  assert.equal(cycles.update(10, 0).night, false);
  const night = cycles.update(20.5, 0);
  assert.equal(night.aurora, true);
  assert.equal(cycles.update(1, 1).key, night.key);
  const movement = [];
  for (const config of [
    { rate: 1, running: true },
    { rate: 300, running: true },
    { rate: 300, running: false },
  ]) {
    const c = new CityClock(config);
    c.tick(0);
    c.tick(60000);
    const bus = createBuses(1),
      route = { a: [0, 0], b: [5000, 0], length: 5000, speed: 8, phase: 0 };
    updateBuses(bus, [route], 60, () => 2, new THREE.Vector3());
    const matrix = new THREE.Matrix4();
    bus.getMatrixAt(0, matrix);
    const xyz = new THREE.Vector3().setFromMatrixPosition(matrix).toArray();
    near(xyz[0], 480);
    near(xyz[1], 3.08, 1e-6);
    movement.push({
      clock: config,
      cityHour: round(c.hour),
      busPositionM: xyz.map(round),
      trainHeadDistanceM: round(trainHeadDistance(60, 14, 855.2, 68, 0)),
      waveHeightM: round(waveHeight('sea', 11, 23, 60)),
    });
    bus.geometry.dispose();
    bus.material.dispose();
  }
  for (const m of movement.slice(1)) {
    assert.deepEqual(m.busPositionM, movement[0].busPositionM);
    assert.equal(m.trainHeadDistanceM, movement[0].trainHeadDistanceM);
    assert.equal(m.waveHeightM, movement[0].waveHeightM);
  }
  sourceTokens('lib/city/engine.ts', [
    'this.uniforms.time.value = time / 1000',
    'updateTraffic(this, this.traffic, time / 1000)',
    'this.lastTime ? (time - this.lastTime) / 1000 : 0',
    'this.navigation?.update((time - this.lastTime) / 1000)',
  ]);
  sourceTokens('lib/city/environment.ts', [
    '(time * r.speed) / r.length',
    'updateBuses(',
  ]);
  sourceTokens('lib/city/railway.ts', [
    'rail.elapsed += dt',
    'THREE.MathUtils.clamp(delta, 0, 0.1)',
  ]);
  sourceTokens('lib/city/water-waves.ts', [
    'time.value = on ? boat!.time : e.uniforms.time.value',
  ]);
  const atmosphere = [];
  for (const mode of ['clear', 'overcast'])
    for (const hour of [0, 6, 10, 14, 19.8, 20.5, 23, 24]) {
      const a = sampleAtmosphere(hour, mode);
      assert.ok(
        Object.values(a)
          .filter((v) => typeof v === 'number')
          .every(Number.isFinite),
      );
      assert.ok(a.night >= 0 && a.night <= 1 && a.day >= 0 && a.day <= 1);
      atmosphere.push({
        mode,
        hour,
        night: round(a.night),
        sunIntensity: round(a.sunIntensity),
        exposure: round(a.exposure),
        fogDensity: round(a.fogDensity),
      });
    }
  const waveStats = {};
  for (const kind of ['sea', 'lake']) {
    let max = 0,
      samples = 0;
    for (let x = -100; x <= 100; x += 10)
      for (let z = -100; z <= 100; z += 10)
        for (const t of [0, 1, 60, 156]) {
          const v = waveHeight(kind, x, z, t);
          assert.ok(Number.isFinite(v));
          max = Math.max(max, Math.abs(v));
          samples++;
        }
    const bound = kind === 'sea' ? 0.415 : 0.021;
    assert.ok(max <= bound + 1e-12);
    waveStats[kind] = {
      samples,
      maxAbsoluteM: round(max),
      analyticAmplitudeBoundM: bound,
    };
  }
  return {
    status: 'pass',
    timeline,
    movement,
    atmosphere,
    waveStats,
    firstNightAurora: {
      status: 'pass',
      meaning: 'Authored session cycle, not a real aurora forecast',
    },
    movementEvidence:
      'Actual bus updater and rail/wave functions receive real seconds; engine call-site guard checks preserve routing. No full browser navigation/physics replay claimed.',
    runtimeChecks: rules.runtimeChecks,
  };
}
export function isContiguousSubsequence(line, source) {
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  return [source, [...source].reverse()].some((s) =>
    s.some(
      (_, start) =>
        start + line.length <= s.length &&
        line.every((p, i) => eq(p, s[start + i])),
    ),
  );
}
function auditStructures(elevation, rules) {
  const bridges = jsonFile(rules.structures.bridgeDataset),
    roads = jsonFile('public/data/roads.geojson'),
    rails = jsonFile(rules.structures.railDataset);
  const routeLength = (line) =>
    sum(
      line.slice(1).map((p, i) => {
        const a = geo.project(line[i]),
          b = geo.project(p);
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
      }),
    );
  const nodes = new Map(bridges.nodes.map((n) => [n.id, n]));
  assert.equal(nodes.size, bridges.nodes.length);
  const bridgeRecords = bridges.features.map((f) => {
    const p = f.properties,
      line = f.geometry.coordinates,
      length = routeLength(line);
    near(length, p.lengthM, rules.structures.sourceLengthRoundingToleranceM);
    assert.ok(
      p.roadWidthM > 0 &&
        p.widthStatus.includes('approximate') &&
        p.deckHeightStatus,
    );
    const endpointErrors = [];
    for (const [end, point] of [
      ['start', line[0]],
      ['end', line.at(-1)],
    ]) {
      const n = nodes.get(`${p.kind}:${p[end + 'Node']}`);
      assert.ok(n, `unresolved bridge node ${f.id}`);
      assert.ok(n.features.includes(f.id));
      const a = geo.project(point),
        b = geo.project(n.coord),
        error = Math.hypot(a[0] - b[0], a[1] - b[1]);
      assert.ok(error <= rules.structures.bridgeNodeToleranceM);
      endpointErrors.push(round(error));
    }
    let provenance = {
      status: 'not_run',
      detail:
        'Raw OSM Overpass way geometry is not present in this package; retained sourceId/URL are traceability, not re-verification.',
    };
    if (p.source === 'cov') {
      const m = /^processed-road-(\d+)-part-(\d+)$/.exec(p.sourceId);
      assert.ok(m);
      const src = roads.features[Number(m[1])];
      assert.equal(src.properties.source, 'cov-public-streets');
      const candidates =
        src.geometry.type === 'MultiLineString'
          ? src.geometry.coordinates
          : [src.geometry.coordinates];
      const original = candidates[Number(m[2])].map((p) =>
        p.slice(0, 2).map((n) => Number(n.toFixed(7))),
      );
      assert.ok(
        isContiguousSubsequence(line, original),
        `bridge source mismatch ${f.id}`,
      );
      provenance = {
        status: 'pass',
        sourceFeatureIndex: Number(m[1]),
        sourceLineIndex: Number(m[2]),
        detail:
          'Exact contiguous forward/reverse subsequence of published road vertices rounded to 7 decimals, matching preparation rule.',
      };
    }
    return {
      id: f.id,
      name: p.name,
      kind: p.kind,
      role: p.role,
      source: p.source,
      sourceId: p.sourceId,
      sourceUrl: p.sourceUrl,
      coordinateCount: line.length,
      sourceLengthM: p.lengthM,
      projectedLengthM: round(length),
      roadWidthM: p.roadWidthM,
      widthConfidence: p.widthStatus,
      deckM: p.estimatedDeckM,
      deckConfidence: p.deckHeightStatus,
      endpointErrorsM: endpointErrors,
      provenance,
    };
  });
  // Execute the unchanged consumer's actual graph solver, stopping before mesh creation.
  const ts = loadTypeScript(),
    bridgeSource = textFile('lib/city/bridges.ts'),
    start = bridgeSource.indexOf('  const heights ='),
    end = bridgeSource.indexOf('  for (const s of d.mainSpines)', start);
  assert.ok(
    start >= 0 && end > start,
    'bridge solver extraction boundary changed',
  );
  const code = ts.transpileModule(
    bridgeSource.slice(start, end) + '\nreturn Object.fromEntries(heights);',
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText;
  const solved = compileFunction(code, ['d', 'e', 'project'])(
    bridges,
    { elevation },
    geo.project,
  );
  assert.ok(Object.values(solved).every(Number.isFinite));
  const sharedNodes = bridges.nodes
    .filter((n) => n.features.length > 1)
    .map((n) => ({
      id: n.id,
      featureIds: n.features,
      heightM: round(solved[n.id]),
      heightRule: n.heightRule,
    }));
  const { makeRailPath } = load('lib/city/rail-path.ts');
  const railRecords = rails.routes.map((r) => {
    assert.ok(
      r.sourceIds.length &&
        r.sourceTimestamp &&
        r.heightStatus.includes('No surveyed'),
    );
    assert.equal(r.loop, false);
    assert.equal(r.cumulativeM.length, r.coordinates.length);
    near(routeLength(r.coordinates), r.lengthM, 0.011);
    for (let i = 1; i < r.cumulativeM.length; i++) {
      assert.ok(r.cumulativeM[i] >= r.cumulativeM[i - 1]);
      near(
        routeLength(r.coordinates.slice(i - 1, i + 1)),
        r.cumulativeM[i] - r.cumulativeM[i - 1],
        0.0011,
      );
      near(
        routeLength(r.coordinates.slice(0, i + 1)),
        r.cumulativeM[i],
        i * 0.0011,
      );
    }
    const covered = new Set();
    for (const seg of r.segments) {
      assert.ok(r.sourceIds.includes(seg.sourceId));
      assert.ok(
        seg.startIndex >= 0 &&
          seg.endIndex < r.coordinates.length &&
          seg.endIndex > seg.startIndex,
      );
      for (let i = seg.startIndex; i < seg.endIndex; i++) covered.add(i);
      if (r.kind === 'skytrain')
        assert.ok(['yes', 'viaduct'].includes(seg.bridge));
    }
    assert.equal(
      covered.size,
      r.coordinates.length - 1,
      'unattributed rail span',
    );
    const p = makeRailPath(r, elevation);
    let maximumGrade = 0,
      minimumClearance = Infinity;
    for (let i = 0; i < p.points.length; i++) {
      const a = p.points[i];
      assert.ok(a.toArray().every(Number.isFinite));
      minimumClearance = Math.min(minimumClearance, a.y - elevation(a.x, a.z));
      if (i) {
        const b = p.points[i - 1],
          run = Math.hypot(a.x - b.x, a.z - b.z);
        if (run > 0)
          maximumGrade = Math.max(maximumGrade, Math.abs(a.y - b.y) / run);
      }
    }
    assert.ok(maximumGrade <= rules.structures.railGradeCaps[r.kind] + 1e-9);
    assert.ok(minimumClearance >= r.clearance + 0.65 - 1e-8);
    return {
      id: r.id,
      sourceIds: r.sourceIds,
      sourceTimestamp: r.sourceTimestamp,
      kind: r.kind,
      sourceCoordinates: r.coordinates.length,
      sourceLengthM: r.lengthM,
      projectedSourceLengthM: round(routeLength(r.coordinates)),
      generated3DLengthM: round(p.length),
      samples: p.points.length,
      gaugeM: r.gaugeM,
      clearanceM: r.clearance,
      minimumGeneratedClearanceM: round(minimumClearance),
      maximumGrade: round(maximumGrade),
      gradeCap: rules.structures.railGradeCaps[r.kind],
      heightConfidence: r.heightStatus,
      displayQualifier: r.displayQualifier,
      segmentAttribution: 'pass',
      rawOsmGeometryReverification: 'not_run',
      navigationService: 'not implemented by this audit',
    };
  });
  sourceTokens('lib/city/lions-railings.ts', [
    '70954668, 70954672',
    '[184, 190, 656, 662]',
    's += 2.4',
  ]);
  return {
    status: 'pass',
    bridgeRecords,
    sharedNodeSolver: {
      status: 'pass',
      method:
        'Executed actual createBridgeApproaches graph-solver source before meshing, using actual elevation methods.',
      nodes: sharedNodes,
    },
    railRecords,
    bridgeSourceChecks: histogram(
      bridgeRecords.map((r) => r.provenance.status),
    ),
    existingCloseStructure: {
      consumer: 'lib/city/lions-railings.ts',
      sourceIds: [70954668, 70954672],
      note: 'Existing source-selected rails and tower openings retained; no close-view visual deficit is inferred from low-detail primitives alone.',
    },
    namedCloseStructureProposals: rules.structures.namedCloseStructureProposals,
    gaps: [
      {
        id: 'a04-engineering-dimensions',
        detail:
          'Bridge widths/decks and all rail heights are explicitly estimates. Acquire named survey evidence before treating them as exact real dimensions.',
      },
      {
        id: 'a04-close-view',
        status: 'not_run',
        detail:
          'Joint/support/guardrail appearance requires source-matched close-view evidence; no new models are warranted by these checks.',
      },
    ],
    runtimeChecks: rules.runtimeChecks,
  };
}
function loadTypeScript() {
  return createRequireForAudit('typescript');
}
import { createRequire } from 'node:module';
const createRequireForAudit = createRequire(import.meta.url);
export async function runAudit() {
  const rules = jsonFile(`${PACKAGE}/source-rules.json`);
  assert.deepEqual(rules.taskIds, ['A01', 'A02', 'A03', 'A04']);
  assert.equal(rules.runtimeChecks.status, 'not_run');
  assert.equal(rules.ground.newTerrainOverlaysAllowed, false);
  assert.equal(
    rules.buildings.roof.flatFinishConfidence,
    'representative seeded appearance, never a measured material classification',
  );
  const requirements = [
    `${PACKAGE}/audit.mjs`,
    `${PACKAGE}/cpu-modules.mjs`,
    'docs/AI_AGENT_DEVELOPMENT_BACKLOG.md',
    'docs/PROJECT_SPECIFICATION.md',
    'docs/MATERIAL_PIPELINE.md',
    'docs/OFFLINE_ASSET_INTEGRATION_2026_10.md',
    'docs/CITY_READABILITY_2026_10.md',
    'DATA_SOURCES.md',
    'LICENSE',
    'AI_AGENT_POLICY.md',
    'tools/make_bridge_routes.py',
    'tools/assets/vegetation_ground/README.md',
    'tools/assets/vegetation_ground/build_vegetation_ground.py',
    'tools/assets/city-materials/README.md',
    'lib/city/harmonize-ground.ts',
    'lib/city/park-paths.ts',
    'lib/city/sky-effects.ts',
    'lib/city/architecture-material.ts',
    'public/data/land.geojson',
    'public/data/shoreline.geojson',
    'public/data/reconciliation-report.json',
  ];
  for (const name of requirements) textFile(name);
  const terrain = jsonFile('public/data/terrain.json'),
    buildings = jsonFile(rules.buildings.dataset),
    snapshot = JSON.stringify(buildings);
  const { BeachGround } = load('lib/city/beach-ground.ts');
  const e = {
    data: { elevation: terrain },
    beachGround: new BeachGround(jsonFile('public/data/beach-coast.json')),
    ...elevationMethods(THREE, geo),
  };
  const elevation = e.elevation.bind(e);
  sourceTokens('lib/city/building-bodies.ts', [
    'Math.max(2, Number(p.height ?? p.hgt_agl ?? 8))',
    'e.elevation(...first.center) - 0.4',
    'sourceRoof: p.roof',
    'minY: foundations.get(key)! + min',
    'maxY: foundations.get(key)! + h',
  ]);
  const A01 = auditBuildings(buildings, elevation, rules),
    A02 = auditGround(terrain, rules),
    A03 = auditClock(rules),
    A04 = auditStructures(elevation, rules);
  assert.equal(JSON.stringify(buildings), snapshot, 'source data mutated');
  // Hash all actually consumed TS/JSON/GLB/PNG files plus required provenance documents.
  sources.add('tools/assets/vegetation_ground/source/vegetation_ground.blend');
  sources.add('tools/assets/city-materials/source/city-material-library.blend');
  const inputFiles = [...sources]
    .sort((a, b) => (a < b ? -1 : Number(a > b)))
    .map((file) => {
      const bytes = fs.readFileSync(path.join(ROOT, file));
      return { file, bytes: bytes.length, sha256: digest(bytes) };
    });
  const inputFingerprint = digest(JSON.stringify(inputFiles));
  const report = {
    schemaVersion: 1,
    packageId: 'city-scale-audit',
    baseRevision: rules.baseRevision,
    status: 'partial',
    scope: 'A01–A04 offline source and CPU research contract',
    inputFingerprint,
    environment: {
      engine: 'Node.js CPU, Three.js math/geometry only',
      webgl: 'not_run',
      blender: 'not_run',
      dependencyLockSha256: digest(
        fs.readFileSync(path.join(ROOT, 'package-lock.json')),
      ),
    },
    A01: A01.summary,
    A02,
    A03,
    A04,
    knownLimitations: [
      'Closed finite rings are checked; polygon self-intersection and inter-building volumetric overlap are not re-proven here.',
      'Source provenance links are retained, not fetched; raw pre-reconciliation CoV/OSM acquisition is not re-run.',
      'A02 remains partial: no new 10m coupons, sand surface or four-light render matrix.',
      'No image-quality improvement, FPS, GPU allocation, runtime integration or deployment is claimed.',
    ],
    runtimeChecks: rules.runtimeChecks,
  };
  const handoff = {
    schemaVersion: 1,
    packageId: 'city-scale-audit',
    baseRevision: rules.baseRevision,
    taskIds: rules.taskIds,
    assetStatus: 'partial',
    integrationStatus: 'runtime_pending_webgl',
    webglAvailable: false,
    manifest: '../manifest.json',
    sourceEditsPreserved: true,
    taskStatus: {
      A01: {
        status: 'offline_complete',
        scope: 'source-rule JSON and source/CPU comparison only',
      },
      A02: {
        status: 'partial',
        scope:
          'existing surface/coupon measurements and research contract; missing 10m coupon/renders',
      },
      A03: {
        status: 'offline_complete',
        scope: 'CPU numeric/source-routing checks only',
      },
      A04: {
        status: 'offline_complete',
        scope:
          'source geometry/provenance/grade audit; no demonstrated component deficit, no new model',
      },
    },
    offlineEvidence: ['report.json', 'buildings.jsonl', 'source-hashes.json'],
    runtimeChecks: rules.runtimeChecks,
    intendedConsumers: [
      'lib/city/building-bodies.ts',
      'lib/city/facade-profile.ts',
      'lib/city/engine.ts',
      'lib/city/clock.ts',
      'lib/city/bridges.ts',
      'lib/city/rail-path.ts',
    ],
    replaces: [],
    knownLimitations: report.knownLimitations,
    nextIntegrationSteps: [
      'Review known foundation ordering and source-height clamp cases before changing source data.',
      'Complete selected 2m/10m surface coupons and four-light CPU renders if material work is justified.',
      'Keep current geometry/datum and shaders; test source-selected runtime samples with WebGL before changing adoption.',
    ],
  };
  return {
    'report.json': report,
    'source-hashes.json': {
      schemaVersion: 1,
      inputFingerprint,
      files: inputFiles,
    },
    'buildings.jsonl': A01.records,
    'handoff.json': handoff,
  };
}
export function serialize(name, value) {
  return name.endsWith('.jsonl')
    ? value.map((v) => JSON.stringify(v)).join('\n') + '\n'
    : JSON.stringify(value, null, 2) + '\n';
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2] ?? '--check';
  assert.ok(['--write', '--check'].includes(mode), 'Use --write or --check');
  const artifacts = await runAudit();
  for (const [name, value] of Object.entries(artifacts)) {
    const target = path.join(ROOT, PACKAGE, 'qa', name),
      expected = serialize(name, value);
    if (mode === '--write') fs.writeFileSync(target, expected);
    else
      assert.equal(
        fs.readFileSync(target, 'utf8'),
        expected,
        `${name} differs; inspect source changes, then explicitly regenerate`,
      );
  }
  console.log(
    JSON.stringify({
      status: 'pass',
      mode,
      inputFingerprint: artifacts['report.json'].inputFingerprint,
      sourceFeatures: artifacts['report.json'].A01.sourceFeatures,
      acceptedPolygonParts: artifacts['report.json'].A01.acceptedPolygonParts,
      A02: 'partial',
      WebGL: 'not_run',
    }),
  );
}

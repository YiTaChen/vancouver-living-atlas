import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  carveFloorRect,
  resizeIsland,
} from '../tools/station-interiors/geometry-utils.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';
const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);
const close = (a, b, tolerance = 1e-7) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const rectangle = (minX, maxX, y, minZ, maxZ) => [
  [minX, y, minZ],
  [minX, y, maxZ],
  [maxX, y, maxZ],
  [maxX, y, minZ],
];
function fixture(alongX = true) {
  const id = alongX ? 'waterfront-canada' : 'waterfront-expo',
    axis = alongX ? 2 : 0,
    center = alongX ? [32, -13, 8] : [-24, -7, 0],
    length = alongX ? 44 : 74,
    half = alongX ? 1.46 : 1.28,
    gap = alongX ? 0.24 : 0.22,
    floorAboveRail = alongX ? 1.1 : 0.95,
    frame = alongX ? [0, Math.SQRT1_2, 0, Math.SQRT1_2] : [0, 0, 0, 1],
    vertices = rectangle(
      center[0] - (alongX ? length : 6) / 2,
      center[0] + (alongX ? length : 6) / 2,
      center[1],
      center[2] - (alongX ? 6 : length) / 2,
      center[2] + (alongX ? 6 : length) / 2,
    ),
    source = {
      stationId: 'waterfront',
      name: 'Waterfront',
      layoutKind: 'two-line-independent-perpendicular-platforms',
      provenance: { mapUrl: 'https://www.translink.ca/' },
      geographicAnchor: { coordinatesLonLat: [-123.11, 49.286] },
      localToWorld: { rotationQuaternionXYZW: [0, 0, 0, 1] },
      floorSurfaces: [
        {
          surfaceId: id,
          levelId: 'platform',
          kind: 'platform',
          walkable: true,
          verticesM: vertices,
          indices: [0, 1, 2, 0, 2, 3],
          geometryNodeId: `floor-${id}`,
        },
      ],
      geometryParts: [
        {
          id: `floor-${id}`,
          centerM: [center[0], center[1] - 0.15, center[2]],
          sizeM: alongX ? [length, 0.3, 6] : [6, 0.3, length],
          yawDegrees: 0,
          material: 'floor',
          role: 'floor',
        },
      ],
      entrances: [
        {
          entranceId: 'fixture-entry',
          label: 'Entry',
          pointM: [center[0], center[1], center[2]],
          surfaceId: id,
        },
      ],
      platforms: [],
      connections: [],
      trackExclusionVolumes: [],
      obstacles: [],
      anchors: [],
      thresholdBridges: [],
      instances: [],
    };
  for (const sign of [-1, 1]) {
    const direction = alongX
        ? sign > 0
          ? 'northbound'
          : 'southbound'
        : sign > 0
          ? 'eastbound'
          : 'westbound',
      pid = `${id}-${direction}`,
      stop = [...center],
      sill = [...center],
      edge = [...center],
      waiting = [...center];
    stop[1] -= floorAboveRail;
    stop[axis] += sign * (3 + half + gap);
    sill[axis] += sign * (3 + gap);
    edge[axis] += sign * 3;
    waiting[axis] += sign * 2;
    const localSill = [alongX ? sign * half : -sign * half, floorAboveRail, 0],
      door = {
        id: `${pid}-car1-door1`,
        carIndex: 0,
        carLocalSide: localSill[0] > 0 ? 'right' : 'left',
        carPoseInConsist: {
          translationM: [0, 0, 0],
          rotationQuaternionXYZW: [0, 0, 0, 1],
        },
        carLocalSillPointM: [...localSill],
        consistLocalSillPointM: [...localSill],
        stationSillPointM: sill,
        platformEdgePointM: edge,
        stationWaitingPointM: waiting,
        openingWidthM: 1.4,
        horizontalThresholdGapM: gap,
        thresholdBridgeId: `bridge-${pid}-car1-door1`,
      };
    source.platforms.push({
      platformId: pid,
      surfaceId: id,
      lineId: alongX ? 'canada' : 'expo',
      direction,
      lengthM: length,
      widthM: 6,
      floorHeightM: center[1],
      railHeightM: stop[1],
      floorAboveRailM: floorAboveRail,
      stopPosition: {
        translationM: stop,
        rotationQuaternionXYZW: frame,
        motionDirectionSign: sign,
      },
      doorAlignmentPoints: [door],
      trackExclusionId: `${pid}-no-walk`,
      waitingRegions: [
        {
          polygonM: [
            waiting.map((v, i) => (i === 0 ? v - 0.2 : v)),
            waiting.map((v, i) => (i === 0 ? v + 0.2 : v)),
          ],
        },
      ],
    });
    source.geometryParts.push(
      {
        id: `trackbed-${pid}`,
        centerM: [...stop],
        sizeM: [2.9, 0.4, length + 12],
        yawDegrees: alongX ? 90 : 0,
        material: 'concrete',
        role: 'trackbed',
      },
      {
        id: `tactile-${pid}`,
        centerM: [...edge],
        sizeM: [0.38, 0.024, length],
        yawDegrees: alongX ? 90 : 0,
        material: 'yellow',
        role: 'static',
      },
      {
        id: `bridge-${door.id}`,
        centerM: [...edge],
        sizeM: [gap, 0.015, 1.3],
        yawDegrees: alongX ? 90 : 0,
        material: 'steel',
        role: 'threshold',
      },
    );
    const exclusionCenter = [...stop];
    source.trackExclusionVolumes.push({
      id: `${pid}-no-walk`,
      footprintM: rectangle(
        exclusionCenter[0] - 1,
        exclusionCenter[0] + 1,
        stop[1],
        exclusionCenter[2] - 1,
        exclusionCenter[2] + 1,
      ),
      minY: stop[1] - 0.5,
      maxY: center[1] + 3,
    });
    source.anchors.push(
      { id: `${pid}-stop`, pointM: [...stop], kind: 'vehicle-root-stop' },
      { id: door.id, pointM: [...edge], kind: 'platform-door' },
    );
    source.thresholdBridges.push({
      instanceId: `bridge-${door.id}`,
      pairedDoorAlignmentId: door.id,
      storedTransform: { translationM: [...edge] },
      deployedTransform: { translationM: [...edge] },
      deployedFloor: {
        verticesM: rectangle(
          edge[0] - 0.1,
          edge[0] + 0.1,
          edge[1],
          edge[2] - 0.1,
          edge[2] + 0.1,
        ),
      },
      sequence: [{ translationM: [...edge] }],
    });
  }
  return source;
}
function floorArea(floor) {
  let area = 0;
  for (let i = 0; i < floor.indices.length; i += 3) {
    const [a, b, c] = floor.indices
      .slice(i, i + 3)
      .map((j) => floor.verticesM[j]);
    area +=
      Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) /
      2;
  }
  return area;
}
function floorContains(floor, x, z) {
  const vector = new THREE.Vector2(x, z);
  for (let i = 0; i < floor.indices.length; i += 3) {
    const [a, b, c] = floor.indices
        .slice(i, i + 3)
        .map(
          (j) =>
            new THREE.Vector2(floor.verticesM[j][0], floor.verticesM[j][2]),
        ),
      area = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x),
      signs = [area(a, b, vector), area(b, c, vector), area(c, a, vector)];
    if (signs.every((s) => s >= -1e-7) || signs.every((s) => s <= 1e-7))
      return true;
  }
  return false;
}
const slabs = (source) =>
  source.geometryParts.filter((part) => part.role === 'floor');
const slabContains = (part, x, z) =>
  Math.abs(x - part.centerM[0]) < part.sizeM[0] / 2 - 1e-7 &&
  Math.abs(z - part.centerM[2]) < part.sizeM[2] / 2 - 1e-7;

test('stairwell cuts remove equal walking and visible slab areas while preserving platform interfaces', () => {
  const source = fixture(),
    original = structuredClone(source),
    floor = source.floorSurfaces[0],
    id = floor.surfaceId;
  assert.equal(
    carveFloorRect(source, id, { minX: 24, maxX: 40, minZ: 6.5, maxZ: 9.5 }),
    source,
  );
  const cut = source.floorSurfaces[0];
  assert.equal(cut.surfaceId, id);
  assert.equal(cut.geometryNodeId, floor.geometryNodeId);
  close(floorArea(cut), 44 * 6 - 16 * 3);
  close(
    slabs(source).reduce((sum, part) => sum + part.sizeM[0] * part.sizeM[2], 0),
    floorArea(cut),
  );
  assert(!floorContains(cut, 32, 8));
  assert(!slabs(source).some((part) => slabContains(part, 32, 8)));
  for (const point of [
    [32, 6],
    [32, 10],
    [15, 8],
    [50, 8],
  ])
    assert(floorContains(cut, ...point));
  assert.deepEqual(source.platforms, original.platforms);
  assert.deepEqual(source.anchors, original.anchors);
  assert(cut.verticesM.length <= 100 && cut.indices.length <= 300);
  assert(source.geometryParts.some((part) => part.id === cut.geometryNodeId));
  const data = makeRuntimeStation(source, 'a'.repeat(64));
  validateRuntimeStation(data);
  const owner = new SkyTrainStationOwner(data, () => 0);
  try {
    assert.equal(owner.floorAt([32, -13, 8], id), null);
    let stopped = owner.floorAt([20, -13, 8], id),
      aisle = owner.floorAt([20, -13, 10], id);
    for (let i = 0; i < 100; i++) {
      stopped = owner.walk(stopped, 0.2, 0);
      aisle = owner.walk(aisle, 0.2, 0);
    }
    assert(stopped.position[0] < 24 - 0.2);
    close(aisle.position[0], 40);
  } finally {
    owner.dispose();
  }
});

test('repeated and overlapping cuts retain prior holes, unique slab IDs and the floor geometry anchor', () => {
  const source = fixture(),
    id = source.floorSurfaces[0].surfaceId;
  carveFloorRect(source, id, { minX: 24, maxX: 40, minZ: 6.5, maxZ: 9.5 });
  carveFloorRect(source, id, { minX: 35, maxX: 48, minZ: 7, maxZ: 10 });
  close(floorArea(source.floorSurfaces[0]), 264 - (48 + 39 - 12.5));
  const ids = source.geometryParts.map((part) => part.id);
  assert.equal(new Set(ids).size, ids.length);
  for (let x = 10.25; x < 54; x += 0.5)
    for (let z = 5.25; z < 11; z += 0.5) {
      const expected =
        !(x > 24 && x < 40 && z > 6.5 && z < 9.5) &&
        !(x > 35 && x < 48 && z > 7 && z < 10);
      assert.equal(
        floorContains(source.floorSurfaces[0], x, z),
        expected,
        `walking ${x},${z}`,
      );
      assert.equal(
        slabs(source).some((part) => slabContains(part, x, z)),
        expected,
        `visible ${x},${z}`,
      );
    }
  // Remove the slab retaining the original ID; another retained piece inherits it.
  carveFloorRect(source, id, { minX: 9, maxX: 24, minZ: 4, maxZ: 12 });
  assert(
    source.geometryParts.some(
      (part) => part.id === source.floorSurfaces[0].geometryNodeId,
    ),
  );
});

for (const alongX of [true, false])
  test(`${alongX ? 'Canada along X' : 'Expo along Z'} widening preserves every exact train/door/bridge interface`, () => {
    const source = fixture(alongX),
      original = structuredClone(source),
      id = source.floorSurfaces[0].surfaceId,
      axis = alongX ? 2 : 0,
      center = alongX ? 8 : -24,
      newWidth = alongX ? 8.6 : 8,
      half = (newWidth - 6) / 2;
    assert.equal(resizeIsland(source, id, newWidth), source);
    close(floorArea(source.floorSurfaces[0]), (alongX ? 44 : 74) * newWidth);
    for (let i = 0; i < source.platforms.length; i++) {
      const platform = source.platforms[i],
        before = original.platforms[i],
        amount =
          Math.sign(before.stopPosition.translationM[axis] - center) * half,
        door = platform.doorAlignmentPoints[0],
        previous = before.doorAlignmentPoints[0],
        rotation = new THREE.Quaternion(
          ...platform.stopPosition.rotationQuaternionXYZW,
        ),
        sill = new THREE.Vector3(...door.carLocalSillPointM)
          .applyQuaternion(
            new THREE.Quaternion(
              ...door.carPoseInConsist.rotationQuaternionXYZW,
            ),
          )
          .add(new THREE.Vector3(...door.carPoseInConsist.translationM))
          .applyQuaternion(rotation)
          .add(new THREE.Vector3(...platform.stopPosition.translationM));
      assert.equal(platform.widthM, newWidth);
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ]) {
        close(door[key][axis], previous[key][axis] + amount);
        for (const other of [0, 1, 2].filter((index) => index !== axis))
          close(door[key][other], previous[key][other]);
      }
      sill
        .toArray()
        .forEach((value, index) => close(value, door.stationSillPointM[index]));
      close(
        Math.abs(door.stationSillPointM[axis] - door.platformEdgePointM[axis]),
        door.horizontalThresholdGapM,
      );
      close(
        Math.abs(
          door.platformEdgePointM[axis] - door.stationWaitingPointM[axis],
        ),
        1,
      );
      for (const key of [
        'carLocalSillPointM',
        'consistLocalSillPointM',
        'carPoseInConsist',
        'carLocalSide',
      ])
        assert.deepEqual(door[key], previous[key]);
      for (const [key, idKey] of [
        ['geometryParts', 'id'],
        ['anchors', 'id'],
      ]) {
        for (const item of source[key].filter((item) =>
          item[idKey].includes(platform.platformId),
        )) {
          const old = original[key].find(
              (value) => value[idKey] === item[idKey],
            ),
            vector = key === 'anchors' ? 'pointM' : 'centerM';
          close(item[vector][axis], old[vector][axis] + amount);
        }
      }
      source.trackExclusionVolumes[i].footprintM.forEach((point, j) =>
        close(
          point[axis],
          original.trackExclusionVolumes[i].footprintM[j][axis] + amount,
        ),
      );
      const bridge = source.thresholdBridges[i],
        oldBridge = original.thresholdBridges[i];
      close(
        bridge.storedTransform.translationM[axis],
        oldBridge.storedTransform.translationM[axis] + amount,
      );
      close(
        bridge.deployedTransform.translationM[axis],
        oldBridge.deployedTransform.translationM[axis] + amount,
      );
      close(
        bridge.sequence[0].translationM[axis],
        oldBridge.sequence[0].translationM[axis] + amount,
      );
      bridge.deployedFloor.verticesM.forEach((point, j) =>
        close(point[axis], oldBridge.deployedFloor.verticesM[j][axis] + amount),
      );
    }
    assert.deepEqual(source.geographicAnchor, original.geographicAnchor);
    assert.deepEqual(source.localToWorld, original.localToWorld);
    validateRuntimeStation(makeRuntimeStation(source, 'a'.repeat(64)));
  });

test('widening an already carved platform keeps the stairwell footprint fixed', () => {
  const source = fixture(),
    id = source.floorSurfaces[0].surfaceId;
  carveFloorRect(source, id, { minX: 24, maxX: 40, minZ: 6.5, maxZ: 9.5 });
  resizeIsland(source, id, 8.6);
  close(floorArea(source.floorSurfaces[0]), 44 * 8.6 - 48);
  assert(!floorContains(source.floorSurfaces[0], 32, 8));
  assert(!slabs(source).some((part) => slabContains(part, 32, 8)));
  assert(floorContains(source.floorSurfaces[0], 32, 4));
});

test('invalid structural edits fail without partially mutating the source', () => {
  for (const operation of [
    (source) =>
      carveFloorRect(source, 'missing', { minX: 1, maxX: 2, minZ: 1, maxZ: 2 }),
    (source) =>
      carveFloorRect(source, source.floorSurfaces[0].surfaceId, {
        minX: 1,
        maxX: 0,
        minZ: 1,
        maxZ: 2,
      }),
    (source) =>
      carveFloorRect(source, source.floorSurfaces[0].surfaceId, {
        minX: 0,
        maxX: 100,
        minZ: 0,
        maxZ: 100,
      }),
    (source) => resizeIsland(source, source.floorSurfaces[0].surfaceId, NaN),
  ]) {
    const source = fixture(),
      original = structuredClone(source);
    assert.throws(() => operation(source));
    assert.deepEqual(source, original);
  }
  const missingSlab = fixture();
  missingSlab.geometryParts = missingSlab.geometryParts.filter(
    (part) => part.role !== 'floor',
  );
  assert.throws(
    () =>
      carveFloorRect(missingSlab, missingSlab.floorSurfaces[0].surfaceId, {
        minX: 24,
        maxX: 40,
        minZ: 6.5,
        maxZ: 9.5,
      }),
    /visible slab/,
  );
});

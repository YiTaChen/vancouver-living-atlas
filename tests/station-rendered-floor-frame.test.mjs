import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';

const { SkyTrainStationOwner, validateRuntimeStation } = await import(
  cityModule('skytrain-stations')
);
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { makeStationStreetAccess } = await import(
  cityModule('skytrain-street-access')
);
const routes = JSON.parse(readFileSync('public/models/skytrain-routes.json'));
const source = JSON.parse(readFileSync(SOURCE)).stations.find(
  (s) => s.stationId === 'waterfront',
);
function fixture() {
  const input = structuredClone(source),
    floor = input.floorSurfaces.find(
      (f) =>
        f.kind === 'corridor' &&
        f.verticesM.some((p) => Math.abs(p[1] - f.verticesM[0][1]) > 0.1),
    ),
    part = input.geometryParts.find((p) => p.id === `floor-${floor.surfaceId}`);
  assert(part && floor);
  // Isolate this opt-in so the legacy annotation negative remains independent
  // of other production floors sharing the same material batch.
  for (const sourcePart of input.geometryParts)
    delete sourcePart.renderFloorSurfaceId;
  part.renderFloorSurfaceId = floor.surfaceId;
  // This older source-only annotation belongs to slab carve ownership. It
  // must never opt any part into the new exact rendering behavior.
  part.floorSurfaceId = 'carve-only-source-annotation';
  return {
    input,
    floor,
    part,
    data: makeRuntimeStation(input, 'a'.repeat(64)),
  };
}
function assertTopRays(owner, partId, floorId) {
  owner.group.updateMatrixWorld(true);
  const mesh = owner.group.children.find((m) =>
      m.userData.stationPartIds?.includes(partId),
    ),
    floor = owner.geometryData.floors.find((f) => f.id === floorId),
    positions = mesh.geometry.getAttribute('position'),
    range = mesh.userData.stationPartRanges?.find((r) => r.id === partId);
  assert(mesh instanceof THREE.Mesh && !(mesh instanceof THREE.InstancedMesh));
  assert.equal(range.renderFloorSurfaceId, floorId);
  assert.equal(range.vertexCount % 3, 0);
  assert.equal(
    mesh.userData.stationTrianglePartIds.length,
    positions.count / 3,
  );
  let samples = 0;
  for (let offset = 0; offset < floor.indices.length; offset += 3) {
    const [a, b, c] = floor.indices
      .slice(offset, offset + 3)
      .map((i) => new THREE.Vector3(...floor.vertices[i]));
    for (const weights of [
      [0.2, 0.3, 0.5],
      [0.7, 0.1, 0.2],
      [0.1, 0.75, 0.15],
    ]) {
      const local = a
          .clone()
          .multiplyScalar(weights[0])
          .addScaledVector(b, weights[1])
          .addScaledVector(c, weights[2]),
        world = new THREE.Vector3(...owner.toWorld(local.toArray())),
        ray = new THREE.Raycaster(
          world.clone().add(new THREE.Vector3(0, 0.6, 0)),
          new THREE.Vector3(0, -1, 0),
          0,
          1,
        ),
        hit = ray
          .intersectObject(mesh)
          .find(
            (h) => mesh.userData.stationTrianglePartIds[h.faceIndex] === partId,
          );
      assert(hit, `${owner.data.id}: missing adapted exact floor triangle`);
      assert(
        hit.point.distanceTo(world) < 1e-5,
        `${owner.data.id}: rendered top changed with frame/terrain (${hit.point.distanceTo(world)})`,
      );
      samples++;
    }
  }
  assert(samples > 3);
}

test('new rendered-floor references survive source compilation, rigid frame adaptation and cloned street attachments', () => {
  const { input, floor, part, data } = fixture(),
    original = structuredClone(data),
    beforeSource = structuredClone(input);
  assert.equal(
    data.parts.find((p) => p.id === part.id).renderFloorSurfaceId,
    floor.surfaceId,
  );
  assert.equal(
    'floorSurfaceId' in data.parts.find((p) => p.id === part.id),
    false,
  );
  validateRuntimeStation(data);
  const adapted = adaptSkyTrainStationFrame(data, routes),
    terrain = (x, z) => 17 + x * 0.0004 - z * 0.0003,
    attached = makeStationStreetAccess(
      adapted,
      terrain,
      (x, z) => terrain(x, z) + 0.15,
    ),
    attachedPart = attached.geometry.parts.find((p) => p.id === part.id),
    attachedFloor = attached.geometry.floors.find(
      (f) => f.id === floor.surfaceId,
    );
  assert.equal(attachedPart.renderFloorSurfaceId, floor.surfaceId);
  assert.deepEqual(
    attachedFloor,
    adapted.floors.find((f) => f.id === floor.surfaceId),
  );
  assert.notEqual(
    attachedFloor,
    adapted.floors.find((f) => f.id === floor.surfaceId),
  );
  assert.deepEqual(
    data,
    original,
    'frame and street attachment cannot mutate the input packet',
  );
  assert.deepEqual(
    input,
    beforeSource,
    'compilation cannot mutate source annotations',
  );
  for (const openWorld of [false, true]) {
    const owner = new SkyTrainStationOwner(
      adapted,
      terrain,
      'balanced',
      openWorld,
      (x, z) => terrain(x, z) + 0.15,
    );
    try {
      assertTopRays(owner, part.id, floor.surfaceId);
    } finally {
      owner.dispose();
    }
  }
});

test('rendered-floor metadata fails closed without reinterpreting pre-existing carve ownership annotations', () => {
  const { data, part, floor } = fixture();
  for (const change of [
    (p) => (p.renderFloorSurfaceId = 'unknown-floor'),
    (p) => (p.renderFloorSurfaceId = 7),
    (p) => (p.renderFloorSurfaceId = ''),
    (p) => (p.renderFloorSurfaceId = null),
    (p) => (p.role = 'wall'),
  ]) {
    const packet = structuredClone(data);
    change(packet.parts.find((p) => p.id === part.id));
    assert.throws(
      () => validateRuntimeStation(packet),
      /Invalid runtime station geometry/,
    );
  }
  const duplicate = structuredClone(data);
  duplicate.parts.push({
    ...duplicate.parts.find((p) => p.id === part.id),
    id: 'duplicate-exact-prism',
    renderFloorSurfaceId: floor.surfaceId,
  });
  assert.throws(() => validateRuntimeStation(duplicate));
  const carveOnly = structuredClone(data),
    tagged = carveOnly.parts.find((p) => p.id === part.id);
  delete tagged.renderFloorSurfaceId;
  tagged.floorSurfaceId = floor.surfaceId;
  validateRuntimeStation(carveOnly);
  const owner = new SkyTrainStationOwner(carveOnly, () => 0);
  try {
    assert(
      owner.group.children.find((m) =>
        m.userData.stationPartIds?.includes(part.id),
      ) instanceof THREE.InstancedMesh,
      'old carve ownership must not silently activate the new floor renderer',
    );
  } finally {
    owner.dispose();
  }
});

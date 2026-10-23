import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { stationCityOpenings, applySkyTrainWorldOpenings } = await import(
  cityModule('skytrain-world-openings')
);
const packet = (id) =>
  JSON.parse(readFileSync(`public/models/skytrain-stations/${id}.json`));
const ownerFor = (id) =>
  new SkyTrainStationOwner(packet(id), () => 0, 'balanced', true);
function contains(opening, point) {
  const [a, b, c, d] = opening.polygon.map((p) => new THREE.Vector3(...p)),
    center = a.clone().add(c).multiplyScalar(0.5),
    across = d.clone().sub(a).setY(0),
    along = b.clone().sub(a).setY(0),
    delta = new THREE.Vector3(...point).sub(center).setY(0),
    width = across.length(),
    length = along.length();
  return (
    point[1] >= opening.minY &&
    point[1] <= opening.maxY &&
    Math.abs(delta.dot(across.normalize())) < width / 2 &&
    Math.abs(delta.dot(along.normalize())) < length / 2
  );
}
test('authored flat farehall headspace removes the city slab seen above the actual walking floor', () => {
  const owner = ownerFor('waterfront');
  try {
    const floor = owner.data.floors.find(
        (f) => f.id === 'waterfront-expo-fare-hall',
      ),
      box = new THREE.Box3().setFromPoints(
        floor.vertices.map((p) => new THREE.Vector3(...p)),
      ),
      center = box.getCenter(new THREE.Vector3()),
      point = owner.toWorld([center.x, center.y + 0.22, center.z]),
      openings = stationCityOpenings(owner);
    assert(
      openings.some(
        (opening) =>
          opening.id === `${floor.id}-authored-room-clearance` &&
          contains(opening, point),
      ),
    );
    assert(
      !openings.some((opening) =>
        contains(opening, owner.toWorld([500, 0, 500])),
      ),
      'bounded clearances retain the surrounding city',
    );
  } finally {
    owner.dispose();
  }
});
test('one full bank aperture includes the space outside individual stair and escalator lanes', () => {
  const owner = ownerFor('waterfront');
  try {
    const part = owner.geometryData.parts.find(
        (p) => p.id === 'waterfront-expo-hall-bank-soffit',
      ),
      slab = owner.geometryData.parts.find(
        (p) => p.id === 'waterfront-expo-hall-bank-underslab',
      ),
      rotation = new THREE.Quaternion(...slab.quaternion),
      across = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
      point = new THREE.Vector3(...slab.position).addScaledVector(
        across,
        part.size[0] / 2 - 0.35,
      );
    point.y += 1.2;
    const world = owner.toWorld(point.toArray()),
      full = stationCityOpenings(owner),
      lanes = owner
        .terrainOpenings()
        .filter((opening) => opening.id.endsWith('-authored-opening'));
    assert(
      !lanes.some((opening) => contains(opening, world)),
      'fixture samples beyond the old individual lane cutouts',
    );
    assert(
      full.some(
        (opening) =>
          opening.id === 'waterfront-expo-hall-bank-authored-bank-clearance' &&
          contains(opening, world),
      ),
    );
  } finally {
    owner.dispose();
  }
});
test('existing city materials receive bounded room/bank uniforms while first-person station walls remain intact', () => {
  const owner = ownerFor('waterfront'),
    cityRoot = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry(),
    mesh = new THREE.Mesh(geometry, material);
  cityRoot.add(mesh);
  const station = owner.group.children.find(
      (object) => object.name === 'station-authored-cream-structure',
    ),
    previousStationHook = station.material.onBeforeCompile,
    previousStationKey = station.material.customProgramCacheKey(),
    patch = applySkyTrainWorldOpenings([cityRoot]);
  try {
    patch.update([owner]);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <clipping_planes_fragment>',
    };
    material.onBeforeCompile(shader, {});
    assert.equal(
      shader.uniforms.uStationOpeningCount.value,
      stationCityOpenings(owner).length,
    );
    assert(shader.fragmentShader.includes('discard'));
    assert.equal(station.material.onBeforeCompile, previousStationHook);
    assert.equal(station.material.customProgramCacheKey(), previousStationKey);
    owner.setCutaway(null);
    assert(
      owner.group.children
        .filter((object) => object.userData.stationOverhead)
        .every((object) => object.visible),
    );
  } finally {
    patch.dispose();
    geometry.dispose();
    material.dispose();
    owner.dispose();
  }
});
test('all seven geographic stations stay within the existing aperture and per-station GPU budgets', () => {
  const ids = [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
      'vancouver-city-centre',
      'yaletown-roundhouse',
    ],
    owners = ids.map(ownerFor),
    patch = applySkyTrainWorldOpenings([]);
  try {
    assert(
      owners.reduce(
        (count, owner) => count + stationCityOpenings(owner).length,
        0,
      ) <= 96,
    );
    assert(owners.every((owner) => stationCityOpenings(owner).length <= 48));
    assert.doesNotThrow(() => patch.update(owners));
    for (const owner of owners.filter((owner) => !owner.data.authoredInterior))
      assert.equal(stationCityOpenings(owner), owner.terrainOpenings());
  } finally {
    patch.dispose();
    owners.forEach((owner) => owner.dispose());
  }
});

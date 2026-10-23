import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import { actualTunnel, routes, station } from './helpers/skytrain-geometry.mjs';
const { SkyTrainRidePath } = await import(cityModule('skytrain-ride-path'));
const { stationWorldPose, trainStopFor } = await import(
  cityModule('skytrain-stations')
);
const { stationRailEnvelope } = await import(
  cityModule('skytrain-station-rail-envelope')
);
// Acceptance reads the exact publication packets. In-memory authoring
// fixtures are opt-in only and must not replace a deployed station here.
const dataFor = (id) => station(id);
function makePath(segment, changes = new Map(), terrain = cityElevation) {
  const data = [segment.from, segment.to].map(
      (id) => changes.get(id) ?? dataFor(id),
    ),
    poses = data.map((d) => {
      const stop = trainStopFor(d, segment.lineId, segment.direction),
        p = stationWorldPose(d, cityElevation, stop.position, stop.quaternion);
      return {
        position: new THREE.Vector3(...p.position),
        quaternion: new THREE.Quaternion(...p.quaternion),
        motionSign: stop.motionSign,
      };
    }),
    envelopes = data
      .map((d) =>
        stationRailEnvelope(
          d,
          segment.lineId,
          segment.direction,
          cityElevation,
        ),
      )
      .filter(Boolean);
  try {
    return new SkyTrainRidePath(
      routes,
      segment.lineId,
      segment.from,
      segment.to,
      ...poses,
      terrain,
      envelopes,
    );
  } catch (error) {
    error.message = `${segment.lineId}:${segment.from}→${segment.to}: ${error.message}`;
    error.stack = `${error.name}: ${error.message}`;
    throw error;
  }
}
const westboundWaterfront = routes.segments.find(
    (s) => s.from === 'burrard' && s.to === 'waterfront',
  ),
  stadiumApproach = routes.segments.find(
    (s) => s.from === 'granville' && s.to === 'stadium-chinatown',
  );

test('actual Waterfront deck and daylight Stadium use bounded rendered track structure with unchanged stops', () => {
  for (const segment of [westboundWaterfront, stadiumApproach]) {
    const path = makePath(segment),
      profile = path.terrainProfile;
    assert(profile.stationStructureSamples > 0);
    assert(profile.minimumTubeClearanceM >= 0.25);
    assert(profile.minimumStationRoofClearanceM >= 0.25);
    assert(path.sample(0).position.distanceTo(path.start.position) < 1e-6);
    assert(path.sample(1).position.distanceTo(path.end.position) < 1e-6);
    assert(profile.maximumPitchDegrees < 8);
  }
});

test('missing or displaced real trackbed cannot be replaced by a nearby ceiling or a station-name exemption', () => {
  const original = dataFor('stadium-chinatown'),
    envelope = stationRailEnvelope(
      original,
      'expo',
      stadiumApproach.direction,
      cityElevation,
    );
  assert(envelope && envelope.supportPartIds.length > 0);
  for (const move of [false, true]) {
    const changed = structuredClone(original),
      ids = new Set(envelope.supportPartIds);
    if (move)
      for (const part of changed.parts.filter((p) => ids.has(p.id)))
        part.position[0] += 100;
    else changed.parts = changed.parts.filter((p) => !ids.has(p.id));
    assert.throws(
      () =>
        makePath(stadiumApproach, new Map([['stadium-chinatown', changed]])),
      /preserve station stops/,
    );
  }
});

test('a physically low rendered station roof still rejects the real train envelope', () => {
  const changed = structuredClone(dataFor('waterfront'));
  for (const p of changed.parts.filter(
    (p) => /(?:roof|ceiling|soffit)/i.test(p.role) && p.material !== 'light',
  ))
    p.position[1] -= 2;
  assert.throws(
    () => makePath(westboundWaterfront, new Map([['waterfront', changed]])),
    /preserve station stops/,
  );
});

test('only the selected platform concrete guideway authorizes support and solid upper floors constrain its roof gap', () => {
  const changed = structuredClone(dataFor('waterfront')),
    stop = trainStopFor(changed, 'expo', westboundWaterfront.direction),
    platform = changed.platforms.find(
      (p) => p.line === 'expo' && p.direction === westboundWaterfront.direction,
    ),
    position = [...stop.position],
    bed = {
      id: `${platform.id}-approach-trackbed-test`,
      position: [position[0], position[1] - 0.3, position[2]],
      size: [2.9, 0.4, 10],
      yaw: 0,
      material: 'concrete',
      role: 'trackbed',
    },
    world = (point) =>
      new THREE.Vector3(
        ...stationWorldPose(changed, cityElevation, point, [0, 0, 0, 1])
          .position,
      ),
    rail = world(position),
    roof = world([position[0], position[1] + 3.65, position[2]]),
    envelope = () =>
      stationRailEnvelope(
        changed,
        'expo',
        westboundWaterfront.direction,
        cityElevation,
      );
  changed.parts = [bed];
  assert.equal(envelope().roofClearance(rail, roof), Infinity);
  for (const invalid of [
    { ...bed, id: 'unrelated-spare-track-approach-trackbed-test' },
    { ...bed, role: 'floor' },
    { ...bed, material: 'glass' },
  ]) {
    changed.parts = [invalid];
    assert.equal(envelope(), null);
  }
  changed.parts = [
    bed,
    {
      id: 'real-concourse-floor-above-track',
      position: [position[0], position[1] + 3.8, position[2]],
      size: [4, 0.2, 10],
      yaw: 0,
      material: 'concrete',
      role: 'floor',
    },
  ];
  assert(Math.abs(envelope().roofClearance(rail, roof) - 0.05) < 1e-6);
});

test('outside every exact source structure the raw terrain requirement remains strict', () => {
  const segment = westboundWaterfront,
    data = [segment.from, segment.to].map(dataFor),
    frames = data.map((d) => {
      const local = trainStopFor(d, segment.lineId, segment.direction),
        p = stationWorldPose(
          d,
          cityElevation,
          local.position,
          local.quaternion,
        );
      return {
        railY: p.position[1],
        envelope: stationRailEnvelope(
          d,
          segment.lineId,
          segment.direction,
          cityElevation,
        ),
      };
    });
  let outsideQueries = 0;
  const lowOutsideTerrain = (x, z) => {
    const supported = frames.some(
      ({ railY, envelope }) =>
        envelope &&
        envelope.roofClearance(
          new THREE.Vector3(x, railY, z),
          new THREE.Vector3(x, railY + 3.65, z),
        ) !== null,
    );
    if (supported) return cityElevation(x, z);
    outsideQueries++;
    return -100;
  };
  assert.throws(
    () => makePath(segment, new Map(), lowOutsideTerrain),
    /preserve station stops/,
  );
  assert(
    outsideQueries > 0,
    'the outside DEM is actually sampled rather than globally bypassed',
  );
});

test('all twelve directed routes emit only tunnel vertices below the unchanged raw terrain', () => {
  let directions = 0,
    vertices = 0;
  for (const segment of routes.segments) {
    const path = makePath(segment),
      tube = actualTunnel(path);
    try {
      for (const mesh of tube.group.children) {
        const p = mesh.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          assert(
            cityElevation(p.getX(i), p.getZ(i)) - p.getY(i) > 0.19,
            `${segment.from}→${segment.to}: real tube vertex ${i} breaks raw terrain`,
          );
          vertices++;
        }
      }
      directions++;
    } finally {
      tube.dispose();
    }
  }
  assert.equal(directions, 12);
  assert(vertices > 1000);
});

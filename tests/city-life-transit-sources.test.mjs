import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const sourceDir = join(root, 'tools/transit/city-life-sources');
const script = join(sourceDir, 'import_gtfs.py');
const snapshotFile = join(sourceDir, 'transit-source-snapshot.json');
const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
const evidence = JSON.parse(
  readFileSync(join(sourceDir, 'gtfs-selection-evidence.json'), 'utf8'),
);
const paths = new Map(snapshot.paths.map((path) => [path.pathId, path]));
const services = new Map(
  snapshot.services.map((service) => [service.serviceId, service]),
);
const core = snapshot.coreBoundsWgs84;
const inCore = ([lon, lat]) =>
  lon >= core.west &&
  lon <= core.east &&
  lat >= core.south &&
  lat <= core.north;
const python = (...args) =>
  spawnSync('python3', [script, ...args], { cwd: root, encoding: 'utf8' });

function validateModified(value, rideReady = false) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-transit-source-test-'));
  try {
    const filename = join(dir, 'snapshot.json');
    writeFileSync(filename, JSON.stringify(value));
    return python(
      '--validate',
      filename,
      ...(rideReady ? ['--require-ride-ready'] : []),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('offline source provenance separates retrieval/version/effective dates', () => {
  assert.equal(
    snapshot.baseRevision,
    '401569193ccda73e8f6a6fd96e4bdb144ef5a4c6',
  );
  assert.equal(snapshot.source.feedVersion, '26SEP_20261002');
  assert.equal(
    snapshot.source.zipSha256,
    '67fe970456c4640e030f7c991012e720f0b0e7d7af58a7ca3457b4ecd0650682',
  );
  assert.equal(snapshot.source.zipBytes, 16145585);
  assert.equal(evidence.sourceZipSha256, snapshot.source.zipSha256);
  assert.equal(snapshot.source.retrievedAtUtc, '2026-10-07T17:48:16Z');
  assert.equal(snapshot.source.effectiveStartDate, '2026-09-07');
  assert.equal(snapshot.source.effectiveEndDate, '2027-01-03');
  assert.equal(snapshot.source.feedPublishedDate, null);
  assert.equal(snapshot.source.serviceSelectionDate, '2026-10-07');
  assert.equal(snapshot.source.serviceTimezone, 'America/Vancouver');
  assert.equal(snapshot.attribution.officialMarksGranted, false);
  assert.match(
    snapshot.attribution.termsUrl,
    /^https:\/\/www\.translink\.ca\//,
  );
});

test('selected routes retain all core stops of all four chosen bus direction patterns', () => {
  const counts = {
    'bus-5:eastbound:regional': 14,
    'bus-5:westbound:regional': 14,
    'bus-6:eastbound:regional': 13,
    'bus-6:westbound:regional': 14,
  };
  const shapeIds = {
    'bus-5:eastbound:regional': '321184',
    'bus-5:westbound:regional': '321187',
    'bus-6:eastbound:regional': '321189',
    'bus-6:westbound:regional': '321191',
  };
  for (const [id, count] of Object.entries(counts)) {
    const service = services.get(id);
    assert.equal(service.orderedStops.length, count);
    assert.equal(service.sourceShapeId, shapeIds[id]);
    const sourceTimes = evidence.sourceRows.stopTimes
      .filter((row) => row.trip_id === service.sourceTripId)
      .sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    assert.deepEqual(
      service.orderedStops.map((stop) => stop.sourceStopId),
      sourceTimes.map((stop) => stop.stop_id),
    );
    assert.ok(service.orderedStops.every((stop) => inCore(stop.lonLat)));
    assert.deepEqual(service.servicePathIntervalM, [
      service.orderedStops[0].pathStationM,
      service.orderedStops.at(-1).pathStationM,
    ]);
  }
  const burrard = services
    .get('bus-5:westbound:regional')
    .orderedStops.find((stop) => stop.name === 'Burrard Station @ Bay 1');
  assert.equal(burrard.sourceStopId, '8535');
  assert.equal(burrard.stopCode, '50043');
  assert.equal(burrard.serviceStopId, 'bus-5:westbound:burrard-station-bay-1');
  assert.ok(!burrard.serviceStopId.includes(burrard.sourceStopId));
  assert.ok(
    evidence.selection.every(
      (selection) => selection.chosenActiveTripCount > 0,
    ),
  );
});

test('rail retains seven station entities, eight station-lines and sixteen direction platforms', () => {
  assert.equal(snapshot.stationEntities.length, 7);
  assert.equal(snapshot.stationLines.length, 8);
  const rail = snapshot.services.filter((service) => service.mode === 'rail');
  assert.equal(rail.flatMap((service) => service.orderedStops).length, 16);
  assert.deepEqual(
    services
      .get('expo:eastbound:regional')
      .orderedStops.map((stop) => stop.stationId),
    [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
    ],
  );
  assert.deepEqual(
    services
      .get('expo:westbound:regional')
      .orderedStops.map((stop) => stop.stationId),
    [
      'main-street-science-world',
      'stadium-chinatown',
      'granville',
      'burrard',
      'waterfront',
    ],
  );
  assert.deepEqual(
    services
      .get('canada:southbound:regional')
      .orderedStops.map((stop) => stop.stationId),
    ['waterfront', 'vancouver-city-centre', 'yaletown-roundhouse'],
  );
  assert.deepEqual(
    services
      .get('canada:northbound:regional')
      .orderedStops.map((stop) => stop.stationId),
    ['yaletown-roundhouse', 'vancouver-city-centre', 'waterfront'],
  );
  const waterfront = rail
    .flatMap((service) => service.orderedStops)
    .filter((stop) => stop.stationId === 'waterfront');
  assert.equal(new Set(waterfront.map((stop) => stop.stationLineId)).size, 2);
  assert.equal(new Set(waterfront.map((stop) => stop.serviceStopId)).size, 4);
  assert.deepEqual(waterfront.map((stop) => stop.sourcePlatformLabel).sort(), [
    'P1',
    'P2',
    'P4',
    'P5',
  ]);
  assert.equal(
    waterfront.find((stop) => stop.sourcePlatformLabel === 'P5').sourceStopId,
    '11303',
  );
  assert.equal(
    waterfront.find((stop) => stop.sourcePlatformLabel === 'P4').sourceStopId,
    '11302',
  );
  assert.notEqual(
    services.get('canada:southbound:regional').vehicleProfileId,
    services.get('expo:eastbound:regional').vehicleProfileId,
  );
  for (const service of rail) assert.equal(service.returnTrackCrossover, null);
  for (const row of evidence.sourceRows.stops)
    assert.ok(
      !/Olympic Village|VCC-Clark|SeaBus|West Coast Express/.test(
        row.stop_name,
      ),
    );
});

test('all retained shapes are source-backed, ordered, unsimplified and strictly core-bounded', () => {
  assert.equal(snapshot.paths.length, 8);
  assert.equal(
    snapshot.paths.reduce((total, path) => total + path.coordinates.length, 0),
    416,
  );
  for (const service of snapshot.services) {
    const path = paths.get(service.pathId);
    assert.equal(path.sourceShapeId, service.sourceShapeId);
    assert.ok(
      path.coordinates.length >= 30,
      'No two-stop straight-line substitution',
    );
    assert.equal(path.coordinates.length, path.cumulativeStationM.length);
    assert.equal(
      path.coordinates.length,
      path.sourceShapePointSequences.length,
    );
    assert.ok(path.coordinates.every(inCore));
    assert.equal(path.elevationM, null);
    assert.match(path.fullSourceShapeRowsSha256, /^[a-f0-9]{64}$/);
    for (let i = 1; i < path.cumulativeStationM.length; i++)
      assert.ok(path.cumulativeStationM[i] >= path.cumulativeStationM[i - 1]);
    for (let i = 1; i < service.orderedStops.length; i++)
      assert.ok(
        service.orderedStops[i].pathStationM >
          service.orderedStops[i - 1].pathStationM,
      );
    for (const stop of service.orderedStops) {
      assert.ok(
        stop.pathStationM >= 0 &&
          stop.pathStationM <= path.cumulativeStationM.at(-1) + 0.00001,
      );
      assert.ok(stop.shapeProjectionOffsetM <= 75);
      assert.equal(stop.elevationM, null);
      assert.equal(stop.doorSide, null);
      assert.equal(stop.surfaceId, null);
    }
    if (service.mode === 'rail') {
      assert.equal(path.sourceShapePointSequences[0], null);
      assert.equal(path.sourceShapePointSequences.at(-1), null);
      assert.match(path.clipping, /interpolated/);
    } else {
      assert.ok(path.sourceShapePointSequences.every(Number.isInteger));
      assert.ok(
        service.orderedStops[0].pathStationM > 0,
        'Bus source tail must remain explicit',
      );
    }
  }
});

test('two source-backed bus service cycles use shared stop projections, never raw shape endpoints', () => {
  assert.equal(snapshot.busContinuityEvidence.length, 4);
  const successor = new Map();
  for (const edge of snapshot.busContinuityEvidence) {
    const a = services.get(edge.fromServiceId).orderedStops.at(-1);
    const b = services.get(edge.toServiceId).orderedStops[0];
    assert.equal(a.sourceStopId, b.sourceStopId);
    assert.equal(a.sourceStopId, edge.example.sharedSourceStopId);
    assert.ok(edge.adjacentActiveTripPairCount >= 100);
    assert.ok(edge.example.scheduledLayoverSeconds >= 0);
    const block = evidence.busBlockExamples.find(
      (row) =>
        row.sourceBlockId === edge.example.sourceBlockId &&
        row.sourceServiceId === edge.example.sourceServiceId,
    );
    assert.ok(block);
    const fromIndex = block.orderedActiveTrips.findIndex(
      (row) => row.sourceTrip.trip_id === edge.example.fromTripId,
    );
    const fromTrip = block.orderedActiveTrips[fromIndex];
    const toTrip = block.orderedActiveTrips[fromIndex + 1];
    assert.equal(
      toTrip.sourceTrip.trip_id,
      edge.example.toTripId,
      'No intervening active block trip can be filtered away',
    );
    assert.equal(fromTrip.sourceTrip.shape_id, edge.fromSourceShapeId);
    assert.equal(toTrip.sourceTrip.shape_id, edge.toSourceShapeId);
    assert.equal(
      fromTrip.lastStopTime.stop_id,
      edge.example.sharedSourceStopId,
    );
    assert.equal(toTrip.firstStopTime.stop_id, edge.example.sharedSourceStopId);
    assert.ok(
      edge.sourceShapeEndpointGapM > 150 && edge.sourceShapeEndpointGapM < 181,
    );
    assert.equal(edge.planarJoinAtScheduledStop.projectionGapM, 0);
    assert.equal(edge.planarJoinAtScheduledStop.headingDifferenceDegrees, 0);
    assert.deepEqual(
      edge.planarJoinAtScheduledStop.fromProjectionLonLat,
      edge.planarJoinAtScheduledStop.toProjectionLonLat,
    );
    assert.equal(edge.runtimeContinuationEnabled, false);
    assert.equal(edge.requiresVehicleAndPassengerIdentityPreserved, true);
    successor.set(edge.fromServiceId, edge.toServiceId);
  }
  for (const start of successor.keys())
    assert.equal(successor.get(successor.get(start)), start);
});

test('stdlib importer handles calendar exceptions, extended times and monotonic projection', () => {
  const result = python('--self-test');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 6 tests/);
});

test('source-only validation passes independently and never says ride-ready', () => {
  const result = python('--validate', snapshotFile);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    sourceValidation: 'passed',
    rideReadinessChecked: false,
    rideReady: false,
  });
  assert.equal(snapshot.rideReady, false);
  assert.equal(snapshot.checks.stationGisPointVerification, 'not_run');
  assert.equal(snapshot.checks.officialStationMapInspection, 'not_run');
  assert.equal(snapshot.checks.webglAndSceneIntegration, 'not_run');
});

test('ride-ready mode fails closed on source-only physical geometry and endpoint continuity', () => {
  const result = python('--validate', snapshotFile, '--require-ride-ready');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ride-readiness rejected/);
  assert.match(
    result.stderr,
    /source-shape-tail continuation is not ride-ready/,
  );
  assert.match(result.stderr, /vehicle profile unresolved/);
  assert.match(
    result.stderr,
    /stop pose\/floor\/door\/boarding geometry unvalidated/,
  );
  assert.match(result.stderr, /endpoint policy unresolved/);
});

test('setting boarding flags cannot promote unresolved bus connectors to ride-ready', () => {
  const edited = structuredClone(snapshot);
  for (const service of edited.services) {
    service.boardingEnabled = true;
    service.endpointPolicyValidated = true;
    service.unresolved = [];
    service.vehicleProfileId = 'fixture-only-validated-profile';
    service.vehicleProfileStatus = 'fixture-only';
    for (const stop of service.orderedStops) {
      Object.assign(stop, {
        surfaceId: 'fixture-floor',
        levelId: 'fixture-level',
        elevationM: 0,
        doorSide: 'right',
        boardingZoneId: 'fixture-in',
        alightingZoneId: 'fixture-out',
        stopPoseStatus: 'validated',
      });
    }
  }
  for (const path of edited.paths)
    Object.assign(path, {
      geometryStatus: 'validated_lane_or_track_geometry',
      verticalProfileStatus: 'validated',
    });
  for (const key of [
    'roadLaneAndRailTrackGeometry',
    'stationEntranceFloorAndDoorAlignment',
    'webglAndSceneIntegration',
  ])
    edited.checks[key] = 'passed';
  const result = validateModified(edited, true);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /source-shape-tail continuation is not ride-ready/,
  );
  assert.ok(!result.stderr.includes('boarding disabled'));
});

test('validator rejects out-of-core geometry and raw-tail service interval mutation', () => {
  const outside = structuredClone(snapshot);
  outside.paths[0].coordinates[0] = [-124, 49.28];
  assert.match(validateModified(outside).stderr, /coordinates leave core/);
  const tails = structuredClone(snapshot);
  tails.services[0].servicePathIntervalM = [
    0,
    paths.get(tails.services[0].pathId).cumulativeStationM.at(-1),
  ];
  assert.match(validateModified(tails).stderr, /service interval must trim/);
});

test('source-only schema categorically rejects forged passed flags and invalid physical placeholders', () => {
  const forged = structuredClone(snapshot);
  forged.rideReady = true;
  for (const service of forged.services) {
    Object.assign(service, {
      boardingEnabled: true,
      endpointPolicyValidated: true,
      unresolved: [],
      vehicleProfileId: '',
      vehicleProfileStatus: 'validated',
    });
    for (const stop of service.orderedStops)
      Object.assign(stop, {
        surfaceId: '',
        levelId: '',
        elevationM: 'not-a-number',
        doorSide: 'wrong',
        boardingZoneId: '',
        alightingZoneId: '',
        stopPoseStatus: 'validated',
      });
  }
  for (const path of forged.paths)
    Object.assign(path, {
      geometryStatus: 'validated_lane_or_track_geometry',
      verticalProfileStatus: 'validated',
    });
  for (const edge of forged.busContinuityEvidence)
    Object.assign(edge, {
      runtimeContinuationEnabled: true,
      physicalConnectorStatus: 'validated',
    });
  for (const key of Object.keys(forged.checks)) forged.checks[key] = 'passed';
  const result = validateModified(forged, true);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /source-only schema cannot authorize ride readiness/,
  );
  assert.ok(!result.stdout.includes('"rideReady": true'));
});

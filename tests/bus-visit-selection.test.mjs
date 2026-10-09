import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const { busVisitSelectedAnchor } = await import(
  cityModule('bus-visit-selection')
);
const { passengerContractFromManifest } = await import(
  cityModule('city-life/vehicle-profile-adapter')
);
function snapshot(version, overrides = {}) {
  const manifest = JSON.parse(
    readFileSync(
      `public/models/blender/${version === 'v1' ? 'bus' : 'bus-v2'}/manifest.json`,
      'utf8',
    ),
  );
  const contract = passengerContractFromManifest(
    manifest,
    'city-bus-12m',
    'low-floor-bus-12m',
    'live-bus',
    'car',
    0,
  );
  return {
    aboard: false,
    viewAnchor: null,
    anchors: contract.anchors.map((value) => ({
      id: value.anchor.anchorId,
      kind: value.anchor.kind,
      datum: value.datum,
    })),
    ...overrides,
  };
}
test('panel boarding defaults resolve against each actual cabin, including a saved legacy choice on v2', () => {
  const old = snapshot('v1'),
    current = snapshot('v2');
  assert.equal(busVisitSelectedAnchor(old, null), 'main-aisle');
  assert.equal(busVisitSelectedAnchor(current, null), 'low-floor-aisle');
  assert.equal(
    busVisitSelectedAnchor(current, 'main-aisle'),
    'low-floor-aisle',
  );
  assert.equal(busVisitSelectedAnchor(old, 'low-floor-aisle'), 'main-aisle');
  assert.equal(busVisitSelectedAnchor(current, 'seat-24'), 'seat-24');
  assert.equal(
    busVisitSelectedAnchor(current, 'missing-seat'),
    'low-floor-aisle',
  );
});
test('panel previews retain a valid active view, recover invalid saved views, and handle absent anchors', () => {
  assert.equal(
    busVisitSelectedAnchor(
      snapshot('v2', { aboard: true, viewAnchor: 'seat-23' }),
      'seat-01',
    ),
    'seat-23',
  );
  assert.equal(
    busVisitSelectedAnchor(
      snapshot('v2', { aboard: true, viewAnchor: 'main-aisle' }),
      'seat-22',
    ),
    'seat-22',
  );
  assert.equal(
    busVisitSelectedAnchor(
      snapshot('v2', { aboard: true, viewAnchor: 'main-aisle' }),
      'missing',
    ),
    'low-floor-aisle',
  );
  assert.equal(
    busVisitSelectedAnchor(
      {
        aboard: false,
        viewAnchor: null,
        anchors: [{ id: 'seat-only', kind: 'seat', datum: 'pelvis' }],
      },
      null,
    ),
    'seat-only',
  );
  assert.equal(
    busVisitSelectedAnchor(
      { aboard: false, viewAnchor: null, anchors: [] },
      'main-aisle',
    ),
    null,
  );
  assert.equal(busVisitSelectedAnchor(null, null), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
import { composeBusV2 } from '../tools/assets/boardable-bus-v2/compose.mjs';
const { passengerContractFromManifest } = await import(
  cityModule('city-life/vehicle-profile-adapter')
);
const bind = (manifest, lod) =>
  passengerContractFromManifest(
    manifest,
    'city-bus-12m',
    'low-floor-bus-12m',
    'bus-v2-live',
    'car-0',
    lod,
  );

test('bus-v2: composed LOD0 and LOD1 bind the actual 23 seats and one safe standing anchor', () => {
  for (const lod of [0, 1]) {
    const m = composeBusV2();
    const c = bind(m, lod);
    assert.equal(c.anchors.filter((a) => a.datum === 'pelvis').length, 23);
    assert.equal(c.anchors.filter((a) => a.datum === 'feet').length, 1);
    assert.equal(c.assetRefs.exterior, 'city-bus-12m-exterior');
    assert.equal(c.assetRefs.interior, 'city-bus-12m-interior-v2');
    assert.ok(c.anchors.every((a) => a.anchor.vehicleId === 'bus-v2-live'));
    assert.equal(m.pathBase, 'repository-root');
    assert.equal(m.scope.runtimeIntegration, 'pending');
    assert.equal(m.vehicles[0].nonStandingRegions[0].standingAllowed, false);
    assert.equal(
      m.vehicles[0].reservedAccessibilityRegions[0].use,
      'reserved-seated-wheelchair',
    );
  }
});
test('bus-v2: the real adapter still rejects display-only exterior LOD2', () => {
  assert.throws(() => bind(composeBusV2(), 2), /passenger capable/);
});
test('bus-v2: accidentally exposing raised rear as standing fails closed', () => {
  const m = composeBusV2();
  m.vehicles[0].standingRegions.push(m.vehicles[0].nonStandingRegions[0]);
  assert.throws(() => bind(m, 0), /Insufficient standing head clearance/);
});
test('bus-v2: adapter rejects unresolved dependency asset IDs', () => {
  const m = composeBusV2();
  m.assets = m.assets.filter((a) => a.id !== 'city-bus-12m-exterior');
  assert.throws(() => bind(m, 0), /asset reference missing/);
});

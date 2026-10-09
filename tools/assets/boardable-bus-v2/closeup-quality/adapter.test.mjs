import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from '../../../../tests/helpers/city-modules.mjs';
import { composeCloseupQuality } from './compose.mjs';
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

test('bus-closeup-quality: composed LOD0 and LOD1 bind the actual 24 seats and one safe standing anchor', () => {
  for (const lod of [0, 1]) {
    const m = composeCloseupQuality();
    const c = bind(m, lod);
    assert.equal(c.anchors.filter((a) => a.datum === 'pelvis').length, 24);
    assert.equal(c.anchors.filter((a) => a.datum === 'feet').length, 1);
    assert.equal(c.assetRefs.exterior, 'city-bus-12m-exterior');
    assert.equal(c.assetRefs.interior, 'city-bus-12m-interior-v2-closeup');
    assert.ok(c.anchors.every((a) => a.anchor.vehicleId === 'bus-v2-live'));
    assert.equal(m.pathBase, 'repository-root');
    assert.ok(m.assets[1].lods[lod].file.startsWith('tools/assets/boardable-bus-v2/closeup-quality/exports/'));
    assert.equal(m.assets[1].lods[lod].triangles, [277040, 91504][lod]);
    assert.equal(m.scope.runtimeIntegration, 'pending');
    assert.equal(m.vehicles[0].nonStandingRegions[0].standingAllowed, false);
    assert.equal(
      m.vehicles[0].reservedAccessibilityRegions[0].use,
      'reserved-seated-wheelchair',
    );
  }
});
test('bus-closeup-quality: the real adapter still rejects display-only exterior LOD2', () => {
  assert.throws(() => bind(composeCloseupQuality(), 2), /passenger capable/);
});
test('bus-closeup-quality: accidentally exposing raised rear as standing fails closed', () => {
  const m = composeCloseupQuality();
  m.vehicles[0].standingRegions.push(m.vehicles[0].nonStandingRegions[0]);
  assert.throws(() => bind(m, 0), /Insufficient standing head clearance/);
});
test('bus-closeup-quality: adapter rejects unresolved dependency asset IDs', () => {
  const m = composeCloseupQuality();
  m.assets = m.assets.filter((a) => a.id !== 'city-bus-12m-exterior');
  assert.throws(() => bind(m, 0), /asset reference missing/);
});

test('bus-closeup-quality: actual adapter preserves inward priority-seat yaw and camera anchors', () => {
  for (const lod of [0, 1]) {
    const m = composeCloseupQuality();
    const c = bind(m, lod);
    const priority = m.vehicles[0].seats.filter(
      (s) => s.group === 'low-floor-priority-left',
    );
    assert.equal(priority.length, 3);
    for (const s of priority) {
      const a = c.anchors.find((a) => a.anchor.anchorId === s.seatId);
      assert.deepEqual(a.anchor.rotationQuaternionXYZW, s.facingQuaternionXYZW);
      assert.ok(a.anchor.rotationQuaternionXYZW[1] < -0.7);
      assert.deepEqual(a.cameraEyePointM, s.cameraEyePointM);
      assert.ok(a.cameraEyePointM[0] < a.anchor.translationM[0]);
    }
    assert.equal(
      c.anchors.filter((a) => a.anchor.anchorId.includes('stowed')).length,
      0,
    );
  }
});
test('bus-closeup-quality: adapter rejects a non-unit priority-seat rotation', () => {
  const m = composeCloseupQuality();
  m.vehicles[0].seats.at(-1).facingQuaternionXYZW = [0, -1, 0, 1];
  assert.throws(() => bind(m, 0), /Invalid metadata rotation/);
});

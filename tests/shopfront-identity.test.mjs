import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {
  SHOP_IDENTITIES,
  SHOP_ATLAS_SIZE,
  shopAtlasRect,
  shopIdentityFor,
  detailedShopPanels,
  createShopPanelBatch,
} = await import(cityModule('shopfront-identity'));

test('shop atlas regions have real gutters and source identity survives reordered data', () => {
  const regions = [];
  assert.equal(SHOP_ATLAS_SIZE, 1024, 'single bounded texture');
  assert.equal(new Set(SHOP_IDENTITIES.map((shop) => shop.name)).size, 6);
  for (let id = 0; id < SHOP_IDENTITIES.length; id++)
    for (const role of ['fascia', 'display', 'notice']) {
      const [x, y, w, h] = shopAtlasRect(id, role);
      assert.ok(x > 0 && y > 0 && x + w < 1 && y + h < 1);
      for (const [bx, by, bw, bh] of regions)
        assert.ok(
          x + w < bx || bx + bw < x || y + h < by || by + bh < y,
          'no cross-tile sampling at the base mip',
        );
      regions.push([x, y, w, h]);
    }
  const keys = Array.from({ length: 40 }, (_, i) => `source-${i}:edge-2:bay-4`);
  const before = new Map(keys.map((key) => [key, shopIdentityFor(key)]));
  for (const key of keys.reverse())
    assert.equal(shopIdentityFor(key), before.get(key));
  assert.equal(new Set(before.values()).size, 6);
});

test('detailed artwork stays within heritage relief, clear of the source wall and under the first sill', () => {
  const panels = detailedShopPanels(2, new THREE.Matrix4());
  assert.equal(panels.length, 3);
  const position = new THREE.PlaneGeometry(1, 1).getAttribute('position');
  for (const panel of panels)
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3()
        .fromBufferAttribute(position, i)
        .applyMatrix4(panel.matrix);
      assert.ok(p.x >= -1.625 && p.x <= 1.625);
      assert.ok(p.y >= 0 && p.y <= 3.1959);
      assert.ok(
        p.z > 0.0408 && p.z <= 1.2435,
        'display backing stays outside wall and behind glass',
      );
    }
  const transformed = detailedShopPanels(
    2,
    new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(40, 6, 18),
  );
  assert.ok(
    new THREE.Vector3()
      .setFromMatrixPosition(transformed[0].matrix)
      .distanceTo(new THREE.Vector3(40.478, 9.001, 18)) < 1e-6,
  );
});

test('all identities and roles share one instanced draw without a light or shadow pass', () => {
  const material = new THREE.MeshStandardMaterial();
  const panels = SHOP_IDENTITIES.flatMap((_, id) =>
    detailedShopPanels(id, new THREE.Matrix4().makeTranslation(id * 8, 0, 0)),
  );
  const mesh = createShopPanelBatch(panels, material);
  assert.equal(mesh.count, 18);
  assert.equal((mesh.geometry.index.count / 3) * mesh.count, 36);
  assert.equal(mesh.geometry.getAttribute('shopAtlasRect').count, 18);
  assert.equal(mesh.material, material);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.children.length, 0);
  assert.equal(mesh.geometry.groups.length, 0);
  for (const attribute of Object.values(mesh.geometry.attributes))
    assert.ok(Array.from(attribute.array).every(Number.isFinite));
  mesh.geometry.dispose();
  mesh.dispose();
  material.dispose();
});

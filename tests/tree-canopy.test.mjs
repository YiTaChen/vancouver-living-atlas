import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createCanopyGeometry, CANOPY_TRIANGLE_BUDGETS } = await import(
  cityModule('assets/tree-canopy')
);

for (const conifer of [false, true]) {
  for (const detail of ['medium', 'distant']) {
    test(`${conifer ? 'conifer' : 'broadleaf'} ${detail} preserves height/clearance and existing triangle budget`, () => {
      const a = createCanopyGeometry(conifer, detail),
        b = createCanopyGeometry(conifer, detail),
        position = a.getAttribute('position'),
        normal = a.getAttribute('normal'),
        color = a.getAttribute('color');
      assert.ok(
        position.count / 3 <=
          CANOPY_TRIANGLE_BUDGETS[conifer ? 'conifer' : 'broadleaf'][detail],
      );
      assert.equal(a.groups.length, 0, 'one existing draw, no per-lobe groups');
      assert.equal(a.userData.originalProceduralAsset, true);
      assert.ok(Math.abs(a.boundingBox.max.y - 1) < 1e-6);
      assert.ok(a.boundingBox.min.y >= 0.25);
      for (const attr of ['position', 'normal', 'color']) {
        assert.deepEqual(
          a.getAttribute(attr).array,
          b.getAttribute(attr).array,
        );
        assert.ok(a.getAttribute(attr).array.every(Number.isFinite));
        assert.equal(a.getAttribute(attr).count, position.count);
      }
      const p = new THREE.Vector3(),
        n = new THREE.Vector3();
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i);
        n.fromBufferAttribute(normal, i);
        assert.ok(
          Math.hypot(p.x, p.z) <= 0.285001,
          'crown must stay inside pre-existing clearance disk',
        );
        assert.ok(Math.abs(n.length() - 1) < 1e-5);
        for (const value of [color.getX(i), color.getY(i), color.getZ(i)])
          assert.ok(
            value > 0.5 && value <= 1.05,
            'subtle baked shade without overbright/black trees',
          );
      }
      const p0 = new THREE.Vector3(),
        p1 = new THREE.Vector3(),
        p2 = new THREE.Vector3();
      for (let i = 0; i < position.count; i += 3) {
        p0.fromBufferAttribute(position, i);
        p1.fromBufferAttribute(position, i + 1);
        p2.fromBufferAttribute(position, i + 2);
        const face = p1.sub(p0).cross(p2.sub(p0));
        assert.ok(face.lengthSq() > 1e-10, 'no degenerate canopy triangles');
        const vertexNormals = new THREE.Vector3();
        for (let k = 0; k < 3; k++)
          vertexNormals.add(n.fromBufferAttribute(normal, i + k));
        assert.ok(
          face.dot(vertexNormals) > 0,
          'front faces agree with shading normals',
        );
      }
      a.dispose();
      b.dispose();
    });
  }
}

test('crown shade preserves local foliage variation without an extra shader or texture', () => {
  for (const conifer of [false, true]) {
    const g = createCanopyGeometry(conifer),
      position = g.getAttribute('position'),
      colors = g.getAttribute('color');
    let low = 0,
      lowCount = 0,
      high = 0,
      highCount = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0.55) {
        low += colors.getY(i);
        lowCount++;
      }
      if (position.getY(i) > 0.85) {
        high += colors.getY(i);
        highCount++;
      }
    }
    assert.ok(lowCount > 0 && highCount > 0);
    assert.ok(high / highCount > low / lowCount + 0.05);
    assert.equal(g.getAttribute('uv'), undefined, 'no new texture sampling');
    g.dispose();
  }
});

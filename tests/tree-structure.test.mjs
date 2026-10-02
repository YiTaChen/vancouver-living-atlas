import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createTreeGeometry } = await import(cityModule('assets/tree-geometry'));

// These are the pre-change authored geometry costs, not relaxed global limits.
const previousTriangles = {
  broadleaf: { medium: 500, ultra: 2838 },
  conifer: { medium: 558, ultra: 3486 },
};
function leafTriangles(g) {
  const { position, normal, uv, color, aSolid } = g.attributes;
  const result = new Set();
  for (let i = 0; i < position.count; i += 3) {
    if (aSolid.getX(i)) continue;
    result.add(
      [position, normal, uv, color]
        .flatMap((a) =>
          Array.from(a.array.slice(i * a.itemSize, (i + 3) * a.itemSize)),
        )
        .join(','),
    );
  }
  return result;
}

for (const conifer of [false, true]) {
  for (const variant of [0, 1, 2]) {
    const name = `${conifer ? 'conifer' : 'broadleaf'} ${variant}`;
    test(`${name} keeps actual primary leaves and crown placement when changing detail`, () => {
      const medium = createTreeGeometry(conifer, variant, 'medium');
      const ultra = createTreeGeometry(conifer, variant, 'ultra');
      try {
        assert.deepEqual(
          medium.foliage.userData.primaryCrownAnchors,
          ultra.foliage.userData.primaryCrownAnchors,
          'primary branches must not move when secondary twigs are added',
        );
        assert.deepEqual(
          medium.foliage.userData.silhouetteReference,
          ultra.foliage.userData.silhouetteReference,
          'one shared normalization prevents whole-tree rescaling at LOD changes',
        );
        const mediumLeaves = leafTriangles(medium.foliage);
        const ultraLeaves = leafTriangles(ultra.foliage);
        assert.ok(mediumLeaves.size > 0);
        assert.ok(ultraLeaves.size > mediumLeaves.size);
        for (const leaf of mediumLeaves)
          assert.ok(
            ultraLeaves.has(leaf),
            'every medium leaf triangle retains its real position, normal, UV and tint',
          );
      } finally {
        for (const model of [medium, ultra])
          for (const g of Object.values(model)) g.dispose();
      }
    });

    test(`${name} retains clearance and the old geometry budget at both tiers`, () => {
      for (const detail of ['medium', 'ultra']) {
        const model = createTreeGeometry(conifer, variant, detail);
        try {
          let triangles = 0;
          const bounds = new THREE.Box3();
          for (const g of Object.values(model)) {
            bounds.union(g.boundingBox);
            triangles += g.attributes.position.count / 3;
            assert.equal(g.groups.length, 0, 'no extra material draws');
            for (const attr of Object.values(g.attributes))
              assert.ok(attr.array.every(Number.isFinite));
          }
          assert.ok(
            triangles <=
              previousTriangles[conifer ? 'conifer' : 'broadleaf'][detail],
          );
          assert.ok(bounds.min.y >= 0 && bounds.max.y <= 1.000001);
          assert.ok(bounds.max.y >= 0.99, 'preserve the source tree height');
          assert.ok(
            Math.max(
              bounds.max.x - bounds.min.x,
              bounds.max.z - bounds.min.z,
            ) <=
              0.46 + variant * 0.015 + 1e-6,
            'detail cannot expand the existing normalized crown envelope',
          );
          const p = model.foliage.attributes.position;
          const color = model.foliage.attributes.color;
          let bottomGreen = 0,
            bottomCount = 0,
            topGreen = 0,
            topCount = 0;
          for (let i = 0; i < p.count; i++) {
            if (p.getY(i) < 0.6) {
              bottomGreen += color.getY(i);
              bottomCount++;
            }
            if (p.getY(i) > 0.85) {
              topGreen += color.getY(i);
              topCount++;
            }
            for (const channel of [color.getX(i), color.getY(i), color.getZ(i)])
              assert.ok(channel > 0.5 && channel <= 1);
          }
          assert.ok(topCount && bottomCount);
          assert.ok(
            topGreen / topCount > bottomGreen / bottomCount,
            'crown tops remain brighter than lower interior foliage',
          );
        } finally {
          for (const g of Object.values(model)) g.dispose();
        }
      }
    });
  }
}

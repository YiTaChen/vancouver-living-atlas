import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  makeOlympicCauldron,
  disposeOlympicCauldron,
  OLYMPIC_CAULDRON_CONTRACT,
} = await import(cityModule('assets/olympic-cauldron'));

test('cauldron has four crossing arms, five elevated unlit mouths and a 10m grounded silhouette', () => {
  const group = makeOlympicCauldron();
  const bounds = new THREE.Box3().setFromObject(group);
  assert.equal(bounds.min.y, 0);
  assert.equal(bounds.max.y, 10);
  for (const extent of [
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z,
  ])
    assert(
      Math.abs(extent - 12) < 0.15,
      `expected published 12m width; received ${extent}`,
    );
  assert.equal(group.userData.cauldronArms.length, 4);
  const quadrants = new Set();
  for (const { foot, tip } of group.userData.cauldronArms) {
    quadrants.add(`${Math.sign(foot[0])},${Math.sign(foot[2])}`);
    assert.equal(foot[1], 0);
    assert(tip[1] > 8 && tip[1] < 10);
    assert(
      foot[0] * tip[0] < 0 && foot[2] * tip[2] < 0,
      'an arm must continue past the centre',
    );
    const t = -foot[0] / (tip[0] - foot[0]);
    assert(t > 0 && t < 1);
    assert(Math.abs(foot[2] + (tip[2] - foot[2]) * t) < 1e-6);
    assert(
      t * tip[1] > 5 && t * tip[1] < 7,
      'crossing should be below all burner mouths',
    );
  }
  assert.equal(quadrants.size, 4);
  const crystal = group.getObjectByName('olympic-cauldron/frosted-crystal');
  const panels = crystal.geometry.getAttribute('position');
  for (const arm of group.userData.authoringParts.slice(0, 4)) {
    const span = arm.ranges[0];
    for (let i = span.first; i < span.first + span.count; i++)
      assert(
        panels.getY(i) >= 0 && panels.getY(i) <= 8.650001,
        'glass panels must stay between their horizontal foot and burner cuts',
      );
  }
  const dark = group.getObjectByName(
    'olympic-cauldron/joints-and-unlit-burners',
  );
  const mouths = new Set();
  const p = dark.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getY(i) - 9.84) < 1e-5) mouths.add('central');
    if (Math.abs(p.getY(i) - 8.49) < 1e-5)
      mouths.add(`${Math.sign(p.getX(i))},${Math.sign(p.getZ(i))}`);
  }
  assert.equal(
    mouths.size,
    5,
    'all five burner wells have recessed dark bottoms',
  );
  assert.equal(OLYMPIC_CAULDRON_CONTRACT.state, 'unlit');
  disposeOlympicCauldron(group);
});

test('finite outward surface geometry uses three opaque texture-free batches and bounded memory', () => {
  const group = makeOlympicCauldron();
  assert.equal(group.children.length, 3);
  let triangles = 0,
    bytes = 0;
  for (const mesh of group.children) {
    assert(mesh.isMesh);
    assert.equal(mesh.geometry.groups.length, 0);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.opacity, 1);
    assert.equal(mesh.material.depthWrite, true);
    assert.equal(mesh.material.side, THREE.FrontSide);
    assert.equal(mesh.material.map, null);
    assert.equal(mesh.material.normalMap, null);
    assert.equal(mesh.material.emissiveIntensity, 1);
    assert.equal(mesh.material.emissive.getHex(), 0);
    const positions = mesh.geometry.getAttribute('position');
    const normals = mesh.geometry.getAttribute('normal');
    const colors = mesh.geometry.getAttribute('color');
    assert.equal(normals.count, positions.count);
    assert.equal(colors.count, positions.count);
    for (const attr of [positions, normals, colors]) {
      bytes += attr.array.byteLength;
      for (const value of attr.array) assert(Number.isFinite(value));
    }
    let nondegenerate = 0;
    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i);
      const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) nondegenerate++;
    }
    assert(nondegenerate / (positions.count / 3) > 0.98, mesh.name);
    triangles += positions.count / 3;
  }
  assert(triangles < 4500);
  assert(bytes < 500_000);
  assert.equal(group.userData.triangles, triangles);
  assert.equal(group.userData.geometryBytes, bytes);
  disposeOlympicCauldron(group);
});

test('each cauldron owns resources; disposal releases each one exactly once without affecting another', () => {
  const first = makeOlympicCauldron(),
    second = makeOlympicCauldron();
  let geometries = 0,
    materials = 0,
    otherDisposals = 0;
  first.children.forEach((mesh, i) => {
    assert.notEqual(mesh.geometry, second.children[i].geometry);
    assert.notEqual(mesh.material, second.children[i].material);
    mesh.geometry.addEventListener('dispose', () => geometries++);
    mesh.material.addEventListener('dispose', () => materials++);
    second.children[i].geometry.addEventListener(
      'dispose',
      () => otherDisposals++,
    );
  });
  disposeOlympicCauldron(first);
  disposeOlympicCauldron(first);
  assert.equal(geometries, 3);
  assert.equal(materials, 3);
  assert.equal(otherDisposals, 0);
  disposeOlympicCauldron(second);
  assert.equal(otherDisposals, 3);
});

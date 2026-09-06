import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { cityModule } from './helpers/city-modules.mjs';
const { makeRoadster } = await import(cityModule('assets/roadster'));
const { makeCockpit } = await import(cityModule('assets/cockpits'));
test('roadster fits the existing car footprint with finite open-cabin geometry and bounded draws', () => {
  const { group, update } = makeRoadster();
  let meshes = 0,
    triangles = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const p = o.geometry.attributes.position;
    assert([...p.array].every(Number.isFinite));
    triangles += (o.geometry.index?.count ?? p.count) / 3;
  });
  const b = new THREE.Box3().setFromObject(group),
    size = b.getSize(new THREE.Vector3());
  assert(size.x < 2.4 && size.z < 4.8 && size.y < 1.6);
  assert(meshes <= 20, `draws ${meshes}`);
  assert(triangles < 20000, `triangles ${triangles}`);
  const wheelGroups = group.children.filter((o) => 'front' in o.userData);
  assert.equal(wheelGroups.length, 4);
  update(4, 1);
  assert(
    wheelGroups.filter((o) => o.userData.front).every((o) => o.rotation.y > 0),
  );
  assert(
    wheelGroups
      .filter((o) => !o.userData.front)
      .every((o) => o.rotation.y === 0),
  );
  assert(wheelGroups.every((o) => o.children[0].rotation.x > 0));
  // Downward rays into the passenger cabin meet a low seat, not a roof/slab.
  group.updateMatrixWorld(true);
  const hits = new THREE.Raycaster(
    new THREE.Vector3(-0.44, 3, -0.15),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(group, true);
  assert(hits.length && hits[0].point.y < 0.75);
});
test('roadster cockpit preserves left-hand driving controls and independent resources', () => {
  const classic = makeCockpit('drive'),
    roadster = makeCockpit('drive', 'roadster');
  assert.equal(roadster.userData.layout, 'left-hand-drive');
  assert.equal(roadster.userData.variant, 'roadster');
  assert.notEqual(
    classic.userData.steeringWheel,
    roadster.userData.steeringWheel,
  );
  assert(roadster.userData.speedNeedle);
});
const source = readFileSync(
  new URL('../lib/city/navigation.ts', import.meta.url),
  'utf8',
);
const start = source.indexOf('  setCarModel('),
  end = source.indexOf('\n  keyDown =', start);
assert(start > 0 && end > start);
const code = ts.transpileModule(
  `export class Selection {${source.slice(start, end)}}`,
  { compilerOptions: { module: ts.ModuleKind.ESNext } },
).outputText;
const { Selection } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
test('car switching keeps driving pose speed zoom and bookmark and reuses model resources', () => {
  const s = new Selection();
  Object.assign(s, {
    carModel: 'classic',
    classicCar: new THREE.Group(),
    roadster: { group: new THREE.Group() },
    classicCockpit: new THREE.Group(),
    roadsterCockpit: new THREE.Group(),
    cockpits: {},
    position: new THREE.Vector3(40, 6, 90),
    yaw: 1.2,
    speed: 12,
    cameraDistances: { drive: 2 },
    bookmark: { id: 'retained' },
    updateCockpit() {},
    notifyCamera() {},
  });
  const before = [
    ...s.position.toArray(),
    s.yaw,
    s.speed,
    s.cameraDistances.drive,
    s.bookmark,
  ];
  for (let i = 0; i < 20; i++) {
    s.setCarModel('roadster');
    assert(s.roadster.group.visible && !s.classicCar.visible);
    assert.equal(s.cockpits.drive, s.roadsterCockpit);
    s.setCarModel('classic');
    assert(s.classicCar.visible && !s.roadster.group.visible);
    assert.equal(s.cockpits.drive, s.classicCockpit);
  }
  assert.deepEqual(
    [
      ...s.position.toArray(),
      s.yaw,
      s.speed,
      s.cameraDistances.drive,
      s.bookmark,
    ],
    before,
  );
});

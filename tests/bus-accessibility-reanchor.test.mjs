import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { BusAccessibility } = await import(cityModule('bus-accessibility'));
const metadata = {
  schemaVersion: 1,
  kneelDropM: 0.0762,
  representative: true,
  notFleetCertification: true,
  ramp: {
    nodeId: 'boarding-ramp',
    lengthM: 1.12,
    widthM: 0.86,
    hingeM: [-1.25, 0.36, 4.6],
    centerOffsetM: [0, 0, -0.15],
    rotationAxis: '+Z',
    stowedAngleRad: 0,
  },
  wheelNodeIds: [
    'wheel-front-left',
    'wheel-front-right',
    'wheel-rear-left',
    'wheel-rear-right',
  ],
};
function fixture() {
  const scene = new THREE.Group(),
    root = new THREE.Group(),
    ramp = new THREE.Group();
  scene.add(root);
  ramp.name = metadata.ramp.nodeId;
  ramp.position.fromArray(metadata.ramp.hingeM);
  root.add(ramp);
  const wheels = metadata.wheelNodeIds.map((name, i) => {
    const wheel = new THREE.Group();
    wheel.name = name;
    wheel.position.set(i % 2 ? 1.1 : -1.1, 0.5, i < 2 ? 3.1 : -3.1);
    root.add(wheel);
    return wheel;
  });
  const controller = BusAccessibility.create(
    root,
    metadata,
    () => ({ y: 0, surfaceId: 'ground', layer: 0 }),
    () => true,
    () => [],
  );
  assert(controller);
  return { root, ramp, wheels, controller };
}
function advance(controller, phase) {
  for (let i = 0; i < 200 && controller.snapshot().phase !== phase; i++)
    controller.update(0.05);
  assert.equal(controller.snapshot().phase, phase);
}
function sameMatrix(actual, expected) {
  actual.elements.forEach((value, i) =>
    assert(Math.abs(value - expected.elements[i]) < 1e-7),
  );
}

test('only an explicit stowed reanchor accepts a new stopped pose, preserving rig transforms through the next full ramp cycle', () => {
  const { root, ramp, wheels, controller } = fixture();
  try {
    root.position.set(12, 0, 5);
    root.rotation.y = 0.4;
    wheels[0].rotation.z = 0.31;
    root.updateWorldMatrix(true, true);
    assert.equal(controller.aligned, false);
    assert.equal(controller.deploy(true), false);
    assert.equal(controller.snapshot().error, 'bus-moved');
    const nodes = [root, ramp, ...wheels],
      before = nodes.map((node) => node.matrixWorld.clone());
    assert.equal(controller.reanchorStowed(), true);
    assert.equal(controller.aligned, true);
    assert.equal(controller.snapshot().error, null);
    nodes.forEach((node, i) => sameMatrix(node.matrixWorld, before[i]));
    assert.equal(controller.deploy(true), true);
    advance(controller, 'deployed');
    wheels.forEach((wheel, i) => sameMatrix(wheel.matrixWorld, before[i + 2]));
    assert.equal(controller.stow(true), true);
    advance(controller, 'stowed');
    nodes.forEach((node, i) => sameMatrix(node.matrixWorld, before[i]));
    controller.dispose();
    nodes.forEach((node, i) => sameMatrix(node.matrixWorld, before[i]));
    assert.equal(controller.reanchorStowed(), false);
  } finally {
    controller.dispose();
  }
});

test('reanchoring cannot release a deploying, deployed, retracting or raising ramp from its original ground proof', () => {
  const { root, controller } = fixture();
  try {
    assert.equal(controller.deploy(true), true);
    for (const phase of ['kneeling', 'deploying', 'deployed']) {
      advance(controller, phase);
      const before = root.matrixWorld.clone();
      assert.equal(controller.reanchorStowed(), false);
      assert.equal(controller.snapshot().phase, phase);
      sameMatrix(root.matrixWorld, before);
    }
    assert.equal(controller.stow(true), true);
    for (const phase of ['retracting', 'raising']) {
      advance(controller, phase);
      assert.equal(controller.reanchorStowed(), false);
      assert.equal(controller.snapshot().phase, phase);
    }
    advance(controller, 'stowed');
    assert.equal(controller.reanchorStowed(), true);
  } finally {
    controller.dispose();
  }
});

test('stowed reanchor rejects invalid/tilted/scaled roots and a modified ramp hinge without accepting drift', () => {
  for (const mutate of [
    ({ root }) => {
      root.position.x = NaN;
    },
    ({ root }) => {
      root.rotation.x = 0.1;
    },
    ({ root }) => {
      root.scale.y = 1.1;
    },
    ({ ramp }) => {
      ramp.position.x += 0.01;
    },
    ({ ramp }) => {
      ramp.rotation.z = 0.1;
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(f.controller.reanchorStowed(), false);
    assert.equal(f.controller.snapshot().phase, 'stowed');
    f.controller.dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
const {
  TransitDemoRuntime,
  transitDemoBusMetadata,
  createResearchTransitLayout,
} = await import(cityModule('city-life/transit-demo'));
const manifest = JSON.parse(
  await readFile(
    new URL('../tools/assets/boardable-bus/manifest.json', import.meta.url),
    'utf8',
  ),
);
const metadata = transitDemoBusMetadata(manifest);
const loader = new GLTFLoader();
async function readGLB(file) {
  const bytes = await readFile(
    new URL(`../tools/assets/boardable-bus/${file}`, import.meta.url),
  );
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
}
async function demo(options) {
  const [exterior, interior] = await Promise.all([
    readGLB(metadata.exteriorFile),
    readGLB(metadata.interiorFile),
  ]);
  return new TransitDemoRuntime(manifest, exterior, interior, options);
}

test('actual shipped GLTF clips plug outward, slide, and open a collision-clear bus aperture', async () => {
  const runtime = await demo();
  try {
    assert.equal(metadata.contract.anchors.length, 12);
    const front = runtime.vehicle.getObjectByName('door-right-front-a');
    assert.ok(front);
    for (
      let i = 0;
      i < 1000 && runtime.snapshot().service.phase !== 'opening';
      i++
    )
      runtime.update(0.05);
    assert.equal(runtime.snapshot().service.phase, 'opening');
    runtime.update(0.2);
    const partiallyOpen = runtime.snapshot();
    assert.equal(partiallyOpen.canBoard, false);
    assert.ok(partiallyOpen.doorProgress > 0 && partiallyOpen.doorProgress < 1);
    const atPlug = runtime.vehicle.worldToLocal(
      front.getWorldPosition(new THREE.Vector3()),
    );
    assert.ok(
      atPlug.x < -1.3,
      `door must actually plug outward, got ${atPlug.x}`,
    );
    assert.ok(Math.abs(atPlug.z - 3.9875) < 0.001);
    assert.equal(runtime.advanceToNextOpenStop(), true);
    const open = runtime.snapshot();
    assert.equal(open.doorsOpen, true);
    assert.equal(
      open.canBoard,
      true,
      'fresh GLTF aperture rays and actual floor must permit boarding',
    );
    const atOpen = runtime.vehicle.worldToLocal(
      front.getWorldPosition(new THREE.Vector3()),
    );
    assert.ok(
      atOpen.distanceTo(new THREE.Vector3(-1.39, 0.36, 3.3675)) < 0.001,
    );
  } finally {
    runtime.dispose();
  }
});

test('seated actor keeps manifest pelvis/camera anchors through bell, curved travel and terminal alighting', async () => {
  const runtime = await demo();
  try {
    assert.equal(
      runtime.board('seat-09'),
      false,
      'moving/closed bus cannot board',
    );
    assert.equal(runtime.advanceToNextOpenStop(), true);
    assert.equal(runtime.board('seat-09'), true);
    const initial = runtime.snapshot();
    assert.deepEqual(initial.passenger.anchor.translationM, [-0.83, 0.88, 2.1]);
    assert.equal(initial.passengerCount, 1);
    const camera = runtime.riderCameraPose();
    assert.ok(camera);
    const localEye = runtime.vehicle.worldToLocal(camera.position.clone());
    assert.ok(
      localEye.distanceTo(new THREE.Vector3(-0.83, 1.47, 2.125)) < 1e-8,
    );
    // Host may observe an Orbit camera instead, without invoking any mobility command.
    runtime.riderCameraPose();
    runtime.snapshot();
    assert.deepEqual(runtime.snapshot().passenger, initial.passenger);
    assert.equal(runtime.requestStop(), true);
    assert.equal(runtime.snapshot().service.bellRequested, true);
    assert.equal(runtime.advanceToNextOpenStop(), true);
    assert.equal(runtime.snapshot().service.bellRequested, false);
    assert.equal(runtime.snapshot().passenger.anchor.anchorId, 'seat-09');
    let maxError = 0,
      turned = false;
    for (
      let i = 0;
      i < 2000 && runtime.snapshot().service.phase !== 'terminal';
      i++
    ) {
      runtime.update(0.05);
      maxError = Math.max(maxError, runtime.snapshot().anchorErrorM);
      if (Math.abs(runtime.vehicle.quaternion.y) > 0.1) turned = true;
    }
    assert.equal(runtime.snapshot().service.phase, 'terminal');
    assert.equal(turned, true);
    assert.ok(maxError < 1e-7, `local anchor drift ${maxError}`);
    const terminal = runtime.snapshot();
    runtime.update(0.2);
    assert.equal(
      runtime.snapshot().service.pathStationM,
      terminal.service.pathStationM,
    );
    assert.equal(
      runtime.snapshot().passengerCount,
      1,
      'occupied terminal must hold, never recycle',
    );
    assert.equal(runtime.alight(), true);
    const exit = runtime.snapshot();
    assert.equal(exit.passenger.mode, 'walking');
    assert.equal(exit.passenger.floor.surfaceId, 'research-curb-3');
    assert.equal(exit.passengerCount, 0);
    assert.equal(exit.pendingTransfers, 0);
  } finally {
    runtime.dispose();
  }
});

test('standing feet datum, hidden pause and bounded resume preserve the exact passenger/service authority', async () => {
  const runtime = await demo();
  try {
    runtime.advanceToNextOpenStop();
    assert.equal(runtime.board('main-aisle'), true);
    assert.deepEqual(
      runtime.snapshot().passenger.anchor.translationM,
      [0, 0.36, 0],
    );
    runtime.setPaused(true);
    const before = runtime.snapshot();
    runtime.update(300);
    const after = runtime.snapshot();
    assert.deepEqual(after.service, before.service);
    assert.deepEqual(after.passenger, before.passenger);
    assert.equal(after.elapsedSeconds, before.elapsedSeconds);
    assert.equal(after.doorProgress, before.doorProgress);
    assert.equal(runtime.requestStop(), false);
    assert.equal(runtime.alight(), false);
    runtime.setPaused(false);
    runtime.update(300);
    assert.ok(
      runtime.snapshot().elapsedSeconds - before.elapsedSeconds <= 0.2000001,
    );
    runtime.advanceToNextOpenStop();
    assert.equal(runtime.alight(), true);
    runtime.dispose();
    runtime.dispose();
  } finally {
    runtime.dispose();
  }
});

test('source-backed layout fails closed without real surface/occupancy observations; invalid fresh floor blocks transfer', async () => {
  const layout = createResearchTransitLayout();
  layout.classification = 'verified-source-service';
  await assert.rejects(
    demo({ layout }),
    /fresh surface and occupancy validators/,
  );
  const runtime = await demo({
    validateTransfer: () => ({
      floorValid: false,
      zoneClear: true,
      lineOfSight: true,
    }),
  });
  try {
    runtime.advanceToNextOpenStop();
    assert.equal(runtime.snapshot().canBoard, false);
    assert.equal(runtime.board('seat-09'), false);
    assert.equal(runtime.snapshot().passenger.mode, 'walking');
    assert.equal(runtime.snapshot().passengerCount, 0);
  } finally {
    runtime.dispose();
  }
});

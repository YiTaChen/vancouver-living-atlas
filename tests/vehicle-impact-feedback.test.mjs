import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { ImpactFeedback, IMPACT_PARTICLE_CAPACITY } = await import(
  cityModule('vehicle-impact-feedback')
);
const hit = {
  point: [100, 4, -20],
  normal: [0, 0, 1],
  velocity: [0, 0, -20],
  kind: 'tree',
  severity: 0.7,
};

test('world-space impact feedback keeps one draw and fixed buffers under repeated hits and lower quality', () => {
  const scene = new THREE.Scene(),
    feedback = new ImpactFeedback(scene),
    geometry = feedback.points.geometry,
    material = feedback.points.material,
    position = geometry.getAttribute('position'),
    attributes = Object.values(geometry.attributes);
  try {
    assert.equal(scene.children.length, 1);
    assert.equal(feedback.stats().active, 0);
    assert.equal(feedback.stats().drawCalls, 0);
    const bytes = feedback.stats().bufferBytes;
    for (let i = 0; i < 1000; i++) feedback.emit(hit);
    assert.equal(feedback.stats().active, IMPACT_PARTICLE_CAPACITY);
    assert.equal(feedback.stats().drawCalls, 1);
    assert.equal(geometry.drawRange.count, 128);
    assert(
      position.getZ(0) > hit.point[2],
      'particles originate outside the actual impact surface',
    );
    feedback.update(1 / 60, new THREE.PerspectiveCamera(), 'balanced');
    assert.equal(feedback.stats().active, 64);
    assert.equal(feedback.stats().budget, 64);
    for (let i = 0; i < 100; i++) feedback.emit(hit);
    assert.equal(feedback.stats().active, 64);
    feedback.update(1 / 60, undefined, 'ultra');
    feedback.emit(hit);
    feedback.emit(hit);
    feedback.emit(hit);
    assert(feedback.stats().active > 64 && feedback.stats().active <= 128);
    assert.equal(feedback.stats().bufferBytes, bytes);
    assert.equal(feedback.points.geometry, geometry);
    assert.equal(feedback.points.material, material);
    assert.deepEqual(Object.values(geometry.attributes), attributes);
    assert.equal(scene.children.length, 1);
  } finally {
    feedback.dispose();
  }
});

test('wood, metallic scrapes and concrete impacts select chips, sparks and dust without allocating another material', () => {
  for (const [kind, expected] of [
    ['tree', 1],
    ['lamp', 2],
    ['guardrail', 2],
    ['concrete', 0],
  ]) {
    const feedback = new ImpactFeedback(new THREE.Scene());
    try {
      feedback.emit({ ...hit, kind });
      const kinds = feedback.points.geometry
        .getAttribute('aKind')
        .array.slice(0, feedback.stats().active);
      assert(kinds.includes(expected), kind);
      assert(kinds.every((value) => [0, 1, 2].includes(value)));
      assert.equal(feedback.stats().drawCalls, 1);
    } finally {
      feedback.dispose();
    }
  }
});

test('nonpositive/non-finite dt cannot advance particles, change quality or decay shake; real time settles everything', () => {
  const feedback = new ImpactFeedback(new THREE.Scene());
  try {
    feedback.emit(hit);
    const positions = feedback.points.geometry
        .getAttribute('position')
        .array.slice(),
      shake = feedback.shake,
      active = feedback.stats().active;
    for (const dt of [0, -1, Infinity, NaN]) {
      feedback.update(dt, undefined, 'low');
      assert.deepEqual(
        feedback.points.geometry.getAttribute('position').array,
        positions,
      );
      assert.equal(feedback.shake, shake);
      assert.equal(feedback.stats().budget, 128);
      assert.equal(feedback.stats().active, active);
    }
    feedback.update(0.1);
    assert(feedback.shake > 0 && feedback.shake < shake);
    assert.notDeepEqual(
      feedback.points.geometry.getAttribute('position').array,
      positions,
    );
    feedback.update(10);
    assert.equal(feedback.stats().active, 0);
    assert.equal(feedback.stats().drawCalls, 0);
    assert.equal(feedback.points.visible, false);
    assert.equal(feedback.shake, 0);
  } finally {
    feedback.dispose();
  }
});

test('invalid inputs never contaminate GPU attributes and continuous scrape admission is time bounded', () => {
  const feedback = new ImpactFeedback(new THREE.Scene());
  try {
    for (const change of [
      { point: [NaN, 0, 0] },
      { point: [1e100, 0, 0] },
      { normal: [0, 0, 0] },
      { normal: [Infinity, 0, 0] },
      { velocity: [0, NaN, 0] },
      { severity: Infinity },
      { scrape: NaN },
    ])
      assert.equal(feedback.emit({ ...hit, ...change }), false);
    assert.equal(feedback.stats().active, 0);
    assert.equal(feedback.shake, 0);
    feedback.emit({ ...hit, kind: 'guardrail', scrape: 0.8 });
    const active = feedback.stats().active;
    for (let i = 0; i < 1000; i++)
      feedback.emit({ ...hit, kind: 'guardrail', scrape: true });
    assert.equal(feedback.stats().active, active);
    feedback.update(0.05);
    feedback.emit({ ...hit, kind: 'guardrail', scrape: 0.8 });
    assert(feedback.stats().active > active);
    for (const attribute of Object.values(feedback.points.geometry.attributes))
      assert([...attribute.array].every(Number.isFinite));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(30, 2, 10);
    feedback.update(0.01, camera, 'high');
    assert.deepEqual(
      camera.position.toArray(),
      [30, 2, 10],
      'feedback never mutates the camera',
    );
  } finally {
    feedback.dispose();
  }
});

test('audio is never allocated until explicit opt-in, is bounded and releases nodes on mute/disposal', async () => {
  const previous = globalThis.AudioContext;
  const contexts = [];
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    oscillators = [];
    constructor() {
      contexts.push(this);
    }
    async resume() {
      this.state = 'running';
    }
    async close() {
      this.state = 'closed';
    }
    createOscillator() {
      const oscillator = {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
        start() {},
        stop() {},
        onended: null,
      };
      this.oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    }
  }
  globalThis.AudioContext = FakeAudioContext;
  const feedback = new ImpactFeedback(new THREE.Scene());
  try {
    feedback.emit(hit);
    feedback.update(1);
    feedback.emit(hit);
    assert.equal(contexts.length, 0);
    assert.equal(feedback.stats().audioAllocated, false);
    assert.equal(await feedback.setAudioEnabled(true), true);
    assert.equal(contexts.length, 1);
    for (let i = 0; i < 20; i++) {
      feedback.update(0.06);
      feedback.emit(hit);
    }
    assert.equal(feedback.stats().voices, 4);
    assert.equal(contexts[0].oscillators.length, 4);
    contexts[0].oscillators[0].onended();
    assert.equal(feedback.stats().voices, 3);
    assert.equal(await feedback.setAudioEnabled(false), true);
    assert.equal(feedback.stats().voices, 0);
    assert.equal(feedback.stats().audioEnabled, false);
    assert.equal(feedback.stats().audioAllocated, false);
    assert.equal(contexts[0].state, 'closed');
    feedback.update(1);
    feedback.emit(hit);
    assert.equal(contexts.length, 1);
    assert.equal(await feedback.setAudioEnabled(true), true);
    feedback.dispose();
    assert.equal(contexts[1].state, 'closed');
    assert.equal(await feedback.setAudioEnabled(true), false);
  } finally {
    feedback.dispose();
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});

test('disposal is idempotent and removes the sole render resource permanently', () => {
  const scene = new THREE.Scene(),
    feedback = new ImpactFeedback(scene);
  let geometries = 0,
    materials = 0;
  feedback.points.geometry.addEventListener('dispose', () => geometries++);
  feedback.points.material.addEventListener('dispose', () => materials++);
  feedback.emit(hit);
  feedback.dispose();
  feedback.dispose();
  feedback.update(1);
  assert.equal(feedback.emit(hit), false);
  assert.equal(feedback.stats().disposed, true);
  assert.equal(feedback.stats().drawCalls, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
});

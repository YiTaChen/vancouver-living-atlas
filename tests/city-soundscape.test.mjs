import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { CitySoundscape } = await import(cityModule('city-soundscape'));

class Param {
  value = 0;
  events = [];
  setValueAtTime(value) {
    this.value = value;
    this.events.push(value);
  }
  setTargetAtTime(value) {
    this.value = value;
    this.events.push(value);
  }
  exponentialRampToValueAtTime(value) {
    this.value = value;
    this.events.push(value);
  }
}
class Node {
  connected = false;
  stopped = false;
  onended = null;
  gain = new Param();
  frequency = new Param();
  pan = new Param();
  Q = new Param();
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  start() {
    this.started = true;
  }
  stop(when) {
    if (when === undefined) this.stopped = true;
  }
}
class Context {
  state = 'suspended';
  currentTime = 0;
  nodes = [];
  destination = new Node();
  resumes = 0;
  suspends = 0;
  closes = 0;
  node() {
    const node = new Node();
    this.nodes.push(node);
    return node;
  }
  createGain() {
    return this.node();
  }
  createBiquadFilter() {
    return this.node();
  }
  createStereoPanner() {
    return this.node();
  }
  createOscillator() {
    return this.node();
  }
  createBufferSource() {
    return this.node();
  }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume() {
    this.resumes++;
    this.state = 'running';
  }
  async suspend() {
    this.suspends++;
    this.state = 'suspended';
  }
  async close() {
    this.closes++;
    this.state = 'closed';
  }
}
const visibility = () => ({
  hidden: false,
  listeners: new Set(),
  addEventListener(_key, listener) {
    this.listeners.add(listener);
  },
  removeEventListener(_key, listener) {
    this.listeners.delete(listener);
  },
  change(hidden) {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  },
});
const frame = (now = 0, patch = {}) => ({
  now,
  listener: [0, 0, 0],
  yaw: 0,
  interior: false,
  shoreDistanceM: 0,
  harbourDistanceM: 0,
  greenery: 1,
  trains: [],
  ...patch,
});

test('constructing/updating is silent and unallocated until a user enable; mute/dispose releases every source', async () => {
  const ctx = new Context(),
    doc = visibility();
  let allocated = 0;
  const sound = new CitySoundscape({
    contextFactory: () => {
      allocated++;
      return ctx;
    },
    visibility: doc,
  });
  sound.update(frame());
  assert.equal(allocated, 0);
  assert.equal(sound.snapshot.allocated, false);
  assert.equal(await sound.setEnabled(true), true);
  sound.update(frame());
  assert.equal(allocated, 1);
  assert.equal(sound.snapshot.loops, 2);
  assert.equal(sound.snapshot.bufferBytes, 96000);
  await sound.setEnabled(false);
  assert.equal(sound.snapshot.loops, 0);
  assert.equal(sound.snapshot.voices, 0);
  assert.equal(sound.snapshot.bufferBytes, 0);
  assert.equal(ctx.state, 'closed');
  assert(ctx.nodes.every((node) => !node.connected));
  sound.dispose();
  sound.dispose();
  assert.equal(doc.listeners.size, 0);
  assert.equal(await sound.setEnabled(true), false);
});

test('visibility and engine suspension stop voices and loops; return reuses permission without replaying steps', async () => {
  const ctx = new Context(),
    doc = visibility();
  const sound = new CitySoundscape({
    contextFactory: () => ctx,
    visibility: doc,
  });
  await sound.setEnabled(true);
  sound.update(frame(0));
  sound.update(frame(1400));
  assert(sound.snapshot.voices > 0);
  sound.update(frame(1500, { interior: true }));
  assert(
    ctx.nodes.some((node) => node.gain.events.at(-1) === 0.07),
    'existing outdoor voices fade at the shared bus indoors',
  );
  doc.change(true);
  assert.equal(sound.snapshot.voices, 0);
  assert.equal(sound.snapshot.loops, 0);
  assert.equal(ctx.state, 'suspended');
  sound.update(frame(100000));
  assert.equal(sound.snapshot.loops, 0);
  doc.change(false);
  sound.update(frame(200000));
  assert.equal(
    sound.snapshot.voices,
    0,
    'bird timers restart instead of catching up',
  );
  assert.equal(ctx.state, 'running');
  sound.setPageActive(false);
  assert.equal(sound.snapshot.enabled, false);
  sound.setPageActive(true);
  assert.equal(sound.snapshot.enabled, true);
  sound.update(frame(200100, { listener: [NaN, 0, 0] }));
  assert.equal(sound.snapshot.loops, 0);
  assert.equal(sound.snapshot.voices, 0);
  sound.dispose();
});

test('a pending enable cannot recreate nodes after mute or disposal and unavailable audio is a recoverable result', async () => {
  const ctx = new Context();
  let resume;
  ctx.resume = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const sound = new CitySoundscape({
    contextFactory: () => ctx,
    visibility: null,
  });
  const enabled = sound.setEnabled(true);
  await sound.setEnabled(false);
  resume();
  assert.equal(await enabled, false);
  assert.equal(sound.snapshot.allocated, false);
  assert.equal(ctx.nodes.length, 0);
  sound.dispose();
  const unavailable = new CitySoundscape({
    contextFactory: () => {
      throw Error('unsupported');
    },
    visibility: null,
  });
  assert.equal(await unavailable.setEnabled(true), false);
  assert.equal(unavailable.snapshot.error, 'unavailable');
  assert.equal(unavailable.snapshot.requested, false);
  unavailable.dispose();
});

test('dense traffic and long frames remain bounded, quiet sources retire, zero volume does no audio work', async () => {
  const ctx = new Context();
  const sound = new CitySoundscape({
    contextFactory: () => ctx,
    visibility: null,
  });
  await sound.setEnabled(true);
  const trains = Array.from({ length: 200 }, (_, i) => ({
    id: `train:${i}`,
    position: [i, 0, 0],
    speedMps: 15,
  }));
  for (let i = 0; i < 500; i++)
    sound.update(
      frame(i * 1000, {
        trains,
        footsteps: {
          position: [i * 0.5, 0, 0],
          space: 'street',
          active: true,
          surface: 'wood',
        },
      }),
    );
  assert(sound.snapshot.loops <= 5);
  assert(sound.snapshot.voices <= 8);
  const quiet = {
    shoreDistanceM: Infinity,
    harbourDistanceM: Infinity,
    greenery: 0,
    trains: [],
  };
  sound.update(frame(500000, quiet));
  sound.update(frame(502000, quiet));
  assert.equal(sound.snapshot.loops, 0);
  sound.setVolume(0);
  const before = ctx.nodes.length;
  sound.update(frame(600000, { trains }));
  assert.equal(ctx.nodes.length, before);
  assert.equal(sound.snapshot.voices, 0);
  sound.setVolume(99);
  assert.equal(sound.snapshot.volume, 1);
  sound.setVolume(NaN);
  assert.equal(sound.snapshot.volume, 0);
  sound.dispose();
});

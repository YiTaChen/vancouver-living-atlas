import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { soundDistanceGain, soundPan, soundscapeMix, FootstepTracker } =
  await import(cityModule('soundscape-policy'));
const frame = (patch = {}) => ({
  now: 0,
  listener: [0, 0, 0],
  yaw: 0,
  interior: false,
  shoreDistanceM: 0,
  harbourDistanceM: 0,
  greenery: 1,
  trains: [],
  ...patch,
});

test('distance fades reject missing sources, remain continuous, and indoor ambient falls while aboard rail remains', () => {
  assert.equal(soundDistanceGain(Infinity, 0, 100), 0);
  assert.equal(soundDistanceGain(NaN, 0, 100), 0);
  assert.equal(soundDistanceGain(-10, 0, 100), 0);
  assert.equal(soundDistanceGain(0, 0, 100), 1);
  assert.equal(soundDistanceGain(100, 0, 100), 0);
  let previous = 1;
  for (let d = 0; d <= 100; d++) {
    const gain = soundDistanceGain(d, 0, 100);
    assert(gain <= previous && previous - gain < 0.016);
    previous = gain;
  }
  const outdoor = soundscapeMix(frame());
  const indoor = soundscapeMix(frame({ interior: true }));
  for (const channel of ['waves', 'gulls', 'birds', 'harbour'])
    assert(Math.abs(indoor[channel] / outdoor[channel] - 0.07) < 1e-8, channel);
  const aboard = {
    id: 'our-carriage',
    position: [0, 0, 0],
    speedMps: 15,
    aboard: true,
  };
  assert.equal(
    soundscapeMix(frame({ trains: [aboard] })).trains[0].gain,
    soundscapeMix(frame({ trains: [aboard], interior: true })).trains[0].gain,
  );
});

test('moving train mix selects nearest audible three, uses 3D distance and listener heading, rejects invalid sources', () => {
  assert.equal(soundPan([0, 0, 0], [5, 0, 0], 0), 1);
  assert.equal(soundPan([0, 0, 0], [5, 0, 0], Math.PI), -1);
  const trains = Array.from({ length: 100 }, (_, i) => ({
    id: `train-${i}`,
    position: [i * 4, 0, 0],
    speedMps: 12,
  }));
  trains.push({ id: 'bad', position: [NaN, 0, 0], speedMps: 9 });
  const mix = soundscapeMix(frame({ trains }));
  assert.equal(mix.trains.length, 3);
  assert(mix.trains.every((t) => t.id !== 'bad' && t.gain > 0));
  assert.equal(
    soundscapeMix(
      frame({
        trains: [{ id: 'underground', position: [0, -180, 0], speedMps: 18 }],
      }),
    ).trains[0].gain,
    0,
  );
  assert(
    soundscapeMix(
      frame({ trains: [{ id: 'x', position: [0, 0, 0], speedMps: 18 }] }),
    ).trains[0].gain >
      soundscapeMix(
        frame({ trains: [{ id: 'x', position: [0, 0, 0], speedMps: 0 }] }),
      ).trains[0].gain,
  );
});

test('steps follow accepted travel, preserve surface, and never sound from idle camera movement or being carried', () => {
  const tracker = new FootstepTracker();
  const samples = [];
  for (let i = 0; i < 40; i++) {
    const step = tracker.sample(
      frame({
        now: i * 100,
        listener: [i * 5, 0, 0],
        footsteps: {
          position: [i * 0.3, 0, 0],
          space: 'carriage-local:a',
          surface: 'metal',
          active: true,
        },
      }),
    );
    if (step) samples.push(step);
  }
  assert(samples.length >= 8 && samples.length <= 13);
  assert(samples.every((step) => step.surface === 'metal' && step.gain > 0));
  for (let i = 40; i < 80; i++)
    assert.equal(
      tracker.sample(
        frame({
          now: i * 100,
          listener: [i * 5, 0, 0],
          footsteps: {
            position: [11.7, 0, 0],
            space: 'carriage-local:a',
            surface: 'metal',
            active: true,
          },
        }),
      ),
      null,
    );
  assert.equal(
    tracker.sample(
      frame({
        now: 8100,
        footsteps: {
          position: [20, 0, 0],
          space: 'world',
          surface: 'sand',
          active: false,
        },
      }),
    ),
    null,
  );
});

test('teleports, hidden gaps, invalid positions, space changes and reverse time reset cadence without bursts', () => {
  const tracker = new FootstepTracker();
  const walk = (now, x, space = 'world') =>
    tracker.sample(
      frame({
        now,
        footsteps: {
          position: [x, 0, 0],
          space,
          surface: 'pavement',
          active: true,
        },
      }),
    );
  assert.equal(walk(0, 0), null);
  assert.equal(walk(100, 0.7), null);
  assert.equal(walk(200, 200), null);
  assert.equal(walk(201, 200.1, 'new-placement'), null);
  assert.equal(walk(8000, 220), null);
  assert.equal(walk(7900, 220.5), null);
  assert.equal(walk(8100, NaN), null);
  assert.equal(walk(8200, 220.9), null);
  tracker.reset();
  assert.equal(walk(8300, 221), null);
});

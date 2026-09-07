import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const {
  createFlight,
  stepFlight,
  setFlightCruise,
  setFlightHover,
  crashFlight,
  validLanding,
} = await import(cityModule('flight-state'));
const input = { pitch: 0, roll: 0, yaw: 0, descend: false };
const water = () => ({ kind: 'water', height: 0 });
const land = () => ({ kind: 'land', height: 0 });
function run(s, seconds, i = input, world = water) {
  for (let t = 0; t < seconds * 60; t++) stepFlight(s, i, 1 / 60, world);
}
test('floatplane needs a water run and cannot hover at zero airspeed', () => {
  const s = createFlight('seaplane', 0, 0, 0);
  s.power = 1;
  run(s, 2, { ...input, pitch: 1 });
  assert.equal(s.phase, 'grounded');
  run(s, 12, { ...input, pitch: 0.5 });
  assert.equal(s.phase, 'airborne');
  assert(s.speed > 27);
  assert(s.y > 5);
  s.power = 0;
  s.speed = 0;
  s.y = 100;
  run(s, 1);
  assert(s.stalled);
  assert(s.y < 100);
});
test('helicopter lifts vertically, hovers and descends with X', () => {
  const s = createFlight('helicopter', 0, 0, 0);
  s.power = 0.8;
  run(s, 5, input, land);
  assert(s.y > 10);
  assert.equal(s.speed, 0);
  setFlightHover(s, true);
  const y = s.y;
  run(s, 8, input, land);
  assert(Math.abs(s.y - y) < 0.3);
  setFlightHover(s, false);
  run(s, 3, { ...input, descend: true }, land);
  assert(s.y < y - 2);
});
test('landing surface and vertical impact rules distinguish aircraft', () => {
  assert(!validLanding('helicopter', 'water'));
  assert(!validLanding('seaplane', 'land'));
  assert(validLanding('seaplane', 'beach'));
  const s = createFlight('helicopter', 0, 1, 0);
  s.phase = 'airborne';
  s.vy = -4;
  run(s, 0.3, input, water);
  assert.equal(s.phase, 'crashed');
  const a = createFlight('helicopter', 0, 0.02, 0);
  a.phase = 'airborne';
  a.vy = -4;
  stepFlight(a, input, 1 / 60, land);
  assert(a.impact > 0.5);
});
test('cruise moves smoothly and accident age is independent of scene clock', () => {
  const s = createFlight('seaplane', 0, 200, 0);
  s.phase = 'airborne';
  s.speed = 45;
  setFlightCruise(s, true);
  s.attached = false;
  stepFlight(s, input, 1 / 60, water);
  assert(Math.hypot(s.x, s.z) < 2);
  run(s, 10);
  assert(Math.hypot(s.x, s.z) > 300);
  crashFlight(s);
  run(s, 8);
  assert(Math.abs(s.crashAge - 8) < 0.02);
  assert.equal(s.cruise, false);
});
test('push lowers the nose, pull raises it; beach takeoff needs a longer run', () => {
  const push = createFlight('seaplane', 0, 400, 0),
    pull = createFlight('seaplane', 0, 400, 0);
  for (const s of [push, pull]) {
    s.phase = 'airborne';
    s.speed = 45;
    s.power = 0.8;
  }
  run(push, 2, { ...input, pitch: -1 });
  run(pull, 2, { ...input, pitch: 1 });
  assert(push.y < 400);
  assert(pull.y > 400);
  const sea = createFlight('seaplane', 0, 0, 0),
    sand = createFlight('seaplane', 0, 0, 0);
  sea.power = sand.power = 1;
  run(sea, 7, { ...input, pitch: 0.5 });
  run(sand, 7, { ...input, pitch: 0.5 }, () => ({ kind: 'beach', height: 0 }));
  assert(sea.speed > sand.speed);
  run(sand, 15, { ...input, pitch: 0.5 }, () => ({ kind: 'beach', height: 0 }));
  assert.equal(sand.phase, 'airborne');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { drivingYawDelta } = await import(cityModule('driving-steering'));
const { advanceBoat, initialBoatState } = await import(cityModule('boat-physics'));

test('car left/right steering moves toward that side in forward and reverse at any heading', () => {
  for (const heading of [0, 1.2, -2.4]) for (const speed of [-5, 5, 21, 60]) {
    for (const turn of [-1, 1]) {
      let yaw = heading, x = 0, z = 0;
      for (let i = 0; i < 30; i++) {
        yaw += drivingYawDelta(turn, speed, 1 / 60);
        x += Math.sin(yaw) * speed / 60;
        z += Math.cos(yaw) * speed / 60;
      }
      const left = x * Math.cos(heading) - z * Math.sin(heading);
      const longitudinal = x * Math.sin(heading) + z * Math.cos(heading);
      assert(left * turn > 0, 'lateral displacement must match steering');
      assert(longitudinal * speed > 0, 'travel must remain in the selected direction');
      assert((yaw-heading) * turn * speed > 0, 'reverse body yaw, not wheel input');
    }
  }
});

test('boat retains correct left/right reverse steering with rudder animation input unchanged', () => {
  const world = { canOccupy: () => true, at: () => ({ id: 'sea' }) };
  for (const heading of [0, 1.2, -2.4]) for (const thrust of [-1, 1]) {
    for (const turn of [-1, 1]) {
      const state = initialBoatState();
      state.yaw = heading;
      for (let i = 0; i < 240; i++) advanceBoat(state, { thrust, turn, neutral: false }, 1/60, world);
      const left = state.x * Math.cos(heading) - state.z * Math.sin(heading);
      const longitudinal = state.x * Math.sin(heading) + state.z * Math.cos(heading);
      assert(left * turn > 0);
      assert(longitudinal * thrust > 0);
      assert(state.rudder * turn > 0, 'rudder input must not be inverted');
      assert((state.yaw-heading) * turn * thrust > 0);
    }
  }
});

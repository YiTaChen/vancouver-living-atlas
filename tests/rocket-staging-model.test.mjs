import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { createRocket, ROCKET_CONFIGS } = await import(
  cityModule('rocket-state')
);
const { createRocketModel, disposeRocketObject } = await import(
  cityModule('assets/rocket')
);

test('spent booster separates continuously, falls behind, and exposes an upper-stage engine on both rockets', () => {
  for (const kind of ['small', 'large']) {
    const state = createRocket(kind, 20, 30000, -10);
    const model = createRocketModel(kind);
    model.build(1);
    model.stage(state);
    const engine = model.upper.getObjectByName('Upper-stage vacuum engine');
    assert.equal(engine.visible, false);
    state.boosterAttached = false;
    state.stage = 'separating';
    state.separation = {
      time: 30,
      flightTime: 25,
      position: { ...state.position },
      velocity: { x: 0, y: 1200, z: 0 },
      attitude: { pitch: 0, roll: 0 },
    };
    state.elapsed = 30;
    model.stage(state);
    assert(
      model.booster.position.length() < 1e-8,
      'no mesh teleport at separation',
    );
    assert.equal(engine.visible, true);
    state.elapsed = 32;
    state.position.y += 2600;
    model.stage(state);
    assert(
      model.booster.position.y < -200,
      'booster preserves initial momentum while upper stage accelerates away',
    );
    assert(
      model.booster.quaternion.angleTo(new THREE.Quaternion()) > 0.1,
      'spent booster visibly tumbles',
    );
    assert.equal(
      model.upper.position.y,
      0,
      'surviving vehicle stays on the physical trajectory',
    );
    model.fire(1, 32);
    const nozzle = model.flame.position.y + ROCKET_CONFIGS[kind].height * 0.16;
    assert(Math.abs(nozzle - ROCKET_CONFIGS[kind].height * 0.418) < 1e-8);
    state.elapsed = 54;
    model.stage(state);
    assert.equal(
      model.booster.visible,
      false,
      'discarded booster has a bounded visual lifetime',
    );
    disposeRocketObject(model.group);
  }
});

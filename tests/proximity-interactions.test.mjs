import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { ProximityInteractionController, shouldHandleInteractionKey } =
  await import(cityModule('proximity-interactions'));
const seat = (id, point, patch = {}) => ({
  id,
  kind: 'seat',
  action: 'sit',
  anchor: [point[0], point[1] + 0.9, point[2]],
  proximityPoint: point,
  range: 3,
  execute: () => true,
  ...patch,
});

test('selection uses physical range, deterministic ties, explicit priority and bounded hysteresis', () => {
  const c = new ProximityInteractionController();
  let rows = [seat('b', [2, 0, 0]), seat('a', [1, 0, 0])];
  c.registerProvider('benches', () => rows);
  assert.equal(c.update([1.4, 0, 0]).id, 'a');
  assert.equal(c.update([1.6, 0, 0]).id, 'a', 'small changes do not flicker');
  assert.equal(c.update([1.8, 0, 0]).id, 'b');
  rows = [
    seat('a', [1, 0, 0]),
    seat('stand', [2, 0, 0], { action: 'stand', priority: 100 }),
  ];
  assert.equal(c.update([1, 0, 0]).action, 'stand');
  assert.equal(
    c.update([2, 4, 0]),
    null,
    'a different floor is outside 3D range',
  );
  rows = [seat('z', [1, 0, 0]), seat('a', [-1, 0, 0])];
  c.clear();
  assert.equal(
    c.update([0, 0, 0]).id,
    'a',
    'tie does not depend on provider array order',
  );
  c.dispose();
});

test('executing requeries the same target and action, rejecting moved, occupied, occluded or replaced objects', () => {
  const c = new ProximityInteractionController();
  const calls = [];
  let allowed = true;
  let point = [1, 0, 0];
  let action = 'sit';
  let range = 3;
  c.registerProvider('world', () => [
    seat('one', point, {
      action,
      range,
      canInteract: () => allowed,
      execute: () => {
        calls.push(action);
        return true;
      },
    }),
    seat('other', [2, 0, 0], {
      execute: () => {
        calls.push('wrong');
        return true;
      },
    }),
  ]);
  c.update([0, 0, 0]);
  point = [8, 0, 0];
  assert.equal(c.execute(), false);
  assert.deepEqual(
    calls,
    [],
    'out-of-range selected target never dispatches another object',
  );
  point = [1, 0, 0];
  c.update([0, 0, 0]);
  range = 0.5;
  assert.equal(
    c.execute(),
    false,
    'a changed interaction range is revalidated',
  );
  range = 3;
  c.update([0, 0, 0]);
  allowed = false;
  assert.equal(
    c.execute(),
    false,
    'provider occupancy/occlusion is checked at action time',
  );
  allowed = true;
  c.update([0, 0, 0]);
  action = 'stand';
  assert.equal(
    c.execute(),
    false,
    'a stale sit prompt does not execute a replacement stand action',
  );
  assert.equal(c.update([0, 0, 0]).action, 'stand');
  assert.equal(c.execute(), true);
  assert.deepEqual(calls, ['stand']);
  assert.equal(
    c.snapshot(),
    null,
    'successful action clears the old affordance',
  );
  assert.equal(c.execute(), false, 'one selected action dispatches only once');
  c.dispose();
});

test('dispatch uses fresh callbacks and copied positions and refuses reentrant actions', () => {
  const c = new ProximityInteractionController();
  const calls = [];
  let version = 'first';
  c.registerProvider('scene', () => {
    const queryVersion = version;
    return [
      seat('one', [0, 0, 1], {
        execute: () => {
          calls.push(queryVersion);
          assert.equal(
            c.execute(),
            false,
            'nested dispatch cannot invoke a second action',
          );
          return true;
        },
      }),
    ];
  });
  const origin = [0, 0, 0];
  const snapshot = c.update(origin);
  origin[0] = 100;
  snapshot.anchor[0] = 100;
  version = 'current';
  assert.equal(c.execute(), true);
  assert.deepEqual(calls, ['current']);
  assert.equal(c.update([0, 0, 0]).anchor[0], 0);
  c.dispose();
});

test('providers reusing a descriptor cannot mutate the selected action in place', () => {
  const c = new ProximityInteractionController();
  const calls = [];
  const mutable = seat('one', [0, 0, 1], {
    execute() {
      calls.push('sit');
      return true;
    },
  });
  c.registerProvider('scene', () => [mutable]);
  c.update([0, 0, 0]);
  mutable.action = 'stand';
  mutable.execute = () => {
    calls.push('stand');
    return true;
  };
  assert.equal(
    c.snapshot().action,
    'sit',
    'selection describes the last query',
  );
  assert.equal(c.execute(), false, 'changed action requires a fresh prompt');
  assert.deepEqual(calls, []);
  assert.equal(c.update([0, 0, 0]).action, 'stand');
  assert.equal(c.execute(), true);
  assert.deepEqual(calls, ['stand']);
  c.dispose();
});

test('invalid/ambiguous candidates and broken optional providers fail closed without disabling valid providers', () => {
  const c = new ProximityInteractionController();
  c.registerProvider('broken', () => {
    throw new Error('optional object not ready');
  });
  c.registerProvider('mixed', () => [
    seat('duplicate', [0, 0, 0]),
    seat('duplicate', [0, 0, 0]),
    seat('nan', [NaN, 0, 0]),
    seat('negative', [0, 0, 0], { range: -1 }),
    seat('guard', [0, 0, 0], {
      canInteract() {
        throw new Error('gone');
      },
    }),
    seat('valid', [0, 0, 2]),
  ]);
  assert.equal(c.update([0, 0, 0]).id, 'valid');
  assert.equal(c.update([Infinity, 0, 0]), null);
  assert.equal(c.execute(), false);
  c.dispose();
});

test('provider unregister, disabled inputs, disposal and callback failures cannot leave actionable stale prompts', () => {
  const c = new ProximityInteractionController();
  const provider = () => [
    seat('one', [1, 0, 0], {
      execute() {
        throw new Error('owner disposed');
      },
    }),
  ];
  const unregister = c.registerProvider('owner', provider);
  assert.throws(() => c.registerProvider('owner', provider), /unique/);
  c.update([0, 0, 0]);
  assert.equal(c.execute(), false);
  assert.equal(c.snapshot(), null);
  c.update([0, 0, 0]);
  assert.equal(c.update([0, 0, 0], false), null);
  assert.equal(c.execute(), false);
  c.update([0, 0, 0]);
  unregister();
  unregister();
  assert.equal(c.snapshot(), null);
  assert.equal(c.execute(), false);
  c.registerProvider('owner', provider);
  c.dispose();
  c.dispose();
  assert.equal(c.update([0, 0, 0]), null);
  assert.equal(c.execute(), false);
  const lateUnregister = c.registerProvider('late', provider);
  lateUnregister();
});

test('F shortcut ignores repeats, modifiers, IME, prevented events and editable/modal targets', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  class ElementFixture {
    constructor(blocked) {
      this.blocked = blocked;
    }
    closest(selector) {
      assert.match(selector, /contenteditable/);
      assert.match(selector, /dialog/);
      return this.blocked ? this : null;
    }
  }
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: ElementFixture,
  });
  try {
    const event = { code: 'KeyF', key: 'f', target: new ElementFixture(false) };
    assert.equal(shouldHandleInteractionKey(event), true);
    assert.equal(
      shouldHandleInteractionKey({ ...event, code: '', key: 'f' }),
      true,
    );
    for (const flag of [
      'repeat',
      'isComposing',
      'altKey',
      'ctrlKey',
      'metaKey',
      'shiftKey',
      'defaultPrevented',
    ])
      assert.equal(
        shouldHandleInteractionKey({ ...event, [flag]: true }),
        false,
        flag,
      );
    assert.equal(
      shouldHandleInteractionKey({
        ...event,
        target: new ElementFixture(true),
      }),
      false,
    );
    assert.equal(
      shouldHandleInteractionKey({ ...event, code: 'KeyE', key: 'e' }),
      false,
    );
  } finally {
    if (saved) Object.defineProperty(globalThis, 'Element', saved);
    else delete globalThis.Element;
  }
});

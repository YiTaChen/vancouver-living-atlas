import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { CityInteractions, projectInteractionAnchor } = await import(
  cityModule('city-interactions')
);

function fixture() {
  const previous = new Map(
    ['window', 'document', 'Element'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  class Element {
    constructor(editing = false) {
      this.editing = editing;
    }
    closest() {
      return this.editing ? this : null;
    }
  }
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { hidden: false });
  for (const [key, value] of Object.entries({ window, document, Element }))
    Object.defineProperty(globalThis, key, { value, configurable: true });
  const focused = [];
  const e = {
    disposed: false,
    pageSuspended: false,
    cabinDisplayActive: false,
    settings: { mode: 'walk' },
    data: {},
    camera: new THREE.PerspectiveCamera(60, 1, 0.08, 100),
    renderer: { domElement: { focus: (options) => focused.push(options) } },
    navigation: {
      mode: 'walk',
      position: new THREE.Vector3(),
      walkSeat: null,
      walkingHeight() {
        return this.position.y;
      },
    },
  };
  e.camera.position.set(0, 1.6, 4);
  e.camera.lookAt(0, 1.1, 0);
  let rows = [];
  const actions = [];
  const host = new CityInteractions(e);
  host.seats.interactionCandidates = () => rows;
  const views = [];
  host.onChange = (view) => views.push(view);
  host.setInputEnabled(true);
  const candidate = (patch = {}) => ({
    id: 'test-seat:1',
    kind: 'seat',
    action: 'sit',
    anchor: [0, 1.1, 0],
    proximityPoint: [0, 0, 0],
    range: 1.85,
    execute() {
      actions.push(this.action);
      return true;
    },
    ...patch,
  });
  const key = (patch = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { key: 'f', code: 'KeyF', repeat: false, ...patch });
    window.dispatchEvent(event);
    return event;
  };
  return {
    host,
    e,
    window,
    document,
    Element,
    focused,
    actions,
    views,
    candidate,
    key,
    setRows: (value) => {
      rows = value;
    },
    dispose() {
      host.dispose();
      for (const [key, descriptor] of previous)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    },
  };
}

test('the real window F listener dispatches once, ignores modified/repeated/editor input and is removed on dispose', () => {
  const f = fixture();
  try {
    let seated = false;
    const updateRows = () =>
      f.setRows([
        f.candidate({
          action: seated ? 'stand' : 'sit',
          execute() {
            f.actions.push(this.action);
            seated = !seated;
            updateRows();
            return true;
          },
        }),
      ]);
    updateRows();
    f.host.update(performance.now(), true);
    assert.equal(f.views.at(-1).snapshot.action, 'sit');
    for (const patch of [
      { repeat: true },
      { isComposing: true },
      { shiftKey: true },
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
      { key: 'g', code: 'KeyG' },
    ])
      assert.equal(f.key(patch).defaultPrevented, false);
    const editor = new Event('keydown', { cancelable: true });
    Object.assign(editor, { key: 'f', code: 'KeyF' });
    Object.defineProperty(editor, 'target', { value: new f.Element(true) });
    f.window.dispatchEvent(editor);
    assert.equal(editor.defaultPrevented, false);
    assert.deepEqual(f.actions, []);
    assert.equal(f.key().defaultPrevented, true);
    assert.deepEqual(f.actions, ['sit']);
    assert.deepEqual(f.focused, [{ preventScroll: true }]);
    assert.equal(f.views.at(-1).snapshot.action, 'stand');
    assert.equal(f.key({ repeat: true }).defaultPrevented, false);
    assert.deepEqual(f.actions, ['sit']);
    assert.equal(f.key().defaultPrevented, true);
    assert.deepEqual(f.actions, ['sit', 'stand']);
    f.host.dispose();
    assert.equal(f.key().defaultPrevented, false);
    assert.deepEqual(f.actions, ['sit', 'stand']);
  } finally {
    f.dispose();
  }
});

test('host-level modal/mode/page guards block both F and touch dispatch and can resume without a stale action', () => {
  const f = fixture();
  try {
    f.setRows([f.candidate()]);
    for (const [block, restore] of [
      [() => f.host.setInputEnabled(false), () => f.host.setInputEnabled(true)],
      [
        () => {
          f.e.pageSuspended = true;
        },
        () => {
          f.e.pageSuspended = false;
        },
      ],
      [
        () => {
          f.document.hidden = true;
        },
        () => {
          f.document.hidden = false;
        },
      ],
      [
        () => {
          f.e.cabinDisplayActive = true;
        },
        () => {
          f.e.cabinDisplayActive = false;
        },
      ],
      [
        () => {
          f.e.placement = { mode: 'walk' };
        },
        () => {
          f.e.placement = null;
        },
      ],
      [
        () => {
          f.e.settings.mode = 'drive';
        },
        () => {
          f.e.settings.mode = 'walk';
        },
      ],
      [
        () => {
          f.e.contextLost = true;
        },
        () => {
          f.e.contextLost = false;
        },
      ],
      [
        () => {
          f.e.disposed = true;
        },
        () => {
          f.e.disposed = false;
        },
      ],
    ]) {
      f.host.update(performance.now(), true);
      assert.equal(f.views.at(-1).snapshot.action, 'sit');
      const count = f.actions.length;
      block();
      assert.equal(f.host.interact(), false);
      assert.equal(f.key().defaultPrevented, false);
      assert.equal(f.actions.length, count);
      f.host.update(performance.now(), true);
      assert.equal(f.views.at(-1).snapshot, null);
      restore();
      f.host.update(performance.now(), true);
      assert.equal(f.views.at(-1).snapshot.action, 'sit');
    }
    assert.equal(f.host.interact(), true);
    assert.deepEqual(f.actions, ['sit']);
  } finally {
    f.dispose();
  }
});

test('touch and F revalidate player position, availability and the displayed identity/action before dispatch', () => {
  const f = fixture();
  try {
    f.setRows([f.candidate()]);
    f.host.update(performance.now(), true);
    f.e.navigation.position.set(10, 0, 0);
    assert.equal(
      f.host.interact(),
      false,
      'moving out of range rejects a stale prompt',
    );
    f.e.navigation.position.set(0, 0, 0);
    f.host.update(performance.now(), true);
    f.setRows([f.candidate({ canInteract: () => false })]);
    assert.equal(
      f.host.interact(),
      false,
      'a newly claimed seat cannot be used',
    );
    for (const replacement of [{ id: 'test-seat:2' }, { action: 'stand' }]) {
      f.setRows([f.candidate()]);
      f.host.update(performance.now(), true);
      f.setRows([f.candidate(replacement)]);
      assert.equal(
        f.host.interact(),
        false,
        'the rendered prompt cannot silently dispatch a replacement',
      );
      assert.deepEqual(f.actions, []);
    }
    f.setRows([f.candidate()]);
    f.host.update(performance.now(), true);
    const rendered = f.views.at(-1).snapshot;
    f.setRows([f.candidate({ id: 'test-seat:2' })]);
    f.host.update(performance.now(), true);
    assert.equal(
      f.host.interact(rendered),
      false,
      'a delayed React tap keeps the identity it originally rendered',
    );
    assert.deepEqual(f.actions, []);
  } finally {
    f.dispose();
  }
});

test('all host providers choose a farther visible seat over a nearer seat behind the camera', () => {
  for (const provider of ['world', 'skytrain', 'bus']) {
    const f = fixture();
    try {
      const camera = f.e.camera;
      camera.position.set(0, 1.24, 0);
      camera.lookAt(0, 1.24, 1);
      const rows = [
        f.candidate({
          id: `${provider}:behind`,
          anchor: [0, 1.1, -0.4],
          proximityPoint: [0, 0, -0.4],
        }),
        f.candidate({
          id: `${provider}:visible`,
          anchor: [0, 1.1, 1.3],
          proximityPoint: [0, 0, 1.3],
        }),
      ];
      if (provider === 'world') f.setRows(rows);
      else if (provider === 'skytrain')
        f.e.skyTrainTravel = {
          active: true,
          interactionOrigin: [0, 0, 0],
          interactionCandidates: () => rows,
        };
      else
        f.e.busVisit = {
          aboard: true,
          interactionOrigin: [0, 0, 0],
          interactionCandidates: () => rows,
        };
      f.host.update(performance.now(), true);
      const rendered = f.views.at(-1).snapshot;
      assert.equal(rendered.id, `${provider}:visible`);
      assert.ok(f.views.at(-1).screen);
      camera.lookAt(0, 1.24, -1);
      assert.equal(
        f.host.interact(rendered),
        false,
        'turning toward another seat cannot dispatch the old mobile prompt',
      );
      assert.deepEqual(f.actions, []);
      assert.equal(f.views.at(-1).snapshot.id, `${provider}:behind`);
      assert.equal(f.key().defaultPrevented, true);
      assert.deepEqual(f.actions, ['sit']);
    } finally {
      f.dispose();
    }
  }
});

test('subscription cleanup preserves other consumers and releases every listener on disposal', () => {
  const f = fixture();
  try {
    const one = [],
      two = [];
    const unsubscribeOne = f.host.subscribe((view) => one.push(view));
    const unsubscribeTwo = f.host.subscribe((view) => two.push(view));
    f.setRows([f.candidate()]);
    f.host.update(performance.now(), true);
    assert.equal(one.at(-1).snapshot.action, 'sit');
    assert.equal(two.at(-1).snapshot.action, 'sit');
    const firstCount = one.length;
    unsubscribeOne();
    unsubscribeOne();
    f.setRows([f.candidate({ action: 'stand' })]);
    f.host.update(performance.now(), true);
    assert.equal(one.length, firstCount);
    assert.equal(two.at(-1).snapshot.action, 'stand');
    assert.equal(
      f.views.at(-1).snapshot.action,
      'stand',
      'legacy onChange remains independent',
    );
    f.host.setInputEnabled(false);
    assert.equal(two.at(-1).snapshot, null);
    const secondCount = two.length;
    f.host.dispose();
    f.host.clear();
    assert.equal(
      two.length,
      secondCount,
      'disposed hosts retain no subscriber callbacks',
    );
    unsubscribeTwo();
  } finally {
    f.dispose();
  }
});

test('future object and person providers share host visibility rules and can unregister cleanly', () => {
  const f = fixture();
  try {
    f.e.camera.position.set(0, 1.24, 0);
    f.e.camera.lookAt(0, 1.24, 1);
    for (const [kind, action] of [
      ['object', 'use'],
      ['person', 'talk'],
    ]) {
      const unregister = f.host.registerProvider(`future-${kind}`, () => [
        f.candidate({
          id: `${kind}:behind`,
          kind,
          action,
          anchor: [0, 1.1, -0.3],
          proximityPoint: [0, 0, -0.3],
        }),
        f.candidate({
          id: `${kind}:visible`,
          kind,
          action,
          anchor: [0, 1.1, 1.2],
          proximityPoint: [0, 0, 1.2],
        }),
      ]);
      f.host.update(performance.now(), true);
      assert.equal(f.views.at(-1).snapshot.id, `${kind}:visible`);
      assert.equal(f.views.at(-1).snapshot.action, action);
      unregister();
      unregister();
      f.host.update(performance.now(), true);
      assert.equal(f.views.at(-1).snapshot, null);
      const count = f.actions.length;
      assert.equal(f.key().defaultPrevented, false);
      assert.equal(
        f.actions.length,
        count,
        'removed provider callbacks cannot execute',
      );
    }
  } finally {
    f.dispose();
  }
});

test('street proximity uses the rendered foot height instead of the navigation elevation seed', () => {
  const f = fixture();
  try {
    f.e.navigation.position.y = 20;
    f.e.navigation.walkingHeight = () => 0;
    f.setRows([f.candidate()]);
    f.host.update(performance.now(), true);
    assert.equal(f.views.at(-1).snapshot.id, 'test-seat:1');
    assert.equal(f.host.interact(), true);
    assert.deepEqual(f.actions, ['sit']);
  } finally {
    f.dispose();
  }
});

test('projected prompts respect the camera frustum and first-person standing has a usable fallback', () => {
  const f = fixture();
  try {
    const camera = f.e.camera;
    camera.position.set(0, 1.24, 0);
    camera.lookAt(0, 1.24, 1);
    const centered = projectInteractionAnchor(camera, [0, 1.24, 2]);
    assert.ok(Math.abs(centered.x - 0.5) < 1e-8);
    assert.ok(Math.abs(centered.y - 0.5) < 1e-8);
    for (const point of [
      [0, 1.24, -2],
      [30, 1.24, 2],
      [0, 1.24, 101],
      [NaN, 1, 1],
    ])
      assert.equal(projectInteractionAnchor(camera, point), null);
    f.setRows([f.candidate({ action: 'stand' })]);
    f.host.update(performance.now(), true);
    assert.deepEqual(f.views.at(-1).screen, { x: 0.5, y: 0.65 });
    assert.equal(f.key().defaultPrevented, true);
    assert.deepEqual(f.actions, ['stand']);
    f.setRows([f.candidate()]);
    f.host.update(performance.now(), true);
    assert.equal(
      f.views.at(-1).snapshot,
      null,
      'an offscreen sit is excluded before selection',
    );
    assert.equal(
      f.host.interact(),
      false,
      'offscreen sit prompts have no invisible action target',
    );
  } finally {
    f.dispose();
  }
});

test('active SkyTrain uses the passenger origin and publication throttles avoid redundant React work', () => {
  const f = fixture();
  try {
    f.e.navigation.position.set(100, 50, 100);
    f.e.skyTrainTravel = {
      active: true,
      interactionOrigin: [0, 0, 0],
      interactionCandidates: () => [f.candidate({ id: 'train-seat:1' })],
    };
    const at = performance.now();
    f.host.update(at);
    assert.equal(f.views.at(-1).snapshot.id, 'train-seat:1');
    const count = f.views.length;
    f.host.update(at + 16);
    f.host.update(at + 34);
    assert.equal(
      f.views.length,
      count,
      'an unchanged projected target is not republished',
    );
    f.e.camera.position.x += 0.2;
    f.host.update(at + 50);
    assert.equal(
      f.views.length,
      count,
      'position updates respect the publication interval',
    );
    f.host.update(at + 68);
    assert.equal(f.views.length, count + 1);
    f.e.skyTrainTravel.interactionOrigin = [10, 0, 0];
    assert.equal(
      f.host.interact(),
      false,
      'train movement uses its latest passenger origin',
    );
  } finally {
    f.dispose();
  }
});

test('moving bus uses its passenger origin for both F and delayed mobile dispatch', () => {
  const f = fixture();
  try {
    f.e.navigation.position.set(99, 50, 99);
    let x = 0,
      seated = false;
    f.e.busVisit = {
      aboard: true,
      get interactionOrigin() {
        return [x, 0, 0];
      },
      interactionCandidates: () => [
        f.candidate({
          id: 'bus:seat-01',
          action: seated ? 'stand' : 'sit',
          anchor: [x, 1.1, 0],
          proximityPoint: [x, 0, 0],
          execute() {
            seated = !seated;
            f.actions.push(this.action);
            return true;
          },
        }),
      ],
    };
    f.host.update(performance.now(), true);
    const rendered = f.views.at(-1).snapshot;
    assert.equal(rendered.id, 'bus:seat-01');
    x = 24;
    f.e.camera.position.x += 24;
    f.e.camera.lookAt(24, 1.1, 0);
    assert.equal(
      f.host.interact(rendered),
      true,
      'same moving seat remains usable',
    );
    assert.equal(f.views.at(-1).snapshot.action, 'stand');
    assert.equal(
      f.host.interact(rendered),
      false,
      'old sit prompt cannot stand',
    );
    assert.equal(f.key().defaultPrevented, true);
    assert.deepEqual(f.actions, ['sit', 'stand']);
    f.e.busVisit.aboard = false;
    f.e.busVisit.interactionCandidates = () => [];
    assert.equal(f.key().defaultPrevented, false);
  } finally {
    f.dispose();
  }
});

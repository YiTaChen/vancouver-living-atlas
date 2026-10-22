import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { StreetNavigation } = await import(cityModule('navigation'));
const { VehicleImpactWorld } = await import(cityModule('vehicle-impact-world'));
const { VehicleCondition } = await import(cityModule('vehicle-condition'));
const {
  createTesla,
  stepTesla,
  TESLA_DEFAULT_SHAPE: teslaShape,
} = await import(cityModule('tesla-state'));
const { TeslaWorld, fixedFacesSource, triangleFace } = await import(
  cityModule('tesla-world')
);

function fixture({
  trees = [{ x: 0, y: 0, z: 3.2, h: 4, conifer: false }],
  lamps = [],
  rails = [],
} = {}) {
  const scene = new THREE.Scene(),
    roads = new THREE.Group(),
    camera = new THREE.PerspectiveCamera();
  scene.add(roads);
  const lampBreaks = [],
    treeSyncs = [];
  const e = {
    scene,
    roads,
    camera,
    elevation: () => 0,
    disposed: false,
    settings: { trees: true, quality: 'balanced' },
    data: { streetLampPoints: lamps },
    traffic: {
      breakLamp: (index) => {
        lampBreaks.push(index);
        return true;
      },
    },
    detailedTrees: { trees, syncBroken: () => treeSyncs.push(true) },
  };
  for (const rail of rails) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...rail.size),
      new THREE.MeshStandardMaterial(),
    );
    mesh.position.fromArray(rail.position);
    mesh.name = rail.name;
    roads.add(mesh);
  }
  const world = new VehicleImpactWorld(e);
  e.vehicleImpacts = world;
  const car = new THREE.Group();
  scene.add(car);
  const condition = new VehicleCondition(e, car, 1550, 0.7);
  const nav = Object.create(StreetNavigation.prototype);
  Object.assign(nav, {
    e,
    mode: 'drive',
    position: new THREE.Vector3(),
    yaw: 0,
    speed: 15,
    car,
    surface: 'ground',
    condition,
    blocked: () => false,
    reachableDeck: () => undefined,
    roadHeight: () => 0,
  });
  const dispose = () => {
    condition.dispose();
    world.dispose();
    roads.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  };
  return { e, world, condition, nav, lampBreaks, treeSyncs, dispose };
}
const shape = { halfExtents: [1, 0.65, 2.4], clearance: 0.02 };
const sweep = (world, fromZ = 0, toZ = 4) =>
  world.sweep({
    from: { position: [0, 0.7, fromZ], quaternion: [0, 0, 0, 1] },
    to: { position: [0, 0.7, toZ], quaternion: [0, 0, 0, 1] },
    shape,
  });

test('actual Drive collision breaks a small tree once, slows the car, damages its front, and disables cached collider faces', () => {
  const f = fixture();
  try {
    assert.match(sweep(f.world).surfaceId, /^tree:0:trunk:side:/);
    f.nav.move(0, 3);
    assert(f.world.isBroken('tree:0'));
    assert(
      f.nav.position.z > 2,
      'the remaining validated route continues beyond the former trunk',
    );
    assert(f.nav.speed > 0 && f.nav.speed < 15);
    assert(f.condition.damage.zones.front > 0);
    assert.equal(f.condition.damage.zones.left, 0);
    assert.equal(f.condition.damage.zones.right, 0);
    assert.equal(f.treeSyncs.length, 1);
    assert.equal(
      sweep(f.world),
      null,
      'the already-loaded tile no longer contributes the broken source',
    );
    assert.equal(f.world.breakProp('tree:0', [0, 0, 15]), false);
    assert.equal(f.treeSyncs.length, 1);
    f.world.update(0.1);
    assert.equal(f.world.broken.size, 1);
  } finally {
    f.dispose();
  }
});

test('a large unbroken tree causes a severe slowdown without a spontaneous 180-degree body flip', () => {
  const f = fixture({ trees: [{ x: 0, y: 0, z: 3.6, h: 25, conifer: false }] });
  try {
    f.nav.move(0, 3);
    assert(!f.world.isBroken('tree:0'));
    assert(Math.abs(f.nav.speed) < 1);
    assert(
      Math.abs(f.nav.yaw) < 0.1,
      'a head-on rebound should roll backward, not turn the whole car',
    );
    assert(f.condition.damage.zones.front > 0.2);
    assert(f.nav.position.z + shape.halfExtents[2] < 3.6 - 25 * 0.035);
  } finally {
    f.dispose();
  }
});

test('a broken pole loses its street-light source once and remains broken after a car repair', () => {
  const f = fixture({ trees: [], lamps: [[0, 3.2]] });
  try {
    assert.match(sweep(f.world).surfaceId, /^lamp:0:side:/);
    f.nav.move(0, 3);
    assert(f.world.isBroken('lamp:0'));
    assert.deepEqual(f.lampBreaks, [0]);
    assert(f.condition.damage.overall > 0);
    assert.equal(f.condition.repair(3), false);
    assert.equal(f.condition.repair(0), true);
    assert.equal(f.condition.damage.overall, 0);
    assert(f.world.isBroken('lamp:0'));
    assert.equal(sweep(f.world), null);
    assert.equal(f.world.breakProp('lamp:0', [0, 0, 10]), false);
    assert.deepEqual(f.lampBreaks, [0]);
  } finally {
    f.dispose();
  }
});

test('Drive preserves original ground restrictions before reaching a breakable prop', () => {
  const f = fixture();
  f.nav.blocked = (_x, z) => z > 0.2;
  try {
    f.nav.move(0, 3);
    assert(!f.world.isBroken('tree:0'));
    assert.equal(f.nav.position.z, 0);
    assert.equal(f.nav.speed, 0);
    assert.equal(f.condition.damage.overall, 0);
  } finally {
    f.dispose();
  }
});

test('Drive rechecks the second intact tree after breaking the first', () => {
  const f = fixture({
    trees: [
      { x: 0, y: 0, z: 3.2, h: 4, conifer: false },
      { x: 0, y: 0, z: 5.6, h: 25, conifer: false },
    ],
  });
  try {
    f.nav.move(0, 6);
    assert(f.world.isBroken('tree:0'));
    assert(!f.world.isBroken('tree:1'));
    assert(Math.abs(f.nav.speed) < 1);
    assert(f.nav.position.z + shape.halfExtents[2] < 5.6 - 25 * 0.035);
  } finally {
    f.dispose();
  }
});

test('a guardrail is registered from its rendered mesh and tangential travel continues without crossing it', () => {
  const f = fixture({
    trees: [],
    rails: [
      {
        name: 'Separated Causeway paths rails',
        size: [0.2, 1.2, 60],
        position: [4, 0.6, 15],
      },
    ],
  });
  f.nav.yaw = 0.4;
  try {
    assert.equal(f.world.props.get('guardrail:0').kind, 'guardrail');
    f.nav.move(Math.sin(f.nav.yaw) * 8, Math.cos(f.nav.yaw) * 8);
    assert(!f.world.isBroken('guardrail:0'));
    assert(f.nav.position.x < 3);
    assert(f.nav.position.z > 2);
    assert(f.condition.damage.overall > 0);
    assert(Object.values(f.condition.damage.scratches).some((v) => v > 0));
    assert.equal(f.world.broken.size, 0);
  } finally {
    f.dispose();
  }
});

test('resting repeated contact damage is episode bounded; a new moving scrape and later impact remain distinct', () => {
  const f = fixture({ trees: [] });
  const hit = {
      surfaceId: 'building:fixed',
      kind: 'obstacle',
      point: [0, 0.7, 2.42],
      normal: [0, 0, -1],
      adherable: false,
      fraction: 0.5,
    },
    pose = { position: [0, 0.7, 0], quaternion: [0, 0, 0, 1] };
  try {
    f.condition.impact({ hit, pose, velocity: [20, 0, 2], shape });
    const once = f.condition.damage.revision,
      initial = f.condition.damage.overall;
    for (let i = 0; i < 120; i++) {
      f.condition.update(1 / 60);
      f.condition.impact({ hit, pose, velocity: [20, 0, 2], shape });
    }
    assert.equal(f.condition.damage.revision, once);
    assert.equal(f.condition.damage.overall, initial);
    f.condition.impact({
      hit: { ...hit, point: [0.4, 0.7, 2.42] },
      pose,
      velocity: [20, 0, 2],
      shape,
    });
    assert.equal(f.condition.damage.revision, once + 1);
    for (let i = 0; i < 3; i++) f.condition.update(0.1);
    f.condition.impact({ hit, pose, velocity: [20, 0, 2], shape });
    assert.equal(f.condition.damage.revision, once + 2);
  } finally {
    f.dispose();
  }
});

test('independent Tesla uses the same live tree state and local front damage through actual swept movement', () => {
  const f = fixture(),
    height = teslaShape.halfExtents[1] + teslaShape.clearance,
    vertices = [
      [-50, 0, -50],
      [50, 0, -50],
      [50, 0, 50],
      [-50, 0, 50],
    ],
    floor = [
      [0, 1, 2],
      [0, 2, 3],
    ].map((indices, i) =>
      triangleFace(
        'floor',
        `floor:${i}`,
        'ground',
        indices.map((n) => vertices[n]),
        true,
        'ground:0',
        [0, 1, 0],
      ),
    ),
    world = new TeslaWorld({
      sources: [fixedFacesSource('floor', floor), ...f.world.sources],
    }),
    s = createTesla([0, height, 0]);
  s.contact = world.support({
    pose: s,
    shape: teslaShape,
    maxDistance: height + 0.2,
    adhesion: false,
  });
  assert(s.contact);
  s.mode = 'ground';
  s.velocity = [0, 0, 15];
  world.impact = (q) => f.condition.impact(q);
  try {
    for (let i = 0; i < 60 && s.position[2] < 5; i++) {
      const report = stepTesla(
        s,
        { throttle: 0.2 },
        1 / 120,
        world,
        teslaShape,
      );
      assert.equal(report.environmentFailures, 0);
      assert.equal(s.mode, 'ground');
    }
    assert(f.world.isBroken('tree:0'));
    assert(s.position[2] > 4);
    assert(f.condition.damage.zones.front > 0);
    assert.equal(
      world.sweep({
        from: s,
        to: s,
        shape: teslaShape,
        ignoreSurfaceId: s.contact.surfaceId,
      }),
      null,
    );
  } finally {
    world.dispose();
    f.dispose();
  }
});

test('a settled fallen log keeps a bounded low obstacle instead of its old full-height trunk', () => {
  const f = fixture();
  try {
    assert.equal(f.world.breakProp('tree:0', [0, 0, 15]), true);
    assert.equal(
      sweep(f.world),
      null,
      'the initial fall does not retain an invisible upright trunk',
    );
    for (let i = 0; i < 17; i++) f.world.update(0.1);
    assert.match(sweep(f.world, 0, 6).surfaceId, /^debris:tree:0:/);
    assert.equal(
      f.world.sweep({
        from: { position: [0, 4, 0], quaternion: [0, 0, 0, 1] },
        to: { position: [0, 4, 10], quaternion: [0, 0, 0, 1] },
        shape,
      }),
      null,
      'the departed upper trunk no longer blocks the sky',
    );
  } finally {
    f.dispose();
  }
});

test('Drive truncates a blocked steering rotation instead of rendering the full requested yaw through a guardrail', () => {
  const f = fixture({
    trees: [],
    rails: [
      {
        name: 'Separated Causeway paths rails',
        size: [0.2, 1.2, 60],
        position: [1.2, 0.6, 0],
      },
    ],
  });
  const initial = { position: [0, 0.7, 0], quaternion: [0, 0, 0, 1] };
  f.nav.car.rotation.y = 0;
  f.nav.yaw = 0.2;
  f.nav.speed = 10;
  try {
    assert.equal(
      f.world.sweep({ from: initial, to: initial, shape }),
      null,
      'the prior rendered body is clear',
    );
    f.nav.move(Math.sin(0.2) * 0.5, Math.cos(0.2) * 0.5);
    const accepted = {
      position: [f.nav.position.x, f.nav.position.y + 0.7, f.nav.position.z],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.nav.yaw)
        .toArray(),
    };
    assert.equal(
      f.world.sweep({ from: accepted, to: accepted, shape }),
      null,
      'the accepted car body retains full clearance',
    );
    assert(
      f.nav.yaw < 0.2,
      'the blocked remainder of the requested turn was rejected',
    );
  } finally {
    f.dispose();
  }
});

test('head-on guardrail impacts from either side face the car, cause front damage, and preserve outside clearance', () => {
  for (const side of [-1, 1]) {
    const f = fixture({
      trees: [],
      rails: [
        {
          name: 'Separated Causeway paths rails',
          size: [0.2, 1.2, 60],
          position: [0, 0.6, 0],
        },
      ],
    });
    f.nav.position.set(side * 4, 0, 0);
    f.nav.yaw = (-side * Math.PI) / 2;
    f.nav.car.rotation.y = f.nav.yaw;
    try {
      f.nav.move(-side * 6, 0);
      assert(
        f.condition.damage.zones.front > 0.2,
        `side ${side} is a genuine frontal impact`,
      );
      assert(Math.abs(f.nav.speed) < 1);
      assert(f.nav.position.x * side > 2.5);
      const accepted = {
        position: [f.nav.position.x, 0.7, f.nav.position.z],
        quaternion: new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.nav.yaw)
          .toArray(),
      };
      assert.equal(
        f.world.sweep({ from: accepted, to: accepted, shape }),
        null,
      );
    } finally {
      f.dispose();
    }
  }
});

test('a finite guardrail end uses a closing normal instead of a tangent side selected by floating-point ties', () => {
  const f = fixture({
    trees: [],
    rails: [
      {
        name: 'Separated Causeway paths rails',
        size: [0.2, 1.2, 0.2],
        position: [0, 0.6, 3.2],
      },
    ],
  });
  try {
    const hit = sweep(f.world, 0, 3);
    assert(
      hit.normal[2] < -0.9,
      'the finite end is hit from its street-facing side',
    );
    f.nav.move(0, 3);
    assert(f.condition.damage.zones.front > 0.2);
    assert(Math.abs(f.nav.speed) < 1);
    assert(f.nav.position.z + shape.halfExtents[2] < 3.1);
  } finally {
    f.dispose();
  }
});

test('a ground refusal also truncates steering when the complete translating and turning prop route would have been clear', () => {
  const f = fixture({
      trees: [],
      rails: [
        {
          name: 'Separated Causeway paths rails',
          size: [0.2, 1.2, 0.2],
          position: [-1.25, 0.6, -2.2],
        },
      ],
    }),
    theta = 0.0665,
    delta = [Math.sin(theta) * 3.5, Math.cos(theta) * 3.5],
    from = { position: [0, 0.7, 0], quaternion: [0, 0, 0, 1] },
    to = {
      position: [delta[0], 0.7, delta[1]],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta)
        .toArray(),
    };
  f.nav.yaw = theta;
  f.nav.speed = 70;
  f.nav.car.rotation.y = 0;
  f.nav.blocked = () => true;
  try {
    assert.equal(
      f.world.sweep({ from, to, shape }),
      null,
      'forward travel would have cleared the rear corner while turning',
    );
    f.nav.move(...delta);
    assert.deepEqual(f.nav.position.toArray(), [0, 0, 0]);
    assert.equal(
      f.nav.yaw,
      0,
      'a forbidden translation cannot keep its otherwise unsafe full end rotation',
    );
    const accepted = {
      position: [0, 0.7, 0],
      quaternion: new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.nav.yaw)
        .toArray(),
    };
    assert.equal(f.world.sweep({ from: accepted, to: accepted, shape }), null);
    assert.equal(
      f.condition.damage.overall,
      0,
      'a rejected ground permission is not a physical tree or barrier impact',
    );
  } finally {
    f.dispose();
  }
});

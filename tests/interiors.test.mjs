import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { PublicInteriors } = await import(cityModule('interiors'));
const { carveApertures } = await import(cityModule('interior-apertures'));
const { createScienceWorld, createCanadaPlace } = await import(
  cityModule('assets/primary-landmarks')
);
const fixture = () => {
  const e = {
    renderer: {},
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    data: {},
    elevation: () => 3,
    camera: new THREE.PerspectiveCamera(),
    settings: { buildings: true, mode: 'walk' },
  };
  return { e, interiors: new PublicInteriors(e) };
};
test('doorway subtraction opens a real hole while preserving adjacent wall and attributes', () => {
  const root = new THREE.Group(),
    wall = new THREE.Mesh(
      new THREE.BoxGeometry(10, 6, 1),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
  wall.position.y = 3;
  root.add(wall);
  carveApertures(root, [{ min: [-1, 0, -2], max: [1, 3, 2] }]);
  root.updateMatrixWorld(true);
  const ray = (x, y) =>
    new THREE.Raycaster(
      new THREE.Vector3(x, y, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(root, true);
  assert.equal(ray(0, 1.5).length, 0);
  assert(ray(2, 1.5).length);
  assert(ray(0, 4).length);
  assert(wall.geometry.attributes.uv);
  assert([...wall.geometry.attributes.position.array].every(Number.isFinite));
});
test('all entrances connect to their public floors, walls and furniture block walking, cars stay outside', () => {
  const { interiors } = fixture();
  for (const site of interiors.sites) {
    const entry = interiors.entry(site.id);
    assert.equal(
      interiors.clear(entry.x, entry.z, 'walk'),
      true,
      site.id + ' entry',
    );
    assert.equal(interiors.clear(entry.x, entry.z, 'drive'), false);
    const path =
      site.id === 'science'
        ? [
            [40, -59],
            [40, -35],
            [40, -22],
            [20, -22],
            [10, -22],
          ]
        : site.id === 'canada'
          ? [
              [-46, -64],
              [-20, -64],
            ]
          : [
              [0, 26],
              [0, 0],
            ];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      for (let j = 0; j <= 100; j++) {
        const p = interiors.world(
          site,
          a[0] + ((b[0] - a[0]) * j) / 100,
          a[1] + ((b[1] - a[1]) * j) / 100,
        );
        assert.equal(
          interiors.clear(...p, 'walk'),
          true,
          site.id + ' route ' + p,
        );
        assert(Number.isFinite(interiors.height(...p)));
      }
    }
    const ob = site.obstacles[0],
      p = interiors.world(site, ob.x, ob.z);
    assert.equal(interiors.clear(...p, 'walk'), false);
  }
});
test('cutaway is close orbit only and restores the intact exterior in walk and distant views', () => {
  const { e, interiors } = fixture();
  const site = interiors.sites[2];
  e.camera.position.copy(site.origin).add(new THREE.Vector3(0, 60, 0));
  e.settings.mode = 'orbit';
  interiors.update();
  assert(site.plane.constant < 100);
  e.settings.mode = 'walk';
  interiors.update();
  assert.equal(site.plane.constant, 1e7);
  e.settings.mode = 'orbit';
  e.camera.position.y = 1000;
  interiors.update();
  assert.equal(site.plane.constant, 1e7);
});
test('Science World and Canada Place have passable ground-level holes in their original envelopes', () => {
  for (const [factory, origin, direction] of [
    [createScienceWorld, [40, 2.5, -54], [0, 0, 1]],
    [createCanadaPlace, [-36, 2.5, -64], [1, 0, 0]],
  ]) {
    const model = factory(false);
    model.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(...origin),
      new THREE.Vector3(...direction),
      0,
      5,
    );
    assert.equal(
      ray.intersectObject(model, true).length,
      0,
      model.name + ' doorway',
    );
  }
});

test('the station rear doorway and entire SkyWalk connect to the lower SeaBus lounge', () => {
  const { e } = fixture();
  e.elevation = () => 13.5;
  const interiors = new PublicInteriors(e),
    s = interiors.sites.find((s) => s.id === 'waterfront');
  const path = [
    [0, 0],
    [-6, -8],
    [-6, -16],
    [-6, -43],
    [9, -140],
    [10, -146],
    [19, -172],
    [27, -192],
    [29, -197],
    [35, -220],
    [35, -239],
  ];
  e.landmarks.updateMatrixWorld(true);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 5);
    for (let j = 0; j <= n; j++) {
      const x = a[0] + ((b[0] - a[0]) * j) / n,
        z = a[1] + ((b[1] - a[1]) * j) / n,
        world = interiors.world(s, x, z);
      assert.equal(interiors.clear(...world, 'walk'), true, `route ${x},${z}`);
      assert.equal(interiors.clear(...world, 'boat'), false);
      const floor = interiors.height(...world);
      assert.ok(Number.isFinite(floor));
      const ray = new THREE.Raycaster(
        new THREE.Vector3(world[0], floor + 2, world[1]),
        new THREE.Vector3(0, -1, 0),
        0,
        2.1,
      );
      const hits = ray
        .intersectObject(s.group, true)
        .filter((h) => h.object.userData.walkSurface);
      assert.ok(
        hits.some((h) => Math.abs(h.point.y - floor) < 0.025),
        `physical floor ${x},${z}`,
      );
    }
  }
  assert.equal(interiors.height(...interiors.world(s, 35, -220)), 4.5);
  const origin = interiors.world(s, -6, -14);
  const direction = new THREE.Vector3(
    Math.sin(s.yaw + Math.PI),
    0,
    Math.cos(s.yaw + Math.PI),
  );
  const hits = new THREE.Raycaster(
    new THREE.Vector3(origin[0], s.origin.y + s.floor + 1.6, origin[1]),
    direction,
    0,
    4,
  ).intersectObject(s.envelope, true);
  assert.equal(hits.length, 0, 'rear doorway is a genuine opening');
  e.settings.mode = 'walk';
  e.camera.position.set(
    ...[
      ...interiors.world(s, 35, -220).slice(0, 1),
      6,
      interiors.world(s, 35, -220)[1],
    ],
  );
  interiors.update();
  assert.equal(s.group.visible, true);
});

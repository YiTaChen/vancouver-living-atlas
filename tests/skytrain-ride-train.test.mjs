import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';
import { ridePath as renderedRidePath } from './helpers/skytrain-geometry.mjs';
const { SkyTrainCabinAssets } = await import(
  cityModule('skytrain-cabin-assets')
);
const { SkyTrainRideTrain } = await import(cityModule('skytrain-ride-train'));
const { openSkyTrainDoorApertures } = await import(
  cityModule('skytrain-door-aperture')
);
const manifest = JSON.parse(
  await readFile('public/models/blender/metro/manifest.json', 'utf8'),
);
const close = (a, b, e = 1e-5) => assert(Math.abs(a - b) < e, `${a} != ${b}`);
function sameQuaternion(actual, expected) {
  // Authored products retain their exact floating-point components. angleTo()
  // assumes unit inputs and reports a false rotation even for identical copies
  // whose norm differs from one by 1.4e-13. Compare the real components instead.
  const sign = actual.dot(expected) < 0 ? -1 : 1;
  actual
    .toArray()
    .forEach((value, index) =>
      assert(Math.abs(value - sign * expected.toArray()[index]) < 1e-12),
    );
}
const routes = JSON.parse(
  await readFile('public/models/skytrain-routes.json', 'utf8'),
);
const pathCache = new Map();
async function ridePath(from, to) {
  const key = `${from}:${to}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const segment = routes.segments.find((s) => s.from === from && s.to === to);
  // Use the same exact rendered station envelopes as production and the other
  // actual-GLB tests. A daylight station/deck cannot be fitted from bare DEM.
  const path = renderedRidePath(segment);
  pathCache.set(key, path);
  return path;
}
async function actualGLB(url) {
  const bytes = await readFile('public' + url),
    loader = new GLTFLoader(),
    originalSelf = globalThis.self;
  globalThis.self = globalThis;
  // Only browser bitmap decoding is substituted. Geometry, transforms, doors,
  // named anchors, PBR/material associations and LODs use the actual GLBs.
  loader.register((parser) => ({
    name: 'node-texture-decoder',
    beforeRoot() {
      parser.textureLoader = {
        load(_url, ok) {
          queueMicrotask(() => ok(new THREE.Texture()));
        },
      };
    },
  }));
  try {
    return await loader.parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '/models/blender/metro/',
    );
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
}
function fixture(options = {}) {
  const loaded = [];
  const assets = new SkyTrainCabinAssets({
    fetchManifest: async () => manifest,
    load: async (url, signal) => {
      const model = await actualGLB(url);
      loaded.push({ url, model, signal });
      return model;
    },
    ...options,
  });
  return { assets, loaded, train: new SkyTrainRideTrain(assets) };
}
function disposalCounts(group) {
  const resources = new Set();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      resources.add(m);
      for (const v of Object.values(m))
        if (v instanceof THREE.Texture) resources.add(v);
    }
  });
  const counts = new Map([...resources].map((r) => [r, 0]));
  for (const r of resources)
    r.addEventListener('dispose', () => counts.set(r, counts.get(r) + 1));
  return counts;
}
function frames(train, open, side) {
  for (let i = 0; i < 8; i++) train.setDoors(open, side, 0.1);
  train.group.updateMatrixWorld(true);
}
function opaqueDoorHits(train, side, height, opaqueOnly = true, zOffset = 0) {
  train.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(
      0,
      train.floorAboveRail + height,
      train.carOffset + zOffset,
    ),
    new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0),
    0.5,
    1.8,
  );
  return ray.intersectObject(train.group, true).filter((hit) => {
    const mesh = hit.object;
    if (!(mesh instanceof THREE.Mesh)) return false;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    return (
      !opaqueOnly || materials.some((m) => !m.transparent || m.opacity > 0.8)
    );
  });
}

test('actual current cabin GLBs meet both station floor datums and retain a rider foot anchor in the moving frame', async () => {
  for (const line of ['expo', 'canada'])
    for (const quality of ['balanced', 'high', 'ultra']) {
      const { train, loaded } = fixture();
      assert(await train.load(line, quality, false));
      assert(train.ready);
      close(train.passenger.position.y, train.floorAboveRail);
      assert(
        loaded.every((x) =>
          x.url.includes(quality === 'balanced' ? '.lod1.glb' : '.lod0.glb'),
        ),
      );
      const floor = train.group.getObjectByName(
        line === 'expo'
          ? 'interior-batch-floor'
          : 'interior-batch-canada-floor',
      );
      assert(floor instanceof THREE.Mesh);
      train.group.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(
        new THREE.Vector3(0, train.floorAboveRail + 0.25, train.carOffset),
        new THREE.Vector3(0, -1, 0),
        0,
        1,
      );
      const hit = ray.intersectObject(floor, false)[0];
      assert(hit);
      close(hit.point.y, train.floorAboveRail);
      const child = new THREE.Object3D();
      train.passenger.add(child);
      const before = child.getWorldPosition(new THREE.Vector3());
      train.group.position.set(100, 20, 40);
      train.group.quaternion.setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 3,
      );
      train.group.updateMatrixWorld(true);
      const expected = before
          .clone()
          .applyQuaternion(train.group.quaternion)
          .add(train.group.position),
        actual = child.getWorldPosition(new THREE.Vector3());
      assert(actual.distanceTo(expected) < 1e-5);
      train.dispose();
    }
});

for (const line of ['expo', 'canada'])
  test(`${line}: opening each selected platform side clears the actual central door aperture at foot, body and head heights`, async () => {
    const { train } = fixture();
    await train.load(line, 'high', false);
    for (const side of ['left', 'right']) {
      frames(train, false, side);
      assert(train.doorsClosed);
      assert(
        opaqueDoorHits(train, side, 1, false, 0.12).length > 0,
        `${line} closed ${side} door must be visible`,
      );
      frames(train, true, side);
      assert(train.doorsClear);
      for (const h of [0.35, 1, 1.7])
        for (const z of [-0.45, 0, 0.45])
          assert.equal(
            opaqueDoorHits(train, side, h, false, z).length,
            0,
            `${line} ${side} open door blocked at ${h}m / ${z} offset: ${JSON.stringify(opaqueDoorHits(train, side, h, false, z).map((hit) => ({ name: hit.object.name, point: hit.point.toArray() })))}`,
          );
      assert(
        opaqueDoorHits(
          train,
          side === 'left' ? 'right' : 'left',
          1,
          false,
          0.12,
        ).length > 0,
        `${line} opposite side stays closed`,
      );
      frames(train, false, side);
      assert(train.doorsClosed);
    }
    train.dispose();
  });

test('the reversed Canada car opens the same world side while its opposite leaves remain shut', async () => {
  const { train } = fixture();
  await train.load('canada', 'high', false);
  const first = train.group.children.find(
    (c) =>
      c instanceof THREE.Group &&
      c !== train.passenger &&
      !c.name.startsWith('Canada Line second'),
  );
  const second = train.group.getObjectByName(
    'Canada Line second car — shared original geometry',
  );
  assert(first && second);
  const firstLeft = first.getObjectByName('door-left-2-a'),
    firstRight = first.getObjectByName('door-right-2-a'),
    secondWorldLeft = second.getObjectByName('door-right-2-a'),
    secondWorldRight = second.getObjectByName('door-left-2-a');
  assert(firstLeft && firstRight && secondWorldLeft && secondWorldRight);
  const position = (n) => n.getWorldPosition(new THREE.Vector3());
  train.group.updateMatrixWorld(true);
  const starts = [firstLeft, firstRight, secondWorldLeft, secondWorldRight].map(
    position,
  );
  frames(train, true, 'left');
  const ends = [firstLeft, firstRight, secondWorldLeft, secondWorldRight].map(
    position,
  );
  assert(starts[0].x > 0 && starts[2].x > 0);
  close(ends[0].distanceTo(starts[0]), 0.78);
  close(ends[2].distanceTo(starts[2]), 0.78);
  close(ends[1].distanceTo(starts[1]), 0);
  close(ends[3].distanceTo(starts[3]), 0);
  train.dispose();
});

test('bounded door animation does not open on invalid time and does not release passengers before full travel', async () => {
  const { train } = fixture();
  await train.load('expo', 'balanced', false);
  for (const dt of [0, -1, NaN, Infinity]) train.setDoors(true, 'left', dt);
  assert(train.doorsClosed);
  train.setDoors(true, 'left', 100);
  assert(!train.doorsClear);
  frames(train, true, 'left');
  assert(train.doorsClear);
  train.setDoors(false, 'left', 0);
  assert(train.doorsClear);
  frames(train, false, 'left');
  assert(train.doorsClosed);
  train.dispose();
});

test('Expo metal frames and transparent window leaves animate together while closed windows preserve the outside view', async () => {
  const { train } = fixture();
  await train.load('expo', 'high', false);
  const frame = train.group.getObjectByName(
      'Animated platform-side train doors',
    ),
    glass = train.group.getObjectByName('Animated train-door glazing');
  assert(frame instanceof THREE.InstancedMesh);
  assert(glass instanceof THREE.InstancedMesh);
  assert.equal(frame.count, 48);
  assert.equal(glass.count, frame.count);
  assert(!Array.isArray(frame.material));
  assert(!frame.material.transparent);
  assert(!Array.isArray(glass.material));
  assert(glass.material.transparent);
  assert(glass.material.opacity > 0 && glass.material.opacity < 0.5);
  assert.equal(glass.material.depthWrite, false);
  const counts = disposalCounts(train.group),
    meshDisposals = [0, 0];
  [frame, glass].forEach((mesh, i) =>
    mesh.addEventListener('dispose', () => meshDisposals[i]++),
  );
  const aligned = () => {
    const frameMatrix = new THREE.Matrix4(),
      glassMatrix = new THREE.Matrix4();
    for (let i = 0; i < frame.count; i++) {
      frame.getMatrixAt(i, frameMatrix);
      glass.getMatrixAt(i, glassMatrix);
      assert.deepEqual(glassMatrix.elements, frameMatrix.elements);
    }
  };
  for (const side of ['left', 'right']) {
    frames(train, false, side);
    aligned();
    const closedWindow = opaqueDoorHits(train, side, 1.5, false, 0.12);
    assert(closedWindow.some((hit) => hit.object === glass));
    assert(!closedWindow.some((hit) => hit.object === frame));
    assert.equal(
      opaqueDoorHits(train, side, 1.5, true, 0.12).length,
      0,
      'a closed window retains a clear view through transparent glazing',
    );
    train.setDoors(true, side, 0.1);
    aligned();
    frames(train, true, side);
    aligned();
    for (const height of [0.35, 1, 1.7])
      for (const z of [-0.45, 0, 0.45])
        assert.equal(opaqueDoorHits(train, side, height, false, z).length, 0);
  }
  train.dispose();
  train.dispose();
  assert.deepEqual(meshDisposals, [1, 1]);
  assert([...counts.values()].every((count) => count === 1));
});

test('compatible graphics use the actual lightweight cabin and every mesh resource is released exactly once', async () => {
  const { train, loaded } = fixture();
  const scene = new THREE.Scene();
  scene.add(train.group);
  await train.load('canada', 'ultra', true);
  assert(loaded.every((x) => x.url.endsWith('.lod1.glb')));
  const counts = disposalCounts(train.group);
  assert(counts.size > 0);
  let meshes = 0,
    triangles = 0;
  train.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes++;
      triangles +=
        ((o.geometry.index?.count ??
          o.geometry.getAttribute('position').count) /
          3) *
        (o instanceof THREE.InstancedMesh ? o.count : 1);
    }
  });
  assert(meshes < 200);
  assert(triangles < 20_000);
  train.dispose();
  train.dispose();
  assert(!train.ready);
  assert.equal(scene.children.length, 0);
  assert([...counts.values()].every((n) => n === 1));
  assert.equal(await train.load('expo', 'high', false), false);
});

test('changing line/quality releases the previous actual cabin buffers before creating a fresh consistent owner', async () => {
  const { train } = fixture();
  await train.load('expo', 'high', false);
  const old = disposalCounts(train.group);
  await train.load('canada', 'balanced', false);
  assert([...old.values()].every((n) => n === 1));
  assert(train.ready);
  close(train.floorAboveRail, 1.1);
  const current = disposalCounts(train.group);
  train.dispose();
  assert([...current.values()].every((n) => n === 1));
});

test('disposing while actual GLB parsing finishes never reattaches a late cabin and releases its buffers', async () => {
  const gate = Promise.withResolvers(),
    parsed = Promise.withResolvers();
  const assets = new SkyTrainCabinAssets({
      fetchManifest: async () => manifest,
      load: async (url) => {
        try {
          const model = await actualGLB(url);
          parsed.resolve(model);
          await gate.promise;
          return model;
        } catch (error) {
          parsed.reject(error);
          throw error;
        }
      },
    }),
    train = new SkyTrainRideTrain(assets);
  const load = train.load('expo', 'high', false);
  // Synchronize on the actual parser rather than a machine-dependent number
  // of event-loop turns, and still keep the loaded scene behind the gate.
  const model = await Promise.race([
    parsed.promise,
    load.then(() => assert.fail('load ended before the actual GLB parsed')),
  ]);
  const counts = disposalCounts(model.scene);
  train.dispose();
  gate.resolve();
  assert.equal(await load, false);
  assert(!train.ready);
  assert([...counts.values()].every((n) => n === 1));
});

test('actual loaded cars follow individual physical arc frames in both directions and return to exact linear station offsets', async () => {
  let articulated = false;
  for (const [line, pairs, offsets] of [
    [
      'expo',
      [
        ['waterfront', 'burrard'],
        ['burrard', 'waterfront'],
      ],
      [26.85, 8.95, -8.95, -26.85],
    ],
    [
      'canada',
      [
        ['waterfront', 'vancouver-city-centre'],
        ['vancouver-city-centre', 'waterfront'],
      ],
      [10.5, -10.5],
    ],
  ]) {
    const { train } = fixture();
    assert(await train.load(line, 'balanced', false));
    const geometries = new Set(),
      materials = new Set();
    train.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
      }
    });
    for (const [from, to] of pairs) {
      const path = await ridePath(from, to);
      for (const u of [0, 0.02, 0.2, 0.4, 0.6, 0.8, 0.98, 1]) {
        train.setPathPose(path, u);
        const reference = path.sample(u);
        assert(train.group.position.distanceTo(reference.position) < 1e-6);
        sameQuaternion(train.group.quaternion, reference.quaternion);
        for (let i = 0; i < offsets.length; i++) {
          const expected = path.sampleDistance(
            u * path.length + offsets[i] * path.start.motionSign,
          );
          const car = train.carFrames[i];
          assert(
            car
              .getWorldPosition(new THREE.Vector3())
              .distanceTo(expected.position) < 1e-6,
          );
          sameQuaternion(
            car.getWorldQuaternion(new THREE.Quaternion()),
            expected.quaternion,
          );
          if (u === 0 || u === 1) {
            assert(
              car.position.distanceTo(new THREE.Vector3(0, 0, offsets[i])) <
                0.015,
            );
            assert(car.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
          }
        }
        if (
          train.carFrames[0].quaternion.angleTo(train.carFrames[1].quaternion) >
          0.001
        )
          articulated = true;
        train.group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            assert(geometries.has(o.geometry));
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              assert(materials.has(m));
          }
        });
      }
    }
    train.resetCarFrames();
    assert(train.stationAligned);
    train.carFrames.forEach((car, i) =>
      assert(
        car.position.distanceTo(new THREE.Vector3(0, 0, offsets[i])) < 1e-9,
      ),
    );
    train.dispose();
  }
  assert(
    articulated,
    'neighboring actual cars turn independently instead of remaining one rigid consist',
  );
});

test('Expo shared single-car shells and all48 paired door instances inherit the articulated car matrices and release once', async () => {
  const { train } = fixture();
  await train.load('expo', 'high', false);
  const path = await ridePath('waterfront', 'burrard');
  train.setPathPose(path, 0.4);
  const shells = train.group.children.filter(
    (o) => o.name === 'Original service exterior — Mark V inspired',
  );
  assert(shells.length > 0 && shells.length <= 8);
  const instance = new THREE.Matrix4(),
    local = new THREE.Matrix4(),
    frame = new THREE.Matrix4(),
    glass = new THREE.Matrix4();
  for (const mesh of shells) {
    assert(mesh instanceof THREE.InstancedMesh);
    assert.equal(mesh.count, 4);
    mesh.geometry.computeBoundingBox();
    assert(
      mesh.geometry.boundingBox.max.z < 9 &&
        mesh.geometry.boundingBox.min.z > -9,
    );
    train.carFrames.forEach((car, i) => {
      mesh.getMatrixAt(i, instance);
      instance.elements.forEach((n, k) =>
        close(n, car.matrix.elements[k], 2e-5),
      );
    });
  }
  const metal = train.group.getObjectByName(
      'Animated platform-side train doors',
    ),
    glazing = train.group.getObjectByName('Animated train-door glazing');
  frames(train, true, 'left');
  for (let i = 0; i < 48; i++) {
    metal.getMatrixAt(i, frame);
    glazing.getMatrixAt(i, glass);
    assert.deepEqual(frame.elements, glass.elements);
    local
      .copy(train.carFrames[Math.floor(i / 12)].matrix)
      .invert()
      .multiply(frame);
    close(Math.abs(local.elements[12]), 1.285, 2e-5);
    close(local.elements[13], 1.94, 2e-5);
  }
  const meshDisposals = shells.map(() => 0),
    buffers = disposalCounts(train.group);
  shells.forEach((mesh, i) =>
    mesh.addEventListener('dispose', () => meshDisposals[i]++),
  );
  train.resetCarFrames();
  frames(train, true, 'left');
  train.group.position.set(0, 0, 0);
  train.group.quaternion.identity();
  train.group.updateMatrixWorld(true);
  assert.equal(
    opaqueDoorHits(train, 'left', 1, false).length,
    0,
    'station reset preserves the actual open aperture',
  );
  train.dispose();
  train.dispose();
  assert(meshDisposals.every((n) => n === 1));
  assert([...buffers.values()].every((n) => n === 1));
});

test('the standing eye, passenger anchor and cabin lamps attach to occupied car0 rather than the rigid train root', async () => {
  for (const line of ['expo', 'canada']) {
    const { train } = fixture();
    await train.load(line, 'high', false);
    const path = await ridePath(
      'waterfront',
      line === 'expo' ? 'burrard' : 'vancouver-city-centre',
    );
    train.setPathPose(path, 0.4);
    const position = new THREE.Vector3(),
      quaternion = new THREE.Quaternion();
    train.passengerWorldPose(position, quaternion);
    const car = train.carFrames[0];
    const localEye = train.eye.clone();
    localEye.z -= train.carOffset;
    assert(position.distanceTo(localEye.applyMatrix4(car.matrixWorld)) < 1e-6);
    assert(
      quaternion.angleTo(car.getWorldQuaternion(new THREE.Quaternion())) < 1e-6,
    );
    assert.equal(train.passenger.parent, car);
    const lamps = [];
    train.group.traverse((o) => {
      if (o instanceof THREE.PointLight) lamps.push(o);
    });
    assert.equal(lamps.length, 2);
    assert(lamps.every((lamp) => lamp.parent === car));
    train.dispose();
  }
});

test('instance-only door cropping retains actual authored materials and finite matched vertex attributes while retiring only unused buffers', async () => {
  for (const level of [0, 1]) {
    const gltf = await actualGLB(manifest.assets[0].lods[level].url),
      root = gltf.scene,
      before = [],
      counts = disposalCounts(root);
    root.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh)) return;
      before.push({
        mesh,
        geometry: mesh.geometry,
        material: mesh.material,
        attributes: Object.fromEntries(
          Object.entries(mesh.geometry.attributes).map(([name, attribute]) => [
            name,
            {
              size: attribute.itemSize,
              array: Array.from(attribute.array),
            },
          ]),
        ),
      });
    });
    openSkyTrainDoorApertures(root);
    let changed = 0;
    for (const saved of before) {
      assert.equal(saved.mesh.material, saved.material);
      const derived = saved.mesh.geometry;
      if (derived !== saved.geometry) changed++;
      assert.deepEqual(
        Object.keys(derived.attributes),
        Object.keys(saved.attributes),
      );
      const position = derived.getAttribute('position');
      assert(position.count > 0);
      assert.equal((derived.index?.count ?? position.count) % 3, 0);
      for (const [name, attribute] of Object.entries(derived.attributes)) {
        assert.equal(attribute.itemSize, saved.attributes[name].size);
        assert.equal(attribute.count, position.count);
        assert(Array.from(attribute.array).every(Number.isFinite));
        assert.deepEqual(
          Array.from(saved.geometry.getAttribute(name).array),
          saved.attributes[name].array,
          'source geometry arrays remain immutable',
        );
      }
      const originalStillReferenced = before.some(
        (s) => s.mesh.geometry === saved.geometry,
      );
      assert.equal(counts.get(saved.geometry), originalStillReferenced ? 0 : 1);
    }
    assert(changed > 0, 'actual cabin panel geometry needs door adaptation');
    for (const [resource, count] of counts)
      if (!(resource instanceof THREE.BufferGeometry)) assert.equal(count, 0);
    const live = disposalCounts(root);
    for (const resource of live.keys()) resource.dispose();
    assert([...live.values()].every((count) => count === 1));
    assert([...counts.values()].every((count) => count === 1));
  }
});

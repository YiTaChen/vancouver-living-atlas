import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './helpers/city-modules.mjs';

const { CityBusAssets } = await import(cityModule('bus-assets'));
const { busRoutePose, createBuses, updateBuses } = await import(
  cityModule('city-buses')
);
const manifest = JSON.parse(
  readFileSync('public/models/blender/bus/manifest.json', 'utf8'),
);
const policy = { quality: 'high', compatible: false, allowNew: true };
const requestNear = (assets) => {
  assets.update(0, new THREE.Vector3(), () => 0, policy);
  return assets.ready;
};
const route = (x = 0, z = 0) => ({
  a: [x, z],
  b: [x, z + 100],
  length: 100,
  speed: 0,
  phase: 0,
});
const parse = (url) => {
  const name = url.split('/').at(-1).split('?')[0],
    bytes = readFileSync(`public/models/blender/bus/${name}`);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
};
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fixture(routes = [route()]) {
  const parent = new THREE.Group(),
    calls = [];
  const assets = new CityBusAssets(routes, parent, {
    fetchManifest: async () => manifest,
    load: (url) => {
      calls.push(url);
      return parse(url);
    },
  });
  return { assets, parent, calls };
}

test('cold construction, overview and forbidden admission make zero asset requests until an eligible near update', async () => {
  let manifests = 0;
  const calls = [];
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => {
      manifests++;
      return manifest;
    },
    load: (url) => {
      calls.push(url);
      return parse(url);
    },
  });
  try {
    await flush();
    assert.equal(assets.stats().status, 'idle');
    assert.equal(manifests, 0);
    assert.equal(calls.length, 0);
    assets.update(0, new THREE.Vector3(0, 900, 0), () => 0, policy);
    assets.update(0, new THREE.Vector3(), () => 0, {
      ...policy,
      allowNew: false,
    });
    await flush();
    assert.equal(manifests, 0);
    assert.equal(calls.length, 0);
    assert.equal(assets.stats().allocatedBatches, 0);
    assets.update(0, new THREE.Vector3(), () => 0, policy);
    assets.update(0, new THREE.Vector3(), () => 0, policy);
    await assets.ready;
    assert.equal(manifests, 1);
    assert.equal(calls.length, 2);
    assert.equal(assets.stats().allocatedBatches, 8);
  } finally {
    assets.dispose();
  }
});

test('parked-only demand loads metadata and LOD0 lazily without requesting the background pair', async () => {
  let manifests = 0;
  const calls = [];
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => {
      manifests++;
      return manifest;
    },
    load: (url) => {
      calls.push(url);
      return parse(url);
    },
  });
  try {
    const owner = await assets.loadBoardable();
    assert.equal(manifests, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((url) => url.includes('.lod0.glb')));
    assert.equal(assets.stats().status, 'idle');
    assert.equal(assets.stats().allocatedBatches, 0);
    assert.equal(assets.stats().boardableOwners, 1);
    owner.dispose();
  } finally {
    assets.dispose();
  }
  await assets.ready;
});

test('actual near exterior/interior pair uses eight shared roles and bounded complete replacements', async () => {
  const f = fixture(Array.from({ length: 28 }, (_, i) => route(i)));
  try {
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      0,
    );
    await requestNear(f.assets);
    const ids = f.assets.update(
      0,
      new THREE.Vector3(0, 15, 0),
      () => 15,
      policy,
    );
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [0, 1, 2, 3],
    );
    const s = f.assets.stats();
    assert.equal(s.allocatedBatches, 8);
    assert.equal(s.populatedBatches, 8);
    assert.equal(s.nearActors, 4);
    assert.equal(s.triangles, 4 * 2_618);
    assert.equal(s.materials, 8);
    assert.equal(s.textures, 0);
    assert.equal(s.assetBytes, 137_088 + 122_468);
    assert.equal(s.loadedTemplates, 2);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((url) => /\.lod1\.glb\?v=[a-f0-9]{12}$/.test(url)));
    const glass = f.assets.group.children.find(
      (m) => m.material.userData.semantic_role === 'glass',
    );
    assert.equal(glass.material.transparent, true);
    assert.equal(glass.material.depthWrite, false);
    assert.equal(glass.material.side, THREE.DoubleSide);
    assert.ok(Math.abs(glass.material.opacity - 0.19) < 1e-6);
    assert.equal(glass.userData.excludeFromSSAO, true);
    const light = f.assets.group.children.find(
      (m) => m.material.userData.semantic_role === 'lights',
    );
    assert.ok(Math.abs(light.material.emissiveIntensity - 1.2) < 1e-6);
    for (const mesh of f.assets.group.children) {
      assert.equal(mesh.count, 4);
      assert.equal(mesh.material.vertexColors, true);
      assert.equal(mesh.geometry.getAttribute('color').itemSize, 4);
      assert.equal(
        mesh.geometry.getAttribute('normal').count,
        mesh.geometry.getAttribute('position').count,
      );
      assert.equal(mesh.castShadow, false);
    }
    assert.match(f.assets.group.userData.provenance.project, /YiTaChen/);
    assert.equal(
      28 - ids.size,
      24,
      'unrepresented actors remain available to the far renderer',
    );
  } finally {
    f.assets.dispose();
  }
});

test('flattened near geometry preserves source surface positions, normals and linear material factors', async () => {
  const f = fixture();
  const originals = await Promise.all(
    ['city-bus-12m-exterior.lod1.glb', 'city-bus-12m-interior.lod1.glb'].map(
      parse,
    ),
  );
  try {
    await requestNear(f.assets);
    const expected = new Map();
    const key = (p, n) =>
      [...p, ...n].map((v) => Math.round(v * 1e5)).join(',');
    for (const { scene } of originals) {
      scene.updateMatrixWorld(true);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        const role = object.material.userData.semantic_role;
        const list = expected.get(role) ?? [];
        const geo = object.geometry,
          p = geo.getAttribute('position'),
          n = geo.getAttribute('normal');
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(
          object.matrixWorld,
        );
        for (let i = 0; i < (geo.index?.count ?? p.count); i++) {
          const index = geo.index ? geo.index.getX(i) : i;
          const point = new THREE.Vector3()
            .fromBufferAttribute(p, index)
            .applyMatrix4(object.matrixWorld);
          const normal = new THREE.Vector3()
            .fromBufferAttribute(n, index)
            .applyNormalMatrix(normalMatrix);
          list.push(key(point.toArray(), normal.toArray()));
        }
        expected.set(role, list);
        const actual = f.assets.group.children.find(
          (m) => m.material.userData.semantic_role === role,
        ).material;
        assert.ok(actual.color.equals(object.material.color));
        assert.equal(actual.roughness, object.material.roughness);
        assert.equal(actual.metalness, object.material.metalness);
        assert.equal(actual.opacity, object.material.opacity);
      });
    }
    for (const mesh of f.assets.group.children) {
      const p = mesh.geometry.getAttribute('position'),
        n = mesh.geometry.getAttribute('normal'),
        actual = [];
      for (let i = 0; i < p.count; i++)
        actual.push(
          key(
            [p.getX(i), p.getY(i), p.getZ(i)],
            [n.getX(i), n.getY(i), n.getZ(i)],
          ),
        );
      assert.deepEqual(
        actual.sort(),
        expected.get(mesh.material.userData.semantic_role).sort(),
      );
    }
  } finally {
    f.assets.dispose();
    for (const gltf of originals)
      gltf.scene.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
  }
});

test('near admission hysteresis, compatible cap and stable exclusions never swallow far routes', async () => {
  const f = fixture([route(0), route(70), route(79), route(95), route(180)]);
  try {
    await requestNear(f.assets);
    const camera = new THREE.Vector3();
    assert.deepEqual(
      [...f.assets.update(0, camera, () => 0, policy)].sort((a, b) => a - b),
      [0, 1, 2],
    );
    camera.x = 17;
    let ids = f.assets.update(0, camera, () => 0, {
      ...policy,
      allowNew: false,
    });
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [0, 1, 2],
    );
    ids = f.assets.update(0, camera, () => 0, policy);
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [0, 1, 2, 3],
    );
    camera.x = -10;
    ids = f.assets.update(0, camera, () => 0, { ...policy, allowNew: false });
    assert.ok(
      ids.has(3),
      'existing actor stays until the 110 m exit threshold',
    );
    camera.x = -20;
    ids = f.assets.update(0, camera, () => 0, { ...policy, allowNew: false });
    assert.ok(!ids.has(3));
    camera.x = 0;
    ids = f.assets.update(0, camera, () => 0, { ...policy, compatible: true });
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [0, 1],
    );
    f.assets.setExcludedRoutes(new Set([0]));
    ids = f.assets.update(0, camera, () => 0, policy);
    assert.ok(!ids.has(0));
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      [1, 2],
    );
    camera.x = 200;
    ids = f.assets.update(0, camera, () => 0, { ...policy, allowNew: false });
    assert.equal(ids.size, 0);
    assert.equal(f.assets.group.visible, false);
    ids = f.assets.update(0, camera, () => 0, policy);
    assert.deepEqual([...ids], [4]);
  } finally {
    f.assets.dispose();
  }
});

test('every near role shares the same actual road-contact frame without the legacy vertical offset', async () => {
  const f = fixture();
  try {
    await requestNear(f.assets);
    const height = (x, z) => 15 + 0.04 * x + 0.02 * z;
    f.assets.update(0, new THREE.Vector3(0, 15, 0), height, policy);
    const expected = new THREE.Matrix4();
    f.assets.group.children[0].getMatrixAt(0, expected);
    assert.ok(
      Math.abs(new THREE.Vector3().setFromMatrixPosition(expected).y - 15) <
        1e-6,
    );
    for (const mesh of f.assets.group.children) {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(0, matrix);
      assert.deepEqual(matrix.elements, expected.elements);
    }
    for (const x of [-1.13, 1.13])
      for (const z of [-3.1, 3.1]) {
        const contact = new THREE.Vector3(x, 0, z).applyMatrix4(expected);
        assert.ok(Math.abs(contact.y - height(contact.x, contact.z)) < 1e-5);
      }
    const pure = busRoutePose(route(), 100, () => 15);
    assert.equal(pure.y, 15);
    const legacy = createBuses(2);
    updateBuses(
      legacy,
      [route(), route(5)],
      0,
      () => 15,
      new THREE.Vector3(0, 15, 0),
      new Set([0]),
    );
    assert.equal(legacy.count, 1);
    const old = new THREE.Matrix4();
    legacy.getMatrixAt(0, old);
    assert.ok(
      Math.abs(new THREE.Vector3().setFromMatrixPosition(old).y - 16.08) < 1e-5,
    );
    legacy.geometry.dispose();
    legacy.material.dispose();
    legacy.dispose();
  } finally {
    f.assets.dispose();
  }
});

test('parked source meshes have neutral vertex colors without changing original positions, normals or PBR factors', async () => {
  const originals = new Map();
  let missingColors = 0;
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => manifest,
    load: async (url) => {
      const gltf = await parse(url);
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry;
        if (!geometry.getAttribute('color')) missingColors++;
        originals.set(geometry, {
          positions: Array.from(geometry.getAttribute('position').array),
          normals: Array.from(geometry.getAttribute('normal').array),
          color: object.material.color.clone(),
          roughness: object.material.roughness,
          metalness: object.material.metalness,
          opacity: object.material.opacity,
          emissive: object.material.emissive.clone(),
          emissiveIntensity: object.material.emissiveIntensity,
        });
      });
      return gltf;
    },
  });
  try {
    const owner = await assets.loadBoardable();
    assert.ok(missingColors > 0, 'actual LOD0 payload exercises absent COLOR_0');
    let meshes = 0;
    const colors = new Map();
    owner.group.traverse((object) => {
      if (!object.isMesh) return;
      meshes++;
      const original = originals.get(object.geometry);
      assert.ok(original, 'owners reuse the managed template geometry');
      assert.equal(object.material.vertexColors, true);
      const color = object.geometry.getAttribute('color');
      assert.ok(color, 'vertex color material requires a color attribute');
      assert.equal(color.itemSize, 4);
      assert.equal(color.count, object.geometry.getAttribute('position').count);
      assert.ok(Array.from(color.array).every((value) => value === 1));
      colors.set(object.geometry, color);
      assert.deepEqual(
        Array.from(object.geometry.getAttribute('position').array),
        original.positions,
      );
      assert.deepEqual(
        Array.from(object.geometry.getAttribute('normal').array),
        original.normals,
      );
      assert.ok(object.material.color.equals(original.color));
      assert.equal(object.material.roughness, original.roughness);
      assert.equal(object.material.metalness, original.metalness);
      assert.equal(object.material.opacity, original.opacity);
      assert.ok(object.material.emissive.equals(original.emissive));
      assert.equal(object.material.emissiveIntensity, original.emissiveIntensity);
    });
    assert.equal(meshes, 28);
    owner.dispose();
    const next = await assets.loadBoardable();
    next.group.traverse((object) => {
      if (object.isMesh)
        assert.equal(
          object.geometry.getAttribute('color'),
          colors.get(object.geometry),
          'neutral buffers are allocated once and reused across visits',
        );
    });
  } finally {
    assets.dispose();
  }
});

test('one lazy parked owner preserves actual door clips and seat anchors with reusable shared resources', async () => {
  const f = fixture();
  try {
    await requestNear(f.assets);
    const a = f.assets.loadBoardable(),
      b = f.assets.loadBoardable();
    assert.equal(a, b);
    const owner = await a;
    assert.equal(owner.group.parent, null);
    assert.equal(owner.vehicle.vehicleId, 'city-bus-12m');
    assert.equal(owner.animations.length, 4);
    assert.equal(f.calls.length, 4);
    assert.equal(f.assets.stats().materials, 8);
    assert.equal(f.assets.stats().boardableOwners, 1);
    for (const seat of owner.vehicle.seats)
      assert.ok(owner.interiorRoot.getObjectByName(seat.pelvisAnchorNodeId));
    const door = owner.vehicle.doors[0],
      node = owner.exteriorRoot.getObjectByName(door.nodeId);
    assert.deepEqual(
      node.position.toArray().map((v) => Math.round(v * 1e5)),
      door.closedTransform.translationM.map((v) => Math.round(v * 1e5)),
    );
    const clip = owner.animations.find((c) => c.name === door.animationClip);
    const action = owner.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    owner.mixer.setTime(clip.duration);
    assert.deepEqual(
      node.position.toArray().map((v) => Math.round(v * 1e5)),
      door.openTransform.translationM.map((v) => Math.round(v * 1e5)),
    );
    const mesh = owner.exteriorRoot.getObjectByProperty('isMesh', true);
    let geometryDisposals = 0,
      materialDisposals = 0;
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
    owner.dispose();
    owner.dispose();
    assert.equal(owner.group.children.length, 0);
    assert.equal(f.assets.stats().boardableOwners, 0);
    assert.equal(geometryDisposals, 0);
    assert.equal(materialDisposals, 0);
    const next = await f.assets.loadBoardable();
    assert.notEqual(next.group, owner.group);
    assert.equal(
      f.calls.length,
      4,
      'all four source templates are bounded and reused',
    );
    assert.equal(
      next.exteriorRoot.getObjectByName(door.nodeId).position.x,
      door.closedTransform.translationM[0],
    );
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      1,
    );
    f.assets.dispose();
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
    assert.equal(next.group.children.length, 0);
  } finally {
    f.assets.dispose();
  }
});

test('near load failure keeps every route available and malformed manifests cannot request authoring paths', async () => {
  const parent = new THREE.Group(),
    calls = [];
  const assets = new CityBusAssets([route()], parent, {
    fetchManifest: async () => manifest,
    load: (url) => {
      calls.push(url);
      return url.includes('exterior')
        ? Promise.reject(Error('network failed'))
        : parse(url);
    },
  });
  await requestNear(assets);
  assert.equal(assets.stats().status, 'error');
  assert.match(assets.stats().errors[0], /network failed/);
  assert.equal(assets.update(0, new THREE.Vector3(), () => 0, policy).size, 0);
  assets.dispose();
  const bad = structuredClone(manifest);
  bad.assets[0].lods[0].url =
    '/__offline-assets/boardable-bus/source/file.blend';
  const invalid = new CityBusAssets([route()], parent, {
    fetchManifest: async () => bad,
    load: (url) => {
      throw Error(`Unexpected fetch ${url}`);
    },
  });
  await requestNear(invalid);
  assert.equal(invalid.stats().status, 'error');
  assert.match(invalid.stats().errors[0], /Invalid bus LOD descriptor/);
  assert.equal(invalid.stats().loadedTemplates, 0);
  invalid.dispose();
});

test('late completion after disposal frees all four template payloads and never attaches owners', async () => {
  const parent = new THREE.Group(),
    pending = [];
  const assets = new CityBusAssets([route()], parent, {
    fetchManifest: async () => manifest,
    load: (url) => new Promise((resolve) => pending.push({ url, resolve })),
  });
  assets.update(0, new THREE.Vector3(), () => 0, policy);
  const boardable = assets.loadBoardable().then(
    () => {
      throw Error('Unexpected owner');
    },
    (error) => error,
  );
  await flush();
  assert.equal(pending.length, 4);
  assets.dispose();
  let disposals = 0;
  for (const request of pending) {
    const gltf = await parse(request.url);
    gltf.scene
      .getObjectByProperty('isMesh', true)
      .geometry.addEventListener('dispose', () => disposals++);
    request.resolve(gltf);
  }
  await requestNear(assets);
  assert.match((await boardable).message, /disposed/);
  assert.equal(disposals, 4);
  assert.equal(parent.children.length, 0);
  assert.equal(assets.stats().loadedTemplates, 0);
  assert.equal(assets.stats().allocatedBatches, 0);
});

test('aborted parked load rejects without consuming an owner or damaging the near fleet', async () => {
  const f = fixture();
  try {
    await requestNear(f.assets);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.assets.loadBoardable({ signal: controller.signal }));
    assert.equal(f.calls.length, 2);
    assert.equal(f.assets.stats().boardableOwners, 0);
    assert.equal(
      f.assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      1,
    );
    const owner = await f.assets.loadBoardable();
    assert.ok(owner.group);
    assert.equal(f.assets.stats().boardableOwners, 1);
  } finally {
    f.assets.dispose();
  }
});

test('synchronous loader failures are caught and never suppress the fallback fleet', async () => {
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => manifest,
    load: () => {
      throw Error('synchronous loader failure');
    },
  });
  await requestNear(assets);
  assert.equal(assets.stats().status, 'error');
  assert.match(assets.stats().errors[0], /synchronous loader failure/);
  assert.equal(assets.update(0, new THREE.Vector3(), () => 0, policy).size, 0);
  assets.dispose();
  const failedManifest = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: () => {
      throw Error('synchronous manifest failure');
    },
  });
  await requestNear(failedManifest);
  assert.equal(failedManifest.stats().status, 'error');
  failedManifest.dispose();
});

test('malformed parked clips reject the visit while valid near templates keep rendering', async () => {
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => manifest,
    load: async (url) => {
      const gltf = await parse(url);
      if (url.includes('exterior.lod0')) gltf.animations = [];
      return gltf;
    },
  });
  try {
    await requestNear(assets);
    await assert.rejects(assets.loadBoardable(), /door node\/clip unavailable/);
    assert.equal(assets.stats().boardableOwners, 0);
    assert.equal(
      assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      1,
    );
  } finally {
    assets.dispose();
  }
});

test('different PBR factors for one shared role are rejected rather than silently recoloring source meshes', async () => {
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => manifest,
    load: async (url) => {
      const gltf = await parse(url);
      if (url.includes('interior.lod1'))
        gltf.scene.traverse((o) => {
          if (o.isMesh && o.material.userData.semantic_role === 'glass')
            o.material.opacity = 0.7;
        });
      return gltf;
    },
  });
  try {
    await requestNear(assets);
    assert.equal(assets.stats().status, 'error');
    assert.match(assets.stats().errors[0], /inconsistent material factors/);
    assert.equal(assets.stats().allocatedBatches, 0);
    assert.equal(
      assets.update(0, new THREE.Vector3(), () => 0, policy).size,
      0,
    );
  } finally {
    assets.dispose();
  }
});

test('parked Retry reissues a failed GLB while preserving the successful actual template and metadata', async () => {
  let manifests = 0,
    failedOnce = false;
  const calls = [];
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => {
      manifests++;
      return manifest;
    },
    load: (url) => {
      calls.push(url);
      if (url.includes('exterior.lod0') && !failedOnce) {
        failedOnce = true;
        return Promise.reject(Error('transient GLB fetch failure'));
      }
      return parse(url);
    },
  });
  try {
    await assert.rejects(assets.loadBoardable(), /transient GLB fetch failure/);
    assert.equal(assets.stats().loadedTemplates, 1);
    assert.equal(assets.stats().boardableOwners, 0);
    const owner = await assets.loadBoardable();
    assert.equal(owner.animations.length, 4);
    assert.equal(manifests, 1);
    assert.equal(
      calls.filter((url) => url.includes('exterior.lod0')).length,
      2,
    );
    assert.equal(
      calls.filter((url) => url.includes('interior.lod0')).length,
      1,
    );
    assert.equal(assets.stats().loadedTemplates, 2);
    assert.equal(assets.stats().boardableOwners, 1);
  } finally {
    assets.dispose();
  }
});

test('a failed metadata request is retried on the next parked demand rather than cached forever', async () => {
  let manifests = 0;
  const calls = [];
  const assets = new CityBusAssets([route()], new THREE.Group(), {
    fetchManifest: async () => {
      if (++manifests === 1) throw Error('transient metadata failure');
      return manifest;
    },
    load: (url) => {
      calls.push(url);
      return parse(url);
    },
  });
  try {
    await assert.rejects(assets.loadBoardable(), /transient metadata failure/);
    assert.equal(calls.length, 0);
    const owner = await assets.loadBoardable();
    assert.equal(manifests, 2);
    assert.equal(calls.length, 2);
    assert.ok(owner.group);
  } finally {
    assets.dispose();
  }
});

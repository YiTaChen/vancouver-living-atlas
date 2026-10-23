import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { station } from './helpers/skytrain-geometry.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';

const { SkyTrainConstructionVisuals } = await import(
  cityModule('skytrain-construction-visuals')
);
const { stationConstructionPortals } = await import(
  cityModule('skytrain-construction-access')
);
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { TravelCameraCollision } = await import(
  cityModule('travel-camera-collision')
);
const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const messages = JSON.parse(
  readFileSync('lib/i18n/skytrain-construction.json', 'utf8'),
);
const ids = [
  'waterfront',
  'burrard',
  'granville',
  'stadium-chinatown',
  'main-street-science-world',
  'vancouver-city-centre',
  'yaletown-roundhouse',
];
const legacyIds = ids.filter((id) => !station(id).authoredInterior);
const expectedPortals = legacyIds.reduce((count, id) => {
  const owner = new SkyTrainStationOwner(
    station(id),
    cityElevation,
    'balanced',
    true,
  );
  const pairs = owner.streetRoutes().length;
  owner.dispose();
  return count + pairs * 2;
}, 0);
const renderables = (group, visible = false) => {
  const result = [];
  const visit = (node) => {
    if (
      node instanceof THREE.Mesh ||
      node instanceof THREE.Line ||
      node instanceof THREE.Points
    )
      result.push(node);
  };
  if (visible) group.traverseVisible(visit);
  else group.traverse(visit);
  return result;
};
const textures = (group) =>
  new Set(
    renderables(group).flatMap((node) => {
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      return materials.flatMap((material) =>
        material.map ? [material.map] : [],
      );
    }),
  );
function fixture(id = legacyIds[0]) {
  const owner = new SkyTrainStationOwner(
      station(id),
      cityElevation,
      'balanced',
      true,
    ),
    placements = stationConstructionPortals(owner, cityElevation),
    visuals = new SkyTrainConstructionVisuals(owner, placements);
  return {
    owner,
    placements,
    visuals,
    dispose() {
      visuals.dispose();
      owner.dispose();
    },
  };
}

test('all legacy station portals have bounded upright geometry and beside-route A-frames without lights, camera collision or picking', () => {
  let count = 0;
  for (const id of legacyIds) {
    const f = fixture(id);
    try {
      count += f.placements.length;
      assert.equal(f.visuals.group.parent, f.owner.group);
      assert.equal(f.visuals.group.children.length, f.placements.length * 2);
      assert.equal(
        textures(f.visuals.group).size,
        0,
        'construction never allocates label textures',
      );
      const geometries = new Set(
        renderables(f.visuals.group).map((node) => node.geometry),
      );
      assert.equal(
        geometries.size,
        8,
        'all rings, runes, particles and signs share eight geometries within the station',
      );
      f.visuals.group.traverse((node) => {
        assert(!(node instanceof THREE.Light));
        assert.equal(node.userData.cameraCollision, false);
      });
      for (const placement of f.placements) {
        const portal = f.visuals.group.children.find(
            (node) => node.userData.portalId === placement.id,
          ),
          sign = f.visuals.group.children.find(
            (node) => node.name === `Construction A-frame — ${placement.id}`,
          );
        assert.deepEqual(portal.position.toArray(), placement.point.position);
        assert.deepEqual(sign.position.toArray(), placement.signPosition);
        const delta = portal.position.clone().sub(sign.position),
          c = Math.cos(sign.rotation.y),
          s = Math.sin(sign.rotation.y),
          x = delta.x * c - delta.z * s,
          z = delta.x * s + delta.z * c,
          footprintClearance = Math.hypot(
            Math.max(0, Math.abs(x) - 0.4),
            Math.max(0, Math.abs(z) - 0.34),
          );
        assert(
          footprintClearance >= 0.45 - 1e-6,
          'the conservative A-frame footprint leaves a clear standing disc at the portal',
        );
        assert.equal(renderables(portal).length + renderables(sign).length, 8);
        const expected = new THREE.Vector3(
            ...f.owner.toWorld([
              placement.point.position[0],
              placement.point.position[1] + 1.1,
              placement.point.position[2],
            ]),
          ),
          anchor = f.visuals.worldAnchor(placement.id);
        assert(anchor.distanceTo(expected) < 1e-6);
        const bounds = new THREE.Box3().setFromObject(portal),
          inverse = portal.matrixWorld.clone().invert(),
          local = bounds.clone().applyMatrix4(inverse);
        assert(bounds.max.y - bounds.min.y < 2.21);
        assert(local.max.y < 2.21);
        const camera = anchor.clone().add(new THREE.Vector3(0, 0, 4)),
          direction = anchor.clone().sub(camera).normalize();
        assert.equal(
          new THREE.Raycaster(camera, direction).intersectObject(
            f.visuals.group,
            true,
          ).length,
          0,
        );
        const resolved = new TravelCameraCollision().resolve(
          anchor,
          camera,
          [f.visuals.group],
          0.2,
        );
        assert(resolved.distanceTo(camera) < 1e-8);
      }
    } finally {
      f.dispose();
    }
  }
  assert.equal(count, expectedPortals);
});

test('nearest portals alone animate; quality caps particles/draws and far labels release their CPU/GPU storage', () => {
  const f = fixture(),
    camera = f.visuals.worldAnchor(f.placements[0].id);
  try {
    f.visuals.update(0.016, camera, 'high', 'en');
    assert(renderables(f.visuals.group, true).length <= 32);
    assert(textures(f.visuals.group).size <= 4);
    const points = renderables(f.visuals.group).find(
      (node) => node instanceof THREE.Points,
    );
    assert.equal(points.geometry.drawRange.count, 48);
    const active = f.visuals.group.children.filter(
      (node) => node.visible && node.userData.portalId,
    );
    assert(active.length > 0 && active.length <= 4);
    const uniforms = active[0].children[0].children.find(
      (node) => node.material instanceof THREE.ShaderMaterial,
    ).material.uniforms;
    const before = uniforms.time.value;
    f.visuals.update(0.016, camera, 'high', 'en');
    assert(uniforms.time.value > before);
    const oldTextures = [...textures(f.visuals.group)],
      disposed = new Map(oldTextures.map((texture) => [texture, 0]));
    for (const texture of oldTextures)
      texture.addEventListener('dispose', () =>
        disposed.set(texture, disposed.get(texture) + 1),
      );
    const frozen = uniforms.time.value;
    f.visuals.update(0.1, new THREE.Vector3(1e5, 1e5, 1e5), 'high', 'en');
    assert.equal(renderables(f.visuals.group, true).length, 0);
    assert.equal(textures(f.visuals.group).size, 0);
    assert.equal(uniforms.time.value, frozen);
    assert([...disposed.values()].every((value) => value === 1));
    f.visuals.update(Infinity, camera, 'balanced', 'en');
    assert.equal(points.geometry.drawRange.count, 16);
    assert(renderables(f.visuals.group, true).length <= 16);
    assert(textures(f.visuals.group).size <= 2);
    assert(Number.isFinite(uniforms.time.value));
  } finally {
    f.dispose();
  }
});

test('a supported pedestrian approaching every legacy portal retains its physical F target at balanced quality while the real third-person camera follows behind', () => {
  const originalDocument = globalThis.document;
  Reflect.set(globalThis, 'document', {
    hidden: false,
    createElement: () => ({ getContext: () => null }),
  });
  let checked = 0;
  try {
    for (const id of legacyIds) {
      const f = fixture(id);
      try {
        const collision = new TravelCameraCollision();
        for (const portal of f.placements) {
          const normal = new THREE.Vector3(
              Math.sin(portal.point.yaw),
              0,
              Math.cos(portal.point.yaw),
            ),
            raw = new THREE.Vector3(...portal.point.position).addScaledVector(
              normal,
              1,
            ),
            foot = f.owner.floorAt(raw.toArray(), portal.point.surfaceId);
          assert(foot && f.owner.isClearFoot(foot));
          const camera = new THREE.PerspectiveCamera(65, 1.6, 0.05, 10000),
            worldFoot = new THREE.Vector3(...f.owner.toWorld(foot)),
            city = {
              camera,
              settings: { mode: 'walk' },
              controls: { target: new THREE.Vector3() },
              navigation: {
                position: new THREE.Vector3(),
                groundHeight: cityElevation,
                clearGround: () => true,
                walker: { group: new THREE.Group(), setSeated() {} },
              },
              renderer: { domElement: { setAttribute() {} } },
            },
            view = Object.assign(Object.create(SkyTrainWorldTravel.prototype), {
              city,
              owner: f.owner,
              station: id,
              phase: 'station',
              occupied: null,
              foot,
              stationSeat: null,
              cabinSeat: null,
              busy: false,
              disposed: false,
              inputEnabled: true,
              constructionAccess: new Map([[f.owner, f.placements]]),
              yaw: portal.point.yaw + Math.PI,
              lookYaw: 0,
              pitch: -0.03,
              distanceView: 4,
              avatarSeated: false,
              cameraCollision: collision,
            });
          const candidates = view
            .constructionCandidates()
            .sort(
              (a, b) =>
                new THREE.Vector3(...a.proximityPoint).distanceToSquared(
                  worldFoot,
                ) -
                new THREE.Vector3(...b.proximityPoint).distanceToSquared(
                  worldFoot,
                ),
            );
          assert(
            candidates[0].id.endsWith(`:${portal.id}`),
            'the actual F candidate is the portal one metre from supported feet',
          );
          view.updateCamera();
          assert(camera.position.distanceTo(worldFoot) > 1);
          f.visuals.update(0.016, worldFoot, 'balanced', 'en');
          const ring = f.visuals.group.children.find(
              (node) => node.userData.portalId === portal.id,
            ),
            sign = f.visuals.group.children.find(
              (node) => node.name === `Construction A-frame — ${portal.id}`,
            );
          assert(
            ring.visible && sign.visible,
            `${portal.id}: zooming behind the pedestrian cannot hide the active physical portal`,
          );
          assert(
            renderables(f.visuals.group, true).length <= 16,
            'the balanced two-portal budget remains intact',
          );
          checked++;
        }
      } finally {
        f.dispose();
      }
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
  assert.equal(checked, expectedPortals);
});

test('all10 localized signs allocate small nonmipped canvas labels lazily, reuse steady frames, and dispose each owned resource once', () => {
  const originalDocument = globalThis.document,
    f = fixture();
  let canvases = 0;
  const painted = [];
  const createCanvas = () => {
    canvases++;
    const context = new Proxy(
      {
        measureText: (value) => ({ width: Array.from(value).length * 30 }),
        fillText: (value) => painted.push(value),
      },
      {
        get(target, key) {
          return target[key] ?? (() => {});
        },
        set(target, key, value) {
          target[key] = value;
          return true;
        },
      },
    );
    return { width: 0, height: 0, getContext: () => context };
  };
  Reflect.set(globalThis, 'document', { createElement: createCanvas });
  const near = f.visuals.worldAnchor(f.placements[0].id),
    counts = new Map();
  try {
    assert.equal(canvases, 0);
    f.visuals.update(0, new THREE.Vector3(1e5, 1e5, 1e5), 'high', 'en');
    assert.equal(
      canvases,
      0,
      'even locale initialization allocates no far label',
    );
    assert.equal(Object.keys(messages).length, 10);
    for (const locale of Object.keys(messages)) {
      f.visuals.update(0.016, near, 'high', locale);
      const live = textures(f.visuals.group);
      assert(live.size > 0 && live.size <= 4);
      for (const texture of live) {
        assert.equal(texture.image.width, 384);
        assert.equal(texture.image.height, 480);
        assert.equal(texture.generateMipmaps, false);
        assert.equal(texture.minFilter, THREE.LinearFilter);
        assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
        if (!counts.has(texture)) {
          counts.set(texture, 0);
          texture.addEventListener('dispose', () =>
            counts.set(texture, counts.get(texture) + 1),
          );
        }
      }
      const before = canvases;
      for (let i = 0; i < 12; i++)
        f.visuals.update(0.016, near, 'high', locale);
      assert.equal(
        canvases,
        before,
        'unchanged labels allocate no canvas or texture during animation',
      );
      assert(
        painted.some(
          (value) =>
            messages[locale].construction.includes(value) && value !== '!',
        ),
      );
      for (const sign of f.visuals.group.children.filter((node) =>
        node.name.startsWith('Construction A-frame'),
      )) {
        assert(sign.userData.text.includes(messages[locale].construction));
        assert(sign.userData.text.includes(messages[locale].portal));
      }
    }
    const resources = new Set();
    for (const node of renderables(f.visuals.group)) {
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        resources.add(material);
    }
    for (const resource of resources) {
      counts.set(resource, 0);
      resource.addEventListener('dispose', () =>
        counts.set(resource, counts.get(resource) + 1),
      );
    }
    f.visuals.dispose();
    f.visuals.dispose();
    assert.equal(f.visuals.group.parent, null);
    assert([...counts.values()].every((value) => value === 1));
  } finally {
    f.dispose();
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

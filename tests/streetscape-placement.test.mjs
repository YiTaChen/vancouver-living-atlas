import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { createStreetfronts } = await import(cityModule('streetfronts'));
const { createProfile } = await import(cityModule('facade-profile'));
const { unproject } = await import(cityModule('geo'));

function fixture(compatibleGraphics = false) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(916, 12, 90);
  const roads = new THREE.Group();
  const pavement = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial(),
  );
  pavement.position.set(916, 11.58, 110);
  pavement.userData.walkSurface = true;
  roads.add(pavement);
  return {
    camera,
    roads,
    landmarks: new THREE.Group(),
    extraTextures: new Set(),
    compatibleGraphics,
    settings: { buildings: true, quality: 'high' },
    renderer: { shadowMap: { needsUpdate: false } },
    disposed: false,
    elevation() {
      return 10.4;
    },
    waterWorld: {
      solidAt() {
        return false;
      },
    },
    data: {
      buildings: {
        features: [
          {
            properties: { id: 'fixture', height: 16, minHeight: 0 },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [900, 100],
                  [932, 100],
                  [932, 120],
                  [900, 120],
                  [900, 100],
                ].map(([x, z]) => unproject(x, z)),
              ],
            },
          },
        ],
      },
      buildingFoundations: new Map([['fixture', 10]]),
      buildingProfiles: new Map([
        [
          'fixture',
          createProfile({
            key: 'fixture',
            heightM: 16,
            footprintAreaM2: 640,
            center: [916, 110],
          }),
        ],
      ]),
    },
  };
}

test('actual frontage fixture switches only eligible ground detail, keeps upper frames and restores fallback', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return new Proxy(
            {},
            {
              get: (target, key) => target[key] ?? (() => {}),
              set: (target, key, value) => {
                target[key] = value;
                return true;
              },
            },
          );
        },
      };
    },
  };
  try {
    const e = fixture();
    const kit = createStreetfronts(e, async () => {
      const scene = new THREE.Group();
      scene.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(3.2, 3.2, 0.3),
          new THREE.MeshStandardMaterial(),
        ),
      );
      return scene;
    });
    assert.ok(kit.snapshot().candidatesByAsset['heritage-shop-bay'] > 0);
    const original = [];
    e.landmarks.traverse((mesh) => {
      if (!(mesh instanceof THREE.InstancedMesh)) return;
      for (let index = 0; index < mesh.count; index++) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(index, matrix);
        original.push({ mesh, index, matrix });
      }
    });
    kit.update();
    await new Promise((resolve) => setImmediate(resolve));
    for (let frame = 0; frame < 8; frame++) kit.update();
    assert.ok(kit.snapshot().visibleBays > 0);
    let groundChanged = 0,
      upperChecked = 0;
    for (const { mesh, index, matrix } of original) {
      const current = new THREE.Matrix4();
      mesh.getMatrixAt(index, current);
      if (matrix.elements[13] > 14.5) {
        assert.deepEqual(
          current.elements,
          matrix.elements,
          'upper window/cornice matrix is never suppressed',
        );
        upperChecked++;
      } else if (!current.equals(matrix)) groundChanged++;
    }
    assert.ok(groundChanged > 0);
    assert.ok(upperChecked > 0);
    e.settings.quality = 'balanced';
    kit.update();
    for (const { mesh, index, matrix } of original) {
      const current = new THREE.Matrix4();
      mesh.getMatrixAt(index, current);
      assert.deepEqual(
        current.elements,
        matrix.elements,
        'every fallback instance restores exactly',
      );
    }
    kit.dispose();
    assert.equal(
      createStreetfronts(fixture(true)),
      null,
      'compatible graphics never owns or loads detailed assets',
    );
  } finally {
    globalThis.document = oldDocument;
  }
});

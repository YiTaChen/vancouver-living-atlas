import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  createSiwashRock,
  SIWASH_ROCK_PLACEMENT,
  SIWASH_ROCK_HORIZONTAL_SCALE,
  SIWASH_ROCK_TRIANGLE_LIMITS,
  SIWASH_ROCK_SOURCES,
} = await import(cityModule('assets/siwash-rock'));
const { SiwashRockDetail } = await import(cityModule('siwash-rock-detail'));
const { project } = await import(cityModule('geo'));
const LEVELS = ['low', 'medium', 'high'];

function meshes(group) {
  const found = [];
  group.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

for (const level of LEVELS)
  test(`Siwash ${level}: finite, nondegenerate opaque geometry within fixed budget`, () => {
    const group = createSiwashRock(level);
    assert.deepEqual(group.userData.placement, SIWASH_ROCK_PLACEMENT);
    const found = meshes(group);
    assert.equal(found.length, 1, 'one material draw for every active LOD');
    let triangles = 0;
    for (const mesh of found) {
      const geometry = mesh.geometry;
      const positions = geometry.getAttribute('position');
      const colours = geometry.getAttribute('color');
      const normals = geometry.getAttribute('normal');
      assert.equal(geometry.index, null);
      assert.equal(positions.count, colours.count);
      assert.equal(positions.count, normals.count);
      assert.equal(positions.count % 3, 0);
      triangles += positions.count / 3;
      for (const attribute of [positions, colours, normals])
        assert.ok([...attribute.array].every(Number.isFinite));
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let i = 0; i < positions.count; i += 3) {
        a.fromBufferAttribute(positions, i);
        b.fromBufferAttribute(positions, i + 1).sub(a);
        c.fromBufferAttribute(positions, i + 2).sub(a);
        assert.ok(b.cross(c).lengthSq() > 1e-12, `triangle ${i / 3} has area`);
      }
      assert.equal(mesh.material.transparent, false);
      assert.equal(mesh.material.opacity, 1);
      assert.equal(mesh.material.side, THREE.FrontSide);
      assert.equal(mesh.material.vertexColors, true);
      assert.equal(mesh.material.alphaTest, 0);
      for (const value of Object.values(mesh.material))
        assert.ok(
          !value?.isTexture,
          'no texture allocations or cutout foliage',
        );
      assert.equal(mesh.castShadow, true);
      assert.equal(mesh.receiveShadow, true);
      const bounds = geometry.boundingBox;
      assert.equal(bounds.min.y, 0, 'original world-water base remains fixed');
      assert.ok(bounds.max.y > 23 && bounds.max.y <= 26.5);
      // The original seven-sided 9.5m-base cylinder had these occupied bounds.
      assert.ok(bounds.min.x >= -9.262 && bounds.max.x <= 9.262);
      assert.ok(bounds.min.z >= -8.56 && bounds.max.z <= 9.5);
      assert.ok(bounds.max.x - bounds.min.x < 12);
      assert.ok(bounds.max.z - bounds.min.z < 12);
    }
    assert.ok(triangles <= SIWASH_ROCK_TRIANGLE_LIMITS[level]);
    assert.equal(group.userData.triangles, triangles);
    assert.ok(!group.children.some((object) => object.isLight));
    assert.deepEqual(group.userData.authoring.sources, [
      ...SIWASH_ROCK_SOURCES,
    ]);
    assert.equal(
      group.userData.authoring.sourceFootprint,
      'public/data/beach-coast.json land[1]',
    );
    assert.equal(group.userData.authoring.horizontalScale, 0.72);
  });

test('Siwash generation is deterministic and retains the same mass/tree across LODs', () => {
  const bounds = [];
  for (const level of LEVELS) {
    const first = meshes(createSiwashRock(level))[0].geometry;
    const second = meshes(createSiwashRock(level))[0].geometry;
    for (const name of ['position', 'color', 'normal'])
      assert.deepEqual(
        first.getAttribute(name).array,
        second.getAttribute(name).array,
      );
    bounds.push(first.boundingBox);
    // The crown has open space and a visible branching trunk rather than a cone.
    const positions = first.getAttribute('position');
    let upperMin = Infinity;
    let upperMax = -Infinity;
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) > 21) {
        upperMin = Math.min(upperMin, positions.getX(i));
        upperMax = Math.max(upperMax, positions.getX(i));
      }
    assert.ok(
      upperMax - upperMin > 9 * SIWASH_ROCK_HORIZONTAL_SCALE,
      'broad windswept crown silhouette after the horizontal island fit',
    );
  }
  for (const box of bounds) {
    assert.equal(box.min.y, bounds[0].min.y);
    assert.equal(box.max.y, bounds[0].max.y);
    assert.ok(box.min.distanceTo(bounds[0].min) < 0.5);
    assert.ok(box.max.distanceTo(bounds[0].max) < 0.5);
  }
});

test('Siwash rock faces point outwards, including water base and exposed summit', () => {
  const mesh = meshes(createSiwashRock('medium'))[0];
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  let dryFaces = 0;
  let baseFaces = 0;
  for (let i = 0; i < positions.count; i += 3) {
    const x =
      (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
    const y =
      (positions.getY(i) + positions.getY(i + 1) + positions.getY(i + 2)) / 3;
    const z =
      (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    if (y === 0) {
      assert.ok(normals.getY(i) < -0.99);
      baseFaces++;
    }
    if (y > 2 && y < 15 && Math.hypot(x, z) > 4) {
      assert.ok(x * normals.getX(i) + z * normals.getZ(i) > 0);
      dryFaces++;
    }
  }
  assert.ok(baseFaces > 0 && dryFaces > 100);
});

function host(quality = 'balanced') {
  const camera = new THREE.PerspectiveCamera();
  const [x, z] = project([
    SIWASH_ROCK_PLACEMENT.lon,
    SIWASH_ROCK_PLACEMENT.lat,
  ]);
  camera.position.set(x, 12, z + 30);
  return {
    camera,
    landmarks: new THREE.Group(),
    settings: { quality, buildings: true },
    renderer: { shadowMap: { needsUpdate: false } },
  };
}

function atSurfaceDistance(e, owner, distance) {
  const centre = owner.bounds.getCenter(new THREE.Vector3());
  e.camera.position.set(centre.x, centre.y, owner.bounds.max.z + distance);
}

function visibleLevelCount(owner) {
  return Object.values(owner.levels).filter((group) => group.visible).length;
}

test('Siwash default and effective Auto qualities choose bounded levels with hysteresis', () => {
  const e = host();
  const owner = new SiwashRockDetail(e);
  assert.equal(
    owner.activeLevel,
    'medium',
    'Balanced gets authored detail nearby',
  );
  assert.equal(visibleLevelCount(owner), 1);
  assert.equal(owner.holder.parent, e.landmarks);
  assert.equal(owner.holder.position.y, 0);
  const resources = Object.values(owner.levels).map(
    (group) => meshes(group)[0].geometry,
  );
  atSurfaceDistance(e, owner, 440);
  owner.update();
  assert.equal(
    owner.activeLevel,
    'medium',
    'small distance changes do not flicker',
  );
  atSurfaceDistance(e, owner, 500);
  owner.update();
  assert.equal(owner.activeLevel, 'low');
  atSurfaceDistance(e, owner, 440);
  owner.update();
  assert.equal(owner.activeLevel, 'low', 're-entry uses the lower threshold');
  atSurfaceDistance(e, owner, 400);
  owner.update();
  assert.equal(owner.activeLevel, 'medium');
  e.settings.quality = 'high';
  atSurfaceDistance(e, owner, 200);
  owner.update();
  assert.equal(owner.activeLevel, 'high', 'default High improves close views');
  atSurfaceDistance(e, owner, 260);
  owner.update();
  assert.equal(owner.activeLevel, 'high');
  atSurfaceDistance(e, owner, 290);
  owner.update();
  assert.equal(owner.activeLevel, 'medium');
  e.settings.quality = 'ultra';
  atSurfaceDistance(e, owner, 600);
  owner.update();
  assert.equal(owner.activeLevel, 'high');
  // Auto writes its effective quality into this same setting; an effective
  // downgrade immediately drops the high level without a separate manual mode.
  e.settings.quality = 'balanced';
  owner.update();
  assert.equal(owner.activeLevel, 'low');
  for (let i = 0; i < 100; i++) owner.update();
  assert.deepEqual(
    Object.values(owner.levels).map((group) => meshes(group)[0].geometry),
    resources,
  );
  assert.equal(visibleLevelCount(owner), 1);
  e.renderer.shadowMap.needsUpdate = false;
  owner.update();
  assert.equal(
    e.renderer.shadowMap.needsUpdate,
    false,
    'stable frames do not refresh static shadows',
  );
  e.settings.buildings = false;
  owner.update();
  assert.equal(owner.holder.visible, false);
  assert.equal(e.renderer.shadowMap.needsUpdate, true);
  owner.dispose();
});

test('Siwash owner releases detached resources once and ignores later updates', () => {
  const e = host('high');
  const owner = new SiwashRockDetail(e);
  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const group of Object.values(owner.levels))
    for (const mesh of meshes(group)) {
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      mesh.material.addEventListener('dispose', () => materialDisposals++);
    }
  owner.dispose();
  owner.dispose();
  owner.update();
  assert.equal(e.landmarks.children.length, 0);
  assert.equal(owner.holder.parent, null);
  assert.equal(owner.holder.children.length, 0);
  assert.equal(geometryDisposals, 3);
  assert.equal(materialDisposals, 3);
  // The engine's final traversal sees no disposed Siwash resources.
  e.landmarks.traverse((object) => assert.ok(!object.isMesh));
});

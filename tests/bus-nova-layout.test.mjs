import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Independent physical reference: TransLink BIDG 2018, PDF pages 24–25,
// Figure 1.2.11. Dimensions are measured from the axle-midpoint datum.
const portals = [
  { group: 'front', minZ: 4, maxZ: 5.2, centerZ: 4.6, width: 1.2 },
  { group: 'rear', minZ: -2.3, maxZ: -1.4, centerZ: -1.85, width: 0.9 },
];
const near = (actual, expected, tolerance = 0.00002) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const metadata = async (directory) =>
  JSON.parse(
    await readFile(`public/models/blender/${directory}/manifest.json`),
  );
const parse = async (file) => {
  const bytes = await readFile(file);
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
};
const dispose = (root) => {
  const geometries = new Set(),
    materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of [].concat(object.material)) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
};

test('all deployed bus profiles use the Nova door spacing and keep both exits on low floor', async () => {
  for (const directory of ['bus', 'bus-v2', 'bus-closeup']) {
    const vehicle = (await metadata(directory)).vehicles[0];
    near(vehicle.bodyBoundsM.max[2], 6.1);
    near(vehicle.bodyBoundsM.min[2], -6.3);
    near(vehicle.wheelbaseM, 6.2);
    near(vehicle.nominalLengthM, 12.4);
    for (const portal of portals) {
      const leaves = vehicle.doors.filter(
        (door) => door.doorGroupId === portal.group,
      );
      assert.equal(leaves.length, 2);
      for (const door of leaves) {
        assert.equal(door.side, 'right');
        near(
          Math.min(...door.openingPolygonM.map((point) => point[2])),
          portal.minZ,
        );
        near(
          Math.max(...door.openingPolygonM.map((point) => point[2])),
          portal.maxZ,
        );
        near(door.boardingPointM[2], portal.centerZ);
        near(door.doorWidthM, portal.width);
        near(door.sillHeightM, 0.36);
        assert(door.openingPolygonM.every((point) => point[0] === -1.25));
      }
      const support = vehicle.floorSurfaces.filter((surface) =>
        surface.verticesM.some((point) => point[0] <= -1.249),
      );
      assert(
        support.some(
          (surface) =>
            surface.verticesM.every(
              (point) => Math.abs(point[1] - 0.36) < 0.00002,
            ) &&
            Math.min(...surface.verticesM.map((point) => point[2])) <=
              portal.minZ &&
            Math.max(...surface.verticesM.map((point) => point[2])) >=
              portal.maxZ,
        ),
        `${directory}: continuous ${portal.group} threshold`,
      );
    }
    const [front, rear] = portals.map(
      (portal) =>
        vehicle.doors.find((door) => door.doorGroupId === portal.group)
          .boardingPointM[2],
    );
    near(front - rear, 6.45);
    if (directory !== 'bus') {
      assert.equal(vehicle.seats.length, 24);
      const lowFloor = vehicle.floorSurfaces.find(
        (surface) => surface.surfaceId === 'low-floor',
      );
      assert(
        Math.min(...lowFloor.verticesM.map((point) => point[2])) < -2.3,
        'the complete rear doorway stays ahead of the stairs',
      );
    }
  }
});

test('actual exterior LODs have correctly sized doors and clear the relocated apertures when opened', async () => {
  const manifest = await metadata('bus');
  for (const lod of manifest.assets[0].lods.filter((item) => item.level < 2)) {
    const gltf = await parse(`public${lod.url}`),
      root = gltf.scene;
    try {
      root.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const hits = (z, y) => {
        ray.set(new THREE.Vector3(-1.45, y, z), new THREE.Vector3(1, 0, 0));
        ray.near = 0;
        ray.far = 0.29;
        return ray.intersectObject(root, true);
      };
      for (const portal of portals) {
        const box = new THREE.Box3();
        for (const suffix of ['a', 'b'])
          box.union(
            new THREE.Box3().setFromObject(
              root.getObjectByName(`door-right-${portal.group}-${suffix}`),
            ),
          );
        near((box.min.z + box.max.z) / 2, portal.centerZ);
        near(box.max.z - box.min.z, portal.width, 0.035);
        // Probe both leaves away from the deliberately modelled centre seam.
        for (const offset of [-0.12, 0.12])
          assert(
            hits(portal.centerZ + offset, 1.3).length > 0,
            'closed leaves cover their actual aperture',
          );
      }
      const mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      }
      mixer.update(
        Math.max(...gltf.animations.map((clip) => clip.duration)) + 0.01,
      );
      root.updateMatrixWorld(true);
      for (const portal of portals)
        for (const z of [
          portal.minZ + 0.08,
          portal.centerZ,
          portal.maxZ - 0.08,
        ])
          for (const y of [0.8, 1.3, 1.9])
            assert.equal(
              hits(z, y).length,
              0,
              `LOD${lod.level} ${portal.group} aperture blocked at ${z}, ${y}`,
            );
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    } finally {
      dispose(root);
    }
  }
});

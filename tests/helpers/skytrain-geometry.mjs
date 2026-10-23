import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { cityModule } from './city-modules.mjs';
import { cityElevation } from './city-elevation.mjs';

const { SkyTrainCabinAssets } = await import(
  cityModule('skytrain-cabin-assets')
);
const { SkyTrainRideTrain } = await import(cityModule('skytrain-ride-train'));
const { SkyTrainTravel } = await import(cityModule('skytrain-travel'));
const { adaptSkyTrainStationFrame, SkyTrainRidePath, validateSkyTrainRoutes } =
  await import(cityModule('skytrain-ride-path'));
const { stationRailEnvelope } = await import(
  cityModule('skytrain-station-rail-envelope')
);
const {
  SkyTrainStationOwner,
  trainStopFor,
  stationWorldPose,
  validateRuntimeStation,
} = await import(cityModule('skytrain-stations'));

export const routes = validateSkyTrainRoutes(
  JSON.parse(fs.readFileSync('public/models/skytrain-routes.json')),
);
const manifest = JSON.parse(
  fs.readFileSync('public/models/blender/metro/manifest.json'),
);
const stations = new Map();
export function station(id) {
  if (!stations.has(id)) {
    const data = validateRuntimeStation(
      JSON.parse(fs.readFileSync(`public/models/skytrain-stations/${id}.json`)),
      id,
    );
    stations.set(id, adaptSkyTrainStationFrame(data, routes));
  }
  return stations.get(id);
}
function stop(segment, id) {
  const data = station(id),
    local = trainStopFor(data, segment.lineId, segment.direction),
    world = stationWorldPose(
      data,
      cityElevation,
      local.position,
      local.quaternion,
    );
  return {
    position: new THREE.Vector3(...world.position),
    quaternion: new THREE.Quaternion(...world.quaternion),
    motionSign: local.motionSign,
  };
}
export function ridePath(segment) {
  return new SkyTrainRidePath(
    routes,
    segment.lineId,
    segment.from,
    segment.to,
    stop(segment, segment.from),
    stop(segment, segment.to),
    cityElevation,
    [segment.from, segment.to]
      .map((id) =>
        stationRailEnvelope(
          station(id),
          segment.lineId,
          segment.direction,
          cityElevation,
        ),
      )
      .filter(Boolean),
  );
}
export function stationOwner(id) {
  return new SkyTrainStationOwner(station(id), cityElevation);
}
async function actualGLB(url) {
  const bytes = fs.readFileSync('public' + url),
    loader = new GLTFLoader(),
    originalSelf = globalThis.self;
  globalThis.self = globalThis;
  // Substitute bitmap decoding only. All geometry, named anchors, materials,
  // transforms, doors and per-car frames come from the current real GLBs.
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
export async function actualTrain(line) {
  const train = new SkyTrainRideTrain(
    new SkyTrainCabinAssets({
      fetchManifest: async () => manifest,
      load: actualGLB,
    }),
  );
  assert(await train.load(line, 'balanced', false));
  assert.equal(train.carFrames.length, line === 'expo' ? 4 : 2);
  return train;
}
/** Bounds measured from the loaded GLB hierarchy and rendered one-per-car
 * exterior instances, in each real car's frame. Empty Expo clone frames still
 * include their actual shared service-shell geometry. */
export function actualCarBounds(train) {
  train.group.updateMatrixWorld(true);
  return train.carFrames.map((car, carIndex) => {
    const bounds = new THREE.Box3(),
      inverse = car.matrixWorld.clone().invert(),
      include = (mesh, matrix) => {
        mesh.geometry.computeBoundingBox();
        bounds.union(
          mesh.geometry.boundingBox
            .clone()
            .applyMatrix4(inverse.clone().multiply(matrix)),
        );
      };
    car.traverse((mesh) => {
      if (mesh instanceof THREE.Mesh) include(mesh, mesh.matrixWorld);
    });
    for (const mesh of train.group.children) {
      if (
        !(mesh instanceof THREE.InstancedMesh) ||
        mesh.count !== train.carFrames.length
      )
        continue;
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(carIndex, matrix);
      include(mesh, matrix.premultiply(mesh.matrixWorld));
    }
    assert(!bounds.isEmpty());
    return bounds;
  });
}
export function actualTunnel(path) {
  // Exercise the actual product method, including its sampling, terrain gate,
  // material, open terminal cuts and geometry. Avoid a duplicate tube builder.
  const controller = Object.create(SkyTrainTravel.prototype);
  controller.city = { scene: new THREE.Scene(), elevation: cityElevation };
  controller.tube = null;
  controller.buildTunnel(path);
  const group = controller.tube;
  assert(group instanceof THREE.Group);
  return {
    group,
    dispose() {
      controller.clearTube();
      assert.equal(controller.tube, null);
      assert.equal(group.parent, null);
    },
  };
}
export function resourceDisposals(group) {
  const resources = new Set();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    if (object instanceof THREE.InstancedMesh) resources.add(object);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) resources.add(value);
    }
  });
  const counts = new Map([...resources].map((resource) => [resource, 0]));
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      counts.set(resource, counts.get(resource) + 1),
    );
  return () => {
    assert(counts.size > 0);
    for (const count of counts.values())
      assert.equal(count, 1, 'every actual GPU resource releases exactly once');
  };
}

const CELL = 16,
  key = (x, z) => `${x},${z}`;
function append(map, id, value) {
  const list = map.get(id) ?? [];
  list.push(value);
  map.set(id, list);
}
/** Spatial rejection only; final narrow-phase tests use actual mesh triangles. */
export function tunnelIndex(group) {
  const triangles = [],
    triangleGrid = new Map(),
    axisGrid = new Map(),
    axes = [];
  for (const mesh of group.children) {
    assert(mesh instanceof THREE.Mesh);
    assert(mesh.geometry instanceof THREE.TubeGeometry);
    const geometry = mesh.geometry,
      attribute = geometry.getAttribute('position'),
      index = geometry.index,
      curve = geometry.parameters.path,
      axis = curve.getPoints(Math.ceil(curve.getLength() / 0.25)),
      run = axes.length;
    assert.equal(geometry.parameters.radius, 3.5);
    assert.equal(geometry.parameters.radialSegments, 8);
    axes.push(axis);
    axis.forEach((p, i) =>
      append(axisGrid, key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)), {
        p,
        run,
        i,
      }),
    );
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [0, 1, 2].map((j) =>
          new THREE.Vector3().fromBufferAttribute(attribute, index.getX(i + j)),
        ),
        triangle = new THREE.Triangle(...vertices),
        box = new THREE.Box3().setFromPoints(vertices),
        id = triangles.length;
      assert(vertices.every((p) => p.toArray().every(Number.isFinite)));
      triangles.push({ triangle, box });
      for (
        let x = Math.floor(box.min.x / CELL);
        x <= Math.floor(box.max.x / CELL);
        x++
      )
        for (
          let z = Math.floor(box.min.z / CELL);
          z <= Math.floor(box.max.z / CELL);
          z++
        )
          append(triangleGrid, key(x, z), id);
    }
  }
  assert(triangles.length > 0);
  const scratch = new THREE.Triangle();
  return {
    intersects(localBox, matrix) {
      const worldBox = localBox.clone().applyMatrix4(matrix),
        inverse = matrix.clone().invert(),
        ids = new Set();
      for (
        let x = Math.floor(worldBox.min.x / CELL);
        x <= Math.floor(worldBox.max.x / CELL);
        x++
      )
        for (
          let z = Math.floor(worldBox.min.z / CELL);
          z <= Math.floor(worldBox.max.z / CELL);
          z++
        )
          for (const id of triangleGrid.get(key(x, z)) ?? []) ids.add(id);
      for (const id of ids) {
        const source = triangles[id];
        if (!worldBox.intersectsBox(source.box)) continue;
        scratch.copy(source.triangle);
        scratch.a.applyMatrix4(inverse);
        scratch.b.applyMatrix4(inverse);
        scratch.c.applyMatrix4(inverse);
        if (localBox.intersectsTriangle(scratch)) return true;
      }
      return false;
    },
    eyeInside(point) {
      const cx = Math.floor(point.x / CELL),
        cz = Math.floor(point.z / CELL);
      let best = { distance: Infinity, run: -1, i: -1 };
      for (let radius = 1; radius < 20; radius++) {
        for (let x = cx - radius; x <= cx + radius; x++)
          for (let z = cz - radius; z <= cz + radius; z++) {
            if (
              radius > 1 &&
              Math.abs(x - cx) < radius &&
              Math.abs(z - cz) < radius
            )
              continue;
            for (const a of axisGrid.get(key(x, z)) ?? []) {
              const distance = point.distanceTo(a.p);
              if (distance < best.distance)
                best = { distance, run: a.run, i: a.i };
            }
          }
        const outside = Math.min(
          point.x - (cx - radius) * CELL,
          (cx + radius + 1) * CELL - point.x,
          point.z - (cz - radius) * CELL,
          (cz + radius + 1) * CELL - point.z,
        );
        if (best.distance < outside) break;
      }
      // A camera before/after the open-ended tube belongs to its station's
      // enclosure. The independent portal test checks that physical region.
      if (best.run < 0 || best.i < 24 || best.i > axes[best.run].length - 25)
        return true;
      return Number.isFinite(best.distance) && best.distance < 3.5;
    },
  };
}

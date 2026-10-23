/* oxlint-disable typescript/unbound-method -- Identity checks verify restoration of borrowed shader hooks; runtime invokes them with .call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import {
  makeRuntimeStation,
  SOURCE,
} from '../tools/build-skytrain-runtime-stations.mjs';
import {
  rebuildBurrard,
  rebuildGranville,
} from '../tools/station-interiors/dunsmuir.mjs';
import { rebuildWaterfront } from '../tools/station-interiors/waterfront.mjs';
import {
  rebuildStadium,
  rebuildYaletown,
} from '../tools/station-interiors/southeast.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { TravelOcclusion } = await import(cityModule('travel-occlusion'));
const { stationCityOpenings, applySkyTrainWorldOpenings } = await import(
  cityModule('skytrain-world-openings')
);
const packet = (id) =>
  JSON.parse(readFileSync(`public/models/skytrain-stations/${id}.json`));
const ownerFor = (id) =>
  new SkyTrainStationOwner(packet(id), () => 0, 'balanced', true);
function contains(opening, point) {
  const [a, b, c, d] = opening.polygon.map((p) => new THREE.Vector3(...p)),
    center = a.clone().add(c).multiplyScalar(0.5),
    across = d.clone().sub(a).setY(0),
    along = b.clone().sub(a).setY(0),
    delta = new THREE.Vector3(...point).sub(center).setY(0),
    width = across.length(),
    length = along.length();
  return (
    point[1] >= opening.minY &&
    point[1] <= opening.maxY &&
    Math.abs(delta.dot(across.normalize())) < width / 2 &&
    Math.abs(delta.dot(along.normalize())) < length / 2
  );
}

test('rotated Waterfront connector apertures stop at the actual end plane and preserve the retained SkyWalk soffit', () => {
  const owner = authoredOwner('waterfront'),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    const floor = owner.data.floors.find(
        (f) => f.id === 'waterfront-seabus-heritage-connector-1',
      ),
      start = new THREE.Vector3(...floor.vertices[0])
        .add(new THREE.Vector3(...floor.vertices[3]))
        .multiplyScalar(0.5),
      end = new THREE.Vector3(...floor.vertices[1])
        .add(new THREE.Vector3(...floor.vertices[2]))
        .multiplyScalar(0.5),
      direction = end.clone().sub(start).setY(0).normalize(),
      across = new THREE.Vector3(direction.z, 0, -direction.x),
      openings = stationCityOpenings(owner),
      connector = openings.find(
        (o) => o.id === `${floor.id}-authored-room-clearance`,
      );
    assert(connector);
    const originalBounds = new THREE.Box3().setFromPoints(
      floor.vertices.map((p) => new THREE.Vector3(...p)),
    );
    assert(
      Math.abs(direction.x) > 0.2 && Math.abs(direction.z) > 0.2,
      'fixture must exercise a genuinely diagonal end plane',
    );
    patch.update([owner]);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <clipping_planes_fragment>',
    };
    material.onBeforeCompile(shader, {});
    const rows = shader.uniforms.uStationOpeningData.value.image.data,
      count = shader.uniforms.uStationOpeningCount.value,
      discardedByUploadedTexture = (point) => {
        for (let i = 0; i < count; i++) {
          const row = rows.subarray(i * 8, i * 8 + 8),
            dx = point[0] - row[0],
            dz = point[2] - row[1],
            across = dx * row[4] + dz * row[5],
            along = -dx * row[5] + dz * row[4];
          if (
            Math.abs(across) < row[2] &&
            Math.abs(along) < row[3] &&
            point[1] >= row[6] &&
            point[1] <= row[7]
          )
            return true;
        }
        return false;
      };
    let oldAabbWouldRemoveRetainedRoof = false;
    for (const offset of [-1.8, 0, 1.8]) {
      const inside = end
          .clone()
          .addScaledVector(direction, -0.1)
          .addScaledVector(across, offset)
          .add(new THREE.Vector3(0, 3.62, 0)),
        retained = end
          .clone()
          .addScaledVector(direction, 0.2)
          .addScaledVector(across, offset)
          .add(new THREE.Vector3(0, 3.62, 0)),
        insideWorld = owner.toWorld(inside.toArray()),
        retainedWorld = owner.toWorld(retained.toArray());
      oldAabbWouldRemoveRetainedRoof ||= originalBounds.containsPoint(
        retained.clone().setY(floor.vertices[0][1]),
      );
      assert(
        contains(connector, insideWorld),
        'real connector headspace remains open',
      );
      assert(discardedByUploadedTexture(insideWorld));
      assert(
        !openings.some((opening) => contains(opening, retainedWorld)),
        'no room AABB may erase the retained roof beyond the diagonal source end',
      );
      assert(
        !discardedByUploadedTexture(retainedWorld),
        'the actual GPU texture predicate must retain the old SkyWalk soffit',
      );
    }
    assert(
      oldAabbWouldRemoveRetainedRoof,
      'negative fixture must expose the previous AABB corner bug',
    );
  } finally {
    patch.dispose();
    geometry.dispose();
    material.dispose();
    owner.dispose();
  }
});
test('authored flat farehall headspace removes the city slab seen above the actual walking floor', () => {
  const owner = ownerFor('waterfront');
  try {
    const floor =
        owner.data.floors.find((f) => f.id === 'waterfront-expo-paid-annex') ??
        owner.data.floors.find((f) => f.id === 'waterfront-expo-fare-hall'),
      box = new THREE.Box3().setFromPoints(
        floor.vertices.map((p) => new THREE.Vector3(...p)),
      ),
      center = box.getCenter(new THREE.Vector3()),
      point = owner.toWorld([center.x, center.y + 0.22, center.z]),
      openings = stationCityOpenings(owner);
    assert(
      openings.some(
        (opening) =>
          opening.id === `${floor.id}-authored-room-clearance` &&
          contains(opening, point),
      ),
    );
    assert(
      !openings.some((opening) =>
        contains(opening, owner.toWorld([500, 0, 500])),
      ),
      'bounded clearances retain the surrounding city',
    );
  } finally {
    owner.dispose();
  }
});
test('one full bank aperture includes the space outside individual stair and escalator lanes', () => {
  const owner = ownerFor('waterfront');
  try {
    const bank = owner.geometryData.parts.some(
        (part) => part.id === 'waterfront-expo-east-bank-soffit',
      )
        ? 'waterfront-expo-east-bank'
        : 'waterfront-expo-hall-bank',
      part = owner.geometryData.parts.find((p) => p.id === bank + '-soffit'),
      slab = owner.geometryData.parts.find((p) => p.id === bank + '-underslab'),
      rotation = new THREE.Quaternion(...slab.quaternion),
      across = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
      point = new THREE.Vector3(...slab.position).addScaledVector(
        across,
        part.size[0] / 2 - 0.35,
      );
    point.y += 1.2;
    const world = owner.toWorld(point.toArray()),
      full = stationCityOpenings(owner),
      lanes = owner
        .terrainOpenings()
        .filter((opening) => opening.id.endsWith('-authored-opening'));
    assert(
      !lanes.some((opening) => contains(opening, world)),
      'fixture samples beyond the old individual lane cutouts',
    );
    assert(
      full.some(
        (opening) =>
          opening.id === bank + '-authored-bank-clearance' &&
          contains(opening, world),
      ),
    );
  } finally {
    owner.dispose();
  }
});
test('existing city materials receive bounded room/bank uniforms while first-person station walls remain intact', () => {
  const owner = ownerFor('waterfront'),
    cityRoot = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry(),
    mesh = new THREE.Mesh(geometry, material);
  cityRoot.add(mesh);
  const station = owner.group.children.find(
      (object) => object.name === 'station-authored-cream-structure',
    ),
    previousStationHook = station.material.onBeforeCompile,
    previousStationKey = station.material.customProgramCacheKey(),
    patch = applySkyTrainWorldOpenings([cityRoot]);
  try {
    patch.update([owner]);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <clipping_planes_fragment>',
    };
    material.onBeforeCompile(shader, {});
    assert.equal(
      shader.uniforms.uStationOpeningCount.value,
      stationCityOpenings(owner).length,
    );
    assert(shader.fragmentShader.includes('discard'));
    assert.equal(station.material.onBeforeCompile, previousStationHook);
    assert.equal(station.material.customProgramCacheKey(), previousStationKey);
    owner.setCutaway(null);
    assert(
      owner.group.children
        .filter((object) => object.userData.stationOverhead)
        .every((object) => object.visible),
    );
  } finally {
    patch.dispose();
    geometry.dispose();
    material.dispose();
    owner.dispose();
  }
});
test('all seven geographic stations fit the existing shared aperture texture budget', () => {
  const ids = [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
      'vancouver-city-centre',
      'yaletown-roundhouse',
    ],
    owners = ids.map(ownerFor),
    patch = applySkyTrainWorldOpenings([]);
  try {
    assert(
      owners.reduce(
        (count, owner) => count + stationCityOpenings(owner).length,
        0,
      ) <=
        7 * 48,
    );
    assert.doesNotThrow(() => patch.update(owners));
    for (const owner of owners.filter((owner) => !owner.data.authoredInterior))
      assert.equal(stationCityOpenings(owner), owner.terrainOpenings());
  } finally {
    patch.dispose();
    owners.forEach((owner) => owner.dispose());
  }
});

const authoredOwner = (id) => {
  const source = JSON.parse(readFileSync(SOURCE)).stations.find(
      (s) => s.stationId === id,
    ),
    rebuild = {
      waterfront: rebuildWaterfront,
      burrard: rebuildBurrard,
      granville: rebuildGranville,
      'stadium-chinatown': rebuildStadium,
      'yaletown-roundhouse': rebuildYaletown,
    }[id];
  return new SkyTrainStationOwner(
    makeRuntimeStation(rebuild ? rebuild(source) : source, 'a'.repeat(64)),
    () => 0,
    'balanced',
    true,
  );
};
test('all reference-authored stations fit bounded texture storage, including curved banks and high glass halls', () => {
  const owners = [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
      'vancouver-city-centre',
      'yaletown-roundhouse',
    ].map(authoredOwner),
    patch = applySkyTrainWorldOpenings([]);
  try {
    assert.doesNotThrow(() => patch.update(owners));
    assert(
      owners.reduce(
        (sum, owner) => sum + stationCityOpenings(owner).length,
        0,
      ) <=
        7 * 48,
    );
    for (const [id, banks] of [
      [
        'burrard',
        ['burrard-main-escalator-bank', 'burrard-street-retaining-walls'],
      ],
      [
        'granville',
        [
          'granville-big-three',
          'granville-bay-corridor-pair',
          'granville-dunsmuir-main-triple',
        ],
      ],
    ]) {
      const owner = owners.find((owner) => owner.data.id === id),
        openings = stationCityOpenings(owner);
      for (const bank of banks) {
        const slab = owner.geometryData.parts.find(
            (part) => part.id === bank + '-underslab',
          ),
          rotation = new THREE.Quaternion(...slab.quaternion),
          edge = new THREE.Vector3(...slab.position).addScaledVector(
            new THREE.Vector3(1, 0, 0).applyQuaternion(rotation),
            slab.size[0] / 2 - 0.15,
          );
        edge.y += 1.5;
        assert(
          openings.some(
            (opening) =>
              opening.id === bank + '-authored-bank-clearance' &&
              contains(opening, owner.toWorld(edge.toArray())),
          ),
          `${bank}: entire occupied bank is open`,
        );
      }
    }
    const burrard = owners.find((owner) => owner.data.id === 'burrard'),
      high = burrard.toWorld([
        -1,
        burrard.data.floors.find((f) => f.id === 'burrard-ticket-atrium')
          .vertices[0][1] + 7.6,
        -105,
      ]);
    assert(
      stationCityOpenings(burrard).some(
        (opening) =>
          opening.id === 'burrard-ticket-atrium-authored-room-clearance' &&
          contains(opening, high),
      ),
      'glass atrium headspace reaches its explicit roof',
    );
    assert(
      !stationCityOpenings(burrard).some((opening) =>
        contains(opening, burrard.toWorld([200, 5, -105])),
      ),
    );
  } finally {
    patch.dispose();
    owners.forEach((owner) => owner.dispose());
  }
});
test('apertures use two float texture texels each, upload only for changed owners and release once', () => {
  const owner = authoredOwner('granville'),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    patch.update([owner]);
    const shader = {
      uniforms: {},
      vertexShader: '#include <project_vertex>',
      fragmentShader: '#include <clipping_planes_fragment>',
    };
    material.onBeforeCompile(shader, {});
    const texture = shader.uniforms.uStationOpeningData.value;
    assert(texture instanceof THREE.DataTexture);
    assert.equal(texture.image.width, 2);
    assert.equal(texture.image.height, 7 * 48);
    assert.equal(texture.type, THREE.FloatType);
    assert.equal(texture.minFilter, THREE.NearestFilter);
    assert.equal(texture.magFilter, THREE.NearestFilter);
    assert.equal(texture.colorSpace, THREE.NoColorSpace);
    assert(texture.image.data instanceof Float32Array);
    assert(shader.fragmentShader.includes('texelFetch'));
    assert(
      !shader.fragmentShader.includes('uniform vec4 uStationOpeningRect['),
    );
    assert(
      !shader.uniforms.uStationOpeningRect &&
        !shader.uniforms.uStationOpeningParameters,
    );
    const first = stationCityOpenings(owner)[0],
      center = first.polygon[0].map(
        (n, axis) => (n + first.polygon[2][axis]) / 2,
      ),
      row = texture.image.data;
    assert(
      Math.abs(row[0] - center[0]) < 0.001 &&
        Math.abs(row[1] - center[2]) < 0.001,
    );
    assert(
      Math.abs(row[6] - first.minY) < 0.001 &&
        Math.abs(row[7] - first.maxY) < 0.001,
    );
    const version = texture.version;
    patch.update([owner]);
    assert.equal(
      texture.version,
      version,
      'unchanged geographic owners do not upload again',
    );
    patch.update([]);
    assert.equal(shader.uniforms.uStationOpeningCount.value, 0);
    assert(texture.version > version);
    let releases = 0;
    texture.addEventListener('dispose', () => releases++);
    patch.dispose();
    patch.dispose();
    assert.equal(releases, 1);
  } finally {
    patch.dispose();
    owner.dispose();
    geometry.dispose();
    material.dispose();
  }
});

function compileApertureMaterial(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <project_vertex>',
    fragmentShader: '#include <clipping_planes_fragment>',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

/** The uploaded texture and page uniforms are the shader's actual inputs.
 * Include the region early-out so a raised row alone cannot falsely pass. */
function rayBoxEntry(origin, delta, lower, upper) {
  let near = -Infinity,
    far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(delta[axis]) < 1e-6) {
      if (origin[axis] < lower[axis] || origin[axis] > upper[axis]) return null;
      continue;
    }
    const a = (lower[axis] - origin[axis]) / delta[axis],
      b = (upper[axis] - origin[axis]) / delta[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return far >= Math.max(near, 0) ? [near, far] : null;
}
function shaderDiscards(shader, point, surface = 1) {
  if (surface < 0.5) return false;
  const u = shader.uniforms,
    rows = u.uStationOpeningData.value.image.data,
    count = u.uStationOpeningCount.value,
    view = u.uStationViewCutaway.value,
    camera = u.uStationViewCamera.value,
    cameraPoint = [camera.x, camera.y, camera.z],
    ray = point.map((v, i) => v - cameraPoint[i]),
    projected = camera.w > 0.5 && ray.reduce((n, v) => n + v * v, 0) > 1e-6;
  for (let page = 0; page < u.uStationRegionCount.value; page++) {
    const bounds = u.uStationRegionBounds.value[page],
      range = u.uStationRegionRanges.value[page],
      activePage =
        view.w > 0.5 && range.x >= view.x && range.x < view.x + view.y,
      maxY = activePage && camera.w < 0.5 ? Math.max(range.w, view.z) : range.w;
    const verticalPage =
        Math.abs(point[0] - bounds.x) <= bounds.z &&
        Math.abs(point[2] - bounds.y) <= bounds.w &&
        point[1] >= range.z &&
        point[1] <= maxY,
      pageRay =
        activePage && projected
          ? rayBoxEntry(
              cameraPoint,
              ray,
              [bounds.x - bounds.z, range.z, bounds.y - bounds.w],
              [bounds.x + bounds.z, range.w, bounds.y + bounds.w],
            )
          : null,
      projectedPage = pageRay && pageRay[1] > (surface > 1.5 ? 0 : 1.00001);
    if (!verticalPage && !projectedPage) continue;
    for (let local = 0; local < range.y; local++) {
      const index = range.x + local;
      if (index >= count) break;
      const row = rows.subarray(index * 8, index * 8 + 8),
        dx = point[0] - row[0],
        dz = point[2] - row[1],
        activeRow = view.w > 0.5 && index >= view.x && index < view.x + view.y;
      if (
        Math.abs(dx * row[4] + dz * row[5]) < row[2] &&
        Math.abs(-dx * row[5] + dz * row[4]) < row[3] &&
        point[1] >= row[6] &&
        point[1] <=
          (activeRow && camera.w < 0.5 ? Math.max(row[7], view.z) : row[7])
      )
        return true;
      if (activeRow && projectedPage) {
        const cx = camera.x - row[0],
          cz = camera.z - row[1],
          origin = [
            cx * row[4] + cz * row[5],
            camera.y,
            -cx * row[5] + cz * row[4],
          ],
          fragment = [
            dx * row[4] + dz * row[5],
            point[1],
            -dx * row[5] + dz * row[4],
          ],
          interval = rayBoxEntry(
            origin,
            fragment.map((v, i) => v - origin[i]),
            [-row[2], row[6], -row[3]],
            [row[2], row[7], row[3]],
          );
        if (
          interval &&
          (surface > 1.5 ? interval[0] > 0.00001 : interval[0] > 1.00001)
        )
          return true;
      }
    }
  }
  return false;
}

test('active third-person owner reveals complete bounded rooms through the camera height, without per-frame uploads or first-person changes', () => {
  const waterfront = authoredOwner('waterfront'),
    burrard = authoredOwner('burrard'),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    patch.update([waterfront, burrard]);
    const shader = compileApertureMaterial(material),
      texture = shader.uniforms.uStationOpeningData.value,
      rowsBefore = Array.from(texture.image.data),
      version = texture.version,
      openings = stationCityOpenings(waterfront),
      others = stationCityOpenings(burrard),
      high = Math.max(...openings.concat(others).map((o) => o.maxY)) + 2,
      centreAt = (opening, y) => [
        (opening.polygon[0][0] + opening.polygon[2][0]) / 2,
        y,
        (opening.polygon[0][2] + opening.polygon[2][2]) / 2,
      ],
      room = openings.find(
        (o) =>
          o.id === 'waterfront-howe-middle-junction-authored-room-clearance',
      ),
      roomPoint = centreAt(room, high);
    assert.equal(
      shaderDiscards(shader, roomPoint),
      false,
      'normal city / first-person volumes do not grow to an overhead camera',
    );
    patch.setViewCutaway(waterfront, high + 0.2);
    assert(openings.length > 48, 'Waterfront must exercise more than one page');
    for (const opening of openings)
      assert(
        shaderDiscards(shader, centreAt(opening, high)),
        `${opening.id}: the active owner reveals its real room/bank across every page`,
      );
    for (const opening of others)
      assert.equal(
        shaderDiscards(shader, centreAt(opening, high)),
        false,
        'unoccupied station headspace stays at its original ceiling',
      );
    assert.equal(
      shaderDiscards(shader, [roomPoint[0], high + 0.4, roomPoint[2]]),
      false,
      'the visible cutaway stops above the requested camera',
    );
    assert.equal(
      shaderDiscards(shader, waterfront.toWorld([500, high, 500])),
      false,
      'no outside city footprint is enlarged',
    );
    const flat = waterfront.data.floors.find(
        (f) => f.id === 'waterfront-seabus-heritage-connector-1',
      ),
      start = new THREE.Vector3(...flat.vertices[0])
        .add(new THREE.Vector3(...flat.vertices[3]))
        .multiplyScalar(0.5),
      end = new THREE.Vector3(...flat.vertices[1])
        .add(new THREE.Vector3(...flat.vertices[2]))
        .multiplyScalar(0.5),
      retained = end
        .clone()
        .addScaledVector(end.clone().sub(start).setY(0).normalize(), 0.2);
    retained.y = high;
    assert.equal(
      shaderDiscards(shader, waterfront.toWorld(retained.toArray())),
      false,
      'raising the view ceiling cannot erase the adjacent retained SkyWalk roof footprint',
    );
    const lowest = Math.min(...openings.map((o) => o.minY));
    assert.equal(
      shaderDiscards(shader, centreAt(room, lowest - 0.5)),
      false,
      'render cutaway does not expand floor or underground support',
    );
    for (let frame = 0; frame < 20; frame++)
      patch.setViewCutaway(waterfront, high + 0.2 + frame * 0.01);
    assert.equal(
      texture.version,
      version,
      'camera movement updates one uniform, not the aperture texture',
    );
    assert.deepEqual(
      Array.from(texture.image.data),
      rowsBefore,
      'floor footprints and physical height limits remain immutable',
    );
    patch.setViewCutaway(null);
    assert.equal(
      shaderDiscards(shader, roomPoint),
      false,
      'first-person/city reset restores fixed volumes',
    );
    patch.setViewCutaway(waterfront, NaN);
    assert.equal(
      shaderDiscards(shader, roomPoint),
      false,
      'nonfinite view ceilings cannot remove scenery',
    );
    patch.setViewCutaway(waterfront, high + 0.2);
    patch.update([burrard]);
    assert.equal(
      shader.uniforms.uStationViewCutaway.value.w,
      0,
      'unloading the active owner clears its old texture-row window',
    );
    patch.dispose();
    assert.equal(shader.uniforms.uStationViewCutaway.value.w, 0);
  } finally {
    patch.dispose();
    waterfront.dispose();
    burrard.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('SSAO normals share exact aperture uniforms only for explicitly enrolled city geometry', () => {
  const owner = authoredOwner('waterfront'),
    root = new THREE.Group(),
    geometry = new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2),
    material = new THREE.MeshStandardMaterial(),
    mesh = new THREE.Mesh(geometry, material),
    normal = new THREE.MeshNormalMaterial();
  mesh.userData.walkSurface = true;
  root.add(mesh);
  const travel = new TravelOcclusion([root], [], [root]),
    patch = applySkyTrainWorldOpenings([root]),
    restoreTravel = travel.prepareMaterial(normal, { normalPass: true }),
    travelHook = normal.onBeforeCompile,
    travelKey = normal.customProgramCacheKey,
    restoreGround = patch.prepareGroundMaterial(normal);
  try {
    assert.strictEqual(
      patch.prepareGroundMaterial(normal),
      restoreGround,
      'composer and late station loading may request the same hook twice',
    );
    patch.update([owner]);
    patch.setViewCutaway(owner, 40);
    const compile = (m, library) => {
        const shader = {
          uniforms: {},
          vertexShader: library.vertexShader,
          fragmentShader: library.fragmentShader,
        };
        m.onBeforeCompile(shader, {});
        return shader;
      },
      color = compile(material, THREE.ShaderLib.standard),
      normals = compile(normal, THREE.ShaderLib.normal);
    for (const name of [
      'uStationOpeningData',
      'uStationOpeningCount',
      'uStationRegionCount',
      'uStationRegionBounds',
      'uStationRegionRanges',
      'uStationViewCutaway',
      'uStationViewCamera',
    ])
      assert.strictEqual(normals.uniforms[name], color.uniforms[name], name);
    assert.match(
      normals.fragmentShader,
      /if\(vStationOpeningSurface>0\.5\)/,
      'the override never applies room cutouts to unrelated avatar or station geometry',
    );
    assert.match(
      normals.fragmentShader,
      /vec2 stationDelta=abs\(vTravelCutawayWorld\.xz-stationBounds\.xy\)/,
    );
    assert.match(
      normals.fragmentShader,
      /float stationOpeningMaxY=stationViewRow && uStationViewCamera\.w<0\.5/,
    );
    assert.match(normals.vertexShader, /vTravelTerrainSurface = float/);
    assert.match(
      normals.vertexShader,
      /vStationOpeningSurface = aStationOpeningSurface/,
    );
    assert.deepEqual(normal.defaultAttributeValues.aStationOpeningSurface, [0]);
    assert.equal(geometry.getAttribute('aStationOpeningSurface').getX(0), 1);
    assert.deepEqual(
      normal.defaultAttributeValues.aTravelOccluderMin,
      [0, 0, 0],
    );
    assert.deepEqual(
      normal.defaultAttributeValues.aTravelOccluderMax,
      [0, 0, 0],
    );
    const min = geometry.getAttribute('aTravelOccluderMin'),
      max = geometry.getAttribute('aTravelOccluderMax');
    assert.deepEqual([min.getX(0), min.getY(0), min.getZ(0)], [1, 1, 1]);
    assert.deepEqual([max.getX(0), max.getY(0), max.getZ(0)], [0, 0, 0]);
    for (const opening of stationCityOpenings(owner)) {
      const point = [
        (opening.polygon[0][0] + opening.polygon[2][0]) / 2,
        30,
        (opening.polygon[0][2] + opening.polygon[2][2]) / 2,
      ];
      assert.equal(
        shaderDiscards(normals, point),
        shaderDiscards(color, point),
        'normal/color use the same texture, page culling and raised view ceiling',
      );
    }
    restoreGround();
    assert.strictEqual(normal.onBeforeCompile, travelHook);
    assert.strictEqual(normal.customProgramCacheKey, travelKey);
    restoreGround();
  } finally {
    restoreGround();
    restoreTravel();
    patch.dispose();
    travel.dispose();
    owner.dispose();
    normal.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('ground-normal hooks fail closed without terrain metadata and release on material or system disposal', () => {
  const patch = applySkyTrainWorldOpenings([]),
    normal = new THREE.MeshNormalMaterial(),
    before = normal.onBeforeCompile,
    key = normal.customProgramCacheKey,
    release = patch.prepareGroundMaterial(normal);
  try {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.normal.vertexShader,
      fragmentShader: THREE.ShaderLib.normal.fragmentShader,
    };
    normal.onBeforeCompile(shader, {});
    assert(!shader.uniforms.uStationOpeningData);
    assert(!shader.fragmentShader.includes('stationOpeningMaxY'));
    normal.dispose();
    assert.strictEqual(normal.onBeforeCompile, before);
    assert.strictEqual(normal.customProgramCacheKey, key);
    release();
    const again = patch.prepareGroundMaterial(normal);
    assert.notStrictEqual(normal.onBeforeCompile, before);
    patch.dispose();
    assert.strictEqual(normal.onBeforeCompile, before);
    assert.strictEqual(normal.customProgramCacheKey, key);
    again();
    assert.strictEqual(normal.onBeforeCompile, before);
  } finally {
    release();
    patch.dispose();
    normal.dispose();
  }
});
test('mapped Waterfront pages every real floor and bank without increasing the 336-texel or 48-aperture loop budgets', () => {
  const owners = [
      'waterfront',
      'burrard',
      'granville',
      'stadium-chinatown',
      'main-street-science-world',
      'vancouver-city-centre',
      'yaletown-roundhouse',
    ].map(authoredOwner),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    const openings = owners.map(stationCityOpenings),
      expected = openings.flat();
    assert(
      openings[0].length > 48,
      'real mapped Waterfront must exercise a second page',
    );
    for (let ownerIndex = 0; ownerIndex < owners.length; ownerIndex++)
      if (owners[ownerIndex].data.authoredInterior)
        for (const floor of owners[ownerIndex].data.floors)
          assert(
            openings[ownerIndex].some(
              (opening) => opening.id === `${floor.id}-authored-room-clearance`,
            ),
            `${floor.id}: no authored room may lose its aperture`,
          );
    assert.doesNotThrow(() => patch.update(owners));
    const shader = compileApertureMaterial(material),
      uniforms = shader.uniforms,
      texture = uniforms.uStationOpeningData.value,
      rows = texture.image.data,
      count = uniforms.uStationOpeningCount.value,
      pageCount = uniforms.uStationRegionCount.value,
      bounds = uniforms.uStationRegionBounds.value,
      ranges = uniforms.uStationRegionRanges.value;
    assert.equal(texture.image.width, 2);
    assert.equal(texture.image.height, 336);
    assert.equal(
      count,
      expected.length,
      'all real source apertures are uploaded',
    );
    assert.equal(
      pageCount,
      openings.reduce((sum, list) => sum + Math.ceil(list.length / 48), 0),
    );
    assert.equal(bounds.length, 13);
    assert.equal(ranges.length, 13);
    assert.match(shader.fragmentShader, /stationRegionIndex<13;/);
    assert.match(shader.fragmentShader, /stationLocalIndex<48;/);
    assert.match(material.customProgramCacheKey(), /texture-v8-view-336-13-48/);
    let cursor = 0;
    for (let page = 0; page < pageCount; page++) {
      const range = ranges[page],
        bound = bounds[page];
      assert.equal(range.x, cursor, 'no missing or overlapping aperture rows');
      assert(range.y > 0 && range.y <= 48);
      const pageBox = new THREE.Box3();
      let minY = Infinity,
        maxY = -Infinity;
      for (let index = cursor; index < cursor + range.y; index++) {
        const opening = expected[index],
          [a, b, , d] = opening.polygon,
          center = a.map((v, axis) => (v + opening.polygon[2][axis]) / 2),
          width = Math.hypot(d[0] - a[0], d[2] - a[2]),
          length = Math.hypot(b[0] - a[0], b[2] - a[2]),
          row = rows.subarray(index * 8, index * 8 + 8),
          expectedRow = [
            center[0],
            center[2],
            width / 2,
            length / 2,
            (d[0] - a[0]) / width,
            (d[2] - a[2]) / width,
            opening.minY,
            opening.maxY,
          ];
        for (let axis = 0; axis < 8; axis++)
          assert(
            Math.abs(row[axis] - expectedRow[axis]) < 0.001,
            `${opening.id}: exact shader row ${axis}`,
          );
        for (const point of opening.polygon)
          pageBox.expandByPoint(new THREE.Vector3(...point));
        minY = Math.min(minY, opening.minY);
        maxY = Math.max(maxY, opening.maxY);
      }
      const center = pageBox.getCenter(new THREE.Vector3()),
        size = pageBox.getSize(new THREE.Vector3());
      assert.deepEqual(
        bound.toArray(),
        [center.x, center.z, size.x / 2, size.z / 2],
        'each page owns its actual spatial bounds',
      );
      assert.deepEqual([range.z, range.w], [minY, maxY]);
      cursor += range.y;
    }
    assert.equal(cursor, count);
    let releases = 0;
    texture.addEventListener('dispose', () => releases++);
    patch.dispose();
    patch.dispose();
    assert.equal(releases, 1, 'all pages share one disposable texture');
  } finally {
    patch.dispose();
    owners.forEach((owner) => owner.dispose());
    geometry.dispose();
    material.dispose();
  }
});

test('seven uneven owners fit exactly thirteen pages; excessive owners or apertures leave the last complete upload intact', () => {
  const ownerWith = (id, size) => ({
      data: { id },
      geometryData: {},
      terrainOpenings: () =>
        Array.from({ length: size }, (_, index) => ({
          id: `${id}-${index}`,
          stationId: id,
          polygon: [
            [index * 3, 0, 0],
            [index * 3, 0, 2],
            [index * 3 + 2, 0, 2],
            [index * 3 + 2, 0, 0],
          ],
          minY: -index,
          maxY: 4 - index,
        })),
    }),
    owners = [
      ownerWith('large', 330),
      ...Array.from({ length: 6 }, (_, i) => ownerWith(`small-${i}`, 1)),
    ],
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    patch.update(owners);
    const shader = compileApertureMaterial(material),
      u = shader.uniforms,
      texture = u.uStationOpeningData.value,
      rows = [...texture.image.data],
      bounds = u.uStationRegionBounds.value.map((v) => v.toArray()),
      ranges = u.uStationRegionRanges.value.map((v) => v.toArray()),
      version = texture.version;
    assert.equal(u.uStationOpeningCount.value, 336);
    assert.equal(u.uStationRegionCount.value, 13);
    assert.throws(
      () => patch.update([...owners, ownerWith('eighth', 0)]),
      /station owner capacity exceeded/,
    );
    assert.throws(
      () => patch.update([ownerWith('overflow', 337)]),
      /entrance aperture capacity exceeded/,
    );
    assert.equal(u.uStationOpeningCount.value, 336);
    assert.equal(u.uStationRegionCount.value, 13);
    assert.deepEqual([...texture.image.data], rows);
    assert.deepEqual(
      u.uStationRegionBounds.value.map((v) => v.toArray()),
      bounds,
    );
    assert.deepEqual(
      u.uStationRegionRanges.value.map((v) => v.toArray()),
      ranges,
    );
    assert.equal(
      texture.version,
      version,
      'rejected input cannot upload a partial aperture table',
    );
  } finally {
    patch.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('real unenclosed flights have full tread-width apertures while existing aggregate banks remain deduplicated', () => {
  const owner = authoredOwner('yaletown-roundhouse'),
    bankOwner = authoredOwner('burrard');
  try {
    const openings = stationCityOpenings(owner),
      flights = openings.filter((o) =>
        o.id.endsWith('-authored-flight-clearance'),
      ),
      previous = openings.filter((o) => !flights.includes(o));
    assert(flights.length > 0, 'exercise real unsupported-flight headspace');
    let previouslyMissing = 0;
    for (const connection of owner.geometryData.connections)
      for (const tread of connection.treads) {
        const vertices = tread.vertices.map((p) => new THREE.Vector3(...p)),
          centre = vertices
            .reduce((v, p) => v.add(p), new THREE.Vector3())
            .multiplyScalar(1 / vertices.length),
          across = vertices[3].clone().sub(vertices[0]);
        for (const side of [-0.49, 0, 0.49])
          for (const height of [0.2, 1.65, 3.5]) {
            const point = centre.clone().addScaledVector(across, side);
            point.y += height;
            const world = owner.toWorld(point.toArray());
            assert(
              openings.some((o) => contains(o, world)),
              `${tread.id}: full real flight footprint`,
            );
            if (!previous.some((o) => contains(o, world))) previouslyMissing++;
          }
      }
    assert(
      previouslyMissing > 20,
      'the former small sight cone left a real flight gap',
    );
    const connection = owner.geometryData.connections.find(
        (c) => c.id === 'yaletown-upper-entry-stair',
      ),
      floor = connection.treads[Math.floor(connection.treads.length / 2)],
      a = new THREE.Vector3(...floor.vertices[0]),
      b = new THREE.Vector3(...floor.vertices[3]),
      outside = a.clone().addScaledVector(b.clone().sub(a).normalize(), -0.3);
    outside.y += 1.65;
    assert(
      !flights.some((o) => contains(o, owner.toWorld(outside.toArray()))),
      'a flight aperture cannot invent a wider room',
    );
    const bankOpenings = stationCityOpenings(bankOwner);
    for (const id of [
      'burrard-main-escalator-bank-1',
      'burrard-main-escalator-bank-2',
      'burrard-main-escalator-bank-3',
    ])
      assert(
        !bankOpenings.some((o) => o.id === `${id}-authored-flight-clearance`),
        'one actual aggregate bank already covers all three lanes',
      );
  } finally {
    owner.dispose();
    bankOwner.dispose();
  }
});

test('late streamed city materials enroll on attachment, retain existing shader hooks and stop watching after disposal', () => {
  const root = new THREE.Group(),
    owner = authoredOwner('stadium-chinatown'),
    patch = applySkyTrainWorldOpenings([root]),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry(),
    unregistered = new THREE.BoxGeometry();
  let originalCalls = 0;
  material.onBeforeCompile = (shader) => {
    originalCalls++;
    shader.uniforms.originalFacade = { value: 7 };
  };
  const before = material.onBeforeCompile;
  try {
    patch.update([owner]);
    const nested = new THREE.Group(),
      mesh = new THREE.InstancedMesh(geometry, material, 1);
    root.add(nested);
    nested.add(mesh);
    assert.notStrictEqual(
      material.onBeforeCompile,
      before,
      'late architecture needs no manual scene traversal',
    );
    const shader = compileApertureMaterial(material);
    assert.equal(originalCalls, 1);
    assert.equal(shader.uniforms.originalFacade.value, 7);
    assert(shader.uniforms.uStationOpeningData);
    assert.match(material.customProgramCacheKey(), /texture-v8-view/);
    assert.equal(geometry.getAttribute('aStationOpeningSurface').getX(0), 1);
    assert(
      !unregistered.hasAttribute('aStationOpeningSurface'),
      'authored station and avatar geometry are never enrolled by proximity',
    );
    const texture = shader.uniforms.uStationOpeningData.value,
      version = texture.version;
    nested.removeFromParent();
    root.add(nested);
    assert.equal(
      texture.version,
      version,
      'streaming does not rebuild floor apertures',
    );
    patch.dispose();
    assert.strictEqual(material.onBeforeCompile, before);
    assert(!geometry.hasAttribute('aStationOpeningSurface'));
    const laterMaterial = new THREE.MeshStandardMaterial(),
      laterHook = laterMaterial.onBeforeCompile,
      laterGeometry = new THREE.BoxGeometry();
    nested.add(new THREE.Mesh(laterGeometry, laterMaterial));
    assert.strictEqual(
      laterMaterial.onBeforeCompile,
      laterHook,
      'detached lifecycle listeners cannot patch after system disposal',
    );
    assert(!laterGeometry.hasAttribute('aStationOpeningSurface'));
    laterGeometry.dispose();
    laterMaterial.dispose();
  } finally {
    patch.dispose();
    owner.dispose();
    geometry.dispose();
    unregistered.dispose();
    material.dispose();
  }
});

test('building roofs and wave water share bounded color/normal cutouts without enrolling source or avatar geometry', () => {
  const owner = authoredOwner('yaletown-roundhouse'),
    root = new THREE.Group(),
    roofGeometry = new THREE.BoxGeometry(),
    roofMaterial = new THREE.MeshStandardMaterial(),
    roof = new THREE.Mesh(roofGeometry, roofMaterial),
    waterGeometry = new THREE.PlaneGeometry(80000, 80000),
    waterMaterial = new THREE.MeshStandardMaterial(),
    water = new THREE.Mesh(waterGeometry, waterMaterial),
    avatar = new THREE.BoxGeometry(),
    normal = new THREE.MeshNormalMaterial();
  let waveCalls = 0;
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.1;
  waterMaterial.onBeforeCompile = (shader) => {
    waveCalls++;
    shader.uniforms.waveTime = { value: 3 };
  };
  root.add(roof);
  const travel = new TravelOcclusion([root]),
    patch = applySkyTrainWorldOpenings([root], [water]),
    restoreTravel = travel.prepareMaterial(normal, { normalPass: true }),
    restoreOpening = patch.prepareGroundMaterial(normal);
  try {
    patch.update([owner]);
    patch.setViewCutaway(owner, 20);
    const color = compileApertureMaterial(roofMaterial),
      waves = compileApertureMaterial(waterMaterial),
      normals = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.normal.vertexShader,
        fragmentShader: THREE.ShaderLib.normal.fragmentShader,
      };
    normal.onBeforeCompile(normals, {});
    assert.equal(waveCalls, 1);
    assert.equal(waves.uniforms.waveTime.value, 3);
    for (const shader of [waves, normals])
      assert.strictEqual(
        shader.uniforms.uStationOpeningData,
        color.uniforms.uStationOpeningData,
      );
    assert.equal(
      roofGeometry.getAttribute('aStationOpeningSurface').getX(0),
      1,
    );
    assert.equal(
      waterGeometry.getAttribute('aStationOpeningSurface').getX(0),
      2,
    );
    assert(!avatar.hasAttribute('aStationOpeningSurface'));
    assert.deepEqual(normal.defaultAttributeValues.aStationOpeningSurface, [0]);
    assert.match(normals.fragmentShader, /if\(vStationOpeningSurface>0\.5\)/);
    const floor = owner.data.floors.find((f) => f.id === 'yaletown-canada'),
      centre = new THREE.Box3()
        .setFromPoints(floor.vertices.map((p) => new THREE.Vector3(...p)))
        .getCenter(new THREE.Vector3()),
      waterPoint = owner.toWorld([centre.x, centre.y + 1, centre.z]);
    for (const shader of [color, waves, normals]) {
      assert(shaderDiscards(shader, waterPoint));
      assert(
        !shaderDiscards(shader, owner.toWorld([500, 0.1, 500])),
        'water and city remain intact outside real station footprints',
      );
    }
    // Travel's disposal listener runs before the opening listener on the same
    // material. Both hooks/default maps must unwind without a stale city flag.
    normal.dispose();
    assert.equal(
      normal.defaultAttributeValues?.aStationOpeningSurface,
      undefined,
    );
  } finally {
    restoreOpening();
    restoreTravel();
    patch.dispose();
    travel.dispose();
    owner.dispose();
    roofGeometry.dispose();
    waterGeometry.dispose();
    avatar.dispose();
    roofMaterial.dispose();
    waterMaterial.dispose();
    normal.dispose();
  }
});

test('city enrollment attributes share ownership and restore pre-existing geometry metadata exactly', () => {
  const root = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial(),
    previous = new THREE.Float32BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count).fill(0.25),
      1,
    );
  geometry.setAttribute('aStationOpeningSurface', previous);
  root.add(new THREE.Mesh(geometry, material));
  const first = applySkyTrainWorldOpenings([root]),
    second = applySkyTrainWorldOpenings([root]);
  try {
    const shared = geometry.getAttribute('aStationOpeningSurface');
    assert.notStrictEqual(shared, previous);
    first.dispose();
    assert.strictEqual(geometry.getAttribute('aStationOpeningSurface'), shared);
    second.dispose();
    assert.strictEqual(
      geometry.getAttribute('aStationOpeningSurface'),
      previous,
    );
    const third = applySkyTrainWorldOpenings([root]);
    geometry.dispose();
    assert.strictEqual(
      geometry.getAttribute('aStationOpeningSurface'),
      previous,
    );
    third.dispose();
  } finally {
    first.dispose();
    second.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('streamed material disposal releases its hook immediately and unsupported shader geometry stays unregistered', () => {
  const root = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial(),
    shaderGeometry = new THREE.BoxGeometry(),
    shaderMaterial = new THREE.ShaderMaterial(),
    before = material.onBeforeCompile,
    mesh = new THREE.Mesh(geometry, material),
    patch = applySkyTrainWorldOpenings([root]);
  try {
    root.add(mesh, new THREE.Mesh(shaderGeometry, shaderMaterial));
    assert.notStrictEqual(material.onBeforeCompile, before);
    assert(
      !shaderGeometry.hasAttribute('aStationOpeningSurface'),
      'a normal override cannot mask an unpatched custom color shader',
    );
    material.dispose();
    assert.strictEqual(material.onBeforeCompile, before);
    mesh.removeFromParent();
    root.add(mesh);
    assert.notStrictEqual(
      material.onBeforeCompile,
      before,
      'an explicitly reattached reused material can enroll again',
    );
    patch.dispose();
    assert.strictEqual(material.onBeforeCompile, before);
  } finally {
    patch.dispose();
    geometry.dispose();
    shaderGeometry.dispose();
    material.dispose();
    shaderMaterial.dispose();
  }
});

test('projected cutaway removes measured Yaletown foreground ground and overview water through original source volumes', () => {
  const owner = new SkyTrainStationOwner(
      adaptSkyTrainStationFrame(
        packet('yaletown-roundhouse'),
        JSON.parse(readFileSync('public/models/skytrain-routes.json')),
      ),
      cityElevation,
      'balanced',
      true,
    ),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry(),
    normal = new THREE.MeshNormalMaterial();
  root.add(new THREE.Mesh(geometry, material));
  const travel = new TravelOcclusion([root], [], [root]),
    patch = applySkyTrainWorldOpenings([root]),
    releaseTravel = travel.prepareMaterial(normal, { normalPass: true }),
    releaseNormal = patch.prepareGroundMaterial(normal);
  try {
    patch.update([owner]);
    const compile = (m, library) => {
        const shader = {
          uniforms: {},
          vertexShader: library.vertexShader,
          fragmentShader: library.fragmentShader,
        };
        m.onBeforeCompile(shader, {});
        return shader;
      },
      color = compile(material, THREE.ShaderLib.standard),
      normals = compile(normal, THREE.ShaderLib.normal),
      texture = color.uniforms.uStationOpeningData.value,
      before = Array.from(texture.image.data),
      version = texture.version,
      samples = [
        {
          label: 'switchback-720,200',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.21307767591577, 8.326794430136154, 1264.4404760780976],
        },
        {
          label: 'switchback-300,500',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.81209049736214, 8.034731193883689, 1264.6315101050948],
        },
        {
          label: 'switchback-450,500',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.67123143278013, 8.03872753417087, 1264.4865833522754],
        },
        {
          label: 'switchback-1000,500',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.16590321730877, 8.053064300581582, 1263.9666624114834],
        },
        {
          label: 'switchback-1200,500',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [449.9863736682265, 8.05815776880721, 1263.781948458846],
        },
        {
          label: 'switchback-720,800',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.7330156234662, 8.051538362105829, 1263.911963067927],
        },
        {
          label: 'switchback-720,400',
          camera: [451.08679867252005, 8.883563482721442, 1263.5523452614477],
          point: [450.2596794734528, 8.042873960392061, 1264.3931057016682],
        },
        {
          label: 'overview-water',
          camera: [483.7154283808745, 83.37205797257313, 1346.8723128826844],
          point: [429.8335085162681, 0.1, 1283.1936803154217],
        },
      ];
    assert.strictEqual(
      color.uniforms.uStationViewCamera,
      normals.uniforms.uStationViewCamera,
    );
    assert.match(color.fragmentShader, /stationRowEntry>1\.00001/);
    assert.match(normals.fragmentShader, /stationRowEntry>1\.00001/);
    assert.match(
      color.fragmentShader,
      /vec3\(-r\.z,p\.z,-r\.w\),vec3\(r\.z,p\.w,r\.w\)/,
      'ordinary city projected rows use original source heights, never the raised chase ceiling',
    );
    let formerlyOpaque = 0;
    for (const sample of samples) {
      patch.setViewCutaway(owner, sample.camera[1] + 0.2);
      if (!shaderDiscards(color, sample.point)) formerlyOpaque++;
      patch.setViewCutaway(
        owner,
        sample.camera[1] + 0.2,
        new THREE.Vector3(...sample.camera),
      );
      assert(shaderDiscards(color, sample.point), sample.label);
      assert(
        shaderDiscards(normals, sample.point),
        sample.label + ' normal parity',
      );
      patch.setViewCutaway(null);
      assert.equal(color.uniforms.uStationViewCamera.value.w, 0);
    }
    assert(
      formerlyOpaque >= 7,
      'actual outside-footprint gray pixels must fail the previous vertical-only mask',
    );
    assert.equal(texture.version, version);
    assert.deepEqual(Array.from(texture.image.data), before);
    assert.match(material.customProgramCacheKey(), /texture-v8-view-336-13-48/);
    assert.match(normal.customProgramCacheKey(), /portals-normal-v5-336-13-48/);
  } finally {
    releaseNormal();
    releaseTravel();
    patch.dispose();
    travel.dispose();
    owner.dispose();
    geometry.dispose();
    material.dispose();
    normal.dispose();
  }
});

test('projected source silhouette preserves off-ray, behind-room, inside-camera and first-person scenery', () => {
  const volume = (id, x) => ({
      data: { id, floors: [] },
      geometryData: { authoredInterior: {}, parts: [], connections: [] },
      terrainOpenings: () => [
        {
          id: id + '-room',
          stationId: id,
          polygon: [
            [x - 2, 0, 10],
            [x - 2, 0, 14],
            [x + 2, 0, 14],
            [x + 2, 0, 10],
          ],
          minY: 0,
          maxY: 4,
        },
      ],
    }),
    owner = volume('active', 0),
    other = volume('other', 30),
    root = new THREE.Group(),
    material = new THREE.MeshStandardMaterial(),
    geometry = new THREE.BoxGeometry();
  root.add(new THREE.Mesh(geometry, material));
  const patch = applySkyTrainWorldOpenings([root]);
  try {
    patch.update([owner, other]);
    const shader = compileApertureMaterial(material),
      camera = new THREE.Vector3(0, 2, 0),
      foreground = [0, 2, 3];
    patch.setViewCutaway(owner, 20, camera);
    assert(shaderDiscards(shader, foreground));
    assert(
      !shaderDiscards(shader, [0, 2, 16]),
      'city beyond the room remains visible',
    );
    assert(
      !shaderDiscards(shader, [3, 2, 3]),
      'off-ray foreground is retained',
    );
    assert(
      !shaderDiscards(shader, [0, 2, -3]),
      'a room behind the camera cannot remove scenery',
    );
    assert(
      !shaderDiscards(shader, [9, 2, 3]),
      'inactive owner along the same extended ray stays fixed',
    );
    patch.setViewCutaway(owner, 20, new THREE.Vector3(2, 2, 0));
    assert(
      shaderDiscards(shader, [2, 2, 3]),
      'exact source edge handles a parallel ray',
    );
    patch.setViewCutaway(owner, 20, new THREE.Vector3(2.001, 2, 0));
    assert(
      !shaderDiscards(shader, [2.001, 2, 3]),
      'a parallel ray outside the edge cannot erase it',
    );
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 10, 0));
    assert(
      !shaderDiscards(shader, [0, 10, 3]),
      'raised chase ceiling is not a projected physical volume',
    );
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 2, 12));
    assert(
      !shaderDiscards(shader, [0, 2, 15]),
      'camera already inside does not project a new aperture beyond the source',
    );
    patch.setViewCutaway(owner, 20, camera);
    assert(!shaderDiscards(shader, camera.toArray()), 'zero ray fails closed');
    camera.x = 1e7;
    assert.deepEqual(
      shader.uniforms.uStationViewCamera.value.toArray(),
      [0, 2, 0, 1],
      'uniform owns a snapshot of camera pose',
    );
    for (const invalid of [
      new THREE.Vector3(NaN, 2, 0),
      new THREE.Vector3(Infinity, 2, 0),
      camera,
    ]) {
      patch.setViewCutaway(owner, 20, invalid);
      assert.equal(shader.uniforms.uStationViewCamera.value.w, 0);
      assert(!shaderDiscards(shader, foreground));
    }
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 2, 0));
    patch.setViewCutaway(null);
    assert(
      !shaderDiscards(shader, foreground),
      'first-person/city resets projection',
    );
    patch.setViewCutaway(owner, NaN, new THREE.Vector3(0, 2, 0));
    assert(!shaderDiscards(shader, foreground));
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 2, 0));
    patch.update([other]);
    assert.equal(
      shader.uniforms.uStationViewCamera.value.w,
      0,
      'unloading cannot retain old camera/row ownership',
    );
    patch.dispose();
    assert.equal(shader.uniforms.uStationViewCamera.value.w, 0);
  } finally {
    patch.dispose();
    geometry.dispose();
    material.dispose();
  }
});

test('water-only geometry markers fail closed when shared with ordinary objects and restore exact metadata after either owner disposes', () => {
  const waterRoot = new THREE.Group(),
    cityRoot = new THREE.Group(),
    geometry = new THREE.PlaneGeometry(),
    material = new THREE.MeshStandardMaterial(),
    cityMaterial = new THREE.MeshStandardMaterial(),
    original = new THREE.Float32BufferAttribute(
      new Float32Array(geometry.getAttribute('position').count).fill(0.25),
      1,
    );
  geometry.setAttribute('aStationOpeningSurface', original);
  waterRoot.add(new THREE.Mesh(geometry, material));
  cityRoot.add(new THREE.Mesh(geometry, cityMaterial));
  const waterPatch = applySkyTrainWorldOpenings([], [waterRoot]),
    marker = geometry.getAttribute('aStationOpeningSurface');
  assert.equal(marker.getX(0), 2);
  const cityPatch = applySkyTrainWorldOpenings([cityRoot]);
  try {
    assert.strictEqual(geometry.getAttribute('aStationOpeningSurface'), marker);
    assert.equal(
      marker.getX(0),
      1,
      'shared geometry cannot grant ordinary city a water excavation',
    );
    cityPatch.dispose();
    assert.equal(
      marker.getX(0),
      2,
      'remaining explicit water owner regains only its original privilege',
    );
    waterPatch.dispose();
    assert.strictEqual(
      geometry.getAttribute('aStationOpeningSurface'),
      original,
    );
    const waterSecond = applySkyTrainWorldOpenings([], [waterRoot]),
      citySecond = applySkyTrainWorldOpenings([cityRoot]);
    waterSecond.dispose();
    assert.equal(
      geometry.getAttribute('aStationOpeningSurface').getX(0),
      1,
      'disposing explicit water first leaves remaining ordinary geometry unprivileged',
    );
    citySecond.dispose();
    assert.strictEqual(
      geometry.getAttribute('aStationOpeningSurface'),
      original,
    );
    const mixed = applySkyTrainWorldOpenings([cityRoot], [waterRoot]);
    assert.equal(
      geometry.getAttribute('aStationOpeningSurface').getX(0),
      1,
      'mixed geometry within one system also fails closed',
    );
    mixed.dispose();
    assert.strictEqual(
      geometry.getAttribute('aStationOpeningSurface'),
      original,
    );
  } finally {
    cityPatch.dispose();
    waterPatch.dispose();
    geometry.dispose();
    material.dispose();
    cityMaterial.dispose();
  }
});

test('explicit sea water behind the measured Yaletown overview rooms yields only to their original projected source silhouette in color and normals', () => {
  const owner = new SkyTrainStationOwner(
      adaptSkyTrainStationFrame(
        packet('yaletown-roundhouse'),
        JSON.parse(readFileSync('public/models/skytrain-routes.json')),
      ),
      cityElevation,
      'balanced',
      true,
    ),
    cityRoot = new THREE.Group(),
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(80000, 80000),
      new THREE.MeshStandardMaterial(),
    ),
    city = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial(),
    ),
    normal = new THREE.MeshNormalMaterial();
  cityRoot.add(city);
  const travel = new TravelOcclusion([cityRoot]),
    patch = applySkyTrainWorldOpenings([cityRoot], [water]),
    releaseTravel = travel.prepareMaterial(normal, { normalPass: true }),
    releaseNormal = patch.prepareGroundMaterial(normal);
  try {
    patch.update([owner]);
    const waves = compileApertureMaterial(water.material),
      color = compileApertureMaterial(city.material),
      normals = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.normal.vertexShader,
        fragmentShader: THREE.ShaderLib.normal.fragmentShader,
      };
    normal.onBeforeCompile(normals, {});
    const camera = new THREE.Vector3(
        509.28072342297605,
        76.57205797257313,
        1368.7964021319622,
      ),
      samples = [
        {
          pixel: [750, 210],
          point: [428.303164457126, 0.1, 1267.0571717804055],
        },
        { pixel: [800, 220], point: [434.75588422, 0.1, 1264.81043338] },
      ],
      texture = waves.uniforms.uStationOpeningData.value,
      before = Array.from(texture.image.data),
      version = texture.version;
    const outsideRoad = [430.7524706, 8.9121599, 1283.1569248];
    patch.setViewCutaway(owner, camera.y + 0.2);
    assert(
      shaderDiscards(color, outsideRoad, 1),
      'negative fixture exercises the old raised column which exposed off-silhouette ocean',
    );
    patch.setViewCutaway(owner, camera.y + 0.2, camera);
    assert(
      !shaderDiscards(color, outsideRoad, 1),
      'actual camera preserves the original road outside the true projected source silhouette',
    );
    assert.equal(
      water.geometry.getAttribute('aStationOpeningSurface').getX(0),
      2,
    );
    assert.equal(
      city.geometry.getAttribute('aStationOpeningSurface').getX(0),
      1,
    );
    for (const shader of [waves, color, normals]) {
      assert(
        !shader.uniforms.uStationViewWaterMinY,
        'no excavation or source-volume height extension is introduced',
      );
      for (const sample of samples) {
        assert(
          !shaderDiscards(shader, sample.point, 1),
          `${sample.pixel.join(',')}: ordinary city behind the original volume remains intact`,
        );
        assert(
          shaderDiscards(shader, sample.point, 2),
          `${sample.pixel.join(',')}: actual global sea sheet cannot fill the exposed source silhouette`,
        );
        assert(
          !shaderDiscards(shader, sample.point, 0),
          `${sample.pixel.join(',')}: avatar and source materials are never enrolled`,
        );
      }
      assert(
        !shaderDiscards(shader, owner.toWorld([500, 0.1, 500]), 2),
        'sea outside the projected actual station remains rendered',
      );
      assert(
        !shaderDiscards(
          shader,
          [420.52479446453407, 0.1, 1272.003068639279],
          2,
        ),
        'measured pixel680,205 is outside this owner original source silhouette and cannot motivate enlarged volumes',
      );
    }
    assert.strictEqual(
      waves.uniforms.uStationViewCamera,
      normals.uniforms.uStationViewCamera,
    );
    assert.match(
      waves.fragmentShader,
      /stationWaterSurface \? stationRowEntry>0\.00001 : stationRowEntry>1\.00001/,
    );
    assert.match(
      normals.fragmentShader,
      /stationWaterSurface \? stationRowEntry>0\.00001 : stationRowEntry>1\.00001/,
    );
    patch.setViewCutaway(null);
    for (const sample of samples)
      assert(
        !shaderDiscards(waves, sample.point, 2),
        'first person/city restores the original sea',
      );
    patch.setViewCutaway(owner, camera.y + 0.2, camera);
    patch.update([]);
    for (const sample of samples)
      assert(
        !shaderDiscards(waves, sample.point, 2),
        'unloading removes the old active projected silhouette',
      );
    patch.update([owner]);
    assert.deepEqual(
      Array.from(texture.image.data),
      before,
      'all original source XZ/Y rows remain byte-identical',
    );
    assert(
      texture.version > version,
      'only explicit owner changes upload any texture',
    );
    assert.equal(
      city.material.defaultAttributeValues.aStationOpeningSurface[0],
      0,
    );
  } finally {
    releaseNormal();
    releaseTravel();
    patch.dispose();
    travel.dispose();
    owner.dispose();
    water.geometry.dispose();
    water.material.dispose();
    city.geometry.dispose();
    city.material.dispose();
    normal.dispose();
  }
});

test('water projection remains restricted to the active actual source volume, including behind-room, off-ray and camera-inside cases', () => {
  const volume = (id, x) => ({
      data: { id, floors: [] },
      geometryData: { authoredInterior: {}, parts: [], connections: [] },
      terrainOpenings: () => [
        {
          id: id + '-room',
          stationId: id,
          polygon: [
            [x - 2, 2, 10],
            [x - 2, 2, 14],
            [x + 2, 2, 14],
            [x + 2, 2, 10],
          ],
          minY: 2,
          maxY: 6,
        },
      ],
    }),
    owner = volume('active', 0),
    other = volume('inactive', 30),
    water = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshStandardMaterial(),
    ),
    patch = applySkyTrainWorldOpenings([], [water]);
  try {
    patch.update([owner, other]);
    const shader = compileApertureMaterial(water.material),
      camera = new THREE.Vector3(0, 6, 0),
      behind = [0, 0.1, 16];
    patch.setViewCutaway(owner, 20, camera);
    assert(
      shaderDiscards(shader, behind, 2),
      'global water behind a crossed real room is absent',
    );
    assert(
      !shaderDiscards(shader, behind, 1),
      'the same behind-room ordinary city fragment stays visible',
    );
    assert(
      !shaderDiscards(shader, [10, 0.1, 16], 2),
      'off-ray sea stays visible',
    );
    assert(
      !shaderDiscards(shader, [0, 0.1, -16], 2),
      'rooms behind the lens do not erase water',
    );
    assert(
      !shaderDiscards(shader, [48, 0.1, 16], 2),
      'a crossed but inactive owner cannot remove sea',
    );
    assert(
      !shaderDiscards(shader, [0, 0.1, 16], 0),
      'source/avatar default attribute is zero',
    );
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 4, 12));
    assert(
      !shaderDiscards(shader, [0, 0.1, 16], 2),
      'a camera inside a room cannot remove all off-footprint sea in every direction',
    );
    assert(!shaderDiscards(shader, [0, 0.1, 16], 1));
    patch.setViewCutaway(owner, 20, new THREE.Vector3(0, 10, 0));
    assert(
      !shaderDiscards(shader, [0, 10, 16], 2),
      'raised camera ceiling never becomes a fake projected source volume',
    );
    patch.setViewCutaway(null);
    assert(!shaderDiscards(shader, behind, 2));
    patch.dispose();
    assert(!water.geometry.hasAttribute('aStationOpeningSurface'));
  } finally {
    patch.dispose();
    water.geometry.dispose();
    water.material.dispose();
  }
});

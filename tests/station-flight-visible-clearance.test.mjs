import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const targets = [
  'waterfront',
  'burrard',
  'granville',
  'stadium-chinatown',
  'yaletown-roundhouse',
];
const packet = (id) =>
  JSON.parse(readFileSync(`public/models/skytrain-stations/${id}.json`));
const up = new THREE.Vector3(0, 1, 0);

function ownerWithSigns(data) {
  const previous = globalThis.document;
  globalThis.document = Object.fromEntries([
    [
      'createElement',
      () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }),
    ],
  ]);
  try {
    return new SkyTrainStationOwner(data, () => 0);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

// This deliberately measures emitted triangles rather than the collider OBBs.
// A missing or misplaced collider must not make visible structure safe to cross.
function renderedStructure(owner) {
  owner.group.updateMatrixWorld(true);
  const source = new Map(owner.geometryData.parts.map((p) => [p.id, p])),
    parts = new Map(),
    inverse = owner.group.matrixWorld.clone().invert(),
    instance = new THREE.Matrix4();
  function add(mesh, matrix, id, start = 0, end) {
    const part = source.get(id),
      isSign = mesh.name.startsWith('station-sign-');
    if (
      (!part && !isSign) ||
      // Tread/floor contact and the following riser's low ankle intersection
      // are intentional during a native step. Visible support is tested
      // separately against the exact foot plane at a strict1cm tolerance.
      (part &&
        (part.role === 'floor' ||
          part.role.endsWith('tread') ||
          part.role === 'stair-support' ||
          /-nosing-/.test(id)))
    )
      return;
    id ??= mesh.name;
    const position = mesh.geometry.getAttribute('position'),
      index = mesh.geometry.index;
    end ??= index?.count ?? position.count;
    const solid = parts.get(id) ?? {
      id,
      bounds: new THREE.Box3(),
      triangles: [],
    };
    parts.set(id, solid);
    for (let offset = start; offset < end; offset += 3) {
      const vertices = [0, 1, 2].map((i) =>
        new THREE.Vector3()
          .fromBufferAttribute(
            position,
            index ? index.getX(offset + i) : offset + i,
          )
          .applyMatrix4(matrix),
      );
      for (const vertex of vertices) solid.bounds.expandByPoint(vertex);
      solid.triangles.push(new THREE.Triangle(...vertices));
    }
  }
  owner.group.traverse((mesh) => {
    if (!(mesh instanceof THREE.Mesh)) return;
    const relative = inverse.clone().multiply(mesh.matrixWorld);
    if (mesh instanceof THREE.InstancedMesh) {
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, instance);
        add(
          mesh,
          relative.clone().multiply(instance),
          mesh.userData.stationPartIds?.[i],
        );
      }
    } else if (mesh.name.startsWith('station-sign-'))
      add(mesh, relative, mesh.name);
    else
      for (const range of mesh.userData.stationPartRanges ?? [])
        add(
          mesh,
          relative,
          range.id,
          range.vertexStart,
          range.vertexStart + range.vertexCount,
        );
  });
  return [...parts.values()];
}

const ray = new THREE.Ray(),
  onTriangle = new THREE.Vector3(),
  onRay = new THREE.Vector3(),
  onEdge = new THREE.Vector3();
function segmentTriangleDistanceSq(a, b, triangle) {
  const length = a.distanceTo(b);
  ray.set(a, b.clone().sub(a).normalize());
  let distance = Math.min(
    triangle.closestPointToPoint(a, onTriangle).distanceToSquared(a),
    triangle.closestPointToPoint(b, onTriangle).distanceToSquared(b),
  );
  if (
    ray.intersectTriangle(
      triangle.a,
      triangle.b,
      triangle.c,
      false,
      onTriangle,
    ) &&
    onTriangle.distanceTo(a) <= length
  )
    return 0;
  for (const [p, q] of [
    [triangle.a, triangle.b],
    [triangle.b, triangle.c],
    [triangle.c, triangle.a],
  ]) {
    const edgeDistance = ray.distanceSqToSegment(p, q, onRay, onEdge);
    if (onRay.distanceTo(a) <= length + 1e-9)
      distance = Math.min(distance, edgeDistance);
  }
  return distance;
}

function intersections(parts, point, allowThinFinishes = false) {
  const bottom = point.clone().addScaledVector(up, 0.24),
    // Rounded capsule stays inside the production 1.7m-high body OBB.
    top = point.clone().addScaledVector(up, 1.46),
    eye = point.clone().addScaledVector(up, 1.65),
    bounds = new THREE.Box3().setFromPoints([bottom, top]).expandByScalar(0.24),
    hits = [];
  for (const part of parts) {
    if (!part.bounds.intersectsBox(bounds)) continue;
    if (
      allowThinFinishes &&
      part.bounds.min.y >= point.y - 0.01 &&
      part.bounds.max.y <= point.y + 0.03
    )
      continue;
    let bodyDistance = Infinity,
      eyeDistance = Infinity;
    for (const triangle of part.triangles) {
      bodyDistance = Math.min(
        bodyDistance,
        segmentTriangleDistanceSq(bottom, top, triangle),
      );
      eyeDistance = Math.min(
        eyeDistance,
        triangle.closestPointToPoint(eye, onTriangle).distanceToSquared(eye),
      );
    }
    if (bodyDistance < 0.238 ** 2 || eyeDistance < 0.059 ** 2)
      hits.push(part.id);
  }
  return hits;
}

function treadProfile(tread) {
  const vertices = tread.vertices.map((p) => new THREE.Vector3(...p));
  return {
    centre: vertices
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length),
    across: vertices[3].clone().sub(vertices[0]),
  };
}

for (const id of targets)
  test(`${id}: every accepted tread body and eye clears the actual emitted non-walking structure and signs`, () => {
    const owner = ownerWithSigns(packet(id)),
      parts = renderedStructure(owner);
    let checked = 0,
      quarters = 0;
    try {
      assert(
        parts.length > 0,
        'inspect actual station structure draw geometry',
      );
      for (const connection of owner.geometryData.connections)
        for (const [index, tread] of connection.treads.entries()) {
          const { centre, across } = treadProfile(tread);
          let clearPaths = 0;
          for (const offset of [-0.25, 0, 0.25]) {
            const point = centre.clone().addScaledVector(across, offset),
              foot = owner.floorAt(
                point.toArray(),
                `${connection.id}:step:${index}`,
              );
            assert(foot, `${tread.id}: the original tread is retained`);
            // Narrow escalators limit the safe side width; a wide staircase
            // can have a real centre handrail separating two safe lanes.
            if (!owner.isClearFoot(foot)) continue;
            clearPaths++;
            checked++;
            if (offset !== 0) quarters++;
            assert.deepEqual(
              intersections(parts, point),
              [],
              `${tread.id}/${offset}: accepted capsule intersects emitted structure at ${point.toArray()}`,
            );
          }
          assert(clearPaths > 0, `${tread.id}: retain a clear supported lane`);
        }
      assert(
        checked > 100 && quarters > 100,
        'cover full flights and safe widths',
      );
    } finally {
      owner.dispose();
    }
  });

for (const id of targets)
  test(`${id}: every capsule-clear authored floor body and eye clears actual non-walking structure and signs`, () => {
    const owner = ownerWithSigns(packet(id)),
      parts = renderedStructure(owner);
    let checked = 0;
    try {
      for (const floor of owner.geometryData.floors)
        for (let offset = 0; offset < floor.indices.length; offset += 3) {
          const [a, b, c] = floor.indices
            .slice(offset, offset + 3)
            .map((i) => new THREE.Vector3(...floor.vertices[i]));
          for (let i = 0; i < 8; i++)
            for (let j = 0; j < 8 - i; j++) {
              const u = (i + 0.22) / 8,
                v = (j + 0.22) / 8;
              if (u + v >= 1) continue;
              const point = a
                  .clone()
                  .multiplyScalar(1 - u - v)
                  .addScaledVector(b, u)
                  .addScaledVector(c, v),
                foot = owner.floorAt(point.toArray(), floor.id);
              if (!foot || !owner.isClearFoot(foot)) continue;
              assert.deepEqual(
                intersections(parts, point, true),
                [],
                `${floor.id}: accepted foot crosses actual structure at ${point.toArray()}`,
              );
              checked++;
            }
        }
      assert(checked > 100, 'meaningful real floor/body/eye coverage');
    } finally {
      owner.dispose();
    }
  });

test('emitted barrier clearance detects a missing handrail and balustrade collider independently', () => {
  const data = packet('waterfront'),
    connection = data.connections.find(
      (c) => c.id === 'waterfront-expo-platform-up',
    ),
    index = Math.floor(connection.treads.length / 2),
    { centre, across } = treadProfile(connection.treads[index]),
    point = centre.clone().addScaledVector(across, -0.25),
    normal = ownerWithSigns(data);
  try {
    const foot = normal.floorAt(
      point.toArray(),
      `${connection.id}:step:${index}`,
    );
    assert(
      foot && !normal.isClearFoot(foot),
      'the true rendered barrier is physical',
    );
  } finally {
    normal.dispose();
  }
  const missing = structuredClone(data),
    ids = new Set(
      data.parts
        .filter(
          (p) =>
            p.id.startsWith(`${connection.id}-`) &&
            ['handrail', 'balustrade'].includes(p.role),
        )
        .map((p) => p.id),
    );
  missing.obstacles = missing.obstacles.filter((p) => !ids.has(p.id));
  const broken = ownerWithSigns(missing);
  try {
    const foot = broken.floorAt(
      point.toArray(),
      `${connection.id}:step:${index}`,
    );
    assert(
      foot && broken.isClearFoot(foot),
      'negative fixture removes only collision',
    );
    assert(
      intersections(renderedStructure(broken), point).some((id) => ids.has(id)),
      'independent actual triangle test still catches the visible collision',
    );
  } finally {
    broken.dispose();
  }
});

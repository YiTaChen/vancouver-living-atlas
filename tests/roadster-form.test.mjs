import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { cityModule } from './helpers/city-modules.mjs';
import { projectBeforeRound2Roadster } from '../tools/assets/material-consumer-candidates/adapters/round2-roadster-source-compatibility.mjs';

const { makeRoadster } = await import(cityModule('assets/roadster'));
const { VehicleDamageVisuals } = await import(
  cityModule('vehicle-damage-visuals')
);
const { vehicleSurfaceWeight } = await import(
  cityModule('assets/vehicle-surface')
);
const {
  roadsterFormLift,
  roadsterFormGradient,
  ROADSTER_FORM_MAX_LIFT_M,
  roadsterMorphTextureBytes,
} = await import(cityModule('assets/roadster-form'));
const { installPedestrianOverrideMaterial } = await import(
  cityModule('city-life/pedestrian-renderer')
);
const { STREET_SHOWCASE_SEGMENTS, STREET_SHOWCASE_BOUNDS } = await import(
  cityModule('street-quality-profile')
);

function assertMorphedPointsInsideBounds(geometry) {
  assert(geometry.boundingBox && geometry.boundingSphere);
  const pos = geometry.getAttribute('position'),
    target = geometry.morphAttributes.position[0],
    point = new THREE.Vector3();
  assert.equal(target.count, pos.count);
  assert.equal(geometry.morphTargetsRelative, true);
  let moved = 0,
    peak = 0;
  for (let i = 0; i < pos.count; i++) {
    point.fromBufferAttribute(pos, i);
    const lift = target.getY(i);
    if (lift > 1e-6) {
      moved++;
      peak = Math.max(peak, lift);
      // The unchanged Drive sweep hull has half-extents [1,.65,2.4]
      // centered .7m above ground: .05 <= y <= 1.35 in car coordinates.
      assert(Math.abs(point.x) <= 1 && Math.abs(point.z) <= 2.4);
      assert(point.y >= 0.05 && point.y + lift <= 1.35);
    }
    point.y += lift;
    assert(geometry.boundingBox.containsPoint(point));
    assert(
      point.distanceTo(geometry.boundingSphere.center) <=
        geometry.boundingSphere.radius + 1e-6,
    );
  }
  return { moved, peak };
}

void test('pilot reshapes both bonnet and rear deck smoothly within the old collision hull', () => {
  assert.equal(ROADSTER_FORM_MAX_LIFT_M, 0.035);
  assert.equal(roadsterFormLift(0, 0.7, 1.2), 0.035);
  assert.equal(roadsterFormLift(0, 0.7, -1.5), 0.03);
  assert.equal(roadsterFormLift(0, 0.7, 1.2, 0), 0);
  assert.equal(
    roadsterFormLift(0, 0.7, 1.2, 0.5),
    ROADSTER_FORM_MAX_LIFT_M / 2,
  );
  for (const point of [
    [0, 0.7, 0],
    [0, 0.7, 2.05],
    [0.9, 0.7, 1.2],
    [0, 1.3, 1.2],
    [0, 0.2, 1.2],
    [0, 0.7, -2.2],
  ])
    assert.equal(roadsterFormLift(...point), 0);
  assert.equal(roadsterFormLift(NaN, 0.7, 1), 0);

  const asset = makeRoadster();
  const paint = asset.group.getObjectByName('roadster/paint');
  const source = paint.geometry.getAttribute('position');
  const target = paint.geometry.morphAttributes.position[0];
  const targetNormals = paint.geometry.morphAttributes.normal[0];
  assert.equal(target.count, source.count);
  assert.equal(targetNormals.count, source.count);
  assert.equal(
    target.array.byteLength + targetNormals.array.byteLength,
    535680,
  );
  assert.equal(roadsterMorphTextureBytes(source.count, 16384), 786432);
  const before = new Float32Array(source.array);
  const proof = assertMorphedPointsInsideBounds(paint.geometry);
  assert(proof.moved > 500);
  assert(
    proof.peak > ROADSTER_FORM_MAX_LIFT_M * 0.95 &&
      proof.peak <= ROADSTER_FORM_MAX_LIFT_M + 1e-7,
  );
  assert.deepEqual(
    source.array,
    before,
    'the authored physical/source mesh is unchanged',
  );
  asset.group.traverse((part) => {
    if (part.isMesh)
      assert.equal(
        part.castShadow,
        false,
        'the car retains its existing analytic contact shadow',
      );
  });
  const digest = createHash('sha256');
  asset.group.traverse((part) => {
    if (!part.isMesh) return;
    for (const name of ['position', 'normal']) {
      const a = part.geometry.getAttribute(name);
      if (a)
        digest.update(
          new Uint8Array(
            a.array.buffer,
            a.array.byteOffset,
            a.array.byteLength,
          ),
        );
    }
    const a = part.geometry.index;
    if (a)
      digest.update(
        new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength),
      );
  });
  assert.equal(
    digest.digest('hex'),
    '7c8a7b1aec841bd50c1aa0649fdacb3f8de387c8276f159164d8dc9d494f3ffa',
  );

  // Check actual original triangles; there must be no collapsed or flipped
  // non-degenerate face after the maximum pilot deformation.
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const aa = new THREE.Vector3(),
    bb = new THREE.Vector3(),
    cc = new THREE.Vector3();
  const n = new THREE.Vector3(),
    nn = new THREE.Vector3(),
    edge = new THREE.Vector3();
  let checked = 0;
  for (let i = 0; i < source.count; i += 3) {
    a.fromBufferAttribute(source, i);
    b.fromBufferAttribute(source, i + 1);
    c.fromBufferAttribute(source, i + 2);
    n.subVectors(b, a).cross(edge.subVectors(c, a));
    if (n.lengthSq() < 1e-15) continue;
    aa.copy(a);
    bb.copy(b);
    cc.copy(c);
    aa.y += target.getY(i);
    bb.y += target.getY(i + 1);
    cc.y += target.getY(i + 2);
    nn.subVectors(bb, aa).cross(edge.subVectors(cc, aa));
    assert(n.dot(nn) > 0, `face ${i / 3} must not invert`);
    checked++;
  }
  assert(checked > 1000);
});

void test('the shared form weight follows real world transforms, fades continuously, and resets for hidden or distant models', () => {
  const asset = makeRoadster(),
    root = new THREE.Group();
  root.add(asset.group);
  const paint = asset.group.getObjectByName('roadster/paint');
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  const x = (a[0] + b[0]) / 2,
    z = (a[1] + b[1]) / 2;
  root.position.set(x, 30, z);
  root.rotation.y = 1.17;
  asset.update(1, 0.5);
  assert.equal(paint.morphTargetInfluences[0], 1);
  const source = new Float32Array(
    paint.geometry.getAttribute('position').array,
  );

  let previous = paint.morphTargetInfluences[0];
  for (let i = 1; i <= 600; i++) {
    root.position.x = x + i * 0.5;
    asset.update(i, -0.25);
    const weight = paint.morphTargetInfluences[0];
    assert.equal(weight, vehicleSurfaceWeight(root.position.x, 30, z));
    assert(Math.abs(weight - previous) < 0.025, 'no hard geographic switch');
    previous = weight;
  }
  root.position.x = STREET_SHOWCASE_BOUNDS.maxX + 100;
  asset.update(0, 0);
  assert.equal(paint.morphTargetInfluences[0], 0);
  root.position.set(x, 300, z);
  asset.update(0, 0);
  assert.equal(paint.morphTargetInfluences[0], 0);
  root.position.set(x, 30, z);
  asset.group.visible = false;
  asset.update(0, 0);
  assert.equal(paint.morphTargetInfluences[0], 0);
  asset.group.visible = true;
  asset.group.removeFromParent();
  asset.update(0, 0);
  assert.equal(paint.morphTargetInfluences[0], 0);
  assert.deepEqual(paint.geometry.getAttribute('position').array, source);
});

void test('real roadster damage and original paint share the same form and remain within conservative culling bounds', () => {
  const asset = makeRoadster(),
    root = new THREE.Group();
  root.add(asset.group);
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  root.position.set((a[0] + b[0]) / 2, 30, (a[1] + b[1]) / 2);
  root.rotation.y = 0.8;
  asset.update(0, 0);
  const paint = asset.group.getObjectByName('roadster/paint');
  const original = paint.geometry,
    originalPositions = new Float32Array(
      original.getAttribute('position').array,
    );
  const effects = new VehicleDamageVisuals(root);
  assert.equal(
    effects.record({
      localPoint: [0, 0.79, 1.2],
      localNormal: [0, 1, 0],
      severity: 0.65,
      scrape: false,
    }),
    true,
  );
  assert(effects.stats().dentedVertices > 0 && effects.stats().triangles > 0);
  const marks = effects.group.children[0];
  marks.onBeforeRender();
  assert.equal(paint.morphTargetInfluences[0], 1);
  assert.equal(marks.morphTargetInfluences[0], 1);
  assert.equal(marks.geometry.morphAttributes.position.length, 1);
  assert.equal(marks.geometry.morphAttributes.normal.length, 1);
  root.updateMatrixWorld(true);
  assert(
    paint.matrixWorld.equals(marks.matrixWorld),
    'paint and marks use the same car-local and world frames',
  );
  assertMorphedPointsInsideBounds(paint.geometry);
  assertMorphedPointsInsideBounds(marks.geometry);
  // Compare actual clipped scratch vertices to barycentric interpolation of
  // the current dented body's native morph target, in the real rotated frame.
  const point = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const a3 = new THREE.Vector3(),
    b3 = new THREE.Vector3(),
    c3 = new THREE.Vector3();
  const bary = new THREE.Vector3(),
    ray = new THREE.Raycaster();
  const markPosition = marks.geometry.getAttribute('position');
  const markNormal = marks.geometry.getAttribute('normal');
  const markMorph = marks.geometry.morphAttributes.position[0];
  const markNormalMorph = marks.geometry.morphAttributes.normal[0];
  const bodyPosition = paint.geometry.getAttribute('position');
  const bodyMorph = paint.geometry.morphAttributes.position[0];
  const bodyNormal = paint.geometry.getAttribute('normal');
  const bodyNormalMorph = paint.geometry.morphAttributes.normal[0];
  const bodyN = new THREE.Vector3(),
    markN = new THREE.Vector3(),
    scratch = new THREE.Vector3();
  let checked = 0,
    worst = 0,
    worstNormalAngle = 0,
    worstExtraNormalAngle = 0,
    worstBaselineNormalAngle = 0;
  paint.morphTargetInfluences[0] = 0;
  for (
    let i = 0;
    i < markPosition.count;
    i += Math.max(1, Math.floor(markPosition.count / 80))
  ) {
    point.fromBufferAttribute(markPosition, i);
    normal.fromBufferAttribute(markNormal, i).normalize();
    const worldPoint = root.localToWorld(point.clone());
    const worldNormal = normal.clone().transformDirection(root.matrixWorld);
    ray.set(
      worldPoint.addScaledVector(worldNormal, 0.04),
      worldNormal.negate(),
    );
    ray.near = 0;
    ray.far = 0.08;
    const hit = ray
      .intersectObject(paint, false)
      .find((x) => Math.abs(x.distance - 0.0415) < 0.003);
    if (!hit?.face) continue;
    const { a, b, c } = hit.face;
    a3.fromBufferAttribute(bodyPosition, a);
    b3.fromBufferAttribute(bodyPosition, b);
    c3.fromBufferAttribute(bodyPosition, c);
    const localHit = paint.worldToLocal(hit.point.clone());
    if (!THREE.Triangle.getBarycoord(localHit, a3, b3, c3, bary)) continue;
    const expected =
      bary.x * bodyMorph.getY(a) +
      bary.y * bodyMorph.getY(b) +
      bary.z * bodyMorph.getY(c);
    worst = Math.max(worst, Math.abs(markMorph.getY(i) - expected));
    const baseBody = new THREE.Vector3()
      .fromBufferAttribute(bodyNormal, a)
      .multiplyScalar(bary.x)
      .add(
        new THREE.Vector3()
          .fromBufferAttribute(bodyNormal, b)
          .multiplyScalar(bary.y),
      )
      .add(
        new THREE.Vector3()
          .fromBufferAttribute(bodyNormal, c)
          .multiplyScalar(bary.z),
      )
      .normalize();
    const baseMark = new THREE.Vector3()
      .fromBufferAttribute(markNormal, i)
      .normalize();
    const baselineAngle = baseBody.angleTo(baseMark);
    worstBaselineNormalAngle = Math.max(
      worstBaselineNormalAngle,
      baselineAngle,
    );
    bodyN
      .fromBufferAttribute(bodyNormal, a)
      .add(scratch.fromBufferAttribute(bodyNormalMorph, a))
      .multiplyScalar(bary.x)
      .add(
        scratch
          .fromBufferAttribute(bodyNormal, b)
          .add(new THREE.Vector3().fromBufferAttribute(bodyNormalMorph, b))
          .multiplyScalar(bary.y),
      )
      .add(
        scratch
          .fromBufferAttribute(bodyNormal, c)
          .add(new THREE.Vector3().fromBufferAttribute(bodyNormalMorph, c))
          .multiplyScalar(bary.z),
      )
      .normalize();
    markN
      .fromBufferAttribute(markNormal, i)
      .add(scratch.fromBufferAttribute(markNormalMorph, i))
      .normalize();
    const normalAngle = bodyN.angleTo(markN);
    worstNormalAngle = Math.max(worstNormalAngle, normalAngle);
    worstExtraNormalAngle = Math.max(
      worstExtraNormalAngle,
      normalAngle - baselineAngle,
    );
    checked++;
  }
  paint.morphTargetInfluences[0] = 1;
  assert(
    checked >= 15,
    'enough real scratch vertices intersect their source paint',
  );
  assert(
    worst < 0.00003,
    `decal/body form mismatch ${(worst * 1000).toFixed(4)} mm`,
  );
  assert(
    worstExtraNormalAngle < Math.PI / 90,
    `morph adds ${((worstExtraNormalAngle * 180) / Math.PI).toFixed(2)}° of normal mismatch (max before ${((worstBaselineNormalAngle * 180) / Math.PI).toFixed(2)}°, after ${((worstNormalAngle * 180) / Math.PI).toFixed(2)}°)`,
  );
  assert.deepEqual(
    original.getAttribute('position').array,
    originalPositions,
    'damage owns a clone, not the source geometry',
  );
  const firstOwned = paint.geometry;
  let oldDisposals = 0,
    sourceDisposals = 0;
  firstOwned.addEventListener('dispose', () => oldDisposals++);
  original.addEventListener('dispose', () => sourceDisposals++);
  assert(
    effects.record({
      localPoint: [0.22, 0.78, 1.05],
      localNormal: [0, 1, 0],
      severity: 0.4,
      scrape: true,
    }),
  );
  assert.equal(
    oldDisposals,
    1,
    'old owned geometry and its cached morph texture are released on rebuild',
  );
  assert.equal(
    sourceDisposals,
    0,
    'shared source geometry is never released by damage',
  );
  assert.notStrictEqual(paint.geometry, firstOwned);
  assert.equal(
    paint.morphTargetInfluences[0],
    1,
    'rebuild retains the current influence',
  );
  assertMorphedPointsInsideBounds(paint.geometry);
  effects.dispose();
  assert.strictEqual(paint.geometry, original);
  assert.equal(sourceDisposals, 0);
});

void test('roadster damage replay transfers only owned attributes while rebuilding and releasing native morph geometry', () => {
  const asset = makeRoadster(),
    root = new THREE.Group();
  root.add(asset.group);
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  root.position.set((a[0] + b[0]) / 2, 30, (a[1] + b[1]) / 2);
  asset.update(0, 0);
  const paint = asset.group.getObjectByName('roadster/paint');
  const source = paint.geometry;
  const sourcePositions = source.getAttribute('position').array.slice();
  const effects = new VehicleDamageVisuals(root);
  assert(
    effects.record({
      localPoint: [0, 0.79, 1.2],
      localNormal: [0, 1, 0],
      severity: 0.65,
      scrape: false,
    }),
  );
  const before = paint.geometry;
  const priorAttributes = { ...before.attributes };
  const priorIndex = before.index;
  const expectedPositions = before.getAttribute('position').array.slice();
  const expectedNormals = before.getAttribute('normal').array.slice();
  const expectedMorphPosition =
    before.morphAttributes.position[0].array.slice();
  const expectedMorphNormal = before.morphAttributes.normal[0].array.slice();
  const expectedMarks = effects.group.children[0].geometry
    .getAttribute('position')
    .array.slice();
  const oldMorph = before.morphAttributes.position[0];
  let disposed = 0,
    sourceDisposed = 0;
  before.addEventListener('dispose', () => disposed++);
  source.addEventListener('dispose', () => sourceDisposed++);
  effects.refresh();
  const after = paint.geometry;
  assert.notStrictEqual(after, before);
  assert.equal(disposed, 1);
  assert.equal(sourceDisposed, 0);
  assert.strictEqual(after.index, priorIndex);
  for (const [name, attribute] of Object.entries(priorAttributes))
    assert.strictEqual(after.getAttribute(name), attribute);
  assert.notStrictEqual(
    after.getAttribute('position'),
    source.getAttribute('position'),
  );
  assert.notStrictEqual(after.morphAttributes.position[0], oldMorph);
  assert.deepEqual(after.groups, before.groups);
  assert.deepEqual(after.drawRange, before.drawRange);
  assert.strictEqual(after.userData, before.userData);
  assert.deepEqual(after.getAttribute('position').array, expectedPositions);
  assert.deepEqual(after.getAttribute('normal').array, expectedNormals);
  assert.deepEqual(
    after.morphAttributes.position[0].array,
    expectedMorphPosition,
  );
  assert.deepEqual(after.morphAttributes.normal[0].array, expectedMorphNormal);
  assert.deepEqual(
    effects.group.children[0].geometry.getAttribute('position').array,
    expectedMarks,
  );
  assert.equal(paint.morphTargetInfluences[0], 1);
  assert.deepEqual(source.getAttribute('position').array, sourcePositions);
  effects.dispose();
  assert.strictEqual(paint.geometry, source);
  assert.equal(sourceDisposed, 0);
});

void test('native Three morph chunks are present in colour, depth, and the actual wrapped SSAO normal material', () => {
  for (const name of ['standard', 'normal', 'depth']) {
    const source = THREE.ShaderLib[name].vertexShader;
    assert(
      source.includes('#include <morphtarget_vertex>'),
      `${name} applies position morphs`,
    );
    assert(
      source.includes('#include <morphnormal_vertex>'),
      `${name} applies normal morphs`,
    );
  }
  const pass = new SSAOPass(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    8,
    8,
    8,
  );
  const restore = installPedestrianOverrideMaterial(pass.normalMaterial);
  try {
    const s = {
      vertexShader: THREE.ShaderLib.normal.vertexShader,
      fragmentShader: THREE.ShaderLib.normal.fragmentShader,
      uniforms: {},
    };
    pass.normalMaterial.onBeforeCompile(s, {});
    assert(s.vertexShader.includes('#include <morphtarget_vertex>'));
    assert(s.vertexShader.includes('#include <morphnormal_vertex>'));
    assert(
      s.vertexShader.indexOf('#include <begin_vertex>') <
        s.vertexShader.indexOf('#include <morphtarget_vertex>'),
    );
  } finally {
    restore();
    pass.dispose();
  }
});

void test('damage keeps its history when switching between the pilot roadster and the classic model', () => {
  const asset = makeRoadster(),
    root = new THREE.Group();
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  root.position.set((a[0] + b[0]) / 2, 30, (a[1] + b[1]) / 2);
  root.add(asset.group);
  const classic = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 1, 4.4),
    new THREE.MeshStandardMaterial(),
  );
  classic.position.y = 0.5;
  classic.visible = false;
  root.add(classic);
  asset.update(0, 0);
  const paint = asset.group.getObjectByName('roadster/paint');
  const effects = new VehicleDamageVisuals(root);
  assert(
    effects.record({
      localPoint: [0, 0.79, 1.2],
      localNormal: [0, 1, 0],
      severity: 0.65,
      scrape: false,
    }),
  );
  const marks = effects.group.children[0];
  marks.onBeforeRender();
  assert.equal(marks.morphTargetInfluences[0], 1);
  const history = effects.marks.length;

  asset.group.visible = false;
  classic.visible = true;
  asset.update(0, 0);
  effects.refresh();
  assert.equal(effects.marks.length, history);
  assert.equal(paint.morphTargetInfluences[0], 0);
  assert.equal(
    marks.geometry.morphAttributes.position,
    undefined,
    'classic car scratches retain their original shape',
  );

  classic.visible = false;
  asset.group.visible = true;
  asset.update(0, 0);
  effects.refresh();
  marks.onBeforeRender();
  assert.equal(effects.marks.length, history);
  assert.equal(marks.morphTargetInfluences[0], 1);
  assert.equal(marks.geometry.morphAttributes.position.length, 1);
  effects.dispose();
});

void test('historical roadster source remains protected by a narrow, fail-closed projection', () => {
  const path = 'lib/city/assets/roadster.ts';
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const projected = projectBeforeRound2Roadster(path, source);
  assert.equal(
    createHash('sha256').update(projected.source).digest('hex'),
    '6adc2cc4771fa9431c73ac90c309eb8ec6d213f45b8170c9a3a48789aaad7455',
  );
  assert.equal(projected.reviewed.length, 1);
  assert.throws(() =>
    projectBeforeRound2Roadster(
      path,
      source.replace("if (key === 'paint')", "if (key === 'dark')"),
    ),
  );
  assert.throws(() =>
    projectBeforeRound2Roadster(
      path,
      source.replace(
        'new THREE.Vector3(0.77, 0.62, -2.2)',
        'new THREE.Vector3(0.79, 0.62, -2.2)',
      ),
    ),
  );
  assert.throws(() =>
    projectBeforeRound2Roadster(
      path,
      source +
        "\n    if (key === 'paint') installRoadsterFormGeometry(geometry);\n",
    ),
  );
});

void test('analytic form gradients match central differences at every shape boundary', () => {
  const around = (values) => values.flatMap((v) => [v - 1e-7, v, v + 1e-7]);
  const xs = around([-0.8, -0.69, -0.58, 0, 0.58, 0.69, 0.8]);
  const ys = around([0.38, 0.48, 0.58, 0.7, 0.83, 0.95, 1.08]);
  const zs = around([
    -1.97, -1.845, -1.72, -1.5, -1.25, -1.1, -0.95, 0.72, 0.835, 0.95, 1.2,
    1.45, 1.635, 1.82,
  ]);
  const h = 1e-6,
    gradient = new THREE.Vector3();
  for (const x of xs)
    for (const y of ys)
      for (const z of zs) {
        const value = roadsterFormGradient(x, y, z, gradient);
        assert.strictEqual(
          value,
          gradient,
          'the builder reuses its destination vector',
        );
        const numeric = [
          (roadsterFormLift(x + h, y, z) - roadsterFormLift(x - h, y, z)) /
            (2 * h),
          (roadsterFormLift(x, y + h, z) - roadsterFormLift(x, y - h, z)) /
            (2 * h),
          (roadsterFormLift(x, y, z + h) - roadsterFormLift(x, y, z - h)) /
            (2 * h),
        ];
        assert(Math.abs(gradient.x - numeric[0]) < 1e-5);
        assert(Math.abs(gradient.y - numeric[1]) < 1e-5);
        assert(Math.abs(gradient.z - numeric[2]) < 1e-5);
      }
  assert.deepEqual(
    roadsterFormGradient(NaN, 0.7, 1, gradient).toArray(),
    [0, 0, 0],
  );
});

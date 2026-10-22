import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import {
  DATA,
  METRICS,
  analyzePayload,
  auditPackage,
  angularRange,
  decodePart,
  posedPoint,
  rigState,
  sweptPoint,
  clippedMinimum,
} from '../tools/assets/tesla-roadster-2026/audit.mjs';

const data = JSON.parse(readFileSync(DATA)),
  analysis = analyzePayload(data);
const close = (a, b, tolerance = 2e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('the detailed runtime copy and all original/derived source files match a complete provenance manifest', () => {
  const report = auditPackage();
  assert.equal(report.passed, true);
  assert.ok(report.files.length >= 13);
  assert.match(data.source.dimensionBasis, /not Tesla CAD/i);
  assert.equal(new URL(data.source.referenceUrl).hostname, 'www.tesla.com');
  assert.match(data.source.yawPorts, /inferred/);
  assert.equal(report.metrics.thrusters.length, 8);
  assert.deepEqual(report.metrics.thrusters.map((p) => p.kind).sort(), [
    'lift',
    'lift',
    'lift',
    'lift',
    'rear',
    'rear',
    'rear',
    'rear',
  ]);
  assert.deepEqual(
    report.metrics,
    JSON.parse(readFileSync(METRICS)).payloadSha256 === report.payload.sha256
      ? (() => {
          const m = JSON.parse(readFileSync(METRICS));
          delete m.payloadSha256;
          return m;
        })()
      : null,
  );
});

test('actual decoded positions, normalized normals, colors and triangle indices obey all three tier budgets', () => {
  let previous = 0;
  for (const quality of ['low', 'medium', 'high']) {
    const metric = analysis.metrics.levels[quality];
    assert.ok(metric.triangles > previous);
    previous = metric.triangles;
    assert.ok(metric.maxDrawsWithYawAndJets <= 36);
    assert.equal(metric.degenerateTriangles, 0);
    const palette = new Set();
    for (const part of analysis.decoded[quality]) {
      assert.ok(part.colors?.length === part.vertexCount);
      assert.equal(part.positions.length, part.vertexCount);
      assert.equal(part.normals.length, part.vertexCount);
      assert.equal(part.indices.length, part.indexCount);
      for (let i = 0; i < part.vertexCount; i++) {
        assert.ok(part.positions[i].every(Number.isFinite));
        close(Math.hypot(...part.normals[i]), 1, 1e-12);
        assert.ok(part.colors[i].every((v) => v >= 0 && v <= 1));
        palette.add(part.colors[i].map((v) => Math.round(v * 255)).join(','));
      }
      assert.ok(
        part.indices.every(
          (i) => Number.isInteger(i) && i >= 0 && i < part.vertexCount,
        ),
      );
    }
    assert.ok(
      palette.size > 15,
      'absolute source colors cannot collapse into a single replacement paint factor',
    );
  }
});

test('malformed quantized streams and missing/cyclic rigs fail closed', () => {
  const original = data.lods.low.parts[0];
  assert.throws(
    () => decodePart({ ...original, positions: original.positions + '!' }),
    /base64/,
  );
  assert.throws(
    () =>
      decodePart({
        ...original,
        normals: Buffer.alloc(original.vertexCount * 3).toString('base64'),
      }),
    /normal/,
  );
  const indices = Buffer.from(original.indices, 'base64');
  indices.writeUInt16LE(65535, 0);
  assert.throws(
    () => decodePart({ ...original, indices: indices.toString('base64') }),
    /index out of range/,
  );
  const broken = structuredClone(data);
  broken.rig.nodes[0].parent = broken.rig.nodes[0].id;
  assert.throws(() => rigState(broken), /cyclic/);
});

test('continuous analytic extrema include interior angular extrema and coupled wing pitch/lift', () => {
  const exact = angularRange(3, 4, -Math.PI, Math.PI);
  close(exact[0], -5, 1e-12);
  close(exact[1], 5, 1e-12);
  const linked = angularRange(-0.2, 0.35, -0.28, 0, -0.24 / 0.28);
  for (let i = 0; i <= 1000; i++) {
    const t = (-0.28 * i) / 1000,
      v = -0.2 * Math.cos(t) + 0.35 * Math.sin(t) - (0.24 / 0.28) * t;
    assert.ok(v >= linked[0] - 1e-12 && v <= linked[1] + 1e-12);
  }
  // Clipping detects a low interpolated point at the slab edge, not only vertices inside it.
  close(
    clippedMinimum(
      [
        [0, 0.1, -2],
        [1, 0.5, 0],
        [-1, 0.5, 0],
      ],
      -0.5,
      0.5,
    ),
    0.4,
    1e-12,
  );
  const poses = [
    {
      steeringRad: -0.62,
      wheelSpinRad: 0.37,
      fanSpinRad: 1.12,
      wingDeploy: 0.41,
    },
    { steeringRad: 0.62, wheelSpinRad: 1.52, fanSpinRad: 2.81, wingDeploy: 1 },
    {
      steeringRad: 0.173,
      wheelSpinRad: 5.11,
      fanSpinRad: 5.77,
      wingDeploy: 0.687,
    },
  ];
  for (const quality of ['low', 'medium', 'high'])
    for (const part of analysis.decoded[quality])
      for (
        let i = 0;
        i < part.positions.length;
        i += Math.max(1, Math.floor(part.positions.length / 11))
      ) {
        const local = part.positions[i],
          rest = posedPoint(local, part.assembly, analysis.state),
          bounds = sweptPoint(rest, part.assembly, analysis.state);
        for (const pose of poses) {
          const p = posedPoint(local, part.assembly, analysis.state, pose);
          for (let axis = 0; axis < 3; axis++)
            assert.ok(
              p[axis] >= bounds.min[axis] - 1e-10 &&
                p[axis] <= bounds.max[axis] + 1e-10,
            );
        }
      }
});

test('generated ground/camera metadata follows actual geometry instead of the previous procedural car', () => {
  const m = analysis.metrics,
    g = m.groundSupport;
  close(m.dimensions.wheelbase, 2.7, 1e-12);
  close(g.track, 1.68, 1e-12);
  assert.equal(m.dimensions.wheelRadius, 0.3505);
  assert.equal(m.dimensions.contactToCenter, m.dimensions.halfExtents[1]);
  assert.deepEqual(g.wheelContacts, [
    [-0.84, 0, 1.35],
    [0.84, 0, 1.35],
    [-0.84, 0, -1.35],
    [0.84, 0, -1.35],
  ]);
  assert.deepEqual(m.anchors.driverEye, [0.36, 0.8805, -0.68]);
  assert.deepEqual(
    m.anchors.steeringWheel,
    analysis.state.world(data.rig.steering),
  );
  for (const l of Object.values(m.levels)) {
    assert.ok(l.animatedBoundsM.min[1] >= -1e-6);
    for (let i = 0; i < 3; i++) {
      const section = g.bodySections[i],
        minimum = l.animatedBodySectionMinimumY[i];
      assert.ok(
        section.clearance <= minimum && minimum - section.clearance < 0.02,
      );
    }
    for (const wheel of Object.values(l.wheelBoundsM))
      assert.ok(wheel.min[1] >= -1e-6);
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(
      analysis.unionAnimated.min[axis] >=
        (axis === 1 ? 0 : -m.dimensions.halfExtents[axis]) - 1e-6,
    );
    assert.ok(
      analysis.unionAnimated.max[axis] <=
        (axis === 1
          ? m.dimensions.halfExtents[axis] * 2
          : m.dimensions.halfExtents[axis]) +
          1e-6,
    );
  }
});

test('runtime geometry and full poses agree with independent payload decoding at every tier', async () => {
  const { createTeslaRoadster } = await import(
    cityModule('assets/tesla-roadster')
  );
  const model = createTeslaRoadster({ quality: 'low' }),
    p = new THREE.Vector3();
  try {
    for (const quality of ['low', 'medium', 'high']) {
      model.setQuality(quality);
      for (const pose of [
        { steeringRad: 0, wheelSpinRad: 0, fanSpinRad: 0, wingDeploy: 0 },
        {
          steeringRad: 0.62,
          wheelSpinRad: 1.5,
          fanSpinRad: 1.7,
          wingDeploy: 1,
        },
        {
          steeringRad: -0.62,
          wheelSpinRad: 4.21,
          fanSpinRad: 2.19,
          wingDeploy: 0.43,
        },
      ]) {
        model.update({ ...pose, thrust: 0, vortexThrust: 0 });
        model.group.updateMatrixWorld(true);
        const level = model.group.children.find(
          (child) => child.isGroup && child.visible,
        );
        for (const part of analysis.decoded[quality]) {
          const mesh = level.getObjectByName(`${part.assembly}:${part.role}`);
          assert.ok(
            mesh?.isMesh,
            `${quality}: payload mesh ${part.assembly}:${part.role}`,
          );
          assert.equal(
            mesh.castShadow,
            part.role !== 'glass' && part.role !== 'headlight',
          );
          assert.equal(mesh.receiveShadow, part.role !== 'glass');
          const position = mesh.geometry.getAttribute('position'),
            normal = mesh.geometry.getAttribute('normal'),
            color = mesh.geometry.getAttribute('color');
          assert.equal(position.count, part.vertexCount);
          assert.equal(mesh.geometry.index.count, part.indexCount);
          if (part.role === 'glass') {
            assert.equal(mesh.material.vertexColors, false);
            assert.equal(mesh.material.side, THREE.FrontSide);
            assert.equal(mesh.material.depthWrite, false);
            assert.equal(mesh.userData.excludeFromSSAO, true);
          } else {
            assert.equal(mesh.material.vertexColors, true);
            if (pose.steeringRad === 0)
              assert.ok(
                mesh.material.color
                  .toArray()
                  .every((value) => Math.abs(value - 1) < 1e-6),
                'absolute source vertex colors need a white material base',
              );
          }
          assert.ok(
            !Object.values(mesh.material).some((value) => value?.isTexture),
          );
          assert.ok(
            !mesh.material.transmission,
            'runtime must not acquire a refraction render pass',
          );
          for (let i = 0; i < part.positions.length; i++)
            for (let axis = 0; axis < 3; axis++) {
              close(position.getComponent(i, axis), part.positions[i][axis]);
              close(normal.getComponent(i, axis), part.normals[i][axis]);
              close(color.getComponent(i, axis), part.colors[i][axis]);
            }
          for (let i = 0; i < part.indices.length; i++)
            assert.equal(mesh.geometry.index.getX(i), part.indices[i]);
          for (
            let i = 0;
            i < part.positions.length;
            i += Math.max(1, Math.floor(part.positions.length / 13))
          ) {
            p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            const expected = posedPoint(
              part.positions[i],
              part.assembly,
              analysis.state,
              pose,
            );
            expected.forEach((value, axis) =>
              close(p.getComponent(axis), value),
            );
          }
        }
        assert.ok(model.stats().meshes <= 36);
      }
    }
  } finally {
    model.dispose();
  }
});

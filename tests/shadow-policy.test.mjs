import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { shadowCoverage, shadowBasis, snapShadowAnchor, SHADOW_DEPTH } =
  await import(cityModule('shadow-policy'));
const { sunAngle } = await import(cityModule('clock'));
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const near = (a, b, tolerance = 1e-8) =>
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const input = {
  mode: 'orbit',
  quality: 'high',
  distance: 150,
  focus: [1428, 28, 135],
  sunDirection: [-2100, 4200, 1400],
  mapSize: 2048,
};

test('High and Ultra retain map sizes and far coverage while resolving small nearby architecture', () => {
  const high = shadowCoverage(input),
    ultra = shadowCoverage({ ...input, quality: 'ultra', mapSize: 4096 });
  assert.equal(high.extent, 160);
  assert.equal(ultra.extent, high.extent);
  near(high.texelMetres, 0.15625);
  near(ultra.texelMetres, 0.078125);
  assert(high.normalBias >= 0.08 && high.normalBias <= 0.3);
  assert(Math.abs(high.bias) * (SHADOW_DEPTH.far - SHADOW_DEPTH.near) <= 0.2);
  const far = shadowCoverage({ ...input, distance: 3800 });
  assert.equal(far.extent, 2700);
  assert.deepEqual(far.anchor, [0, 0, 0]);
  assert.deepEqual(SHADOW_DEPTH, { near: 100, far: 9500 });
  for (const mode of ['walk', 'drive', 'boat', 'flight'])
    assert.equal(shadowCoverage({ ...input, mode }).extent, 170);
});

test('light-space snapping puts both shadow-plane coordinates on actual texel boundaries', () => {
  for (const direction of [
    [-2100, 4200, 1400],
    [4000, 300, 1400],
    [0.001, 5000, 0.02],
    [0, 5000, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]) {
    const basis = shadowBasis(direction);
    for (const texel of [0.078125, 0.166015625, 2.63671875]) {
      const anchor = snapShadowAnchor(
        [1234.123, 45.5, -760.23],
        direction,
        texel,
      );
      assert(anchor.every(Number.isFinite));
      const light = new THREE.DirectionalLight();
      light.position.fromArray(anchor).add(new THREE.Vector3(...direction));
      light.target.position.fromArray(anchor);
      light.updateMatrixWorld(true);
      light.target.updateMatrixWorld(true);
      const mapSize = 2048,
        extent = (texel * mapSize) / 2;
      Object.assign(light.shadow.camera, {
        left: -extent,
        right: extent,
        top: extent,
        bottom: -extent,
        near: SHADOW_DEPTH.near,
        far: SHADOW_DEPTH.far,
      });
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.updateMatrices(light);
      const origin = new THREE.Vector3().applyMatrix4(light.shadow.matrix);
      for (const coordinate of [origin.x, origin.y])
        near(coordinate * mapSize, Math.round(coordinate * mapSize), 2e-5);
      near(dot(basis.right, basis.up), 0);
      near(dot(basis.forward, basis.up), 0);
      near(Math.hypot(...basis.forward), 1);
    }
  }
});

test('a full solar cycle resnaps the same world center without accumulating coverage drift', () => {
  const first = shadowCoverage({ ...input, mode: 'walk' });
  let previous = first;
  for (let step = 0; step <= 720; step++) {
    const angle = (step / 720) * Math.PI * 2;
    previous = shadowCoverage({
      ...input,
      mode: 'walk',
      previous,
      refreshing: true,
      sunDirection: [
        Math.cos(angle) * 4500,
        Math.max(300, Math.sin(angle) * 5000),
        1400,
      ],
    });
    assert.deepEqual(previous.center, input.focus);
    // The snap remains at most one half texel along either light-plane axis.
    const basis = shadowBasis([
      Math.cos(angle) * 4500,
      Math.max(300, Math.sin(angle) * 5000),
      1400,
    ]);
    const delta = previous.anchor.map((n, i) => n - input.focus[i]);
    for (const axis of [basis.right, basis.up])
      assert(Math.abs(dot(delta, axis)) <= previous.texelMetres / 2 + 1e-8);
  }
  const restored = shadowCoverage({
    ...input,
    mode: 'walk',
    previous,
    refreshing: true,
  });
  assert.deepEqual(restored.anchor, first.anchor);
  assert.deepEqual(restored.center, first.center);
});

test('stationary and sub-margin travel preserve exact cached coordinates; crossing margin recenters safely', () => {
  const first = shadowCoverage({ ...input, mode: 'walk' });
  const small = shadowCoverage({
    ...input,
    mode: 'walk',
    previous: first,
    focus: input.focus.map((n, i) => n + (i === 0 ? 1 : 0)),
  });
  assert.strictEqual(small.anchor, first.anchor);
  assert.deepEqual(small, first);
  const moved = shadowCoverage({
    ...input,
    mode: 'walk',
    previous: first,
    focus: input.focus.map((n, i) => n + (i === 0 ? 100 : 0)),
  });
  assert.notDeepEqual(moved.anchor, first.anchor);
  assert.equal(moved.extent, first.extent);
  const direction = [...input.sunDirection];
  for (let i = 0; i < 50; i++) {
    shadowCoverage({
      ...input,
      previous: first,
      sunDirection: direction,
      refreshing: true,
    });
    assert.deepEqual(
      direction,
      input.sunDirection,
      'coverage must not mutate solar direction',
    );
  }
});

test('zoom coverage expands immediately, shrinks with hysteresis and resets for quality/mode transitions', () => {
  const first = shadowCoverage({ ...input, distance: 500 });
  assert.equal(first.extent, 480);
  const minor = shadowCoverage({ ...input, distance: 465, previous: first });
  assert.equal(minor.extent, first.extent);
  const close = shadowCoverage({ ...input, distance: 350, previous: first });
  assert(close.extent < first.extent);
  const expanded = shadowCoverage({ ...input, distance: 620, previous: first });
  assert(expanded.extent >= 620 * 0.95);
  assert.equal(
    shadowCoverage({
      ...input,
      distance: 465,
      previous: first,
      quality: 'ultra',
      mapSize: 4096,
    }).extent,
    448,
  );
  assert.equal(
    shadowCoverage({ ...input, mode: 'walk', previous: first }).extent,
    170,
  );
});

test('the actual 19h roof PCF slope is covered without losing 14h contact precision or using the old 1.88m depth offset', () => {
  const sunAt = (hour) => {
    const angle = sunAngle(hour);
    return [
      Math.cos(angle) * 4500,
      Math.max(300, Math.sin(angle) * 5000),
      1400,
    ];
  };
  for (const [quality, mapSize] of [
    ['high', 2048],
    ['ultra', 4096],
  ]) {
    for (const mode of ['orbit', 'walk']) {
      const day = shadowCoverage({
        ...input,
        quality,
        mapSize,
        mode,
        sunDirection: sunAt(14),
      });
      near(day.normalBias, Math.max(0.1, day.texelMetres * 0.65));
      near(day.depthOffsetMetres, 0.04);
      const dusk = shadowCoverage({
        ...input,
        quality,
        mapSize,
        mode,
        sunDirection: sunAt(19),
      });
      assert(dusk.normalBias <= 0.3);
      assert(dusk.depthOffsetMetres > 0.04 && dusk.depthOffsetMetres < 0.4);
      const sine = dusk.sunElevationSine;
      const requiredDepth =
        (dusk.texelMetres * 1.75 * Math.sqrt(1 - sine ** 2)) / sine;
      assert(dusk.normalBias / sine + dusk.depthOffsetMetres > requiredDepth);
      // This is clearance along a flat roof's normal, not a 1.88m global shift.
      assert(dusk.normalBias + dusk.depthOffsetMetres * sine <= 0.3);
      near(
        -dusk.bias * (SHADOW_DEPTH.far - SHADOW_DEPTH.near),
        dusk.depthOffsetMetres,
      );
      assert.equal(dusk.mapSize, day.mapSize);
      assert.equal(dusk.extent, day.extent);
    }
  }
  for (const hour of [6, 14, 19, 20.5, 23]) {
    for (const distance of [150, 1200, 3800]) {
      const coverage = shadowCoverage({
        ...input,
        distance,
        sunDirection: sunAt(hour),
      });
      assert(coverage.bias < 0);
      assert(coverage.depthOffsetMetres <= 0.8);
      assert(coverage.normalBias <= 1.2);
      assert(Number.isFinite(coverage.bias));
    }
  }
});

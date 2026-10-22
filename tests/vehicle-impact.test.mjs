import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const {
  resolveVehicleImpact: impact,
  createVehicleDamage,
  applyVehicleDamage,
  resetVehicleDamage,
  vehicleDamagePerformance,
  vehicleDamageZone,
  VEHICLE_IMPACT_TUNING,
} = await import(cityModule('vehicle-impact'));
const query = (overrides = {}) => ({
  velocity: [0, 0, 15],
  normal: [0, 0, -1],
  massKg: 1550,
  obstacle: { id: 'tree:1', kind: 'tree', diameterM: 0.3 },
  ...overrides,
});
const energy = (v, mass = 1550) =>
  0.5 * mass * v.reduce((sum, n) => sum + n * n, 0);
const close = (a, b, tolerance = 1e-8) =>
  assert(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('tree size changes break work cubically and consumes rather than creates kinetic energy', () => {
  const small = impact(
      query({ obstacle: { id: 'small', kind: 'tree', diameterM: 0.1 } }),
    ),
    medium = impact(query()),
    large = impact(
      query({ obstacle: { id: 'large', kind: 'tree', diameterM: 0.6 } }),
    );
  assert(small.broken && medium.broken && !large.broken);
  close(small.breakWorkJ, 2000);
  close(medium.breakWorkJ, 54000);
  close(large.breakWorkJ / medium.breakWorkJ, 8);
  assert(small.velocity[2] > medium.velocity[2] && large.velocity[2] <= 0);
  close(
    energy(small.velocity) + small.absorbedEnergyJ,
    energy(query().velocity),
  );
  close(
    energy(medium.velocity) + medium.absorbedEnergyJ,
    energy(query().velocity),
  );
});
test('tree break depends on normal energy, not total speed or a universal speed threshold', () => {
  const headOn = impact(query({ velocity: [0, 0, 12] })),
    glance = impact(query({ velocity: [40, 0, 2] }));
  assert(headOn.broken && !glance.broken);
  assert(glance.velocity[0] > 39 && glance.velocity[2] <= 0);
  assert(impact(query({ velocity: [0, 0, 8], massKg: 2000 })).broken);
  assert(!impact(query({ velocity: [0, 0, 8], massKg: 1000 })).broken);
});
test('break threshold leaves exact residual momentum and an equality hit stops at the yielded source', () => {
  const work = 54000,
    speed = Math.sqrt((2 * work) / 1550);
  const hit = impact(query({ velocity: [0, 0, speed] }));
  assert(hit.broken && hit.passThrough);
  close(hit.velocity[2], 0, 2e-7);
  close(hit.absorbedEnergyJ, work);
});
test('breakaway metal poles yield while rigid poles and nonbreakaway trees retain collision', () => {
  const lamp = { id: 'lamp:1', kind: 'lamp', diameterM: 0.16 };
  const yielding = impact(query({ obstacle: lamp })),
    fixed = impact(query({ obstacle: { ...lamp, breakaway: false } })),
    fixedTree = impact(
      query({
        obstacle: {
          id: 'tree',
          kind: 'tree',
          diameterM: 0.1,
          breakaway: false,
        },
      }),
    );
  assert(yielding.broken && yielding.velocity[2] > 14);
  close(yielding.breakWorkJ, 6000);
  assert(!fixed.broken && !fixed.passThrough && fixed.velocity[2] < 0);
  assert(!fixedTree.broken && fixedTree.velocity[2] < 0);
});
test('foliage yields softly without felling or removing its independent trunk', () => {
  const hit = impact(
    query({ obstacle: { id: 'tree:1:crown', kind: 'foliage' } }),
  );
  assert(hit.passThrough && !hit.broken);
  assert(hit.absorbedEnergyJ <= 500 + 1e-8);
  assert(hit.velocity[2] > 14.9);
});
test('guardrail glances redirect normal velocity and preserve most tangent speed, head-on loses most speed', () => {
  const obstacle = { id: 'rail:4', kind: 'guardrail', material: 'metal' },
    glance = impact(query({ velocity: [25, 0, 2], obstacle })),
    frontal = impact(query({ velocity: [0, 0, 25], obstacle }));
  assert(!glance.broken && !glance.passThrough);
  assert(glance.velocity[0] > 24.7 && glance.velocity[2] < 0);
  assert(glance.scrape > 0 && glance.severity < frontal.severity);
  assert(Math.hypot(...frontal.velocity) < 1.1);
  close(glance.friction, 0.12);
});
test('normal magnitudes do not affect response and arbitrary 3D contacts cannot add energy', () => {
  assert.deepEqual(impact(query({ normal: [0, 0, -7] })), impact(query()));
  for (const kind of ['tree', 'foliage', 'lamp', 'guardrail', 'rigid'])
    for (const speed of [0.001, 0.1, 1, 8, 25, 90, 400])
      for (const normal of [
        [0, 0, -1],
        [-1, 0, 0],
        [0, -1, -1],
        [1, -2, -3],
      ]) {
        const q = query({
            velocity: [speed * 0.4, speed * 0.2, speed],
            normal,
            obstacle: { id: kind, kind, diameterM: 0.3 },
          }),
          hit = impact(q);
        assert(hit.valid && hit.velocity.every(Number.isFinite));
        assert(
          energy(hit.velocity) <= energy(q.velocity) + 1e-5,
          `${kind} speed ${speed}`,
        );
        assert(hit.severity >= 0 && hit.severity <= 1);
        assert(hit.scrape >= 0 && hit.scrape <= 1);
        close(
          hit.absorbedEnergyJ,
          energy(q.velocity) - energy(hit.velocity),
          1e-5,
        );
      }
});
test('resting, tangent and separating contacts neither break obstacles nor add damage', () => {
  for (const velocity of [
    [0, 0, 0],
    [25, 0, 0],
    [20, 0, -10],
  ]) {
    const hit = impact(query({ velocity })),
      damage = createVehicleDamage();
    assert.deepEqual(hit.velocity, velocity);
    assert.equal(hit.absorbedEnergyJ, 0);
    assert.equal(hit.broken, false);
    assert.equal(
      applyVehicleDamage(damage, { localPoint: [0, 0, 2.3], impact: hit }),
      null,
    );
    assert.equal(damage.revision, 0);
  }
});
test('invalid or unbounded inputs fail closed with finite stationary response', () => {
  for (const overrides of [
    { velocity: [NaN, 0, 1] },
    { normal: [0, 0, 0] },
    { normal: [0, Infinity, 0] },
    { massKg: 0 },
    { massKg: -1 },
    { massKg: Infinity },
    { massKg: 100001 },
    { obstacle: { id: '', kind: 'tree' } },
    { obstacle: { id: 'x', kind: 'unknown' } },
    { obstacle: { id: 'x', kind: 'tree', diameterM: NaN } },
    { obstacle: { id: 'x', kind: 'lamp', diameterM: -0.1 } },
  ]) {
    const hit = impact(query(overrides));
    assert.equal(hit.valid, false);
    assert.deepEqual(hit.velocity, [0, 0, 0]);
    assert.equal(hit.broken, false);
  }
});
test('damage uses vehicle-local hit location, supports roof normals, and never mirrors left/right', () => {
  for (const [localPoint, zone] of [
    [[0, 0, 2], 'front'],
    [[0, 0, -2], 'rear'],
    [[-1, 0, 0], 'right'],
    [[1, 0, 0], 'left'],
    [[0, 0.7, 0], 'roof'],
  ]) {
    const damage = createVehicleDamage(),
      hit = applyVehicleDamage(damage, { localPoint, impact: impact(query()) });
    assert.equal(hit.zone, zone);
    assert(damage.zones[zone] > 0 && damage.scratches[zone] > 0);
    for (const other of ['front', 'rear', 'left', 'right', 'roof'])
      if (other !== zone) assert.equal(damage.zones[other], 0);
  }
  assert.equal(
    vehicleDamageZone({ localPoint: [0.8, 0.7, 0], localNormal: [-1, 0, 0] }),
    'left',
  );
});
test('duplicate contact episodes do not stack damage and the dedup store remains bounded', () => {
  const damage = createVehicleDamage(),
    q = {
      localPoint: [0, 0, 2],
      impact: impact(query()),
      eventId: 'tree:1:episode:1',
    };
  applyVehicleDamage(damage, q);
  const once = structuredClone(damage);
  assert.equal(applyVehicleDamage(damage, q), null);
  assert.deepEqual(damage, once);
  for (let i = 0; i < 120; i++)
    applyVehicleDamage(damage, { ...q, eventId: `new:${i}` });
  assert.equal(
    damage.recentEventIds.length,
    VEHICLE_IMPACT_TUNING.recentEventLimit,
  );
  assert(damage.zones.front >= 0 && damage.zones.front <= 1);
  assert(damage.scratches.front >= 0 && damage.scratches.front <= 1);
  assert.equal(damage.zones.left, 0);
});
test('mechanical damage has bounded handling consequences and repair restores a pristine vehicle', () => {
  const damage = createVehicleDamage();
  assert.deepEqual(vehicleDamagePerformance(damage), {
    acceleration: 1,
    topSpeed: 1,
    steering: 1,
    braking: 1,
    steeringBias: 0,
  });
  for (const zone of ['front', 'rear', 'left', 'right', 'roof'])
    damage.zones[zone] = 1;
  const factors = vehicleDamagePerformance(damage);
  close(factors.acceleration, 0.55);
  close(factors.topSpeed, 0.65);
  close(factors.steering, 0.7);
  close(factors.braking, 0.85);
  damage.zones.left = 0;
  close(vehicleDamagePerformance(damage).steeringBias, -0.035);
  damage.recentEventIds.push('old');
  resetVehicleDamage(damage);
  assert.equal(damage.severity, 0);
  assert.equal(damage.lastHit, null);
  assert.deepEqual(damage.recentEventIds, []);
  assert.deepEqual(vehicleDamagePerformance(damage), {
    acceleration: 1,
    topSpeed: 1,
    steering: 1,
    braking: 1,
    steeringBias: 0,
  });
});
test('concrete barriers retain collision and dissipate more tangent motion than steel guardrails', () => {
  const steel = impact(
      query({
        velocity: [25, 0, 3],
        obstacle: { id: 'rail', kind: 'guardrail', material: 'steel' },
      }),
    ),
    concrete = impact(
      query({
        velocity: [25, 0, 3],
        obstacle: { id: 'wall', kind: 'guardrail', material: 'concrete' },
      }),
    );
  assert(concrete.velocity[0] < steel.velocity[0]);
  assert(concrete.absorbedEnergyJ > steel.absorbedEnergyJ);
  assert(!concrete.broken && !concrete.passThrough);
  assert(concrete.scrape > steel.scrape);
});
test('explicit game-strength overrides remain gated by object kind and breakaway', () => {
  const obstacle = {
      id: 'custom',
      kind: 'tree',
      diameterM: 1,
      breakWorkJ: 1000,
    },
    yielding = impact(query({ obstacle })),
    fixed = impact(query({ obstacle: { ...obstacle, breakaway: false } })),
    rail = impact(query({ obstacle: { ...obstacle, kind: 'guardrail' } }));
  assert(yielding.broken);
  close(yielding.breakWorkJ, 1000);
  assert(!fixed.broken && !rail.broken);
  assert(!impact(query({ obstacle: { ...obstacle, breakWorkJ: NaN } })).valid);
});
test('pure response does not mutate the caller and damage ignores tiny repeated resting bumps', () => {
  const q = query(),
    snapshot = structuredClone(q),
    result = impact(q);
  assert.deepEqual(q, snapshot);
  assert.deepEqual(impact(q), result);
  const damage = createVehicleDamage(),
    tiny = impact(query({ velocity: [0, 0, 0.1] }));
  for (let i = 0; i < 1000; i++)
    applyVehicleDamage(damage, { localPoint: [0, 0, 2], impact: tiny });
  assert.equal(damage.overall, 0);
  assert.equal(damage.revision, 0);
});

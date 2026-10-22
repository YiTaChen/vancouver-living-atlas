import assert from 'node:assert/strict';
import * as THREE from 'three';

/** Exercise production capsule walking, then drive it with the public touch
 * axes. Reading the local geometry builds a route; no passenger position,
 * anchor or ownership is injected into the runtime. */
export function walkBusTo(visit, matches, maxNodes = 12000) {
  assert.ok(visit.aboard && !visit.passengerSeated);
  const space = visit.space;
  const local = () =>
    visit.owner.interiorRoot
      .worldToLocal(new THREE.Vector3(...visit.interactionOrigin))
      .toArray();
  const start = local(),
    step = 0.12;
  const key = (p) =>
    `${Math.round(p[0] / step)}:${Math.round(p[1] / 0.08)}:${Math.round(p[2] / step)}`;
  const nodes = [{ point: start, parent: -1 }],
    seen = new Set([key(start)]);
  let found = -1;
  for (let cursor = 0; cursor < nodes.length && cursor < maxNodes; cursor++) {
    const point = nodes[cursor].point;
    if (matches(point, space)) {
      found = cursor;
      break;
    }
    for (const [x, z] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const next = space.walk(point, x * step, z * step),
        id = key(next);
      if (
        Math.hypot(next[0] - point[0], next[2] - point[2]) < 0.06 ||
        seen.has(id)
      )
        continue;
      seen.add(id);
      nodes.push({ point: next, parent: cursor });
    }
  }
  assert.ok(
    found >= 0,
    'requested cabin location must be physically reachable',
  );
  const path = [];
  for (let i = found; nodes[i].parent >= 0; i = nodes[i].parent)
    path.push(nodes[i].point);
  path.reverse();
  for (const target of path) {
    const point = local(),
      dx = target[0] - point[0],
      dz = target[2] - point[2];
    const desired = Math.atan2(dx, dz);
    let delta = Math.atan2(
      Math.sin(desired - visit.yaw),
      Math.cos(desired - visit.yaw),
    );
    while (Math.abs(delta) > 1e-7) {
      visit.setTouchAxes(-Math.sign(delta), 0);
      visit.update(Math.min(0.05, Math.abs(delta) / 1.65));
      delta = Math.atan2(
        Math.sin(desired - visit.yaw),
        Math.cos(desired - visit.yaw),
      );
    }
    let remaining = Math.hypot(dx, dz);
    while (remaining > 1e-7) {
      const dt = Math.min(0.05, remaining / 1.6);
      visit.setTouchAxes(0, 1);
      visit.update(dt);
      remaining -= dt * 1.6;
    }
    visit.clearInput();
    assert.ok(
      Math.hypot(local()[0] - target[0], local()[2] - target[2]) < 0.035,
      'physical controls must follow capsule-safe path',
    );
  }
  assert.ok(
    matches(local(), space),
    'physical controls must reach the interaction',
  );
  return local();
}

export function walkBusToSeat(visit, seatId) {
  return walkBusTo(visit, (point, space) => {
    const seat = space.seats.find((row) => row.id === seatId);
    return seat && space.canSit(seat, point);
  });
}

export function walkBusToRearDoor(visit) {
  const z = visit.doors.find((door) => door.group === 'rear').point[2];
  return walkBusTo(
    visit,
    (point) => Math.hypot(point[0] + 0.7, point[2] - z) < 0.9,
  );
}

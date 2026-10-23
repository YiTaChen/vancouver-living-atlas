import assert from 'node:assert/strict';
const distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
/** Route around actual columns, gates and open stairwells on a flat floor.
 * Every search edge uses the production capsule walker; replay the resulting
 * chain, including ownership checks. Vertical movement is never planned here. */
export function planFlat(o, initial, goal, check = () => {}) {
  const step = 0.3,
    key = (f) =>
      `${Math.round((f.position[0] - initial.position[0]) / step)},${Math.round((f.position[2] - initial.position[2]) / step)},${f.surfaceId}`;
  const queue = [
      {
        foot: initial,
        cost: 0,
        score: distance(initial.position, goal),
        parent: null,
      },
    ],
    best = new Map([[key(initial), 0]]);
  let iterations = 0;
  const straight = (from, to, verify = false) => {
    let foot = from;
    const dx = to[0] - from.position[0],
      dz = to[2] - from.position[2],
      n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
    for (let i = 0; i < n; i++) {
      const next = o.walk(foot, dx / n, dz / n);
      assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
      assert(o.isClearFoot(next));
      if (verify) check(next);
      foot = next;
    }
    return foot;
  };
  const direct = straight(initial, goal);
  if (
    distance(direct.position, goal) < 0.16 &&
    Math.abs(direct.position[1] - goal[1]) < 0.23
  )
    return [goal];
  if (process.env.STATION_WALK_DEBUG)
    console.log('Planning flat route', o.data.id, initial.position, goal, initial.surfaceId);
  while (queue.length && iterations++ < 20000) {
    queue.sort((a, b) => b.score - a.score);
    const node = queue.pop();
    if (distance(node.foot.position, goal) < 0.65) {
      const end = straight(node.foot, goal);
      if (
        distance(end.position, goal) < 0.16 &&
        Math.abs(end.position[1] - goal[1]) < 0.23
      ) {
        const chain = [];
        let p = node;
        while (p.parent) {
          chain.unshift(p.foot.position);
          p = p.parent;
        }
        return [...chain, goal];
      }
    }
    for (const [x, z] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const next = o.walk(node.foot, x * step, z * step);
      if (
        distance(next.position, [
          node.foot.position[0] + x * step,
          next.position[1],
          node.foot.position[2] + z * step,
        ]) > 0.015 ||
        Math.abs(next.position[1] - initial.position[1]) > 0.025
      )
        continue;
      try {
        check(next);
      } catch {
        continue;
      }
      const k = key(next),
        cost = node.cost + Math.hypot(x * step, z * step);
      if (cost >= (best.get(k) ?? Infinity)) continue;
      best.set(k, cost);
      queue.push({
        foot: next,
        cost,
        score: cost + distance(next.position, goal),
        parent: node,
      });
    }
  }
  assert.fail(
    `${o.data.id}: no supported flat path from ${initial.position} to ${goal}`,
  );
}

export function walkFlat(o, initial, goal, check = () => {}) {
  const chain = planFlat(o, initial, goal, check);
  let foot = initial;
  for (const target of chain) {
    const dx = target[0] - foot.position[0],
      dz = target[2] - foot.position[2],
      steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.06));
    for (let i = 0; i < steps; i++) {
      const next = o.walk(foot, dx / steps, dz / steps);
      assert(Math.abs(next.position[1] - foot.position[1]) <= 0.221);
      assert(o.isClearFoot(next));
      check(next);
      foot = next;
    }
  }
  return foot;
}

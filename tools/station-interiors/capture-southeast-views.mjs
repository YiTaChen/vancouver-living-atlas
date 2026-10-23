import {
  captureStationEntrances,
  captureStationLifts,
} from './capture-station-access.mjs';

/** Every eye position is attached to an existing capsule-supported floor. */
async function floorView(
  page,
  snapshot,
  floorId,
  label,
  { targetFloor, targetPartPrefix, direction = [0, 0, 1] } = {},
) {
  await page.evaluate(
    ({ floorId, targetFloor, targetPartPrefix, direction }) => {
      const travel = window.__atlas.skyTrainTravel,
        owner = travel.owner,
        floor = owner.geometryData.floors.find((f) => f.id === floorId);
      if (!floor) throw new Error(`Missing maintained floor ${floorId}`);
      const center = (vertices) =>
          vertices.reduce(
            (sum, p) => sum.map((v, a) => v + p[a] / vertices.length),
            [0, 0, 0],
          ),
        desired = center(floor.vertices),
        candidates = [desired];
      for (let i = 0; i < floor.indices.length; i += 3) {
        const triangle = floor.indices
          .slice(i, i + 3)
          .map((n) => floor.vertices[n]);
        for (const weights of [
          [1 / 3, 1 / 3, 1 / 3],
          [0.6, 0.2, 0.2],
          [0.2, 0.6, 0.2],
          [0.2, 0.2, 0.6],
        ])
          candidates.push(
            [0, 1, 2].map((axis) =>
              weights.reduce((sum, w, k) => sum + w * triangle[k][axis], 0),
            ),
          );
      }
      const feet = candidates
        .map((p) => owner.floorAt(p, floorId))
        .filter((p) => p && owner.isClearFoot(p));
      feet.sort(
        (a, b) =>
          Math.hypot(...a.position.map((v, axis) => v - desired[axis])) -
          Math.hypot(...b.position.map((v, axis) => v - desired[axis])),
      );
      if (!feet.length)
        throw new Error(`No real clear viewpoint on ${floorId}`);
      travel.foot = feet[0];
      let target = travel.foot.position.map((v, axis) => v + direction[axis]);
      if (targetFloor) {
        const f = owner.geometryData.floors.find((f) => f.id === targetFloor);
        if (!f) throw new Error(`Missing view target ${targetFloor}`);
        target = center(f.vertices);
        target[1] += 1.65;
      }
      if (targetPartPrefix) {
        const parts = owner.geometryData.parts.filter((p) =>
          p.id.startsWith(targetPartPrefix),
        );
        if (!parts.length)
          throw new Error(`Missing actual fixture ${targetPartPrefix}`);
        target = center(parts.map((p) => p.position));
      }
      const dx = target[0] - travel.foot.position[0],
        dz = target[2] - travel.foot.position[2];
      travel.yaw = Math.atan2(dx, dz);
      travel.lookYaw = 0;
      travel.pitch =
        targetFloor || targetPartPrefix
          ? Math.atan2(
              target[1] - travel.foot.position[1] - 1.65,
              Math.hypot(dx, dz),
            )
          : -0.05;
      travel.distanceView = 0;
      travel.updateCamera();
    },
    { floorId, targetFloor, targetPartPrefix, direction },
  );
  await snapshot(`${label}-firstperson`);
  await page.evaluate(() => {
    const travel = window.__atlas.skyTrainTravel;
    travel.distanceView = 7;
    travel.pitch = -0.45;
    travel.updateCamera();
  });
  await snapshot(`${label}-thirdperson`);
}

async function flightView(page, snapshot, id) {
  await page.evaluate((id) => {
    const travel = window.__atlas.skyTrainTravel,
      owner = travel.owner,
      c = owner.geometryData.connections.find((c) => c.id === id);
    if (!c?.treads.length) throw new Error(`Missing real flight ${id}`);
    const index = Math.floor(c.treads.length / 2),
      tread = c.treads[index],
      p = tread.vertices.reduce(
        (sum, v) => sum.map((n, axis) => n + v[axis] / tread.vertices.length),
        [0, 0, 0],
      ),
      foot = owner.floorAt(p, `${id}:step:${index}`),
      low = c.start[1] < c.end[1] ? c.start : c.end;
    if (!foot || !owner.isClearFoot(foot))
      throw new Error(`No clear tread eye on ${id}`);
    travel.foot = foot;
    travel.lookYaw = 0;
    travel.distanceView = 0;
    travel.yaw = Math.atan2(low[0] - p[0], low[2] - p[2]);
    travel.pitch =
      Math.atan2(low[1] - p[1], Math.hypot(low[0] - p[0], low[2] - p[2])) -
      0.08;
    travel.updateCamera();
  }, id);
  await snapshot(`${id}-firstperson`);
  await page.evaluate(() => {
    const travel = window.__atlas.skyTrainTravel;
    travel.distanceView = 8;
    travel.pitch = -0.8;
    travel.updateCamera();
  });
  await snapshot(`${id}-overhead-thirdperson`);
}

async function bankView(page, snapshot, ids, label) {
  const bank = await page.evaluate((ids) => {
    const travel = window.__atlas.skyTrainTravel,
      owner = travel.owner,
      lanes = ids.map((id) =>
        owner.geometryData.connections.find((c) => c.id === id),
      );
    if (lanes.some((c) => c?.type !== 'escalator'))
      throw new Error('Missing maintained escalator lanes');
    const tops = lanes.map((c) =>
        c.start[1] > c.end[1]
          ? { point: c.start, floor: c.from, low: c.end }
          : { point: c.end, floor: c.to, low: c.start },
      ),
      top = tops[0],
      dx = top.low[0] - top.point[0],
      dz = top.low[2] - top.point[2],
      length = Math.hypot(dx, dz),
      center = [0, 1, 2].map((axis) =>
        tops.reduce((sum, v) => sum + v.point[axis] / tops.length, 0),
      ),
      p = [
        center[0] - (dx / length) * 1.6,
        center[1],
        center[2] - (dz / length) * 1.6,
      ],
      foot = owner.floorAt(p, top.floor);
    if (!foot || !owner.isClearFoot(foot))
      throw new Error(`No real upper landing supports bank view ${ids}`);
    travel.foot = foot;
    travel.yaw = Math.atan2(dx, dz);
    travel.lookYaw = 0;
    travel.distanceView = 0;
    travel.pitch = Math.atan2(top.low[1] - top.point[1], length) - 0.12;
    travel.updateCamera();
    return {
      laneIds: ids,
      from: lanes.map((c) => c.from),
      to: lanes.map((c) => c.to),
      foot,
    };
  }, ids);
  await snapshot(label);
  return bank;
}

/** Small flat-floor detours are planned with the production capsule. Every
 * resulting segment is replayed by native touch walking; vertical segments
 * always follow the actual authored stair/escalator graph. */
async function nativeKeeferReturn(page, report) {
  report.keeferPassageReturn = await page.evaluate(() => {
    const travel = window.__atlas.skyTrainTravel,
      owner = travel.owner,
      entry = owner.streetEntrances().find((e) => e.id.includes('keefer')),
      route = owner.streetRoutes().find((r) => r.entranceId === entry?.id),
      target = 'stadium-main-concourse';
    if (!entry || !route)
      throw new Error('Missing real Keefer raised approach route');
    travel.foot = owner.tryEnterFromStreet(entry.inward);
    if (!travel.foot) throw new Error('No supported Keefer street handoff');
    const initial = structuredClone(travel.foot),
      visited = [initial.position],
      distance = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
    let maxStep = 0,
      frames = 0;
    const simulate = (start, goal) => {
      const n = Math.max(1, Math.ceil(distance(start.position, goal) / 0.06));
      const dx = (goal[0] - start.position[0]) / n,
        dz = (goal[2] - start.position[2]) / n;
      let foot = start;
      for (let i = 0; i < n; i++) foot = owner.walk(foot, dx, dz);
      return foot;
    };
    const plan = (start, goal) => {
      const direct = simulate(start, goal);
      if (distance(direct.position, goal) < 0.12) return [goal];
      if (Math.abs(goal[1] - start.position[1]) > 0.22)
        throw new Error('Actual vertical Keefer flight is blocked');
      const step = 0.3,
        queue = [
          {
            foot: start,
            cost: 0,
            score: distance(start.position, goal),
            parent: null,
          },
        ],
        best = new Map();
      for (let count = 0; queue.length && count < 14000; count++) {
        queue.sort((a, b) => b.score - a.score);
        const node = queue.pop();
        if (
          distance(node.foot.position, goal) < 0.7 &&
          distance(simulate(node.foot, goal).position, goal) < 0.12
        ) {
          const path = [goal];
          let p = node;
          while (p.parent) {
            path.unshift(p.foot.position);
            p = p.parent;
          }
          return path;
        }
        for (const [x, z] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]) {
          const next = owner.walk(node.foot, x * step, z * step);
          if (
            Math.abs(next.position[1] - start.position[1]) > 0.22 ||
            distance(next.position, node.foot.position) < 0.2 ||
            !owner.isClearFoot(next)
          )
            continue;
          const key = `${Math.round((next.position[0] - start.position[0]) / step)},${Math.round((next.position[2] - start.position[2]) / step)},${next.surfaceId}`,
            cost = node.cost + distance(node.foot.position, next.position);
          if ((best.get(key) ?? Infinity) <= cost) continue;
          best.set(key, cost);
          queue.push({
            foot: next,
            cost,
            score: cost + distance(next.position, goal),
            parent: node,
          });
        }
      }
      throw new Error('No actual clear flat Keefer detour');
    };
    const walk = (goal) => {
      for (const waypoint of plan(travel.foot, goal)) {
        for (
          let i = 0;
          i < 5000 && distance(travel.foot.position, waypoint) > 0.035;
          i++
        ) {
          const old = travel.foot,
            dx = waypoint[0] - old.position[0],
            dz = waypoint[2] - old.position[2];
          travel.yaw = Math.atan2(dx, dz);
          travel.lookYaw = 0;
          travel.setTouchAxes(0, 1);
          travel.update(Math.min(0.02, Math.hypot(dx, dz) / 2.5));
          frames++;
          if (!travel.active || !owner.isClearFoot(travel.foot))
            throw new Error('Keefer native route lost floor ownership');
          maxStep = Math.max(
            maxStep,
            Math.abs(travel.foot.position[1] - old.position[1]),
          );
          if (maxStep > 0.221)
            throw new Error('Keefer route exceeded true native riser limit');
          if (distance(old.position, travel.foot.position) < 0.001)
            throw new Error('Keefer native waypoint is obstructed');
        }
        if (distance(travel.foot.position, waypoint) > 0.08)
          throw new Error('Keefer native waypoint was not reached');
      }
      travel.clearInput();
    };
    for (const point of route.points) {
      walk(point);
      visited.push([...travel.foot.position]);
      if (travel.foot.surfaceId === target) break;
    }
    if (travel.foot.surfaceId !== target)
      throw new Error('Keefer passage never reaches the real concourse');
    for (const point of visited.toReversed().slice(1)) walk(point);
    return {
      entryId: entry.id,
      reachedConcourse: true,
      returned: distance(travel.foot.position, initial.position) < 0.08,
      frames,
      maxStep,
    };
  });
  if (!report.keeferPassageReturn.returned)
    throw new Error(
      'Keefer actual native return did not reach the original handoff',
    );
}

export async function captureSoutheastStation(
  page,
  snapshot,
  report,
  stationId,
) {
  await captureStationEntrances(page, snapshot, report, stationId);
  await captureStationLifts(page, snapshot, report);
  if (stationId === 'stadium-chinatown') {
    await nativeKeeferReturn(page, report);
    await floorView(
      page,
      snapshot,
      'stadium-main-concourse',
      'ticket-concourse',
      { targetFloor: 'stadium-west-platform-approach' },
    );
    await floorView(page, snapshot, 'stadium-expo', 'daylight-island', {
      direction: [0, 0, 1],
    });
    await floorView(
      page,
      snapshot,
      'stadium-expo',
      'west-spare-platform-fence',
      { targetPartPrefix: 'stadium-spare-fence-' },
    );
    await floorView(
      page,
      snapshot,
      'stadium-keefer-entry',
      'keefer-raised-passage',
      { targetFloor: 'stadium-main-concourse' },
    );
    for (const id of [
      'stadium-beatty-main-stair',
      'stadium-concourse-island-stair',
      'stadium-expo-east-upper-stair',
      'stadium-expo-east-lower-stair',
    ])
      await flightView(page, snapshot, id);
    const raised = await page.evaluate(() =>
      window.__atlas.skyTrainTravel.owner.geometryData.connections
        .filter((c) => c.treads.length && c.id.includes('keefer'))
        .map((c) => c.id),
    );
    if (!raised.length)
      throw new Error('Missing actual raised Keefer street stairs');
    for (const id of raised) await flightView(page, snapshot, id);
  } else {
    if (report.liftCores.length !== 2)
      throw new Error(
        'Yaletown must retain two physically separate lift cores',
      );
    await floorView(page, snapshot, 'yaletown-unpaid-concourse', '2026-gates', {
      targetPartPrefix: 'yaletown-2026-fare-gate-',
    });
    await floorView(
      page,
      snapshot,
      'yaletown-paid-rear-landing',
      'long-lower-concourse',
      { targetFloor: 'yaletown-paid-north-landing' },
    );
    await floorView(page, snapshot, 'yaletown-canada', 'island-platform', {
      direction: [0, 0, 1],
    });
    for (const id of [
      'yaletown-upper-entry-stair',
      'yaletown-lower-entry-stair',
      'yaletown-platform-stair',
    ])
      await flightView(page, snapshot, id);
    report.escalatorBanks = [
      await bankView(
        page,
        snapshot,
        ['yaletown-platform-up-escalator', 'yaletown-platform-added-escalator'],
        'separate-two-escalator-bank-from-top',
      ),
    ];
  }
}

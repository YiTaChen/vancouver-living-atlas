/** Shared full-city doorway and lift evidence. Independent viewpoints start
 * on existing supported floors; all reported transitions use native controls. */
export async function captureStationEntrances(
  page,
  snapshot,
  report,
  stationId,
) {
  report.entryTransitions = [];
  const entries = await page.evaluate(() =>
    window.__atlas.skyTrainTravel.owner
      .streetEntrances()
      .map((entry) => entry.id),
  );
  for (const entryId of entries) {
    const transition = await page.evaluate(
      async ({ stationId, entryId }) => {
        const engine = window.__atlas,
          travel = engine.skyTrainTravel,
          owner = travel.stations.get(stationId),
          entry = owner.streetEntrances().find((item) => item.id === entryId),
          nav = engine.navigation;
        const accepted =
          owner.tryEnterFromStreet(entry.inward) ??
          owner.tryEnterFromStreet(entry.threshold);
        if (!accepted || !owner.isClearFoot(accepted))
          throw new Error(`No real supported street handoff: ${entryId}`);
        // Select this real doorway as the independent entrance test's start.
        if (travel.active) {
          travel.foot = accepted;
          if (!travel.foot || !owner.isClearFoot(travel.foot))
            throw new Error(`No supported entrance setup: ${entryId}`);
        } else {
          nav.position.fromArray(owner.toWorld(accepted));
          nav.mode = 'walk';
          nav.yaw = owner.yaw;
          nav.pitch = 0;
          if (!(await travel.enter(stationId)))
            throw new Error(`Actual street entrance refused: ${entryId}`);
        }
        travel.distanceView = 4;
        travel.pitch = -0.2;
        travel.lookYaw = 0;
        const heading = Math.atan2(
          -entry.localDirection[0],
          -entry.localDirection[2],
        );
        for (let count = 0; count < 100; count++) {
          const turn = Math.atan2(
            Math.sin(heading - travel.yaw),
            Math.cos(heading - travel.yaw),
          );
          if (Math.abs(turn) < 1e-6) break;
          travel.setTouchAxes(-Math.sign(turn), 0);
          travel.update(Math.min(0.1, Math.abs(turn) / 1.65));
        }
        let walked = 0,
          maxStep = 0;
        travel.setTouchAxes(0, 1);
        for (let count = 0; count < 50 && travel.active; count++) {
          const previous = [...travel.foot.position];
          travel.update(0.1);
          const next = travel.foot?.position;
          if (next) {
            walked += Math.hypot(next[0] - previous[0], next[2] - previous[2]);
            maxStep = Math.max(maxStep, Math.abs(next[1] - previous[1]));
            if (!owner.isClearFoot(travel.foot))
              throw new Error(`Unsupported exit step: ${entryId}`);
          }
        }
        const left = !travel.active && nav.mode === 'walk';
        travel.clearInput();
        nav.blur();
        return {
          entryId,
          left,
          walked,
          maxStep,
          outside: nav.position.toArray(),
        };
      },
      { stationId, entryId },
    );
    if (!transition.left)
      throw new Error(`Native walking did not leave ${entryId}`);
    await snapshot(`entrance-${entryId}-outside-thirdperson`);
    transition.reentry = await page.evaluate(
      ({ stationId, entryId }) => {
        const engine = window.__atlas,
          travel = engine.skyTrainTravel,
          owner = travel.stations.get(stationId),
          entry = owner.streetEntrances().find((item) => item.id === entryId),
          nav = engine.navigation;
        // Continue from the real outside exit. Native city navigation crosses
        // the sampled apron and automatic proximity transfers ownership before
        // the mapped stairhead; never inject a lower station floor as city Y.
        const start = nav.position.toArray(),
          direction = owner.group
            .localToWorld(
              owner.group.position.clone().set(...entry.localDirection),
            )
            .sub(owner.group.position);
        nav.blur();
        nav.yaw = Math.atan2(direction.x, direction.z);
        nav.pitch = 0;
        nav.setTouchAxes(0, 1);
        let steps = 0;
        while (!travel.active && steps++ < 100) {
          nav.update(0.05);
          travel.update(0.05);
        }
        const entered = travel.active && travel.station === stationId;
        nav.blur();
        travel.clearInput();
        travel.distanceView = 4;
        travel.pitch = -0.2;
        if (entered) travel.updateCamera();
        return {
          entered,
          steps,
          start,
          position: nav.position.toArray(),
          walkingHeight: nav.walkingHeight(),
          stationFoot: travel.foot,
        };
      },
      { stationId, entryId },
    );
    transition.entered = transition.reentry.entered;
    report.entryTransitions.push(transition);
    if (!transition.entered)
      throw new Error(`Actual street entrance refused: ${entryId}`);
    await snapshot(`entrance-${entryId}-inside-thirdperson`);
  }
}

async function faceLiftLanding(page) {
  await page.evaluate(() => {
    const travel = window.__atlas.skyTrainTravel,
      foot = travel.foot.position,
      leaves = travel.owner.geometryData.parts.filter(
        (p) =>
          p.role === 'lift-door' &&
          p.size[1] >= 2 &&
          Math.abs(p.position[1] - foot[1] - 1.1) < 0.2 &&
          Math.hypot(p.position[0] - foot[0], p.position[2] - foot[2]) < 1.8,
      );
    if (leaves.length !== 2)
      throw new Error('Landing capture needs two real open lift leaves');
    const dx = (leaves[0].position[0] + leaves[1].position[0]) / 2 - foot[0],
      dz = (leaves[0].position[2] + leaves[1].position[2]) / 2 - foot[2];
    travel.yaw = Math.atan2(dx, dz);
    travel.lookYaw = 0;
    travel.pitch = -0.05;
    travel.distanceView = 0;
    travel.updateCamera();
  });
}

export async function captureStationLifts(page, snapshot, report) {
  report.liftTrips = [];
  report.liftCores = await page.evaluate(() => {
    const owner = window.__atlas.skyTrainTravel.owner,
      groups = new Map();
    for (const c of owner.geometryData.connections.filter(
      (c) => c.type === 'elevator',
    )) {
      if (Math.hypot(c.start[0] - c.end[0], c.start[2] - c.end[2]) > 0.1)
        throw new Error(`Nonvertical lift ${c.id}`);
      const key = `${c.start[0].toFixed(3)},${c.start[2].toFixed(3)}`;
      const group = groups.get(key) ?? [];
      group.push(c);
      groups.set(key, group);
    }
    return [...groups.values()].map((connections, index) => {
      const endpoints = connections.flatMap((c) => [
          { surfaceId: c.from, position: c.start },
          { surfaceId: c.to, position: c.end },
        ]),
        initial = endpoints.toSorted(
          (a, b) => b.position[1] - a.position[1],
        )[0],
        visited = new Set(),
        trips = [];
      const visit = (floor) => {
        for (const c of connections) {
          if (visited.has(c.id) || ![c.from, c.to].includes(floor)) continue;
          visited.add(c.id);
          const reverse = c.to === floor;
          trips.push({ id: c.id, reverse });
          visit(reverse ? c.from : c.to);
          trips.push({ id: c.id, reverse: !reverse });
        }
      };
      visit(initial.surfaceId);
      if (visited.size !== connections.length)
        throw new Error('Disconnected lift connections in one core');
      return {
        id: `core-${index + 1}`,
        initial,
        trips,
        lowestY: Math.min(...endpoints.map((e) => e.position[1])),
        connectionIds: connections.map((c) => c.id),
      };
    });
  });
  if (!report.liftCores.length)
    throw new Error('Missing actual authored lift graph');
  for (const core of report.liftCores) {
    const label =
      report.liftCores.length === 1 ? 'elevator' : `elevator-${core.id}`;
    await page.evaluate((initial) => {
      const travel = window.__atlas.skyTrainTravel;
      travel.foot = travel.owner.floorAt(initial.position, initial.surfaceId);
      if (!travel.foot || !travel.owner.isClearFoot(travel.foot))
        throw new Error('Unsupported initial lift cabin');
    }, core.initial);
    let capturedLowest = false;
    for (const [index, trip] of core.trips.entries()) {
      const before = await page.evaluate(({ id, reverse }) => {
        const engine = window.__atlas,
          travel = engine.skyTrainTravel,
          owner = travel.owner,
          connection = owner.geometryData.connections.find((c) => c.id === id),
          destination = reverse ? connection.start : connection.end,
          candidateId = `skytrain:elevator:${owner.data.id}:${id}:${reverse ? 'return' : 'forward'}`,
          find = () =>
            travel.interactionCandidates().find((c) => c.id === candidateId);
        let candidate = find();
        if (!candidate)
          throw new Error(`Actual lift prompt unavailable: ${candidateId}`);
        const button = owner.toLocal(candidate.proximityPoint);
        for (let count = 0; count < 30; count++) {
          const dx = button[0] - travel.foot.position[0],
            dz = button[2] - travel.foot.position[2],
            d = Math.hypot(dx, dz);
          if (d < 0.025) break;
          travel.yaw = Math.atan2(dx, dz);
          travel.lookYaw = 0;
          travel.setTouchAxes(0, 1);
          travel.update(Math.min(0.05, d / 2.5));
        }
        travel.clearInput();
        candidate = find();
        if (!candidate)
          throw new Error(
            `Native walking lost the actual lift prompt: ${candidateId}`,
          );
        const anchor = owner.toLocal(candidate.anchor),
          foot = travel.foot.position;
        travel.yaw = Math.atan2(anchor[0] - foot[0], anchor[2] - foot[2]);
        travel.lookYaw = 0;
        travel.pitch = 0;
        travel.distanceView = 0;
        travel.updateCamera();
        engine.interactions.clear();
        engine.interactions.update(performance.now(), true);
        const prompt = engine.interactions.controller.snapshot();
        if (prompt?.id !== candidateId)
          throw new Error(
            `Actual camera cannot see lift prompt: ${candidateId}`,
          );
        return {
          id,
          candidateId,
          action: candidate.action,
          from: [...foot],
          destination: [...destination],
          prompt,
        };
      }, trip);
      if (index === 0) await snapshot(`${label}-call-firstperson`);
      await page.keyboard.press('f');
      const result = await page.evaluate((before) => {
        const travel = window.__atlas.skyTrainTravel,
          owner = travel.owner,
          arrived =
            Math.hypot(
              ...travel.foot.position.map(
                (v, axis) => v - before.destination[axis],
              ),
            ) < 0.01;
        if (!arrived || !owner.isClearFoot(travel.foot))
          throw new Error(`Native F did not complete lift trip: ${before.id}`);
        return {
          ...before,
          arrived,
          to: [...travel.foot.position],
          surfaceId: travel.foot.surfaceId,
          direction: travel.direction,
        };
      }, before);
      report.liftTrips.push({ core: core.id, ...result });
      if (!capturedLowest && Math.abs(result.to[1] - core.lowestY) < 0.01) {
        await faceLiftLanding(page);
        await snapshot(`${label}-lowest-landing-firstperson`);
        capturedLowest = true;
      }
    }
    await faceLiftLanding(page);
    await snapshot(`${label}-returned-to-entry-level-firstperson`);
  }
}

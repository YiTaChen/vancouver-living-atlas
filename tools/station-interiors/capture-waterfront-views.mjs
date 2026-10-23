import {
  captureStationEntrances,
  captureStationLifts,
} from './capture-station-access.mjs';

/** Maintained phase4 IDs, rather than the superseded generic Waterfront rooms.
 * These are independent inspect viewpoints; native street/lift transitions are
 * captured separately by the shared full-game helpers below. */
export const WATERFRONT_VIEWPOINTS = [
  {
    kind: 'floor',
    label: 'cordova-true-northeast-doorway-into-heritage-nave',
    floorId: 'waterfront-heritage-entry-vestibule',
    anchorEntrance: 'cordova-lobby',
    advance: 1.4,
    lookAlongEntrance: 'cordova-lobby',
    maximumDrift: 0.3,
  },
  {
    kind: 'floor',
    label: 'heritage-nave-left-northwest-canada-line-direction',
    floorId: 'waterfront-heritage-hall',
    anchorEntrance: 'cordova-lobby',
    advance: 8,
    targetConnection: 'waterfront-canada-lobby-stairs',
    maximumDrift: 1,
    thirdpersonDistance: 14,
    thirdpersonPitch: -0.3,
  },
  {
    kind: 'floor',
    label: 'heritage-nave-retained-columns-and-high-ceiling',
    floorId: 'waterfront-heritage-hall',
    anchorEntrance: 'cordova-lobby',
    advance: 14,
    leftOffset: -22,
    targetFloor: 'waterfront-heritage-entry-vestibule',
    maximumDrift: 1,
    thirdpersonDistance: 14,
    thirdpersonPitch: -0.3,
  },
  {
    kind: 'floor',
    label: 'heritage-rear-covered-vestibule-to-expo-annex',
    floorId: 'waterfront-heritage-expo-vestibule-0',
    targetFloor: 'waterfront-expo-paid-annex',
  },
  {
    kind: 'floor',
    label: 'heritage-rear-covered-grade-to-retained-seabus-skywalk',
    floorId: 'waterfront-seabus-heritage-connector-0',
    targetFloor: 'waterfront-seabus-heritage-connector-1',
  },
  {
    kind: 'floor',
    label: 'heritage-expo-annex-toward-east-fares',
    floorId: 'waterfront-expo-paid-annex',
    offset: [-0.8, 0, -2.9],
    targetPartPrefix: 'waterfront-expo-fares-',
  },
  {
    kind: 'floor',
    label: 'expo-upper-lift-clear-apron-beside-paid-fares',
    floorId: 'waterfront-expo-paid-annex',
    offset: [1.8, 0, 0.6],
    targetConnection: 'waterfront-expo-lift',
  },
  {
    kind: 'bank',
    label: 'heritage-east-stair-and-two-escalators',
    connections: [
      'waterfront-expo-platform-stairs',
      'waterfront-expo-platform-up',
      'waterfront-expo-platform-down',
    ],
    escalators: 2,
    retreat: 1.4,
  },
  {
    kind: 'bank',
    label: 'howe-upper-central-stair-and-two-escalators',
    connections: [
      'waterfront-howe-upper-stairs',
      'waterfront-howe-upper-up',
      'waterfront-howe-upper-down',
    ],
    escalators: 2,
    retreat: 1.1,
  },
  {
    kind: 'floor',
    label: 'howe-low-ceiling-junction-and-left-mall-branch',
    floorId: 'waterfront-howe-middle-junction',
    targetFloor: 'waterfront-howe-mall-vestibule-0',
  },
  {
    kind: 'floor',
    label: 'howe-unpaid-mall-side-five-gate-boundary',
    floorId: 'waterfront-howe-middle-north-0',
    targetPartPrefix: 'waterfront-howe-fares-reader-',
  },
  {
    kind: 'floor',
    label: 'howe-paid-platform-side-five-gate-boundary',
    floorId: 'waterfront-howe-paid-hall-0',
    targetPartPrefix: 'waterfront-howe-fares-reader-',
  },
  {
    kind: 'bank',
    label: 'howe-lower-stair-and-single-escalator',
    connections: [
      'waterfront-howe-lower-stairs',
      'waterfront-howe-lower-escalator',
    ],
    escalators: 1,
    retreat: 1.2,
  },
  {
    kind: 'floor',
    label: 'howe-29m-platform-tunnel-toward-island',
    floorId: 'waterfront-howe-platform-tunnel-0',
    offset: [0, 0, 9],
    targetFloor: 'waterfront-expo-west-landing',
    thirdpersonPitch: -0.15,
  },
  {
    kind: 'floor',
    label: 'howe-29m-platform-tunnel-return-to-lower-bank',
    floorId: 'waterfront-howe-platform-tunnel-0',
    offset: [0, 0, -9],
    targetConnection: 'waterfront-howe-lower-stairs',
    thirdpersonPitch: -0.15,
  },
  {
    kind: 'floor',
    label: 'expo-island-east-track-walkway',
    floorId: 'waterfront-expo',
    offset: [2.65, 0, -18],
    direction: [0, 0, 1],
  },
  {
    kind: 'floor',
    label: 'expo-island-west-track-walkway',
    floorId: 'waterfront-expo',
    offset: [-2.65, 0, 18],
    direction: [0, 0, -1],
  },
  {
    kind: 'bank',
    label: 'granville-42-riser-stair-and-escalator',
    connections: ['waterfront-granville-stairs', 'waterfront-granville-up'],
    escalators: 1,
    retreat: 1.1,
  },
  {
    kind: 'floor',
    label: 'granville-independent-public-street-lift',
    floorId: 'waterfront-granville-lift-street',
    targetConnection: 'waterfront-granville-street-lift',
    offset: [0, 0, 1.15],
  },
  {
    kind: 'floor',
    label: 'granville-lift-and-stair-shared-concourse',
    floorId: 'waterfront-granville-concourse-arrival',
    targetFloor: 'waterfront-granville-lift-concourse',
    offset: [0.8, 0, -0.6],
  },
  {
    kind: 'floor',
    label: 'canada-granville-paid-concourse',
    floorId: 'waterfront-canada-south-approach-0',
    targetPartPrefix: 'waterfront-canada-south-fares-',
    offset: [1.2, 0, -1],
  },
  {
    kind: 'bank',
    label: 'canada-granville-24-riser-platform-bank',
    connections: [
      'waterfront-canada-south-stairs',
      'waterfront-canada-south-up',
    ],
    escalators: 1,
    retreat: 1.1,
  },
  {
    kind: 'floor',
    label: 'heritage-canada-initial-descent',
    floorId: 'waterfront-canada-lobby-stairs-upper-landing',
    targetConnection: 'waterfront-canada-lobby-stairs',
  },
  ...[0, 1, 2].map((index) => ({
    kind: 'floor',
    label: `under-cordova-graded-passage-${index + 1}-of-three`,
    floorId: `waterfront-under-cordova-passage-${index}`,
    targetFloor: `waterfront-under-cordova-passage-${index + 1}`,
  })),
  {
    kind: 'floor',
    label: 'canada-cordova-north-concourse',
    floorId: 'waterfront-canada-north-concourse',
    targetPartPrefix: 'waterfront-canada-north-fares-',
    offset: [-4.7, 0, -1.1],
  },
  {
    kind: 'bank',
    label: 'canada-north-24-riser-platform-bank',
    connections: [
      'waterfront-canada-north-stairs',
      'waterfront-canada-north-up',
      'waterfront-canada-north-down',
    ],
    escalators: 2,
    retreat: 1.1,
  },
  {
    kind: 'floor',
    label: 'canada-island-granville-direction',
    floorId: 'waterfront-canada',
    offset: [0, 0, 2.3],
    targetFloor: 'waterfront-canada-south-concourse',
    levelLook: true,
  },
  {
    kind: 'floor',
    label: 'canada-island-cordova-direction',
    floorId: 'waterfront-canada',
    offset: [0, 0, -2.3],
    targetFloor: 'waterfront-canada-north-concourse',
    levelLook: true,
  },
  ...[
    'waterfront-expo-platform-stairs',
    'waterfront-expo-platform-up',
    'waterfront-expo-platform-down',
    'waterfront-howe-upper-stairs',
    'waterfront-howe-upper-up',
    'waterfront-howe-upper-down',
    'waterfront-howe-lower-stairs',
    'waterfront-howe-lower-escalator',
    'waterfront-granville-stairs',
    'waterfront-granville-up',
    'waterfront-canada-south-stairs',
    'waterfront-canada-south-up',
    'waterfront-canada-north-stairs',
    'waterfront-canada-north-up',
    'waterfront-canada-north-down',
    'waterfront-canada-lobby-stairs',
    'waterfront-canada-lobby-up',
    'waterfront-canada-lobby-down',
  ].map((connectionId) => ({
    kind: 'flight',
    label: connectionId,
    connectionId,
  })),
];

/** Inspect framing uses the same requested chase pose as normal player input.
 * A wide hall needs enough context to include actual columns and branch doors;
 * the default downward close view otherwise contains only its central floor. */
export function waterfrontThirdPersonSettings(spec) {
  const distanceView =
      spec.thirdpersonDistance ?? (spec.kind === 'flight' ? 8 : 7),
    pitch = spec.thirdpersonPitch ?? (spec.kind === 'flight' ? -0.8 : -0.45);
  if (
    !Number.isFinite(distanceView) ||
    distanceView < 2 ||
    distanceView > 14 ||
    !Number.isFinite(pitch) ||
    pitch < -1.1 ||
    pitch > 0.22
  )
    throw new Error(`Invalid maintained third-person framing: ${spec.label}`);
  return { distanceView, pitch };
}

/** Self-contained so Playwright can serialize this same resolver into the
 * page. Supplying an owner runs identical support/clearance QA in Node, without
 * a browser, camera, native transition or generated public packet. */
export function prepareWaterfrontViewpoint(spec, suppliedOwner) {
  const travel = suppliedOwner ? null : window.__atlas.skyTrainTravel,
    owner = suppliedOwner ?? travel.owner,
    data = owner.geometryData,
    mean = (points) =>
      points.reduce(
        (sum, p) => sum.map((v, i) => v + p[i] / points.length),
        [0, 0, 0],
      ),
    findFloor = (id) => {
      const f = data.floors.find((f) => f.id === id);
      if (!f) throw new Error(`Missing phase4 Waterfront floor: ${id}`);
      return f;
    },
    findEntrance = (id) => {
      const entrance = data.entrances.find((entry) => entry.id === id);
      if (!entrance?.inwardDirection)
        throw new Error(`Missing mapped entrance direction: ${id}`);
      return entrance;
    },
    findConnection = (id) => {
      const c = data.connections.find((c) => c.id === id);
      if (!c) throw new Error(`Missing phase4 Waterfront connection: ${id}`);
      return c;
    },
    supported = (id, desired, maximumDrift = 2.5) => {
      const f = findFloor(id),
        candidates = [desired];
      for (const dx of [0, -0.3, 0.3, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8])
        for (const dz of [0, -0.3, 0.3, -0.6, 0.6, -1.2, 1.2, -1.8, 1.8])
          if (Math.hypot(dx, dz) <= maximumDrift)
            candidates.push([desired[0] + dx, desired[1], desired[2] + dz]);
      for (let i = 0; i < f.indices.length; i += 3) {
        const triangle = f.indices.slice(i, i + 3).map((n) => f.vertices[n]);
        candidates.push(mean(triangle));
      }
      const feet = candidates
        .map((p) => owner.floorAt(p, id))
        .filter(
          (foot) =>
            foot &&
            owner.isClearFoot(foot) &&
            Math.hypot(
              foot.position[0] - desired[0],
              foot.position[2] - desired[2],
            ) <= maximumDrift,
        );
      feet.sort(
        (a, b) =>
          Math.hypot(...a.position.map((v, i) => v - desired[i])) -
          Math.hypot(...b.position.map((v, i) => v - desired[i])),
      );
      if (!feet.length)
        throw new Error(`No supported clear viewpoint: ${spec.label} on ${id}`);
      return feet[0];
    };
  let foot, target, laneIds, from, to;
  if (spec.kind === 'flight') {
    const c = findConnection(spec.connectionId);
    if (!c.treads.length)
      throw new Error(`Missing actual flight treads: ${c.id}`);
    const index = Math.floor(c.treads.length / 2),
      tread = c.treads[index];
    foot = owner.floorAt(mean(tread.vertices), `${c.id}:step:${index}`);
    if (!foot || !owner.isClearFoot(foot))
      throw new Error(`Unsupported actual tread viewpoint: ${c.id}`);
    const low = c.start[1] < c.end[1] ? c.start : c.end;
    target = [low[0], low[1] + 1.55, low[2]];
  } else if (spec.kind === 'bank') {
    const lanes = spec.connections.map(findConnection);
    if (lanes.some((c) => !c.treads.length))
      throw new Error(`Bank lacks physical treads: ${spec.label}`);
    laneIds = lanes.filter((c) => c.type === 'escalator').map((c) => c.id);
    if (laneIds.length !== spec.escalators)
      throw new Error(`Wrong real escalator count: ${spec.label}`);
    const ends = lanes.map((c) =>
        c.start[1] > c.end[1]
          ? { top: c.start, low: c.end, floor: c.from }
          : { top: c.end, low: c.start, floor: c.to },
      ),
      top = mean(ends.map((p) => p.top)),
      low = mean(ends.map((p) => p.low)),
      dx = low[0] - top[0],
      dz = low[2] - top[2],
      length = Math.hypot(dx, dz);
    foot = supported(
      ends[0].floor,
      [
        top[0] - (dx / length) * spec.retreat,
        top[1],
        top[2] - (dz / length) * spec.retreat,
      ],
      1.8,
    );
    target = [low[0], low[1] + 1.55, low[2]];
    from = lanes.map((c) => c.from);
    to = lanes.map((c) => c.to);
  } else {
    const floor = findFloor(spec.floorId),
      offset = spec.offset ?? [0, 0, 0],
      desired = spec.anchorEntrance
        ? (() => {
            const entrance = findEntrance(spec.anchorEntrance),
              inward = entrance.inwardDirection,
              left = [inward[2], 0, -inward[0]];
            const point = entrance.point.map(
              (v, i) =>
                v +
                inward[i] * (spec.advance ?? 0) +
                left[i] * (spec.leftOffset ?? 0),
            );
            // The open-city entrance is the sampled street threshold, whose
            // Y can differ from the authored hall beyond its graded apron.
            // These anchored hall/vestibule views use the named flat floor.
            point[1] = mean(floor.vertices)[1];
            return point;
          })()
        : [0, 1, 2].map(
            (i) =>
              (Math.min(...floor.vertices.map((p) => p[i])) +
                Math.max(...floor.vertices.map((p) => p[i]))) /
                2 +
              offset[i],
          );
    foot = supported(spec.floorId, desired, spec.maximumDrift ?? 2.5);
    if (spec.lookAlongEntrance) {
      const direction = findEntrance(spec.lookAlongEntrance).inwardDirection;
      target = foot.position.map(
        (v, i) => v + direction[i] * 8 + (i === 1 ? 1.55 : 0),
      );
    } else if (spec.targetFloor)
      target = mean(findFloor(spec.targetFloor).vertices).map(
        (v, i) => v + (i === 1 ? 1.55 : 0),
      );
    else if (spec.targetConnection) {
      const c = findConnection(spec.targetConnection);
      const point =
        c.type === 'elevator'
          ? [c.start, c.end].toSorted(
              (a, b) =>
                Math.abs(a[1] - foot.position[1]) -
                Math.abs(b[1] - foot.position[1]),
            )[0]
          : mean([c.start, c.end]);
      target = point.map((v, i) => v + (i === 1 ? 1.55 : 0));
    } else if (spec.targetPartPrefix) {
      const parts = data.parts.filter((p) =>
        p.id.startsWith(spec.targetPartPrefix),
      );
      if (!parts.length)
        throw new Error(`Missing real view fixture: ${spec.targetPartPrefix}`);
      target = mean(parts.map((p) => p.position));
    } else
      target = foot.position.map(
        (v, i) =>
          v + (spec.direction ?? [0, 0, 1])[i] * 8 + (i === 1 ? 1.5 : 0),
      );
  }
  if (spec.levelLook) target[1] = foot.position[1] + 1.5;
  const dx = target[0] - foot.position[0],
    dz = target[2] - foot.position[2],
    yaw = Math.atan2(dx, dz),
    pitch = Math.atan2(target[1] - foot.position[1] - 1.65, Math.hypot(dx, dz)),
    platform = data.platforms.find((p) => p.surfaceId === foot.surfaceId);
  if (![...target, yaw, pitch].every(Number.isFinite))
    throw new Error(`Invalid view direction: ${spec.label}`);
  if (travel) {
    travel.clearInput();
    travel.foot = foot;
    travel.level = platform ? 'platform' : 'concourse';
    if (platform) {
      travel.line = platform.line;
      travel.direction = platform.direction;
    }
    travel.yaw = yaw;
    travel.lookYaw = 0;
    travel.pitch = pitch;
    travel.distanceView = 0;
    travel.updateCamera();
  }
  return {
    label: spec.label,
    kind: spec.kind,
    foot,
    target,
    yaw,
    pitch,
    laneIds,
    from,
    to,
  };
}

export async function captureWaterfrontStation(
  page,
  snapshot,
  report,
  stationId = 'waterfront',
) {
  if (stationId !== 'waterfront')
    throw new Error('Waterfront capture helper requires Waterfront');
  const expectedEntries = [
    'cordova-lobby',
    'howe-expo',
    'granville-canada',
    'granville-canada-lift',
  ];
  const entries = await page.evaluate(() =>
    window.__atlas.skyTrainTravel.owner.streetEntrances().map((e) => e.id),
  );
  if (
    entries.length !== expectedEntries.length ||
    expectedEntries.some((id) => !entries.includes(id))
  )
    throw new Error(
      'Capture requires the phase4 packet and all four real Waterfront street references',
    );
  await captureStationEntrances(page, snapshot, report, stationId);
  await captureStationLifts(page, snapshot, report);
  report.seabusContinuation = await page.evaluate(() => {
    const engine = window.__atlas,
      travel = engine.skyTrainTravel,
      owner = travel.owner,
      nav = engine.navigation,
      floors = owner.geometryData.floors,
      grade = floors.find(
        (f) => f.id === 'waterfront-seabus-heritage-connector-0',
      ),
      overlap = floors.find(
        (f) => f.id === 'waterfront-seabus-heritage-connector-1',
      ),
      mean = (points) =>
        points.reduce(
          (s, p) => s.map((v, i) => v + p[i] / points.length),
          [0, 0, 0],
        );
    if (!grade || !overlap)
      throw new Error('Missing physical SeaBus connector');
    const start = mean(grade.vertices),
      a = mean([overlap.vertices[0], overlap.vertices[3]]),
      b = mean([overlap.vertices[1], overlap.vertices[2]]),
      length = Math.hypot(b[0] - a[0], b[2] - a[2]),
      outward = [(b[0] - a[0]) / length, 0, (b[2] - a[2]) / length],
      foot = owner.floorAt(start, grade.id);
    if (!foot || !owner.isClearFoot(foot))
      throw new Error('Unsupported SeaBus grade start');
    // Independent supported start; every subsequent exit/return step is native.
    travel.foot = foot;
    travel.yaw = Math.atan2(outward[0], outward[2]);
    travel.lookYaw = 0;
    travel.pitch = -0.2;
    travel.distanceView = 4;
    travel.clearInput();
    travel.setTouchAxes(0, 1);
    let exitSteps = 0,
      maxHeightStep = 0;
    while (travel.active && exitSteps++ < 160) {
      const y = owner.toWorld(travel.foot)[1];
      travel.update(0.05);
      const nextY = travel.active
        ? owner.toWorld(travel.foot)[1]
        : nav.walkingHeight();
      maxHeightStep = Math.max(maxHeightStep, Math.abs(nextY - y));
      if (travel.active && !owner.isClearFoot(travel.foot))
        throw new Error('Unsupported native SeaBus exit');
    }
    if (travel.active) throw new Error('Native SeaBus exit did not release');
    const release = [nav.position.x, nav.walkingHeight(), nav.position.z];
    for (let i = 0; i < 12; i++) {
      const y = nav.walkingHeight();
      nav.update(0.05);
      travel.update(0.05);
      maxHeightStep = Math.max(
        maxHeightStep,
        Math.abs(nav.walkingHeight() - y),
      );
      if (travel.active)
        throw new Error('SeaBus exit immediately reacquired owner');
    }
    nav.blur();
    const outside = [nav.position.x, nav.walkingHeight(), nav.position.z];
    if (
      Math.hypot(outside[0] - release[0], outside[2] - release[2]) < 0.5 ||
      maxHeightStep > 0.18
    )
      throw new Error(
        'SeaBus bridge lost held movement or changed walking height: ' +
          JSON.stringify({
            outside,
            release,
            maxHeightStep,
            walkingHeight: nav.walkingHeight(),
            groundHeight: nav.groundHeight(outside[0], outside[2]),
          }),
      );
    return { left: true, release, outside, maxHeightStep, exitSteps };
  });
  await snapshot('seabus-native-exit-on-retained-skywalk-thirdperson');
  report.seabusContinuation.reentry = await page.evaluate(() => {
    const engine = window.__atlas,
      travel = engine.skyTrainTravel,
      owner = travel.stations.get('waterfront'),
      nav = engine.navigation,
      floor = owner.geometryData.floors.find(
        (f) => f.id === 'waterfront-seabus-heritage-connector-1',
      ),
      mean = (points) =>
        points.reduce(
          (s, p) => s.map((v, i) => v + p[i] / points.length),
          [0, 0, 0],
        ),
      a = mean([floor.vertices[0], floor.vertices[3]]),
      b = mean([floor.vertices[1], floor.vertices[2]]),
      worldA = owner.toWorld(a),
      worldB = owner.toWorld(b);
    nav.blur();
    nav.yaw = Math.atan2(worldA[0] - worldB[0], worldA[2] - worldB[2]);
    nav.setTouchAxes(0, 1);
    let steps = 0;
    while (!travel.active && steps++ < 100) {
      nav.update(0.05);
      travel.update(0.05);
    }
    if (!travel.active || travel.station !== 'waterfront')
      throw new Error('Native SeaBus reentry refused');
    // Continue into the graded section with the same held input after handoff.
    for (let i = 0; i < 16; i++) travel.update(0.05);
    if (
      !travel.active ||
      !owner.isClearFoot(travel.foot) ||
      travel.foot.surfaceId !== 'waterfront-seabus-heritage-connector-0'
    )
      throw new Error(
        'SeaBus reentry did not continue into the physical grade',
      );
    nav.blur();
    travel.clearInput();
    travel.distanceView = 4;
    travel.pitch = -0.2;
    travel.updateCamera();
    return {
      entered: true,
      steps,
      foot: travel.foot,
      world: owner.toWorld(travel.foot),
    };
  });
  await snapshot('seabus-native-return-through-covered-grade-thirdperson');
  const expectedLifts = [
    'waterfront-expo-lift',
    'waterfront-canada-north-lift',
    'waterfront-canada-south-platform-lift',
    'waterfront-canada-cordova-lift',
    'waterfront-granville-street-lift',
  ];
  const capturedLiftIds = new Set(
    report.liftCores.flatMap((c) => c.connectionIds),
  );
  if (expectedLifts.some((id) => !capturedLiftIds.has(id)))
    throw new Error(
      'A real Waterfront lift core lacks native F roundtrip evidence',
    );
  report.waterfrontViews = [];
  report.escalatorBanks = [];
  for (const spec of WATERFRONT_VIEWPOINTS) {
    const view = await page.evaluate(prepareWaterfrontViewpoint, spec);
    report.waterfrontViews.push(view);
    if (view.kind === 'bank') report.escalatorBanks.push(view);
    await snapshot(`${spec.label}-firstperson`);
    await page.evaluate(({ distanceView, pitch }) => {
      const travel = window.__atlas.skyTrainTravel;
      travel.distanceView = distanceView;
      travel.pitch = pitch;
      travel.updateCamera();
    }, waterfrontThirdPersonSettings(spec));
    await snapshot(
      `${spec.label}-${spec.kind === 'flight' ? 'overhead-' : ''}thirdperson`,
    );
  }
}

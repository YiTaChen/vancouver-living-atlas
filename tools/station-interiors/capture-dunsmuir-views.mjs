import {
  captureStationEntrances,
  captureStationLifts,
} from './capture-station-access.mjs';
/** Additional full-city evidence for the two stacked Dunsmuir tunnel stations.
 * Interior viewpoints use supported inspect placements. Doorway exits use the
 * production controller's touch input from an actual accepted street entry.
 */
export async function captureDunsmuirStation(
  page,
  snapshot,
  report,
  stationId,
) {
  await captureStationEntrances(page, snapshot, report, stationId);
  await captureStationLifts(page, snapshot, report);

  const platforms = await page.evaluate(() => {
    const unique = new Map();
    for (const platform of window.__atlas.skyTrainTravel.owner.geometryData
      .platforms)
      unique.set(platform.surfaceId, {
        line: platform.line,
        direction: platform.direction,
        surfaceId: platform.surfaceId,
      });
    return [...unique.values()];
  });
  for (const platform of platforms) {
    const label = platform.surfaceId.endsWith('-upper')
      ? 'upper-platform'
      : 'lower-platform';
    await page.evaluate((platform) => {
      const travel = window.__atlas.skyTrainTravel;
      travel.foot = travel.owner.boardingPoint(
        platform.line,
        platform.direction,
      );
      travel.line = platform.line;
      travel.direction = platform.direction;
      travel.level = 'platform';
      travel.yaw = travel.foot.yaw + Math.PI / 2;
      travel.lookYaw = 0;
      travel.distanceView = 4;
      travel.pitch = -0.2;
      travel.updateCamera();
    }, platform);
    await snapshot(`${label}-thirdperson`);
    await page.evaluate(() => {
      const travel = window.__atlas.skyTrainTravel;
      travel.distanceView = 0;
      travel.pitch = 0;
      travel.updateCamera();
    });
    await snapshot(`${label}-firstperson`);
  }

  const flights =
    stationId === 'burrard'
      ? [
          'burrard-street-stairs',
          'burrard-park-stairs-1',
          'burrard-park-stairs-3',
          'burrard-interplatform-stairs',
          'burrard-main-escalator-bank-2',
        ]
      : [
          'granville-seymour-stairs',
          'granville-interplatform-stairs',
          'granville-big-three-2',
          'granville-dunsmuir-main-triple-2',
        ];
  for (const connectionId of flights) {
    await page.evaluate((connectionId) => {
      const travel = window.__atlas.skyTrainTravel,
        owner = travel.owner,
        connection = owner.geometryData.connections.find(
          (item) => item.id === connectionId,
        );
      if (!connection?.treads.length)
        throw new Error(`Missing authored flight: ${connectionId}`);
      const index = Math.floor(connection.treads.length / 2),
        tread = connection.treads[index],
        point = tread.vertices.reduce(
          (sum, p) => sum.map((v, axis) => v + p[axis] / tread.vertices.length),
          [0, 0, 0],
        ),
        foot = owner.floorAt(point, `${connection.id}:step:${index}`);
      if (!foot || !owner.isClearFoot(foot))
        throw new Error(`Unsupported flight capture: ${connectionId}`);
      travel.foot = foot;
      travel.level = 'concourse';
      travel.yaw = Math.atan2(
        connection.end[0] - connection.start[0],
        connection.end[2] - connection.start[2],
      );
      travel.lookYaw = 0;
      travel.distanceView = 0;
      travel.pitch = Math.atan2(
        connection.end[1] - connection.start[1],
        Math.hypot(
          connection.end[0] - connection.start[0],
          connection.end[2] - connection.start[2],
        ),
      );
      travel.updateCamera();
    }, connectionId);
    await snapshot(`${connectionId}-firstperson`);
    await page.evaluate(() => {
      const travel = window.__atlas.skyTrainTravel;
      travel.distanceView = 9;
      travel.pitch = -0.8;
      travel.updateCamera();
    });
    await snapshot(`${connectionId}-overhead-thirdperson`);
  }
  report.escalatorBanks = [];
  for (const prefix of stationId === 'granville'
    ? ['granville-big-three', 'granville-dunsmuir-main-triple']
    : ['burrard-main-escalator-bank']) {
    const bank = await page.evaluate((prefix) => {
      const travel = window.__atlas.skyTrainTravel,
        owner = travel.owner,
        lanes = owner.geometryData.connections.filter(
          (item) =>
            item.type === 'escalator' &&
            new RegExp(`^${prefix}-[123]$`).test(item.id),
        );
      if (lanes.length !== 3)
        throw new Error(`Expected three real parallel escalators: ${prefix}`);
      const lane = lanes.find((item) => item.id.endsWith('-2')),
        dx = lane.end[0] - lane.start[0],
        dz = lane.end[2] - lane.start[2],
        length = Math.hypot(dx, dz),
        point = [
          lane.start[0] - (dx / length) * 2,
          lane.start[1],
          lane.start[2] - (dz / length) * 2,
        ],
        foot = owner.floorAt(point, lane.from) ?? owner.floorAt(point);
      if (!foot || !owner.isClearFoot(foot))
        throw new Error(`No clear bank-top viewpoint: ${prefix}`);
      travel.foot = foot;
      travel.distanceView = 0;
      travel.pitch = Math.atan2(lane.end[1] - lane.start[1], length) - 0.12;
      travel.yaw = Math.atan2(dx, dz);
      travel.lookYaw = 0;
      travel.updateCamera();
      return {
        id: prefix,
        laneIds: lanes.map((item) => item.id),
        from: lane.from,
        to: lane.to,
      };
    }, prefix);
    report.escalatorBanks.push(bank);
    await snapshot(`${prefix}-three-lanes-from-top`);
  }
}

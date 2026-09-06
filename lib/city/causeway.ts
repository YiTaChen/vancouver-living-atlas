import type { CityEngine } from './engine';
import { project } from './geo';
import { gridHeightField } from './surface-meshing';
import {
  bakeSurface,
  createChain,
  createNorthCausewayProfile,
  type SurfaceSegment,
} from './causeway-profile';
import { createSouthCausewayNetwork } from './south-profile';
import southData from './south-profile-data.json';
import cityCuts from './causeway-city-cuts.json';
import type { Point } from './road-graph';
import { buildMainRoadGeometry } from './main-road-geometry';
import mainCrossSection from './main-cross-section-data.json';

export const CAUSEWAY_ROAD = 'lions:road';
export interface CausewayData {
  segments: SurfaceSegment[];
  south: ReturnType<typeof createSouthCausewayNetwork>;
  north: ReturnType<typeof createNorthCausewayProfile>;
  main: ReturnType<typeof buildMainRoadGeometry>;
  cuts: Map<string, [number, number][]>;
  excludedPathIds: Set<number>;
  masks: { points: Point[]; level: string }[];
}

/** Prepare one stable road datum before City pavement and building fronts. */
export function prepareCauseway(e: CityEngine) {
  e.data.roadRelief = gridHeightField((x, z) => e.elevation(x, z));
  const south = createSouthCausewayNetwork(southData, project, 3, {
    groundRoadTop: (x, z) => e.data.roadRelief(x, z) + 1.05,
    liveSourceWays: e.data.bridges.features,
  });
  const main = e.data.bridges.mainSpines.find((s: any) => s.kind === 'lions');
  const mainGeometry = buildMainRoadGeometry({
    main,
    project,
    crossSection: mainCrossSection as Parameters<
      typeof buildMainRoadGeometry
    >[0]['crossSection'],
    topY: main.estimatedDeckM + 1.95,
  });
  const north = createNorthCausewayProfile(
    e.data.bridges.features,
    project,
    (x, z) => e.elevation(x, z),
    main.estimatedDeckM + 1.95,
  );
  const centralChain = createChain(
    e.data.bridges.features,
    [257712148],
    project,
  );
  const central = bakeSurface(
    centralChain,
    (s) => {
      const p = centralChain.at(s);
      return e.elevation(p.x, p.z) + 1.11;
    },
    { maxStepM: 15, routeId: 'causeway-central', layer: 1 },
  );
  // The southern window ends at an existing 15m tessellation vertex.
  const overlapEnd =
    south.routes.find((r) => r.info.id === 'shared')!.info.lengthM -
    south.routes
      .find((r) => r.info.id === 'shared')!
      .chain.ranges.get(257712148)!.start;
  const untouchedCentral = central.filter((s) => s.s0 >= overlapEnd - 1e-6);
  if (
    !untouchedCentral.length ||
    Math.abs(untouchedCentral[0].s0 - overlapEnd) > 1e-5
  )
    throw new Error(
      'Causeway southern window no longer meets the unchanged central mesh',
    );
  const northern = bakeSurface(north.chain, north.vertical.height, {
    maxStepM: 5,
    routeId: 'causeway-north',
    layer: 1,
  });
  const segments = [
    ...south.segments.filter((s) => s.routeId !== 'causeway-south-bike-exit'),
    ...untouchedCentral,
    ...northern,
  ].map((s) => ({ ...s, surfaceId: CAUSEWAY_ROAD, layer: 1 }));
  const cuts = new Map<string, [number, number][]>();
  for (const source of cityCuts.sources) {
    const [index, part] = source.sourceId.split(':').map(Number);
    const f = e.data.roads.features[index];
    const coordinates =
      f.geometry.type === 'MultiLineString'
        ? f.geometry.coordinates[part]
        : f.geometry.coordinates;
    if (
      JSON.stringify(coordinates) !== JSON.stringify(source.sourceCoordinates)
    )
      throw new Error(`Causeway City cut source changed: ${source.sourceId}`);
    cuts.set(
      source.sourceId,
      source.sourceId === cityCuts.interface.citySourceId
        ? [
            [...cityCuts.interface.proposedCityReplaceIntervalM] as [
              number,
              number,
            ],
          ]
        : source.centrelineInNewRoadFootprint.map((r) => [r.startM, r.endM]),
    );
  }
  const masks = south.segments
    .filter((s) => s.routeId !== 'causeway-south-bike-exit')
    .map((s) => {
      const dx = s.b[0] - s.a[0],
        dz = s.b[1] - s.a[1],
        len = Math.hypot(dx, dz),
        w = (s.width + 3) / 2;
      const nx = (dz / len) * w,
        nz = (-dx / len) * w;
      return {
        level: 'ground',
        points: [
          [s.a[0] - nx, s.a[1] - nz],
          [s.a[0] + nx, s.a[1] + nz],
          [s.b[0] + nx, s.b[1] + nz],
          [s.b[0] - nx, s.b[1] - nz],
        ] as Point[],
      };
    });
  e.data.causeway = {
    segments,
    south,
    north,
    cuts,
    masks,
    main: mainGeometry,
    excludedPathIds: new Set([1296092759]),
  } satisfies CausewayData;
}

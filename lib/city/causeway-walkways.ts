import type { CityEngine } from './engine';
import type { CausewayData } from './causeway';
import {
  createChain,
  bakeSurface,
  type SurfaceSegment,
  type SourceWay,
} from './causeway-profile';
import { createWalkwayAttachment } from './walkway-attachments';
import { project } from './geo';
import source from './north-walkways-source.json';

const EAST = [
  70954671, 1252160597, 877408903, 1252160599, 877408901, 1349155155, 70954668,
];
const WEST = [
  70954674, 1074018477, 877408899, 1349155152, 1349155151, 1349155153,
  1349155149, 1349155148, 70954672,
];
export function completeCausewayAttachment(data: CausewayData) {
  const chain = [
    ...data.segments.filter((s) => s.routeId === 'causeway-south-shared'),
    ...data.segments.filter((s) => s.routeId === 'causeway-central'),
    ...data.segments.filter((s) => s.routeId === 'causeway-north'),
    ...data.main.segments,
  ];
  let s = 0;
  return chain.map((segment) => {
    const length = Math.hypot(
        segment.b[0] - segment.a[0],
        segment.b[1] - segment.a[1],
      ),
      s0 = s;
    s += length;
    return {
      ...segment,
      s0,
      s1: s,
      h0: Math.fround(segment.h0),
      h1: Math.fround(segment.h1),
    };
  });
}

/** Only the explicitly connected upper source chains use this road profile. */
export function northernCausewayWalkways(e: CityEngine) {
  const data = e.data.causeway as CausewayData;
  const road = completeCausewayAttachment(data);
  const sample = createWalkwayAttachment(road, {
    maxDistanceM: 23,
    endpointAllowanceM: 0.12,
    topOffsetM: 0.13,
  });
  const ways: SourceWay[] = source.features.map((f) => ({
    geometry: f.geometry,
    properties: {
      sourceId: f.properties.sourceId,
      roadWidthM: f.properties.widthM,
    },
  }));
  const paths: SurfaceSegment[] = [];
  for (const [ids, routeId, surfaceId, reverse] of [
    [EAST, 'causeway-east-path', 'lions:east-walk', false],
    [WEST, 'causeway-west-path', 'lions:west-upper', true],
  ] as const) {
    const chain = createChain(ways, ids, project, reverse);
    const baked = bakeSurface(
      chain,
      (s) => {
        const p = chain.at(s),
          hit = sample(p.x, p.z);
        if (!hit)
          throw new Error(`Unbound upper footway source ${p.sourceId} at ${s}`);
        return hit.y;
      },
      { maxStepM: 3, routeId, layer: 1, surfaceId },
    );
    paths.push(...baked);
    for (const id of ids) data.excludedPathIds.add(id);
  }
  return {
    paths,
    road,
    sample,
    allowedModes: (sourceId: number): readonly ('walk' | 'drive')[] =>
      EAST.includes(sourceId) ||
      sourceId === 70954672 ||
      sourceId === 1349155153
        ? ['walk']
        : [],
  };
}

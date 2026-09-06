import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { Feature } from './types';
import { lines, project, inPolygon } from './geo';
import { TerrainPathDraper } from './terrain-draped-path';

export function prepareParkPaths(e: CityEngine) {
  const groundSourceIds = new Set([
    44032491, 74267973, 115939816, 363686270, 648864806, 381179591, 863811845,
  ]);
  const coastalPathIds = new Set<number>(e.data.beachCoast.replacementPathIds);
  const park = e.parkPolys.find((p) => p.name === 'Stanley Park');
  const protectedPaths = new Set([
    ...groundSourceIds,
    116061622,
    120254725,
    ...coastalPathIds,
    ...(e.data.causeway?.excludedPathIds || []),
  ]);
  const isParkTrail = (f: Feature) =>
    !f.properties.bridge &&
    !f.properties.tunnel &&
    f.properties.class !== 'steps' &&
    !protectedPaths.has(Number(f.properties.sourceId ?? f.properties.id)) &&
    !!park &&
    lines(f).every((line) =>
      line.every((p) => inPolygon(project(p), park.poly)),
    );
  const connectors: [number, number][] = e.data.paths.features
    .filter((f: Feature) => !isParkTrail(f))
    .flatMap((f: Feature) => lines(f).flatMap((line) => line.map(project)));
  const draper = new TerrainPathDraper(
    (e.terrain.children[0] as THREE.Mesh).geometry,
    connectors,
  );
  return { isParkTrail, draper };
}

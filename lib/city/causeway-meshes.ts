import { buildLionsRailings, LIONS_WALK_SOURCES } from './lions-railings';
import * as THREE from 'three';
import type { CityEngine } from './engine';
import {
  buildCausewayGeometry,
  createCausewayTriangleLookup,
  type BufferKind,
  type GeometryResult,
} from './causeway-geometry';
import { addStreetMeshes } from './street-meshes';
import { TravelSurfaceIndex, type TravelSurface } from './travel-surfaces';
import { forwardGate, type SurfaceConnection } from './surface-reachability';
import type { RoadSegment } from './placement-geometry';
import type { CausewayData } from './causeway';
import { northernCausewayWalkways } from './causeway-walkways';
import {
  createUpperWalkwayProfiles,
  type WalkSourceJSON,
} from './upper-walkway-profile';
import groundConnectors from './walkway-ground-connectors.json';
import northSources from './north-walkways-source.json';
import { GroundSurfaceIndex } from './ground-surface';
import { project, lines } from './geo';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildSupportCorridors,
  proposeWestWalkSupports,
} from './west-walk-supports';
import noFill from './causeway-no-fill.json';

export function createCausewayMeshes(e: CityEngine) {
  const data = e.data.causeway as CausewayData;
  const geometry = buildCausewayGeometry(data.segments, {
    groundRoadTop: (x, z) => e.data.roadRelief(x, z) + 1.05,
    groundElevation: (x, z) => e.elevation(x, z),
    retainingRouteIds: new Set(['causeway-north']),
    allowedModes: (_id, kind) => (kind === 'road' ? ['drive'] : []),
  });
  addCausewayBuffers(e, geometry.buffers, 'Stanley Park Causeway');
  registerCausewayGeometry(e, geometry);
  addCausewayBuffers(e, data.main.buffers, 'Lions Gate Bridge');
  e.data.causewayTravelSurfaces.push(...data.main.surfaces);
  for (const p of data.main.perSegment)
    e.data.bridgeSurfaces.push({
      ...p.segment,
      a: [...p.segment.a],
      b: [...p.segment.b],
      name: 'Lions Gate Bridge',
      allowedModes: ['drive'],
      protectedSurface: true,
      triangles: p.asphalt,
    } satisfies RoadSegment);
  const northern = northernCausewayWalkways(e);
  // Restore the original shared node in the two tiny prepared neighbour paths.
  // Their source coordinates/widths otherwise retain their existing display.
  const neighbors = [116061622, 120254725];
  for (const f of e.data.paths.features) {
    if (neighbors.includes(Number(f.properties.id))) {
      const original = groundConnectors.features.find(
        (s) => s.properties.sourceId === Number(f.properties.id),
      );
      if (original) f.geometry = original.geometry;
    }
  }
  const groundGroup = new THREE.Group();
  const groundMeshes: THREE.Mesh[] = [];
  for (const f of e.data.paths.features)
    if (neighbors.includes(Number(f.properties.id)))
      for (const line of lines(f))
        groundMeshes.push(
          e.ribbon(
            line.map(project),
            f.properties.width || 2.5,
            0,
            1.5,
            groundGroup,
          ),
        );
  const groundIndex = new GroundSurfaceIndex(groundMeshes);
  const connectors = createUpperWalkwayProfiles({
    roadSegments: [...data.segments, ...data.main.segments],
    elevation: (x, z) => e.elevation(x, z),
    project,
    groundPathTop: (x, z) =>
      groundIndex.sample(x, z, e.elevation(x, z) + 1.5) ??
      e.elevation(x, z) + 1.5,
    sources: {
      features: [...groundConnectors.features, ...northSources.features],
    } as WalkSourceJSON,
  });
  for (const mesh of groundMeshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  for (const id of connectors.excludedGroundSourceIds)
    data.excludedPathIds.add(id);
  const chilco = data.south.segments
    .filter((s) => s.routeId === 'causeway-south-bike-exit')
    .map((s) => ({ ...s, surfaceId: 'lions:chilco-path' }));
  const allPaths = [...northern.paths, ...connectors.segments, ...chilco];
  const mainStart = data.main.segments[0].a,
    mainEnd = data.main.segments.at(-1)!.b;
  const paths = buildCausewayGeometry(allPaths, {
    shoulderWidthM: 0.25,
    shoulderRiseM: 0,
    rails: true,
    paint: false,
    junctionFills: false,
    bridgeSourceIds: new Set([
      70954668, 70954672, 70954677, 70954679, 1349155154, 1349155147,
    ]),
    allowedModes: (id) =>
      id.sourceId === 1296092759 ||
      connectors.excludedGroundSourceIds.some((n) => n === id.sourceId)
        ? ['walk']
        : northern.allowedModes(id.sourceId),
    railAllowed: (id) => !LIONS_WALK_SOURCES.has(id.sourceId),
  });
  addCausewayBuffers(e, paths.buffers, 'Separated Causeway paths', true);
  const railing = buildLionsRailings(paths, allPaths, mainStart, mainEnd);
  addStreetMeshes(
    e,
    railing.positions,
    new THREE.MeshStandardMaterial({
      color: 0x377568,
      roughness: 0.72,
      side: THREE.DoubleSide,
    }),
    'Lions Gate outer pedestrian railing',
    undefined,
    false,
    false,
    true,
    true,
  );
  e.data.lionsRailingSpans = railing.spans;

  registerCausewayGeometry(e, paths);
  const pathLookup = createCausewayTriangleLookup(paths);
  const supports = proposeWestWalkSupports({
    segments: allPaths,
    elevation: (x, z) => e.elevation(x, z),
    pathTop: (x, z) =>
      pathLookup.heightAt(
        x,
        z,
        { surfaceId: 'lions:west:walk-entry', layer: 1 },
        'road',
      )?.y,
    corridors: buildSupportCorridors({
      paths: e.data.paths,
      cityRoads: e.data.roads,
      project,
      excludedPathIds: data.excludedPathIds,
    }),
    extraNoFill: noFill.features.flatMap((f, i) => {
      const polygons =
        f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates
          : [f.geometry.coordinates];
      return (polygons as unknown as number[][][][]).map((p, j) => ({
        id: `source-no-fill:${i}:${j}`,
        outer: p[0].map(project),
        holes: p.slice(1).map((ring) => ring.map(project)),
      }));
    }),
  });
  const columns = supports.columns.map((s) =>
    new THREE.CylinderGeometry(0.5, 0.5, s.heightM, 8).translate(...s.center),
  );
  if (columns.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(columns),
      new THREE.MeshStandardMaterial({ color: 0x7b8983, roughness: 0.94 }),
    );
    mesh.name = 'Western walkway sparse concrete supports';
    mesh.castShadow = mesh.receiveShadow = true;
    e.roads.add(mesh);
    columns.forEach((g) => g.dispose());
  }
  e.data.causewaySupports = supports;

  e.data.causewayPathSegments = allPaths;
  const connections: SurfaceConnection[] = [];
  const road = { surfaceId: 'lions:road', layer: 1 },
    ground = { surfaceId: 'ground', layer: 0 };
  const addGate = (
    id: string,
    center: readonly [number, number],
    direction: readonly [number, number],
    width: number,
  ) =>
    connections.push({
      id,
      from: ground,
      to: road,
      allowedModes: ['drive'],
      twoWay: true,
      maxSeamStep: 0.25,
      geometry: forwardGate(center, direction, width),
    });
  const east = data.segments.find((s) => s.routeId === 'causeway-south-east')!;
  addGate(
    'georgia-city-causeway',
    east.a,
    [east.b[0] - east.a[0], east.b[1] - east.a[1]],
    18,
  );
  const park = data.segments
    .filter((s) => s.routeId === 'causeway-south-park-access')
    .at(-1)!;
  addGate(
    'park-access-city',
    park.b,
    [park.a[0] - park.b[0], park.a[1] - park.b[1]],
    park.width,
  );
  const chilcoEnd = chilco.at(-1)!;
  connections.push({
    id: 'chilco-path-ground',
    from: ground,
    to: { surfaceId: 'lions:chilco-path', layer: 1 },
    allowedModes: ['walk'],
    twoWay: true,
    maxSeamStep: 0.1,
    geometry: forwardGate(
      chilcoEnd.b,
      [chilcoEnd.a[0] - chilcoEnd.b[0], chilcoEnd.a[1] - chilcoEnd.b[1]],
      chilcoEnd.width,
    ),
  });
  for (const gate of connectors.groundEndpointGates) {
    const first = connectors.segments.find((s) => s.routeId === gate.routeId)!;
    connections.push({
      id: gate.id,
      from: ground,
      to: { surfaceId: gate.surfaceId, layer: 1 },
      allowedModes: ['walk'],
      twoWay: true,
      maxSeamStep: 0.02,
      geometry: forwardGate(
        gate.point,
        [first.b[0] - first.a[0], first.b[1] - first.a[1]],
        first.width,
      ),
    });
  }
  for (const join of connectors.joins)
    if (join.fromSurfaceId !== join.toSurfaceId)
      connections.push({
        id: `path-node-${join.nodeId}`,
        from: { surfaceId: join.fromSurfaceId, layer: 1 },
        to: { surfaceId: join.toSurfaceId, layer: 1 },
        allowedModes: ['walk'],
        twoWay: true,
        maxSeamStep: 0.02,
        geometry: { kind: 'junction', center: join.point, radius: 3 },
      });
  // Source 1277976050 is bus=designated, motorcar=no. Its visual node datum
  // stays intact; it does not become a car connection merely by touching XY.
  e.data.causewayConnections = connections;
  e.data.travelSurfaces = new TravelSurfaceIndex(
    e.data.causewayTravelSurfaces || [],
  );
  e.data.causewayGeometryStats = { ...geometry.stats, main: data.main.stats };
}

export function addCausewayBuffers(
  e: CityEngine,
  buffers: Partial<Record<BufferKind | 'platform', number[]>>,
  name: string,
  path = false,
) {
  const colors: Record<string, number> = {
    shoulder: 0xafb1a5,
    curb: 0xbfc1af,
    slab: 0x7b8983,
    retaining: 0x7a8378,
    paintWhite: 0xdcdccf,
    paintYellow: 0xd6c986,
    rails: 0x8d9990,
    platform: 0xa6aaa0,
  };
  for (const [kind, positions] of Object.entries(buffers)) {
    if (!positions.length) continue;
    const surface = kind === 'asphalt' || kind === 'shoulder';
    const material =
      kind === 'asphalt'
        ? e.roadMaterials.get(path ? 'sidewalk-concrete' : 'asphalt-fine')!
        : new THREE.MeshStandardMaterial({
            color:
              kind === 'rails' && name === 'Lions Gate Bridge'
                ? 0xb6b3a4
                : (colors[kind] ?? 0xb2afa0),
            roughness: kind === 'rails' ? 0.58 : 0.9,
            side: THREE.DoubleSide,
          });
    const uv =
      kind === 'asphalt'
        ? positions.flatMap((n, i) =>
            i % 3 === 0 ? [n / 3, positions[i + 2] / 3] : [],
          )
        : undefined;
    addStreetMeshes(
      e,
      positions,
      material,
      `${name} ${kind}`,
      uv,
      surface,
      kind === 'asphalt',
      true,
      !kind.startsWith('paint'),
    );
  }
}

export function registerCausewayGeometry(e: CityEngine, g: GeometryResult) {
  const surfaces: TravelSurface[] = e.data.causewayTravelSurfaces || [];
  for (const top of g.surfaces) {
    surfaces.push(top);
    const source =
      top.inputIndex >= 0 ? g.perSegment[top.inputIndex].segment : undefined;
    const p = top.triangles;
    const segment: RoadSegment = {
      a: source ? [...source.a] : [p[0], p[2]],
      b: source ? [...source.b] : [p[3], p[5]],
      h0: source?.h0 ?? p[1],
      h1: source?.h1 ?? p[4],
      width: source?.width ?? 2,
      name: 'Stanley Park Causeway',
      surfaceId: top.surfaceId,
      routeId: top.routeId,
      layer: top.layer,
      allowedModes: top.allowedModes,
      protectedSurface: true,
      triangles: p,
    };
    e.data.bridgeSurfaces.push(segment);
  }
  e.data.causewayTravelSurfaces = surfaces;
}

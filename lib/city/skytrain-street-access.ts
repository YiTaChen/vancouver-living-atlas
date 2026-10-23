/** Entrance-map interpretation in city metres. These are street-side map
 * anchors, not the City station selection points or surveyed door positions. */
import * as THREE from 'three';
import { project } from './geo';
import type { StationId } from './skytrain-network';
import type {
  RuntimeStationData,
  StationVector,
  StationFloor,
  StationConnection,
  StationPart,
} from './skytrain-stations';

const stationMap = (name: string) =>
  `https://infomaps.translink.ca/system_maps/skytrain_station_maps/${name}_station.pdf`;
export interface StreetEntranceReference {
  id: string;
  label: string;
  lonlat: [number, number];
  /** Inward compass bearing, clockwise from north. */
  bearing: number;
  source: string;
}
export const SKYTRAIN_STREET_ENTRANCES: Readonly<
  Record<StationId, readonly StreetEntranceReference[]>
> = {
  waterfront: [
    {
      id: 'cordova-lobby',
      label: 'Cordova Street · heritage station lobby',
      lonlat: [-123.111986, 49.285624],
      bearing: 315,
      source: stationMap('waterfront'),
    },
    {
      id: 'granville-canada',
      label: 'Granville Street · Canada Line entrance',
      lonlat: [-123.113236, 49.285546],
      bearing: 135,
      source: stationMap('waterfront'),
    },
  ],
  burrard: [
    {
      id: 'burrard-plaza',
      label: 'Burrard / Dunsmuir · station plaza',
      lonlat: [-123.120154, 49.285603],
      bearing: 315,
      source: stationMap('burrard'),
    },
  ],
  granville: [
    {
      id: 'granville-street',
      label: 'Granville Street entrance',
      lonlat: [-123.11661616, 49.28333933],
      bearing: 135,
      source: stationMap('granville_vancouver_city_centre'),
    },
    {
      id: 'dunsmuir-street',
      label: 'Dunsmuir Street accessible entrance approach',
      lonlat: [-123.11567165, 49.28341303],
      bearing: 135,
      source: stationMap('granville_vancouver_city_centre'),
    },
    {
      id: 'seymour-street',
      label: 'Seymour Street entrance approach',
      lonlat: [-123.115527, 49.283043],
      bearing: 315,
      source: stationMap('granville_vancouver_city_centre'),
    },
  ],
  'stadium-chinatown': [
    {
      id: 'beatty-upper',
      label: 'Beatty Street · upper entrance',
      lonlat: [-123.110421, 49.280156],
      bearing: 135,
      source: stationMap('stadium_chinatown'),
    },
    {
      id: 'pacific-lower',
      label: 'Pacific / Expo Boulevard · lower entrance',
      lonlat: [-123.108764, 49.278603],
      bearing: 315,
      source: stationMap('stadium_chinatown'),
    },
  ],
  'main-street-science-world': [
    {
      id: 'main-east',
      label: 'Terminal Avenue · east stationhouse',
      lonlat: [-123.099908, 49.273054],
      bearing: 270,
      source: stationMap('main_street'),
    },
  ],
  'vancouver-city-centre': [
    {
      id: 'granville-georgia',
      label: 'Granville / West Georgia · street entrance',
      lonlat: [-123.1189031, 49.2821403],
      bearing: 315,
      source: stationMap('granville_vancouver_city_centre'),
    },
  ],
  'yaletown-roundhouse': [
    {
      id: 'davie-mainland',
      label: 'Davie / Mainland · station pavilion',
      lonlat: [-123.121813, 49.274484],
      bearing: 45,
      source: stationMap('yaletown_roundhouse'),
    },
  ],
};
export interface StreetEntrance {
  id: string;
  stationId: StationId;
  label: string;
  source: string;
  accuracy: string;
  surfaceId: string;
  threshold: StationVector;
  inward: StationVector;
  outward: StationVector;
  /** Local unit vector pointing through the public doorway. */
  localDirection: StationVector;
}
export interface StationTerrainOpening {
  id: string;
  stationId: StationId;
  polygon: StationVector[];
  minY: number;
  maxY: number;
}
export interface StationStreetAccess {
  geometry: RuntimeStationData;
  entrances: StreetEntrance[];
  openings: StationTerrainOpening[];
  routes: {
    entranceId: string;
    platformSurfaceId: string;
    points: StationVector[];
  }[];
}
const vector = (p: StationVector) => new THREE.Vector3(...p);
const tuple = (p: THREE.Vector3): StationVector => p.toArray();
const indices = [0, 1, 2, 0, 2, 3];
function strip(
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
): StationVector[] {
  const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x)
    .normalize()
    .multiplyScalar(width / 2);
  return [
    a.clone().sub(side),
    b.clone().sub(side),
    b.clone().add(side),
    a.clone().add(side),
  ].map(tuple);
}
/** Replaces only representative access circulation in an open-world owner.
 * Authored platform/track/door geometry and the immutable source packet survive.
 * Depths, switchbacks and corridor dimensions remain representative. */
export function makeStationStreetAccess(
  source: RuntimeStationData,
  heightAt: (x: number, z: number) => number,
  streetHeightAt: (x: number, z: number) => number = heightAt,
): StationStreetAccess {
  const [ox, oz] = project(source.lonlat),
    base = heightAt(ox, oz),
    rotation = new THREE.Quaternion(...source.quaternion),
    inverse = rotation.clone().invert(),
    origin = new THREE.Vector3(ox, base, oz),
    local = (p: THREE.Vector3) =>
      p.clone().sub(origin).applyQuaternion(inverse),
    world = (p: THREE.Vector3) =>
      p.clone().applyQuaternion(rotation).add(origin),
    platformIds = new Set(source.platforms.map((p) => p.surfaceId)),
    floors: StationFloor[] = source.floors
      .filter((f) => platformIds.has(f.id))
      .map((f) => structuredClone(f)),
    connections: StationConnection[] = [],
    parts: StationPart[] = [],
    entrances: StreetEntrance[] = [],
    openings: StationTerrainOpening[] = [],
    routes: StationStreetAccess['routes'] = [],
    platformFloors = [...floors],
    // The retained station frame contains the exact train and boarding geometry.
    retained = source.parts.filter(
      (p) =>
        ['rail', 'trackbed', 'threshold'].includes(p.role) ||
        [...platformIds].some(
          (id) =>
            p.id === `floor-${id}` ||
            p.id.startsWith(`${id}-column-`) ||
            p.id.startsWith(`${id}-bench-`) ||
            p.id.startsWith(`tactile-${id}-`) ||
            p.id.startsWith(`roof-${id}`) ||
            p.id.startsWith(`wall-${id}`),
        ),
    );
  parts.push(...structuredClone(retained));
  const addPart = (
    id: string,
    position: THREE.Vector3,
    size: StationVector,
    material = 'floor',
    yaw = 0,
    role = 'floor',
  ) => parts.push({ id, position: tuple(position), size, material, yaw, role });
  const landing = (
    id: string,
    p: THREE.Vector3,
    radius = 2.1,
  ): StationFloor => {
    const vertices = Array.from({ length: 16 }, (_, i) =>
      tuple(
        p
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos((i * Math.PI) / 8) * radius,
              0,
              Math.sin((i * Math.PI) / 8) * radius,
            ),
          ),
      ),
    );
    const floor: StationFloor = {
      id,
      level: id,
      kind: 'landing',
      vertices,
      indices: Array.from({ length: 14 }, (_, i) => [0, i + 1, i + 2]).flat(),
    };
    floors.push(floor);
    // A thin original polygon slab matches the supported landing, without a
    // rotated box protruding into the adjacent flight or a second floor above it.
    return floor;
  };
  const link = (
    from: string,
    to: string,
    a: THREE.Vector3,
    b: THREE.Vector3,
  ) => {
    connections.push({
      id: `${from}--${to}`,
      from,
      to,
      type: 'walk',
      start: tuple(a),
      end: tuple(b),
      width: 2.4,
      treads: [],
    });
  };
  const opening = (id: string, polygon: StationVector[]) => {
    const points = polygon.map((p) => world(vector(p))),
      ys = points.map((p) => p.y),
      ground = points.map((p) => heightAt(p.x, p.z));
    // Only circulation that actually intersects street/head space opens terrain.
    if (ys.some((y, i) => y + 2.5 >= ground[i] - 0.05 && y <= ground[i] + 3))
      openings.push({
        id,
        stationId: source.id,
        polygon: points.map(tuple),
        minY: Math.min(...ys) - 0.4,
        maxY: Math.max(...ground, ...ys) + 3.6,
      });
  };
  const route = (
    id: string,
    fromId: string,
    start: THREE.Vector3,
    targetId: string,
    finish: THREE.Vector3,
    initialDirection?: THREE.Vector3,
    bendDirection?: THREE.Vector3,
  ): StationVector[] => {
    if (Math.abs(finish.y - start.y) < 1e-6) {
      const d = finish.clone().sub(start),
        length = d.length();
      if (length < 0.05) {
        link(fromId, targetId, start, finish);
        return [tuple(start), tuple(finish)];
      }
      d.normalize();
      const vertices = strip(
          start.clone().addScaledVector(d, -0.2),
          finish.clone().addScaledVector(d, 0.2),
          3.8,
        ),
        surfaceId = `${id}-floor`;
      floors.push({
        id: surfaceId,
        level: id,
        kind: 'corridor',
        vertices,
        indices,
      });
      link(fromId, surfaceId, start, start);
      link(surfaceId, targetId, finish, finish);
      opening(id, vertices);
      return [tuple(start), tuple(finish)];
    }
    const delta = finish.clone().sub(start),
      rise = Math.abs(delta.y),
      flights = Math.max(
        1,
        Math.ceil(rise / (source.id === 'granville' ? 8.5 : 3)),
      ),
      toward = new THREE.Vector3(delta.x, 0, delta.z).normalize(),
      flightAxis = (
        initialDirection ??
        bendDirection ??
        new THREE.Vector3(toward.z, 0, -toward.x)
      )
        .clone()
        .normalize();
    if (flightAxis.lengthSq() < 0.1) flightAxis.set(1, 0, 0);
    const progress = new THREE.Vector3(-flightAxis.z, 0, flightAxis.x);
    if (progress.dot(delta) < 0) progress.negate();
    const span = (rise / flights) * 1.95 + 5,
      path: StationVector[] = [tuple(start)];
    let previousId = fromId,
      current = start.clone();
    for (let i = 0; i < flights; i++) {
      const direction = flightAxis.clone().multiplyScalar(i % 2 ? -1 : 1),
        b = current
          .clone()
          .addScaledVector(direction, span)
          .setY(start.y + (delta.y * (i + 1)) / flights),
        nextId = `${id}-landing-${i + 1}`;
      landing(nextId, b);
      const begin = current.clone().addScaledVector(direction, 1.98),
        end = b.clone().addScaledVector(direction, -1.98),
        length = Math.hypot(end.x - begin.x, end.z - begin.z),
        steps = Math.max(1, Math.ceil(Math.abs(end.y - begin.y) / 0.16)),
        treads: StationConnection['treads'] = [];
      for (let k = 0; k < steps; k++) {
        const a = begin.clone().lerp(end, k / steps),
          b = begin.clone().lerp(end, (k + 1) / steps),
          y = begin.y + ((end.y - begin.y) * (k + 1)) / steps;
        a.y = b.y = y;
        const vertices = strip(a, b, 2.4);
        treads.push({ id: `${id}-flight-${i}-tread-${k}`, vertices, indices });
        addPart(
          `${id}-flight-${i}-tread-${k}`,
          a
            .clone()
            .lerp(b, 0.5)
            .add(new THREE.Vector3(0, -0.06, 0)),
          [2.4, 0.12, length / steps + 0.001],
          source.id === 'granville' ? 'escalator' : 'concrete',
          (Math.atan2(direction.x, direction.z) * 180) / Math.PI,
          'stair-tread',
        );
      }
      connections.push({
        id: `${id}-flight-${i}`,
        from: previousId,
        to: nextId,
        type: 'stairs',
        start: tuple(begin),
        end: tuple(end),
        width: 2.4,
        treads,
      });
      opening(
        `${id}-flight-${i}`,
        strip(begin, end, source.id === 'granville' ? 4.8 : 3.25),
      );
      path.push(tuple(begin), tuple(end), tuple(b));
      const turnEnd = b.clone().addScaledVector(progress, 5.2),
        turnId = `${id}-turn-${i + 1}`;
      landing(turnId, turnEnd);
      path.push(
        ...route(`${id}-turn-passage-${i}`, nextId, b, turnId, turnEnd).slice(
          1,
        ),
      );
      previousId = turnId;
      current = turnEnd;
    }
    // Leave each compact switchback perpendicular to its flight before the
    // level station passage. No flat floor covers the next ascending tread.
    const align = initialDirection
        ? new THREE.Vector3(finish.x, current.y, current.z)
        : current
            .clone()
            .addScaledVector(
              flightAxis,
              finish.clone().sub(current).dot(flightAxis),
            ),
      alignId = `${id}-alignment`;
    landing(alignId, align);
    path.push(
      ...route(
        `${id}-alignment-passage`,
        previousId,
        current,
        alignId,
        align,
      ).slice(1),
    );
    path.push(
      ...route(`${id}-arrival-passage`, alignId, align, targetId, finish).slice(
        1,
      ),
    );
    return path;
  };
  // A source-backed common interchange has separate line descents. It does
  // not invent a connection between Granville and Vancouver City Centre.
  const first = platformFloors[0],
    firstBox = new THREE.Box3().setFromPoints(first.vertices.map(vector)),
    fc = firstBox.getCenter(new THREE.Vector3()),
    hub = new THREE.Vector3(
      fc.x + 0.85,
      source.id === 'main-street-science-world'
        ? 8
        : source.id === 'stadium-chinatown'
          ? -1
          : -3.5,
      source.id === 'main-street-science-world'
        ? firstBox.max.z + 9
        : firstBox.min.z - 9,
    ),
    hubId = `${source.id}-public-concourse`;
  landing(hubId, hub, 2);
  const platformRoutes = new Map<string, StationVector[]>();
  for (const [platformIndex, f] of platformFloors.entries()) {
    const box = new THREE.Box3().setFromPoints(f.vertices.map(vector)),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3()),
      alongZ = size.z > size.x,
      east = source.id === 'main-street-science-world',
      target = alongZ
        ? new THREE.Vector3(
            center.x + 0.85,
            center.y,
            east ? box.max.z - 1.8 : box.min.z + 1.8,
          )
        : new THREE.Vector3(box.min.x + 1.8, center.y, center.z + 0.85),
      bottom = alongZ
        ? new THREE.Vector3(
            target.x,
            center.y,
            east ? box.max.z + 10 : box.min.z - 10,
          )
        : new THREE.Vector3(box.min.x - 10, center.y, target.z),
      top = bottom.clone().setY(hub.y),
      topId = `${f.id}-descent-top`,
      bottomId = `${f.id}-descent-bottom`;
    if (['burrard', 'granville'].includes(source.id) && platformIndex) {
      top.x += 28;
      bottom.x += 28;
      top.z -= 12;
      bottom.z -= 12;
    }
    const flightCount = Math.max(
        2,
        Math.ceil(Math.abs(bottom.y - top.y) / 3.2),
      ),
      progress = (flightCount - 1) * 4.8;
    if (alongZ) bottom.z += east ? progress : -progress;
    else bottom.x -= progress;
    landing(topId, top);
    landing(bottomId, bottom);
    let approach: StationVector[];
    if (platformIndex && ['burrard', 'granville'].includes(source.id)) {
      const a = hub.clone().add(new THREE.Vector3(0, 0, 7)),
        b = new THREE.Vector3(top.x, hub.y, a.z),
        aId = `${f.id}-mezzanine-turn-a`,
        bId = `${f.id}-mezzanine-turn-b`;
      landing(aId, a);
      landing(bId, b);
      approach = [
        ...route(`${f.id}-mezzanine-a`, hubId, hub, aId, a),
        ...route(`${f.id}-mezzanine-b`, aId, a, bId, b).slice(1),
        ...route(`${f.id}-mezzanine-c`, bId, b, topId, top).slice(1),
      ];
    } else
      approach = route(`${f.id}-mezzanine-passage`, hubId, hub, topId, top);
    const descent = route(
        `${f.id}-public-descent`,
        topId,
        top,
        bottomId,
        bottom,
        undefined,
        alongZ ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1),
      ),
      align = alongZ
        ? new THREE.Vector3(target.x, bottom.y, bottom.z)
        : new THREE.Vector3(bottom.x, bottom.y, target.z),
      alignId = `${f.id}-platform-alignment`;
    landing(alignId, align);
    const alignment = route(
        `${f.id}-alignment-passage`,
        bottomId,
        bottom,
        alignId,
        align,
      ),
      arrival = route(`${f.id}-platform-passage`, alignId, align, f.id, target);
    platformRoutes.set(f.id, [
      ...approach,
      ...descent.slice(1),
      ...alignment.slice(1),
      ...arrival.slice(1),
    ]);
  }
  for (const [entranceIndex, ref] of SKYTRAIN_STREET_ENTRANCES[
    source.id
  ].entries()) {
    const [x, z] = project(ref.lonlat),
      y = streetHeightAt(x, z),
      p = local(new THREE.Vector3(x, y, z)),
      bearing = (ref.bearing * Math.PI) / 180,
      inward = new THREE.Vector3(
        Math.sin(bearing),
        0,
        -Math.cos(bearing),
      ).applyQuaternion(inverse),
      outside = p.clone().addScaledVector(inward, -3),
      inside = p.clone().addScaledVector(inward, 3),
      surfaceId = `${source.id}-${ref.id}-street-apron`,
      floor: StationFloor = {
        id: surfaceId,
        level: 'street',
        kind: 'street-apron',
        vertices: strip(outside, inside, 3.8),
        indices,
      };
    const side = new THREE.Vector3(inward.z, 0, -inward.x),
      grid: StationVector[] = [],
      gridIndices: number[] = [];
    for (const along of [-3, -2.7, -1, 0, 0.8, 1.5])
      for (const across of [-1.9, 0, 1.9])
        grid.push(
          tuple(
            p
              .clone()
              .addScaledVector(inward, along)
              .addScaledVector(side, across),
          ),
        );
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 2; col++) {
        const a = row * 3 + col,
          b = a + 3;
        gridIndices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    floor.vertices = grid;
    floor.indices = gridIndices;
    // Terrain is sampled at the complete apron corners. Crossing ownership
    // preserves world X/Z and has no synthetic fixed station-datum height snap.
    for (const v of floor.vertices) {
      const w = world(vector(v));
      v[1] = streetHeightAt(w.x, w.z) - base;
    }
    floors.push(floor);
    const firstLanding = `${source.id}-${ref.id}-vestibule`,
      vestibule = p.clone().addScaledVector(inward, 1);
    landing(firstLanding, vestibule);
    link(surfaceId, firstLanding, p, p);
    const elevated = source.id === 'main-street-science-world',
      bottom = elevated
        ? hub
        : hub.clone().add(new THREE.Vector3(-9, 0, -14 - entranceIndex * 7)),
      bottomId = elevated ? hubId : `${source.id}-${ref.id}-arrival-hall`;
    if (!elevated) landing(bottomId, bottom);
    let path: StationVector[];
    if (elevated) {
      const stairBottom = new THREE.Vector3(hub.x, p.y, firstBox.max.z + 12),
        stairTop = new THREE.Vector3(hub.x, hub.y, firstBox.max.z + 35),
        bottomFloor = `${source.id}-east-stair-foyer`,
        topFloor = `${source.id}-east-stair-gallery`,
        // The east stair lies back toward the street side of this west-facing
        // door. First enter the stationhouse, then pass beside the apron so
        // walking toward the stair cannot cross the real street exit again.
        inwardTurn = p.clone().addScaledVector(inward, 4.5),
        across = Math.sign(stairBottom.clone().sub(p).dot(side)) || 1,
        sideTurn = inwardTurn.clone().addScaledVector(side, across * 4.6),
        stairTurn = stairBottom
          .clone()
          .addScaledVector(
            side,
            across * 4.6 - stairBottom.clone().sub(p).dot(side),
          ),
        inwardFloor = `${source.id}-east-entrance-inward-turn`,
        sideFloor = `${source.id}-east-entrance-side-turn`,
        stairTurnFloor = `${source.id}-east-stair-side-turn`;
      landing(bottomFloor, stairBottom);
      landing(topFloor, stairTop);
      landing(inwardFloor, inwardTurn);
      landing(sideFloor, sideTurn);
      landing(stairTurnFloor, stairTurn);
      path = [
        ...route(
          `${source.id}-east-entrance-inward-passage`,
          firstLanding,
          vestibule,
          inwardFloor,
          inwardTurn,
        ),
        ...route(
          `${source.id}-east-entrance-side-passage`,
          inwardFloor,
          inwardTurn,
          sideFloor,
          sideTurn,
        ).slice(1),
        ...route(
          `${source.id}-east-stair-side-passage`,
          sideFloor,
          sideTurn,
          stairTurnFloor,
          stairTurn,
        ).slice(1),
        ...route(
          `${source.id}-east-ground-passage`,
          stairTurnFloor,
          stairTurn,
          bottomFloor,
          stairBottom,
        ).slice(1),
        ...route(
          `${source.id}-east-public-stairs`,
          bottomFloor,
          stairBottom,
          topFloor,
          stairTop,
          undefined,
          new THREE.Vector3(1, 0, 0),
        ).slice(1),
        ...route(
          `${source.id}-east-platform-gallery`,
          topFloor,
          stairTop,
          hubId,
          hub,
        ).slice(1),
      ];
    } else
      path = route(
        `${source.id}-${ref.id}-access`,
        firstLanding,
        vestibule,
        bottomId,
        bottom,
        inward,
      );
    if (!elevated) {
      const sideHub = new THREE.Vector3(bottom.x, hub.y, hub.z),
        sideId = `${source.id}-${ref.id}-concourse-corner`;
      landing(sideId, sideHub);
      path.push(
        ...route(
          `${source.id}-${ref.id}-concourse-side`,
          bottomId,
          bottom,
          sideId,
          sideHub,
        ).slice(1),
      );
      path.push(
        ...route(
          `${source.id}-${ref.id}-concourse-passage`,
          sideId,
          sideHub,
          hubId,
          hub,
        ).slice(1),
      );
    }
    for (const [platformSurfaceId, tail] of platformRoutes)
      routes.push({
        entranceId: ref.id,
        platformSurfaceId,
        points: [
          tuple(p),
          tuple(vestibule),
          ...path.slice(1),
          ...tail.slice(1),
        ],
      });
    entrances.push({
      id: ref.id,
      stationId: source.id,
      label: ref.label,
      source: ref.source,
      accuracy:
        'Official entrance-map street placement interpreted against City streets; representative circulation, not a survey.',
      surfaceId,
      threshold: tuple(world(p)),
      inward: (() => {
        const point = world(p.clone().addScaledVector(inward, 1.5));
        point.y = streetHeightAt(point.x, point.z);
        return tuple(point);
      })(),
      outward: (() => {
        const point = world(p.clone().addScaledVector(inward, -2.7));
        point.y = streetHeightAt(point.x, point.z);
        return tuple(point);
      })(),
      localDirection: tuple(inward),
    });
    opening(`${source.id}-${ref.id}-portal`, [
      floor.vertices[0],
      floor.vertices[15],
      floor.vertices[17],
      floor.vertices[2],
    ]);
    // Recognizable street portals: Cordova remains a heritage-lobby interface,
    // Yaletown a brick/wood pavilion, Burrard an open glazed plaza pavilion.
    const roof = vestibule.clone().add(new THREE.Vector3(0, 3.25, 0)),
      yaw = (Math.atan2(inward.x, inward.z) * 180) / Math.PI,
      heritage = source.id === 'waterfront',
      brick = source.id === 'yaletown-roundhouse' || heritage;
    addPart(
      `${surfaceId}-canopy`,
      roof,
      [5.4, heritage ? 0.35 : 0.18, 5.4],
      brick ? 'wood' : 'glass',
      yaw,
      'static',
    );
    for (const sign of [-1, 1]) {
      const post = vestibule
        .clone()
        .addScaledVector(new THREE.Vector3(inward.z, 0, -inward.x), sign * 2.35)
        .add(new THREE.Vector3(0, 1.6, 0));
      addPart(
        `${surfaceId}-post-${sign}`,
        post,
        [heritage ? 0.55 : 0.22, 3.2, heritage ? 0.55 : 0.22],
        brick ? 'brick' : 'steel',
        yaw,
        'static',
      );
    }
  }
  // Actual landing/apron support meshes use the identical floor triangles.
  // Built-in primitive platform meshes remain in the retained authored parts.
  const geometry: RuntimeStationData = {
    ...source,
    floors,
    connections,
    parts,
    entrances: entrances.map((e) => ({
      id: e.id,
      label: e.label,
      point: tuple(local(vector(e.threshold))),
      surfaceId: e.surfaceId,
    })),
    obstacles: source.obstacles.filter((p) =>
      [...platformIds].some(
        (id) =>
          p.id.startsWith(`${id}-column-`) || p.id.startsWith(`${id}-bench-`),
      ),
    ),
    exclusions: source.exclusions,
  };
  return { geometry, entrances, openings, routes };
}

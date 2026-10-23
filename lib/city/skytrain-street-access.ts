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
  /** Coordinate evidence supplements the operator's entrance diagram. */
  coordinateSource?: string;
  /** Explicitly distinguish interpreted street mouths from mapped stair endpoints. */
  coordinateAccuracy?: string;
}
export const SKYTRAIN_STREET_ENTRANCES: Readonly<
  Record<StationId, readonly StreetEntranceReference[]>
> = {
  waterfront: [
    {
      id: 'cordova-lobby',
      label: 'Cordova Street · heritage station lobby',
      lonlat: [-123.1120035, 49.2856425],
      bearing: 44.555553,
      source: stationMap('waterfront'),
      coordinateSource: 'https://www.openstreetmap.org/node/1692226746',
    },
    {
      id: 'howe-expo',
      label: 'Howe Street · Expo Line entrance',
      lonlat: [-123.113392, 49.2868766],
      bearing: 221.006215,
      source: stationMap('waterfront'),
      coordinateSource: 'https://www.openstreetmap.org/node/3633792226',
    },
    {
      id: 'granville-canada',
      label: 'Granville Street · Canada Line stairs',
      lonlat: [-123.114375, 49.285054],
      bearing: 45.651265,
      source: stationMap('waterfront'),
      coordinateSource: 'https://gtfs.org/documentation/schedule/examples/pathways/',
    },
    {
      id: 'granville-canada-lift',
      label: 'Granville Street · independent Canada Line elevator',
      lonlat: [-123.1141964, 49.285239],
      bearing: 121.770114,
      source: stationMap('waterfront'),
      coordinateSource: 'https://www.openstreetmap.org/node/13864937287',
    },
  ],
  burrard: [
    {
      id: 'burrard-plaza',
      label: 'Burrard / Dunsmuir · station plaza',
      lonlat: [-123.120065, 49.2854422],
      bearing: 315,
      source: stationMap('burrard'),
      coordinateSource: 'https://www.openstreetmap.org/node/5324651728',
    },
    {
      id: 'burrard-park',
      label: 'Art Phillips Park · Dunsmuir public steps',
      lonlat: [-123.1205982, 49.2857671],
      bearing: 135,
      source: stationMap('burrard'),
      coordinateSource: 'https://www.openstreetmap.org/way/139571580',
    },
    {
      id: 'burrard-elevator',
      label: 'Burrard Street · separate elevator stationhouse',
      lonlat: [-123.1198987, 49.2856494],
      bearing: 315,
      source: stationMap('burrard'),
      coordinateSource: 'https://www.openstreetmap.org/node/9198420892',
    },
  ],
  granville: [
    {
      id: 'granville-street',
      label: 'Granville Street entrance',
      lonlat: [-123.117129, 49.283014],
      bearing: 135,
      source: stationMap('granville_vancouver_city_centre'),
      coordinateSource: 'https://www.openstreetmap.org/node/889550073',
    },
    {
      id: 'dunsmuir-street',
      label: 'Dunsmuir Street accessible entrance approach',
      lonlat: [-123.116088, 49.283284],
      bearing: 225,
      source: stationMap('granville_vancouver_city_centre'),
      coordinateSource: 'https://www.openstreetmap.org/node/1248731632',
    },
    {
      id: 'seymour-street',
      label: 'Seymour Street entrance approach',
      lonlat: [-123.11606963320845, 49.282678332362714],
      bearing: 315,
      source: stationMap('granville_vancouver_city_centre'),
      coordinateSource:
        'https://digital.lib.washington.edu/server/api/core/bitstreams/e7c27087-87fd-476e-ab80-87d30d24c2ac/content#page=73',
      coordinateAccuracy:
        'Photo-supported entrance direction; street mouth inferred 7 m southeast of mapped stairhead using the city building edge, not a surveyed door coordinate.',
    },
  ],
  'stadium-chinatown': [
    {
      id: 'beatty-upper',
      label: 'Beatty Street · upper entrance',
      lonlat: [-123.110108, 49.2798687],
      bearing: 135,
      source: stationMap('stadium_chinatown'),
      coordinateSource: 'https://www.openstreetmap.org/node/3714304769',
    },
    {
      id: 'pacific-lower',
      label: 'Expo Boulevard · lower entrance',
      lonlat: [-123.10849, 49.2788731],
      bearing: 315,
      source: stationMap('stadium_chinatown'),
      coordinateSource: 'https://www.openstreetmap.org/node/3830176079',
    },
    {
      id: 'keefer-place',
      label: 'Keefer Place · raised concourse entrance via external steps',
      lonlat: [-123.109698, 49.279757],
      bearing: 225,
      source: stationMap('stadium_chinatown'),
      coordinateSource: 'https://www.openstreetmap.org/node/3714304773',
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
      lonlat: [-123.121947, 49.2745277],
      bearing: 45,
      source: stationMap('yaletown_roundhouse'),
      coordinateSource: 'https://www.openstreetmap.org/node/2383770178',
    },
    {
      id: 'davie-elevator',
      label: 'Davie Street · independent elevator pavilion door',
      lonlat: [-123.121882, 49.2745181],
      bearing: 315.8903568785,
      source: stationMap('yaletown_roundhouse'),
      coordinateSource: 'https://www.openstreetmap.org/node/9133604358',
      coordinateAccuracy:
        'Mapped doorway; inward direction follows exterior footway https://www.openstreetmap.org/way/988151952, not a surveyed shaft bearing.',
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
  if (source.authoredInterior)
    return attachAuthoredStation(source, heightAt, streetHeightAt);
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

/** Keep reference-authored passenger circulation intact in the open city. Only
 * the short street/apron attachment is generated; no interior flight is replaced. */
function attachAuthoredStation(
  source: RuntimeStationData,
  heightAt: (x: number, z: number) => number,
  streetHeightAt: (x: number, z: number) => number,
): StationStreetAccess {
  const geometry = structuredClone(source),
    [ox, oz] = project(source.lonlat),
    base = heightAt(ox, oz),
    rotation = new THREE.Quaternion(...source.quaternion),
    inverse = rotation.clone().invert(),
    origin = new THREE.Vector3(ox, base, oz),
    local = (p: THREE.Vector3) =>
      p.clone().sub(origin).applyQuaternion(inverse),
    world = (p: THREE.Vector3) =>
      p.clone().applyQuaternion(rotation).add(origin),
    entrances: StreetEntrance[] = [],
    openings: StationTerrainOpening[] = [],
    routes: StationStreetAccess['routes'] = [],
    mapping = source.authoredInterior?.streetEntranceMap as
      | Record<string, string>
      | undefined;
  const addBeam = (
    id: string,
    a: THREE.Vector3,
    b: THREE.Vector3,
    width: number,
    height: number,
    material: string,
    role: string,
  ) => {
    const d = b.clone().sub(a),
      q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          -Math.atan2(d.y, Math.hypot(d.x, d.z)),
          Math.atan2(d.x, d.z),
          0,
          'YXZ',
        ),
      );
    geometry.parts.push({
      id,
      position: tuple(a.clone().add(b).multiplyScalar(0.5)),
      size: [width, height, d.length()],
      yaw: 0,
      quaternion: q.toArray(),
      material,
      role,
    });
  };
  const link = (id: string, from: string, to: string, p: THREE.Vector3) =>
    geometry.connections.push({
      id,
      from,
      to,
      type: 'walk',
      start: tuple(p),
      end: tuple(p),
      width: 3.8,
      treads: [],
    });
  // Interior support follows the authored triangles, including stair holes.
  // The hillside outside cannot choose the height of a floor inside a hall.
  const authoredFloorHeight = (point: THREE.Vector3, floorId: string) => {
    const floor = source.floors.find((f) => f.id === floorId);
    if (!floor) return null;
    const height = (x: number, z: number) => {
      for (let i = 0; i < floor.indices.length; i += 3) {
        const [a, b, c] = floor.indices
          .slice(i, i + 3)
          .map((index) => vector(floor.vertices[index]));
        const ux = b.x - a.x,
          uz = b.z - a.z,
          vx = c.x - a.x,
          vz = c.z - a.z,
          denominator = ux * vz - vx * uz;
        if (Math.abs(denominator) < 1e-9) continue;
        const u = ((x - a.x) * vz - (z - a.z) * vx) / denominator,
          v = (ux * (z - a.z) - uz * (x - a.x)) / denominator;
        if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8)
          return a.y + u * (b.y - a.y) + v * (c.y - a.y);
      }
      return null;
    };
    const y = height(point.x, point.z);
    if (y === null) return null;
    return [
      [0.24, 0],
      [-0.24, 0],
      [0, 0.24],
      [0, -0.24],
    ].every(([x, z]) => {
      const footY = height(point.x + x, point.z + z);
      return footY !== null && Math.abs(footY - y) <= 0.28;
    })
      ? y
      : null;
  };
  for (const ref of SKYTRAIN_STREET_ENTRANCES[source.id]) {
    const target =
      source.entrances.find((e) => e.id === (mapping?.[ref.id] ?? ref.id)) ??
      (SKYTRAIN_STREET_ENTRANCES[source.id].length === 1
        ? source.entrances[0]
        : undefined);
    if (!target) continue;
    const raised = (
      source.authoredInterior?.raisedStreetApproaches as
        | Record<
            string,
            {
              topLonLat: [number, number];
              stairBottomLonLat: [number, number];
              deckLonLat: [number, number][];
              risers: number;
              source: string;
            }
          >
        | undefined
    )?.[ref.id];
    if (raised) {
      // This entrance is on a pedestrian deck above the DEM. Street ownership
      // starts at the mapped external stairhead, never on terrain below the door.
      const pointAt = (ll: [number, number]) => {
        const [x, z] = project(ll);
        return local(new THREE.Vector3(x, streetHeightAt(x, z), z));
      };
      const top = pointAt(raised.topLonLat),
        bottom = pointAt(raised.stairBottomLonLat),
        deck = raised.deckLonLat.map(pointAt),
        door = vector(target.point),
        inward = bottom.clone().sub(top).setY(0).normalize(),
        side = new THREE.Vector3(inward.z, 0, -inward.x),
        width = 2.6,
        apronId = `${source.id}-${ref.id}-street-apron`,
        stairId = `${source.id}-${ref.id}-mapped-approach-stair`;
      const addBox = (
        id: string,
        p: THREE.Vector3,
        size: StationVector,
        material: string,
        role: string,
        yaw = 0,
        collision = false,
      ) => {
        geometry.parts.push({
          id,
          position: tuple(p),
          size,
          yaw,
          material,
          role,
        });
        if (collision)
          geometry.obstacles.push({ id, position: tuple(p), size, yaw });
      };
      const addFloor = (
        id: string,
        vertices: StationVector[],
        kind = 'corridor',
      ) => {
        geometry.floors.push({
          id,
          level: 'keefer-raised-approach',
          kind,
          vertices,
          indices,
        });
      };
      const opening = (id: string, vertices: StationVector[]) => {
        const p = vertices.map((v) => world(vector(v)));
        openings.push({
          id,
          stationId: source.id,
          polygon: p.map(tuple),
          minY: Math.min(...p.map((v) => v.y)) - 0.4,
          maxY:
            Math.max(...p.map((v) => Math.max(v.y, heightAt(v.x, v.z)))) + 3,
        });
      };
      const grid: StationVector[] = [],
        gridIndices: number[] = [];
      for (const along of [-3.5, -1, 0, 0.3])
        for (const across of [-1.7, 0, 1.7]) {
          const p = top
              .clone()
              .addScaledVector(inward, along)
              .addScaledVector(side, across),
            w = world(p);
          p.y = streetHeightAt(w.x, w.z) - base;
          grid.push(tuple(p));
        }
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 2; c++) {
          const a = r * 3 + c,
            b = a + 3;
          gridIndices.push(a, b, b + 1, a, b + 1, a + 1);
        }
      geometry.floors.push({
        id: apronId,
        level: 'street',
        kind: 'street-apron',
        vertices: grid,
        indices: gridIndices,
      });
      const start = top.clone().addScaledVector(inward, 0.3),
        startWorld = world(start);
      start.y = streetHeightAt(startWorld.x, startWorld.z) - base;
      const horizontal = Math.hypot(bottom.x - start.x, bottom.z - start.z),
        yaw = (Math.atan2(inward.x, inward.z) * 180) / Math.PI,
        treads: StationConnection['treads'] = [];
      for (let i = 0; i < raised.risers; i++) {
        const a = start.clone().lerp(bottom, i / raised.risers),
          b = start.clone().lerp(bottom, (i + 1) / raised.risers),
          y = start.y + ((bottom.y - start.y) * i) / raised.risers,
          center = a.clone().add(b).multiplyScalar(0.5).setY(y),
          id = `${stairId}-tread-${i}`;
        a.y = y;
        b.y = y;
        treads.push({ id, vertices: strip(a, b, width), indices });
        addBox(
          id,
          center.clone().add(new THREE.Vector3(0, -0.09, 0)),
          [width, 0.18, horizontal / raised.risers + 0.002],
          'concrete',
          'stair-tread',
          yaw,
        );
        addBox(
          id + '-nosing',
          a.clone().add(new THREE.Vector3(0, 0.006, 0)),
          [width, 0.012, 0.035],
          'yellow',
          'detail',
          yaw,
        );
        const supportBottom = Math.min(start.y, bottom.y) - 0.2,
          h = Math.max(0.12, y - supportBottom - 0.52);
        addBox(
          id + '-support',
          center.clone().setY(supportBottom + h / 2),
          [width, h, horizontal / raised.risers + 0.003],
          'concrete',
          'stair-support',
          yaw,
          true,
        );
        const visibleHeight = Math.max(0.12, y - supportBottom - 0.16);
        addBox(
          id + '-riser',
          center.clone().setY(supportBottom + visibleHeight / 2),
          [width, visibleHeight, horizontal / raised.risers + 0.003],
          'concrete',
          'stair-support',
          yaw,
        );
      }
      const landingId = stairId + '-landing',
        landingEnd = bottom.clone().addScaledVector(inward, 1.8);
      addFloor(landingId, strip(bottom, landingEnd, width), 'landing');
      addBeam(
        landingId + '-slab',
        bottom.clone().add(new THREE.Vector3(0, -0.15, 0)),
        landingEnd.clone().add(new THREE.Vector3(0, -0.15, 0)),
        width,
        0.3,
        'concrete',
        'floor',
      );
      geometry.connections.push({
        id: stairId,
        from: apronId,
        to: landingId,
        type: 'stairs',
        start: tuple(start),
        end: tuple(bottom),
        width,
        treads,
      });
      for (const sign of [-1, 1]) {
        const a = start
            .clone()
            .addScaledVector(side, sign * (width / 2 + 0.07)),
          b = bottom.clone().addScaledVector(side, sign * (width / 2 + 0.07));
        addBeam(
          `${stairId}-parapet-${sign}`,
          a.clone().add(new THREE.Vector3(0, 0.43, 0)),
          b.clone().add(new THREE.Vector3(0, 0.43, 0)),
          0.16,
          0.86,
          'concrete',
          'wall',
        );
        addBeam(
          `${stairId}-handrail-${sign}`,
          a.clone().add(new THREE.Vector3(0, 0.98, 0)),
          b.clone().add(new THREE.Vector3(0, 0.98, 0)),
          0.065,
          0.07,
          'red',
          'handrail',
        );
        const d = b.clone().sub(a),
          q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              -Math.atan2(d.y, Math.hypot(d.x, d.z)),
              Math.atan2(d.x, d.z),
              0,
              'YXZ',
            ),
          );
        geometry.obstacles.push({
          id: `${stairId}-parapet-${sign}`,
          position: tuple(
            a
              .clone()
              .add(b)
              .multiplyScalar(0.5)
              .add(new THREE.Vector3(0, 0.43, 0)),
          ),
          size: [0.16, 0.86, d.length()],
          yaw: 0,
          quaternion: q.toArray(),
        });
      }
      opening(stairId + '-terrain', strip(start, bottom, width + 0.4));
      // The small residual rise follows the mapped concrete approach, not a
      // fabricated five-metre ramp from the ground directly under the station.
      const bottomY = bottom.y,
        polyline = [bottom, ...deck],
        total = polyline
          .slice(1)
          .reduce(
            (n, p, i) =>
              n + Math.hypot(p.x - polyline[i].x, p.z - polyline[i].z),
            0,
          );
      let accumulated = 0,
        previous = landingId;
      for (let i = 1; i < polyline.length; i++) {
        const a = polyline[i - 1],
          b = polyline[i],
          length = Math.hypot(b.x - a.x, b.z - a.z);
        a.y = bottomY + ((door.y - bottomY) * accumulated) / total;
        accumulated += length;
        b.y = bottomY + ((door.y - bottomY) * accumulated) / total;
        const id = `${source.id}-${ref.id}-mapped-deck-${i}`,
          vertices = strip(a, b, width);
        const previousCorner = previous;
        addFloor(id, vertices);
        link(id + '-from', previous, id, a);
        previous = id;
        addBeam(
          id + '-slab',
          a.clone().add(new THREE.Vector3(0, -0.16, 0)),
          b.clone().add(new THREE.Vector3(0, -0.16, 0)),
          width,
          0.3,
          'concrete',
          'floor',
        );
        const corner = id + '-landing',
          cornerHalf = 1.4;
        addFloor(
          corner,
          [
            [b.x - cornerHalf, b.y, b.z - cornerHalf],
            [b.x - cornerHalf, b.y, b.z + cornerHalf],
            [b.x + cornerHalf, b.y, b.z + cornerHalf],
            [b.x + cornerHalf, b.y, b.z - cornerHalf],
          ],
          'landing',
        );
        addBox(
          corner + '-slab',
          b.clone().add(new THREE.Vector3(0, -0.15, 0)),
          [2.8, 0.3, 2.8],
          'concrete',
          'floor',
        );
        link(id + '-to', id, corner, b);
        if (length < cornerHalf * 2)
          link(id + '-overlap', previousCorner, corner, b);
        previous = corner;
        opening(id + '-terrain', vertices);
      }
      const edgeAt = (index: number, sign: number) => {
        const p = polyline[index],
          before = polyline[Math.max(0, index - 1)],
          after = polyline[Math.min(polyline.length - 1, index + 1)],
          t0 = p.clone().sub(before).setY(0).normalize(),
          t1 = after.clone().sub(p).setY(0).normalize();
        if (!t0.lengthSq()) t0.copy(t1);
        if (!t1.lengthSq()) t1.copy(t0);
        const l0 = new THREE.Vector3(t0.z, 0, -t0.x),
          l1 = new THREE.Vector3(t1.z, 0, -t1.x),
          m = l0.clone().add(l1).normalize();
        return p
          .clone()
          .addScaledVector(
            m,
            (sign * (width / 2 + 0.08)) / Math.max(0.35, m.dot(l0)),
          );
      };
      for (let i = 1; i < polyline.length; i++)
        for (const sign of [-1, 1]) {
          const a = edgeAt(i - 1, sign),
            b = edgeAt(i, sign),
            d = b.clone().sub(a),
            id = `${source.id}-${ref.id}-deck-guard-${i}-${sign}`,
            q = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                -Math.atan2(d.y, Math.hypot(d.x, d.z)),
                Math.atan2(d.x, d.z),
                0,
                'YXZ',
              ),
            );
          addBeam(
            id + '-parapet',
            a.clone().add(new THREE.Vector3(0, 0.43, 0)),
            b.clone().add(new THREE.Vector3(0, 0.43, 0)),
            0.16,
            0.86,
            'concrete',
            'wall',
          );
          addBeam(
            id + '-handrail',
            a.clone().add(new THREE.Vector3(0, 0.98, 0)),
            b.clone().add(new THREE.Vector3(0, 0.98, 0)),
            0.06,
            0.07,
            'steel',
            'handrail',
          );
          geometry.obstacles.push({
            id,
            position: tuple(
              a
                .clone()
                .add(b)
                .multiplyScalar(0.5)
                .add(new THREE.Vector3(0, 0.43, 0)),
            ),
            size: [0.16, 0.86, d.length()],
            yaw: 0,
            quaternion: q.toArray(),
          });
        }
      const join = door
          .clone()
          .addScaledVector(vector(target.inwardDirection ?? [-1, 0, 0]), 0.8),
        throatId = `${source.id}-${ref.id}-raised-door-threshold`;
      addFloor(throatId, strip(polyline.at(-1)!, join, width));
      addBeam(
        throatId + '-slab',
        polyline
          .at(-1)!
          .clone()
          .add(new THREE.Vector3(0, -0.15, 0)),
        join.clone().add(new THREE.Vector3(0, -0.15, 0)),
        width,
        0.3,
        'concrete',
        'floor',
      );
      link(throatId + '-from', previous, throatId, polyline.at(-1)!);
      link(throatId + '-to', throatId, target.surfaceId, join);
      const outside = top.clone().addScaledVector(inward, -3.1),
        inner = top.clone().addScaledVector(inward, 0.1),
        outsideWorld = world(outside),
        innerWorld = world(inner);
      outsideWorld.y = streetHeightAt(outsideWorld.x, outsideWorld.z);
      innerWorld.y = streetHeightAt(innerWorld.x, innerWorld.z);
      entrances.push({
        id: ref.id,
        stationId: source.id,
        label: ref.label,
        source: ref.source,
        accuracy:
          'Mapped external stair and raised pedestrian approach; deck elevations and widths remain representative, not a survey. Street threshold is the public stairhead, not terrain below the station door.',
        surfaceId: apronId,
        threshold: tuple(world(top)),
        inward: tuple(innerWorld),
        outward: tuple(outsideWorld),
        localDirection: tuple(inward),
      });
      for (const platformId of new Set(
        source.platforms.map((v) => v.surfaceId),
      )) {
        const queue = [target.surfaceId],
          seen = new Set(queue),
          previous = new Map<
            string,
            { floor: string; connection: StationConnection }
          >();
        for (const floor of queue) {
          if (floor === platformId) break;
          for (const c of source.connections) {
            if (c.type === 'elevator') continue;
            const next =
              c.from === floor ? c.to : c.to === floor ? c.from : undefined;
            if (next && !seen.has(next)) {
              seen.add(next);
              previous.set(next, { floor, connection: c });
              queue.push(next);
            }
          }
        }
        if (!seen.has(platformId)) continue;
        const chain: { floor: string; connection: StationConnection }[] = [];
        let floor = platformId;
        while (floor !== target.surfaceId) {
          const p = previous.get(floor)!;
          chain.unshift(p);
          floor = p.floor;
        }
        const points: StationVector[] = [
          tuple(top),
          tuple(start),
          ...polyline.map(tuple),
          tuple(join),
        ];
        for (const { floor, connection: c } of chain) {
          const forward = c.from === floor;
          points.push(forward ? c.start : c.end, forward ? c.end : c.start);
        }
        routes.push({
          entranceId: ref.id,
          platformSurfaceId: platformId,
          points,
        });
      }
      continue;
    }
    const [x, z] = project(ref.lonlat),
      p = local(new THREE.Vector3(x, streetHeightAt(x, z), z)),
      inward = target.inwardDirection
        ? vector(target.inwardDirection).normalize()
        : new THREE.Vector3(
            Math.sin((ref.bearing * Math.PI) / 180),
            0,
            -Math.cos((ref.bearing * Math.PI) / 180),
          ).applyQuaternion(inverse),
      outside = p.clone().addScaledVector(inward, -3.1),
      join = vector(target.point),
      direction = join.clone().sub(p).setY(0);
    const mappedDoor = direction.length() < 0.2;
    if (direction.length() > 2) {
      const floor = source.floors.find((f) => f.id === target.surfaceId)!;
      const box = new THREE.Box3().setFromPoints(floor.vertices.map(vector)),
        center = box.getCenter(new THREE.Vector3());
      // Meet the edge of the entrance hall, rather than overlaying its flat
      // floor with a rising attachment ramp across the entire room.
      if (Math.abs(direction.x) > Math.abs(direction.z))
        join.set(
          THREE.MathUtils.clamp(p.x, box.min.x + 0.6, box.max.x - 0.6),
          target.point[1],
          center.z,
        );
      else
        join.set(
          center.x,
          target.point[1],
          THREE.MathUtils.clamp(p.z, box.min.z + 0.6, box.max.z - 0.6),
        );
      direction.copy(join).sub(p).setY(0);
    }
    if (!mappedDoor && direction.length() < 0.2)
      join.addScaledVector(
        inward,
        Math.max(3.2, 2 + Math.abs(p.y - join.y) * 2.1),
      );
    else if (direction.length() > 2) inward.copy(direction).normalize();
    outside.copy(p).addScaledVector(inward, -3.1);
    const apronId = `${source.id}-${ref.id}-street-apron`,
      throatId = `${source.id}-${ref.id}-authored-threshold`,
      vertices = strip(
        p.clone().addScaledVector(inward, -3.5),
        p.clone().addScaledVector(inward, 0.6),
        3.8,
      );
    const grid: StationVector[] = [],
      gridIndices: number[] = [];
    const across = new THREE.Vector3(inward.z, 0, -inward.x);
    // A mapped door may be the head of a descending staircase. Its outside
    // apron must end at that door, never overlay the first real stair flight.
    const apronRows = mappedDoor
      ? [-3.5, -2.8, -2.2, -1.2, -0.6, 0]
      : [-3.5, -2.8, -1, 0, 1.1, 2.2];
    for (const along of apronRows)
      for (const side of [-1.9, 0, 1.9]) {
        const v = p
            .clone()
            .addScaledVector(inward, along)
            .addScaledVector(across, side),
          w = world(v);
        const streetY = streetHeightAt(w.x, w.z) - base;
        // Preserve the city datum until the outer ownership handoff, then
        // blend over the whole available apron. A one-row drop can be steep
        // enough to reject the capsule even though both endpoints are clear.
        const blend = mappedDoor
          ? THREE.MathUtils.clamp((along + 2.2) / 1.6, 0, 1)
          : 0;
        v.y = THREE.MathUtils.lerp(streetY, target.point[1], blend);
        grid.push(tuple(v));
      }
    for (let row = 0; row < apronRows.length - 1; row++)
      for (let col = 0; col < 2; col++) {
        const a = row * 3 + col,
          b = a + 3;
        gridIndices.push(a, b, b + 1, a, b + 1, a + 1);
      }
    geometry.floors.push({
      id: apronId,
      level: 'street',
      kind: 'street-apron',
      vertices: grid,
      indices: gridIndices,
    });
    vertices.splice(
      0,
      vertices.length,
      grid[0],
      grid.at(-3)!,
      grid.at(-1)!,
      grid[2],
    );
    const rampStart = p.clone().addScaledVector(inward, mappedDoor ? -0.6 : 2),
      rampWorld = world(rampStart);
    rampStart.y =
      authoredFloorHeight(rampStart, target.surfaceId) ??
      (mappedDoor
        ? target.point[1]
        : streetHeightAt(rampWorld.x, rampWorld.z) - base);
    const throat = strip(rampStart, join, 3.8);
    geometry.floors.push({
      id: throatId,
      level: 'street-attachment',
      kind: 'corridor',
      vertices: throat,
      indices,
    });
    link(`${apronId}-join`, apronId, throatId, rampStart);
    link(`${throatId}-join`, throatId, target.surfaceId, join);
    if (direction.length() < 2 && Math.abs(p.y - target.point[1]) < 0.25)
      link(`${apronId}-authored-overlap`, apronId, target.surfaceId, p);
    const d = join.clone().sub(p),
      side = new THREE.Vector3(d.z, 0, -d.x).normalize();
    // Fully enclosed attachment. It is recorded separately from the maintained
    // station interior so it cannot silently replace its photographed topology.
    if (d.length() > 2) {
      for (const sign of [-1, 1])
        addBeam(
          `${throatId}-wall-${sign}`,
          p
            .clone()
            .addScaledVector(side, sign * 2)
            .add(new THREE.Vector3(0, 1.6, 0)),
          join
            .clone()
            .addScaledVector(side, sign * 2)
            .add(new THREE.Vector3(0, 1.6, 0)),
          0.18,
          3.2,
          'wall',
          'wall',
        );
      addBeam(
        `${throatId}-ceiling`,
        p.clone().add(new THREE.Vector3(0, 3.2, 0)),
        join.clone().add(new THREE.Vector3(0, 3.2, 0)),
        4.2,
        0.16,
        'wall',
        'ceiling',
      );
      addBeam(
        `${throatId}-floor`,
        p.clone().add(new THREE.Vector3(0, -0.12, 0)),
        join.clone().add(new THREE.Vector3(0, -0.12, 0)),
        3.8,
        0.2,
        'floor',
        'floor',
      );
    }
    const threshold = world(p),
      outer = world(outside),
      inner = world(p.clone().addScaledVector(inward, mappedDoor ? -0.6 : 1.1));
    inner.y = mappedDoor
      ? base + rampStart.y
      : streetHeightAt(inner.x, inner.z);
    outer.y = streetHeightAt(outer.x, outer.z);
    entrances.push({
      id: ref.id,
      stationId: source.id,
      label: ref.label,
      source: ref.source,
      accuracy:
        'Official street anchor and preserved reference-authored interior; secondary attachment extents are representative, not a survey.',
      surfaceId: apronId,
      threshold: tuple(threshold),
      inward: tuple(inner),
      outward: tuple(outer),
      localDirection: tuple(inward),
    });
    for (const [i, polygon] of [vertices, throat].entries()) {
      const points = polygon.map((v) => world(vector(v))),
        ys = points.map((v) => v.y),
        ground = points.map((v) => heightAt(v.x, v.z));
      openings.push({
        id: `${throatId}-opening-${i}`,
        stationId: source.id,
        polygon: points.map(tuple),
        minY: Math.min(...ys) - 0.4,
        maxY: Math.max(...ground, ...ys) + 3.8,
      });
    }
    // A graph path records the actual authored flights. Elevator-only links are
    // excluded from walking routes; the lift interaction remains separate.
    for (const platformId of new Set(
      source.platforms.map((v) => v.surfaceId),
    )) {
      const queue = [target.surfaceId],
        previous = new Map<
          string,
          { floor: string; connection: StationConnection }
        >();
      const visited = new Set(queue);
      while (queue.length && !visited.has(platformId)) {
        const f = queue.shift()!;
        for (const c of source.connections) {
          if (c.type === 'elevator') continue;
          const next = c.from === f ? c.to : c.to === f ? c.from : undefined;
          if (next && !visited.has(next)) {
            visited.add(next);
            previous.set(next, { floor: f, connection: c });
            queue.push(next);
          }
        }
      }
      if (!visited.has(platformId)) continue;
      const chain: { floor: string; connection: StationConnection }[] = [];
      let f = platformId;
      while (f !== target.surfaceId) {
        const step = previous.get(f)!;
        chain.unshift(step);
        f = step.floor;
      }
      const points: StationVector[] = [tuple(p), tuple(rampStart), tuple(join)];
      for (const { floor, connection: c } of chain) {
        const forward = c.from === floor;
        const departure = vector(forward ? c.start : c.end),
          arrival = vector(forward ? c.end : c.start),
          travel = arrival.clone().sub(departure).setY(0).normalize();
        const onFloor = (id: string, point: THREE.Vector3) => {
          const f = source.floors.find((f) => f.id === id);
          if (!f) return false;
          return [
            [0, 0],
            [0.26, 0],
            [-0.26, 0],
            [0, 0.26],
            [0, -0.26],
          ].every(([dx, dz]) => {
            const q = point.clone().add(new THREE.Vector3(dx, 0, dz));
            for (let i = 0; i < f.indices.length; i += 3) {
              const triangle = new THREE.Triangle(
                ...(f.indices
                  .slice(i, i + 3)
                  .map((index) => vector(f.vertices[index])) as [
                  THREE.Vector3,
                  THREE.Vector3,
                  THREE.Vector3,
                ]),
              );
              if (triangle.containsPoint(q)) return true;
            }
            return false;
          });
        };
        if (c.treads.length) {
          const approach = departure.clone().addScaledVector(travel, -1.2);
          if (onFloor(floor, approach)) points.push(tuple(approach));
        }
        points.push(tuple(departure), tuple(arrival));
        if (c.treads.length) {
          const clear = arrival.clone().addScaledVector(travel, 0.9);
          if (onFloor(forward ? c.to : c.from, clear))
            points.push(tuple(clear));
        }
      }
      routes.push({
        entranceId: ref.id,
        platformSurfaceId: platformId,
        points,
      });
    }
  }
  geometry.entrances = entrances.map((e) => ({
    id: e.id,
    label: e.label,
    point: tuple(local(vector(e.threshold))),
    surfaceId: e.surfaceId,
    inwardDirection: e.localDirection,
  }));
  // Near-street authored shafts open terrain at their actual footprint only.
  for (const c of source.connections.filter(
    (c) => c.type === 'stairs' || c.type === 'escalator',
  )) {
    const polygon = strip(vector(c.start), vector(c.end), c.width + 0.45),
      points = polygon.map((v) => world(vector(v)));
    if (points.some((v) => v.y + 2.5 >= heightAt(v.x, v.z)))
      openings.push({
        id: c.id + '-authored-opening',
        stationId: source.id,
        polygon: points.map(tuple),
        minY: Math.min(...points.map((v) => v.y)) - 0.4,
        maxY: Math.max(...points.map((v) => heightAt(v.x, v.z))) + 3.6,
      });
  }
  return { geometry, entrances, openings, routes };
}

import { interior } from './builder.mjs';
import { resizeIsland, carveFloorRect } from './geometry-utils.mjs';
import * as THREE from 'three';

const references = [
  {
    url: 'https://commons.wikimedia.org/wiki/File:Waterfront_Station_interior_-_Vancouver,_Canada_-_DSC00053.JPG',
    note: 'Daderot, own photograph, 23 June 2015 (CC0): round cream hall columns, deep cream ceiling coffers with blue-gray recesses, rose upper frieze and round end-wall clock. Original geometric interpretation; spacing, size and clock time are representative, not surveyed. No photograph or mural is used as a game texture.',
  },
  {
    url: 'https://images-dh-production-baselayer.dailyhive.com/uploads/2018/07/expo-line-waterfront-station-fare-gates.jpg',
    note: 'First-hand Kenneth Chan / Daily Hive photograph of Howe fare hall, 2018: five gate lanes, six housings, perforated side panels and low flat ceiling. Exact gate offset along the mapped middle level remains representative.',
  },
  {
    url: 'https://www.openstreetmap.org/way/1446762153',
    note: 'Actual indoor Cordova entry way continues northeast from surveyed door1692226746. Together with outside approach364284185 it fixes the public doorway normal independently of the rail frame.',
  },
  {
    url: 'https://www.openstreetmap.org/way/78393326',
    note: 'Existing heritage station building footprint constrains the long hall axis and public nave footprint. Interior wall offsets, pillars and the short rear Expo annex remain representative.',
  },
  {
    url: 'https://www.openstreetmap.org/node/1692226746',
    note: 'Survey-tagged West Cordova public entrance, wheelchair=yes; actual primary anchor replaces the unreferenced legacy repository point.',
  },
  {
    url: 'https://www.openstreetmap.org/node/3633801257',
    note: 'Current Granville escalator portal, explicitly described as escalator entrance. It is about 2.8 m from the separate stairs entrance in the official GTFS teaching example; those are not interchangeable survey coordinates.',
  },
  {
    url: 'https://gtfs.org/documentation/schedule/examples/pathways/',
    note: 'Official teaching example separately identifies Granville stairs90, escalator91, lift92, Cordova93 and Howe94. Granville stairs90 is used for that stair doorway; current survey-tagged OSM takes precedence for Cordova over teaching-example93.',
  },
  {
    url: 'https://www.translink.ca/-/media/translink/documents/about-translink/governance-and-board/board-of-directors/board-minutes-and-reports/2020/december/2020_12_17_public_board_meeting_agenda.pdf',
    note: 'Official December 2020 BCRTC report, page 2: two east-end escalators, two at Howe street and one up escalator between the platform and the Howe bank.',
  },
  {
    url: 'https://buzzer.translink.ca/2021/04/links-tidbits-new-escalators-at-waterfront-transit-priority-signal-at-metrotown-and-more/',
    note: 'Official existing Howe lower-landing photograph: central stair, flanking escalators, low ceiling and mall-left direction.',
  },
  {
    url: 'https://buzzer.translink.ca/2020/06/waterfronts-expo-line-eastern-entrance-to-temporarily-close/',
    note: 'Official Expo east-bank project: Howe remains alternate Expo access; no accessible elevator route via Howe.',
  },
  {
    url: 'https://cityhallwatch.wordpress.com/2024/12/03/walking-audit-all-canada-line-stations-davidowicz/',
    note: 'First-hand Waterfront 42 upper and 24 lower stair riser count; dimensional section inferred, not survey.',
  },
  {
    url: 'https://www.openstreetmap.org/way/379737506',
    note: 'Existing Howe upper stairs and connected mapped lower stair/tunnel geometry.',
  },
  {
    url: 'https://www.openstreetmap.org/way/358464785',
    note: 'Mapped three-bend underground walkway between the heritage hall and Canada Line concourse.',
  },
  {
    url: 'https://www.translink.ca/-/media/translink/documents/schedules-and-maps/skytrain-accessible-entrance-maps/waterfront_station_elevator_map.pdf',
    note: 'Heritage hall serves both lines; Granville entrance serves Canada Line; Howe access serves Expo only.',
  },
  {
    url: 'https://buzzer.translink.ca/2009/07/the-buzzer-rides-the-canada-line/',
    note: 'Operator photographs: southwest heritage-hall entrance, escalator to separate ticketing concourse, platform descent at far side.',
  },
  {
    url: 'https://buzzer.translink.ca/2008/12/canada-line-photos-waterfront-station/',
    note: 'Operator construction photographs distinguish concourse, platform and under-Cordova passage.',
  },
  {
    url: 'https://www.flickr.com/photos/viriyincy/4000151862',
    note: 'Photograph of installed station diagram; separate perpendicular island platforms and heritage-hall interchange.',
  },
  {
    url: 'https://commons.wikimedia.org/wiki/File:Expo_Line_platform_of_Waterfront_station.jpg',
    note: 'Actual Expo island: large cream columns, low metallic soffit, long fluorescent strips and red rails.',
  },
  {
    url: 'https://commons.wikimedia.org/wiki/File:Waterfront_Station_Canada_Line_Platform_2025.JPG',
    note: 'Actual Canada island: dark track walls, pale modular ceiling, rectangular floor tiles and central escalator well.',
  },
];

function ceilingOpening(b, id, cut) {
  const p = b.s.geometryParts.find((p) => p.id === id);
  if (!p) return;
  const x0 = p.centerM[0] - p.sizeM[0] / 2,
    x1 = p.centerM[0] + p.sizeM[0] / 2,
    z0 = p.centerM[2] - p.sizeM[2] / 2,
    z1 = p.centerM[2] + p.sizeM[2] / 2,
    a = Math.max(x0, cut.minX),
    c = Math.min(x1, cut.maxX),
    d = Math.max(z0, cut.minZ),
    e = Math.min(z1, cut.maxZ);
  if (c <= a || e <= d) return;
  b.s.geometryParts = b.s.geometryParts.filter((q) => q !== p);
  [
    [x0, a, z0, z1],
    [c, x1, z0, z1],
    [a, c, z0, d],
    [a, c, e, z1],
  ].forEach(([xx, xxx, zz, zzz], i) => {
    if (xxx > xx && zzz > zz)
      b.box(
        `${id}-opening-${i}`,
        [(xx + xxx) / 2, p.centerM[1], (zz + zzz) / 2],
        [xxx - xx, p.sizeM[1], zzz - zz],
        p.material,
        p.role,
      );
  });
}

const PRIMARY = {
  lonlat: [-123.1120035, 49.2856425],
  point: [-1.0818052808, 0, -65.8353703579],
  oldGroundM: 13.105608777147175,
  groundM: 13.150238399998088,
  reference: 'https://www.openstreetmap.org/node/1692226746',
};
PRIMARY.verticalShiftM = PRIMARY.oldGroundM - PRIMARY.groundM;

/** Preserve the already verified world section when changing the sampled
 * primary street datum. Station-frame fields move; carriage-local fields do
 * not. A shallow 44.6 mm threshold remains between the sampled new street
 * point and the unmeasured heritage-hall slab. */
function rebaseVerticalDatum(s) {
  const dy = PRIMARY.verticalShiftM,
    point = (p) => [p[0], p[1] + dy, p[2]];
  for (const f of s.floorSurfaces) f.verticesM = f.verticesM.map(point);
  for (const p of s.geometryParts) p.centerM = point(p.centerM);
  for (const o of s.obstacles) o.centerM = point(o.centerM);
  for (const a of s.anchors) a.pointM = point(a.pointM);
  for (const l of s.levels) {
    l.floorHeightM += dy;
    l.heightBasis =
      'Preserved world section after surveyed Cordova-door datum correction; interior slab levels remain inferred';
  }
  for (const e of s.entrances) e.pointM = point(e.pointM);
  s.entrances.find((e) => e.entranceId === 'cordova-lobby').pointM[1] = 0;
  for (const c of s.connections) {
    c.startPointM = point(c.startPointM);
    c.endPointM = point(c.endPointM);
    for (const t of c.treadSurfaces ?? []) t.verticesM = t.verticesM.map(point);
  }
  for (const p of s.platforms) {
    p.stopPosition.translationM = point(p.stopPosition.translationM);
    p.floorHeightM += dy;
    p.railHeightM += dy;
    for (const d of p.doorAlignmentPoints)
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ])
        d[key] = point(d[key]);
    for (const r of p.waitingRegions ?? []) r.polygonM = r.polygonM.map(point);
  }
  for (const e of s.trackExclusionVolumes) {
    e.footprintM = e.footprintM.map(point);
    e.minY += dy;
    e.maxY += dy;
  }
  for (const t of s.thresholdBridges ?? []) {
    for (const key of ['storedTransform', 'deployedTransform'])
      t[key].translationM = point(t[key].translationM);
    t.deployedFloor.verticesM = t.deployedFloor.verticesM.map(point);
    for (const phase of t.sequence ?? [])
      phase.translationM = point(phase.translationM);
  }
  for (const sign of s.interiorSigns) sign.position = point(sign.position);
  for (const landing of s.authoredInterior.elevatorLandings ?? [])
    landing.pointM = point(landing.pointM);
  const vertical = s.authoredInterior.verticalInference;
  for (const key of Object.keys(vertical).filter((k) => k.endsWith('YM')))
    vertical[key] += dy;
  Object.assign(vertical, {
    datumGroundDemM: PRIMARY.groundM,
    previousDatumGroundDemM: PRIMARY.oldGroundM,
    sourceVerticalRebaseM: dy,
    primaryStreetThresholdYM: 0,
    heritageHallFloorYM: dy,
    primaryThresholdHeightM: -dy,
    datumBasis:
      'Survey-tagged OSM Cordova node1692226746 replaces the unreferenced legacy repository door; all existing station-frame geometry receives one rigid vertical shift to preserve world heights and every verified stair rise',
    thresholdBasis:
      'The surveyed door ground sample is 44.6 mm above the retained inferred hall slab. This traversable threshold is not an interior slab survey or an extra hidden stair flight.',
  });
  return s;
}

const CANADA = {
  origin: [32, -13, 8],
  centre: [87.4, -3.749, 27.6],
  yaw: -13.145,
};
const EXPO = { origin: [-24, -7, 0], centre: [-43.45, -7, 3.3], yaw: 0 };
const vec = (p) => new THREE.Vector3(...p);
const tuple = (p) => p.toArray();
function frame(spec) {
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    (spec.yaw * Math.PI) / 180,
  );
  return {
    q,
    point: (p) =>
      tuple(
        vec(p).sub(vec(spec.origin)).applyQuaternion(q).add(vec(spec.centre)),
      ),
  };
}
const canadaFrame = frame(CANADA);

/** A rigid station-frame edit deliberately leaves all car-local door fields alone. */
function boardingTransform(s, line, point, q, dy, partIds = null) {
  const matches = (id) => id?.includes(`waterfront-${line}`);
  for (const f of s.floorSurfaces.filter(
    (f) => f.surfaceId === `waterfront-${line}`,
  ))
    f.verticesM = f.verticesM.map(point);
  for (const p of s.geometryParts.filter(
    (p) =>
      matches(p.id) &&
      (!partIds ||
        partIds.has(p.id) ||
        p.id.startsWith(`floor-waterfront-${line}-cut-`) ||
        p.id.startsWith(`waterfront-${line}-ceiling-opening-`)),
  ))
    transformBox(p, point, q);
  for (const a of s.anchors.filter((a) => matches(a.id)))
    a.pointM = point(a.pointM);
  const platformLevels = new Set(
    s.floorSurfaces
      .filter((f) => f.surfaceId === `waterfront-${line}`)
      .map((f) => f.levelId),
  );
  for (const level of s.levels.filter((l) => platformLevels.has(l.levelId)))
    level.floorHeightM += dy;
  for (const p of s.platforms.filter((p) => p.lineId === line)) {
    p.stopPosition.translationM = point(p.stopPosition.translationM);
    p.stopPosition.rotationQuaternionXYZW = q
      .clone()
      .multiply(new THREE.Quaternion(...p.stopPosition.rotationQuaternionXYZW))
      .toArray();
    if (p.stopPosition.approachDirection)
      p.stopPosition.approachDirection = tuple(
        vec(p.stopPosition.approachDirection).applyQuaternion(q),
      );
    p.floorHeightM += dy;
    p.railHeightM += dy;
    for (const d of p.doorAlignmentPoints)
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ])
        d[key] = point(d[key]);
    for (const region of p.waitingRegions ?? [])
      region.polygonM = region.polygonM.map(point);
  }
  for (const e of s.trackExclusionVolumes.filter((e) => matches(e.id))) {
    e.footprintM = e.footprintM.map(point);
    e.minY += dy;
    e.maxY += dy;
  }
  for (const t of (s.thresholdBridges ?? []).filter((t) =>
    matches(t.instanceId),
  )) {
    for (const key of ['storedTransform', 'deployedTransform']) {
      t[key].translationM = point(t[key].translationM);
      t[key].rotationQuaternionXYZW = q
        .clone()
        .multiply(new THREE.Quaternion(...t[key].rotationQuaternionXYZW))
        .toArray();
    }
    t.deployedFloor.verticesM = t.deployedFloor.verticesM.map(point);
    for (const phase of t.sequence ?? []) {
      phase.translationM = point(phase.translationM);
      phase.rotationQuaternionXYZW = q
        .clone()
        .multiply(new THREE.Quaternion(...phase.rotationQuaternionXYZW))
        .toArray();
    }
  }
}
function transformBox(p, point, q) {
  p.centerM = point(p.centerM);
  const old = p.rotationQuaternionXYZW
    ? new THREE.Quaternion(...p.rotationQuaternionXYZW)
    : new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        ((p.yawDegrees ?? 0) * Math.PI) / 180,
      );
  p.rotationQuaternionXYZW = q.clone().multiply(old).toArray();
  p.yawDegrees = 0;
}
function canonicalSource(input) {
  const s = structuredClone(input);
  for (const [line, spec] of Object.entries({ expo: EXPO, canada: CANADA })) {
    const f = s.floorSurfaces.find((f) => f.surfaceId === `waterfront-${line}`),
      ps = s.platforms.filter((p) => p.lineId === line);
    const xs = f.verticesM.map((v) => v[0]),
      zs = f.verticesM.map((v) => v[2]);
    const from = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      ps[0].floorHeightM,
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ];
    const canonicalQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      line === 'canada' ? Math.PI / 2 : 0,
    );
    const q = canonicalQ.multiply(
      new THREE.Quaternion(
        ...ps[0].stopPosition.rotationQuaternionXYZW,
      ).invert(),
    );
    const point = (p) =>
      tuple(vec(p).sub(vec(from)).applyQuaternion(q).add(vec(spec.origin)));
    boardingTransform(s, line, point, q, spec.origin[1] - from[1]);
    // Author each rebuild from the complete train-facing rectangle; stairwell
    // cuts are reapplied once below instead of accumulating triangulation.
    const w = ps[0].widthM,
      len = ps[0].lengthM,
      [x, y, z] = spec.origin;
    f.verticesM =
      line === 'canada'
        ? [
            [x - len / 2, y, z - w / 2],
            [x - len / 2, y, z + w / 2],
            [x + len / 2, y, z + w / 2],
            [x + len / 2, y, z - w / 2],
          ]
        : [
            [x - w / 2, y, z - len / 2],
            [x - w / 2, y, z + len / 2],
            [x + w / 2, y, z + len / 2],
            [x + w / 2, y, z - len / 2],
          ];
    f.indices = [0, 1, 2, 0, 2, 3];
    f.geometryNodeId = `floor-${f.surfaceId}`;
    s.geometryParts = s.geometryParts.filter(
      (p) =>
        !(
          p.role === 'floor' &&
          (p.id === f.geometryNodeId ||
            p.id.startsWith(`${f.geometryNodeId}-cut-`) ||
            p.floorSurfaceId === f.surfaceId)
        ),
    );
    s.geometryParts.push({
      id: f.geometryNodeId,
      centerM: [x, y - 0.15, z],
      sizeM: line === 'canada' ? [len, 0.3, w] : [w, 0.3, len],
      yawDegrees: 0,
      material: 'floor',
      role: 'floor',
    });
  }
  resizeIsland(s, 'waterfront-expo', 8.6);
  resizeIsland(s, 'waterfront-canada', 8.6);
  return s;
}
/** Apply a frame only to geometry authored in this scope. */
function scoped(b, spec, author) {
  const keys = [
    'floorSurfaces',
    'geometryParts',
    'obstacles',
    'connections',
    'entrances',
    'interiorSigns',
    'levels',
  ];
  const first = Object.fromEntries(keys.map((k) => [k, b.s[k].length]));
  author();
  const { point, q } = frame(spec);
  for (const l of b.s.levels.slice(first.levels))
    l.floorHeightM += spec.centre[1] - spec.origin[1];
  for (const f of b.s.floorSurfaces.slice(first.floorSurfaces))
    f.verticesM = f.verticesM.map(point);
  for (const p of b.s.geometryParts.slice(first.geometryParts))
    transformBox(p, point, q);
  for (const p of b.s.obstacles.slice(first.obstacles))
    transformBox(p, point, q);
  for (const c of b.s.connections.slice(first.connections)) {
    c.startPointM = point(c.startPointM);
    c.endPointM = point(c.endPointM);
    for (const t of c.treadSurfaces ?? []) t.verticesM = t.verticesM.map(point);
  }
  for (const e of b.s.entrances.slice(first.entrances)) {
    e.pointM = point(e.pointM);
    if (e.inwardDirectionM)
      e.inwardDirectionM = tuple(vec(e.inwardDirectionM).applyQuaternion(q));
  }
  for (const sign of b.s.interiorSigns.slice(first.interiorSigns)) {
    sign.position = point(sign.position);
    sign.yaw += (spec.yaw * Math.PI) / 180;
  }
}
/** Continuous triangulated passage, with physical slabs, full side walls and
 * a matching soffit. No invisible steps approximate the inferred gentle grade. */
function passage(
  b,
  id,
  points,
  width = 5,
  {
    height = 3.1,
    material = 'white',
    roof = true,
    overlap = true,
    startEnclosureZ = null,
    flatStartUntilZ = null,
  } = {},
) {
  const dirs = points
    .slice(1)
    .map((p, i) => vec(p).sub(vec(points[i])).setY(0).normalize());
  const laterals = dirs.map((d) => new THREE.Vector3(d.z, 0, -d.x));
  const miters = points.map((p, i) =>
    i === 0
      ? laterals[0].clone().multiplyScalar(width / 2)
      : i === points.length - 1
        ? laterals
            .at(-1)
            .clone()
            .multiplyScalar(width / 2)
        : laterals[i - 1]
            .clone()
            .add(laterals[i])
            .normalize()
            .multiplyScalar(
              width /
                2 /
                laterals[i - 1]
                  .clone()
                  .add(laterals[i])
                  .normalize()
                  .dot(laterals[i]),
            ),
  );
  const ids = [];
  for (let i = 0; i < points.length - 1; i++) {
    const sid = `${id}-${i}`,
      a = vec(points[i]),
      z = vec(points[i + 1]),
      ma = miters[i],
      mz = miters[i + 1];
    const corners = [
      tuple(a.clone().sub(ma)),
      tuple(z.clone().sub(mz)),
      tuple(z.clone().add(mz)),
      tuple(a.clone().add(ma)),
    ];
    const flatEntry = i === 0 && flatStartUntilZ !== null,
      entryCenter = flatEntry
        ? a
            .clone()
            .lerp(z, (flatStartUntilZ - a.z) / (z.z - a.z))
            .setY(a.y)
        : null,
      edgeAtEntry = (from, to) => {
        const p = vec(from),
          q = vec(to),
          t = (flatStartUntilZ - p.z) / (q.z - p.z);
        if (!(t > 0 && t < 1))
          throw new Error('Flat passage entry must be inside both floor edges');
        return tuple(p.lerp(q, t).setY(a.y));
      },
      verticesM = flatEntry
        ? [
            corners[0],
            edgeAtEntry(corners[0], corners[1]),
            corners[1],
            corners[2],
            edgeAtEntry(corners[3], corners[2]),
            corners[3],
          ]
        : corners;
    b.s.floorSurfaces.push({
      surfaceId: sid,
      frameId: b.s.stationId,
      levelId: sid,
      verticesM,
      indices: flatEntry
        ? [0, 1, 4, 0, 4, 5, 1, 2, 3, 1, 3, 4]
        : [0, 1, 2, 0, 2, 3],
      walkable: true,
      kind: 'corridor',
      geometryNodeId: `floor-${sid}`,
      headClearanceM: height,
    });
    b.s.levels.push({
      levelId: sid,
      label: sid,
      floorHeightM: a.y,
      heightBasis: 'Photo/step/DEM integrated inferred section; not survey',
    });
    // Keep the conservative legacy beam bound for source provenance. The
    // explicit surface reference below owns the exact rendered prism instead.
    const extension =
      overlap && (i > 0 || i < points.length - 2) ? width * 0.56 : 0;
    const renderedFloor = b.beam(
      `floor-${sid}`,
      tuple(
        a
          .clone()
          .addScaledVector(dirs[i], -extension)
          .add(new THREE.Vector3(0, -0.15, 0)),
      ),
      tuple(
        z
          .clone()
          .addScaledVector(dirs[i], extension)
          .add(new THREE.Vector3(0, -0.15, 0)),
      ),
      width,
      0.3,
      'floor',
      'floor',
    );
    // The walking quad, including its actual miter and grade, is also the
    // visible concrete top. Rectangular overlap beams cannot describe a
    // twisted ramp turn without a raised lip or an unsupported corner.
    b.s.geometryParts.find(
      (part) => part.id === renderedFloor,
    ).renderFloorSurfaceId = sid;
    for (const side of [-1, 1]) {
      const u = a.clone().addScaledVector(ma, side),
        v = z.clone().addScaledVector(mz, side);
      // A passage can overlap the floor of an adjoining room. Its sidewalls
      // start at the real room portal, rather than fence across that room.
      if (i === 0 && startEnclosureZ !== null && Math.abs(v.z - u.z) > 1e-6)
        u.lerp(
          v,
          Math.max(0, Math.min(1, (startEnclosureZ - u.z) / (v.z - u.z))),
        );
      if (flatEntry) {
        if (Math.abs(u.z - flatStartUntilZ) > 1e-5)
          throw new Error(
            'Flat passage entry enclosure must start at its portal',
          );
        u.y = a.y;
      }
      const wall = b.beam(
        `${sid}-side-${side}`,
        tuple(u.clone().add(new THREE.Vector3(0, height / 2, 0))),
        tuple(v.clone().add(new THREE.Vector3(0, height / 2, 0))),
        0.2,
        height,
        material,
        'wall',
      );
      const p = b.s.geometryParts.find((p) => p.id === wall);
      b.s.obstacles.push({ ...structuredClone(p), type: 'oriented-box' });
      b.beam(
        `${sid}-handrail-${side}`,
        tuple(u.clone().add(new THREE.Vector3(0, 0.93, 0))),
        tuple(v.clone().add(new THREE.Vector3(0, 0.93, 0))),
        0.055,
        0.065,
        'steel',
        'handrail',
      );
    }
    const profile = entryCenter ? [a, entryCenter, z] : [a, z],
      boundaries = entryCenter
        ? [
            [vec(corners[0]), vec(corners[3])],
            [vec(verticesM[1]), vec(verticesM[4])],
            [vec(corners[1]), vec(corners[2])],
          ]
        : [
            [vec(corners[0]), vec(corners[3])],
            [vec(corners[1]), vec(corners[2])],
          ];
    for (let section = 0; section < profile.length - 1; section++) {
      const suffix = section === profile.length - 2 ? '' : '-flat-entry',
        start = profile[section],
        end = profile[section + 1];
      if (roof) {
        // Floor and sidewall ends follow their actual miter, not the square
        // end of a centreline box. The roof must reach that same boundary.
        // Its bounded lap is derived from corner projections; any change in
        // grade across those corners is covered by physical slab thickness.
        const run = end.clone().sub(start).setY(0).length(),
          grade = (end.y - start.y) / run,
          cosine = 1 / Math.hypot(1, grade),
          startOffsets = boundaries[section].map((p) =>
            p.clone().sub(start).dot(dirs[i]),
          ),
          endOffsets = boundaries[section + 1].map((p) =>
            p.clone().sub(end).dot(dirs[i]),
          ),
          warp = Math.max(
            ...[...boundaries[section], ...boundaries[section + 1]].map((p) =>
              Math.abs(
                p.y - start.y - grade * p.clone().sub(start).dot(dirs[i]),
              ),
            ),
          ),
          thickness = 0.18 + 2 * warp * cosine,
          thicknessProjection = (thickness / 2) * Math.abs(grade) * cosine,
          startLap =
            Math.max(0, ...startOffsets.map((v) => -v)) + thicknessProjection,
          endLap = Math.max(0, ...endOffsets) + thicknessProjection,
          roofStart = start.clone().addScaledVector(dirs[i], -startLap),
          roofEnd = end.clone().addScaledVector(dirs[i], endLap);
        roofStart.y -= grade * startLap;
        roofEnd.y += grade * endLap;
        b.beam(
          `${sid}-ceiling${suffix}`,
          tuple(roofStart.add(new THREE.Vector3(0, height, 0))),
          tuple(roofEnd.add(new THREE.Vector3(0, height, 0))),
          width + 0.3,
          thickness,
          'panel',
          'ceiling',
        );
      }
      b.beam(
        `${sid}-light${suffix}`,
        tuple(
          profile[section].clone().add(new THREE.Vector3(0, height - 0.12, 0)),
        ),
        tuple(
          profile[section + 1]
            .clone()
            .add(new THREE.Vector3(0, height - 0.12, 0)),
        ),
        0.12,
        0.05,
        'light',
        'ceiling',
      );
    }
    if (i) b.walk(`${id}-joint-${i}`, ids.at(-1), sid, points[i]);
    ids.push(sid);
  }
  return ids;
}
function flatSegment(b, id, a, z, width = 5, options = {}) {
  return passage(b, id, [a, z], width, options)[0];
}

/** Remove only the solid's exact horizontal slice from a flat landing. The
 * retaining plinth stays physical; a flat walk/render slab cannot pass through
 * its small inclined corner. No body-radius or inferred clearance is added. */
function notchLandingAtSolid(b, floorId, solidId) {
  const floor = b.s.floorSurfaces.find((f) => f.surfaceId === floorId),
    solid = b.s.geometryParts.find((p) => p.id === solidId),
    slab = b.s.geometryParts.find((p) => p.id === floor?.geometryNodeId),
    epsilon = 1e-8;
  if (!floor || !solid || !slab || floor.verticesM.length !== 4)
    throw new Error('A structural landing notch needs its original flat quad');
  const y = floor.verticesM[0][1];
  if (floor.verticesM.some((p) => Math.abs(p[1] - y) > epsilon))
    throw new Error('Structural landing notches require a flat floor');
  const rotation = solid.rotationQuaternionXYZW
      ? new THREE.Quaternion(...solid.rotationQuaternionXYZW)
      : new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          (solid.yawDegrees * Math.PI) / 180,
        ),
    center = vec(solid.centerM),
    planes = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const normal = new THREE.Vector3()
        .setComponent(axis, sign)
        .applyQuaternion(rotation);
      planes.push({
        x: normal.x,
        z: normal.z,
        limit: normal.dot(center) + solid.sizeM[axis] / 2 - normal.y * y,
      });
    }
  const clip = (polygon, plane, inside) => {
    const result = [],
      signed = (p) => plane.x * p.x + plane.z * p.y - plane.limit;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        z = polygon[(i + 1) % polygon.length],
        da = signed(a),
        dz = signed(z),
        keepA = inside ? da <= 0 : da >= 0,
        keepZ = inside ? dz <= 0 : dz >= 0;
      if (keepA) result.push(a.clone());
      if (keepA !== keepZ) result.push(a.clone().lerp(z, da / (da - dz)));
    }
    return result;
  };
  let remainder = floor.verticesM.map((p) => new THREE.Vector2(p[0], p[2]));
  const pieces = [];
  for (const plane of planes) {
    const outside = clip(remainder, plane, false);
    if (Math.abs(THREE.ShapeUtils.area(outside)) > epsilon)
      pieces.push(outside);
    remainder = clip(remainder, plane, true);
    if (!remainder.length) break;
  }
  if (Math.abs(THREE.ShapeUtils.area(remainder)) <= epsilon)
    throw new Error('Expected a real retaining-plinth intersection');

  // The convex partition is only an intermediate operation. Merge its outside
  // boundary so the final prism has no internal partition walls or T-junctions.
  const vertices = [],
    vertexId = (p) => {
      let id = vertices.findIndex((v) => v.distanceToSquared(p) < epsilon ** 2);
      if (id === -1) id = vertices.push(p.clone()) - 1;
      return id;
    };
  for (const polygon of pieces) for (const p of polygon) vertexId(p);
  const edges = new Map();
  for (const polygon of pieces)
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        z = polygon[(i + 1) % polygon.length],
        direction = z.clone().sub(a),
        lengthSquared = direction.lengthSq();
      if (lengthSquared < epsilon ** 2) continue;
      const cuts = vertices
        .map((p, id) => ({
          id,
          t: p.clone().sub(a).dot(direction) / lengthSquared,
          distance: Math.abs(direction.cross(p.clone().sub(a))),
        }))
        .filter(
          (p) =>
            p.t >= -epsilon &&
            p.t <= 1 + epsilon &&
            p.distance < epsilon * Math.sqrt(lengthSquared),
        )
        .sort((p, q) => p.t - q.t);
      for (let j = 1; j < cuts.length; j++) {
        const from = cuts[j - 1].id,
          to = cuts[j].id;
        if (from === to) continue;
        const key = from < to ? `${from}:${to}` : `${to}:${from}`,
          edge = edges.get(key) ?? { from, to, count: 0 };
        edge.count++;
        edges.set(key, edge);
      }
    }
  const boundary = [...edges.values()].filter((edge) => edge.count === 1),
    neighbors = new Map();
  for (const { from, to } of boundary) {
    neighbors.set(from, [...(neighbors.get(from) ?? []), to]);
    neighbors.set(to, [...(neighbors.get(to) ?? []), from]);
  }
  if (!boundary.length || [...neighbors.values()].some((v) => v.length !== 2))
    throw new Error('Retaining-plinth notch must leave one closed landing');
  const order = [boundary[0].from];
  let previous = null,
    next = order[0];
  do {
    const following = neighbors.get(next).find((id) => id !== previous);
    previous = next;
    next = following;
    if (next !== order[0]) order.push(next);
    if (order.length > boundary.length)
      throw new Error('Retaining-plinth notch boundary did not close');
  } while (next !== order[0]);
  if (order.length !== boundary.length)
    throw new Error('Retaining-plinth notch cannot create detached landings');
  const contour = order.map((id) => vertices[id]);
  floor.verticesM = contour.map((p) => [p.x, y, p.y]);
  floor.indices = THREE.ShapeUtils.triangulateShape(contour, []).flat();
  slab.renderFloorSurfaceId = floorId;
}
function pointAlong(a, z, t) {
  return a.map((n, i) => n + (z[i] - n) * t);
}

export function rebuildWaterfront(input) {
  const source = canonicalSource(input),
    b = interior(source, 'waterfront-mapped-circulation-v3', references);
  b.s.layoutKind =
    'heritage-hall-mapped-independent-islands-howe-and-granville';
  b.s.authoredInterior.primaryEntrance = 'cordova-lobby';
  b.s.authoredInterior.streetEntranceMap = {
    'cordova-lobby': 'cordova-lobby',
    'howe-expo': 'howe-expo',
    'granville-canada': 'granville-canada',
    'granville-canada-lift': 'granville-canada-lift',
  };
  b.tracks();
  b.platform('waterfront-expo', { columns: false });
  b.platform('waterfront-canada', { columns: false });
  const trainPartIds = new Set(b.s.geometryParts.map((p) => p.id));
  // The observed Cordova doorway opens northeast into the building. Its
  // outside/inside OSM footways, rather than the rail frame's +Z axis, define
  // that normal. Local +X points out to Cordova; local +Z runs left/northwest
  // along the photographed heritage hall. Platform/bank coordinates stay fixed.
  const heritageInward = [-0.9752056270313687, 0, -0.22130066652939584],
    heritageLeft = [heritageInward[2], 0, -heritageInward[0]],
    heritageYaw = -12.78543888107276,
    heritageAt = (u, v, y = 0) =>
      tuple(
        vec(PRIMARY.point)
          .addScaledVector(vec(heritageInward), u)
          .addScaledVector(vec(heritageLeft), v)
          .add(new THREE.Vector3(0, y, 0)),
      );
  scoped(
    b,
    { origin: [0, 0, 0], centre: [...PRIMARY.point], yaw: heritageYaw },
    () => {
      b.floor(
        'waterfront-heritage-hall',
        [-15.4, 0, -14.75],
        25.2,
        70.5,
        'concourse',
        'heritage-hall',
      );
      b.s.floorSurfaces.at(-1).headClearanceM = 8.5;
      b.room('waterfront-heritage-hall', [-15.4, 0, -14.75], 25.2, 70.5, {
        height: 8.5,
        material: 'cream',
        doors: {
          // Main nave front u=2.8 joins the exact street-door vestibule.
          // A second aperture preserves the existing Canada lift approach.
          east: [
            [12.35, 17.15],
            [32.75, 35.25],
          ],
          // Rear connection to the independently mapped Expo bank annex.
          west: [
            [14.25, 19.05],
            [24.75, 31.75],
          ],
          // Canada stairs and the lift retain their mapped source locations.
          // Their upper landings overlap this end; the hall slab stops before
          // the first descending tread, so no rotated floor cut is required.
          south: [[-0.1, 12.6]],
        },
      });
      b.floor(
        'waterfront-heritage-entry-vestibule',
        [-1.4, 0, 0],
        2.8,
        4.8,
        'concourse',
        'heritage-hall',
      );
      b.s.floorSurfaces.at(-1).headClearanceM = 8.5;
      b.room('waterfront-heritage-entry-vestibule', [-1.4, 0, 0], 2.8, 4.8, {
        height: 8.5,
        material: 'cream',
        doors: { east: [[-2.4, 2.4]], west: [[-2.4, 2.4]] },
      });
      b.walk(
        'cordova-entry-heritage-nave',
        'waterfront-heritage-entry-vestibule',
        'waterfront-heritage-hall',
        [-2.8, 0, 0],
      );
      // The nave is taller than its covered branches. Close the wall above
      // each low portal instead of leaving a full-height opening to the sky.
      b.box(
        'heritage-seabus-rear-portal-header',
        [-28, 6.35, 1.9],
        [0.2, 4.3, 4.8],
        'cream',
        'wall',
        0,
        true,
      );
      b.box(
        'heritage-expo-rear-portal-header',
        [-28, 5.85, 13.5],
        [0.2, 5.3, 7],
        'cream',
        'wall',
        0,
        true,
      );
      b.box(
        'heritage-canada-portal-header',
        [-9.15, 5.85, 20.5],
        [12.7, 5.3, 0.2],
        'cream',
        'wall',
        0,
        true,
      );
      for (const u of [7, 24])
        for (const v of [-42, -26, -10, 6]) {
          b.box(
            `heritage-column-${u}-${v}`,
            [-u, 3.8, v],
            [0.58, 7.6, 0.58],
            'cream',
            'column',
            0,
            true,
          );
          // Sixteen physical faces give the photographed round shaft its
          // actual silhouette; the central core stays inside that shell.
          for (let face = 0; face < 16; face++) {
            const angle = (face / 16) * Math.PI * 2;
            b.box(
              `heritage-column-${u}-${v}-round-face-${face}`,
              [-u + Math.sin(angle) * 0.413, 3.8, v + Math.cos(angle) * 0.413],
              [2 * 0.413 * Math.tan(Math.PI / 16) + 0.004, 7.6, 0.025],
              'cream',
              'column-panel',
              (angle * 180) / Math.PI,
              true,
            );
          }
          b.box(
            `heritage-capital-${u}-${v}`,
            [-u, 7.5, v],
            [1.35, 0.38, 1.35],
            'cream',
            'detail',
          );
        }
      // Preserve the photographed heritage character when the superseded
      // public-interior hall is retired. All decoration uses this mapped hall
      // frame; no floor, passage, flight or boarding datum moves with it.
      for (const x of [-7, -24]) {
        b.box(
          `heritage-frieze-${x}`,
          [x, 7.98, -14.75],
          [0.2, 0.62, 70],
          'heritageRose',
          'detail',
        );
        for (const [y, width, height] of [
          [7.61, 0.55, 0.2],
          [8.36, 0.65, 0.18],
        ])
          b.box(
            `heritage-cornice-${x}-${y}`,
            [x, y, -14.75],
            [width, height, 70],
            'cream',
            'detail',
          );
        // Neutral framed panels retain the mural rhythm without presenting
        // invented imagery as a copy of the station's landscape paintings.
        for (const z of [-42, -26, -10, 6]) {
          b.box(
            `heritage-frieze-frame-${x}-${z}`,
            [x + (x === -7 ? -0.13 : 0.13), 7.98, z],
            [0.06, 0.48, 6.3],
            'cream',
            'detail',
          );
          b.box(
            `heritage-frieze-panel-${x}-${z}`,
            [x + (x === -7 ? -0.17 : 0.17), 7.98, z],
            [0.04, 0.34, 5.9],
            'tile',
            'detail',
          );
        }
      }
      const cofferX = [-23, -19.25, -15.5, -11.75, -8];
      for (let row = 0; row < 14; row++) {
        const z = -47.5 + row * 4.8;
        for (const [col, x] of cofferX.entries()) {
          const id = `heritage-coffer-${row}-${col}`;
          b.box(
            id + '-recess',
            [x, 8.39, z],
            [3.35, 0.06, 4.35],
            'heritageBlue',
            'ceiling',
          );
          for (const side of [-1, 1]) {
            b.box(
              id + '-rim-x-' + side,
              [x + side * 1.68, 8.24, z],
              [0.18, 0.22, 4.55],
              'cream',
              'ceiling',
            );
            b.box(
              id + '-rim-z-' + side,
              [x, 8.24, z + side * 2.2],
              [3.55, 0.22, 0.18],
              'cream',
              'ceiling',
            );
          }
        }
      }
      for (const z of [-49.78, 20.28]) {
        const id = `heritage-end-clock-${z}`,
          x = -15.5,
          y = 6.75,
          front = z < 0 ? 1 : -1;
        for (let row = -6; row <= 6; row++) {
          const dy = row * 0.12;
          b.box(
            id + '-face-' + row,
            [x, y + dy, z],
            [2 * Math.sqrt(0.85 ** 2 - dy ** 2), 0.13, 0.055],
            'cream',
            'detail',
          );
        }
        for (let tick = 0; tick < 24; tick++) {
          const a = (tick * Math.PI) / 12;
          const q = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a)
            .toArray();
          b.box(
            id + '-rim-' + tick,
            [x + Math.sin(a) * 0.87, y + Math.cos(a) * 0.87, z],
            [0.22, 0.09, 0.09],
            'black',
            'detail',
            0,
            false,
            q,
          );
          if (tick % 2 === 0)
            b.box(
              id + '-tick-' + tick,
              [
                x + Math.sin(a) * 0.69,
                y + Math.cos(a) * 0.69,
                z + front * 0.055,
              ],
              [0.035, 0.13, 0.045],
              'black',
              'detail',
              0,
              false,
              q,
            );
        }
        b.box(
          id + '-hour-hand',
          [x - 0.16, y + 0.13, z + front * 0.09],
          [0.055, 0.43, 0.04],
          'black',
          'detail',
          0,
          false,
          new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.9)
            .toArray(),
        );
        b.box(
          id + '-minute-hand',
          [x + 0.18, y + 0.23, z + front * 0.1],
          [0.04, 0.6, 0.04],
          'black',
          'detail',
          0,
          false,
          new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.65)
            .toArray(),
        );
      }
      for (const v of [-42, -26, -10, 6])
        b.box(
          `heritage-light-${v}`,
          [-15.5, 7.7, v],
          [4, 0.08, 0.4],
          'light',
          'ceiling',
        );
      b.sign('Waterfront', [-0.25, 3.6, 0], Math.PI / 2, 6, 0.8, '#243e51');
      b.sign(
        'Canada Line  ←     Expo Line  ↑',
        [-3, 2.7, 0],
        Math.PI / 2,
        8,
        0.5,
      );
      b.sign('Cordova Street  Exit', [-1, 2.7, 0], -Math.PI / 2, 5, 0.45);
      b.sign('Canada Line  ↓', [-11, 2.5, 19.9], Math.PI, 5, 0.45, '#007d9f');
    },
  );
  b.entrance(
    'cordova-lobby',
    'Cordova Street · heritage station hall',
    'waterfront-heritage-entry-vestibule',
    [...PRIMARY.point],
  );
  b.s.entrances.at(-1).inwardDirectionM = [...heritageInward];
  b.s.authoredInterior.heritageHallOrientation = {
    doorwayNode: 1692226746,
    outsideApproachWay: 364284185,
    indoorEntryWay: 1446762153,
    buildingFootprintWay: 78393326,
    inwardDirectionM: [...heritageInward],
    leftDirectionM: [...heritageLeft],
    inwardWorldBearingDegrees: 44.55555277232628,
    hallLocalYawDegrees: heritageYaw,
    hallBoundsInwardLeftM: { inward: [2.8, 28], left: [-50, 20.5] },
    streetVestibuleBoundsInwardLeftM: { inward: [0, 2.8], left: [-2.4, 2.4] },
    status:
      'Entry normal and hall axis follow mapped public footways and existing building footprint. Inner nave dimensions, columns and short rear Expo annex are representative; mapped stairs, lifts and boarding assemblies stay fixed.',
  };
  // Join the retained, physically rendered SeaBus SkyWalk at its existing
  // rear doorway. The section between the inferred nave slab and that deck is
  // a visible continuous grade, not a height override or an invisible ramp.
  const seabusU = 36.65620213165932,
    seabusV = 1.9452906719721303,
    seabusY = 0.5639810169114025,
    seabusConnector = passage(
      b,
      'waterfront-seabus-heritage-connector',
      [
        heritageAt(27.4, seabusV),
        heritageAt(seabusU, seabusV, seabusY),
        heritageAt(seabusU + 0.8, seabusV, seabusY),
      ],
      4.4,
      { height: 4.2, material: 'cream', overlap: false },
    );
  // The retained SkyWalk has a 3.62 m soffit. Close the actual 0.58 m
  // roof step at their shared end plane, without changing either walkway.
  b.box(
    'heritage-seabus-skywalk-roof-fascia',
    heritageAt(seabusU + 0.8, seabusV, seabusY + 3.91),
    [0.22, 0.64, 4.6],
    'cream',
    'wall',
    heritageYaw,
    true,
  );
  b.walk(
    'heritage-nave-seabus-connector',
    'waterfront-heritage-hall',
    seabusConnector[0],
    heritageAt(27.6, seabusV),
  );
  b.s.authoredInterior.publicInteriorLinks = [
    {
      id: 'waterfront-seabus',
      surfaceId: seabusConnector.at(-1),
      endEdge: [1, 2],
      insetM: 0.8,
      widthM: 4.4,
      publicInterior: 'waterfront',
      accuracy:
        'Retained existing SkyWalk endpoint; nave-to-bridge grade and covered connector proportions inferred, not surveyed.',
    },
  ];
  // The Expo bank lies beyond the rear of the retained public nave. A short
  // covered vestibule connects to its existing paid concourse; it does not
  // rotate or move the bank to compensate for the former hall-axis error.
  const expoHall = b.floor(
    'waterfront-expo-paid-annex',
    [-42.7, 0, -57.2],
    12,
    7.4,
    'concourse',
    'heritage-hall',
  );
  b.room('waterfront-expo-paid-annex', [-42.7, 0, -57.2], 12, 7.4, {
    height: 3.2,
    material: 'cream',
    doors: { east: [[-3.7, 3.0]], south: [[-4.85, 3.7]] },
  });
  const expoHallLink = flatSegment(
    b,
    'waterfront-heritage-expo-vestibule',
    heritageAt(26, 13),
    [-38.2, 0, -59.2],
    3.2,
    { height: 3.2, material: 'cream' },
  );
  b.walk(
    'heritage-nave-expo-vestibule',
    'waterfront-heritage-hall',
    expoHallLink,
    heritageAt(26, 13),
  );
  b.walk(
    'heritage-vestibule-expo-annex',
    expoHallLink,
    expoHall,
    [-38.2, 0, -59.2],
  );
  // OSM's two present east escalators descend directly to the Expo end
  // landing. The additional walking stair is parallel to that photographed
  // bank. There is no invented intermediate public floor.
  b.fareGates(
    'waterfront-expo-fares',
    [-43.5, 0, -58.2],
    [-3.4, -1.7, 0, 1.7, 3.4],
  );
  // The mapped lift is on the platform side of this inferred gate line.
  // Keep a full standing/turning apron outside its -Z portal, and close the
  // unused side spans with visible low barriers instead of an invisible bypass.
  for (const [side, a, z] of [
    ['west', -48.6, -46.9],
    ['east', -40.1, -36.8],
  ]) {
    b.box(
      `waterfront-expo-fare-side-barrier-${side}`,
      [(a + z) / 2, 0.55, -58.2],
      [z - a, 1.1, 0.12],
      'steel',
      'wall',
      0,
      true,
    );
    b.box(
      `waterfront-expo-fare-side-rail-${side}`,
      [(a + z) / 2, 1.12, -58.2],
      [z - a, 0.06, 0.16],
      'black',
      'detail',
    );
  }
  const expoLanding = b.floor(
    'waterfront-expo-east-landing',
    [-43.45, -7, -36.76],
    8.6,
    6.12,
    'landing',
    'waterfront-expo-level',
  );
  for (const [suffix, x, width, kind] of [
    ['stairs', -46.2, 2.2, 'stairs'],
    ['up', -43.8, 1.05, 'escalator'],
    ['down', -42.1, 1.05, 'escalator'],
  ])
    b.flight(
      `waterfront-expo-platform-${String(suffix)}`,
      expoHall,
      expoLanding,
      [x, 0, -53.51],
      [x - 0.121, -7, -39.79],
      width,
      { kind, enclosed: false },
    );
  b.shaft(
    'waterfront-expo-east-bank',
    [-44.2, 0, -53.51],
    [-44.321, -7, -39.79],
    6.8,
    { material: 'cream', height: 3.2 },
  );
  b.walk(
    'waterfront-expo-east-platform',
    expoLanding,
    'waterfront-expo',
    [-43.34, -7, -33.7],
  );
  b.sign(
    'Expo Line  ↓  Platforms 1 · 2',
    [-43.5, 2.4, -53.8],
    0,
    6,
    0.45,
    '#004b7d',
  );
  // Mapped existing lift lies beside the escalator bank. Its platform-level
  // narrow parallel aisle avoids crossing either track or the stair envelope.
  b.floor(
    'waterfront-expo-lift-lower',
    [-40.203, -7, -54.222],
    2.2,
    2.2,
    'lift-landing',
    'waterfront-expo-level',
  );
  const expoLiftAisle = flatSegment(
    b,
    'waterfront-expo-lift-aisle',
    [-40.203, -7, -53.122],
    [-40.203, -7, -33.7],
    1.32,
    { material: 'cream', height: 2.9 },
  );
  b.walk(
    'expo-lift-lower-aisle',
    'waterfront-expo-lift-lower',
    expoLiftAisle,
    [-40.203, -7, -53.122],
  );
  b.walk(
    'expo-lift-aisle-platform',
    expoLiftAisle,
    'waterfront-expo',
    [-40.203, -7, -33.7],
  );
  b.elevator(
    'waterfront-expo-lift',
    expoHall,
    'waterfront-expo-lift-lower',
    [-40.203, 0, -54.222],
    [-40.203, -7, -54.222],
  );

  // Howe Street: photograph-backed central stairs with one escalator on each
  // side, a low-ceiling middle landing and the mall passage on the left.
  const howeTop = [-64.79375356, 2.1919, 92.21254299],
    howeBottom = [-51.28189882, -2.2, 94.40972386];
  const howeDirection = vec(howeBottom).sub(vec(howeTop)).setY(0).normalize();
  const howeLateral = new THREE.Vector3(howeDirection.z, 0, -howeDirection.x);
  const howeEntry = flatSegment(
    b,
    'waterfront-howe-street-landing',
    tuple(vec(howeTop).addScaledVector(howeDirection, -2)),
    tuple(vec(howeTop).addScaledVector(howeDirection, 0.4)),
    6.2,
    { height: 3.2, material: 'cream' },
  );
  b.entrance('howe-expo', 'Howe Street · Expo Line', howeEntry, howeTop);
  b.s.entrances.at(-1).inwardDirectionM = tuple(howeDirection);
  const howeMiddleFirst = flatSegment(
    b,
    'waterfront-howe-middle-west',
    [...tuple(vec(howeBottom).addScaledVector(howeDirection, -0.45))],
    [-45.75, -2.2, 95.15 + (0.9 * howeDirection.z) / howeDirection.x],
    8.2,
    { height: 2.65, material: 'cream' },
  );
  const howeJunction = b.floor(
    'waterfront-howe-middle-junction',
    [-42.66473407, -2.2, 95.78624779],
    8.2,
    8.2,
    'concourse',
  );
  b.room(
    'waterfront-howe-middle-junction',
    [-42.66473407, -2.2, 95.78624779],
    8.2,
    8.2,
    {
      height: 2.65,
      material: 'cream',
      doors: {
        west: [[-4.1, 3.45]],
        north: [[-3.1, 3.67]],
        south: [[-2.45, 1.7]],
      },
    },
  );
  // The five-lane fare boundary is after the unpaid mall junction and
  // before the lower platform flight. The first-hand 2018 photo establishes
  // six housings and perforated panels; its exact mapped metre offset is not
  // published. Separate support surfaces make that paid boundary explicit.
  const howeGateApproach = [-42.39, -2.2, 91.68624779],
    howeGateDeparture = [-42.11684546, -2.2, 87.05262666],
    howeGateCentre = pointAlong(howeGateApproach, howeGateDeparture, 0.5),
    howeGateDirection = vec(howeGateDeparture)
      .sub(vec(howeGateApproach))
      .setY(0)
      .normalize(),
    howeGateLateral = new THREE.Vector3(
      howeGateDirection.z,
      0,
      -howeGateDirection.x,
    ),
    howeGateYaw =
      (Math.atan2(howeGateDirection.x, howeGateDirection.z) * 180) / Math.PI,
    howeMiddleLast = flatSegment(
      b,
      'waterfront-howe-middle-north',
      howeGateApproach,
      howeGateCentre,
      6.8,
      { height: 2.65, material: 'cream' },
    ),
    howePaidHall = flatSegment(
      b,
      'waterfront-howe-paid-hall',
      howeGateCentre,
      howeGateDeparture,
      6.8,
      { height: 2.65, material: 'cream' },
    );
  b.walk(
    'howe-fare-boundary',
    howeMiddleLast,
    howePaidHall,
    tuple(vec(howeGateCentre).addScaledVector(howeGateLateral, 0.21)),
  );
  b.fareGates(
    'waterfront-howe-fares',
    howeGateCentre,
    [-3.285, -1.635, -0.405, 0.825, 2.055, 3.285],
    howeGateYaw,
  );
  for (const side of [-1, 1])
    b.beam(
      `howe-farehall-perforated-panel-${side}`,
      tuple(
        vec(howeGateApproach)
          .addScaledVector(howeGateLateral, side * 3.29)
          .add(new THREE.Vector3(0, 1.325, 0)),
      ),
      tuple(
        vec(howeGateDeparture)
          .addScaledVector(howeGateLateral, side * 3.29)
          .add(new THREE.Vector3(0, 1.325, 0)),
      ),
      0.025,
      2.6,
      'acoustic',
      'detail',
    );
  b.sign(
    '↓ Exit  Howe Street · Waterfront Centre · Sinclair Centre',
    tuple(vec(howeGateCentre).add(new THREE.Vector3(0, 2.37, 0))),
    (howeGateYaw * Math.PI) / 180,
    6.4,
    0.4,
  );
  b.sign(
    'Expo Line  ↓  Platforms 1 · 2',
    tuple(
      vec(howeGateCentre)
        .addScaledVector(howeGateDirection, -0.03)
        .add(new THREE.Vector3(0, 2.37, 0)),
    ),
    (howeGateYaw * Math.PI) / 180 + Math.PI,
    6.4,
    0.4,
    '#004b7d',
  );
  b.s.authoredInterior.howeFareBoundary = {
    referencePhoto:
      'https://images-dh-production-baselayer.dailyhive.com/uploads/2018/07/expo-line-waterfront-station-fare-gates.jpg',
    photographer: 'Kenneth Chan / Daily Hive, 2018',
    lanes: 5,
    readerHousings: 6,
    unpaidSurfaceId: howeMiddleLast,
    paidSurfaceId: howePaidHall,
    boundaryConnectionId: 'howe-fare-boundary',
    directionToPlatformM: tuple(howeGateDirection),
    placementBasis:
      'The photographed fare boundary belongs after the mapped unpaid commercial T-junction and before the lower platform flight. Exact centreline offset and hall width are representative, not a measured gate coordinate.',
  };
  b.walk(
    'howe-middle-west-junction',
    howeMiddleFirst,
    howeJunction,
    [-46.65, -2.2, 95.15],
  );
  b.walk(
    'howe-middle-junction-north',
    howeJunction,
    howeMiddleLast,
    [-42.39, -2.2, 91.68624779],
  );
  const howeMiddle = [howeMiddleFirst, howeJunction, howePaidHall];
  for (const [suffix, offset, width, kind] of [
    ['stairs', 0, 2.8, 'stairs'],
    ['up', -2.2, 1.1, 'escalator'],
    ['down', 2.2, 1.1, 'escalator'],
  ])
    b.flight(
      `waterfront-howe-upper-${String(suffix)}`,
      howeEntry,
      howeMiddle[0],
      tuple(vec(howeTop).addScaledVector(howeLateral, offset)),
      tuple(vec(howeBottom).addScaledVector(howeLateral, offset)),
      width,
      { kind, enclosed: false },
    );
  b.shaft('waterfront-howe-upper-bank', howeTop, howeBottom, 6.2, {
    material: 'cream',
    height: 2.9,
  });
  for (const part of b.s.geometryParts)
    if (
      part.id.startsWith('waterfront-howe-upper-') &&
      part.id.includes('-balustrade-')
    ) {
      part.material = 'stainless';
      part.sizeM[0] = 0.07;
    }
  for (const [i, offset] of [-2.2, 2.2].entries())
    b.box(
      `howe-escalator-approach-plate-${i}`,
      tuple(
        vec(howeBottom)
          .addScaledVector(howeLateral, offset)
          .addScaledVector(howeDirection, 0.38)
          .add(new THREE.Vector3(0, 0.014, 0)),
      ),
      [1.42, 0.026, 0.76],
      'steel',
      'detail',
      (Math.atan2(howeDirection.x, howeDirection.z) * 180) / Math.PI,
    );
  const howeLowerTop = [-42.11684546, -2.2, 87.45262666],
    howeLowerBottom = [-42.59920296, -7, 73.16344279];
  const lowerDir = vec(howeLowerBottom)
    .sub(vec(howeLowerTop))
    .setY(0)
    .normalize();
  const howeTunnel = passage(
    b,
    'waterfront-howe-platform-tunnel',
    [
      tuple(vec(howeLowerBottom).addScaledVector(lowerDir, -0.45)),
      [-43.5679, -7, 43.2466],
    ],
    6,
    { material: 'cream', height: 2.9 },
  );
  const lowerLat = new THREE.Vector3(
    howeLowerBottom[2] - howeLowerTop[2],
    0,
    howeLowerTop[0] - howeLowerBottom[0],
  ).normalize();
  for (const [suffix, offset, width, kind] of [
    ['stairs', -0.9, 3.4, 'stairs'],
    ['escalator', 2, 1.1, 'escalator'],
  ])
    b.flight(
      `waterfront-howe-lower-${String(suffix)}`,
      howeMiddle.at(-1),
      howeTunnel[0],
      tuple(vec(howeLowerTop).addScaledVector(lowerLat, offset)),
      tuple(vec(howeLowerBottom).addScaledVector(lowerLat, offset)),
      width,
      { kind, enclosed: false },
    );
  b.shaft('waterfront-howe-lower-bank', howeLowerTop, howeLowerBottom, 5.4, {
    material: 'cream',
    height: 2.9,
  });
  b.floor(
    'waterfront-expo-west-landing',
    [-43.51, -7, 41.77],
    8.6,
    2.954,
    'landing',
    'waterfront-expo-level',
  );
  b.walk(
    'howe-tunnel-west-landing',
    howeTunnel[0],
    'waterfront-expo-west-landing',
    [-43.5679, -7, 43.2466],
  );
  b.walk(
    'expo-west-landing-island',
    'waterfront-expo-west-landing',
    'waterfront-expo',
    [-43.56, -7, 40.3],
  );
  // The mall branch is visibly signposted. Model only the documented access
  // mouth, without claiming to reconstruct the connected commercial complex.
  const mall = flatSegment(
    b,
    'waterfront-howe-mall-vestibule',
    [-42.994244, -2.2, 99.487849],
    [-43.6253, -2.2, 106.5192],
    4.2,
    { height: 2.65, material: 'cream' },
  );
  // Only this short access mouth is reconstructed. Its inferred opaque
  // scope closure prevents an underground opening into the exterior city;
  // it does not claim that the real commercial complex ends here.
  const mallEnd = [-43.6253, -2.2, 106.5192],
    mallDirection = vec(mallEnd)
      .sub(vec([-43.03, -2.2, 99.88624779]))
      .setY(0)
      .normalize();
  b.box(
    'waterfront-howe-commercial-scope-closure',
    [mallEnd[0], mallEnd[1] + 1.325, mallEnd[2]],
    [4.42, 2.65, 0.22],
    'cream',
    'wall',
    (Math.atan2(mallDirection.x, mallDirection.z) * 180) / Math.PI,
    true,
  );
  b.walk(
    'howe-mall-left-branch',
    howeJunction,
    mall,
    [-43.03, -2.2, 99.88624779],
  );
  for (const [i, [x, z]] of [
    [-44.6, 93.8],
    [-40.6, 93.8],
    [-44.6, 97.8],
    [-40.6, 97.8],
  ].entries()) {
    for (let strip = 0; strip < 16; strip++) {
      const offset = -0.12 + (strip + 0.5) * 0.015,
        span = 2 * Math.sqrt(0.12 * 0.12 - offset * offset);
      b.box(
        `howe-recessed-light-${i}-${strip}`,
        [x + offset, 0.398, z],
        [0.015, 0.016, span],
        'light',
        'ceiling',
      );
    }
    for (let segment = 0; segment < 24; segment++) {
      const angle = ((segment + 0.5) * Math.PI) / 12;
      b.box(
        `howe-recessed-light-rim-${i}-${segment}`,
        [x + Math.cos(angle) * 0.135, 0.397, z + Math.sin(angle) * 0.135],
        [0.037, 0.02, 0.025],
        'black',
        'ceiling',
        (-angle * 180) / Math.PI,
      );
    }
  }
  for (let i = 0; i < 13; i++) {
    const offset = -3.9 + i * 0.6;
    b.box(
      `howe-square-tile-joint-x-${i}`,
      [-42.66473407 + offset, -2.194, 95.78624779],
      [0.012, 0.008, 8.1],
      'tile',
      'detail',
    );
    b.box(
      `howe-square-tile-joint-z-${i}`,
      [-42.66473407, -2.194, 95.78624779 + offset],
      [8.1, 0.008, 0.012],
      'tile',
      'detail',
    );
    for (let j = 0; j < 13; j++)
      if ((i + 2 * j) % 5 === 0)
        b.box(
          `howe-muted-floor-tile-${i}-${j}`,
          [
            -42.66473407 + offset + 0.3,
            -2.197,
            95.78624779 - 3.9 + j * 0.6 + 0.3,
          ],
          [0.576, 0.006, 0.576],
          'warmfloor',
          'detail',
        );
  }
  b.sign(
    '↑ Howe Street · Canada Place · Convention Centre',
    [-50.9, 0.15, 94.4],
    -Math.PI / 2,
    6.4,
    0.38,
  );
  b.sign(
    '← Waterfront Centre · Sinclair Centre',
    [-41.5, 0.15, 96.1],
    0,
    5.8,
    0.36,
  );
  b.sign(
    'Expo Line ↓  Platforms 1 · 2',
    [-42.2, 0.15, 87.8],
    0,
    5,
    0.38,
    '#004b7d',
  );

  // The south 24-riser count fixes the representative 4m section. The north
  // bank reuses that section without claiming an independent counted survey.
  // Both paid concourses are rigidly placed in the mapped station box.
  scoped(b, CANADA, () => {
    b.floor(
      'waterfront-canada-north-concourse',
      [-3, -9, 8],
      14,
      10,
      'concourse',
    );
    b.room('waterfront-canada-north-concourse', [-3, -9, 8], 14, 10, {
      height: 3.6,
      material: 'white',
      doors: { west: [[-4, 4]], east: [[-3, 3]] },
    });
    b.fareGates(
      'waterfront-canada-north-fares',
      [-3, -9, 8],
      [-3.55, -1.75, 0, 1.75, 3.55],
      90,
    );
    for (const [suffix, z, width, kind] of [
      ['stairs', 6.5, 2.1, 'stairs'],
      ['up', 8.5, 1.05, 'escalator'],
      ['down', 10, 1.05, 'escalator'],
    ])
      b.flight(
        `waterfront-canada-north-${String(suffix)}`,
        'waterfront-canada-north-concourse',
        'waterfront-canada',
        [4, -9, z],
        [15, -13, z],
        width,
        { kind, enclosed: false },
      );
    b.shaft('waterfront-canada-north-bank', [4, -9, 8], [15, -13, 8], 5.4, {
      material: 'white',
      height: 3.2,
    });
    b.floor('waterfront-canada-lift-lower', [1, -13, 11], 3, 4, 'lift-landing');
    const liftHall = flatSegment(
      b,
      'waterfront-canada-lift-passage',
      [2, -13, 11.5],
      [10, -13, 11.5],
      // The fixed tunnel wall's inner face is Z11.95. Keep this inferred
      // aisle on its island side, with 0.9m between the actual sidewalls;
      // the previous Z12 centreline ran inside that train-protection wall.
      1.1,
      { height: 2.9 },
    );
    b.walk(
      'canada-lift-lower-passage',
      'waterfront-canada-lift-lower',
      liftHall,
      [2, -13, 11.5],
    );
    b.walk(
      'canada-lift-passage-platform',
      liftHall,
      'waterfront-canada',
      [10, -13, 11.5],
    );
    b.elevator(
      'waterfront-canada-north-lift',
      'waterfront-canada-north-concourse',
      'waterfront-canada-lift-lower',
      [1, -9, 10],
      [1, -13, 10],
    );
    b.floor(
      'waterfront-canada-south-concourse',
      [67, -9, 8],
      6,
      10,
      'concourse',
    );
    b.room('waterfront-canada-south-concourse', [67, -9, 8], 6, 10, {
      height: 3.6,
      material: 'white',
      doors: { east: [[-4, 4]], west: [[-4.5, 4.5]] },
    });
    b.fareGates(
      'waterfront-canada-south-fares',
      [67, -9, 8],
      [-3.55, -1.75, 0, 1.75, 3.55],
      90,
    );
    for (const [suffix, z, width, kind] of [
      ['stairs', 6.6, 2.1, 'stairs'],
      ['up', 9, 1.1, 'escalator'],
    ])
      b.flight(
        `waterfront-canada-south-${String(suffix)}`,
        'waterfront-canada-south-concourse',
        'waterfront-canada',
        [64, -9, z],
        [53, -13, z],
        width,
        { kind, enclosed: false },
      );
    b.shaft('waterfront-canada-south-bank', [64, -9, 8], [53, -13, 8], 5.4, {
      material: 'white',
      height: 3.2,
    });
    // The separate street lift reaches this paid concourse; a second core
    // descends inside the island. Keep the upper bypass above the railway,
    // never route a flat platform-level corridor across a running track.
    const southLiftUpper = b.floor(
      'waterfront-canada-south-lift-upper',
      [50.8, -9, 8],
      3,
      3,
      'lift-landing',
    );
    const southLiftAisles = passage(
      b,
      'waterfront-canada-south-lift-upper-aisle',
      [
        [64, -9, 11.8],
        [50.8, -9, 11.8],
        [50.8, -9, 9.1],
      ],
      2.0,
      { height: 2.9 },
    );
    b.walk(
      'canada-south-concourse-lift-bypass',
      'waterfront-canada-south-concourse',
      southLiftAisles[0],
      [64, -9, 11.8],
    );
    b.walk(
      'canada-south-bypass-lift-door',
      southLiftAisles.at(-1),
      southLiftUpper,
      [50.8, -9, 9.1],
    );
    b.elevator(
      'waterfront-canada-south-platform-lift',
      southLiftUpper,
      'waterfront-canada',
      [50.8, -9, 8],
      [50.8, -13, 8],
    );
    b.sign(
      'Canada Line ↓  Platforms 3 · 4',
      [-3, -6.5, 8],
      Math.PI / 2,
      5,
      0.42,
      '#007d9f',
    );
    b.sign('Exit ↑ Granville Street', [67, -6.5, 8], -Math.PI / 2, 5, 0.42);
  });

  // The heritage bank follows the two separately mapped present escalators.
  // Its 3 m section is inferred; horizontal endpoints are map-backed.
  const arrival = b.floor(
    'waterfront-canada-transfer-arrival-0',
    [-15, -3, -38.925],
    14,
    3.85,
    'landing',
  );
  b.room(
    'waterfront-canada-transfer-arrival-room',
    [-15, -3, -38.925],
    14,
    3.85,
    {
      height: 3.2,
      material: 'white',
      doors: {
        north: [
          [-6.8, 3.55],
          [5.9, 7],
        ],
        south: [[-3.58, 2.5]],
        east: [[-1.925, 1.2]],
      },
    },
  );
  const lobbyBankStart = vec([-15.13, 0, -46.74]),
    lobbyBankEnd = vec([-16.37, -3, -41.36]),
    lobbyBankDirection = lobbyBankEnd
      .clone()
      .sub(lobbyBankStart)
      .setY(0)
      .normalize(),
    lobbyBankYaw =
      (Math.atan2(lobbyBankDirection.x, lobbyBankDirection.z) * 180) / Math.PI;
  // The three separately mapped flights share full-width structural landings.
  // Their staggered ends must not expose holes between the narrower lanes.
  // These flat caps stop before the first tread / begin after the last tread.
  const lobbyUpperCap = b.floor(
      'waterfront-canada-lobby-full-bank-upper-landing',
      tuple(lobbyBankStart.clone().addScaledVector(lobbyBankDirection, -1)),
      10,
      1.8,
      'landing',
      undefined,
      'floor',
      lobbyBankYaw,
    ),
    lobbyLowerCap = b.floor(
      'waterfront-canada-lobby-full-bank-lower-landing',
      tuple(lobbyBankEnd.clone().addScaledVector(lobbyBankDirection, 1.64)),
      10,
      3.12,
      'landing',
      undefined,
      'floor',
      lobbyBankYaw,
    );
  b.walk(
    'canada-lobby-full-bank-arrival',
    lobbyLowerCap,
    arrival,
    [-16.7, -3, -39.9],
  );
  for (const [suffix, a, z, width, kind] of [
    ['stairs', [-18.6, 0, -47.5], [-19.84, -3, -42.12], 2.1, 'stairs'],
    [
      'up',
      [-11.68949664, 0, -45.98483322],
      [-12.93179158, -3, -40.61191279],
      1.1,
      'escalator',
    ],
    [
      'down',
      [-15.2059548, 0, -46.73661463],
      [-16.43496255, -3, -41.36338208],
      1.1,
      'escalator',
    ],
  ]) {
    const flightDirection = vec(z).sub(vec(a)).setY(0).normalize(),
      finish = tuple(
        vec(z).addScaledVector(
          flightDirection,
          (-39.35 - z[2]) / flightDirection.z,
        ),
      ),
      d = vec(finish).sub(vec(z)).setY(0),
      center = vec(z).add(vec(finish)).multiplyScalar(0.5);
    const landing = b.floor(
      `waterfront-canada-lobby-${String(suffix)}-landing`,
      center.toArray(),
      width + 1,
      d.length() + 0.1,
      'landing',
      undefined,
      'floor',
      (Math.atan2(d.x, d.z) * 180) / Math.PI,
    );
    const tangent = vec(z).sub(vec(a)).setY(0).normalize();
    const upperLanding = b.floor(
      `waterfront-canada-lobby-${String(suffix)}-upper-landing`,
      tuple(vec(a).addScaledVector(tangent, -0.93)),
      width + 1,
      2.14,
      'landing',
      undefined,
      'floor',
      (Math.atan2(tangent.x, tangent.z) * 180) / Math.PI,
    );
    b.walk(
      `waterfront-canada-lobby-${String(suffix)}-upper-infill`,
      lobbyUpperCap,
      upperLanding,
      tuple(vec(a).addScaledVector(tangent, -0.93)),
    );
    b.walk(
      `waterfront-canada-lobby-${String(suffix)}-lower-infill`,
      landing,
      lobbyLowerCap,
      tuple(vec(z).addScaledVector(tangent, 0.55)),
    );
    b.walk(
      `waterfront-canada-lobby-${String(suffix)}-hall`,
      'waterfront-heritage-hall',
      upperLanding,
      tuple(vec(a).addScaledVector(tangent, -1.9)),
    );
    b.flight(
      `waterfront-canada-lobby-${String(suffix)}`,
      upperLanding,
      landing,
      a,
      z,
      width,
      { kind, enclosed: false },
    );
    b.walk(
      `waterfront-canada-lobby-${String(suffix)}-arrival`,
      landing,
      arrival,
      finish,
    );
  }
  b.shaft(
    'waterfront-canada-lobby-bank',
    [-15.13, 0, -46.74],
    [-16.37, -3, -41.36],
    10,
    { material: 'white', height: 3.2 },
  );
  // Turn the short outer shaft wall into the arrival room; the opposite
  // end already overlaps it. Keep the separate lift approach open at X=-8.
  const lobbyReturn = b.beam(
    'waterfront-canada-lobby-left-arrival-return',
    [-21.34, -1.4, -42.5],
    [-21.8, -1.4, -40.7],
    0.22,
    3.2,
    'white',
    'wall',
  );
  b.s.obstacles.push({
    ...structuredClone(
      b.s.geometryParts.find((part) => part.id === lobbyReturn),
    ),
    type: 'oriented-box',
  });
  b.floor(
    'waterfront-canada-cordova-lift-lower',
    [-8, -3, -46.1],
    2.2,
    2.2,
    'lift-landing',
  );
  const cordovaLiftHall = flatSegment(
    b,
    'waterfront-canada-cordova-lift-hall',
    [-8, -3, -45],
    [-8, -3, -40.7],
    2.2,
    { height: 2.8 },
  );
  b.walk(
    'cordova-lift-lower-hall',
    'waterfront-canada-cordova-lift-lower',
    cordovaLiftHall,
    [-8, -3, -45],
  );
  const cordovaLiftCross = b.floor(
    'waterfront-canada-cordova-lift-cross-0',
    [-11.25, -3, -39.95],
    6.5,
    1.5,
    'landing',
  );
  notchLandingAtSolid(
    b,
    cordovaLiftCross,
    'waterfront-canada-lobby-bank-underslab',
  );
  b.walk(
    'cordova-lift-hall-cross',
    cordovaLiftHall,
    cordovaLiftCross,
    [-8, -3, -40.7],
  );
  b.walk(
    'cordova-lift-cross-arrival',
    cordovaLiftCross,
    arrival,
    [-14.5, -3, -39.4],
  );
  b.floor(
    'waterfront-canada-cordova-lift-upper',
    [-8, 0, -46.8],
    2.4,
    4,
    'lift-landing',
  );
  b.walk(
    'cordova-lift-upper-hall',
    'waterfront-canada-cordova-lift-upper',
    'waterfront-heritage-hall',
    [-8, 0, -48],
  );
  b.elevator(
    'waterfront-canada-cordova-lift',
    'waterfront-canada-cordova-lift-upper',
    'waterfront-canada-cordova-lift-lower',
    [-8, 0, -46.1],
    [-8, -3, -46.1],
  );
  const mapped = [
    [-15.01915162, -39.22525136],
    [-22.59904355, -5.4576624],
    [-2.27888302, 6.71813212],
    [25.10278165, 14.81963887],
  ];
  const lengths = mapped
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - mapped[i][0], p[1] - mapped[i][1])),
    total = lengths.reduce((a, v) => a + v, 0);
  let travelled = 0;
  const graded = mapped.map((p, i) => {
    if (i) travelled += lengths[i - 1];
    return [p[0], -3 + (3.251 * travelled) / total, p[1]];
  });
  const northDoor = canadaFrame.point([-10, -9, 8]);
  const cordovaSurfaces = passage(
    b,
    'waterfront-under-cordova-passage',
    [...graded, northDoor],
    6,
    {
      height: 3.25,
      material: 'white',
      startEnclosureZ: -37,
      flatStartUntilZ: -37,
    },
  );
  const underCordova = cordovaSurfaces.slice(0, 3),
    northApproach = cordovaSurfaces[3],
    arrivalFlatRunM =
      lengths[0] * ((-37 - graded[0][2]) / (graded[1][2] - graded[0][2]));
  b.walk('canada-arrival-to-passage', arrival, underCordova[0], graded[0]);
  b.walk(
    'canada-approach-north-fares',
    northApproach,
    'waterfront-canada-north-concourse',
    northDoor,
  );
  b.sign('Expo Line / Cordova Street ↑', [-15, -0.4, -28], Math.PI, 5, 0.4);

  // Granville/Hastings bank uses the actual street door and mapped escalator
  // run. The 42/24 first-hand count fixes the section, without claiming survey.
  const granville = [145.27957733, 7.2513, 46.07056249],
    upperEsc = [142.47905401, 7.2513, 45.8405247],
    bottomEsc = [128.22495091, 0.2513, 42.31796692];
  const gd = vec(bottomEsc).sub(vec(upperEsc)).setY(0).normalize(),
    gl = new THREE.Vector3(gd.z, 0, -gd.x);
  const granvilleEntry = flatSegment(
    b,
    'waterfront-granville-pavilion',
    tuple(vec(granville).addScaledVector(gd, -2)),
    tuple(vec(granville).addScaledVector(gd, 3.0)),
    8.4,
    { height: 3.7, material: 'glass' },
  );
  b.entrance(
    'granville-canada',
    'Granville / Hastings · Canada Line',
    granvilleEntry,
    granville,
  );
  b.s.entrances.at(-1).inwardDirectionM = tuple(gd);
  const granvilleArrivalCenter = tuple(
    vec(bottomEsc).addScaledVector(gd, 5.25).addScaledVector(gl, 1.4),
  );
  const granvilleArrival = b.floor(
    'waterfront-granville-concourse-arrival',
    granvilleArrivalCenter,
    6.2,
    6.9,
    'concourse',
    undefined,
    'floor',
    (Math.atan2(gd.x, gd.z) * 180) / Math.PI,
  );
  scoped(
    b,
    {
      origin: [0, 0, 0],
      centre: granvilleArrivalCenter,
      yaw: (Math.atan2(gd.x, gd.z) * 180) / Math.PI,
    },
    () =>
      b.room('waterfront-granville-arrival-room', [0, 0, 0], 6.2, 6.9, {
        height: 3.6,
        material: 'white',
        doors: {
          north: [[-3.1, 3.1]],
          west: [[-2.55, 2.85]],
          east: [[-0.1, 2.6]],
        },
      }),
  );
  const stairTop = tuple(vec(upperEsc).addScaledVector(gl, 2.4)),
    stairBottom = tuple(vec(bottomEsc).addScaledVector(gl, 2.4));
  for (const [suffix, top, bottom, width, kind] of [
    ['stairs', stairTop, stairBottom, 2.2, 'stairs'],
    ['up', upperEsc, bottomEsc, 1.1, 'escalator'],
  ]) {
    const end = tuple(vec(bottom).addScaledVector(gd, 2));
    const landing = b.floor(
      `waterfront-granville-${String(suffix)}-lower-landing`,
      pointAlong(bottom, end, 0.5),
      width + 1,
      2.1,
      'landing',
      undefined,
      'floor',
      (Math.atan2(gd.x, gd.z) * 180) / Math.PI,
    );
    b.flight(
      `waterfront-granville-${String(suffix)}`,
      granvilleEntry,
      landing,
      top,
      bottom,
      width,
      { kind, enclosed: false },
    );
    b.walk(
      `waterfront-granville-${String(suffix)}-arrival`,
      landing,
      granvilleArrival,
      end,
    );
  }
  b.shaft(
    'waterfront-granville-bank',
    pointAlong(stairTop, upperEsc, 0.5),
    pointAlong(stairBottom, bottomEsc, 0.5),
    5.8,
    { material: 'white', height: 3.2 },
  );
  const southDoor = canadaFrame.point([70, -9, 8]);
  const southMouth = tuple(
    vec(bottomEsc).addScaledVector(gd, 5.4).addScaledVector(gl, -1.7),
  );
  const southApproach = flatSegment(
    b,
    'waterfront-canada-south-approach',
    southMouth,
    southDoor,
    5.4,
    { height: 3.6 },
  );
  b.walk(
    'granville-arrival-south-approach',
    granvilleArrival,
    southApproach,
    southMouth,
  );
  b.walk(
    'granville-approach-south-fares',
    southApproach,
    'waterfront-canada-south-concourse',
    // Keep the route goal inside the shared floor overlap, so a complete
    // passenger body can reach it around the angled corridor corner.
    canadaFrame.point([70, -9, 8.2]),
  );
  // Independent public Granville lift entrance; its reference is the mapped
  // outside portal rather than the stair pavilion 24 m farther southeast.
  const liftDoor = [120.94296098, 6.7454303, 45.88823269],
    liftCentre = [120.94296098, 6.7454303, 44.73823269];
  b.floor(
    'waterfront-granville-lift-street',
    [120.94296098, 6.7454303, 45.33823269],
    2.4,
    3.4,
    'lift-landing',
  );
  b.entrance(
    'granville-canada-lift',
    'Granville Street · Canada Line elevator',
    'waterfront-granville-lift-street',
    liftDoor,
  );
  b.s.entrances.at(-1).inwardDirectionM = [0, 0, -1];
  b.floor(
    'waterfront-granville-lift-concourse',
    [120.94296098, 0.2513, 44.73823269],
    2.4,
    2.4,
    'lift-landing',
  );
  b.elevator(
    'waterfront-granville-street-lift',
    'waterfront-granville-lift-street',
    'waterfront-granville-lift-concourse',
    liftCentre,
    [120.94296098, 0.2513, 44.73823269],
  );
  b.walk(
    'granville-lift-concourse-door',
    'waterfront-granville-lift-concourse',
    granvilleArrival,
    [122.04296098, 0.2513, 44.73823269],
  );
  b.sign(
    'Waterfront · Canada Line',
    [143.9, 9.8, 46],
    Math.PI / 2,
    5,
    0.5,
    '#007d9f',
  );

  const architectureStart = {
    parts: b.s.geometryParts.length,
    obstacles: b.s.obstacles.length,
    signs: b.s.interiorSigns.length,
  };
  // Observed platform architecture. These structural panels stay present in
  // first person; the renderer clips upper fragments for the overhead avatar.
  for (const x of [-32.2, -15.8])
    b.box(
      'expo-track-wall-' + x,
      [x, -5.875, 0],
      [0.22, 5.15, 78],
      'acoustic',
      'wall',
    );
  for (let z = -27; z <= 30; z += 12) {
    b.box(
      'waterfront-expo-column-' + z,
      [-24, -5.35, z],
      [0.8, 3.3, 0.95],
      'cream',
      'column',
      0,
      true,
    );
    b.sign('Waterfront', [-23.57, -4.8, z], Math.PI / 2, 2, 0.32, '#ece9dc');
  }
  for (const x of [-26.5, -21.5])
    b.box(
      'expo-long-light-' + x,
      [x, -3.65, 0],
      [0.17, 0.06, 72],
      'light',
      'ceiling',
    );
  for (const z of [-20, 16])
    b.bench('waterfront-expo-' + z, [-24, -7, z], 2.4, 90);
  for (const z of [-0.4, 16.4]) {
    b.box(
      'canada-dark-track-wall-' + z,
      [32, -11.575, z],
      [48, 5.95, 0.22],
      'acoustic',
      'wall',
    );
    b.box(
      'canada-wall-light-' + z,
      [32, -9.8, z],
      [44, 0.06, 0.12],
      'light',
      'ceiling',
    );
  }
  for (let x = 12; x <= 52; x += 1.5)
    b.box(
      'canada-floor-joint-' + x,
      [x, -12.994, 8],
      [0.014, 0.008, 6],
      'tile',
      'detail',
    );
  for (const z of [6.5, 8, 9.5])
    b.box(
      'canada-floor-long-joint-' + z,
      [32, -12.994, z],
      [44, 0.008, 0.014],
      'tile',
      'detail',
    );
  for (let x = 19; x < 40; x += 9) {
    b.box(
      'waterfront-canada-column-' + x,
      [x, -11.3, 8],
      [0.5, 3.4, 0.5],
      'white',
      'column',
      0,
      true,
    );
    b.box(
      'waterfront-canada-column-band-' + x,
      [x, -10.7, 8],
      [0.51, 0.22, 0.51],
      'canada',
      'detail',
    );
    b.sign('Waterfront', [x, -10.3, 8], Math.PI / 2, 2.6, 0.4, '#007d9f');
  }
  b.bench('waterfront-canada', [32, -13, 8], 2.4, 0, { material: 'steel' });
  for (let x = 13; x < 54; x += 4)
    b.box(
      'canada-ceiling-grid-' + x,
      [x, -9.48, 8],
      [0.035, 0.03, 12],
      'steel',
      'ceiling',
    );
  for (const z of [3, 5, 7, 9, 11, 13])
    b.box(
      'canada-ceiling-long-grid-' + z,
      [32, -9.48, z],
      [44, 0.03, 0.035],
      'steel',
      'ceiling',
    );
  for (let x = 16; x < 54; x += 6)
    b.box(
      'canada-hung-light-' + x,
      [x, -9.7, 8],
      [3.8, 0.06, 0.2],
      'light',
      'ceiling',
    );
  for (const p of b.s.geometryParts) {
    if (p.role === 'trackbed') p.material = 'ballast';
    if (p.id.startsWith('floor-waterfront-expo')) p.material = 'warmfloor';
    if (p.id === 'waterfront-expo-ceiling') p.material = 'panel';
  }
  b.box(
    'waterfront-expo-structural-base',
    [-24, -8.55, 0],
    [17, 0.24, 84],
    'ballast',
    'floor',
  );
  b.box(
    'waterfront-canada-structural-base',
    [32, -14.65, 8],
    [50, 0.24, 18],
    'ballast',
    'floor',
  );
  for (let z = -31; z < 37; z += 2) {
    b.box(
      'expo-floor-grout-' + z,
      [-24, -6.993, z],
      [8.6, 0.008, 0.012],
      'tile',
      'detail',
    );
    b.box(
      'expo-ceiling-panel-joint-' + z,
      [-24, -3.505, z],
      [16.6, 0.025, 0.025],
      'steel',
      'ceiling',
    );
  }
  for (const x of [-27, -25, -23, -21])
    b.box(
      'expo-floor-long-grout-' + x,
      [x, -6.993, 0],
      [0.012, 0.008, 74],
      'tile',
      'detail',
    );
  // The framed poster rhythm and service duct are visible in the real track
  // wall photograph. Artwork is original neutral geometry, not copied adverts.
  for (const x of [-32.05, -15.95])
    for (let z = -29; z < 33; z += 3.2) {
      b.box(
        `expo-ad-frame-${x}-${z}`,
        [x, -5.5, z],
        [0.08, 1.85, 1.35],
        'black',
        'detail',
      );
      b.box(
        `expo-ad-art-${x}-${z}`,
        [x + (x < -24 ? 0.05 : -0.05), -5.5, z],
        [0.025, 1.64, 1.14],
        Math.round(z) % 2 ? 'poster' : 'cream',
        'detail',
      );
    }
  for (const z of [-0.25, 16.25])
    for (let x = 13; x < 53; x += 3.3) {
      b.box(
        `canada-ad-frame-${z}-${x}`,
        [x, -11.2, z],
        [1.5, 1.8, 0.08],
        'black',
        'detail',
      );
      b.box(
        `canada-ad-art-${z}-${x}`,
        [x, -11.2, z + (z < 8 ? 0.05 : -0.05)],
        [1.3, 1.6, 0.025],
        Math.round(x) % 2 ? 'poster' : 'cream',
        'detail',
      );
    }
  for (const p of b.s.platforms) {
    const q = new THREE.Quaternion(...p.stopPosition.rotationQuaternionXYZW),
      stop = new THREE.Vector3(...p.stopPosition.translationM),
      at = (x, y, z) =>
        new THREE.Vector3(x, y - stop.y, z)
          .applyQuaternion(q)
          .add(stop)
          .toArray();
    for (const end of [-1, 1]) {
      const z = end * (p.lengthM / 2 + 24);
      for (const side of [-1, 1])
        b.box(
          `${p.platformId}-portal-wall-${end}-${side}`,
          at(side * 1.95, p.floorHeightM + 1.45, z),
          [0.2, 3.8, 48],
          'acoustic',
          'wall',
          0,
          true,
          q.toArray(),
        );
      b.box(
        `${p.platformId}-portal-roof-${end}`,
        at(0, p.floorHeightM + 3.4, z),
        [4.1, 0.2, 48],
        'acoustic',
        'ceiling',
        0,
        false,
        q.toArray(),
      );
      b.box(
        `${p.platformId}-portal-base-${end}`,
        at(0, p.railHeightM - 0.35, z),
        [4.1, 0.2, 48],
        'ballast',
        'floor',
        0,
        false,
        q.toArray(),
      );
    }
  }
  b.sign('Platform 1 / 2  ·  Expo Line', [-24, -4.4, 4], 0, 5, 0.45, '#004b7d');
  b.sign(
    'Platform 3 / 4  ·  Canada Line',
    [32, -10.4, 8],
    Math.PI / 2,
    5,
    0.45,
    '#007d9f',
  );
  const architectureIds = new Set(
    b.s.geometryParts.slice(architectureStart.parts).map((p) => p.id),
  );
  // Open both the visible slab and passenger triangle mesh at the real
  // platform wells. The surviving side strips stay connected to every door.
  carveFloorRect(b.s, 'waterfront-canada', {
    minX: 4,
    maxX: 15,
    minZ: 5.1,
    maxZ: 10.9,
  });
  carveFloorRect(b.s, 'waterfront-canada', {
    minX: 53,
    maxX: 64,
    minZ: 5.1,
    maxZ: 10.9,
  });
  ceilingOpening(b, 'waterfront-canada-ceiling', {
    minX: 3.7,
    maxX: 16,
    minZ: 5,
    maxZ: 11.1,
  });
  for (const p of [...b.s.geometryParts].filter((p) =>
    p.id.startsWith('waterfront-canada-ceiling-opening-'),
  ))
    ceilingOpening(b, p.id, { minX: 52.6, maxX: 64.3, minZ: 5, maxZ: 11.1 });
  for (const p of [...b.s.geometryParts].filter((p) =>
    p.id.startsWith('waterfront-canada-ceiling-opening-'),
  ))
    ceilingOpening(b, p.id, {
      minX: 49.55,
      maxX: 52.05,
      minZ: 6.75,
      maxZ: 9.25,
    });
  for (const cut of [
    { minX: 49.55, maxX: 52.05, minZ: 6.75, maxZ: 9.25 },
    { minX: 3.7, maxX: 16, minZ: 5, maxZ: 11.1 },
    { minX: 52.6, maxX: 64.3, minZ: 5, maxZ: 11.1 },
  ]) {
    for (const p of [...b.s.geometryParts].filter(
      (p) =>
        p.id.startsWith('canada-') &&
        (p.role === 'ceiling' || p.id.startsWith('canada-floor-')),
    )) {
      const before = b.s.geometryParts.length;
      ceilingOpening(b, p.id, cut);
      if (b.s.geometryParts.length !== before || !b.s.geometryParts.includes(p))
        for (const part of b.s.geometryParts.filter((part) =>
          part.id.startsWith(p.id + '-opening-'),
        ))
          architectureIds.add(part.id);
    }
  }
  // Artwork, structural slabs and both complete boarding contracts receive
  // exactly the same rigid edit. Moving the room without its rails/thresholds
  // would silently break the validated station-to-car interface.
  for (const [line, spec] of Object.entries({ expo: EXPO, canada: CANADA })) {
    const { point, q } = frame(spec);
    boardingTransform(
      b.s,
      line,
      point,
      q,
      spec.centre[1] - spec.origin[1],
      trainPartIds,
    );
    for (const p of b.s.geometryParts.filter(
      (p) => architectureIds.has(p.id) && p.id.includes(line),
    ))
      transformBox(p, point, q);
    for (const p of b.s.obstacles
      .slice(architectureStart.obstacles)
      .filter((p) => p.id.includes(line)))
      transformBox(p, point, q);
  }
  for (const sign of b.s.interiorSigns.slice(architectureStart.signs)) {
    const spec = sign.position[1] < -8 ? CANADA : EXPO,
      { point } = frame(spec);
    sign.position = point(sign.position);
    sign.yaw += (spec.yaw * Math.PI) / 180;
  }
  b.s.transferRoutes = [
    {
      id: 'expo-to-canada-via-heritage-hall',
      fromStationLineId: 'waterfront:expo',
      toStationLineId: 'waterfront:canada',
      viaSurfaceIds: [
        'waterfront-expo',
        'waterfront-expo-east-landing',
        'waterfront-heritage-hall',
        'waterfront-canada-transfer-arrival-0',
        ...underCordova,
        northApproach,
        'waterfront-canada-north-concourse',
        'waterfront-canada',
      ],
      connectionGraphAuthoritative: true,
      status:
        'Mapped public heritage-hall transfer with independent paid concourses; grade and unmeasured interior clearances inferred',
    },
  ];
  b.s.authoredInterior.mappedHorizontalBasis = {
    datumLonLat: [...PRIMARY.lonlat],
    datumPointM: [...PRIMARY.point],
    primaryDoorReference: PRIMARY.reference,
    primaryDoorSourceTag: 'survey',
    legacyUnreferencedDatumLonLat: [-123.111986, 49.285624],
    legacyDatumPointM: [0, 0, -68],
    sourceHorizontalGeometryRebase:
      'Only the primary threshold changes; all secondary doors, platforms and track assemblies retain their source X/Z coordinates so the new geographic anchor/rebase preserves their world position',
    runtimeGroupYawDegrees: -121.770113891,
    expoIslandPolygonWays: [87223387, 783525511],
    expoIslandMappedLengthM: 79.9,
    expoMappedApproximateYawDegrees: -0.1683,
    expoPlatformSourceYawDegrees: 0,
    expoOrientationBasis:
      'Retain the established GTFS tangent and fixed geographic station frame; approximate OSM polygon differs by 0.168 degrees, about 23 cm over 80 m',
    expoActiveBoardingLengthM: 74,
    canadaStationBoxWay: 379828985,
    canadaBoxLengthM: 85.4,
    canadaActiveBoardingLengthM: 44,
    canadaActiveExtent:
      '44 m retained boarding profile placed toward the Hastings/Granville end of the mapped box; exact active/reserve boundary inferred',
    howeUpperStairWay: 379737506,
    howeLowerStairWay: 689601479,
    howePlatformTunnelWay: 379737505,
    underCordovaWay: 358464785,
  };
  b.s.authoredInterior.verticalInference = {
    status:
      'Integrated photo/step-count/terrain section; not surveyed interior floor elevations',
    datumGroundDemM: 13.1056,
    howeStreetGroundDemM: 15.2975,
    granvilleStreetGroundDemM: 20.3569,
    granvilleLiftGroundDemM: 19.851039,
    howeStreetYM: 2.1919,
    howeMiddleLandingYM: -2.2,
    expoPlatformYM: -7,
    granvilleStreetYM: 7.2513,
    granvilleLiftStreetYM: 6.7454303,
    canadaConcourseYM: 0.2513,
    canadaPlatformYM: -3.749,
    granvilleUpperRisers: 42,
    canadaLowerRisers: 24,
    canadaNorthRiserCountBasis:
      '24 is the representative shared section; the first-hand 2024 count directly documents the Granville/south route, not an independent north-bank measurement.',
    heritageBankDropM: 3,
    underCordovaRunM: total,
    underCordovaRiseM: 3.251,
    underCordovaGradePercent: (100 * 3.251) / total,
    underCordovaGradeBasis:
      'Mean rise over the mapped run; the overlap inside the transfer arrival room remains level through its real portal.',
    underCordovaLevelArrivalRunM: arrivalFlatRunM,
    underCordovaFirstRampGradePercent:
      (100 * (graded[1][1] - graded[0][1])) / (lengths[0] - arrivalFlatRunM),
    canadaNorthLiftAisle: {
      localCenterZ: 11.5,
      clearWidthM: 0.9,
      fixedTunnelWallInnerFaceZ: 11.95,
      status:
        'Representative island-side aisle section; its two walking anchors remain on the passenger side of the retained train-protection wall. Cabin and boarding geometry stay fixed; exact corridor offset is not surveyed.',
    },
    limitations:
      'Ground DEM is not a basement survey. The 42/24 first-hand count constrains a 7/4 m stair section. The mapped under-Cordova passage has a level overlap within the arrival room, then a continuous inferred ramp to reconcile that section with the photographed heritage descent; local gradients and room offsets are not surveyed.',
  };
  b.s.authoredInterior.unverifiedDetails = [
    'Howe fare-boundary exact offset is representative; its five lanes and six housings follow the first-hand 2018 photograph, and the mall branch remains unpaid.',
    'Howe lower escalator side, middle-landing elevations and unmeasured widths are representative; its two-bank topology, upper central stair/flanking escalators and mall-left branch are reference-backed.',
    'Canada platform active/reserve boundary within the longer mapped station box is inferred; the complete 44 m boarding assembly remains rigid.',
    'Granville street-to-concourse and concourse-to-island lift cores are separate so the accessible route never crosses tracks at platform height. The interior island-core position is inferred.',
    'Cordova Canada lift cabin is placed beside the mapped escalator bank with a short enclosed bypass; cabin footprint and precise lower portal require an as-built survey.',
    'Poster artwork is original neutral geometry. Commercial mall interiors beyond the documented Howe access mouth are not reconstructed; its opaque scope closure is an inferred model boundary, not a surveyed commercial doorway.',
  ];
  b.s.provenance.depthStatus = b.s.authoredInterior.verticalInference.status;
  return rebaseVerticalDatum(b.finish({ encloseElevators: true }));
}

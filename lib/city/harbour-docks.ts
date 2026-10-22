import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import type { Feature, FeatureCollection } from './types';
import { project, rings, lines } from './geo';

/** Geography remains the committed OSM snapshot. The operator confirms cement
 * floats; panel joints, edge colours and small cleats are original visual
 * interpretations, not surveyed fittings or new navigable surfaces. */
export const HARBOUR_DOCK_REFERENCES = [
  'https://coalharbourmarina.com/annual-moorage/',
  'https://coalharbourmarina.com/contact-us/',
  'https://www.openstreetmap.org/way/41742497',
] as const;
export const HARBOUR_DOCK_LIMITS = {
  width: 1.4, // Existing display estimate for OSM line piers; not a measured width.
  topY: 1.6,
  bottomY: 0.2,
  maxSegments: 80,
  maxPanelsPerSegment: 64,
  maxCleats: 48,
  maxAddedTriangles: 24_000,
} as const;
type Point = [number, number];
type Vec3 = [number, number, number];
interface Mooring {
  marinaSourceId: number;
  pierSourceId: number;
  coordinate: number[];
}
interface Sites {
  illustrativeMoorings?: Mooring[];
}
export interface MarinaDockSegment {
  sourceId: number;
  lineIndex: number;
  segmentIndex: number;
  a: Point;
  b: Point;
  x: number;
  z: number;
  yaw: number;
  length: number;
}
export interface MarinaDockCleat {
  sourceId: number;
  segmentIndex: number;
  lineIndex: number;
  x: number;
  z: number;
  yaw: number;
  side: number;
  station: number;
}

export function hullPolygon(
  x: number,
  z: number,
  yaw: number,
  length: number,
  width: number,
) {
  const fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    rx = Math.cos(yaw),
    rz = -Math.sin(yaw);
  return [
    [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ].map(([a, b]) => [
      x + (fx * a * length) / 2 + (rx * b * width) / 2,
      z + (fz * a * length) / 2 + (rz * b * width) / 2,
    ]),
  ];
}

function projectedSegments(feature: Feature): MarinaDockSegment[] {
  if (!feature.geometry.type.endsWith('LineString')) return [];
  return lines(feature).flatMap((line, lineIndex) => {
    const points = line.map(project);
    return points.slice(1).map((b, index) => {
      const a = points[index];
      return {
        sourceId: Number(feature.properties.sourceId),
        lineIndex,
        segmentIndex: index + 1,
        a,
        b,
        x: (a[0] + b[0]) / 2,
        z: (a[1] + b[1]) / 2,
        yaw: Math.atan2(b[0] - a[0], b[1] - a[1]),
        length: Math.hypot(b[0] - a[0], b[1] - a[1]),
      };
    });
  });
}
const segmentKey = (
  s: Pick<MarinaDockSegment, 'sourceId' | 'lineIndex' | 'segmentIndex'>,
) => `${s.sourceId}:${s.lineIndex}:${s.segmentIndex}`;

function nearest(point: Point, segment: MarinaDockSegment) {
  const dx = segment.b[0] - segment.a[0],
    dz = segment.b[1] - segment.a[1],
    t = THREE.MathUtils.clamp(
      ((point[0] - segment.a[0]) * dx + (point[1] - segment.a[1]) * dz) /
        segment.length ** 2,
      0,
      1,
    );
  return {
    t,
    distance: Math.hypot(
      point[0] - segment.a[0] - t * dx,
      point[1] - segment.a[1] - t * dz,
    ),
  };
}

/** Only the five source piers already linked to Coal Harbour's authored
 * moorings are eligible. Flight terminals, fuel pontoons, public no-mooring
 * piers and polygon wharves retain their original mesh. */
export function planMarinaDockDetails(piers: FeatureCollection, sites: Sites) {
  const moorings = (sites.illustrativeMoorings ?? []).filter(
    (m) =>
      m.marinaSourceId === 41742497 &&
      m.coordinate.length >= 2 &&
      m.coordinate.every(Number.isFinite),
  );
  const pierIds = new Set(moorings.map((m) => m.pierSourceId));
  const allSegments = piers.features
    .flatMap(projectedSegments)
    .filter((s) => Number.isFinite(s.length) && s.length >= 0.1);
  const eligible = new Set(
    piers.features
      .filter((f) => {
        const p = f.properties;
        return (
          pierIds.has(Number(p.sourceId)) &&
          p.man_made === 'pier' &&
          p.sourceType === 'way' &&
          !['no', 'commercial'].includes(p.mooring) &&
          !p.aeroway &&
          !p.waterway &&
          p.highway !== 'footway' &&
          f.geometry.type.endsWith('LineString') &&
          // Restrict this operator/material interpretation to its source marina.
          lines(f).every((line) =>
            line.every(
              ([lon, lat]) =>
                lon > -123.129 && lon < -123.123 && lat > 49.29 && lat < 49.293,
            ),
          )
        );
      })
      .map((f) => Number(f.properties.sourceId)),
  );
  const segments = allSegments
    .filter((s) => eligible.has(s.sourceId) && s.length >= 4 && s.length <= 160)
    .slice(0, HARBOUR_DOCK_LIMITS.maxSegments);
  const cleats: MarinaDockCleat[] = [];
  for (const mooring of moorings) {
    const point = project(mooring.coordinate);
    const candidates = segments
      .filter((s) => s.sourceId === mooring.pierSourceId)
      .map((s) => ({ s, ...nearest(point, s) }))
      .sort((a, b) => a.distance - b.distance);
    const candidate = candidates[0];
    if (!candidate || candidate.distance > 12) continue;
    const { s, t } = candidate;
    const station = (t - 0.5) * s.length;
    // Keep junctions/ramps free; never put a cap or bar in the centre passage.
    if (Math.abs(station) > s.length / 2 - 2) continue;
    const side =
      Math.sign(
        (point[0] - s.x) * Math.cos(s.yaw) - (point[1] - s.z) * Math.sin(s.yaw),
      ) || 1;
    const x = s.x + Math.sin(s.yaw) * station + Math.cos(s.yaw) * side * 0.6,
      z = s.z + Math.cos(s.yaw) * station - Math.sin(s.yaw) * side * 0.6;
    if (
      allSegments.some(
        (other) =>
          segmentKey(other) !== segmentKey(s) &&
          nearest([x, z], other).distance < 1.6,
      )
    )
      continue;
    if (cleats.some((c) => Math.hypot(c.x - x, c.z - z) < 2.5)) continue;
    cleats.push({
      sourceId: s.sourceId,
      segmentIndex: s.segmentIndex,
      lineIndex: s.lineIndex,
      x,
      z,
      yaw: s.yaw,
      side,
      station,
    });
    if (cleats.length >= HARBOUR_DOCK_LIMITS.maxCleats) break;
  }
  return { segments, cleats };
}

function colourGeometry(geometry: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex),
    count = geometry.getAttribute('position').count,
    colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colours.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

/** Subdivide the actual box surface, not an offset duplicate top plane. The
 * original 1.4m width, 0.2m underside and 1.6m top survive exactly. */
export function marinaDockSegmentGeometry(length: number) {
  const positions: number[] = [],
    normals: number[] = [],
    colours: number[] = [];
  const quad = (
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    normal: Vec3,
    hex: number,
  ) => {
    const colour = new THREE.Color(hex);
    const forward =
      new THREE.Vector3(...b)
        .sub(new THREE.Vector3(...a))
        .cross(new THREE.Vector3(...c).sub(new THREE.Vector3(...a)))
        .dot(new THREE.Vector3(...normal)) > 0;
    for (const point of forward ? [a, b, c, a, c, d] : [a, c, b, a, d, c]) {
      positions.push(...point);
      normals.push(...normal);
      colours.push(colour.r, colour.g, colour.b);
    }
  };
  const half = length / 2,
    top = HARBOUR_DOCK_LIMITS.topY;
  const topPanel = (
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    colour: number,
  ) =>
    quad(
      [x0, top, z0],
      [x1, top, z0],
      [x1, top, z1],
      [x0, top, z1],
      [0, 1, 0],
      colour,
    );
  topPanel(-0.7, -0.61, -half, half, 0xc3beb0);
  topPanel(0.61, 0.7, -half, half, 0xc3beb0);
  const panels = Math.min(
    HARBOUR_DOCK_LIMITS.maxPanelsPerSegment,
    Math.max(1, Math.ceil(length / 2.5)),
  );
  for (let i = 0; i < panels; i++) {
    const a = -half + (i * length) / panels,
      b = -half + ((i + 1) * length) / panels,
      seam = i === panels - 1 ? 0 : 0.018;
    topPanel(-0.61, 0.61, a, b - seam, i % 3 === 0 ? 0xaaa99a : 0xb7b5a6);
    if (seam) topPanel(-0.61, 0.61, b - seam, b, 0x73786f);
  }
  for (const [lo, hi, colour] of [
    [0.2, 1.2, 0x89958a],
    [1.2, 1.46, 0x394842],
    [1.46, top, 0xaaa99a],
  ]) {
    for (const side of [-1, 1]) {
      const x = side * 0.7;
      quad(
        [x, lo, -half],
        [x, hi, -half],
        [x, hi, half],
        [x, lo, half],
        [side, 0, 0],
        colour,
      );
      const z = side * half;
      quad(
        [-0.7, lo, z],
        [0.7, lo, z],
        [0.7, hi, z],
        [-0.7, hi, z],
        [0, 0, side],
        colour,
      );
    }
  }
  quad(
    [-0.7, 0.2, -half],
    [0.7, 0.2, -half],
    [0.7, 0.2, half],
    [-0.7, 0.2, half],
    [0, -1, 0],
    0x89958a,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return geometry;
}

function cleatGeometry(cleat: MarinaDockCleat) {
  const parts: THREE.BufferGeometry[] = [];
  for (const [w, h, l, y] of [
    [0.11, 0.025, 0.3, 1.6125],
    [0.035, 0.065, 0.035, 1.6575],
    [0.035, 0.035, 0.25, 1.7075],
  ]) {
    const g = new THREE.BoxGeometry(w, h, l).toNonIndexed();
    g.translate(0, y, 0);
    g.rotateY(cleat.yaw);
    g.translate(cleat.x, 0, cleat.z);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return geometry;
}

export function addDocks(e: Pick<CityEngine, 'data' | 'waterWorld' | 'scene'>) {
  const piers = e.data['harbour-piers'] as FeatureCollection;
  const plan = planMarinaDockDetails(piers, e.data['harbour-sites'] ?? {});
  const detailed = new Set(plan.segments.map(segmentKey));
  const geometries: THREE.BufferGeometry[] = [];
  for (const f of piers.features) {
    for (const poly of f.geometry.type.endsWith('Polygon') ? rings(f) : []) {
      const p = poly.map((r) => r.map(project));
      e.waterWorld.addObstacle(p);
      const shape = new THREE.Shape(p[0].map((v) => new THREE.Vector2(...v)));
      shape.holes = p
        .slice(1)
        .map((r) => new THREE.Path(r.map((v) => new THREE.Vector2(...v))));
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: 1.4,
        bevelEnabled: false,
      });
      g.rotateX(Math.PI / 2);
      g.translate(0, 1.6, 0);
      g.deleteAttribute('uv');
      geometries.push(colourGeometry(g, 0x87948c));
    }
    for (const segment of projectedSegments(f)) {
      const { x, z, yaw, length } = segment;
      if (length < 0.1) continue;
      e.waterWorld.addObstacle(hullPolygon(x, z, yaw, length, 1.4));
      const g = detailed.has(segmentKey(segment))
        ? marinaDockSegmentGeometry(length)
        : colourGeometry(
            new THREE.BoxGeometry(1.4, 1.4, length)
              .toNonIndexed()
              .translate(0, 0.9, 0),
            0x87948c,
          );
      g.rotateY(yaw);
      g.translate(x, 0, z);
      g.deleteAttribute('uv');
      geometries.push(g);
    }
  }
  if (!geometries.length) return;
  const geometry = mergeGeometries(geometries)!;
  geometries.forEach((g) => g.dispose());
  const docks = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.91,
    }),
  );
  docks.name = 'Source harbour piers · marina concrete floats';
  docks.receiveShadow = true;
  docks.userData.marinaDetailSourceIds = [
    ...new Set(plan.segments.map((s) => s.sourceId)),
  ];
  docks.userData.dockReferences = [...HARBOUR_DOCK_REFERENCES];
  docks.userData.detailedSegments = plan.segments.length;
  docks.userData.detailStatus =
    'Original joints and fittings on existing OSM-derived pier boxes; not surveyed hardware';
  e.scene.add(docks);
  e.data.harbourDockMesh = docks;
  let hardware: THREE.Mesh | undefined;
  if (plan.cleats.length) {
    const parts = plan.cleats.map(cleatGeometry),
      hardwareGeometry = mergeGeometries(parts)!;
    parts.forEach((g) => g.dispose());
    hardware = new THREE.Mesh(
      hardwareGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x63767a,
        metalness: 0.65,
        roughness: 0.42,
      }),
    );
    hardware.name = 'Coal Harbour edge cleats · illustrative marina fittings';
    hardware.castShadow = true;
    hardware.receiveShadow = true;
    hardware.userData.edgeCleats = plan.cleats.length;
    docks.add(hardware);
  }
  // QA can compare the precise former box/extrusion implementation. Build its
  // resource only on first use; keep both variants scene-owned for disposal.
  const detailedGeometry = geometry,
    detailedMaterial = docks.material;
  let baseline:
    | THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    | undefined;
  const control = {
    enabled: true,
    setEnabled(enabled: boolean) {
      if (enabled === control.enabled) return;
      if (!baseline) {
        const originals: THREE.BufferGeometry[] = [];
        for (const f of piers.features) {
          for (const poly of f.geometry.type.endsWith('Polygon')
            ? rings(f)
            : []) {
            const p = poly.map((r) => r.map(project)),
              shape = new THREE.Shape(p[0].map((v) => new THREE.Vector2(...v)));
            shape.holes = p
              .slice(1)
              .map(
                (r) => new THREE.Path(r.map((v) => new THREE.Vector2(...v))),
              );
            const g = new THREE.ExtrudeGeometry(shape, {
              depth: 1.4,
              bevelEnabled: false,
            });
            g.rotateX(Math.PI / 2);
            g.translate(0, 1.6, 0);
            g.deleteAttribute('uv');
            originals.push(g);
          }
          for (const s of projectedSegments(f)) {
            if (s.length < 0.1) continue;
            const g = new THREE.BoxGeometry(1.4, 1.4, s.length).toNonIndexed();
            g.rotateY(s.yaw);
            g.translate(s.x, 0.9, s.z);
            g.deleteAttribute('uv');
            originals.push(g);
          }
        }
        const originalGeometry = mergeGeometries(originals)!;
        originals.forEach((g) => g.dispose());
        baseline = new THREE.Mesh(
          originalGeometry,
          new THREE.MeshStandardMaterial({
            color: 0x87948c,
            roughness: 0.91,
          }),
        );
        baseline.name = 'Harbour dock inactive variant resource owner';
        baseline.visible = false;
        docks.add(baseline);
      }
      const originalGeometry = enabled ? docks.geometry : baseline.geometry,
        originalMaterial = enabled ? docks.material : baseline.material;
      docks.geometry = enabled ? detailedGeometry : originalGeometry;
      docks.material = enabled ? detailedMaterial : originalMaterial;
      baseline.geometry = enabled ? originalGeometry : detailedGeometry;
      baseline.material = enabled ? originalMaterial : detailedMaterial;
      if (hardware) hardware.visible = enabled;
      control.enabled = enabled;
    },
  };
  e.data.harbourDockDetailControl = control;
}

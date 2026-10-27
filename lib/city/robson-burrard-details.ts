import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { FeatureCollection } from './types';
import { inPolygon, lines, project, rings, unproject } from './geo';
import { fitBays, hashId, structureKey, type Profile } from './facade-profile';
import { replacedBuilding } from './replaced-buildings';
import {
  STREET_SHOWCASE_BOUNDS,
  STREET_SHOWCASE_DETAIL_BUDGET as BUDGET,
  STREET_SHOWCASE_PALETTE as PALETTE,
  STREET_SHOWCASE_SEGMENTS,
  streetShowcaseWeight,
} from './street-quality-profile';

type Finish = 'stone' | 'metal' | 'glass' | 'canopy' | 'warm';
export type StreetShowcaseBox = {
  kind:
    | 'plinth'
    | 'post'
    | 'transom'
    | 'glazing'
    | 'fascia'
    | 'canopy'
    | 'trim'
    | 'handle'
    | 'display';
  finish: Finish;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  yaw: number;
  /** Pitch in local facade space, used for the pitched awning top only. */
  pitch: number;
  color: number;
};
export type StreetShowcaseBay = {
  id: string;
  sourceKey: string;
  /** A representative frontage group, not an actual surveyed business. */
  shopId: string;
  shopStyle: number;
  hasDoor: boolean;
  roadName: string;
  center: readonly [number, number];
  normal: readonly [number, number];
  pavementY: number;
  canopyBottomY: number;
  boxes: readonly StreetShowcaseBox[];
  sign: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    width: number;
    height: number;
    index: number;
  } | null;
};
type Road = {
  name: string;
  a: readonly number[];
  b: readonly number[];
  halfWidth: number;
};
type Footprint = {
  key: string;
  polygon: number[][][];
  height: number;
  ground: number;
  profile?: Profile;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};
export interface StreetShowcasePlanHost {
  buildings: FeatureCollection;
  roads: FeatureCollection;
  foundations: ReadonlyMap<string, number>;
  profiles: ReadonlyMap<string, Profile>;
  /** Same pavement datum used by the existing building-body ground glazing. */
  pavementY(x: number, z: number): number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// Restrained combinations rather than independent random colours on each bay.
// Real business names and tenant classifications are deliberately not inferred.
const STOREFRONT_STYLES = [
  {
    base: 0xb5b2a6,
    frame: 0x4d605b,
    glass: 0x38565a,
    fascia: 0x778b7c,
    fasciaFinish: 'stone',
    canopy: 0x4b6259,
    transom: 0.76,
    signs: [0, 1],
  },
  {
    base: 0xc2b6a3,
    frame: 0x685e51,
    glass: 0x344e4d,
    fascia: 0x927c65,
    fasciaFinish: 'stone',
    canopy: 0x795f50,
    transom: 0.82,
    signs: [2, 7],
  },
  {
    base: 0xaeb5b1,
    frame: 0x4d5d60,
    glass: 0x3b6064,
    fascia: 0x586a69,
    fasciaFinish: 'metal',
    canopy: 0x506476,
    transom: 0.7,
    signs: [6, 1],
  },
  {
    base: 0xb8a994,
    frame: 0x5a5549,
    glass: 0x38534c,
    fascia: 0x827a63,
    fasciaFinish: 'stone',
    canopy: 0x6a6151,
    transom: 0.78,
    signs: [5, 2],
  },
  {
    base: 0xb6b5a9,
    frame: 0x40584f,
    glass: 0x365650,
    fascia: 0x51685a,
    fasciaFinish: 'metal',
    canopy: 0x78604c,
    transom: 0.74,
    signs: [3, 4],
  },
] as const;

const TRADE_SIGNS = [
  { label: 'COFFEE', background: '#243f36', ink: '#fff1d3', serif: false },
  { label: 'BOOKS', background: '#e6ddca', ink: '#233f38', serif: true },
  { label: 'BAKERY', background: '#60483a', ink: '#fff0d4', serif: true },
  { label: 'FLOWERS', background: '#dce2d0', ink: '#254b3d', serif: false },
  { label: 'MARKET', background: '#324b43', ink: '#fff0d1', serif: false },
  { label: 'MUSIC', background: '#e2d4ba', ink: '#41352c', serif: true },
  { label: 'STUDIO', background: '#334d57', ink: '#f4ead7', serif: false },
  { label: 'CAFE', background: '#ddc9ac', ink: '#49372d', serif: true },
] as const;
const sourcePilotSouthWest = unproject(
  STREET_SHOWCASE_BOUNDS.minX,
  STREET_SHOWCASE_BOUNDS.maxZ,
);
const sourcePilotNorthEast = unproject(
  STREET_SHOWCASE_BOUNDS.maxX,
  STREET_SHOWCASE_BOUNDS.minZ,
);
/** Conservative outer-ring bounds before allocating/projecting a polygon. The
 * current city projection is affine, so source-coordinate bounds preserve all
 * intersecting footprints, including footprints enclosing the entire pilot. */
function sourceRingIntersectsPilot(ring: readonly number[][]) {
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity;
  for (const p of ring) {
    minLon = Math.min(minLon, p[0]);
    minLat = Math.min(minLat, p[1]);
    maxLon = Math.max(maxLon, p[0]);
    maxLat = Math.max(maxLat, p[1]);
  }
  // Sub-millimetre outward padding only protects the inverse-projection edge
  // from floating-point rounding. Exact local-space rejection remains below.
  const pad = 1e-9;
  return (
    maxLon >= sourcePilotSouthWest[0] - pad &&
    minLon <= sourcePilotNorthEast[0] + pad &&
    maxLat >= sourcePilotSouthWest[1] - pad &&
    minLat <= sourcePilotNorthEast[1] + pad
  );
}
function openRing(raw: readonly number[][]): number[][] {
  const end =
    raw.length > 1 &&
    raw[0][0] === raw.at(-1)![0] &&
    raw[0][1] === raw.at(-1)![1]
      ? -1
      : raw.length;
  return raw.slice(0, end).map(project);
}
function signedArea(ring: readonly number[][]) {
  return ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return s + p[0] * q[1] - q[0] * p[1];
  }, 0);
}
function closestRoad(x: number, z: number, roads: readonly Road[]) {
  let found: {
    road: Road;
    x: number;
    z: number;
    distance: number;
    ux: number;
    uz: number;
  } | null = null;
  for (const road of roads) {
    const dx = road.b[0] - road.a[0],
      dz = road.b[1] - road.a[1],
      length = Math.hypot(dx, dz);
    if (length < 1) continue;
    const t = clamp(
      ((x - road.a[0]) * dx + (z - road.a[1]) * dz) / (length * length),
      0,
      1,
    );
    const px = road.a[0] + dx * t,
      pz = road.a[1] + dz * t;
    const distance = Math.hypot(px - x, pz - z);
    if (!found || distance < found.distance)
      found = {
        road,
        x: px,
        z: pz,
        distance,
        ux: dx / length,
        uz: dz / length,
      };
  }
  return found;
}

/** Original, representative architectural finish: exact source walls remain
 * walls. These shallow display panels are not POIs, surveyed tenants, new
 * openings, collision volumes, pavement or walkable destinations. */
export function planRobsonBurrardDetails(
  host: StreetShowcasePlanHost,
): StreetShowcaseBay[] {
  const roadNames = new Set<string>(
    STREET_SHOWCASE_SEGMENTS.map((s) => s.roadName),
  );
  const roads: Road[] = [];
  for (const f of host.roads.features) {
    const p = f.properties;
    if (
      !roadNames.has(String(p.name)) ||
      !String(p.class ?? p.type).includes('Arterial')
    )
      continue;
    for (const line of lines(f)) {
      const projected = line.map(project);
      for (let i = 1; i < projected.length; i++) {
        const a = projected[i - 1],
          b = projected[i];
        if (
          Math.max(a[0], b[0]) < STREET_SHOWCASE_BOUNDS.minX ||
          Math.min(a[0], b[0]) > STREET_SHOWCASE_BOUNDS.maxX ||
          Math.max(a[1], b[1]) < STREET_SHOWCASE_BOUNDS.minZ ||
          Math.min(a[1], b[1]) > STREET_SHOWCASE_BOUNDS.maxZ
        )
          continue;
        roads.push({
          name: String(p.name),
          a,
          b,
          halfWidth: Math.max(3, Number(p.width) / 2 || 9),
        });
      }
    }
  }
  roads.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.a[0] - b.a[0] || a.a[1] - b.a[1],
  );
  if (!roads.length) return [];

  const footprints: Footprint[] = [];
  for (const f of host.buildings.features) {
    for (const raw of rings(f)) {
      if (!raw[0] || !sourceRingIntersectsPilot(raw[0])) continue;
      const polygon = raw.map(openRing),
        ring = polygon[0];
      if (!ring || ring.length < 3) continue;
      const xs = ring.map((p) => p[0]),
        zs = ring.map((p) => p[1]);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minZ = Math.min(...zs),
        maxZ = Math.max(...zs);
      if (
        maxX < STREET_SHOWCASE_BOUNDS.minX ||
        minX > STREET_SHOWCASE_BOUNDS.maxX ||
        maxZ < STREET_SHOWCASE_BOUNDS.minZ ||
        minZ > STREET_SHOWCASE_BOUNDS.maxZ
      )
        continue;
      const key = structureKey(
        f.properties,
        ring
          .map((p) => p.map((n) => n.toFixed(3)).join(','))
          .sort()
          .join(';'),
      );
      const ground = host.foundations.get(key),
        height = Number(f.properties.height);
      if (
        Number(f.properties.minHeight) > 0 ||
        ground === undefined ||
        !Number.isFinite(ground) ||
        !Number.isFinite(height)
      )
        continue;
      // Public landmarks with original interiors/portals retain their authored
      // appearance. All footprints still participate in party-wall rejection.
      const profile =
        replacedBuilding(f.properties) ||
        /gallery|museum|library|cathedral|church|station/i.test(
          String(f.properties.name ?? ''),
        )
          ? undefined
          : host.profiles.get(key);
      footprints.push({
        key,
        polygon,
        ground,
        height,
        profile,
        minX,
        maxX,
        minZ,
        maxZ,
      });
    }
  }
  footprints.sort(
    (a, b) => a.key.localeCompare(b.key) || a.minX - b.minX || a.minZ - b.minZ,
  );
  // Only small, nearby source polygons enter this index. Boundary probes reject
  // party walls/overlapping podiums without an all-city per-bay raycast.
  const cells = new Map<string, Footprint[]>();
  for (const p of footprints) {
    for (let x = Math.floor(p.minX / 32); x <= Math.floor(p.maxX / 32); x++)
      for (let z = Math.floor(p.minZ / 32); z <= Math.floor(p.maxZ / 32); z++) {
        const id = `${x},${z}`,
          cell = cells.get(id) ?? [];
        cell.push(p);
        cells.set(id, cell);
      }
  }
  const blocked = (x: number, z: number) =>
    (cells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? []).some(
      (p) =>
        x >= p.minX &&
        x <= p.maxX &&
        z >= p.minZ &&
        z <= p.maxZ &&
        inPolygon([x, z], p.polygon),
    );

  const bays: StreetShowcaseBay[] = [];
  for (const p of footprints) {
    const profile = p.profile;
    if (
      !profile ||
      p.height < 7 ||
      profile.kind === 'domestic-cladding' ||
      profile.kind === 'heritage-brick'
    )
      continue;
    const ring = p.polygon[0],
      sign = signedArea(ring) > 0 ? 1 : -1;
    for (let edge = 0; edge < ring.length; edge++) {
      const a = ring[edge],
        b = ring[(edge + 1) % ring.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 6 || length > 130) continue;
      const ux = dx / length,
        uz = dz / length,
        nx = sign * uz,
        nz = -sign * ux,
        yaw = -Math.atan2(dz, dx);
      const grid = fitBays(profile, length);
      const pitch = grid.pitchM * (grid.pitchM < 3.4 ? 2 : 1);
      // Use two existing narrow facade bays for a shop, while staying on the
      // same metre rhythm. A little stone at the corners avoids wrapping glass.
      const count = Math.min(18, Math.floor((length - 1.0) / pitch));
      const margin = (length - count * pitch) / 2;
      for (let bay = 0; bay < count; bay++) {
        const u = margin + (bay + 0.5) * pitch,
          x = a[0] + ux * u,
          z = a[1] + uz * u;
        if (streetShowcaseWeight(x, z) < 0.6) continue;
        const nearest = closestRoad(x, z, roads);
        if (
          !nearest ||
          nearest.distance > BUDGET.maxFrontageDistanceM ||
          nearest.distance < nearest.road.halfWidth + 0.5 ||
          ((nearest.x - x) * nx + (nearest.z - z) * nz) /
            Math.max(0.1, nearest.distance) <
            0.74 ||
          Math.abs(nearest.ux * ux + nearest.uz * uz) < 0.74
        )
          continue;
        const width = Math.max(2.6, pitch - 0.25),
          half = width / 2;
        const samples = [-half, 0, half].map((v) => ({
          x: x + ux * v + nx * 0.4,
          z: z + uz * v + nz * 0.4,
        }));
        if (samples.some((q) => blocked(q.x, q.z))) continue;
        const grades = samples.map((q) => host.pavementY(q.x, q.z));
        if (
          grades.some((g) => !Number.isFinite(g)) ||
          Math.max(...grades) - Math.min(...grades) > 0.45
        )
          continue;
        const pavementY = Math.max(...grades),
          bottom = Math.max(p.ground + 0.2, pavementY + 0.08);
        const top = Math.min(
          p.ground + profile.groundStoreyM - 0.24,
          p.ground + p.height - 0.5,
        );
        if (top - bottom < 2.2) continue;
        const id = `${p.key}:${edge}:${bay}`;
        // Treat consecutive source bays as one representative shop. Its frame,
        // awning and sign share an identity; a door on every three-metre bay
        // would otherwise read as an endless sequence of identical kiosks.
        const edgeSeed = hashId(`${p.key}:${edge}:frontage`);
        const groupSize = 2 + ((edgeSeed >>> 8) % 2);
        const shopNumber = Math.floor(bay / groupSize);
        const shopId = `${p.key}:${edge}:shop:${shopNumber}`;
        const shopSeed = hashId(shopId);
        const shopStyle = (shopSeed >>> 8) % STOREFRONT_STYLES.length;
        const style = STOREFRONT_STYLES[shopStyle];
        const hasDoor = bay % groupSize === Math.floor(groupSize / 2);
        const boxes: StreetShowcaseBox[] = [];
        const box = (
          kind: StreetShowcaseBox['kind'],
          finish: Finish,
          w: number,
          h: number,
          depth: number,
          along: number,
          y: number,
          offset: number,
          color: number,
          pitch = 0,
        ) => {
          boxes.push({
            kind,
            finish,
            width: w,
            height: h,
            depth,
            x: x + ux * along + nx * offset,
            y,
            z: z + uz * along + nz * offset,
            yaw,
            pitch,
            color,
          });
        };
        const frameColor = style.frame;
        const glassBottom = bottom + 0.36,
          glassTop = top - 0.7,
          glassHeight = glassTop - glassBottom;
        box(
          'plinth',
          'stone',
          width,
          0.36,
          0.16,
          0,
          bottom + 0.18,
          0.075,
          style.base,
        );
        box(
          'glazing',
          'glass',
          width - 0.16,
          glassHeight,
          0.035,
          0,
          (glassBottom + glassTop) / 2,
          0.105,
          style.glass,
        );
        for (const side of [-1, 1])
          box(
            'post',
            'metal',
            0.095,
            glassHeight + 0.12,
            0.19,
            side * (width / 2 - 0.06),
            (glassBottom + glassTop) / 2,
            0.105,
            frameColor,
          );
        // The entrance is one bay of a grouped frontage. It remains a surface
        // treatment: there is no new physical opening or navigation target.
        const doorU = (shopSeed & 1 ? -1 : 1) * Math.min(0.42, width * 0.16);
        const mullions = hasDoor ? [doorU - 0.45, doorU + 0.45] : [0];
        for (const along of mullions)
          box(
            'post',
            'metal',
            hasDoor ? 0.095 : 0.065,
            glassHeight,
            0.17,
            along,
            (glassBottom + glassTop) / 2,
            0.12,
            frameColor,
          );
        box(
          'transom',
          'metal',
          width - 0.07,
          0.065,
          0.18,
          0,
          glassBottom + glassHeight * style.transom,
          0.12,
          frameColor,
        );
        box(
          'trim',
          'metal',
          width + 0.04,
          0.075,
          0.21,
          0,
          glassBottom - 0.02,
          0.115,
          frameColor,
        );
        box(
          'trim',
          'metal',
          width + 0.04,
          0.085,
          0.2,
          0,
          glassTop + 0.025,
          0.11,
          frameColor,
        );
        if (hasDoor)
          box(
            'handle',
            'metal',
            0.035,
            0.34,
            0.095,
            doorU + 0.28,
            glassBottom + 0.92,
            0.2,
            PALETTE.bronze,
          );
        if (hasDoor) {
          // A restrained kick plate and lintel make the single grouped
          // entrance legible at street scale without a new opening or collider.
          box(
            'trim',
            'metal',
            0.84,
            0.18,
            0.08,
            doorU,
            glassBottom + 0.12,
            0.2,
            PALETTE.bronze,
          );
          box(
            'trim',
            'metal',
            0.98,
            0.09,
            0.08,
            doorU,
            glassTop - 0.02,
            0.2,
            frameColor,
          );
        }
        box(
          'fascia',
          style.fasciaFinish,
          width + 0.06,
          0.68,
          0.19,
          0,
          top - 0.34,
          0.11,
          style.fascia,
        );
        // A narrow warm reveal gives depth without a point light per shop.
        box(
          'display',
          'warm',
          width - 0.22,
          0.045,
          0.07,
          0,
          glassTop - 0.07,
          0.14,
          PALETTE.warmInterior,
        );
        const canopyBottomY = Math.max(pavementY + 2.95, top - 0.45);
        const canopy = (shopSeed >>> 4) % 5 < 3 && canopyBottomY < top + 0.2;
        if (canopy) {
          const canopyColor = style.canopy;
          // Local +Z points opposite the outward normal on CCW rings. The
          // slope therefore follows ring winding, always descending outward.
          const pitch = -sign * 0.16;
          box(
            'canopy',
            'canopy',
            width + 0.1,
            0.1,
            1.16,
            0,
            canopyBottomY + 0.14,
            0.57,
            canopyColor,
            pitch,
          );
          box(
            'canopy',
            'canopy',
            width + 0.1,
            0.19,
            0.075,
            0,
            canopyBottomY - 0.035,
            1.11,
            canopyColor,
          );
          for (const side of [-1, 1])
            box(
              'trim',
              'metal',
              0.045,
              0.065,
              1.05,
              side * (width / 2 - 0.12),
              canopyBottomY + 0.12,
              0.55,
              frameColor,
              pitch,
            );
        }
        bays.push({
          id,
          sourceKey: p.key,
          shopId,
          shopStyle,
          hasDoor,
          roadName: nearest.road.name,
          center: [x, z],
          normal: [nx, nz],
          pavementY,
          canopyBottomY: canopy ? canopyBottomY - 0.13 : Infinity,
          boxes,
          sign: hasDoor
            ? {
                x: x + nx * 0.217,
                y: top - 0.34,
                z: z + nz * 0.217,
                yaw: Math.atan2(nx, nz),
                width: Math.min(2.55, width - 0.3),
                height: 0.44,
                index: style.signs[(shopSeed >>> 14) % style.signs.length],
              }
            : null,
        });
      }
    }
  }
  // Stable geography-first truncation, never dependent on feature file order.
  return bays
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, BUDGET.maxPlannedBays);
}

type Host = Pick<
  CityEngine,
  'data' | 'buildings' | 'camera' | 'settings' | 'renderer' | 'elevation'
> &
  Partial<Pick<CityEngine, 'sceneryMotion' | 'detailWorkBudget' | 'uniforms'>>;

function createSignTexture(canvas?: HTMLCanvasElement | null) {
  if (!canvas) return null;
  canvas.width = 512;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  if (!c) return null;
  // Eight small, fictional trade labels share the original 512×256 texture.
  // Their palettes and typography follow the frontage groups, not real POIs.
  TRADE_SIGNS.forEach((sign, i) => {
    const x = (i % 2) * 256,
      y = Math.floor(i / 2) * 64;
    c.fillStyle = sign.background;
    c.fillRect(x, y, 256, 64);
    c.fillStyle = sign.ink;
    c.font = `600 29px ${sign.serif ? 'serif' : 'sans-serif'}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(sign.label, x + 128, y + 32, 212);
    c.fillRect(x + 10, y + 14, 20, 1);
    c.fillRect(x + 226, y + 14, 20, 1);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.name =
    'Original generic Robson/Burrard trade labels — representative, not POI data';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

/** Six bounded, shared draws for the visible pilot. Buildings, roads, floors,
 * collision, interior portals and rocket source spans remain untouched. */
export class RobsonBurrardDetails {
  readonly root = new THREE.Group();
  readonly bays: readonly StreetShowcaseBay[];
  readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  readonly signGeometry = new THREE.PlaneGeometry(1, 1);
  readonly materials: Record<Finish, THREE.MeshStandardMaterial>;
  readonly meshes = new Map<Finish, THREE.InstancedMesh>();
  readonly signMaterial: THREE.MeshStandardMaterial;
  readonly signMesh: THREE.InstancedMesh;
  readonly texture: THREE.CanvasTexture | null;
  readonly stats = {
    plannedBays: 0,
    planMs: 0,
    visibleBays: 0,
    visibleBoxes: 0,
    signs: 0,
    drawBatches: 0,
    triangles: 0,
    maxSelectionMs: 0,
    updates: 0,
    droppedAtBudget: 0,
    disposed: false,
  };
  private disposed = false;
  private last = new THREE.Vector3(Infinity, Infinity, Infinity);
  private quality = '';
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 1, 0);
  private color = new THREE.Color();
  private selectedSignature = '';
  private signRects: THREE.InstancedBufferAttribute;

  constructor(
    private e: Host,
    canvas: HTMLCanvasElement | null = typeof document === 'undefined'
      ? null
      : document.createElement('canvas'),
  ) {
    this.root.name =
      'Robson / Burrard — original representative street-front finish pilot';
    this.root.userData = {
      appearanceOnly: true,
      source: 'unchanged Vancouver building and street geometry',
      representativeBusinesses: true,
      collision: false,
      pilotBounds: STREET_SHOWCASE_BOUNDS,
    };
    const planStart = performance.now();
    this.bays = planRobsonBurrardDetails({
      buildings: e.data.buildings ?? { features: [] },
      roads: e.data.roads ?? { features: [] },
      foundations: e.data.buildingFoundations ?? new Map(),
      profiles: e.data.buildingProfiles ?? new Map(),
      pavementY: (x, z) =>
        (e.data.roadRelief?.(x, z) ?? e.elevation(x, z)) + 1.18,
    });
    this.stats.plannedBays = this.bays.length;
    this.stats.planMs = performance.now() - planStart;
    this.materials = {
      stone: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.02,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.34,
        metalness: 0.56,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.25,
        metalness: 0.3,
        envMapIntensity: 1.2,
      }),
      canopy: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.87,
        metalness: 0.0,
      }),
      warm: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.65,
        metalness: 0.05,
        emissive: PALETTE.warmInterior,
        emissiveIntensity: 0.22,
      }),
    };
    const night = this.e.uniforms?.night ?? { value: 0 };
    this.materials.glass.onBeforeCompile = (shader) => {
      shader.uniforms.uStreetShowcaseNight = night;
      shader.vertexShader =
        'varying vec2 vStreetGlassUv; varying vec3 vStreetGlassWorld; varying vec3 vStreetGlassNormal;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 streetLocal=vec4(transformed,1.0);
        vec3 streetNormal=normal;
        #ifdef USE_INSTANCING
          streetLocal=instanceMatrix*streetLocal;
          streetNormal=mat3(instanceMatrix)*streetNormal;
        #endif
        vStreetGlassUv=uv;
        vStreetGlassWorld=(modelMatrix*streetLocal).xyz;
        vStreetGlassNormal=normalize(mat3(modelMatrix)*streetNormal);`,
      );
      shader.fragmentShader =
        'uniform float uStreetShowcaseNight; varying vec2 vStreetGlassUv; varying vec3 vStreetGlassWorld; varying vec3 vStreetGlassNormal;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 streetEye=normalize(cameraPosition-vStreetGlassWorld);
        vec3 streetN=normalize(vStreetGlassNormal);
        vec3 streetT=normalize(cross(vec3(0.,1.,0.),streetN)+vec3(.00001,0.,0.));
        float streetFacing=max(.35,abs(dot(streetEye,streetN)));
        vec2 room=clamp(vStreetGlassUv-vec2(dot(streetEye,streetT),streetEye.y)*(.10/streetFacing),0.,1.);
        float inset=smoothstep(.0,.10,room.x)*smoothstep(.0,.10,1.-room.x)*smoothstep(.0,.12,1.-room.y);
        float displayStyle=fract(dot(diffuseColor.rgb,vec3(3.17,7.39,4.63)));
        float shelf=(1.-smoothstep(.016,.04,abs(room.y-(.26+displayStyle*.08))))+(1.-smoothstep(.016,.04,abs(room.y-(.56+displayStyle*.05))));
        float floorBand=1.-smoothstep(.12,.28,room.y);
        vec3 roomColor=mix(vec3(.15,.19,.17),vec3(.39,.32,.22),floorBand*.65);
        roomColor*=mix(.42,1.,inset)*(1.-min(1.,shelf)*.24*step(.36,displayStyle));
        diffuseColor.rgb=mix(diffuseColor.rgb*.56,roomColor,.54);
      `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float streetWindowGlow=smoothstep(.18,.35,vStreetGlassUv.y)*(1.-smoothstep(.80,.98,vStreetGlassUv.y));
        totalEmissiveRadiance+=vec3(.15,.105,.052)*streetWindowGlow*uStreetShowcaseNight;
      `,
      );
    };
    this.materials.glass.customProgramCacheKey = () =>
      'robson-burrard-shop-glazing-v1';
    this.materials.canopy.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'varying vec2 vStreetCanopyUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvStreetCanopyUv=uv;',
      );
      shader.fragmentShader =
        'varying vec2 vStreetCanopyUv;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float weave=sin(vStreetCanopyUv.x*160.)*sin(vStreetCanopyUv.y*90.);
        float detail=1.-smoothstep(.05,.15,max(fwidth(vStreetCanopyUv.x),fwidth(vStreetCanopyUv.y)));
        diffuseColor.rgb*=.98+weave*.025*detail;
      `,
      );
    };
    this.materials.canopy.customProgramCacheKey = () =>
      'robson-burrard-canopy-v1';
    for (const finish of Object.keys(this.materials) as Finish[]) {
      const capacity = Math.max(
        1,
        Math.min(
          BUDGET.maxVisibleBoxes,
          this.bays.reduce(
            (n, b) => n + b.boxes.filter((box) => box.finish === finish).length,
            0,
          ),
        ),
      );
      const mesh = new THREE.InstancedMesh(
        this.boxGeometry,
        this.materials[finish],
        capacity,
      );
      mesh.name = `Robson / Burrard ${finish} finish pool`;
      mesh.count = 0;
      mesh.castShadow = finish !== 'glass' && finish !== 'warm';
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.appearanceOnly = true;
      mesh.userData.cameraCollision = false;
      mesh.userData.travelOcclusion = false;
      // Placement/launch queries recurse through buildings. This finish must
      // not introduce another roof, obstacle or per-instance picking workload.
      mesh.raycast = () => {};
      this.meshes.set(finish, mesh);
      this.root.add(mesh);
    }
    this.texture = createSignTexture(canvas);
    this.signMaterial = new THREE.MeshStandardMaterial({
      color: this.texture ? 0xffffff : PALETTE.anodizedMetal,
      map: this.texture,
      roughness: 0.65,
      metalness: 0.08,
      emissive: PALETTE.warmInterior,
      emissiveIntensity: 0.035,
    });
    this.signMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute vec4 showcaseSignRect;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv=showcaseSignRect.xy+uv*showcaseSignRect.zw;
        #endif`,
      );
    };
    this.signMaterial.customProgramCacheKey = () =>
      'robson-burrard-original-generic-signs-v1';
    const signCapacity = Math.max(
      1,
      Math.min(BUDGET.maxVisibleBays, this.bays.length),
    );
    this.signRects = new THREE.InstancedBufferAttribute(
      new Float32Array(signCapacity * 4),
      4,
    ).setUsage(THREE.DynamicDrawUsage);
    this.signGeometry.setAttribute('showcaseSignRect', this.signRects);
    this.signMesh = new THREE.InstancedMesh(
      this.signGeometry,
      this.signMaterial,
      signCapacity,
    );
    this.signMesh.name =
      'Robson / Burrard generic trade labels — not real tenants';
    this.signMesh.count = 0;
    this.signMesh.receiveShadow = true;
    this.signMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.signMesh.userData.appearanceOnly = true;
    this.signMesh.userData.cameraCollision = false;
    this.signMesh.userData.travelOcclusion = false;
    this.signMesh.raycast = () => {};
    this.root.add(this.signMesh);
    e.buildings.add(this.root);
  }

  update(force = false) {
    if (this.disposed) return;
    const q = this.e.settings.buildings ? this.e.settings.quality : 'off';
    const high = q === 'high' || q === 'ultra';
    const altitude =
      this.e.camera.position.y -
      this.e.elevation(this.e.camera.position.x, this.e.camera.position.z);
    const active =
      q !== 'off' &&
      altitude >= -1 &&
      altitude <= BUDGET.maximumCameraHeightM &&
      streetShowcaseWeight(this.e.camera.position.x, this.e.camera.position.z) >
        0;
    const state = `${q}:${active}`;
    if (
      !force &&
      state === this.quality &&
      this.last.distanceToSquared(this.e.camera.position) <
        BUDGET.selectionMoveM ** 2
    )
      return;
    // No geometry is created during movement. Repacking existing matrices is a
    // single bounded admission; deferred updates keep the previous safe set.
    if (
      active &&
      !force &&
      this.e.sceneryMotion &&
      !this.e.sceneryMotion.allowNewDetails
    )
      return;
    const work = () => {
      const start = performance.now();
      this.last.copy(this.e.camera.position);
      this.quality = state;
      const range = high ? BUDGET.highRangeM : BUDGET.balancedRangeM;
      const chosen: StreetShowcaseBay[] = [];
      let boxes = 0;
      if (active) {
        const candidates = this.bays
          .map((bay) => ({
            bay,
            distance: Math.hypot(
              bay.center[0] - this.last.x,
              bay.center[1] - this.last.z,
            ),
          }))
          .filter((p) => p.distance < range)
          .sort(
            (a, b) =>
              a.distance - b.distance || a.bay.id.localeCompare(b.bay.id),
          );
        for (const { bay } of candidates) {
          if (
            chosen.length >=
              (high
                ? BUDGET.maxVisibleBays
                : Math.floor(BUDGET.maxVisibleBays * 0.55)) ||
            boxes + bay.boxes.length > BUDGET.maxVisibleBoxes
          )
            break;
          chosen.push(bay);
          boxes += bay.boxes.length;
        }
        this.stats.droppedAtBudget += Math.max(
          0,
          candidates.length - chosen.length,
        );
      }
      const signature = chosen.map((b) => b.id).join('|');
      if (signature !== this.selectedSignature || force) {
        this.selectedSignature = signature;
        const counts = { stone: 0, metal: 0, glass: 0, canopy: 0, warm: 0 };
        let signs = 0;
        for (const bay of chosen) {
          for (const b of bay.boxes) {
            const mesh = this.meshes.get(b.finish)!;
            this.position.set(b.x, b.y, b.z);
            if (b.pitch)
              this.quaternion.setFromEuler(
                this.rotation.set(b.pitch, b.yaw, 0, 'YXZ'),
              );
            else this.quaternion.setFromAxisAngle(this.axis, b.yaw);
            this.scale.set(b.width, b.height, b.depth);
            this.matrix.compose(this.position, this.quaternion, this.scale);
            const i = counts[b.finish]++;
            mesh.setMatrixAt(i, this.matrix);
            mesh.setColorAt(i, this.color.setHex(b.color));
          }
          if (bay.sign && signs < this.signMesh.instanceMatrix.count) {
            const s = bay.sign;
            this.position.set(s.x, s.y, s.z);
            this.quaternion.setFromAxisAngle(this.axis, s.yaw);
            this.scale.set(s.width, s.height, 1);
            this.matrix.compose(this.position, this.quaternion, this.scale);
            this.signMesh.setMatrixAt(signs, this.matrix);
            this.signRects.setXYZW(
              signs,
              ((s.index % 2) * 256 + 4) / 512,
              1 - (Math.floor(s.index / 2) * 64 + 60) / 256,
              248 / 512,
              56 / 256,
            );
            signs++;
          }
        }
        for (const [finish, mesh] of this.meshes) {
          mesh.count = counts[finish];
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          if (mesh.count) {
            mesh.computeBoundingBox();
            mesh.computeBoundingSphere();
          }
        }
        this.signMesh.count = signs;
        this.signMesh.instanceMatrix.needsUpdate = true;
        this.signRects.needsUpdate = true;
        if (signs) {
          this.signMesh.computeBoundingBox();
          this.signMesh.computeBoundingSphere();
        }
        this.stats.visibleBays = chosen.length;
        this.stats.visibleBoxes = boxes;
        this.stats.signs = signs;
        this.stats.drawBatches = [
          ...this.meshes.values(),
          this.signMesh,
        ].filter((m) => m.count > 0).length;
        this.stats.triangles = boxes * 12 + signs * 2;
        this.e.renderer.shadowMap.needsUpdate = true;
      }
      this.stats.updates++;
      this.stats.maxSelectionMs = Math.max(
        this.stats.maxSelectionMs,
        performance.now() - start,
      );
    };
    if (this.e.detailWorkBudget && active && !force)
      this.e.detailWorkBudget.run(work, { admission: true });
    else work();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes.values()) mesh.dispose();
    this.signMesh.dispose();
    this.root.clear();
    this.root.removeFromParent();
    this.boxGeometry.dispose();
    this.signGeometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose());
    this.signMaterial.dispose();
    this.texture?.dispose();
    this.stats.visibleBays =
      this.stats.visibleBoxes =
      this.stats.signs =
      this.stats.drawBatches =
      this.stats.triangles =
        0;
    this.stats.disposed = true;
  }
}

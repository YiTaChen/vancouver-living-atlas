import {
  createBCPlaceEnvelope,
  createBCPlaceOuterWall,
  type BCPlaceEntryOptions,
} from './bc-place-envelope';
import {
  createHarbourPodium,
  type HarbourPodiumOptions,
} from './harbour-podium';
/**
 * Original parametric Vancouver architecture. LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid), 2026.
 * Local coordinates are metres, +Y up. Factories do not apply map placement.
 * No downloaded 3D assets, photographic textures, logos, or traced artwork.
 * The metadata below is part of the integration contract; see SOURCE-NOTES.md.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createMarineGroundEntrance,
  marineGroundBayOverlapsEntry,
  marineGroundTrimRanges,
} from './marine-entry';

type V3 = readonly [number, number, number];
type V2 = readonly [number, number];
type Colour = THREE.ColorRepresentation;
type Ring = readonly V2[];
type Profile = { x: number; z: number; y: number };
const TAU = Math.PI * 2;
const WHITE = 0xe6e5da;
const STEEL = 0xb4bfbd;
const GLASS = 0x284750;

export const SECONDARY_LANDMARK_PLACEMENTS = {
  bcPlace: {
    lon: -123.1120067,
    lat: 49.2766985,
    yaw: 0.677,
    base: 5,
    baseY: 5,
    pivot: 'Centre of the stadium at the existing 5 m site datum.',
    sourceIds: ['osm-24705904'],
    excludeBuildingIds: [],
    excludeStructureIds: [],
  },
  harbourCentre: {
    lon: -123.1120903,
    lat: 49.2847656,
    yaw: -0.8,
    pivot: 'Centre of the existing office shaft; sample terrain here once.',
    lookoutLocal: [0.28761196383652887, 0, 12.90171557875517],
    sourceIds: ['osm-1371268997', 'osm-143682595'],
    excludeBuildingIds: [],
    excludeStructureIds: [],
  },
  marineBuilding: {
    lon: -123.117146,
    lat: 49.287449,
    yaw: 0.77,
    base: 14.22,
    baseY: 14.22,
    pivot: 'Crown centre, at the reconciled building base datum.',
    sourceIds: [
      'osm-125579375',
      'osm-360437838',
      'osm-360437839',
      'osm-360437840',
      'osm-360437841',
      'osm-360575454',
      'osm-360575455',
      'osm-360575458',
      'osm-360575460',
    ],
    excludeBuildingIds: [
      'osm-structure-19-0',
      'osm-structure-19-1',
      'osm-structure-19-2',
    ],
    excludeStructureIds: ['osm-structure-19'],
  },
} as const;

/** One merged mesh per PBR treatment; vertex colours supply surface variation. */
class Batch {
  parts: THREE.BufferGeometry[] = [];
  constructor(
    readonly name: string,
    readonly settings: THREE.MeshStandardMaterialParameters = {},
    readonly nightIntensity = 0,
  ) {}

  add(source: THREE.BufferGeometry, colour: Colour = WHITE): void {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'color')
        g.deleteAttribute(key);
    }
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    if (!g.hasAttribute('color')) {
      const c = new THREE.Color(colour),
        count = g.getAttribute('position').count;
      const colours = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colours.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    }
    this.parts.push(g);
  }

  box(size: V3, p: V3, colour: Colour = WHITE, yaw = 0): void {
    this.add(
      new THREE.BoxGeometry(...size).rotateY(yaw).translate(...p),
      colour,
    );
  }

  cylinder(
    top: number,
    bottom: number,
    height: number,
    p: V3,
    colour: Colour = WHITE,
    radial = 48,
  ): void {
    this.add(
      new THREE.CylinderGeometry(top, bottom, height, radial).translate(...p),
      colour,
    );
  }

  beam(a: V3, b: V3, radius = 0.15, colour: Colour = WHITE, radial = 6): void {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    if (delta.lengthSq() < 1e-10) return;
    const g = new THREE.CylinderGeometry(
      radius,
      radius,
      delta.length(),
      radial,
    );
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      ),
    );
    const centre = start.add(end).multiplyScalar(0.5);
    this.add(g.translate(centre.x, centre.y, centre.z), colour);
  }

  window(
    width: number,
    height: number,
    p: V3,
    yaw = 0,
    colour: Colour = GLASS,
  ): void {
    this.add(
      new THREE.PlaneGeometry(width, height).rotateY(yaw).translate(...p),
      colour,
    );
  }

  prism(ring: Ring, bottom: number, top: number, colour: Colour): void {
    const shape = new THREE.Shape();
    ring.forEach(([x, z], i) =>
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z),
    );
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: top - bottom,
      steps: 1,
      bevelEnabled: false,
      curveSegments: 1,
    });
    g.rotateX(-Math.PI / 2).translate(0, bottom, 0);
    this.add(g, colour);
  }

  finish(group: THREE.Group): void {
    if (!this.parts.length) return;
    const geometry = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    if (!geometry) throw new Error(`Unable to merge ${this.name}`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.07,
      ...this.settings,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = this.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (this.nightIntensity) {
      material.emissiveIntensity = 0;
      material.userData.nightIntensity = this.nightIntensity;
      group.userData.nightMaterials.push({
        material,
        intensity: this.nightIntensity,
      });
    }
  }
}

function geometry(
  positions: number[],
  indices: number[],
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Walk a radial section from outside/below toward inside/above: normals face out. */
function ellipseLoft(
  profiles: Profile[],
  segments: number,
  cx = 0,
  cz = 0,
  start = 0,
  end = TAU,
): THREE.BufferGeometry {
  const p: number[] = [],
    f: number[] = [];
  for (const s of profiles) {
    for (let i = 0; i <= segments; i++) {
      const a = start + ((end - start) * i) / segments;
      p.push(cx + s.x * Math.cos(a), s.y, cz + s.z * Math.sin(a));
    }
  }
  for (let row = 0; row < profiles.length - 1; row++) {
    for (let i = 0; i < segments; i++) {
      const a = row * (segments + 1) + i,
        b = a + 1;
      const d = (row + 1) * (segments + 1) + i,
        c = d + 1;
      f.push(a, d, c, a, c, b);
    }
  }
  return geometry(p, f);
}

function ellipseRail(
  batch: Batch,
  rx: number,
  rz: number,
  y: number,
  radius: number,
  colour: Colour,
  segments: number,
  cx = 0,
  cz = 0,
): void {
  const points = Array.from({ length: segments + 1 }, (_, i) => {
    const a = (i / segments) * TAU;
    return new THREE.Vector3(cx + rx * Math.cos(a), y, cz + rz * Math.sin(a));
  });
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  batch.add(new THREE.TubeGeometry(curve, segments, radius, 5, false), colour);
}

function complete(
  name: string,
  detail: boolean,
  batches: Batch[],
  placement: object,
  solidFootprints: Ring[] = [],
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.userData.nightMaterials = [];
  batches.forEach((b) => b.finish(group));
  const bounds = new THREE.Box3().setFromObject(group);
  let triangles = 0;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh)
      triangles +=
        (object.geometry.index?.count ??
          object.geometry.getAttribute('position').count) / 3;
  });
  Object.assign(group.userData, {
    placement,
    detail,
    units: 'metres',
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    triangles,
    drawCalls: group.children.length,
    solidFootprints: solidFootprints.map((ring) => [...ring, ring[0]]),
    originalProceduralAsset: true,
    nightFactor: 0,
  });
  return group;
}

/** Optional convenience. Root may instead merge userData.nightMaterials into its engine. */
export function setSecondaryLandmarkNight(
  group: THREE.Group,
  factor: number,
): void {
  const n = THREE.MathUtils.clamp(factor, 0, 1);
  const materials = group.userData.nightMaterials as
    | { material: THREE.MeshStandardMaterial; intensity: number }[]
    | undefined;
  materials?.forEach(({ material, intensity }) => {
    material.emissiveIntensity = n * intensity;
  });
  group.userData.nightFactor = n;
}

/** An open-roof stadium. 36 mast/panel positions remain present at both detail levels. */
export function createBCPlace(
  detail: boolean,
  options: BCPlaceEntryOptions = {},
): THREE.Group {
  const structure = new Batch('BC Place / precast bowl and concourses');
  const white = new Batch('BC Place / painted structural steel', {
    roughness: 0.4,
    metalness: 0.42,
  });
  const cables = new Batch('BC Place / suspension cables', {
    roughness: 0.34,
    metalness: 0.72,
  });
  const membrane = new Batch('BC Place / original tensile membrane', {
    roughness: 0.76,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const seating = new Batch('BC Place / seating tiers and aisles', {
    roughness: 0.85,
  });
  const field = new Batch('BC Place / pitch and markings', {
    roughness: 0.96,
    metalness: 0,
  });
  const screens = new Batch(
    'BC Place / screens and access lighting',
    { roughness: 0.4, emissive: 0x9cb9b8 },
    0.75,
  );
  const n = detail ? 144 : 72;
  const envelope = createBCPlaceEnvelope(detail, options);

  // Replace only the outer wall so the new entrance recesses are real holes.
  structure.add(createBCPlaceOuterWall(n, envelope.userData.entries), 0x999e96);
  // Retain original inner bowl, top cap and underside profile.
  structure.add(
    ellipseLoft(
      [
        { x: 112.6, z: 91.5, y: 30.5 },
        { x: 106, z: 85.5, y: 30.5 },
        { x: 64, z: 47, y: 4 },
        { x: 64, z: 47, y: 0 },
        { x: 106, z: 86, y: 0 },
      ],
      n,
    ),
    0x999e96,
  );
  for (const y of [8, 18, 28.5, 31.5]) {
    structure.add(
      ellipseLoft(
        [
          { x: 112.8, z: 91.8, y: y - 0.45 },
          { x: 112.8, z: 91.8, y: y + 0.45 },
          { x: 108, z: 87, y: y + 0.45 },
        ],
        n,
      ),
      0xc8ccbf,
    );
  }
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU,
      c = Math.cos(a),
      s = Math.sin(a);
    white.beam(
      [111.8 * c, 8, 90.8 * s],
      [111.8 * c, 41.8, 90.8 * s],
      i % 2 ? 0.27 : 0.43,
      0xd6d9ce,
      detail ? 6 : 4,
    );
    if (detail) {
      white.beam(
        [112.2 * c, 32, 91.2 * s],
        [111.6 * c, 41.5, 90.6 * s],
        0.14,
        WHITE,
        4,
      );
    }
  }

  // Each fabric gore has a doubly curved analytic surface, not a flat annulus.
  const radialSteps = detail ? 12 : 5,
    angularSteps = detail ? 8 : 3;
  for (let sector = 0; sector < 36; sector++) {
    const vertices: number[] = [],
      faces: number[] = [];
    for (let r = 0; r <= radialSteps; r++) {
      const t = r / radialSteps;
      for (let c = 0; c <= angularSteps; c++) {
        const u = c / angularSteps,
          a = ((sector + u) / 36) * TAU;
        const x = THREE.MathUtils.lerp(112, 50, t);
        const z = THREE.MathUtils.lerp(91, 42.5, t);
        const y =
          THREE.MathUtils.lerp(42.6, 44.4, t) +
          2.5 * Math.sin(t * Math.PI) -
          2.35 * Math.sin(u * Math.PI) * Math.sin(t * Math.PI);
        vertices.push(x * Math.cos(a), y, z * Math.sin(a));
      }
    }
    for (let r = 0; r < radialSteps; r++)
      for (let c = 0; c < angularSteps; c++) {
        const a = r * (angularSteps + 1) + c,
          b = a + 1;
        const d = a + angularSteps + 1,
          e = d + 1;
        faces.push(a, d, e, a, e, b);
      }
    membrane.add(geometry(vertices, faces), sector % 2 ? 0xe7e8df : 0xf1eee2);

    const a = (sector / 36) * TAU,
      c = Math.cos(a),
      s = Math.sin(a);
    const foot: V3 = [108.9 * c, 17, 88.9 * s];
    const tip: V3 = [115.3 * c, 65.5, 94.6 * s];
    const inner: V3 = [50 * c, 44.6, 42.5 * s];
    white.beam(foot, tip, 0.6, WHITE, detail ? 8 : 5);
    white.beam(
      [110.5 * c, 36, 90 * s],
      [112 * c, 42.6, 91 * s],
      0.37,
      WHITE,
      5,
    );
    cables.beam(tip, inner, 0.145, STEEL, detail ? 6 : 4);
    const before: V3 = [112 * c, 42.9, 91 * s];
    let previous = before;
    for (let k = 1; k <= (detail ? 10 : 4); k++) {
      const t = k / (detail ? 10 : 4);
      const p: V3 = [
        THREE.MathUtils.lerp(112, 50, t) * c,
        THREE.MathUtils.lerp(42.9, 44.7, t) + 2.5 * Math.sin(t * Math.PI),
        THREE.MathUtils.lerp(91, 42.5, t) * s,
      ];
      white.beam(previous, p, 0.13, 0xcdd2c9, 4);
      previous = p;
    }
    if (detail) {
      // Secondary under-slung radial tension chord and suspension hangers.
      cables.beam([111.3 * c, 40.6, 90.5 * s], inner, 0.08, 0x899994, 4);
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        const rx = THREE.MathUtils.lerp(115.3, 50, t);
        const rz = THREE.MathUtils.lerp(94.6, 42.5, t);
        cables.beam(
          [rx * c, THREE.MathUtils.lerp(65.5, 44.6, t), rz * s],
          [rx * c, 44.0 + 2.1 * Math.sin(t * Math.PI), rz * s],
          0.055,
          STEEL,
          4,
        );
      }
    }
  }
  ellipseRail(white, 112, 91, 42.5, 0.57, WHITE, n);
  ellipseRail(white, 50, 42.5, 44.45, 0.46, WHITE, n);
  ellipseRail(white, 111.8, 90.8, 31.7, 0.28, 0xd6d9cf, n);

  // Continuous seat risers, open radial aisles, perimeter vomitories.
  const rows = detail ? 36 : 22,
    sections = 36;
  for (let row = 0; row < rows; row++) {
    const t = row / rows,
      t2 = (row + 0.9) / rows;
    const innerX = 62 + 43 * t,
      innerZ = 45 + 39 * t;
    const outerX = 62 + 43 * t2,
      outerZ = 45 + 39 * t2;
    const y = 4.3 + 25 * t,
      y2 = 4.3 + 25 * t2;
    for (let sector = 0; sector < sections; sector++) {
      const start = ((sector + 0.05) / sections) * TAU;
      const end = ((sector + 0.94) / sections) * TAU;
      seating.add(
        ellipseLoft(
          [
            { x: innerX, z: innerZ, y },
            { x: outerX, z: outerZ, y },
            { x: outerX, z: outerZ, y: y2 },
          ].reverse(),
          detail ? 4 : 2,
          0,
          0,
          start,
          end,
        ),
        sector % 9 < 2 ? 0x464d4c : row % 3 === 0 ? 0x98413d : 0x754841,
      );
    }
  }
  field.box([105, 0.25, 70], [0, 3.8, 0], 0x315b3e);
  for (let i = 0; i < 10; i++) {
    field.box(
      [10, 0.025, 66],
      [-45 + i * 10, 3.95, 0],
      i % 2 ? 0x487c4c : 0x407148,
    );
  }
  const lineY = 3.98;
  for (const z of [-33, 33])
    field.box([100, 0.025, 0.16], [0, lineY, z], 0xe5eadb);
  for (const x of [-50, 0, 50])
    field.box([0.16, 0.025, 66], [x, lineY, 0], 0xe5eadb);
  ellipseRail(field, 9.15, 9.15, lineY + 0.02, 0.08, 0xe5eadb, 64);
  for (const side of [-1, 1]) {
    field.box([16.5, 0.03, 0.16], [side * 41.75, lineY, -20.15], 0xe5eadb);
    field.box([16.5, 0.03, 0.16], [side * 41.75, lineY, 20.15], 0xe5eadb);
    field.box([0.16, 0.03, 40.3], [side * 33.5, lineY, 0], 0xe5eadb);
    white.beam([side * 50, 4, -3.65], [side * 50, 6.44, -3.65], 0.08, WHITE, 5);
    white.beam(
      [side * 50, 6.44, -3.65],
      [side * 50, 6.44, 3.65],
      0.08,
      WHITE,
      5,
    );
    white.beam([side * 50, 6.44, 3.65], [side * 50, 4, 3.65], 0.08, WHITE, 5);
  }
  // A modest, four-sided centre-hung scoreboard; no brand artwork.
  structure.box([15.5, 6.5, 10.5], [0, 28, 0], 0x243333);
  for (const side of [-1, 1]) {
    screens.window(
      14.5,
      5.2,
      [0, 28, side * 5.27],
      side < 0 ? Math.PI : 0,
      0x477783,
    );
    screens.window(
      9.5,
      5.2,
      [side * 7.77, 28, 0],
      (side * Math.PI) / 2,
      0x477783,
    );
    for (const x of [-6, 6]) {
      cables.beam(
        [x, 31.3, side * 4.5],
        [x * 3, 44.5, side * 39],
        0.09,
        STEEL,
        4,
      );
    }
  }
  const group = complete(
    'BC Place — original detailed model',
    detail,
    [structure, white, cables, membrane, seating, field, screens],
    SECONDARY_LANDMARK_PLACEMENTS.bcPlace,
    [
      Array.from(
        { length: 72 },
        (_, i): V2 => [
          112.8 * Math.cos((i / 72) * TAU),
          91.8 * Math.sin((i / 72) * TAU),
        ],
      ),
    ],
  );
  group.add(envelope);
  group.userData.nightMaterials.push(...envelope.userData.nightMaterials);
  group.userData.envelopeRefinement = {
    contract: envelope.userData.contract,
    entries: envelope.userData.entries,
    rejectedEntries: envelope.userData.rejectedEntries,
    thresholdStatus: envelope.userData.thresholdStatus,
  };
  let triangles = 0,
    drawCalls = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      triangles +=
        (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3;
      drawCalls++;
    }
  });
  const bounds = new THREE.Box3().setFromObject(group);
  Object.assign(group.userData, {
    triangles,
    drawCalls,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  });
  return group;
}

export const HARBOUR_PODIUM: Ring = [
  [-24.5, -41.8],
  [54.4, -43],
  [55, 35],
  [21.3, 36.5],
  [18.8, 36.5],
  [18.8, 38],
  [-16.8, 38.4],
  [-24, 31],
  [-21, 27],
  [-21, 22.5],
  [-24.5, 22.5],
];

/** Facade elements parallel to an arbitrary straight footprint edge. */
function eachEdge(
  ring: Ring,
  callback: (
    a: V2,
    b: V2,
    length: number,
    tangent: V2,
    normal: V2,
    yaw: number,
    index: number,
  ) => void,
): void {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    if (length < 0.05) return;
    const tangent: V2 = [dx / length, dz / length];
    const normal: V2 =
      area > 0 ? [tangent[1], -tangent[0]] : [-tangent[1], tangent[0]];
    callback(
      a,
      b,
      length,
      tangent,
      normal,
      Math.atan2(normal[0], normal[1]),
      i,
    );
  });
}

export function createHarbourCentre(
  detail: boolean,
  options: HarbourPodiumOptions = {},
): THREE.Group {
  const stone = new Batch(
    'Harbour Centre / Spencer podium and concrete shaft',
    { roughness: 0.79 },
  );
  const trim = new Batch('Harbour Centre / concrete frames and disc fascias', {
    roughness: 0.6,
  });
  const steel = new Batch('Harbour Centre / roof structure and antenna', {
    roughness: 0.36,
    metalness: 0.66,
  });
  const glass = new Batch('Harbour Centre / recessed windows', {
    roughness: 0.17,
    metalness: 0.48,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const lit = new Batch(
    'Harbour Centre / occupied windows',
    {
      roughness: 0.21,
      metalness: 0.35,
      emissive: 0xf0c489,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    },
    0.76,
  );
  const lookout = new Batch(
    'Harbour Centre / panoramic viewing and restaurant glazing',
    { roughness: 0.15, metalness: 0.45, emissive: 0xc9ba91 },
    0.58,
  );
  const podium = createHarbourPodium(detail, HARBOUR_PODIUM, options);
  const tower: Ring = [
    [-17.5, -18.5],
    [17.5, -18.5],
    [17.5, 18.5],
    [-17.5, 18.5],
  ];
  stone.prism(tower, 20, 116, 0xc3bca6);

  // Regular concrete office grid: 28 rows, square dark window apertures.
  eachEdge(tower, (a, _b, length, tangent, normal, yaw, edge) => {
    const bays = detail ? 9 : 7,
      pitch = length / bays;
    for (let floor = 0; floor < 28; floor++) {
      const y = 22.0 + floor * 3.32;
      for (let bay = 0; bay < bays; bay++) {
        const x = a[0] + tangent[0] * (bay + 0.5) * pitch + normal[0] * 0.065;
        const z = a[1] + tangent[1] * (bay + 0.5) * pitch + normal[1] * 0.065;
        const batch = (floor * 7 + bay * 3 + edge * 11) % 13 < 3 ? lit : glass;
        batch.window(
          pitch - 0.72,
          2.44,
          [x, y + 1.45, z],
          yaw,
          (floor + bay) % 4 ? 0x3c5153 : 0x304249,
        );
        if (detail) {
          trim.box([pitch - 0.46, 0.16, 0.28], [x, y + 0.18, z], 0xb1aa96, yaw);
          steel.box([0.055, 2.4, 0.035], [x, y + 1.45, z], 0x7e8580, yaw);
        }
      }
      trim.box(
        [length + 0.14, 0.24, 0.29],
        [a[0] + (tangent[0] * length) / 2, y, a[1] + (tangent[1] * length) / 2],
        0xd4cbb5,
        yaw,
      );
    }
    for (let bay = 0; bay <= bays; bay++) {
      trim.box(
        [0.23, 94, 0.23],
        [
          a[0] + tangent[0] * bay * pitch,
          68.6,
          a[1] + tangent[1] * bay * pitch,
        ],
        0xd3ccb8,
        yaw,
      );
    }
  });
  trim.box([35.5, 1.5, 37.5], [0, 116.2, 0], 0xd6d0bc);
  const [cx, , cz] = SECONDARY_LANDMARK_PLACEMENTS.harbourCentre.lookoutLocal;
  const sides = detail ? 96 : 48;
  stone.cylinder(6.4, 6.4, 13, [cx, 122.9, cz], 0x9da79e, sides);
  trim.cylinder(15.2, 6.6, 6.6, [cx, 131.5, cz], 0xc8cbbb, sides);
  trim.cylinder(16.1, 15.2, 1.25, [cx, 135.35, cz], 0xdbded0, sides);
  lookout.cylinder(16.9, 16.1, 6.7, [cx, 139.3, cz], 0x284548, sides);
  trim.cylinder(17.8, 17.3, 1.45, [cx, 143.3, cz], 0xe5e2d0, sides);
  lookout.cylinder(18.1, 17.8, 6.9, [cx, 147.4, cz], 0x2f4b4f, sides);
  trim.cylinder(18.3, 19.2, 1.5, [cx, 151.6, cz], 0xd6d8c7, sides);
  trim.cylinder(8.4, 18.3, 3.5, [cx, 154.1, cz], 0xd9dace, sides);
  steel.cylinder(7.5, 8.4, 0.85, [cx, 156.275, cz], 0x959f99, sides);
  for (let i = 0; i < (detail ? 72 : 36); i++) {
    const a = (i / (detail ? 72 : 36)) * TAU,
      c = Math.cos(a),
      s = Math.sin(a);
    steel.beam(
      [cx + 16.17 * c, 136, cz + 16.17 * s],
      [cx + 16.96 * c, 142.65, cz + 16.96 * s],
      0.075,
      0xa4b0a9,
      4,
    );
    steel.beam(
      [cx + 17.87 * c, 143.95, cz + 17.87 * s],
      [cx + 18.16 * c, 150.82, cz + 18.16 * s],
      0.075,
      0xa4b0a9,
      4,
    );
    if (i % (detail ? 6 : 3) === 0) {
      trim.beam(
        [cx + 6.5 * c, 128, cz + 6.5 * s],
        [cx + 15.2 * c, 134.7, cz + 15.2 * s],
        0.22,
        0xe0dfcd,
        5,
      );
    }
  }
  ellipseRail(steel, 16.53, 16.53, 139.05, 0.065, 0x7a8987, sides, cx, cz);
  ellipseRail(steel, 18.03, 18.03, 147.35, 0.065, 0x8c9690, sides, cx, cz);
  // External glass elevator: restrained dark ribbon and two guide rails.
  glass.box([3.75, 106.5, 0.35], [cx, 74, 18.87], 0x24414a);
  for (const x of [cx - 1.92, cx + 1.92]) {
    steel.box([0.16, 107, 0.38], [x, 74, 18.9], 0x8e9b97);
  }
  lit.box([3.45, 3.1, 0.55], [cx, 83, 19.04], 0x73847e);
  steel.cylinder(0.95, 1.25, 4.6, [cx, 159, cz], 0xbdc6ba, 16);
  steel.cylinder(0.34, 0.7, 13.7, [cx, 167.9, cz], 0xccd1c5, 12);
  steel.cylinder(0.12, 0.34, 2.25, [cx, 175.875, cz], 0xd8dbcd, 8);
  for (const y of [160.9, 164.5, 169.5, 172.8]) {
    steel.cylinder(1.35, 1.35, 0.22, [cx, y, cz], 0x899991, 24);
  }
  if (detail)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      steel.beam(
        [cx + Math.cos(a) * 5.5, 156.7, cz + Math.sin(a) * 5.5],
        [cx + Math.cos(a) * 0.6, 163, cz + Math.sin(a) * 0.6],
        0.08,
        0xa2afa7,
        4,
      );
    }
  const group = complete(
    'Harbour Centre — original detailed model',
    detail,
    [stone, trim, steel, glass, lit, lookout],
    SECONDARY_LANDMARK_PLACEMENTS.harbourCentre,
    [HARBOUR_PODIUM],
  );
  group.add(podium);
  group.userData.nightMaterials.push(...podium.userData.nightMaterials);
  group.userData.podiumRefinement = {
    contract: podium.userData.contract,
    bays: podium.userData.bays,
    entries: podium.userData.entries,
  };
  let triangles = 0,
    drawCalls = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      triangles +=
        (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3;
      drawCalls++;
    }
  });
  const box = new THREE.Box3().setFromObject(group);
  Object.assign(group.userData, {
    triangles,
    drawCalls,
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
  });
  return group;
}

// Plan coordinates are original OSM building-part coordinates transformed into metres.
// There is no third-party mesh here. Rounding to 0.1 mm greatly exceeds source accuracy.
const MARINE_OUTLINE: Ring = [
  [32.9118, -1.5642],
  [36.1335, 4.4905],
  [41.6661, 14.8483],
  [36.4917, 14.8857],
  [14.3355, 15.0481],
  [-12.5488, 15.2466],
  [-14.6768, 15.261],
  [-24.6089, -12.0469],
  [-13.7349, -16.5436],
  [-7.7538, -18.9776],
  [17.9156, -29.6578],
];
const MARINE_PARTS: { top: number; bottom: number; ring: Ring }[] = [
  {
    top: 26,
    bottom: 8,
    ring: [
      [-14.6768, 15.261],
      [-24.5755, -12.123],
      [-13.7349, -16.5436],
      [-13.712, -14.9087],
      [-12.5488, 15.2466],
    ],
  },
  {
    top: 40,
    bottom: 8,
    ring: [
      [14.3355, 15.0481],
      [-12.5488, 15.2466],
      [-13.712, -14.9087],
      [4.8024, -15.2686],
      [4.8529, -13.2659],
      [4.9849, -8.1449],
      [5.0495, -5.8959],
      [5.1727, -1.0161],
      [7.5002, -1.0696],
      [12.6303, -1.1656],
      [13.8551, -1.1874],
      [32.9118, -1.5642],
      [36.1335, 4.4905],
      [36.4917, 14.8857],
    ],
  },
  {
    top: 68,
    bottom: 40,
    ring: [
      [-12.5488, 15.2466],
      [-13.712, -14.9087],
      [4.8024, -15.2686],
      [4.8529, -13.2659],
      [4.9849, -8.1449],
      [5.0495, -5.8959],
      [5.1727, -1.0161],
      [7.5002, -1.0696],
      [12.6303, -1.1656],
      [13.8551, -1.1874],
      [14.3355, 15.0481],
    ],
  },
  {
    top: 74,
    bottom: 68,
    ring: [
      [4.9849, -8.1449],
      [5.0495, -5.8959],
      [5.1727, -1.0161],
      [7.5002, -1.0696],
      [12.6303, -1.1656],
      [12.8763, 13.1525],
      [-10.2928, 13.139],
      [-10.8366, -13.1594],
      [4.8529, -13.2659],
    ],
  },
  {
    top: 80,
    bottom: 74,
    ring: [
      [5.0495, -5.8959],
      [5.1727, -1.0161],
      [7.5002, -1.0696],
      [7.8837, 8.6215],
      [-6.3734, 8.6902],
      [-6.8675, -8.2718],
      [4.9849, -8.1449],
    ],
  },
  {
    top: 88,
    bottom: 80,
    ring: [
      [-4.0954, 5.7047],
      [-3.9692, -6.0662],
      [5.0495, -5.8959],
      [5.1727, -1.0161],
      [5.0531, 5.8767],
    ],
  },
];

/** Smaller than the raw ground outline, so shallow cornices stay inside the reserved parcel. */
function insetMarine(ring: Ring): V2[] {
  return ring.map(([x, z]) => [x * 0.975, z * 0.975]);
}

export function createMarineBuilding(
  detail: boolean,
  entryOptions: { thresholdY?: number } = {},
): THREE.Group {
  const brick = new Batch('Marine Building / variegated brick masses', {
    roughness: 0.9,
    metalness: 0,
  });
  const stone = new Batch('Marine Building / granite and terracotta', {
    roughness: 0.78,
    metalness: 0.02,
  });
  const ornaments = new Batch('Marine Building / abstract Art Deco relief', {
    roughness: 0.69,
  });
  const glass = new Batch('Marine Building / recessed window glazing', {
    roughness: 0.23,
    metalness: 0.3,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const lit = new Batch(
    'Marine Building / occupied window glazing',
    {
      roughness: 0.25,
      metalness: 0.23,
      emissive: 0xf2c291,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    },
    0.8,
  );
  const copper = new Batch('Marine Building / patinated crown and metalwork', {
    roughness: 0.57,
    metalness: 0.57,
  });
  const outline = insetMarine(MARINE_OUTLINE);
  // Replaces the base shell plus the lower front tower wall. The entry threshold
  // uses the existing street elevation; the building placement/base is unchanged.
  const entrance = createMarineGroundEntrance(detail, entryOptions);

  const facade = (
    ring: Ring,
    bottom: number,
    top: number,
    level: number,
  ): void => {
    eachEdge(ring, (a, _b, length, t, normal, yaw, edge) => {
      const bays = Math.max(1, Math.floor(length / 3.45));
      const pitch = length / bays;
      const middle: V3 = [
        a[0] + (t[0] * length) / 2,
        (bottom + top) / 2,
        a[1] + (t[1] * length) / 2,
      ];
      // Ground cornices stop at the raised entrance surround.
      const trimRanges =
        level === 0 ? marineGroundTrimRanges(a, _b) : [[0, length]];
      for (const [from, to] of trimRanges) {
        const tx = a[0] + (t[0] * (from + to)) / 2;
        const tz = a[1] + (t[1] * (from + to)) / 2;
        stone.box([to - from, 0.48, 0.18], [tx, top - 0.2, tz], 0xd3bb90, yaw);
        stone.box([to - from, 0.2, 0.24], [tx, top - 1.3, tz], 0xb59b74, yaw);
      }
      for (let bay = 0; bay < bays; bay++) {
        const px = a[0] + t[0] * (bay + 0.5) * pitch + normal[0] * 0.065;
        const pz = a[1] + t[1] * (bay + 0.5) * pitch + normal[1] * 0.065;
        const entryBay = marineGroundBayOverlapsEntry(px, pz, pitch / 2);
        if (level === 0 && entryBay) continue;
        // Tall, creamy ribs are the main reading at city scale.
        if (length > 2.5) {
          const ribX = px - t[0] * pitch * 0.45,
            ribZ = pz - t[1] * pitch * 0.45;
          const ribBottom =
            level === 2 && entryBay
              ? Math.max(bottom, entrance.userData.upperCutY)
              : bottom;
          stone.box(
            [Math.min(0.38, pitch * 0.13), top - ribBottom - 0.5, 0.18],
            [ribX, (ribBottom + top) / 2, ribZ],
            bay % 3 === 0 ? 0xd1ba91 : 0xb89b72,
            yaw,
          );
        }
        // Resolve each setback's floors locally; even the short 6 m tiers get a window row.
        const floors = Math.max(1, Math.round((top - bottom) / 4.2));
        const floorPitch = (top - bottom - 2) / floors;
        const windowHeight = Math.min(2.25, floorPitch - 0.35);
        for (let floor = 0; floor < floors; floor++) {
          const y = bottom + 0.5 + (floor + 0.5) * floorPitch;
          // Part index1 is facade level2. Its low row and vertical ribs would
          // otherwise cross the raised arch despite the wall aperture.
          if (
            level === 2 &&
            entryBay &&
            y - windowHeight / 2 < entrance.userData.upperCutY
          )
            continue;
          const batch =
            (floor * 11 + bay * 7 + edge * 3 + level) % 17 < 4 ? lit : glass;
          const width = Math.max(0.45, Math.min(pitch - 0.7, 2.35));
          batch.window(
            width,
            windowHeight,
            [px, y, pz],
            yaw,
            (floor + bay) % 3 ? 0x3d504d : 0x364442,
          );
          if (detail) {
            copper.box([0.07, windowHeight, 0.035], [px, y, pz], 0x777d68, yaw);
            stone.box(
              [width + 0.15, 0.13, 0.22],
              [px, y - windowHeight / 2 - 0.05, pz],
              0xc7ac82,
              yaw,
            );
            ornaments.box(
              [width * 0.8, 0.2, 0.04],
              [px, y + 1.54, pz],
              (floor + bay) % 2 ? 0xb08a62 : 0x846144,
              yaw,
            );
          }
        }
        if (detail && length > 3) {
          // Original geometric relief: stylised stepped chevrons, not copied sculpture.
          for (let step = 0; step < 2; step++) {
            ornaments.box(
              [Math.max(0.2, pitch * (0.58 - 0.12 * step)), 0.15, 0.13],
              [px, top - 0.72 - step * 0.18, pz],
              0xe1cca5,
              yaw,
            );
          }
        }
      }
    });
  };
  facade(outline, 1.35, 8, 0);
  MARINE_PARTS.forEach((part, i) => {
    const ring = insetMarine(part.ring);
    brick.prism(
      ring,
      i === 1 ? entrance.userData.upperCutY : part.bottom,
      part.top,
      [0x987355, 0x936d50, 0x997454, 0x98714e, 0xa78058, 0xac885e][i],
    );
    facade(ring, part.bottom, part.top, i + 1);
    // Flat roof terraces are visibly darker than the articulated elevations.
    const roof = ring.map(([x, z]) => [x * 0.997, z * 0.997] as V2);
    copper.prism(roof, part.top + 0.01, part.top + 0.07, 0x666c5c);
  });
  // Faceted lantern and verdigris hipped crown visible in VHF's present-day photo.
  const cx = 0.45,
    cz = -0.1;
  const lantern: V2[] = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * TAU + Math.PI / 8;
    return [cx + 3.25 * Math.cos(a), cz + 3.95 * Math.sin(a)];
  });
  stone.prism(lantern, 88, 92.05, 0xd3c5a1);
  eachEdge(lantern, (a, _b, len, t, normal, yaw) => {
    glass.window(
      len * 0.65,
      2.3,
      [
        a[0] + (t[0] * len) / 2 + normal[0] * 0.065,
        90,
        a[1] + (t[1] * len) / 2 + normal[1] * 0.065,
      ],
      yaw,
      0x3b514c,
    );
  });
  const roofP: number[] = [],
    roofI: number[] = [];
  lantern.forEach(([x, z], i) => {
    const next = lantern[(i + 1) % lantern.length];
    const offset = roofP.length / 3;
    roofP.push(x, 92.05, z, cx, 96.6, cz, next[0], 92.05, next[1]);
    roofI.push(offset, offset + 1, offset + 2);
  });
  copper.add(geometry(roofP, roofI), 0x88aa95);
  copper.cylinder(0.09, 0.15, 1.4, [cx, 97.3, cz], 0xaa9161, 8);
  if (detail) {
    for (const p of lantern)
      copper.beam([p[0], 92.08, p[1]], [cx, 96.62, cz], 0.045, 0x6b9480, 4);
    copper.cylinder(0.22, 0.22, 0.22, [cx, 97.8, cz], 0xc5ae71, 12);
  }
  const result = complete(
    'Marine Building — original Art Deco interpretation',
    detail,
    [brick, stone, ornaments, glass, lit, copper],
    SECONDARY_LANDMARK_PLACEMENTS.marineBuilding,
    [outline],
  );
  result.add(entrance);
  // LandmarkDetail.registerNight reads only the top-level list.
  result.userData.nightMaterials.push(...entrance.userData.nightMaterials);
  result.userData.entryLiftY = entrance.userData.entryLiftY;
  result.userData.thresholdY = entrance.userData.thresholdY;
  result.userData.upperCutY = entrance.userData.upperCutY;
  const bounds = new THREE.Box3().setFromObject(result);
  result.userData.bounds = {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
  };
  let triangles = 0,
    drawCalls = 0;
  result.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      drawCalls++;
      triangles +=
        (object.geometry.index?.count ??
          object.geometry.getAttribute('position').count) / 3;
    }
  });
  result.userData.triangles = triangles;
  result.userData.drawCalls = drawCalls;
  return result;
}

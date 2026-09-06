/** Original MIT Science World entrance study, 2026.
 * Replaces only the old entry glass box and low canopy; preserves the main
 * pavilion, sphere, annex envelope, location and deck datum. No renderer/DOM.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
type P = readonly [number, number, number];
type XZ = readonly [number, number];
const YAW = -0.35,
  CS = Math.cos(YAW),
  SN = Math.sin(YAW);
const ENTRY: XZ = [39, -43],
  CANOPY: XZ = [40, -52];
export const SCIENCE_ENTRY_CONTRACT = {
  placement: { lon: -123.1039114, lat: 49.2733499, yaw: 0, baseY: 3.4 },
  originalEntry: { size: [10, 10.8, 11], center: [39, 6.45, -43], yaw: -0.35 },
  originalCanopy: {
    size: [12.8, 0.28, 15],
    center: [40, 2.9, -52],
    yaw: -0.35,
  },
  pavilionRoofY: 11.85,
  podiumTopY: 1,
  defaultThresholdY: 1.02,
  defaultCanopySoffitY: 4.15,
  doorRecessM: 0.85,
  doorHeightM: 2.95,
  frontCenterLocal: [39 - SN * 5.5, -43 - CS * 5.5],
  reconstruction:
    'Original entrance interpretation within the existing entry/canopy footprints; no measured architectural dimension claim.',
  groundPolicy:
    'Keep podium/deck datum. The mapped street pavement does not cover this forecourt; roadRelief alone is not an existing sidewalk surface.',
} as const;
export interface ScienceEntryOptions {
  /** Building-local Y. Existing concrete podium top=1, world=4.4m. */
  thresholdY?: number;
  /** Lowest structural soffit. Source canopy underside2.76 gave only1.71m clear. */
  canopySoffitY?: number;
  /** Actual existing ground/paving surface, in building-local XZ/Y, for feet.
   * Default footings extend to local-1.6m conservatively; this does not add paving. */
  footingSurfaceY?: (x: number, z: number) => number;
}
export function scienceEntryPoint(x: number, y: number, z: number): P {
  return [ENTRY[0] + CS * x + SN * z, y, ENTRY[1] - SN * x + CS * z];
}
export function scienceEntryCoordinates(x: number, z: number): XZ {
  const dx = x - ENTRY[0],
    dz = z - ENTRY[1];
  return [CS * dx - SN * dz, SN * dx + CS * dz];
}
export function scienceCanopyPoint(x: number, y: number, z: number): P {
  return [CANOPY[0] + CS * x + SN * z, y, CANOPY[1] - SN * x + CS * z];
}
export function scienceCanopyCoordinates(x: number, z: number): XZ {
  const dx = x - CANOPY[0],
    dz = z - CANOPY[1];
  return [CS * dx - SN * dz, SN * dx + CS * dz];
}
export function isInsideScienceEntryReservedFootprints(
  x: number,
  z: number,
  tolerance = 0.00002,
): boolean {
  const a = scienceEntryCoordinates(x, z),
    b = scienceCanopyCoordinates(x, z);
  return (
    (Math.abs(a[0]) <= 5 + tolerance && Math.abs(a[1]) <= 5.5 + tolerance) ||
    (Math.abs(b[0]) <= 6.4 + tolerance && Math.abs(b[1]) <= 7.5 + tolerance)
  );
}

class Batch {
  parts: THREE.BufferGeometry[] = [];
  material: THREE.MeshStandardMaterial;
  constructor(
    readonly role: string,
    roughness: number,
    metalness: number,
    readonly nightIntensity = 0,
  ) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
      emissive: nightIntensity ? 0xffd7ab : 0,
      emissiveIntensity: 0,
    });
  }
  add(source: THREE.BufferGeometry, color: number) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    for (const key of Object.keys(g.attributes))
      if (!['position', 'normal'].includes(key)) g.deleteAttribute(key);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const c = new THREE.Color(color),
      colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  quad(a: P, b: P, c: P, d: P, color: number, expected: P) {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      cv = new THREE.Vector3(...c);
    const reverse =
      bv
        .sub(av)
        .cross(cv.sub(av))
        .dot(new THREE.Vector3(...expected)) < 0;
    const g = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        reverse
          ? [...a, ...c, ...b, ...a, ...d, ...c]
          : [...a, ...b, ...c, ...a, ...c, ...d],
        3,
      ),
    );
    g.computeVertexNormals();
    this.add(g, color);
  }
  finish(group: THREE.Group) {
    if (!this.parts.length) {
      this.material.dispose();
      return;
    }
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!g) throw new Error('Science entry geometry merge failed');
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = `Science entrance / ${this.role}`;
    mesh.userData.role = this.role;
    mesh.castShadow = this.role !== 'glass' && this.role !== 'light';
    mesh.receiveShadow = this.role !== 'light';
    if (this.role === 'floor') mesh.userData.walkSurface = true;
    group.add(mesh);
    if (this.nightIntensity) {
      this.material.userData.nightIntensity = this.nightIntensity;
      group.userData.nightMaterials.push({
        material: this.material,
        intensity: this.nightIntensity,
      });
    }
  }
}

export function createScienceEntrance(
  detail: boolean,
  options: ScienceEntryOptions = {},
): THREE.Group {
  const threshold =
    options.thresholdY ?? SCIENCE_ENTRY_CONTRACT.defaultThresholdY;
  const soffit =
    options.canopySoffitY ?? SCIENCE_ENTRY_CONTRACT.defaultCanopySoffitY;
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 2.5)
    throw new Error(
      'Science entry threshold must preserve/clear existing podium',
    );
  if (!Number.isFinite(soffit) || soffit - threshold < 3.05 || soffit > 6)
    throw new Error('Science canopy needs at least3.05m structural clearance');
  const footingSample = (x: number, z: number) => {
    const p = scienceCanopyPoint(x, 0, z),
      y = options.footingSurfaceY?.(p[0], p[2]) ?? -1.6;
    if (!Number.isFinite(y) || y >= soffit - 0.7 || y < -20)
      throw new Error('Invalid Science canopy footing surface');
    return y;
  };
  const footingSpecs = [-5.2, 5.2].flatMap((x) =>
    [-5.85, 3.95].map((z) => ({ x, z, surface: footingSample(x, z) })),
  );
  const pipeSpecs = [-6.12, 6.12].map((x) => ({
    x,
    surface: footingSample(x, 3.9),
  }));
  const group = new THREE.Group();
  group.name = 'Science World / entrance replacement';
  group.userData.nightMaterials = [];
  const metal = new Batch('painted steel and aluminium', 0.43, 0.52);
  const glass = new Batch('glass', 0.24, 0.34, 0.16);
  const opaque = new Batch('soffit and recess', 0.82, 0.015);
  const light = new Batch('light', 0.55, 0.05, 0.55);
  const floor = new Batch('floor', 0.9, 0.01);
  type Frame = 'entry' | 'canopy';
  const point = (p: P, frame: Frame) =>
    frame === 'entry' ? scienceEntryPoint(...p) : scienceCanopyPoint(...p);
  const transform = (g: THREE.BufferGeometry, frame: Frame) => {
    const p = frame === 'entry' ? ENTRY : CANOPY;
    return g.rotateY(YAW).translate(p[0], 0, p[1]);
  };
  const box = (
    batch: Batch,
    size: P,
    position: P,
    color: number,
    frame: Frame = 'entry',
  ) =>
    batch.add(
      transform(new THREE.BoxGeometry(...size).translate(...position), frame),
      color,
    );
  const beam = (
    batch: Batch,
    a: P,
    b: P,
    r: number,
    color: number,
    sides = 6,
    frame: Frame = 'entry',
  ) => {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      direction = bv.clone().sub(av),
      length = direction.length();
    if (length < 1e-8) return;
    const geometry = new THREE.CylinderGeometry(r, r, length, sides)
      .applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        ),
      )
      .translate(...av.lerp(bv, 0.5).toArray());
    batch.add(transform(geometry, frame), color);
  };
  const quad = (
    batch: Batch,
    a: P,
    b: P,
    c: P,
    d: P,
    color: number,
    normal: P,
    frame: Frame = 'entry',
  ) => {
    const n = new THREE.Vector3(...normal).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      YAW,
    );
    batch.quad(
      point(a, frame),
      point(b, frame),
      point(c, frame),
      point(d, frame),
      color,
      n.toArray(),
    );
  };
  const front = (
    batch: Batch,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z: number,
    color: number,
  ) =>
    quad(
      batch,
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
      color,
      [0, 0, -1],
    );
  const ibeamZ = (
    x: number,
    y: number,
    z: number,
    length: number,
    depth: number,
    width: number,
  ) => {
    box(metal, [0.048, depth, length], [x, y, z], 0xbbc4c2, 'canopy');
    for (const sign of [-1, 1])
      box(
        metal,
        [width, 0.045, length],
        [x, y + (sign * (depth - 0.045)) / 2, z],
        0xcbd3cf,
        'canopy',
      );
  };
  const ibeamX = (
    x: number,
    y: number,
    z: number,
    length: number,
    depth: number,
    width: number,
  ) => {
    box(metal, [length, depth, 0.044], [x, y, z], 0xaebbb9, 'canopy');
    for (const sign of [-1, 1])
      box(
        metal,
        [length, 0.04, width],
        [x, y + (sign * (depth - 0.04)) / 2, z],
        0xc3ccc9,
        'canopy',
      );
  };

  // Door front: a real0.85m recess after removing the original closed glass box.
  // The entry enclosure projects ~2m ahead of the existing annex face, so the
  // dark recess ends before the old red wall; no hidden internal mass needs cut.
  const doorBottom = threshold + 0.02,
    doorTop = threshold + 2.97,
    doorZ = -4.65;
  front(glass, -4.77, 4.77, doorBottom, doorTop, doorZ, 0x3b6269);
  front(opaque, -4.78, 4.78, threshold, threshold + 3.2, -3.64, 0x132e32);
  for (const sign of [-1, 1]) {
    quad(
      opaque,
      [sign * 4.78, threshold, -5.5],
      [sign * 4.78, threshold, -3.64],
      [sign * 4.78, threshold + 3.2, -3.64],
      [sign * 4.78, threshold + 3.2, -5.5],
      0x314247,
      [-sign, 0, 0],
    );
    box(
      metal,
      [0.14, 3.25, 0.16],
      [sign * 4.84, threshold + 1.625, -5.4],
      0xd5dedc,
    );
  }
  quad(
    opaque,
    [-4.78, threshold + 3.2, -5.5],
    [4.78, threshold + 3.2, -5.5],
    [4.78, threshold + 3.2, -3.64],
    [-4.78, threshold + 3.2, -3.64],
    0x485352,
    [0, -1, 0],
  );
  // Floor stays on the existing podium. It is a separate, explicitly walkable
  // mesh, so a canopy/roof can never be accidentally indexed as a walk surface.
  quad(
    floor,
    [-4.77, threshold, -5.5],
    [4.77, threshold, -5.5],
    [4.77, threshold, -3.65],
    [-4.77, threshold, -3.65],
    0xb5b7aa,
    [0, 1, 0],
  );
  for (const x of [-4.76, -3.18, -1.59, 0, 1.59, 3.18, 4.76])
    box(
      metal,
      [0.075, 2.96, 0.12],
      [x, threshold + 1.505, doorZ - 0.02],
      0xb5c0bf,
    );
  for (const y of [doorBottom, doorTop])
    box(metal, [9.58, 0.085, 0.16], [0, y, doorZ - 0.03], 0xc2ccc7);
  // Automatic sliding centre pair, stationary side panes and original pull bars.
  for (const x of [-0.8, 0.8]) {
    box(
      metal,
      [0.035, 2.8, 0.055],
      [x, threshold + 1.49, doorZ - 0.04],
      0x8faaa9,
    );
    beam(
      metal,
      [x, threshold + 0.94, doorZ - 0.16],
      [x, threshold + 1.45, doorZ - 0.16],
      0.021,
      0xbec8c4,
      6,
    );
  }
  box(metal, [3.3, 0.19, 0.22], [0, doorTop + 0.13, doorZ - 0.02], 0x6e8586);
  box(opaque, [0.2, 0.08, 0.075], [0, doorTop + 0.105, doorZ - 0.18], 0x1c292c);
  // Sparse small contrast markers add human scale without copied signage.
  for (let i = 0; i < 8; i++)
    box(
      metal,
      [0.11, 0.05, 0.025],
      [-4.2 + i * 1.2, threshold + 1.43, doorZ - 0.035],
      0xa0b4b1,
    );

  // Upper atrium curtainwall: visible depth and floor/spandrel hierarchy rather
  // than a second sphere cage. All glass uses an opaque PBR approximation.
  const frontBottom = threshold + 3.28,
    levels = [frontBottom, 7.6, 11.7];
  const bays = detail ? 6 : 4;
  for (let j = 1; j < levels.length; j++)
    for (let i = 0; i < bays; i++) {
      const x0 = -4.93 + (i * 9.86) / bays + 0.035,
        x1 = -4.93 + ((i + 1) * 9.86) / bays - 0.035;
      front(
        glass,
        x0,
        x1,
        levels[j - 1] + 0.025,
        levels[j] - 0.025,
        -5.39,
        (i + j) % 3 ? 0x476e75 : 0x547b80,
      );
    }
  for (const y of levels)
    box(metal, [9.98, 0.095, 0.14], [0, y, -5.405], 0xc4d0cc);
  for (let i = 0; i <= bays; i++)
    box(
      metal,
      [0.065, 11.78 - frontBottom, 0.16],
      [-4.94 + (i * 9.88) / bays, (11.78 + frontBottom) / 2, -5.39],
      0xc8d3cf,
    );
  box(opaque, [9.8, 0.26, 0.24], [0, frontBottom - 0.17, -5.35], 0x46565a);
  box(metal, [9.96, 0.055, 0.24], [0, frontBottom - 0.31, -5.35], 0xafbcbb);
  for (const sign of [-1, 1]) {
    // Side surfaces retain the same original11m enclosure depth. The portion
    // inside the original annex remains hidden by that building as before.
    const sideBays = detail ? 5 : 3;
    for (let i = 0; i < sideBays; i++) {
      const z0 = -5.38 + (i * 10.75) / sideBays + 0.025,
        z1 = -5.38 + ((i + 1) * 10.75) / sideBays - 0.025;
      for (let j = 0; j < 3; j++) {
        const y0 = j === 0 ? 1.05 : j === 1 ? 4.35 : 7.6,
          y1 = j === 0 ? 4.35 : j === 1 ? 7.6 : 11.7;
        quad(
          glass,
          [sign * 4.94, y0, z0],
          [sign * 4.94, y0, z1],
          [sign * 4.94, y1, z1],
          [sign * 4.94, y1, z0],
          (i + j) % 2 ? 0x3f6971 : 0x50767c,
          [sign, 0, 0],
        );
      }
    }
    for (let i = 0; i <= sideBays; i++)
      box(
        metal,
        [0.09, 10.68, 0.07],
        [sign * 4.94, 6.39, -5.38 + (i * 10.75) / sideBays],
        0xbccbc9,
      );
    for (const y of [1.1, 4.35, 7.6, 11.74])
      box(metal, [0.16, 0.08, 10.83], [sign * 4.91, y, -0.01], 0xb5c4c1);
  }
  box(opaque, [10, 0.13, 11], [0, 11.785, 0], 0x6b7877);
  for (const z of [-5.43, 5.43])
    box(metal, [10, 0.14, 0.1], [0, 11.77, z], 0xd4dcda);

  // Same canopy XY envelope, corrected clear height, exposed wide-flange beams,
  // thin panel seams, end plates and modest bolted joints.
  const roofBottom = soffit + 0.48,
    roofTop = roofBottom + 0.16;
  for (const x of [-5.2, 0, 5.2])
    ibeamZ(x, soffit + 0.19, 0, 14.64, 0.38, 0.25);
  const crossZ = detail
    ? [-7.18, -4.8, -2.4, 0, 2.4, 4.8, 7.18]
    : [-7.18, -3.6, 0, 3.6, 7.18];
  for (const z of crossZ) ibeamX(0, soffit + 0.37, z, 12.42, 0.22, 0.2);
  const roofX = detail ? 6 : 3,
    roofZ = detail ? 8 : 4;
  for (let ix = 0; ix < roofX; ix++)
    for (let iz = 0; iz < roofZ; iz++) {
      const w = 12.62 / roofX,
        l = 14.82 / roofZ,
        x = -6.31 + (ix + 0.5) * w,
        z = -7.41 + (iz + 0.5) * l;
      box(
        opaque,
        [w - 0.016, 0.16, l - 0.016],
        [x, roofBottom + 0.08, z],
        (ix + iz) % 3 ? 0xb6beb9 : 0xaab5b2,
        'canopy',
      );
    }
  for (const x of [-6.33, 6.33])
    box(metal, [0.1, 0.3, 14.96], [x, roofTop - 0.035, 0], 0xc7cfcb, 'canopy');
  for (const z of [-7.45, 7.45])
    box(metal, [12.68, 0.3, 0.08], [0, roofTop - 0.035, z], 0xc7cfcb, 'canopy');
  const footings = [];
  for (const { x, z, surface: sample } of footingSpecs) {
    const p = scienceCanopyPoint(x, 0, z);
    const base = sample + 0.015,
      top = soffit + 0.22;
    footings.push({ localXZ: [p[0], p[2]], surfaceY: sample, baseY: base });
    box(
      metal,
      [0.18, top - base, 0.18],
      [x, (base + top) / 2, z],
      0xc1cbc6,
      'canopy',
    );
    box(metal, [0.39, 0.04, 0.39], [x, base + 0.02, z], 0x7a8d8b, 'canopy');
    box(
      metal,
      [0.055, 0.48, 0.39],
      [x + 0.16, soffit + 0.11, z],
      0xadb9b7,
      'canopy',
    );
    if (detail) {
      for (const dx of [-0.13, 0.13])
        for (const dz of [-0.13, 0.13])
          beam(
            metal,
            [x + dx, base + 0.04, z + dz],
            [x + dx, base + 0.081, z + dz],
            0.024,
            0x6b7e7f,
            6,
            'canopy',
          );
      for (const yy of [-0.15, 0.15])
        for (const dz of [-0.12, 0.12])
          beam(
            metal,
            [x + 0.17, soffit + 0.11 + yy, z + dz],
            [x + 0.211, soffit + 0.11 + yy, z + dz],
            0.024,
            0x7d8d8b,
            6,
            'canopy',
          );
      const to = z < 0 ? 1 : -1;
      beam(
        metal,
        [x, soffit - 0.56, z],
        [x, soffit + 0.04, z + to * 0.82],
        0.052,
        0x98aaa7,
        4,
        'canopy',
      );
    }
  }
  // Slim drainage drops and under-canopy light runs, no copied logos/text.
  for (const { x, surface: base } of pipeSpecs) {
    beam(
      metal,
      [x, base + 0.15, 3.9],
      [x, roofTop - 0.08, 3.9],
      0.048,
      0x80928f,
      6,
      'canopy',
    );
  }
  for (const x of [-2.58, 2.58])
    box(light, [0.035, 0.035, 11.8], [x, soffit + 0.08, 0], 0xc8d6cc, 'canopy');
  box(light, [7.1, 0.035, 0.035], [0, threshold + 3.12, -5.17], 0xe1d2b0);
  if (detail) {
    // Gasket lines remain behind projecting aluminium; optional close-view
    // fixing covers share one merged opaque batch.
    for (const x of [-4.77, 4.77])
      for (const y of [4.6, 7.55, 11.3])
        box(opaque, [0.055, 0.1, 0.035], [x, y, -5.475], 0x23383e);
  }
  for (const batch of [metal, glass, opaque, light, floor]) batch.finish(group);
  const bounds = new THREE.Box3().setFromObject(group);
  let triangles = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      triangles +=
        (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3;
  });
  Object.assign(group.userData, {
    detail,
    thresholdY: threshold,
    canopySoffitY: soffit,
    canopyRoofTopY: roofTop,
    footings,
    triangleCount: triangles,
    meshCount: group.children.length,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    originalProceduralGeometry: true,
    contract: SCIENCE_ENTRY_CONTRACT,
  });
  return group;
}

/** Adds original paint-scale panel joints/grain to existing red material only.
 * No texture, DOM, per-frame update or extra draw call. Stable program key.
 * Geometry-space coordinates keep metre scale across the two existing red drums
 * and annex. Small anti-aliased joints and roughness variation avoid a noisy wall.
 */
export function applyScienceRedPanelMaterial(
  material: THREE.MeshStandardMaterial,
): void {
  material.roughness = 0.61;
  material.metalness = 0.12;
  material.customProgramCacheKey = () => 'science-red-painted-panels-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSciencePaintP;\nvarying vec3 vSciencePaintN;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSciencePaintP=position;\nvSciencePaintN=normal;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSciencePaintP;\nvarying vec3 vSciencePaintN;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 paintN=normalize(vSciencePaintN);
        float paintRadius=length(vSciencePaintP.xz);
        vec2 paintUV=vec2(abs(paintN.x)>abs(paintN.z)?vSciencePaintP.z:vSciencePaintP.x,vSciencePaintP.y);
        if(paintRadius<32.2)paintUV.x=atan(vSciencePaintP.z,vSciencePaintP.x)*paintRadius;
        vec2 panelSize=vec2(2.4,1.16);
        vec2 panelEdge=min(fract(paintUV/panelSize),1.0-fract(paintUV/panelSize))*panelSize;
        vec2 paintAA=max(fwidth(paintUV),vec2(.002));
        float joint=(1.0-smoothstep(.004,.014+max(paintAA.x,paintAA.y),min(panelEdge.x,panelEdge.y)))*(1.0-abs(paintN.y));
        joint*=min(1.0,.024/(max(paintAA.x,paintAA.y)+.002));
        float paintGrain=(sin(paintUV.x*91.7)*sin(paintUV.y*87.1))*.007/(1.0+40.0*max(paintAA.x,paintAA.y));
        diffuseColor.rgb*=1.0-joint*.17+paintGrain;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+joint*.065+paintGrain,0.0,1.0);',
      );
  };
  material.needsUpdate = true;
  material.userData.sciencePaint = {
    originalProceduralMaterial: true,
    panelWidthM: 2.4,
    panelHeightM: 1.16,
    approximatedPattern: true,
  };
}

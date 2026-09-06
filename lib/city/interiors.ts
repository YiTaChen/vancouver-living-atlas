import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { project, inPolygon } from './geo';
import type { CityEngine } from './engine';
import type { PlacementPoint } from './placement-geometry';
export type InteriorId = 'science' | 'canada' | 'waterfront';
type P = [number, number, number];
type XZ = [number, number];
type Rect = { x: number; z: number; w: number; d: number };
const rect = (x: number, z: number, w: number, d: number): XZ[] => [
  [x - w / 2, z - d / 2],
  [x + w / 2, z - d / 2],
  [x + w / 2, z + d / 2],
  [x - w / 2, z + d / 2],
];
const circle = (r: number): XZ[] =>
  Array.from({ length: 64 }, (_, i) => [
    Math.cos((i * Math.PI) / 32) * r,
    Math.sin((i * Math.PI) / 32) * r,
  ]);
const ANNEX: XZ[] = [
  [25, -29],
  [36, -48],
  [46, -44],
  [56, -29],
  [63, -11],
  [65, 8],
  [60, 23],
  [31, 14],
];
const inside = (p: XZ, poly: XZ[]) => inPolygon(p, [poly]);
const segmentDistance = (p: XZ, a: XZ, b: XZ) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = THREE.MathUtils.clamp(
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz),
      0,
      1,
    );
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
class Parts {
  batches = new Map<
    string,
    { material: THREE.Material; geometries: THREE.BufferGeometry[] }
  >();
  group = new THREE.Group();
  add(key: string, g: THREE.BufferGeometry, color: number, glow = false) {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.deleteAttribute('uv');
    if (!flat.hasAttribute('normal')) flat.computeVertexNormals();
    const c = new THREE.Color(color),
      colors = new Float32Array(flat.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (!this.batches.has(key))
      this.batches.set(key, {
        material: glow
          ? new THREE.MeshBasicMaterial({
              vertexColors: true,
              side: THREE.DoubleSide,
            })
          : new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.75,
              side: THREE.DoubleSide,
              emissive: 0xffffff,
              emissiveIntensity: 0.32,
            }),
        geometries: [],
      });
    const material = this.batches.get(key)!.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor.rgb;\n#endif',
        );
      };
      material.customProgramCacheKey = () => 'interior-coloured-ambient-v1';
    }
    this.batches.get(key)!.geometries.push(flat);
  }
  box(size: P, p: P, color: number, key = 'structure') {
    this.add(
      key,
      new THREE.BoxGeometry(...size).translate(...p),
      color,
      key === 'light',
    );
  }
  cylinder(radius: number, height: number, p: P, color: number) {
    this.add(
      'structure',
      new THREE.CylinderGeometry(radius, radius, height, 16).translate(...p),
      color,
    );
  }
  beam(a: P, b: P, r: number, color: number) {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      delta = bv.clone().sub(av);
    this.add(
      'structure',
      new THREE.CylinderGeometry(r, r, delta.length(), 8)
        .applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            delta.normalize(),
          ),
        )
        .translate(...av.lerp(bv, 0.5).toArray()),
      color,
    );
  }
  floor(poly: XZ[], y: number, color: number) {
    const shape = new THREE.Shape(
      poly.map((p) => new THREE.Vector2(p[0], -p[1])),
    );
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2).translate(0, y, 0);
    this.add('floor', g, color);
  }
  sign(text: string, p: P, width: number, yaw = 0) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#163d59';
    ctx.fillRect(0, 0, 768, 96);
    ctx.fillStyle = '#f5f0df';
    ctx.font = '500 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 384, 48, 730);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 8),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    mesh.position.set(...p);
    mesh.rotation.y = yaw;
    mesh.name = 'Interior wayfinding / ' + text;
    this.group.add(mesh);
  }
  finish() {
    for (const [key, b] of this.batches) {
      const mesh = new THREE.Mesh(
        mergeGeometries(b.geometries, false)!,
        b.material,
      );
      mesh.name = 'Interior / ' + key;
      mesh.userData.walkSurface = key === 'floor';
      mesh.receiveShadow = true;
      this.group.add(mesh);
      b.geometries.forEach((g) => g.dispose());
    }
    return this.group;
  }
}
interface Site {
  id: InteriorId;
  origin: THREE.Vector3;
  yaw: number;
  floor: number;
  polys: XZ[][];
  doors: Rect[];
  obstacles: Rect[];
  group: THREE.Group;
  envelope: THREE.Group | null;
  plane: THREE.Plane;
  installed: WeakSet<THREE.Material>;
  entry: XZ;
  entryYaw: number;
  approach: Rect;
  approachOuter: number;
}
export class PublicInteriors {
  sites: Site[] = [];
  cutawayEnabled = true;
  constructor(private e: CityEngine) {
    e.renderer.localClippingEnabled = true;
    for (const id of ['science', 'canada', 'waterfront'] as InteriorId[])
      this.create(id);
  }
  private create(id: InteriorId) {
    const place =
      id === 'science'
        ? [-123.1039114, 49.2733499, 0, 3.4]
        : id === 'canada'
          ? [-123.111352, 49.2886214, -1.073, 3.5]
          : [-123.11182, 49.28571, -0.77, 0];
    const [wx, wz] = project(place);
    let base = id === 'waterfront' ? this.e.elevation(wx, wz) : place[3];
    if (id === 'waterfront')
      for (const x of [-55, 0, 55])
        for (const z of [-15, 0, 15]) {
          const c = Math.cos(place[2]),
            s = Math.sin(place[2]);
          base = Math.max(
            base,
            this.e.elevation(wx + c * x + s * z, wz - s * x + c * z),
          );
        }
    const floor =
      id === 'science'
        ? Math.max(
            1.04,
            (this.e.data.landmarkGroundPlans?.find(
              (p: any) => p.kind === 'science',
            )?.thresholdY ?? 1.02) + 0.02,
          )
        : id === 'canada'
          ? 1.35
          : 0.2;
    const polys =
      id === 'science'
        ? [circle(31.7), ANNEX]
        : id === 'canada'
          ? [rect(0.5, -0.5, 64, 180)]
          : [rect(0, 0, 112, 32)];
    const doors: Rect[] =
      id === 'science'
        ? [
            { x: 40, z: -44, w: 8, d: 22 },
            { x: 31, z: -22.5, w: 22, d: 15 },
          ]
        : id === 'canada'
          ? [
              { x: -32, z: -64, w: 8, d: 8 },
              { x: 33, z: -64, w: 8, d: 8 },
            ]
          : [{ x: 0, z: 16, w: 7, d: 4 }];
    const approach =
      id === 'science'
        ? { x: 40, z: -55, w: 8, d: 12 }
        : id === 'canada'
          ? { x: -40, z: -64, w: 16, d: 8 }
          : { x: 0, z: 22, w: 7, d: 12 };
    const entry: XZ =
      id === 'science' ? [40, -59] : id === 'canada' ? [-46, -64] : [0, 26];
    const parts = new Parts(),
      group = parts.group;
    group.name = 'Public interior / ' + id;
    group.position.set(wx, base, wz);
    group.rotation.y = place[2];
    const site: Site = {
      id,
      origin: group.position.clone(),
      yaw: place[2],
      floor,
      polys,
      doors,
      obstacles: [],
      group,
      envelope: null,
      plane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e7),
      installed: new WeakSet(),
      entry,
      entryYaw: id === 'science' ? 0 : id === 'canada' ? Math.PI / 2 : Math.PI,
      approach,
      approachOuter: 0,
    };
    const outer = this.world(site, ...entry);
    site.approachOuter = this.e.elevation(outer[0], outer[1]) - base;
    const f = floor,
      cream = 0xe1d8c7,
      steel = 0x47606c;
    polys.forEach((poly) =>
      parts.floor(
        poly,
        f,
        id === 'science' ? 0xc7c3b0 : id === 'canada' ? 0xa8bfc2 : 0xd8cbb9,
      ),
    );
    doors.forEach((d) =>
      parts.floor(rect(d.x, d.z, d.w, d.d), f + 0.002, 0xb9bdb7),
    );
    // Continuous threshold/ramp matches the same height function used by walking.
    const ramp = rect(approach.x, approach.z, approach.w, approach.d),
      positions: number[] = [];
    for (const i of [0, 2, 1, 0, 3, 2]) {
      const p = ramp[i];
      positions.push(p[0], this.localHeight(site, ...p), p[1]);
    }
    const rampG = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    rampG.computeVertexNormals();
    parts.add('floor', rampG, 0xbcbbaa);
    const obstacle = (
      x: number,
      z: number,
      w: number,
      d: number,
      h: number,
      color: number,
    ) => {
      parts.box([w, h, d], [x, f + h / 2, z], color);
      site.obstacles.push({ x, z, w, d });
    };
    const bench = (x: number, z: number, w = 3) => {
      obstacle(x, z, w, 0.7, 0.48, 0x8d6e4e);
      parts.box([w, 0.55, 0.12], [x, f + 0.78, z - 0.32], 0x8d6e4e);
    };
    if (id === 'science') {
      // A central stage, demonstration islands and an open circulation ring.
      parts.cylinder(4, 0.3, [0, f + 0.15, 0], 0x357f99);
      site.obstacles.push({ x: 0, z: 0, w: 7, d: 7 });
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        const x = Math.cos(a) * 24,
          z = Math.sin(a) * 24;
        parts.cylinder(0.42, 9, [x, f + 4.5, z], cream);
        site.obstacles.push({ x, z, w: 1, d: 1 });
        parts.beam([x, f + 8.6, z], [0, f + 9, 0], 0.16, steel);
      }
      for (const [x, z, c] of [
        [-16, -12, 0xe2b347],
        [-15, 12, 0x448aaf],
        [12, 17, 0xba5a65],
        [13, -11, 0x64a987],
      ]) {
        obstacle(x, z, 4, 3, 0.9, c);
        parts.add(
          'structure',
          new THREE.TorusGeometry(1, 0.075, 8, 28)
            .rotateX(0.4)
            .translate(x, f + 2, z),
          0xdee2d9,
        );
        parts.cylinder(0.55, 0.7, [x, f + 1.25, z], 0x526877);
      }
      for (const z of [-18, -10, 0, 10]) bench(47, z, 4);
      parts.sign(
        'ADMISSIONS  •  SCIENCE WORLD',
        [49, f + 2.4, -34.9],
        7,
        Math.PI,
      );
      parts.sign('PUZZLES & ILLUSIONS', [15, f + 3, -20], 8, Math.PI);
      obstacle(49, -34, 6, 1.5, 1.1, 0x357d93); // admissions
      for (let i = 0; i < 5; i++)
        parts.box([0.8, 0.5, 0.2], [47 + i, f + 1.35, -34], 0x153745);
      for (const z of [-17, 0, 17])
        parts.box([18, 0.11, 0.25], [45, f + 7, z], 0xf3dbac, 'light');
      for (const x of [-12, 0, 12])
        parts.box([0.2, 0.08, 34], [x, f + 8.8, 0], 0xf3dbac, 'light');
    } else if (id === 'canada') {
      for (const x of [-32.2, 33.2]) {
        for (const z of [-68.1, -59.9])
          parts.box([0.22, 3.6, 0.22], [x, f + 1.8, z], steel);
        parts.box([0.22, 0.2, 8.4], [x, f + 3.6, -64], steel);
        // Door leaves are parked open against the side jambs.
        for (const z of [-67.8, -60.2])
          parts.box([1.2, 3, 0.1], [x, f + 1.5, z], 0x75999e);
      }

      // Long delegate concourse alongside three partitioned exhibition bays.
      for (const z of [-38, 18, 64]) {
        for (const x of [-24, 25]) {
          parts.cylinder(0.55, 12, [x, f + 6, z], cream);
          site.obstacles.push({ x, z, w: 1.4, d: 1.4 });
        }
        parts.beam([-24, f + 11.8, z], [25, f + 11.8, z], 0.25, steel);
      }
      for (const z of [-27, 29]) {
        obstacle(8, z, 44, 0.3, 5.5, 0xe5dfd0);
        parts.box([44, 0.12, 0.12], [8, f + 5.6, z], 0x68858c);
      }
      for (const z of [-48, 7, 56]) {
        for (const x of [-27, -19]) bench(x, z, 3);
        obstacle(8, z, 8, 2, 1, 0x446d80);
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 6; col++) {
            const x = -3 + col * 3,
              zz = z + 6 + row * 3;
            obstacle(x, zz, 0.65, 0.7, 0.45, 0x486b7b);
            parts.box([0.65, 0.6, 0.12], [x, f + 0.7, zz + 0.3], 0x486b7b);
          }
      }
      parts.sign(
        'CANADA PLACE  •  WELCOME',
        [-29, f + 2.7, -64],
        8,
        -Math.PI / 2,
      );
      for (const [i, z] of [-48, 7, 56].entries())
        parts.sign(
          'EXHIBITION HALL ' + ['A', 'B', 'C'][i],
          [-15, f + 3.4, z],
          8,
          -Math.PI / 2,
        );
      obstacle(-11, -73, 9, 1.5, 1.05, 0x78989e);
      for (let z = -76; z < 87; z += 14)
        parts.box([49, 0.1, 0.22], [0.5, f + 10, z], 0xffe6b9, 'light');
    } else {
      // Heritage station shell replaces the generic filled geographic prism.
      const envelope = new Parts();
      envelope.group.name = 'Waterfront Station / heritage shell';
      envelope.group.position.copy(group.position);
      envelope.group.rotation.copy(group.rotation);
      const brick = 0x8f4c3b;
      for (const x of [-29.75, 29.75])
        envelope.box([52.5, 8.5, 0.5], [x, f + 4.25, 16], brick);
      envelope.box([112, 9, 0.5], [0, f + 13, 16], brick);
      envelope.box([112, 17.5, 0.5], [0, f + 8.75, -16], brick);
      for (const x of [-56, 56])
        envelope.box([0.5, 17.5, 32], [x, f + 8.75, 0], brick);
      envelope.box([114, 0.6, 34], [0, f + 17.8, 0], 0x6a716e);
      const roofPoints: P[] = [
        [-57, f + 18, -17],
        [57, f + 18, -17],
        [57, f + 18, 17],
        [-57, f + 18, 17],
        [-44, f + 22, 0],
        [44, f + 22, 0],
      ];
      const roof = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [0, 1, 5, 0, 5, 4, 1, 2, 5, 2, 3, 4, 2, 4, 5, 3, 0, 4].flatMap(
            (i) => roofPoints[i],
          ),
          3,
        ),
      );
      roof.computeVertexNormals();
      envelope.add('structure', roof, 0x526b60);

      for (const y of [1, 8.7, 16.5])
        envelope.box([114, 0.35, 0.8], [0, f + y, 16.3], cream);
      for (let x = -48; x <= 48; x += 8) {
        envelope.box([3, 5, 0.12], [x, f + 12, 16.31], 0x74959a);
        if (Math.abs(x) > 5)
          envelope.box([2.8, 4, 0.12], [x, f + 4.2, 16.31], 0x74959a);
      }
      for (const x of [-12, -8, -4, 4, 8, 12]) {
        envelope.cylinder(0.6, 8, [x, f + 4, 19], cream);
        envelope.box([1.6, 0.35, 1.6], [x, f + 8, 19], cream);
      }
      envelope.box([29, 0.6, 6], [0, f + 8.5, 18], cream);
      const pediment = new THREE.Shape([
        new THREE.Vector2(-14, f + 8.9),
        new THREE.Vector2(14, f + 8.9),
        new THREE.Vector2(0, f + 12.4),
      ]);
      envelope.add(
        'structure',
        new THREE.ExtrudeGeometry(pediment, {
          depth: 0.45,
          bevelEnabled: false,
        }).translate(0, 0, 20.5),
        cream,
      );

      for (const x of [-3.6, 3.6])
        envelope.box([0.18, 3.4, 0.4], [x, f + 1.7, 16], 0x546f73);
      envelope.box([7.4, 0.18, 0.4], [0, f + 3.4, 16], 0x546f73);
      // Open glazed door leaves held alongside the jambs.
      for (const x of [-3.5, 3.5])
        envelope.box([0.12, 3, 1.3], [x, f + 1.5, 15.3], 0x759799);
      for (let x = -44; x <= 44; x += 11) {
        for (const z of [-10, 10]) {
          if (Math.abs(x) < 3) continue;
          parts.cylinder(0.48, 7.5, [x, f + 3.75, z], cream);
          parts.box([1.5, 0.32, 1.5], [x, f + 7.5, z], cream);
          site.obstacles.push({ x, z, w: 1.2, d: 1.2 });
        }
        parts.box([0.3, 0.55, 24], [x, f + 7.8, 0], cream);
      }
      for (let x = -44; x < 50; x += 11)
        for (const z of [-6, 0, 6]) {
          parts.box([9.8, 0.18, 5.6], [x + 5.5, f + 8.15, z], 0xc3a999);
          parts.box([2, 0.08, 1], [x + 5.5, f + 8, z], 0xffdfb1, 'light');
        }
      for (const x of [-43, -30, 27, 40]) bench(x, 2, 4);
      obstacle(-42, -12, 12, 2, 1.15, 0x475b62); // ticket/customer-service counter
      for (let x = -18; x <= 18; x += 3)
        obstacle(x, -11, 0.55, 1.8, 0.95, 0x678186);
      // Clock and suspended blue wayfinding panels.
      parts.add(
        'structure',
        new THREE.CylinderGeometry(1.2, 1.2, 0.15, 40)
          .rotateX(Math.PI / 2)
          .translate(0, f + 6.6, -15.55),
        0xefe9d6,
      );
      parts.beam([0, f + 6.6, -15.4], [0, f + 7.4, -15.4], 0.045, 0x24393f);
      parts.beam([0, f + 6.6, -15.4], [0.7, f + 6.3, -15.4], 0.045, 0x24393f);
      parts.box([14, 1, 0.2], [0, f + 4, -10], 0x184f89);
      parts.sign(
        'SkyTrain  •  SeaBus  •  West Coast Express',
        [0, f + 4, -9.87],
        14,
      );
      parts.sign('TICKETS  /  CUSTOMER SERVICE', [-42, f + 2.5, -10.8], 12);
      envelope.sign('WATERFRONT STATION', [0, f + 9.1, 18.1], 22);
      site.envelope = envelope.finish();
      this.e.landmarks.add(site.envelope);
    }
    parts.finish();
    this.e.landmarks.add(group);
    this.sites.push(site);
  }
  world(site: Site, x: number, z: number): XZ {
    const c = Math.cos(site.yaw),
      s = Math.sin(site.yaw);
    return [site.origin.x + c * x + s * z, site.origin.z - s * x + c * z];
  }
  local(site: Site, x: number, z: number): XZ {
    const c = Math.cos(site.yaw),
      s = Math.sin(site.yaw),
      dx = x - site.origin.x,
      dz = z - site.origin.z;
    return [c * dx - s * dz, s * dx + c * dz];
  }
  private inRect(p: XZ, r: Rect, margin = 0) {
    return (
      Math.abs(p[0] - r.x) <= r.w / 2 + margin &&
      Math.abs(p[1] - r.z) <= r.d / 2 + margin
    );
  }
  private localHeight(site: Site, x: number, z: number) {
    const a = site.approach;
    if (!this.inRect([x, z], a)) return site.floor;
    const t =
      site.id === 'science'
        ? (z + 61) / 12
        : site.id === 'canada'
          ? (x + 48) / 16
          : (28 - z) / 12;
    return THREE.MathUtils.lerp(
      site.approachOuter,
      site.floor,
      THREE.MathUtils.clamp(t, 0, 1),
    );
  }
  private siteAt(x: number, z: number) {
    for (const site of this.sites) {
      const p = this.local(site, x, z);
      if (
        site.polys.some((poly) => inside(p, poly)) ||
        site.doors.some((r) => this.inRect(p, r)) ||
        this.inRect(p, site.approach)
      )
        return { site, p };
    }
    return null;
  }
  height(x: number, z: number) {
    const hit = this.siteAt(x, z);
    return hit
      ? hit.site.origin.y + this.localHeight(hit.site, ...hit.p)
      : undefined;
  }
  clear(x: number, z: number, mode: string): boolean | undefined {
    const hit = this.siteAt(x, z);
    if (!hit) return undefined;
    const { site, p } = hit;
    if (mode !== 'walk') return false;
    if (site.obstacles.some((r) => this.inRect(p, r, 0.35))) return false;
    const door = site.doors.some((r) => this.inRect(p, r, -0.35));
    if (
      !door &&
      site.polys.some((poly) =>
        poly.some(
          (a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length]) < 0.55,
        ),
      )
    )
      return false;
    return true;
  }
  entry(id: InteriorId): PlacementPoint {
    const site = this.sites.find((s) => s.id === id)!;
    const [x, z] = this.world(site, ...site.entry);
    return {
      x,
      z,
      y: this.height(x, z)! + 1.25,
      yaw: site.yaw + site.entryYaw,
      surface: 'ground',
      name: id,
      snappedDistance: 0,
    };
  }
  update() {
    for (const site of this.sites) {
      const local = this.local(
        site,
        this.e.camera.position.x,
        this.e.camera.position.z,
      );
      const near = Math.hypot(...local) < (site.id === 'canada' ? 190 : 140);
      site.group.visible = this.e.settings.buildings && near;
      if (site.envelope) site.envelope.visible = this.e.settings.buildings;
      const cut =
        this.cutawayEnabled &&
        this.e.settings.mode === 'orbit' &&
        near &&
        this.e.camera.position.y > site.origin.y + site.floor + 10 &&
        this.e.camera.position.y < site.origin.y + 240;
      site.plane.constant = cut ? site.origin.y + site.floor + 3.3 : 1e7;
      const holder =
        site.envelope ??
        this.e.landmarkDetails.find(
          (l) =>
            l.medium.userData.placement?.lon ===
            (site.id === 'science' ? -123.1039114 : -123.111352),
        )?.holder;
      for (const root of [holder, site.group])
        root?.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (!site.installed.has(material)) {
              material.side = THREE.DoubleSide;
              material.clippingPlanes = [site.plane];
              material.clipShadows = true;
              material.needsUpdate = true;
              site.installed.add(material);
            }
        });
    }
  }
}

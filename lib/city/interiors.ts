import * as THREE from 'three';
import { SKY_WALK, SEABUS_TERMINAL, corridorQuad } from './seabus-layout';
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
        material:
          key === 'glass'
            ? new THREE.MeshBasicMaterial({
                vertexColors: true,
                transparent: true,
                opacity: 0.16,
                depthWrite: false,
                side: THREE.DoubleSide,
              })
            : glow
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
  floor(
    poly: XZ[],
    y: number | ((x: number, z: number) => number),
    color: number,
  ) {
    // Split at circulation-profile creases so a diagonal SkyWalk deck does not
    // interpolate a ramp height across the preceding flat bridge.
    if (typeof y === 'function')
      for (const cut of [-192, -140, 16, 28]) {
        if (
          Math.min(...poly.map((p) => p[1])) < cut - 1e-7 &&
          Math.max(...poly.map((p) => p[1])) > cut + 1e-7
        ) {
          const clip = (side: number) => {
            const out: XZ[] = [];
            for (let i = 0; i < poly.length; i++) {
              const a = poly[i],
                b = poly[(i + 1) % poly.length],
                aa = (a[1] - cut) * side >= 0,
                bb = (b[1] - cut) * side >= 0;
              if (aa) out.push(a);
              if (aa !== bb) {
                const t = (cut - a[1]) / (b[1] - a[1]);
                out.push([a[0] + (b[0] - a[0]) * t, cut]);
              }
            }
            return out;
          };
          this.floor(clip(-1), y, color);
          this.floor(clip(1), y, color);
          return;
        }
      }
    const shape = new THREE.Shape(
      poly.map((p) => new THREE.Vector2(p[0], -p[1])),
    );
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    if (typeof y === 'number') g.translate(0, y, 0);
    else {
      const a = g.attributes.position;
      for (let i = 0; i < a.count; i++) a.setY(i, y(a.getX(i), a.getZ(i)));
      g.computeVertexNormals();
    }
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
      mesh.userData.interiorRoof = key === 'roof';
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
          : [
              rect(0, 0, 112, 32),
              ...SKY_WALK.slice(1).map((p, i) => corridorQuad(SKY_WALK[i], p)),
              rect(
                SEABUS_TERMINAL.x,
                SEABUS_TERMINAL.z,
                SEABUS_TERMINAL.width,
                SEABUS_TERMINAL.depth,
              ),
            ];
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
          : [
              { x: 0, z: 16, w: 7, d: 4 },
              ...SKY_WALK.map(([x, z]) => ({ x, z, w: 5, d: 5 })),
            ];
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
        id === 'waterfront' ? (x, z) => this.localHeight(site, x, z) : f,
        id === 'science' ? 0xc7c3b0 : id === 'canada' ? 0xa8bfc2 : 0xd8cbb9,
      ),
    );
    doors.forEach((d) =>
      parts.floor(
        rect(d.x, d.z, d.w, d.d),
        (x, z) => this.localHeight(site, x, z) + 0.002,
        0xb9bdb7,
      ),
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
      // Rear door connects the main concourse to the actual northbound SkyWalk.
      envelope.box([47, 17.5, 0.5], [-32.5, f + 8.75, -16], brick);
      envelope.box([59, 17.5, 0.5], [26.5, f + 8.75, -16], brick);
      envelope.box([6, 13, 0.5], [-6, f + 11, -16], brick);
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
        if (x !== -6) obstacle(x, -11, 0.55, 1.8, 0.95, 0x678186);
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
      this.enrichStation(parts, envelope, site);
      this.addSkyWalk(parts, envelope, site);
      site.envelope = envelope.finish();
      this.e.landmarks.add(site.envelope);
    }
    if (id === 'canada') this.enrichCanada(parts, site);
    parts.finish();
    this.e.landmarks.add(group);
    this.sites.push(site);
  }
  private enrichStation(p: Parts, e: Parts, s: Site) {
    const f = s.floor,
      stone = 0xe6dac5,
      rose = 0xa47870,
      dark = 0x34464b;
    // Recessed masonry joints and projecting stone window surrounds, on both elevations.
    for (const z of [-16.3, 16.4]) {
      for (let x = -52; x <= 52; x += 8) {
        for (const y of [4.2, 12]) {
          if (y < 5 && (Math.abs(x) < 5 || (z < 0 && Math.abs(x + 6) < 6)))
            continue;
          e.box([3.7, 0.24, 0.35], [x, f + y - 2.4, z], stone);
          e.box([3.7, 0.28, 0.35], [x, f + y + 2.4, z], stone);
          for (const dx of [-1.7, 1.7])
            e.box([0.22, 4.8, 0.28], [x + dx, f + y, z], stone);
          e.box([2.9, 4.4, 0.08], [x, f + y, z + 0.02], 0x3f626c);
          e.box([0.09, 4.4, 0.12], [x, f + y, z + 0.1], stone);
          for (const dy of [-1.2, 0, 1.2])
            e.box([3, 0.08, 0.12], [x, f + y + dy, z + 0.1], stone);
        }
        const doorway = z < 0 ? -6 : 0;
        for (const y of [1.6, 8.2, 16])
          if (y > 4.3 || Math.abs(x - doorway) > 7)
            e.box([7, 0.16, 0.3], [x, f + y, z], stone);
        const short = Math.abs(x + 3.8 - doorway) < 4;
        e.box(
          [0.7, short ? 12 : 15, 0.28],
          [x + 3.8, f + (short ? 10.3 : 8.2), z],
          0xa65e49,
        );
      }
      for (let y = 2; y < 16; y += 0.55) {
        if (y < 4.3) {
          const centre = z < 0 ? -6 : 0,
            half = z < 0 ? 3 : 3.5;
          e.box(
            [56 + centre - half, 0.028, 0.025],
            [(-56 + centre - half) / 2, f + y, z - 0.13],
            0x693d34,
          );
          e.box(
            [56 - centre - half, 0.028, 0.025],
            [(56 + centre + half) / 2, f + y, z - 0.13],
            0x693d34,
          );
        } else e.box([112, 0.028, 0.025], [0, f + y, z - 0.13], 0x693d34);
      }
      for (let x = -55; x < 56; x += 0.8)
        e.box([0.24, 0.3, 0.5], [x, f + 17.3, z], stone);
    }
    for (const x of [-12, -8, -4, 4, 8, 12]) {
      for (const [r, y, h] of [
        [0.9, 0.2, 0.22],
        [0.76, 0.43, 0.22],
        [0.73, 7.8, 0.22],
      ])
        e.cylinder(r, h, [x, f + y, 19], stone);
    }
    // Slate roof seams and small dormers break up the former unbroken slab.
    for (let x = -48; x <= 48; x += 3)
      e.beam([x, f + 18.05, 17], [x, f + 22.05, 0], 0.035, 0x7e8c79);
    for (const x of [-40, -24, 24, 40]) {
      e.box([3.4, 2.2, 2.2], [x, f + 20, 9], stone);
      e.box([2, 1.5, 0.1], [x, f + 20, 10.14], 0x355567);
      e.box([3.8, 0.22, 2.6], [x, f + 21.2, 9], 0x4a6058);
    }
    for (let x = -54; x < 54; x += 3)
      for (let z = -14; z < 15; z += 3)
        p.floor(
          rect(x + 1.5, z + 1.5, 2.96, 2.96),
          f + 0.006,
          Math.round(x / 3 + z / 3) % 2 ? 0xb5aea0 : 0xcac2af,
        );
    for (const z of [-15.6, 15.6]) {
      for (const y of [0.2, 1.2, 5.6, 7.3]) {
        if (y < 3.5) {
          const centre = z < 0 ? -6 : 0,
            half = z < 0 ? 3 : 3.5;
          p.box(
            [55 + centre - half, 0.16, 0.18],
            [(-55 + centre - half) / 2, f + y, z],
            stone,
          );
          p.box(
            [55 - centre - half, 0.16, 0.18],
            [(55 + centre + half) / 2, f + y, z],
            stone,
          );
        } else p.box([110, 0.16, 0.18], [0, f + y, z], stone);
      }
      for (let x = -49; x < 52; x += 11) {
        if (z < 0 && Math.abs(x + 6) < 6) continue;
        p.box([9.4, 2.5, 0.13], [x, f + 6.15, z], rose);
        p.box([8.3, 0.1, 0.22], [x, f + 5.05, z], stone);
        p.box([8.3, 0.1, 0.22], [x, f + 7.2, z], stone);
        p.box(
          [7.4, 1.5, 0.16],
          [x, f + 6.15, z + (z < 0 ? 0.12 : -0.12)],
          0xc7ac79,
        );
        // Original mountain-relief frieze, inspired by the framed heritage decoration.
        for (let i = 0; i < 7; i++)
          p.box(
            [0.65, 0.2 + (i % 3) * 0.25, 0.08],
            [x - 2.4 + i * 0.8, f + 5.9, z + (z < 0 ? 0.23 : -0.23)],
            0x867a5f,
          );
        p.box(
          [8, 0.08, 0.08],
          [x, f + 4.83, z + (z < 0 ? 0.2 : -0.2)],
          0xffd7a3,
          'light',
        );
      }
    }
    for (let x = -44; x <= 44; x += 11)
      for (const z of [-10, 10]) {
        if (Math.abs(x) < 3) continue;
        for (const [r, y, h] of [
          [0.75, 0.15, 0.3],
          [0.61, 0.4, 0.2],
          [0.72, 7.2, 0.25],
        ])
          p.cylinder(r, h, [x, f + y, z], stone);
        for (const dx of [-0.5, 0.5])
          p.add(
            'structure',
            new THREE.TorusGeometry(0.22, 0.065, 6, 16).translate(
              x + dx,
              f + 7.1,
              z + 0.42,
            ),
            stone,
          );
      }
    for (const x of [-33, -11, 11, 33]) {
      p.beam([x, f + 8, 0], [x, f + 6.4, 0], 0.045, dark);
      p.cylinder(0.85, 0.13, [x, f + 6.4, 0], 0x9d8352);
      p.cylinder(0.7, 0.08, [x, f + 6.32, 0], 0xffd99a);
      p.box([1.2, 0.05, 0.6], [x, f + 6.28, 0], 0xffe4b6, 'light');
    }
    for (const x of [-49, -45, -41]) {
      p.box([1.1, 1.8, 0.6], [x, f + 0.9, 12.8], 0x354b5b);
      p.box([0.75, 0.55, 0.05], [x, f + 1.25, 12.45], 0x91ccda, 'light');
      s.obstacles.push({ x, z: 12.8, w: 1.2, d: 0.7 });
    }
    p.sign('TICKETS  •  COMPASS', [-45, f + 2.3, 12.4], 8, Math.PI);
    p.sign('SeaBus  ↑  NORTH VANCOUVER', [-6, f + 3.1, -15.6], 6);
    // Keep the actual rear doorway unobstructed by the old representative gate row.
    s.obstacles = s.obstacles.filter((o) => !(o.z === -11 && o.x === -6));
  }
  private addSkyWalk(p: Parts, e: Parts, s: Site) {
    const h = (x: number, z: number) => this.localHeight(s, x, z),
      steel = 0x688487;
    for (let i = 1; i < SKY_WALK.length; i++) {
      const a = SKY_WALK[i - 1],
        b = SKY_WALK[i],
        q = corridorQuad(a, b),
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      e.floor(q, (x, z) => h(x, z) - 0.25, 0x607c81);

      // Roof is a separate batch so the low terminal also opens in an overhead cutaway.
      const roofG = new THREE.ShapeGeometry(
        new THREE.Shape(q.map(([x, z]) => new THREE.Vector2(x, -z))),
      );
      roofG.rotateX(-Math.PI / 2);
      const v = roofG.attributes.position;
      for (let j = 0; j < v.count; j++)
        v.setY(j, h(v.getX(j), v.getZ(j)) + 3.62);
      roofG.computeVertexNormals();
      e.add('roof', roofG, 0x536d75);
      for (const [u, w] of [
        [q[0], q[1]],
        [q[3], q[2]],
      ]) {
        for (const y of [0.45, 1.05, 3.4])
          e.beam(
            [u[0], h(...u) + y, u[1]],
            [w[0], h(...w) + y, w[1]],
            0.055,
            steel,
          );
        const panel = new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            [
              u[0],
              h(...u) + 0.5,
              u[1],
              w[0],
              h(...w) + 0.5,
              w[1],
              w[0],
              h(...w) + 3.35,
              w[1],
              u[0],
              h(...u) + 0.5,
              u[1],
              w[0],
              h(...w) + 3.35,
              w[1],
              u[0],
              h(...u) + 3.35,
              u[1],
            ],
            3,
          ),
        );
        panel.computeVertexNormals();
        e.add('glass', panel, 0x88b6ba);
        for (let d = 0; d < length; d += 5) {
          const t = d / length,
            x = u[0] + (w[0] - u[0]) * t,
            z = u[1] + (w[1] - u[1]) * t;
          e.box([0.12, 3.5, 0.12], [x, h(x, z) + 1.75, z], steel);
        }
      }
      for (let d = 3; d < length; d += 9) {
        const t = d / length,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t;
        p.box([1.8, 0.06, 0.4], [x, h(x, z) + 3.35, z], 0xffefc3, 'light');
      }
    }
    // Sparse paired supports under the SkyWalk, outside the clear walking width.
    for (let z = -50; z > -140; z -= 25) {
      const x = -6 + ((9 + 6) * (-z - 43)) / 97;
      for (const dx of [-3.2, 3.2]) {
        const [wx, wz] = this.world(s, x + dx, z),
          ground = this.e.elevation(wx, wz) - s.origin.y;
        const top = h(x, z) - 0.25;
        if (top > ground)
          e.box(
            [0.45, top - ground, 0.7],
            [x + dx, (top + ground) / 2, z],
            steel,
          );
      }
    }
    const f = SEABUS_TERMINAL.worldFloor - s.origin.y;
    e.box([74, 0.4, 58], [35, f - 0.23, -220], steel);
    e.box([74, 0.3, 58], [35, f + 5, -220], 0x67868b, 'roof');
    for (const x of [0, 70]) {
      e.box([0.25, 1.05, 56], [x, f + 0.525, -220], 0x557881);
      e.box([0.12, 3.5, 56], [x, f + 2.8, -220], 0x88b6ba, 'glass');
      for (let z = -246; z < -193; z += 6)
        e.box([0.18, 4.8, 0.18], [x, f + 2.4, z], steel);
    }
    for (const z of [-248, -192]) {
      for (const [x, w] of z === -192
        ? [
            [12, 24],
            [54, 32],
          ]
        : [[35, 70]]) {
        e.box([w, 1, 0.25], [x, f + 0.5, z], steel);
        e.box([w, 3.5, 0.12], [x, f + 2.8, z], 0x88b6ba, 'glass');
      }
    }
    for (const x of [9, 55])
      for (const z of [-205, -216, -227, -238]) {
        p.box([7, 0.45, 1.2], [x, f + 0.45, z], 0x24567a);
        p.box([7, 0.8, 0.15], [x, f + 0.9, z + 0.5], 0x24567a);
        s.obstacles.push({ x, z, w: 7, d: 1.3 });
      }
    for (let z = -242; z < -198; z += 6)
      p.box([32, 0.07, 0.3], [35, f + 4.7, z], 0xffedc9, 'light');
    p.sign('SeaBus  →  LONSDALE QUAY', [35, f + 3.5, -241], 25);
    p.sign('BOARDING LOUNGE', [35, f + 2.3, -242], 16);
    p.floor(rect(35, -241, 35, 0.18), f + 0.015, 0xe0bd50);
    for (const x of [22, 48]) {
      e.box([0.2, 3.5, 0.2], [x, f + 1.75, -247.7], steel);
      e.box([8, 0.2, 0.2], [x, f + 3.5, -247.7], steel);
      p.sign('BOARDING', [x, f + 2.8, -247.55], 6);
    }
    p.sign('← Waterfront Station', [29, f + 3, -193], 10, Math.PI);
    p.sign('SeaBus  ↑', [10, h(10, -140) + 2.7, -140], 5);
    // Parallel stepped escalator detail beside the continuous accessible circulation ramp.
    for (let i = 0; i < 18; i++) {
      const z = -147 - i * 2,
        x = 13 + (i / 18) * 15,
        y = h(x, z);
      p.box([1.1, 0.15, 1.95], [x + 1.6, y + 0.06, z], 0x7e969b);
    }
  }
  private enrichCanada(p: Parts, s: Site) {
    const f = s.floor,
      blue = 0x345e73,
      wood = 0xb88457,
      cream = 0xe9e1cf;
    // The East Building reference has blue patterned carpet, teal columns and pale wood panels.
    for (let x = -30; x < 31; x += 3)
      for (let z = -88; z < 88; z += 3) {
        const tone = (((Math.round(x + z) / 3) % 3) + 3) % 3;
        p.floor(
          rect(x + 1.5, z + 1.5, 2.97, 2.97),
          f + 0.008,
          [0x587e88, 0x416879, 0x759295][Math.floor(tone)],
        );
        p.floor(rect(x + 1.5, z + 1.5, 0.12, 2.9), f + 0.012, 0x91a9a9);
      }
    for (const z of [-27, 29])
      for (let x = -12; x < 30; x += 3) {
        p.box([2.8, 4.6, 0.12], [x, f + 2.4, z - 0.22], wood);
        p.box([2.8, 4.6, 0.12], [x, f + 2.4, z + 0.22], wood);
        p.box([2.8, 0.08, 0.15], [x, f + 4.8, z - 0.24], cream);
      }
    for (const z of [-38, 18, 64])
      for (const x of [-24, 25]) {
        p.cylinder(0.61, 2.4, [x, f + 1.2, z], blue);
        p.cylinder(0.68, 0.12, [x, f + 2.4, z], 0xb2babe);
      }
    for (const z of [-79, -43, 11, 65])
      for (const x of [-26, 25]) {
        p.cylinder(0.7, 0.8, [x, f + 0.4, z], 0xd1c5ae);
        p.cylinder(0.65, 0.04, [x, f + 0.82, z], 0x473c2b);
        for (let i = 0; i < 5; i++)
          p.add(
            'structure',
            new THREE.IcosahedronGeometry(0.58, 1)
              .scale(0.8, 1.3, 0.8)
              .translate(
                x + Math.cos(i * 2) * 0.4,
                f + 1.35 + (i % 2) * 0.35,
                z + Math.sin(i * 2) * 0.4,
              ),
            0x39714e,
          );
        s.obstacles.push({ x, z, w: 1.5, d: 1.5 });
      }
    for (const z of [-81, -34, 21, 78]) {
      for (const x of [-25, -17]) {
        p.box([3, 0.4, 1.1], [x, f + 0.48, z], blue);
        p.box([3, 0.65, 0.25], [x, f + 0.9, z + 0.5], blue);
        for (const dx of [-1.4, 1.4])
          p.box([0.25, 0.65, 1.1], [x + dx, f + 0.75, z], blue);
        s.obstacles.push({ x, z, w: 3, d: 1.4 });
      }
      p.cylinder(1, 0.35, [-21, f + 0.3, z], 0x303b41);
      s.obstacles.push({ x: -21, z, w: 2, d: 2 });
    }
    p.box([10, 0.18, 2], [-11, f + 1.18, -73], 0xe4dac5);
    for (const x of [-14, -11, -8]) {
      p.box([0.6, 0.5, 0.14], [x, f + 1.5, -73], 0x182e3b);
      p.box([0.48, 0.32, 0.02], [x, f + 1.52, -73.09], 0x77bdca, 'light');
    }
    p.sign('REGISTRATION  /  INFORMATION', [-11, f + 2.5, -74], 11);
    // Representative exhibition installations add human-scale activity and clear aisles.
    for (const z of [-49, 6, 55])
      for (const x of [8, 23]) {
        p.box([5, 0.12, 4], [x, f + 0.07, z - 10], 0x526a75);
        p.box([5, 2.8, 0.16], [x, f + 1.4, z - 12], 0xb3c2c3);
        p.box([2.8, 1.3, 0.08], [x, f + 1.8, z - 11.85], 0x265269);
        p.sign('VANCOUVER', [x, f + 2.2, z - 11.78], 2.7);
        s.obstacles.push({ x, z: z - 12, w: 5, d: 0.25 });
      }
    for (let z = -83; z < 85; z += 12) {
      p.box([60, 0.16, 0.28], [0.5, f + 7.7, z], cream);
      p.box([7, 0.08, 1.8], [-22, f + 7.5, z], 0xffedce, 'light');
    }
    // Escalator display in the entrance lobby; upper meeting rooms remain outside this floor's scope.
    for (const x of [18, 21]) {
      for (let i = 0; i < 20; i++)
        p.box(
          [2.2, 0.22, 0.5],
          [x, f + 0.15 + i * 0.19, -83 + i * 0.5],
          0x758991,
        );
      for (const dx of [-1.2, 1.2])
        p.beam([x + dx, f + 1, -83], [x + dx, f + 4.8, -73], 0.065, 0x293d43);
      s.obstacles.push({ x, z: -78, w: 2.6, d: 11 });
    }
    p.sign('MEETING LEVEL  ↗', [19.5, f + 5.3, -73], 9);
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
    if (site.id === 'waterfront' && z < -140)
      return THREE.MathUtils.lerp(
        site.floor,
        SEABUS_TERMINAL.worldFloor - site.origin.y,
        THREE.MathUtils.clamp((-z - 140) / 52, 0, 1),
      );
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
      site.polys.some(
        (poly) =>
          !site.polys.some((other) => other !== poly && inside(p, other)) &&
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
      const footprintDistance = Math.min(
        ...site.polys.map((poly) =>
          inside(local, poly)
            ? 0
            : Math.min(
                ...poly.map((p, i) =>
                  segmentDistance(local, p, poly[(i + 1) % poly.length]),
                ),
              ),
        ),
      );
      const near = footprintDistance < 210;
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
          if (object.userData.interiorRoof) object.visible = !cut;
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

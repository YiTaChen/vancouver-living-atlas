import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import { GroundSurfaceIndex } from './ground-surface';
import { project, rings, inPolygon } from './geo';
import layout from './beach-layout.json';

/** Original static geometry; reference/placement provenance in beach-amenities.md.
 * Two spatial batches, no animation, textures, network requests or per-prop draws.
 */
export function createBeachAmenities(e: CityEngine) {
  const ground = new GroundSurfaceIndex([
    e.terrain.children[0] as THREE.Mesh,
    ...(e.terrain.children.filter((m) => m.userData.beachSand) as THREE.Mesh[]),
  ]);
  const floor = (x: number, z: number) =>
    ground.sample(x, z, e.elevation(x, z) + 1.6) ?? e.elevation(x, z);
  const report = {
    courts: 0,
    volleyball: 0,
    logs: 0,
    triangles: 0,
    batches: 0,
  };
  for (const beach of ['english', 'kitsilano']) {
    const geos: THREE.BufferGeometry[] = [];
    const add = (g: THREE.BufferGeometry, color: number) => {
      const flat = g.index ? g.toNonIndexed() : g;
      if (flat !== g) g.dispose();
      flat.deleteAttribute('uv');
      const c = new THREE.Color(color),
        a = new Float32Array(flat.getAttribute('position').count * 3);
      for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
      flat.setAttribute('color', new THREE.BufferAttribute(a, 3));
      geos.push(flat);
    };
    const rod = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      r: number,
      color: number,
      top = r,
      sides = 6,
    ) => {
      const delta = b.clone().sub(a),
        g = new THREE.CylinderGeometry(top, r, delta.length(), sides);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          delta.normalize(),
        ),
      );
      g.translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
      add(g, color);
    };
    for (const item of layout.filter((p) => p.beach === beach)) {
      const ps = item.corners.map(project),
        center = ps
          .reduce((v, p) => v.add(new THREE.Vector2(...p)), new THREE.Vector2())
          .multiplyScalar(0.25);
      const along = new THREE.Vector2(
        ps[1][0] - ps[0][0],
        ps[1][1] - ps[0][1],
      ).normalize();
      const across = new THREE.Vector2(
        ps[3][0] - ps[0][0],
        ps[3][1] - ps[0][1],
      ).normalize();
      const length = Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]),
        width = Math.hypot(ps[3][0] - ps[0][0], ps[3][1] - ps[0][1]);
      const p = (u: number, v: number, h = 0) => {
        const x = center.x + along.x * u + across.x * v,
          z = center.y + along.y * u + across.y * v;
        return new THREE.Vector3(x, floor(x, z) + h, z);
      };
      // Small draped cells keep markings on the rendered sand/ground, rather
      // than elevating an entire court to its highest corner.
      const patch = (
        u0: number,
        v0: number,
        u1: number,
        v1: number,
        color: number,
        h = 0.035,
      ) => {
        const out: number[] = [],
          nu = Math.ceil((u1 - u0) / 0.8),
          nv = Math.ceil((v1 - v0) / 0.8);
        for (let i = 0; i < nu; i++)
          for (let j = 0; j < nv; j++) {
            const a = p(
                u0 + ((u1 - u0) * i) / nu,
                v0 + ((v1 - v0) * j) / nv,
                h,
              ),
              b = p(
                u0 + ((u1 - u0) * (i + 1)) / nu,
                v0 + ((v1 - v0) * j) / nv,
                h,
              ),
              c = p(
                u0 + ((u1 - u0) * (i + 1)) / nu,
                v0 + ((v1 - v0) * (j + 1)) / nv,
                h,
              ),
              d = p(
                u0 + ((u1 - u0) * i) / nu,
                v0 + ((v1 - v0) * (j + 1)) / nv,
                h,
              );
            for (const q of [a, c, b, a, d, c]) out.push(...q.toArray());
          }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
        g.computeVertexNormals();
        add(g, color);
      };
      const stroke = (
        coords: number[][],
        color = 0xf1f0db,
        radius = 0.055,
        h = 0.075,
      ) => {
        const paint: number[] = [];
        for (let i = 1; i < coords.length; i++) {
          const a = coords[i - 1],
            b = coords[i],
            du = b[0] - a[0],
            dv = b[1] - a[1],
            len = Math.hypot(du, dv);
          if (len < 1e-6) continue;
          const n = Math.ceil(len / 0.6),
            su = (-dv / len) * radius,
            sv = (du / len) * radius;
          for (let j = 0; j < n; j++) {
            const u = a[0] + (du * j) / n,
              v = a[1] + (dv * j) / n,
              uu = a[0] + (du * (j + 1)) / n,
              vv = a[1] + (dv * (j + 1)) / n;
            if (item.sport === 'basketball') {
              const q = [
                p(u - su, v - sv, h),
                p(uu - su, vv - sv, h),
                p(uu + su, vv + sv, h),
                p(u + su, v + sv, h),
              ];
              for (const k of [0, 2, 1, 0, 3, 2]) paint.push(...q[k].toArray());
            } else rod(p(u, v, h), p(uu, vv, h), radius, color);
          }
        }
        if (paint.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(paint, 3),
          );
          g.computeVertexNormals();
          add(g, color);
        }
      };
      const l = length / 2,
        w = width / 2;
      if (item.sport === 'basketball') {
        patch(-l - 0.8, -w - 0.8, l + 0.8, w + 0.8, 0x333947);
        patch(-l, -w, l, w, 0x303f88, 0.045);
        for (const sign of [-1, 1]) {
          // Blue end zones with orange painted keys, matching 2026 renewal.
          patch(
            sign < 0 ? -l : l - 6,
            -w,
            sign < 0 ? -l + 6 : l,
            w,
            0x298fbd,
            0.05,
          );
          patch(
            sign < 0 ? -l : l - 5,
            -2.45,
            sign < 0 ? -l + 5 : l,
            2.45,
            0xd58054,
            0.057,
          );
          stroke([
            [sign * l, -2.45],
            [sign * (l - 5), -2.45],
            [sign * (l - 5), 2.45],
            [sign * l, 2.45],
          ]);
          const arc = Array.from({ length: 41 }, (_, i) => {
            const t = -Math.PI / 2 + (i * Math.PI) / 40;
            return [sign * (l - 1.5 - 6.3 * Math.cos(t)), 6.3 * Math.sin(t)];
          });
          stroke(arc);
          const base = p(sign * (l + 0.45), 0, -0.15),
            upright = p(sign * (l + 0.45), 0, 3.9),
            back = p(sign * (l - 1.1), 0, 3.5);
          rod(base, upright, 0.1, 0x343c42);
          rod(upright, back, 0.075, 0x343c42);
          const board = new THREE.BoxGeometry(0.09, 1.05, 1.8),
            yaw = -Math.atan2(along.y, along.x);
          board.rotateY(yaw);
          board.translate(...back.toArray());
          add(board, 0xe0e7e0);
          const hoop = p(sign * (l - 1.55), 0, 3.05),
            ring = new THREE.TorusGeometry(0.225, 0.026, 5, 16);
          ring.rotateX(Math.PI / 2);
          ring.translate(...hoop.toArray());
          add(ring, 0xc85f2b);
          for (let k = 0; k < 12; k++) {
            const t = (k * Math.PI) / 6;
            rod(
              hoop
                .clone()
                .add(
                  new THREE.Vector3(0.22 * Math.cos(t), 0, 0.22 * Math.sin(t)),
                ),
              hoop
                .clone()
                .add(
                  new THREE.Vector3(
                    0.13 * Math.cos(t),
                    -0.38,
                    0.13 * Math.sin(t),
                  ),
                ),
              0.008,
              0xe0ddd2,
              0.008,
              4,
            );
          }
        }
        stroke([
          [-l, -w],
          [l, -w],
          [l, w],
          [-l, w],
          [-l, -w],
        ]);
        stroke([
          [0, -w],
          [0, w],
        ]);
        stroke(
          Array.from({ length: 49 }, (_, i) => [
            1.8 * Math.cos((i * Math.PI) / 24),
            1.8 * Math.sin((i * Math.PI) / 24),
          ]),
        );
        report.courts++;
      } else {
        stroke(
          [
            [-l, -w],
            [l, -w],
            [l, w],
            [-l, w],
            [-l, -w],
          ],
          0x536c8a,
          0.022,
          0.055,
        );
        const netW = w + 0.45;
        for (const sign of [-1, 1])
          rod(
            p(0, sign * netW, -0.18),
            p(0, sign * netW, 2.65),
            0.085,
            0xa99b7c,
          );
        // Actual mesh strands; no transparent plane/sorting artifacts.
        for (let v = -w; v <= w + 0.01; v += 0.25)
          rod(p(0, v, 1.4), p(0, v, 2.4), 0.018, 0x455150, 0.018, 4);
        for (let h = 1.4; h <= 2.41; h += 0.2)
          rod(p(0, -w, h), p(0, w, h), 0.018, 0x455150, 0.018, 4);
        rod(p(0, -netW, 2.4), p(0, netW, 2.4), 0.032, 0x6e8caa);
        rod(p(0, -w, 1.4), p(0, w, 1.4), 0.018, 0xe5e2ce);
        report.volleyball++;
      }
    }
    const f = e.data.beachCoast.beachOverlays.features.find(
      (f: any) =>
        f.properties.name ===
        (beach === 'english' ? 'English Bay Beach' : 'Kitsilano Beach'),
    );
    const polygons = f
      ? rings(f).map((r) => r.map((ring) => ring.map(project)))
      : [];
    // Sparse, representative seating logs. Locations are illustrative, not a
    // survey; keep them inside sand and outside the selected playing footprints.
    for (let i = 0; i < 12; i++) {
      const lon =
        beach === 'english'
          ? -123.1433 - (i > 7 ? (i - 7) * 0.00009 : 0)
          : -123.15265 - i * 0.000105 + Math.sin(i * 2.3) * 0.000018;
      const lat =
        beach === 'english' ? 49.2879 - i * 0.00024 : 49.27655 - i * 0.00013;
      const [x, z] = project([lon, lat]),
        theta = (beach === 'english' ? 0.3 : 0.7) + Math.sin(i * 1.7) * 0.25;
      const len = 4.8 + (i % 4) * 0.55,
        r = 0.28 + (i % 3) * 0.055,
        dx = Math.sin(theta),
        dz = Math.cos(theta);
      const at = (t: number) =>
        new THREE.Vector3(
          x + dx * t,
          floor(x + dx * t, z + dz * t) + r * 0.67,
          z + dz * t,
        );
      if (
        ![-len / 2, 0, len / 2].every((t) =>
          polygons.some((poly) => inPolygon([x + dx * t, z + dz * t], poly)),
        )
      )
        continue;
      const plays = layout
        .filter((c) => c.beach === beach)
        .map((c) => c.corners.map(project));
      if (
        plays.some((poly) =>
          [-len / 2, 0, len / 2].some((t) => {
            const px = x + dx * t,
              pz = z + dz * t;
            const center = poly.reduce(
              (a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4],
              [0, 0],
            );
            const expanded = poly.map((p) => [
              center[0] + (p[0] - center[0]) * 1.4,
              center[1] + (p[1] - center[1]) * 1.4,
            ]);
            return inPolygon([px, pz], [expanded]);
          }),
        )
      )
        continue;
      // Tapered, gently crooked segments sink slightly into sand; end grain and
      // short broken branches distinguish wood from plain cylinders.
      for (let j = 0; j < 5; j++)
        rod(
          at(-len / 2 + (len * j) / 5),
          at(-len / 2 + (len * (j + 1)) / 5),
          r * (1 - j * 0.055),
          [0x989386, 0xa29b8c, 0x8c887c][i % 3],
          r * (1 - (j + 1) * 0.055),
          9,
        );
      const end = at(-len / 2),
        tip = at(-len / 2 - 0.018);
      rod(end, tip, r * 0.93, 0xbcb096, r * 0.93, 9);
      for (const scale of [0.38, 0.68]) {
        const grain = new THREE.TorusGeometry(r * scale, 0.012, 4, 12);
        grain.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(dx, 0, dz),
          ),
        );
        grain.translate(...at(-len / 2 - 0.023).toArray());
        add(grain, 0x8b806c);
      }
      const branch = at(len * 0.16);
      rod(
        branch,
        branch.clone().add(new THREE.Vector3(0.3, 0.33, -0.22)),
        0.1,
        0x888376,
        0.035,
        6,
      );
      // Narrow longitudinal dark grooves read as weathered wood at eye level.
      for (const side of [-1, 1])
        rod(
          at(-len * 0.4).add(
            new THREE.Vector3(
              dz * r * 0.55 * side,
              r * 0.64,
              -dx * r * 0.55 * side,
            ),
          ),
          at(len * 0.35).add(
            new THREE.Vector3(
              dz * r * 0.48 * side,
              r * 0.53,
              -dx * r * 0.48 * side,
            ),
          ),
          0.014,
          0x77766b,
          0.009,
          4,
        );
      report.logs++;
    }
    if (!geos.length) continue;
    const geometry = mergeGeometries(geos)!;
    geos.forEach((g) => g.dispose());
    geometry.computeBoundingSphere();
    const center = geometry.boundingSphere!.center.clone();
    geometry.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${beach}-beach-amenities`;
    const lod = new THREE.LOD();
    lod.position.copy(center);
    lod.addLevel(mesh, 0);
    lod.addLevel(new THREE.Group(), 1400, 0.12);
    e.scene.add(lod);
    report.triangles += geometry.getAttribute('position').count / 3;
    report.batches++;
  }
  e.data.beachAmenities = report;
}

import * as THREE from 'three';
import { DetailedTrees, registerTree, type ForestTree } from './detailed-trees';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import { project, rings, lines, inPolygon, hash } from './geo';
import type { Feature } from './types';
import { lakeSurfaces } from './water-world';
import { roadDecorations } from './road-decorations';
import { trimRoad } from './road-trim';
export interface Traffic {
  mesh: THREE.InstancedMesh;
  cabins: THREE.InstancedMesh;
  lamps: THREE.InstancedMesh;
  routes: {
    a: number[];
    b: number[];
    length: number;
    speed: number;
    phase: number;
  }[];
  boats: THREE.Group[];
}
export function createNature(e: CityEngine) {
  const woodPolys = e.data.context.features
    .filter((f: Feature) => f.properties.class === 'wood')
    .flatMap((f: Feature) => rings(f).map((p) => p.map((r) => r.map(project))));
  const surfaces = lakeSurfaces(e.data.context, (x, z) => e.elevation(x, z));
  const waters = surfaces.map((s) => s.polygon!);
  e.data.waterSurfaces = surfaces;
  e.data.waterMeshes = [];
  const beaches = e.data.context.features
    .filter((f: Feature) => f.properties.class === 'beach')
    .flatMap((f: Feature) => rings(f).map((p) => p.map((r) => r.map(project))));
  e.data.waterPolys = waters;
  e.data.beachPolys = beaches;
  // Inland water lies at the local lake shore elevation, never at sea level.
  for (const surface of surfaces) {
    const poly = surface.polygon!,
      level = surface.level,
      pts = poly.map((r: number[][]) =>
        r
          .slice(0, -1)
          .map((p) => new THREE.Vector2(...(p as [number, number]))),
      ),
      flat = pts.flat(),
      pos: number[] = [];
    for (const tri of THREE.ShapeUtils.triangulateShape(pts[0], pts.slice(1)))
      for (const i of tri) {
        const p = flat[i];
        pos.push(p.x, level, p.y);
      }
    const mesh = new THREE.Mesh(
      e.geometry(pos),
      new THREE.MeshStandardMaterial({
        color: 0x3b7776,
        roughness: 0.42,
        metalness: 0.12,
        side: THREE.DoubleSide,
      }),
    );
    mesh.userData.waterId = surface.id;
    e.data.waterMeshes.push(mesh);
    e.terrain.add(mesh);
  }
  for (const poly of beaches) e.polygonMesh(poly, 0xc9b98d, 1.6);
  // A narrow seawall follows the measured shoreline, except natural beach sections.
  const shorePos: number[] = [],
    rockPos: number[] = [];
  for (const f of e.data.shoreline.features)
    for (const l of lines(f)) {
      const ps = l.map(project);
      for (let i = 0; i < ps.length - 1; i++) {
        const a = ps[i],
          b = ps[i + 1],
          len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.1) continue;
        const [lon, lat] = [l[i][0], l[i][1]],
          isCliff = lat > 49.303 && lon < -123.15;
        const colorLine = isCliff ? rockPos : shorePos;
        const wa = isCliff ? 4.5 : 3;
        const dx = ((b[1] - a[1]) / len) * wa,
          dz = (-(b[0] - a[0]) / len) * wa;
        for (const p of [
          [a[0] - dx, a[1] - dz],
          [a[0] + dx, a[1] + dz],
          [b[0] + dx, b[1] + dz],
          [a[0] - dx, a[1] - dz],
          [b[0] + dx, b[1] + dz],
          [b[0] - dx, b[1] - dz],
        ])
          colorLine.push(
            p[0],
            Math.max(0.7, e.elevation(p[0], p[1])) + 1.15,
            p[1],
          );
      }
    }
  for (const [pos, color] of [
    [shorePos, 0xb3b1a0],
    [rockPos, 0x807d67],
  ] as [number[], number][]) {
    const mesh = new THREE.Mesh(
      e.geometry(pos),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    mesh.receiveShadow = true;
    mesh.userData.walkSurface = true;
    e.terrain.add(mesh);
  }
  // Trails are geographic source lines. Merge their geometry to keep draw calls low.
  const pathGeos: THREE.BufferGeometry[] = [];
  for (const f of e.data.paths.features) {
    if (
      e.data.causeway?.excludedPathIds.has(
        Number(f.properties.sourceId ?? f.properties.id),
      )
    )
      continue;
    for (const l of lines(f)) {
      const mesh = e.ribbon(
        l.map(project),
        f.properties.width || 2.5,
        0xb2a587,
        1.5,
      );
      pathGeos.push(mesh.geometry);
      e.roads.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
  }
  if (pathGeos.length) {
    const merged = mergeGeometries(pathGeos),
      m = new THREE.Mesh(
        merged!,
        new THREE.MeshStandardMaterial({
          color: 0xaea48c,
          side: THREE.DoubleSide,
          roughness: 1,
        }),
      );
    m.userData.walkSurface = true;
    e.roads.add(m);
    pathGeos.forEach((g) => g.dispose());
  }
  const trees: ForestTree[] = [];
  for (let i = 0; i < e.data.trees.trees.length; i++) {
    const t = e.data.trees.trees[i],
      p = project(t),
      [lon, lat] = t;
    if (lon < -123.165 || lon > -123.095 || lat < 49.267 || lat > 49.315)
      continue;
    if (!e.onLand(p[0], p[1])) continue;
    const species = String(t[4] || '');
    trees.push({
      x: p[0],
      z: p[1],
      h: Math.max(5, Math.min(26, Number(t[2]) || 10)),
      conifer: /THUJA|PINUS|PICEA|PSEUDOTSUGA|TSUGA|ABIES/i.test(species),
      seed: i,
    });
  }
  const forest = woodPolys.length
    ? woodPolys
    : e.parkPolys.filter((p) => p.name === 'Stanley Park').map((p) => p.poly);
  for (let x = -2700; x < 400; x += 13)
    for (let z = -3180; z < 0; z += 13) {
      const seed = x * 3.11 + z * 11.5,
        xx = x + (hash(seed) - 0.5) * 12,
        zz = z + (hash(seed + 2) - 0.5) * 12,
        height = 16 + hash(seed + 3) * 21;
      if (
        !forest.some((p: number[][][]) => inPolygon([xx, zz], p)) ||
        !e.onLand(xx, zz) ||
        waters.some((p: number[][][]) => inPolygon([xx, zz], p)) ||
        beaches.some((p: number[][][]) => inPolygon([xx, zz], p)) ||
        // Keep the full generated crown clear of the physical road/path mesh.
        // Surveyed municipal tree XY remains unchanged.
        e.data.travelSurfaces?.overlapsDisk(xx, zz, height * 0.3 + 1)
      )
        continue;
      trees.push({
        x: xx,
        z: zz,
        h: height,
        conifer: hash(seed + 9) > 0.16,
        seed,
      });
    }
  const coniferGeos = [
    new THREE.ConeGeometry(0.25, 0.55, 7).translate(0, 0.57, 0),
    new THREE.ConeGeometry(0.205, 0.47, 7).translate(0, 0.76, 0),
    new THREE.ConeGeometry(0.15, 0.4, 7).translate(0, 0.97, 0),
  ];
  const conifer = mergeGeometries(coniferGeos)!;
  const leafGeos = [
    new THREE.IcosahedronGeometry(1, 1)
      .scale(0.23, 0.31, 0.22)
      .translate(0, 0.76, 0),
    new THREE.IcosahedronGeometry(1, 1)
      .scale(0.18, 0.24, 0.19)
      .translate(0.11, 0.62, 0),
    new THREE.IcosahedronGeometry(1, 1)
      .scale(0.18, 0.24, 0.18)
      .translate(-0.1, 0.64, 0.06),
  ];
  const leaf = mergeGeometries(leafGeos)!;
  const lowLeaf = mergeGeometries([
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.25, 0.33, 0.23)
      .translate(0, 0.76, 0),
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.19, 0.25, 0.2)
      .translate(0.11, 0.62, 0),
    new THREE.IcosahedronGeometry(1, 0)
      .scale(0.19, 0.25, 0.19)
      .translate(-0.1, 0.64, 0.06),
  ])!;
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
  ];
  const cells = new Map<string, typeof trees>();
  for (const t of trees) {
    const key = Math.floor(t.x / 350) + ',' + Math.floor(t.z / 350);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(t);
  }
  const dummy = new THREE.Object3D(),
    trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 0.64, 5),
    trunkMat = new THREE.MeshStandardMaterial({
      color: 0x695745,
      roughness: 1,
    });
  for (const cell of cells.values()) {
    for (const [list, geo, mat] of [
      [cell.filter((t) => t.conifer), conifer, mats[0]],
      [cell.filter((t) => !t.conifer), leaf, mats[1]],
    ] as [typeof trees, THREE.BufferGeometry, THREE.MeshStandardMaterial][]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        dummy.position.set(t.x, e.elevation(t.x, t.z), t.z);
        dummy.scale.set(t.h, t.h, t.h);
        dummy.rotation.set(0, hash(t.seed) * Math.PI, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        registerTree(t, mesh, i, dummy.matrix);
        const c = t.conifer
          ? new THREE.Color(0x315e48).lerp(
              new THREE.Color(0x6d8651),
              hash(t.seed + 3) * 0.6,
            )
          : new THREE.Color(0x527849).lerp(
              new THREE.Color(0x9cad67),
              hash(t.seed + 3) * 0.6,
            );
        mesh.setColorAt(i, c);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      if (geo === leaf) {
        const low = new THREE.InstancedMesh(lowLeaf, mat, list.length);
        low.instanceMatrix = mesh.instanceMatrix;
        low.instanceColor = mesh.instanceColor;
        low.castShadow = false;
        low.receiveShadow = true;
        low.computeBoundingSphere();
        const lod = new THREE.LOD(),
          center = mesh.boundingSphere!.center;
        lod.position.copy(center);
        mesh.position.copy(center).negate();
        low.position.copy(mesh.position);
        lod.addLevel(mesh, 0);
        lod.addLevel(low, 500);
        e.vegetation.add(lod);
      } else e.vegetation.add(mesh);
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, cell.length);
    for (let i = 0; i < cell.length; i++) {
      const t = cell[i];
      dummy.position.set(t.x, e.elevation(t.x, t.z) + t.h * 0.31, t.z);
      dummy.scale.set(t.h * 0.065, t.h, t.h * 0.065);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      registerTree(t, trunks, i, dummy.matrix);
    }
    trunks.computeBoundingSphere();
    const trunkLod = new THREE.LOD();
    trunkLod.position.copy(trunks.boundingSphere!.center);
    trunks.position.copy(trunkLod.position).negate();
    trunkLod.addLevel(trunks, 0);
    trunkLod.addLevel(new THREE.Group(), 1800);
    e.vegetation.add(trunkLod);
  }
  e.stats.trees = trees.length;
  e.detailedTrees = new DetailedTrees(e, trees);
}
export function createStreetDetails(e: CityEngine): Traffic {
  const roads = e.data.roads.features.filter(
    (f: Feature) =>
      !/bikeway|lane|private|non.city/i.test(f.properties.class || '') &&
      !/bridge|causeway/i.test(f.properties.name || ''),
  );
  const lampPoints = roadDecorations(e, e.data.roadGraph),
    routes: Traffic['routes'] = [];
  const dummy = new THREE.Object3D();
  for (let k = 0; k < roads.length; k++) {
    const f = roads[k],
      w = e.data.roadWidths?.get(f) ?? f.properties.width ?? 10;
    for (const [part, line] of lines(f).entries()) {
      const sourceIndex = e.data.roads.features.indexOf(f);
      for (const ps of trimRoad(
        line.map(project),
        e.data.causeway?.cuts.get(`${sourceIndex}:${part}`) || [],
      )) {
        for (let i = 0; i < ps.length - 1; i++) {
          const a = ps[i],
            b = ps[i + 1],
            len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 25) continue;
          const dx = (b[0] - a[0]) / len,
            dz = (b[1] - a[1]) / len,
            px = dz,
            pz = -dx;
          if (len > 55 && hash(k * 23 + i) > 0.6) {
            const direction = hash(k + 7) > 0.5 ? 1 : -1;
            const aa = [
                a[0] + px * w * (w < 10 ? 0.21 : 0.23) * direction,
                a[1] + pz * w * (w < 10 ? 0.21 : 0.23) * direction,
              ],
              bb = [
                b[0] + px * w * (w < 10 ? 0.21 : 0.23) * direction,
                b[1] + pz * w * (w < 10 ? 0.21 : 0.23) * direction,
              ];
            if (e.onLand((aa[0] + bb[0]) / 2, (aa[1] + bb[1]) / 2))
              routes.push({
                a: direction > 0 ? aa : bb,
                b: direction > 0 ? bb : aa,
                length: len,
                speed: 6 + hash(k) * 5,
                phase: hash(k + 4),
              });
          }
        }
      }
    }
  }
  const lampGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.13, 8, 6).translate(0, 4, 0),
    new THREE.BoxGeometry(1.9, 0.12, 0.12).translate(0.8, 7.9, 0),
  ])!;
  const lamps = new THREE.InstancedMesh(
    lampGeo,
    new THREE.MeshStandardMaterial({ color: 0x475a59, roughness: 0.8 }),
    lampPoints.length,
  );
  const lightCaps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.75, 0.12, 0.45),
    new THREE.MeshStandardMaterial({
      color: 0xffe0a4,
      emissive: 0xffc571,
      emissiveIntensity: 0.15,
    }),
    lampPoints.length,
  );
  for (let i = 0; i < lampPoints.length; i++) {
    const [x, z, yaw] = lampPoints[i];
    dummy.position.set(x, e.elevation(x, z) + 1, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
    dummy.position.y += 7.85;
    dummy.updateMatrix();
    lightCaps.setMatrixAt(i, dummy.matrix);
  }
  e.roads.add(lamps, lightCaps);
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.8, 0.8, 4.3),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.28,
      roughness: 0.38,
    }),
    routes.length,
  );
  const cabins = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.52, 0.65, 2.25),
    new THREE.MeshStandardMaterial({
      color: 0x35505b,
      metalness: 0.38,
      roughness: 0.3,
    }),
    routes.length,
  );
  const palette = [0xdeddd4, 0x424e58, 0x83877d, 0x983f34, 0xcfb476, 0x314a57];
  for (let i = 0; i < routes.length; i++)
    body.setColorAt(
      i,
      new THREE.Color(palette[Math.floor(hash(i) * palette.length)]),
    );
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = cabins.frustumCulled = false;
  e.trafficGroup.add(body, cabins);
  const boats: THREE.Group[] = [];
  return { mesh: body, cabins, lamps: lightCaps, routes, boats };
}
const dummy = new THREE.Object3D();
export function updateTraffic(e: CityEngine, traffic: Traffic, time: number) {
  traffic.routes.forEach((r, i) => {
    const t = (r.phase + (time * r.speed) / r.length) % 1,
      x = THREE.MathUtils.lerp(r.a[0], r.b[0], t),
      z = THREE.MathUtils.lerp(r.a[1], r.b[1], t);
    dummy.position.set(
      x,
      (e.data.roadRelief?.(x, z) ?? e.elevation(x, z)) + 1.8,
      z,
    );
    dummy.rotation.set(0, Math.atan2(r.b[0] - r.a[0], r.b[1] - r.a[1]), 0);
    dummy.updateMatrix();
    traffic.mesh.setMatrixAt(i, dummy.matrix);
    dummy.position.y += 0.65;
    dummy.updateMatrix();
    traffic.cabins.setMatrixAt(i, dummy.matrix);
  });
  traffic.mesh.instanceMatrix.needsUpdate = true;
  traffic.cabins.instanceMatrix.needsUpdate = true;
}

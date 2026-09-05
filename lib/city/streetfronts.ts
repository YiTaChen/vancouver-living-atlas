import * as THREE from 'three';
import { replacedBuilding } from './replaced-buildings';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import { project, rings, hash, inPolygon } from './geo';
// Original architectural embellishments for the close-view Gastown corridor.
// These are representative street detail, not claims about current businesses.
export function createStreetfronts(e: CityEngine) {
  const batches = new Map<string, { color: number; instances: number[][] }>(),
    textures: THREE.CanvasTexture[] = [];
  const box = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    color: number,
  ) => {
    const key = color + ':' + Math.floor(x / 180) + ':' + Math.floor(z / 180);
    if (!batches.has(key)) batches.set(key, { color, instances: [] });
    batches.get(key)!.instances.push([w, h, d, x, y, z, yaw]);
  };
  const names = ['COFFEE', 'BOOKS', 'GALLERY', 'STUDIO', 'RECORDS', 'GASTOWN'];
  const signs = names.map((name, i) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = ['#28463f', '#4a3a31', '#233b46'][i % 3];
    ctx.fillRect(0, 0, 512, 96);
    ctx.strokeStyle = '#c1b88e';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 500, 84);
    ctx.font = '500 38px Georgia';
    ctx.fillStyle = '#e5daba';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 256, 49);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    textures.push(t);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  });
  const signGeos: THREE.BufferGeometry[][] = names.map(() => []);
  let n = 0;
  for (const f of e.data.buildings.features) {
    if (
      f.properties.minHeight > 0 ||
      f.properties.height < 7 ||
      f.properties.height > 34
    )
      continue;
    for (const polygon of rings(f)) {
      const ring = polygon[0].slice(0, -1).map(project),
        center = ring.reduce(
          (a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length],
          [0, 0],
        );
      if (
        center[0] < 700 ||
        center[0] > 1850 ||
        center[1] < -70 ||
        center[1] > 540
      )
        continue;
      let area = ring.reduce((s, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return s + a[0] * b[1] - b[0] * a[1];
      }, 0);
      if (area < 0) ring.reverse();
      const ground = e.elevation(...(center as [number, number])) - 0.35;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 9 || len > 75) continue;
        const dx = (b[0] - a[0]) / len,
          dz = (b[1] - a[1]) / len,
          nx = dz,
          nz = -dx,
          yaw = Math.atan2(nx, nz);
        // Cast-stone window surrounds and projecting cornices produce real silhouettes.
        for (let u = 2.05; u < len - 1.8; u += 3.1)
          for (let y = 4.6; y < f.properties.height - 1.3; y += 3.25) {
            const x = a[0] + dx * u + nx * 0.11,
              z = a[1] + dz * u + nz * 0.11;
            box(2.4, 0.16, 0.27, x, ground + y + 1.07, z, yaw, 0xbcb6a4);
            box(2.4, 0.23, 0.4, x, ground + y - 1.08, z, yaw, 0xc2b69e);
            for (const sign of [-1, 1])
              box(
                0.13,
                2.18,
                0.24,
                x + dx * 1.12 * sign,
                ground + y,
                z + dz * 1.12 * sign,
                yaw,
                0xaaa491,
              );
          }
        box(
          len,
          0.4,
          0.6,
          (a[0] + b[0]) / 2 + nx * 0.15,
          ground + f.properties.height - 0.3,
          (a[1] + b[1]) / 2 + nz * 0.15,
          yaw,
          0xbdb298,
        );
        for (let u = 4; u < len - 3; u += 8) {
          const x = a[0] + dx * u,
            z = a[1] + dz * u,
            side = hash(n) > 0.5 ? 0x496153 : 0x764437;
          box(
            4.8,
            2.7,
            0.18,
            x + nx * 0.15,
            ground + 1.4,
            z + nz * 0.15,
            yaw,
            0x29434a,
          );
          for (const t of [-2.45, 0, 2.45])
            box(
              0.12,
              2.8,
              0.25,
              x + dx * t + nx * 0.3,
              ground + 1.4,
              z + dz * t + nz * 0.3,
              yaw,
              0x273c3d,
            );
          box(
            5.5,
            0.16,
            1.7,
            x + nx * 0.8,
            ground + 3.2,
            z + nz * 0.8,
            yaw,
            side,
          );
          box(
            5.5,
            0.42,
            0.12,
            x + nx * 1.63,
            ground + 3,
            z + nz * 1.63,
            yaw,
            side,
          );
          const g = new THREE.PlaneGeometry(4.5, 0.7);
          g.rotateY(yaw);
          g.translate(x + nx * 0.4, ground + 4, z + nz * 0.4);
          signGeos[n % names.length].push(g);
          n++;
        }
      }
    }
  }
  const detailGeometry = new THREE.BoxGeometry(1, 1, 1),
    detailTransform = new THREE.Object3D();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  for (const { color, instances } of batches.values()) {
    if (!materials.has(color))
      materials.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }),
      );
    const mesh = new THREE.InstancedMesh(
      detailGeometry,
      materials.get(color)!,
      instances.length,
    );
    instances.forEach(([w, h, d, x, y, z, yaw], i) => {
      detailTransform.position.set(x, y, z);
      detailTransform.scale.set(w, h, d);
      detailTransform.rotation.set(0, yaw, 0);
      detailTransform.updateMatrix();
      mesh.setMatrixAt(i, detailTransform.matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    const lod = new THREE.LOD();
    lod.position.copy(mesh.boundingSphere!.center);
    mesh.position.copy(lod.position).negate();
    lod.addLevel(mesh, 0);
    lod.addLevel(new THREE.Group(), 900);
    e.landmarks.add(lod);
  }
  for (let i = 0; i < names.length; i++)
    if (signGeos[i].length) {
      const mesh = new THREE.Mesh(mergeGeometries(signGeos[i])!, signs[i]);
      e.landmarks.add(mesh);
      signGeos[i].forEach((g) => g.dispose());
    }
  // Gastown's steam clock, positioned from its map location. Original clock-face art.
  const [cx, cz] = project([-123.10865, 49.28443]),
    ground = e.elevation(cx, cz) + 1.3,
    g = new THREE.Group();
  g.position.set(cx, ground, cz);
  const add = (geom: THREE.BufferGeometry, color: number, y: number) => {
    const m = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        color,
        metalness: 0.25,
        roughness: 0.52,
      }),
    );
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(1.5, 0.38, 1.5), 0x88877b, 0.19);
  add(new THREE.BoxGeometry(0.96, 3.2, 0.96), 0x284334, 1.98);
  add(new THREE.BoxGeometry(1.24, 0.25, 1.24), 0xb6a673, 3.68);
  add(new THREE.BoxGeometry(1.02, 1.25, 1.02), 0x455743, 4.4);
  add(new THREE.ConeGeometry(0.89, 0.65, 4), 0x3a5745, 5.32);
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 6), 0xb5a772, 5.96);
  const face = document.createElement('canvas');
  face.width = 256;
  face.height = 256;
  const fc = face.getContext('2d')!;
  fc.fillStyle = '#e8e1bd';
  fc.beginPath();
  fc.arc(128, 128, 117, 0, Math.PI * 2);
  fc.fill();
  fc.strokeStyle = '#605d3e';
  fc.lineWidth = 7;
  fc.stroke();
  fc.fillStyle = '#2d3b32';
  fc.font = '22px Georgia';
  fc.textAlign = 'center';
  fc.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    fc.fillText(String(i), 128 + Math.sin(a) * 88, 128 - Math.cos(a) * 88);
  }
  fc.lineWidth = 6;
  fc.beginPath();
  fc.moveTo(128, 128);
  fc.lineTo(128, 49);
  fc.moveTo(128, 128);
  fc.lineTo(184, 142);
  fc.stroke();
  const tex = new THREE.CanvasTexture(face);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 0.85),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
    );
    m.rotation.y = (i * Math.PI) / 2;
    m.position.set(
      Math.sin((i * Math.PI) / 2) * 0.516,
      4.42,
      Math.cos((i * Math.PI) / 2) * 0.516,
    );
    g.add(m);
  }
  e.landmarks.add(g);
}

/** Modest original rooftop plant, placed strictly inside each measured footprint. */
export function createRoofDetails(e: CityEngine) {
  const boxes: {
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      d: number;
      seed: number;
    }[] = [],
    highest = new Map<string, any>();
  for (const f of e.data.buildings.features) {
    if (replacedBuilding(f.properties)) continue;
    const key = String(
      f.properties.structureId ?? f.properties.buildingId ?? f.properties.id,
    );
    if (
      !highest.has(key) ||
      highest.get(key).properties.height < f.properties.height
    )
      highest.set(key, f);
  }
  let seed = 0;
  for (const f of highest.values()) {
    const height = f.properties.height;
    if (height < 8 || height > 180) continue;
    for (const p of rings(f)) {
      const poly = p.map((r) => r.map(project)),
        r = poly[0],
        cx = r.reduce((s, p) => s + p[0], 0) / r.length,
        cz = r.reduce((s, p) => s + p[1], 0) / r.length;
      if (
        ![
          [cx - 3, cz - 3],
          [cx + 3, cz - 3],
          [cx + 3, cz + 3],
          [cx - 3, cz + 3],
        ].every((p) => inPolygon(p, poly))
      )
        continue;
      boxes.push({
        x: cx,
        y: e.elevation(cx, cz) - 0.35 + height,
        z: cz,
        w: 2.3 + hash(seed) * 2,
        h: 1.2 + hash(seed + 5) * 1.5,
        d: 2.1 + hash(seed + 7) * 2,
        seed: seed++,
      });
    }
  }
  const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x838d8c, roughness: 0.8 }),
      boxes.length,
    ),
    vents = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x384b50, roughness: 0.85 }),
      boxes.length,
    ),
    obj = new THREE.Object3D();
  boxes.forEach((b, i) => {
    obj.rotation.set(0, -0.78, 0);
    obj.position.set(b.x, b.y + b.h / 2, b.z);
    obj.scale.set(b.w, b.h, b.d);
    obj.updateMatrix();
    body.setMatrixAt(i, obj.matrix);
    obj.position.y = b.y + b.h + 0.08;
    obj.scale.set(Math.min(b.w, b.d) * 0.65, 1, Math.min(b.w, b.d) * 0.65);
    obj.updateMatrix();
    vents.setMatrixAt(i, obj.matrix);
  });
  body.castShadow = true;
  body.receiveShadow = true;
  e.buildings.add(body, vents);
}

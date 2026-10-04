import * as THREE from 'three';

/** Exact triangle-metric charts. UV values are metres, never normalized 0..1.
 * Positions/normals/transforms stay byte-identical. Charts deliberately split at
 * triangle edges: suited to the small stochastic maps here, NOT directional
 * planks, large decals or a seamless curved-body paint design. Floors use a
 * common XZ chart, so neighbouring flat floor fragments remain phase-aligned.
 */
export function metreUV(geometry, mode = 'triangle') {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  if (!p || p.count % 3) throw new Error('Triangle positions required');
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const u = new THREE.Vector3(), n = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    u.subVectors(b, a); n.crossVectors(u, v.subVectors(c, a));
    if (n.lengthSq() < 1e-24) {
      if (u.lengthSq() < 1e-24) u.subVectors(c, a);
      const axis = Math.abs(u.clone().normalize().y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
      n.crossVectors(u, axis);
    }
    if (mode === 'floor' && Math.abs(n.normalize().y) > 0.99999) {
      uv.set([a.x, a.z, b.x, b.z, c.x, c.z], i * 2);
    } else {
      // An isometric chart per triangle also handles sloped circulation floors.
      u.normalize(); v.crossVectors(n.normalize(), u).normalize();
      uv.set([a.dot(u), a.dot(v), b.dot(u), b.dot(v), c.dot(u), c.dot(v)], i * 2);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.userData.metreUV = { units: 'm', mode, chartSeams: mode === 'floor' ? 'crease-or-triangle' : 'per-triangle' };
  return g;
}

export function metricError(g) {
  const p = g.getAttribute('position'), uv = g.getAttribute('uv');
  if (!p || !uv || p.count !== uv.count) throw new Error('Missing metre UV');
  let max = 0, measuredEdges = 0;
  for (let i = 0; i < p.count; i += 3) for (const [a, b] of [[0,1],[1,2],[2,0]]) {
    const x = i+a, y = i+b;
    const d = Math.hypot(p.getX(x)-p.getX(y),p.getY(x)-p.getY(y),p.getZ(x)-p.getZ(y));
    const t = Math.hypot(uv.getX(x)-uv.getX(y),uv.getY(x)-uv.getY(y));
    max = Math.max(max, Math.abs(d-t)); measuredEdges++;
  }
  return { maxAbsoluteEdgeErrorM: max, measuredEdges };
}

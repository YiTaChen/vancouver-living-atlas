/** MIT. Exact planar triangle intersection checks, no external geometry package. */
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const bounds = (p) => [
  Math.min(...p.map((p) => p[0])),
  Math.min(...p.map((p) => p[1])),
  Math.max(...p.map((p) => p[0])),
  Math.max(...p.map((p) => p[1])),
];
const overlaps = (a, b) =>
  a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const area = (p) =>
  p.length < 3
    ? 0
    : Math.abs(
        p.slice(1, -1).reduce((n, a, i) => n + cross(p[0], a, p[i + 2]), 0),
      ) / 2;
function intersection(poly, clip) {
  let out = poly;
  const sign = cross(clip[0], clip[1], clip[2]) >= 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length],
      input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j],
        q = input[(j + 1) % input.length],
        dp = sign * cross(a, b, p),
        dq = sign * cross(a, b, q);
      if (dp >= -1e-9) out.push(p);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}
function triangle(flat, offset) {
  const p = [0, 3, 6].map((i) => [flat[offset + i], flat[offset + i + 2]]),
    y = [flat[offset + 1], flat[offset + 4], flat[offset + 7]],
    det = cross(p[0], p[1], p[2]);
  if (Math.abs(det) < 1e-7) return;
  return {
    p,
    bounds: bounds(p),
    height(x, z) {
      const u =
        ((x - p[0][0]) * (p[2][1] - p[0][1]) -
          (z - p[0][1]) * (p[2][0] - p[0][0])) /
        det;
      const v =
        ((p[1][0] - p[0][0]) * (z - p[0][1]) -
          (p[1][1] - p[0][1]) * (x - p[0][0])) /
        det;
      return y[0] + u * (y[1] - y[0]) + v * (y[2] - y[0]);
    },
  };
}
export function auditGeometry({ e, road, paths, groundPathMeshes }) {
  const lowerIds = new Set([
      363686270, 648864806, 44032491, 115939816, 74267973,
    ]),
    lower = [];
  for (const mesh of groundPathMeshes)
    if (lowerIds.has(mesh.userData.auditPathId)) {
      const p = mesh.geometry.getAttribute('position').array;
      for (let i = 0; i < p.length; i += 9) {
        const tri = triangle(p, i);
        if (tri) lower.push({ ...tri, sourceId: mesh.userData.auditPathId });
      }
    }
  function clearance(geometry) {
    const flat = geometry.buffers.slab;
    let checks = 0,
      minimum;
    for (let i = 0; i < flat.length; i += 9) {
      const top = triangle(flat, i);
      if (!top) continue;
      for (const bottom of lower) {
        if (!overlaps(top.bounds, bottom.bounds)) continue;
        const q = intersection(top.p, bottom.p);
        if (area(q) < 1e-9) continue;
        for (const p of q) {
          const soffitY = top.height(...p),
            lowerY = bottom.height(...p),
            headroomM = soffitY - lowerY;
          checks++;
          if (!minimum || headroomM < minimum.headroomM)
            minimum = {
              slabTriangleOffset: i,
              lowerPathId: bottom.sourceId,
              point: p,
              soffitY,
              lowerY,
              headroomM,
            };
        }
      }
    }
    return { checks, minimum, valid: !!minimum && minimum.headroomM >= 3 };
  }
  const main = e.data.causeway.main.segments,
    a = main[0].a,
    b = main.at(-1).b,
    dx = b[0] - a[0],
    dz = b[1] - a[1],
    length = Math.hypot(dx, dz);
  const frame = (x, z) => [
    ((x - a[0]) * dx + (z - a[1]) * dz) / length,
    (-(x - a[0]) * dz + (z - a[1]) * dx) / length,
  ];
  const pylons = [];
  for (const station of [187, 659])
    for (const side of [-1, 1]) {
      const offset = side * 10.8,
        box = [
          [station - 2, offset - 1.7],
          [station + 2, offset - 1.7],
          [station + 2, offset + 1.7],
          [station - 2, offset + 1.7],
        ],
        bb = bounds(box);
      let topOverlaps = 0,
        railOverlaps = 0;
      for (const kind of ['asphalt', 'shoulder', 'rails']) {
        const flat = paths.result.buffers[kind];
        for (let i = 0; i < flat.length; i += 9) {
          const p = [0, 3, 6].map((j) => frame(flat[i + j], flat[i + j + 2]));
          if (!overlaps(bounds(p), bb) || area(p) < 1e-9) continue;
          if (area(intersection(p, box)) > 1e-8) {
            if (kind === 'rails') railOverlaps++;
            else topOverlaps++;
          }
        }
      }
      pylons.push({
        station,
        side: side < 0 ? 'west' : 'east',
        topOverlaps,
        railOverlaps,
        valid: topOverlaps === 0 && railOverlaps === 0,
      });
    }
  const roadSlab = clearance(road.result),
    pathSlab = clearance(paths.result);
  return {
    valid: roadSlab.valid && pathSlab.valid && pylons.every((p) => p.valid),
    roadSlab,
    pathSlab,
    pylons,
  };
}

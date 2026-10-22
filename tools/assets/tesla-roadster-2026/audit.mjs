/** Independent CPU audit of the quantized Roadster payload; no Blender/WebGL. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PACKAGE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(PACKAGE, '../../..');
export const DATA = join(
  ROOT,
  'lib/city/assets/tesla-roadster-detailed-data.json',
);
export const METRICS = join(
  ROOT,
  'lib/city/assets/tesla-roadster-detailed-metrics.json',
);
const TAU = Math.PI * 2;
const BUDGETS = { low: 12000, medium: 30000, high: 60000 };
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const finite = (v) => Array.isArray(v) && v.every(Number.isFinite);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const norm = (p) => Math.hypot(...p);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const empty = () => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});
const extend = (box, p) => {
  for (let i = 0; i < 3; i++) {
    box.min[i] = Math.min(box.min[i], p[i]);
    box.max[i] = Math.max(box.max[i], p[i]);
  }
};
const union = (a, b) => {
  extend(a, b.min);
  extend(a, b.max);
  return a;
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
const lexical = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const roundedUp = (n, unit = 0.001) =>
  Number((Math.ceil((n - 1e-10) / unit) * unit).toFixed(8));
const roundedDown = (n, unit = 0.001) =>
  Number((Math.floor((n + 1e-10) / unit) * unit).toFixed(8));

function bytes(text, size, label) {
  check(
    typeof text === 'string' &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        text,
      ),
    `${label}: malformed base64`,
  );
  const result = Buffer.from(text, 'base64');
  check(
    result.length === size && result.toString('base64') === text,
    `${label}: byte length/canonical encoding mismatch`,
  );
  return result;
}

export function decodePart(part, scale = 0.0001) {
  const n = part.vertexCount,
    count = part.indexCount;
  check(
    Number.isInteger(n) &&
      n > 0 &&
      n <= 65536 &&
      Number.isInteger(count) &&
      count > 0 &&
      count % 3 === 0,
    'invalid vertex/index count',
  );
  const p = bytes(part.positions, n * 6, 'positions'),
    normal = bytes(part.normals, n * 3, 'normals'),
    indices = bytes(part.indices, count * 2, 'indices');
  const color =
    part.colors === undefined ? null : bytes(part.colors, n * 3, 'colors');
  const positions = [],
    normals = [],
    colors = [],
    index = [];
  for (let i = 0; i < n; i++) {
    positions.push([0, 1, 2].map((c) => p.readInt16LE(i * 6 + c * 2) * scale));
    const vector = [0, 1, 2].map((c) => normal.readInt8(i * 3 + c) / 127),
      magnitude = norm(vector);
    check(
      magnitude > 0 && Number.isFinite(magnitude),
      'zero/nonfinite quantized normal',
    );
    check(
      vector.every((v) => v >= -1 && v <= 1),
      'normal outside signed normalized byte range',
    );
    normals.push(vector.map((v) => v / magnitude));
    if (color) colors.push([0, 1, 2].map((c) => color[i * 3 + c] / 255));
  }
  for (let i = 0; i < count; i++) {
    const v = indices.readUInt16LE(i * 2);
    check(v < n, 'triangle index out of range');
    index.push(v);
  }
  return {
    ...part,
    positions,
    normals,
    colors: color ? colors : null,
    indices: index,
  };
}

export function rigState(data) {
  const rig = data.rig,
    nodes = new Map();
  check(rig && Array.isArray(rig.nodes), 'missing rig');
  for (const node of rig.nodes) {
    check(
      typeof node.id === 'string' &&
        !nodes.has(node.id) &&
        finite(node.position) &&
        node.position.length === 3,
      'invalid/duplicate rig node',
    );
    check(
      node.rotationQuaternion === undefined ||
        (finite(node.rotationQuaternion) &&
          node.rotationQuaternion.length === 4 &&
          node.rotationQuaternion.every(
            (v, i) => Math.abs(v - [0, 0, 0, 1][i]) < 1e-12,
          )),
      'non-identity authored basis is outside this baked-rig contract',
    );
    nodes.set(node.id, node);
  }
  const chain = (id) => {
    const result = [],
      seen = new Set();
    while (id !== null) {
      check(nodes.has(id) && !seen.has(id), `missing/cyclic rig node ${id}`);
      seen.add(id);
      result.push(nodes.get(id));
      id = nodes.get(id).parent;
    }
    return result;
  };
  const world = (id) =>
    chain(id).reduce((p, n) => add(p, n.position), [0, 0, 0]);
  for (const id of nodes.keys()) chain(id);
  for (const [key, count] of [
    ['wheelSteers', 2],
    ['wheelRolls', 4],
    ['fans', 4],
  ])
    check(
      Array.isArray(rig[key]) &&
        new Set(rig[key]).size === count &&
        rig[key].every((id) => nodes.has(id)),
      `invalid ${key} rig`,
    );
  for (const id of [rig.steering, rig.wing, rig.roof])
    check(nodes.has(id), 'missing yoke/wing/roof node');
  for (const side of ['left', 'right']) {
    const door = rig.doors?.[side];
    check(
      door &&
        nodes.has(door.id) &&
        finite(door.axis) &&
        Math.abs(norm(door.axis) - 1) < 1e-5,
      'invalid door rig/axis',
    );
  }
  const wheelRoots = new Set(rig.wheelRolls.map((id) => nodes.get(id).parent));
  check(
    wheelRoots.size === 4,
    'wheel roll assemblies must have separate steering parents',
  );
  return { rig, nodes, chain, world, wheelRoots };
}

function rotate(p, axis, a) {
  const c = Math.cos(a),
    s = Math.sin(a);
  if (axis === 'x') return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  if (axis === 'y') return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

export function posedPoint(point, assembly, state, pose = {}) {
  let p = [...point];
  const { rig } = state;
  for (const node of state.chain(assembly)) {
    if (rig.wheelRolls.includes(node.id))
      p = rotate(p, 'x', pose.wheelSpinRad ?? 0);
    if (rig.wheelSteers.includes(node.id))
      p = rotate(p, 'y', pose.steeringRad ?? 0);
    if (rig.fans.includes(node.id))
      p = rotate(
        p,
        'z',
        (pose.fanSpinRad ?? 0) * (rig.fans.indexOf(node.id) % 2 ? -1 : 1),
      );
    if (node.id === rig.steering)
      p = rotate(p, 'z', -2.6 * (pose.steeringRad ?? 0));
    if (node.id === rig.wing)
      p = rotate(p, 'x', -0.28 * (pose.wingDeploy ?? 0));
    p = add(p, node.position);
    if (node.id === rig.wing) p[1] += 0.24 * (pose.wingDeploy ?? 0);
  }
  return p;
}

/** Exact extrema of a*cos(t)+b*sin(t)+c*t on a closed interval. */
export function angularRange(a, b, lo, hi, c = 0) {
  const candidates = [lo, hi],
    r = Math.hypot(a, b);
  if (r > 0 && Math.abs(c) <= r) {
    const phase = Math.atan2(b, a),
      v = Math.asin(c / r);
    for (const base of [phase + v, phase + Math.PI - v])
      for (
        let k = Math.floor((lo - base) / TAU) - 1;
        k <= Math.ceil((hi - base) / TAU) + 1;
        k++
      ) {
        const t = base + k * TAU;
        if (t >= lo && t <= hi) candidates.push(t);
      }
  }
  const values = candidates.map(
    (t) => a * Math.cos(t) + b * Math.sin(t) + c * t,
  );
  return [Math.min(...values), Math.max(...values)];
}

export function sweptPoint(q, assembly, state, maxSteer = 0.62) {
  const { rig } = state,
    ids = state.chain(assembly).map((n) => n.id),
    result = empty();
  const roll = ids.find((id) => rig.wheelRolls.includes(id));
  if (roll) {
    const pivot = state.world(roll),
      v = sub(q, pivot),
      a = ids.some((id) => rig.wheelSteers.includes(id)) ? maxSteer : 0,
      r = Math.hypot(v[1], v[2]);
    const xr = [angularRange(v[0], r, -a, a), angularRange(v[0], -r, -a, a)],
      zr = [angularRange(r, -v[0], -a, a), angularRange(-r, -v[0], -a, a)];
    result.min = [
      pivot[0] + Math.min(...xr.map((x) => x[0])),
      pivot[1] - r,
      pivot[2] + Math.min(...zr.map((x) => x[0])),
    ];
    result.max = [
      pivot[0] + Math.max(...xr.map((x) => x[1])),
      pivot[1] + r,
      pivot[2] + Math.max(...zr.map((x) => x[1])),
    ];
    return result;
  }
  const moving = ids.filter(
    (id) =>
      rig.wheelSteers.includes(id) ||
      rig.fans.includes(id) ||
      id === rig.steering ||
      id === rig.wing,
  );
  check(moving.length <= 1, 'unsupported nested non-wheel animation');
  if (!moving.length) {
    extend(result, q);
    return result;
  }
  const id = moving[0],
    pivot = state.world(id),
    v = sub(q, pivot);
  let ranges;
  if (rig.wheelSteers.includes(id))
    ranges = [
      angularRange(v[0], v[2], -maxSteer, maxSteer),
      [v[1], v[1]],
      angularRange(v[2], -v[0], -maxSteer, maxSteer),
    ];
  else if (id === rig.wing)
    ranges = [
      [v[0], v[0]],
      angularRange(v[1], -v[2], -0.28, 0, -0.24 / 0.28),
      angularRange(v[2], v[1], -0.28, 0),
    ];
  else {
    const a = rig.fans.includes(id) ? Math.PI : maxSteer * 2.6;
    ranges = [
      angularRange(v[0], -v[1], -a, a),
      angularRange(v[1], v[0], -a, a),
      [v[2], v[2]],
    ];
  }
  result.min = ranges.map((r, i) => r[0] + pivot[i]);
  result.max = ranges.map((r, i) => r[1] + pivot[i]);
  return result;
}

function clip(poly, z, above) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ai = above ? a[2] >= z : a[2] <= z,
      bi = above ? b[2] >= z : b[2] <= z;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (z - a[2]) / (b[2] - a[2]);
      out.push(a.map((v, j) => v + (b[j] - v) * t));
    }
  }
  return out;
}
export function clippedMinimum(triangle, minZ, maxZ) {
  const polygon = clip(clip(triangle, minZ, true), maxZ, false);
  return polygon.length ? Math.min(...polygon.map((p) => p[1])) : null;
}

function upwardRay(triangle) {
  const [a, b, c] = triangle,
    ab = sub(b, a),
    ac = sub(c, a),
    den = ab[0] * ac[2] - ac[0] * ab[2];
  if (Math.abs(den) < 1e-15) return null;
  const u = (-a[0] * ac[2] + a[2] * ac[0]) / den,
    v = (-ab[0] * a[2] + ab[2] * a[0]) / den;
  if (u < -1e-10 || v < -1e-10 || u + v > 1 + 1e-10) return null;
  const y = a[1] + u * ab[1] + v * ac[1];
  return y >= 0 ? y : null;
}

function rayTriangle(origin, direction, triangle) {
  const [a, b, c] = triangle,
    e1 = sub(b, a),
    e2 = sub(c, a),
    p = cross(direction, e2),
    det = e1.reduce((s, v, i) => s + v * p[i], 0);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(origin, a),
    u = s.reduce((sum, v, i) => sum + v * p[i], 0) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1),
    v = direction.reduce((sum, x, i) => sum + x * q[i], 0) / det;
  if (v < 0 || u + v > 1) return null;
  const distance = e2.reduce((sum, x, i) => sum + x * q[i], 0) / det;
  return distance > 1e-8 ? distance : null;
}

export function analyzePayload(data) {
  check(
    data.version === 1 &&
      data.positionScale === 0.0001 &&
      data.axes === 'Atlas: +X left,+Y up,+Z front',
    'invalid schema/axis/quantization contract',
  );
  check(
    data.source && JSON.stringify(data.source).length > 100,
    'missing meaningful donor provenance',
  );
  const state = rigState(data),
    unionRest = empty(),
    unionAnimated = empty(),
    levels = {},
    decoded = {};
  for (const [quality, budget] of Object.entries(BUDGETS)) {
    const lod = data.lods?.[quality];
    check(
      lod &&
        Array.isArray(lod.parts) &&
        lod.parts.length > 0 &&
        lod.parts.length <= 34,
      `${quality}: payload draw budget`,
    );
    const parts = lod.parts.map((p) => decodePart(p, data.positionScale));
    decoded[quality] = parts;
    const rest = empty(),
      animated = empty(),
      wheelRadii = {},
      wheelBounds = {},
      tyreContactRayY = {};
    let triangles = 0,
      vertices = 0,
      degenerates = 0,
      colors = 0,
      minBody = Infinity,
      undertray = Infinity,
      roofDistance = Infinity,
      opaqueRoofDistance = Infinity,
      forwardOpaqueDistance = Infinity,
      fanMinimumY = Infinity,
      fanAnimatedMinimumY = Infinity;
    for (const part of parts) {
      check(
        state.nodes.has(part.assembly) && typeof part.role === 'string',
        `${quality}: unknown assembly/material`,
      );
      vertices += part.vertexCount;
      triangles += part.indices.length / 3;
      if (part.colors) colors += part.colors.length;
      const chain = state.chain(part.assembly).map((n) => n.id),
        wheelRoot = chain.find((id) => state.wheelRoots.has(id)),
        roll = chain.find((id) => state.rig.wheelRolls.includes(id));
      const world = part.positions.map((p) =>
        posedPoint(p, part.assembly, state),
      );
      for (const q of world) {
        extend(rest, q);
        union(animated, sweptPoint(q, part.assembly, state));
        if (!wheelRoot) minBody = Math.min(minBody, q[1]);
        if (chain.some((id) => state.rig.fans.includes(id))) {
          fanMinimumY = Math.min(fanMinimumY, q[1]);
          fanAnimatedMinimumY = Math.min(
            fanAnimatedMinimumY,
            sweptPoint(q, part.assembly, state).min[1],
          );
        }
        if (roll) {
          const v = sub(q, state.world(roll));
          wheelRadii[roll] = Math.max(
            wheelRadii[roll] ?? 0,
            Math.hypot(v[1], v[2]),
          );
          wheelBounds[roll] ??= empty();
          extend(wheelBounds[roll], q);
        }
      }
      for (let i = 0; i < part.indices.length; i += 3) {
        const t = part.indices.slice(i, i + 3).map((j) => world[j]);
        if (norm(cross(sub(t[1], t[0]), sub(t[2], t[0]))) / 2 <= 1e-12)
          degenerates++;
        if (roll && part.role === 'rubber') {
          const pivot = state.world(roll),
            hit = rayTriangle([pivot[0], -0.05, pivot[2]], [0, 1, 0], t);
          if (hit !== null)
            tyreContactRayY[roll] = Math.min(
              tyreContactRayY[roll] ?? Infinity,
              hit - 0.05,
            );
        }
        if (!wheelRoot) {
          const hit = upwardRay(t);
          if (hit !== null) undertray = Math.min(undertray, hit);
          const canopy = rayTriangle(data.anchors.driverEye, [0, 1, 0], t);
          if (canopy !== null) roofDistance = Math.min(roofDistance, canopy);
          if (part.role !== 'glass') {
            const up = rayTriangle(data.anchors.driverEye, [0, 1, 0], t),
              forward = rayTriangle(data.anchors.driverEye, [0, 0, 1], t);
            if (up !== null)
              opaqueRoofDistance = Math.min(opaqueRoofDistance, up);
            if (forward !== null)
              forwardOpaqueDistance = Math.min(forwardOpaqueDistance, forward);
          }
        }
      }
    }
    check(
      triangles === lod.triangles && triangles < budget,
      `${quality}: actual triangle count/budget mismatch`,
    );
    check(
      degenerates === 0,
      `${quality}: ${degenerates} quantized degenerate triangles`,
    );
    check(
      Object.keys(wheelRadii).length === 4,
      `${quality}: missing wheel geometry`,
    );
    check(
      state.rig.wheelRolls.every(
        (id) =>
          Number.isFinite(tyreContactRayY[id]) &&
          tyreContactRayY[id] >= -1e-6 &&
          tyreContactRayY[id] < 0.001,
      ),
      `${quality}: continuous tyre tread is not within one millimetre of the contact plane: ${JSON.stringify(tyreContactRayY)}`,
    );
    check(
      animated.min[1] >= -1e-6,
      `${quality}: arbitrary wheel/fan/wing pose penetrates ground (${animated.min[1]})`,
    );
    check(
      Number.isFinite(roofDistance) && roofDistance > 0.025,
      `${quality}: driver eye is not safely below the closed canopy`,
    );
    check(
      forwardOpaqueDistance >= 0.6,
      `${quality}: opaque geometry obscures the neutral driver view`,
    );
    levels[quality] = {
      triangles,
      vertices,
      geometryDraws: parts.length,
      maxDrawsWithYawAndJets: parts.length + 2,
      maxTrianglesWithYawAndJets:
        triangles + { low: 24, medium: 32, high: 48 }[quality] + 160,
      coloredVertices: colors,
      degenerateTriangles: degenerates,
      boundsM: rest,
      animatedBoundsM: animated,
      wheelRadiiM: wheelRadii,
      wheelBoundsM: wheelBounds,
      tyreContactRayY,
      minimumBodyY: minBody,
      fanMinimumY,
      fanAnimatedMinimumY,
      camera: {
        canopyDistanceM: roofDistance,
        opaqueRoofDistanceM: Number.isFinite(opaqueRoofDistance)
          ? opaqueRoofDistance
          : null,
        firstForwardOpaqueDistanceM: Number.isFinite(forwardOpaqueDistance)
          ? forwardOpaqueDistance
          : null,
        nearM: 0.025,
        neutralViewClear: true,
      },
      undertrayAtOriginY: Number.isFinite(undertray) ? undertray : null,
    };
    union(unionRest, rest);
    union(unionAnimated, animated);
  }
  check(
    levels.low.triangles < levels.medium.triangles &&
      levels.medium.triangles < levels.high.triangles,
    'LOD triangle counts are not monotonic',
  );
  const halfExtents = [
    roundedUp(Math.max(-unionAnimated.min[0], unionAnimated.max[0])),
    roundedUp(unionAnimated.max[1] / 2),
    roundedUp(Math.max(-unionAnimated.min[2], unionAnimated.max[2])),
  ];
  const centers = state.rig.wheelRolls.map((id) => state.world(id)),
    front = Math.max(...centers.map((p) => p[2])),
    rear = Math.min(...centers.map((p) => p[2]));
  const boundaries = [-halfExtents[2], rear, front, halfExtents[2]];
  for (const [quality, parts] of Object.entries(decoded)) {
    const minima = [Infinity, Infinity, Infinity],
      animatedMinima = [Infinity, Infinity, Infinity],
      frontMin = { value: Infinity },
      rearMin = { value: Infinity };
    for (const part of parts) {
      const ids = state.chain(part.assembly).map((n) => n.id);
      if (ids.some((id) => state.wheelRoots.has(id))) continue;
      const world = part.positions.map((p) =>
          posedPoint(p, part.assembly, state),
        ),
        wing = ids.includes(state.rig.wing);
      let wingSection = null;
      if (wing) {
        const bounds = empty();
        for (const q of world)
          union(bounds, sweptPoint(q, part.assembly, state));
        wingSection = [0, 1, 2].find(
          (i) =>
            bounds.min[2] >= boundaries[i] - 1e-8 &&
            bounds.max[2] <= boundaries[i + 1] + 1e-8,
        );
        check(
          wingSection !== undefined,
          'wing pitch crosses support-section boundary; exact sweep clipping needs extension',
        );
        for (const q of world)
          animatedMinima[wingSection] = Math.min(
            animatedMinima[wingSection],
            sweptPoint(q, part.assembly, state).min[1],
          );
      }
      for (let i = 0; i < part.indices.length; i += 3) {
        const t = part.indices.slice(i, i + 3).map((j) => world[j]);
        for (let s = 0; s < 3; s++) {
          const polygon = clip(
            clip(t, boundaries[s], true),
            boundaries[s + 1],
            false,
          );
          for (const q of polygon) {
            minima[s] = Math.min(minima[s], q[1]);
            if (!wing)
              animatedMinima[s] = Math.min(
                animatedMinima[s],
                sweptPoint(q, part.assembly, state).min[1],
              );
          }
        }
        const fm = clippedMinimum(t, front + 0.3505, halfExtents[2]),
          rm = clippedMinimum(t, -halfExtents[2], rear - 0.3505);
        if (fm !== null) frontMin.value = Math.min(frontMin.value, fm);
        if (rm !== null) rearMin.value = Math.min(rearMin.value, rm);
      }
    }
    levels[quality].bodySectionMinimumY = minima;
    levels[quality].animatedBodySectionMinimumY = animatedMinima;
    levels[quality].frontBumperMinimumY = frontMin.value;
    levels[quality].rearDiffuserMinimumY = rearMin.value;
  }
  const radius = roundedUp(
      Math.max(
        ...Object.values(levels).flatMap((l) => Object.values(l.wheelRadiiM)),
      ),
      0.0001,
    ),
    minimums = [0, 1, 2].map((i) =>
      Math.min(
        ...Object.values(levels).map((l) => l.animatedBodySectionMinimumY[i]),
      ),
    );
  check(
    centers.every((p) => Math.abs(p[1] - radius) < 0.001),
    'tyre centre/radius inconsistent with contact datum',
  );
  const contacts = [...centers]
    .sort((a, b) => b[2] - a[2] || a[0] - b[0])
    .map((p) => [
      p[0],
      Math.abs(p[1] - radius) < 1e-7 ? 0 : p[1] - radius,
      p[2],
    ]);
  const metrics = {
    schemaVersion: 1,
    axes: data.axes,
    poseRange: {
      steeringRad: [-0.62, 0.62],
      wheelSpinRad: 'all angles',
      fanSpinRad: 'all angles',
      wingDeploy: [0, 1],
      wingPitchRad: [0, -0.28],
      wingLiftM: 0.24,
      doors: 'closed during gameplay',
    },
    dimensions: {
      length: unionRest.max[2] - unionRest.min[2],
      width: unionRest.max[0] - unionRest.min[0],
      height: unionRest.max[1] - unionRest.min[1],
      wheelbase: front - rear,
      wheelRadius: radius,
      contactToCenter: halfExtents[1],
      halfExtents,
    },
    groundSupport: {
      wheelContacts: contacts,
      track:
        Math.max(...centers.map((p) => p[0])) -
        Math.min(...centers.map((p) => p[0])),
      wheelRadius: radius,
      chassisClearance: roundedDown(Math.min(...minimums) - 0.002),
      suspensionTravel: 0.05,
      bodySections: minimums.map((m, i) => ({
        minZ: boundaries[i],
        maxZ: boundaries[i + 1],
        clearance: roundedDown(m - 0.002),
      })),
      measured: {
        minimumBodyY: Math.min(
          ...Object.values(levels).map((l) => l.minimumBodyY),
        ),
        bodySectionMinimumY: minimums,
        frontOverhang: roundedUp(unionRest.max[2] - front, 0.0001),
        rearOverhang: roundedUp(rear - unionRest.min[2], 0.0001),
      },
    },
    anchors: data.anchors,
    levels,
  };
  check(
    data.anchors &&
      Object.values(data.anchors).every((v) => !Array.isArray(v) || finite(v)),
    'invalid authored anchors',
  );
  return { metrics, decoded, state, unionRest, unionAnimated };
}

function triangleDigest(positions, colors, indices) {
  const vertices = positions.map((p, i) =>
    [
      ...p.map((v) => Math.round(v * 10000)),
      ...colors[i].slice(0, 3).map((v) => Math.round(v * 255)),
    ].join(','),
  );
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) {
    const v = indices.slice(i, i + 3).map((j) => vertices[j]);
    triangles.push(
      [
        v.join('|'),
        [v[1], v[2], v[0]].join('|'),
        [v[2], v[0], v[1]].join('|'),
      ].sort(lexical)[0],
    );
  }
  return sha(triangles.sort(lexical).join('\n'));
}

/** Independent binary GLB parity permits exporter vertex deduplication. */
export function auditInspectionGLB(path, parts, state) {
  const binary = readFileSync(path);
  check(
    binary.toString('ascii', 0, 4) === 'glTF' &&
      binary.readUInt32LE(4) === 2 &&
      binary.readUInt32LE(8) === binary.length,
    'invalid inspection GLB container',
  );
  const jsonLength = binary.readUInt32LE(12),
    data = JSON.parse(binary.subarray(20, 20 + jsonLength).toString()),
    binStart = 28 + jsonLength;
  check(
    binary.readUInt32LE(16) === 0x4e4f534a &&
      binary.readUInt32LE(24 + jsonLength) === 0x004e4942,
    'invalid inspection GLB chunks',
  );
  check(
    !data.cameras?.length && !data.extensions?.KHR_lights_punctual,
    'studio cameras/lights in inspection GLB',
  );
  function accessor(index) {
    const a = data.accessors[index],
      v = data.bufferViews[a.bufferView],
      channels = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type],
      size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    check(channels && size && !a.sparse, 'unsupported GLB accessor encoding');
    const stride = v.byteStride ?? channels * size,
      offset = binStart + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    check(
      (a.byteOffset ?? 0) + (a.count - 1) * stride + channels * size <=
        v.byteLength,
      'inspection GLB accessor exceeds view',
    );
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: channels }, (_, c) => {
        const p = offset + i * stride + c * size;
        let value =
          a.componentType === 5126
            ? binary.readFloatLE(p)
            : a.componentType === 5125
              ? binary.readUInt32LE(p)
              : a.componentType === 5123
                ? binary.readUInt16LE(p)
                : binary.readUInt8(p);
        if (a.normalized)
          value /= { 5121: 255, 5123: 65535, 5125: 4294967295 }[
            a.componentType
          ];
        return value;
      }),
    );
  }
  const parents = new Map();
  for (let i = 0; i < data.nodes.length; i++)
    for (const child of data.nodes[i].children ?? []) {
      check(!parents.has(child), 'multiple GLB parents');
      parents.set(child, i);
    }
  const expected = new Map(parts.map((p) => [`${p.assembly}:${p.role}`, p]));
  let triangles = 0,
    count = 0;
  for (let i = 0; i < data.nodes.length; i++) {
    const node = data.nodes[i];
    check(
      node.camera === undefined && !node.extensions?.KHR_lights_punctual,
      'non-asset GLB node',
    );
    if (node.mesh === undefined) continue;
    const part = expected.get(node.name);
    check(part, `unexpected inspection GLB mesh ${node.name}`);
    expected.delete(node.name);
    const translation = [0, 0, 0],
      seen = new Set();
    let cursor = i;
    while (cursor !== undefined) {
      check(!seen.has(cursor), 'cyclic inspection GLB');
      seen.add(cursor);
      const n = data.nodes[cursor];
      check(
        !n.matrix &&
          (n.rotation ?? [0, 0, 0, 1]).every(
            (v, j) => Math.abs(v - [0, 0, 0, 1][j]) < 1e-6,
          ) &&
          (n.scale ?? [1, 1, 1]).every((v) => Math.abs(v - 1) < 1e-6),
        'inspection GLB basis differs from quantized rig',
      );
      for (let axis = 0; axis < 3; axis++)
        translation[axis] += (n.translation ?? [0, 0, 0])[axis];
      cursor = parents.get(cursor);
    }
    check(
      translation.every(
        (v, j) => Math.abs(v - state.world(part.assembly)[j]) < 1e-6,
      ),
      'inspection GLB world translation differs from runtime rig',
    );
    const primitives = data.meshes[node.mesh].primitives;
    check(primitives.length === 1, 'inspection mesh primitive count changed');
    const p = primitives[0];
    check((p.mode ?? 4) === 4, 'inspection GLB has non-triangle geometry');
    const positions = accessor(p.attributes.POSITION),
      normals = accessor(p.attributes.NORMAL),
      colors = accessor(p.attributes.COLOR_0),
      indices = accessor(p.indices).map((v) => v[0]);
    check(
      positions.length === normals.length &&
        positions.length === colors.length &&
        indices.length === part.indices.length,
      'inspection GLB attribute/triangle counts differ',
    );
    check(
      positions.every((v) => finite(v)) &&
        normals.every((n) => finite(n) && Math.abs(norm(n) - 1) < 0.001) &&
        colors.every((c) => finite(c) && c.every((v) => v >= 0 && v <= 1)) &&
        indices.every(
          (v) => Number.isInteger(v) && v >= 0 && v < positions.length,
        ),
      'inspection GLB has invalid vertices/normals/colors/indices',
    );
    check(
      triangleDigest(positions, colors, indices) ===
        triangleDigest(part.positions, part.colors, part.indices),
      `inspection GLB colored triangle geometry differs: ${node.name}`,
    );
    triangles += indices.length / 3;
    count++;
  }
  check(expected.size === 0, 'inspection GLB omits runtime parts');
  return {
    triangles,
    parts: count,
    positionsColorsOrientedTrianglesMatch: true,
    finiteUnitNormals: true,
    worldTransformAgreement: true,
  };
}

export function auditPackage() {
  const raw = readFileSync(DATA),
    data = JSON.parse(raw),
    analysis = analyzePayload(data);
  const exported = join(PACKAGE, 'exports/tesla-roadster-detailed-data.json');
  check(
    readFileSync(exported).equals(raw),
    'runtime/export JSON copies differ',
  );
  const manifest = JSON.parse(
      readFileSync(join(PACKAGE, 'manifest.json'), 'utf8'),
    ),
    records = [];
  check(
    manifest.schemaVersion === 1 &&
      manifest.contract === 'tesla-roadster-2026-quantized-v1' &&
      manifest.packageId === 'tesla-roadster-2026' &&
      manifest.units === 'm' &&
      manifest.axes === data.axes,
    'invalid package contract',
  );
  check(
    JSON.stringify(manifest.rig) === JSON.stringify(data.rig) &&
      JSON.stringify(manifest.anchors) === JSON.stringify(data.anchors),
    'manifest/data rig or anchors differ',
  );
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.sha256 && (value.file || value.path))
      records.push({
        ...value,
        file: value.export ?? value.path ?? value.file,
      });
    if (value.sourceSha256 && value.source)
      records.push({
        file: value.source,
        sha256: value.sourceSha256,
        bytes: value.sourceBytes,
      });
    for (const child of Object.values(value)) walk(child);
  }
  walk(manifest);
  check(
    records.length >= 13,
    'manifest does not identify all source and derived files',
  );
  const checked = [];
  for (const record of records) {
    const name = record.file,
      possibilities = [resolve(PACKAGE, name), resolve(ROOT, name)],
      path = possibilities.find(existsSync);
    check(
      path &&
        relative(ROOT, path) !== '..' &&
        !relative(ROOT, path).startsWith('../'),
      `manifest path unavailable/outside checkout: ${name}`,
    );
    const bytes = readFileSync(path);
    check(
      sha(bytes) === record.sha256,
      `source/derived hash mismatch: ${name}`,
    );
    if (record.bytes !== undefined)
      check(
        bytes.length === record.bytes,
        `source/derived byte count mismatch: ${name}`,
      );
    checked.push({
      file: relative(PACKAGE, path),
      bytes: bytes.length,
      sha256: sha(bytes),
    });
  }
  const sourceFiles = checked.filter((r) =>
    r.file.startsWith('source/reference/'),
  );
  check(
    sourceFiles.some(
      (r) =>
        /Rocket.*\.blend$/.test(r.file) &&
        r.sha256 ===
          'b597855e6fe66d9aad451554f83686bfb742695e24161166395bd6ef4d8709c5',
    ) &&
      sourceFiles.some(
        (r) =>
          /Thrust.*\.blend$/.test(r.file) &&
          r.sha256 ===
            '6c00e2a64b316d6b59cf962eecb3fe0c1a06a4bc322a036e0a9d4a9e827cd784',
      ) &&
      sourceFiles.filter((r) => r.file.endsWith('.py')).length >= 4,
    'missing or changed accepted original Blender/source donors',
  );
  check(
    sourceFiles.some(
      (r) => r.file === data.source.hero && r.sha256 === data.source.heroSha256,
    ),
    'payload donor hash does not identify the accepted source',
  );
  const ports = manifest.source?.portAnchors;
  check(
    Array.isArray(ports) &&
      ports.length === 8 &&
      new Set(ports.map((p) => p.id)).size === 8,
    'missing authored nozzle anchors',
  );
  for (const port of ports) {
    check(
      finite(port.position) &&
        port.position.length === 3 &&
        finite(port.direction) &&
        port.direction.length === 3 &&
        Math.abs(norm(port.direction) - 1) < 1e-8 &&
        port.radius > 0 &&
        port.radius < 0.1,
      'invalid authored nozzle datum',
    );
    check(
      port.kind === 'rear'
        ? port.direction[2] === -1 && port.position[2] < -2
        : port.kind === 'lift' &&
            port.direction[1] === -1 &&
            port.position[1] > 0.09,
      'nozzle axis/position mismatch',
    );
  }
  check(
    ports.filter((p) => p.kind === 'rear').length === 4 &&
      ports.filter((p) => p.kind === 'lift').length === 4,
    'incorrect rear/lift nozzle split',
  );
  analysis.metrics.thrusters = ports;
  analysis.metrics.fans = data.rig.fans.map((id) => analysis.state.world(id));
  const derivedGLBParity = {};
  for (const lod of manifest.assets[0].lods)
    derivedGLBParity[lod.quality] = auditInspectionGLB(
      resolve(PACKAGE, lod.export),
      analysis.decoded[lod.quality],
      analysis.state,
    );
  return {
    schemaVersion: 1,
    passed: true,
    payload: {
      file: relative(ROOT, DATA),
      bytes: raw.length,
      sha256: sha(raw),
    },
    files: checked,
    derivedGLBParity,
    metrics: analysis.metrics,
    limitations: [
      'Representative artist dimensions; not Tesla engineering CAD.',
      'Doors remain closed in the driving envelope.',
      'Continuous analytic vertex extrema cover steering, wheel/fan rotation and linked wing pitch/lift; body triangles are exactly clipped at measured axle boundaries.',
      'Blender files are provenance-hashed, not deserialized by this CPU audit.',
    ],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = auditPackage(),
    i = process.argv.indexOf('--output'),
    out =
      i < 0
        ? join(PACKAGE, 'qa/geometry-audit.json')
        : resolve(process.argv[i + 1]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  writeFileSync(
    METRICS,
    JSON.stringify(
      { ...result.metrics, payloadSha256: result.payload.sha256 },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        report: out,
        metrics: METRICS,
        levels: Object.fromEntries(
          Object.entries(result.metrics.levels).map(([q, v]) => [
            q,
            { triangles: v.triangles, draws: v.maxDrawsWithYawAndJets },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

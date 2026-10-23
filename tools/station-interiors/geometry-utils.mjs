/** Structural edits for the source station packet (station-local Y-up metres).
 * Both utilities mutate and return the packet, after validating the full edit.
 * Apply island resizing before authoring the surrounding rooms and stair banks.
 */
const EPS = 1e-7;
const copy = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const near = (a, b) => Math.abs(a - b) <= EPS;
const bounds = (vertices) => ({
  minX: Math.min(...vertices.map((p) => p[0])),
  maxX: Math.max(...vertices.map((p) => p[0])),
  minZ: Math.min(...vertices.map((p) => p[2])),
  maxZ: Math.max(...vertices.map((p) => p[2])),
});
function floorFor(source, floorId) {
  const floor = source.floorSurfaces?.find((f) => f.surfaceId === floorId);
  if (!floor || !floor.verticesM?.length || !floor.indices?.length)
    throw new Error(`Missing source floor ${floorId}`);
  const y = floor.verticesM[0][1];
  if (
    floor.verticesM.some(
      (p) => p.length !== 3 || !p.every(finite) || !near(p[1], y),
    ) ||
    floor.indices.length % 3 ||
    floor.indices.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= floor.verticesM.length,
    )
  )
    throw new Error(`Floor ${floorId} must have valid horizontal triangles`);
  return floor;
}
function contains(floor, x, z) {
  for (let i = 0; i < floor.indices.length; i += 3) {
    const [a, b, c] = floor.indices
        .slice(i, i + 3)
        .map((index) => floor.verticesM[index]),
      denominator =
        (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < EPS) continue;
    const u =
        ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / denominator,
      v =
        ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / denominator;
    if (u >= -EPS && v >= -EPS && u + v <= 1 + EPS) return true;
  }
  return false;
}
function area(floor) {
  let total = 0;
  for (let i = 0; i < floor.indices.length; i += 3) {
    const [a, b, c] = floor.indices
      .slice(i, i + 3)
      .map((index) => floor.verticesM[index]);
    total +=
      Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) /
      2;
  }
  return total;
}
function axisAlignedBoundary(floor) {
  const edges = new Map();
  for (let i = 0; i < floor.indices.length; i += 3) {
    const triangle = floor.indices
      .slice(i, i + 3)
      .map((index) => floor.verticesM[index]);
    for (let j = 0; j < 3; j++) {
      const a = triangle[j],
        b = triangle[(j + 1) % 3],
        key = [a, b]
          .map((point) => `${point[0].toFixed(8)},${point[2].toFixed(8)}`)
          .sort()
          .join('|'),
        edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  }
  return [...edges.values()].every(
    ({ a, b, count }) => count !== 1 || near(a[0], b[0]) || near(a[2], b[2]),
  );
}
function subtract(rect, cut) {
  const minX = Math.max(rect.minX, cut.minX),
    maxX = Math.min(rect.maxX, cut.maxX),
    minZ = Math.max(rect.minZ, cut.minZ),
    maxZ = Math.min(rect.maxZ, cut.maxZ);
  if (maxX <= minX + EPS || maxZ <= minZ + EPS) return [rect];
  return [
    { ...rect, maxX: minX },
    { ...rect, minX: maxX },
    { minX, maxX, minZ: rect.minZ, maxZ: minZ },
    { minX, maxX, minZ: maxZ, maxZ: rect.maxZ },
  ].filter(
    (piece) => piece.maxX > piece.minX + EPS && piece.maxZ > piece.minZ + EPS,
  );
}
function slabBases(floor) {
  return [
    ...new Set(
      [floor.geometryNodeId, `floor-${floor.surfaceId}`].filter(Boolean),
    ),
  ];
}
function isSlab(part, floor) {
  return (
    part.role === 'floor' &&
    (part.floorSurfaceId === floor.surfaceId ||
      slabBases(floor).some(
        (id) => part.id === id || part.id.startsWith(`${id}-cut-`),
      ))
  );
}
function slabBounds(part) {
  let yaw = ((part.yawDegrees ?? 0) * Math.PI) / 180;
  if (part.rotationQuaternionXYZW) {
    const [x, y, z, w] = part.rotationQuaternionXYZW;
    if (Math.abs(x) > EPS || Math.abs(z) > EPS)
      throw new Error(`Floor slab ${part.id} must be horizontal`);
    yaw = 2 * Math.atan2(y, w);
  }
  if (!near(Math.sin(2 * yaw), 0))
    throw new Error(`Floor slab ${part.id} must be axis aligned`);
  const sx =
      Math.abs(Math.cos(yaw)) * part.sizeM[0] +
      Math.abs(Math.sin(yaw)) * part.sizeM[2],
    sz =
      Math.abs(Math.sin(yaw)) * part.sizeM[0] +
      Math.abs(Math.cos(yaw)) * part.sizeM[2];
  return {
    minX: part.centerM[0] - sx / 2,
    maxX: part.centerM[0] + sx / 2,
    minZ: part.centerM[2] - sz / 2,
    maxZ: part.centerM[2] + sz / 2,
  };
}
function slabPiece(part, rect, id = part.id) {
  const result = {
    ...copy(part),
    id,
    centerM: [
      (rect.minX + rect.maxX) / 2,
      part.centerM[1],
      (rect.minZ + rect.maxZ) / 2,
    ],
    sizeM: [rect.maxX - rect.minX, part.sizeM[1], rect.maxZ - rect.minZ],
    yawDegrees: 0,
  };
  delete result.rotationQuaternionXYZW;
  return result;
}
function commit(source, changed) {
  Object.assign(source, changed);
  return source;
}

/** Remove a real rectangular stairwell from both the walking triangles and the
 * corresponding visible slab. The surface ID and all station door vectors stay
 * unchanged. Repeated cuts preserve earlier holes and compact adjacent cells.
 */
export function carveFloorRect(source, floorId, cut) {
  if (
    !cut ||
    !['minX', 'maxX', 'minZ', 'maxZ'].every((key) => finite(cut[key])) ||
    cut.minX >= cut.maxX ||
    cut.minZ >= cut.maxZ
  )
    throw new Error('A floor cut needs finite increasing X/Z bounds');
  const changed = copy(source),
    floor = floorFor(changed, floorId),
    extent = bounds(floor.verticesM);
  if (!axisAlignedBoundary(floor))
    throw new Error(`Floor ${floorId} must have an axis-aligned boundary`);
  if (
    cut.maxX <= extent.minX ||
    cut.minX >= extent.maxX ||
    cut.maxZ <= extent.minZ ||
    cut.minZ >= extent.maxZ
  )
    return source;
  const slabs = changed.geometryParts.filter((part) => isSlab(part, floor));
  if (!slabs.length)
    throw new Error(`Floor ${floorId} has no associated visible slab`);
  const slabArea = slabs.reduce((total, part) => {
    const rect = slabBounds(part);
    return total + (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
  }, 0);
  if (Math.abs(slabArea - area(floor)) > Math.max(EPS, slabArea * 1e-7))
    throw new Error(
      `Floor ${floorId} walking footprint and visible slabs disagree`,
    );
  const unique = (values) =>
      [...new Set(values.map((v) => +v.toFixed(8)))].sort((a, b) => a - b),
    xs = unique([
      ...floor.verticesM.map((p) => p[0]),
      Math.max(extent.minX, cut.minX),
      Math.min(extent.maxX, cut.maxX),
    ]),
    zs = unique([
      ...floor.verticesM.map((p) => p[2]),
      Math.max(extent.minZ, cut.minZ),
      Math.min(extent.maxZ, cut.maxZ),
    ]);
  if (xs.length * zs.length > 4096)
    throw new Error(`Floor ${floorId} cut grid is too large`);
  const rectangles = [];
  let originalArea = 0,
    previous = new Map();
  for (let zi = 0; zi + 1 < zs.length; zi++) {
    const row = [];
    for (let xi = 0; xi + 1 < xs.length; xi++) {
      const x = (xs[xi] + xs[xi + 1]) / 2,
        z = (zs[zi] + zs[zi + 1]) / 2,
        supported = contains(floor, x, z);
      if (supported)
        originalArea += (xs[xi + 1] - xs[xi]) * (zs[zi + 1] - zs[zi]);
      row.push(
        supported &&
          !(x > cut.minX && x < cut.maxX && z > cut.minZ && z < cut.maxZ),
      );
    }
    const current = new Map();
    for (let xi = 0; xi < row.length; xi++) {
      if (!row[xi]) continue;
      const start = xi;
      while (xi + 1 < row.length && row[xi + 1]) xi++;
      const key = `${xs[start]},${xs[xi + 1]}`;
      let rectangle = previous.get(key);
      if (rectangle) rectangle.maxZ = zs[zi + 1];
      else {
        rectangle = {
          minX: xs[start],
          maxX: xs[xi + 1],
          minZ: zs[zi],
          maxZ: zs[zi + 1],
        };
        rectangles.push(rectangle);
      }
      current.set(key, rectangle);
    }
    previous = current;
  }
  if (Math.abs(originalArea - area(floor)) > Math.max(EPS, originalArea * 1e-7))
    throw new Error(
      `Floor ${floorId} must have a nonoverlapping axis-aligned footprint`,
    );
  if (!rectangles.length)
    throw new Error(`Cannot remove all of floor ${floorId}`);
  const vertices = [],
    indices = [],
    vertexIndices = new Map(),
    y = floor.verticesM[0][1];
  for (const rect of rectangles) {
    const corners = [
        [rect.minX, y, rect.minZ],
        [rect.minX, y, rect.maxZ],
        [rect.maxX, y, rect.maxZ],
        [rect.maxX, y, rect.minZ],
      ],
      ids = corners.map((point) => {
        const key = point.join(',');
        if (!vertexIndices.has(key)) {
          vertexIndices.set(key, vertices.length);
          vertices.push(point);
        }
        return vertexIndices.get(key);
      });
    indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
  }
  if (vertices.length > 100 || indices.length > 300)
    throw new Error(`Floor ${floorId} cut exceeds the runtime triangle budget`);
  floor.verticesM = vertices;
  floor.indices = indices;
  const replacements = new Map(),
    usedIds = new Set(changed.geometryParts.map((part) => part.id)),
    baseId = floor.geometryNodeId ?? `floor-${floorId}`;
  let suffix = 1;
  const nextId = () => {
    while (usedIds.has(`${baseId}-cut-${suffix}`)) suffix++;
    const id = `${baseId}-cut-${suffix++}`;
    usedIds.add(id);
    return id;
  };
  for (const part of slabs) {
    const pieces = subtract(slabBounds(part), cut);
    replacements.set(
      part.id,
      pieces.map((rect, index) =>
        slabPiece(part, rect, index ? nextId() : part.id),
      ),
    );
  }
  changed.geometryParts = changed.geometryParts.flatMap(
    (part) => replacements.get(part.id) ?? [part],
  );
  if (!changed.geometryParts.some((part) => part.id === baseId))
    changed.geometryParts.find((part) => isSlab(part, floor)).id = baseId;
  return commit(source, changed);
}

/** Widen an island and translate each track/door interface by half the change.
 * Train-relative vectors, carriage poses and sill gaps are preserved exactly.
 * Arbitrary surrounding rooms/columns are left for the station author to place.
 */
export function resizeIsland(source, floorId, newWidth) {
  if (!finite(newWidth) || newWidth < 2 || newWidth > 30)
    throw new Error('An island width must be between 2 and 30 metres');
  const changed = copy(source),
    floor = floorFor(changed, floorId),
    extent = bounds(floor.verticesM),
    platforms = changed.platforms.filter((p) => p.surfaceId === floorId);
  if (platforms.length !== 2)
    throw new Error(`Floor ${floorId} must have two opposing island tracks`);
  const axis = extent.maxX - extent.minX < extent.maxZ - extent.minZ ? 0 : 2,
    min = axis === 0 ? extent.minX : extent.minZ,
    max = axis === 0 ? extent.maxX : extent.maxZ,
    center = (min + max) / 2,
    oldWidth = max - min,
    halfChange = (newWidth - oldWidth) / 2;
  if (!platforms.every((p) => near(p.widthM, oldWidth)))
    throw new Error(
      `Floor ${floorId} width disagrees with its platform interfaces`,
    );
  for (const platform of platforms) {
    const [x, y, z, w] = platform.stopPosition.rotationQuaternionXYZW,
      tangent = [
        2 * (x * z + w * y),
        2 * (y * z - w * x),
        1 - 2 * (x * x + y * y),
      ];
    if (!near(tangent[axis], 0) || !near(tangent[1], 0))
      throw new Error(
        `Track ${platform.platformId} is not aligned with its island`,
      );
  }
  const signs = platforms.map((p) =>
    Math.sign(p.stopPosition.translationM[axis] - center),
  );
  if (!signs[0] || signs[0] === signs[1])
    throw new Error(`Floor ${floorId} is not a two-sided island`);
  if (near(halfChange, 0)) return source;
  if (!changed.geometryParts.some((part) => isSlab(part, floor)))
    throw new Error(`Floor ${floorId} has no associated visible slab`);
  const stretch = (value) =>
      near(value, min)
        ? value - halfChange
        : near(value, max)
          ? value + halfChange
          : value,
    shift = (point, amount) => {
      if (Array.isArray(point)) point[axis] += amount;
    };
  for (const vertex of floor.verticesM) vertex[axis] = stretch(vertex[axis]);
  changed.geometryParts = changed.geometryParts.map((part) => {
    if (!isSlab(part, floor)) return part;
    const rect = slabBounds(part);
    if (axis === 0) {
      rect.minX = stretch(rect.minX);
      rect.maxX = stretch(rect.maxX);
    } else {
      rect.minZ = stretch(rect.minZ);
      rect.maxZ = stretch(rect.maxZ);
    }
    if (rect.minX >= rect.maxX || rect.minZ >= rect.maxZ)
      throw new Error(`Resizing collapses a slab of ${floorId}`);
    return slabPiece(part, rect);
  });
  const doorShifts = new Map(),
    trackShifts = new Map();
  for (const [index, platform] of platforms.entries()) {
    const amount = signs[index] * halfChange;
    trackShifts.set(platform.platformId, amount);
    platform.widthM = newWidth;
    shift(platform.stopPosition.translationM, amount);
    for (const door of platform.doorAlignmentPoints) {
      doorShifts.set(door.id, amount);
      for (const key of [
        'stationSillPointM',
        'platformEdgePointM',
        'stationWaitingPointM',
      ])
        shift(door[key], amount);
    }
    for (const waiting of platform.waitingRegions ?? [])
      for (const point of waiting.polygonM) shift(point, amount);
    for (const exclusion of changed.trackExclusionVolumes ?? [])
      if (
        exclusion.id === platform.trackExclusionId ||
        exclusion.id.startsWith(platform.platformId + '-')
      )
        for (const point of exclusion.footprintM) shift(point, amount);
  }
  const amountFor = (id) => {
    if (doorShifts.has(id)) return doorShifts.get(id);
    return [...trackShifts].find(([track]) => id.includes(track))?.[1];
  };
  for (const part of changed.geometryParts) {
    const amount = amountFor(part.id);
    if (amount !== undefined) shift(part.centerM, amount);
  }
  for (const obstacle of changed.obstacles ?? []) {
    const amount = amountFor(obstacle.id);
    if (amount !== undefined) {
      shift(obstacle.centerM, amount);
      shift(obstacle.boundsM?.min, amount);
      shift(obstacle.boundsM?.max, amount);
    }
  }
  for (const anchor of changed.anchors ?? []) {
    const amount = amountFor(anchor.id);
    if (amount !== undefined) shift(anchor.pointM, amount);
  }
  for (const bridge of changed.thresholdBridges ?? []) {
    const amount = doorShifts.get(bridge.pairedDoorAlignmentId);
    if (amount === undefined) continue;
    shift(bridge.storedTransform?.translationM, amount);
    shift(bridge.deployedTransform?.translationM, amount);
    for (const point of bridge.deployedFloor?.verticesM ?? [])
      shift(point, amount);
    for (const pose of bridge.sequence ?? []) shift(pose.translationM, amount);
  }
  for (const instance of changed.instances ?? []) {
    const amount = amountFor(
      instance.instanceId ?? instance.id ?? instance.nodeId ?? '',
    );
    if (amount !== undefined) {
      shift(instance.translationM, amount);
      shift(instance.transform?.translationM, amount);
    }
  }
  return commit(source, changed);
}

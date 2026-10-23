// Frozen numerical reference from 28b3bb55, before invariant edge caching.
// Only used to prove exact preservation and measure the arithmetic optimization.
class GroundSurfaceBeforeEdgeCache {
  sample(x, z, anchorY) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(anchorY))
      return undefined;
    const cell = this.cells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`);
    if (!cell) return undefined;
    let highest;
    const vertices = this.vertices;
    for (const id of cell) {
      const inverse = this.inverseAreas[id];
      if (inverse === 0) continue;
      const t = id * 3,
        a = this.triangles[t] * 3,
        b = this.triangles[t + 1] * 3,
        c = this.triangles[t + 2] * 3;
      const ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2];
      const bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2];
      const cx = vertices[c],
        cy = vertices[c + 1],
        cz = vertices[c + 2];
      const dx = x - ax,
        dz = z - az;
      const u = (dx * (cz - az) - dz * (cx - ax)) * inverse;
      const v = ((bx - ax) * dz - (bz - az) * dx) * inverse;
      // Half a millimetre in world XZ resolves independently rounded Float32
      // path caps at shared source nodes. It never widens the height window.
      const eps = 0.0005 * Math.abs(inverse);
      if (
        u < -eps * Math.hypot(cx - ax, cz - az) ||
        v < -eps * Math.hypot(bx - ax, bz - az) ||
        u + v > 1 + eps * Math.hypot(cx - bx, cz - bz)
      )
        continue;
      const y = ay + u * (by - ay) + v * (cy - ay);
      if (
        Number.isFinite(y) &&
        Math.abs(y - anchorY) <= 4 &&
        (highest === undefined || y > highest)
      )
        highest = y;
    }
    return highest;
  }
  coversSegment(from, to, anchorY, maxHeightDeltaM = 4) {
    if (
      ![...from, ...to, anchorY, maxHeightDeltaM].every(Number.isFinite) ||
      maxHeightDeltaM < 0 ||
      maxHeightDeltaM > 4 ||
      Math.hypot(to[0] - from[0], to[1] - from[1]) > 16
    )
      return false;
    const x0 = Math.floor((Math.min(from[0], to[0]) - 0.0005) / 64),
      x1 = Math.floor((Math.max(from[0], to[0]) + 0.0005) / 64),
      z0 = Math.floor((Math.min(from[1], to[1]) - 0.0005) / 64),
      z1 = Math.floor((Math.max(from[1], to[1]) + 0.0005) / 64);
    if (
      ![x0, x1, z0, z1].every(Number.isSafeInteger) ||
      (x1 - x0 + 1) * (z1 - z0 + 1) > 16
    )
      return false;
    const ids = new Set();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (const id of this.cells.get(`${x},${z}`) || []) {
          ids.add(id);
          if (ids.size > 16_384) return false;
        }
    const intervals = [],
      vertices = this.vertices;
    const dx = to[0] - from[0],
      dz = to[1] - from[1];
    for (const id of ids) {
      // Retained curb faces participate in volume queries, never floor coverage.
      if (this.inverseAreas[id] === 0) continue;
      const ti = id * 3,
        a = this.triangles[ti] * 3,
        b = this.triangles[ti + 1] * 3,
        c = this.triangles[ti + 2] * 3;
      const ax = vertices[a],
        ay = vertices[a + 1],
        az = vertices[a + 2],
        bx = vertices[b],
        by = vertices[b + 1],
        bz = vertices[b + 2],
        cx = vertices[c],
        cy = vertices[c + 1],
        cz = vertices[c + 2];
      const inverse = this.inverseAreas[id],
        px = from[0] - ax,
        pz = from[1] - az;
      const u = (px * (cz - az) - pz * (cx - ax)) * inverse,
        v = ((bx - ax) * pz - (bz - az) * px) * inverse,
        du = (dx * (cz - az) - dz * (cx - ax)) * inverse,
        dv = ((bx - ax) * dz - (bz - az) * dx) * inverse;
      const eps = 0.0005 * Math.abs(inverse),
        height = ay + u * (by - ay) + v * (cy - ay),
        heightDelta = du * (by - ay) + dv * (cy - ay);
      let low = 0,
        high = 1;
      const clip = (value, slope) => {
        if (!Number.isFinite(value) || !Number.isFinite(slope)) return false;
        if (Math.abs(slope) < 1e-14) return value >= -1e-12;
        const t = -value / slope;
        if (slope > 0) low = Math.max(low, t);
        else high = Math.min(high, t);
        return low <= high + 1e-12;
      };
      if (
        clip(u + eps * Math.hypot(cx - ax, cz - az), du) &&
        clip(v + eps * Math.hypot(bx - ax, bz - az), dv) &&
        clip(1 - u - v + eps * Math.hypot(cx - bx, cz - bz), -du - dv) &&
        clip(height - anchorY + maxHeightDeltaM, heightDelta) &&
        clip(anchorY + maxHeightDeltaM - height, -heightDelta)
      )
        intervals.push([Math.max(0, low), Math.min(1, high)]);
    }
    intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let covered = 0;
    for (const [low, high] of intervals) {
      if (low > covered + 1e-8) return false;
      covered = Math.max(covered, high);
      if (covered >= 1 - 1e-8) return true;
    }
    return false;
  }
}
export const sampleBeforeEdgeCache =
  GroundSurfaceBeforeEdgeCache.prototype.sample;
export const coversSegmentBeforeEdgeCache =
  GroundSurfaceBeforeEdgeCache.prototype.coversSegment;

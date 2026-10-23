/** Author station circulation as connected passenger surfaces, not decorative stairs.
 * Coordinates are station-local Y-up metres. Topology is reference-backed; extents
 * remain representative until a measured interior survey is available. */
import * as THREE from 'three';

export class InteriorBuilder {
  constructor(source, revision, references) {
    this.s = structuredClone(source);
    this.s.floorSurfaces = [];
    this.s.connections = [];
    this.s.entrances = [];
    this.s.geometryParts = [];
    this.s.obstacles = [];
    this.s.levels = [];
    this.s.anchors = this.s.anchors.filter((a) =>
      ['vehicle-root-stop', 'platform-door'].includes(a.kind),
    );
    this.s.transferRoutes = [];
    this.s.interiorSigns = [];
    this.s.authoredInterior = {
      revision,
      references,
      dimensions: 'representative',
      accuracy:
        'Reference-backed passenger topology and visible architecture; dimensions and placement are not a survey.',
    };
    this.s.provenance.dimensionStatus = this.s.authoredInterior.accuracy;
    this.s.provenance.depthStatus =
      'Representative local street offsets; not surveyed elevations';
  }
  box(
    id,
    center,
    size,
    material = 'wall',
    role = 'wall',
    yaw = 0,
    collision = false,
    quaternion,
  ) {
    const part = {
      id,
      centerM: [...center],
      sizeM: [...size],
      yawDegrees: yaw,
      material,
      role,
    };
    if (quaternion) part.rotationQuaternionXYZW = [...quaternion];
    this.s.geometryParts.push(part);
    if (collision)
      this.s.obstacles.push({
        id,
        centerM: [...center],
        sizeM: [...size],
        yawDegrees: yaw,
        type: 'oriented-box',
      });
    return id;
  }
  beam(id, a, b, width, height, material = 'steel', role = 'detail') {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      d = bv.clone().sub(av);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        -Math.atan2(d.y, Math.hypot(d.x, d.z)),
        Math.atan2(d.x, d.z),
        0,
        'YXZ',
      ),
    );
    return this.box(
      id,
      av.add(bv).multiplyScalar(0.5).toArray(),
      [width, height, d.length()],
      material,
      role,
      0,
      false,
      q.toArray(),
    );
  }
  floor(
    id,
    center,
    width,
    length,
    kind = 'walk',
    level = id,
    material = 'floor',
    yaw = 0,
  ) {
    const [x, y, z] = center,
      angle = (yaw * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const verticesM = [
      [-width / 2, -length / 2],
      [-width / 2, length / 2],
      [width / 2, length / 2],
      [width / 2, -length / 2],
    ].map(([xx, zz]) => [x + xx * c + zz * s, y, z - xx * s + zz * c]);
    this.s.floorSurfaces.push({
      surfaceId: id,
      frameId: this.s.stationId,
      levelId: level,
      verticesM,
      indices: [0, 1, 2, 0, 2, 3],
      walkable: true,
      kind,
      geometryNodeId: 'floor-' + id,
      headClearanceM: 2.8,
    });
    if (!this.s.levels.some((l) => l.levelId === level))
      this.s.levels.push({
        levelId: level,
        label: level,
        floorHeightM: y,
        heightBasis: 'representative local offset',
      });
    this.box(
      'floor-' + id,
      [x, y - 0.15, z],
      [width, 0.3, length],
      material,
      'floor',
      yaw,
    );
    return id;
  }
  /** Copy the exact existing train-facing surface and original door alignment. */
  platform(id, { columns = true, roof = true, material = 'floor' } = {}) {
    const f = this.originalFloor(id);
    this.s.floorSurfaces.push(f);
    if (!this.s.levels.some((l) => l.levelId === f.levelId)) {
      const level = this.base.levels.find((l) => l.levelId === f.levelId);
      if (level) this.s.levels.push(structuredClone(level));
    }
    const b = new THREE.Box3().setFromPoints(
        f.verticesM.map((v) => new THREE.Vector3(...v)),
      ),
      c = b.getCenter(new THREE.Vector3()),
      size = b.getSize(new THREE.Vector3());
    const slabs = this.base.geometryParts.filter(
      (p) =>
        p.role === 'floor' &&
        (p.id === 'floor-' + id ||
          p.id.startsWith('floor-' + id + '-cut-') ||
          p.floorSurfaceId === id),
    );
    if (slabs.length) this.s.geometryParts.push(...structuredClone(slabs));
    else
      this.box(
        'floor-' + id,
        [c.x, c.y - 0.15, c.z],
        [size.x, 0.3, size.z],
        material,
        'floor',
      );
    if (roof)
      this.box(
        id + '-ceiling',
        [c.x, c.y + 3.6, c.z],
        size.x > size.z
          ? [size.x + 1.2, 0.18, size.z + 8.4]
          : [size.x + 8.4, 0.18, size.z + 1.2],
        'cream',
        'ceiling',
      );
    if (columns) {
      const alongX = size.x > size.z,
        len = Math.max(size.x, size.z);
      for (let d = -len / 2 + 8, i = 0; d < len / 2 - 5; d += 12, i++) {
        const x = c.x + (alongX ? d : 0),
          z = c.z + (alongX ? 0 : d);
        this.box(
          id + '-column-' + i,
          [x, c.y + 1.65, z],
          [0.48, 3.3, 0.48],
          'cream',
          'column',
          0,
          true,
        );
      }
    }
    return id;
  }
  originalFloor(id) {
    const f = this.base.floorSurfaces.find((f) => f.surfaceId === id);
    if (!f) throw new Error('Missing original floor ' + id);
    return structuredClone(f);
  }
  walk(id, from, to, point, end = point, width = 2.4) {
    this.s.connections.push({
      connectionId: id,
      fromSurfaceId: from,
      toSurfaceId: to,
      type: 'walk',
      frameId: this.s.stationId,
      startPointM: [...point],
      endPointM: [...end],
      clearWidthM: width,
      bidirectional: true,
      runtimeEnabled: true,
    });
  }
  entrance(id, label, surfaceId, point) {
    this.s.entrances.push({
      entranceId: id,
      label,
      surfaceId,
      pointM: [...point],
      frameId: this.s.stationId,
      entranceAndExit: true,
      streetAttachmentStatus:
        'local datum; geographic placement representative',
    });
  }
  sign(
    text,
    position,
    yaw = 0,
    width = 4,
    height = 0.42,
    background = '#152c3b',
  ) {
    this.s.interiorSigns.push({
      text,
      position: [...position],
      yaw,
      width,
      height,
      background,
    });
  }
  /** Seat and solid base share the passenger inventory's real floor datum. */
  bench(id, center, length = 2.4, yaw = 0, { material = 'red' } = {}) {
    const [x, y, z] = center,
      a = (yaw * Math.PI) / 180;
    const at = (xx, yy, zz) => [
      x + xx * Math.cos(a) + zz * Math.sin(a),
      y + yy,
      z - xx * Math.sin(a) + zz * Math.cos(a),
    ];
    this.box(
      id + '-bench-seat',
      at(0, 0.46, 0),
      [length, 0.12, 0.55],
      material,
      'static',
      yaw,
    );
    this.box(
      id + '-bench-body',
      at(0, 0.22, 0),
      [length, 0.44, 0.5],
      'steel',
      'bench-body',
      yaw,
      true,
    );
    this.box(
      id + '-bench-back',
      at(0, 0.76, -0.24),
      [length, 0.55, 0.06],
      material,
      'bench-back',
      yaw,
      true,
    );
  }
  /** Flat room enclosure. Door intervals are measured along each wall's axis. */
  room(
    id,
    center,
    width,
    length,
    { height = 3.2, material = 'wall', roof = true, doors = {} } = {},
  ) {
    const [x, y, z] = center;
    if (roof)
      this.box(
        id + '-ceiling',
        [x, y + height, z],
        [width + 0.36, 0.18, length + 0.36],
        material,
        'ceiling',
      );
    for (const [side, axis, sign, span] of [
      ['west', 'x', -1, length],
      ['east', 'x', 1, length],
      ['north', 'z', -1, width],
      ['south', 'z', 1, width],
    ]) {
      const cuts = (doors[side] ?? [])
        .map(([a, b]) => [Math.max(-span / 2, a), Math.min(span / 2, b)])
        .sort((a, b) => a[0] - b[0]);
      let from = -span / 2,
        i = 0;
      for (const [a, b] of [...cuts, [span / 2, span / 2]]) {
        if (a > from + 0.01) {
          const mid = (from + a) / 2,
            size = a - from;
          this.box(
            `${id}-${side}-${i++}`,
            axis === 'x'
              ? [x + sign * (width / 2 + 0.1), y + height / 2, z + mid]
              : [x + mid, y + height / 2, z + sign * (length / 2 + 0.1)],
            axis === 'x' ? [0.2, height, size] : [size, height, 0.2],
            material,
            'wall',
            0,
            true,
          );
        }
        if (b > a)
          this.box(
            `${id}-${side}-lintel-${i}`,
            axis === 'x'
              ? [
                  x + sign * (width / 2 + 0.1),
                  y + height - 0.2,
                  z + (a + b) / 2,
                ]
              : [
                  x + (a + b) / 2,
                  y + height - 0.2,
                  z + sign * (length / 2 + 0.1),
                ],
            axis === 'x' ? [0.2, 0.4, b - a] : [b - a, 0.4, 0.2],
            material,
            'wall',
          );
        from = Math.max(from, b);
      }
    }
  }
  shaft(
    id,
    start,
    end,
    width,
    { material = 'wall', height = 3.2, roof = true } = {},
  ) {
    const a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end),
      d = b.clone().sub(a),
      run = Math.hypot(d.x, d.z),
      lateral = new THREE.Vector3(d.z, 0, -d.x).normalize(),
      yaw = (Math.atan2(d.x, d.z) * 180) / Math.PI;
    for (const side of [-1, 1]) {
      const c = a
        .clone()
        .add(b)
        .multiplyScalar(0.5)
        .addScaledVector(lateral, side * (width / 2 + 0.1));
      c.y = (Math.min(a.y, b.y) + Math.max(a.y, b.y) + height) / 2;
      this.box(
        `${id}-shaft-wall-${side}`,
        c.toArray(),
        [0.2, Math.abs(d.y) + height, run + 0.12],
        material,
        'wall',
        yaw,
        true,
      );
      this.beam(
        `${id}-wall-handrail-${side}`,
        a
          .clone()
          .addScaledVector(lateral, side * (width / 2 - 0.09))
          .add(new THREE.Vector3(0, 0.93, 0))
          .toArray(),
        b
          .clone()
          .addScaledVector(lateral, side * (width / 2 - 0.09))
          .add(new THREE.Vector3(0, 0.93, 0))
          .toArray(),
        0.055,
        0.065,
        'steel',
        'handrail',
      );
    }
    if (roof)
      this.beam(
        id + '-soffit',
        a
          .clone()
          .add(new THREE.Vector3(0, height, 0))
          .toArray(),
        b
          .clone()
          .add(new THREE.Vector3(0, height, 0))
          .toArray(),
        width + 0.4,
        0.18,
        material,
        'soffit',
      );
    this.beam(
      id + '-underslab',
      a
        .clone()
        .add(new THREE.Vector3(0, -0.2, 0))
        .toArray(),
      b
        .clone()
        .add(new THREE.Vector3(0, -0.2, 0))
        .toArray(),
      width + 0.4,
      0.2,
      'concrete',
      'floor',
    );
    this.beam(
      id + '-striplight',
      a
        .clone()
        .add(new THREE.Vector3(0, height - 0.12, 0))
        .toArray(),
      b
        .clone()
        .add(new THREE.Vector3(0, height - 0.12, 0))
        .toArray(),
      0.12,
      0.04,
      'light',
      'ceiling',
    );
  }
  flight(
    id,
    from,
    to,
    start,
    end,
    width = 2.4,
    {
      kind = 'stairs',
      enclosed = true,
      material = 'wall',
      handrails = true,
    } = {},
  ) {
    const a = new THREE.Vector3(...start),
      b = new THREE.Vector3(...end),
      delta = b.clone().sub(a),
      run = Math.hypot(delta.x, delta.z),
      count = Math.max(1, Math.ceil(Math.abs(delta.y) / 0.167)),
      tangent = new THREE.Vector3(delta.x, 0, delta.z).normalize(),
      lateral = new THREE.Vector3(tangent.z, 0, -tangent.x),
      yaw = (Math.atan2(delta.x, delta.z) * 180) / Math.PI;
    const treads = [];
    for (let i = 0; i < count; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / count),
        y = a.y + delta.y * (delta.y > 0 ? (i + 1) / count : i / count),
        halfRun = run / count / 2;
      const vs = [
        [-1, -1],
        [-1, 1],
        [1, 1],
        [1, -1],
      ].map(([sx, sz]) =>
        p
          .clone()
          .addScaledVector(lateral, (sx * width) / 2)
          .addScaledVector(tangent, sz * halfRun)
          .setY(y)
          .toArray(),
      );
      const pid = `${id}-tread-${i}`;
      treads.push({
        partId: pid,
        frameId: this.s.stationId,
        verticesM: vs,
        indices: [0, 1, 2, 0, 2, 3],
      });
      this.box(
        pid,
        [p.x, y - 0.09, p.z],
        [width, 0.18, run / count + 0.002],
        kind === 'escalator' ? 'escalator' : 'concrete',
        kind === 'escalator' ? 'escalator-tread' : 'stair-tread',
        yaw,
      );
      if (kind === 'escalator')
        this.box(
          `${id}-nosing-${i}`,
          [p.x, y + 0.003, p.z],
          [width, 0.01, 0.025],
          'yellow',
          'detail',
          yaw,
        );
    }
    this.s.connections.push({
      connectionId: id,
      fromSurfaceId: from,
      toSurfaceId: to,
      type: kind,
      frameId: this.s.stationId,
      startPointM: [...start],
      endPointM: [...end],
      clearWidthM: width,
      bidirectional: true,
      runtimeEnabled: true,
      treadSurfaces: treads,
      riserCount: count,
      riseM: Math.abs(delta.y) / count,
      treadRunM: run / count,
    });
    if (enclosed) this.shaft(id, start, end, width, { material });
    if (handrails)
      for (const side of [-1, 1]) {
        const offset = side * (width / 2 - 0.07),
          av = a.clone().addScaledVector(lateral, offset),
          bv = b.clone().addScaledVector(lateral, offset);
        this.beam(
          `${id}-handrail-${side}`,
          av
            .clone()
            .add(new THREE.Vector3(0, 0.98, 0))
            .toArray(),
          bv
            .clone()
            .add(new THREE.Vector3(0, 0.98, 0))
            .toArray(),
          0.07,
          0.085,
          kind === 'escalator' ? 'black' : 'steel',
          'handrail',
        );
        if (kind === 'escalator')
          this.beam(
            `${id}-balustrade-${side}`,
            av
              .clone()
              .add(new THREE.Vector3(0, 0.49, 0))
              .toArray(),
            bv
              .clone()
              .add(new THREE.Vector3(0, 0.49, 0))
              .toArray(),
            0.035,
            0.86,
            'glass',
            'balustrade',
          );
      }
    return id;
  }
  elevator(id, from, to, start, end) {
    this.s.connections.push({
      connectionId: id,
      fromSurfaceId: from,
      toSurfaceId: to,
      type: 'elevator',
      frameId: this.s.stationId,
      startPointM: [...start],
      endPointM: [...end],
      clearWidthM: 1.5,
      clearCabinSizeM: [1.8, 2.4, 1.8],
      bidirectional: true,
      runtimeEnabled: true,
    });
    const mid = start.map((v, i) => (v + end[i]) / 2),
      h = Math.abs(end[1] - start[1]) + 2.5;
    for (const dx of [-0.95, 0.95])
      this.box(
        id + '-jamb-' + dx,
        [mid[0] + dx, mid[1] + 1.2, mid[2]],
        [0.12, h, 1.9],
        'steel',
        'lift-shaft',
      );
    for (const p of [start, end])
      this.sign('Elevator  ↕', [p[0], p[1] + 2.1, p[2]], 0, 1.7, 0.3);
  }
  /** Preserve track, rail and tactile geometry while replacing old corridors. */
  tracks() {
    for (const p of this.base.geometryParts)
      if (['rail', 'trackbed'].includes(p.role) || p.id.startsWith('tactile-'))
        this.s.geometryParts.push(structuredClone(p));
  }
  finish() {
    return this.s;
  }
}

export function interior(source, revision, references = []) {
  const b = new InteriorBuilder(source, revision, references);
  b.base = structuredClone(source);
  return b;
}

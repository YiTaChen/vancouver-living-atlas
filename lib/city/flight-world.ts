import * as THREE from 'three';
import type { CityEngine } from './engine';
import { inPolygon, project } from './geo';
import type { AircraftKind, FlightSurface, FlightState } from './flight-state';
import {
  collisionTriangles,
  hitTriangles,
  isClosedCollisionMesh,
} from './flight-collision';
import { AIRFRAME_PROBES, AIRFRAME_RADIUS } from './flight-geometry';
type Volume = {
  bounds: THREE.Box3;
  local?: THREE.Box3;
  inverse?: THREE.Matrix4;
  polygon?: number[][][];
  mesh?: THREE.Mesh;
  triangles?: Float32Array;
  closed?: boolean;
};
const northwest = project([-123.225, 49.334]),
  southeast = project([-123.089, 49.26]);
export class FlightWorld {
  cells = new Map<string, Volume[]>();
  constructor(private e: CityEngine) {
    for (const v of e.data.flightBuildingVolumes || []) {
      const xs = v.polygon[0].map((p: number[]) => p[0]),
        zs = v.polygon[0].map((p: number[]) => p[1]);
      this.add({
        polygon: v.polygon,
        bounds: new THREE.Box3(
          new THREE.Vector3(Math.min(...xs), v.minY, Math.min(...zs)),
          new THREE.Vector3(Math.max(...xs), v.maxY, Math.max(...zs)),
        ),
      });
    }
    for (const v of e.data.flightBridgeVolumes || []) {
      const matrix = new THREE.Matrix4().fromArray(v.matrix),
        local = new THREE.Box3(
          new THREE.Vector3(...(v.min as [number, number, number])),
          new THREE.Vector3(...(v.max as [number, number, number])),
        );
      this.add({
        local,
        inverse: matrix.clone().invert(),
        bounds: local.clone().applyMatrix4(matrix),
      });
    }
    // Stable medium landmark geometry, independent of optional Ultra streaming.
    for (const detail of e.landmarkDetails) {
      detail.holder.updateWorldMatrix(true, true);
      detail.medium.traverse((o: THREE.Object3D) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.computeBoundingBox();
        if (!o.geometry.boundingBox) return;
        // Keep triangle raycasts for these few nearby landmarks: aggregate bounds
        // are broad phase only and do not turn courtyards into solid blocks.
        this.add({
          mesh: o,
          bounds: o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld),
        });
      });
    }
  }
  add(v: Volume) {
    for (
      let x = Math.floor(v.bounds.min.x / 80);
      x <= Math.floor(v.bounds.max.x / 80);
      x++
    )
      for (
        let z = Math.floor(v.bounds.min.z / 80);
        z <= Math.floor(v.bounds.max.z / 80);
        z++
      ) {
        const key = x + ',' + z;
        const cell = this.cells.get(key) || [];
        cell.push(v);
        this.cells.set(key, cell);
      }
  }
  supported(x: number, z: number, margin = 0) {
    return (
      x >= northwest[0] + margin &&
      x <= southeast[0] - margin &&
      z >= northwest[1] + margin &&
      z <= southeast[1] - margin
    );
  }
  surface = (x: number, z: number): FlightSurface => {
    const water = this.e.waterWorld?.at(x, z);
    if (water) return { kind: 'water', height: water.level };
    const b = this.e.beachGround?.surface.sample(
      x,
      z,
      this.e.rawElevation(x, z),
    );
    const terrain = this.e.elevation(x, z);
    const road = this.e.data.roadSurface?.sample(x, z, terrain + 1.05);
    return {
      kind: b?.isLand && b.sandWeight > 0.15 ? 'beach' : 'land',
      height: road ?? terrain,
    };
  };
  /** Segment sweep subdivided to <=0.7m, with nearby prisms/OBBs only. */
  hit(a: THREE.Vector3, b: THREE.Vector3, radius = 1.1) {
    const sweep = new THREE.Box3().setFromPoints([a, b]).expandByScalar(radius),
      seen = new Set<Volume>();
    for (
      let x = Math.floor(sweep.min.x / 80);
      x <= Math.floor(sweep.max.x / 80);
      x++
    )
      for (
        let z = Math.floor(sweep.min.z / 80);
        z <= Math.floor(sweep.max.z / 80);
        z++
      )
        for (const v of this.cells.get(x + ',' + z) || []) seen.add(v);
    for (const v of seen) {
      if (!v.bounds.intersectsBox(sweep)) continue;
      if (v.mesh) {
        if (!v.triangles) {
          v.triangles = collisionTriangles(v.mesh);
          v.closed = isClosedCollisionMesh(v.triangles);
        }
        if (hitTriangles(v.triangles, a, b, radius, v.closed)) return true;
      } else if (v.inverse && v.local) {
        const aa = a.clone().applyMatrix4(v.inverse),
          bb = b.clone().applyMatrix4(v.inverse),
          box = v.local.clone().expandByScalar(radius),
          delta = bb.clone().sub(aa),
          length = delta.length();
        if (box.containsPoint(aa) || box.containsPoint(bb)) return true;
        const hit = new THREE.Ray(aa, delta.normalize()).intersectBox(
          box,
          new THREE.Vector3(),
        );
        if (hit && hit.distanceTo(aa) <= length) return true;
      } else if (v.polygon) {
        const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.7));
        for (let i = 0; i <= steps; i++) {
          const p = a.clone().lerp(b, i / steps);
          if (p.y + radius < v.bounds.min.y || p.y - radius > v.bounds.max.y)
            continue;
          for (const [dx, dz] of [
            [0, 0],
            [radius, 0],
            [-radius, 0],
            [0, radius],
            [0, -radius],
          ])
            if (inPolygon([p.x + dx, p.z + dz], v.polygon)) return true;
        }
      }
    }
    return false;
  }
  climbHeading(s: FlightState) {
    let best = s.yaw,
      bestScore = -Infinity;
    for (let i = 0; i < 24; i++) {
      const yaw = s.yaw + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 12;
      let clearance = 0;
      let previous = new THREE.Vector3(s.x, s.y + 3, s.z);
      for (let d = 30; d <= 1800; d += 30) {
        const x = s.x + Math.sin(yaw) * d,
          z = s.z - Math.cos(yaw) * d;
        if (!this.supported(x, z)) break;
        const y = Math.min(
            413,
            s.y +
              3 +
              Math.max(0, d - (s.phase === 'grounded' ? 240 : 0)) * 0.21,
          ),
          p = new THREE.Vector3(x, y, z);
        if (
          (s.phase === 'grounded' &&
            d < 300 &&
            this.surface(x, z).kind !== 'water') ||
          y < this.surface(x, z).height + 3 ||
          this.hit(previous, p, 8)
        )
          break;
        clearance = d;
        previous = p;
      }
      const score = clearance - i * 2;
      if (score > bestScore) {
        bestScore = score;
        best = yaw;
      }
    }
    return best;
  }
  clearAirframe(
    kind: AircraftKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -yaw,
    );
    return AIRFRAME_PROBES[kind].every((offset) => {
      const p = new THREE.Vector3(...offset)
        .applyQuaternion(q)
        .add(new THREE.Vector3(x, y, z));
      return !this.hit(p, p, AIRFRAME_RADIUS);
    });
  }
  launch(
    x: number,
    z: number,
  ): {
    kind: AircraftKind;
    x: number;
    y: number;
    z: number;
    yaw: number;
  } | null {
    if (!this.supported(x, z)) return null;
    const water = this.e.waterWorld?.at(x, z);
    if (water) {
      if (!this.e.waterWorld!.canOccupy(x, z, 0, water.id, 8, 7.5)) return null;
      const p = new THREE.Vector3(x, water.level + 3, z);
      if (this.hit(p, p, 7.5)) return null;
      // Select a clear initial water run, with the longest safe corridor winning.
      let yaw = 0,
        best = 0;
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        let length = 0;
        for (let d = 30; d <= 650; d += 30) {
          const xx = x + Math.sin(a) * d,
            zz = z - Math.cos(a) * d;
          if (
            this.e.waterWorld!.at(xx, zz)?.id !== water.id ||
            this.hit(
              new THREE.Vector3(xx, water.level + 3, zz),
              new THREE.Vector3(xx, water.level + 3, zz),
              7.5,
            )
          )
            break;
          length = d;
        }
        if (length > best) {
          best = length;
          yaw = a;
        }
      }
      if (best < 300 || !this.clearAirframe('seaplane', x, water.level, z, yaw))
        return null;
      return { kind: 'seaplane', x, y: water.level, z, yaw };
    }
    let best: { d: number; x: number; z: number; yaw: number } | null = null;
    for (const edge of this.e.placement!.world.roads) {
      const dx = edge.b[0] - edge.a[0],
        dz = edge.b[1] - edge.a[1],
        den = dx * dx + dz * dz;
      if (!den) continue;
      const t = THREE.MathUtils.clamp(
          ((x - edge.a[0]) * dx + (z - edge.a[1]) * dz) / den,
          0,
          1,
        ),
        px = edge.a[0] + t * dx,
        pz = edge.a[1] + t * dz,
        d = Math.hypot(x - px, z - pz);
      if (d < 18 && (!best || d < best.d))
        best = { d, x: px, z: pz, yaw: Math.atan2(dx, -dz) };
    }
    if (!best) return null;
    const h = this.surface(best.x, best.z);
    if (h.kind === 'water') return null;
    const p = new THREE.Vector3(best.x, h.height + 3, best.z);
    if (this.hit(p, p, 5.5)) return null;
    if (!this.clearAirframe('helicopter', best.x, h.height, best.z, best.yaw))
      return null;
    return {
      kind: 'helicopter',
      x: best.x,
      y: h.height,
      z: best.z,
      yaw: best.yaw,
    };
  }
}

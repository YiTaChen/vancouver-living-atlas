import * as THREE from 'three';
import { project } from './geo';
import type { RuntimeStationData, StationPart } from './skytrain-stations';
import type { LineId, SkyTrainDirection, StationId } from './skytrain-network';

export interface StationRailEnvelope {
  stationId: StationId;
  supportPartIds: readonly string[];
  /** Null means no rendered station rail structure supports this exact point.
   * Infinity is a supported open-air track; finite values are actual roof gaps. */
  roofClearance(rail: THREE.Vector3, roof: THREE.Vector3): number | null;
}

/** Derive a bounded rail envelope from the exact boxes used by the authored
 * renderer. A nearby concourse, spare track or raised DEM cannot authorize it. */
export function stationRailEnvelope(
  data: RuntimeStationData,
  line: LineId,
  direction: SkyTrainDirection,
  heightAt: (x: number, z: number) => number,
): StationRailEnvelope | null {
  if (!data.authoredInterior) return null;
  const platform = data.platforms.find(
    (p) => p.line === line && p.direction === direction,
  );
  if (!platform) return null;
  const [x, z] = project(data.lonlat),
    station = new THREE.Matrix4().compose(
      new THREE.Vector3(x, heightAt(x, z), z),
      new THREE.Quaternion(...data.quaternion),
      new THREE.Vector3(1, 1, 1),
    ),
    unit = new THREE.Box3(
      new THREE.Vector3(-0.5, -0.5, -0.5),
      new THREE.Vector3(0.5, 0.5, 0.5),
    ),
    world = new THREE.Vector3(),
    localRay = new THREE.Ray(),
    box = (part: StationPart) => {
      const q = part.quaternion
          ? new THREE.Quaternion(...part.quaternion)
          : new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              (part.yaw * Math.PI) / 180,
            ),
        matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(...part.position),
          q,
          new THREE.Vector3(...part.size),
        );
      matrix.premultiply(station);
      return {
        part,
        matrix,
        inverse: matrix.clone().invert(),
        bounds: unit.clone().applyMatrix4(matrix),
      };
    },
    supports = data.parts
      .filter(
        (p) =>
          p.id === `trackbed-${platform.id}` ||
          (p.id.startsWith(`${platform.id}-portal-base-`) &&
            p.role === 'floor' &&
            p.material === 'ballast') ||
          (p.id.startsWith(`${platform.id}-approach-trackbed-`) &&
            p.role === 'trackbed' &&
            p.material === 'concrete'),
      )
      .map(box),
    roofs = data.parts
      .filter(
        (p) =>
          // A concourse slab above the track is just as solid as a part named
          // ceiling. It can restrict clearance, but cannot authorize rail
          // support: only the selected platform's real trackbed does that.
          /(?:roof|ceiling|soffit|^floor$)/i.test(p.role) &&
          p.material !== 'light',
      )
      .map(box),
    height = (
      b: ReturnType<typeof box>,
      point: THREE.Vector3,
      above: boolean,
    ) => {
      if (
        point.x < b.bounds.min.x ||
        point.x > b.bounds.max.x ||
        point.z < b.bounds.min.z ||
        point.z > b.bounds.max.z
      )
        return null;
      localRay.origin.set(point.x, point.y + (above ? 1000 : -1000), point.z);
      localRay.direction.set(0, above ? -1 : 1, 0);
      localRay.applyMatrix4(b.inverse);
      const hit = localRay.intersectBox(unit, world);
      return hit ? hit.applyMatrix4(b.matrix).y : null;
    };
  if (!supports.length) return null;
  return {
    stationId: data.id,
    supportPartIds: supports.map((b) => b.part.id),
    roofClearance(rail, roof) {
      const supported = supports.some((b) => {
        const top = height(b, rail, true);
        return top !== null && rail.y - top >= -0.2 && rail.y - top <= 0.9;
      });
      if (!supported) return null;
      let clearance = Infinity;
      for (const b of roofs) {
        if (b.bounds.max.y <= rail.y + 1.2) continue;
        const underside = height(b, roof, false);
        if (underside !== null)
          clearance = Math.min(clearance, underside - roof.y);
      }
      return clearance;
    },
  };
}

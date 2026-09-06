/** Opt-in diagnostics: replays source polylines THROUGH the real navigation
 * movement/collision method. This is a geometry audit, not a driving demo. */
import type { CityEngine } from './engine';
import type { SurfaceSegment } from './causeway-profile';
import type { TravelSurfaceIndex } from './travel-surfaces';
import { project, lines } from './geo';

export async function auditCausewayTravel(e: CityEngine) {
  const nav = e.navigation!,
    index = e.data.travelSurfaces as TravelSurfaceIndex;
  const groups = new Map<string, SurfaceSegment[]>();
  for (const s of [
    ...e.data.causeway.segments,
    ...e.data.causeway.main.segments,
  ] as SurfaceSegment[]) {
    const group = groups.get(s.routeId) || [];
    group.push(s);
    groups.set(s.routeId, group);
  }
  const results: Record<string, unknown>[] = [];
  e.applySettings({ ...e.settings, mode: 'drive', autoRotate: false });
  e.setClock({ hour: 14, running: false });
  for (const [route, segments] of groups)
    for (const reversed of [false, true]) {
      const points = [segments[0].a, ...segments.map((s) => s.b)];
      if (reversed) points.reverse();
      const start = points[0],
        hit = index
          .lookup(...start)
          .find((h) => h.allowedModes.includes('drive'));
      if (!hit) {
        results.push({
          route,
          reversed,
          valid: false,
          error: 'No drive surface at source start',
        });
        continue;
      }
      nav.startAt('drive', {
        x: start[0],
        z: start[1],
        y: hit.y,
        yaw: 0,
        surface: 'bridge',
        surfaceId: hit.surfaceId,
        layer: hit.layer,
        name: route,
        snappedDistance: 0,
      });
      let travelled = 0,
        failedAt: number | undefined,
        maxPositionError = 0,
        maxYError = 0;
      for (let i = 1; i < points.length; i++) {
        const p = points[i],
          dx = p[0] - nav.position.x,
          dz = p[1] - nav.position.z;
        const before = nav.position.clone();
        nav.yaw = Math.atan2(dx, dz);
        nav.move(dx, dz);
        travelled += Math.hypot(
          nav.position.x - before.x,
          nav.position.z - before.z,
        );
        const error = Math.hypot(nav.position.x - p[0], nav.position.z - p[1]);
        maxPositionError = Math.max(error, maxPositionError);
        const expected = index
          .lookup(...p)
          .find(
            (h) =>
              h.surfaceId === hit.surfaceId && h.allowedModes.includes('drive'),
          );
        if (expected)
          maxYError = Math.max(
            maxYError,
            Math.abs(nav.position.y - expected.y),
          );
        if (error > 0.02) {
          failedAt = i;
          break;
        }
        if (i % 120 === 0)
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      results.push({
        route,
        reversed,
        valid: failedAt === undefined,
        failedAt,
        travelled,
        maxPositionError,
        maxYError,
        finalSurfaceId: nav.surfaceId,
        finalPosition: nav.position.toArray(),
      });
    }
  for (const id of e.data.causeway.south
    ? [363686270, 648864806, 44032491, 115939816, 74267973]
    : []) {
    const f = e.data.paths.features.find(
      (f: any) => Number(f.properties.sourceId ?? f.properties.id) === id,
    );
    if (!f) {
      results.push({
        lowerPath: id,
        valid: false,
        error: 'Missing source path',
      });
      continue;
    }
    for (const line of lines(f)) {
      const points = line.map(project),
        start = points[0];
      nav.startAt('walk', {
        x: start[0],
        z: start[1],
        y: e.elevation(...start) + 1.25,
        yaw: 0,
        surface: 'ground',
        name: String(id),
        snappedDistance: 0,
      });
      let failedAt: number | undefined,
        floorJump = false;
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        nav.move(p[0] - nav.position.x, p[1] - nav.position.z);
        if (Math.hypot(nav.position.x - p[0], nav.position.z - p[1]) > 0.02) {
          failedAt = i;
          break;
        }
        floorJump ||= index.surfaceIds.has(nav.surfaceId || '');
      }
      results.push({
        lowerPath: id,
        valid: failedAt === undefined && !floorJump,
        failedAt,
        floorJump,
        finalPosition: nav.position.toArray(),
      });
    }
  }
  nav.setMode('orbit');
  e.applySettings({ ...e.settings, mode: 'orbit' });
  return {
    kind: 'Actual navigation movement/collision replay; no camera demo or FPS claim',
    valid: results.every((r) => r.valid),
    results,
  };
}

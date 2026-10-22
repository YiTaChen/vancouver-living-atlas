/** Loopback opt-in diagnostics. Entry uses the actual road graph and public
 * navigation. Recording observes native driving; it never injects speed/input,
 * moves the car after entry, or disables collision/traffic-stop permissions. */
import type { CityEngine } from './engine';
import type { RoadGraph } from './road-graph';
import type { SurfaceHit } from './surface-reachability';
type QAPath = {
  sourceIds: number[];
  osmSourceIds?: number[];
  points: readonly (readonly [number, number])[];
  width: number;
  identity: { surfaceId: string; layer: number };
  reverseIdentity?: { surfaceId: string; layer: number };
};

export function installStanleyDriveQA(e: CityEngine, panel: HTMLElement) {
  const graph = e.data.roadGraph as RoadGraph | undefined;
  const edges =
    graph?.edges
      .filter((edge) =>
        edge.names.some((name) => /stanley park drive/i.test(name)),
      )
      .sort((a, b) => b.length - a.length) ?? [];
  if (!graph || !edges.length) return;
  const status = document.createElement('p');
  status.textContent = 'Stanley Drive QA ready';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Stanley Drive QA road segment');
  for (const edge of edges) {
    const option = document.createElement('option');
    option.value = String(edge.id);
    option.textContent = `Edge ${edge.id} · ${edge.length.toFixed(1)}m · ${edge.sourceIds.join(',')}`;
    select.appendChild(option);
  }
  const presets = {
    ...e.data.prospectOverpass?.qaRoutes,
    ...e.data.stanleySouthRamp?.qaRoutes,
    ...e.data.stanleyWestRamp?.qaRoutes,
    ...e.data.stanleyNorthboundExit?.qaRoutes,
    ...e.data.stanleyNorthboundRamp?.qaRoutes,
    ...e.data.stanleyDriveCorrections?.qaRoutes,
  } as Record<string, QAPath>;
  const north = e.data.stanleyNorthboundRamp;
  if (north?.points && north.qaRoutes?.northbound)
    presets.northEntry = {
      ...north.qaRoutes.northbound,
      points: north.points,
    };
  for (const [id, route] of Object.entries(presets)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = `Reproduction · ${id} · ${route.sourceIds.join(',')}`;
    select.appendChild(option);
  }
  panel.appendChild(status);
  panel.appendChild(select);
  let entry: unknown = null,
    sequence = 0,
    recording = false;
  const samples: unknown[] = [];
  const button = (name: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = action;
    panel.appendChild(b);
  };
  for (const reverse of [false, true])
    button(`Stanley Drive QA: start ${reverse ? 'reverse' : 'forward'}`, () => {
      const nav = e.navigation,
        edge = edges.find((edge) => edge.id === Number(select.value)),
        preset = presets[select.value];
      if (!nav || (!edge && !preset)) return;
      e.tesla?.deactivate();
      e.applySettings({
        ...e.settings,
        mode: 'drive',
        qualityMode: 'manual',
        quality: 'balanced',
        autoRotate: false,
      });
      e.setClock({ hour: 14, running: false });
      const points = preset
        ? [...preset.points]
        : [graph.nodes[edge!.a].point, graph.nodes[edge!.b].point];
      if (reverse) points.reverse();
      const a = points[0],
        b = points.at(-1)!;
      const lengths = points
        .slice(1)
        .map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
      const length = lengths.reduce((sum, n) => sum + n, 0);
      let station = Math.min(5, length * 0.15),
        segment = 0;
      while (segment < lengths.length - 1 && station > lengths[segment])
        station -= lengths[segment++];
      const from = points[segment],
        to = points[segment + 1];
      if (!from || !to || !lengths[segment]) return;
      const fraction = station / lengths[segment],
        x = from[0] + (to[0] - from[0]) * fraction,
        z = from[1] + (to[1] - from[1]) * fraction;
      const yaw = Math.atan2(to[0] - from[0], to[1] - from[1]);
      const identity =
        reverse && preset?.reverseIdentity
          ? preset.reverseIdentity
          : preset?.identity;
      const protectedPreset = identity && identity.surfaceId !== 'ground';
      const bridgeHit: SurfaceHit | undefined = protectedPreset
        ? e.data.travelSurfaces
            ?.lookup(x, z)
            .find(
              (hit: SurfaceHit) =>
                hit.surfaceId === identity.surfaceId &&
                hit.layer === identity.layer &&
                hit.allowedModes.includes('drive'),
            )
        : undefined;
      if (protectedPreset && !bridgeHit) {
        status.textContent =
          'Source-owned protected floor missing; entry refused';
        return;
      }
      const width = preset?.width ?? edge!.width;
      if (!Number.isFinite(width) || width < 2) {
        status.textContent = 'Source road width missing; entry refused';
        return;
      }
      const y = bridgeHit?.y ?? nav.roadHeight(x, z);
      nav.startAt('drive', {
        x,
        y,
        z,
        yaw,
        surface: bridgeHit ? 'bridge' : 'ground',
        surfaceId: bridgeHit?.surfaceId,
        layer: bridgeHit?.layer,
        name: 'Stanley Park Drive audit',
        snappedDistance: 0,
      });
      nav.cameraDistances.drive = 10;
      nav.snapCamera = true;
      nav.update(0);
      entry = {
        edgeId: preset ? select.value : edge!.id,
        sourceIds: preset?.sourceIds ?? edge!.sourceIds,
        osmSourceIds: preset?.osmSourceIds,
        a,
        b,
        points,
        x,
        y,
        z,
        yaw,
        reverse,
        width,
        surfaceId: bridgeHit?.surfaceId ?? 'ground',
        surfaceLayer: bridgeHit?.layer ?? 0,
        initialDamage: nav.condition.damage.overall,
        initialBrokenCount: e.vehicleImpacts?.broken.size ?? 0,
      };
      samples.length = 0;
      recording = true;
      status.textContent = `Recording actual road ${preset ? select.value : edge!.id}; use native W/A/D/Space`;
    });
  const sample = () => {
    const nav = e.navigation;
    if (e.disposed) {
      clearInterval(timer);
      return;
    }
    if (
      !recording ||
      !nav ||
      nav.mode !== 'drive' ||
      e.settings.mode !== 'drive' ||
      e.tesla?.active ||
      document.hidden
    )
      return;
    const x = nav.position.x,
      z = nav.position.z,
      yaw = nav.yaw;
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as const;
    const from = {
      position: [x, nav.position.y + 0.7, z] as const,
      quaternion: q,
    };
    const hit = e.vehicleImpacts?.sweep({
      from,
      to: {
        position: [
          x + Math.sin(yaw) * 6,
          from.position[1],
          z + Math.cos(yaw) * 6,
        ],
        quaternion: q,
      },
      shape: { halfExtents: [1, 0.65, 2.4], clearance: 0.02 },
    });
    samples.push({
      t: performance.now(),
      position: nav.position.toArray(),
      yaw,
      speedKph: nav.speed * 3.6,
      throttle: nav.keys.has('w') || nav.keys.has('arrowup') || nav.touchY > 0,
      brake: nav.keys.has(' ') || nav.touchBrake,
      surface: nav.surface,
      surfaceId: nav.surfaceId,
      groundAllowed: nav.clearGround(x, z, 'drive'),
      police: nav.trafficStop?.active,
      damage: nav.condition.damage.overall,
      lastHit: nav.condition.damage.lastHit,
      ahead: hit
        ? {
            surfaceId: hit.surfaceId,
            fraction: hit.fraction,
            point: hit.point,
            normal: hit.normal,
          }
        : null,
    });
    if (samples.length >= 5000) {
      recording = false;
      status.textContent = 'Recording reached bounded sample limit';
    }
  };
  const timer = setInterval(sample, 100);
  window.addEventListener('pagehide', () => clearInterval(timer), {
    once: true,
  });
  button('Stanley Drive QA: save checkpoint', () => {
    sample();
    const treeStats = e.data.stanleyTreeRoadClearance;
    const row = {
      kind: 'stanley-drive-native-v1',
      entry,
      viewport: [innerWidth, innerHeight],
      quality: e.settings.quality,
      qualityMode: e.settings.qualityMode,
      carModel: e.navigation?.carModel,
      treeClearance: treeStats
        ? {
            complete: treeStats.complete,
            candidates: treeStats.candidates,
            retained: treeStats.retained,
            excluded: treeStats.excluded,
            municipalExcluded: treeStats.municipalExcluded,
            generatedExcluded: treeStats.generatedExcluded,
            triangles: treeStats.triangles,
            heightAwareTriangles: treeStats.heightAwareTriangles,
          }
        : null,
      valid:
        entry !== null &&
        !e.disposed &&
        !document.hidden &&
        e.settings.mode === 'drive' &&
        e.navigation?.mode === 'drive' &&
        !e.tesla?.active,
      samples: [...samples],
      broken: [...(e.vehicleImpacts?.broken ?? [])],
      damage: e.navigation?.condition.damage,
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `stanley-drive-${++sequence}-${Date.now()}`,
        row,
        screenshot: e.screenshot(),
      }),
    }).then((response) => {
      status.textContent = response.ok
        ? 'Stanley Drive checkpoint saved'
        : `Save failed ${response.status}`;
    });
  });
}

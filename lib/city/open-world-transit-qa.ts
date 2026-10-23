/** Imported only by explicitly opted-in local QA builds. Street spawns place a
 * walker outside the source entrance; all subsequent walking/boarding is real. */
import type { CityEngine } from './engine';
import { SKYTRAIN_STATIONS } from './skytrain-network';
import type { SkyTrainStationOwner, StationPoint } from './skytrain-stations';
export function installOpenWorldTransitQA(city: CityEngine) {
  const requested = new URLSearchParams(location.search).get('world-station');
  const panel = document.createElement('details'),
    summary = document.createElement('summary'),
    output = document.createElement('output');
  summary.textContent = 'Open-world transit QA';
  panel.appendChild(summary);
  panel.appendChild(output);
  panel.style.cssText =
    'position:fixed;left:8px;top:165px;z-index:10000;background:#10262ee8;color:white;max-width:420px;max-height:65vh;overflow:auto;padding:8px;font:11px monospace';
  output.style.whiteSpace = 'pre-wrap';
  document.body.appendChild(panel);
  const controls = document.createElement('div');
  panel.insertBefore(controls, output);
  let spawned = false;
  const spawn = (id: string) => {
    const owner = city.skyTrainTravel?.stations.owners.find(
        (s) => s.data.id === id,
      ),
      entrance = owner?.streetEntrances()[0],
      nav = city.navigation;
    if (
      !owner ||
      !entrance ||
      !nav ||
      city.skyTrainTravel?.active ||
      city.busVisit?.aboard
    )
      return false;
    const dx = entrance.inward[0] - entrance.threshold[0],
      dz = entrance.inward[2] - entrance.threshold[2],
      length = Math.hypot(dx, dz),
      x = entrance.threshold[0] - (dx / length) * 3.7,
      z = entrance.threshold[2] - (dz / length) * 3.7;
    nav.startAt('walk', {
      x,
      y: nav.groundHeight(x, z),
      z,
      yaw: Math.atan2(dx, dz),
      surface: 'ground',
      surfaceId: 'ground',
      layer: 0,
      name: entrance.label,
      snappedDistance: 0,
    });
    city.settings = { ...city.settings, mode: 'walk', autoRotate: false };
    city.onTravelResume('walk');
    return true;
  };
  for (const station of SKYTRAIN_STATIONS) {
    const b = document.createElement('button');
    b.textContent = `Street: ${station.name}`;
    b.onclick = () => spawn(station.id);
    controls.appendChild(b);
  }
  const timer = setInterval(() => {
    if (city.disposed) {
      clearInterval(timer);
      panel.remove();
      return;
    }
    if (requested && !spawned) spawned = spawn(requested);
    const passenger = city.skyTrainTravel as unknown as {
      owner: SkyTrainStationOwner | null;
      foot: StationPoint | null;
    } | null;
    const snapshot = {
      train: city.skyTrainTravel?.snapshot(),
      service: city.skyTrainTravel?.serviceSnapshot(),
      bus: city.busWorldService?.snapshot(),
      foot:
        city.skyTrainTravel?.interactionOrigin ??
        city.navigation?.position.toArray(),
      camera: city.camera.position.toArray(),
      cameraDirection: city.camera
        .getWorldDirection(city.controls.target.clone())
        .toArray(),
      stationFoot:
        passenger?.foot && passenger.owner
          ? {
              surfaceId: passenger.foot.surfaceId,
              layer: passenger.foot.layer,
              supported: passenger.owner.isClearFoot(passenger.foot),
            }
          : null,
      owners: city.skyTrainTravel?.stations.owners.map((o) => ({
        id: o.data.id,
        origin: o.origin,
        yaw: o.yaw,
        entrances: o.streetEntrances(),
        routes: o.streetRoutes(),
      })),
    };
    city.renderer.domElement.dataset.openWorldTransit =
      JSON.stringify(snapshot);
    output.textContent = JSON.stringify(
      {
        train: snapshot.train,
        foot: snapshot.foot,
        service: snapshot.service?.vehicles.filter(
          (v) =>
            Math.abs(v.position[0]) < 10000 && Math.abs(v.position[2]) < 10000,
        ),
        bus: snapshot.bus,
      },
      null,
      1,
    );
  }, 250);
}

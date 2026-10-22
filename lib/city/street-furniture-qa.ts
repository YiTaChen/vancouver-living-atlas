/** Only the explicitly instrumented local QA entry imports this module. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { FurnitureKind } from './street-furniture-placement';

export function installStreetFurnitureQA(
  e: CityEngine,
  panel: HTMLElement,
  lease: { begin(): boolean; end(): void; isRunning(): boolean },
) {
  const status = document.createElement('p');
  status.id = 'street-furniture-qa-status';
  status.textContent = 'Street furniture QA ready';
  panel.appendChild(status);
  let focused: string | null = null;
  let sequence = 0;
  const button = (label: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = () => {
      if (!lease.isRunning()) action();
    };
    panel.appendChild(b);
  };
  const focus = (kind: FurnitureKind, street = '') => {
    const candidates =
      e.streetFurniture?.placements.filter(
        (p) =>
          p.kind === kind &&
          (!street || p.streetNames.some((name) => name.includes(street))),
      ) ?? [];
    const placement = candidates.sort(
      (a, b) =>
        Math.hypot(a.x - e.camera.position.x, a.z - e.camera.position.z) -
        Math.hypot(b.x - e.camera.position.x, b.z - e.camera.position.z),
    )[0];
    if (!placement) {
      status.textContent = `No proven ${kind} ${street} placement`;
      return;
    }
    e.navigation?.setMode('orbit');
    e.navigation?.blur();
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      autoRotate: false,
      labels: false,
    });
    e.transition = null;
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      placement.yaw,
    );
    const origin = new THREE.Vector3(placement.x, placement.y, placement.z);
    let eye: THREE.Vector3 | undefined;
    for (const local of [
      [3.4, 2.2, -4.4],
      [-3.4, 2.2, -4.4],
      [0, 1.8, -5.5],
      [3, 2.2, 3],
    ]) {
      const candidate = new THREE.Vector3(...local)
        .applyQuaternion(rotation)
        .add(origin);
      let clear =
        e.navigation?.clearGround(candidate.x, candidate.z, 'walk') === true;
      for (let step = 1; clear && step < 10; step++) {
        const point = candidate.clone().lerp(origin, step / 10);
        if (e.waterWorld.solidAt(point.x, point.z)) clear = false;
      }
      if (clear) {
        eye = candidate;
        break;
      }
    }
    if (!eye) {
      status.textContent = 'No unobstructed camera approach to this furnishing';
      return;
    }
    e.controls.minDistance = 0.5; // Local close-up QA must bypass the city-orbit 28m limit.
    e.camera.position.copy(eye);
    e.controls.target.set(placement.x, placement.y + 0.48, placement.z);
    e.camera.lookAt(e.controls.target);
    e.controls.update();
    e.streetFurniture?.update(true);
    focused = placement.id;
    status.textContent = `Focused ${kind}: ${placement.streetNames.join(', ')}; ${placement.id}`;
  };
  for (const kind of ['cedar-bench', 'garbage-bin', 'bicycle-rack'] as const)
    button(`Furniture: focus ${kind}`, () => focus(kind));
  button('Furniture: focus Robson bench', () => focus('cedar-bench', 'ROBSON'));
  button('Seats: approach visible bench', () => {
    const nav = e.navigation;
    const p =
      e.streetFurniture?.placements.find(
        (p) => p.id === focused && p.kind === 'cedar-bench',
      ) ?? e.streetFurniture?.placements.find((p) => p.kind === 'cedar-bench');
    if (!nav || !p || e.skyTrainTravel?.active) return;
    const x = p.x + Math.sin(p.yaw) * 1.2,
      z = p.z + Math.cos(p.yaw) * 1.2;
    if (!nav.clearGround(x, z, 'walk', true)) return;
    e.applySettings({
      ...e.settings,
      mode: 'walk',
      autoRotate: false,
      labels: false,
    });
    nav.cameraDistances.walk = 3.6;
    nav.startAt('walk', {
      x,
      z,
      y: p.y + 0.02,
      yaw: p.yaw + Math.PI,
      surface: 'ground',
      name: '',
      snappedDistance: 0,
    });
    e.onTravelResume('walk');
    e.streetFurniture?.update(true);
    status.textContent = `Approaching seat ${p.id}; use real F/tap to sit`;
  });
  button('Seats: inspect current state', () => {
    status.textContent = JSON.stringify({
      worldSeat: e.navigation?.walkSeat?.id ?? null,
      position: e.navigation?.position.toArray(),
      avatar: {
        visible: e.navigation?.walker.group.visible,
        position: e.navigation?.walker.group.position.toArray(),
        pose: e.navigation?.walker.group.userData,
      },
      selected: e.interactions?.controller.snapshot(),
      camera: { position: e.camera.position.toArray(), quaternion: e.camera.quaternion.toArray(), fov: e.camera.fov, aspect: e.camera.aspect },
      skytrain: e.skyTrainTravel?.snapshot(),
      origin: e.skyTrainTravel?.interactionOrigin,
      furniture: e.streetFurniture?.stats(),
    });
  });

  button('Furniture: save checkpoint', () => {
    if (!lease.begin()) return;
    const screenshot = e.screenshot();
    const id = focused?.replace(/[^a-z0-9-]/gi, '-').slice(0, 90) ?? 'overview';
    const hour = e.clock.hour.toFixed(2).replace('.', 'p');
    const name = `furniture-${e.compatibleGraphics ? 'compatible' : e.settings.quality}-${id}-${hour}h-${++sequence}`;
    const row = {
      kind: 'city-street-furniture-webgl-v1',
      valid: !document.hidden && !e.disposed,
      hour: e.clock.hour,
      quality: e.settings.quality,
      qualityMode: e.settings.qualityMode,
      compatible: e.compatibleGraphics,
      focused,
      viewport: [innerWidth, innerHeight],
      render: [e.renderer.domElement.width, e.renderer.domElement.height],
      camera: e.camera.position.toArray(),
      target: e.controls.target.toArray(),
      furniture: e.streetFurniture?.stats(),
      placements: e.streetFurniture?.placements,
      calls: e.renderer.info.render.calls,
      triangles: e.renderer.info.render.triangles,
      geometries: e.renderer.info.memory.geometries,
      textures: e.renderer.info.memory.textures,
      physical: e.streetFurniture?.placements.map((p) => ({
        id: p.id,
        playerBlocked: e.navigation?.clearGround(p.x, p.z, 'walk') === false,
        futureBlocked:
          e.navigation?.clearGround(p.x, p.z, 'walk', true) === false,
      })),
    };
    void fetch('/__visual-qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, row, screenshot }),
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Furniture capture failed ${response.status}`);
        status.textContent = `Saved ${name}`;
      })
      .catch((error) => {
        status.textContent = String(error);
      })
      .finally(() => lease.end());
  });
}

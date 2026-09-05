import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityEngine } from './engine';
import { project, rings, lines } from './geo';
import { makeWake } from './wake';
import { waveHeight } from './water-world';
import {
  HarbourPath,
  harbourVisible,
  type HarbourKind,
  type HarbourRouteData,
} from './harbour-path';
import {
  makeHelicopter,
  makeSeaplane,
  makeCruiseShip,
  makeMotorboat,
  makeMooredYacht,
} from './harbour-models';
export interface HarbourActor {
  model: THREE.Group;
  path: HarbourPath;
  kind: HarbourKind;
  length: number;
  phase: number;
  wake: THREE.Mesh;
  offRoute?: boolean;
}
export interface Harbour {
  group: THREE.Group;
  actors: HarbourActor[];
  moored: THREE.Group[];
  launches: {
    model: THREE.Group;
    points: THREE.Vector3[];
    lengths: number[];
    length: number;
    phase: number;
    wake: THREE.Mesh;
  }[];
  elapsed: number;
}
export function hullPolygon(
  x: number,
  z: number,
  yaw: number,
  length: number,
  width: number,
) {
  const fx = Math.sin(yaw),
    fz = Math.cos(yaw),
    rx = Math.cos(yaw),
    rz = -Math.sin(yaw);
  const r = [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([a, b]) => [
    x + (fx * a * length) / 2 + (rx * b * width) / 2,
    z + (fz * a * length) / 2 + (rz * b * width) / 2,
  ]);
  return [r];
}
function addDocks(e: CityEngine) {
  const geometries: THREE.BufferGeometry[] = [];
  for (const f of e.data['harbour-piers'].features) {
    for (const poly of f.geometry.type.endsWith('Polygon') ? rings(f) : []) {
      const p = poly.map((r) => r.map(project));
      e.waterWorld.addObstacle(p);
      const shape = new THREE.Shape(
        p[0].map((v) => new THREE.Vector2(v[0], v[1])),
      );
      shape.holes = p
        .slice(1)
        .map(
          (r) => new THREE.Path(r.map((v) => new THREE.Vector2(v[0], v[1]))),
        );
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: 1.4,
        bevelEnabled: false,
      });
      g.rotateX(Math.PI / 2);
      g.translate(0, 1.6, 0);
      g.deleteAttribute('uv');
      geometries.push(g);
    }
    for (const line of f.geometry.type.endsWith('LineString') ? lines(f) : []) {
      const p = line.map(project);
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1],
          b = p[i],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.1) continue;
        const x = (a[0] + b[0]) / 2,
          z = (a[1] + b[1]) / 2,
          yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        e.waterWorld.addObstacle(hullPolygon(x, z, yaw, length, 1.4));
        const g = new THREE.BoxGeometry(1.4, 1.4, length).toNonIndexed();
        g.rotateY(yaw);
        g.translate(x, 0.9, z);
        g.deleteAttribute('uv');
        geometries.push(g);
      }
    }
  }
  if (geometries.length) {
    const g = mergeGeometries(geometries)!;
    geometries.forEach((g) => g.dispose());
    const docks = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ color: 0x87948c, roughness: 0.91 }),
    );
    docks.receiveShadow = true;
    e.scene.add(docks);
    e.data.harbourDockMesh = docks;
  }
}
function rotor(model: THREE.Group, time: number) {
  const main = model.userData.rotor as THREE.Object3D | undefined,
    tail = model.userData.tailRotor as THREE.Object3D | undefined,
    prop = model.userData.propeller as THREE.Object3D | undefined;
  if (main) main.rotation.y = time * 42;
  if (tail) tail.rotation.x = time * 57;
  if (prop) prop.rotation.z = time * 65;
}
export function createHarbour(e: CityEngine): Harbour {
  addDocks(e);
  const pad = e.data['harbour-sites'].sites.find(
    (s: { kind: string; coordinate: number[] }) => s.kind === 'helipad',
  );
  if (pad) {
    const [x, z] = project(pad.coordinate),
      markings = new THREE.Group(),
      mat = new THREE.MeshBasicMaterial({ color: 0xe7e9cf });
    const circle = new THREE.Mesh(new THREE.RingGeometry(6.8, 7.15, 40), mat);
    circle.rotation.x = -Math.PI / 2;
    markings.add(circle);
    for (const [px, pz, w, l] of [
      [-1.7, 0, 0.55, 5],
      [1.7, 0, 0.55, 5],
      [0, 0, 3.5, 0.6],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.025, l), mat);
      bar.position.set(px, 0, pz);
      markings.add(bar);
    }
    markings.position.set(x, 1.63, z);
    e.scene.add(markings);
  }
  const h: Harbour = {
    group: new THREE.Group(),
    actors: [],
    moored: [],
    launches: [],
    elapsed: 0,
  };
  h.group.name = 'Harbour traffic';
  e.scene.add(h.group);
  const factories = {
    cruise: makeCruiseShip,
    seaplane: makeSeaplane,
    helicopter: makeHelicopter,
  };
  for (const route of e.data['harbour-routes'].routes as HarbourRouteData[]) {
    const model = factories[route.kind]();
    const adjusted = {
      ...route,
      altitudesM: route.altitudesM.map((y, i) =>
        route.kind === 'seaplane'
          ? Math.max(0, y - 0.6)
          : route.kind === 'helicopter' && i === 0
            ? 1.65
            : y,
      ),
    };
    model.userData.harbourVehicle = true;
    model.name = route.name;
    h.group.add(model);
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.userData.harbourVehicle = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.transparent = true;
      }
    });
    const wake = makeWake(
      route.kind === 'cruise' ? 180 : 25,
      route.kind === 'cruise' ? 32 : 3,
    );
    wake.visible = false;
    h.group.add(wake);
    h.actors.push({
      model,
      wake,
      path: new HarbourPath(adjusted),
      kind: route.kind,
      length: route.kind === 'cruise' ? 250 : 16,
      phase: route.kind === 'cruise' ? 0 : route.kind === 'seaplane' ? 8 : 2,
    });
  }
  for (const [i, berth] of e.data[
    'harbour-sites'
  ].illustrativeMoorings.entries()) {
    const model = makeMooredYacht(i),
      [x, z] = project(berth.coordinate);
    // Geographic compass bearings run clockwise from north; scene +Z points south.
    const yaw = Math.PI - (berth.headingDegrees * Math.PI) / 180;
    const box = new THREE.Box3().setFromObject(model),
      size = box.getSize(new THREE.Vector3());
    model.scale.set(berth.boatWidthM / size.x, 1, berth.boatLengthM / size.z);
    model.position.set(x, 0.1, z);
    model.rotation.y = yaw;
    model.userData.length = berth.boatLengthM;
    model.userData.harbourVehicle = true;
    h.moored.push(model);
    h.group.add(model);
    e.waterWorld.addObstacle(
      hullPolygon(x, z, yaw, berth.boatLengthM, berth.boatWidthM),
    );
  }
  // Original harbour launches circle open-water areas, with every hull sample checked.
  for (const [i, anchor] of [
    [-123.123, 49.294],
    [-123.12, 49.2945],
    [-123.135, 49.2735],
    [-123.158, 49.286],
  ].entries()) {
    const [cx, cz] = project(anchor),
      points: THREE.Vector3[] = [];
    let valid = true;
    for (let j = 0; j <= 180; j++) {
      const a = (j / 180) * Math.PI * 2,
        x = cx + Math.sin(a) * 65,
        z = cz + Math.cos(a) * 42,
        yaw = Math.atan2(Math.cos(a) * 65, -Math.sin(a) * 42);
      if (!e.waterWorld.canOccupy(x, z, yaw, 'sea')) valid = false;
      points.push(new THREE.Vector3(x, 0.1, z));
    }
    if (!valid) continue;
    const lengths = [0];
    for (let j = 1; j < points.length; j++)
      lengths.push(lengths[j - 1] + points[j].distanceTo(points[j - 1]));
    const model = makeMotorboat();
    model.userData.harbourVehicle = true;
    h.group.add(model);
    const wake = makeWake();
    h.group.add(wake);
    h.launches.push({
      model,
      wake,
      points,
      lengths,
      length: lengths.at(-1)!,
      phase: i * 0.24,
    });
  }
  h.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = false;
  });
  updateHarbour(e, h, 0);
  return h;
}
export function updateHarbour(e: CityEngine, h: Harbour, delta: number) {
  h.elapsed += Math.max(0, Math.min(0.1, delta));
  h.group.visible = e.settings.harbour;
  const overview = e.camera.position.distanceTo(e.controls.target),
    height = e.renderer.domElement.clientHeight || 800;
  for (const actor of h.actors) {
    const { path, model, kind } = actor,
      dwell = kind === 'cruise' ? 35 : 14;
    const t = (h.elapsed + actor.phase) % (path.duration * 2 + dwell * 2 + 16);
    const inbound = t > path.duration + dwell + 8;
    const flightTime = inbound
      ? path.duration - Math.max(0, t - (path.duration + dwell + 8))
      : Math.max(0, t - dwell);
    const p = path.sample(flightTime),
      atEnd = flightTime > path.duration || flightTime < 0;

    const water = kind === 'cruise' || (kind === 'seaplane' && p.y < 1.5);
    model.position.set(
      p.x,
      p.y +
        0.1 +
        (water
          ? waveHeight('sea', p.x, p.z, h.elapsed) *
            (kind === 'cruise' ? 0.08 : 0.6)
          : 0),
      p.z,
    );
    model.rotation.set(
      kind === 'cruise' ? 0 : -p.pitch * (inbound ? -1 : 1),
      p.yaw + (inbound ? Math.PI : 0),
      water
        ? Math.sin(h.elapsed * 1.1) * 0.01
        : Math.sin(h.elapsed * 0.5) * 0.025,
      'YXZ',
    );
    const fade = Math.min(
      1,
      Math.max(0, (path.length - p.distance) / (kind === 'cruise' ? 350 : 550)),
    );
    actor.offRoute = atEnd || fade <= 0.005;
    model.traverse((o) => {
      if (o instanceof THREE.Mesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.opacity = fade;
          m.depthWrite = fade > 0.999;
        }
    });
    model.visible =
      !atEnd &&
      fade > 0.005 &&
      harbourVisible(
        actor.length,
        e.camera.position.distanceTo(model.position),
        height,
        e.camera.fov,
        overview,
      );
    if (model.visible) rotor(model, h.elapsed);
    actor.wake.visible =
      model.visible && water && flightTime > 0 && flightTime < path.duration;
    const stern = kind === 'cruise' ? 125 : 6,
      yaw = model.rotation.y;
    actor.wake.position.set(
      p.x - Math.sin(yaw) * stern,
      0.15,
      p.z - Math.cos(yaw) * stern,
    );
    actor.wake.rotation.y = yaw;
  }
  for (const boat of h.moored) {
    boat.visible = harbourVisible(
      boat.userData.length,
      e.camera.position.distanceTo(boat.position),
      height,
      e.camera.fov,
      overview,
    );
    if (boat.visible) {
      boat.position.y =
        0.1 + Math.sin(h.elapsed * 0.65 + boat.position.x) * 0.035;
      boat.rotation.z = Math.sin(h.elapsed * 0.7 + boat.position.z) * 0.006;
    }
  }
  for (const launch of h.launches) {
    const d = (h.elapsed * 3 + launch.phase * launch.length) % launch.length;
    let i = 1;
    while (launch.lengths[i] < d) i++;
    const a = launch.points[i - 1],
      b = launch.points[i],
      u =
        (d - launch.lengths[i - 1]) /
        (launch.lengths[i] - launch.lengths[i - 1]);
    launch.model.position.lerpVectors(a, b, u);
    launch.model.position.y =
      0.1 +
      waveHeight(
        'sea',
        launch.model.position.x,
        launch.model.position.z,
        h.elapsed,
      ) *
        0.7;
    launch.model.rotation.set(
      0,
      Math.atan2(b.x - a.x, b.z - a.z),
      Math.sin(h.elapsed) * 0.018,
    );
    launch.model.visible = harbourVisible(
      7,
      e.camera.position.distanceTo(launch.model.position),
      height,
      e.camera.fov,
      overview,
    );
    launch.wake.visible = launch.model.visible;
    launch.wake.position.copy(launch.model.position);
    launch.wake.position.y = 0.15;
    launch.wake.position.x -= Math.sin(launch.model.rotation.y) * 3.5;
    launch.wake.position.z -= Math.cos(launch.model.rotation.y) * 3.5;
    launch.wake.rotation.y = launch.model.rotation.y;
    rotor(launch.model, h.elapsed);
  }
}

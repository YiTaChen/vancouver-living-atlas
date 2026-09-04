import * as THREE from 'three';
import { bridgeSurface } from './bridges';
import type { CityEngine } from './engine';
import { project, rings, lines, inPolygon } from './geo';
import type { Feature } from './types';
import landmarkFootprints from './landmark-footprints.json';
import type { PlacementPoint, StreetMode } from './placement-geometry';
export class StreetNavigation {
  mode: 'orbit' | 'walk' | 'drive' = 'orbit';
  keys = new Set<string>();
  position = new THREE.Vector3();
  yaw = 0;
  pitch = 0.04;
  speed = 0;
  surface: 'ground' | 'bridge' = 'ground';
  snapCamera = false;
  dragging = false;
  last = [0, 0];
  car = new THREE.Group();
  collisions = new Map<string, number[][][][]>();
  constructor(public e: CityEngine) {
    for (const f of [
      ...e.data.buildings.features,
      ...landmarkFootprints.features,
    ]) {
      if ((f.properties.minHeight || 0) > 4) continue;
      for (const r of rings(f)) {
        const p = r.map((q) => q.map(project)),
          xs = p[0].map((q) => q[0]),
          zs = p[0].map((q) => q[1]);
        for (
          let x = Math.floor(Math.min(...xs) / 80);
          x <= Math.floor(Math.max(...xs) / 80);
          x++
        )
          for (
            let z = Math.floor(Math.min(...zs) / 80);
            z <= Math.floor(Math.max(...zs) / 80);
            z++
          ) {
            const key = x + ',' + z;
            if (!this.collisions.has(key)) this.collisions.set(key, []);
            this.collisions.get(key)!.push(p);
          }
      }
    }
    const mesh = (
      g: THREE.BufferGeometry,
      c: number,
      x: number,
      y: number,
      z: number,
      metal = 0.2,
    ) => {
      const m = new THREE.Mesh(
        g,
        new THREE.MeshStandardMaterial({
          color: c,
          metalness: metal,
          roughness: 0.36,
        }),
      );
      m.position.set(x, y, z);
      this.car.add(m);
      return m;
    };
    mesh(new THREE.BoxGeometry(1.95, 0.55, 4.5), 0x9b3e31, 0, 0.7, 0);
    mesh(new THREE.BoxGeometry(1.8, 0.2, 4.7), 0x753329, 0, 0.45, 0);
    mesh(new THREE.BoxGeometry(1.65, 0.68, 2.4), 0x233d48, 0, 1.3, -0.15, 0.5);
    mesh(new THREE.BoxGeometry(1.72, 0.11, 2.4), 0xb44b3a, 0, 1.66, -0.15);
    mesh(new THREE.BoxGeometry(1.85, 0.14, 1.15), 0xad4335, 0, 1.04, 1.55);
    mesh(new THREE.BoxGeometry(1.3, 0.2, 0.06), 0x132f37, 0, 0.64, 2.3);
    mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), 0xc1c2b2, 0, 0.45, 2.35);
    for (const x of [-1.02, 1.02])
      for (const z of [-1.4, 1.35]) {
        const wheel = mesh(
          new THREE.CylinderGeometry(0.36, 0.36, 0.2, 16),
          0x1c2424,
          x,
          0.38,
          z,
        );
        wheel.rotation.z = Math.PI / 2;
        const rim = mesh(
          new THREE.CylinderGeometry(0.23, 0.23, 0.22, 8),
          0xaaa99b,
          x,
          0.38,
          z,
        );
        rim.rotation.z = Math.PI / 2;
      }
    for (const x of [-0.7, 0.7]) {
      mesh(new THREE.BoxGeometry(0.43, 0.17, 0.07), 0xffedbb, x, 0.84, 2.3);
      mesh(new THREE.BoxGeometry(0.48, 0.14, 0.07), 0xe6472d, x, 0.87, -2.3);
      mesh(
        new THREE.BoxGeometry(0.3, 0.12, 0.27),
        0x883c31,
        x * 1.6,
        1.22,
        0.75,
      );
    }
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 4.9),
      new THREE.MeshBasicMaterial({
        color: 0x15272c,
        transparent: true,
        opacity: 0.23,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    this.car.add(shadow);
    this.car.visible = false;
    e.scene.add(this.car);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    const canvas = e.renderer.domElement;
    canvas.addEventListener('pointerdown', this.pointerDown);
    canvas.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
  }
  keyDown = (ev: KeyboardEvent) => {
    if (
      this.mode === 'orbit' ||
      (ev.target instanceof Element &&
        ev.target.closest(
          '[role="combobox"], [role="listbox"], [role="option"], [role="dialog"]',
        )) ||
      ev.target instanceof HTMLInputElement ||
      ev.target instanceof HTMLTextAreaElement
    )
      return;
    const k = ev.key.toLowerCase();
    if (
      [
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        'shift',
        ' ',
      ].includes(k)
    ) {
      ev.preventDefault();
      this.keys.add(k);
    }
  };
  keyUp = (ev: KeyboardEvent) => {
    this.keys.delete(ev.key.toLowerCase());
  };
  blur = () => {
    this.keys.clear();
    this.dragging = false;
    this.speed = 0;
  };
  pointerDown = (ev: PointerEvent) => {
    if (this.mode === 'orbit') return;
    this.dragging = true;
    this.last = [ev.clientX, ev.clientY];
  };
  pointerMove = (ev: PointerEvent) => {
    if (!this.dragging || this.mode === 'orbit') return;
    this.yaw -= (ev.clientX - this.last[0]) * 0.004;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + (ev.clientY - this.last[1]) * 0.003,
      -0.7,
      0.7,
    );
    this.last = [ev.clientX, ev.clientY];
  };
  pointerUp = () => {
    this.dragging = false;
  };
  blocked(x: number, z: number) {
    if (this.reachableDeck(x, z) !== undefined) return false;
    if (
      this.surface === 'bridge' &&
      Math.abs(this.e.elevation(x, z) + 1.25 - this.position.y) > 4
    )
      return true;
    return !this.clearGround(x, z);
  }
  reachableDeck(x: number, z: number) {
    const deck = bridgeSurface(this.e, x, z, this.position.y);
    if (deck === undefined) return undefined;
    if (
      this.surface === 'bridge' ||
      Math.abs(deck - this.e.elevation(x, z) - 1.25) < 0.8
    )
      return deck;
    return undefined;
  }
  clearGround(x: number, z: number) {
    if (!this.e.onLand(x, z)) return false;
    if (this.e.data.waterPolys?.some((p: number[][][]) => inPolygon([x, z], p)))
      return false;
    return !(
      this.collisions
        .get(Math.floor(x / 80) + ',' + Math.floor(z / 80))
        ?.some((p) => inPolygon([x, z], p)) || false
    );
  }
  startAt(mode: StreetMode, point: PlacementPoint) {
    this.blur();
    this.mode = mode;
    this.car.visible = mode === 'drive';
    this.e.controls.enabled = false;
    this.e.transition = null;
    this.position.set(point.x, point.y, point.z);
    this.surface = point.surface;
    this.yaw = point.yaw;
    this.pitch = 0.04;
    this.snapCamera = true;
    this.update(0);
    this.e.renderer.domElement.focus({ preventScroll: true });
  }
  setMode(mode: 'orbit' | 'walk' | 'drive', streetName?: string) {
    if (mode === this.mode && !streetName) return;
    this.keys.clear();
    this.speed = 0;
    this.mode = mode;
    this.car.visible = mode === 'drive';
    this.e.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.e.camera.near = 2;
      this.e.camera.updateProjectionMatrix();
      return;
    }
    this.e.transition = null;
    const anchors: Record<string, number[]> = {
      'WATER ST': [-123.1084, 49.28428],
      'ROBSON ST': [-123.1258, 49.2831],
      'BEACH AV': [-123.1422, 49.2841],
    };
    const anchor =
      streetName && anchors[streetName] ? project(anchors[streetName]) : null;
    const target = anchor
      ? new THREE.Vector3(anchor[0], 0, anchor[1])
      : this.e.controls.target;
    let best = Infinity,
      chosen: number[][] | null = null;
    const candidateRoads = this.e.data.roads.features.filter(
      (f: Feature) =>
        !/bikeway|lane|bridge|causeway|private/i.test(
          (f.properties.class || '') + ' ' + (f.properties.name || ''),
        ),
    );
    for (const f of candidateRoads) {
      if (
        streetName &&
        !String(f.properties.name)
          .toUpperCase()
          .includes(streetName.toUpperCase())
      )
        continue;
      for (const line of lines(f)) {
        const p = line.map(project);
        for (let i = 0; i < p.length - 1; i++) {
          const a = p[i],
            b = p[i + 1],
            length = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (length < 35) continue;
          const x = (a[0] + b[0]) / 2,
            z = (a[1] + b[1]) / 2,
            dist = Math.hypot(x - target.x, z - target.z);
          if (dist < best && this.clearGround(x, z)) {
            best = dist;
            chosen = [a, b];
          }
        }
      }
    }
    if (!chosen) {
      this.mode = 'orbit';
      this.car.visible = false;
      this.e.controls.enabled = true;
      return;
    }
    const [a, b] = chosen;
    this.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
    this.surface = 'ground';
    this.position.y = this.e.elevation(this.position.x, this.position.z) + 1.25;
    this.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.pitch = 0.04;
    this.snapCamera = true;
    this.update(0.016);
    this.e.renderer.domElement.focus();
  }
  startBridge(kind: string) {
    const s = this.e.data.bridges?.mainSpines.find((s: any) => s.kind === kind);
    if (!s || this.mode === 'orbit') return;
    const a = project(s.start),
      b = project(s.end);
    this.keys.clear();
    this.speed = 0;
    this.position.set(
      a[0] + (b[0] - a[0]) * 0.04,
      s.estimatedDeckM + 1.95,
      a[1] + (b[1] - a[1]) * 0.04,
    );
    this.surface = 'bridge';
    this.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.pitch = 0;
    this.snapCamera = true;
    this.update(0.016);
    this.e.renderer.domElement.focus();
  }
  step(direction: string) {
    if (this.mode === 'orbit') return;
    if (direction === 'left') this.yaw += 0.15;
    else if (direction === 'right') this.yaw -= 0.15;
    else {
      const s = direction === 'backward' ? -8 : 8;
      this.move(Math.sin(this.yaw) * s, Math.cos(this.yaw) * s);
    }
    this.update(0.016);
  }
  move(dx: number, dz: number) {
    if (Math.hypot(dx, dz) < 1e-9) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 1.5));
    for (let i = 0; i < steps; i++) {
      const x = this.position.x + dx / steps,
        z = this.position.z + dz / steps;
      if (!this.blocked(x, z)) {
        const deck = this.reachableDeck(x, z);
        this.position.x = x;
        this.position.z = z;
        this.position.y = deck ?? this.e.elevation(x, z) + 1.25;
        this.surface = deck === undefined ? 'ground' : 'bridge';
      } else {
        this.speed = 0;
        break;
      }
    }
  }
  update(dt: number) {
    if (this.mode === 'orbit') return;
    dt = Math.min(0.05, dt);
    const pressed = (...s: string[]) => s.some((k) => this.keys.has(k)),
      forward =
        Number(pressed('w', 'arrowup')) - Number(pressed('s', 'arrowdown')),
      turn =
        Number(pressed('a', 'arrowleft')) - Number(pressed('d', 'arrowright'));
    if (this.mode === 'drive') {
      this.speed = THREE.MathUtils.clamp(this.speed + forward * dt * 8, -5, 21);
      if (!forward) this.speed *= Math.pow(0.78, dt);
      if (pressed(' ')) this.speed *= Math.pow(0.007, dt);
      this.yaw += turn * dt * (0.55 + Math.abs(this.speed) * 0.026);
      this.move(
        Math.sin(this.yaw) * this.speed * dt,
        Math.cos(this.yaw) * this.speed * dt,
      );
    } else {
      this.yaw += turn * dt * 1.45;
      const speed = pressed('shift') ? 12 : 4;
      this.move(
        Math.sin(this.yaw) * forward * speed * dt,
        Math.cos(this.yaw) * forward * speed * dt,
      );
    }
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    if (this.mode === 'walk') {
      this.e.camera.position
        .copy(this.position)
        .add(new THREE.Vector3(0, 1.75, 0));
      this.e.camera.lookAt(
        this.position
          .clone()
          .addScaledVector(dir, 30)
          .add(new THREE.Vector3(0, 1.75 - this.pitch * 25, 0)),
      );
    } else {
      this.car.position.copy(this.position);
      this.car.rotation.y = this.yaw;
      const pos = this.position
        .clone()
        .addScaledVector(dir, -14)
        .add(new THREE.Vector3(0, 6.3, 0));
      pos.y = Math.max(pos.y, this.e.elevation(pos.x, pos.z) + 2);
      if (this.snapCamera) this.e.camera.position.copy(pos);
      else this.e.camera.position.lerp(pos, 0.16);
      this.e.camera.lookAt(
        this.position
          .clone()
          .addScaledVector(dir, 7)
          .add(new THREE.Vector3(0, 1.4 - this.pitch * 10, 0)),
      );
    }
    this.e.controls.target.copy(this.position).addScaledVector(dir, 25);
    this.snapCamera = false;
    this.e.camera.near = 0.25;
    this.e.camera.updateProjectionMatrix();
  }
  destroy() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    const c = this.e.renderer.domElement;
    c.removeEventListener('pointerdown', this.pointerDown);
    c.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
  }
}

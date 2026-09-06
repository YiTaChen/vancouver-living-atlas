import * as THREE from 'three';
import type { StreetNavigation } from './navigation';
import { makeWalker } from './assets/walker';
import {
  TrafficStopState,
  inSpeedEnforcementArea,
  STOP_DURATIONS,
} from './traffic-stop-state';

/** A small original patrol car and animated officer, allocated once and hidden while idle. */
export class TrafficStop {
  state = new TrafficStopState();
  group = new THREE.Group();
  car = new THREE.Group();
  door = new THREE.Group();
  officer = makeWalker();
  lights: THREE.Mesh[] = [];
  private speaking = false;
  anchor = new THREE.Vector3();
  yaw = 0;
  age = 0;
  constructor(private nav: StreetNavigation) {
    const box = (
      parent: THREE.Group,
      size: number[],
      at: number[],
      color: number,
      glow = false,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...(size as [number, number, number])),
        glow
          ? new THREE.MeshBasicMaterial({ color })
          : new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
      );
      mesh.position.set(...(at as [number, number, number]));
      parent.add(mesh);
      return mesh;
    };
    this.group.name = 'Traffic stop — original patrol car and officer';
    box(this.car, [1.85, 0.55, 4.5], [0, 0.65, 0], 0x16202b);
    box(this.car, [1.88, 0.38, 2.2], [0, 1, 0], 0xf2f3ec);
    box(this.car, [1.55, 0.65, 2.05], [0, 1.48, -0.1], 0x263e4c);
    box(this.car, [1.65, 0.08, 2.15], [0, 1.84, -0.1], 0x16202b);
    for (const x of [-0.97, 0.97])
      for (const z of [-1.4, 1.4]) {
        const w = new THREE.Mesh(
          new THREE.CylinderGeometry(0.36, 0.36, 0.22, 16),
          new THREE.MeshStandardMaterial({ color: 0x17191d }),
        );
        w.rotation.z = Math.PI / 2;
        w.position.set(x, 0.38, z);
        this.car.add(w);
      }
    for (const x of [-0.6, 0.6]) {
      box(this.car, [0.4, 0.13, 0.08], [x, 0.92, 2.28], 0xffffdf, true);
      box(this.car, [0.4, 0.13, 0.08], [x, 0.92, -2.28], 0xd51d2b, true);
    }
    this.lights = [
      box(this.car, [0.55, 0.16, 0.3], [-0.33, 1.98, 0], 0xf32632, true),
      box(this.car, [0.55, 0.16, 0.3], [0.33, 1.98, 0], 0x227aff, true),
    ];
    this.door.position.set(0.95, 0.95, 0.75);
    box(this.door, [0.08, 0.8, 1.25], [0, 0.15, -0.6], 0xf0f2eb);
    this.car.add(this.door);
    for (const x of [-0.955, 0.955])
      box(this.car, [0.02, 0.22, 0.65], [x, 1, 0], 0x183759);
    this.officer.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (
          m.color &&
          [0x2c6c70, 0x205156, 0x9e6748].includes(m.color.getHex())
        )
          m.color.setHex(0x172e4a);
      }
    });
    box(this.officer.group, [0.27, 0.08, 0.29], [0, 1.76, 0], 0x152840);
    box(this.officer.group, [0.25, 0.025, 0.17], [0, 1.73, 0.17], 0x152840);
    box(this.officer.group, [0.065, 0.09, 0.035], [0.12, 1.32, 0.2], 0xdcc779);
    this.group.add(this.car, this.officer.group);
    this.group.visible = false;
    nav.e.scene.add(this.group);
  }
  get active() {
    return this.state.active;
  }
  get caption() {
    return this.state.phase === 'talk'
      ? 'please safe driving'
      : this.active
        ? 'Police stop · Please wait'
        : '';
  }
  cancel() {
    if (this.active) {
      this.nav.speed = 0;
      this.nav.keys.clear();
      this.nav.setTouchAxes(0, 0);
    }
    if (this.speaking && typeof speechSynthesis !== 'undefined')
      speechSynthesis.cancel();
    this.speaking = false;
    this.state.cancel();
    this.group.visible = false;
    this.door.rotation.y = 0;
  }
  world(x: number, z: number) {
    return new THREE.Vector3(
      this.anchor.x + Math.cos(this.yaw) * x + Math.sin(this.yaw) * z,
      this.anchor.y,
      this.anchor.z - Math.sin(this.yaw) * x + Math.cos(this.yaw) * z,
    );
  }
  supported(x: number, z: number) {
    const p = this.world(x, z);
    return (
      this.nav.clearGround(p.x, p.z, 'walk') &&
      Math.abs(this.nav.groundHeight(p.x, p.z) - this.anchor.y) < 1.5
    );
  }
  update(dt: number) {
    const n = this.nav,
      previous = this.state.phase;
    this.state.update(
      dt,
      n.speed,
      n.mode === 'drive' &&
        n.surface === 'ground' &&
        inSpeedEnforcementArea(n.position.x, n.position.z),
    );
    if (!this.active) {
      if (previous !== 'idle') {
        n.speed = 0;
        n.keys.clear();
        n.setTouchAxes(0, 0);
      }
      this.group.visible = false;
      return;
    }
    this.age += dt;
    this.group.visible = true;
    if (previous === 'idle') this.age = 0;
    if (previous === 'idle' || this.state.phase === 'braking') {
      this.anchor.copy(n.position);
      this.yaw = n.yaw;
    }
    if (previous === 'braking' && this.state.phase === 'exit') {
      // Avoid a scripted pedestrian crossing a wall, water or an unsupported deck.
      for (let z = -9; z <= 0; z += 0.3)
        if (!this.supported(1.7, z)) {
          this.cancel();
          return;
        }
    }
    if (
      this.state.phase === 'talk' &&
      previous !== 'talk' &&
      typeof speechSynthesis !== 'undefined'
    ) {
      const line = new SpeechSynthesisUtterance('please safe driving');
      line.lang = 'en-CA';
      line.rate = 0.9;
      line.onend = () => {
        this.speaking = false;
      };
      line.onerror = () => {
        this.speaking = false;
      };
      this.speaking = true;
      speechSynthesis.speak(line);
    }
    const phase = this.state.phase,
      t = Math.min(1, this.state.elapsed / (STOP_DURATIONS[phase] || 1));
    let cx = 0,
      cz = phase === 'braking' ? -9 - 15 * Math.exp(-this.age) : -9;
    if (phase === 'depart') {
      cx = Math.sin((Math.min(1, t * 3) * Math.PI) / 2) * 3.5;
      cz += t * 48;
      if (!this.supported(cx, cz)) {
        this.cancel();
        return;
      }
    }
    const cp = this.world(cx, cz);
    cp.y = n.groundHeight(cp.x, cp.z) + 0.04;
    this.car.position.copy(cp);
    this.car.rotation.y = this.yaw;
    this.lights.forEach(
      (l, i) => (l.visible = Math.floor(this.age * 5) % 2 === i),
    );
    this.door.rotation.y =
      phase === 'exit'
        ? -t * 1.15
        : phase === 'enter'
          ? -(1 - t) * 1.15
          : ['approach', 'talk', 'return'].includes(phase)
            ? -1.15
            : 0;
    this.officer.group.visible = [
      'exit',
      'approach',
      'talk',
      'return',
      'enter',
    ].includes(phase);
    const walk =
      phase === 'approach'
        ? t
        : phase === 'return'
          ? 1 - t
          : phase === 'talk'
            ? 1
            : 0;
    const ox =
      phase === 'exit'
        ? 0.6 + 1.1 * t
        : phase === 'enter'
          ? 1.7 - 1.1 * t
          : 1.7;
    const op = this.world(ox, -9 + 9 * walk);
    op.y = n.groundHeight(op.x, op.z) + 0.02;
    this.officer.group.position.copy(op);
    this.officer.group.rotation.y =
      this.yaw +
      (phase === 'return' ? Math.PI : phase === 'talk' ? -Math.PI / 2 : 0);
    this.officer.update(walk * 9, phase === 'approach' || phase === 'return');
  }
  destroy() {
    this.cancel();
    this.group.removeFromParent();
    const mats = new Set<THREE.Material>();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          mats.add(m);
      }
    });
    mats.forEach((m) => m.dispose());
  }
}

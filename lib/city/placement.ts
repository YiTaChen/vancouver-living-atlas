import * as THREE from 'three';
import type { CityEngine } from './engine';
import { lines, project, unproject } from './geo';
import {
  resolvePlacement,
  type PlacementResult,
  type PlacementWorld,
  type StreetMode,
} from './placement-geometry';

export interface PlacementPreview {
  result: PlacementResult;
  screen: [number, number];
  coordinate: [number, number];
  height: number;
  radius: number;
}

/** Pointer placement uses the rendered terrain plus explicit bridge deck surfaces. */
export class MapPlacement {
  mode: StreetMode | null = null;
  preview: PlacementPreview | null = null;
  onPreview: (value: PlacementPreview | null) => void = () => {};
  onCommit: (mode: StreetMode) => void = () => {};
  onCancel: () => void = () => {};
  raycaster = new THREE.Raycaster();
  bridgeMesh: THREE.Mesh;
  ring: THREE.Mesh;
  world: PlacementWorld;
  pointer: [number, number] | null = null;
  drag: {
    id: number;
    x: number;
    y: number;
    moved: boolean;
    figure: boolean;
  } | null = null;
  pointers = new Set<number>();
  multiTouch = false;
  raf = 0;
  lastPick = 0;
  savedDamping = true;
  constructor(public e: CityEngine) {
    const roads = e.data.roads.features
      .filter(
        (f: any) =>
          !/bikeway|private|bridge|causeway|path|trail|stairs|pedestrian/i.test(
            `${f.properties.class} ${f.properties.name}`,
          ),
      )
      .flatMap((f: any) =>
        lines(f).flatMap((line) => {
          const p = line.map(project);
          return p.slice(1).map((b, i) => ({
            a: p[i],
            b,
            name: String(f.properties.name || ''),
          }));
        }),
      );
    this.world = {
      roads,
      bridges: e.data.bridgeSurfaces.map((s: any) => ({
        ...s,
        name: s.name || '',
      })),
      elevation: (x, z) => e.elevation(x, z),
      contains: (x, z) => e.onLand(x, z),
      clear: (x, z) => e.navigation!.clearGround(x, z),
    };
    const positions: number[] = [];
    for (const s of this.world.bridges) {
      const dx = s.b[0] - s.a[0],
        dz = s.b[1] - s.a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.1) continue;
      const px = (dz / length) * (s.width! / 2 - 0.8),
        pz = (-dx / length) * (s.width! / 2 - 0.8);
      const a = [s.a[0] - px, s.h0!, s.a[1] - pz],
        b = [s.a[0] + px, s.h0!, s.a[1] + pz];
      const c = [s.b[0] + px, s.h1!, s.b[1] + pz],
        d = [s.b[0] - px, s.h1!, s.b[1] - pz];
      positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    this.bridgeMesh = new THREE.Mesh(
      e.geometry(positions),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    );
    this.bridgeMesh.updateMatrixWorld(true);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 48),
      new THREE.MeshBasicMaterial({
        color: 0xe3ed9c,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 1000;
    this.ring.visible = false;
    e.scene.add(this.ring);
    e.renderer.domElement.addEventListener(
      'pointerdown',
      this.pointerDown,
      true,
    );
    window.addEventListener('pointermove', this.pointerMove);
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerCancel);
    window.addEventListener('blur', this.pointerCancel);
    e.renderer.domElement.addEventListener('keydown', this.keyDown);
    e.controls.addEventListener('change', this.queue);
  }
  begin(mode: StreetMode) {
    const wasStreet = this.e.navigation!.mode !== 'orbit';
    const start = this.e.navigation!.position.clone();
    if (!this.mode) this.savedDamping = this.e.controls.enableDamping;
    this.e.navigation!.setMode('orbit');
    this.e.settings.mode = 'orbit';
    this.e.settings.autoRotate = false;
    this.e.controls.autoRotate = false;
    this.e.controls.enableDamping = false;
    this.e.transition = null;
    if (wasStreet) {
      this.e.controls.target.copy(start);
      this.e.camera.position.copy(start).add(new THREE.Vector3(160, 500, 240));
    }
    this.e.controls.update();
    this.mode = mode;
    this.drag = null;
    this.aimCentre();
  }
  aimCentre() {
    const r = this.e.renderer.domElement.getBoundingClientRect();
    this.pointer = [r.left + r.width / 2, r.top + r.height / 2];
    this.pick(true);
  }
  startDrag(event: PointerEvent) {
    if (!this.mode) return;
    this.pointers.add(event.pointerId);
    if (this.pointers.size > 1) this.multiTouch = true;
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      figure: true,
    };
  }
  pointerDown = (event: PointerEvent) => {
    if (!this.mode) return;
    this.pointers.add(event.pointerId);
    if (this.pointers.size > 1) {
      this.multiTouch = true;
      if (this.drag) this.drag.moved = true;
      return;
    }
    if (event.button !== 0) return;
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      figure: false,
    };
    this.pointer = [event.clientX, event.clientY];
  };
  overMap(x: number, y: number) {
    return document.elementFromPoint(x, y) === this.e.renderer.domElement;
  }
  pointerMove = (event: PointerEvent) => {
    if (!this.mode) return;
    if (this.drag && this.drag.id !== event.pointerId) return;
    if (
      this.drag &&
      Math.hypot(event.clientX - this.drag.x, event.clientY - this.drag.y) > 6
    )
      this.drag.moved = true;
    if (this.overMap(event.clientX, event.clientY)) {
      this.pointer = [event.clientX, event.clientY];
      this.queue();
    } else if (this.drag?.figure) {
      this.pointer = null;
      this.preview = null;
      this.ring.visible = false;
      this.onPreview(null);
    }
  };
  pointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId);
    const interrupted = this.multiTouch;
    if (!this.pointers.size) this.multiTouch = false;
    const drag = this.drag;
    if (!this.mode || !drag || drag.id !== event.pointerId) return;
    this.drag = null;
    const shouldPlace = drag.figure ? drag.moved : !drag.moved;
    if (
      !interrupted &&
      shouldPlace &&
      this.overMap(event.clientX, event.clientY)
    ) {
      this.pointer = [event.clientX, event.clientY];
      this.pick(true);
      this.commit();
    }
  };
  pointerCancel = () => {
    this.drag = null;
    this.pointers.clear();
    this.multiTouch = false;
  };
  keyDown = (event: KeyboardEvent) => {
    if (!this.mode) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.aimCentre();
      this.commit();
    }
  };
  queue = () => {
    if (!this.mode || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (performance.now() - this.lastPick < 45) {
        this.queue();
        return;
      }
      this.pick();
    });
  };
  pick(_force = false) {
    if (!this.mode || !this.pointer) return;
    this.lastPick = performance.now();
    const r = this.e.renderer.domElement.getBoundingClientRect();
    const [sx, sy] = this.pointer;
    this.e.camera.updateMatrixWorld();
    this.raycaster.far = 45000;
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((sx - r.left) / r.width) * 2 - 1,
        1 - ((sy - r.top) / r.height) * 2,
      ),
      this.e.camera,
    );
    const hits = this.raycaster.intersectObjects(
      [this.e.terrain.children[0], this.bridgeMesh, this.e.water],
      false,
    );
    const hit = hits[0];
    this.ring.visible = false;
    if (!hit) {
      this.preview = null;
      this.onPreview(null);
      return;
    }
    const bridge = hit.object === this.bridgeMesh;
    const point = hit.point;
    const radius = Math.max(
      4,
      Math.min(
        30,
        ((hit.distance *
          2 *
          Math.tan(THREE.MathUtils.degToRad(this.e.camera.fov / 2))) /
          r.height) *
          14,
      ),
    );
    let result: PlacementResult;
    if (hit.object === this.e.water)
      result = { valid: false, reason: 'placementInvalid' };
    else {
      const direction = this.e.camera.getWorldDirection(new THREE.Vector3());
      result = resolvePlacement(
        this.mode,
        {
          x: point.x,
          y: point.y,
          z: point.z,
          surface: bridge ? 'bridge' : 'ground',
        },
        this.world,
        radius,
        Math.atan2(direction.x, direction.z),
      );
      // Do not place through a visible tower or a landmark roof.
      if (result.valid) {
        this.raycaster.far = hit.distance - 2;
        const obstacles = [
          ...(this.e.buildings.visible ? this.e.buildings.children : []),
          ...this.e.landmarks.children,
        ];
        const front = this.raycaster.intersectObjects(obstacles, true)[0];
        if (front && front.point.y > point.y + 3)
          result = { valid: false, reason: 'placementInvalid' };
      }
    }
    const position = result.valid
      ? new THREE.Vector3(result.point.x, result.point.y, result.point.z)
      : point;
    this.ring.position.copy(position).add(new THREE.Vector3(0, 0.3, 0));
    this.ring.scale.setScalar(radius);
    (this.ring.material as THREE.MeshBasicMaterial).color.set(
      result.valid ? 0xe3ed9c : 0xff7769,
    );
    this.ring.visible = true;
    const projected = position.clone().project(this.e.camera);
    this.preview = {
      result,
      screen: [
        r.left + ((projected.x + 1) * r.width) / 2,
        r.top + ((1 - projected.y) * r.height) / 2,
      ],
      coordinate: unproject(position.x, position.z),
      height: position.y,
      radius,
    };
    this.onPreview(this.preview);
  }
  commit() {
    if (!this.mode || !this.preview?.result.valid) return false;
    const mode = this.mode,
      point = this.preview.result.point;
    this.finish();
    this.e.navigation!.startAt(mode, point);
    this.e.settings.mode = mode;
    this.onCommit(mode);
    return true;
  }
  finish() {
    this.mode = null;
    this.preview = null;
    this.ring.visible = false;
    this.drag = null;
    this.pointers.clear();
    this.e.controls.enableDamping = this.savedDamping;
    this.multiTouch = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onPreview(null);
  }
  cancel() {
    if (this.mode) {
      this.finish();
      this.onCancel();
    }
  }
  destroy() {
    this.finish();
    this.e.renderer.domElement.removeEventListener(
      'pointerdown',
      this.pointerDown,
      true,
    );
    this.e.renderer.domElement.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerCancel);
    window.removeEventListener('blur', this.pointerCancel);
    this.e.controls.removeEventListener('change', this.queue);
    this.bridgeMesh.geometry.dispose();
    (this.bridgeMesh.material as THREE.Material).dispose();
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
  }
}

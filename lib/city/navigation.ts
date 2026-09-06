import * as THREE from 'three';
import { bridgeSurface } from './bridges';
import { trimRoad } from './road-trim';
import {
  resolveSurfaceStep,
  sampleKnownSurface,
  type SurfaceHit,
} from './surface-reachability';
import type { TravelSurfaceIndex } from './travel-surfaces';
import type { CityEngine } from './engine';
import { project, rings, lines, inPolygon } from './geo';
import type { Feature } from './types';
import landmarkFootprints from './landmark-footprints.json';
import {
  canSwitchStreetMode,
  closestOnSegment,
  type RoadSegment,
  type PlacementPoint,
  type TravelMode,
} from './placement-geometry';
import { BoatController } from './boat-controller';
import { makeWalker } from './assets/walker';
import { GroundSurfaceIndex, walkableGroundMeshes } from './ground-surface';
import { DriverCameraMotion, DRIVER_LEFT_OFFSET } from './driver-camera';
import type { TravelBookmark } from './travel-return';
import { makeCockpit } from './assets/cockpits';
import {
  firstPerson,
  TRAVEL_DEFAULT_DISTANCE,
  zoomTravel,
  type InteriorView,
  type TravelView,
} from './travel-camera';
export class StreetNavigation {
  mode: 'orbit' | TravelMode = 'orbit';
  keys = new Set<string>();
  position = new THREE.Vector3();
  yaw = 0;
  driveLookYaw = 0;
  driverMotion = new DriverCameraMotion();
  steeringPulse: { turn: number; remaining: number } | null = null;
  returnBlend: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    fov: number;
    elapsed: number;
  } | null = null;
  pitch = 0.04;
  speed = 0;
  surface: 'ground' | 'bridge' | 'water' = 'ground';
  surfaceId: string | undefined;
  surfaceLayer: number | undefined;
  snapCamera = false;
  dragging = false;
  last = [0, 0];
  car = new THREE.Group();
  boat: BoatController;
  cameraDistances = { ...TRAVEL_DEFAULT_DISTANCE };
  renderedDistance = 0;
  interiors: Record<'drive' | 'boat', InteriorView> = {
    drive: 'interior',
    boat: 'interior',
  };
  walker = makeWalker();
  walkingDistance = 0;
  cockpits = { drive: makeCockpit('drive'), boat: makeCockpit('boat') };
  cameraSignature = '';
  cameraDOMSignature = '';
  groundSurface: GroundSurfaceIndex | null = null;
  touches = new Map<number, [number, number]>();
  blockedPointers = new Set<number>();
  pinchDistance = 0;
  wheelQuietUntil = 0;
  steering = 0;
  collisions = new Map<string, number[][][][]>();
  constructor(public e: CityEngine) {
    this.boat = new BoatController(e);
    this.walker.group.visible = false;
    this.walker.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
    // Cheap contact shadow follows the walker without refreshing city shadow maps.
    for (const [radius, opacity] of [
      [0.24, 0.14],
      [0.36, 0.08],
      [0.5, 0.035],
    ]) {
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 24),
        new THREE.MeshBasicMaterial({
          color: 0x15272c,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.012 + radius * 0.01;
      shadow.scale.y = 0.7;
      this.walker.group.add(shadow);
    }
    this.cockpits.drive.visible = this.cockpits.boat.visible = false;
    e.scene.add(this.walker.group);
    if (!e.camera.parent) e.scene.add(e.camera);
    e.camera.add(this.cockpits.drive, this.cockpits.boat);
    // Keep instruments and the steering wheel above the bottom HUD.
    this.cockpits.boat.position.set(0, 0.2, -0.22);
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
    canvas.addEventListener('wheel', this.wheel, {
      passive: false,
      capture: true,
    });
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointermove', this.pointerMove, true);
    window.addEventListener('pointerup', this.pointerUp, true);
    window.addEventListener('pointercancel', this.pointerUp, true);
  }
  keyDown = (ev: KeyboardEvent) => {
    if (
      this.mode === 'orbit' ||
      ev.defaultPrevented ||
      ev.ctrlKey ||
      ev.metaKey ||
      ev.altKey ||
      (ev.target instanceof Element &&
        ev.target.closest(
          'select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="option"], [role="dialog"]',
        )) ||
      ev.target instanceof HTMLInputElement ||
      ev.target instanceof HTMLTextAreaElement
    )
      return;
    const k = this.movementKey(ev);
    if (ev.target instanceof Element) {
      // Space activates a focused button; arrow keys belong to value selectors.
      // WASD remains available after using an ordinary HUD control.
      if (
        k === ' ' &&
        ev.target.closest('button, a, [role="radio"], [role="slider"]')
      )
        return;
      if (
        k.startsWith('arrow') &&
        ev.target.closest('[role="radio"], [role="slider"]')
      )
        return;
    }
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
  movementKey(ev: KeyboardEvent) {
    const codes: Record<string, string> = {
      KeyW: 'w',
      KeyA: 'a',
      KeyS: 's',
      KeyD: 'd',
      ArrowUp: 'arrowup',
      ArrowDown: 'arrowdown',
      ArrowLeft: 'arrowleft',
      ArrowRight: 'arrowright',
      ShiftLeft: 'shift',
      ShiftRight: 'shift',
      Space: ' ',
    };
    return codes[ev.code] || ev.key.toLowerCase();
  }
  keyUp = (ev: KeyboardEvent) => {
    this.keys.delete(this.movementKey(ev));
  };
  blur = () => {
    this.keys.clear();
    this.dragging = false;
    this.touches.clear();
    this.pinchDistance = 0;
    this.speed = 0;
    this.steeringPulse = null;
    if (this.boat) {
      this.boat.pulse = null;
      this.boat.state.throttle = 0;
    }
  };
  get cameraDistance() {
    return this.mode === 'orbit' ? 0 : this.cameraDistances[this.mode];
  }
  get cameraView(): TravelView {
    return {
      mode: this.mode,
      perspective:
        this.mode !== 'orbit' && firstPerson(this.mode, this.renderedDistance)
          ? 'first'
          : 'third',
      interior:
        this.mode === 'drive' || this.mode === 'boat'
          ? this.interiors[this.mode]
          : 'clear',
    };
  }
  notifyCamera() {
    const view = this.cameraView,
      signature = JSON.stringify(view);
    const distance = this.cameraDistance.toFixed(2);
    const domSignature = signature + distance;
    if (domSignature !== this.cameraDOMSignature) {
      const canvas = this.e.renderer.domElement;
      canvas.setAttribute?.('data-travel-mode', this.mode);
      canvas.setAttribute?.('data-camera-view', view.perspective);
      canvas.setAttribute?.('data-camera-distance', distance);
      this.cameraDOMSignature = domSignature;
    }
    if (signature === this.cameraSignature) return;
    this.cameraSignature = signature;
    this.e.onTravelView?.(view);
  }
  setInterior(view: InteriorView) {
    if (this.mode !== 'drive' && this.mode !== 'boat') return;
    this.interiors[this.mode] = view;
    this.updateCockpit(0, 0);
    this.notifyCamera();
  }
  zoom(factor: number) {
    if (this.mode === 'orbit') return;
    const next = zoomTravel(this.cameraDistance, factor);
    if (next.exit) {
      this.wheelQuietUntil = performance.now() + 450;
      this.touches.forEach((_, id) => this.blockedPointers.add(id));
      this.e.leaveTravelAtLocation(true);
      return;
    }
    this.cameraDistances[this.mode] = next.distance;
    this.notifyCamera();
  }
  wheel = (ev: WheelEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (this.mode === 'orbit') {
      if (performance.now() >= this.wheelQuietUntil) return;
      // Consume the remainder of the same gesture after switching to Orbit.
      this.wheelQuietUntil = performance.now() + 180;
    } else {
      const pixels =
        ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 600 : 1);
      this.zoom(Math.exp(THREE.MathUtils.clamp(pixels * 0.003, -0.7, 0.7)));
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  pointerDown = (ev: PointerEvent) => {
    if (this.mode === 'orbit') return;
    this.e.renderer.domElement.focus({ preventScroll: true });
    if (ev.pointerType === 'touch') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.e.renderer.domElement.setPointerCapture?.(ev.pointerId);
      this.touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.touches.size > 1) {
        const [a, b] = [...this.touches.values()];
        this.pinchDistance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.dragging = false;
        return;
      }
    }
    this.dragging = true;
    this.last = [ev.clientX, ev.clientY];
  };
  pointerMove = (ev: PointerEvent) => {
    if (this.blockedPointers.has(ev.pointerId)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      return;
    }
    if (this.mode === 'orbit') return;
    if (this.touches.has(ev.pointerId)) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      this.touches.set(ev.pointerId, [ev.clientX, ev.clientY]);
      if (this.touches.size > 1) {
        const [a, b] = [...this.touches.values()];
        const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (this.pinchDistance > 4 && distance > 4)
          this.zoom(this.pinchDistance / distance);
        this.pinchDistance = distance;
        return;
      }
    }
    if (!this.dragging) return;
    if (this.mode === 'boat')
      this.boat.lookYaw -= (ev.clientX - this.last[0]) * 0.004;
    else if (this.mode === 'drive')
      this.driveLookYaw = THREE.MathUtils.clamp(
        this.driveLookYaw - (ev.clientX - this.last[0]) * 0.004,
        -1.2,
        1.2,
      );
    else this.yaw -= (ev.clientX - this.last[0]) * 0.004;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + (ev.clientY - this.last[1]) * 0.003,
      -0.7,
      0.7,
    );
    this.last = [ev.clientX, ev.clientY];
  };
  pointerUp = (ev: PointerEvent) => {
    if (this.blockedPointers.delete(ev.pointerId))
      ev.stopImmediatePropagation();
    this.touches.delete(ev.pointerId);
    this.pinchDistance = 0;
    const remaining = [...this.touches.values()][0];
    this.dragging = this.mode !== 'orbit' && this.touches.size === 1;
    if (this.dragging && remaining) this.last = [...remaining];
  };
  blocked(x: number, z: number) {
    const index = this.e.data.travelSurfaces as TravelSurfaceIndex | undefined;
    if (
      index &&
      (index.surfaceIds.has(this.surfaceId || '') || index.lookup(x, z).length)
    )
      return this.protectedStep(x, z) === undefined;
    if (this.reachableDeck(x, z) !== undefined) return false;
    if (
      this.surface === 'bridge' &&
      Math.abs(this.e.elevation(x, z) + 1.25 - this.position.y) > 4
    )
      return true;
    return !this.clearGround(x, z);
  }
  reachableDeck(x: number, z: number) {
    const deck = bridgeSurface(this.e, x, z, this.position.y, {
      excludeProtected: true,
    });
    if (deck === undefined) return undefined;
    if (
      this.surface === 'bridge' ||
      Math.abs(deck - this.e.elevation(x, z) - 1.25) < 0.8
    )
      return deck;
    return undefined;
  }
  /** Protected upper floors cannot fall back to the highest nearby mesh. */
  protectedStep(x: number, z: number): SurfaceHit | undefined {
    if (this.mode !== 'walk' && this.mode !== 'drive') return undefined;
    const index = this.e.data.travelSurfaces as TravelSurfaceIndex;
    const lookup = (xx: number, zz: number): SurfaceHit[] => {
      const hits = index.lookup(xx, zz);
      if (this.clearGround(xx, zz))
        hits.push({
          surfaceId: 'ground',
          layer: 0,
          y:
            this.mode === 'walk'
              ? this.groundHeight(xx, zz)
              : this.roadHeight(xx, zz) - 0.2,
          allowedModes: ['walk', 'drive'],
          legacySurface: 'ground',
        });
      return hits;
    };
    const identity = index.surfaceIds.has(this.surfaceId || '')
      ? { surfaceId: this.surfaceId!, layer: this.surfaceLayer ?? 1 }
      : { surfaceId: 'ground', layer: 0 };
    const currentY =
      identity.surfaceId === 'ground'
        ? this.mode === 'walk'
          ? this.groundHeight(this.position.x, this.position.z)
          : this.roadHeight(this.position.x, this.position.z) - 0.2
        : this.position.y;
    const result = resolveSurfaceStep({
      current: {
        ...identity,
        x: this.position.x,
        z: this.position.z,
        y: currentY,
      },
      to: [x, z],
      mode: this.mode,
      lookup,
      connections: this.e.data.causewayConnections || [],
    });
    return result.ok ? result.hit : undefined;
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
  startAt(mode: TravelMode, point: PlacementPoint) {
    this.e.travelReturn?.invalidate(true);
    this.returnBlend = null;
    this.driverMotion.reset();
    this.steering = 0;
    this.steeringPulse = null;
    this.driveLookYaw = 0;
    if (mode === 'boat' && !this.boat.start(point)) return false;
    if (mode !== 'boat') this.boat.stop();
    this.blur();
    this.mode = mode;
    this.car.visible = mode === 'drive';
    this.e.controls.enabled = false;
    this.e.transition = null;
    this.position.set(point.x, point.y, point.z);
    this.surface = point.surface;
    this.surfaceId = point.surfaceId;
    this.surfaceLayer = point.layer;
    this.yaw = point.yaw;
    this.pitch = 0.04;
    this.snapCamera = true;
    this.update(0);
    this.e.renderer.domElement.focus({ preventScroll: true });
    return true;
  }
  rehomeStreetSurface(mode: 'walk' | 'drive') {
    const index = this.e.data.travelSurfaces as TravelSurfaceIndex | undefined;
    if (
      index?.surfaceIds.has(this.surfaceId || '') &&
      (mode === 'walk' || mode === 'drive') &&
      !sampleKnownSurface(
        index.lookup(this.position.x, this.position.z),
        { surfaceId: this.surfaceId!, layer: this.surfaceLayer ?? 1 },
        mode,
      )
    ) {
      // Bridge footways and roadway are separate. A deliberate mode switch
      // uses the adjacent same-height corridor, keeping the local camera.
      let selected:
        | {
            s: RoadSegment;
            p: NonNullable<ReturnType<typeof closestOnSegment>>;
            hit: SurfaceHit;
          }
        | undefined;
      for (const s of this.e.data.bridgeSurfaces as RoadSegment[]) {
        if (!s.protectedSurface || !s.allowedModes?.includes(mode)) continue;
        const p = closestOnSegment(this.position.x, this.position.z, s);
        if (
          !p ||
          p.distance > 35 ||
          (selected && p.distance >= selected.p.distance)
        )
          continue;
        const hit = sampleKnownSurface(
          index.lookup(p.x, p.z),
          { surfaceId: s.surfaceId!, layer: s.layer! },
          mode,
        );
        if (!hit || Math.abs(hit.y - this.position.y) > 0.35) continue;
        selected = { s, p, hit };
      }
      if (selected) {
        this.position.set(selected.p.x, selected.hit.y, selected.p.z);
        this.surfaceId = selected.hit.surfaceId;
        this.surfaceLayer = selected.hit.layer;
      } else return false;
    }
    return true;
  }
  switchStreetMode(mode: 'orbit' | TravelMode) {
    if (!canSwitchStreetMode(this.mode, mode)) return false;
    if (mode !== this.mode) {
      if (
        (mode === 'walk' || mode === 'drive') &&
        !this.rehomeStreetSurface(mode)
      )
        return false;
      this.blur();
      this.mode = mode;
      this.driveLookYaw = 0;
      this.driverMotion.reset();
      this.steering = 0;
      this.steeringPulse = null;
      this.car.visible = mode === 'drive';
      this.e.controls.enabled = false;
      this.e.transition = null;
      // Retain exact position, ground/bridge layer and look direction.
      this.snapCamera = true;
      this.update(0);
    }
    return true;
  }
  setMode(mode: 'orbit' | TravelMode, streetName?: string) {
    if (mode === this.mode && !streetName) return;
    this.e.travelReturn?.invalidate(true);
    this.returnBlend = null;
    this.driverMotion.reset();
    this.steering = 0;
    this.steeringPulse = null;
    this.driveLookYaw = 0;
    if (!streetName && this.switchStreetMode(mode)) return;
    if (mode === 'boat') {
      this.startWater(streetName || 'coal-harbour');
      return;
    }
    this.boat.stop();
    this.keys.clear();
    this.speed = 0;
    this.mode = mode;
    this.car.visible = mode === 'drive';
    this.e.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      this.blur();
      this.walker.group.visible = false;
      this.cockpits.drive.visible = this.cockpits.boat.visible = false;
      this.e.camera.fov = 42;
      this.e.camera.up.set(0, 1, 0);
      this.e.camera.near = 2;
      this.notifyCamera();
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
      for (const [part, line] of lines(f).entries()) {
        const sourceIndex = this.e.data.roads.features.indexOf(f);
        for (const p of trimRoad(
          line.map(project),
          this.e.data.causeway?.cuts.get(`${sourceIndex}:${part}`) || [],
        )) {
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
              chosen = [[...a], [...b]];
            }
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
    this.surfaceId = undefined;
    this.surfaceLayer = undefined;
    this.position.y = this.roadHeight(this.position.x, this.position.z);
    this.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.pitch = 0.04;
    this.snapCamera = true;
    this.update(0.016);
    this.e.renderer.domElement.focus();
  }
  startWater(id: string) {
    const start = this.e.waterWorld.start(id);
    if (!start) return false;
    return this.startAt('boat', {
      x: start.x,
      z: start.z,
      y: start.surface.level,
      yaw: 0,
      surface: 'water',
      waterId: start.surface.id,
      name: start.surface.name,
      snappedDistance: 0,
    });
  }
  hold(direction: string, active: boolean) {
    const key: Record<string, string> = {
      forward: 'w',
      backward: 's',
      left: 'a',
      right: 'd',
      neutral: ' ',
    };
    if (!key[direction]) return;
    if (active) {
      this.keys.add(key[direction]);
      this.boat.pulse = null;
    } else this.keys.delete(key[direction]);
  }
  startBridge(kind: string) {
    const s = this.e.data.bridges?.mainSpines.find((s: any) => s.kind === kind);
    if (!s || this.mode === 'orbit' || this.mode === 'boat') return;
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
    this.surfaceId = kind === 'lions' ? 'lions:road' : undefined;
    this.surfaceLayer = kind === 'lions' ? 1 : undefined;
    if (kind === 'lions') this.rehomeStreetSurface(this.mode);
    this.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    this.pitch = 0;
    this.snapCamera = true;
    this.update(0.016);
    this.e.renderer.domElement.focus();
  }
  step(direction: string) {
    if (this.mode === 'orbit') return;
    this.e.renderer.domElement.focus({ preventScroll: true });
    if (this.mode === 'boat') {
      this.boat.pulse = { key: direction, remaining: 0.7 };
      return;
    }
    if (direction === 'left' || direction === 'right') {
      const turn = direction === 'left' ? 1 : -1;
      this.yaw += turn * 0.15;
      this.steeringPulse = { turn, remaining: 0.22 };
    } else {
      const s = direction === 'backward' ? -8 : 8;
      this.move(Math.sin(this.yaw) * s, Math.cos(this.yaw) * s);
    }
    this.update(0.016);
  }
  move(dx: number, dz: number) {
    if (this.mode === 'boat') return;
    if (Math.hypot(dx, dz) < 1e-9) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 1.5));
    for (let i = 0; i < steps; i++) {
      const x = this.position.x + dx / steps,
        z = this.position.z + dz / steps;
      const index = this.e.data.travelSurfaces as
        | TravelSurfaceIndex
        | undefined;
      if (
        index &&
        (index.surfaceIds.has(this.surfaceId || '') ||
          index.lookup(x, z).length)
      ) {
        const hit = this.protectedStep(x, z);
        if (!hit) {
          this.speed = 0;
          break;
        }
        this.position.set(x, hit.y + (hit.surfaceId === 'ground' ? 0.2 : 0), z);
        this.surface = hit.surfaceId === 'ground' ? 'ground' : 'bridge';
        this.surfaceId = hit.surfaceId;
        this.surfaceLayer = hit.layer;
        continue;
      }
      if (!this.blocked(x, z)) {
        const deck = this.reachableDeck(x, z);
        this.position.x = x;
        this.position.z = z;
        this.position.y = deck ?? this.roadHeight(x, z);
        this.surface = deck === undefined ? 'ground' : 'bridge';
        this.surfaceId = undefined;
        this.surfaceLayer = undefined;
      } else {
        this.speed = 0;
        break;
      }
    }
  }
  roadHeight(x: number, z: number) {
    const fallback = this.e.elevation(x, z) + 1.05;
    return (this.e.data?.roadSurface?.sample(x, z, fallback) ?? fallback) + 0.2;
  }
  update(dt: number) {
    if (this.mode === 'orbit') return;
    dt = Math.max(0, Math.min(0.05, dt));
    this.renderedDistance = this.snapCamera
      ? this.cameraDistance
      : THREE.MathUtils.lerp(
          this.renderedDistance,
          this.cameraDistance,
          1 - Math.exp(-dt * 12),
        );
    const before = this.position.clone();
    const previousSpeed = this.speed,
      previousYaw = this.yaw;
    this.walker.group.visible =
      this.mode === 'walk' && this.renderedDistance >= 2;
    this.car.visible = this.mode === 'drive' && this.renderedDistance > 3.5;
    this.e.camera.up.set(0, 1, 0);
    const pressed = (...s: string[]) => s.some((k) => this.keys.has(k)),
      forward =
        Number(pressed('w', 'arrowup')) - Number(pressed('s', 'arrowdown')),
      turn =
        Number(pressed('a', 'arrowleft')) - Number(pressed('d', 'arrowright'));
    if (this.mode === 'boat') {
      const input = { thrust: forward, turn, neutral: pressed(' ') };
      this.boat.update(
        dt,
        input,
        this.pitch,
        this.snapCamera || !!this.returnBlend,
        this.renderedDistance,
      );
      this.position.copy(this.boat.model.position);
      this.yaw = this.boat.state.yaw;
      this.speed = this.boat.state.speed;
      this.finishReturnBlend(dt);
      this.updateCockpit(dt, input.turn);
      this.notifyCamera();
      this.snapCamera = false;
      return;
    }
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
    if (this.mode === 'drive')
      this.driverMotion.update(
        dt,
        this.speed,
        previousSpeed,
        this.yaw - previousYaw,
      );
    const distance = this.renderedDistance;
    const viewYaw = this.yaw + (this.mode === 'drive' ? this.driveLookYaw : 0);
    const dir = new THREE.Vector3(Math.sin(viewYaw), 0, Math.cos(viewYaw));
    const walked = this.position.distanceTo(before);
    this.walkingDistance += walked;
    this.walker.group.position.copy(this.position);
    if (this.mode === 'walk')
      this.walker.group.position.y = this.walkingHeight();
    this.walker.group.rotation.y = this.yaw;
    if (this.mode === 'walk')
      this.walker.update(this.walkingDistance, walked > 0.0001);
    this.car.position.copy(this.position);
    this.car.rotation.y = this.yaw;
    const eyeHeight = this.mode === 'walk' ? 1.68 : 1.45;
    const eye = (
      this.mode === 'walk' ? this.walker.group.position : this.position
    )
      .clone()
      .add(new THREE.Vector3(0, eyeHeight, 0));
    const blend = THREE.MathUtils.smoothstep(
      distance,
      0,
      this.mode === 'walk' ? 2 : 5,
    );
    if (this.mode === 'drive') {
      const left = new THREE.Vector3(
        Math.cos(this.yaw),
        0,
        -Math.sin(this.yaw),
      );
      const forward = new THREE.Vector3(
        Math.sin(this.yaw),
        0,
        Math.cos(this.yaw),
      );
      eye.addScaledVector(
        left,
        (DRIVER_LEFT_OFFSET + this.driverMotion.sway) * (1 - blend),
      );
      eye.addScaledVector(forward, this.driverMotion.surge * (1 - blend));
    }
    const pos = eye.clone().addScaledVector(dir, -distance * blend);
    pos.y += distance * (this.mode === 'walk' ? 0.28 : 0.35) * blend;
    // Clip the chase segment at walls/banks; collision checks never move the player.
    const steps = Math.ceil(distance / 1.5);
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const x = eye.x + (pos.x - eye.x) * t,
        z = eye.z + (pos.z - eye.z) * t;
      if (!this.clearGround(x, z) && this.surface !== 'bridge') {
        pos.x = eye.x + ((pos.x - eye.x) * (step - 1)) / steps;
        pos.z = eye.z + ((pos.z - eye.z) * (step - 1)) / steps;
        break;
      }
    }
    if (blend > 0.5)
      pos.y = Math.max(pos.y, this.e.elevation(pos.x, pos.z) + 2);
    // Distance itself is eased, so the eye remains attached to movement without drift.
    this.e.camera.position.copy(pos);
    this.e.camera.lookAt(
      eye
        .clone()
        .addScaledVector(
          dir,
          THREE.MathUtils.lerp(
            25,
            this.mode === 'walk'
              ? Math.min(1.5, Math.max(0, distance - 2) * 0.75)
              : 2,
            blend,
          ),
        )
        .add(
          new THREE.Vector3(
            0,
            -(this.mode === 'walk' ? 0.5 : 0.25) * blend -
              this.pitch * (25 - blend * (this.mode === 'walk' ? 20 : 15)),
            0,
          ),
        ),
    );
    if (this.mode === 'drive') {
      this.e.camera.quaternion.premultiply(
        this.driverMotion.worldRotation(this.yaw, 1 - blend),
      );
    }
    this.e.controls.target.copy(this.position).addScaledVector(dir, 25);
    this.e.camera.near = 0.08;
    this.e.camera.fov = THREE.MathUtils.lerp(58, 48, blend);
    this.e.camera.updateProjectionMatrix();
    this.finishReturnBlend(dt);
    this.updateCockpit(dt, turn);
    this.notifyCamera();
    this.snapCamera = false;
  }
  walkingHeight() {
    if (this.surface === 'bridge') return this.position.y;
    return this.groundHeight(this.position.x, this.position.z) + 0.02;
  }
  groundHeight(x: number, z: number) {
    if (!this.groundSurface) {
      this.groundSurface = new GroundSurfaceIndex(
        walkableGroundMeshes(this.e.scene),
      );
    }
    return (
      this.groundSurface.sample(x, z, this.e.elevation(x, z) + 1.25) ??
      this.e.elevation(x, z)
    );
  }
  snapshotTravel(): TravelBookmark | null {
    if (this.mode === 'orbit') return null;
    return {
      mode: this.mode,
      position: this.position.clone(),
      yaw: this.yaw,
      pitch: this.pitch,
      lookYaw: this.mode === 'boat' ? this.boat.lookYaw : this.driveLookYaw,
      surface: this.surface,
      surfaceId: this.surfaceId,
      layer: this.surfaceLayer,
      waterId: this.mode === 'boat' ? this.boat.state.surfaceId : undefined,
      distance: this.cameraDistance,
      interior: this.cameraView.interior,
    };
  }
  restoreFromMap(saved: TravelBookmark) {
    const from = {
      position: this.e.camera.position.clone(),
      quaternion: this.e.camera.quaternion.clone(),
      fov: this.e.camera.fov,
      elapsed: 0,
    };
    this.cameraDistances[saved.mode] = saved.distance;
    if (saved.mode !== 'walk') this.interiors[saved.mode] = saved.interior;
    if (
      !this.startAt(saved.mode, {
        x: saved.position.x,
        y: saved.position.y,
        z: saved.position.z,
        yaw: saved.yaw,
        surface: saved.surface,
        surfaceId: saved.surfaceId,
        layer: saved.layer,
        waterId: saved.waterId,
        name: '',
        snappedDistance: 0,
      })
    )
      return false;
    this.pitch = saved.pitch;
    if (saved.mode === 'boat') this.boat.lookYaw = saved.lookYaw;
    else if (saved.mode === 'drive') this.driveLookYaw = saved.lookYaw;
    this.snapCamera = true;
    this.update(0);
    this.returnBlend = from;
    this.e.camera.position.copy(from.position);
    this.e.camera.quaternion.copy(from.quaternion);
    this.e.camera.fov = from.fov;
    this.e.camera.updateProjectionMatrix();
    return true;
  }
  finishReturnBlend(dt: number) {
    const blend = this.returnBlend;
    if (!blend) return;
    blend.elapsed += dt;
    const t = THREE.MathUtils.smoothstep(blend.elapsed, 0, 0.45);
    this.e.camera.position.lerpVectors(
      blend.position,
      this.e.camera.position,
      t,
    );
    this.e.camera.quaternion.slerpQuaternions(
      blend.quaternion,
      this.e.camera.quaternion,
      t,
    );
    this.e.camera.fov = THREE.MathUtils.lerp(blend.fov, this.e.camera.fov, t);
    this.e.camera.updateProjectionMatrix();
    if (t === 1) this.returnBlend = null;
  }
  updateCockpit(dt: number, turn: number) {
    if (this.steeringPulse) {
      if (!turn) turn = this.steeringPulse.turn;
      this.steeringPulse.remaining -= dt;
      if (this.steeringPulse.remaining <= 0) this.steeringPulse = null;
    }
    this.steering = THREE.MathUtils.lerp(
      this.steering,
      turn,
      1 - Math.exp(-dt * 7),
    );
    for (const mode of ['drive', 'boat'] as const) {
      const cockpit = this.cockpits[mode];
      cockpit.visible =
        this.mode === mode &&
        !this.returnBlend &&
        firstPerson(mode, this.renderedDistance) &&
        this.interiors[mode] === 'interior';
      if (!cockpit.visible) continue;
      const {
        speedGauge: spec,
        speedNeedle,
        steeringWheel,
        steeringMaxRadians,
      } = cockpit.userData;
      const value = Math.abs(this.speed) * spec.metresPerSecondMultiplier;
      speedNeedle.rotation.z = THREE.MathUtils.lerp(
        spec.startAngle,
        spec.endAngle,
        Math.min(1, value / spec.maxSpeed),
      );
      steeringWheel.rotation.z = this.steering * steeringMaxRadians;
      if (mode === 'drive') {
        // Interior remains attached to the car while the driver's head looks/moves.
        const base = this.position
          .clone()
          .add(
            new THREE.Vector3(
              Math.cos(this.yaw) * DRIVER_LEFT_OFFSET,
              1.45,
              -Math.sin(this.yaw) * DRIVER_LEFT_OFFSET,
            ),
          );
        const inverse = this.e.camera.quaternion.clone().invert();
        cockpit.position
          .copy(base)
          .sub(this.e.camera.position)
          .applyQuaternion(inverse);
        cockpit.quaternion
          .copy(inverse)
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              this.yaw + Math.PI,
            ),
          );
      }
    }
  }

  destroy() {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    const c = this.e.renderer.domElement;
    c.removeEventListener('wheel', this.wheel, true);
    c.removeEventListener('pointerdown', this.pointerDown, true);
    c.removeEventListener('pointermove', this.pointerMove, true);
    window.removeEventListener('pointerup', this.pointerUp, true);
    window.removeEventListener('pointercancel', this.pointerUp, true);
    this.touches.clear();
    this.blockedPointers.clear();
    this.groundSurface = null;
  }
}

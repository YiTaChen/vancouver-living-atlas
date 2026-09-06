import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { TravelMode } from './placement-geometry';
import type { InteriorView } from './travel-camera';

export interface TravelBookmark {
  mode: TravelMode;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  lookYaw: number;
  surface: 'ground' | 'bridge' | 'water';
  waterId?: string;
  surfaceId?: string;
  layer?: number;
  distance: number;
  interior: InteriorView;
}
export const RETURN_MAP_DISTANCE = 110;
const CENTER_EPSILON = 0.001;

/** A one-use return to travel. Panning invalidates it even if the map is moved back. */
export class TravelReturn {
  bookmark: TravelBookmark | null = null;
  lastDistance = Infinity;
  touches = new Map<number, THREE.Vector2>();
  gesture: null | {
    kind: 'pending' | 'pinch' | 'pan' | 'rotate' | 'consumed';
    span: number;
    center: THREE.Vector2;
    lastSpan: number;
    lastCenter: THREE.Vector2;
    enablePan: boolean;
  } = null;
  raf = 0;
  constructor(public e: CityEngine) {}
  attach() {
    const canvas = this.e.renderer.domElement;
    canvas.addEventListener('pointerdown', this.down, true);
    canvas.addEventListener('pointermove', this.move, true);
    window.addEventListener('pointerup', this.up, true);
    window.addEventListener('pointercancel', this.up, true);
    window.addEventListener('blur', this.clearGesture);
    this.e.controls.addEventListener('change', this.observeCenter);
  }
  remember(bookmark: TravelBookmark) {
    this.bookmark = bookmark;
    this.lastDistance = 200;
    this.e.onTravelReturnChange?.(bookmark.mode);
  }
  invalidate = (cancelGesture = false) => {
    // An explicit new destination owns subsequent zoom. Swallow the remainder
    // of the previous touch gesture until both fingers lift.
    if (cancelGesture && this.gesture) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.gesture.kind = 'consumed';
    }
    if (!this.bookmark) return;
    this.bookmark = null;
    this.e.onTravelReturnChange?.(null);
  };
  observeCenter = () => {
    const saved = this.bookmark;
    if (!saved) return;
    const target = this.e.controls.target;
    if (
      Math.hypot(target.x - saved.position.x, target.z - saved.position.z) >
      CENTER_EPSILON
    )
      this.invalidate();
  };
  /** Called after Orbit's update has returned, never from its change event. */
  update() {
    if (!this.bookmark) return;
    this.observeCenter();
    if (!this.bookmark || this.e.transition || this.e.placement?.mode) return;
    if (this.e.navigation?.mode !== 'orbit') {
      this.invalidate();
      return;
    }
    const distance = this.e.camera.position.distanceTo(this.e.controls.target);
    const inward = distance < this.lastDistance - 0.0001;
    this.lastDistance = distance;
    if (!inward || distance > RETURN_MAP_DISTANCE) return;
    const saved = this.bookmark;
    this.invalidate();
    if (this.gesture) this.gesture.kind = 'consumed';
    if (!this.e.navigation.restoreFromMap(saved)) return;
    this.e.settings = {
      ...this.e.settings,
      mode: saved.mode,
      autoRotate: false,
    };
    this.e.controls.autoRotate = false;
    this.e.onTravelResume?.(saved.mode);
  }
  // Orbit's default two-finger action mixes dolly and pan. Buffer both finger
  // events until the frame boundary, then lock this gesture to pinch OR pan.
  down = (event: PointerEvent) => {
    if (
      event.pointerType !== 'touch' ||
      this.e.navigation?.mode !== 'orbit' ||
      (!this.bookmark && !this.gesture)
    )
      return;
    this.touches.set(
      event.pointerId,
      new THREE.Vector2(event.clientX, event.clientY),
    );
    if (this.gesture?.kind === 'consumed' || this.touches.size !== 2) return;
    this.e.completeLocalMapTransition();
    const [a, b] = [...this.touches.values()];
    const center = a.clone().add(b).multiplyScalar(0.5),
      span = a.distanceTo(b);
    this.gesture = {
      kind: 'pending',
      span,
      center,
      lastSpan: span,
      lastCenter: center.clone(),
      enablePan: this.gesture?.enablePan ?? this.e.controls.enablePan,
    };
    this.e.controls.enablePan = false;
  };
  move = (event: PointerEvent) => {
    if (!this.touches.has(event.pointerId)) return;
    this.touches.get(event.pointerId)!.set(event.clientX, event.clientY);
    if (!this.gesture) return; // Single finger keeps Orbit's normal rotation.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.raf) this.raf = requestAnimationFrame(this.flushGesture);
  };
  flushGesture = () => {
    this.raf = 0;
    const gesture = this.gesture;
    if (!gesture || gesture.kind === 'consumed') return;
    if (gesture.kind === 'rotate' && this.touches.size === 1) {
      // After a pinch, continue rotation from the remaining finger's current
      // location. Orbit's suppressed two-finger coordinates are stale.
      const point = [...this.touches.values()][0];
      const { camera, controls } = this.e;
      const angle =
        (2 * Math.PI * controls.rotateSpeed) /
        Math.max(1, this.e.renderer.domElement.clientHeight);
      const spherical = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      spherical.theta -= (point.x - gesture.lastCenter.x) * angle;
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi - (point.y - gesture.lastCenter.y) * angle,
        controls.minPolarAngle,
        controls.maxPolarAngle,
      );
      spherical.makeSafe();
      camera.position
        .copy(controls.target)
        .add(new THREE.Vector3().setFromSpherical(spherical));
      controls.update();
      gesture.lastCenter.copy(point);
      return;
    }
    if (this.touches.size !== 2) return;
    const [a, b] = [...this.touches.values()];
    const center = a.clone().add(b).multiplyScalar(0.5),
      span = a.distanceTo(b);
    if (gesture.kind === 'pending') {
      const spread = Math.abs(span - gesture.span),
        drift = center.distanceTo(gesture.center);
      if (Math.max(spread, drift) < 6) return;
      gesture.kind = spread > drift * 1.3 ? 'pinch' : 'pan';
      if (gesture.kind === 'pan') this.invalidate();
    }
    if (gesture.kind === 'pinch' && span > 4) {
      this.e.zoom(gesture.lastSpan / span);
    } else if (gesture.kind === 'pan') {
      const { camera, controls } = this.e;
      const scale =
        (2 *
          camera.position.distanceTo(controls.target) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
        Math.max(1, this.e.renderer.domElement.clientHeight);
      camera.updateMatrix();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const forward = new THREE.Vector3()
        .crossVectors(camera.up, right)
        .normalize();
      const offset = right
        .multiplyScalar(-(center.x - gesture.lastCenter.x) * scale)
        .addScaledVector(forward, (center.y - gesture.lastCenter.y) * scale);
      camera.position.add(offset);
      controls.target.add(offset);
      controls.update();
    }
    gesture.lastSpan = span;
    gesture.lastCenter.copy(center);
  };
  up = (event: PointerEvent) => {
    if (!this.touches.has(event.pointerId)) return;
    // Apply final coordinates before discarding a finger if no RAF ran yet.
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.flushGesture();
    }
    this.touches.delete(event.pointerId);
    if (
      this.gesture &&
      this.gesture.kind !== 'consumed' &&
      this.touches.size === 1 &&
      this.e.navigation?.mode === 'orbit'
    ) {
      this.gesture.kind = 'rotate';
      this.gesture.lastCenter.copy([...this.touches.values()][0]);
    }
    if (!this.touches.size) this.clearGesture();
    // Let Orbit remove its pointer bookkeeping, even after travel resumes.
  };
  clearGesture = () => {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.gesture) this.e.controls.enablePan = this.gesture.enablePan;
    this.gesture = null;
    this.touches.clear();
  };
  destroy() {
    this.clearGesture();
    const canvas = this.e.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.down, true);
    canvas.removeEventListener('pointermove', this.move, true);
    window.removeEventListener('pointerup', this.up, true);
    window.removeEventListener('pointercancel', this.up, true);
    window.removeEventListener('blur', this.clearGesture);
    this.e.controls.removeEventListener('change', this.observeCenter);
  }
}

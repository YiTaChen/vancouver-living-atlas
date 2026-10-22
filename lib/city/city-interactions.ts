import * as THREE from 'three';
import type { CityEngine } from './engine';
import {
  ProximityInteractionController,
  shouldHandleInteractionKey,
  type InteractionCandidate,
  type InteractionProvider,
  type InteractionPromptSnapshot,
} from './proximity-interactions';
import { WorldSeats } from './world-seats';

export interface InteractionView {
  snapshot: InteractionPromptSnapshot | null;
  screen: { x: number; y: number } | null;
}
export const EMPTY_INTERACTION_VIEW: InteractionView = {
  snapshot: null,
  screen: null,
};

export function projectInteractionAnchor(
  camera: THREE.PerspectiveCamera,
  point: readonly [number, number, number],
) {
  if (!point.every(Number.isFinite)) return null;
  // Projection needs the camera ancestry, not its hidden cockpit descendants.
  camera.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(...point).project(camera);
  if (
    ![p.x, p.y, p.z].every(Number.isFinite) ||
    p.z < -1 ||
    p.z > 1 ||
    Math.abs(p.x) > 1 ||
    Math.abs(p.y) > 1
  )
    return null;
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}

/** Thin engine host: each future feature registers its own provider. There is
 * one keyboard listener and one dispatcher for F and the mobile prompt. */
export class CityInteractions {
  readonly controller = new ProximityInteractionController();
  readonly seats: WorldSeats;
  onChange: (view: InteractionView) => void = () => {};
  private readonly listeners = new Set<(view: InteractionView) => void>();
  subscribe(listener: (view: InteractionView) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    this.onChange(this.view);
    this.listeners.forEach((listener) => listener(this.view));
  }
  private enabled = false;
  private lastPublish = -Infinity;
  private signature = '';
  private view: InteractionView = EMPTY_INTERACTION_VIEW;
  constructor(private readonly e: CityEngine) {
    this.seats = new WorldSeats(e);
    this.registerProvider('world-seats', () =>
      this.seats.interactionCandidates(),
    );
    this.registerProvider(
      'skytrain',
      () => e.skyTrainTravel?.interactionCandidates() ?? [],
    );
    window.addEventListener('keydown', this.keyDown);
  }

  /** Scene features share the host's camera-aware selection and F/touch input. */
  registerProvider(id: string, provider: InteractionProvider) {
    return this.controller.registerProvider(id, () =>
      this.visibleCandidates(provider()),
    );
  }

  private visibleCandidates(candidates: readonly InteractionCandidate[]) {
    // Visibility belongs to this camera host, before nearest-target selection.
    // Standing must remain usable when a seated first-person eye hides its anchor.
    return candidates.filter(
      (candidate) =>
        candidate.action === 'stand' ||
        (Array.isArray(candidate.anchor) &&
          candidate.anchor.length === 3 &&
          projectInteractionAnchor(this.e.camera, candidate.anchor) !== null),
    );
  }

  setInputEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  clear() {
    this.controller.clear();
    this.view = EMPTY_INTERACTION_VIEW;
    this.signature = '';
    this.publish();
  }

  private resolve() {
    const nav = this.e.navigation,
      travel = this.e.skyTrainTravel;
    const enabled =
      this.enabled &&
      !this.e.disposed &&
      !this.e.pageSuspended &&
      !document.hidden &&
      !this.e.cabinDisplayActive &&
      !this.e.placement?.mode &&
      this.e.settings.mode === 'walk' &&
      !this.e.busVisit?.aboard;
    const origin = travel?.active
      ? travel.interactionOrigin
      : nav
        ? ([nav.position.x, nav.walkingHeight(), nav.position.z] as [
            number,
            number,
            number,
          ])
        : null;
    const snapshot = this.controller.update(origin ?? null, enabled);
    return {
      snapshot,
      screen: snapshot
        ? (projectInteractionAnchor(this.e.camera, snapshot.anchor) ??
          (snapshot.action === 'stand' ? { x: 0.5, y: 0.65 } : null))
        : null,
    };
  }

  update(now: number, force = false) {
    this.seats.update();
    if (!force && now - this.lastPublish < 33) return;
    this.lastPublish = now;
    this.view = this.resolve();
    const { snapshot, screen } = this.view;
    const signature =
      snapshot && screen
        ? `${snapshot.id}:${snapshot.action}:${Math.round(screen.x * 2000)}:${Math.round(screen.y * 2000)}`
        : '';
    if (signature === this.signature) return;
    this.signature = signature;
    this.publish();
  }

  interact(expected: InteractionPromptSnapshot | null = this.view.snapshot) {
    // Re-sample the current player position and provider state before dispatch.
    // A stale React prompt cannot sit on a moved/removed/claimed seat.
    this.view = this.resolve();
    if (
      !expected ||
      !this.view.snapshot ||
      !this.view.screen ||
      this.view.snapshot.id !== expected.id ||
      this.view.snapshot.action !== expected.action
    ) {
      this.update(performance.now(), true);
      return false;
    }
    const done = this.controller.execute();
    if (done) {
      this.e.renderer.domElement.focus({ preventScroll: true });
      this.update(performance.now(), true);
    }
    return done;
  }

  private keyDown = (event: KeyboardEvent) => {
    if (shouldHandleInteractionKey(event) && this.interact())
      event.preventDefault();
  };

  dispose() {
    window.removeEventListener('keydown', this.keyDown);
    this.controller.dispose();
    this.seats.dispose();
    this.listeners.clear();
    this.onChange = () => {};
  }
}

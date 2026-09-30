import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Three r185 has no public gesture-cancel API. disconnect() retains its pointer
 * bookkeeping, while synthetic pointercancel can call releasePointerCapture on
 * an ID the browser has already ended. Keep this narrow adapter version-tested;
 * never use reset(), which also changes the camera and saved reset position. */
type OrbitGestureState = {
  state: number;
  _pointers: number[];
  _pointerPositions: Record<number, unknown>;
  _controlActive: boolean;
  _domElementKeyEvents: HTMLElement | Window | null;
  _interceptControlUp: EventListener;
};
export function clearOrbitGesture(controls: OrbitControls) {
  const state = controls as unknown as OrbitGestureState;
  if (!state._pointers.length && !state._controlActive) return;
  const element = controls.domElement;
  if (!element) return;
  const pointers = [...state._pointers];
  const keys = state._domElementKeyEvents;
  controls.disconnect();
  // disconnect() removes keydown but r185 leaves an outstanding Control-key
  // keyup listener attached until that key is released, possibly on another page.
  element
    .getRootNode()
    .removeEventListener('keyup', state._interceptControlUp, true);
  state._pointers.length = 0;
  state._pointerPositions = {};
  state._controlActive = false;
  state.state = -1; // r185 _STATE.NONE, verified against the installed controls.
  for (const pointer of pointers) {
    if (!element.hasPointerCapture(pointer)) continue;
    try {
      element.releasePointerCapture(pointer);
    } catch (error) {
      // Native capture can end between the ownership check and release.
      if (!(error instanceof DOMException && error.name === 'NotFoundError'))
        throw error;
    }
  }
  controls.connect(element);
  if (keys) controls.listenToKeyEvents(keys);
  controls.cursorStyle = controls.cursorStyle;
}

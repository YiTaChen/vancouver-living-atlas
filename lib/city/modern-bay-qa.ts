/** Extra local QA coverage, separate from the eight matched upgrade captures. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import { clearQAOrbitMomentum, captureQAPose } from './upgrade-qa-pose';

export const MODERN_BAY_QA_VIEWS = [
  {
    id: 'west-end-modern-bay',
    sourceId: '140475',
    coord: [-123.13022787415413, 49.277532425066354],
    position: [-161.77087453640135, 32.98445807412949, 942.6104416136913],
    camera: [-156.41322140328037, 34.98445807412949, 936.6694355620903],
    target: [-161.77087453640135, 34.58445807412949, 942.6104416136913],
  },
  {
    id: 'yaletown-modern-bay',
    sourceId: '143422',
    coord: [-123.11830440843212, 49.27867025844494],
    position: [704.0183684411332, 19.469251746153507, 815.946829909161],
    camera: [709.8880643763979, 21.469251746153507, 821.3825147443532],
    target: [704.0183684411332, 21.06925174615351, 815.946829909161],
  },
] as const;
export type ModernBayQAView = (typeof MODERN_BAY_QA_VIEWS)[number]['id'];

const orbitMinimums = new WeakMap<CityEngine, number>();
/** Call when leaving these extra QA views or restoring normal rendering. */
export function restoreModernBayQA(e: CityEngine) {
  const previous = orbitMinimums.get(e);
  if (previous === undefined) return;
  e.controls.minDistance = previous;
  orbitMinimums.delete(e);
}

/** Read the normal runtime's visible instances. A globally loaded kit alone is
 * not proof that the expected full-sized bay is selected at this source edge. */
export function modernBayQAState(e: CityEngine, id: ModernBayQAView) {
  const view = MODERN_BAY_QA_VIEWS.find((v) => v.id === id)!;
  const kit = e.streetscapeKit;
  const snapshot = kit?.snapshot();
  let matchedPrimitives = 0;
  const matrix = new THREE.Matrix4();
  kit?.group.traverseVisible((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return;
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, matrix);
      const m = matrix.elements;
      if (
        Math.hypot(
          m[12] - view.position[0],
          m[13] - view.position[1],
          m[14] - view.position[2],
        ) < 0.04
      )
        matchedPrimitives++;
    }
  });
  return {
    ready: !!snapshot?.loaded && !snapshot.failed && matchedPrimitives >= 3,
    matchedPrimitives,
    streetscape: snapshot,
  };
}

/** Caller owns busy state and capture timing. Selects an existing source edge;
 * no model injection, source edits, collision edits or walker displacement. */
export function selectModernBayQA(e: CityEngine, id: ModernBayQAView) {
  const view = MODERN_BAY_QA_VIEWS.find((v) => v.id === id)!;
  const source = e.data.buildings.features.find((feature: any) => {
    const p = feature.properties;
    return String(p.structureId ?? p.buildingId ?? p.id) === view.sourceId;
  });
  if (!source) throw new Error(`Missing expected source ${view.sourceId}`);
  if (!e.streetscapeKit) throw new Error('Detailed streetscape is unavailable');
  if (e.settings.quality !== 'high' && e.settings.quality !== 'ultra')
    throw new Error('Modern bay QA requires High or Ultra quality');
  e.navigation!.keys.clear();
  e.navigation!.setMode('orbit');
  e.transition = null;
  e.applySettings({
    ...e.settings,
    mode: 'orbit',
    buildings: true,
    labels: false,
    autoRotate: false,
  });
  clearQAOrbitMomentum(e.controls);
  e.setClock({ hour: 14, running: false });
  e.camera.fov = 48;
  e.camera.near = 0.15;
  // Match the public orbit ground guard before freezing the QA pose. Otherwise
  // animate() would raise this close camera after expectedPose was captured.
  const groundMinimumY = e.onLand(view.camera[0], view.camera[2])
    ? e.elevation(view.camera[0], view.camera[2]) + 4
    : null;
  e.camera.position.set(
    view.camera[0],
    Math.max(view.camera[1], groundMinimumY ?? view.camera[1]),
    view.camera[2],
  );
  e.controls.target.set(view.target[0], view.target[1], view.target[2]);
  e.controls.maxPolarAngle = Math.PI * 0.499;
  // Normal orbit has a 28 m minimum, which would move this close QA pose.
  // Retain it until the caller leaves this explicitly selected extra QA view.
  if (!orbitMinimums.has(e)) orbitMinimums.set(e, e.controls.minDistance);
  e.controls.minDistance = Math.min(e.controls.minDistance, 8);
  e.controls.update();
  e.ensureSSAO();
  e.renderer.setPixelRatio(1);
  e.renderer.setSize(1920, 1080, false);
  e.composer?.setPixelRatio(1);
  e.composer?.setSize(1920, 1080);
  e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
  e.camera.aspect = 1920 / 1080;
  e.camera.updateProjectionMatrix();
  e.renderer.shadowMap.needsUpdate = true;
  return {
    id,
    sourceId: view.sourceId,
    sourceCoord: view.coord,
    expectedBayPosition: view.position,
    groundMinimumY,
    expectedPose: captureQAPose(e.camera, e.controls),
    camera: e.camera.position.toArray(),
    target: e.controls.target.toArray(),
    note: 'Representative original modern bay on an actual source edge and existing pavement. Camera uses an 8 m horizontal setback and respects the public land elevation + 4 m orbit minimum. Await modernBayQAState.ready before capture; inspect the image for occlusion. Source identity does not assert a surveyed or enterable lobby.',
  };
}

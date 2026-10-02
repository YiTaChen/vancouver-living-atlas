/** LOCAL VISUAL QA: replayable Robson source-frontage architecture candidate. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import { getCityMaterialLibrary } from './material-library';
import { clearQAOrbitMomentum } from './upgrade-qa-pose';
import {
  ArchitectureModuleCandidate,
  ARCHITECTURE_MODULE_CANDIDATE,
  type ArchitectureCandidateLOD,
} from './architecture-module-candidate';

export function installArchitectureModuleCandidateQA(
  e: CityEngine,
  parent: HTMLElement,
  busy: () => boolean,
) {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent =
    'Blender architecture candidate: Robson source frontages';
  field.appendChild(legend);
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.id = 'architecture-module-candidate';
  const label = document.createElement('label');
  label.htmlFor = enable.id;
  label.textContent = 'Replace existing upper sills (QA only) ';
  label.appendChild(enable);
  field.appendChild(label);
  const lod = document.createElement('select');
  lod.setAttribute('aria-label', 'Architecture module candidate LOD');
  for (const [value, text] of [
    ['auto', 'Distance LOD'],
    ['0', 'Force LOD0'],
    ['1', 'Force LOD1'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    lod.appendChild(option);
  }
  field.appendChild(lod);
  const frame = document.createElement('button');
  frame.textContent = 'Frame Robson source frontages';
  field.appendChild(frame);
  const status = document.createElement('p');
  status.id = 'architecture-module-candidate-status';
  status.textContent =
    'Off. Production coverage is unchanged. GPU/visual gate unverified.';
  field.appendChild(status);
  parent.appendChild(field);
  let candidate: ArchitectureModuleCandidate | null = null;
  let mode: ArchitectureCandidateLOD = 'auto';
  const evidence = () =>
    candidate?.snapshot() ?? {
      id: ARCHITECTURE_MODULE_CANDIDATE.id,
      status: 'off',
      productionDefaultsUnchanged: true,
      candidateGPUAndVisualGate: 'unverified',
    };
  const refresh = () => {
    const state = candidate?.snapshot();
    status.textContent = state
      ? `${state.status}: ${state.selectedExistingInstances} source-selected existing sills; ${state.allocatedReplacements} allocated replacements. Shared atlas ${state.sharedAtlasReady ? 'ready' : 'fallback'}. GPU/visual gate unverified.${state.error ? ` ${state.error}` : ''}`
      : 'Off. Existing box sills restored; production defaults unchanged.';
  };
  function toggle(active: boolean) {
    if (busy() || e.disposed) {
      enable.checked = candidate !== null;
      return;
    }
    const details = e.architecturalDetails;
    if (!details) {
      enable.checked = false;
      status.textContent = 'Architecture layer is not available.';
      return;
    }
    if (!active) {
      details.setQAModuleAdapter(null);
      candidate = null;
      refresh();
      return;
    }
    if (candidate) return;
    e.data.architectureModuleCandidate = { snapshot: evidence };
    candidate = new ArchitectureModuleCandidate({
      details,
      camera: e.camera,
      settings: () => e.settings,
      compatibleGraphics: e.compatibleGraphics,
      library: getCityMaterialLibrary(e),
      onChange: refresh,
    });
    if (!details.setQAModuleAdapter(candidate)) {
      candidate = null;
      enable.checked = false;
      return;
    }
    candidate.setLOD(mode);
    const current = candidate;
    void current.start().then(() => {
      if (candidate === current && !e.disposed) refresh();
    });
    refresh();
  }
  enable.onchange = () => toggle(enable.checked);
  lod.onchange = () => {
    if (busy()) {
      lod.value = String(mode);
      return;
    }
    mode = lod.value === '0' ? 0 : lod.value === '1' ? 1 : 'auto';
    candidate?.setLOD(mode);
    refresh();
  };
  frame.onclick = () => {
    if (busy() || !candidate || e.disposed) return;
    const selections = [...candidate.selected.values()];
    if (!selections.length) {
      status.textContent =
        'Named source edges did not match; original sills are retained.';
      return;
    }
    const target = new THREE.Vector3();
    for (const { box } of selections)
      target.add(new THREE.Vector3(box.x, box.y, box.z));
    target.multiplyScalar(1 / selections.length);
    const yaw = selections[0].yaw;
    e.navigation?.keys.clear();
    e.navigation?.setMode('orbit');
    e.transition = null;
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      quality: e.settings.quality === 'ultra' ? 'ultra' : 'high',
      autoRotate: false,
      labels: false,
    });
    clearQAOrbitMomentum(e.controls);
    e.controls.enabled = true;
    e.setClock({ hour: 14, running: false });
    e.setAtmosphere('clear');
    e.camera.fov = 48;
    e.camera.near = 0.15;
    e.camera.position
      .copy(target)
      .add(new THREE.Vector3(Math.sin(yaw) * 44, 2, Math.cos(yaw) * 44));
    e.controls.target.copy(target);
    e.controls.update();
    e.renderer.setPixelRatio(1);
    e.renderer.setSize(1920, 1080, false);
    e.composer?.setPixelRatio(1);
    e.composer?.setSize(1920, 1080);
    e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
    e.camera.aspect = 1920 / 1080;
    e.camera.updateProjectionMatrix();
    e.renderer.shadowMap.needsUpdate = true;
    e.architecturalDetails?.update(true);
    refresh();
  };
  const parameters = new URLSearchParams(
    typeof location === 'undefined' ? '' : location.search,
  );
  if (
    parameters.get(ARCHITECTURE_MODULE_CANDIDATE.query) ===
    ARCHITECTURE_MODULE_CANDIDATE.value
  ) {
    const requested = parameters.get('architectureLOD');
    mode = requested === '0' ? 0 : requested === '1' ? 1 : 'auto';
    lod.value = String(mode);
    enable.checked = true;
    toggle(true);
    frame.click();
  }
  return evidence;
}

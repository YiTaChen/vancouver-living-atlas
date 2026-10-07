/** Local-only renderer study. These coupons never replace city objects. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CityEngine } from './engine';
import {
  clearQAOrbitMomentum,
  captureQAPose,
  qaPoseError,
} from './upgrade-qa-pose';

const closedStudyBitmaps = new WeakSet<ImageBitmap>();
function closeStudyBitmap(value: unknown) {
  if (
    typeof ImageBitmap !== 'undefined' &&
    value instanceof ImageBitmap &&
    !closedStudyBitmaps.has(value)
  ) {
    closedStudyBitmaps.add(value);
    value.close();
  }
}

function disposeStudy(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  const bitmaps = new Set<ImageBitmap>();
  textures.forEach((texture) => {
    texture.dispose();
    if (
      typeof ImageBitmap !== 'undefined' &&
      texture.source.data instanceof ImageBitmap
    )
      bitmaps.add(texture.source.data);
  });
  bitmaps.forEach(closeStudyBitmap);
}

export function installOfflineMaterialStudyQA(
  e: CityEngine,
  parent: HTMLElement,
  lease: { begin(): boolean; end(): void; isRunning(): boolean },
) {
  const field = document.createElement('fieldset');
  field.setAttribute('aria-label', 'Offline material study');
  const legend = document.createElement('legend');
  legend.textContent =
    'Offline material study — coupons, not city replacements';
  field.appendChild(legend);
  const status = document.createElement('p');
  status.textContent =
    'Not loaded. Eight opaque roles require consumer UV and role mapping.';
  field.appendChild(status);
  parent.appendChild(field);
  const group = new THREE.Group();
  group.name = 'LOCAL QA offline role coupons';
  group.position.set(0, 100, 0);
  let ready = false,
    busy = false,
    generation = 0;
  function clear() {
    generation++;
    ready = false;
    e.scene.remove(group);
    disposeStudy(group);
    group.clear();
    e.data.offlineMaterialStudy = null;
    status.textContent = 'Study cleared and owned resources released.';
  }
  async function load() {
    if (ready) return;
    const ticket = ++generation;
    const assets = await Promise.allSettled(
      ['landmark', 'vehicle', 'interior'].map((name) =>
        new GLTFLoader().loadAsync(
          `/__offline-assets/role-materials/exports/${name}-material-study.glb`,
        ),
      ),
    );
    if (
      e.disposed ||
      ticket !== generation ||
      assets.some((result) => result.status === 'rejected')
    ) {
      for (const result of assets)
        if (result.status === 'fulfilled') disposeStudy(result.value.scene);
      throw new Error('Study failed to load or was cancelled');
    }
    for (const result of assets)
      if (result.status === 'fulfilled') group.add(result.value.scene);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = true;
      }
    });
    const materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    let meshes = 0,
      triangles = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++;
      triangles +=
        (object.geometry.index?.count ??
          object.geometry.getAttribute('position').count) / 3;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value instanceof THREE.Texture && !textures.has(value)) {
            textures.add(value);
            // Engine teardown disposes attached textures. Close their private
            // bitmaps too, even if the study Clear button was never clicked.
            value.addEventListener('dispose', () =>
              closeStudyBitmap(value.source.data),
            );
          }
      }
    });
    if (
      meshes !== 16 ||
      materials.size !== 8 ||
      triangles !== 4560 ||
      textures.size !== 24
    ) {
      clear();
      throw new Error(
        'Study does not match handoff mesh/material/map contract',
      );
    }
    e.data.offlineMaterialStudy = {
      meshes,
      triangles,
      materials: materials.size,
      textures: textures.size,
      scope:
        'Opaque coupons in the actual city renderer, no production consumer or city placement acceptance',
    };
    e.scene.add(group);
    ready = true;
  }
  function frame() {
    e.navigation?.keys.clear();
    e.navigation?.setMode('orbit');
    e.transition = null;
    e.applySettings({
      ...e.settings,
      mode: 'orbit',
      qualityMode: 'manual',
      quality: 'high',
      labels: false,
      autoRotate: false,
    });
    clearQAOrbitMomentum(e.controls);
    e.controls.enabled = false;
    e.camera.position.set(6.8, 104.8, 6);
    e.controls.target.set(2.25, 100.35, -0.8);
    e.camera.fov = 48;
    e.camera.near = 0.1;
    e.controls.minDistance = 0.25;
    e.camera.updateProjectionMatrix();
    e.controls.update();
    e.renderer.setPixelRatio(1);
    e.renderer.setSize(1920, 1080, false);
    e.composer?.setPixelRatio(1);
    e.composer?.setSize(1920, 1080);
    e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
    e.camera.aspect = 1920 / 1080;
    e.camera.updateProjectionMatrix();
  }
  const render = document.createElement('button');
  render.textContent = 'Render offline role materials';
  render.onclick = async () => {
    if (busy || e.disposed || !lease.begin()) return;
    busy = true;
    try {
      await load();
      frame();
      for (const [name, atmosphere, hour] of [
        ['clear', 'clear', 14],
        ['overcast', 'overcast', 14],
        ['dusk', 'clear', 19.8],
        ['night', 'clear', 23],
      ] as const) {
        e.setAtmosphere(atmosphere);
        e.setClock({ hour, running: false });
        e.renderer.shadowMap.needsUpdate = true;
        const pose = captureQAPose(e.camera, e.controls);
        let hidden = document.hidden,
          maximumPoseError = 0;
        const visibility = () => {
          hidden ||= document.hidden;
        };
        document.addEventListener('visibilitychange', visibility);
        try {
          const started = performance.now();
          await new Promise<void>((resolve) => {
            const settle = () => {
              hidden ||= document.hidden;
              maximumPoseError = Math.max(
                maximumPoseError,
                qaPoseError(e.camera, e.controls, pose),
              );
              if (e.disposed || performance.now() - started >= 2500) resolve();
              else requestAnimationFrame(settle);
            };
            requestAnimationFrame(settle);
          });
        } finally {
          document.removeEventListener('visibilitychange', visibility);
        }
        const valid = !hidden && !e.disposed && maximumPoseError < 0.0001;
        const response = await fetch('/__visual-qa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `offline-role-materials-${name}`,
            row: {
              kind: 'offline-role-study-v1',
              valid,
              hidden,
              maximumPoseError,
              hour,
              atmosphere,
              render: [
                e.renderer.domElement.width,
                e.renderer.domElement.height,
              ],
              camera: e.camera.position.toArray(),
              target: e.controls.target.toArray(),
              ...e.data.offlineMaterialStudy,
            },
            screenshot: e.screenshot(),
          }),
        });
        if (!response.ok || !valid) throw new Error('Study capture invalid');
      }
      status.textContent =
        'Saved four renderer studies: 8 roles, 16 meshes, 4560 triangles, 24 textures. Consumer integration remains unverified.';
    } catch (error) {
      status.textContent = `Study failed: ${error}`;
    } finally {
      busy = false;
      lease.end();
      e.controls.enabled = e.navigation?.mode === 'orbit';
    }
  };
  field.appendChild(render);
  const remove = document.createElement('button');
  remove.textContent = 'Clear offline material study';
  remove.onclick = () => {
    if (!busy && !lease.isRunning()) clear();
  };
  field.appendChild(remove);
}

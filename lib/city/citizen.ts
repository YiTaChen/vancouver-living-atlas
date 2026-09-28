import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWalker } from './assets/walker';

const CITIZEN_URL = '/models/citizen/vancouver-citizen.glb';
const WALK_STRIDE = 1;
const RUN_STRIDE = 1.9;

type CitizenAsset = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};
type CitizenOptions = {
  /** Override only for local tests or an explicitly chosen original asset. */
  load?: () => Promise<CitizenAsset>;
};

/** Dispose a privately owned scene, including the procedural loading fallback. */
function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  const skeletons = new Set<THREE.Skeleton>();
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
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    texture.dispose();
    if (
      typeof ImageBitmap !== 'undefined' &&
      texture.source.data instanceof ImageBitmap
    )
      bitmaps.add(texture.source.data);
  }
  for (const bitmap of bitmaps) bitmap.close();
}

/**
 * One privately owned animated citizen per navigator. The public root never
 * changes, so camera following, ground contact and contact shadows survive the
 * asynchronous swap. Officers continue to use makeWalker() and its palette.
 */
export function makeCitizen(options: CitizenOptions = {}) {
  const group = new THREE.Group();
  group.name = 'Vancouver citizen';
  group.userData = { assetState: 'fallback', forward: '+Z', groundY: 0 };
  let fallback: ReturnType<typeof makeWalker> | null = makeWalker();
  group.add(fallback.group);
  fallback.group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = false;
  });
  let requested = false;
  let disposed = false;
  let model: THREE.Group | undefined;
  let mixer: THREE.AnimationMixer | undefined;
  let idle: THREE.AnimationAction | undefined;
  let walk: THREE.AnimationAction | undefined;
  let run: THREE.AnimationAction | undefined;
  let lastTime: number | undefined;
  let lastDistance = 0;
  let movementWeight = 0;
  let runWeight = 0;
  let idleTime = 0;

  async function load() {
    if (requested || disposed) return;
    requested = true;
    group.userData.assetState = 'loading';
    let asset: CitizenAsset | undefined;
    try {
      // Deliberately owned per navigator: no shared mutable skeleton, texture or
      // disposal state can survive a destroyed/recreated city engine.
      asset = await (options.load?.() ??
        new GLTFLoader().loadAsync(CITIZEN_URL));
      if (disposed) {
        disposeModel(asset.scene);
        return;
      }
      const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
      if (!clips.has('idle') || !clips.has('walk') || !clips.has('run'))
        throw new Error('Citizen is missing its idle, walk or run clip');
      model = asset.scene;
      model.name = 'Original rigged citizen — 38k PBR';
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = false;
        object.receiveShadow = true;
        // This single actor has animated limbs beyond the rest-pose bounds.
        object.frustumCulled = false;
      });
      mixer = new THREE.AnimationMixer(model);
      idle = mixer.clipAction(clips.get('idle')!).play();
      walk = mixer.clipAction(clips.get('walk')!).play();
      run = mixer.clipAction(clips.get('run')!).play();
      for (const action of [idle, walk, run]) action.paused = true;
      applyPose(lastDistance, 0, false, 0);
      group.add(model);
      if (fallback) {
        group.remove(fallback.group);
        disposeModel(fallback.group);
        fallback = null;
      }
      group.userData.assetState = 'ready';
      group.userData.heightMetres = 1.81;
      group.userData.strideMetres = { walk: WALK_STRIDE, run: RUN_STRIDE };
    } catch {
      mixer?.stopAllAction();
      if (model) mixer?.uncacheRoot(model);
      if (asset) disposeModel(asset.scene);
      model = undefined;
      mixer = undefined;
      idle = walk = run = undefined;
      if (!disposed) group.userData.assetState = 'fallback-error';
      // The original walker remains usable even offline or with a corrupt GLB.
    }
  }

  function applyPose(
    distance: number,
    dt: number,
    moving: boolean,
    speed: number,
  ) {
    if (!mixer || !idle || !walk || !run) return;
    const blend = 1 - Math.exp(-dt * 14);
    movementWeight += (Number(moving) - movementWeight) * blend;
    runWeight += (Number(speed > 2.4) - runWeight) * blend;
    idleTime += dt;
    idle.time = idleTime % idle.getClip().duration;
    walk.time = ((distance / WALK_STRIDE) % 1) * walk.getClip().duration;
    run.time = ((distance / RUN_STRIDE) % 1) * run.getClip().duration;
    idle.setEffectiveWeight(1 - movementWeight);
    walk.setEffectiveWeight(movementWeight * (1 - runWeight));
    run.setEffectiveWeight(movementWeight * runWeight);
    // Travel owns position; clip phase is metres walked, never wall-clock drift.
    mixer.update(0);
  }

  function update(
    distance: number,
    moving: boolean,
    elapsed?: number,
    speed?: number,
  ) {
    if (disposed) return;
    void load();
    const now =
      typeof performance === 'undefined' ? Date.now() : performance.now();
    const delta =
      elapsed ?? (lastTime === undefined ? 1 / 60 : (now - lastTime) / 1000);
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
    const metres = Number.isFinite(distance)
      ? Math.max(0, distance)
      : lastDistance;
    const measuredSpeed = dt > 0 ? Math.abs(metres - lastDistance) / dt : 0;
    lastTime = now;
    lastDistance = metres;
    fallback?.update(metres, moving);
    applyPose(
      metres,
      dt,
      moving,
      speed !== undefined && Number.isFinite(speed)
        ? Math.abs(speed)
        : measuredSpeed,
    );
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    disposeModel(group);
    group.removeFromParent();
    group.clear();
    model = undefined;
    fallback = null;
    mixer = undefined;
    idle = walk = run = undefined;
    group.userData.assetState = 'disposed';
  }

  return { group, update, dispose };
}

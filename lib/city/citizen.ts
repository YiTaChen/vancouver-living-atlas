import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWalker } from './assets/walker';

// Content revision avoids reusing a cached 2048 atlas at the stable asset path.
const CITIZEN_URL =
  '/models/citizen/vancouver-citizen.glb?v=14d66fabe097';
export type CitizenQAVariant = 'baseline-2048' | 'candidate-1024';
const DEFAULT_CITIZEN_VARIANT: CitizenQAVariant = 'candidate-1024';
const QA_ASSET_URLS = {
  'baseline-2048':
    '/__offline-assets/citizen/runtime-reference/vancouver-citizen-2048.glb',
  'candidate-1024': CITIZEN_URL,
} as const;
const qaSelectors = new WeakMap<
  THREE.Group,
  (variant: CitizenQAVariant) => Promise<boolean>
>();

/** Local gated QA uses the normal loader and private ownership lifecycle. */
export async function selectCitizenAssetForQA(
  group: THREE.Group,
  variant: CitizenQAVariant,
) {
  if (process.env.VANCOUVER_VISUAL_QA !== '1')
    throw new Error('Citizen comparison requires the local visual QA build');
  if (!Object.prototype.hasOwnProperty.call(QA_ASSET_URLS, variant))
    throw new Error('Unknown citizen comparison asset');
  const select = qaSelectors.get(group);
  if (!select) throw new Error('Citizen is unavailable or already disposed');
  if (!(await select(variant)))
    throw new Error('Citizen comparison asset failed or was superseded');
  return group.userData.assetVariant as CitizenQAVariant;
}
const WALK_STRIDE = 1;
const RUN_STRIDE = 1.9;

type CitizenAsset = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};
type CitizenOptions = {
  /** Override only for local tests or an explicitly chosen original asset. */
  load?: (url: string) => Promise<CitizenAsset>;
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
  group.userData = {
    assetState: 'fallback',
    assetVariant: 'procedural',
    forward: '+Z',
    groundY: 0,
  };
  let fallback: ReturnType<typeof makeWalker> | null = makeWalker();
  group.add(fallback.group);
  fallback.group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = false;
  });
  let requested = false;
  let disposed = false;
  let generation = 0;
  let activeVariant: CitizenQAVariant | undefined;
  let pendingVariant: CitizenQAVariant | undefined;
  let inFlight: Promise<boolean> | undefined;
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

  function loadAsset(variant: CitizenQAVariant): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (pendingVariant === variant && inFlight) return inFlight;
    if (activeVariant === variant && !pendingVariant)
      return Promise.resolve(true);
    requested = true;
    const ticket = ++generation;
    pendingVariant = variant;
    group.userData.assetState = 'loading';
    group.userData.requestedAssetVariant = variant;
    delete group.userData.assetError;
    inFlight = (async () => {
      let asset: CitizenAsset | undefined;
      let nextMixer: THREE.AnimationMixer | undefined;
      try {
        // Each navigator owns its decoded image, skeleton and geometry. During
        // QA swaps the current actor remains visible until its replacement is valid.
        const url = process.env.VANCOUVER_VISUAL_QA === '1'
          ? QA_ASSET_URLS[variant]
          : CITIZEN_URL;
        asset = await (options.load?.(url) ?? new GLTFLoader().loadAsync(url));
        if (disposed || ticket !== generation) {
          disposeModel(asset.scene);
          return false;
        }
        const clips = new Map(
          asset.animations.map((clip) => [clip.name, clip]),
        );
        if (!clips.has('idle') || !clips.has('walk') || !clips.has('run'))
          throw new Error('Citizen is missing its idle, walk or run clip');
        const nextModel = asset.scene;
        nextModel.name = 'Original rigged citizen — 38k PBR';
        nextModel.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = false;
          object.receiveShadow = true;
          object.frustumCulled = false;
        });
        nextMixer = new THREE.AnimationMixer(nextModel);
        const nextIdle = nextMixer.clipAction(clips.get('idle')!).play();
        const nextWalk = nextMixer.clipAction(clips.get('walk')!).play();
        const nextRun = nextMixer.clipAction(clips.get('run')!).play();
        for (const action of [nextIdle, nextWalk, nextRun])
          action.paused = true;
        // Validate the first sampled pose before replacing any live mixer state.
        samplePose(nextMixer, nextIdle, nextWalk, nextRun, lastDistance);
        const previousModel = model;
        const previousMixer = mixer;
        model = nextModel;
        mixer = nextMixer;
        idle = nextIdle;
        walk = nextWalk;
        run = nextRun;
        // Current distance, blend weights and idle phase were retained above.
        group.add(model);
        if (previousModel) {
          previousMixer?.stopAllAction();
          previousMixer?.uncacheRoot(previousModel);
          group.remove(previousModel);
          disposeModel(previousModel);
        }
        if (fallback) {
          group.remove(fallback.group);
          disposeModel(fallback.group);
          fallback = null;
        }
        activeVariant = variant;
        group.userData.assetState = 'ready';
        group.userData.assetVariant = variant;
        group.userData.heightMetres = 1.81;
        group.userData.strideMetres = { walk: WALK_STRIDE, run: RUN_STRIDE };
        return true;
      } catch (error) {
        nextMixer?.stopAllAction();
        if (asset) {
          nextMixer?.uncacheRoot(asset.scene);
          disposeModel(asset.scene);
        }
        if (!disposed && ticket === generation) {
          group.userData.assetState = model ? 'ready' : 'fallback-error';
          group.userData.assetError = String(error);
        }
        // Failed initial loads keep the procedural walker; failed QA swaps keep
        // the previous validated citizen, without retrying on every frame.
        return false;
      } finally {
        if (ticket === generation) {
          pendingVariant = undefined;
          inFlight = undefined;
          delete group.userData.requestedAssetVariant;
        }
      }
    })();
    return inFlight;
  }
  if (process.env.VANCOUVER_VISUAL_QA === '1')
    qaSelectors.set(group, loadAsset);

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
    samplePose(mixer, idle, walk, run, distance);
  }

  function samplePose(
    targetMixer: THREE.AnimationMixer,
    targetIdle: THREE.AnimationAction,
    targetWalk: THREE.AnimationAction,
    targetRun: THREE.AnimationAction,
    distance: number,
  ) {
    targetIdle.time = idleTime % targetIdle.getClip().duration;
    targetWalk.time =
      ((distance / WALK_STRIDE) % 1) * targetWalk.getClip().duration;
    targetRun.time =
      ((distance / RUN_STRIDE) % 1) * targetRun.getClip().duration;
    targetIdle.setEffectiveWeight(1 - movementWeight);
    targetWalk.setEffectiveWeight(movementWeight * (1 - runWeight));
    targetRun.setEffectiveWeight(movementWeight * runWeight);
    // Travel owns position; clip phase is metres walked, never wall-clock drift.
    targetMixer.update(0);
  }

  function update(
    distance: number,
    moving: boolean,
    elapsed?: number,
    speed?: number,
  ) {
    if (disposed) return;
    if (!requested) void loadAsset(DEFAULT_CITIZEN_VARIANT);
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
    generation++;
    qaSelectors.delete(group);
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

/** LOCAL VISUAL QA: bounded delivered-model inspection, not source placement acceptance. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { CityEngine } from './engine';
import trees from '../../tools/assets/mature-tree-templates/manifest.json';
import equipment from '../../tools/assets/rooftop-equipment/manifest.json';
import cars from '../../tools/assets/traffic-car-templates/manifest.json';
import bus from '../../tools/assets/boardable-bus/manifest.json';
import metro from '../../tools/assets/boardable-metro/manifest.json';
import stations from '../../tools/assets/transit-station-spaces/manifest.json';
import landmarks from '../../tools/assets/landmark-entrance-details/manifest.json';
import roofs from '../../tools/assets/roof-surface-studies/manifest.json';
import furniture from '../../tools/assets/street-furniture-expansion/manifest.json';
import ground from '../../tools/assets/ground-planting-details/manifest.json';
import windows from '../../tools/assets/source-fitted-window-variants/manifest.json';
import characters from '../../tools/assets/citizen-character-variants/manifest.json';
import { clearQAOrbitMomentum, captureQAPose, qaPoseError } from './upgrade-qa-pose';

type Bounds = { min: number[]; max: number[] };
type MapRequirement = { material: string; channel: 'map' | 'normalMap' | 'aoMap' | 'roughnessMap' | 'metalnessMap'; colorSpace: string };
type Binding = { material?: string; materialName?: string; levels?: number[]; maps?: Record<string, unknown>; inspectionMaps?: Record<string, unknown> };
type Asset = { id: string; boundsM?: Bounds; materialBindings?: Binding[]; lods: { level: number; file: string; sha256: string; bytes: number; triangles: number; boundsM?: Bounds }[] };
export type DeliveryModel = {
  key: string; package: string; asset: string; level: number;
  file: string; sha256: string; bytes: number; triangles: number; frameBounds?: Bounds; requiredMaps: MapRequirement[];
};
function mapRequirements(asset: Asset, level: number, file: string): MapRequirement[] {
  const requirements: MapRequirement[] = [];
  for (const binding of asset.materialBindings ?? []) {
    if (binding.levels && !binding.levels.includes(level)) continue;
    const material = binding.materialName ?? binding.material;
    if (!material) continue;
    const maps = binding.maps ?? (file.includes('.inspection.') ? binding.inspectionMaps : undefined);
    for (const name of Object.keys(maps ?? {})) {
      const color = ['baseColor', 'baseColorAlpha', 'color'].includes(name);
      // R is neutral AO in these packages; glTF need not bind occlusionTexture.
      const channels: MapRequirement['channel'][] = color ? ['map'] : name === 'normal' ? ['normalMap'] : ['orm', 'roughnessMetallicLegacy'].includes(name) ? ['roughnessMap', 'metalnessMap'] : [];
      if (!channels.length) throw new Error(`Unknown delivery texture channel: ${name}`);
      for (const channel of channels) requirements.push({ material, channel, colorSpace: color ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    }
  }
  return requirements;
}
const packages = [
  ['mature-tree-templates', trees], ['rooftop-equipment', equipment],
  ['traffic-car-templates', cars], ['boardable-bus', bus],
  ['boardable-metro', metro], ['transit-station-spaces', stations],
  ['landmark-entrance-details', landmarks], ['roof-surface-studies', roofs],
  ['street-furniture-expansion', furniture], ['ground-planting-details', ground],
  ['source-fitted-window-variants', windows], ['citizen-character-variants', characters],
] as unknown as [string, { assets: Asset[] }][];
export const BLENDER_DELIVERY_MODELS: readonly DeliveryModel[] = packages.flatMap(([name, manifest]) =>
  manifest.assets.filter((asset) => name !== 'citizen-character-variants' || ['vancouver-citizen', 'vancouver-police'].includes(asset.id))
    .flatMap((asset) => asset.lods.map((lod) => ({
      key: `${name}/${asset.id}/lod${lod.level}`, package: name, asset: asset.id,
      level: lod.level, file: lod.file, sha256: lod.sha256, bytes: lod.bytes,
      triangles: lod.triangles, frameBounds: asset.boundsM ?? asset.lods[0].boundsM,
      requiredMaps: mapRequirements(asset, lod.level, lod.file),
    }))),
);

const closedBitmaps = new WeakSet<ImageBitmap>();
const closedSkeletons = new WeakSet<THREE.Skeleton>();
function closeBitmap(value: unknown) {
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap && !closedBitmaps.has(value)) {
    closedBitmaps.add(value); value.close();
  }
}
function closeSkeleton(skeleton: THREE.Skeleton) {
  if (!closedSkeletons.has(skeleton)) { closedSkeletons.add(skeleton); skeleton.dispose(); }
}
function ownedResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  return { geometries, materials, textures, skeletons };
}
export function disposeDeliveryModel(root: THREE.Object3D) {
  const resources = ownedResources(root);
  resources.skeletons.forEach(closeSkeleton);
  resources.geometries.forEach((value) => value.dispose());
  resources.materials.forEach((value) => value.dispose());
  resources.textures.forEach((value) => { value.dispose(); closeBitmap(value.source.data); });
}
export function deliveryModelEvidence(root: THREE.Object3D, model: DeliveryModel) {
  let meshes = 0, triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    const position = object.geometry.getAttribute('position');
    if (!position || !Array.from(position.array).every(Number.isFinite)) throw new Error('Delivery model has invalid positions');
    triangles += (object.geometry.index?.count ?? position.count) / 3;
  });
  if (triangles !== model.triangles || meshes === 0) throw new Error(`Delivery model triangle contract: ${triangles} / ${model.triangles}`);
  const bounds = new THREE.Box3().setFromObject(root), resources = ownedResources(root);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('Delivery model has invalid physical bounds');
  for (const requirement of model.requiredMaps) {
    const material = [...resources.materials].find((value) => value.name === requirement.material) as THREE.MeshStandardMaterial | undefined;
    const map = material?.[requirement.channel], source = map?.source.data as { width?: number; height?: number } | undefined;
    if (!map || !source || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width! <= 0 || source.height! <= 0 || map.colorSpace !== requirement.colorSpace)
      throw new Error(`Delivery texture contract: ${requirement.material}/${requirement.channel}`);
  }
  return {
    model, meshes, triangles, geometries: resources.geometries.size,
    materials: resources.materials.size, textures: resources.textures.size,
    skeletons: resources.skeletons.size, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    surfaces: [...resources.materials].map((material) => {
      const m = material as THREE.MeshStandardMaterial;
      return { name: m.name, alphaTest: m.alphaTest, transparent: m.transparent, side: m.side, colorSpace: m.map?.colorSpace ?? null, roughness: m.roughness, metalness: m.metalness };
    }),
  };
}

/** GLTFLoader can return a scene after a texture failure; treat that as a failed load. */
export async function loadDeliveryGLTF(url: string, factory: (manager: THREE.LoadingManager) => Pick<GLTFLoader, 'loadAsync'> = (manager) => new GLTFLoader(manager)): Promise<GLTF> {
  const manager = new THREE.LoadingManager(), failures: string[] = [];
  manager.onError = (failed) => { failures.push(failed); };
  const asset = await factory(manager).loadAsync(url);
  if (failures.length) {
    disposeDeliveryModel(asset.scene);
    throw new Error(`Delivered dependency failed: ${failures.join(', ')}`);
  }
  return asset;
}

/** One active owned GLTF; a superseded/failed replacement never destroys the last valid model. */
export class DeliveryModelPreview {
  readonly group = new THREE.Group();
  private ticket = 0;
  private active: { root: THREE.Group; mixer: THREE.AnimationMixer | null; evidence: ReturnType<typeof deliveryModelEvidence> } | null = null;
  status = 'idle';
  constructor(private unavailable: () => boolean, private loader: (url: string) => Promise<GLTF> = loadDeliveryGLTF) {
    this.group.name = 'LOCAL QA Blender delivery model';
    this.group.position.set(0, 200, 0);
  }
  snapshot() { return { status: this.status, activeModels: this.active ? 1 : 0, evidence: this.active?.evidence ?? null }; }
  async select(key: string) {
    const model = BLENDER_DELIVERY_MODELS.find((item) => item.key === key);
    if (!model) throw new Error('Unknown delivered model');
    if (this.unavailable()) return false;
    const ticket = ++this.ticket;
    this.status = 'loading';
    let asset: GLTF | undefined, mixer: THREE.AnimationMixer | null = null;
    try {
      asset = await this.loader(`/__offline-assets/${model.package}/${model.file}?v=${model.sha256.slice(0, 12)}`);
      if (ticket !== this.ticket || this.unavailable()) { disposeDeliveryModel(asset.scene); return false; }
      const idle = asset.animations.find((clip) => clip.name === 'idle');
      if (idle) { mixer = new THREE.AnimationMixer(asset.scene); mixer.clipAction(idle).play(); mixer.update(0); }
      const evidence = deliveryModelEvidence(asset.scene, model);
      const resources = ownedResources(asset.scene);
      // Engine scene traversal owns attached geometry/materials. Its disposal also
      // closes imported bitmaps and skeleton textures, which Three does not close.
      resources.textures.forEach((texture) => texture.addEventListener('dispose', () => closeBitmap(texture.source.data)));
      resources.geometries.forEach((geometry) => geometry.addEventListener('dispose', () => resources.skeletons.forEach(closeSkeleton)));
      asset.scene.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
      this.releaseActive();
      this.group.add(asset.scene);
      this.active = { root: asset.scene, mixer, evidence };
      this.status = 'ready';
      return true;
    } catch (error) {
      if (mixer && asset) { mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); }
      if (asset) disposeDeliveryModel(asset.scene);
      if (ticket === this.ticket) this.status = this.active ? 'ready' : 'failed';
      throw error;
    }
  }
  private releaseActive() {
    if (!this.active) return;
    const { root, mixer } = this.active;
    mixer?.stopAllAction(); mixer?.uncacheRoot(root);
    this.group.remove(root); disposeDeliveryModel(root); this.active = null;
  }
  clear() { this.ticket++; this.releaseActive(); this.status = 'idle'; }
}

type Lease = { begin(): boolean; end(): void; isRunning(): boolean };
export function installBlenderDeliveryQA(e: CityEngine, parent: HTMLElement, lease: Lease) {
  const preview = new DeliveryModelPreview(() => e.disposed || e.renderer.getContext().isContextLost());
  const field = document.createElement('fieldset'), legend = document.createElement('legend');
  legend.textContent = 'Blender delivery: one model, actual renderer';
  field.setAttribute('aria-label', 'Blender delivered models');
  field.appendChild(legend);
  const status = document.createElement('p'); status.id = 'blender-delivery-status';
  status.textContent = 'Inspection only. No geographic placement, population or boarding acceptance.';
  field.appendChild(status);
  const selector = document.createElement('select'); selector.setAttribute('aria-label', 'Delivered Blender model');
  for (const model of BLENDER_DELIVERY_MODELS) { const option = document.createElement('option'); option.value = model.key; option.textContent = `${model.package} / ${model.asset} / LOD${model.level}`; selector.appendChild(option); }
  field.appendChild(selector);
  const view = document.createElement('select'); view.setAttribute('aria-label', 'Delivered model camera');
  for (const name of ['three-quarter', 'front', 'side', 'top', 'interior']) { const option = document.createElement('option'); option.value = option.textContent = name; view.appendChild(option); }
  const interiorOption = view.options[view.options.length - 1];
  // Installing a QA panel must not touch an engine already owned by a capture.
  let exteriorMaxPolarAngle: number | null = null;
  function restoreInteriorPolarLimit() {
    if (exteriorMaxPolarAngle !== null) {
      e.controls.maxPolarAngle = exteriorMaxPolarAngle;
      exteriorMaxPolarAngle = null;
    }
  }
  const permitsInterior = (model: DeliveryModel | undefined) => Boolean(model && ['boardable-bus', 'boardable-metro'].includes(model.package) && model.asset.includes('interior'));
  function updateInteriorOption(model = BLENDER_DELIVERY_MODELS.find((item) => item.key === selector.value)) {
    interiorOption.disabled = !permitsInterior(model);
    if (interiorOption.disabled && view.value === 'interior') view.value = 'three-quarter';
  }
  selector.onchange = () => updateInteriorOption();
  updateInteriorOption();
  let framedView = 'three-quarter';
  let sourceViewpoint: { kind: string; worldBounds: Bounds; eyeHeightAboveGeometryMinM: number; endInsetM: number; forward: string } | null = null;
  view.onchange = () => { if (!lease.isRunning()) frame(); };
  field.appendChild(view);
  const sweep = document.createElement('input'); sweep.type = 'checkbox'; sweep.checked = false;
  const sweepLabel = document.createElement('label'); sweepLabel.textContent = 'Four lighting conditions '; sweepLabel.appendChild(sweep); field.appendChild(sweepLabel);
  function button(label: string, action: () => void) { const node = document.createElement('button'); node.textContent = label; node.onclick = action; field.appendChild(node); }
  function fixedResolution() {
    e.renderer.setPixelRatio(1); e.renderer.setSize(1920, 1080, false);
    e.composer?.setPixelRatio(1); e.composer?.setSize(1920, 1080);
    e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
    e.camera.aspect = 1920 / 1080; e.camera.updateProjectionMatrix();
  }
  function frame() {
    const evidence = preview.snapshot().evidence;
    if (!evidence) return;
    e.navigation?.keys.clear(); e.navigation?.setMode('orbit'); e.transition = null;
    e.applySettings({ ...e.settings, mode: 'orbit', quality: 'high', labels: false, autoRotate: false });
    clearQAOrbitMomentum(e.controls);
    updateInteriorOption(evidence.model);
    framedView = view.value;
    sourceViewpoint = null;
    if (framedView === 'interior') {
      // Physical attached geometry, including the preview's +200m offset. This
      // is a fixed aisle inspection, with no hidden ceiling or navigation state.
      preview.group.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(preview.group, true), center = bounds.getCenter(new THREE.Vector3());
      const eyeY = bounds.min.y + 1.65;
      e.camera.position.set(center.x, eyeY, bounds.min.z + .8);
      e.controls.target.set(center.x, eyeY, bounds.max.z - .8);
      e.camera.fov = 65; e.camera.near = .03;
      exteriorMaxPolarAngle ??= e.controls.maxPolarAngle;
      e.controls.maxPolarAngle = Math.PI;
      sourceViewpoint = { kind: 'interior-source-aisle', worldBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, eyeHeightAboveGeometryMinM: 1.65, endInsetM: .8, forward: '+Z' };
    } else {
      const b = evidence.model.frameBounds ?? evidence.bounds;
      const bounds = new THREE.Box3(new THREE.Vector3().fromArray(b.min), new THREE.Vector3().fromArray(b.max));
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3()).add(preview.group.position);
      const distance = Math.max(2.4, size.length() * 1.6);
      const direction = framedView === 'front' ? new THREE.Vector3(0, .13, 1) : framedView === 'side' ? new THREE.Vector3(1, .13, 0) : framedView === 'top' ? new THREE.Vector3(.02, 1, .02) : new THREE.Vector3(.7, .35, .85);
      e.controls.target.copy(center); e.camera.position.copy(center).addScaledVector(direction.normalize(), distance);
      e.camera.fov = 42; e.camera.near = .1;
      restoreInteriorPolarLimit();
    }
    e.controls.minDistance = .25;
    e.camera.updateProjectionMatrix(); e.controls.update(); e.controls.enabled = true;
    fixedResolution(); e.setAtmosphere('clear'); e.setClock({ hour: 14, running: false });
    e.renderer.shadowMap.needsUpdate = true;
  }
  button('Load delivered model', () => void (async () => {
    if (e.disposed || !lease.begin()) return;
    status.textContent = 'Loading delivered model';
    try { if (!(await preview.select(selector.value))) throw new Error('Model load superseded'); e.scene.add(preview.group); frame(); status.textContent = `Ready: ${JSON.stringify(preview.snapshot())}`; }
    catch (error) { status.textContent = `Delivery preview failed: ${error}`; }
    finally { lease.end(); }
  })());
  button('Frame delivered model', () => { if (!lease.isRunning()) frame(); });
  button('Clear delivered model', () => { if (!lease.isRunning()) { preview.clear(); e.scene.remove(preview.group); restoreInteriorPolarLimit(); sourceViewpoint = null; status.textContent = 'Preview cleared; owned model resources released.'; } });
  async function sample(ms: number, pose: ReturnType<typeof captureQAPose>, key: string) {
    const started = performance.now(), gaps: number[] = [];
    let last = started, hidden = document.hidden, maxPoseError = 0, lost = false;
    const visibility = () => { hidden ||= document.hidden; }; document.addEventListener('visibilitychange', visibility);
    try { await new Promise<void>((resolve) => {
      const next = (now: number) => {
        hidden ||= document.hidden; lost ||= e.renderer.getContext().isContextLost();
        maxPoseError = Math.max(maxPoseError, qaPoseError(e.camera, e.controls, pose));
        gaps.push(now - last); last = now;
        if (e.disposed || hidden || lost || now - started >= ms) resolve(); else requestAnimationFrame(next);
      }; requestAnimationFrame(next);
    }); } finally { document.removeEventListener('visibilitychange', visibility); }
    const sorted = [...gaps].sort((a, b) => a - b), state = preview.snapshot();
    return { valid: !hidden && !lost && !e.disposed && maxPoseError < .0001 && state.status === 'ready' && state.evidence?.model.key === key, hidden, lost, maxPoseError, sampleMs: last - started, frames: gaps.length, fps: gaps.length * 1000 / Math.max(1, last - started), p50Ms: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0 };
  }
  button('Capture delivered model', () => void (async () => {
    if (e.disposed || !preview.snapshot().evidence || !lease.begin()) return;
    e.controls.enabled = false; fixedResolution();
    const pose = captureQAPose(e.camera, e.controls), model = preview.snapshot().evidence!.model, capturedView = framedView, capturedViewpoint = sourceViewpoint;
    try {
      const conditions = [['clear', 'clear', 14], ['overcast', 'overcast', 14], ['dusk', 'clear', 19.8], ['night', 'clear', 23]] as const;
      for (const [condition, atmosphere, hour] of sweep.checked ? conditions : conditions.slice(0, 1)) {
        status.textContent = `Capturing ${model.asset} LOD${model.level} / ${condition}`;
        e.setAtmosphere(atmosphere); e.setClock({ hour, running: false }); e.renderer.shadowMap.needsUpdate = true;
        const warmup = await sample(2500, pose, model.key), measured = await sample(5000, pose, model.key);
        const row = { kind: 'blender-delivery-webgl-v1', ...measured, valid: warmup.valid && measured.valid, warmup, ...preview.snapshot(), atmosphere, hour, view: capturedView, sourceViewpoint: capturedViewpoint, quality: e.settings.quality, camera: e.camera.position.toArray(), target: e.controls.target.toArray(), render: [e.renderer.domElement.width, e.renderer.domElement.height], calls: e.renderer.info.render.calls, triangles: e.renderer.info.render.triangles, geometries: e.renderer.info.memory.geometries, textures: e.renderer.info.memory.textures, protocol: 'One owned model at physical scale in actual city canvas; static idle at time zero where available; 2.5s warmup + 5s RAF. Interior view is a fixed source-geometry aisle viewpoint, not a boarding path. Full-scene/multipass counters; no source-placement, navigation, dynamic door or boarding acceptance.' };
        const response = await fetch('/__visual-qa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `delivery-${model.asset}-lod${model.level}-${capturedView}-${condition}`, row, screenshot: e.screenshot() }) });
        if (!response.ok || !row.valid) throw new Error('Hidden, context-lost or drifting delivery capture');
      }
      status.textContent = `Saved actual renderer inspection: ${model.key}`;
    } catch (error) { status.textContent = `Delivery capture failed: ${error}`; }
    finally { e.controls.enabled = e.navigation?.mode === 'orbit'; lease.end(); }
  })());
  parent.appendChild(field);
}

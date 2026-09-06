import * as THREE from 'three';
import { withRendererState, withShaderCheck } from './renderer-state';

type Renderable = THREE.Mesh | THREE.Points | THREE.Line;
type Job = {
  group: THREE.Group;
  holder: THREE.Group;
  signal: AbortSignal;
  objects: Renderable[];
  next: number;
  signature: string | null;
  settled: boolean;
  abort: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
};
export interface WarmupOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** The real composer beauty target, not the canvas. */
  colorTarget: () => THREE.WebGLRenderTarget | null;
  unavailable: () => boolean;
}
function abortError() {
  return Object.assign(new Error('Landmark preparation cancelled'), {
    name: 'AbortError',
  });
}

/**
 * One renderable / one landmark per tick. compile() warms the actual material;
 * render() forces geometry/texture upload. Both use only public Three APIs.
 * A single synchronous driver compile/upload can STILL exceed a frame budget.
 */
export class LandmarkGpuWarmup {
  private jobs: Job[] = [];
  private scratch: THREE.WebGLRenderTarget | null = null;
  private directTarget = new THREE.WebGLRenderTarget(16, 16);
  private targetSignature = '';
  private stopped = false;
  constructor(private options: WarmupOptions) {}

  prepare(
    group: THREE.Group,
    signal: AbortSignal,
    holder: THREE.Group,
  ): Promise<void> {
    if (this.stopped || this.options.unavailable())
      return Promise.reject(new Error('Graphics unavailable'));
    if (signal.aborted) return Promise.reject(abortError());
    if (group.parent)
      return Promise.reject(
        new Error('Prepare requires an unattached landmark'),
      );
    const objects: Renderable[] = [];
    // Include currently hidden night geometry: its first visible frame also needs buffers.
    group.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      )
        objects.push(object);
    });
    if (
      objects.some(
        (object) =>
          (object as THREE.SkinnedMesh).isSkinnedMesh ||
          (object as THREE.InstancedMesh).isInstancedMesh,
      )
    )
      return Promise.reject(
        new Error(
          'This bounded warmer supports ordinary landmark geometry only',
        ),
      );
    return new Promise((resolve, reject) => {
      const job: Job = {
        group,
        holder,
        signal,
        objects,
        next: 0,
        signature: null,
        settled: false,
        resolve,
        reject,
        abort: () => this.finish(job, abortError()),
      };
      signal.addEventListener('abort', job.abort, { once: true });
      this.jobs.push(job);
    });
  }

  /** Call once AFTER the visible composer render, never from an idle callback. */
  tick(): void {
    if (this.stopped) return;
    const { renderer, scene, camera } = this.options;
    if (this.options.unavailable() || renderer.getContext().isContextLost()) {
      this.invalidate('Graphics context unavailable');
      return;
    }
    const job = this.jobs[0];
    if (!job) return;
    if (job.signal.aborted) {
      this.finish(job, abortError());
      return;
    }
    try {
      const colorTarget = this.options.colorTarget();
      // Direct/mobile rendering still needs bounded geometry upload. An RGBA8
      // scratch target is widely supported; compile the canvas variant separately.
      const target = colorTarget ?? this.directTarget;

      const signature = pipelineSignature(renderer, scene, camera, target);
      // A quality/shadow/light definition change requires rewarming previous objects.
      if (job.signature !== signature) {
        job.next = 0;
        job.signature = signature;
      }
      if (job.next >= job.objects.length) {
        this.finish(job);
        return;
      }
      if (!this.scratch || this.targetSignature !== targetKey(target)) {
        this.scratch?.dispose();
        this.scratch = target.clone();
        this.scratch.setSize(16, 16);
        this.scratch.viewport.set(0, 0, 16, 16);
        this.scratch.scissor.set(0, 0, 16, 16);
        this.scratch.scissorTest = false;
        this.targetSignature = targetKey(target);
      }
      job.holder.updateWorldMatrix(true, false);
      job.group.updateMatrixWorld(true);
      const source = job.objects[job.next];
      // clone(false) shares geometry/material; the original is never reparented.
      const proxy = source.clone(false) as Renderable;
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(job.holder.matrixWorld).multiply(source.matrixWorld);
      proxy.matrixWorld.copy(proxy.matrix);
      proxy.visible = true;
      proxy.frustumCulled = false;
      proxy.layers.mask = camera.layers.mask;
      const warmScene = makeLightingScene(scene, camera);
      warmScene.add(proxy);
      const warmCamera = camera.clone();
      camera.updateWorldMatrix(true, false);
      warmCamera.matrixAutoUpdate = false;
      warmCamera.matrix.copy(camera.matrixWorld);
      warmCamera.matrixWorld.copy(camera.matrixWorld);
      withRendererState(renderer, () => {
        // Preserve the real cached sun shadow, including any pending refresh flag.
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
        renderer.autoClear = true;
        renderer.autoClearColor =
          renderer.autoClearDepth =
          renderer.autoClearStencil =
            true;
        if (!colorTarget) {
          renderer.setRenderTarget(null);
          withShaderCheck(renderer, () =>
            renderer.compile(proxy, warmCamera, scene),
          );
        }
        renderer.setRenderTarget(this.scratch);
        // Non-null RT is essential: canvas compile would warm different colour/tone defines.
        withShaderCheck(renderer, () => {
          renderer.compile(proxy, warmCamera, scene);
          if (job.signal.aborted) throw abortError();
          renderer.render(warmScene, warmCamera);
        });
      });
      // No event-loop yield occurred while source resources or renderer state were borrowed.
      if (job.signal.aborted) this.finish(job, abortError());
      else if (
        this.options.unavailable() ||
        renderer.getContext().isContextLost()
      )
        this.invalidate('Graphics context lost during preparation');
      else {
        job.next++;
        if (job.next === job.objects.length) this.finish(job);
      }
    } catch (error) {
      this.finish(
        job,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private finish(job: Job, error?: Error) {
    if (job.settled) return;
    job.settled = true;
    job.signal.removeEventListener('abort', job.abort);
    const index = this.jobs.indexOf(job);
    if (index !== -1) this.jobs.splice(index, 1);
    // We never dispose the borrowed geometry/materials; LandmarkLoadState owns them.
    job.objects.length = 0;
    if (error) job.reject(error);
    else job.resolve();
  }
  /** Context-loss listener calls this because animation has stopped and tick may not run. */
  invalidate(reason = 'Graphics unavailable') {
    this.stopped = true;
    for (const job of [...this.jobs]) this.finish(job, new Error(reason));
  }
  dispose() {
    this.invalidate('Landmark preparation disposed');
    this.scratch?.dispose();
    this.directTarget.dispose();
    this.scratch = null;
  }
}

function targetKey(target: THREE.WebGLRenderTarget) {
  return [
    target.texture.type,
    target.texture.format,
    target.texture.colorSpace,
    target.samples,
    target.depthBuffer,
    target.stencilBuffer,
  ].join('/');
}
function visibleLights(scene: THREE.Scene, camera: THREE.Camera) {
  const lights: THREE.Light[] = [];
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Light && object.layers.test(camera.layers))
      lights.push(object);
  });
  return lights;
}
function pipelineSignature(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  target: THREE.WebGLRenderTarget,
) {
  return JSON.stringify([
    targetKey(target),
    renderer.shadowMap.enabled,
    renderer.shadowMap.type,
    renderer.localClippingEnabled,
    renderer.clippingPlanes.length,
    scene.fog?.constructor.name,
    scene.environment?.uuid,
    visibleLights(scene, camera).map((light) => [light.type, light.castShadow]),
  ]);
}
function makeLightingScene(source: THREE.Scene, camera: THREE.Camera) {
  const scene = new THREE.Scene();
  scene.environment = source.environment;
  scene.environmentIntensity = source.environmentIntensity;
  scene.environmentRotation.copy(source.environmentRotation);
  scene.fog = source.fog;
  for (const light of visibleLights(source, camera)) {
    light.updateWorldMatrix(true, false);
    const clone = light.clone(false);
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(light.matrixWorld);
    clone.matrixWorld.copy(light.matrixWorld);
    if (
      light instanceof THREE.DirectionalLight ||
      light instanceof THREE.SpotLight
    ) {
      const copy = clone as THREE.DirectionalLight | THREE.SpotLight;
      light.target.updateWorldMatrix(true, false);
      copy.target = new THREE.Object3D();
      copy.target.position.setFromMatrixPosition(light.target.matrixWorld);
      scene.add(copy.target);
      // Read the existing shadow only. Do not dispose this clone's borrowed map.
      copy.shadow.map = light.shadow.map;
      copy.shadow.matrix.copy(light.shadow.matrix);
      copy.shadow.autoUpdate = false;
      copy.shadow.needsUpdate = false;
    }
    scene.add(clone);
  }
  return scene;
}

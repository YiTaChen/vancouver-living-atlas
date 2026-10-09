import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  SkyTrainCabinAssets,
  type CabinDescriptor,
  type CabinId,
  type CabinOwner,
} from './skytrain-cabin-assets';
import {
  cabinLOD,
  cabinPixelRatio,
  type CabinQualityPolicy,
} from './skytrain-cabin-policy';
import { CabinDisplayFrames } from './skytrain-cabin-frame';

export type CabinDisplayStatus =
  | { phase: 'loading' }
  | { phase: 'ready'; cabin: CabinDescriptor; level: 0 | 1 }
  | { phase: 'error' };

/** Optional factories make partial acquisition failures reproducible without
 * requiring a GPU; production uses the actual Three and browser resources. */
export interface CabinRendererDependencies {
  renderer(options: THREE.WebGLRendererParameters): THREE.WebGLRenderer;
  room(): RoomEnvironment;
  pmrem(renderer: THREE.WebGLRenderer): THREE.PMREMGenerator;
  observer(callback: ResizeObserverCallback): ResizeObserver;
}
const DEFAULT_DEPENDENCIES: CabinRendererDependencies = {
  renderer: (options) => new THREE.WebGLRenderer(options),
  room: () => new RoomEnvironment(),
  pmrem: (renderer) => new THREE.PMREMGenerator(renderer),
  observer: (callback) => new ResizeObserver(callback),
};

/** Dedicated static exhibit renderer. The city camera and materials are never
 * touched. It owns and releases its renderer, environment, assets and listeners. */
export class SkyTrainCabinRenderer {
  private readonly renderer!: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(68, 1, 0.025, 100);
  private readonly scene = new THREE.Scene();
  private readonly assets = new SkyTrainCabinAssets();
  private readonly frames!: CabinDisplayFrames;
  private readonly environment!: THREE.WebGLRenderTarget;
  private releases: (() => void)[] = [];
  private owner: CabinOwner | null = null;
  private disposed = false;
  private generation = 0;
  private id: CabinId = 'mark-v';
  private level: 0 | 1 | null = null;
  private selected = 'standing';
  private policy: CabinQualityPolicy;
  private yaw = 0;
  private pitch = 0;
  private drag: { pointer: number; x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    policy: CabinQualityPolicy,
    private readonly onStatus: (status: CabinDisplayStatus) => void,
    dependencies = DEFAULT_DEPENDENCIES,
  ) {
    this.policy = policy;
    try {
      this.renderer = dependencies.renderer({
        canvas,
        antialias: !policy.compatible,
        alpha: false,
        powerPreference: 'low-power',
      });
      this.track(() => this.renderer.forceContextLoss());
      this.track(() => this.renderer.dispose());
      this.track(() => this.renderer.renderLists.dispose());
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.9;
      this.scene.background = new THREE.Color('#aeb9c3');
      const room = dependencies.room(),
        releaseRoom = this.track(() => room.dispose());
      const pmrem = dependencies.pmrem(this.renderer),
        releasePMREM = this.track(() => pmrem.dispose());
      this.environment = pmrem.fromScene(room, 0.04, 0.1, 100);
      this.track(() => this.environment.dispose());
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.5;
      releaseRoom();
      releasePMREM();
      this.scene.add(
        new THREE.AmbientLight(0xffffff, 0.25),
        new THREE.HemisphereLight(0xffffff, 0xdfe5ea, 0.9),
      );
      const daylight = new THREE.DirectionalLight(0xffffff, 1.5);
      daylight.position.set(-3, 6, 8);
      this.scene.add(daylight);
      this.camera.rotation.order = 'YXZ';
      this.frames = new CabinDisplayFrames(() => {
        if (!this.disposed) this.renderer.render(this.scene, this.camera);
      });
      this.track(() => this.frames.dispose());
      const observer = dependencies.observer(this.resize);
      this.track(() => observer.disconnect());
      observer.observe(canvas);
      this.listen(canvas, 'pointerdown', this.pointerDown);
      this.listen(canvas, 'pointermove', this.pointerMove);
      this.listen(canvas, 'pointerup', this.pointerEnd);
      this.listen(canvas, 'pointercancel', this.pointerEnd);
      this.listen(canvas, 'lostpointercapture', this.pointerEnd);
      this.listen(canvas, 'keydown', this.keyDown);
      this.listen(canvas, 'webglcontextlost', this.contextLost);
      this.listen(document, 'visibilitychange', this.visibility);
      this.visibility();
      this.resize();
    } catch (error) {
      this.disposed = true;
      this.assets.dispose();
      this.scene.environment = null;
      this.scene.clear();
      this.releaseResources();
      throw error;
    }
  }
  private track(release: () => void) {
    let released = false;
    const once = () => {
      if (!released) {
        released = true;
        release();
      }
    };
    this.releases.push(once);
    return once;
  }
  private listen(
    target: EventTarget,
    type: string,
    listener: (event: never) => void,
  ) {
    const callback = listener as EventListener;
    this.track(() => target.removeEventListener(type, callback));
    target.addEventListener(type, callback);
  }
  private releaseResources() {
    // A failing destructor must not prevent other acquired resources releasing.
    for (const release of this.releases.reverse()) {
      try {
        release();
      } catch {
        /* Continue releasing independently owned resources. */
      }
    }
    this.releases = [];
  }
  async open(id: CabinId, policy: CabinQualityPolicy, force = false) {
    if (this.disposed) return;
    this.policy = policy;
    this.resize();
    const level = cabinLOD(policy);
    if (!force && id === this.id && level === this.level) return;
    this.id = id;
    this.level = level;
    const generation = ++this.generation;
    this.owner?.group.removeFromParent();
    this.owner = null;
    this.onStatus({ phase: 'loading' });
    this.frames.invalidate();
    try {
      const owner = await this.assets.open(id, level);
      if (!owner || this.disposed || generation !== this.generation) return;
      this.owner = owner;
      this.scene.add(owner.group);
      this.selectViewpoint(owner.descriptor.defaultViewpoint);
      this.canvas.dataset.cabinHashes = owner.resources
        .map((resource) => resource.sha256)
        .join(',');
      this.canvas.dataset.cabinSeatCount = String(owner.descriptor.seatCount);
      this.canvas.dataset.cabinLod = String(level);
      this.onStatus({ phase: 'ready', cabin: owner.descriptor, level });
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.level = null;
      this.onStatus({ phase: 'error' });
    }
  }
  selectViewpoint(id: string) {
    const view = this.owner?.descriptor.viewpoints.find(
      (view) => view.id === id,
    );
    if (!view) return;
    this.selected = id;
    this.canvas.dataset.cabinViewpoint = id;
    this.camera.position.set(...view.positionM);
    this.yaw = Math.atan2(-view.facingXZ[0], -view.facingXZ[1]);
    this.pitch = 0;
    this.orient();
  }
  resetView() {
    this.selectViewpoint(this.selected);
  }
  capture() {
    if (this.disposed || !this.owner || document.hidden)
      throw new Error('Cabin display is not ready');
    this.renderer.render(this.scene, this.camera);
    return {
      screenshot: this.canvas.toDataURL('image/png'),
      row: {
        kind: 'skytrain-cabin-display-checkpoint-v1',
        capturedAt: new Date().toISOString(),
        valid: true,
        model: this.id,
        lod: this.owner.level,
        seatCount: this.owner.descriptor.seatCount,
        viewpoint: this.selected,
        resources: this.owner.resources,
        policy: { ...this.policy },
        render: [this.canvas.width, this.canvas.height],
        pixelRatio: this.renderer.getPixelRatio(),
        camera: {
          position: this.camera.position.toArray(),
          quaternion: this.camera.quaternion.toArray(),
          near: this.camera.near,
          fov: this.camera.fov,
        },
        renderer: {
          calls: this.renderer.info.render.calls,
          triangles: this.renderer.info.render.triangles,
          geometries: this.renderer.info.memory.geometries,
          textures: this.renderer.info.memory.textures,
        },
      },
    };
  }
  private orient() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.frames.invalidate();
  }
  private resize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(cabinPixelRatio(this.policy, width, height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.frames.invalidate();
  };
  private visibility = () => this.frames.setVisible(!document.hidden);
  private contextLost = (event: Event) => {
    if (this.disposed) return;
    event.preventDefault();
    this.onStatus({ phase: 'error' });
    // Retry creates a fresh canvas and renderer. A lost PMREM target must never
    // resume with invalid environment pixels on Three's automatic restoration.
    this.dispose();
  };
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary) return;
    this.drag = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (!this.drag || this.drag.pointer !== event.pointerId) return;
    this.yaw -= (event.clientX - this.drag.x) * 0.004;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - (event.clientY - this.drag.y) * 0.004,
      -1.2,
      1.2,
    );
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
    this.orient();
  };
  private pointerEnd = (event: PointerEvent) => {
    if (this.drag?.pointer !== event.pointerId) return;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
  };
  private keyDown = (event: KeyboardEvent) => {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(
        event.key,
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') {
      this.resetView();
      return;
    }
    this.yaw +=
      event.key === 'ArrowLeft' ? 0.09 : event.key === 'ArrowRight' ? -0.09 : 0;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch +
        (event.key === 'ArrowUp'
          ? 0.07
          : event.key === 'ArrowDown'
            ? -0.07
            : 0),
      -1.2,
      1.2,
    );
    this.orient();
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    if (this.drag && this.canvas.hasPointerCapture(this.drag.pointer))
      this.canvas.releasePointerCapture(this.drag.pointer);
    this.drag = null;
    this.assets.dispose();
    this.owner = null;
    this.scene.environment = null;
    this.scene.clear();
    this.releaseResources();
  }
}

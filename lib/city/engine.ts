import { FlightController } from './flight-controller';
import { clearOrbitGesture } from './orbit-lifecycle';
import { paintStartupProgress } from './startup-progress';
import { ScenePreparationQueue } from './scene-preparation';
import { PublicInteriors } from './interiors';
import { isMobileGraphics, supportsHDRTarget } from './graphics-profile';
import { SkyEffects } from './sky-effects';
import {
  AtmosphereEnvironment, applyAtmosphereSky, installAtmosphereSky,
  normalizeAtmosphere, sampleAtmosphere, type AtmosphereMode,
} from './atmosphere';
import { createBeachAmenities } from './beach-amenities';
import { createResidentialGround } from './residential-ground';
import { installSSAOBlur4 } from './ssao-blur4';
import { trackSSAOResources } from './ssao-resources';
import { SSAOExclusions } from './ssao-exclusions';
import { installSSAOVisibility } from './ssao-visibility';
import {
  shadowCoverage,
  SHADOW_DEPTH,
  type ShadowCoverage,
} from './shadow-policy';
import { LandmarkGpuWarmup } from './gpu-landmark-warmup';
import { warmComposer } from './warm-composer';
import type { LandmarkWorkerClient } from './landmark-worker-client';
import { createStartupQA } from './startup-qa';
import { BeachGround, type BeachCoastData } from './beach-ground';
import { enterLocalMap, finishLocalMapTransition } from './local-map-camera';
import { createRoadSurfaces } from './road-surfaces';
import { harmonizeGround } from './harmonize-ground';
import { TravelReturn } from './travel-return';
import type { TravelMode } from './placement-geometry';
import type { TravelView } from './travel-camera';
import * as THREE from 'three';
import { LocalMinimap, minimapPose, minimapWorldPoint } from './minimap';
import { DiscoveryMarker, type DiscoveryTarget } from './discovery-marker';
import type { LandmarkDetail } from './landmark-detail';
import { FacadeDetails } from './facade-details';
import { ArchitecturalDetails } from './architecture-details';
import { createBuildingBodies } from './building-bodies';
import type { DetailedTrees } from './detailed-trees';
import { QUALITY, qualityPixelRatio } from './quality';
import { DEFAULT_LOCALE, translate, viewText, type Locale } from '../i18n';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import Delaunator from 'delaunator';
import { createStreetfronts } from './streetfronts';
import type { StreetscapeKit } from './streetscape-kit';
import { createBridgeApproaches } from './bridges';
import { prepareCauseway } from './causeway';
import { makeContext } from './context';
import { StreetNavigation } from './navigation';
import { MapPlacement } from './placement';
import { CityClock, type ClockState } from './clock';
import { createLandmarks } from './landmarks';
import { createRailway, updateRailway, type Railway } from './railway';
import type { TrainKind } from './rail-path';
import { WaterWorld } from './water-world';
import { createHarbour, updateHarbour, type Harbour } from './harbour';
import { addSailingWaves } from './water-waves';
import type { HarbourKind } from './harbour-path';
import landmarkFootprints from './landmark-footprints.json';
import {
  createNature,
  createStreetDetails,
  updateTraffic,
  type Traffic,
} from './environment';
import { project, unproject, rings, lines, inPolygon, hash } from './geo';
import {
  VIEWS,
  DEFAULT_SETTINGS,
  type FeatureCollection,
  type Feature,
  type Settings,
  type SceneStats,
  type Viewpoint,
} from './types';

export class CityEngine {
  startupQA =
    process.env.VANCOUVER_VISUAL_QA === '1' ? createStartupQA() : null;
  clock = new CityClock();
  lastLightUpdate = 0;
  lastLightHour = -1;
  lastShadowHour = -1;
  lastSolarShadowUpdate = 0;
  visibilityChange = () => {
    if (this.disposed) return;
    if (document.hidden) this.clearHeldInput();
    this.clock.setVisible(
      !document.hidden && !this.pageSuspended,
      performance.now(),
    );
  };
  locale: Locale = DEFAULT_LOCALE;
  scene = new THREE.Scene();
  environmentTarget: THREE.WebGLRenderTarget | null = null;
  private environmentCache: AtmosphereEnvironment | null = null;
  atmosphere: AtmosphereMode = 'clear';
  extraTextures = new Set<THREE.Texture>();
  contextLost = false;
  compatibleGraphics = false;
  lastShadowCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  sky = new Sky();
  skyEffects!: SkyEffects;
  composer: EffectComposer | null = null;
  renderPass: RenderPass | null = null;
  fxaa: ShaderPass | null = null;
  // A BFCache entry retains this exact document and React tree. Disposing its
  // canvas on persisted pagehide would leave a dead city when Back restores it.
  pageSuspended = false;
  private suspendedAt = 0;
  private renderReady = false;
  private loadAbort = new AbortController();
  pageHide = (event: PageTransitionEvent) => {
    if (event.persisted) this.suspendPage();
    else this.destroy();
  };
  pageShow = (event: PageTransitionEvent) => {
    if (event.persisted) this.resumePage();
  };
  private graphicsContextLost = (event: Event) => {
    if (this.disposed) return;
    event.preventDefault();
    this.contextLost = true;
    // A restored GL context does not restore our rendered PMREM/shadow contents.
    // Release this engine and expose the existing explicit reload action.
    this.failInitialization(new Error('graphics-context-lost'));
  };
  ssao: SSAOPass | null = null;
  aoExclusions: SSAOExclusions | null = null;
  shadowCoverageState: ShadowCoverage | null = null;
  roadMaterials = new Map<string, THREE.MeshStandardMaterial>();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  buildings = new THREE.Group();
  vegetation = new THREE.Group();
  detailedTrees: DetailedTrees | null = null;
  facadeDetails: FacadeDetails | null = null;
  architecturalDetails: ArchitecturalDetails | null = null;
  streetscapeKit: StreetscapeKit | null = null;
  roads = new THREE.Group();
  terrain = new THREE.Group();
  landmarks = new THREE.Group();
  landmarkDetails: LandmarkDetail[] = [];
  interiors: PublicInteriors | null = null;
  landmarkWorker: LandmarkWorkerClient<THREE.Group> | null = null;
  landmarkWarmup: LandmarkGpuWarmup | null = null;
  prepareLandmark?: (
    group: THREE.Group,
    signal: AbortSignal,
    holder: THREE.Group,
  ) => void | Promise<void>;
  trafficGroup = new THREE.Group();
  traffic: Traffic | null = null;
  railway: Railway | null = null;
  harbour: Harbour | null = null;
  sailingWaves: ReturnType<typeof addSailingWaves> | null = null;
  navigation: StreetNavigation | null = null;
  flight: FlightController | null = null;
  onFlightMode: (mode: 'orbit' | 'flight') => void = () => {};
  placement: MapPlacement | null = null;
  travelReturn: TravelReturn;
  settings = { ...DEFAULT_SETTINGS };
  stats: SceneStats = {
    buildings: 0,
    trees: 0,
    roads: 0,
    fps: 0,
    elevation: 0,
    distance: 0,
  };
  data: Record<string, any> = {};
  sceneryPreparation = new ScenePreparationQueue();
  landPolys: number[][][][] = [];
  beachGround!: BeachGround;
  parkPolys: { name: string; poly: number[][][] }[] = [];
  sun = new THREE.DirectionalLight(0xffecd0, 3);
  ambient = new THREE.HemisphereLight(0xc9e7ff, 0x66746b, 2.2);
  water!: THREE.Mesh;
  waterWorld!: WaterWorld;
  uniforms = {
    night: { value: 0 }, time: { value: 0 },
    skyHorizon: { value: new THREE.Color() },
    skyZenith: { value: new THREE.Color() },
  };
  disposed = false;
  frame = 0;
  resizeObserver: ResizeObserver;
  lastTime = 0;
  fpsAt = 0;
  frames = 0;
  transition: null | {
    localMap?: boolean;
    fromQuaternion?: THREE.Quaternion;
    toQuaternion?: THREE.Quaternion;
    start: number;
    duration: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } = null;
  onTravelReturnChange: (mode: TravelMode | null) => void = () => {};
  onTravelResume: (mode: TravelMode) => void = () => {};
  onLocalOrbit: () => void = () => {};
  onTravelView: (view: TravelView) => void = () => {};
  onStats: (s: SceneStats) => void;
  onReady: () => void;
  onError: (s: string) => void;
  raf = 0;
  labelElements: {
    element: HTMLButtonElement;
    position: THREE.Vector3;
    id: string;
  }[] = [];
  minimap: LocalMinimap | null = null;
  discoveryTarget: DiscoveryTarget | null = null;
  private discoveryMarker: DiscoveryMarker | null = null;
  constructor(
    public container: HTMLElement,
    onStats: (s: SceneStats) => void,
    onReady: () => void,
    onError: (s: string) => void,
    private onProgress: (percent: number) => void = () => {},
  ) {
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.mark('engine.constructor.body.begin');
      this.startupQA?.begin('constructor.body');
      this.startupQA?.begin('constructor.renderer-controls');
    }
    this.onStats = onStats;
    this.onReady = onReady;
    this.onError = onError;
    try {
      this.camera = new THREE.PerspectiveCamera(
        42,
        container.clientWidth / container.clientHeight,
        2,
        45000,
      );
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
      this.compatibleGraphics =
        isMobileGraphics(navigator.userAgent, navigator.maxTouchPoints) ||
        new URLSearchParams(location.search).get('graphics') === 'compatible' ||
        !supportsHDRTarget(this.renderer);
      if (this.compatibleGraphics) this.settings.quality = 'balanced';
      this.renderer.domElement.dataset.graphics = this.compatibleGraphics
        ? 'compatible'
        : 'hdr';
      this.renderer.setPixelRatio(this.pixelRatio());
      this.renderer.setSize(container.clientWidth, container.clientHeight);
      this.renderer.info.autoReset = false;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.13;
      this.renderer.shadowMap.autoUpdate = false;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.shadowMap.enabled = !this.compatibleGraphics;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.domElement.setAttribute(
        'aria-label',
        translate(this.locale, 'canvasLabel'),
      );
      this.renderer.domElement.tabIndex = 0;
      container.appendChild(this.renderer.domElement);
      this.renderer.domElement.addEventListener(
        'webglcontextlost',
        this.graphicsContextLost,
      );
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.travelReturn = new TravelReturn(this);
      this.travelReturn.attach();
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.07;
      this.controls.minDistance = 28;
      this.controls.maxDistance = 18000;
      this.controls.maxPolarAngle = Math.PI * 0.485;
      this.controls.screenSpacePanning = false;
      this.controls.zoomSpeed = 0.75;
      this.controls.rotateSpeed = 0.65;
      this.controls.addEventListener('start', () => {
        this.transition = null;
      });
      this.sky.scale.setScalar(35000);
      installAtmosphereSky(this.sky);
      applyAtmosphereSky(this.sky, sampleAtmosphere(this.clock.hour, this.atmosphere));
      this.scene.add(this.sky);
      this.skyEffects = new SkyEffects(this.scene);
      if (process.env.VANCOUVER_VISUAL_QA === '1') {
        this.startupQA?.end('constructor.renderer-controls');
        this.startupQA?.begin('constructor.environment-pmrem');
      }
      if (!this.compatibleGraphics) {
        this.environmentCache = new AtmosphereEnvironment(this.renderer, this.sky);
        this.environmentTarget = this.environmentCache.get(this.atmosphere,
          sampleAtmosphere(this.clock.hour, this.atmosphere).environmentPhase);
        this.scene.environment = this.environmentTarget.texture;
      }
      if (process.env.VANCOUVER_VISUAL_QA === '1') {
        this.startupQA?.end('constructor.environment-pmrem');
        this.startupQA?.begin('constructor.scene-and-events');
      }

      this.scene.add(
        this.ambient,
        this.sun,
        this.buildings,
        this.vegetation,
        this.roads,
        this.terrain,
        this.landmarks,
        this.trafficGroup,
      );
      this.sun.position.set(-2500, 3600, 1400);
      this.sun.castShadow = true;
      Object.assign(this.sun.shadow.camera, {
        left: -2700,
        right: 2700,
        top: 2700,
        bottom: -2700,
        near: SHADOW_DEPTH.near,
        far: SHADOW_DEPTH.far,
      });
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0002;
      this.sun.shadow.normalBias = 1.2;
      this.scene.add(this.sun.target);
      this.scene.background = new THREE.Color(0xbdd9e3);
      this.scene.fog = new THREE.FogExp2(0xbdd9e3, 0.000027);
      this.flyTo('overview', false);
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed || this.contextLost) return;
        const w = container.clientWidth,
          h = container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer?.setSize(w, h);
        this.resizeQuality();
      });
      this.resizeObserver.observe(container);
      if (process.env.VANCOUVER_VISUAL_QA === '1') {
        this.startupQA?.end('constructor.scene-and-events');
      }
    } catch (error) {
      // The caller cannot destroy an instance whose constructor never returned.
      this.destroy();
      throw error;
    }
    document.addEventListener('visibilitychange', this.visibilityChange);
    window.addEventListener('pagehide', this.pageHide);
    window.addEventListener('pageshow', this.pageShow);
    this.load().catch((error) => this.failInitialization(error));
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.end('constructor.body');
      this.startupQA?.mark('engine.constructor.body.end');
    }
  }
  private failInitialization(error: unknown) {
    if (this.disposed) return;
    const message = this.contextLost
      ? 'graphics-context-lost'
      : error instanceof Error
        ? error.message
        : String(error);
    if (process.env.VANCOUVER_VISUAL_QA === '1') this.startupQA?.fail(error);
    console.error('Vancouver scene initialization failed', error);
    this.destroy();
    this.onError(message);
  }
  private clearHeldInput() {
    if (this.controls) clearOrbitGesture(this.controls);
    this.navigation?.blur();
    this.flight?.clearInput();
    this.travelReturn?.clearGesture();
    this.placement?.cancel();
  }
  private suspendPage() {
    if (this.disposed || this.pageSuspended) return;
    this.pageSuspended = true;
    this.suspendedAt = performance.now();
    this.clock.setVisible(false, this.suspendedAt);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearHeldInput();
  }
  private resumePage() {
    if (this.disposed || this.contextLost || !this.pageSuspended) return;
    const now = performance.now();
    if (this.transition)
      this.transition.start += Math.max(0, now - this.suspendedAt);
    this.pageSuspended = false;
    this.clearHeldInput();
    this.clock.resetTimebase(now);
    this.clock.setVisible(!document.hidden, now);
    this.lastTime = this.fpsAt = now;
    this.frames = 0;
    if (this.renderReady) this.raf = requestAnimationFrame(this.animate);
  }
  async load() {
    const advance = (percent: number) =>
      paintStartupProgress(
        percent,
        this.onProgress,
        () => this.disposed || this.contextLost,
      );
    if (!(await advance(3))) return;
    let filesComplete = 0;
    const fileDone = () => {
      if (!this.disposed && !this.contextLost)
        this.onProgress(3 + Math.floor((++filesComplete / 17) * 12));
    };
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('load.data.fetch-and-decode', 'async-wall');
    }

    const names = [
      'buildings',
      'roads',
      'parks',
      'land',
      'context',
      'paths',
      'shoreline',
      'context-land',
    ];
    await Promise.all([
      ...names.map(async (n) => {
        const res = await fetch(`/data/${n}.geojson`, {
          signal: this.loadAbort.signal,
        });
        if (!res.ok)
          throw new Error(`Could not load ${n} data (${res.status})`);
        this.data[n] = await res.json();
        fileDone();
      }),
      ...[
        ['terrain', 'elevation', false],
        ['bridges', 'bridges', false],
        ['trees', 'trees', false],
        ['context-terrain', 'contextTerrain', false],
        ['railways', 'railways', true],
        ['harbour-sites', 'harbour-sites', true],
        ['harbour-routes', 'harbour-routes', true],
        ['harbour-piers', 'harbour-piers', true],
        ['beach-coast', 'beachCoast', true],
      ].map(async ([name, key, required]) => {
        const res = await fetch(`/data/${name}.json`, {
          signal: this.loadAbort.signal,
        });
        if (!res.ok) {
          if (required)
            throw new Error(`Could not load ${name} (${res.status})`);
          fileDone();
          return;
        }
        this.data[String(key)] = await res.json();
        fileDone();
      }),
    ]);
    if (this.disposed) return;
    if (!(await advance(15))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('load.geographic-masks');
    }
    this.beachGround = new BeachGround(this.data.beachCoast);
    // Preserve the exact original tessellation keys used by the local patch.
    this.data.originalLandPolys = this.data.land.features.flatMap(
      (f: Feature) => rings(f).map((p) => p.map((r) => r.map(project))),
    );
    this.landPolys = (
      this.data.beachCoast as BeachCoastData
    ).land.features.flatMap((f: Feature) =>
      rings(f).map((p) => p.map((r) => r.map(project))),
    );
    this.parkPolys = this.data.parks.features.flatMap((f: Feature) =>
      rings(f).map((p) => ({
        name: f.properties.name || f.properties.park_name || '',
        poly: p.map((r) => r.map(project)),
      })),
    );
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.water');
    }
    this.makeWater();
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.land');
    }
    this.makeLand();
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.context');
    }
    makeContext(this);
    if (!(await advance(27))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1')
      this.startupQA?.phase('geometry.causeway-prepare');
    prepareCauseway(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1')
      this.startupQA?.phase('geometry.roads');
    this.makeRoads();
    if (!(await advance(48))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.buildings');
    }
    this.makeBuildings();
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.bridge-approaches');
    }
    createBridgeApproaches(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.nature');
    }
    createNature(this);
    if (!(await advance(64))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.ground-harmonization');
    }
    harmonizeGround(this);
    createBeachAmenities(this);
    createResidentialGround(this);
    // Resolve landmark feet and entries from the final rendered ground.
    if (!(await advance(75))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.landmarks-medium-and-ground-plan');
    }
    createLandmarks(this);
    this.interiors = new PublicInteriors(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('collision.waterworld-and-footprints');
    }
    this.waterWorld = new WaterWorld(
      this.landPolys,
      this.data['context-land'],
      this.data.waterSurfaces,
      this.data.buildings,
      landmarkFootprints,
      this.beachGround,
    );
    for (const p of (this.data.beachCoast as BeachCoastData)
      .groundObstacleFootprints)
      this.waterWorld.addObstacle(p);
    for (const p of this.data.solidWaterFootprints || [])
      this.waterWorld.addObstacle(p);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.streetfronts-and-roofs');
    }
    this.streetscapeKit = createStreetfronts(this);
    // Roof furniture is invisible at the opening overview. Build it in bounded
    // background steps only for detail profiles; basic roofs already exist.
    this.scheduleScenery?.();
    if (!(await advance(82))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.traffic-and-road-details');
    }
    this.traffic = createStreetDetails(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.railway');
    }
    this.railway = createRailway(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.harbour-and-dock-collision');
    }
    this.harbour = createHarbour(this);
    if (!(await advance(88))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('controller.navigation');
    }
    this.navigation = new StreetNavigation(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('geometry.sailing-waves');
    }
    this.sailingWaves = addSailingWaves(this);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('controller.placement-proxies');
    }
    this.placement = new MapPlacement(this);
    this.flight = new FlightController(this);
    if (!(await advance(92))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('render.composer-setup');
    }
    if (!this.compatibleGraphics) {
      this.composer = new EffectComposer(this.renderer);
      this.renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(new OutputPass());
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('render.quality-and-initial-lighting');
    }
    this.resizeQuality();
    this.applySettings(this.settings);
    if (!(await advance(95))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.phase('render.scene-compileAsync', 'async-wall');
    }
    await this.renderer.compileAsync(this.scene, this.camera);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.endPhase();
      this.startupQA?.mark('render.scene-compileAsync.resolved');
    }

    if (this.disposed || this.contextLost) return;
    if (!(await advance(98))) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1')
      this.startupQA?.phase('render.composer-warmup');
    // Allocate and run the current postprocessing pipeline while loading is visible.
    // This adds real buffer upload after the existing initial shader compilation.
    if (this.composer) {
      this.ensureSSAO();
      this.updateShadowFrustum();
      warmComposer(
        this.renderer,
        this.composer,
        this.scene,
        this.ssao,
        this.fxaa,
        this.settings.quality !== 'balanced',
      );
    }
    this.landmarkWarmup = new LandmarkGpuWarmup({
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      colorTarget: () => this.composer?.readBuffer ?? null,
      unavailable: () => this.disposed || this.contextLost,
    });
    this.prepareLandmark = (group, signal, holder) => {
      if (!this.landmarkWarmup)
        return Promise.reject(new Error('GPU preparation unavailable'));
      return this.landmarkWarmup.prepare(group, signal, holder);
    };
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.endPhase();
      this.startupQA?.mark('render.composer-warmup.finished');
    }
    if (this.disposed || this.contextLost) return;
    if (
      process.env.NODE_ENV === 'development' &&
      new URLSearchParams(location.search).has('inspect')
    )
      (window as Window & { __atlas?: CityEngine }).__atlas = this;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.mark('engine.onReady.called');
      this.startupQA?.begin('react.onReady-callback');
    }
    this.onProgress(100);
    this.onReady();
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.end('react.onReady-callback');
      this.startupQA?.mark('engine.onReady.returned');
    }

    this.renderReady = true;
    this.fpsAt = performance.now();
    this.clock.setVisible(!document.hidden && !this.pageSuspended, this.fpsAt);
    this.clock.resetTimebase(this.fpsAt);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.begin('render.first-city-frame');
    }
    this.animate(this.fpsAt);
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.end('render.first-city-frame');
      this.startupQA?.frameSubmitted(this);
    }

    if (process.env.VANCOUVER_VISUAL_QA === '1')
      void import('./visual-qa').then(({ installVisualQA }) =>
        installVisualQA(this),
      );
  }
  pixelRatio() {
    const w = Math.max(1, this.container.clientWidth),
      h = Math.max(1, this.container.clientHeight);
    const ratio = qualityPixelRatio(
      this.settings.quality,
      w,
      h,
      window.devicePixelRatio,
    );
    return this.compatibleGraphics
      ? Math.min(ratio, 1, Math.sqrt(1_000_000 / (w * h)))
      : ratio;
  }
  resizeQuality() {
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    const shadowSize = QUALITY[this.settings.quality].shadowSize;
    if (this.sun.shadow.mapSize.x !== shadowSize) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.composer?.setPixelRatio(ratio);
    this.fxaa?.uniforms.resolution.value.set(
      1 / (this.container.clientWidth * ratio),
      1 / (this.container.clientHeight * ratio),
    );
  }
  updateShadowFrustum() {
    if (this.compatibleGraphics || this.settings.quality === 'balanced') return;
    const direction = this.sun.position.clone().sub(this.sun.target.position);
    const coverage = shadowCoverage({
      mode: this.settings.mode,
      quality: this.settings.quality,
      distance: this.camera.position.distanceTo(this.controls.target),
      focus: this.controls.target.toArray(),
      sunDirection: direction.toArray(),
      mapSize: this.sun.shadow.mapSize.x,
      previous: this.shadowCoverageState,
      refreshing: this.renderer.shadowMap.needsUpdate,
    });
    const camera = this.sun.shadow.camera;
    const resized =
      camera.right !== coverage.extent ||
      camera.near !== SHADOW_DEPTH.near ||
      camera.far !== SHADOW_DEPTH.far;
    const moved =
      this.sun.target.position.x !== coverage.anchor[0] ||
      this.sun.target.position.y !== coverage.anchor[1] ||
      this.sun.target.position.z !== coverage.anchor[2];
    const biased =
      this.sun.shadow.normalBias !== coverage.normalBias ||
      this.sun.shadow.bias !== coverage.bias;
    this.shadowCoverageState = coverage;
    if (moved) {
      // Translate light and target together: solar direction must remain exact.
      this.sun.target.position.fromArray(coverage.anchor);
      this.sun.position.copy(direction).add(this.sun.target.position);
    }
    if (resized) {
      Object.assign(camera, {
        left: -coverage.extent,
        right: coverage.extent,
        top: coverage.extent,
        bottom: -coverage.extent,
        near: SHADOW_DEPTH.near,
        far: SHADOW_DEPTH.far,
      });
      camera.updateProjectionMatrix();
    }
    this.sun.shadow.normalBias = coverage.normalBias;
    this.sun.shadow.bias = coverage.bias;
    if (moved || resized || biased) this.renderer.shadowMap.needsUpdate = true;
  }
  ensureSSAO() {
    if (this.compatibleGraphics || this.ssao || !this.composer) return;
    const ratio = this.pixelRatio();
    this.ssao = new SSAOPass(
      this.scene,
      this.camera,
      this.container.clientWidth * ratio,
      this.container.clientHeight * ratio,
      8,
    );
    trackSSAOResources(this.ssao);
    installSSAOBlur4(this.ssao);
    // Ambient contact shading is low-frequency: render it at half resolution
    // while keeping the city colour pass at the selected physical resolution.
    const sizeAO = this.ssao.setSize.bind(this.ssao);
    this.ssao.setSize = (w, h) =>
      sizeAO(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.ssao.maxDistance = 0.005;
    // Match the two-sided road/deck surfaces used in the beauty pass.
    this.ssao.normalMaterial.side = THREE.DoubleSide;
    const exclusions = new SSAOExclusions(this.scene);
    this.aoExclusions = exclusions;
    const visibility = installSSAOVisibility(this.ssao, exclusions);
    trackSSAOResources(this.ssao).restores.add(() => {
      visibility.restore();
      exclusions.dispose();
    });
    this.composer.insertPass(this.ssao, 1);
  }
  scheduleScenery() {
    // Roof appearance now follows the same bounded camera selection as street
    // detail instead of permanently adding equipment for every city building.
    this.architecturalDetails?.update(true);
  }
  renderScene() {
    this.detailedTrees?.update();
    this.facadeDetails?.update();
    this.architecturalDetails?.update();
    this.streetscapeKit?.update();
    this.landmarkWorker?.beginFrame();
    this.landmarkDetails.forEach((l) => l.update());
    this.interiors?.update();
    this.updateShadowFrustum();
    this.renderer.info.reset();
    const shadows =
      !this.compatibleGraphics &&
      this.settings.quality !== 'balanced' &&
      this.camera.position.distanceTo(this.controls.target) < 4500;
    if (shadows !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = shadows;
      this.renderer.shadowMap.needsUpdate = shadows;
    }
    const ao =
      !this.compatibleGraphics &&
      this.settings.quality !== 'balanced' &&
      this.camera.position.distanceTo(this.controls.target) < 3500;
    if (ao) this.ensureSSAO();
    if (this.ssao) {
      this.ssao.enabled = ao;
      this.ssao.kernelRadius = this.settings.mode === 'orbit' ? 7 : 2;
      this.ssao.minDistance =
        this.settings.mode === 'orbit' ? 0.00001 : 0.000002;
      const su = this.ssao.ssaoMaterial.uniforms;
      su.cameraNear.value = this.camera.near;
      su.cameraFar.value = this.camera.far;
      su.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
      su.cameraInverseProjectionMatrix.value.copy(
        this.camera.projectionMatrixInverse,
      );
    }
    // SSAOPass multiplies AO into the current beauty buffer; redraw it every frame.
    if (this.renderPass) this.renderPass.enabled = true;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.landmarkWarmup?.tick();
    this.sceneryPreparation.pump(
      this.settings.quality === 'balanced'
        ? 0
        : this.transition || this.settings.mode !== 'orbit'
          ? 0.5
          : 1.5,
    );
  }
  elevation(x: number, z: number): number {
    return this.beachGround?.height(x, z) ?? this.rawElevation(x, z);
  }
  rawElevation(x: number, z: number): number {
    const d = this.data.elevation;
    if (!d) return 8;
    const c = unproject(x, z);
    const b = d.bbox || d.bounds;
    const w = d.width || d.cols,
      n = d.height || d.rows;
    const values = d.heights || d.elevations || d.data || d.values;
    if (!b || !values || !w || !n) return 8;
    const u = THREE.MathUtils.clamp(
        ((c[0] - b[0]) / (b[2] - b[0])) * (w - 1),
        0,
        w - 1,
      ),
      v = THREE.MathUtils.clamp(
        ((b[3] - c[1]) / (b[3] - b[1])) * (n - 1),
        0,
        n - 1,
      );
    const i = Math.min(w - 2, Math.floor(u)),
      j = Math.min(n - 2, Math.floor(v)),
      a = u - i,
      bv = v - j;
    const at = (xx: number, yy: number) =>
      Array.isArray(values[yy]) ? values[yy][xx] : values[yy * w + xx];
    return Math.max(
      1.2,
      (at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - bv) +
        (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * bv,
    );
  }
  onLand(x: number, z: number) {
    // On MHWS itself use the explicit beach water convention.
    const sample = this.beachGround?.near(x, z)
      ? this.beachGround.surface.sample(x, z, this.rawElevation(x, z))
      : undefined;
    return sample?.isLand ?? this.landPolys.some((p) => inPolygon([x, z], p));
  }
  geometry(
    pos: number[],
    normals?: number[],
    colors?: number[],
    uvs?: number[],
  ) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (normals)
      g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else g.computeVertexNormals();
    if (colors)
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return g;
  }
  makeWater() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c7587,
      roughness: 0.59,
      metalness: 0.16,
      envMapIntensity: 0.15,
    });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.uniforms.time;
      s.vertexShader = 'varying vec3 vWorld;\n' + s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorld=(modelMatrix*vec4(position,1.0)).xyz;',
      );
      s.fragmentShader =
        'uniform float uTime;\nvarying vec3 vWorld;\n' + s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
   float w1=sin(vWorld.x*.035+vWorld.z*.023+uTime*.7);float w2=cos(vWorld.z*.045-vWorld.x*.017+uTime*.9);
   normal=normalize(normal+vec3(w1*.025,w2*.025,0.0));`,
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
   float wave=sin(vWorld.x*.055+vWorld.z*.08+uTime*.6)*sin(vWorld.z*.036-vWorld.x*.071+uTime*.4);
   diffuseColor.rgb*=.98+wave*.025;`,
      );
    };
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(80000, 80000), mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = 0.1;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }
  makeLand() {
    // Shared triangle vertices need the same elevation/park classification.
    // Keep exact coordinates (no quantization) and release caches after build.
    const samples = new Map<string, { height: number; color: number }>();
    const sample = (x: number, z: number) => {
      const key = `${x}:${z}`;
      let value = samples.get(key);
      if (!value) {
        const park = this.parkPolys.find((p) => inPolygon([x, z], p.poly));
        value = {
          height: this.elevation(x, z),
          color: park
            ? park.name === 'Stanley Park'
              ? 0x476d3f
              : 0x658a4f
            : 0x95998a,
        };
        samples.set(key, value);
      }
      return value;
    };
    const positions: number[] = [],
      colors: number[] = [];
    for (const [polyIndex, poly] of (
      this.data.originalLandPolys as number[][][][]
    ).entries()) {
      const boundary = poly.flat(),
        xs = poly[0].map((p) => p[0]),
        zs = poly[0].map((p) => p[1]);
      const xmin = Math.min(...xs),
        xmax = Math.max(...xs),
        zmin = Math.min(...zs),
        zmax = Math.max(...zs);
      const pts = [...boundary];
      for (let x = xmin + 22; x < xmax; x += 32)
        for (let z = zmin + 17; z < zmax; z += 32)
          if (inPolygon([x, z], poly)) pts.push([x, z]);
      const tri = Delaunator.from(pts).triangles;
      for (let i = 0; i < tri.length; i += 3) {
        if (this.beachGround.replacements.has(`${polyIndex}:${i}`)) continue;
        const p = [pts[tri[i]], pts[tri[i + 1]], pts[tri[i + 2]]];
        const cx = (p[0][0] + p[1][0] + p[2][0]) / 3,
          cz = (p[0][1] + p[1][1] + p[2][1]) / 3;
        if (!inPolygon([cx, cz], poly)) continue;
        // Consistent upward winding in the east/south plane.
        if (
          (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
            (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) >
          0
        )
          [p[1], p[2]] = [p[2], p[1]];
        for (const q of p) {
          const value = sample(q[0], q[1]);
          positions.push(q[0], value.height, q[1]);
          const c = new THREE.Color(value.color).multiplyScalar(
            0.97 +
              hash(Math.round(cx / 60) + Math.round(cz / 60) * 781) * 0.065,
          );
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    // One physical terrain mesh remains first in terrain.children, including
    // all graded sand; MapPlacement therefore raycasts the same final surface.
    const coast = this.data.beachCoast as BeachCoastData;
    for (const source of [coast.outsidePositions, coast.profilePositions])
      for (let i = 0; i < source.length; i += 3) {
        const x = source[i],
          y = source[i + 1],
          z = source[i + 2];
        positions.push(x, y, z);
        const park = this.parkPolys.find((p) => inPolygon([x, z], p.poly));
        const color = new THREE.Color(
          park
            ? park.name === 'Stanley Park'
              ? 0x476d3f
              : 0x658a4f
            : 0x95998a,
        );
        const beach = this.beachGround.surface.sample(
          x,
          z,
          this.rawElevation(x, z),
        );
        if (beach)
          color.lerp(
            new THREE.Color(0xc9b98d).lerp(
              new THREE.Color(0x8d8267),
              beach.wetness * 0.55,
            ),
            beach.sandWeight,
          );
        colors.push(color.r, color.g, color.b);
      }
    const mesh = new THREE.Mesh(
      this.geometry(positions, undefined, colors),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    mesh.receiveShadow = true;
    mesh.userData.walkSurface = true;
    this.terrain.add(mesh);
  }
  polygonMesh(poly: number[][][], color: number, offset = 0.5) {
    const positions: number[] = [],
      pts = poly.map((r) =>
        r.slice(0, -1).map((p) => new THREE.Vector2(p[0], p[1])),
      ),
      flat = pts.flat();
    if (!pts[0]?.length) return;
    const triangles = THREE.ShapeUtils.triangulateShape(pts[0], pts.slice(1));
    // Subdivide long park triangles so the green surface follows the real hills.
    const add = (
      a: THREE.Vector2,
      b: THREE.Vector2,
      c: THREE.Vector2,
      depth = 0,
    ) => {
      if (
        depth < 7 &&
        Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > 65
      ) {
        const ab = a.clone().lerp(b, 0.5),
          bc = b.clone().lerp(c, 0.5),
          ca = c.clone().lerp(a, 0.5);
        add(a, ab, ca, depth + 1);
        add(ab, b, bc, depth + 1);
        add(ca, bc, c, depth + 1);
        add(ab, bc, ca, depth + 1);
        return;
      }
      for (const p of [a, c, b])
        positions.push(p.x, this.elevation(p.x, p.y) + offset, p.y);
    };
    triangles.forEach((t) => add(flat[t[0]], flat[t[1]], flat[t[2]]));
    const m = new THREE.Mesh(
      this.geometry(positions),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
    );
    m.receiveShadow = true;
    m.userData.walkSurface = true;
    this.terrain.add(m);
    return m;
  }
  makeParks() {
    this.parkPolys.forEach((p) =>
      this.polygonMesh(
        p.poly,
        p.name.toLowerCase().includes('stanley') ? 0x578247 : 0x78975c,
        0.65,
      ),
    );
  }
  makeBuildings() {
    createBuildingBodies(this);
    if (!this.compatibleGraphics)
      this.architecturalDetails = new ArchitecturalDetails(this);
  }
  ribbon(
    points: number[][],
    width: number,
    color: number,
    offset: number,
    group = this.roads,
  ) {
    const p: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const steps = Math.ceil(len / 25);
      for (let j = 0; j < steps; j++) {
        const t = j / steps,
          s = (j + 1) / steps,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t,
          xx = a[0] + (b[0] - a[0]) * s,
          zz = a[1] + (b[1] - a[1]) * s,
          dx = (((b[1] - a[1]) / len) * width) / 2,
          dz = ((-(b[0] - a[0]) / len) * width) / 2;
        for (const v of [
          [x - dx, z - dz],
          [x + dx, z + dz],
          [xx + dx, zz + dz],
          [x - dx, z - dz],
          [xx + dx, zz + dz],
          [xx - dx, zz - dz],
        ])
          p.push(v[0], this.elevation(v[0], v[1]) + offset, v[1]);
      }
    }
    const m = new THREE.Mesh(
      this.geometry(p),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
    m.receiveShadow = true;
    group.add(m);
    return m;
  }
  makeRoads() {
    createRoadSurfaces(this);
  }
  flyTo(id: string, animate = true) {
    if (this.flight?.attached) this.flight.detach();
    this.placement?.cancel();
    const v = VIEWS.find((p) => p.id === id) || VIEWS[0];
    this.fly(v, animate);
  }
  fly(v: Viewpoint, animate = true) {
    this.travelReturn?.invalidate(true);
    this.completeLocalMapTransition();
    const distance =
        v.distance *
        (v.distance >= 7800
          ? Math.max(1, Math.min(1.8, 0.85 / this.camera.aspect))
          : 1),
      [x, z] = project(v.coord),
      target = new THREE.Vector3(
        x,
        this.elevation(x, z) + (v.targetHeight || 0),
        z,
      ),
      pos = new THREE.Vector3(
        x + Math.sin(v.azimuth) * Math.cos(v.elevation) * distance,
        this.elevation(x, z) +
          (v.targetHeight || 0) +
          Math.sin(v.elevation) * distance,
        z + Math.cos(v.azimuth) * Math.cos(v.elevation) * distance,
      );
    if (animate)
      this.transition = {
        start: performance.now(),
        duration: 1800,
        from: this.camera.position.clone(),
        to: pos,
        fromTarget: this.controls.target.clone(),
        toTarget: target,
      };
    else {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
    }
  }
  completeLocalMapTransition() {
    finishLocalMapTransition(this);
  }
  leaveTravelAtLocation(remember = false) {
    if (this.flight?.attached) { this.flight.detach(); return; }
    if (!enterLocalMap(this, remember)) return;
    this.onLocalOrbit();
  }
  zoom(f: number) {
    if (this.flight?.attached) { this.flight.zoom(f); return; }
    if (this.navigation && this.navigation.mode !== 'orbit') {
      this.navigation.zoom(f);
      return;
    }
    if (!Number.isFinite(f) || f <= 0) return;
    this.completeLocalMapTransition();
    this.transition = null;
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(f)
      .add(this.controls.target);
    this.controls.update();
    this.travelReturn?.update();
  }
  focusTrain(kind: TrainKind) {
    if(this.flight?.attached) this.flight.detach();
    this.travelReturn?.invalidate(true);
    this.completeLocalMapTransition();
    const train = this.railway?.trains.find((t) => t.kind === kind);
    if (!train) return;
    this.placement?.cancel();
    this.navigation?.setMode('orbit');
    this.settings.mode = 'orbit';
    this.settings.trains = true;
    this.railway!.group.visible = true;
    if (!train.cars.some((c) => c.group.visible)) {
      // A cropped open route has an off-scene interval between passes. Bring
      // its next service into view only when no existing car would teleport.
      const span = train.path.length + train.length + 100;
      train.phase =
        (train.path.length * 0.4 + 40 - this.railway!.elapsed * train.speed) /
        span;
      updateRailway(this, this.railway!, 0);
    }
    const car = train.cars.find((c) => c.group.visible) || train.cars[0];
    const target = car.group.visible
      ? car.group.position.clone()
      : train.path.sample(train.path.length * 0.5);
    const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(
      car.group.quaternion,
    );
    const side = new THREE.Vector3(direction.z, 0, -direction.x);
    const position = target
      .clone()
      .addScaledVector(side, 110)
      .addScaledVector(direction, -65);
    position.y += 75;
    this.transition = {
      start: performance.now(),
      duration: 1400,
      from: this.camera.position.clone(),
      to: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target.addScaledVector(direction, 18),
    };
  }
  focusHarbour(kind: HarbourKind) {
    if(this.flight?.attached) this.flight.detach();
    this.travelReturn?.invalidate(true);
    this.completeLocalMapTransition();
    const actor = this.harbour?.actors.find((a) => a.kind === kind);
    if (!actor) return;
    if (actor.offRoute) {
      actor.phase = -this.harbour!.elapsed;
      updateHarbour(this, this.harbour!, 0);
    }
    this.placement?.cancel();
    this.navigation?.setMode('orbit');
    this.settings.mode = 'orbit';
    const target = actor.model.position.clone(),
      distance = kind === 'cruise' ? 520 : 140;
    this.transition = {
      start: performance.now(),
      duration: 1400,
      from: this.camera.position.clone(),
      to: target
        .clone()
        .add(new THREE.Vector3(distance * 0.5, distance * 0.6, distance * 0.7)),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
  }
  applySettings(settings: Settings) {
    if (settings.mode !== this.settings.mode) {
      if (settings.mode === 'walk' || settings.mode === 'drive' || settings.mode === 'boat') this.flight?.clear();
      if (settings.mode === 'orbit' && this.flight?.attached) this.flight.detach();
      if (settings.mode !== 'flight') this.navigation?.setMode(settings.mode);
    }
    this.settings = { ...settings };
    this.scheduleScenery?.();
    this.buildings.visible = settings.buildings;
    this.vegetation.visible = settings.trees;
    this.controls.autoRotate = settings.autoRotate;
    this.resizeQuality();
    this.renderer.shadowMap.enabled =
      !this.compatibleGraphics &&
      settings.quality !== 'balanced' &&
      this.camera.position.distanceTo(this.controls.target) < 4500;
    this.controls.autoRotateSpeed = 0.5;
    this.trafficGroup.visible = settings.traffic;
    if (this.railway) this.railway.group.visible = settings.trains;
    if (this.harbour) this.harbour.group.visible = settings.harbour;
    this.landmarks.visible = settings.buildings;
    this.detailedTrees?.update(true);
    this.updateLighting(true);
    this.updateShadowFrustum?.();
  }
  setClock(patch: Partial<ClockState>) {
    this.clock.configure(patch, performance.now());
    this.updateLighting(true);
    this.stats.clock = this.clock.snapshot();
    this.onStats({ ...this.stats });
  }
  setAtmosphere(mode: AtmosphereMode) {
    const next = normalizeAtmosphere(mode);
    if (next === this.atmosphere || this.disposed || this.contextLost) return;
    this.atmosphere = next;
    this.updateLighting(true);
  }
  tickClock(time: number) {
    this.clock.tick(time);
    if (
      this.clock.hour !== this.lastLightHour &&
      time - this.lastLightUpdate >= 100
    )
      this.updateLighting(false, time);
  }
  updateLighting(force = false, time = performance.now()) {
    const hour = this.clock.hour;
    this.lastLightHour = hour;
    this.lastLightUpdate = time;
    const lighting = sampleAtmosphere(hour, this.atmosphere),
      { angle: a, night } = lighting;
    this.uniforms.night.value = night;
    for (const n of this.data.nightMaterials || [])
      n.material.emissiveIntensity = night * n.intensity;
    for (const o of this.data.nightObjects || []) o.visible = night > 0.15;
    if (this.traffic)
      (
        this.traffic.lamps.material as THREE.MeshStandardMaterial
      ).emissiveIntensity = 0.05 + night * 1.7;
    this.sun.position.set(
      Math.cos(a) * 4500,
      Math.sin(a) * 5000,
      1400,
    );
    applyAtmosphereSky(this.sky, lighting);
    this.sky.visible = true;
    this.uniforms.skyHorizon.value.copy(lighting.horizon);
    this.uniforms.skyZenith.value.copy(lighting.zenith);
    if (this.skyEffects) this.skyEffects.atmosphereVisibility = lighting.celestialVisibility;
    this.sun.position.add(this.sun.target.position);
    this.sun.intensity = lighting.sunIntensity;
    this.sun.color.copy(lighting.sunColor);
    this.ambient.intensity = lighting.ambientIntensity;
    this.ambient.color.copy(lighting.hemisphereSky);
    this.ambient.groundColor.copy(lighting.hemisphereGround);
    if (this.environmentCache) {
      this.environmentTarget = this.environmentCache.get(this.atmosphere, lighting.environmentPhase);
      this.scene.environment = this.environmentTarget.texture;
    }
    this.scene.environmentIntensity = lighting.environmentIntensity;
    this.scene.background = lighting.horizon;
    if (this.scene.fog) {
      this.scene.fog.color.copy(lighting.horizon);
      if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = lighting.fogDensity;
    }
    this.renderer.toneMappingExposure = lighting.exposure;
    const hourDelta = Math.abs(hour - this.lastShadowHour);
    const movedSun = Math.min(hourDelta, 24 - hourDelta) >= 1 / 30;
    if (force || (movedSun && time - this.lastSolarShadowUpdate >= 750)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowHour = hour;
      this.lastSolarShadowUpdate = time;
    }
  }
  animate = (time: number) => {
    if (this.disposed || this.contextLost || this.pageSuspended) return;
    this.raf = requestAnimationFrame(this.animate);
    this.uniforms.time.value = time / 1000;
    this.tickClock(time);
    if (this.transition) {
      const t = THREE.MathUtils.clamp(
          (performance.now() - this.transition.start) /
            this.transition.duration,
          0,
          1,
        ),
        u = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(
        this.transition.from,
        this.transition.to,
        u,
      );
      this.controls.target.lerpVectors(
        this.transition.fromTarget,
        this.transition.toTarget,
        u,
      );
      if (this.transition.fromQuaternion && this.transition.toQuaternion)
        this.camera.quaternion.slerpQuaternions(
          this.transition.fromQuaternion,
          this.transition.toQuaternion,
          u,
        );
      else this.camera.lookAt(this.controls.target);
      if (t === 1) {
        if (this.transition.localMap) this.controls.enabled = true;
        this.transition = null;
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    if (this.traffic && this.settings.traffic)
      updateTraffic(this, this.traffic, time / 1000);
    if (this.railway && this.settings.trains)
      updateRailway(
        this,
        this.railway,
        this.lastTime ? (time - this.lastTime) / 1000 : 0,
      );
    if (this.harbour)
      updateHarbour(
        this,
        this.harbour,
        this.lastTime ? (time - this.lastTime) / 1000 : 0,
      );
    if (this.settings.mode === 'orbit') {
      if (!this.transition) this.controls.update();
    } else if (this.settings.mode !== 'flight') this.navigation?.update((time - this.lastTime) / 1000);
    this.flight?.update(this.lastTime ? (time - this.lastTime) / 1000 : 0);
    this.travelReturn?.update();
    this.sailingWaves?.update();
    this.discoveryMarker?.update(time, !!this.discoveryTarget && this.settings.mode === 'walk');
    this.minimap?.draw(time);
    if (
      this.settings.mode === 'orbit' &&
      !this.transition?.localMap &&
      this.onLand(this.camera.position.x, this.camera.position.z)
    )
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.elevation(this.camera.position.x, this.camera.position.z) + 4,
      );
    this.updateLabels();
    // LOD changes alter shadow casters even when the sun does not move.
    if (this.camera.position.distanceTo(this.lastShadowCamera) > 120) {
      this.renderer.shadowMap.needsUpdate = true;
      this.lastShadowCamera.copy(this.camera.position);
    }
    this.lastTime = time;
    this.skyEffects.update(
      this.clock.hour,
      this.clock.calendarDay,
      time,
      this.camera,
    );
    this.renderScene();
    this.frames++;
    if (time - this.fpsAt > 800) {
      this.renderer.domElement.dataset.triangles = String(
        this.renderer.info.render.triangles,
      );
      this.renderer.domElement.dataset.drawCalls = String(
        this.renderer.info.render.calls,
      );
      this.renderer.domElement.dataset.geometries = String(
        this.renderer.info.memory.geometries,
      );
      this.stats.renderWidth = this.renderer.domElement.width;
      this.stats.renderHeight = this.renderer.domElement.height;
      this.stats.fps = Math.round((this.frames * 1000) / (time - this.fpsAt));
      this.stats.trafficStop = this.navigation?.trafficStop?.caption || '';
      this.stats.speed = Math.round((this.flight?.attached ? this.flight.state?.speed || 0 : this.navigation?.speed || 0) * 3.6);
      this.stats.clock = this.clock.snapshot();
      this.stats.heading = this.controls.getAzimuthalAngle();
      const location = this.flight?.pose || minimapPose(this.navigation, this.controls.target);
      [this.stats.lon, this.stats.lat] = unproject(location.x, location.z);
      this.stats.distance = Math.round(
        this.camera.position.distanceTo(this.controls.target),
      );
      this.stats.elevation = Math.round(
        this.settings.mode === 'orbit'
          ? this.elevation(this.controls.target.x, this.controls.target.z)
          : this.flight?.attached ? this.flight.state!.y : this.navigation?.position.y || 0,
      );
      this.onStats({ ...this.stats });
      this.fpsAt = time;
      this.frames = 0;
    }
  };

  setLocale(locale: Locale) {
    this.locale = locale;
    this.renderer.domElement.setAttribute(
      'aria-label',
      translate(locale, 'canvasLabel'),
    );
    for (const label of this.labelElements) {
      const name = viewText(locale, label.id, 'name');
      label.element.textContent = name;
      label.element.setAttribute(
        'aria-label',
        translate(locale, 'goToPlace', { name }),
      );
    }
  }
  attachLabels(host: HTMLElement, onSelect: (id: string) => void) {
    const heights: Record<string, number> = {
      overview: 0,
      downtown: 100,
      stanley: 105,
      science: 65,
      bcplace: 70,
      lookout: 180,
      marine: 106,
      convention: 38,
      harbour: 30,
      canada: 70,
      waterfront: 28,
      railway: 12,
      skytrain: 18,
      english: 7,
      falsecreek: 12,
      lions: 130,
    };
    for (const v of VIEWS.filter(
      (v) => v.id !== 'overview' && v.id !== 'downtown',
    )) {
      const [x, z] = project(v.coord),
        el = document.createElement('button');
      el.className = 'map-label';
      const name = viewText(this.locale, v.id, 'name');
      el.textContent = name;
      el.setAttribute(
        'aria-label',
        translate(this.locale, 'goToPlace', { name }),
      );
      el.addEventListener('click', () => onSelect(v.id));
      host.appendChild(el);
      this.labelElements.push({
        element: el,
        position: new THREE.Vector3(x, this.elevation(x, z) + heights[v.id], z),
        id: v.id,
      });
    }
  }
  updateLabels() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    for (const l of this.labelElements) {
      const p = l.position.clone().project(this.camera),
        distance = this.camera.position.distanceTo(l.position),
        visible =
          this.settings.labels &&
          p.z > -1 &&
          p.z < 1 &&
          p.x > -0.95 &&
          p.x < 0.94 &&
          p.y > -0.85 &&
          p.y < 0.77 &&
          distance < 10500 &&
          this.settings.mode === 'orbit';
      l.element.style.display = visible ? 'flex' : 'none';
      if (visible)
        l.element.style.transform = `translate(${((p.x + 1) * w) / 2}px,${((1 - p.y) * h) / 2}px) translate(-50%,-100%)`;
    }
  }
  setDiscoveryTarget(target: DiscoveryTarget | null) {
    if (this.disposed) return;
    this.discoveryTarget = target && Number.isFinite(target.x) && Number.isFinite(target.z)
      ? { ...target } : null;
    if (this.discoveryTarget) {
      this.discoveryMarker ??= new DiscoveryMarker(this.scene);
      const { x, z } = this.discoveryTarget;
      this.discoveryMarker.place(this.discoveryTarget, this.navigation?.groundHeight(x, z) ?? this.elevation(x, z));
    }
    this.discoveryMarker?.update(performance.now(), !!this.discoveryTarget && this.settings.mode === 'walk');
    this.minimap?.draw(performance.now(), true);
  }
  drawMinimap(canvas: HTMLCanvasElement) {
    if (this.minimap?.canvas !== canvas)
      this.minimap = new LocalMinimap(this, canvas, (id) =>
        viewText(this.locale, id, 'name'),
      );
    this.minimap.draw(performance.now(), true);
  }
  setMinimapSpan(span: number) {
    if (!this.minimap) return;
    this.minimap.span = span;
    this.minimap.draw(performance.now(), true);
  }
  navigateMinimap(event: MouseEvent) {
    const map = this.minimap;
    if (!map || this.navigation?.mode !== 'orbit') return;
    const canvas = map.canvas,
      rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = minimapWorldPoint(
      (((event.clientX - rect.left) / rect.width) * canvas.width) / 2,
      (((event.clientY - rect.top) / rect.height) * canvas.height) / 2,
      map.transform,
    );
    this.fly({
      ...VIEWS[0],
      coord: unproject(point.x, point.z),
      distance: 1300,
      elevation: 0.8,
    });
  }

  screenshot() {
    this.renderScene();
    return this.renderer.domElement.toDataURL('image/png');
  }
  destroy() {
    document.removeEventListener('visibilitychange', this.visibilityChange);
    if (this.disposed) return;
    if (process.env.VANCOUVER_VISUAL_QA === '1') {
      this.startupQA?.dispose();
    }
    window.removeEventListener('pagehide', this.pageHide);
    window.removeEventListener('pageshow', this.pageShow);
    this.disposed = true;
    this.loadAbort.abort();
    if (process.env.NODE_ENV === 'development') {
      const inspectWindow = window as Window & { __atlas?: CityEngine };
      if (inspectWindow.__atlas === this) delete inspectWindow.__atlas;
    }
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.labelElements.forEach((l) => l.element.remove());
    this.minimap = null;
    this.aoExclusions?.dispose();
    this.aoExclusions = null;
    this.travelReturn?.destroy();
    this.flight?.destroy();
    this.navigation?.destroy();
    this.placement?.destroy();
    this.controls?.dispose();
    this.landmarkDetails.forEach((l) => l.disposePending());
    this.sceneryPreparation.dispose();
    this.landmarkWarmup?.dispose();
    this.landmarkWorker?.dispose();
    this.detailedTrees?.dispose();
    this.facadeDetails?.dispose();
    this.architecturalDetails?.dispose();
    this.streetscapeKit?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      m.customDepthMaterial?.dispose();
      m.customDistanceMaterial?.dispose();
      if (m instanceof THREE.InstancedMesh) m.dispose();
      if (m.material) {
        for (const a of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(a))
            if (v instanceof THREE.Texture) v.dispose();
          a.dispose();
        }
      }
    });
    this.environmentCache?.dispose();
    this.extraTextures.forEach((t) => t.dispose());
    this.sun.shadow.dispose();
    this.composer?.passes.forEach((p) => p.dispose());
    this.composer?.dispose();
    for (const m of this.roadMaterials.values()) m.map?.dispose();
    this.renderer?.domElement.removeEventListener(
      'webglcontextlost',
      this.graphicsContextLost,
    );
    this.renderer?.dispose();

    this.renderer?.domElement.remove();
  }
}

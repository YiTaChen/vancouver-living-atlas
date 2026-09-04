import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import Delaunator from 'delaunator';
import { createStreetfronts, createRoofDetails } from './streetfronts';
import { createBridgeApproaches } from './bridges';
import { makeContext } from './context';
import { StreetNavigation } from './navigation';
import { createLandmarks } from './landmarks';
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
  scene = new THREE.Scene();
  environmentTarget: THREE.WebGLRenderTarget | null = null;
  extraTextures = new Set<THREE.Texture>();
  contextLost = false;
  shadowKey = '';
  sky = new Sky();
  composer: EffectComposer | null = null;
  renderPass: RenderPass | null = null;
  fxaa: ShaderPass | null = null;
  pageHide = () => this.destroy();
  ssao: SSAOPass | null = null;
  roadMaterials = new Map<string, THREE.MeshStandardMaterial>();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  buildings = new THREE.Group();
  vegetation = new THREE.Group();
  roads = new THREE.Group();
  terrain = new THREE.Group();
  landmarks = new THREE.Group();
  trafficGroup = new THREE.Group();
  traffic: Traffic | null = null;
  navigation: StreetNavigation | null = null;
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
  landPolys: number[][][][] = [];
  parkPolys: { name: string; poly: number[][][] }[] = [];
  sun = new THREE.DirectionalLight(0xffecd0, 3);
  ambient = new THREE.HemisphereLight(0xc9e7ff, 0x66746b, 2.2);
  water!: THREE.Mesh;
  uniforms = { night: { value: 0 }, time: { value: 0 } };
  disposed = false;
  frame = 0;
  resizeObserver: ResizeObserver;
  lastTime = 0;
  fpsAt = 0;
  frames = 0;
  transition: null | {
    start: number;
    duration: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } = null;
  onStats: (s: SceneStats) => void;
  onReady: () => void;
  onError: (s: string) => void;
  raf = 0;
  labelElements: {
    element: HTMLButtonElement;
    position: THREE.Vector3;
    id: string;
  }[] = [];
  minimapCanvas: HTMLCanvasElement | null = null;
  miniMapTransform = { scale: 1, xmin: 0, zmin: 0, ox: 0, oy: 0 };
  constructor(
    public container: HTMLElement,
    onStats: (s: SceneStats) => void,
    onReady: () => void,
    onError: (s: string) => void,
  ) {
    this.onStats = onStats;
    this.onReady = onReady;
    this.onError = onError;
    this.camera = new THREE.PerspectiveCamera(42, 1, 2, 45000);
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '可互動的溫哥華 3D 地圖。拖曳旋轉、滾輪縮放、右鍵平移。',
    );
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      if (this.disposed) return;
      event.preventDefault();
      this.contextLost = true;
      cancelAnimationFrame(this.raf);
      this.onError(
        '圖形處理暫時中斷。請重新載入地圖，或關閉其他 3D 分頁後再試。',
      );
    });
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 28;
    this.controls.maxDistance = 12500;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.screenSpacePanning = false;
    this.controls.zoomSpeed = 0.75;
    this.controls.rotateSpeed = 0.65;
    this.controls.addEventListener('start', () => {
      this.transition = null;
    });
    this.sky.scale.setScalar(35000);
    this.sky.material.uniforms.turbidity.value = 3;
    this.sky.material.uniforms.rayleigh.value = 1.7;
    this.sky.material.uniforms.mieCoefficient.value = 0.005;
    this.sky.material.uniforms.mieDirectionalG.value = 0.8;
    this.sky.material.uniforms.sunPosition.value.set(-4000, 5000, 1400);
    this.scene.add(this.sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      envScene = new THREE.Scene();
    envScene.add(this.sky.clone());
    this.environmentTarget = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.012;
    pmrem.dispose();
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
      near: 100,
      far: 9500,
    });
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 1.2;
    this.scene.add(this.sun.target);
    this.scene.background = new THREE.Color(0xbdd9e3);
    this.scene.fog = new THREE.FogExp2(0xbdd9e3, 0.000027);
    this.flyTo('overview', false);
    this.resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth,
        h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer?.setSize(w, h);
      this.resizeQuality();
    });
    this.resizeObserver.observe(container);
    this.load().catch((e) => {
      if (!this.disposed) this.onError(String(e.message || e));
    });
  }
  async load() {
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
    await Promise.all(
      names.map(async (n) => {
        const res = await fetch(`/data/${n}.geojson`);
        if (!res.ok) throw new Error(`無法載入 ${n} 地理資料 (${res.status})`);
        this.data[n] = await res.json();
      }),
    );
    const t = await fetch('/data/terrain.json');
    if (t.ok) this.data.elevation = await t.json();
    const bridgeData = await fetch('/data/bridges.json');
    if (bridgeData.ok) this.data.bridges = await bridgeData.json();
    const tr = await fetch('/data/trees.json');
    if (tr.ok) this.data.trees = await tr.json();
    const ctx = await fetch('/data/context-terrain.json');
    if (ctx.ok) this.data.contextTerrain = await ctx.json();
    if (this.disposed) return;
    this.landPolys = this.data.land.features.flatMap((f: Feature) =>
      rings(f).map((p) => p.map((r) => r.map(project))),
    );
    this.parkPolys = this.data.parks.features.flatMap((f: Feature) =>
      rings(f).map((p) => ({
        name: f.properties.name || f.properties.park_name || '',
        poly: p.map((r) => r.map(project)),
      })),
    );
    this.makeWater();
    this.makeLand();
    makeContext(this);
    this.makeBuildings();
    this.makeRoads();
    createLandmarks(this);
    createBridgeApproaches(this);
    createNature(this);
    createStreetfronts(this);
    createRoofDetails(this);
    this.traffic = createStreetDetails(this);
    this.navigation = new StreetNavigation(this);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.resizeQuality();
    this.applySettings(this.settings);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (this.disposed || this.contextLost) return;
    window.addEventListener('pagehide', this.pageHide, { once: true });
    this.onReady();
    this.fpsAt = performance.now();
    this.animate(this.fpsAt);
  }
  pixelRatio() {
    const w = Math.max(1, this.container.clientWidth),
      h = Math.max(1, this.container.clientHeight);
    return Math.min(
      window.devicePixelRatio,
      this.settings.quality === 'high' ? 1.25 : 1,
      Math.sqrt(1800000 / (w * h)),
    );
  }
  resizeQuality() {
    const ratio = this.pixelRatio();
    this.renderer.setPixelRatio(ratio);
    this.composer?.setPixelRatio(ratio);
    this.fxaa?.uniforms.resolution.value.set(
      1 / (this.container.clientWidth * ratio),
      1 / (this.container.clientHeight * ratio),
    );
  }
  renderScene() {
    this.renderer.info.reset();
    const shadows =
      this.settings.quality === 'high' &&
      this.camera.position.distanceTo(this.controls.target) < 4500;
    if (shadows !== this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = shadows;
      this.renderer.shadowMap.needsUpdate = shadows;
    }
    const ao =
      this.settings.quality === 'high' &&
      this.camera.position.distanceTo(this.controls.target) < 3500;
    if (ao && !this.ssao && this.composer) {
      const ratio = this.pixelRatio();
      this.ssao = new SSAOPass(
        this.scene,
        this.camera,
        this.container.clientWidth * ratio,
        this.container.clientHeight * ratio,
        8,
      );
      this.ssao.maxDistance = 0.005;
      this.composer.insertPass(this.ssao, 1);
    }
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
    if (this.renderPass) this.renderPass.enabled = !ao;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
  elevation(x: number, z: number): number {
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
    return this.landPolys.some((p) => inPolygon([x, z], p));
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
    const positions: number[] = [],
      colors: number[] = [];
    for (const poly of this.landPolys) {
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
          const h = this.elevation(q[0], q[1]);
          positions.push(q[0], h, q[1]);
          const park = this.parkPolys.find((p) => inPolygon(q, p.poly));
          const c = new THREE.Color(
            park
              ? park.name === 'Stanley Park'
                ? 0x476d3f
                : 0x658a4f
              : 0x95998a,
          ).multiplyScalar(
            0.97 +
              hash(Math.round(cx / 60) + Math.round(cz / 60) * 781) * 0.065,
          );
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    const mesh = new THREE.Mesh(
      this.geometry(positions, undefined, colors),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    mesh.receiveShadow = true;
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
    const pos: number[] = [],
      norm: number[] = [],
      colors: number[] = [],
      uv: number[] = [],
      styles: number[] = [];
    let style = 0;
    const palette = [
      0x91aeb0, 0xa3b9bc, 0xaebbbc, 0x8fa5a9, 0xb4b6ab, 0xd5d0bb, 0x8dabae,
      0xc4c2b5, 0x687f84,
    ];
    let count = 0;
    const foundations = new Map<string, number>();
    const vertex = (
      x: number,
      y: number,
      z: number,
      nx: number,
      ny: number,
      nz: number,
      c: THREE.Color,
      u: number,
      v: number,
    ) => {
      pos.push(x, y, z);
      norm.push(nx, ny, nz);
      colors.push(c.r, c.g, c.b);
      uv.push(u, v);
      styles.push(style);
    };
    for (const f of this.data.buildings.features) {
      const prop = f.properties,
        h = Math.max(2, Number(prop.height ?? prop.hgt_agl ?? 8));
      if (h > 350) continue;
      for (const polygon of rings(f)) {
        const poly = polygon.map((r) => r.slice(0, -1).map(project));
        if (poly[0].length < 3) continue;
        const center = poly[0].reduce(
          (a, p) => [
            a[0] + p[0] / poly[0].length,
            a[1] + p[1] / poly[0].length,
          ],
          [0, 0],
        );
        const key = String(prop.structureId ?? prop.buildingId ?? prop.id);
        if (!foundations.has(key))
          foundations.set(key, this.elevation(center[0], center[1]) - 0.4);
        const ground = foundations.get(key)!,
          base = ground + Math.max(0, Number(prop.minHeight) || 0),
          top = ground + h;
        const c = new THREE.Color(
          palette[Math.floor(hash(count * 3.7) * palette.length)],
        );
        style =
          (h < 48 &&
            center[0] > 700 &&
            center[0] < 1850 &&
            center[1] > -70 &&
            center[1] < 540) ||
          (h < 28 && prop.source === 'cov-2009' && hash(count + 73) > 0.8)
            ? 1
            : 0;
        if (style) c.set(hash(count) > 0.4 ? 0xb9876b : 0x8c8980);
        if (h < 15) c.lerp(new THREE.Color(0xc7bcaa), 0.3);
        for (const ring of poly) {
          const area = ring.reduce((s, p, i) => {
            const q = ring[(i + 1) % ring.length];
            return s + p[0] * q[1] - q[0] * p[1];
          }, 0);
          if (area < 0) ring.reverse();
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i],
              b = ring[(i + 1) % ring.length],
              dx = b[0] - a[0],
              dz = b[1] - a[1],
              len = Math.hypot(dx, dz);
            if (len < 0.01) continue;
            const nx = dz / len,
              nz = -dx / len;
            [
              [a[0], base, a[1], 0, 0],
              [b[0], top, b[1], len, h],
              [b[0], base, b[1], len, 0],
              [a[0], base, a[1], 0, 0],
              [a[0], top, a[1], 0, h],
              [b[0], top, b[1], len, h],
            ].forEach((v) =>
              vertex(v[0], v[1], v[2], nx, 0, nz, c, v[3], v[4]),
            );
          }
        }
        const p2 = poly.map((r) => r.map((p) => new THREE.Vector2(...p))),
          flat = p2.flat();
        for (const t of THREE.ShapeUtils.triangulateShape(p2[0], p2.slice(1)))
          for (const idx of [t[0], t[2], t[1]]) {
            const p = flat[idx];
            vertex(
              p.x,
              top,
              p.y,
              0,
              1,
              0,
              c.clone().multiplyScalar(0.88),
              -1,
              -1,
            );
          }
        count++;
      }
    }
    const brick = new THREE.TextureLoader().load(
      '/textures/brick-terracotta-albedo.png',
    );
    this.extraTextures.add(brick);
    brick.wrapS = brick.wrapT = THREE.RepeatWrapping;
    brick.colorSpace = THREE.SRGBColorSpace;
    brick.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.68,
      metalness: 0.12,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uNight = this.uniforms.night;
      s.uniforms.uBrick = { value: brick };
      s.vertexShader =
        'attribute float aStyle;varying float vStyle;varying vec2 vFacade;\n' +
        s.vertexShader;
      s.vertexShader = s.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFacade=uv;vStyle=aStyle;',
      );
      s.fragmentShader =
        'uniform sampler2D uBrick;uniform float uNight;varying float vStyle;varying vec2 vFacade;\n' +
        s.fragmentShader;
      s.fragmentShader = s.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if(vFacade.x>=0.0){if(vStyle>.5)diffuseColor.rgb=texture2D(uBrick,vFacade/1.728).rgb*diffuseColor.rgb*2.0;diffuseColor.rgb*=mix(.72,1.0,smoothstep(0.0,18.0,vFacade.y));vec2 cell=vec2(vFacade.x/3.1,vFacade.y/3.25);vec2 grid=fract(cell);float pane=smoothstep(.1,.17,grid.x)*(1.0-smoothstep(.79,.9,grid.x))*smoothstep(.18,.24,grid.y)*(1.0-smoothstep(.82,.9,grid.y));
   float rand=fract(sin(dot(floor(cell),vec2(127.1,311.7)))*43758.5453);float lit=step(.52,rand)*uNight;
   diffuseColor.rgb=mix(diffuseColor.rgb*1.12,diffuseColor.rgb*vec3(.50,.69,.77),pane);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0,.69,.3),pane*lit*.85);
  }`,
      );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
   if(vFacade.x>=0.0){vec2 grid=fract(vec2(vFacade.x/3.1,vFacade.y/3.25));float r=fract(sin(dot(floor(vec2(vFacade.x/3.1,vFacade.y/3.25)),vec2(127.1,311.7)))*43758.5453);float pane=step(.14,grid.x)*step(grid.x,.84)*step(.2,grid.y)*step(grid.y,.85);totalEmissiveRadiance+=vec3(1.,.6,.21)*pane*step(.52,r)*uNight*.9;}`,
      );
    };
    const geo = this.geometry(pos, norm, colors, uv);
    geo.setAttribute('aStyle', new THREE.Float32BufferAttribute(styles, 1));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.buildings.add(mesh);
    this.stats.buildings = count;
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
    let count = 0;
    const batches: Record<string, number[][][]> = {};
    for (const f of this.data.roads.features) {
      const t = String(
          f.properties.type || f.properties.class || '',
        ).toLowerCase(),
        n = String(f.properties.name || '');
      if (/bridge|causeway/i.test(n) || /bikeway/.test(t)) continue;
      const kind = String(
        Number(f.properties.width) ||
          (/lane/.test(t) ? 4 : /arterial/.test(t) ? 18 : 9),
      );
      batches[kind] ??= [];
      for (const l of lines(f)) {
        batches[kind].push(l.map(project));
        count++;
      }
    }
    for (const [kind, ls] of Object.entries(batches)) {
      const width = Number(kind);
      const positions: number[] = [],
        edge: number[] = [];
      for (const l of ls) {
        for (let i = 0; i < l.length - 1; i++) {
          const a = l[i],
            b = l[i + 1],
            len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len < 0.1) continue;
          for (let j = 0, steps = Math.ceil(len / 18); j < steps; j++) {
            const t = j / steps,
              s = (j + 1) / steps,
              x = a[0] + (b[0] - a[0]) * t,
              z = a[1] + (b[1] - a[1]) * t,
              xx = a[0] + (b[0] - a[0]) * s,
              zz = a[1] + (b[1] - a[1]) * s;
            for (const [w, array, offset] of [
              [width + 4, edge, 1.18],
              [width, positions, 1.05],
            ] as [number, number[], number][]) {
              const dx = (((b[1] - a[1]) / len) * w) / 2,
                dz = ((-(b[0] - a[0]) / len) * w) / 2;
              const points =
                array === edge
                  ? [-1, 1].flatMap((sign) => {
                      const ix = (dx * width) / w,
                        iz = (dz * width) / w;
                      return [
                        [x + dx * sign, z + dz * sign],
                        [x + ix * sign, z + iz * sign],
                        [xx + ix * sign, zz + iz * sign],
                        [x + dx * sign, z + dz * sign],
                        [xx + ix * sign, zz + iz * sign],
                        [xx + dx * sign, zz + dz * sign],
                      ];
                    })
                  : [
                      [x - dx, z - dz],
                      [x + dx, z + dz],
                      [xx + dx, zz + dz],
                      [x - dx, z - dz],
                      [xx + dx, zz + dz],
                      [xx - dx, zz - dz],
                    ];
              for (const p of points)
                array.push(p[0], this.elevation(p[0], p[1]) + offset, p[1]);
            }
          }
        }
      }
      for (const [p, color] of [
        [edge, 0xc8c5b8],
        [positions, 0x697579],
      ] as [number[], number][]) {
        const geometry = this.geometry(p),
          uv: number[] = [];
        for (let i = 0; i < p.length; i += 3) uv.push(p[i] / 3, p[i + 2] / 3);
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const kind = color === 0xc8c5b8 ? 'sidewalk-concrete' : 'asphalt-fine';
        if (!this.roadMaterials.has(kind)) {
          const loader = new THREE.TextureLoader(),
            map = loader.load(`/textures/${kind}-albedo.png`);
          map.wrapS = map.wrapT = THREE.RepeatWrapping;
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 8;
          this.roadMaterials.set(
            kind,
            new THREE.MeshStandardMaterial({
              map,
              color: 0xe1e2df,
              roughness: 0.94,
              side: THREE.DoubleSide,
            }),
          );
        }
        const mesh = new THREE.Mesh(geometry, this.roadMaterials.get(kind));
        mesh.receiveShadow = true;
        this.roads.add(mesh);
      }
    }
    this.stats.roads = count;
  }
  flyTo(id: string, animate = true) {
    const v = VIEWS.find((p) => p.id === id) || VIEWS[0];
    this.fly(v, animate);
  }
  fly(v: Viewpoint, animate = true) {
    const [x, z] = project(v.coord),
      target = new THREE.Vector3(x, this.elevation(x, z), z),
      pos = new THREE.Vector3(
        x + Math.sin(v.azimuth) * Math.cos(v.elevation) * v.distance,
        this.elevation(x, z) + Math.sin(v.elevation) * v.distance,
        z + Math.cos(v.azimuth) * Math.cos(v.elevation) * v.distance,
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
  zoom(f: number) {
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(f)
      .add(this.controls.target);
    this.controls.update();
  }
  applySettings(settings: Settings) {
    if (settings.mode !== this.settings.mode)
      this.navigation?.setMode(settings.mode);
    this.settings = { ...settings };
    this.buildings.visible = settings.buildings;
    this.vegetation.visible = settings.trees;
    this.controls.autoRotate = settings.autoRotate;
    this.resizeQuality();
    this.renderer.shadowMap.enabled =
      settings.quality === 'high' &&
      this.camera.position.distanceTo(this.controls.target) < 4500;
    this.controls.autoRotateSpeed = 0.5;
    const a = ((settings.hour - 6) / 14.5) * Math.PI,
      day = Math.max(0, Math.sin(a)),
      night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.38);
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
      Math.max(300, Math.sin(a) * 5000),
      1400,
    );
    this.sky.material.uniforms.sunPosition.value.copy(this.sun.position);
    this.sky.visible = day > 0.05;
    const extent = settings.mode === 'orbit' ? 2700 : 170;
    Object.assign(this.sun.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    if (settings.mode !== 'orbit') {
      this.sun.target.position.copy(this.controls.target);
      this.sun.position.add(this.controls.target);
    } else this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = day * 2.3 + 0.04;
    this.sun.color.set(night > 0.2 ? 0xffad73 : 0xffeed6);
    this.ambient.intensity = 0.4 + day * 1.3;
    const bg = new THREE.Color(0x102536).lerp(
      new THREE.Color(0xbedce9),
      Math.pow(day, 0.5),
    );
    this.scene.environmentIntensity = 0.002 + day * 0.016;
    this.scene.background = bg;
    if (this.scene.fog) this.scene.fog.color.copy(bg);
    this.renderer.toneMappingExposure = 1.06 + night * 0.1;
    this.trafficGroup.visible = settings.traffic;
    this.landmarks.visible = settings.buildings;
    const key = [
      settings.hour,
      settings.mode,
      settings.buildings,
      settings.trees,
      settings.quality,
    ].join(':');
    if (key !== this.shadowKey) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowKey = key;
    }
  }
  animate = (time: number) => {
    if (this.disposed || this.contextLost) return;
    this.raf = requestAnimationFrame(this.animate);
    this.uniforms.time.value = time / 1000;
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
      if (t === 1) this.transition = null;
    }
    if (this.traffic && this.settings.traffic)
      updateTraffic(this, this.traffic, time / 1000);
    if (this.settings.mode === 'orbit') this.controls.update();
    else this.navigation?.update((time - this.lastTime) / 1000);
    if (
      this.settings.mode === 'orbit' &&
      this.onLand(this.camera.position.x, this.camera.position.z)
    )
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.elevation(this.camera.position.x, this.camera.position.z) + 4,
      );
    if (
      this.settings.mode !== 'orbit' &&
      this.sun.target.position.distanceTo(this.controls.target) > 60
    ) {
      this.sun.position.sub(this.sun.target.position).add(this.controls.target);
      this.sun.target.position.copy(this.controls.target);
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.updateLabels();
    this.lastTime = time;
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
      this.stats.fps = Math.round((this.frames * 1000) / (time - this.fpsAt));
      this.stats.speed = Math.round((this.navigation?.speed || 0) * 3.6);
      this.stats.heading = this.controls.getAzimuthalAngle();
      this.stats.lon = unproject(
        this.controls.target.x,
        this.controls.target.z,
      )[0];
      this.stats.lat = unproject(
        this.controls.target.x,
        this.controls.target.z,
      )[1];
      this.stats.distance = Math.round(
        this.camera.position.distanceTo(this.controls.target),
      );
      this.stats.elevation = Math.round(
        this.elevation(this.controls.target.x, this.controls.target.z),
      );
      this.onStats({ ...this.stats });
      this.fpsAt = time;
      this.frames = 0;
    }
  };

  attachLabels(host: HTMLElement, onSelect: (id: string) => void) {
    const heights: Record<string, number> = {
      overview: 0,
      downtown: 100,
      stanley: 105,
      science: 65,
      canada: 70,
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
      el.textContent = v.name;
      el.setAttribute('aria-label', `前往 ${v.name}`);
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
  drawMinimap(canvas: HTMLCanvasElement) {
    this.minimapCanvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width,
      h = canvas.height,
      xmin = -2690,
      zmin = -3230,
      scale = Math.min((w - 16) / 5100, (h - 16) / 5350),
      ox = (w - 5100 * scale) / 2,
      oy = 8;
    this.miniMapTransform = { scale, xmin, zmin, ox, oy };
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1b424e';
    ctx.fillRect(0, 0, w, h);
    const polygon = (poly: number[][][], color: string) => {
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach((p, i) => {
          const x = (p[0] - xmin) * scale + ox,
            y = (p[1] - zmin) * scale + oy;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = color;
      ctx.fill('evenodd');
    };
    for (const poly of this.landPolys) polygon(poly, '#7b958c');
    for (const p of this.parkPolys) polygon(p.poly, '#425f49');
    ctx.strokeStyle = '#b9c2ab88';
    ctx.lineWidth = 0.6;
    for (const f of this.data.roads.features.filter((f: Feature) =>
      /arterial/i.test(f.properties.class || ''),
    ))
      for (const l of lines(f)) {
        ctx.beginPath();
        l.map(project).forEach((p, i) =>
          i
            ? ctx.lineTo((p[0] - xmin) * scale + ox, (p[1] - zmin) * scale + oy)
            : ctx.moveTo(
                (p[0] - xmin) * scale + ox,
                (p[1] - zmin) * scale + oy,
              ),
        );
        ctx.stroke();
      }
    for (const v of VIEWS.filter((v) =>
      ['science', 'stanley', 'canada'].includes(v.id),
    )) {
      const [x, z] = project(v.coord);
      ctx.beginPath();
      ctx.arc(
        (x - xmin) * scale + ox,
        (z - zmin) * scale + oy,
        3,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = '#e2e9a8';
      ctx.fill();
    }
  }
  navigateMinimap(event: MouseEvent) {
    const canvas = this.minimapCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(),
      { scale, xmin, zmin, ox, oy } = this.miniMapTransform,
      x =
        (((event.clientX - rect.left) / rect.width) * canvas.width - ox) /
          scale +
        xmin,
      z =
        (((event.clientY - rect.top) / rect.height) * canvas.height - oy) /
          scale +
        zmin,
      coord = unproject(x, z);
    this.fly({ ...VIEWS[0], coord, distance: 1300, elevation: 0.8 });
  }

  screenshot() {
    this.renderScene();
    return this.renderer.domElement.toDataURL('image/png');
  }
  destroy() {
    if (this.disposed) return;
    window.removeEventListener('pagehide', this.pageHide);
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.labelElements.forEach((l) => l.element.remove());
    this.navigation?.destroy();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      if (m instanceof THREE.InstancedMesh) m.dispose();
      if (m.material) {
        for (const a of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(a))
            if (v instanceof THREE.Texture) v.dispose();
          a.dispose();
        }
      }
    });
    this.environmentTarget?.dispose();
    this.extraTextures.forEach((t) => t.dispose());
    this.sun.shadow.dispose();
    this.composer?.passes.forEach((p) => p.dispose());
    this.composer?.dispose();
    for (const m of this.roadMaterials.values()) m.map?.dispose();
    this.renderer.dispose();

    this.renderer.domElement.remove();
  }
}

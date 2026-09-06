import { cityModule } from './helpers/city-modules.mjs';

import * as THREE from 'three';
import test from 'node:test';
import assert from 'node:assert/strict';
const { LandmarkGpuWarmup } = await import(cityModule('gpu-landmark-warmup'));
const { withRendererState } = await import(cityModule('renderer-state'));
const { warmComposer } = await import(cityModule('warm-composer'));
const { LandmarkLoadState } = await import(cityModule('landmark-load-state'));

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
class Renderer {
  autoClear = false;
  autoClearColor = false;
  autoClearDepth = true;
  autoClearStencil = false;
  xr = { enabled: true };
  shadowMap = {
    autoUpdate: true,
    needsUpdate: true,
    enabled: true,
    type: THREE.PCFShadowMap,
  };
  info = {
    autoReset: false,
    render: { frame: 123, calls: 22, triangles: 44, points: 8, lines: 5 },
  };
  localClippingEnabled = false;
  clippingPlanes = [];
  debug = { checkShaderErrors: false, onShaderError: null };
  target = new THREE.WebGLRenderTarget(120, 70);
  face = 3;
  level = 2;
  color = new THREE.Color(0x142331);
  alpha = 0.63;
  lost = false;
  calls = [];
  viewport = [4, 5, 640, 360];
  scissor = [7, 8, 444, 222];
  getRenderTarget() {
    return this.target;
  }
  getActiveCubeFace() {
    return this.face;
  }
  getActiveMipmapLevel() {
    return this.level;
  }
  setRenderTarget(target, face = 0, level = 0) {
    this.target = target;
    this.face = face;
    this.level = level;
  }
  getClearColor(out) {
    return out.copy(this.color);
  }
  getClearAlpha() {
    return this.alpha;
  }
  setClearColor(color, alpha = 1) {
    this.color.set(color);
    this.alpha = alpha;
  }
  getContext() {
    return { isContextLost: () => this.lost };
  }
  compile(object, camera, targetScene) {
    this.calls.push({
      type: 'compile',
      object,
      targetScene,
      target: this.target,
      shadow: { ...this.shadowMap },
    });
    this.onCompile?.(object, camera, targetScene);
  }
  render(scene, camera) {
    const objects = [];
    scene.traverse((o) => {
      if (o.isMesh || o.isPoints) objects.push(o);
    });
    this.calls.push({
      type: 'render',
      objects,
      scene,
      camera,
      target: this.target,
      shadow: { ...this.shadowMap },
    });
    this.info.render.frame++;
    this.info.render.calls += objects.length;
    this.info.render.triangles += 100;
    this.onRender?.(scene, camera);
  }
}
function snapshot(r) {
  return {
    target: r.target,
    face: r.face,
    level: r.level,
    autoClear: r.autoClear,
    color: r.autoClearColor,
    depth: r.autoClearDepth,
    stencil: r.autoClearStencil,
    xr: r.xr.enabled,
    shadow: { ...r.shadowMap },
    info: { ...r.info.render, frame: undefined },
    infoAuto: r.info.autoReset,
    clear: r.color.toArray(),
    alpha: r.alpha,
    viewport: [...r.viewport],
    scissor: [...r.scissor],
  };
}
function setup() {
  const renderer = new Renderer(),
    scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(55, 1.5, 0.08, 30000);
  camera.position.set(100, 50, 400);
  camera.lookAt(0, 0, 0);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.position.set(40, 80, -50);
  sun.target.position.set(10, 1, 2);
  scene.add(sun, sun.target, new THREE.HemisphereLight());
  scene.environment = new THREE.Texture();
  scene.environmentIntensity = 0.018;
  scene.fog = new THREE.FogExp2(0xcbdfea, 0.00001);
  const target = new THREE.WebGLRenderTarget(1920, 1080, {
    type: THREE.HalfFloatType,
  });
  const warmer = new LandmarkGpuWarmup({
    renderer,
    scene,
    camera,
    colorTarget: () => target,
    unavailable: () => false,
  });
  return { renderer, scene, camera, sun, target, warmer };
}
function candidate(count = 3) {
  const group = new THREE.Group(),
    holder = new THREE.Group();
  holder.position.set(14, 3, -70);
  holder.rotation.y = 0.4;
  group.position.y = 0.7;
  for (let i = 0; i < count; i++) {
    const material = new THREE.MeshStandardMaterial({ color: 0x99aabb });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), material);
    mesh.position.set(i * 10, 2, -3);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return { group, holder };
}

test('one object per tick, one active landmark, genuine draw after compile, target and lighting match', async () => {
  const { warmer, renderer, scene, sun } = setup(),
    a = candidate(2),
    b = candidate(1);
  const before = snapshot(renderer),
    aPromise = warmer.prepare(a.group, new AbortController().signal, a.holder);
  const bPromise = warmer.prepare(
    b.group,
    new AbortController().signal,
    b.holder,
  );
  warmer.tick();
  assert.equal(renderer.calls.length, 2);
  assert.equal(a.group.parent, null);
  const [compile, draw] = renderer.calls;
  assert.equal(compile.targetScene, scene);
  assert.equal(compile.target, draw.target);
  assert.equal(draw.target.width, 16);
  assert.equal(draw.target.height, 16);
  assert.equal(draw.target.texture.type, THREE.HalfFloatType);
  assert.equal(draw.objects[0].geometry, a.group.children[0].geometry);
  assert.equal(draw.objects[0].material, a.group.children[0].material);
  assert.equal(draw.objects[0].frustumCulled, false);
  assert.equal(draw.shadow.enabled, true);
  assert.equal(draw.shadow.autoUpdate, false);
  assert.equal(draw.shadow.needsUpdate, false);
  const cloneSun = draw.scene.children.find((o) => o.isDirectionalLight);
  assert.notEqual(cloneSun, sun);
  assert.equal(sun.parent, scene);
  assert.equal(cloneSun.castShadow, true);
  assert.deepEqual(cloneSun.target.position.toArray(), [10, 1, 2]);
  assert.equal(draw.scene.environment, scene.environment);
  assert.equal(draw.scene.fog, scene.fog);
  assert.deepEqual(snapshot(renderer), before);
  assert.equal(renderer.info.render.frame, 124);
  warmer.tick();
  await aPromise;
  assert.equal(renderer.calls.length, 4);
  warmer.tick();
  await bPromise;
  assert.equal(renderer.calls.length, 6);
  warmer.dispose();
});

test('world placement and hidden night buffers warm without altering source visibility or parent', async () => {
  const { warmer, renderer } = setup(),
    { group, holder } = candidate(1);
  const points = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1, 2, 3)]),
    new THREE.PointsMaterial(),
  );
  points.visible = false;
  group.add(points);
  const promise = warmer.prepare(group, new AbortController().signal, holder);
  warmer.tick();
  const expected = holder.matrixWorld
    .clone()
    .multiply(group.children[0].matrixWorld);
  assert.deepEqual(
    renderer.calls[1].objects[0].matrixWorld.elements,
    expected.elements,
  );
  warmer.tick();
  await promise;
  assert.equal(points.visible, false);
  assert.equal(points.parent, group);
  assert.equal(renderer.calls[3].objects[0].isPoints, true);
  assert.equal(renderer.calls[3].objects[0].visible, true);
  warmer.dispose();
});

test('queued and mid-warm cancellation settle promptly, never dispose or reuse source resources', async () => {
  const { warmer, renderer } = setup(),
    a = candidate(3),
    b = candidate(2),
    ca = new AbortController(),
    cb = new AbortController();
  let disposals = 0;
  a.group.children[0].geometry.addEventListener('dispose', () => disposals++);
  const pa = assert.rejects(warmer.prepare(a.group, ca.signal, a.holder), {
    name: 'AbortError',
  });
  const pb = assert.rejects(warmer.prepare(b.group, cb.signal, b.holder), {
    name: 'AbortError',
  });
  warmer.tick();
  cb.abort();
  ca.abort();
  await Promise.all([pa, pb]);
  const count = renderer.calls.length;
  warmer.tick();
  assert.equal(renderer.calls.length, count);
  assert.equal(disposals, 0);
  warmer.dispose();
});

test('compile/render failures restore state; mid-compile cancellation skips the draw', async () => {
  for (const point of ['compile', 'render', 'abort']) {
    const { warmer, renderer } = setup(),
      { group, holder } = candidate(2),
      controller = new AbortController();
    const before = snapshot(renderer),
      promise = assert.rejects(
        warmer.prepare(group, controller.signal, holder),
      );
    if (point === 'compile')
      renderer.onCompile = () => {
        throw Error('driver compile failed');
      };
    if (point === 'render')
      renderer.onRender = () => {
        throw Error('draw failed');
      };
    if (point === 'abort') renderer.onCompile = () => controller.abort();
    warmer.tick();
    await promise;
    assert.deepEqual(snapshot(renderer), before);
    assert.equal(
      renderer.calls.filter((c) => c.type === 'render').length,
      point === 'render' ? 1 : 0,
    );
    warmer.dispose();
  }
});

test('context loss and explicit destruction reject queued jobs without requiring another animation tick', async () => {
  for (const cause of ['lost', 'listener', 'dispose']) {
    const { warmer, renderer } = setup(),
      a = candidate(),
      b = candidate();
    const pa = assert.rejects(
      warmer.prepare(a.group, new AbortController().signal, a.holder),
    );
    const pb = assert.rejects(
      warmer.prepare(b.group, new AbortController().signal, b.holder),
    );
    if (cause === 'lost') {
      renderer.lost = true;
      warmer.tick();
    } else if (cause === 'listener') warmer.invalidate('context lost');
    else warmer.dispose();
    await Promise.all([pa, pb]);
    assert.equal(renderer.calls.length, 0);
    await assert.rejects(
      warmer.prepare(a.group, new AbortController().signal, a.holder),
    );
    warmer.dispose();
  }
});

test('shader definition changes restart preparation, but sun movement/intensity does not', async () => {
  const { warmer, renderer, sun } = setup(),
    { group, holder } = candidate(3);
  const promise = warmer.prepare(group, new AbortController().signal, holder);
  warmer.tick();
  sun.position.x += 2;
  sun.intensity = 4;
  warmer.tick();
  assert.equal(renderer.calls[2].object.geometry, group.children[1].geometry);
  renderer.shadowMap.enabled = false;
  warmer.tick();
  assert.equal(renderer.calls[4].object.geometry, group.children[0].geometry);
  warmer.tick();
  warmer.tick();
  await promise;
  warmer.dispose();
});

test('Three public shader-error callback turns a logged GLSL failure into medium fallback', async () => {
  const { warmer, renderer } = setup(),
    { group, holder } = candidate(1);
  let previousCalls = 0;
  const previous = () => previousCalls++;
  renderer.debug.onShaderError = previous;
  renderer.onRender = () =>
    renderer.debug.onShaderError(null, null, null, null);
  const promise = assert.rejects(
    warmer.prepare(group, new AbortController().signal, holder),
    /shader compilation failed/,
  );
  warmer.tick();
  await promise;
  assert.equal(previousCalls, 1);
  assert.equal(renderer.debug.onShaderError, previous);
  assert.equal(renderer.debug.checkShaderErrors, false);
  warmer.dispose();
});

test('medium is retained until full GPU preparation and explicit next-frame commit', async () => {
  const { warmer } = setup(),
    { group, holder } = candidate(2);
  let attached = 0,
    released = 0;
  const state = new LandmarkLoadState({
    load: () => ({ promise: Promise.resolve(group), cancel() {} }),
    prepare: (g, signal) => warmer.prepare(g, signal, holder),
    attach: () => attached++,
    release: () => released++,
  });
  state.start();
  await flush();
  assert.equal(state.status, 'preparing');
  warmer.tick();
  await flush();
  assert.equal(state.commit(), false);
  assert.equal(attached, 0);
  warmer.tick();
  await flush();
  assert.equal(state.status, 'prepared');
  assert.equal(attached, 0);
  assert.equal(state.commit(), true);
  assert.equal(attached, 1);
  assert.equal(released, 0);
  state.dispose();
  warmer.dispose();
});

test('loading pipeline warms full passes offscreen and restores buffers/visibility on success or exception', () => {
  for (const throws of [false, true]) {
    const renderer = new Renderer(),
      scene = new THREE.Scene(),
      child = new THREE.Object3D();
    scene.add(child);
    const originalOverride = new THREE.MeshBasicMaterial();
    scene.overrideMaterial = originalOverride;
    const ssao = { enabled: false, renderToScreen: true },
      beauty = { enabled: true, renderToScreen: true };
    const read = new THREE.WebGLRenderTarget(),
      write = new THREE.WebGLRenderTarget();
    const composer = {
      passes: [beauty, ssao],
      renderToScreen: true,
      readBuffer: read,
      writeBuffer: write,
      render(delta) {
        assert.equal(delta, 0);
        assert.equal(this.renderToScreen, false);
        assert.equal(ssao.enabled, true);
        renderer.setRenderTarget(write);
        renderer.autoClear = true;
        renderer.setClearColor(0xff0077, 1);
        renderer.info.render.frame++;
        renderer.info.render.calls += 20;
        this.readBuffer = write;
        this.writeBuffer = read;
        ssao.renderToScreen = false;
        child.visible = false;
        scene.overrideMaterial = null;
        if (throws) throw Error('AO draw failed');
      },
    };
    const before = snapshot(renderer),
      fxaa = { material: new THREE.ShaderMaterial() };
    if (throws)
      assert.throws(
        () => warmComposer(renderer, composer, scene, ssao, fxaa, true),
        /AO draw failed/,
      );
    else warmComposer(renderer, composer, scene, ssao, fxaa, true);
    assert.deepEqual(snapshot(renderer), before);
    assert.equal(composer.readBuffer, read);
    assert.equal(composer.writeBuffer, write);
    assert.equal(composer.renderToScreen, true);
    assert.equal(ssao.enabled, false);
    assert.equal(ssao.renderToScreen, true);
    assert.equal(child.visible, true);
    assert.equal(scene.overrideMaterial, originalOverride);
    if (!throws) assert.equal(renderer.calls[0].target, null);
  }
});

test('state transaction preserves renderer monotonic frame and owned memory', () => {
  const renderer = new Renderer(),
    before = snapshot(renderer);
  withRendererState(renderer, () => {
    renderer.info.render.frame += 3;
    renderer.info.render.calls += 9;
  });
  assert.deepEqual(snapshot(renderer), before);
  assert.equal(renderer.info.render.frame, 126);
});

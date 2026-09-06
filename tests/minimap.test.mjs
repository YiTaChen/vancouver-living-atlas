import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function load(path, imports = {}) {
  let source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  for (const [name, url] of Object.entries(imports))
    source = source.replaceAll(`from '${name}'`, `from '${url}'`);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  const url =
    'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
  return { url, module: await import(url) };
}
const geo = await load('lib/city/geo.ts');
const types = await load('lib/city/types.ts');
const trim = await load('lib/city/road-trim.ts');
const { module: map } = await load('lib/city/minimap.ts', {
  './geo': geo.url,
  './types': types.url,
  './road-trim': trim.url,
});
const navigation = (mode = 'walk') => ({
  mode,
  position: { x: 1400, z: 180 },
  yaw: -1.8,
  boat: { state: { x: -1100, z: -920, yaw: 0.4 }, lookYaw: Math.PI },
});
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('minimap keyboard zoom leaves browser shortcuts and movement keys alone', () => {
  assert.equal(map.minimapZoomKey({ key: '+' }), 'in');
  assert.equal(map.minimapZoomKey({ key: '-' }), 'out');
  for (const key of ['+', '=', '-', '_'])
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      assert.equal(map.minimapZoomKey({ key, [modifier]: true }), null);
    }
  for (const key of ['w', 'a', 's', 'd', 'ArrowUp', 'Escape'])
    assert.equal(map.minimapZoomKey({ key }), null);
});

test('walk and drive follow the actual player, independent of look-ahead target and heading', () => {
  for (const mode of ['walk', 'drive']) {
    const nav = navigation(mode);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      nav.yaw = yaw;
      const target = {
        x: nav.position.x + Math.sin(yaw) * 25,
        z: nav.position.z + Math.cos(yaw) * 25,
      };
      const pose = map.minimapPose(nav, target);
      assert.deepEqual(pose, { x: 1400, z: 180, yaw, following: true });
      for (const span of map.MINIMAP_SPANS) {
        const t = map.minimapTransform(pose, span, 280, 180);
        near((pose.x - t.x) * t.scale, 140);
        near((pose.z - t.z) * t.scale, 90);
      }
    }
  }
});

test('boat follows physics state immediately, excluding bobbing, chase-camera offset and lookYaw', () => {
  const nav = navigation('boat');
  const expected = { ...nav.boat.state, following: true };
  for (const lookYaw of [0, Math.PI, -1.4]) {
    nav.boat.lookYaw = lookYaw;
    nav.position = { x: 9999, z: 9999, y: 7 }; // A previous frame's model pose must not leak in.
    assert.deepEqual(map.minimapPose(nav, { x: 70, z: 80 }), expected);
  }
  nav.boat.state.x -= 7; // Reverse/coasting keeps following even without a key press.
  assert.equal(map.minimapPose(nav, { x: 70, z: 80 }).x, expected.x - 7);
});

test('north-up heading points south at zero and east at positive half-pi', () => {
  for (const [yaw, x, y] of [
    [0, 0, 1],
    [Math.PI / 2, 1, 0],
    [Math.PI, 0, -1],
    [-Math.PI / 2, -1, 0],
  ]) {
    const d = map.headingVector(yaw);
    near(d.x, x);
    near(d.y, y);
  }
});

test('zoom bounds and overview picking preserve location and do not clamp boats to downtown', () => {
  assert.equal(map.zoomMinimap(200, 'in'), 200);
  assert.equal(map.zoomMinimap(6400, 'out'), 6400);
  assert.equal(map.zoomMinimap(800, 'in'), 400);
  assert.equal(map.zoomMinimap(800, 'out'), 1600);
  const [x, z] = geo.module.project([-123.16742803, 49.32723941]);
  const pose = { x, z, yaw: 0, following: true };
  for (const [width, height] of [
    [280, 180],
    [560, 360],
    [190, 122],
  ]) {
    const t = map.minimapTransform(pose, 800, width, height);
    const center = map.minimapWorldPoint(width / 2, height / 2, t);
    near(center.x, x);
    near(center.z, z);
  }
  const orbit = map.minimapPose(navigation('orbit'), { x: 777, z: 222 });
  assert.equal(orbit.following, false);
  const t = map.minimapTransform(orbit, 200, 280, 180);
  const point = map.minimapWorldPoint(
    (777 - t.x) * t.scale,
    (222 - t.z) * t.scale,
    t,
  );
  near(point.x, 777);
  near(point.z, 222);
});

test('renderer repaints moving poses, preserves inland water holes, skips unchanged and hidden maps', () => {
  const previousPath = globalThis.Path2D;
  globalThis.Path2D = class {
    points = [];
    moveTo(x, z) {
      this.points.push([x, z]);
    }
    lineTo(x, z) {
      this.points.push([x, z]);
    }
    closePath() {}
  };
  try {
    const polygon = [
      [
        [-10, -10],
        [10, -10],
        [10, 10],
        [-10, 10],
        [-10, -10],
      ],
      [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
        [-2, -2],
      ],
    ];
    const fills = [];
    const ctx = new Proxy(
      {
        measureText: (text) => ({ width: text.length * 6 }),
        fill(path, rule) {
          fills.push({ path, rule, color: this.fillStyle });
        },
      },
      { get: (target, key) => (key in target ? target[key] : () => {}) },
    );
    const canvas = {
      width: 560,
      height: 360,
      clientWidth: 280,
      clientHeight: 180,
      dataset: {},
      getContext: () => ctx,
    };
    const nav = navigation('boat');
    nav.boat.state = { x: 0, z: 0, yaw: 0 };
    const e = {
      locale: 'en',
      navigation: nav,
      controls: { target: { x: 25, z: 30 } },
      waterWorld: { regional: [polygon] },
      landPolys: [polygon],
      parkPolys: [],
      data: {
        waterSurfaces: [{ polygon, name: 'Test lagoon' }],
        buildings: { features: [] },
        roads: { features: [] },
      },
    };
    const renderer = new map.LocalMinimap(e, canvas, (id) => id);
    renderer.draw(0);
    assert.equal(canvas.dataset.centerX, '0');
    const water = fills.find((f) => f.color === '#215664');
    assert(water);
    assert.equal(water.rule, 'evenodd');
    assert.equal(water.path.points.length, 10);
    const count = fills.length;
    renderer.draw(150);
    assert.equal(fills.length, count);
    nav.boat.state.x += 5;
    renderer.draw(200);
    assert.equal(fills.length, count); // 10 Hz bound.
    renderer.draw(250);
    assert.equal(canvas.dataset.centerX, '5');
    const poseBefore = JSON.stringify(nav);
    renderer.span = 400;
    renderer.draw(260, true);
    assert.equal(canvas.dataset.span, '400');
    assert.equal(JSON.stringify(nav), poseBefore);
    canvas.clientWidth = 0;
    nav.boat.state.x = 12;
    renderer.draw(400);
    assert.equal(canvas.dataset.centerX, '5');
    canvas.clientWidth = 280;
    renderer.draw(500);
    assert.equal(canvas.dataset.centerX, '12');
    canvas.clientWidth = 200;
    canvas.clientHeight = 128;
    renderer.draw(600);
    assert.equal(canvas.width, 400);
    assert.equal(canvas.height, 256);
    near((12 - renderer.transform.x) * renderer.transform.scale, 100);
    nav.mode = 'orbit';
    renderer.draw(700);
    assert.equal(canvas.dataset.following, 'false');
  } finally {
    globalThis.Path2D = previousPath;
  }
});

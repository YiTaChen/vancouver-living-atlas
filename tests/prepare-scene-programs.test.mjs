// Stored method identities are compared or invoked with their original receiver.
/* oxlint-disable typescript/unbound-method */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const { prepareScenePrograms } = await import(
  cityModule('prepare-scene-programs')
);
const COMPLETION = 0x91b1,
  LINK = 0x8b82;
function fixture({ extension = true, ready = false, linked = true } = {}) {
  const material = new THREE.MeshStandardMaterial();
  const raw = { alive: true, ready, linked };
  const program = { id: 42, name: 'streamed-station-wall', program: raw };
  const calls = [],
    properties = new WeakMap();
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  let lost = false,
    compiles = 0;
  const gl = {
    LINK_STATUS: LINK,
    isContextLost: () => lost,
    getExtension(name) {
      assert.equal(name, 'KHR_parallel_shader_compile');
      return extension ? { COMPLETION_STATUS_KHR: COMPLETION } : null;
    },
    isProgram: (handle) => handle.alive,
    getProgramParameter(handle, parameter) {
      assert(handle.alive, 'deleted program must never be queried');
      calls.push([handle, parameter]);
      return parameter === COMPLETION ? handle.ready : handle.linked;
    },
    getProgramInfoLog: () => '   fragment varying mismatch   ',
  };
  const renderer = {
    info: { programs: [program] },
    getContext: () => gl,
    compile(actualScene, actualCamera, _target) {
      assert.strictEqual(actualScene, scene);
      assert.strictEqual(actualCamera, camera);
      compiles++;
      properties.set(material, {
        currentProgram: { isReady: () => raw.ready },
      });
      return new Set([material]);
    },
    compileAsync() {
      throw Error('unsafe material polling must not be used');
    },
  };
  Object.defineProperty(renderer, 'properties', {
    get() {
      throw Error('private material properties must not be read');
    },
  });
  material.addEventListener('dispose', () => {
    raw.alive = false;
    program.program = undefined;
    renderer.info.programs.length = 0;
    properties.delete(material);
  });
  return {
    renderer,
    gl,
    scene,
    camera,
    material,
    raw,
    program,
    calls,
    properties,
    compiles: () => compiles,
    loseContext: () => {
      lost = true;
    },
  };
}
function timers(t) {
  let id = 0;
  const pending = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    const token = ++id;
    pending.set(token, { callback, ms });
    return token;
  });
  t.mock.method(globalThis, 'clearTimeout', (token) => pending.delete(token));
  return {
    pending,
    run() {
      const [token, timer] = pending.entries().next().value;
      pending.delete(token);
      timer.callback();
    },
  };
}
function prepare(f, options) {
  return prepareScenePrograms(f.renderer, f.scene, f.camera, options);
}

test('actual Three compileAsync callback loses disposed material properties; native-handle preparation safely completes', async (t) => {
  const source = readFileSync(
    new URL(
      '../node_modules/three/src/renderers/WebGLRenderer.js',
      import.meta.url,
    ),
    'utf8',
  );
  const ast = ts.createSourceFile(
    'WebGLRenderer.js',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let actual;
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === 'this.compileAsync'
    )
      actual = node.right;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert(actual);
  const old = fixture();
  let callback;
  // Execute the installed Three function unchanged. Only browser/GPU acquisition
  // and scheduling are substituted; disposal uses the real Three Material event.
  const factory = `export function bind(properties, extensions, setTimeout) { return (${actual.getText(ast)}); }`;
  const { bind } = await import(
    'data:text/javascript;base64,' + Buffer.from(factory).toString('base64')
  );
  const unsafeCompile = bind(
    { get: (material) => old.properties.get(material) ?? {} },
    { get: () => ({}) },
    (poll) => {
      callback = poll;
    },
  );
  unsafeCompile.call(old.renderer, old.scene, old.camera);
  assert.equal(typeof callback, 'function');
  old.material.dispose();
  assert.throws(
    callback,
    /isReady/,
    'the upstream timer throws outside Promise rejection',
  );
  const clock = timers(t),
    current = fixture();
  const originalDispose = current.material.dispose;
  const result = prepare(current);
  assert.equal(clock.pending.size, 1);
  current.material.dispose();
  clock.run();
  await result;
  assert.strictEqual(current.material.dispose, originalDispose);
  assert.equal(clock.pending.size, 0);
  assert.equal(current.calls.filter(([, query]) => query === LINK).length, 0);
});

test('KHR polling is nonblocking until completion, deduplicates handles, and snapshots the programs present after compile', async (t) => {
  const clock = timers(t),
    f = fixture();
  f.renderer.info.programs.push(f.program);
  const target = new THREE.Scene();
  const original = f.renderer.compile;
  let seenTarget;
  f.renderer.compile = (...args) => {
    seenTarget = args[2];
    return original(...args);
  };
  const result = prepare(f, { targetScene: target });
  assert.strictEqual(seenTarget, target);
  assert.equal(f.compiles(), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1], COMPLETION);
  f.renderer.info.programs.push({
    id: 99,
    program: { alive: true, ready: false, linked: false },
  });
  f.raw.ready = true;
  clock.run();
  await result;
  assert.deepEqual(
    f.calls.map(([, parameter]) => parameter),
    [COMPLETION, COMPLETION, LINK],
  );
  assert.equal(clock.pending.size, 0);
  f.material.dispose();
});

test('a completed live program with a genuine link failure rejects with useful source and driver diagnostics', async (t) => {
  const clock = timers(t),
    f = fixture({ ready: true, linked: false });
  await assert.rejects(
    prepare(f),
    /Scene shader link failed \(streamed-station-wall\): fragment varying mismatch/,
  );
  assert.equal(clock.pending.size, 0);
  f.material.dispose();
});

test('exceptions in a later polling callback reject the Promise and leave no timers behind', async (t) => {
  const clock = timers(t),
    f = fixture();
  const result = prepare(f);
  f.gl.getProgramParameter = () => {
    throw Error('driver query failed');
  };
  clock.run();
  await assert.rejects(result, /driver query failed/);
  assert.equal(clock.pending.size, 0);
  f.material.dispose();
});

test('abort settles immediately, removes its listener and cancels pending polls; pre-abort never compiles', async (t) => {
  const clock = timers(t),
    f = fixture(),
    controller = new AbortController();
  const add = t.mock.method(controller.signal, 'addEventListener');
  const remove = t.mock.method(controller.signal, 'removeEventListener');
  const result = prepare(f, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(clock.pending.size, 0);
  assert.equal(add.mock.calls.length, 1);
  assert.equal(remove.mock.calls.length, 1);
  assert.strictEqual(
    add.mock.calls[0].arguments[1],
    remove.mock.calls[0].arguments[1],
  );
  const preAborted = fixture();
  await assert.rejects(prepare(preAborted, { signal: controller.signal }), {
    name: 'AbortError',
  });
  assert.equal(preAborted.compiles(), 0);
  f.material.dispose();
  preAborted.material.dispose();
});

test('context loss and engine unavailability reject before missing GPU state can be read', async (t) => {
  const clock = timers(t),
    f = fixture();
  const result = prepare(f);
  f.loseContext();
  f.gl.isProgram = () => {
    throw Error('must not query lost context');
  };
  clock.run();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(clock.pending.size, 0);
  const gone = fixture();
  await assert.rejects(prepare(gone, { unavailable: () => true }), {
    name: 'AbortError',
  });
  assert.equal(gone.compiles(), 0);
  const lost = fixture();
  lost.loseContext();
  await assert.rejects(prepare(lost), { name: 'AbortError' });
  assert.equal(lost.compiles(), 0);
  f.material.dispose();
  gone.material.dispose();
  lost.material.dispose();
});

test('without parallel compile support LINK_STATUS is still checked and failures never silently pass', async (t) => {
  const clock = timers(t),
    f = fixture({ extension: false, linked: true });
  await prepare(f);
  assert.deepEqual(
    f.calls.map(([, parameter]) => parameter),
    [LINK],
  );
  assert.equal(clock.pending.size, 0);
  const broken = fixture({ extension: false, linked: false });
  await assert.rejects(prepare(broken), /Scene shader link failed/);
  f.material.dispose();
  broken.material.dispose();
});

test('pending compilation has a finite timeout and clears the scheduled callback', async (t) => {
  const clock = timers(t),
    f = fixture();
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const result = prepare(f, { timeoutMs: 100, pollMs: 1000 });
  assert.equal(
    [...clock.pending.values()][0].ms,
    100,
    'poll never outlives the deadline',
  );
  now = 101;
  clock.run();
  await assert.rejects(result, /timed out with 1 program/);
  assert.equal(clock.pending.size, 0);
  f.material.dispose();
});

test('initial compile errors and already empty/disposed program snapshots settle without starting polling', async (t) => {
  const clock = timers(t),
    f = fixture();
  f.renderer.compile = () => {
    throw Error('source shader hook failed');
  };
  await assert.rejects(prepare(f), /source shader hook failed/);
  const empty = fixture();
  empty.renderer.info.programs = [];
  await prepare(empty);
  const deleted = fixture();
  deleted.raw.alive = false;
  await prepare(deleted);
  assert.equal(deleted.calls.length, 0);
  assert.equal(clock.pending.size, 0);
  f.material.dispose();
  empty.material.dispose();
  deleted.material.dispose();
});

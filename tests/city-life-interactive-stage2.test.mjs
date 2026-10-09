import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const { InteractiveRendererCandidate } = await import(
  cityModule('city-life/interactive-renderer-candidate')
);
const names = ['idle', 'walk', 'look', 'yield', 'guide', 'sit'];
function fixture() {
  const geometry = new THREE.BoxGeometry(0.4, 1, 0.2),
    material = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  const clips = names.map((n) => new THREE.AnimationClip(n, 1, []));
  return {
    root,
    geometry,
    material,
    templates: new Map([
      ['commuter', { root, clips }],
      ['runner', { root, clips }],
    ]),
  };
}
const pose = (id = 'a', extra = {}) => ({
  actorId: id,
  appearanceId: 'commuter',
  motion: 'walk',
  phase: 0.2,
  position: [1, 0, 2],
  quaternion: [0, 0, 0, 1],
  ...extra,
});
test('interactive candidate clones per actor but retains shared resources', () => {
  const f = fixture(),
    r = new InteractiveRendererCandidate(f.templates, 2);
  r.sync([pose('a'), pose('b')]);
  assert.equal(r.size, 2);
  assert.notEqual(r.root.children[0], r.root.children[1]);
  assert.equal(r.root.children[0].children[0].geometry, f.geometry);
  const a = r.root.children[0];
  r.sync([pose('a', { phase: 0.8 }), pose('b')]);
  assert.equal(r.root.children[0], a);
  let destroyed = 0;
  f.geometry.addEventListener('dispose', () => destroyed++);
  f.material.addEventListener('dispose', () => destroyed++);
  r.dispose();
  r.dispose();
  assert.equal(r.size, 0);
  assert.equal(destroyed, 0);
  assert.throws(() => r.sync([]), /disposed/);
});
test('interactive global cap and invalid updates preserve active actors', () => {
  const f = fixture(),
    r = new InteractiveRendererCandidate(f.templates, 1);
  r.sync([pose()]);
  const old = r.root.children[0];
  for (const poses of [
    [pose(), pose('b')],
    [pose(), pose()],
    [pose('a', { phase: NaN })],
    [pose('a', { phase: 1 })],
    [pose('a', { position: [0, Infinity, 0] })],
    [pose('a', { quaternion: [0, 0, 0, 0] })],
    [pose('a', { appearanceId: 'runner' })],
    [pose('a', { motion: 'missing' })],
  ]) {
    assert.throws(() => r.sync(poses));
    assert.equal(r.size, 1);
    assert.equal(r.root.children[0], old);
  }
  r.sync([]);
  assert.equal(r.size, 0);
  assert.equal(r.root.children.length, 0);
});
test('interactive invalid budgets and clip sets fail closed', () => {
  const f = fixture();
  for (const cap of [-1, 1.5, 5, NaN])
    assert.throws(() => new InteractiveRendererCandidate(f.templates, cap));
  assert.throws(
    () =>
      new InteractiveRendererCandidate(
        new Map([['bad', { root: f.root, clips: [] }]]),
        2,
      ),
  );
});
test('interactive repeated upgrade and release stays bounded, phase remains caller-owned', () => {
  const f = fixture(),
    r = new InteractiveRendererCandidate(f.templates, 4);
  for (let i = 0; i < 20; i++) {
    r.sync([pose('a', { phase: 0.3, motion: 'sit' })]);
    assert.equal(r.size, 1);
    r.sync([]);
    assert.equal(r.root.children.length, 0);
  }
  r.dispose();
});
test('four actual exported skins and six clips satisfy offline contract', () => {
  const out = execFileSync(
    'python3',
    ['tools/assets/city-life-interactive/validate.py'],
    { encoding: 'utf8' },
  );
  assert.equal(JSON.parse(out).status, 'pass');
});

test('interactive rejects nonfinite, zero-duration and duplicate clips', () => {
  const f = fixture(),
    good = f.templates.get('commuter');
  for (const duration of [0, -1, Infinity, NaN]) {
    const clips = good.clips.map(
      (c) =>
        new THREE.AnimationClip(c.name, c.name === 'walk' ? duration : 1, []),
    );
    // AnimationClip normalizes negative duration, so force adversarial metadata.
    clips.find((c) => c.name === 'walk').duration = duration;
    assert.throws(
      () =>
        new InteractiveRendererCandidate(
          new Map([['bad', { root: f.root, clips }]]),
          2,
        ),
    );
  }
  const clips = [new THREE.AnimationClip('walk', 0, []), ...good.clips];
  assert.throws(
    () =>
      new InteractiveRendererCandidate(
        new Map([['bad', { root: f.root, clips }]]),
        2,
      ),
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  TreeLeafCandidate,
  installCandidateLeaf,
  TREE_MATERIAL_CANDIDATE: manifest,
} = await import(cityModule('assets/tree-material-candidate'));

function imageRequests(run) {
  const original = THREE.ImageLoader.prototype.load;
  const requests = [];
  THREE.ImageLoader.prototype.load = function (
    url,
    onLoad,
    _progress,
    onError,
  ) {
    requests.push({ url, onLoad, onError });
    return {};
  };
  try {
    return run(requests);
  } finally {
    THREE.ImageLoader.prototype.load = original;
  }
}

test('candidate remains lazy and only becomes usable with all five verified coverage mips in one texture', async () => {
  let pending, candidate, host, requests;
  imageRequests((queue) => {
    requests = queue;
    host = { extraTextures: new Set() };
    candidate = new TreeLeafCandidate(host);
    assert.equal(host.extraTextures.size, 0);
    pending = candidate.load();
    assert.equal(candidate.load(), pending);
    assert.equal(queue.length, 5);
    assert.equal(host.extraTextures.size, 1);
    for (let i = 4; i >= 1; i--)
      queue[i].onLoad({
        width: manifest.files[i].size,
        height: manifest.files[i].size,
      });
    assert.equal(candidate.materials, null);
    queue[0].onLoad({ width: 1024, height: 1024 });
  });
  assert.equal(await pending, true);
  assert.equal(candidate.status, 'ready');
  const { leaf, depth } = candidate.materials;
  assert.equal(leaf.map, depth.map);
  assert.deepEqual(
    leaf.map.mipmaps.map((image) => image.width),
    [1024, 512, 256, 128, 64],
  );
  assert.equal(leaf.map.generateMipmaps, false);
  assert.equal(leaf.map.premultiplyAlpha, false);
  assert.equal(leaf.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(leaf.map.anisotropy, 1);
  for (const material of [leaf, depth]) {
    assert.equal(material.alphaTest, 0.4);
    assert.equal(material.side, THREE.DoubleSide);
    assert.equal(material.transparent, false);
  }
  requests.forEach((request, i) =>
    assert.equal(
      request.url,
      `/__offline-assets/vegetation_ground/maps/${manifest.files[i].file}?v=${manifest.files[i].sha256.slice(0, 12)}`,
    ),
  );
  let materialDisposals = 0,
    textureDisposals = 0;
  leaf.addEventListener('dispose', () => materialDisposals++);
  depth.addEventListener('dispose', () => materialDisposals++);
  leaf.map.addEventListener('dispose', () => textureDisposals++);
  candidate.dispose();
  candidate.dispose();
  assert.equal(materialDisposals, 2);
  assert.equal(textureDisposals, 0, 'Engine owns the one shared texture');
  for (const texture of host.extraTextures) texture.dispose();
});

test('one failed/wrong-size mip or disposal during load never publishes partial materials', async () => {
  for (const failure of ['error', 'size', 'dispose']) {
    let pending, candidate, host;
    imageRequests((queue) => {
      host = { extraTextures: new Set() };
      candidate = new TreeLeafCandidate(host);
      pending = candidate.load();
      if (failure === 'error') queue[0].onError(new Error('missing mip'));
      if (failure === 'size') queue[0].onLoad({ width: 512, height: 512 });
      if (failure === 'dispose') candidate.dispose();
      for (const [i, request] of queue.entries())
        request.onLoad({
          width: manifest.files[i].size,
          height: manifest.files[i].size,
        });
    });
    assert.equal(await pending, false);
    assert.equal(candidate.materials, null);
    candidate.dispose();
    for (const texture of host.extraTextures) texture.dispose();
  }
});

test('color and shadow passes use identical straight alpha and preserve aSolid without RGB unmatting', () => {
  for (const source of [THREE.ShaderLib.standard, THREE.ShaderLib.depth]) {
    const shader = {
      uniforms: {},
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
    };
    installCandidateLeaf(shader);
    assert.match(shader.vertexShader, /vSolid=aSolid/);
    assert.match(
      shader.fragmentShader,
      /leafUv=mix\(vMapUv,uTreeCandidateSolidUV\[leafCell\],vSolid\)/,
    );
    assert.match(
      shader.fragmentShader,
      /sampledDiffuseColor.a=mix\(sampledDiffuseColor.a,1.,vSolid\)/,
    );
    assert.doesNotMatch(shader.fragmentShader, /unmatte|leafRGB|1.0-matte/);
    assert.equal(
      (shader.fragmentShader.match(/texture2D\(map,leafUv\)/g) ?? []).length,
      1,
    );
    assert.ok(
      shader.fragmentShader.indexOf('sampledDiffuseColor.a=mix') <
        shader.fragmentShader.indexOf('#include <alphatest_fragment>'),
    );
    assert.deepEqual(
      shader.uniforms.uTreeCandidateSolidUV.value.map((uv) => uv.toArray()),
      manifest.solidSamples.map((sample) => sample.uv),
    );
  }
});

function authoredRGBA(file) {
  const raw = readFileSync(
    new URL(`../tools/assets/vegetation_ground/maps/${file}`, import.meta.url),
  );
  assert.equal(raw.readUInt32BE(16), raw.readUInt32BE(20));
  assert.equal(raw[24], 8);
  assert.equal(raw[25], 6);
  const size = raw.readUInt32BE(16),
    data = [];
  for (let offset = 8; offset < raw.length;) {
    const length = raw.readUInt32BE(offset);
    if (raw.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      data.push(raw.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const scanlines = inflateSync(Buffer.concat(data));
  assert.equal(scanlines.length, size * (size * 4 + 1));
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    assert.equal(
      scanlines[y * (size * 4 + 1)],
      0,
      'the authored deterministic PNG uses unfiltered rows',
    );
    scanlines.copy(
      rgba,
      y * size * 4,
      y * (size * 4 + 1) + 1,
      (y + 1) * (size * 4 + 1),
    );
  }
  return { raw, rgba, size };
}

test('QA candidate reads original offline bytes with matching hashes, opaque species UVs and measured mip coverage', () => {
  const source = JSON.parse(
    readFileSync(
      new URL(
        '../tools/assets/vegetation_ground/manifest.json',
        import.meta.url,
      ),
    ),
  );
  const coverage = JSON.parse(
    readFileSync(
      new URL(
        '../tools/assets/vegetation_ground/alpha-coverage.json',
        import.meta.url,
      ),
    ),
  );
  let bytes = 0;
  manifest.files.forEach((file, level) => {
    const { raw, rgba, size } = authoredRGBA(file.file);
    assert.equal(size, file.size);
    assert.equal(createHash('sha256').update(raw).digest('hex'), file.sha256);
    assert.equal(
      file.sha256,
      source.maps.find((map) => map.file === `maps/${file.file}`).sha256,
    );
    bytes += size * size * 4;
    const half = size / 2;
    for (let cell = 0; cell < 4; cell++) {
      let covered = 0;
      for (
        let y = Math.floor(cell / 2) * half;
        y < (Math.floor(cell / 2) + 1) * half;
        y++
      )
        for (let x = (cell % 2) * half; x < ((cell % 2) + 1) * half; x++)
          if (rgba[(y * size + x) * 4 + 3] >= 102) covered++;
      assert.equal(
        covered / half ** 2,
        coverage.mips[level].cells[cell].correctedCoverage,
      );
      assert.ok(
        Math.abs(
          covered / half ** 2 - coverage.mips[0].cells[cell].baseCoverage,
        ) < 0.008,
      );
      if (level !== 0) continue;
      const sample = manifest.solidSamples[cell],
        [u, v] = sample.uv;
      const x = Math.floor(u * size),
        y = Math.floor((1 - v) * size);
      assert.deepEqual([x, y], sample.pixel);
      assert.equal(Math.floor(x / half) + 2 * Math.floor(y / half), cell);
      assert.deepEqual(
        [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)],
        sample.rgba,
      );
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          assert.ok(rgba[((y + dy) * size + x + dx) * 4 + 3] >= 250);
    }
  });
  assert.equal(bytes, 5586944);
  assert.equal(bytes, manifest.rgba8MipBytes);
});

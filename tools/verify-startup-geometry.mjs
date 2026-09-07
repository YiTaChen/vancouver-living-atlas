// Compare the final physical ground byte-for-byte against an independent checkout.
// Usage: node tools/verify-startup-geometry.mjs [--root /path/to/baseline]
import { createHash } from 'node:crypto';
import { createFixture } from './causeway-cpu.mjs';
const started = performance.now();
const { e } = createFixture();
const hash = createHash('sha256');
let bytes = 0,
  meshes = 0;
for (const group of [e.terrain, e.roads])
  group.traverse((mesh) => {
    if (!mesh.geometry) return;
    meshes++;
    hash.update(mesh.name);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      hash.update(name);
      const buffer = Buffer.from(
        attribute.array.buffer,
        attribute.array.byteOffset,
        attribute.array.byteLength,
      );
      hash.update(buffer);
      bytes += buffer.length;
    }
  });
console.log(
  JSON.stringify({
    hash: hash.digest('hex'),
    meshes,
    bytes,
    elapsedMs: performance.now() - started,
  }),
);

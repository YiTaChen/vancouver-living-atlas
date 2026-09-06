import { createFixture, load, sourceHashes } from './causeway-cpu.mjs';
import { writeFileSync } from 'node:fs';
const started = performance.now(),
  { e, geo, THREE, groundPathMeshes } = createFixture();
const { isParkTrail } = load('lib/city/park-paths.ts').prepareParkPaths(e);
const { GroundSurfaceIndex } = load('lib/city/ground-surface.ts');
const ground = new GroundSurfaceIndex([e.terrain.children[0]]);
let samples = 0,
  close = 0,
  maxGap = 0;
const paths = [];
for (const mesh of groundPathMeshes) {
  const f = e.data.paths.features.find(
    (f) =>
      Number(f.properties.sourceId ?? f.properties.id) ===
      mesh.userData.auditPathId,
  );
  if (!isParkTrail(f)) continue;
  const p = mesh.geometry.getAttribute('position');
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3,
      z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3,
      y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const g = ground.sample(x, z, y);
    if (g === undefined) continue;
    const gap = y - g;
    min = Math.min(min, gap);
    max = Math.max(max, gap);
    samples++;
    if (Math.abs(gap - 0.045) < 0.005) close++;
    maxGap = Math.max(maxGap, gap);
  }
  paths.push({
    id: f.properties.id,
    name: f.properties.name,
    triangles: p.count / 3,
    minGap: min,
    maxGap: max,
    point: geo.lines(f)[0][Math.floor(geo.lines(f)[0].length / 2)],
  });
}
const report = {
  paths,
  samples,
  exactSurfaceSamples: close,
  maxGap,
  elapsedMs: performance.now() - started,
  sourceHashes: sourceHashes(),
};
writeFileSync(
  process.argv[process.argv.indexOf('--output') + 1] &&
    process.argv.includes('--output')
    ? process.argv[process.argv.indexOf('--output') + 1]
    : '/tmp/vancouver-park-path-audit.json',
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      paths: paths.length,
      samples,
      close,
      maxGap,
      elapsedMs: report.elapsedMs,
      examples: paths.filter((p) => p.maxGap < 0.051).slice(0, 8),
    },
    null,
    2,
  ),
);

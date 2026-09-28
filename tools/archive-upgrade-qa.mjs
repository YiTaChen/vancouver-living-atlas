// Preserve original 1080p renderer PNGs and their matched measurements, without resampling.
import {
  readFile,
  mkdir,
  readdir,
  copyFile,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label))
  throw new Error('Pass a simple capture label');
const source = resolve('work/visual-qa', label),
  target = resolve('docs/visual-quality', label);
const names = (await readdir(source)).filter((n) =>
  /^(high|ultra)-.*\.json$/.test(n),
);
const rows = [];
const expected = new Set(
  ['high', 'ultra'].flatMap((q) =>
    ['atlas-aerial', 'gastown-roofs', 'gastown-street', 'citizen'].map(
      (id) => `${q}-${id}`,
    ),
  ),
);
for (const name of names) {
  const row = JSON.parse(await readFile(resolve(source, name), 'utf8'));
  if (row.kind !== 'upgrade-matched-v1') continue;
  if (!row.valid || row.render?.[0] !== 1920 || row.render?.[1] !== 1080)
    throw new Error(`Invalid matched capture: ${name}`);
  if (
    !expected.delete(`${row.quality}-${row.id}`) ||
    name !== `${row.quality}-${row.id}.json`
  )
    throw new Error(`Unexpected or duplicate view: ${name}`);
  const png = await readFile(resolve(source, `${row.quality}-${row.id}.png`));
  if (
    png.length < 24 ||
    png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    png.readUInt32BE(16) !== 1920 ||
    png.readUInt32BE(20) !== 1080
  )
    throw new Error(`Invalid PNG dimensions: ${name}`);
  rows.push(row);
}
if (
  rows.length !== 8 ||
  expected.size ||
  new Set(rows.map((r) => r.sourceFingerprint)).size !== 1
)
  throw new Error('Both four-view High and Ultra suites are required');
await mkdir(target, { recursive: true });
for (const row of rows) {
  const name = `${row.quality}-${row.id}.png`;
  await copyFile(resolve(source, name), resolve(target, name));
}
await writeFile(
  resolve(target, 'measurements.json'),
  JSON.stringify(rows, null, 2) + '\n',
);
const table = rows
  .map(
    (r) =>
      `| ${r.quality} | ${r.id} | ${r.fps.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.maxMs.toFixed(1)} | ${r.over100Ms} | [PNG](${r.quality}-${r.id}.png) |`,
  )
  .join('\n');
await writeFile(
  resolve(target, 'README.md'),
  `# ${label}\n\n` +
    `Actual local WebGL renders, fixed 1920×1080 drawing buffer and 14:00. High and Ultra have identical pixel counts here, unlike normal quality presets. Each view settles for 5 seconds before an 8-second visible-browser RAF sample. These short samples are diagnostic, not a universal FPS or long-session guarantee.\n\n` +
    `Device: ${rows[0].renderer}. Parent revision: \`${rows[0].revision}\`; the JSON records the source fingerprint at server startup, including uncommitted changes. Rebuild before starting the server; this source hash alone does not verify the served bundle. Counters include multipass rendering, not unique geometry.\n\n` +
    `| Quality | View | FPS | p95 ms | Max ms | >100 ms | Capture |\n| --- | --- | ---: | ---: | ---: | ---: | --- |\n${table}\n`,
);
console.log(`Archived ${rows.length} original PNG captures to ${target}`);

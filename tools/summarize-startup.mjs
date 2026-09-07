import { readFile, readdir } from 'node:fs/promises';
const dirs = process.argv.slice(2);
const median = (list) =>
  [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
for (const dir of dirs) {
  const rows = [];
  for (const file of (await readdir(dir)).filter((name) =>
    /^(desktop|mobile-profile)-\d+\.json$/.test(name),
  )) {
    const data = JSON.parse(await readFile(`${dir}/${file}`, 'utf8')),
      m = data.measurement;
    if (!m.valid || m.hiddenDuringMeasurement)
      throw new Error(`Invalid sample ${file}`);
    const end = m.marks.find(
      (mark) => mark.name === 'ui.interactive-eligible',
    ).elapsedMs;
    const sync = m.spans
      .filter(
        (s) =>
          s.kind === 'sync-main-thread-wall' &&
          !s.name.startsWith('constructor.') &&
          !s.name.startsWith('react.') &&
          !s.name.startsWith('render.'),
      )
      .reduce((sum, s) => sum + s.wallMs, 0);
    rows.push({
      file,
      seconds: (m.originPerformanceMs + end) / 1000,
      mainGeometrySeconds: sync / 1000,
    });
  }
  console.log(
    JSON.stringify(
      {
        dir,
        rows,
        desktopMedian: median(
          rows
            .filter((r) => r.file.startsWith('desktop'))
            .map((r) => r.seconds),
        ),
        mobileProfileMedian: median(
          rows.filter((r) => r.file.startsWith('mobile')).map((r) => r.seconds),
        ),
      },
      null,
      2,
    ),
  );
}

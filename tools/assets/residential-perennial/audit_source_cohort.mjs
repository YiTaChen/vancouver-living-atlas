// Read-only pre-clearance candidate audit using the actual building/profile rules.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cityModule } from '../../../tests/helpers/city-modules.mjs';
const { rings, project } = await import(cityModule('geo'));
const { replacedBuilding } = await import(cityModule('replaced-buildings'));
const { structureKey, summarizeStructures, createProfile, hashId } =
  await import(cityModule('facade-profile'));
const bytes = readFileSync('public/data/buildings.geojson');
const parts = [];
for (const f of JSON.parse(bytes).features) {
  const p = f.properties,
    h = Math.max(2, Number(p.height ?? p.hgt_agl ?? 8)),
    min = Math.max(0, Number(p.minHeight) || 0);
  if (!Number.isFinite(h) || h > 350 || min >= h || replacedBuilding(p))
    continue;
  for (const raw of rings(f)) {
    const ring = raw[0].slice(0, -1).map(project);
    if (ring.length < 3) continue;
    const key = structureKey(
      p,
      ring
        .map((q) => q.map((n) => n.toFixed(3)).join(','))
        .sort()
        .join(';'),
    );
    const center = [0, 1].map(
      (i) => ring.reduce((n, q) => n + q[i], 0) / ring.length,
    );
    const area =
      Math.abs(
        ring.reduce((n, q, i) => {
          const r = ring[(i + 1) % ring.length];
          return n + q[0] * r[1] - r[0] * q[1];
        }, 0),
      ) / 2;
    parts.push({
      structureId: key,
      heightM: h,
      minHeightM: min,
      footprintAreaM2: area,
      center,
    });
  }
}
const counts = new Map();
for (const p of parts)
  counts.set(p.structureId, (counts.get(p.structureId) ?? 0) + 1);
const profiles = new Map(
  [...summarizeStructures(parts)].map(([key, s]) => [key, createProfile(s)]),
);
const candidates = parts
  .filter(
    (p) =>
      profiles.get(p.structureId).kind === 'domestic-cladding' &&
      p.minHeightM === 0 &&
      p.heightM >= 3.5 &&
      p.heightM <= 12 &&
      counts.get(p.structureId) === 1,
  )
  .sort(
    (a, b) =>
      hashId(a.structureId) - hashId(b.structureId) ||
      a.structureId.localeCompare(b.structureId),
  );
writeFileSync(
  'tools/assets/residential-perennial/source-cohort.json',
  JSON.stringify(
    {
      status:
        'Pre-clearance candidate audit only; accepted runtime plots require actual terrain and road tests. No invented accepted IDs.',
      input: 'public/data/buildings.geojson',
      inputSha256: createHash('sha256').update(bytes).digest('hex'),
      candidateCount: candidates.length,
      plotCap: 500,
      first20Candidates: candidates
        .slice(0, 20)
        .map((p) => ({
          key: p.structureId,
          center: p.center,
          heightM: p.heightM,
        })),
      selection:
        'Existing domestic-cladding profile, single part, ground level, 3.5–12 m, deterministic hash order; runtime then rejects overlapping road/building/accepted beds and requires terrain sample.',
    },
    null,
    2,
  ) + '\n',
);

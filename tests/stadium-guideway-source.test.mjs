import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebuildStadium } from '../tools/station-interiors/southeast.mjs';
import { makeRuntimeStation } from '../tools/build-skytrain-runtime-stations.mjs';
import { cityModule } from './helpers/city-modules.mjs';
import { walkFlat } from './helpers/station-walker.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const original = JSON.parse(
  readFileSync('tools/assets/skytrain-stations-stage2/station-layout.json'),
).stations.find((s) => s.stationId === 'stadium-chinatown');
const built = rebuildStadium(original),
  data = makeRuntimeStation(built, 'a'.repeat(64));

test('Stadium mapped northwest guideways have visible connected beds, running rails, service walks and bounded tunnel mouths', () => {
  const parts = built.geometryParts;
  for (const p of built.platforms) {
    const x = p.stopPosition.translationM[0],
      y = p.railHeightM;
    const beds = parts
      .filter((g) => g.id.startsWith(`${p.platformId}-approach-trackbed-`))
      .sort((a, b) => a.centerM[2] - b.centerM[2]);
    assert.equal(beds.length, 3);
    for (const g of beds) {
      assert.equal(g.material, 'concrete');
      assert.equal(g.role, 'trackbed');
      assert.equal(g.centerM[0], x);
      assert(Math.abs(g.centerM[1] + g.sizeM[1] / 2 - (y - 0.07)) < 1e-8);
    }
    assert(beds[0].centerM[2] - beds[0].sizeM[2] / 2 <= 14);
    assert(beds.at(-1).centerM[2] + beds.at(-1).sizeM[2] / 2 >= 53.2);
    for (let i = 1; i < beds.length; i++)
      assert(
        beds[i - 1].centerM[2] + beds[i - 1].sizeM[2] / 2 >=
          beds[i].centerM[2] - beds[i].sizeM[2] / 2,
      );
    const prefix = `stadium-northwest-guideway-${p.direction}`;
    const roof = parts.find((g) => g.id === `${prefix}-tunnel-roof`);
    assert(roof);
    assert(
      roof.centerM[2] + roof.sizeM[2] / 2 < 25.2,
      'real daylight guideway stays open to the sky',
    );
    assert(roof.centerM[1] - roof.sizeM[1] / 2 - y - 3.65 >= 0.25);
    for (const section of ['portal-transition', 'viaduct']) {
      assert(
        parts.some((g) => g.id === `${prefix}-${section}-maintenance-walk`),
      );
      assert(parts.some((g) => g.id === `${prefix}-${section}-outer-parapet`));
      assert(parts.some((g) => g.id === `${prefix}-${section}-outer-handrail`));
      for (const side of [-1, 1]) {
        const rail = parts.find(
          (g) => g.id === `${prefix}-${section}-rail-${side}`,
        );
        assert(Math.abs(rail.centerM[0] - x - side * 0.7175) < 1e-8);
        assert(Math.abs(rail.centerM[1] + rail.sizeM[1] / 2 - y) < 1e-8);
      }
    }
  }
  const twice = rebuildStadium(built);
  assert.equal(twice.geometryParts.length, built.geometryParts.length);
  assert.equal(new Set(parts.map((p) => p.id)).size, parts.length);
});

test('Stadium real mapped lift core remains inside the two running tracks, with three public landings', () => {
  const evidence = JSON.parse(
    readFileSync(
      'tools/station-interiors/references/stadium-northwest-guideways-20261023.json',
    ),
  );
  const record = evidence.records.find((r) => r.id === 5476795075);
  assert.deepEqual(record.lonlat, [-123.1098663, 49.2797654]);
  assert.equal(record.type, 'node');
  assert.equal(record.tags.highway, 'elevator');
  const landings = built.authoredInterior.elevatorLandings;
  assert.equal(
    landings.length,
    3,
    'three authored public levels are not an all-stops inventory',
  );
  for (const l of landings) {
    assert(Math.abs(l.pointM[0] - 3.98869237) < 0.001);
    assert(Math.abs(l.pointM[2] - 20.59954082) < 0.001);
  }
});

test('Stadium Beatty and Keefer step-free paths walk the real lift portals and lower bypass in both directions', () => {
  const o = new SkyTrainStationOwner(data, () => 0, 'balanced', false);
  try {
    for (const id of ['stadium-beatty-entry', 'stadium-keefer-entry']) {
      const e = data.entrances.find((e) => e.id === id),
        goal = 'stadium-expo';
      const queue = [e.surfaceId],
        seen = new Set(queue),
        previous = new Map();
      for (const from of queue) {
        if (from === goal) break;
        for (const c of data.connections.filter((c) =>
          ['walk', 'elevator'].includes(c.type),
        )) {
          const to = c.from === from ? c.to : c.to === from ? c.from : null;
          if (!to || seen.has(to)) continue;
          seen.add(to);
          previous.set(to, { from, c });
          queue.push(to);
        }
      }
      assert(seen.has(goal));
      const chain = [];
      let to = goal;
      while (to !== e.surfaceId) {
        const p = previous.get(to);
        chain.unshift({ c: p.c, forward: p.c.from === p.from });
        to = p.from;
      }
      assert(chain.some(({ c }) => c.type === 'elevator'));
      const initial = o.floorAt(
        e.point.map((n, i) => n + e.inwardDirection[i] * 0.4),
        e.surfaceId,
      );
      assert(initial && o.isClearFoot(initial));
      let foot = initial;
      for (const reverse of [false, true])
        for (const { c, forward: raw } of reverse
          ? [...chain].reverse()
          : chain) {
          const forward = reverse ? !raw : raw,
            start = forward ? c.start : c.end,
            end = forward ? c.end : c.start;
          foot = walkFlat(o, foot, start);
          if (c.type === 'elevator') {
            assert(
              built.authoredInterior.elevatorLandings.some(
                (l) => Math.hypot(...l.pointM.map((n, i) => n - end[i])) < 0.01,
              ),
            );
            foot = o.floorAt(end, forward ? c.to : c.from);
            assert(
              foot && o.isClearFoot(foot),
              'a lift transition must end inside a supported real cabin',
            );
          } else foot = walkFlat(o, foot, end);
        }
      foot = walkFlat(o, foot, initial.position);
      assert(
        Math.hypot(
          foot.position[0] - initial.position[0],
          foot.position[2] - initial.position[2],
        ) < 0.17,
      );
    }
  } finally {
    o.dispose();
  }
});

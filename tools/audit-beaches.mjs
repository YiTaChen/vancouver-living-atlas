/** Original MIT. Real ground movement and boat physics against final coastal data. */
import { writeFileSync } from 'node:fs';
import {
  createFixture,
  load,
  readData,
  sourceHashes,
} from './causeway-cpu.mjs';
const { e, nav, geo } = createFixture();
const { WaterWorld, lakeSurfaces } = load('lib/city/water-world.ts');
const { advanceBoat, initialBoatState } = load('lib/city/boat-physics.ts');
const world = new WaterWorld(
  e.landPolys,
  readData('context-land.geojson'),
  lakeSurfaces(e.data.context, (x, z) => e.elevation(x, z)),
  e.data.buildings,
  load('lib/city/landmark-footprints.json'),
  e.beachGround,
);
for (const p of e.data.beachCoast.groundObstacleFootprints)
  world.addObstacle(p);
const rows = [];
for (const [name, x, z] of [
  ['Second Beach', -1598, -938],
  ['Third Beach', -2069, -2043],
]) {
  nav.mode = 'walk';
  nav.surface = 'ground';
  nav.surfaceId = undefined;
  nav.surfaceLayer = undefined;
  nav.position.set(x, nav.groundHeight(x, z), z);
  nav.yaw = -Math.PI / 2;
  nav.speed = 0;
  let walked = 0,
    blocked = false,
    maxFootGap = 0;
  for (let i = 0; i < 400; i++) {
    const before = nav.position.x;
    nav.move(-0.25, 0);
    const d = Math.abs(nav.position.x - before);
    walked += d;
    if (d < 0.01) {
      blocked = true;
      break;
    }
    const h = e.beachGround.height(nav.position.x, nav.position.z);
    if (h !== undefined)
      maxFootGap = Math.max(maxFootGap, Math.abs(nav.walkingHeight() - h));
  }
  rows.push({
    name,
    mode: 'walk',
    valid:
      blocked &&
      walked > 5 &&
      walked < 90 &&
      e.onLand(nav.position.x, nav.position.z) &&
      maxFootGap < 0.05,
    walked,
    blocked,
    maxFootGap,
    coordinate: geo.unproject(nav.position.x, nav.position.z),
  });
  const boat = { ...initialBoatState(), x: x - 90, z, yaw: Math.PI / 2 };
  let seconds = 0,
    allOccupied = true;
  for (let i = 0; i < 2400; i++) {
    advanceBoat(boat, { thrust: 1, turn: 0, neutral: false }, 1 / 60, world);
    seconds += 1 / 60;
    allOccupied &&= world.canOccupy(boat.x, boat.z, boat.yaw, 'sea');
    if (boat.collided) break;
  }
  rows.push({
    name,
    mode: 'boat',
    valid:
      allOccupied &&
      boat.collided &&
      boat.x > x - 70 &&
      boat.x < x - 20 &&
      boat.vx === 0 &&
      boat.vz === 0,
    travelled: boat.x - (x - 90),
    seconds,
    collided: boat.collided,
    coordinate: geo.unproject(boat.x, boat.z),
    groundHeight: e.beachGround.height(boat.x, boat.z),
  });
}
const report = {
  kind: 'CPU replay of canonical StreetNavigation.move and advanceBoat against final rendered coastal terrain; no browser/FPS claim',
  valid: rows.every((r) => r.valid),
  results: rows,
  sourceHashes: sourceHashes(),
};
const arg = process.argv.indexOf('--output');
if (arg >= 0)
  writeFileSync(process.argv[arg + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ valid: report.valid, results: rows }, null, 2));
nav.destroy();
if (!report.valid) process.exitCode = 1;

import type { CityEngine } from './engine';
import { inPolygon, lines, project } from './geo';
import type { FeatureCollection } from './types';
import type {
  FootstepSurface,
  SoundscapeFrame,
  SoundscapeTrain,
} from './soundscape-policy';
import { soundDistanceGain } from './soundscape-policy';

type Segment = readonly [number, number, number, number];
const CELL = 200;

/** Audio-only local shoreline query. It never changes collision geometry. */
export class SoundscapeShoreIndex {
  private readonly cells = new Map<string, Segment[]>();
  constructor(data: FeatureCollection) {
    for (const feature of data.features)
      for (const line of lines(feature))
        for (let i = 1; i < line.length; i++) {
          const a = project(line[i - 1]),
            b = project(line[i]);
          const segment: Segment = [a[0], a[1], b[0], b[1]];
          for (
            let x = Math.floor(Math.min(a[0], b[0]) / CELL);
            x <= Math.floor(Math.max(a[0], b[0]) / CELL);
            x++
          )
            for (
              let z = Math.floor(Math.min(a[1], b[1]) / CELL);
              z <= Math.floor(Math.max(a[1], b[1]) / CELL);
              z++
            ) {
              const key = `${x},${z}`;
              const bucket = this.cells.get(key) ?? [];
              bucket.push(segment);
              this.cells.set(key, bucket);
            }
        }
  }
  distance(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
    let nearest = 180 * 180;
    const cx = Math.floor(x / CELL),
      cz = Math.floor(z / CELL);
    for (let i = cx - 1; i <= cx + 1; i++)
      for (let j = cz - 1; j <= cz + 1; j++)
        for (const [ax, az, bx, bz] of this.cells.get(`${i},${j}`) ?? []) {
          const dx = bx - ax,
            dz = bz - az,
            length = dx * dx + dz * dz;
          const t = length
            ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
            : 0;
          nearest = Math.min(
            nearest,
            (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2,
          );
        }
    return nearest < 180 * 180 ? Math.sqrt(nearest) : Infinity;
  }
}

// Original illustrative harbour ambience zones, not live vessel locations.
const HARBOUR = [
  [-123.1114, 49.2888],
  [-123.127, 49.294],
  [-123.097, 49.289],
].map(project);

/** Sample existing state, never traverse meshes. Environmental queries run at
 * 5 Hz; accepted foot displacement is sampled each active frame. No work or
 * geographic index is created until the user enables the soundscape. */
export class CitySoundscapeWorld {
  private shore: SoundscapeShoreIndex | null = null;
  private sampledAt = -Infinity;
  private environment = {
    shoreDistanceM: Infinity,
    greenery: 0,
    harbourDistanceM: Infinity,
    interior: false,
  };
  private surface: FootstepSurface = 'pavement';
  private trains: SoundscapeTrain[] = [];
  constructor(private readonly city: CityEngine) {}
  update(now: number) {
    const e = this.city,
      audio = e.soundscape;
    if (!audio?.enabled) {
      this.sampledAt = -Infinity;
      return;
    }
    const p = e.camera.position;
    const transit = e.skyTrainTravel;
    if (now - this.sampledAt >= 200 || now < this.sampledAt) {
      this.sampledAt = now;
      this.shore ??= new SoundscapeShoreIndex(
        e.data.beachCoast?.shoreline ?? e.data.shoreline,
      );
      const floor = e.interiors?.height(p.x, p.z);
      const interior = Boolean(
        transit?.aboard ||
        transit?.underground ||
        e.busVisit?.aboard ||
        (floor !== undefined && p.y >= floor - 0.1 && p.y < floor + 4),
      );
      const green = e.parkPolys.some((park) =>
        inPolygon([p.x, p.z], park.poly),
      );
      const day = e.clock.hour >= 5 && e.clock.hour < 21;
      this.environment = {
        interior,
        shoreDistanceM: Math.hypot(this.shore.distance(p.x, p.z), p.y - 0.1),
        greenery:
          day && green
            ? soundDistanceGain(Math.abs(p.y - e.elevation(p.x, p.z)), 4, 70)
            : 0,
        harbourDistanceM: e.settings.harbour
          ? Math.min(
              ...HARBOUR.map(([x, z]) => Math.hypot(p.x - x, p.z - z, p.y)),
            )
          : Infinity,
      };
      const foot = e.navigation?.position ?? p;
      const footGreen = e.parkPolys.some((park) =>
        inPolygon([foot.x, foot.z], park.poly),
      );
      const sand = (e.data.beachPolys as number[][][][] | undefined)?.some(
        (poly) => inPolygon([foot.x, foot.z], poly),
      );
      this.surface = sand
        ? 'sand'
        : footGreen
          ? 'grass'
          : /wood|boardwalk/i.test(e.navigation?.surfaceId ?? '')
            ? 'wood'
            : 'pavement';
      this.trains = [];
      if (e.settings.trains && !transit?.active)
        e.railway?.trains.forEach((train, i) => {
          const car = train.cars[0]?.group;
          if (
            train.kind !== 'skytrain' ||
            !car?.visible ||
            !e.railway?.group.visible
          )
            return;
          const position = car.position;
          if (position.distanceToSquared(p) < 150 * 150)
            this.trains.push({
              id: `city-${i}`,
              position: position.toArray(),
              speedMps: train.speed,
            });
        });
    }
    const steps = transit?.active
      ? transit.soundscapeFootsteps
      : e.navigation?.mode === 'walk'
        ? {
            position: e.navigation.position.toArray(),
            space: `street:${e.navigation.surfaceId ?? e.navigation.surface}`,
            surface: this.surface,
            active: !e.navigation.walkSeat && !e.busVisit?.aboard,
          }
        : undefined;
    const trains =
      transit?.active && transit.train.ready
        ? [
            {
              id: 'passenger-service',
              position: transit.train.group.position.toArray(),
              speedMps: transit.speedMps,
              aboard: transit.aboard,
            },
          ]
        : this.trains;
    const frame: SoundscapeFrame = {
      now,
      listener: p.toArray(),
      yaw: Math.atan2(
        e.camera.matrixWorld.elements[8],
        e.camera.matrixWorld.elements[10],
      ),
      ...this.environment,
      trains,
      footsteps: steps,
    };
    audio.update(frame);
  }
}

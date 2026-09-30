/** Original Atlas activity; these coordinates belong to our representative Science World interior. */
export const LIGHT_LAB_STORAGE_KEY = 'vancouver-atlas-light-lab-v1';
export const LIGHT_LAB_PATH: readonly (readonly [number, number])[] = [
  [40, -59],
  [40, -35],
  [40, -22],
  [20, -22],
  [13, -16],
];
export const LIGHT_LAB_RADIUS = 3;
export const LIGHT_LAB_RECIPES = [
  [100, 100, 0],
  [0, 100, 100],
  [100, 100, 100],
] as const;
export type LightLevels = readonly [number, number, number];
export interface LightLabSave {
  version: 1;
  next: number;
  best: number;
  stamped: boolean;
}
export function emptyLightLabSave(): LightLabSave {
  return { version: 1, next: 0, best: 0, stamped: false };
}
export function readLightLabSave(raw: string | null): LightLabSave {
  const clean = emptyLightLabSave();
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || value.version !== 1) return clean;
    const count = (n: unknown) =>
      Number.isInteger(n) && Number(n) >= 0 ? Math.min(3, Number(n)) : 0;
    const next = count(value.next),
      best = Math.max(next, count(value.best));
    return {
      version: 1,
      next,
      best,
      stamped: next === 3 || (value.stamped === true && best === 3),
    };
  } catch {
    return clean;
  }
}
export function startLightLab(save: LightLabSave): LightLabSave {
  return { ...save, next: save.next === 3 ? 0 : save.next };
}
export interface LightLabSample {
  /** Accepted navigation position transformed into the Science World site's local coordinates. */
  x: number;
  z: number;
  now: number;
  mode: string;
  visible: boolean;
  onFloor: boolean;
}
export interface LightLabStatus {
  next: number;
  distance: number;
  arrived: boolean;
  eligible: boolean;
  interrupted: boolean;
}
/** Admission is a session-local physical visit, never restored from a save. Each
 * corridor waypoint must be approached in sequence with continuous accepted movement. */
export class LightLabVisit {
  private previous: LightLabSample | null = null;
  private hiddenAt: readonly [number, number] | null = null;
  private walked = 0;
  next = 0;
  interrupted = false;
  private reset() {
    this.next = 0;
    this.walked = 0;
    this.previous = null;
    this.hiddenAt = null;
    this.interrupted = true;
  }
  sample(value: LightLabSample): LightLabStatus {
    const finite = [value.x, value.z, value.now].every(Number.isFinite);
    const walking = finite && value.mode === 'walk' && value.onFloor;
    if (!walking) this.reset();
    else if (!value.visible) {
      if (this.previous && !this.hiddenAt)
        this.hiddenAt = [this.previous.x, this.previous.z];
      this.previous = null;
    } else {
      if (this.hiddenAt) {
        if (
          Math.hypot(value.x - this.hiddenAt[0], value.z - this.hiddenAt[1]) >
          0.75
        )
          this.reset();
        this.hiddenAt = null;
      } else if (this.previous) {
        const dt = (value.now - this.previous.now) / 1000;
        const moved = Math.hypot(
          value.x - this.previous.x,
          value.z - this.previous.z,
        );
        if (dt < 0 || dt > 1.5 || moved > dt * 14 + 1) {
          // A stationary callback/re-render cannot destroy an otherwise valid visit.
          if (moved > 0.75 || dt < 0) this.reset();
        } else this.walked += moved;
      }
      const target = LIGHT_LAB_PATH[this.next];
      if (target) {
        const distance = Math.hypot(value.x - target[0], value.z - target[1]);
        const previous = LIGHT_LAB_PATH[Math.max(0, this.next - 1)];
        const required = this.next
          ? Math.max(
              0,
              Math.hypot(target[0] - previous[0], target[1] - previous[1]) - 5,
            )
          : 0;
        if (distance <= 2.5 && this.walked + 0.01 >= required) {
          this.next++;
          this.walked = 0;
          this.interrupted = false;
        }
      }
      this.previous = { ...value };
    }
    const target =
      LIGHT_LAB_PATH[Math.min(this.next, LIGHT_LAB_PATH.length - 1)];
    const distance = finite
      ? Math.hypot(value.x - target[0], value.z - target[1])
      : Infinity;
    const arrived = this.next === LIGHT_LAB_PATH.length;
    return {
      next: this.next,
      distance,
      arrived,
      interrupted: this.interrupted,
      eligible:
        walking && value.visible && arrived && distance <= LIGHT_LAB_RADIUS,
    };
  }
}
export function lightRecipeMatches(levels: LightLevels, index: number) {
  const recipe = LIGHT_LAB_RECIPES[index];
  return (
    !!recipe &&
    levels.length === 3 &&
    recipe.every(
      (_, i) =>
        Number.isFinite(levels[i]) &&
        levels[i] >= 0 &&
        levels[i] <= 100 &&
        Math.abs(levels[i] - recipe[i]) <= 8,
    )
  );
}
/** Recheck the live floor, visit and stage at the actual award boundary. */
export function submitLightLab(
  save: LightLabSave,
  index: number,
  levels: LightLevels,
  visit: LightLabVisit,
  sample: LightLabSample,
): LightLabSave {
  if (
    index !== save.next ||
    !visit.sample(sample).eligible ||
    !lightRecipeMatches(levels, index)
  )
    return save;
  const next = save.next + 1;
  return {
    version: 1,
    next,
    best: Math.max(save.best, next),
    stamped: save.stamped || next === 3,
  };
}
/** Slider values represent relative light intensity, converted from linear RGB for display. */
export function lightMixtureCSS(levels: LightLevels) {
  const channel = (level: number) => {
    const value = Math.min(
      1,
      Math.max(0, Number.isFinite(level) ? level / 100 : 0),
    );
    return Math.round(
      255 *
        (value <= 0.0031308
          ? value * 12.92
          : 1.055 * value ** (1 / 2.4) - 0.055),
    );
  };
  return `rgb(${levels.map(channel).join(' ')})`;
}

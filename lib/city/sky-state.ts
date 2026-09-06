export const MOON_PHASES = [
  'auto',
  'new',
  'waxingCrescent',
  'firstQuarter',
  'waxingGibbous',
  'full',
  'waningGibbous',
  'lastQuarter',
  'waningCrescent',
  'eclipse',
] as const;
export interface SkySettings {
  sun: boolean;
  moon: boolean;
  stars: boolean;
  aurora: boolean;
  meteors: boolean;
  moonPhase: (typeof MOON_PHASES)[number];
  auroraMode: 'auto' | 'always';
  starDensity: number;
  auroraIntensity: number;
  auroraDensity: number;
  meteorFrequency: number;
}
export const DEFAULT_SKY: SkySettings = {
  sun: true,
  moon: true,
  stars: true,
  aurora: true,
  meteors: true,
  moonPhase: 'auto',
  auroraMode: 'auto',
  starDensity: 0.45,
  auroraIntensity: 0.45,
  auroraDensity: 0.45,
  meteorFrequency: 0.3,
};
export function normalizeSky(
  p: Partial<SkySettings>,
  current = DEFAULT_SKY,
): SkySettings {
  const result = { ...current };
  for (const key of ['sun', 'moon', 'stars', 'aurora', 'meteors'] as const)
    if (typeof p[key] === 'boolean') result[key] = p[key];
  for (const key of [
    'starDensity',
    'auroraIntensity',
    'auroraDensity',
    'meteorFrequency',
  ] as const)
    if (Number.isFinite(p[key]))
      result[key] = Math.max(0, Math.min(1, p[key]!));
  if (MOON_PHASES.includes(p.moonPhase!)) result.moonPhase = p.moonPhase!;
  if (p.auroraMode === 'auto' || p.auroraMode === 'always')
    result.auroraMode = p.auroraMode;
  return result;
}
export function nightKey(hour: number, day: number) {
  return day - (hour < 6 ? 1 : 0);
}
/** Session-scoped first night, stable random event per subsequent calendar night.
 * Manual scrubbing within a night never rerolls its aurora. Eclipse is an
 * explicit artistic preview, not a claimed astronomical eclipse forecast.
 */
export class NightSkyCycle {
  private first: number | null = null;
  constructor(private seed = Math.random()) {}
  update(hour: number, day: number) {
    const key = nightKey(hour, day),
      night = hour >= 20.5 || hour < 6;
    if (night && this.first === null) this.first = key;
    const offset = this.first === null ? 0 : key - this.first;
    const value =
      Math.sin((key + 917) * 127.1 + this.seed * 311.7) * 43758.5453;
    return {
      night,
      key,
      aurora: this.first === key || value - Math.floor(value) < 1 / 3,
      phase: (((0.25 + offset / 29.53059) % 1) + 1) % 1,
    };
  }
}

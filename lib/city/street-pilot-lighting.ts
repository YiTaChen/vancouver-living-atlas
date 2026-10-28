import type { AtmosphereSample } from './atmosphere';
import { streetShowcaseWeight } from './street-quality-profile';

/** Camera height above the local ground, not world Y. The same streets can be
 * inspected on foot or from a tall tower without changing the aerial palette. */
export const STREET_PILOT_LIGHTING_ALTITUDE = Object.freeze({
  fullM: 25,
  offM: 90,
});

export type StreetPilotLightingMultipliers = Readonly<{
  ambientIntensity: number;
  sunIntensity: number;
  environmentIntensity: number;
  exposure: number;
}>;

export const STREET_PILOT_BASELINE_LIGHTING: StreetPilotLightingMultipliers =
  Object.freeze({
    ambientIntensity: 1,
    sunIntensity: 1,
    environmentIntensity: 1,
    exposure: 1,
  });

/** Street-level light calibration. Keep broad overcast fill and night visibility,
 * while clear daylight has a stronger directional-to-ambient ratio and more of
 * the existing sky PMREM on glossy surfaces. No extra lights or passes are used. */
export const STREET_PILOT_LIGHTING_TARGETS = Object.freeze({
  dayClear: Object.freeze({
    ambientIntensity: 0.57,
    sunIntensity: 1.2,
    environmentIntensity: 3.2,
    exposure: 0.98,
  }),
  dayOvercast: Object.freeze({
    ambientIntensity: 0.75,
    sunIntensity: 1.1,
    environmentIntensity: 2.6,
    exposure: 0.98,
  }),
  night: Object.freeze({
    ambientIntensity: 1,
    sunIntensity: 1,
    environmentIntensity: 2,
    exposure: 1,
  }),
});

function unit(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

/** Spatial appearance envelope only. The host must additionally exclude public
 * interiors, bus/skytrain cameras and flight modes before applying this weight.
 * altitudeM is camera height above local ground; negative heights remain low.
 * Re-evaluate when the camera moves even if the simulation clock is fixed. */
export function streetPilotLightingWeight(
  x: number,
  altitudeM: number,
  z: number,
): number {
  if (![x, altitudeM, z].every(Number.isFinite)) return 0;
  const spatial = streetShowcaseWeight(x, z);
  if (spatial === 0) return 0;
  const t = unit(
    (altitudeM - STREET_PILOT_LIGHTING_ALTITUDE.fullM) /
      (STREET_PILOT_LIGHTING_ALTITUDE.offM -
        STREET_PILOT_LIGHTING_ALTITUDE.fullM),
  );
  return spatial * (1 - t * t * (3 - 2 * t));
}

/** The street-bounce pilot additionally excludes vehicles whose view can be
 * within the district while the user is on water or in a rocket. The existing
 * camera weight already excludes flight, interiors, transit, and high altitude. */
export function streetPilotNightViewWeight(
  weight: number,
  mode: string,
): number {
  return mode === 'boat' || mode === 'rocket' || mode === 'flight'
    ? 0
    : unit(weight);
}

/** Multiply the *fresh base* atmosphere sample, never the previously adjusted
 * light values. Using sampleAtmosphere's continuous night factor keeps sunrise
 * and sunset gradual; full night retains all baseline visibility fill. The
 * existing cached PMREM is reused with a scalar intensity change only. */
export function streetPilotLightingMultipliers(
  atmosphere: Pick<AtmosphereSample, 'night' | 'cloud'>,
  weight: number,
): StreetPilotLightingMultipliers {
  const w = unit(weight);
  if (w === 0) return STREET_PILOT_BASELINE_LIGHTING;
  const daylight = 1 - unit(atmosphere.night, 1);
  const cloud = unit(atmosphere.cloud);
  const clear = STREET_PILOT_LIGHTING_TARGETS.dayClear;
  const overcast = STREET_PILOT_LIGHTING_TARGETS.dayOvercast;
  const night = STREET_PILOT_LIGHTING_TARGETS.night;
  const multiplier = (key: keyof StreetPilotLightingMultipliers) => {
    const dayTarget = clear[key] + (overcast[key] - clear[key]) * cloud;
    const target = night[key] + (dayTarget - night[key]) * daylight;
    return 1 + (target - 1) * w;
  };
  return {
    ambientIntensity: multiplier('ambientIntensity'),
    sunIntensity: multiplier('sunIntensity'),
    environmentIntensity: multiplier('environmentIntensity'),
    exposure: multiplier('exposure'),
  };
}

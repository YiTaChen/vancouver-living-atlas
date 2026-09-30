import type { CityEngine } from './engine';
import { inPolygon } from './geo';
import {
  LIGHT_LAB_PATH,
  LIGHT_LAB_RADIUS,
  type LightLabSample,
} from './light-lab';

export function lightLabTarget(city: CityEngine, next: number) {
  const interiors = city.interiors;
  const site = interiors?.sites.find((candidate) => candidate.id === 'science');
  if (!interiors || !site) return null;
  const local =
    LIGHT_LAB_PATH[Math.max(0, Math.min(LIGHT_LAB_PATH.length - 1, next))];
  const [x, z] = interiors.world(site, ...local);
  return { x, z };
}
/** Audit the whole authored corridor before changing the current travel state. */
export function canStartLightLab(city: CityEngine) {
  const nav = city.navigation,
    interiors = city.interiors;
  const site = interiors?.sites.find((candidate) => candidate.id === 'science');
  if (city.disposed || city.contextLost || !nav || !interiors || !site)
    return false;
  for (let index = 1; index < LIGHT_LAB_PATH.length; index++) {
    const a = LIGHT_LAB_PATH[index - 1],
      b = LIGHT_LAB_PATH[index];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    const steps = Math.ceil(length / 0.3);
    for (let step = 0; step <= steps; step++)
      for (const offset of [-0.35, 0, 0.35]) {
        const [x, z] = interiors.world(
          site,
          a[0] + (dx * step) / steps - (dz / length) * offset,
          a[1] + (dz * step) / steps + (dx / length) * offset,
        );
        if (
          interiors.clear(x, z, 'walk') !== true ||
          !nav.clearGround(x, z, 'walk') ||
          !Number.isFinite(interiors.height(x, z))
        )
          return false;
      }
  }
  return true;
}
export function placeLightLabStart(city: CityEngine) {
  if (!canStartLightLab(city)) return false;
  city.flight?.clear();
  city.placement?.cancel();
  city.applySettings({
    ...city.settings,
    mode: 'walk',
    autoRotate: false,
    buildings: true,
  });
  return city.navigation!.startAt('walk', city.interiors!.entry('science'));
}
export function lightLabSample(
  city: CityEngine,
  now = performance.now(),
): LightLabSample {
  const nav = city.navigation,
    interiors = city.interiors;
  const site = interiors?.sites.find((candidate) => candidate.id === 'science');
  if (city.disposed || city.contextLost || !nav || !interiors || !site)
    return {
      x: NaN,
      z: NaN,
      now,
      mode: 'orbit',
      visible: false,
      onFloor: false,
    };
  const [x, z] = interiors.local(site, nav.position.x, nav.position.z);
  // Limit the floor identity to this site's polygons, open doors and entry ramp.
  const rectContains = (r: { x: number; z: number; w: number; d: number }) =>
    Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2;
  const inSite =
    site.polys.some((poly) => inPolygon([x, z], [poly])) ||
    site.doors.some(rectContains) ||
    rectContains(site.approach);
  const floor = interiors.height(nav.position.x, nav.position.z);
  return {
    x,
    z,
    now,
    mode: nav.mode,
    visible: !document.hidden,
    onFloor:
      inSite &&
      nav.surface === 'ground' &&
      floor !== undefined &&
      Math.abs(nav.position.y - floor - 1.25) < 0.6 &&
      interiors.clear(nav.position.x, nav.position.z, 'walk') === true,
  };
}

/** Bring the physical exhibit into view without moving the visitor or granting progress. */
export function faceLightLabExhibit(city: CityEngine) {
  const sample = lightLabSample(city);
  const stand = LIGHT_LAB_PATH[LIGHT_LAB_PATH.length - 1];
  if (
    !sample.visible ||
    sample.mode !== 'walk' ||
    !sample.onFloor ||
    Math.hypot(sample.x - stand[0], sample.z - stand[1]) > LIGHT_LAB_RADIUS
  )
    return false;
  const nav = city.navigation!,
    interiors = city.interiors!;
  const site = interiors.sites.find((candidate) => candidate.id === 'science')!;
  const [x, z] = interiors.world(site, 13, -11);
  nav.yaw = Math.atan2(x - nav.position.x, z - nav.position.z);
  nav.pitch = 0.04;
  nav.snapCamera = true;
  nav.update(0);
  return true;
}

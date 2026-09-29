/** Extra local QA coverage, separate from the eight matched upgrade captures. */
import type { CityEngine } from './engine';
import type { PitchedRoof } from './building-roof';
import { project } from './geo';
import { clearQAOrbitMomentum, captureQAPose } from './upgrade-qa-pose';

export const DOMESTIC_QA_VIEWS = [
  {
    id: 'kitsilano-gables',
    sourceId: '134681',
    coord: [-123.151607335, 49.274209915],
    offset: [65, 55, 90],
  },
  {
    id: 'west-end-gables',
    sourceId: '145450',
    coord: [-123.13082495, 49.2818510275],
    offset: [-50, 45, 65],
  },
] as const;
export type DomesticQAView = (typeof DOMESTIC_QA_VIEWS)[number]['id'];

/** The caller owns busy state and capture timing. This does not inject a model,
 * change source data or move the walker. It selects existing source structures. */
export function selectDomesticQA(e: CityEngine, id: DomesticQAView) {
  const view = DOMESTIC_QA_VIEWS.find((v) => v.id === id)!;
  const roofs = e.data.buildingRoofs as Map<string, PitchedRoof> | undefined;
  const roof = roofs?.get(view.sourceId);
  if (!roof)
    throw new Error(`Missing expected source-tagged roof ${view.sourceId}`);
  const [x, z] = project(view.coord);
  const y = e.elevation(x, z);
  e.navigation!.keys.clear();
  e.navigation!.setMode('orbit');
  e.transition = null;
  e.applySettings({
    ...e.settings,
    mode: 'orbit',
    labels: false,
    autoRotate: false,
  });
  clearQAOrbitMomentum(e.controls);
  e.setClock({ hour: 14, running: false });
  e.camera.fov = 48;
  e.camera.near = 0.15;
  e.camera.position.set(
    x + view.offset[0],
    y + view.offset[1],
    z + view.offset[2],
  );
  e.controls.target.set(x, y + 5, z);
  e.controls.maxPolarAngle = Math.PI * 0.499;
  e.controls.update();
  const expectedPose = captureQAPose(e.camera, e.controls);
  e.ensureSSAO();
  e.renderer.setPixelRatio(1);
  e.renderer.setSize(1920, 1080, false);
  e.composer?.setPixelRatio(1);
  e.composer?.setSize(1920, 1080);
  e.fxaa?.uniforms.resolution.value.set(1 / 1920, 1 / 1080);
  e.camera.aspect = 1920 / 1080;
  e.camera.updateProjectionMatrix();
  e.renderer.shadowMap.needsUpdate = true;
  const nearbyRoofs = [...roofs!.values()].filter((r) => {
    const center = r.ring.reduce(
      (p, v) => [p[0] + v[0] / r.ring.length, p[1] + v[1] / r.ring.length],
      [0, 0],
    );
    return Math.hypot(center[0] - x, center[1] - z) < 90;
  }).length;
  return {
    id,
    expectedPose,
    sourceId: view.sourceId,
    sourceCoord: view.coord,
    sourceRoof: roof.sourceRoof,
    sourceDataset: roof.sourceDataset,
    sourceEpoch: roof.sourceEpoch,
    nearbyRoofsWithin90m: nearbyRoofs,
    note: 'Source-supported type; representative gable pitch and ridge direction. Nearby count is geographic coverage, not an on-screen visibility claim.',
  };
}

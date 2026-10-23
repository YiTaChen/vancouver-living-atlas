/** Native-input checkpoints for local QA builds; never a public travel menu. */
import type { CityEngine } from './engine';
import { project } from './geo';

const checkpoints = [
  {
    id: 'Second Beach',
    coord: [-123.148072951, 49.2924559],
    offset: [18, 12, 24],
  },
  {
    id: 'Georgia entrance',
    coord: [-123.136210413, 49.296737228],
    offset: [28, 18, 30],
  },
  { id: 'Avison', coord: [-123.130145965, 49.300274491], offset: [20, 12, 22] },
  {
    id: 'Lumberman',
    coord: [-123.13579094338603, 49.30685281922547],
    offset: [24, 14, 22],
  },
  {
    id: 'Rawlings dark control',
    coord: [-123.1512853, 49.3087402],
    offset: [18, 12, 24],
  },
  {
    id: 'Beaver Lake dark control',
    coord: [-123.139, 49.3041],
    offset: [60, 55, 80],
  },
  {
    id: 'Siwash shore',
    coord: [-123.1560181124, 49.3087515252],
    offset: [-42, 18, 42],
    targetY: 10,
  },
  {
    id: 'Siwash legacy',
    coord: [-123.15987, 49.30552],
    offset: [42, 18, 42],
    targetY: 10,
  },
] as const;

export function installParkSceneryQA(e: CityEngine, panel: HTMLElement) {
  let selected = checkpoints[0].id as string;
  const report = document.createElement('output');
  report.id = 'park-scenery-qa-report';
  report.setAttribute('aria-label', 'Park scenery QA report');
  report.style.cssText = 'display:block;white-space:pre-wrap;font-size:11px';
  const snapshot = () => {
    report.textContent = JSON.stringify(
      {
        checkpoint: selected,
        hour: e.clock.snapshot().hour,
        quality: e.settings.quality,
        qualityMode: e.settings.qualityMode,
        camera: e.camera.position.toArray(),
        target: e.controls.target.toArray(),
        lighting: e.traffic?.streetLighting.stats(),
        poleInventory: {
          records: e.data.stanleyStreetLamps?.inventoryRecords,
          deduplicated: e.data.stanleyStreetLamps?.inventoryFixtures,
          admitted: e.data.stanleyStreetLamps?.admittedFixtures,
          rejected: e.data.stanleyStreetLamps?.rejectedPoles,
        },
        parkSample: e.traffic?.streetLighting.samplePark(
          e.controls.target.x,
          e.controls.target.z,
        ),
        siwashLevel: (
          e as CityEngine & { siwashRock?: { activeLevel: string } }
        ).siwashRock?.activeLevel,
        render: {
          calls: e.renderer.info.render.calls,
          triangles: e.renderer.info.render.triangles,
        },
        memory: e.renderer.info.memory,
      },
      null,
      2,
    );
  };
  const button = (name: string, action: () => void) => {
    const b = document.createElement('button');
    b.textContent = `Park scenery QA: ${name}`;
    b.style.cssText =
      'padding:7px;margin:3px;border:1px solid #709598;cursor:pointer';
    b.onclick = () => {
      action();
      snapshot();
    };
    panel.appendChild(b);
  };
  for (const point of checkpoints)
    button(point.id, () => {
      selected = point.id;
      e.prepareTravelPlacement();
      e.navigation?.setMode('orbit');
      e.skyEffects.qaTime = null;
      e.applySettings({
        ...e.settings,
        mode: 'orbit',
        labels: false,
        autoRotate: false,
      });
      e.controls.maxPolarAngle = Math.PI * 0.485;
      const [x, z] = project(point.coord);
      const y = 'targetY' in point ? point.targetY : e.elevation(x, z);
      e.camera.position.set(
        x + point.offset[0],
        y + point.offset[1],
        z + point.offset[2],
      );
      e.controls.target.set(x, y, z);
      e.controls.update();
      e.setClock({ hour: 23, running: false });
    });
  for (const hour of [14, 23, 3])
    button(`${hour}:00`, () => e.setClock({ hour, running: false }));
  for (const quality of ['balanced', 'high', 'ultra'] as const)
    button(quality, () =>
      e.applySettings({ ...e.settings, qualityMode: 'manual', quality }),
    );
  button('Auto', () => e.applySettings({ ...e.settings, qualityMode: 'auto' }));
  button('snapshot', snapshot);
  panel.appendChild(report);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { cityModule } from './helpers/city-modules.mjs';

const { STREET_SHOWCASE_SEGMENTS } = await import(
  cityModule('street-quality-profile')
);
const { sampleAtmosphere } = await import(cityModule('atmosphere'));

// Exercise the actual CityEngine method with small host doubles: importing the
// complete browser engine here would otherwise construct a WebGL application.
const engineSource = readFileSync(
  new URL('../lib/city/engine.ts', import.meta.url),
  'utf8',
);
const sourceFile = ts.createSourceFile(
  'engine.ts',
  engineSource,
  ts.ScriptTarget.Latest,
  true,
);
const engineClass = sourceFile.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === 'CityEngine',
);
const method = engineClass?.members.find(
  (node) =>
    ts.isMethodDeclaration(node) &&
    node.name.getText(sourceFile) === 'applyStreetPilotLighting',
);
assert(method, 'engine lighting method must exist');
const subjectSource = ts.transpileModule(
  `import { streetPilotLightingWeight, streetPilotLightingMultipliers, streetPilotNightViewWeight } from '${cityModule('street-pilot-lighting')}'; export class LightingHost { ${method.getText(sourceFile)} }`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const { LightingHost } = await import(
  `data:text/javascript;base64,${Buffer.from(subjectSource).toString('base64')}`
);

test('engine synchronizes a late-created light field and clears pilot bounce across view transitions', () => {
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  const camera = {
    position: { x: (a[0] + b[0]) / 2, y: 2, z: (a[1] + b[1]) / 2 },
  };
  let inside = false;
  const light = {
    weight: 0,
    setPilotNightViewWeight(weight) {
      this.weight = weight;
    },
  };
  const host = Object.assign(new LightingHost(), {
    camera,
    elevation: () => 0,
    cabinDisplayActive: false,
    busVisit: { aboard: false },
    skyTrainTravel: { active: false },
    flight: { attached: false },
    rocket: { active: false },
    tesla: { active: false, state: null },
    settings: { mode: 'walk' },
    interiors: { height: () => (inside ? 0 : undefined) },
    traffic: null,
    pilotLightingCheckedAt: -Infinity,
    pilotLightingWeight: -1,
    pilotBaseLighting: sampleAtmosphere(23),
    sun: { intensity: 0 },
    ambient: { intensity: 0 },
    scene: { environmentIntensity: 0 },
    renderer: { toneMappingExposure: 0 },
  });
  host.applyStreetPilotLighting(100, true);
  host.traffic = { streetLighting: light };
  host.applyStreetPilotLighting(101, true);
  assert.equal(
    light.weight,
    1,
    'a field created after the camera cache is initialized receives the current weight',
  );
  host.busVisit.aboard = true;
  host.applyStreetPilotLighting(102);
  assert.equal(
    light.weight,
    0,
    'entering a bus clears the field without waiting for the 100 ms check',
  );
  host.busVisit.aboard = false;
  host.applyStreetPilotLighting(201);
  assert.equal(
    light.weight,
    1,
    'leaving transit restores the pilot at fixed clock and position',
  );
  host.settings.mode = 'boat';
  host.applyStreetPilotLighting(202);
  assert.equal(light.weight, 0);
  host.applyStreetPilotLighting(301);
  assert.equal(
    light.weight,
    0,
    'the cached atmosphere weight cannot re-enable boat lighting',
  );
  host.settings.mode = 'walk';
  host.applyStreetPilotLighting(401);
  assert.equal(light.weight, 1);
  host.rocket.active = true;
  host.applyStreetPilotLighting(402);
  assert.equal(
    light.weight,
    0,
    'active rocket is excluded even before its mode changes',
  );
  host.rocket.active = false;
  host.applyStreetPilotLighting(501);
  assert.equal(light.weight, 1);
  inside = true;
  host.applyStreetPilotLighting(601);
  assert.equal(light.weight, 0, 'interior check excludes pilot bounce');
  inside = false;
  camera.position.y = 120;
  host.applyStreetPilotLighting(701);
  assert.equal(light.weight, 0, 'high altitude excludes pilot bounce');
  camera.position.y = 2;
  host.applyStreetPilotLighting(801);
  assert.equal(light.weight, 1);
  host.flight.attached = true;
  host.applyStreetPilotLighting(802);
  assert.equal(
    light.weight,
    0,
    'attached aircraft is excluded even before its mode changes',
  );
  host.flight.attached = false;
  host.applyStreetPilotLighting(901);
  host.skyTrainTravel.active = true;
  host.applyStreetPilotLighting(902);
  assert.equal(light.weight, 0);
  host.skyTrainTravel.active = false;
  host.applyStreetPilotLighting(1001);
  host.cabinDisplayActive = true;
  host.applyStreetPilotLighting(1002);
  assert.equal(light.weight, 0);
  host.cabinDisplayActive = false;
  host.applyStreetPilotLighting(1101);
  assert.equal(light.weight, 1);
  camera.position.x += 10000;
  host.applyStreetPilotLighting(1201);
  assert.equal(
    light.weight,
    0,
    'leaving the district restores the original field',
  );
  camera.position.x -= 10000;
  host.settings.mode = 'tesla';
  host.tesla.active = true;
  host.tesla.state = null;
  host.applyStreetPilotLighting(1301);
  assert.equal(
    light.weight,
    1,
    'a Tesla still initializing is not treated as airborne',
  );
  host.tesla.state = { mode: 'ground' };
  host.applyStreetPilotLighting(1401);
  assert.equal(light.weight, 1);
  for (const [index, mode] of ['air', 'wall'].entries()) {
    host.tesla.state.mode = mode;
    host.applyStreetPilotLighting(1402 + index * 100);
    assert.equal(
      light.weight,
      0,
      `Tesla ${mode} is excluded without waiting for the 100 ms check`,
    );
    host.tesla.state.mode = 'ground';
    host.applyStreetPilotLighting(1501 + index * 100);
    assert.equal(light.weight, 1);
  }
});

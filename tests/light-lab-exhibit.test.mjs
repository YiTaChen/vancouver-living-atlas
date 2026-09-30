import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { LightLabExhibit } = await import(cityModule('light-lab-exhibit'));
const { PublicInteriors } = await import(cityModule('interiors'));
import * as THREE from 'three';

test('physical light lab stays on its existing island with one unlit two-triangle display', () => {
  const e = {
    renderer: {},
    landmarks: new THREE.Group(),
    landmarkDetails: [],
    data: {},
    elevation: () => 3,
    camera: new THREE.PerspectiveCamera(),
    settings: { buildings: true, mode: 'walk' },
  };
  const interiors = new PublicInteriors(e),
    site = interiors.sites.find((s) => s.id === 'science');
  const display = site.group.getObjectByName(
    'Atlas original light-mixing exhibit',
  );
  assert(display);
  assert.equal(display.geometry.index.count / 3, 2);
  assert(display.material instanceof THREE.MeshBasicMaterial);
  assert.equal(display.castShadow, false);
  assert.equal(display.receiveShadow, false);
  const ob = site.obstacles.find((o) => o.x === 13 && o.z === -11);
  display.geometry.computeBoundingBox();
  const halfWidth = display.geometry.boundingBox.max.x;
  assert(Math.abs(display.position.x - ob.x) + halfWidth <= ob.w / 2);
  assert(Math.abs(display.position.z - ob.z) <= ob.d / 2);
  const lab = interiors.world(site, 13, -16);
  assert.equal(interiors.clear(...lab, 'walk'), true);
  interiors.setLightLabMix([100, 100, 0]);
  assert.deepEqual(display.userData.lightLevels, [100, 100, 0]);
});

test('display input is bounded and safe without a browser canvas', () => {
  const exhibit = new LightLabExhibit();
  exhibit.setLevels([Infinity, -5, 128]);
  assert.deepEqual(exhibit.screen.userData.lightLevels, [0, 0, 100]);
  exhibit.setLevels([50.4, 25.6, 80]);
  assert.deepEqual(exhibit.screen.userData.lightLevels, [50, 26, 80]);
  const unchanged = exhibit.screen.userData.lightLevels;
  exhibit.setLevels([50, 26, 80]);
  assert.equal(exhibit.screen.userData.lightLevels, unchanged);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
import { cityElevation } from './helpers/city-elevation.mjs';
import {
  WATERFRONT_VIEWPOINTS,
  prepareWaterfrontViewpoint,
  waterfrontThirdPersonSettings,
} from '../tools/station-interiors/capture-waterfront-views.mjs';
const { SkyTrainStationOwner } = await import(cityModule('skytrain-stations'));
const { adaptSkyTrainStationFrame } = await import(
  cityModule('skytrain-ride-path')
);
const { SkyTrainWorldTravel } = await import(
  cityModule('skytrain-world-travel')
);
const { travelLookDirection } = await import(
  cityModule('travel-camera-collision')
);
const routes = JSON.parse(
  fs.readFileSync('public/models/skytrain-routes.json'),
);
for (const openWorld of [false, true])
  test(`all maintained Waterfront capture views have actual body-supported floors; doorway looks northeast, openWorld=${openWorld}`, () => {
    const source = JSON.parse(
        fs.readFileSync('public/models/skytrain-stations/waterfront.json'),
      ),
      data = adaptSkyTrainStationFrame(source, routes),
      // Street navigation may stand above raw terrain on an exterior structure.
      // Its doorway Y must not be reused for an interior camera placement.
      owner = new SkyTrainStationOwner(
        data,
        cityElevation,
        'balanced',
        openWorld,
        (x, z) => cityElevation(x, z) + 0.6,
      );
    try {
      assert(WATERFRONT_VIEWPOINTS.length >= 47);
      const views = WATERFRONT_VIEWPOINTS.map((spec) =>
        prepareWaterfrontViewpoint(spec, owner),
      );
      for (const view of views) {
        assert(
          owner.floorAt(view.foot.position, view.foot.surfaceId),
          `${view.label}: actual floor triangle`,
        );
        assert(
          owner.isClearFoot(view.foot),
          `${view.label}: complete standing body`,
        );
      }
      const entry = data.entrances.find((e) => e.id === 'cordova-lobby'),
        first = views.find(
          (v) =>
            v.label === 'cordova-true-northeast-doorway-into-heritage-nave',
        ),
        look = new THREE.Vector3(Math.sin(first.yaw), 0, Math.cos(first.yaw)),
        inward = new THREE.Vector3(...entry.inwardDirection),
        worldLook = look.clone().applyQuaternion(owner.group.quaternion),
        bearing =
          ((Math.atan2(worldLook.x, -worldLook.z) * 180) / Math.PI + 360) % 360;
      assert(
        look.dot(inward) > 0.999999,
        'first person looks inside through the true doorway',
      );
      assert(
        Math.abs(bearing - 44.555553) < 0.001,
        'OSM outside and indoor approach establish northeast, independently of rail yaw',
      );
      const canada = views.find(
          (v) =>
            v.label === 'heritage-nave-left-northwest-canada-line-direction',
        ),
        towardCanada = new THREE.Vector3(...canada.target)
          .sub(new THREE.Vector3(...canada.foot.position))
          .setY(0)
          .normalize(),
        left = new THREE.Vector3(inward.z, 0, -inward.x);
      assert(
        towardCanada.dot(left) > 0,
        'Canada stairs are left/northwest of the actual entering walker',
      );
      assert(
        views.some(
          (v) => v.label === 'howe-unpaid-mall-side-five-gate-boundary',
        ),
      );
      assert(
        views.some(
          (v) => v.label === 'howe-paid-platform-side-five-gate-boundary',
        ),
      );
      assert.equal(views.filter((v) => v.kind === 'flight').length, 18);
    } finally {
      owner.dispose();
    }
  });

test('maintained Waterfront context views preserve the requested production chase pose, full body and visible hall columns', () => {
  const owner = new SkyTrainStationOwner(
      adaptSkyTrainStationFrame(
        JSON.parse(
          fs.readFileSync('public/models/skytrain-stations/waterfront.json'),
        ),
        routes,
      ),
      cityElevation,
      'balanced',
      true,
    ),
    camera = new THREE.PerspectiveCamera(65, 1.44, 0.05, 2000),
    city = {
      settings: { mode: 'walk' },
      camera,
      controls: { target: new THREE.Vector3() },
      navigation: {
        position: new THREE.Vector3(),
        walker: { group: new THREE.Group() },
      },
      renderer: { domElement: { setAttribute() {} } },
    };
  try {
    for (const spec of WATERFRONT_VIEWPOINTS) {
      const view = prepareWaterfrontViewpoint(spec, owner),
        settings = waterfrontThirdPersonSettings(spec),
        travel = Object.assign(Object.create(SkyTrainWorldTravel.prototype), {
          city,
          owner,
          phase: 'station',
          occupied: null,
          foot: view.foot,
          yaw: view.yaw,
          lookYaw: 0,
          ...settings,
          stationSeat: null,
          cabinSeat: null,
          avatarSeated: false,
        }),
        feet = new THREE.Vector3(...owner.toWorld(view.foot)),
        direction = travelLookDirection(
          view.yaw + owner.yaw,
          -Math.atan(0.28) - THREE.MathUtils.clamp(-settings.pitch, -0.22, 1.1),
        ),
        pivot = feet.clone().add(new THREE.Vector3(0, 1.13, 0)),
        requested = pivot
          .clone()
          .addScaledVector(direction, -settings.distanceView);
      travel.updateCamera();
      camera.updateMatrixWorld(true);
      assert(camera.position.distanceTo(requested) < 1e-7, spec.label);
      assert(city.controls.target.distanceTo(pivot) < 1e-7, spec.label);
      assert.equal(travel.yaw, view.yaw, 'framing cannot rotate the walker');
      for (const height of [0.12, 1.8]) {
        const body = feet
          .clone()
          .add(new THREE.Vector3(0, height, 0))
          .project(camera);
        assert(
          Math.abs(body.x) < 1 &&
            Math.abs(body.y) < 1 &&
            body.z > -1 &&
            body.z < 1,
          `${spec.label}: the complete avatar remains in the actual camera frustum`,
        );
      }
      if (spec.label.startsWith('heritage-nave-')) {
        const columns = owner.geometryData.parts.filter(
            (p) => p.role === 'column',
          ),
          framed = columns.some((p) => {
            const point = new THREE.Vector3(
              ...owner.toWorld([
                p.position[0],
                view.foot.position[1] + 1.4,
                p.position[2],
              ]),
            ).project(camera);
            return (
              Math.abs(point.x) < 0.9 &&
              Math.abs(point.y) < 0.9 &&
              point.z > -1 &&
              point.z < 1
            );
          });
        assert(
          framed,
          `${spec.label}: a real nave column must be inside the context frame`,
        );
      }
    }
    for (const value of [NaN, Infinity, 1, 15])
      assert.throws(() =>
        waterfrontThirdPersonSettings({
          label: 'invalid',
          thirdpersonDistance: value,
        }),
      );
    for (const value of [NaN, Infinity, -1.11, 0.23])
      assert.throws(() =>
        waterfrontThirdPersonSettings({
          label: 'invalid',
          thirdpersonPitch: value,
        }),
      );
  } finally {
    owner.dispose();
  }
});

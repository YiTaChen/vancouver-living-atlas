import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';

const {
  vehicleSurfaceWeight,
  installVehicleSurface,
  installPilotContactShadow,
  pilotContactShadowFalloff,
} = await import(cityModule('assets/vehicle-surface'));
const { STREET_SHOWCASE_SEGMENTS, STREET_SHOWCASE_BOUNDS } = await import(
  cityModule('street-quality-profile')
);
const { makeRoadster } = await import(cityModule('assets/roadster'));
const { makeAircraft, updateAircraftInstruments } = await import(
  cityModule('assets/aircraft-models')
);
const { createRocketModel, disposeRocketObject } = await import(
  cityModule('assets/rocket')
);
const { PedestrianRenderer } = await import(
  cityModule('city-life/pedestrian-renderer')
);

function stats(root) {
  let meshes = 0,
    triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    triangles +=
      (object.geometry.index?.count ??
        object.geometry.attributes.position.count) / 3;
    assert(
      [...object.geometry.attributes.position.array].every(Number.isFinite),
    );
  });
  return { meshes, triangles };
}

function shader(material) {
  const result = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {},
  };
  material.onBeforeCompile(result, {});
  return result;
}

test('mobile assets restore the source look outside the pilot and in high-altitude flight', () => {
  const { a, b } = STREET_SHOWCASE_SEGMENTS[0];
  const x = (a[0] + b[0]) / 2,
    z = (a[1] + b[1]) / 2;
  assert.equal(vehicleSurfaceWeight(x, 30, z), 1);
  assert.equal(vehicleSurfaceWeight(x, 150, z), 1);
  assert.equal(vehicleSurfaceWeight(x, 225, z), 0.5);
  assert.equal(vehicleSurfaceWeight(x, 300, z), 0);
  assert.equal(vehicleSurfaceWeight(x, 100000, z), 0);
  assert.equal(vehicleSurfaceWeight(STREET_SHOWCASE_BOUNDS.maxX + 1, 30, z), 0);
  assert.equal(vehicleSurfaceWeight(NaN, 30, z), 0);
  assert.equal(vehicleSurfaceWeight(x, Infinity, z), 0);
});

test('surface hooks preserve authored values, existing shader behavior and instance-space masking', () => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xd7192d,
    roughness: 0.25,
    metalness: 0.38,
    opacity: 0.26,
  });
  const authored = [
    material.color.getHex(),
    material.roughness,
    material.metalness,
    material.opacity,
  ];
  let earlier = 0;
  material.onBeforeCompile = (s) => {
    earlier++;
    s.vertexShader += '\n// retained earlier wheel/deformation hook';
  };
  material.customProgramCacheKey = () => 'retained-source-shader';
  installVehicleSurface(material, 'roadster-paint');
  const s = shader(material);
  assert.equal(earlier, 1);
  assert.match(s.vertexShader, /retained earlier wheel/);
  assert.match(s.vertexShader, /instanceMatrix\*atlasSurfaceWorld/);
  assert.match(s.vertexShader, /modelMatrix\*atlasSurfaceWorld/);
  assert.match(
    s.fragmentShader,
    /atlasStreetShowcaseWeight\(vAtlasSurfaceWorld.xz\)/,
  );
  assert.match(s.fragmentShader, /atlasRoadsterPanel/);
  assert.match(s.fragmentShader, /fwidth\(distanceM\)/);
  assert.match(s.fragmentShader, /if\(atlasSurfaceWeight>0.\)/);
  const panelEvaluation = s.fragmentShader.indexOf(
    '=atlasRoadsterPanel(vAtlasSurfaceLocal,vAtlasSurfaceNormal)',
  );
  const pilotBranch = s.fragmentShader.indexOf('if(atlasSurfaceWeight>0.)');
  assert(
    panelEvaluation >= 0 && panelEvaluation < pilotBranch,
    'evaluate seam derivatives before the spatially varying branch so boundary pixel quads have defined derivatives',
  );
  assert.match(material.customProgramCacheKey(), /^retained-source-shader\//);
  assert.deepEqual(
    [
      material.color.getHex(),
      material.roughness,
      material.metalness,
      material.opacity,
    ],
    authored,
  );
  assert.equal(material.map, null);
  assert.equal(material.normalMap, null);
  material.dispose();
});

test('pilot contact shadow softens the existing plane without changing outside alpha or material ownership', () => {
  const material = new THREE.MeshBasicMaterial({
    color: 0x15272c,
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.9), material);
  const geometry = plane.geometry;
  const authored = [
    material.color.getHex(),
    material.opacity,
    material.transparent,
    material.depthWrite,
  ];
  let previousCalls = 0;
  material.onBeforeCompile = function (s) {
    assert.strictEqual(this, material);
    previousCalls++;
    s.fragmentShader += '\n// retained contact hook';
  };
  material.customProgramCacheKey = function () {
    assert.strictEqual(this, material);
    return 'source-contact-shadow';
  };
  installPilotContactShadow(material);
  const s = {
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    uniforms: {},
  };
  material.onBeforeCompile(s, {});
  assert.equal(previousCalls, 1);
  assert.match(s.fragmentShader, /retained contact hook/);
  assert.match(material.customProgramCacheKey(), /^source-contact-shadow\//);
  assert.match(s.vertexShader, /vAtlasContactUv=uv/);
  assert.match(s.vertexShader, /instanceMatrix\*atlasContactWorld/);
  assert.match(s.vertexShader, /modelMatrix\*atlasContactWorld/);
  assert.match(
    s.fragmentShader,
    /atlasStreetShowcaseWeight\(vAtlasContactWorld.xz\)/,
  );
  assert.match(
    s.fragmentShader,
    /if\(atlasContactWeight>0.\)[\s\S]*diffuseColor.a=mix\(diffuseColor.a,diffuseColor.a\*contactFalloff,atlasContactWeight\)/,
  );
  assert.deepEqual(
    [
      material.color.getHex(),
      material.opacity,
      material.transparent,
      material.depthWrite,
    ],
    authored,
  );
  assert.strictEqual(plane.geometry, geometry);
  assert.deepEqual(stats(plane), { meshes: 1, triangles: 2 });
  assert.equal(material.map, null);
  assert.equal(material.alphaMap, null);
  assert.equal(pilotContactShadowFalloff(0.5, 0.5), 1.2);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    for (const [u, v] of [
      [t, 0],
      [t, 1],
      [0, t],
      [1, t],
    ])
      assert.equal(
        pilotContactShadowFalloff(u, v),
        0,
        'all plane borders fade to zero',
      );
    assert(
      Math.abs(
        pilotContactShadowFalloff(t, 0.37) -
          pilotContactShadowFalloff(1 - t, 0.63),
      ) < 1e-12,
    );
  }
  assert(pilotContactShadowFalloff(0.9, 0.5) > 0);
  assert(pilotContactShadowFalloff(0.9, 0.5) < 1.2);
  assert.equal(pilotContactShadowFalloff(NaN, 0.5), 0);
  material.dispose();
  geometry.dispose();
});

test('roadster surface finishing adds no geometry, meshes, textures or wheel controls', () => {
  const asset = makeRoadster();
  assert.deepEqual(stats(asset.group), { meshes: 19, triangles: 14662 });
  const paint = asset.group.getObjectByName('roadster/paint').material;
  const glass = asset.group.getObjectByName('roadster/glass').material;
  assert.equal(paint.color.getHex(), 0xd7192d);
  assert.equal(paint.roughness, 0.25);
  assert.equal(paint.metalness, 0.38);
  assert.equal(glass.transparent, true);
  assert.equal(glass.opacity, 0.26);
  assert.equal(glass.depthWrite, false);
  assert.match(shader(glass).fragmentShader, /diffuseColor.a=mix/);
  const wheels = asset.group.children.filter(
    (part) => 'front' in part.userData,
  );
  asset.update(3.5, -0.5);
  assert.equal(wheels.length, 4);
  assert(
    wheels
      .filter((part) => part.userData.front)
      .every((part) => part.rotation.y < 0),
  );
  assert(
    wheels.every((part) => Math.abs(part.children[0].rotation.x - 10) < 1e-8),
  );
});

test('aircraft retain geometry and instruments while encoding surface roles in two normalized bytes', () => {
  for (const [kind, exterior, cockpit] of [
    [
      'seaplane',
      { meshes: 4, triangles: 6720 },
      { meshes: 11, triangles: 5298 },
    ],
    [
      'helicopter',
      { meshes: 6, triangles: 7312 },
      { meshes: 11, triangles: 4674 },
    ],
  ]) {
    const asset = makeAircraft(kind);
    const geometries = new Set(),
      materials = new Set();
    const disposed = new Map();
    try {
      assert.deepEqual(stats(asset.group), exterior);
      assert.deepEqual(stats(asset.cockpit), cockpit);
      const finishes = new Set();
      for (const root of [asset.group, asset.cockpit])
        root.traverse((part) => {
          if (!(part instanceof THREE.Mesh)) return;
          geometries.add(part.geometry);
          materials.add(part.material);
          if (part.material.userData.streetSurface?.role !== 'aircraft-batch')
            return;
          const attr = part.geometry.getAttribute('assetSurface');
          assert(attr.array instanceof Uint8Array);
          assert.equal(attr.itemSize, 2);
          assert.equal(attr.normalized, true);
          assert.equal(
            attr.count,
            part.geometry.getAttribute('position').count,
          );
          for (let i = 0; i < attr.count; i++) {
            assert(attr.getX(i) >= 0 && attr.getX(i) <= 1);
            assert(attr.getY(i) >= 0 && attr.getY(i) <= 1);
            finishes.add(`${attr.getX(i)},${attr.getY(i)}`);
          }
          assert.match(
            shader(part.material).vertexShader,
            /vAtlasAssetSurface=assetSurface/,
          );
        });
      assert(
        finishes.size >= 4,
        'enamel, metal, rubber and interior retain distinct finishes within shared draws',
      );
      for (const propeller of asset.propellers)
        assert(['x', 'y', 'z'].includes(propeller.userData.spinAxis));
      updateAircraftInstruments(asset.instruments, {
        airspeedKnots: 95,
        altitudeMetres: 120,
        verticalSpeedMetresPerSecond: 4,
        pitch: 0.1,
        roll: -0.2,
        heading: 0.3,
        power: 0.7,
      });
      for (const instrument of Object.values(asset.instruments))
        assert(
          [
            ...instrument.quaternion.toArray(),
            ...instrument.position.toArray(),
          ].every(Number.isFinite),
        );
      for (const resource of [...geometries, ...materials])
        resource.addEventListener('dispose', () =>
          disposed.set(resource, (disposed.get(resource) ?? 0) + 1),
        );
    } finally {
      asset.dispose();
    }
    assert(
      [...geometries, ...materials].every(
        (resource) => disposed.get(resource) === 1,
      ),
    );
  }
});

test('rocket material finishing preserves original geometry, stage ownership and authored colours', () => {
  for (const [kind, expected] of [
    ['small', { meshes: 35, triangles: 6600 }],
    ['large', { meshes: 55, triangles: 8616 }],
    ['super-heavy', { meshes: 116, triangles: 26084 }],
  ]) {
    const model = createRocketModel(kind);
    try {
      assert.deepEqual(stats(model.group), expected);
      const surfaces = new Set();
      model.group.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        if (part.material.userData.streetSurface) surfaces.add(part.material);
      });
      assert(surfaces.size >= 4);
      const roles = new Set(
        [...surfaces].map((m) => m.userData.streetSurface.role),
      );
      assert(roles.has('rocket-paint'));
      assert(roles.has('rocket-black'));
      assert(roles.has('glazing'));
      if (kind === 'super-heavy') assert(roles.has('rocket-metal'));
      for (const material of surfaces) {
        const before = material.color.clone();
        shader(material);
        assert(material.color.equals(before));
        assert.equal(material.userData.streetSurface.sourceOutsidePilot, true);
      }
      assert.equal(model.segments.length, 6);
      assert(model.booster.children.includes(model.segments[0]));
      assert(model.upper.children.includes(model.segments[5]));
    } finally {
      disposeRocketObject(model.group);
    }
  }
});

test('crowd retains its single shared opaque material and exact animation shader', () => {
  const crowd = new PedestrianRenderer();
  try {
    const material = crowd.group.children[0].material;
    const s = shader(material);
    assert.equal(material.roughness, 0.88);
    assert.equal(material.metalness, 0);
    assert.equal(material.transparent, false);
    assert.equal(new Set(crowd.group.children.map((m) => m.material)).size, 1);
    assert.match(s.vertexShader, /pedestrianRigidLimb\(transformed,/);
    assert.match(s.vertexShader, /vAtlasSurfacePalette=_palette/);
    assert.equal(
      (s.vertexShader.match(/attribute float _palette;/g) ?? []).length,
      1,
    );
    assert.match(s.fragmentShader, /atlasStreetShowcaseWeight/);
  } finally {
    crowd.dispose();
  }
});

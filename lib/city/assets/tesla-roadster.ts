import * as THREE from 'three';
import {
  TESLA_ROADSTER_ANCHORS,
  TESLA_ROADSTER_DIMENSIONS,
  TESLA_ROADSTER_THRUSTERS,
  type TeslaModelQuality,
  type TeslaRoadsterModel,
  type TeslaRoadsterVisualState,
} from './tesla-roadster-contract';
import {
  buildTeslaRoadsterLevel,
  type TeslaGeometryLevel,
  type TeslaMaterials,
} from './tesla-roadster-geometry';

export * from './tesla-roadster-contract';

export const TESLA_ROADSTER_PROVENANCE = Object.freeze({
  model:
    'Original Blender-authored October 2026 Tesla Roadster Rocket, derived into three batched city LODs',
  author: 'Vancouver Living Atlas by YiTaChen',
  source: 'https://github.com/YiTaChen/vancouver-living-atlas',
  license: 'Vancouver Living Atlas Noncommercial Research and Attribution 1.0',
  referenceDate: '2026-10-22',
  references: ['https://www.tesla.com/roadster?redirect=no'],
  limitations: [
    'Not Tesla CAD; dimensions, unseen surfaces and mechanical packaging are modelling estimates.',
    'Single driver seat follows Rocket. Passenger-side vessel packaging is an explicit artist inference from the public two-seat cabin.',
    'Four rear fan cells and eight observed donor nozzles are separate systems. Two illustrative front yaw ports preserve the existing ten-port gameplay effect.',
    'No Tesla image, texture or third-party model is distributed by this source.',
  ],
});

function createMaterials(): TeslaMaterials {
  const materials: TeslaMaterials = {
    paint: new THREE.MeshStandardMaterial({
      color: 0xf2f2ee,
      metalness: 0.24,
      roughness: 0.24,
    }),
    // Slight tonal separation approximates the different facet reflection seen
    // in the reference studio images without an expensive reflection capture.
    hood: new THREE.MeshStandardMaterial({
      color: 0xd5d7d8,
      metalness: 0.3,
      roughness: 0.25,
    }),
    carbon: new THREE.MeshStandardMaterial({
      color: 0x111719,
      metalness: 0.24,
      roughness: 0.47,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x111214,
      roughness: 0.94,
    }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.7 }),
    suede: new THREE.MeshStandardMaterial({ color: 0x62666a, roughness: 0.99 }),
    titanium: new THREE.MeshStandardMaterial({
      color: 0x9b9a90,
      metalness: 0.82,
      roughness: 0.31,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x51402b,
      metalness: 0.22,
      roughness: 0.16,
      transparent: true,
      opacity: 0.97,
      // Near-opaque outward glazing reads as a closed smoked-copper canopy.
      // Backface culling keeps the driver's outward view clear. The removable
      // glass roof shares this single outward layer, without a second pass.
      side: THREE.FrontSide,
      depthWrite: false,
      forceSinglePass: true,
    }),
    headlight: new THREE.MeshBasicMaterial({
      color: 0xdbf1ff,
      toneMapped: false,
    }),
    tail: new THREE.MeshBasicMaterial({ color: 0xd6261e, toneMapped: false }),
    display: new THREE.MeshStandardMaterial({
      color: 0x10181c,
      emissive: 0x15303c,
      emissiveIntensity: 0.35,
      roughness: 0.35,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x952f22,
      emissive: 0xa92b1d,
      emissiveIntensity: 0.2,
      roughness: 0.6,
    }),
  };
  for (const [role, material] of Object.entries(materials)) {
    material.name = `Tesla 2026:${role}`;
    material.userData.semantic_role = role;
    if (
      role !== 'glass' &&
      (material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshBasicMaterial)
    ) {
      // Donor colors are absolute linear vertex RGB, shared across each role.
      material.color.set(0xffffff);
      material.vertexColors = true;
    }
  }
  return materials;
}

const finite = (value: number | undefined, fallback = 0) =>
  Number.isFinite(value) ? value! : fallback;
const normalized = (value: number | undefined) =>
  THREE.MathUtils.clamp(finite(value), 0, 1);
const angle = (value: number | undefined) => finite(value) % (Math.PI * 2);

/**
 * One selected car. Each of three source-authored geometry tiers is built at most
 * once. Materials and the bounded cold-gas effect are shared by all cached tiers.
 */
export function createTeslaRoadster(
  options: { quality?: TeslaModelQuality } = {},
): TeslaRoadsterModel {
  const group = new THREE.Group(),
    materials = createMaterials(),
    tailDayColor = (materials.tail as THREE.MeshBasicMaterial).color.clone(),
    levels = new Map<TeslaModelQuality, TeslaGeometryLevel>(),
    jetsMaterial = new THREE.MeshBasicMaterial({
      color: 0xe5eef1,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      forceSinglePass: true,
    }),
    jets = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.015, 0.8, 8, 1, true),
      jetsMaterial,
      TESLA_ROADSTER_THRUSTERS.length,
    ),
    transform = new THREE.Object3D(),
    up = new THREE.Vector3(0, 1, 0),
    direction = new THREE.Vector3(),
    ports = TESLA_ROADSTER_THRUSTERS.map((port) => ({
      kind: port.kind,
      point: port.position.map(
        (value, axis) => value + port.direction[axis] * 0.07,
      ) as [number, number, number],
      direction: port.direction,
    }));
  let quality: TeslaModelQuality = options.quality ?? 'medium',
    current: TeslaGeometryLevel,
    disposed = false,
    steering = 0,
    spin = 0,
    fanSpin = 0,
    thrust = 0,
    vortexThrust = 0,
    wing = 0,
    brake = 0,
    night = false,
    doorsOpen = 0,
    roofLift = 0;
  group.name = 'Tesla Roadster Rocket 2026';
  group.userData.provenance = TESLA_ROADSTER_PROVENANCE;
  group.userData.modelConvention =
    '+Y up, +Z forward, +X driver left, tyre contact Y=0';
  group.userData.dimensionsEstimated = true;
  jets.name = 'bounded-cold-gas-jets';
  jets.userData.excludeFromSSAO = true;
  jets.count = ports.length;
  jets.visible = false;
  jets.frustumCulled = false;
  jets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(jets);

  function applyPose() {
    current.steering.rotation.z = -steering * 2.6;
    for (const wheel of current.wheelSteers) wheel.rotation.y = steering;
    for (const wheel of current.wheelRolls) wheel.rotation.x = spin;
    for (let i = 0; i < current.fans.length; i++)
      current.fans[i].rotation.z = fanSpin * (i % 2 === 0 ? 1 : -1);
    current.wing.rotation.x = -wing * 0.28;
    current.wing.position.y = current.wingNeutralY + wing * 0.24;
    for (const door of current.doors)
      door.object.quaternion.setFromAxisAngle(
        door.axis,
        doorsOpen * Math.PI * 0.4,
      );
    current.roof.position.y = current.roofNeutralY + roofLift;
  }

  function setQuality(next: TeslaModelQuality) {
    if (disposed) return;
    if (!['low', 'medium', 'high'].includes(next))
      throw new RangeError('Unknown Tesla model quality');
    if (current && next === quality) return;
    let level = levels.get(next);
    if (!level) {
      level = buildTeslaRoadsterLevel(next, materials);
      levels.set(next, level);
      group.add(level.root);
    }
    if (current) current.root.visible = false;
    quality = next;
    current = level;
    current.root.visible = true;
    applyPose();
  }
  // Assign through the same path used for later tier changes.
  setQuality(quality);

  return {
    group,
    anchors: TESLA_ROADSTER_ANCHORS,
    dimensions: TESLA_ROADSTER_DIMENSIONS,
    setQuality,
    update(state: TeslaRoadsterVisualState) {
      if (disposed) return;
      steering = THREE.MathUtils.clamp(
        finite(state.steeringRad, steering),
        -0.62,
        0.62,
      );
      spin =
        state.wheelSpinRad === undefined ? spin : angle(state.wheelSpinRad);
      fanSpin =
        state.fanSpinRad === undefined ? fanSpin : angle(state.fanSpinRad);
      wing =
        state.wingDeploy === undefined ? wing : normalized(state.wingDeploy);
      doorsOpen =
        state.doorsOpen === undefined ? doorsOpen : normalized(state.doorsOpen);
      roofLift =
        state.roofLift === undefined
          ? roofLift
          : THREE.MathUtils.clamp(finite(state.roofLift), 0, 1.5);
      applyPose();
      const nextThrust =
        state.thrust === undefined ? thrust : normalized(state.thrust);
      const nextVortex =
        state.vortexThrust === undefined
          ? vortexThrust
          : normalized(state.vortexThrust);
      if (nextThrust !== thrust || nextVortex !== vortexThrust) {
        thrust = nextThrust;
        vortexThrust = nextVortex;
        jets.visible = Math.max(thrust, vortexThrust) > 0.002;
        jetsMaterial.opacity =
          0.08 + Math.max(thrust, vortexThrust) * 0.11 + vortexThrust * 0.04;
        for (let i = 0; i < ports.length; i++) {
          const port = ports[i];
          const pulse = Math.max(
            thrust,
            vortexThrust *
              (port.kind === 'lift' ? 1.4 : port.kind === 'rear' ? 1.15 : 0.35),
          );
          direction.fromArray(port.direction);
          transform.quaternion.setFromUnitVectors(up, direction);
          transform.position
            .fromArray(port.point)
            .addScaledVector(direction, 0.4 * pulse);
          transform.scale.set(
            0.55 + Math.min(1, pulse) * 0.45,
            Math.max(0.001, pulse),
            0.55 + Math.min(1, pulse) * 0.45,
          );
          transform.updateMatrix();
          jets.setMatrixAt(i, transform.matrix);
        }
        jets.instanceMatrix.needsUpdate = true;
      }
      const nextBrake =
          state.brake === undefined ? brake : normalized(state.brake),
        nextNight = state.night ?? night;
      if (nextBrake !== brake || nextNight !== night) {
        brake = nextBrake;
        night = nextNight;
        (materials.tail as THREE.MeshBasicMaterial).color
          .copy(tailDayColor)
          .multiplyScalar(1 + brake * 0.8 + (night ? 0.15 : 0));
        (materials.accent as THREE.MeshStandardMaterial).emissiveIntensity =
          night ? 0.8 : 0.2;
        (materials.display as THREE.MeshStandardMaterial).emissiveIntensity =
          night ? 0.65 : 0.35;
      }
    },
    stats() {
      return {
        quality,
        triangles: disposed
          ? 0
          : current.triangles + (jets.visible ? 16 * jets.count : 0),
        meshes: disposed ? 0 : current.meshes + (jets.visible ? 1 : 0),
        materials: disposed ? 0 : Object.keys(materials).length + 1,
        cachedLevels: levels.size,
        disposed,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const geometries = new Set<THREE.BufferGeometry>();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      geometries.forEach((geometry) => geometry.dispose());
      Object.values(materials).forEach((material) => material.dispose());
      jetsMaterial.dispose();
      jets.dispose();
      levels.clear();
      group.removeFromParent();
      group.clear();
    },
  };
}

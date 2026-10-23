import * as THREE from 'three';
import {
  ROCKET_CONFIGS,
  rocketDirection,
  type RocketKind,
  type RocketState,
} from '../rocket-state';
import { RocketWreckageVisual } from './rocket-wreckage';
import { rocketExhaustGeometry, rocketExhaustMaterial } from './rocket-exhaust';
import {
  addRocketDesign,
  createTitanStrapOns,
  TITAN_SHIELD_AZIMUTH,
} from './rocket-design';

/** Original reusable meshes. Dimensions are authored gameplay dimensions, not a real vehicle blueprint. */
export function createRocketModel(kind: RocketKind) {
  const large = kind === 'large',
    titan = kind === 'super-heavy',
    config = ROCKET_CONFIGS[kind],
    { height: h, radius: r } = config;
  const group = new THREE.Group(),
    segments: THREE.Group[] = [];
  const booster = new THREE.Group(),
    upper = new THREE.Group();
  booster.name = 'First stage — separable booster';
  upper.name = 'Second stage — observation vehicle';
  group.add(booster, upper);
  group.name = `${kind} ${titan ? 'Titan' : 'Atlas'} research rocket`;
  group.userData.rocketKind = kind;
  const white = new THREE.MeshStandardMaterial({
    color: 0xe8eced,
    metalness: 0.48,
    roughness: 0.29,
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x16242e,
    metalness: 0.65,
    roughness: 0.34,
  });
  const orange = new THREE.MeshStandardMaterial({
    color: 0xe98236,
    metalness: 0.35,
    roughness: 0.4,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x63bfd8,
    emissive: 0x0b354a,
    metalness: 0.72,
    roughness: 0.15,
  });
  const steelColor = titan ? 0xd8e2e7 : 0xaabcc5;
  const steel = new THREE.MeshStandardMaterial({
    color: steelColor,
    metalness: titan ? 0.28 : 0.76,
    roughness: titan ? 0.42 : 0.34,
  });
  const heatShield = new THREE.MeshStandardMaterial({
    color: 0x53646b,
    metalness: 0.05,
    roughness: 0.88,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  function part(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    y: number,
    parent: THREE.Object3D,
  ) {
    const m = new THREE.Mesh(geometry, material);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    segments.push(g);
    (i < 3 ? booster : upper).add(g);
    part(
      new THREE.CylinderGeometry(r, r, h * 0.14, 32),
      titan ? steel : large && i < 3 ? orange : i === 2 ? black : white,
      h * (0.11 + i * 0.14),
      g,
    );
    for (const y of [h * (0.04 + i * 0.14), h * (0.175 + i * 0.14)])
      part(
        new THREE.TorusGeometry(r * 1.005, r * 0.035, 6, 32),
        titan ? black : orange,
        y,
        g,
      ).rotation.x = Math.PI / 2;
  }
  const top = new THREE.Group();
  upper.add(top);
  segments.push(top);
  if (titan) {
    const profile = [
      [r, 0.74 * h],
      [r, 0.82 * h],
      [r * 0.86, 0.89 * h],
      [r * 0.55, 0.95 * h],
      [r * 0.16, 0.99 * h],
      [0, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    part(new THREE.LatheGeometry(profile, 40), steel, 0, top).name =
      'Titan ogive nose';
    part(
      new THREE.LatheGeometry(
        profile.map((p) => new THREE.Vector2(p.x * 1.009, p.y)),
        32,
        TITAN_SHIELD_AZIMUTH,
        Math.PI,
      ),
      heatShield,
      0,
      top,
    ).name = 'Titan nose heat shield';
  } else {
    part(
      new THREE.CylinderGeometry(r * (large ? 1.18 : 0.72), r, h * 0.1, 32),
      white,
      h * 0.79,
      top,
    );
    part(
      new THREE.ConeGeometry(r * (large ? 1.18 : 0.72), h * 0.16, 32),
      white,
      h * 0.92,
      top,
    );
  }
  const window = part(
    new THREE.SphereGeometry(r * 0.28, 16, 10),
    glass,
    h * 0.83,
    top,
  );
  window.position.z = r * (titan ? 1.015 : large ? 1.16 : 0.73);
  window.scale.z = 0.18;
  const engineCount = titan ? 19 : large ? 7 : 1;
  for (let i = 0; i < engineCount; i++) {
    const a = titan && i > 6 ? ((i - 7) * Math.PI) / 6 : (i * Math.PI) / 3,
      engine = part(
        new THREE.CylinderGeometry(
          r * (titan ? 0.09 : 0.19),
          r * (titan ? 0.16 : 0.31),
          h * 0.042,
          16,
          1,
          true,
        ),
        black,
        h * 0.025,
        segments[0],
      );
    engine.name = `${config.label} main engine ${i + 1}`;
    if (i)
      engine.position.set(
        Math.cos(a) * r * (titan ? (i > 6 ? 0.71 : 0.36) : 0.59),
        h * 0.025,
        Math.sin(a) * r * (titan ? (i > 6 ? 0.71 : 0.36) : 0.59),
      );
  }
  const collisionSegments = addRocketDesign(kind, h, r, segments, {
    white,
    black,
    orange,
    steel,
    heatShield,
  });
  const strapDesign = titan
    ? createTitanStrapOns(h, r, { white, black, steel, orange })
    : null;
  const strapOns = strapDesign?.groups ?? [],
    strapOrigins = strapOns.map((booster) => booster.position.clone());
  strapOns.forEach((booster) => group.add(booster));
  if (strapDesign) collisionSegments.push(...strapDesign.collision);
  const upperEngine = new THREE.Group();
  upperEngine.name = 'Upper-stage vacuum engine';
  upper.add(upperEngine);
  part(
    new THREE.CylinderGeometry(r * 0.28, r * 0.65, h * 0.055, 24, 1, true),
    black,
    h * 0.445,
    upperEngine,
  );
  part(
    new THREE.SphereGeometry(r * 0.94, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    black,
    h * 0.462,
    upperEngine,
  ).scale.y = 0.3;
  upperEngine.visible = false;
  const separationMaterial = new THREE.MeshBasicMaterial({
    color: 0xc5eaff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const separationFlash = new THREE.Mesh(
    new THREE.TorusGeometry(r * 1.04, r * 0.12, 6, 32),
    separationMaterial,
  );
  separationFlash.rotation.x = Math.PI / 2;
  separationFlash.position.y = h * 0.46;
  separationFlash.visible = false;
  group.add(separationFlash);
  const flameMat = titan
    ? rocketExhaustMaterial()
    : new THREE.MeshBasicMaterial({
        color: 0xffc865,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
  const jetMaterial = flameMat,
    jetCoreMaterial = titan ? rocketExhaustMaterial(true) : null,
    mainJetLength = h * (titan ? 0.7 : 0.65),
    strapJetLength = h * 0.5;
  const flame = new THREE.Mesh(
    titan
      ? rocketExhaustGeometry(r * 0.85, mainJetLength)
      : new THREE.ConeGeometry(r * 0.85, mainJetLength, 20, 1, true),
    jetMaterial,
  );
  flame.rotation.z = Math.PI;
  flame.position.y = -h * 0.3;
  flame.visible = false;
  group.add(flame);
  const core = new THREE.Mesh(
    titan
      ? rocketExhaustGeometry(r * 0.4, mainJetLength * 0.72, true)
      : new THREE.ConeGeometry(r * 0.4, h * 0.38, 16),
    jetCoreMaterial ??
      new THREE.MeshBasicMaterial({
        color: 0xd6edff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
  );
  flame.add(core);
  core.position.y = titan ? -mainJetLength * 0.14 : -h * 0.11;
  flame.frustumCulled = core.frustumCulled = false;
  const sidePlumes: THREE.Mesh[] = [];
  if (large)
    for (const side of [-1, 1]) {
      const plume = new THREE.Mesh(
        new THREE.ConeGeometry(r * 0.5, h * 0.4, 16, 1, true),
        flameMat,
      );
      plume.name = 'Atlas side booster exhaust';
      plume.rotation.z = Math.PI;
      plume.position.set(side * r * 2.05, -h * 0.18, 0);
      plume.visible = false;
      group.add(plume);
      sidePlumes.push(plume);
    }
  const strapPlumes = strapOns.map((booster, i) => {
    const plume = new THREE.Mesh(
      rocketExhaustGeometry(r * 0.36, strapJetLength),
      jetMaterial,
    );
    plume.name = `Titan external booster exhaust ${i + 1}`;
    plume.rotation.z = Math.PI;
    plume.position.y = -h * 0.155;
    plume.visible = false;
    const brightCore = new THREE.Mesh(
      rocketExhaustGeometry(r * 0.18, strapJetLength * 0.72, true),
      core.material,
    );
    brightCore.name = 'Titan external exhaust bright core';
    brightCore.position.y = -strapJetLength * 0.14;
    plume.frustumCulled = brightCore.frustumCulled = false;
    plume.add(brightCore);
    booster.add(plume);
    return plume;
  });
  const light = new THREE.PointLight(
    0xffa345,
    0,
    config.blastRadius * 1.85,
    1.5,
  );
  light.position.y = 1;
  group.add(light);
  const wreckage = new RocketWreckageVisual(
    kind,
    group,
    segments,
    upperEngine,
    strapOns,
  );
  // Attached to real shell sections, so onboard fire survives breakup and the
  // floating-origin space handoff without rendering ground trees through Earth.
  const fireMaterial = new THREE.MeshBasicMaterial({
    color: 0xffa127,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const bodyFlames = segments.map((segment, i) => {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.7, h * 0.16, 7),
      fireMaterial,
    );
    mesh.name = 'Attached onboard fire';
    const angle = i * 2.399;
    mesh.position.set(
      Math.sin(angle) * r,
      h * (i < 5 ? 0.14 + i * 0.14 : 0.85),
      Math.cos(angle) * r,
    );
    mesh.rotation.z = 0.2 * Math.sin(angle);
    mesh.visible = false;
    segment.add(mesh);
    return mesh;
  });
  strapOns.forEach((booster, i) => {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(r * 0.55, h * 0.12, 7),
      fireMaterial,
    );
    mesh.name = 'Attached external booster fire';
    mesh.userData.strapOn = true;
    mesh.position.set(
      Math.cos((i * Math.PI) / 2) * r * 0.44,
      h * 0.27,
      Math.sin((i * Math.PI) / 2) * r * 0.44,
    );
    mesh.visible = false;
    booster.add(mesh);
    bodyFlames.push(mesh);
  });
  const blastMaterial = new THREE.MeshBasicMaterial({
    color: 0xffba56,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 12),
    blastMaterial,
  );
  blast.name = 'Rocket propellant explosion flash';
  blast.visible = false;
  group.add(blast);
  const scorch = new THREE.Color(0x55483e);
  const inverse = new THREE.Quaternion();
  let activeStage: RocketState['stage'] | null = null,
    strapsAttached = titan;
  return {
    group,
    segments,
    flame,
    light,
    booster,
    upper,
    strapOns,
    strapPlumes,
    height: h,
    radius: r,
    collisionSegments,
    damage(state: RocketState, surface: (x: number, z: number) => number) {
      white.color.set(0xe8eced).lerp(scorch, state.fireDamage * 0.8);
      steel.color.set(steelColor).lerp(scorch, state.fireDamage * 0.8);
      orange.color.set(0xe98236).lerp(scorch, state.fireDamage * 0.65);
      white.emissive.setRGB(
        state.fireIntensity * 0.16,
        state.fireIntensity * 0.018,
        0,
      );
      const center = wreckage.update(state, surface);
      fireMaterial.opacity = state.fireIntensity * 0.85;
      bodyFlames.forEach((mesh, i) => {
        mesh.visible =
          state.fireIntensity > 0.025 &&
          (mesh.userData.strapOn
            ? state.strapAttached
            : state.boosterAttached || i >= 3);
        mesh.scale.set(
          0.7 + 0.2 * Math.sin(state.elapsed * 19 + i),
          0.65 +
            state.fireIntensity * 0.7 +
            0.25 * Math.sin(state.elapsed * 27 + i),
          0.8,
        );
      });
      blast.visible = false;
      if (
        state.wreckage?.explosionTime !== null &&
        state.wreckage?.explosionTime !== undefined
      ) {
        const flashAge = state.elapsed - state.wreckage.explosionTime;
        light.intensity = Math.max(
          light.intensity,
          Math.max(0, 1 - flashAge / 0.7) * (titan ? 480 : large ? 240 : 80),
        );
        blast.visible = flashAge >= 0 && flashAge < 1.15;
        blastMaterial.opacity = Math.max(0, (1 - flashAge / 1.15) * 0.72);
        blastMaterial.color.set(flashAge < 0.12 ? 0xffefc4 : 0xff862f);
        blast.scale.setScalar(r * (2.5 + Math.max(0, flashAge) * 8));
        if (center)
          blast.position
            .copy(center)
            .sub(
              new THREE.Vector3(
                state.position.x,
                state.position.y,
                state.position.z,
              ),
            )
            .applyQuaternion(inverse.copy(group.quaternion).invert());
      }
      return center;
    },
    build(progress: number) {
      segments.forEach((g, i) => {
        const t = THREE.MathUtils.clamp(progress * segments.length - i, 0, 1);
        g.visible = t > 0;
        g.scale.y = Math.max(0.001, t);
      });
      strapOns.forEach((booster, i) => {
        const t = THREE.MathUtils.clamp(progress * 1.5 - 0.1 - i * 0.08, 0, 1);
        booster.visible = t > 0;
        booster.scale.y = Math.max(0.001, t);
      });
    },
    /** The detached booster preserves separation momentum and tumbles about its own centre. */
    stage(state: RocketState) {
      activeStage = state.stage;
      strapsAttached = state.strapAttached;
      const straps = state.strapSeparation;
      strapOns.forEach((booster, i) => {
        if (!straps) return;
        const t = Math.max(0, state.elapsed - straps.time);
        booster.visible = t < 28;
        const direction = rocketDirection(straps.attitude),
          initial = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(direction.x, direction.y, direction.z),
          ),
          angle = (i * Math.PI) / 2,
          rotation = initial
            .clone()
            .multiply(
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  Math.cos(angle) * t * 0.1,
                  t * 0.035,
                  -Math.sin(angle) * t * 0.1,
                ),
              ),
            ),
          center = new THREE.Vector3(0, h * 0.3, 0),
          origin = strapOrigins[i]
            .clone()
            .add(center)
            .applyQuaternion(initial)
            .add(
              new THREE.Vector3(
                straps.position.x,
                straps.position.y,
                straps.position.z,
              ),
            );
        const outward = new THREE.Vector3(
          Math.cos(angle),
          0,
          Math.sin(angle),
        ).applyQuaternion(initial);
        origin
          .addScaledVector(
            new THREE.Vector3(
              straps.velocity.x,
              straps.velocity.y,
              straps.velocity.z,
            ),
            t,
          )
          .addScaledVector(outward, 7 * t);
        origin.y -= 4.905 * t * t;
        origin.sub(center.applyQuaternion(rotation));
        const inverse = group.quaternion.clone().invert();
        booster.position
          .copy(origin)
          .sub(
            new THREE.Vector3(
              state.position.x,
              state.position.y,
              state.position.z,
            ),
          )
          .applyQuaternion(inverse);
        booster.quaternion.copy(inverse).multiply(rotation);
      });
      const separation = state.separation;
      upperEngine.visible = !state.boosterAttached;
      const nozzle = state.boosterAttached ? 0 : h * 0.418;
      flame.position.y = nozzle - h * (state.boosterAttached ? 0.3 : 0.16);
      flame.userData.upper = !state.boosterAttached;
      flame.userData.nozzle = nozzle;
      light.position.y = nozzle + 1;
      if (!separation) return;
      const t = Math.max(0, state.elapsed - separation.time);
      separationFlash.visible = t < 0.65;
      separationFlash.scale.setScalar(1 + t * 6);
      separationMaterial.opacity = Math.max(0, 0.8 * (1 - t / 0.65));
      booster.visible = t < 22;
      const d = rocketDirection(separation.attitude);
      const initialQ = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(d.x, d.y, d.z),
      );
      const detachedQ = initialQ
        .clone()
        .multiply(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(t * 0.16, t * 0.05, t * 0.23),
          ),
        );
      const center = new THREE.Vector3(0, h * 0.23, 0);
      const position = new THREE.Vector3(
        separation.position.x,
        separation.position.y,
        separation.position.z,
      )
        .add(center.clone().applyQuaternion(initialQ))
        .addScaledVector(
          new THREE.Vector3(
            separation.velocity.x,
            separation.velocity.y,
            separation.velocity.z,
          ),
          t,
        )
        .addScaledVector(new THREE.Vector3(d.x, d.y, d.z), -7 * t);
      position.y -= 4.8 * t * t;
      position.sub(center.applyQuaternion(detachedQ));
      const inverse = group.quaternion.clone().invert();
      booster.position
        .copy(position)
        .sub(
          new THREE.Vector3(
            state.position.x,
            state.position.y,
            state.position.z,
          ),
        )
        .applyQuaternion(inverse);
      booster.quaternion.copy(inverse).multiply(detachedQ);
    },
    fire(power: number, time: number) {
      if (titan) {
        (jetMaterial as THREE.ShaderMaterial).uniforms.uTime.value = time;
        jetCoreMaterial!.uniforms.uTime.value = time;
      }
      const coreFraction = config.strapOns
        ? config.stages.boost.maxThrust /
          (config.stages.boost.maxThrust + config.strapOns.maxThrust)
        : 1;
      const mainPower =
        titan && (activeStage === 'strap-separating' || activeStage === 'boost')
          ? Math.min(1, power / coreFraction)
          : power;
      flame.visible = mainPower > 0.01;
      strapPlumes.forEach((plume, i) => {
        plume.visible =
          strapsAttached && activeStage === 'strap-on' && power > 0.01;
        plume.scale.y = power * (1 + 0.07 * Math.sin(time * 41 + i * 1.7));
        plume.position.y = h * 0.005 - strapJetLength * 0.5 * plume.scale.y;
      });
      sidePlumes.forEach((plume, i) => {
        plume.visible = power > 0.01 && !flame.userData.upper;
        plume.scale.y = power * (1 + 0.06 * Math.sin(time * 37 + i));
      });
      flame.scale.set(
        1 + 0.12 * Math.sin(time * 37),
        mainPower *
          (flame.userData.upper ? 0.53 : 1) *
          (1 + 0.08 * Math.sin(time * 53)),
        1,
      );
      if (titan)
        flame.position.y =
          (flame.userData.nozzle ?? 0) +
          h * 0.005 -
          mainJetLength * 0.5 * flame.scale.y;
      light.intensity = power * (titan ? 350 : large ? 180 : 65);
    },
  };
}

export function createRocketScaffold(kind: RocketKind) {
  const config = ROCKET_CONFIGS[kind];
  const group = new THREE.Group(),
    h = config.height * 1.06,
    r = config.footprintRadius * 1.12;
  const steel = new THREE.MeshStandardMaterial({
    color: 0x68818a,
    metalness: 0.72,
    roughness: 0.5,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4,
      pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, h, 6), steel);
    pole.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    group.add(pole);
  }
  for (let y = 2; y < h; y += Math.max(3, h / 9)) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.1, 5, 12), steel);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    group.add(ring);
  }
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.15, r * 1.2, 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0x3f5159, roughness: 1 }),
  );
  base.position.y = -0.15;
  group.add(base);
  group.name = 'Temporary assembly gantry — no load-bearing foundation';
  return group;
}

export function disposeRocketObject(root: THREE.Object3D) {
  root.removeFromParent();
  const gs = new Set<THREE.BufferGeometry>(),
    ms = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
      gs.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        ms.add(m),
      );
    }
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
}

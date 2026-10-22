import * as THREE from 'three';
import {
  ROCKET_CONFIGS,
  rocketDirection,
  type RocketKind,
  type RocketState,
} from '../rocket-state';

/** Original reusable meshes. Dimensions are authored gameplay dimensions, not a real vehicle blueprint. */
export function createRocketModel(kind: RocketKind) {
  const large = kind === 'large',
    { height: h, radius: r } = ROCKET_CONFIGS[kind];
  const group = new THREE.Group(),
    segments: THREE.Group[] = [];
  const booster = new THREE.Group(),
    upper = new THREE.Group();
  booster.name = 'First stage — separable booster';
  upper.name = 'Second stage — observation vehicle';
  group.add(booster, upper);
  group.name = `${kind} Atlas research rocket`;
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
      i === 2 ? black : white,
      h * (0.11 + i * 0.14),
      g,
    );
    for (const y of [h * (0.04 + i * 0.14), h * (0.175 + i * 0.14)])
      part(
        new THREE.TorusGeometry(r * 1.005, r * 0.035, 6, 32),
        orange,
        y,
        g,
      ).rotation.x = Math.PI / 2;
  }
  const top = new THREE.Group();
  upper.add(top);
  segments.push(top);
  part(
    new THREE.CylinderGeometry(r * 0.72, r, h * 0.1, 32),
    white,
    h * 0.79,
    top,
  );
  part(new THREE.ConeGeometry(r * 0.72, h * 0.16, 32), white, h * 0.92, top);
  const window = part(
    new THREE.SphereGeometry(r * 0.28, 16, 10),
    glass,
    h * 0.83,
    top,
  );
  window.position.z = r * 0.73;
  window.scale.z = 0.18;
  for (let i = 0; i < (large ? 7 : 1); i++) {
    const a = (i * Math.PI) / 3,
      engine = part(
        new THREE.CylinderGeometry(r * 0.19, r * 0.31, h * 0.042, 16, 1, true),
        black,
        h * 0.025,
        segments[0],
      );
    if (i)
      engine.position.set(
        Math.cos(a) * r * 0.59,
        h * 0.025,
        Math.sin(a) * r * 0.59,
      );
  }
  for (let i = 0; i < 4; i++) {
    const fin = part(
      new THREE.BoxGeometry(r * 1.12, h * 0.12, r * 0.09),
      black,
      h * 0.13,
      segments[0],
    );
    const a = (i * Math.PI) / 2;
    fin.position.x = Math.cos(a) * r;
    fin.position.z = Math.sin(a) * r;
    fin.rotation.y = -a;
  }
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
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffc865,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.85, h * 0.65, 20, 1, true),
    flameMat,
  );
  flame.rotation.z = Math.PI;
  flame.position.y = -h * 0.3;
  flame.visible = false;
  group.add(flame);
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(r * 0.4, h * 0.38, 16),
    new THREE.MeshBasicMaterial({
      color: 0xd6edff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  flame.add(core);
  core.position.y = -h * 0.11;
  const light = new THREE.PointLight(0xffa345, 0, large ? 180 : 65, 1.5);
  light.position.y = 1;
  group.add(light);
  return {
    group,
    segments,
    flame,
    light,
    booster,
    upper,
    height: h,
    radius: r,
    build(progress: number) {
      segments.forEach((g, i) => {
        const t = THREE.MathUtils.clamp(progress * segments.length - i, 0, 1);
        g.visible = t > 0;
        g.scale.y = Math.max(0.001, t);
      });
    },
    /** The detached booster preserves separation momentum and tumbles about its own centre. */
    stage(state: RocketState) {
      const separation = state.separation;
      upperEngine.visible = !state.boosterAttached;
      const nozzle = state.boosterAttached ? 0 : h * 0.418;
      flame.position.y = nozzle - h * (state.boosterAttached ? 0.3 : 0.16);
      flame.userData.upper = !state.boosterAttached;
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
      flame.visible = power > 0.01;
      flame.scale.set(
        1 + 0.12 * Math.sin(time * 37),
        power *
          (flame.userData.upper ? 0.53 : 1) *
          (1 + 0.08 * Math.sin(time * 53)),
        1,
      );
      light.intensity = power * (large ? 180 : 65);
    },
  };
}

export function createRocketScaffold(large: boolean) {
  const group = new THREE.Group(),
    h = large ? 55 : 18,
    r = large ? 7 : 2.8;
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
  for (let y = 2; y < h; y += large ? 6 : 3) {
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

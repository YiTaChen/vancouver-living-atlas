import * as THREE from 'three';
import type { RocketKind } from '../rocket-state';

export type RocketCollisionSegment = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  radius: number;
  booster: boolean;
};

/** Authored appendages stay on real stage sections during separation/breakup. */
export function addRocketDesign(
  kind: RocketKind,
  height: number,
  radius: number,
  segments: THREE.Group[],
  materials: {
    white: THREE.Material;
    black: THREE.Material;
    orange: THREE.Material;
    steel: THREE.Material;
    heatShield: THREE.Material;
  },
) {
  const h = height,
    r = radius;
  const collision: RocketCollisionSegment[] = [];
  function mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Group,
    name: string,
  ) {
    const m = new THREE.Mesh(geometry, material);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function probe(a: number[], b: number[], width: number, booster: boolean) {
    collision.push({
      from: new THREE.Vector3(...(a as [number, number, number])),
      to: new THREE.Vector3(...(b as [number, number, number])),
      radius: width,
      booster,
    });
  }
  function wing(
    parent: THREE.Group,
    y: number,
    reach: number,
    length: number,
    angle: number,
    material: THREE.Material,
    name: string,
    booster: boolean,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(r * 0.92, y - length * 0.5);
    shape.lineTo(r * reach, y - length * 0.38);
    shape.lineTo(r * reach, y + length * 0.08);
    shape.lineTo(r * 0.92, y + length * 0.5);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: r * 0.09,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, -r * 0.045);
    geometry.rotateY(angle);
    mesh(geometry, material, parent, name);
    const a = new THREE.Vector3(r, y, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle,
    );
    const b = new THREE.Vector3(r * reach, y - length * 0.1, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      angle,
    );
    probe(a.toArray(), b.toArray(), r * 0.13, booster);
  }
  if (kind === 'small') {
    for (let i = 0; i < 4; i++)
      wing(
        segments[0],
        h * 0.13,
        2.0,
        h * 0.16,
        (i * Math.PI) / 2,
        materials.orange,
        'Scout swept stabilizer',
        true,
      );
  } else if (kind === 'large') {
    for (const side of [-1, 1]) {
      const parent = segments[side < 0 ? 0 : 2],
        x = side * r * 2.05;
      const body = mesh(
        new THREE.CylinderGeometry(r * 0.54, r * 0.54, h * 0.42, 24),
        materials.white,
        parent,
        'Atlas side booster',
      );
      body.position.set(x, h * 0.25, 0);
      const nose = mesh(
        new THREE.ConeGeometry(r * 0.54, h * 0.11, 24),
        materials.white,
        parent,
        'Atlas booster nose',
      );
      nose.position.set(x, h * 0.515, 0);
      const bell = mesh(
        new THREE.CylinderGeometry(r * 0.28, r * 0.43, h * 0.045, 16, 1, true),
        materials.black,
        parent,
        'Atlas booster nozzle',
      );
      bell.position.set(x, h * 0.025, 0);
      for (const y of [0.08, 0.22, 0.38]) {
        const band = mesh(
          new THREE.TorusGeometry(r * 0.55, r * 0.035, 5, 24),
          materials.black,
          parent,
          'Atlas booster joint',
        );
        band.rotation.x = Math.PI / 2;
        band.position.set(x, h * y, 0);
      }
      for (const y of [0.12, 0.39]) {
        const tie = mesh(
          new THREE.BoxGeometry(r * 1.2, r * 0.18, r * 0.2),
          materials.black,
          parent,
          'Atlas booster mount',
        );
        tie.position.set(side * r * 1.35, h * y, 0);
      }
      probe(
        [x, h * 0.04 + r * 0.54, 0],
        [x, h * 0.55 - r * 0.3, 0],
        r * 0.54,
        true,
      );
    }
  } else {
    for (let i = 0; i < 2; i++) {
      wing(
        segments[3],
        h * 0.535,
        1.57,
        h * 0.11,
        i * Math.PI,
        materials.heatShield,
        'Titan aft control flap',
        false,
      );
      wing(
        segments[5],
        h * 0.875,
        1.43,
        h * 0.085,
        i * Math.PI,
        materials.steel,
        'Titan forward control flap',
        false,
      );
    }
    // Merge every grid-fin rib into one mesh: a readable lattice without one
    // draw call per bar. These are fixed visual fins, not return-flight controls.
    const positions: number[] = [],
      normals: number[] = [];
    function rib(
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      angle: number,
    ) {
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate(x, y, z);
      g.rotateY(angle);
      positions.push(...g.getAttribute('position').array);
      normals.push(...g.getAttribute('normal').array);
      g.dispose();
    }
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2,
        left = r * 0.98,
        right = r * 1.76,
        y = h * 0.413,
        hh = h * 0.021;
      for (const yy of [y - hh, y + hh])
        rib(
          (left + right) / 2,
          yy,
          0,
          right - left,
          r * 0.075,
          r * 0.12,
          angle,
        );
      for (let j = 0; j <= 5; j++)
        rib(
          left + ((right - left) * j) / 5,
          y,
          0,
          r * 0.065,
          hh * 2,
          r * 0.12,
          angle,
        );
      const a = new THREE.Vector3(left, y, 0).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          angle,
        ),
        b = new THREE.Vector3(right, y, 0).applyAxisAngle(
          new THREE.Vector3(0, 1, 0),
          angle,
        );
      probe(a.toArray(), b.toArray(), r * 0.2, true);
    }
    const grid = new THREE.BufferGeometry();
    grid.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
    grid.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    mesh(grid, materials.steel, segments[2], 'Titan lattice grid fins');
    for (let i = 3; i < 5; i++) {
      const shield = mesh(
        new THREE.CylinderGeometry(
          r * 1.009,
          r * 1.009,
          h * 0.14,
          32,
          1,
          true,
          -Math.PI / 2,
          Math.PI,
        ),
        materials.heatShield,
        segments[i],
        'Titan heat shield',
      );
      shield.position.y = h * (0.11 + i * 0.14);
    }
  }
  return collision;
}

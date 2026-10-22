import * as THREE from 'three';
import type { CityEngine } from './engine';
import { project } from './geo';
import { createLandmarkGroundSampler } from './landmark-ground';
import { makeOlympicCauldron } from './assets/olympic-cauldron';
import source from './waterfront-source.json';
import type { WaterSurface } from './water-world';

export const CAULDRON_COORDINATE = source.cauldron.coordinate;
export const CAULDRON_POOL = source.pool.ring.map(project);

/** Resolve every foundation corner from the existing rendered floor. Never
 * infer a plaza from a terrain height alone or add a second broad walk deck. */
export function resolveCauldronFoundation(
  sample: (x: number, z: number) => number | undefined,
) {
  const centre = project(CAULDRON_COORDINATE);
  const samples = [
    centre,
    ...CAULDRON_POOL.slice(0, -1),
    ...CAULDRON_POOL.slice(0, -1).map((p, i) => {
      const q = CAULDRON_POOL[i + 1];
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    }),
  ].map(([x, z]) => sample(x, z));
  if (samples.some((y) => y === undefined || !Number.isFinite(y))) return null;
  const heights = samples as number[];
  const low = Math.min(...heights),
    high = Math.max(...heights);
  // A bad floor or a podium/ground mix must not produce a tall invented plinth.
  if (high - low > 1.25) return null;
  return { centre, low, high, top: high + 0.035, samples: heights };
}

/** Small static batches, no requests, textures, point lights or LOD loads.
 * All resources belong to the scene and use CityEngine's ordinary teardown. */
export function createWaterfront(e: CityEngine) {
  const [x, z] = project(CAULDRON_COORDINATE);
  const floor = createLandmarkGroundSampler(
    [e.terrain, e.roads],
    [{ x, z, radius: 20 }],
    (px, pz) => e.elevation(px, pz),
  );
  const foundation = resolveCauldronFoundation((px, pz) =>
    floor.sample(px, pz),
  );
  e.data.waterfrontProof = {
    status: foundation ? 'ready' : 'unavailable-ground',
    sourceMeshes: floor.sourceMeshes,
    sourceTriangles: floor.triangles,
    foundation,
  };
  if (!foundation) return;
  const group = new THREE.Group();
  group.name = 'Jack Poole Plaza · Olympic Cauldron';
  group.userData.waterfrontDetail = true;
  const outer = CAULDRON_POOL.slice(0, -1).map(([px, pz]) => [px - x, pz - z]);
  // 0.24 m coping inset on this mapped rectangular pool.
  const inner = outer.map(([px, pz], i) => {
    const previous = outer[(i + 3) % 4];
    const next = outer[(i + 1) % 4];
    const a = new THREE.Vector2(previous[0] - px, previous[1] - pz).normalize();
    const b = new THREE.Vector2(next[0] - px, next[1] - pz).normalize();
    return [px + 0.24 * (a.x + b.x), pz + 0.24 * (a.y + b.y)];
  });
  const shape = (ring: number[][]) =>
    new THREE.Shape(ring.map(([a, b]) => new THREE.Vector2(a, -b)));
  const rimShape = shape(outer);
  rimShape.holes.push(
    new THREE.Path(inner.map(([a, b]) => new THREE.Vector2(a, -b))),
  );
  const depth = foundation.top - foundation.low + 0.2;
  const rimGeometry = new THREE.ExtrudeGeometry(rimShape, {
    depth,
    bevelEnabled: false,
  });
  rimGeometry.rotateX(-Math.PI / 2);
  rimGeometry.translate(0, -depth + 0.13, 0);
  const rim = new THREE.Mesh(
    rimGeometry,
    new THREE.MeshStandardMaterial({ color: 0xb0b4b0, roughness: 0.86 }),
  );
  rim.name = 'Mapped reflecting-pool coping';
  rim.castShadow = rim.receiveShadow = true;
  const waterGeometry = new THREE.ShapeGeometry(shape(inner));
  waterGeometry.rotateX(-Math.PI / 2);
  waterGeometry.translate(0, 0.045, 0);
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x386463,
      roughness: 0.25,
      metalness: 0.3,
    }),
  );
  water.name = 'Reflecting pool · opaque shallow water';
  water.userData.waterId = 'lake-1070091596-0';
  water.receiveShadow = true;
  const sculpture = makeOlympicCauldron();
  sculpture.position.y = 0.045;
  sculpture.rotation.y = -0.403;
  group.add(rim, sculpture);
  group.position.set(x, foundation.top, z);
  e.landmarks.add(group);
  // Nature already renders this mapped pool. Replace that single source visual
  // and its computed level, retaining its polygon and non-navigable identity.
  // The pool stays with terrain when the Buildings layer is hidden.
  water.position.set(x, foundation.top, z);
  e.terrain.add(water);
  const waterId = water.userData.waterId;
  const previousWater = (e.data.waterMeshes as THREE.Mesh[] | undefined)?.find(
    (m) => m.userData.waterId === waterId,
  );
  const previousSurface = (
    e.data.waterSurfaces as WaterSurface[] | undefined
  )?.find((s) => s.id === waterId);
  if (previousWater) previousWater.visible = false;
  e.data.waterMeshes = [
    ...(e.data.waterMeshes ?? []).filter(
      (m: THREE.Mesh) => m !== previousWater,
    ),
    water,
  ];
  e.data.waterSurfaces = (e.data.waterSurfaces ?? []).map((s: WaterSurface) =>
    s.id === waterId
      ? { ...s, level: foundation.top + 0.045, navigable: false }
      : s,
  );
  e.data.waterfrontProof.pool = {
    id: waterId,
    previousLevel: previousSurface?.level,
    level: foundation.top + 0.045,
  };
  e.data.waterfrontDetailControl = {
    setEnabled(enabled: boolean) {
      group.visible = water.visible = enabled;
      if (previousWater) previousWater.visible = !enabled;
    },
  };
  // Nature's original waterPolys already excludes this pool from ground travel.
  // Retain that source footprint; never turn it into a boat launch surface.
  group.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) meshes.push(o);
  });
  e.data.flightLandmarkMeshes = [
    ...(e.data.flightLandmarkMeshes ?? []),
    ...meshes,
  ];
}

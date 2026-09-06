import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const load = async (name) => import(cityModule(name.replace(/\.ts$/, '')));
const { applyShoreLowering: apply, shoreGroundMeshes } =
  await load('shore-lowering.ts');
const { groundHarmonizationScopes } = await load(
    'ground-harmonization-scopes.ts',
  ),
  { project } = await load('geo.ts');
const { compareGroundHeights: compare, reconcileGroundVisibility: clip } =
  await load('ground-visibility.ts');
const scope = groundHarmonizationScopes(project).find(
    (s) => s.id === 'north-coast',
  ),
  x = (scope.bounds[0] + scope.bounds[2]) / 2,
  z = (scope.bounds[1] + scope.bounds[3]) / 2;
const rect = (x0, z0, x1, z1, y) =>
  [
    [x0, z0],
    [x0, z1],
    [x1, z1],
    [x0, z0],
    [x1, z1],
    [x1, z0],
  ].flatMap(([x, z]) => [x, y, z]);
function shore(kind = 'seawall') {
  const geometry = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        rect(x - 12, z - 12, x + 12, z + 12, 5.5),
        3,
      ),
    ),
    mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xb3b1a0 }),
    );
  mesh.userData = {
    walkSurface: true,
    groundShoreSource: 'measured-shoreline-strip',
    groundShoreKind: kind,
  };
  mesh.name = kind;
  return { kind: 'shore', shoreKind: kind, mesh };
}
const positions = new Float32Array(rect(x - 1.5, z - 3, x + 1.5, z + 3, 5));
const paths = scope.pathSourceIds.map((id) => ({
  id,
  kind: 'path',
  level: 'ground',
  positions,
}));
test('explicit shore correction preserves the source footprint, material and path bytes while lowering only inside the coastal scope', () => {
  const s = shore(),
    before = Array.from(positions),
    material = s.mesh.material,
    g = s.mesh.geometry;
  let disposed = 0;
  g.addEventListener('dispose', () => disposed++);
  const result = apply([s], paths, scope),
    final = s.mesh.geometry.getAttribute('position').array;
  assert.equal(result.kind, 'shore');
  assert.equal(disposed, 1);
  assert.equal(s.mesh.material, material);
  assert.deepEqual(Array.from(positions), before);
  assert.ok(compare(final, positions, scope.bounds).maximumDeltaM < -0.0199);
  for (let i = 0; i < final.length; i += 3) {
    assert.ok(
      final[i] >= scope.bounds[0] &&
        final[i] <= scope.bounds[2] &&
        final[i + 2] >= scope.bounds[1] &&
        final[i + 2] <= scope.bounds[3],
    );
    assert.ok(final[i + 1] <= 5.5);
  }
  assert.equal(shoreGroundMeshes([s])[0].kind, 'shore');
  assert.equal(s.mesh.userData.asphaltSurface, undefined);
});
test('water, terrain, sand overlay and protected upper mesh cannot masquerade as a shoreline correction target', () => {
  for (const edit of [
    (m) => delete m.userData.groundShoreSource,
    (m) => {
      m.userData.waterId = 'sea';
    },
    (m) => {
      m.userData.beachProfile = true;
    },
    (m) => {
      m.userData.protectedSurface = true;
    },
    (m) => {
      m.userData.asphaltSurface = true;
    },
    (m) => {
      m.userData.groundVisibilityApplied = true;
    },
  ]) {
    const s = shore();
    edit(s.mesh);
    assert.throws(() => apply([s], paths, scope), /explicitly marked/);
  }
});
test('Causeway and any altered geographic bounds are explicitly refused', () => {
  assert.throws(
    () => apply([shore()], paths, groundHarmonizationScopes(project)[0]),
    /two reviewed/,
  );
  assert.throws(
    () =>
      apply([shore()], paths, {
        ...scope,
        bounds: [...scope.bounds.slice(0, 3), scope.bounds[3] + 10],
      }),
    /geographic region/,
  );
});
test('actual source ID/physical level is mandatory; no reconstructed or upper path is accepted', () => {
  assert.throws(() => apply([shore()], [], scope), /Missing actual/);
  assert.throws(
    () =>
      apply(
        [shore()],
        paths.map((p) => ({ ...p, level: 'upper' })),
        scope,
      ),
    /unprotected source path/,
  );
});
test('final explicit shore triangles can remove coarse grass while a physical beach profile stays protected', () => {
  const s = shore(),
    final = shoreGroundMeshes([s])[0],
    land = Array.from(s.mesh.geometry.getAttribute('position').array).map(
      (v, i) => (i % 3 === 1 ? 6 : v),
    ),
    beach = land.slice(0, 9),
    original = [...land, ...beach];
  const result = clip(
    { positions: original, protectedTriangleRanges: [[2, 3]] },
    [
      {
        id: final.id,
        kind: 'shore',
        level: 'ground',
        positions: s.mesh.geometry.getAttribute('position').array,
      },
    ],
    { bounds: scope.bounds },
  );
  assert.deepEqual(result.positions, beach);
  assert.deepEqual(result.changedTriangles, [0, 1]);
});

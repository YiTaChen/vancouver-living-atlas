import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Preserve the existing audited constructor and immutable first-round receipt.
// Only these exact round-two bounds/uniform callsites may be projected out; the
// whole result must still hash to the independently reviewed first-round source.
const firstRoundSha256 =
  '6adc2cc4771fa9431c73ac90c309eb8ec6d213f45b8170c9a3a48789aaad7455';
const changes = [
  [
    "import { installVehicleSurface, vehicleSurfaceWeight } from './vehicle-surface';\n",
    "import { installVehicleSurface } from './vehicle-surface';\n",
  ],
  ["import { installRoadsterFormGeometry } from './roadster-form';\n", ''],
  ["    if (key === 'paint') installRoadsterFormGeometry(geometry);\n", ''],
  ['  const formWorldPosition = new THREE.Vector3();\n', ''],
  [
    "  const paintMesh = group.getObjectByName('roadster/paint') as THREE.Mesh;\n",
    '',
  ],
  [
    `      if (group.visible && group.parent) {
        group.getWorldPosition(formWorldPosition);
        paintMesh.morphTargetInfluences![0] = vehicleSurfaceWeight(
          formWorldPosition.x,
          formWorldPosition.y,
          formWorldPosition.z,
        );
      } else paintMesh.morphTargetInfluences![0] = 0;
`,
    '',
  ],
];

export function projectBeforeRound2Roadster(path, source) {
  if (
    path !== 'lib/city/assets/roadster.ts' ||
    !changes.some(([current]) => source.includes(current))
  )
    return { source, reviewed: [] };
  for (const [index, [current, prior]] of changes.entries()) {
    assert.equal(
      source.split(current).length - 1,
      1,
      `Protected roadster source drift: round-two delta ${index + 1}`,
    );
    source = source.replace(current, prior);
  }
  assert.equal(
    createHash('sha256').update(source).digest('hex'),
    firstRoundSha256,
    'Unreviewed first-round roadster source change',
  );
  return {
    source,
    reviewed: ['street pilot round-two roadster bounds and weight'],
  };
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { historicalTeslaShape } from './tesla-historical-shape.mjs';

// The road triangles and captured motion remain historical evidence. Only the
// chassis datum is mapped from the old authored car to the measured new one.
const historicalShape = structuredClone(historicalTeslaShape);
// These frozen captures predate the later metadata-only tread-radius and
// rear-lip refinement; their original authored geometry dimensions are shared.
delete historicalShape.groundSupport.wheelRadius;
historicalShape.groundSupport.bodySections[0].clearance = 0.08;
const measured = JSON.parse(
  readFileSync(
    new URL(
      '../../lib/city/assets/tesla-roadster-detailed-metrics.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

export function historicalTeslaCaptureAdapter(capturedShape, currentShape) {
  assert.deepEqual(
    capturedShape,
    historicalShape,
    'retain the original captured car metadata',
  );
  const currentHeight =
    measured.dimensions.halfExtents[1] + capturedShape.clearance;
  assert.deepEqual(
    currentShape,
    {
      halfExtents: measured.dimensions.halfExtents,
      clearance: capturedShape.clearance,
      groundSupport: {
        wheelContacts: measured.groundSupport.wheelContacts.map(([x, y, z]) => [
          x,
          y - currentHeight,
          z,
        ]),
        chassisClearance: measured.groundSupport.chassisClearance,
        suspensionTravel: measured.groundSupport.suspensionTravel,
        wheelRadius: measured.dimensions.wheelRadius,
        bodySections: measured.groundSupport.bodySections,
      },
    },
    'use the complete measured new shape, including all obstruction envelopes',
  );

  const meanContact = (shape) =>
    shape.groundSupport.wheelContacts
      .reduce(
        (sum, contact) => sum.add(new THREE.Vector3(...contact)),
        new THREE.Vector3(),
      )
      .multiplyScalar(1 / 4);
  const oldContact = meanContact(capturedShape),
    newContact = meanContact(currentShape);
  return (captured) => {
    const state = structuredClone(captured);
    const rotation = new THREE.Quaternion(...state.quaternion).normalize();
    const oldWorldContact = oldContact
      .clone()
      .applyQuaternion(rotation)
      .add(new THREE.Vector3(...state.position));
    const delta = oldContact.clone().sub(newContact).applyQuaternion(rotation);
    state.position = new THREE.Vector3(...state.position).add(delta).toArray();
    const mappedWorldContact = newContact
      .clone()
      .applyQuaternion(rotation)
      .add(new THREE.Vector3(...state.position));
    assert(
      oldWorldContact.distanceTo(mappedWorldContact) < 1e-10,
      'preserve captured tyre-plane position on the actual grade',
    );
    // Orientation, velocity, heading, physical contact identity and every source
    // triangle are untouched. The runtime must still prove all four new tyres.
    return state;
  };
}

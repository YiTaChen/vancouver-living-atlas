import assert from 'node:assert/strict';

// See qa/fixture-portability.md. One known trigonometric footprint coordinate
// differs by one double-precision ULP on this supported macOS Node runtime.
const coordinatePath = 'interiors.0.polys.0.36.1';
const toleranceM = 1e-12;

function assertFiniteNumbers(value, path = 'fixture') {
  if (typeof value === 'number')
    assert(Number.isFinite(value), `Non-finite geometry fixture number: ${path}`);
  else if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value))
      assertFiniteNumbers(child, `${path}.${key}`);
}

/** Keep source hashes, geometry digests, order, topology and metadata exact.
 * Only the documented Science World footprint coordinate may round within
 * 1e-12 metres. This is comparison-only; neither runtime nor fixture is edited. */
export function assertPortableGeometryFixture(actual, expected) {
  assertFiniteNumbers(actual);
  assertFiniteNumbers(expected);
  // Retain the validator's existing JSON-fixture serialization (-0 becomes 0).
  // Check finite numbers first so JSON cannot turn NaN/Infinity into null.
  const comparable = JSON.parse(JSON.stringify(actual));
  const a = comparable.interiors?.[0], b = expected.interiors?.[0];
  const x = a?.polys?.[0]?.[36]?.[1], y = b?.polys?.[0]?.[36]?.[1];
  const rounding = [];
  if (a?.id === 'science' && b?.id === 'science' &&
    typeof x === 'number' && typeof y === 'number' &&
    Math.abs(x - y) <= toleranceM) {
    if (x !== y) rounding.push({ path: coordinatePath, actual: x,
      expected: y, absoluteDifferenceM: Math.abs(x - y), toleranceM });
    a.polys[0][36][1] = y;
  }
  assert.deepEqual(comparable, expected,
    'Source/geometry regression fixture drift. Review before re-recording.');
  return { scope: 'One documented Science World polygon coordinate only; all other fixture fields remain exact', rounding };
}

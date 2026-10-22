import assert from 'node:assert/strict';

// The reviewed CPU fixture contains world-space double precision coordinates.
// Different V8/platform implementations of trigonometry can differ by one ULP.
// Only those finite numeric leaves receive a 1e-12 absolute tolerance; structure,
// source hashes, geometry hashes and every other value retain deep strict equality.
const ABSOLUTE_TOLERANCE = 1e-12;

export function assertConsumerFixtureEqual(actual, expected) {
  function normalizeNumbers(value, reference) {
    if (typeof value === 'number' && typeof reference === 'number') {
      assert.ok(
        Number.isFinite(value) && Number.isFinite(reference),
        'Consumer fixture numeric values must be finite',
      );
      return Math.abs(value - reference) <= ABSOLUTE_TOLERANCE
        ? reference
        : value;
    }
    if (Array.isArray(value) && Array.isArray(reference)) {
      return value.map((item, index) =>
        normalizeNumbers(item, reference[index]),
      );
    }
    if (
      value &&
      reference &&
      typeof value === 'object' &&
      typeof reference === 'object' &&
      !Array.isArray(value) &&
      !Array.isArray(reference)
    ) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          normalizeNumbers(item, reference[key]),
        ]),
      );
    }
    return value;
  }

  assert.deepEqual(
    normalizeNumbers(actual, expected),
    expected,
    'Source/geometry regression fixture drift. Review before re-recording.',
  );
}

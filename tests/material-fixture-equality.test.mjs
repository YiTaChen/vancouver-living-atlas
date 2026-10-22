import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConsumerFixtureEqual } from '../tools/assets/material-consumer-candidates/adapters/fixture-equality.mjs';

const fixture = () => ({
  sourceHashes: { 'lib/city/interiors.ts': 'reviewed-source-hash' },
  geometry: { hash: 'reviewed-triangle-hash', triangles: 120 },
  interiors: [{ polys: [[[-29.286981180607793, -12.131064805973342]]] }],
});

test('consumer fixture accepts only sub-picometre finite coordinate noise without changing inputs', () => {
  const expected = fixture();
  const actual = fixture();
  actual.interiors[0].polys[0][0][1] = -12.13106480597334;
  const before = structuredClone(actual);
  assert.doesNotThrow(() => assertConsumerFixtureEqual(actual, expected));
  assert.deepEqual(actual, before);
  assert.deepEqual(expected, fixture());
});

test('consumer fixture keeps source and geometry hashes strictly equal', () => {
  for (const change of [
    (actual) => {
      actual.sourceHashes['lib/city/interiors.ts'] = 'changed-source-hash';
    },
    (actual) => {
      actual.geometry.hash = 'changed-triangle-hash';
    },
  ]) {
    const actual = fixture();
    change(actual);
    assert.throws(
      () => assertConsumerFixtureEqual(actual, fixture()),
      /fixture drift/,
    );
  }
});

test('consumer fixture rejects micrometre geometry drift, altered counts and missing or extra fields', () => {
  for (const change of [
    (actual) => {
      actual.interiors[0].polys[0][0][1] += 1e-6;
    },
    (actual) => {
      actual.geometry.triangles++;
    },
    (actual) => {
      delete actual.geometry.hash;
    },
    (actual) => {
      actual.geometry.extra = true;
    },
    (actual) => {
      actual.interiors[0].polys[0].push([0, 0]);
    },
  ]) {
    const actual = fixture();
    change(actual);
    assert.throws(
      () => assertConsumerFixtureEqual(actual, fixture()),
      /fixture drift/,
    );
  }
});

test('consumer fixture rejects non-finite coordinates and number/string type changes', () => {
  for (const value of [NaN, Infinity, -Infinity, '-12.131064805973342']) {
    const actual = fixture();
    actual.interiors[0].polys[0][0][1] = value;
    assert.throws(() => assertConsumerFixtureEqual(actual, fixture()));
  }
});

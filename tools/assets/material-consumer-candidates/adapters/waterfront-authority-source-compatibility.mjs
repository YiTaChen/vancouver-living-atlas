import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const review = JSON.parse(
  readFileSync(
    new URL('./reviewed-waterfront-authority.json', import.meta.url),
  ),
);
const sha = (source) => createHash('sha256').update(source).digest('hex');

/** Audit-only source projection. The current constructors still run in the
 * material consumers. A complete exact-byte guard prevents the reviewed hall
 * authority/split delta from hiding any future bench, collider or material edit.
 */
export function projectBeforeWaterfrontAuthority(path, source) {
  if (
    path !== review.path ||
    (!source.includes('WaterfrontAuthority') && !source.includes('legacyHall'))
  )
    return { source, reviewed: [] };
  assert.equal(
    sha(source),
    review.reviewedSha256,
    'Protected pre-seating source drift: reviewed Waterfront authority bytes',
  );
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const change of review.changes.toReversed())
    lines.splice(
      change.startLine,
      change.endLine - change.startLine,
      change.prior,
    );
  const prior = lines.join('');
  assert.equal(sha(prior), review.priorSha256);
  return {
    source: prior,
    reviewed: ['reviewed Waterfront authority and legacy-hall separation'],
  };
}

/** The reviewed split preserves every world triangle and normal. Only the
 * number of merged meshes and their conservative Box3 union changes. Keep
 * exact old/new values rather than ignoring these fields during comparison.
 */
export function reviewedWaterfrontConsumerFixture(fixture, source) {
  if (!projectBeforeWaterfrontAuthority(review.path, source).reviewed.length)
    return fixture;
  const expected = structuredClone(fixture),
    waterfront = expected.interiors.find((site) => site.id === 'waterfront');
  assert(waterfront, 'Protected Waterfront consumer fixture missing');
  assert.deepEqual(waterfront.geometry, review.geometryMetadata.prior);
  for (const key of ['hash', 'triangles', 'vertices'])
    assert.equal(
      review.geometryMetadata.reviewed[key],
      review.geometryMetadata.prior[key],
      `Protected Waterfront geometry drift: ${key}`,
    );
  waterfront.geometry = structuredClone(review.geometryMetadata.reviewed);
  return expected;
}

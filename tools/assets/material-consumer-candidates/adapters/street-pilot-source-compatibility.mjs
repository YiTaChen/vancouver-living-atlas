import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const review = JSON.parse(
  readFileSync(new URL('./reviewed-street-pilot.json', import.meta.url)),
);

/** Subtract only the reviewed material hook/attribute and chase-camera delta.
 * Current constructors still run in the consumer harness. The existing final
 * whole-source SHA guard remains authoritative, including older seated and
 * character fixtures. No source, geometry or original receipt is rewritten. */
export function projectBeforeStreetPilot(path, source) {
  const entry = review.files.find((row) => row.path === path);
  if (
    !entry ||
    !entry.changes.some((change) => source.includes(change.current))
  )
    return { source, reviewed: [] };
  for (const [i, change] of entry.changes.entries()) {
    assert.equal(
      source.split(change.current).length - 1,
      1,
      `Protected pre-seating source drift: street pilot delta ${i + 1}: ${path}`,
    );
    source = source.replace(change.current, change.prior);
  }
  return { source, reviewed: ['street pilot material and camera composition'] };
}

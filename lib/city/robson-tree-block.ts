import { project } from './geo';
import {
  constrainCarriageway,
  type TreeCandidate,
} from './tree-road-clearance';
import type { Point, RoadInput } from './road-graph';

// These are the unchanged ends of the two contiguous City of Vancouver
// source segments adjoining Robson/Burrard. They identify only this pilot,
// not a citywide rule or a survey of lane count. Match the exact source
// geometry rather than mutable feature-array indices.
const POINTS = [
  [-123.1217906, 49.2826345],
  [-123.1222754, 49.2829491],
  [-123.1228089, 49.2832957],
].map(project);

const equal = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
function matches(input: RoadInput, a: Point, b: Point) {
  if (
    input.name.toUpperCase() !== 'ROBSON ST' ||
    input.roadClass.toUpperCase() !== 'ARTERIAL' ||
    input.width !== 18 ||
    input.corridorWidth !== 22 ||
    input.level !== 'ground' ||
    input.points.length !== 2
  )
    return false;
  const [start, end] = input.points;
  return (
    (equal(start, a) && equal(end, b)) || (equal(start, b) && equal(end, a))
  );
}

/** Reuse existing conservative tree-row evidence across two contiguous source
 * fragments, but narrow only the Robson/Burrard intersection fragment. The
 * other fragment is evidence only: a recorded building overlaps its roadway.
 * Source lines, the 22m corridor and tree coordinates stay intact. If either
 * source is trimmed, duplicated, reclassified or lacks two supported tree
 * rows, retain the existing per-source widths. */
export function applyRobsonPilotTreeBlock(
  inputs: RoadInput[],
  trees: readonly TreeCandidate[],
) {
  const first = inputs.filter((input) => matches(input, POINTS[0], POINTS[1]));
  const second = inputs.filter((input) => matches(input, POINTS[1], POINTS[2]));
  if (first.length !== 1 || second.length !== 1) return;
  const width = constrainCarriageway(POINTS, trees, 18).asphaltWidth;
  if (width === undefined) return;
  // The first segment has a source building overlapping the roadway. Use its
  // trees as evidence, but do not shift that segment's visual carriageway.
  second[0].width = width;
}

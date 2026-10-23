import type * as THREE from 'three';
import type { SkyTrainPathPose, SkyTrainStopPose } from './skytrain-ride-path';

/** Structural path contract shared by authored core trips, full GTFS legs and
 * physical terminal crossovers. Car offsets always refer to the same car body. */
export interface SkyTrainMotionPath {
  readonly length: number;
  readonly start: SkyTrainStopPose;
  readonly end: SkyTrainStopPose;
  readonly curve: THREE.Curve<THREE.Vector3>;
  sampleDistance(distance: number, target?: SkyTrainPathPose): SkyTrainPathPose;
  sampleCarDistance?(
    distance: number,
    carOffset: number,
    target?: SkyTrainPathPose,
  ): SkyTrainPathPose;
}

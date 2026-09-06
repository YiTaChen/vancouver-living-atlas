import {
  LANDMARK_WORKER_VERSION,
  assertResolvedPlan,
  type LandmarkJob,
  type LandmarkWorkerResult,
} from './landmark-worker-protocol';
import {
  createWorkerLandmark,
  type ResolvedLandmarkPlan,
} from './landmark-worker-factories';
import { packLandmark } from './landmark-geometry-packet.js';
import * as THREE from 'three';

// A dedicated worker has no document/window/renderer. Do not import CityEngine.
type Scope = {
  onmessage:
    | ((event: { data: LandmarkJob<ResolvedLandmarkPlan> }) => void)
    | null;
  postMessage(message: LandmarkWorkerResult, transfer?: Transferable[]): void;
};
const scope = globalThis as unknown as Scope;
scope.onmessage = (event) => {
  const job = event.data;
  const reply = {
    version: LANDMARK_WORKER_VERSION,
    session: job.session,
    job: job.job,
  } as const;
  try {
    if (job.version !== LANDMARK_WORKER_VERSION)
      throw new Error('Worker/factory bundle version mismatch');
    assertResolvedPlan(job.plan, job.landmark);
    const start = performance.now();
    const group = createWorkerLandmark(true, job.plan);
    const factoryMs = performance.now() - start;
    const result = packLandmark(THREE, group);
    scope.postMessage(
      {
        ...reply,
        ok: true,
        packet: result.packet,
        factoryMs,
        geometryBytes: result.bytes,
      },
      result.transfer,
    );
  } catch (error) {
    scope.postMessage({
      ...reply,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

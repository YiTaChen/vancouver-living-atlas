import * as THREE from 'three';
import type { FacadeQueueOptions } from './facade-queue';

/** Borrow-only public scheduler API; it never disposes source resources. */
export interface FacadePageWarmer {
  prepare(
    group: THREE.Group,
    signal: AbortSignal,
    holder: THREE.Group,
  ): Promise<void>;
}

/** Wall duration includes FIFO waiting and Promise settlement; never GPU time. */
export interface FacadePreparationMetrics {
  requested: number;
  succeeded: number;
  cancelled: number;
  failed: number;
  pending: number;
  totalAsyncWallMs: number;
  lastAsyncWallMs: number;
  maxAsyncWallMs: number;
}
export function createFacadePreparationMetrics(): FacadePreparationMetrics {
  return {
    requested: 0,
    succeeded: 0,
    cancelled: 0,
    failed: 0,
    pending: 0,
    totalAsyncWallMs: 0,
    lastAsyncWallMs: 0,
    maxAsyncWallMs: 0,
  };
}

/** One queue ticket -> one ordinary mesh in the shared post-render scheduler.
 * Never reparent a source page. Its queue's private group must stay intact until
 * whole-cell publication. Source geometry/material remain queue/caller-owned.
 */
export function createFacadePagePreparation(
  getWarmer: () => FacadePageWarmer | null | undefined,
  holder: THREE.Group,
  metrics: FacadePreparationMetrics = createFacadePreparationMetrics(),
  now: () => number = () => performance.now(),
): NonNullable<FacadeQueueOptions['preparePage']> {
  return (request) => {
    const start = now();
    metrics.requested++;
    metrics.pending++;
    let wrapper: THREE.Group | undefined;
    let acknowledged = false;
    const finish = (error?: unknown) => {
      if (acknowledged) return;
      acknowledged = true;
      // Clear only this wrapper's proxy. Never dispose borrowed geometry/material.
      wrapper?.clear();
      const duration = now() - start;
      const wallMs = Number.isFinite(duration) ? Math.max(0, duration) : 0;
      metrics.pending--;
      metrics.lastAsyncWallMs = wallMs;
      metrics.totalAsyncWallMs += wallMs;
      metrics.maxAsyncWallMs = Math.max(metrics.maxAsyncWallMs, wallMs);
      if (request.signal.aborted) metrics.cancelled++;
      else if (error !== undefined) metrics.failed++;
      else metrics.succeeded++;
      request.ack(error);
    };
    if (request.signal.aborted) {
      finish();
      return;
    }
    try {
      const warmer = getWarmer();
      if (!warmer) throw new Error('Facade GPU preparation unavailable');
      for (
        let node: THREE.Object3D | null = request.mesh;
        node;
        node = node.parent
      ) {
        if (node === holder || node instanceof THREE.Scene)
          throw new Error('Facade page preparation requires a detached source');
      }
      request.mesh.updateWorldMatrix(true, false);
      const proxy = request.mesh.clone(false);
      proxy.matrixAutoUpdate = false;
      // A private queue group can have a transform. Flatten its detached local
      // ancestry once; scheduler adds the actual future host's matrixWorld.
      proxy.matrix.copy(request.mesh.matrixWorld);
      proxy.matrixWorld.copy(proxy.matrix);
      wrapper = new THREE.Group();
      wrapper.name = 'Borrowed facade page for GPU preparation';
      wrapper.userData.preparationKind = 'facade';
      wrapper.userData.facadeToken = request.token;
      wrapper.userData.pageIndex = request.pageIndex;
      wrapper.add(proxy);
      // The shared scheduler rejects promptly on abort/context loss. Do not ack
      // in an independent abort listener: that might dispose a page while a
      // synchronous compile/render callback is still borrowing its buffers.
      void warmer.prepare(wrapper, request.signal, holder).then(
        () => finish(),
        (error: unknown) =>
          finish(error ?? new Error('Facade GPU preparation failed')),
      );
    } catch (error) {
      // Synchronous failure has no outstanding renderer borrower.
      finish(error ?? new Error('Facade GPU preparation failed'));
    }
  };
}

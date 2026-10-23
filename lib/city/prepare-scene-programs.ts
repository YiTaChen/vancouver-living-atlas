import type * as THREE from 'three';

export interface SceneProgramPreparationOptions {
  signal?: AbortSignal;
  unavailable?: () => boolean;
  targetScene?: THREE.Scene;
  pollMs?: number;
  timeoutMs?: number;
}

/** Compile through Three's public API, then wait on a snapshot of native program
 * handles. Streamed assets may dispose their materials during this wait. Such
 * deleted programs are no longer needed and cannot invalidate another program's
 * readiness check. No material hooks/disposal methods or renderer properties are
 * borrowed, and every timer exception settles the returned Promise.
 *
 * Without KHR_parallel_shader_compile the LINK_STATUS query can block, as with
 * an ordinary first draw; readiness and real link failures are still checked. */
export async function prepareScenePrograms(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  camera: THREE.Camera,
  options: SceneProgramPreparationOptions = {},
): Promise<void> {
  if (options.signal?.aborted || options.unavailable?.()) throw aborted();
  const gl = renderer.getContext();
  const unavailable = () =>
    options.signal?.aborted || options.unavailable?.() || gl.isContextLost();
  if (unavailable()) throw aborted();
  renderer.compile(scene, camera, options.targetScene);
  if (unavailable()) throw aborted();
  const pending = new Map<WebGLProgram, string>();
  // Copy native handles now: Three's program wrapper clears .program on destroy.
  // The renderer.info array itself also changes as streaming releases resources.
  for (const entry of renderer.info.programs ?? []) {
    const program = entry.program as WebGLProgram | undefined;
    if (program) pending.set(program, entry.name || `program ${entry.id}`);
  }
  const extension = gl.getExtension('KHR_parallel_shader_compile');
  const pollMs = bounded(options.pollMs, 10, 1, 1000);
  const timeoutMs = bounded(options.timeoutMs, 120000, 1, 600000);
  const started = performance.now();

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      pending.clear();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const onAbort = () => finish(aborted());
    const poll = () => {
      if (settled) return;
      try {
        if (unavailable()) {
          finish(aborted());
          return;
        }
        for (const [program, label] of pending) {
          if (!gl.isProgram(program)) {
            pending.delete(program);
            continue;
          }
          if (
            extension &&
            !gl.getProgramParameter(program, extension.COMPLETION_STATUS_KHR)
          )
            continue;
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program)?.trim().slice(0, 2000);
            throw new Error(
              `Scene shader link failed (${label})${log ? `: ${log}` : ''}`,
            );
          }
          pending.delete(program);
        }
        if (!pending.size) {
          finish();
          return;
        }
        const remaining = timeoutMs - (performance.now() - started);
        if (remaining <= 0) {
          finish(
            new Error(
              `Scene shader preparation timed out with ${pending.size} program(s) pending.`,
            ),
          );
          return;
        }
        timer = setTimeout(poll, Math.min(pollMs, remaining));
      } catch (error) {
        finish(error);
      }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    poll();
  });
}

function aborted() {
  return new DOMException(
    'Scene shader preparation is no longer available.',
    'AbortError',
  );
}
function bounded(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  return value !== undefined && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

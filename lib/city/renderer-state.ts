import * as THREE from 'three';

/** Synchronous transaction only. Never hold renderer state across an await. */
export function withRendererState<T>(
  renderer: THREE.WebGLRenderer,
  work: () => T,
): T {
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace();
  const level = renderer.getActiveMipmapLevel();
  const clearColor = renderer.getClearColor(new THREE.Color()).clone();
  const clearAlpha = renderer.getClearAlpha();
  const saved = {
    autoClear: renderer.autoClear,
    color: renderer.autoClearColor,
    depth: renderer.autoClearDepth,
    stencil: renderer.autoClearStencil,
    xr: renderer.xr.enabled,
    shadowAuto: renderer.shadowMap.autoUpdate,
    shadowNeeds: renderer.shadowMap.needsUpdate,
    shadowEnabled: renderer.shadowMap.enabled,
    infoAuto: renderer.info.autoReset,
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    points: renderer.info.render.points,
    lines: renderer.info.render.lines,
  };
  try {
    renderer.xr.enabled = false;
    renderer.info.autoReset = false;
    return work();
  } finally {
    renderer.autoClear = saved.autoClear;
    renderer.autoClearColor = saved.color;
    renderer.autoClearDepth = saved.depth;
    renderer.autoClearStencil = saved.stencil;
    renderer.xr.enabled = saved.xr;
    renderer.shadowMap.autoUpdate = saved.shadowAuto;
    renderer.shadowMap.needsUpdate = saved.shadowNeeds;
    renderer.shadowMap.enabled = saved.shadowEnabled;
    renderer.info.autoReset = saved.infoAuto;
    Object.assign(renderer.info.render, {
      calls: saved.calls,
      triangles: saved.triangles,
      points: saved.points,
      lines: saved.lines,
    });
    // Do NOT rewind info.render.frame: WebGLObjects uses it to deduplicate uploads.
    renderer.setClearColor(clearColor, clearAlpha);
    // Do not call setViewport/setScissor: their logical values must remain intact.
    // Binding a target uses that target's own viewport/scissor and restores it here.
    renderer.setRenderTarget(target, face, level);
  }
}

/** Three normally logs GLSL failures instead of throwing; failed Ultra must stay hidden. */
export function withShaderCheck<T>(
  renderer: THREE.WebGLRenderer,
  work: () => T,
): T {
  const callback = renderer.debug.onShaderError;
  const check = renderer.debug.checkShaderErrors;
  let failed = false;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (...args) => {
    failed = true;
    callback?.(...args);
  };
  try {
    const result = work();
    if (failed)
      throw new Error('GPU shader compilation failed during preparation');
    return result;
  } finally {
    renderer.debug.onShaderError = callback;
    renderer.debug.checkShaderErrors = check;
  }
}

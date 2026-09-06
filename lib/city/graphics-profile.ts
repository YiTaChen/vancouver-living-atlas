import * as THREE from 'three';

/** iPadOS may identify as a Mac; touch points distinguish it from a Mac mouse. */
export function isMobileGraphics(userAgent: string, touchPoints = 0) {
  return (
    /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && touchPoints > 1)
  );
}

/** Probe the actual attachment, not just an advertised extension. Runs once. */
export function supportsHDRTarget(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  if (
    !renderer.extensions.has('EXT_color_buffer_float') &&
    !renderer.extensions.has('EXT_color_buffer_half_float')
  )
    return false;
  const previous = renderer.getRenderTarget();
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
  });
  try {
    renderer.setRenderTarget(target);
    return (
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    );
  } catch {
    return false;
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}

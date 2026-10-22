import * as THREE from 'three';

/** A visual right-of-way through one coarse GIS extrusion near Main Street.
 * World geometry and collision volumes retain the original city source. */
export function createSkyTrainGuidewayUniforms() {
  return {
    skyTrainGuidewayFrame: { value: new THREE.Vector4() },
    skyTrainGuidewayBounds: { value: new THREE.Vector4() },
    skyTrainGuidewayHeight: { value: new THREE.Vector4(-1, 0, 0, 0) },
  };
}
type Uniforms = Partial<ReturnType<typeof createSkyTrainGuidewayUniforms>>;
interface GuidewayFrame {
  origin: readonly [number, number, number];
  yaw: number;
  railY: number;
}
export function setMainSkyTrainGuideway(
  uniforms: Uniforms,
  frame: GuidewayFrame | null,
  seed?: number,
) {
  const {
    skyTrainGuidewayFrame: basis,
    skyTrainGuidewayBounds: bounds,
    skyTrainGuidewayHeight: height,
  } = uniforms;
  if (!basis || !bounds || !height) return;
  basis.value.set(0, 0, 0, 0);
  bounds.value.set(0, 0, 0, 0);
  height.value.set(-1, 0, 0, 0);
  if (
    !frame ||
    !Number.isFinite(seed) ||
    ![...frame.origin, frame.yaw, frame.railY].every(Number.isFinite)
  )
    return;
  basis.value.set(
    frame.origin[0],
    frame.origin[2],
    Math.cos(frame.yaw),
    Math.sin(frame.yaw),
  );
  // Actual two-track articulated cabin/source-body overlap plus >=0.30m.
  // Keep the correction to this38m stretch, retaining the rest of the podium.
  bounds.value.set(-6.8, 6.7, -83.6, -45.7);
  height.value.set(seed!, frame.railY - 0.4, frame.railY + 4, 1);
}
export const SKYTRAIN_GUIDEWAY_UNIFORMS_GLSL = `
uniform vec4 uSkyTrainGuidewayFrame;
uniform vec4 uSkyTrainGuidewayBounds;
uniform vec4 uSkyTrainGuidewayHeight;
`;
export const SKYTRAIN_GUIDEWAY_CONDITION_GLSL = `uSkyTrainGuidewayHeight.w>0.0
  && abs(vFacade.w-uSkyTrainGuidewayHeight.x)<.1
  && vArchitectureWorld.y>uSkyTrainGuidewayHeight.y
  && vArchitectureWorld.y<uSkyTrainGuidewayHeight.z
  && (vArchitectureWorld.x-uSkyTrainGuidewayFrame.x)*uSkyTrainGuidewayFrame.z-(vArchitectureWorld.z-uSkyTrainGuidewayFrame.y)*uSkyTrainGuidewayFrame.w>uSkyTrainGuidewayBounds.x
  && (vArchitectureWorld.x-uSkyTrainGuidewayFrame.x)*uSkyTrainGuidewayFrame.z-(vArchitectureWorld.z-uSkyTrainGuidewayFrame.y)*uSkyTrainGuidewayFrame.w<uSkyTrainGuidewayBounds.y
  && (vArchitectureWorld.x-uSkyTrainGuidewayFrame.x)*uSkyTrainGuidewayFrame.w+(vArchitectureWorld.z-uSkyTrainGuidewayFrame.y)*uSkyTrainGuidewayFrame.z>uSkyTrainGuidewayBounds.z
  && (vArchitectureWorld.x-uSkyTrainGuidewayFrame.x)*uSkyTrainGuidewayFrame.w+(vArchitectureWorld.z-uSkyTrainGuidewayFrame.y)*uSkyTrainGuidewayFrame.z<uSkyTrainGuidewayBounds.w`;

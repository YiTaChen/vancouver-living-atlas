/** Offline reference for one shared rigid-limb shader, not a production renderer.
 * glTF coordinates, metres, radians. Inputs are clamped to this envelope.
 * Apply the SAME deformation to position and normals in color/AO/normal/depth.
 * No AnimationMixer, skeleton, VAT, per-actor materials, or dynamic shadows.
 */
export const MOTION_CONTRACT = Object.freeze({
  version: 'rigid-limb-v1',
  states: ['walk', 'idle', 'look', 'yield'],
  limbIds: { torso: 0, head: 1, armLeft: 2, armRight: 3, legLeft: 4, legRight: 5 },
  maxLimbAngleRad: .42,
  maxHeadYawRad: .75,
  rootLiftRangeM: [0, .051],
  instanceAttributes: ['phaseRadians', 'walkWeight', 'lookYawRadians', 'yieldWeight'],
});
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
export function poseParameters({ phaseRadians = 0, walkWeight = 0, lookYawRadians = 0, yieldWeight = 0 } = {}) {
  const walk = clamp(walkWeight, 0, 1), yielding = clamp(yieldWeight, 0, 1);
  const phase = Number.isFinite(phaseRadians) ? phaseRadians : 0;
  return { phase, walk, yielding, yaw: clamp(lookYawRadians, -.75, .75),
    lift: walk * (.035 + .008 * (1 - Math.cos(2 * phase))) };
}
export function deformVertex(position, normal, limb, pivot, instance = {}) {
  const p = poseParameters(instance);
  let angle = 0;
  if (limb === 2) angle = -.30 * Math.sin(p.phase) * p.walk + .12 * p.yielding;
  if (limb === 3) angle = .30 * Math.sin(p.phase) * p.walk + .12 * p.yielding;
  if (limb === 4) angle = .38 * Math.sin(p.phase) * p.walk;
  if (limb === 5) angle = -.38 * Math.sin(p.phase) * p.walk;
  const v = position.map((value, i) => value - pivot[i]);
  const c = Math.cos(limb === 1 ? p.yaw : angle), s = Math.sin(limb === 1 ? p.yaw : angle);
  const rotate = (a) => limb === 1
    ? [c * a[0] + s * a[2], a[1], -s * a[0] + c * a[2]]
    : [a[0], c * a[1] - s * a[2], s * a[1] + c * a[2]];
  const rotated = rotate(v);
  return { position: rotated.map((value, i) => value + pivot[i] + (i === 1 ? p.lift : 0)), normal: rotate(normal) };
}
export function stateInputs(state, phaseRadians = 0, lookYawRadians = .6) {
  if (!MOTION_CONTRACT.states.includes(state)) throw new RangeError('Unknown pedestrian state');
  return { phaseRadians, walkWeight: state === 'walk' ? 1 : 0,
    lookYawRadians: state === 'look' || state === 'yield' ? lookYawRadians : 0,
    yieldWeight: state === 'yield' ? 1 : 0 };
}

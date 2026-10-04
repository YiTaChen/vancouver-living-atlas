import { loader } from './harness.mjs';
import { ROLE_SURFACE, bindSurface } from './shared-surfaces.mjs';
const load = loader(true);
/** Original constructors evaluated with the narrow reviewed patches in memory.
 * No current source modules, controllers, public files or map files are modified.
 */
export async function makeRoadsterCandidate() {
  const { makeRoadster } = await load('assets/roadster');
  const result = makeRoadster();
  describeBindings(result.group);
  return result;
}
export async function makeInteriorsCandidate(engineFixture) {
  const { PublicInteriors } = await load('interiors');
  const result = new PublicInteriors(engineFixture);
  for (const s of result.sites) for (const root of [s.group,s.envelope]) if (root) describeBindings(root);
  return result;
}
export function describeBindings(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const id = ROLE_SURFACE[o.userData.semanticRole];
    if (id) o.userData.surfaceId = id;
  });
}
/** Opt-in only: supplied textures are shared, caller owns their lifecycle.
 * Existing glass/light/screen/driver skin/fallback material is never rebound.
 */
export function bindCandidateMaps(root, sharedById) {
  const done = new Set();
  root.traverse(o => {
    const id = o.userData?.surfaceId;
    if (!id || !sharedById[id] || done.has(o.material)) return;
    bindSurface(o.material,id,sharedById[id]); done.add(o.material);
  });
  return done.size;
}

import { REVISION } from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import type { SSAOExclusions } from './ssao-exclusions';

type VisibilityHooks = {
  _overrideVisibility?: () => void;
  _restoreVisibility?: () => void;
  _visibilityCache?: unknown[];
};
type VisibilityPass = SSAOPass & VisibilityHooks;

/** This optimization borrows private r185 hooks. Probe their behavior without
 * touching the live scene; function-source matching would break under minifiers.
 * Any unsupported revision/shape/behavior keeps Three's original traversal. */
export function supportsSSAOVisibilityContract(
  pass: SSAOPass,
  revision = REVISION,
): boolean {
  const hooks = pass as VisibilityPass;
  const prototype = SSAOPass.prototype as VisibilityPass;
  if (
    revision !== '185' ||
    typeof hooks._overrideVisibility !== 'function' ||
    typeof hooks._restoreVisibility !== 'function' ||
    hooks._overrideVisibility !== prototype._overrideVisibility ||
    hooks._restoreVisibility !== prototype._restoreVisibility ||
    !Array.isArray(hooks._visibilityCache) ||
    hooks._visibilityCache.length !== 0
  )
    return false;
  const objects = [
    { visible: true, isPoints: true },
    { visible: true, isLine: true },
    { visible: true, isLine2: true },
    { visible: false, isPoints: true },
    { visible: false, isLine: true },
    { visible: false, isLine2: true },
    { visible: true },
    { visible: false },
  ];
  const visibility = objects.map((object) => object.visible);
  const cache: unknown[] = [];
  let traversals = 0;
  const probe = {
    _visibilityCache: cache,
    scene: {
      traverse(visit: (object: (typeof objects)[number]) => void) {
        traversals++;
        objects.forEach(visit);
      },
    },
  };
  try {
    hooks._overrideVisibility.call(probe);
    if (
      traversals !== 1 ||
      probe._visibilityCache !== cache ||
      cache.length !== 3 ||
      !cache.every((object, index) => object === objects[index]) ||
      objects.some((object, index) => object.visible !== (index === 6))
    )
      return false;
    hooks._restoreVisibility.call(probe);
    return (
      traversals === 1 &&
      probe._visibilityCache === cache &&
      Number(cache.length) === 0 &&
      objects.every((object, index) => object.visible === visibility[index])
    );
  } catch {
    return false;
  }
}

/** Keep event-maintained exclusions as the sole visibility owner during an AO
 * draw. They already cover every point/line that upstream would scan for.
 * Suppression is scoped to the synchronous draw, with exact restoration even
 * after failure. No render pass, scene update, shader or draw is removed. */
export function installSSAOVisibility(
  pass: SSAOPass,
  exclusions: SSAOExclusions,
) {
  const hooks = pass as VisibilityPass;
  // Keep exact method identity for restoration; all calls below supply pass.
  // oxlint-disable-next-line typescript/unbound-method
  const originalRender = pass.render;
  const override = hooks._overrideVisibility;
  const restore = hooks._restoreVisibility;
  const cache = hooks._visibilityCache;
  const supported = supportsSSAOVisibilityContract(pass);
  const skip = () => {};
  let restored = false;
  const render: SSAOPass['render'] = (...args) => {
    // A later wrapper may still hold this function after uninstalling it.
    if (restored) return originalRender.apply(pass, args);
    return exclusions.render(() => {
      // A later adapter or nonempty upstream cache invalidates this frame's
      // optimization; preserve its original behavior rather than overwriting it.
      const suppress =
        supported &&
        hooks._overrideVisibility === override &&
        hooks._restoreVisibility === restore &&
        hooks._visibilityCache === cache &&
        cache?.length === 0;
      if (!suppress) return originalRender.apply(pass, args);
      hooks._overrideVisibility = skip;
      hooks._restoreVisibility = skip;
      try {
        return originalRender.apply(pass, args);
      } finally {
        hooks._overrideVisibility = override;
        hooks._restoreVisibility = restore;
      }
    });
  };
  pass.render = render;
  return {
    optimized: supported,
    restore() {
      if (restored) return;
      restored = true;
      // Do not erase a later independently installed wrapper.
      if (pass.render === render) pass.render = originalRender;
    },
  };
}

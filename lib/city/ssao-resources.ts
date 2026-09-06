import type * as THREE from 'three';
import type { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

interface Owner {
  textures: Set<THREE.Texture>;
  restores: Set<() => void>;
}
const owners = new WeakMap<SSAOPass, Owner>();
/** Independent, visually neutral r185 disposal fix; safe to install without candidate B. */
export function trackSSAOResources(pass: SSAOPass): Owner {
  const existing = owners.get(pass);
  if (existing) return existing;
  const owner = {
    textures: new Set<THREE.Texture>([pass.noiseTexture]),
    restores: new Set<() => void>(),
  };
  const originalDispose = pass.dispose;
  let disposed = false;
  pass.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const restore of [...owner.restores]) restore();
    try {
      originalDispose.call(pass);
    } finally {
      // Three r185's own SSAOPass.dispose omits these two resources.
      owner.textures.forEach((texture) => texture.dispose());
      owner.textures.clear();
      pass.ssaoMaterial.dispose();
    }
  };
  owners.set(pass, owner);
  return owner;
}

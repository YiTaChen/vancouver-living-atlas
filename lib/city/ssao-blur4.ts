import type { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

/** 16 bilinear taps spanning one complete 4x4 noise period; avoids a repeating ground grid. */
export function installSSAOBlur4(pass: SSAOPass): () => void {
  const material = pass.blurMaterial,
    original = material.fragmentShader;
  const replacements = [
    ['for ( int i = - 2; i <= 2; i ++ )', 'for ( int i = - 2; i < 2; i ++ )'],
    ['for ( int j = - 2; j <= 2; j ++ )', 'for ( int j = - 2; j < 2; j ++ )'],
    [
      '( vec2( float( i ), float( j ) ) ) * texelSize',
      '( vec2( float( i ), float( j ) ) + vec2( 0.5 ) ) * texelSize',
    ],
    ['result / ( 5.0 * 5.0 )', 'result / ( 4.0 * 4.0 )'],
  ];
  let shader = original;
  for (const [from, to] of replacements) {
    if (
      !shader.includes(from) ||
      shader.indexOf(from) !== shader.lastIndexOf(from)
    )
      throw new Error(
        'SSAO blur shader changed; update the Three r185 blur integration',
      );
    shader = shader.replace(from, to);
  }
  material.fragmentShader = shader;
  material.needsUpdate = true;
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    material.fragmentShader = original;
    material.needsUpdate = true;
  };
}

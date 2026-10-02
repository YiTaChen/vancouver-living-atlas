import * as THREE from 'three';
import manifest from '../../../tools/assets/vegetation-runtime-candidate/manifest.json';

export const TREE_MATERIAL_CANDIDATE = manifest;
export type TreeMaterialCandidate = 'baseline' | 'leaf-rgba';
type Shader = Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];

/** The same straight-alpha contract is installed in visible and shadow passes.
 * Existing solid crown geometry retains its coverage and uses a measured opaque
 * interior sample in the new atlas. No neutral-RGB unmatting is performed. */
export function installCandidateLeaf(shader: Shader) {
  shader.uniforms.uTreeCandidateSolidUV = {
    value: manifest.solidSamples.map(
      (sample) => new THREE.Vector2(...sample.uv),
    ),
  };
  shader.vertexShader =
    'attribute float aSolid; varying float vSolid;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvSolid=aSolid;',
  );
  shader.fragmentShader =
    'varying float vSolid; uniform vec2 uTreeCandidateSolidUV[4];\n' +
    shader.fragmentShader;
  const sampling = THREE.ShaderChunk.map_fragment
    .replace(
      'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
      `int leafCell=int(clamp(floor(vMapUv.x*2.),0.,1.)+2.*clamp(floor((1.-vMapUv.y)*2.),0.,1.));
      vec2 leafUv=mix(vMapUv,uTreeCandidateSolidUV[leafCell],vSolid);
      vec4 sampledDiffuseColor=texture2D(map,leafUv);`,
    )
    .replace(
      'diffuseColor *= sampledDiffuseColor;',
      'sampledDiffuseColor.a=mix(sampledDiffuseColor.a,1.,vSolid);\ndiffuseColor *= sampledDiffuseColor;',
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    sampling,
  );
}

/** Lazy opt-in asset, one GPU texture with five authored coverage mips. Three's
 * WebGL2 immutable allocation uses mipmaps.length (1024 through 64); no driver
 * generated tail or separately allocated mip-reference textures are introduced. */
export class TreeLeafCandidate {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'disposed' = 'idle';
  materials: {
    leaf: THREE.MeshStandardMaterial;
    depth: THREE.MeshDepthMaterial;
  } | null = null;
  private pending: Promise<boolean> | null = null;
  private settle: ((ready: boolean) => void) | null = null;
  constructor(
    private host: { extraTextures: Set<THREE.Texture>; disposed?: boolean },
  ) {}

  load(): Promise<boolean> {
    if (this.pending) return this.pending;
    if (this.status === 'disposed' || this.host.disposed)
      return Promise.resolve(false);
    this.status = 'loading';
    const texture = new THREE.Texture();
    texture.name =
      'Candidate straight RGBA foliage with authored coverage mips';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.premultiplyAlpha = false;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 1;
    this.host.extraTextures.add(texture);
    const images: HTMLImageElement[] = [];
    let loaded = 0;
    this.pending = new Promise((resolve) => {
      this.settle = resolve;
      const fail = () => {
        if (this.status !== 'loading') return;
        this.status = 'failed';
        resolve(false);
      };
      const loader = new THREE.ImageLoader();
      manifest.files.forEach((file, index) => {
        loader.load(
          `/__offline-assets/vegetation_ground/maps/${file.file}?v=${file.sha256.slice(0, 12)}`,
          (image) => {
            if (this.status !== 'loading' || this.host.disposed) {
              resolve(false);
              return;
            }
            if (image.width !== file.size || image.height !== file.size) {
              fail();
              return;
            }
            images[index] = image;
            if (++loaded !== manifest.files.length) return;
            texture.image = images[0];
            // WebGLTextures' regular-texture upload accepts TexImageSource mips.
            // @types/three currently lists canvas but omits HTMLImageElement;
            // keep the original straight-RGBA images (canvas would premultiply
            // and discard the intentionally extended RGB under zero alpha).
            texture.mipmaps = images as unknown as THREE.Texture['mipmaps'];
            texture.needsUpdate = true;
            const leaf = new THREE.MeshStandardMaterial({
              map: texture,
              alphaTest: manifest.alphaCutoff,
              side: THREE.DoubleSide,
              vertexColors: true,
              roughness: 0.92,
            });
            const depth = new THREE.MeshDepthMaterial({
              map: texture,
              alphaTest: manifest.alphaCutoff,
              side: THREE.DoubleSide,
              depthPacking: THREE.RGBADepthPacking,
            });
            leaf.onBeforeCompile = depth.onBeforeCompile = installCandidateLeaf;
            leaf.customProgramCacheKey = () =>
              'tree-candidate-straight-rgba-leaf-v1';
            depth.customProgramCacheKey = () =>
              'tree-candidate-straight-rgba-depth-v1';
            this.materials = { leaf, depth };
            this.status = 'ready';
            resolve(true);
          },
          undefined,
          fail,
        );
      });
    });
    return this.pending;
  }

  dispose(sceneOwnsMaterials = false) {
    if (this.status === 'disposed') return;
    this.status = 'disposed';
    this.settle?.(false);
    if (!sceneOwnsMaterials) {
      this.materials?.leaf.dispose();
      this.materials?.depth.dispose();
    }
    this.materials = null;
  }
}

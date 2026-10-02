import * as THREE from 'three';
import manifest from '../../public/materials/city/manifest.json';

/** One authored catalogue for building, street and architectural detail maps.
 * Values in the manifest describe original representative materials, not surveys.
 * Runtime ownership stays with the engine's texture set, including failed loads. */
export const CITY_MATERIAL_MANIFEST = manifest;
export const CITY_MATERIAL_SLOT = Object.fromEntries(
  manifest.materials.map((material, index) => [material.id, index]),
) as Record<string, number>;

type MaterialHost = {
  extraTextures: Set<THREE.Texture>;
  disposed?: boolean;
};
export interface CityMaterialLibrary {
  color: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
  ready: THREE.IUniform<number>;
}
const libraries = new WeakMap<MaterialHost, CityMaterialLibrary>();

/** Three atlas textures per engine. Individual materials never dispose them. */
export function getCityMaterialLibrary(
  host: MaterialHost,
): CityMaterialLibrary {
  const cached = libraries.get(host);
  if (cached) return cached;
  const ready = { value: 0 },
    loader = new THREE.TextureLoader();
  let loaded = 0;
  const texture = (name: keyof typeof manifest.files, color = false) => {
    const result = loader.load(
      `/materials/city/${name}.png?v=${manifest.files[name].sha256.slice(0, 12)}`,
      () => {
        loaded++;
        if (loaded === 3 && !host.disposed) ready.value = 1;
      },
      undefined,
      () => {
        // All slots retain their catalogue appearance if a map is unavailable.
        ready.value = 0;
      },
    );
    result.name = `Shared city material ${name}`;
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.wrapS = result.wrapT = THREE.ClampToEdgeWrapping;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.magFilter = THREE.LinearFilter;
    // The shader controls the footprint and fades before padded slot edges can
    // mix. Anisotropic samples could reach beyond that explicit guard.
    result.anisotropy = 1;
    host.extraTextures.add(result);
    return result;
  };
  const library = {
    color: texture('color', true),
    normal: texture('normal'),
    orm: texture('orm'),
    ready,
  };
  libraries.set(host, library);
  return library;
}

/** Pixel-centre inset for a manifest slot; row zero is the lower UV row.
 * Exposed for CPU validation of atlas borders and mip footprint policy. */
export function cityMaterialRect(
  slot: number,
): [number, number, number, number] {
  const { width, height, columns, slotSize, padding } = manifest.atlas;
  const id = Math.max(
    0,
    Math.min(manifest.materials.length - 1, Math.floor(slot)),
  );
  const x = (id % columns) * slotSize + padding + 0.5;
  const y = Math.floor(id / columns) * slotSize + padding + 0.5;
  return [
    x / width,
    y / height,
    (slotSize - 2 * padding - 1) / width,
    (slotSize - 2 * padding - 1) / height,
  ];
}
export const CITY_MATERIAL_DETAIL_FADE = [2, 6] as const;
// Atlas texels disappear before their padding becomes unsafe. The much larger
// physical courses survive until an entire brick/plank is smaller than a pixel.
export const CITY_MATERIAL_COURSE_FADE = [1, 2] as const;
export const CITY_MATERIAL_COURSE_CONTRAST = 0.14;
function coursePattern(pattern: string): [number, number, number] {
  switch (pattern) {
    case 'brick':
      return [8, 24, 1];
    case 'paver':
      return [8, 16, 1];
    case 'shingle':
      return [4, 8, 1];
    case 'cladding':
      return [0, 8, 2];
    default:
      return [0, 0, 0];
  }
}

type Shader = Parameters<THREE.MeshStandardMaterial['onBeforeCompile']>[0];
/** GLSL contract shared by bodies, relief and paving. Metre coordinates remain
 * unwrapped for derivatives; fract is used only after those derivatives exist.
 * At a six-texel footprint a filtered physical-course approximation replaces
 * atlas detail before padded slot edges can bleed. Normals become neutral;
 * stone, concrete, paint and asphalt retain their exact catalogue average. */
export function installCityMaterialLibrary(
  shader: Shader,
  library: CityMaterialLibrary,
) {
  if (shader.uniforms.uCityColor) return;
  shader.uniforms.uCityColor = { value: library.color };
  shader.uniforms.uCityNormal = { value: library.normal };
  shader.uniforms.uCityORM = { value: library.orm };
  shader.uniforms.uCityReady = library.ready;
  shader.uniforms.uCityTileMeters = {
    value: manifest.materials.map((m) => new THREE.Vector2(...m.tileMeters)),
  };
  shader.uniforms.uCityAverageColor = {
    value: manifest.materials.map((m) =>
      new THREE.Color().setRGB(
        m.averageColor[0],
        m.averageColor[1],
        m.averageColor[2],
        THREE.SRGBColorSpace,
      ),
    ),
  };
  shader.uniforms.uCityRoughMetal = {
    value: manifest.materials.map(
      (m) => new THREE.Vector2(m.roughness, m.metalness),
    ),
  };
  shader.uniforms.uCityRects = {
    value: manifest.materials.map(
      (_, i) => new THREE.Vector4(...cityMaterialRect(i)),
    ),
  };
  shader.uniforms.uCityCoursePattern = {
    value: manifest.materials.map(
      (m) =>
        new THREE.Vector4(
          ...coursePattern(m.pattern),
          [...m.id].reduce((sum, c) => sum + c.charCodeAt(0), 0),
        ),
    ),
  };
  const count = manifest.materials.length;
  const useful = manifest.atlas.slotSize - 2 * manifest.atlas.padding - 1;
  shader.fragmentShader =
    `
uniform sampler2D uCityColor, uCityNormal, uCityORM;
uniform float uCityReady;
uniform vec2 uCityTileMeters[${count}], uCityRoughMetal[${count}];
uniform vec3 uCityAverageColor[${count}];
uniform vec4 uCityRects[${count}], uCityCoursePattern[${count}];
// Integral of a periodic mortar strip. Box filtering preserves thin courses
// without enlarging them to a pixel or introducing distant high-contrast lines.
float cityStripeIntegral(float phase,float width) {
  return floor(phase)*width+min(fract(phase),width);
}
float cityFilteredJoint(float phase,float footprint,float halfWidth) {
  float width=max(footprint,.0001);
  float center=fract(phase)+halfWidth;
  return clamp((cityStripeIntegral(center+width*.5,halfWidth*2.)
    -cityStripeIntegral(center-width*.5,halfWidth*2.))/width,0.,1.);
}
vec3 cityCourseColor(int id,vec2 tileUV,vec2 dx,vec2 dy) {
  vec3 mean=uCityAverageColor[id];
  vec4 pattern=uCityCoursePattern[id];
  if(pattern.z<.5) return mean;
  vec2 course=tileUV*pattern.xy;
  // This is fwidth of the UNWRAPPED physical course coordinates. Derivatives
  // arrive from outside every branch, including the atlas texture-fetch guard.
  vec2 width=abs(dx*pattern.xy)+abs(dy*pattern.xy);
  float footprint=max(width.x,width.y);
  float courseDetail=1.-smoothstep(${CITY_MATERIAL_COURSE_FADE[0]}.0,${CITY_MATERIAL_COURSE_FADE[1]}.0,footprint);
  if(courseDetail<=.001) return mean;
  float row=floor(course.y);
  vec2 halfJoint=clamp(vec2(.00325)*pattern.xy/uCityTileMeters[id],vec2(.006),vec2(.065));
  if(pattern.z>1.5) halfJoint.y=.0275;
  float horizontal=cityFilteredJoint(course.y,width.y,halfJoint.y);
  float joint=horizontal, expected=halfJoint.y*2.;
  float shifted=course.x+mod(row,2.)*.5;
  if(pattern.z<1.5) {
    float vertical=cityFilteredJoint(shifted,width.x,halfJoint.x);
    joint=1.-(1.-horizontal)*(1.-vertical);
    expected=1.-(1.-halfJoint.x*2.)*(1.-halfJoint.y*2.);
  }
  vec2 cell=vec2(mod(floor(shifted),max(1.,pattern.x)),mod(row,pattern.y));
  float seed=sin(cell.x*7.13+cell.y*13.17+pattern.w)*.5+.5;
  // Seed variation fades sooner than the analytically filtered joints, avoiding
  // pixel-sized randomly sampled tiles. All contrast remains within +/-14%.
  float seedDetail=1.-smoothstep(.45,1.,footprint);
  float variation=(seed-.5)*.12*seedDetail-(joint-expected)*.11;
  return mean*(1.+clamp(variation,-${CITY_MATERIAL_COURSE_CONTRAST},${CITY_MATERIAL_COURSE_CONTRAST})*courseDetail);
}
struct CitySurface { vec3 color; vec3 normal; float roughness; float metalness; vec2 tileUV; };
CitySurface citySurface(float slot, vec2 metres) {
  int id=int(clamp(floor(slot+.5),0.0,${count - 1}.0));
  vec2 tileUV=metres/uCityTileMeters[id];
  vec2 dx=dFdx(tileUV), dy=dFdy(tileUV);
  float footprint=max(length(dx),length(dy))*${useful}.0;
  float detail=(1.0-smoothstep(${CITY_MATERIAL_DETAIL_FADE[0]}.0,${CITY_MATERIAL_DETAIL_FADE[1]}.0,footprint))*uCityReady;
  CitySurface surface;
  surface.color=uCityAverageColor[id];
  if(detail<.999) surface.color=cityCourseColor(id,tileUV,dx,dy);
  surface.normal=vec3(0,0,1);
  surface.roughness=uCityRoughMetal[id].x;
  surface.metalness=uCityRoughMetal[id].y;
  surface.tileUV=tileUV;
  // Coherent distance/readiness guard: far fragments do not fetch any atlas.
  // Explicit gradients were computed above, outside this conditional flow.
  if(detail>.001) {
    vec4 rect=uCityRects[id];
    vec2 atlasUV=rect.xy+fract(tileUV)*rect.zw;
    vec3 color=textureGrad(uCityColor,atlasUV,dx*rect.zw,dy*rect.zw).rgb;
    vec3 mapNormal=textureGrad(uCityNormal,atlasUV,dx*rect.zw,dy*rect.zw).rgb*2.0-1.0;
    vec3 orm=textureGrad(uCityORM,atlasUV,dx*rect.zw,dy*rect.zw).rgb;
    surface.color=mix(surface.color,color,detail);
    surface.normal=normalize(mix(surface.normal,mapNormal,detail));
    surface.roughness=mix(surface.roughness,orm.g,detail);
    surface.metalness=mix(surface.metalness,orm.b,detail);
  }
  return surface;
}
vec3 citySurfaceNormal(CitySurface surface, vec3 viewPosition, vec3 surfaceNormal, float strength) {
  vec3 q0=dFdx(viewPosition), q1=dFdy(viewPosition);
  vec2 st0=dFdx(surface.tileUV), st1=dFdy(surface.tileUV);
  vec3 q1perp=cross(q1,surfaceNormal), q0perp=cross(surfaceNormal,q0);
  vec3 tangent=q1perp*st0.x+q0perp*st1.x;
  vec3 bitangent=q1perp*st0.y+q0perp*st1.y;
  float determinant=max(dot(tangent,tangent),dot(bitangent,bitangent));
  float scale=determinant>0.0?inversesqrt(determinant):0.0;
  float facing=gl_FrontFacing?1.0:-1.0;
  mat3 frame=mat3(tangent*scale*facing,bitangent*scale*facing,surfaceNormal);
  vec3 mapNormal=normalize(vec3(surface.normal.xy*strength,surface.normal.z));
  return normalize(frame*mapNormal);
}
` + shader.fragmentShader;
}

/** Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) Canada Place gallery/atrium and PTFE-style material study.
 * Metres in existing building-local axes. No renderer, DOM, texture downloads,
 * engine or per-frame loop. Keep the original five sail/rigging geometry.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
type P = readonly [number, number, number];
export const CANADA_DETAIL_CONTRACT = {
  placement: { lon: -123.111352, lat: 49.2886214, yaw: -1.073, baseY: 3.5 },
  originalHall: { min: [-32, 1.3, -91], max: [33, 25.7, 90] },
  originalSideGlass: {
    x: [-33.2, 34.2],
    z: [-90.5, 89.5],
    bands: [
      [3.15, 7.05],
      [9.35, 13.25],
      [17.35, 23.65],
    ],
  },
  atrium: { x: [-26.3, 27.7], y: [5.5, 22.5], mouthZ: -91, glazingZ: -89.95 },
  gallerySlabUndersideY: 16.7,
  fixedPierDeckY: 1.3,
  originalEnvelopeBoxes: [
    { min: [-32, 1.3, -91], max: [33, 25.7, 90] },
    { min: [-42.3, 16.7, -95.5], max: [-32.5, 17.5, 94.5] },
    { min: [33.5, 16.7, -95.5], max: [43.3, 17.5, 94.5] },
  ],
  changes:
    'True north atrium aperture; side glazing recessed behind existing frames; high gallery soffits only. No new sea-level obstruction.',
  surveyStatus:
    'Original architectural interpretation within retained source geometry; not a measured restoration model.',
} as const;
class Batch {
  material: THREE.MeshStandardMaterial;
  parts: THREE.BufferGeometry[] = [];
  constructor(
    readonly role: string,
    roughness: number,
    metalness: number,
    readonly nightIntensity = 0,
  ) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness,
      metalness,
      emissive: nightIntensity ? 0xe8d3b0 : 0,
      emissiveIntensity: 0,
    });
  }
  add(source: THREE.BufferGeometry, color: number) {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    for (const name of Object.keys(g.attributes))
      if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    if (!g.hasAttribute('normal')) g.computeVertexNormals();
    const c = new THREE.Color(color),
      colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
  }
  box(size: P, center: P, color: number) {
    this.add(new THREE.BoxGeometry(...size).translate(...center), color);
  }
  quad(a: P, b: P, c: P, d: P, color: number, n: P) {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      cv = new THREE.Vector3(...c);
    const reverse =
      bv
        .sub(av)
        .cross(cv.sub(av))
        .dot(new THREE.Vector3(...n)) < 0;
    const g = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        reverse
          ? [...a, ...c, ...b, ...a, ...d, ...c]
          : [...a, ...b, ...c, ...a, ...c, ...d],
        3,
      ),
    );
    g.computeVertexNormals();
    this.add(g, color);
  }
  beam(a: P, b: P, radius: number, color: number, sides = 6) {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      d = bv.clone().sub(av),
      length = d.length();
    if (length < 1e-8) return;
    const g = new THREE.CylinderGeometry(radius, radius, length, sides)
      .applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          d.normalize(),
        ),
      )
      .translate(...av.lerp(bv, 0.5).toArray());
    this.add(g, color);
  }
  finish(group: THREE.Group) {
    if (!this.parts.length) {
      this.material.dispose();
      return;
    }
    const g = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!g) throw new Error('Canada detail merge failed');
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.name = `Canada Place detail / ${this.role}`;
    mesh.userData.role = this.role;
    mesh.castShadow = this.role !== 'glazing' && this.role !== 'light';
    mesh.receiveShadow = this.role !== 'light';
    group.add(mesh);
    if (this.nightIntensity) {
      this.material.userData.nightIntensity = this.nightIntensity;
      group.userData.nightMaterials.push({
        material: this.material,
        intensity: this.nightIntensity,
      });
    }
  }
}

/** Contains a REPLACEMENT hall shell, six side glazing bands and north atrium.
 * Remove the corresponding original closed mass/glass fields before adding it.
 * Existing columns, gallery slabs, mullions, all five sails and rigging remain. */
export function createCanadaGalleryDetail(detail: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Canada Place / gallery and atrium replacement';
  group.userData.nightMaterials = [];
  const solid = new Batch('hall shell and soffit', 0.79, 0.025);
  const metal = new Batch('window returns and fixings', 0.41, 0.47);
  const glass = new Batch('glazing', 0.24, 0.35, 0.17);
  const light = new Batch('light', 0.57, 0, 0.58);
  const WHITE = 0xe5e6dc;
  const front = (
    batch: Batch,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z: number,
    color: number,
  ) =>
    batch.quad(
      [x0, y0, z],
      [x1, y0, z],
      [x1, y1, z],
      [x0, y1, z],
      color,
      [0, 0, -1],
    );
  const side = (
    batch: Batch,
    x: number,
    z0: number,
    z1: number,
    y0: number,
    y1: number,
    sign: number,
    color: number,
  ) =>
    batch.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color, [
      sign,
      0,
      0,
    ]);

  // Same65x24.4x181m hall as the old box, but its north wall now has an actual
  //54x17m opening. No prism/cap behind the glazing can hide the recess.
  for (const [x, sign] of [
    [-32, -1],
    [33, 1],
  ])
    side(solid, x, -91, 90, 1.3, 25.7, sign, WHITE);
  solid.quad(
    [-32, 1.3, 90],
    [33, 1.3, 90],
    [33, 25.7, 90],
    [-32, 25.7, 90],
    WHITE,
    [0, 0, 1],
  );
  solid.quad(
    [-32, 25.7, -91],
    [33, 25.7, -91],
    [33, 25.7, 90],
    [-32, 25.7, 90],
    WHITE,
    [0, 1, 0],
  );
  solid.quad(
    [-32, 1.3, -91],
    [33, 1.3, -91],
    [33, 1.3, 90],
    [-32, 1.3, 90],
    WHITE,
    [0, -1, 0],
  );
  front(solid, -32, -26.3, 1.3, 25.7, -91, WHITE);
  front(solid, 27.7, 33, 1.3, 25.7, -91, WHITE);
  front(solid, -26.3, 27.7, 1.3, 5.5, -91, WHITE);
  front(solid, -26.3, 27.7, 22.5, 25.7, -91, WHITE);
  for (const [x, sign] of [
    [-26.3, 1],
    [27.7, -1],
  ])
    side(solid, x, -91, -89.92, 5.5, 22.5, sign, 0xb7c1bf);
  solid.quad(
    [-26.3, 22.5, -91],
    [27.7, 22.5, -91],
    [27.7, 22.5, -89.92],
    [-26.3, 22.5, -89.92],
    0x9eaaa8,
    [0, -1, 0],
  );
  solid.quad(
    [-26.3, 5.5, -91],
    [27.7, 5.5, -91],
    [27.7, 5.5, -89.92],
    [-26.3, 5.5, -89.92],
    0xc7cfcb,
    [0, 1, 0],
  );

  // Recess the side panes0.68m behind the retained existing vertical frame grid.
  // All glass stays outside the opaque hall core, so its depth is actually seen.
  for (const sign of [-1, 1]) {
    const face = sign < 0 ? -32 : 33,
      outer = face + sign * 1.2,
      inner = face + sign * 0.52;
    const cuts = [-90.5];
    for (let z = -88; z <= 89; z += detail ? 3 : 6) cuts.push(z);
    if (cuts.at(-1)! < 89.5) cuts.push(89.5);
    const bands = CANADA_DETAIL_CONTRACT.originalSideGlass.bands;
    for (const [index, [bottom, top]] of bands.entries()) {
      for (let j = 1; j < cuts.length; j++) {
        const z0 = cuts[j - 1] + 0.055,
          z1 = cuts[j] - 0.055;
        side(
          glass,
          inner,
          z0,
          z1,
          bottom + 0.03,
          top - 0.03,
          sign,
          (j + index) % 5 ? 0x476974 : 0x537580,
        );
        for (const [z, direction] of [
          [z0, 1],
          [z1, -1],
        ])
          solid.quad(
            [outer, bottom, z],
            [inner, bottom, z],
            [inner, top, z],
            [outer, top, z],
            0xc4cecb,
            [0, 0, direction],
          );
        solid.quad(
          [outer, top, z0],
          [outer, top, z1],
          [inner, top, z1],
          [inner, top, z0],
          0xaebbb7,
          [0, -1, 0],
        );
        solid.quad(
          [outer, bottom, z0],
          [outer, bottom, z1],
          [inner, bottom, z1],
          [inner, bottom, z0],
          0xcdd3cc,
          [0, 1, 0],
        );
        if (detail) {
          metal.box(
            [0.055, top - bottom - 0.1, 0.035],
            [inner + sign * 0.027, (bottom + top) / 2, z0 + 0.04],
            0x6c8588,
          );
          if (index === 2)
            metal.box(
              [0.06, 0.075, z1 - z0],
              [inner + sign * 0.03, 20.48, (z0 + z1) / 2],
              0x829697,
            );
        }
      }
    }

    // Panelized soffit stays directly below the already-existing high gallery
    // slab. It adds no new low obstacle or protruding marine pier foundation.
    const center = sign * 37.9 + 0.5,
      slabLeft = center - 4.9,
      slabRight = center + 4.9;
    solid.quad(
      [slabLeft + 0.025, 16.693, -95.43],
      [slabRight - 0.025, 16.693, -95.43],
      [slabRight - 0.025, 16.693, 94.43],
      [slabLeft + 0.025, 16.693, 94.43],
      0x738982,
      [0, -1, 0],
    );
    const columns = detail ? 3 : 2,
      rows = detail ? 48 : 24,
      w = 9.72 / columns,
      l = 189.82 / rows;
    for (let i = 0; i < columns; i++)
      for (let j = 0; j < rows; j++) {
        const x = slabLeft + 0.04 + (i + 0.5) * w,
          z = -95.41 + (j + 0.5) * l;
        solid.box(
          [w - 0.025, 0.055, l - 0.03],
          [x, 16.6575, z],
          (i + j) % 4 ? 0xc3cbc6 : 0xb7c1bb,
        );
      }
    for (let z = -88; z <= 90; z += 12) {
      solid.box([9.5, 0.35, 0.34], [center, 16.425, z], 0xd3d9d0);
      // Small bearing heads align to existing columns; no duplicate columns.
      solid.box([0.88, 0.21, 1.0], [sign * 40.5 + 0.5, 16.525, z], 0xc1cbc3);
      if (detail)
        for (const dx of [-0.32, 0.32])
          for (const dz of [-0.34, 0.34])
            metal.beam(
              [sign * 40.5 + 0.5 + dx, 16.39, z + dz],
              [sign * 40.5 + 0.5 + dx, 16.35, z + dz],
              0.023,
              0x7f9290,
              6,
            );
      if ((z + 88) % 24 === 0) {
        metal.box([0.46, 0.06, 1.05], [center, 16.31, z], 0x758a87);
        light.box([0.32, 0.026, 0.82], [center, 16.268, z], 0xe0d9be);
      }
    }
    // Recessed drainage/shadow channel along the inner soffit edge.
    solid.box(
      [0.085, 0.055, 188.9],
      [face + sign * 1.78, 16.61, -0.5],
      0x5a716e,
    );
    // Explicit envelope metadata is tested; original galley overhang may extend
    // beyond the pier polygon, but no new projection is introduced here.
  }

  // North atrium window wall at original x/y bounds, now1.05m inside its mouth.
  const cuts = Array.from(
      { length: (detail ? 18 : 9) + 1 },
      (_, i) => -26.3 + (i * 54) / (detail ? 18 : 9),
    ),
    levels = [5.5, 10.9, 16.5, 22.5];
  for (let j = 1; j < levels.length; j++)
    for (let i = 1; i < cuts.length; i++)
      front(
        glass,
        cuts[i - 1] + 0.07,
        cuts[i] - 0.07,
        levels[j - 1] + 0.055,
        levels[j] - 0.055,
        -89.95,
        (i + j) % 4 ? 0x344f5b : 0x476771,
      );
  for (const x of cuts)
    metal.box([0.115, 16.9, 0.2], [x, 14, -90.84], 0xb1c2c0);
  for (const y of levels)
    metal.box([54.12, 0.12, 0.22], [0.7, y, -90.86], 0xc1cdca);
  for (const x of [-26.3, 27.7])
    solid.box([0.28, 17.2, 0.2], [x, 14, -91.02], 0xd8ddd1);
  for (const y of [5.5, 22.5])
    solid.box([54.25, 0.25, 0.25], [0.7, y, -91.03], 0xd2dacd);
  // A few shallow inner mullions give the atrium layered shadows; they remain
  // in front of opaque recessed glazing rather than hidden behind it.
  if (detail)
    for (const x of cuts)
      metal.box([0.045, 16.75, 0.05], [x + 0.1, 14, -90.03], 0x687f85);
  for (const x of [-23.2, -11.2, 0.7, 12.6, 24.6]) {
    metal.box([0.1, 0.22, 0.12], [x, 21.95, -90.45], 0x788e8c);
    light.box([0.055, 0.12, 0.04], [x, 21.95, -90.53], 0xdad7ba);
  }
  for (const batch of [solid, metal, glass, light]) batch.finish(group);
  const bounds = new THREE.Box3().setFromObject(group);
  let count = 0;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      count +=
        (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) /
        3;
  });
  Object.assign(group.userData, {
    detail,
    triangleCount: count,
    meshCount: group.children.length,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    contract: CANADA_DETAIL_CONTRACT,
    originalProceduralGeometry: true,
  });
  return group;
}

/** Original single-pass PTFE-like diffuse membrane, not transparent glass.
 * Uses the actual current Three directional light colour/direction for a small
 * backlit diffuse term; no new clock/night uniform or frame update is required.
 * All existing sail positions, UVs, normals, seams and rigging stay unchanged.
 */
export function applyCanadaMembraneMaterial(
  material: THREE.MeshStandardMaterial,
): void {
  material.color.setHex(0xf1f0e7);
  material.roughness = 0.77;
  material.metalness = 0;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  material.forceSinglePass = true;
  material.customProgramCacheKey = () => 'canada-ptfe-membrane-v1';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vCanadaClothUV;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCanadaClothUV=uv;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vCanadaClothUV;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 clothMetric=vCanadaClothUV*vec2(72.0,24.55);
        vec2 clothAA=max(fwidth(clothMetric),vec2(.001));
        float seamD=min(fract(vCanadaClothUV.x*7.0),1.0-fract(vCanadaClothUV.x*7.0))*(72.0/7.0);
        float seamAA=clothAA.x;
        float tape=(1.0-smoothstep(.018,.05+seamAA,seamD))*min(1.0,.07/(seamAA+.002));
        tape*=step(.025,vCanadaClothUV.x)*step(vCanadaClothUV.x,.975);
        float threadFilter=1.0/(1.0+max(clothAA.x,clothAA.y)*700.0);
        float weave=sin(clothMetric.x*487.0)*sin(clothMetric.y*463.0)*threadFilter;
        float edgeLoad=exp(-min(vCanadaClothUV.x,1.0-vCanadaClothUV.x)*11.0)*exp(-abs(vCanadaClothUV.y-.5)*3.0);
        float tensionRipple=sin(vCanadaClothUV.y*175.0+vCanadaClothUV.x*19.0)*edgeLoad;
        float canadaBumpHeight=weave*.000035+tensionRipple*.0013;
        diffuseColor.rgb*=1.0-tape*.018+weave*.008;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec3 clothDpdx=dFdx(-vViewPosition),clothDpdy=dFdy(-vViewPosition);
        vec3 clothRx=cross(clothDpdy,normal),clothRy=cross(normal,clothDpdx);
        float clothDet=dot(clothDpdx,clothRx);
        vec3 clothGrad=sign(clothDet)*(dFdx(canadaBumpHeight)*clothRx+dFdy(canadaBumpHeight)*clothRy)/max(abs(clothDet),.000001);
        float clothGradLen=length(clothGrad);
        normal=normalize(normal-clothGrad*min(1.0,.10/max(clothGradLen,.00001)));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+tape*.07-weave*.018,0.0,1.0);',
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float clothBack=pow(max(0.0,dot(-normal,directionalLights[0].direction)),1.35);
          reflectedLight.indirectDiffuse+=diffuseColor.rgb*directionalLights[0].color*(.038*clothBack);
        #endif`,
      );
  };
  material.userData.canadaMembrane = {
    originalProceduralMaterial: true,
    geometryDisplacement: false,
    transparent: false,
    backScatterApproximation: true,
    sourceUVsRetained: true,
    metreScaleIsApproximate: true,
  };
  material.needsUpdate = true;
}

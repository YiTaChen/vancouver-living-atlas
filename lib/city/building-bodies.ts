import * as THREE from 'three';
import type { CityEngine } from './engine';
import { rings, project } from './geo';
import { replacedBuilding } from './replaced-buildings';
import { FacadeDetails } from './facade-details';
import { installArchitectureSurface } from './architecture-material';
import { selectFlatRoofFinish } from './building-surface-palette';
import {
  getCityMaterialLibrary,
  installCityMaterialLibrary,
} from './material-library';
import {
  planPitchedRoof,
  pitchedRoofTriangles,
  roofFrame,
  type PitchedRoof,
} from './building-roof';
import {
  createProfile,
  facadeTemplates,
  fitBays,
  groundGlazing,
  structureKey,
  summarizeStructures,
  type Part,
  type Profile,
} from './facade-profile';

/** One measured body and one shared facade definition per source structure.
 * All added patterns are representative architecture; source footprints/heights
 * are retained. Parts above a podium keep the same metre-based floor phase. */
export function createBuildingBodies(e: CityEngine) {
  const parts: Part[] = [];
  const prepared: {
    key: string;
    polygon: [number, number][][];
    center: [number, number];
    h: number;
    min: number;
    sourceRoof: unknown;
    sourceDataset: unknown;
    hasSourceHeight: boolean;
  }[] = [];
  for (const f of e.data.buildings.features) {
    const p = f.properties,
      h = Math.max(2, Number(p.height ?? p.hgt_agl ?? 8)),
      min = Math.max(0, Number(p.minHeight) || 0);
    if (!Number.isFinite(h) || h > 350 || min >= h || replacedBuilding(p))
      continue;
    for (const raw of rings(f)) {
      const polygon = raw.map((r) => r.slice(0, -1).map(project)),
        ring = polygon[0];
      if (ring.length < 3) continue;
      const center: [number, number] = [
        ring.reduce((n, q) => n + q[0], 0) / ring.length,
        ring.reduce((n, q) => n + q[1], 0) / ring.length,
      ];
      const area =
        Math.abs(
          ring.reduce((n, a, i) => {
            const b = ring[(i + 1) % ring.length];
            return n + a[0] * b[1] - b[0] * a[1];
          }, 0),
        ) / 2;
      const key = structureKey(
        p,
        ring
          .map((q) => q.map((n) => n.toFixed(3)).join(','))
          .sort()
          .join(';'),
      );
      parts.push({
        structureId: key,
        heightM: h,
        minHeightM: min,
        footprintAreaM2: area,
        center,
      });
      prepared.push({
        key,
        polygon,
        center,
        h,
        min,
        sourceRoof: p.roof,
        sourceDataset: p.source,
        hasSourceHeight: Number.isFinite(Number(p.height ?? p.hgt_agl)),
      });
    }
  }
  const firstByKey = new Map<string, (typeof prepared)[number]>();
  for (const part of prepared)
    if (!firstByKey.has(part.key)) firstByKey.set(part.key, part);
  const structures = summarizeStructures(parts),
    profiles = new Map<string, Profile>(),
    foundations = new Map<string, number>();
  for (const [key, structure] of structures) {
    profiles.set(key, createProfile(structure));
    // Keep the previous foundation datum. Choosing a larger podium for style
    // classification must not lift or lower an existing compound building.
    const first = firstByKey.get(key)!;
    foundations.set(key, e.elevation(...first.center) - 0.4);
  }
  const partCounts = new Map<string, number>();
  for (const part of prepared)
    partCounts.set(part.key, (partCounts.get(part.key) ?? 0) + 1);
  const buildingRoofs = new Map<string, PitchedRoof>();
  for (const part of prepared) {
    if (!part.hasSourceHeight) continue;
    const roof = planPitchedRoof(
      part.polygon,
      part.h,
      part.min,
      part.sourceRoof,
      part.sourceDataset,
      partCounts.get(part.key)!,
    );
    if (roof) buildingRoofs.set(part.key, roof);
  }
  e.data.buildingRoofs = buildingRoofs;
  e.data.flightBuildingVolumes = prepared.map(({ key, polygon, h, min }) => ({
    polygon,
    minY: foundations.get(key)! + min,
    maxY: foundations.get(key)! + h,
  }));
  e.data.buildingProfiles = profiles;
  e.data.buildingFoundations = foundations;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    uv: number[] = [],
    styles: number[] = [],
    layouts: number[] = [],
    tops: number[] = [],
    seeds: number[] = [],
    roofFinishes: number[] = [],
    baseWindows: number[] = [];
  for (const { key, polygon, h, min } of prepared) {
    // Normalize the projected copy before choosing facade edges and roof phase.
    // Source feature coordinates remain untouched.
    for (const ring of polygon) {
      const area = ring.reduce((s, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return s + p[0] * q[1] - q[0] * p[1];
      }, 0);
      if (area < 0) ring.reverse();
    }
    const profile = profiles.get(key)!,
      roofFinish = selectFlatRoofFinish(profile.kind, profile.seed),
      ground = foundations.get(key)!,
      color = new THREE.Color(profile.wallColor),
      roof = buildingRoofs.get(key),
      wallTop = roof?.eaveHeight ?? h,
      frame = roofFrame(polygon[0]),
      roofLayout: [number, number, number, number] = [
        ...frame.axis,
        ...frame.origin,
      ];
    const vertex = (
      x: number,
      y: number,
      z: number,
      nx: number,
      ny: number,
      nz: number,
      u: number,
      v: number,
      layout: readonly [number, number, number, number],
      baseWindow: readonly [number, number] = [0, 0],
    ) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      const shade = ny > 0.5 ? 0.82 : 1;
      colors.push(color.r * shade, color.g * shade, color.b * shade);
      uv.push(u, v);
      styles.push(profile.styleIndex);
      seeds.push(profile.seed);
      roofFinishes.push(roofFinish);
      layouts.push(...layout);
      tops.push(wallTop);
      baseWindows.push(...baseWindow);
    };
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          length = Math.hypot(dx, dz);
        if (length < 0.01) continue;
        const grid = fitBays(profile, length),
          nx = dz / length,
          nz = -dx / length,
          grades = [0, 0.25, 0.5, 0.75, 1].map(
            (t) =>
              e.data.roadRelief(
                a[0] + dx * t + nx * 0.5,
                a[1] + dz * t + nz * 0.5,
              ) + 1.18,
          ),
          doorBottom = Math.max(...grades) - ground + 0.02,
          baseWindow = groundGlazing(
            profile,
            { minHeightM: min, heightM: wallTop },
            ground,
            grades,
          );
        for (const [x, y, z, u, v] of [
          [a[0], ground + min, a[1], 0, min],
          [b[0], ground + wallTop, b[1], length, wallTop],
          [b[0], ground + min, b[1], length, min],
          [a[0], ground + min, a[1], 0, min],
          [a[0], ground + wallTop, a[1], 0, wallTop],
          [b[0], ground + wallTop, b[1], length, wallTop],
        ])
          vertex(
            x,
            y,
            z,
            nx,
            0,
            nz,
            u,
            v,
            [grid.pitchM, grid.originM, grid.count, min],
            // A representative opaque domestic door panel on one deterministic
            // long wall; it does not create an entrance or alter collision.
            profile.kind === 'domestic-cladding' &&
              min === 0 &&
              i === frame.edge &&
              grid.count > 0 &&
              doorBottom >= 0 &&
              doorBottom + 2.25 < wallTop &&
              Math.max(...grades) - Math.min(...grades) < 0.18
              ? [
                  grid.originM +
                    (Math.floor(grid.count / 2) + 0.5) * grid.pitchM,
                  -1 - doorBottom,
                ]
              : baseWindow,
          );
      }
    }
    if (roof) {
      for (const triangle of pitchedRoofTriangles(roof, ground)) {
        const [a, , b] = triangle.vertices;
        const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const grid = fitBays(profile, length);
        for (const [x, y, z] of triangle.vertices) {
          const u = length > 0 ? Math.hypot(x - a[0], z - a[2]) : 0;
          vertex(
            x,
            y,
            z,
            ...triangle.normal,
            triangle.roof ? -1 : u,
            triangle.roof ? -2 : y - ground,
            triangle.roof
              ? roofLayout
              : [grid.pitchM, grid.originM, grid.count, min],
          );
        }
      }
    } else {
      const shapes = polygon.map((r) => r.map((p) => new THREE.Vector2(...p))),
        flat = shapes.flat();
      for (const t of THREE.ShapeUtils.triangulateShape(
        shapes[0],
        shapes.slice(1),
      ))
        for (const i of [t[0], t[2], t[1]])
          vertex(flat[i].x, ground + h, flat[i].y, 0, 1, 0, -1, -1, roofLayout);
    }
  }
  const materialLibrary = getCityMaterialLibrary(e);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (s) => {
    s.uniforms.uNight = e.uniforms.night;
    s.uniforms.uPattern = {
      value: facadeTemplates.map(
        (p) =>
          new THREE.Vector4(
            p.storeyM,
            p.groundStoreyM,
            p.wallRoughness,
            p.glassRoughness,
          ),
      ),
    };
    s.uniforms.uPaneBounds = {
      value: facadeTemplates.map((p) => new THREE.Vector4(...p.pane)),
    };
    s.uniforms.uBrickWeights = {
      value: facadeTemplates.map((p) => p.brickNormalScale),
    };
    s.vertexShader =
      `attribute float aStyle; attribute float aSeed; attribute float aRoofFinish; attribute vec4 aLayout; attribute float aTop; attribute vec2 aBaseWindow;
      varying vec4 vFacade; varying vec4 vLayout; varying float vTop; varying float vRoofFinish; varying vec2 vBaseWindow;\n` +
      s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFacade=vec4(uv,aStyle,aSeed);vLayout=aLayout;vTop=aTop;vRoofFinish=aRoofFinish;vBaseWindow=aBaseWindow;',
    );
    s.fragmentShader =
      `uniform float uNight;
      uniform vec4 uPattern[${facadeTemplates.length}]; uniform vec4 uPaneBounds[${facadeTemplates.length}]; uniform float uBrickWeights[${facadeTemplates.length}];
      varying vec4 vFacade; varying vec4 vLayout; varying float vTop; varying float vRoofFinish; varying vec2 vBaseWindow;\n` +
      s.fragmentShader;
    s.fragmentShader = s.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float facadePane=0.0, facadeLit=0.0, facadeNormal=0.0;
      vec3 architectureGlassReflection=vec3(0.0);
      int facadeStyle=int(clamp(floor(vFacade.z+.5),0.0,${facadeTemplates.length - 1}.0));
      vec4 pattern=uPattern[facadeStyle], bounds=uPaneBounds[facadeStyle];
      // Original metre-scale PBR surfaces share one atlas with street details.
      // Keep the existing pane layout and geographic body; only surfacing changes.
      float citySlot=facadeStyle==0?0.0:(facadeStyle==1?1.0:(facadeStyle==5?3.0:2.0));
      vec2 cityMetres=vFacade.xy;
      if(vFacade.x<0.0){
        citySlot=vFacade.y< -1.5?4.0:7.0;
        cityMetres=vec2(dot(vArchitectureWorld.xz,vLayout.xy),dot(vArchitectureWorld.xz,vec2(-vLayout.y,vLayout.x)))-vLayout.zw;
      }
      CitySurface cityFinish=citySurface(citySlot,cityMetres);
      if(vFacade.x>=0.0){
        vec2 cell=vec2((vFacade.x-vLayout.y)/vLayout.x,(vFacade.y-pattern.y)/pattern.x);
        vec2 grid=fract(cell), aa=max(fwidth(cell)*.8,vec2(.003));
        vec2 cellId=floor(cell);
        float bottom=pattern.y+(cellId.y+bounds.z)*pattern.x;
        float top=pattern.y+(cellId.y+bounds.w)*pattern.x;
        float valid=step(0.0,cellId.x)*step(cellId.x,vLayout.z-1.0)*step(0.0,cellId.y)*step(vLayout.w-.001,bottom)*step(top,vTop+.001);
        facadePane=(smoothstep(bounds.x-aa.x,bounds.x+aa.x,grid.x)-smoothstep(bounds.y-aa.x,bounds.y+aa.x,grid.x))
          *(smoothstep(bounds.z-aa.y,bounds.z+aa.y,grid.y)-smoothstep(bounds.w-aa.y,bounds.w+aa.y,grid.y))*valid;
        float groundAA=max(fwidth(vFacade.y)*.8,.008);
        float lowerPane=(smoothstep(.08-aa.x,.08+aa.x,grid.x)-smoothstep(.92-aa.x,.92+aa.x,grid.x))
          *(smoothstep(vBaseWindow.x-groundAA,vBaseWindow.x+groundAA,vFacade.y)-smoothstep(vBaseWindow.y-groundAA,vBaseWindow.y+groundAA,vFacade.y))
          *step(.1,vBaseWindow.y-vBaseWindow.x)*step(0.0,cellId.x)*step(cellId.x,vLayout.z-1.0);
        facadePane=max(facadePane,lowerPane);
        if(facadeStyle==5 && vBaseWindow.y<-.5){
          float entryBay=floor((vBaseWindow.x-vLayout.y)/vLayout.x);
          facadePane*=1.0-step(abs(cellId.x-entryBay),.1)*step(abs(cellId.y),.1);
        }
        float variation=fract(sin(dot(cellId+vFacade.w,vec2(127.1,311.7)))*43758.5453);
        // The representative building palette owns both hue and reflectance.
        // Authored maps provide variation around their catalogue mean, so the
        // finish is applied once instead of replacing every wall's brightness.
        vec3 wall=diffuseColor.rgb*cityFinish.color/max(uCityAverageColor[int(citySlot)],vec3(.025));
        wall*=mix(.94,1.06,mod(vFacade.w,29.0)/28.0);
        float band=(1.0-smoothstep(.025,.055,grid.y))*step(pattern.y,vFacade.y);
        wall*=1.0-band*(facadeStyle==4?.13:.055);
        vec3 glass=mix(vec3(.075,.14,.165),vec3(.19,.29,.32),smoothstep(.1,.9,grid.y));
        glass*=mix(.9,1.12,variation);
        float blind=step(.79,variation)*(1.0-smoothstep(.34,.7,grid.y));
        glass=mix(glass,vec3(.35,.345,.30),blind*.45);
        diffuseColor.rgb=mix(wall,glass,facadePane);
        diffuseColor.rgb*=mix(.88,1.0,smoothstep(0.0,12.0,vFacade.y));
        facadeLit=facadePane*step(.66,variation)*uNight;
        facadeNormal=uBrickWeights[facadeStyle]*(1.0-facadePane);
      }
    `,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor=mix(cityFinish.roughness,pattern.w,facadePane);`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      metalnessFactor=mix(cityFinish.metalness,.18,facadePane);`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      normal=citySurfaceNormal(cityFinish,-vViewPosition,normal,.72*(1.0-facadePane));`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance+=vec3(1.0,.66,.32)*facadeLit*.8;`,
    );
    installArchitectureSurface(s, e.uniforms);
    installCityMaterialLibrary(s, materialLibrary);
  };
  material.customProgramCacheKey = () => 'atlas-city-bodies-pbr-v2';
  const geometry = e.geometry(positions, normals, colors, uv);
  geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(styles, 1));
  geometry.setAttribute(
    'aRoofFinish',
    new THREE.Float32BufferAttribute(roofFinishes, 1),
  );
  geometry.setAttribute(
    'aLayout',
    new THREE.Float32BufferAttribute(layouts, 4),
  );
  geometry.setAttribute('aTop', new THREE.Float32BufferAttribute(tops, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geometry.setAttribute(
    'aBaseWindow',
    new THREE.Float32BufferAttribute(baseWindows, 2),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Measured building bodies with shared facade profiles';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  e.buildings.add(mesh);
  e.stats.buildings = prepared.length;
  e.facadeDetails = new FacadeDetails(e, foundations);
}

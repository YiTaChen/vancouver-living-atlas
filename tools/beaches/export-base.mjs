import {writeFileSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),get=(f)=>JSON.parse(readFileSync(new URL(f,root),'utf8'));
const {default:Delaunator}=await import(new URL('node_modules/delaunator/index.js',root));
const {cityModule}=await import(new URL('tests/helpers/city-modules.mjs',root));
const {project,rings,inPolygon}=await import(cityModule('geo'));
const polys=get('public/data/land.geojson').features.flatMap(f=>rings(f).map(p=>p.map(r=>r.map(project)))),out=[];
for(let pi=0;pi<polys.length;pi++) {
 const poly=polys[pi],boundary=poly.flat(),xs=poly[0].map(p=>p[0]),zs=poly[0].map(p=>p[1]);
 const xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs),pts=[...boundary];
 for(let x=xmin+22;x<xmax;x+=32)for(let z=zmin+17;z<zmax;z+=32)if(inPolygon([x,z],poly))pts.push([x,z]);
 const tri=Delaunator.from(pts).triangles;
 for(let i=0;i<tri.length;i+=3){const p=[pts[tri[i]],pts[tri[i+1]],pts[tri[i+2]]];if(!inPolygon([(p[0][0]+p[1][0]+p[2][0])/3,(p[0][1]+p[1][1]+p[2][1])/3],poly))continue;out.push({key:`${pi}:${i}`,p});}
}
writeFileSync(new URL('../../work/beach-build/base-terrain.json',import.meta.url),JSON.stringify(out));
console.log(JSON.stringify({baseTriangles:out.length}));

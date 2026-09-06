import {readFileSync,writeFileSync} from 'node:fs';
import {cityModule} from '../../tests/helpers/city-modules.mjs';
const root=new URL('../../',import.meta.url),get=f=>JSON.parse(readFileSync(new URL(f,root),'utf8'));
const {cityRoadGraph}=await import(cityModule('street-layout')),{buildPavement}=await import(cityModule('pavement')),{prepareCauseway}=await import(cityModule('causeway')),{unproject}=await import(cityModule('geo'));
const dem=get('public/data/terrain.json'),[w0,s0,e0,n0]=dem.bounds,w=dem.width,h=dem.height,V=dem.heights;
const elevation=(x,z)=>{const [lon,lat]=unproject(x,z),u=Math.max(0,Math.min(w-1,(lon-w0)/(e0-w0)*(w-1))),v=Math.max(0,Math.min(h-1,(n0-lat)/(n0-s0)*(h-1))),i=Math.min(w-2,Math.floor(u)),j=Math.min(h-2,Math.floor(v)),a=u-i,b=v-j;return Math.max(1.2,(V[j*w+i]*(1-a)+V[j*w+i+1]*a)*(1-b)+(V[(j+1)*w+i]*(1-a)+V[(j+1)*w+i+1]*a)*b);};
const e={data:{roads:get('public/data/roads.geojson'),bridges:get('public/data/bridges.json')},elevation};prepareCauseway(e);
const graph=cityRoadGraph(e.data.roads,get('public/data/trees.json').trees,e.data.causeway.cuts),extension=get('lib/city/street-curb-extensions.json');
const pavement=buildPavement(graph,{exclusions:e.data.causeway.masks,sidewalkExtensions:[{points:extension.points,level:'ground'}],sidewalkWidth:edge=>edge.classes.every(c=>/lane|private|non.city|bikeway/i.test(c))?0:Math.max(2,(edge.corridorWidth-edge.width)/2)});
const triangles=[];
for(const source of [pavement.asphalt,pavement.sidewalks])for(let i=0;i<source.indices.length;i+=3){const pts=source.indices.slice(i,i+3).map(k=>source.vertices[k]);if(pts.some(p=>p[0]<-100&&p[0]>-2500&&p[1]<1500&&p[1]>-3300))triangles.push(pts);}
writeFileSync(new URL('../../work/beach-build/ground-pavement.json',import.meta.url),JSON.stringify(triangles));console.log(JSON.stringify({groundPavementTriangles:triangles.length}));

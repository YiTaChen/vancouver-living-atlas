// Rebuild a local, isolated view of the same procedural model used by the app.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import ts from 'typescript';
const out = 'work/roadster-review';
await mkdir(out, { recursive: true });
for (const f of ['three.module.js', 'three.core.js'])
  await copyFile('node_modules/three/build/' + f, out + '/' + f);
await copyFile(
  'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js',
  out + '/BufferGeometryUtils.js',
);
await copyFile(
  'node_modules/three/examples/jsm/controls/OrbitControls.js',
  out + '/OrbitControls.js',
);
let source = await readFile('lib/city/assets/roadster.ts', 'utf8');
source = source.replace(
  'three/addons/utils/BufferGeometryUtils.js',
  './BufferGeometryUtils.js',
);
await writeFile(
  out + '/roadster.js',
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
);
await writeFile(
  out + '/index.html',
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#b8c6ce;font:14px system-ui}nav{position:absolute;top:15px;left:15px;display:flex;gap:8px}button{padding:10px}canvas{display:block}</style><script type="importmap">{"imports":{"three":"./three.module.js"}}</script></head><body><nav><button id="front">Front</button><button id="rear">Rear</button><button id="side">Side</button><span id="stats"></span></nav><script type="module">
import * as T from 'three';import {OrbitControls} from './OrbitControls.js';import {makeRoadster} from './roadster.js';
const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);renderer.setClearColor(0xb8c6ce);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;document.body.append(renderer.domElement);
const scene=new T.Scene(), camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,100), controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.6,0);camera.position.set(6,3.2,6);
scene.add(new T.HemisphereLight(0xddefff,0x625c53,3));const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(4,7,5);scene.add(sun);const fill=new T.DirectionalLight(0xb2d5ff,1.5);fill.position.set(-4,3,-5);scene.add(fill);
const car=makeRoadster();scene.add(car.group);const floor=new T.Mesh(new T.PlaneGeometry(200,200),new T.MeshStandardMaterial({color:0x9aa6af,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
let triangles=0,draws=0;car.group.traverse(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});document.querySelector('#stats').textContent=draws+' draws / '+triangles+' triangles';
for(const [id,p] of Object.entries({front:[6,3.2,6],rear:[5,2.8,-6],side:[7,1.8,0]})) document.getElementById(id).onclick=()=>{camera.position.set(...p);controls.update()};
function frame(){controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)}frame();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
</script></body></html>`,
);
console.log(
  'Preview built: serve work/roadster-review locally (e.g. python3 -m http.server 3101 --directory work/roadster-review).',
);

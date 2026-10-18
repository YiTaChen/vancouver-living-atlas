// Isolated review of the exact source model consumed by the main city.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import ts from 'typescript';
const out = 'work/tesla-roadster-review';
await mkdir(out, { recursive: true });
for (const name of ['three.module.js', 'three.core.js'])
  await copyFile(`node_modules/three/build/${name}`, `${out}/${name}`);
for (const [folder, name] of [
  ['utils', 'BufferGeometryUtils.js'],
  ['controls', 'OrbitControls.js'],
])
  await copyFile(
    `node_modules/three/examples/jsm/${folder}/${name}`,
    `${out}/${name}`,
  );
for (const name of [
  'tesla-roadster-contract',
  'tesla-roadster-geometry',
  'tesla-roadster',
]) {
  const source = await readFile(`lib/city/assets/${name}.ts`, 'utf8');
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replaceAll(
      'three/addons/utils/BufferGeometryUtils.js',
      './BufferGeometryUtils.js',
    )
    .replace(/(['"])\.\/(tesla-roadster[^'"]+)\1/g, '$1./$2.js$1');
  await writeFile(`${out}/${name}.js`, compiled);
}
await writeFile(
  `${out}/index.html`,
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:13px system-ui;background:#84919b}nav{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:7px;flex-wrap:wrap;align-items:center}button,select{padding:8px}#stats{background:#fffd;padding:8px;border-radius:5px}canvas{display:block}</style><script type="importmap">{"imports":{"three":"./three.module.js"}}</script></head><body><nav><select id="quality"><option>low</option><option selected>medium</option><option>high</option></select><button data-view="front">Front</button><button data-view="three">3/4</button><button data-view="rear">Rear</button><button data-view="side">Side</button><button data-view="cabin">Cabin</button><button data-view="under">Underbody</button><button id="motion">Animate</button><span id="stats"></span></nav><script type="module">
import * as T from 'three';import{OrbitControls}from'./OrbitControls.js';import{createTeslaRoadster}from'./tesla-roadster.js';
const renderer=new T.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));renderer.setClearColor(0x11151b);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;document.body.append(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(36,innerWidth/innerHeight,.025,80),controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.65,0);camera.position.set(5.1,2.4,5.1);scene.add(new T.HemisphereLight(0xdceafa,0x73614d,.8));const sun=new T.DirectionalLight(0xfff4df,2);sun.position.set(3,7,4);scene.add(sun);const fill=new T.DirectionalLight(0xe0eeff,.5);fill.position.set(-3,2,-4);scene.add(fill);
const model=createTeslaRoadster({quality:'medium'});scene.add(model.group);const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x242a32,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
let animated=false;document.querySelector('#quality').onchange=e=>{model.setQuality(e.target.value);report()};document.querySelector('#motion').onclick=()=>{animated=!animated;model.update({thrust:animated?1:0,wingDeploy:animated?1:0})};
const views={front:[[0,.85,7],[0,.65,.4]],three:[[5.1,2.4,5.1],[0,.65,0]],rear:[[4,1.7,-5.6],[0,.65,-.3]],side:[[6.4,1.6,0],[0,.65,0]],cabin:[model.anchors.driverEye,model.anchors.driverLookAt],under:[[3,-3,4],[0,.3,0]]};for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{const[p,t]=views[button.dataset.view];camera.position.set(...p);camera.fov=button.dataset.view==='cabin'?70:36;camera.updateProjectionMatrix();controls.target.set(...t);floor.visible=button.dataset.view!=='under';controls.minDistance=button.dataset.view==='cabin'?0:1;controls.update()};function report(){const s=model.stats();document.querySelector('#stats').textContent=s.quality+' / '+s.meshes+' meshes / '+s.triangles.toLocaleString()+' triangles'}report();
function frame(time){if(animated)model.update({steeringRad:Math.sin(time*.0006)*.3,wheelSpinRad:-time*.003,fanSpinRad:time*.02});controls.update();renderer.render(scene,camera);requestAnimationFrame(frame)}requestAnimationFrame(frame);addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
</script></body></html>`,
);
console.log(`Tesla model preview built in ${out}`);

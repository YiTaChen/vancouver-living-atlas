// Private, reproducible review of origin/main against the current runtime model.
// Run from the repository root. Nothing is emitted to public/ or bundled by Vite.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as THREE from 'three';
import ts from 'typescript';

const root = process.cwd();
const output = path.join(root, 'work/tesla-roadster-comparison');
const baselineRef = process.env.ROADSTER_BASELINE_REF || 'origin/main';
const entry = 'lib/city/assets/tesla-roadster.ts';
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baselineCommit = git('rev-parse', `${baselineRef}^{commit}`);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const posix = (value) => value.split(path.sep).join('/');
const emittedName = (file) =>
  file.endsWith('.json')
    ? `${file}.js`
    : file.replace(/\.(?:tsx?|m?js)$/, '.js');
const evidence = {
  generatedAt: new Date().toISOString(),
  baseline: { ref: baselineRef, commit: baselineCommit, sources: {} },
  candidate: {
    commit: git('rev-parse', 'HEAD'),
    dirtyFiles: git('status', '--short'),
    sources: {},
  },
  normalization: {
    coordinates:
      '+Y up, +Z front, +X driver left, tyre plane Y=0; no recentering or rescaling',
    lighting:
      'identical hemisphere + two directional lights; no HDRI, shadows, SSAO or city postprocessing',
    toneMapping: 'ACESFilmic, exposure 1.05, sRGB output',
    pixelRatioCap: 1.5,
    camera:
      'shared camera for exterior/section and matched-eye views; native-eye inspection uses each model contract eye/lookAt with identical 70 degree FOV and equal viewports, explicitly labeled',
    cameraPresets: {
      three: [
        [8.8, 3.4, 8.8],
        [0, 0.6, 0],
      ],
      front: [
        [0, 1.15, 9],
        [0, 0.6, 0],
      ],
      rear: [
        [7.6, 2.6, -10.6],
        [0, 0.6, 0],
      ],
      side: [
        [10.8, 2.25, 0],
        [0, 0.6, 0],
      ],
      roof: [
        [4.4, 4.4, 1.9],
        [0, 0.5, -0.2],
      ],
      under: [
        [6, -6, 8],
        [0, 0.3, 0],
      ],
    },
    roofSection:
      'same world-space Y<=0.94m clipping plane; not a physical roof animation',
    costs:
      'CPU geometry counts, not measured FPS or frame time; renderer counters include floor and both views in split mode',
  },
};
await mkdir(output, { recursive: true });

async function copyVendor(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await readFile(
    path.join(root, 'node_modules/three', file),
    'utf8',
  );
  const target = path.join(output, 'vendor/three', file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
  const imports = source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g);
  for (const [, specifier] of imports)
    await copyVendor(
      posix(path.normalize(path.join(path.dirname(file), specifier))),
      seen,
    );
}
const vendorSeen = new Set();
await copyVendor('build/three.module.js', vendorSeen);
await copyVendor('examples/jsm/controls/OrbitControls.js', vendorSeen);

async function buildGraph(label) {
  const record = evidence[label];
  const pending = new Map();
  const read =
    label === 'baseline'
      ? async (file) =>
          execFileSync('git', ['show', `${baselineCommit}:${file}`], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
      : async (file) => readFile(path.join(root, file), 'utf8');
  async function resolve(importer, specifier) {
    const base = posix(
      path.normalize(path.join(path.dirname(importer), specifier)),
    );
    if (base.startsWith('../') || path.isAbsolute(base))
      throw new Error(`Import escapes repository: ${importer} -> ${specifier}`);
    const candidates = /\.(?:tsx?|m?js|json)$/.test(base)
      ? [base, base.replace(/\.js$/, '.ts')]
      : [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}.js`,
          `${base}.mjs`,
          `${base}.json`,
          `${base}/index.ts`,
        ];
    for (const candidate of new Set(candidates)) {
      try {
        return { file: candidate, source: await read(candidate) };
      } catch {
        /* Try TS/JSON resolution candidates. */
      }
    }
    throw new Error(
      `Unresolved ${label} dependency: ${importer} -> ${specifier}`,
    );
  }
  async function visit(file, source) {
    if (pending.has(file)) return;
    // Mark before traversing so circular imports are handled without waiting on themselves.
    pending.set(file, true);
    source ??= await read(file);
    record.sources[file] = {
      sha256: sha256(source),
      bytes: Buffer.byteLength(source),
      gzipBytes: gzipSync(source).byteLength,
      dependencies: [],
    };
    const target = path.join(output, label, emittedName(file));
    await mkdir(path.dirname(target), { recursive: true });
    if (file.endsWith('.json')) {
      await writeFile(
        target,
        `export default ${JSON.stringify(JSON.parse(source))};\n`,
      );
      return;
    }
    let compiled = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        resolveJsonModule: true,
      },
    }).outputText;
    const ast = ts.createSourceFile(
      file + '.js',
      compiled,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const imports = [];
    function walk(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier
      ) {
        imports.push({
          literal: node.moduleSpecifier,
          attributes: node.attributes,
        });
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        imports.push({ literal: node.arguments[0] });
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
    const edits = [];
    for (const { literal, attributes } of imports) {
      const specifier = literal.text;
      if (specifier.startsWith('.')) {
        const dependency = await resolve(file, specifier);
        record.sources[file].dependencies.push(dependency.file);
        await visit(dependency.file, dependency.source);
        let relative = posix(
          path.relative(
            path.dirname(emittedName(file)),
            emittedName(dependency.file),
          ),
        );
        if (!relative.startsWith('.')) relative = `./${relative}`;
        edits.push({
          start: literal.getStart(ast),
          end: literal.end,
          text: JSON.stringify(relative),
        });
        if (attributes)
          edits.push({
            start: attributes.getStart(ast),
            end: attributes.end,
            text: '',
          });
      } else if (specifier.startsWith('three/addons/')) {
        await copyVendor(
          `examples/jsm/${specifier.slice('three/addons/'.length)}`,
          vendorSeen,
        );
      } else if (specifier !== 'three') {
        throw new Error(
          `Unsupported browser dependency: ${file} -> ${specifier}`,
        );
      }
    }
    for (const edit of edits.sort((a, b) => b.start - a.start))
      compiled =
        compiled.slice(0, edit.start) + edit.text + compiled.slice(edit.end);
    await writeFile(target, compiled);
  }
  await visit(entry);
  record.moduleCount = pending.size;
  record.sourceBytes = Object.values(record.sources).reduce(
    (sum, value) => sum + value.bytes,
    0,
  );
  record.independentlyGzippedSourceBytes = Object.values(record.sources).reduce(
    (sum, value) => sum + value.gzipBytes,
    0,
  );
  record.jsonDependencies = Object.entries(record.sources)
    .filter(([file]) => file.endsWith('.json'))
    .map(([file, source]) => ({
      file,
      bytes: source.bytes,
      gzipBytes: source.gzipBytes,
      sha256: source.sha256,
    }));
  const modelModule = await import(
    pathToFileURL(path.join(output, label, emittedName(entry))).href
  );
  const model = modelModule.createTeslaRoadster({ quality: 'low' });
  record.dimensions = model.dimensions;
  record.anchors = model.anchors;
  record.provenance = modelModule.TESLA_ROADSTER_PROVENANCE;
  record.qualities = {};
  for (const quality of ['low', 'medium', 'high']) {
    model.setQuality(quality);
    model.update({
      steeringRad: 0,
      wheelSpinRad: 0,
      fanSpinRad: 0,
      thrust: 0,
      vortexThrust: 0,
      wingDeploy: 0,
      brake: 0,
      night: false,
    });
    model.group.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    const geometries = new Set();
    let batches = 0,
      geometryBytes = 0,
      vertices = 0;
    model.group.traverseVisible((object) => {
      if (!object.isMesh) return;
      const geometry = object.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bounds.union(
        geometry.boundingBox.clone().applyMatrix4(object.matrixWorld),
      );
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      batches += geometry.groups.length
        ? geometry.groups.filter(
            (group) =>
              group.count > 0 &&
              materials[group.materialIndex]?.visible !== false,
          ).length
        : 1;
      if (geometries.has(geometry)) return;
      geometries.add(geometry);
      vertices += geometry.attributes.position.count;
      const arrays = new Set();
      for (const attribute of Object.values(geometry.attributes))
        arrays.add(attribute.data?.array || attribute.array);
      if (geometry.index) arrays.add(geometry.index.array);
      for (const array of arrays) geometryBytes += array.byteLength;
    });
    record.qualities[quality] = {
      ...model.stats(),
      visibleGeometryBatches: batches,
      uniqueGeometryBytes: geometryBytes,
      uniqueVertices: vertices,
      renderedBounds: {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: bounds.getSize(new THREE.Vector3()).toArray(),
      },
    };
  }
  model.dispose();
}

await buildGraph('baseline');
await buildGraph('candidate');
evidence.framingProof = {
  viewport: [640, 720],
  fov: 36,
  conservativeContractBoxes: true,
  views: {},
};
for (const view of ['three', 'front', 'rear', 'side']) {
  const [position, target] = evidence.normalization.cameraPresets[view];
  const camera = new THREE.PerspectiveCamera(36, 640 / 720, 0.025, 80);
  camera.position.fromArray(position);
  camera.lookAt(new THREE.Vector3().fromArray(target));
  camera.updateMatrixWorld();
  const corners = [];
  for (const label of ['baseline', 'candidate']) {
    const [x, y, z] = evidence[label].dimensions.halfExtents;
    for (const px of [-x, x])
      for (const py of [0, y * 2])
        for (const pz of [-z, z])
          corners.push(new THREE.Vector3(px, py, pz).project(camera));
  }
  const maxX = Math.max(...corners.map((point) => Math.abs(point.x)));
  const maxY = Math.max(...corners.map((point) => Math.abs(point.y)));
  if (maxX > 0.9 || maxY > 0.6)
    throw new Error(`Insufficient common camera framing margin: ${view}`);
  evidence.framingProof.views[view] = {
    maxNdcX: maxX,
    maxNdcY: maxY,
    minHorizontalMarginPx: (1 - maxX) * 320,
    minVerticalMarginPx: (1 - maxY) * 360,
  };
}
await writeFile(
  path.join(output, 'evidence.json'),
  JSON.stringify(evidence, null, 2) + '\n',
);
const rows = [
  '| Model | Quality | Triangles | Meshes | Geometry batches | Geometry bytes |',
  '|---|---|---:|---:|---:|---:|',
];
for (const label of ['baseline', 'candidate'])
  for (const [quality, stat] of Object.entries(evidence[label].qualities))
    rows.push(
      `| ${label} | ${quality} | ${stat.triangles} | ${stat.meshes} | ${stat.visibleGeometryBatches} | ${stat.uniqueGeometryBytes} |`,
    );
const startupRows = [
  '| Model | TS/JSON source bytes | Independently gzipped source bytes | JSON dependencies (raw / gzip bytes) |',
  '|---|---:|---:|---|',
];
for (const label of ['baseline', 'candidate']) {
  const record = evidence[label];
  startupRows.push(
    `| ${label} | ${record.sourceBytes} | ${record.independentlyGzippedSourceBytes} | ${record.jsonDependencies.map((item) => `${path.basename(item.file)}: ${item.bytes} / ${item.gzipBytes}`).join('; ') || 'none'} |`,
  );
}
await writeFile(
  path.join(output, 'REPORT.md'),
  `# Generated comparison evidence\n\nBaseline: ${baselineRef} (${baselineCommit}). Candidate: working tree at ${evidence.candidate.commit}.\n\n${rows.join('\n')}\n\nThese are CPU geometry/resource counts, not FPS or GPU timing. Geometry bytes cover active unique BufferGeometry attribute/index arrays; shared materials, textures, JavaScript objects and cached inactive tiers are excluded. Full hashes, anchors, dimensions, bounds, fixed camera presets and 640x720 framing proof are in evidence.json. Browser render counters additionally include the floor and both views in split mode.\n\n## Startup representation audit\n\n${startupRows.join('\n')}\n\nSource bytes/gzip are measured on these individual TS/JSON files, not the production minified bundle or an observed network transfer. Candidate JSON is statically imported: all packed LOD strings are parsed with its containing city chunk, and only the selected tier is synchronously decoded into typed arrays on first use. Later tier visits reuse cached geometry. Baseline has smaller procedural source and no equivalent JSON payload. No browser startup latency, GPU timings or FPS were measured by this tool.\n`,
);

await writeFile(
  path.join(output, 'index.html'),
  `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Roadster 2026｜同條件模型比較</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#11151b;color:#edf1f4;font:13px system-ui,sans-serif}canvas{display:block;width:100vw;height:100vh}header{position:absolute;inset:12px 12px auto;display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:10px;background:#111b25ed;border:1px solid #8296a644;border-radius:10px;max-width:1280px}strong{margin-right:6px}button,select{font:inherit;color:inherit;background:#233343;border:1px solid #638198;border-radius:5px;padding:7px 9px;cursor:pointer}button[aria-pressed=true]{background:#dbe9f0;color:#152430;border-color:#fff}label{display:flex;gap:5px;align-items:center}.separator{width:1px;height:24px;background:#71839377}.hint{flex-basis:100%;color:#a9bdcb;font-size:12px;line-height:1.5}#labels{position:absolute;left:0;right:0;top:148px;display:flex;pointer-events:none}#labels span{width:50%;padding:8px;text-align:center;font-weight:600;text-shadow:0 1px 5px #000;background:#131c2780}#labels span:only-child{width:100%}#evidence{position:absolute;left:12px;right:12px;bottom:12px;max-width:1150px;background:#111b25ed;border:1px solid #8296a644;border-radius:10px;padding:10px;line-height:1.55;pointer-events:none}#stats{display:flex;gap:18px;flex-wrap:wrap}#stats b{color:#dcebf5}#metrics,#camera-note{color:#a9bdcb;font-size:12px}#error{position:absolute;inset:180px 20px auto;padding:18px;background:#531c1c;white-space:pre-wrap;display:none}a{color:#b8defa}#evidence a{pointer-events:auto}.divider{position:absolute;top:140px;bottom:0;left:50%;width:1px;background:#d7e5ef77;pointer-events:none}@media(max-width:760px){header{inset:6px 6px auto;gap:5px;padding:7px}button,select{padding:6px}#labels{top:220px}#evidence{font-size:11px;inset:auto 6px 6px}.divider{top:220px}.hint{font-size:11px}}
</style><script type="importmap">{"imports":{"three":"./vendor/three/build/three.module.js","three/addons/":"./vendor/three/examples/jsm/"}}</script></head>
<body><header><strong>Roadster 2026 同條件比較</strong><button data-mode="baseline">整合前</button><button data-mode="candidate">整合後</button><button data-mode="split">並排</button><span class="separator"></span><label>品質<select id="quality"><option value="low">低 L</option><option value="medium" selected>中 M</option><option value="high">高 H</option></select></label><button data-view="three">前 3/4</button><button data-view="front">正前</button><button data-view="rear">車尾</button><button data-view="side">車側</button><button data-view="native-eye">座艙 · 各版眼位</button><button data-view="cabin">共同舊眼位</button><button data-view="candidate-eye">共同新眼位</button><button data-view="roof">屋頂剖視</button><button data-view="under">底盤</button><button id="motion" aria-pressed="false">動作檢查</button><span class="hint">相同光線、曝光、鏡位與輪胎接地原點；滑鼠拖曳旋轉、滾輪縮放。屋頂剖視是兩版一致的高度裁切。<a href="./evidence.json" target="_blank">完整測量與來源</a></span></header><div id="labels"></div><div class="divider" hidden></div><section id="evidence"><div id="stats">載入模型…</div><div id="metrics"></div><div id="camera-note"></div></section><div id="error"></div>
<script type="module">
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
try {
  const [before,after,evidence] = await Promise.all([import('./baseline/lib/city/assets/tesla-roadster.js'),import('./candidate/lib/city/assets/tesla-roadster.js'),fetch('./evidence.json').then(r=>r.json())]);
  const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));renderer.setClearColor(0x11151b);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.outputColorSpace=T.SRGBColorSpace;renderer.info.autoReset=false;document.body.prepend(renderer.domElement);
  const camera=new T.PerspectiveCamera(36,1,.025,80),controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;
  const models={baseline:before.createTeslaRoadster({quality:'medium'}),candidate:after.createTeslaRoadster({quality:'medium'})};
  const scenes={},floors={},nativeCameras={};
  for(const label of ['baseline','candidate']){const eyeCamera=new T.PerspectiveCamera(70,1,.025,80);eyeCamera.position.fromArray(models[label].anchors.driverEye);eyeCamera.lookAt(new T.Vector3().fromArray(models[label].anchors.driverLookAt));nativeCameras[label]=eyeCamera;}
  for(const label of ['baseline','candidate']){const scene=new T.Scene();scene.add(new T.HemisphereLight(0xdceafa,0x73614d,.8));const sun=new T.DirectionalLight(0xfff4df,2);sun.position.set(3,7,4);scene.add(sun);const fill=new T.DirectionalLight(0xe0eeff,.5);fill.position.set(-3,2,-4);scene.add(fill);scene.add(models[label].group);const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x242a32,roughness:.95}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);floors[label]=floor;scenes[label]=scene;}
  const views={...evidence.normalization.cameraPresets,'native-eye':[models.baseline.anchors.driverEye,models.baseline.anchors.driverLookAt],cabin:[models.baseline.anchors.driverEye,models.baseline.anchors.driverLookAt],'candidate-eye':[models.candidate.anchors.driverEye,models.candidate.anchors.driverLookAt]};
  const params=new URLSearchParams(location.search);let mode=['baseline','candidate','split'].includes(params.get('mode'))?params.get('mode'):'split',quality=['low','medium','high'].includes(params.get('quality'))?params.get('quality'):'medium',view=Object.hasOwn(views,params.get('view'))?params.get('view'):'three',animated=false,clock=0;
  const section=new T.Plane(new T.Vector3(0,-1,0),.94),names={baseline:'整合前 · origin/main',candidate:'整合後 · 工作樹'};
  function status(){document.querySelector('#quality').value=quality;for(const button of document.querySelectorAll('[data-mode]'))button.setAttribute('aria-pressed',String(button.dataset.mode===mode));for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));document.querySelector('.divider').hidden=mode!=='split';document.querySelector('#labels').innerHTML=(mode==='split'?['baseline','candidate']:[mode]).map(label=>'<span>'+names[label]+'</span>').join('');document.querySelector('#stats').innerHTML=['baseline','candidate'].map(label=>{const s=models[label].stats();return '<span><b>'+names[label]+'</b> · '+quality.toUpperCase()+' · '+s.triangles.toLocaleString()+' 三角形 · '+s.meshes+' meshes · '+s.materials+' 材質</span>'}).join('');document.querySelector('#camera-note').textContent=(view==='native-eye'?'各版原生 driverEye / driverLookAt，固定鏡位、相同 FOV 70°；此模式相機位置不同，請另用共同眼位比較。':view==='roof'?'共同剖面 Y≤0.94 m；這不是實體車頂開啟。':view==='cabin'?'兩版共同使用舊版 driverEye / driverLookAt。':view==='candidate-eye'?'兩版共同使用新版 driverEye / driverLookAt。':'共同鏡位；不縮放模型、不自動重新置中。')+' CPU 幾何計數不代表 FPS；實際城市效能需另測。';const next=new URLSearchParams({mode,quality,view});history.replaceState(null,'','?'+next);}
  function size(){const width=innerWidth,height=innerHeight;renderer.setSize(width,height);camera.aspect=(mode==='split'?width/2:width)/height;camera.updateProjectionMatrix();for(const eyeCamera of Object.values(nativeCameras)){eyeCamera.aspect=camera.aspect;eyeCamera.updateProjectionMatrix();}}
  function preset(){const [position,target]=views[view];camera.position.fromArray(position);controls.target.fromArray(target);camera.fov=view==='cabin'||view==='candidate-eye'?70:36;controls.enabled=view!=='native-eye';controls.minDistance=view==='cabin'||view==='candidate-eye'?0:1;renderer.clippingPlanes=view==='roof'?[section]:[];for(const floor of Object.values(floors))floor.visible=view!=='under';size();controls.update();status();}
  for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>{mode=button.dataset.mode;size();status()};for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;preset()};document.querySelector('#quality').onchange=e=>{quality=e.target.value;for(const model of Object.values(models))model.setQuality(quality);status()};document.querySelector('#motion').onclick=e=>{animated=!animated;e.target.setAttribute('aria-pressed',String(animated));if(!animated){clock=0;for(const model of Object.values(models))model.update({steeringRad:0,wheelSpinRad:0,fanSpinRad:0,thrust:0,wingDeploy:0})}};
  for(const model of Object.values(models))model.setQuality(quality);preset();let previous=0,frames=0;
  function render(time){const dt=previous?Math.min(.05,(time-previous)/1000):0;previous=time;if(animated){clock+=dt;const pose={steeringRad:Math.sin(clock*.6)*.3,wheelSpinRad:-clock*3,fanSpinRad:clock*20,thrust:.65,wingDeploy:1};for(const model of Object.values(models))model.update(pose)}controls.update();renderer.info.reset();renderer.setScissorTest(true);const width=innerWidth,height=innerHeight;if(mode==='split'){const left=Math.floor(width/2);renderer.setViewport(0,0,left,height);renderer.setScissor(0,0,left,height);renderer.render(scenes.baseline,view==='native-eye'?nativeCameras.baseline:camera);renderer.setViewport(left,0,width-left,height);renderer.setScissor(left,0,width-left,height);renderer.render(scenes.candidate,view==='native-eye'?nativeCameras.candidate:camera)}else{renderer.setViewport(0,0,width,height);renderer.setScissor(0,0,width,height);renderer.render(scenes[mode],view==='native-eye'?nativeCameras[mode]:camera)}renderer.setScissorTest(false);document.querySelector('#metrics').textContent='此畫面 renderer.info：'+renderer.info.render.calls+' 繪製呼叫 / '+renderer.info.render.triangles.toLocaleString()+' 三角形（含地板；並排時含兩版） · DPR '+renderer.getPixelRatio();if(++frames===2)document.documentElement.dataset.ready='true';requestAnimationFrame(render)}requestAnimationFrame(render);addEventListener('resize',size);
  window.roadsterComparison={models,evidence,camera,nativeCameras,renderer,getState:()=>({mode,quality,view,animated,camera:camera.position.toArray(),target:controls.target.toArray()})};
} catch(error){const box=document.querySelector('#error');box.style.display='block';box.textContent=String(error.stack||error);document.documentElement.dataset.ready='error';console.error(error)}
</script></body></html>`,
);
console.log(`Comparison built: ${path.relative(root, output)}/index.html`);
console.log(
  `Baseline ${baselineCommit}; candidate ${evidence.candidate.commit}; source hashes and CPU counts: evidence.json`,
);
console.log(
  'Serve repository root with an HTTP server, then open /work/tesla-roadster-comparison/.',
);

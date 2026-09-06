/** Node-only recorder validation. No engine construction, browser or GPU. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../package.json',import.meta.url))('typescript');
const source=fs.readFileSync(new URL('../lib/city/startup-qa.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(){
  let now=0,id=0,overlay=false;
  const raf=new Map(),listeners=new Map();
  const document={hidden:false,addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
  const context={exports:{},URL,Date,Error,Number,Math,document,
    location:{origin:'http://localhost:3100'},window:{devicePixelRatio:2},
    performance:{now:()=>now,timeOrigin:1700000000000,getEntriesByType:kind=>kind==='resource'?[{
      name:'http://localhost:3100/data/terrain.json',startTime:5,duration:30,
      requestStart:6,responseStart:15,responseEnd:35,transferSize:40,encodedBodySize:20,decodedBodySize:30,
    }]:[]},
    requestAnimationFrame:fn=>{raf.set(++id,fn);return id;},cancelAnimationFrame:n=>raf.delete(n)};
  vm.runInNewContext(js,context);
  const e={settings:{quality:'high'},disposed:false,contextLost:false,navigation:{},placement:{},
    container:{clientWidth:1200,clientHeight:800,closest:()=>({querySelector:()=>overlay?{}:null})},
    renderer:{capabilities:{maxTextureSize:16384,maxSamples:4,maxAttributes:16,maxVaryings:30,precision:'highp'},
      extensions:{has:()=>false},getPixelRatio:()=>1.25,
      domElement:{width:1500,height:1000,clientWidth:1200,clientHeight:800,isConnected:true},
      info:{render:{calls:22,triangles:1000}}}};
  const qa=context.exports.createStartupQA();
  return {qa,e,raf,listeners,document,time:t=>now=t,overlay:v=>overlay=v,
    frame:()=>{const queue=[...raf.values()];raf.clear();queue.forEach(f=>f());}};
}
{
  const f=fixture(),{qa,e}=f;
  qa.markAt('react.engine-import.begin',-80);
  f.time(1);qa.begin('constructor.body');qa.begin('renderer');
  f.time(5);qa.end('renderer');qa.phase('data','async-wall');
  f.time(7);qa.end('constructor.body');
  f.time(100);qa.phase('geometry');
  f.time(140);qa.phase('compile','async-wall');
  f.time(180);qa.endPhase();
  qa.reactCommitted(e);assert.equal(f.raf.size,0);
  f.time(190);qa.frameSubmitted(e);qa.frameSubmitted(e);assert.equal(f.raf.size,1);
  f.time(206);f.frame();assert.equal(qa.snapshot().status,'recording');
  f.time(222);f.frame();
  const report=qa.snapshot();
  assert.equal(report.valid,true);assert.equal(report.status,'interactive');
  assert.equal(report.originPerformanceMs,-80);
  assert.equal(report.spans.find(s=>s.name==='data').wallMs,95);
  assert.equal(report.spans.find(s=>s.name==='constructor.body').wallMs,6);
  assert.equal(report.spans.find(s=>s.name==='compile').kind,'async-wall');
  assert.equal(report.marks.filter(m=>m.name==='city.first-frame.submitted').length,1);
  assert.equal(report.dataResources[0].responseEndMs,115);
  assert.equal(report.capabilities.gpuTimerQueryUsed,false);
  assert.equal(f.listeners.size,0);assert.equal(f.raf.size,0);
  f.time(900);assert.equal(qa.snapshot().spans.at(-1).wallMs,40);
}
{
  const f=fixture();f.qa.phase('pending','async-wall');f.time(99);f.qa.fail(new Error('fetch failed'));
  const report=f.qa.snapshot();assert.equal(report.status,'failed');assert.equal(report.valid,false);
  assert.equal(report.spans[0].wallMs,99);assert.equal(report.spans[0].complete,false);
  assert.equal(report.spans[0].interrupted,true);assert.equal(f.listeners.size,0);
}
{
  const f=fixture();f.qa.frameSubmitted(f.e);f.qa.reactCommitted(f.e);assert.equal(f.raf.size,1);
  f.qa.dispose();assert.equal(f.raf.size,0);assert.equal(f.listeners.size,0);assert.equal(f.qa.snapshot().status,'disposed');
}
{
  const f=fixture();f.document.hidden=true;f.listeners.get('visibilitychange')();f.document.hidden=false;
  f.qa.reactCommitted(f.e);f.qa.frameSubmitted(f.e);f.frame();f.frame();
  assert.equal(f.qa.snapshot().valid,false);assert.equal(f.qa.snapshot().hiddenDuringMeasurement,true);
}
{
  const f=fixture();f.overlay(true);f.qa.reactCommitted(f.e);f.qa.frameSubmitted(f.e);f.frame();
  assert.equal(f.qa.snapshot().status,'recording');assert.equal(f.qa.snapshot().valid,false);f.qa.dispose();
}
console.log('PASS: startup phase/backfill, async classification, first-frame/React join, hidden/error/disposal cleanup, overlay guard. No GPU timing was measured.');

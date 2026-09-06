import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../package.json',import.meta.url));
const ts=require('typescript'),THREE=require('three');
const source=fs.readFileSync(new URL('../lib/city/release-qa-observer.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function fixture(kind){
  let now=0,rafId=0;
  const raf=new Map(),events=new Map();
  const document={hidden:false,addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
  const context={exports:{},performance:{now:()=>now},document,
    requestAnimationFrame:fn=>{raf.set(++rafId,fn);return rafId;},cancelAnimationFrame:id=>raf.delete(id),
    setTimeout:()=>1,clearTimeout:()=>{}};
  vm.runInNewContext(js,context);
  const group=new THREE.Group();group.name='test landmark';
  const medium=new THREE.Group();group.add(medium);
  const originalUpdate=function(){
    if(e.settings.quality==='ultra'&&!this.ultra){
      now+=3000;
      this.ultra=new THREE.Group();
      this.ultra.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
      group.add(this.ultra);
    }
    medium.visible=e.settings.quality!=='ultra';
    if(this.ultra)this.ultra.visible=e.settings.quality==='ultra';
  };
  const detail={holder:group,medium,ultra:null,update:originalUpdate};
  const camera=new THREE.PerspectiveCamera();
  const e={landmarkDetails:[detail],disposed:false,clock:{hour:23},uniforms:{night:{value:1}},
    navigation:{position:new THREE.Vector3(),mode:'drive',yaw:0,speed:21,surface:'ground',cameraDistance:10,cameraView:{perspective:'third'},keys:new Set(['w']),update(){}},
    camera,controls:{target:new THREE.Vector3()},settings:{quality:'high'},
    renderer:{domElement:{width:100,height:100,addEventListener(){},removeEventListener(){}},
      info:{render:{triangles:12,calls:1},memory:{geometries:1,textures:0}}},
    renderScene(){detail.update();if(detail.ultra?.visible)detail.ultra.children[0].onAfterRender();}};
  const originalRender=e.renderScene;
  const promise=context.exports.measureReleaseWindow(e,{durationMs:4000,expectedMode:'drive',action:()=>{
    if(kind==='throw')throw new Error('intentional action error');
    e.settings.quality='ultra';
  }});
  if(kind==='throw'){
    await assert.rejects(promise,/intentional action error/);
  }else if(kind==='hidden'){
    document.hidden=true;events.get('visibilitychange')();
    const report=await promise;assert.equal(report.valid,false);assert.equal(report.flags.hidden,true);
  }else{
    now+=16;e.renderScene(); // actual lazy creation stretches first frame to 3016 ms
    const first=[...raf.values()];raf.clear();first.forEach(fn=>fn());
    now=4100;e.navigation.position.x=20;e.renderScene();
    const final=[...raf.values()];raf.clear();final.forEach(fn=>fn());
    const report=await promise;
    assert.equal(report.valid,true);
    assert.equal(report.coldFirst2s.maxMs,3016);
    assert.equal(report.landmarks[0].ultraPresentInitially,false);
    assert.equal(report.landmarks[0].firstAttachedMs,3016);
    assert.equal(report.landmarks[0].firstSubmittedMs,3016);
    assert.equal(report.landmarks[0].constructionMs[0],3000);
    assert.equal(report.traveledMeters,20);
    assert.equal(report.renderCPU.maxMs,3000);
  }
  assert.equal(e.renderScene,originalRender);
  assert.equal(detail.update,originalUpdate);
  assert.equal(raf.size,0);
  assert.equal(events.size,0);
}
await fixture('normal');await fixture('hidden');await fixture('throw');
console.log('PASS: cold first-frame gap/arrival, movement trace, hidden invalidation, action-error cleanup.');

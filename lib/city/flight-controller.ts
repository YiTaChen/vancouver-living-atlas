import * as THREE from 'three';
import type { CityEngine } from './engine';
import { FlightWorld } from './flight-world';
import { createFlight, stepFlight, crashFlight, setFlightCruise, setFlightHover, clamp, type FlightState, type AircraftKind } from './flight-state';
import { project } from './geo';
import { firstVisibleObstacleHit } from './visible-obstacles';
import { makeAircraft, updateAircraftInstruments } from './assets/aircraft-models';
import { EMPTY_FLIGHT, type FlightSnapshot } from './flight-snapshot';
function dispose(root:THREE.Object3D){
  root.removeFromParent();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof THREE.Texture)textures.add(v);}}});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
}
export class FlightController {
  state:FlightState|null=null; world:FlightWorld|null=null; model:ReturnType<typeof makeAircraft>|null=null;
  placing=false; warning=''; distance=28; renderedDistance=28; interior:'cockpit'|'clear'='cockpit';
  lookYaw=0;lookPitch=.18;keys=new Set<string>();touch={x:0,y:0,yaw:0,descend:false};
  private clock=0;private published=0;private accumulator=0;
  private blend:{position:THREE.Vector3;quaternion:THREE.Quaternion;age:number}|null=null;
  private pointers=new Map<number,[number,number]>();private lastPinch=0;
  private drop:{x:number;y:number;id:number;moved:boolean;figure:boolean}|null=null;
  private ring:THREE.Mesh;private effects:{group:THREE.Group;age:number}[]=[];
  onChange:(value:FlightSnapshot)=>void=()=>{};
  constructor(public e:CityEngine){
    this.ring=new THREE.Mesh(new THREE.RingGeometry(6,7,48),new THREE.MeshBasicMaterial({color:0xe0eaa0,side:THREE.DoubleSide,transparent:true,opacity:.85,depthTest:false}));
    this.ring.rotation.x=-Math.PI/2;this.ring.visible=false;e.scene.add(this.ring);
    const c=e.renderer.domElement;
    c.addEventListener('pointerdown',this.down,true);window.addEventListener('pointermove',this.move);window.addEventListener('pointerup',this.up);window.addEventListener('pointercancel',this.cancelPointer);
    c.addEventListener('wheel',this.wheel,{capture:true,passive:false});
    window.addEventListener('keydown',this.keyDown);window.addEventListener('keyup',this.keyUp);window.addEventListener('blur',this.clearInput);document.addEventListener('visibilitychange',this.visibility);
  }
  get attached(){return !!this.state?.attached;}
  get pose(){const s=this.state;return s?.attached?{x:s.x,z:s.z,yaw:Math.PI-s.yaw,following:true}:null;}
  get snapshot():FlightSnapshot {const s=this.state;return{...EMPTY_FLIGHT,exists:!!s&&s.phase!=='crashed',attached:!!s?.attached,placing:this.placing,kind:s?.kind||null,phase:s?.phase||'grounded',power:s?.power||0,altitude:s?Math.round(s.y):0,speed:s?Math.round(s.speed*1.94384):0,cruise:!!s?.cruise,hover:!!s?.hover,join:!!s?.join,view:this.distance<=3?this.interior:'chase',stalled:!!s?.stalled,crashSeconds:s?Math.max(0,Math.ceil(8-s.crashAge)):0,warning:this.warning};}
  notify(){this.onChange(this.snapshot);}
  prepare(){this.world||=new FlightWorld(this.e);}
  beginPlacement(){
    this.clear();this.prepare();this.e.placement?.cancel();this.e.travelReturn?.invalidate(true);
    if(this.e.navigation?.mode!=='orbit')this.e.leaveTravelAtLocation();
    this.e.navigation?.setMode('orbit');this.e.settings.mode='orbit';this.e.settings.autoRotate=false;this.e.controls.autoRotate=false;
    this.placing=true;this.warning='placement';this.notify();this.e.onLocalOrbit();
  }
  cancelPlacement(){this.placing=false;this.ring.visible=false;this.drop=null;this.warning='';this.notify();}
  startDrag(ev:PointerEvent){this.beginPlacement();this.drop={x:ev.clientX,y:ev.clientY,id:ev.pointerId,moved:false,figure:true};}
  pick(sx:number,sy:number,commit=false){
    if(!this.placing||!this.world)return;
    const rect=this.e.renderer.domElement.getBoundingClientRect();if(sx<rect.left||sx>rect.right||sy<rect.top||sy>rect.bottom)return;
    const ray=new THREE.Raycaster();this.e.camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2((sx-rect.left)/rect.width*2-1,1-(sy-rect.top)/rect.height*2),this.e.camera);ray.far=45000;
    const ground=ray.intersectObjects(this.e.placement!.groundMeshes,false)[0];
    let point=ground?.point||null,distance=ground?.distance??Infinity;
    for(const water of [this.e.waterWorld!.sea,...this.e.waterWorld!.surfaces]){
      const p=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-water.level),new THREE.Vector3());
      if(p&&this.e.waterWorld!.at(p.x,p.z)?.id===water.id&&p.distanceTo(ray.ray.origin)<distance){point=p;distance=p.distanceTo(ray.ray.origin);}
    }
    const obstacle=firstVisibleObstacleHit(ray,[this.e.buildings,this.e.landmarks]);
    const launch=point&&(!obstacle||obstacle.distance>=distance-1)?this.world.launch(point.x,point.z):null;
    if(point){this.ring.visible=true;this.ring.position.copy(point);this.ring.position.y+=.25;(this.ring.material as THREE.MeshBasicMaterial).color.set(launch?0xe0eaa0:0xff8b73);}
    this.warning=launch?launch.kind:'invalid';this.notify();if(commit&&launch)this.start(launch.kind,launch.x,launch.y,launch.z,launch.yaw);
  }
  quick(kind:AircraftKind){
    this.prepare();const base=project(kind==='seaplane'?[-123.1225,49.293]:[-123.1128,49.2845]);
    // Deterministic nearby search validates the same road/water clearance as a drop.
    for(let radius=0;radius<=180;radius+=20)for(let i=0;i<16;i++){
      const a=i*Math.PI/8,p=this.world!.launch(base[0]+Math.cos(a)*radius,base[1]+Math.sin(a)*radius);
      if(p?.kind===kind){this.start(kind,p.x,p.y,p.z,p.yaw);return;}
    }
    this.warning='invalid';this.notify();
  }
  start(kind:AircraftKind,x:number,y:number,z:number,yaw=0){
    this.clear();this.prepare();this.e.placement?.cancel();this.e.travelReturn?.invalidate(true);this.e.navigation?.setMode('orbit');
    this.state=createFlight(kind,x,y,z,yaw);this.model=makeAircraft(kind);this.e.scene.add(this.model.group);this.e.camera.add(this.model.cockpit);
    this.placing=false;this.ring.visible=false;this.distance=this.renderedDistance=kind==='helicopter'?24:30;this.lookYaw=0;this.lookPitch=.18;this.warning='';
    this.attach();
  }
  attach(){if(!this.state||this.state.phase==='crashed')return false;
    this.e.placement?.cancel();this.e.completeLocalMapTransition();this.e.transition=null;this.e.navigation?.setMode('orbit');this.e.travelReturn?.invalidate(true);
    this.distance=Math.min(this.distance,80);this.renderedDistance=this.distance;
    this.state.attached=true;this.e.settings.mode='flight';this.e.controls.enabled=false;this.e.controls.autoRotate=false;
    this.blend={position:this.e.camera.position.clone(),quaternion:this.e.camera.quaternion.clone(),age:0};
    this.e.onFlightMode('flight');this.notify();return true;
  }
  detach(){const s=this.state;if(!s)return;
    if(s.phase!=='crashed')this.enableCruise(true);s.attached=false;this.clearInput();this.blend=null;
    if(this.model)this.model.cockpit.visible=false;
    this.e.camera.up.set(0,1,0);this.e.camera.near=2;this.e.camera.fov=48;this.e.camera.updateProjectionMatrix();
    this.e.controls.target.set(s.x,s.y,s.z);this.e.camera.position.set(s.x+170,s.y+230,s.z+210);this.e.controls.enabled=true;this.e.settings.mode='orbit';this.e.controls.update();
    this.e.onLocalOrbit();this.e.onFlightMode('orbit');this.notify();
  }
  clear(){
    if(this.attached){this.e.settings.mode='orbit';this.e.controls.enabled=true;this.e.camera.up.set(0,1,0);this.e.camera.near=2;this.e.camera.updateProjectionMatrix();}
    if(this.model){dispose(this.model.group);dispose(this.model.cockpit);this.model=null;}
    this.state=null;this.placing=false;this.ring.visible=false;this.warning='';this.blend=null;this.clearInput();this.notify();
  }
  setPower(value:number){const s=this.state;if(!s||s.phase==='crashed')return;s.power=clamp(value,0,1);s.hover=false;s.cruise=false;this.notify();}
  enableCruise(enabled:boolean){const s=this.state;if(!s)return;setFlightCruise(s,enabled);if(enabled&&s.kind==='seaplane'&&s.climbing)s.climbYaw=this.world!.climbHeading(s);}
  cruise(){const s=this.state;if(s){this.enableCruise(!s.cruise);this.notify();}}
  hover(){const s=this.state;if(s){setFlightHover(s,!s.hover);this.notify();}}
  setView(v:'cockpit'|'clear'|'chase'){this.interior=v==='clear'?'clear':'cockpit';this.distance=v==='chase'?28:0;this.lookYaw=0;this.lookPitch=v==='chase'?.18:0;this.notify();}
  zoom(factor:number){if(!this.attached||!Number.isFinite(factor)||factor<=0)return;
    this.distance=clamp((this.distance+2)*factor-2,0,200);
    if(this.distance>150){this.detach();return;}this.notify();
  }
  clearInput=()=>{this.keys.clear();this.touch={x:0,y:0,yaw:0,descend:false};this.pointers.clear();this.drop=null;this.lastPinch=0;};
  visibility=()=>{if(document.hidden)this.clearInput();};
  keyDown=(ev:KeyboardEvent)=>{
    if(!this.attached||ev.defaultPrevented||ev.ctrlKey||ev.metaKey||ev.altKey)return;
    if(ev.target instanceof Element&&ev.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="dialog"],[role="listbox"],[role="combobox"]'))return;
    const key=ev.code.replace('Key','').toLowerCase();
    if(!['w','s','a','d','q','e','r','f','x','h','c','arrowup','arrowdown','arrowleft','arrowright'].includes(key))return;
    ev.preventDefault();if(!ev.repeat&&key==='h')this.hover();if(!ev.repeat&&key==='c')this.cruise();this.keys.add(key);
  };
  keyUp=(ev:KeyboardEvent)=>{this.keys.delete(ev.code.replace('Key','').toLowerCase());};
  down=(ev:PointerEvent)=>{
    if(this.placing){if(!this.drop)this.drop={x:ev.clientX,y:ev.clientY,id:ev.pointerId,moved:false,figure:false};return;}
    if(!this.attached||ev.button!==0)return;ev.preventDefault();ev.stopImmediatePropagation();this.e.renderer.domElement.focus({preventScroll:true});this.e.renderer.domElement.setPointerCapture(ev.pointerId);this.pointers.set(ev.pointerId,[ev.clientX,ev.clientY]);this.lastPinch=0;
  };
  move=(ev:PointerEvent)=>{
    if(this.placing&&this.drop){if(Math.hypot(ev.clientX-this.drop.x,ev.clientY-this.drop.y)>6)this.drop.moved=true;if(this.drop.figure)this.pick(ev.clientX,ev.clientY);return;}
    const old=this.pointers.get(ev.pointerId);if(!this.attached||!old)return;
    this.pointers.set(ev.pointerId,[ev.clientX,ev.clientY]);
    if(this.pointers.size>1){const [a,b]=[...this.pointers.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(this.lastPinch>0)this.zoom(this.lastPinch/d);this.lastPinch=d;}
    else{this.lookYaw-=(ev.clientX-old[0])*.005;this.lookPitch=clamp(this.lookPitch+(ev.clientY-old[1])*.004,-1.1,1.15);}
  };
  up=(ev:PointerEvent)=>{if(this.placing&&this.drop?.id===ev.pointerId){const drop=this.drop;this.drop=null;if((!drop.figure&&!drop.moved)||(drop.figure&&drop.moved))this.pick(ev.clientX,ev.clientY,true);}this.pointers.delete(ev.pointerId);this.lastPinch=0;};
  cancelPointer=()=>{this.drop=null;this.pointers.clear();this.lastPinch=0;};
  wheel=(ev:WheelEvent)=>{if(!this.attached||ev.ctrlKey||ev.metaKey)return;ev.preventDefault();ev.stopImmediatePropagation();this.zoom(Math.exp(clamp(ev.deltaY*(ev.deltaMode===1?16:1)*.003,-.6,.6)));};
  private explode(){
    const s=this.state!;crashFlight(s);this.model!.cockpit.visible=false;this.clearInput();
    const group=new THREE.Group();group.position.set(s.x,s.y+2,s.z);this.e.scene.add(group);this.effects.push({group,age:0});
    const geo=new THREE.IcosahedronGeometry(1,1);
    for(let i=0;i<36;i++){const smoke=i>=12,m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:smoke?0x586168:(i%2?0xff9833:0xffd480),transparent:true,opacity:.9,depthWrite:false}));m.userData.smoke=smoke;m.userData.seed=i;group.add(m);}
    this.notify();
  }
  update(rawDt:number){
    const dt=clamp(rawDt,0,.1);this.clock+=dt;
    for(const effect of this.effects){effect.age+=dt;effect.group.children.forEach((obj,i)=>{const m=obj as THREE.Mesh,smoke=i>=12,t=effect.age,a=i*2.399;
      m.position.set(Math.cos(a)*(smoke?2+t*.4:2),smoke?1+(i%6)*1.8+t*.65:Math.sin(t*8+i)*.7,Math.sin(a)*(smoke?2+t*.4:2));m.scale.setScalar(smoke?1.7+t*.22:Math.max(.01,2.5*(1-t/8))*(.8+Math.sin(t*14+i)*.2));(m.material as THREE.MeshBasicMaterial).opacity=Math.max(0,(smoke?.6:.9)*(1-t/(smoke?20:8)));});}
    this.effects=this.effects.filter(effect=>{if(effect.age>=20){dispose(effect.group);return false;}return true;});
    const s=this.state;if(!s)return;
    this.accumulator+=dt;
    if(s.attached&&s.phase!=='crashed'){
      if(this.keys.has('r'))this.setPower(s.power+dt*.25);if(this.keys.has('f'))this.setPower(s.power-dt*.25);
    }
    const held=(a:string,b?:string)=>this.keys.has(a)||!!b&&this.keys.has(b)?1:0;
    const input={pitch:held('s','arrowdown')-held('w','arrowup')-this.touch.y,roll:held('d','arrowright')-held('a','arrowleft')+this.touch.x,yaw:held('e')-held('q')+this.touch.yaw,descend:this.keys.has('x')||this.touch.descend};
    if((Math.abs(input.pitch)+Math.abs(input.roll)+Math.abs(input.yaw)>0.1||input.descend)&&s.attached){s.cruise=false;s.hover=false;}
    while(this.accumulator>=1/60){
      this.accumulator-=1/60;const before=new THREE.Vector3(s.x,s.y,s.z),phase=s.phase;
      stepFlight(s,input,1/60,this.world!.surface);
      if(phase!=='crashed'&&s.phase==='crashed')this.explode();
      if(s.phase!=='crashed'){
        const after=new THREE.Vector3(s.x,s.y,s.z),q=new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch,-s.yaw,-s.roll,'YXZ'));
        const samples=s.kind==='seaplane'?[[0,1.6,0],[0,1.7,-4],[7.1,3,0],[-7.1,3,0],[0,2,4]]:[[0,1.8,0],[5,3.5,0],[-5,3.5,0],[0,3.5,-5],[0,3.5,5],[0,2,6.4]];
        if(samples.some(offset=>{const o=new THREE.Vector3(...offset as [number,number,number]).applyQuaternion(q);return this.world!.hit(before.clone().add(o),after.clone().add(o),.85);})){s.x=before.x;s.y=before.y;s.z=before.z;this.explode();}
        if(!this.world!.supported(s.x,s.z)&&this.warning!=='boundary'){this.enableCruise(true);this.warning='boundary';}
      }
    }
    if(s.phase==='crashed'){
      if(s.attached&&s.crashAge>=8)this.detach();
      if(s.crashAge>=20){this.clear();return;}
    }
    const model=this.model!;
    model.group.position.set(s.x,s.y,s.z);model.group.rotation.set(s.pitch,-s.yaw,-s.roll,'YXZ');
    for(const prop of model.propellers){const axis=prop.userData.spinAxis||'y';if(s.phase!=='crashed')prop.rotation[axis as 'x'|'y'|'z']+=dt*(s.kind==='helicopter'?32:75)*(0.2+s.power);}
    model.group.visible=!(s.attached&&this.distance<=3);
    model.cockpit.visible=s.attached&&s.phase!=='crashed'&&this.distance<=3&&this.interior==='cockpit';
    updateAircraftInstruments(model.instruments,{airspeedKnots:s.speed*1.94384,altitudeMetres:s.y,verticalSpeedMetresPerSecond:s.vy,pitch:s.pitch,roll:s.roll,heading:s.yaw,power:s.power});
    model.stick.rotation.x=-s.pitch*.7;model.stick.rotation.z=-s.roll*.8;
    if(model.rotorBlur)model.rotorBlur.visible=s.phase!=='crashed'&&s.power>.2;
    if(s.attached)this.updateCamera(dt);
    if(this.clock-this.published>.12){this.published=this.clock;this.notify();}
  }
  private updateCamera(dt:number){
    const s=this.state!,camera=this.e.camera;this.renderedDistance=THREE.MathUtils.damp(this.renderedDistance,this.distance,7,dt);
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch,-s.yaw,-s.roll,'YXZ'));
    const pos=new THREE.Vector3(s.x,s.y+(s.kind==='helicopter'?2.0:2.25),s.z);
    let rotation:THREE.Quaternion;
    if(this.distance<=3){
      pos.add(new THREE.Vector3(s.kind==='helicopter'?.45:-.45,0,-1.4).applyQuaternion(q));
      rotation=q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.lookPitch,this.lookYaw,0,'YXZ')));
    }else{
      const a=-s.yaw+this.lookYaw,d=this.renderedDistance;
      pos.add(new THREE.Vector3(Math.sin(a)*Math.cos(this.lookPitch)*d,Math.sin(this.lookPitch)*d+3,Math.cos(a)*Math.cos(this.lookPitch)*d));
      pos.y=Math.max(pos.y,this.world!.surface(pos.x,pos.z).height+2);
      const matrix=new THREE.Matrix4().lookAt(pos,new THREE.Vector3(s.x,s.y+2,s.z),new THREE.Vector3(0,1,0));rotation=new THREE.Quaternion().setFromRotationMatrix(matrix);
    }
    const ground=this.world!.surface(s.x,s.z),vibration=s.impact*.25+(s.stalled?.055:0)+(s.phase==='grounded'&&s.speed>2?(ground.kind==='beach'?.09:.025)*Math.min(s.speed/20,1):0);
    pos.y+=Math.sin(this.clock*53)*vibration;
    if(this.blend){this.blend.age+=dt;const t=Math.min(1,this.blend.age/1.6),u=t*t*(3-2*t);camera.position.lerpVectors(this.blend.position,pos,u);camera.quaternion.slerpQuaternions(this.blend.quaternion,rotation,u);if(t===1)this.blend=null;}
    else{camera.position.copy(pos);camera.quaternion.copy(rotation);}
    camera.near=this.distance<=3?.06:.2;camera.fov=this.distance<=3?64:52;camera.updateProjectionMatrix();
    this.model!.cockpit.quaternion.copy(camera.quaternion).invert().multiply(q);this.e.controls.target.set(s.x,s.y+2,s.z);
  }
  destroy(){this.clear();this.effects.forEach(effect=>dispose(effect.group));this.effects=[];dispose(this.ring);const c=this.e.renderer.domElement;c.removeEventListener('pointerdown',this.down,true);c.removeEventListener('wheel',this.wheel,true);window.removeEventListener('pointermove',this.move);window.removeEventListener('pointerup',this.up);window.removeEventListener('pointercancel',this.cancelPointer);window.removeEventListener('keydown',this.keyDown);window.removeEventListener('keyup',this.keyUp);window.removeEventListener('blur',this.clearInput);document.removeEventListener('visibilitychange',this.visibility);}
}

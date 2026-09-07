/** Assisted sightseeing physics in metres/seconds. Independent of the scene clock. */
export type AircraftKind = 'helicopter' | 'seaplane';
export type FlightSurface = { kind: 'land' | 'water' | 'beach'; height: number };
export type FlightPhase = 'grounded' | 'airborne' | 'crashed';
export interface FlightInput { pitch: number; roll: number; yaw: number; descend: boolean }
export interface FlightState {
  kind: AircraftKind; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; yaw: number; pitch: number; roll: number;
  speed: number; power: number; phase: FlightPhase; cruise: boolean;
  hover: boolean; hoverHeight: number; attached: boolean; stalled: boolean;
  climbYaw: number; climbing: boolean; impact: number; crashAge: number; age: number; join: boolean;
}
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));
const damp = (a: number, b: number, rate: number, dt: number) => a + (b-a)*(1-Math.exp(-rate*dt));
const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const FLIGHT_LOOP = { x: -350, z: -650, rx: 2850, rz: 3000, altitude: 410 };
export function createFlight(kind: AircraftKind, x: number, y: number, z: number, yaw = 0): FlightState {
  return { kind,x,y,z,yaw, vx:0,vy:0,vz:0,pitch:0,roll:0,speed:0,power:0,
    phase:'grounded',cruise:false,hover:false,hoverHeight:y,attached:true,
    stalled:false,climbYaw:yaw,climbing:true,impact:0,crashAge:0,age:0,join:true };
}
export function setFlightCruise(s: FlightState, enabled: boolean) {
  if (s.phase==='crashed') return;
  s.cruise=enabled; s.hover=false; s.join=true;s.climbing=s.y<FLIGHT_LOOP.altitude-15;s.climbYaw=s.yaw;
}
export function setFlightHover(s: FlightState, enabled: boolean) {
  if(s.kind!=='helicopter'||s.phase==='crashed') return;
  s.hover=enabled;s.cruise=false;s.hoverHeight=Math.max(s.y, 2); if(enabled)s.power=0.52;
}
export function crashFlight(s: FlightState) {
  if(s.phase==='crashed')return;
  s.phase='crashed';s.crashAge=0;s.cruise=false;s.hover=false;s.power=0;
  s.vx=s.vy=s.vz=s.speed=0;s.impact=1;
}
export function validLanding(kind:AircraftKind,surface:FlightSurface['kind']) {
  return kind==='helicopter' ? surface!=='water' : surface==='water'||surface==='beach';
}
/** Caller supplies the actual surface at each substep, including rendered sand. */
export function stepFlight(s: FlightState, raw: FlightInput, dt: number, surfaceAt: (x:number,z:number)=>FlightSurface) {
  dt=clamp(dt,0,1/30);s.age+=dt;s.impact=Math.max(0,s.impact-dt*1.7);
  if(s.phase==='crashed'){s.crashAge+=dt;return;}
  let p=clamp(raw.pitch,-1,1),r=clamp(raw.roll,-1,1),yaw=clamp(raw.yaw,-1,1);
  let targetHeight=0,desiredYaw=s.yaw;
  if(s.cruise){
    const l=FLIGHT_LOOP,t=Math.atan2((s.z-l.z)/l.rz,(s.x-l.x)/l.rx);
    const nearestX=l.x+Math.cos(t)*l.rx,nearestZ=l.z+Math.sin(t)*l.rz;
    s.join=Math.hypot(s.x-nearestX,s.z-nearestZ)>160;
    const look=t+0.20,tx=l.x+Math.cos(look)*l.rx,tz=l.z+Math.sin(look)*l.rz;
    if(s.y>=l.altitude-15)s.climbing=false;
    desiredYaw=s.climbing?s.climbYaw:Math.atan2(tx-s.x,-(tz-s.z));
    targetHeight=Math.max(l.altitude,surfaceAt(s.x,s.z).height+120);
    // Coordinated, rate-limited turn; never translate onto the route.
    const turn=angle(desiredYaw-s.yaw);
    r=clamp(turn*1.6,-0.8,0.8);yaw=clamp(turn,-0.7,0.7);
    s.power=s.kind==='seaplane'?0.8:0.68;
    p=clamp((targetHeight-s.y)*0.008,-0.35,0.55);
  }
  const ground=surfaceAt(s.x,s.z);
  if(s.kind==='seaplane'){
    s.roll=damp(s.roll,r*0.55,2.8,dt);
    s.pitch=damp(s.pitch,p*0.43+(s.phase==='airborne'?0.025:0),2.0,dt);
    s.yaw+=((Math.tan(s.roll)*9.81/Math.max(s.speed,18))+(yaw*(s.phase==='grounded'?0.48:0.15)))*dt;
    // Sand remains traversable but takes substantially more power/run to lift off.
    const drag=s.phase==='airborne'?0.06:ground.kind==='beach'?0.125:(s.speed<16?0.12:0.075);
    s.speed=clamp(s.speed+(s.power*6.8-drag*s.speed-0.5-Math.max(0,s.pitch)*1.5)*dt,0,78);
    s.stalled=s.phase==='airborne'&&s.speed<24;
    let vertical=s.speed*Math.sin(s.pitch);
    if(s.stalled)vertical-= (24-s.speed)*0.9+2;
    if(s.phase==='grounded'&&(s.speed<27||s.pitch<0.055))vertical=0;
    s.vy=damp(s.vy,vertical,1.8,dt);
    s.vx=Math.sin(s.yaw)*s.speed;s.vz=-Math.cos(s.yaw)*s.speed;
  }else{
    s.stalled=false;
    if(s.cruise){
      const turn=angle(desiredYaw-s.yaw);s.yaw+=clamp(turn*0.9,-0.42,0.42)*dt;
      const speed=s.climbing ? 0 : 40;
      s.vx=damp(s.vx,Math.sin(s.yaw)*speed,0.6,dt);s.vz=damp(s.vz,-Math.cos(s.yaw)*speed,0.6,dt);
      s.vy=damp(s.vy,clamp((targetHeight-s.y)*0.28,-5,7),1,dt);
      s.pitch=damp(s.pitch,-0.13,2,dt);s.roll=damp(s.roll,r*0.3,2,dt);
    }else{
      s.pitch=damp(s.pitch,p*0.35,2.6,dt);s.roll=damp(s.roll,r*0.4,2.6,dt);s.yaw+=yaw*0.75*dt;
      const forward=-Math.sin(s.pitch)*14,side=Math.sin(s.roll)*12;
      s.vx+=(Math.sin(s.yaw)*forward+Math.cos(s.yaw)*side-s.vx*0.13)*dt;
      s.vz+=(-Math.cos(s.yaw)*forward+Math.sin(s.yaw)*side-s.vz*0.13)*dt;
      if(s.hover){
        s.vx=damp(s.vx,0,1.7,dt);s.vz=damp(s.vz,0,1.7,dt);
        s.vy=damp(s.vy,clamp((s.hoverHeight-s.y)*1.3,-3,3),2,dt);
      }else if(raw.descend){s.vy=damp(s.vy,-2.2,2,dt);}
      else s.vy+=((s.power-0.52)*18-s.vy*0.85)*dt;
    }
    s.vy=clamp(s.vy,-9,10);s.speed=Math.hypot(s.vx,s.vz);
    if(s.phase==='grounded'&&s.vy<=0){s.vx=damp(s.vx,0,8,dt);s.vz=damp(s.vz,0,8,dt);}
  }
  s.x+=s.vx*dt;s.z+=s.vz*dt;s.y+=s.vy*dt;
  const next=surfaceAt(s.x,s.z);
  if(s.y>next.height+0.25)s.phase='airborne';
  if(s.y<=next.height){
    const downward=Math.max(0,-s.vy);
    if(!validLanding(s.kind,next.kind)||downward>11){crashFlight(s);return;}
    if(s.phase==='airborne')s.impact=clamp((downward-0.6)/5,0,1);
    s.y=next.height;s.vy=Math.max(0,s.vy);s.phase='grounded';
  }
  if(s.y>1100){s.y=1100;s.vy=Math.min(0,s.vy);}
}

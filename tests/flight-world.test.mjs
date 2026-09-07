import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cityModule } from './helpers/city-modules.mjs';
const {FlightWorld}=await import(cityModule('flight-world'));
const building={polygon:[[[-5,-5],[5,-5],[5,5],[-5,5]]],minY:10,maxY:40};
function world(volumes=[],bridges=[]){return new FlightWorld({data:{flightBuildingVolumes:volumes,flightBridgeVolumes:bridges},landmarkDetails:[],elevation:()=>0,rawElevation:()=>0});}
const v=(x,y,z)=>new THREE.Vector3(x,y,z);
test('swept building collision catches high speed wall and roof while allowing overhead and elevated gap',()=>{
 const w=world([building]);assert(w.hit(v(-80,20,0),v(80,20,0)));assert(w.hit(v(0,80,0),v(0,20,0)));
 assert(!w.hit(v(-80,45,0),v(80,45,0)));assert(!w.hit(v(-80,4,0),v(80,4,0)));
});
test('bridge collision uses oriented narrow volumes without closing the entire underpass',()=>{
 const matrix=new THREE.Matrix4().makeRotationY(.7);matrix.setPosition(0,30,0);
 const w=world([],[{matrix:matrix.toArray(),min:[-10,-1,-100],max:[10,1,100]}]);
 assert(w.hit(v(0,40,0),v(0,20,0)));assert(!w.hit(v(-80,20,0),v(80,20,0)));
 const cable=new THREE.Matrix4();cable.setPosition(0,50,0);
 const c=world([],[{matrix:cable.toArray(),min:[-.2,-20,-.2],max:[.2,20,.2]}]);
 assert(c.hit(v(-40,50,0),v(40,50,0),.85));
});
test('holes in building footprint stay empty and off-map launch is rejected',()=>{
 const w=world([{...building,polygon:[...building.polygon,[[-2,-2],[-2,2],[2,2],[2,-2]]]}]);
 assert(!w.hit(v(0,20,0),v(0,21,0),.1));assert.equal(w.launch(90000,90000),null);
});

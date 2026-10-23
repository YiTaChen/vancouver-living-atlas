import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {metreUV,metricError} from './adapters/metre-uv.mjs';
import {configureSharedMaps,bindSurface,SURFACES} from './adapters/shared-surfaces.mjs';
import {roadsterPatch,interiorPatch} from './adapters/source-patches.mjs';
import {originalSource} from './adapters/harness.mjs';
import {readFileSync} from 'node:fs';
import {assertProtectedSources,projectBeforeCharacter,projectBeforeSeating} from './adapters/seating-source-compatibility.mjs';

test('Exact metre triangle charts retain transformed box attributes',()=>{
 const original=new THREE.BoxGeometry(2,3,4).rotateY(.54).translate(2,1,9).toNonIndexed();
 const positions=Array.from(original.attributes.position.array),normals=Array.from(original.attributes.normal.array);
 const result=metreUV(original);assert.equal(result,original);
 assert.deepEqual(Array.from(result.attributes.position.array),positions);assert.deepEqual(Array.from(result.attributes.normal.array),normals);
 assert(metricError(result).maxAbsoluteEdgeErrorM<5e-6);
});
test('Curved and merged geometry keeps metre chart distances',()=>{
 const shapes=[new THREE.SphereGeometry(.7,16,10).scale(1,.8,.3),new THREE.CylinderGeometry(.35,.35,.24,24)];
 const gs=shapes.map(g=>metreUV(g));const merged=mergeGeometries(gs,false);
 assert.equal(merged.attributes.uv.count,merged.attributes.position.count);assert(metricError(merged).maxAbsoluteEdgeErrorM<1e-6);
});
test('Flat floor charts share XZ phase and sloped charts retain physical distances',()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([4,2,7,6,2,7,4,2,10],3));
 metreUV(g,'floor');assert.deepEqual([...g.attributes.uv.array],[4,7,6,7,4,10]);
 g.attributes.position.setY(1,3);metreUV(g,'floor');assert(metricError(g).maxAbsoluteEdgeErrorM<2e-6);
});
test('Zero-area inherited triangles stay finite rather than moving vertices',()=>{
 const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,0,0,0,1,0,0],3));
 metreUV(g);assert([...g.attributes.uv.array].every(Number.isFinite));assert(metricError(g).maxAbsoluteEdgeErrorM<1e-6);
});
test('Shared eight surface maps use correct channel, physical repeat, and UV orientation',()=>{
 assert.equal(Object.keys(SURFACES).length,8);
 for(const [id,period] of Object.entries(SURFACES)){
  const maps={basecolor:new THREE.Texture(),normal:new THREE.Texture(),orm:new THREE.Texture()};
  const config=configureSharedMaps(id,maps);assert.equal(config.metalnessMap,config.roughnessMap);assert.equal(maps.basecolor.repeat.x,1/period);
  assert.equal(maps.basecolor.colorSpace,THREE.SRGBColorSpace);assert.equal(maps.normal.colorSpace,THREE.NoColorSpace);assert.equal(maps.orm.colorSpace,THREE.NoColorSpace);assert.equal(maps.basecolor.flipY,true);
  configureSharedMaps(id,maps,{gltf:true});assert.equal(maps.basecolor.flipY,false);
 }
});
test('Binding rejects screens/glass, unknown maps and protects shader hooks',()=>{
 const maps={basecolor:new THREE.Texture(),normal:new THREE.Texture(),orm:new THREE.Texture()};
 assert.throws(()=>bindSurface(new THREE.MeshBasicMaterial(),'interior-terrazzo',maps),/Opaque/);
 assert.throws(()=>bindSurface(new THREE.MeshStandardMaterial({transparent:true}),'interior-terrazzo',maps),/Opaque/);
 assert.throws(()=>configureSharedMaps('made-up',maps),/Unknown/);assert.throws(()=>configureSharedMaps('interior-terrazzo',{}),/textures/);
 const material=new THREE.MeshStandardMaterial({vertexColors:true,color:'red'});const fn=()=>{};material.onBeforeCompile=fn;
 bindSurface(material,'interior-terrazzo',maps);assert.equal(Object.getOwnPropertyDescriptor(material,'onBeforeCompile').value,fn);assert.equal(material.vertexColors,false);assert.equal(material.color.getHex(),0xffffff);
});
test('Source patches fail closed when reviewed callsites change',()=>{
 assert.throws(()=>roadsterPatch(originalSource('assets/roadster').replace('    flat.deleteAttribute(\'uv\');',''), 'file:test'),/Source anchor/);
 assert.throws(()=>interiorPatch(originalSource('interiors').replace('obstacle(x, z, w, 0.7, 0.48, 0x8d6e4e);',''), 'file:test'),/Source anchor/);
});
test('Only the authored Roadster seat scope is changed to leather role',()=>{
 const s=roadsterPatch(originalSource('assets/roadster'),'file:test');
 assert(s.includes("add('driver-skin', new THREE.SphereGeometry(0.115"));
 assert(s.includes("oval('seat-upholstery', [0.275, 0.085, 0.32]"));
 assert(s.includes("box('dark', [1.48, 0.1, 3.95]"));
});

function protectedSources() {
  const baseline = JSON.parse(readFileSync(
    new URL('./qa/current-source-fixtures.json', import.meta.url), 'utf8',
  )).sourceHashes;
  const sources = Object.fromEntries(Object.keys(baseline).map(path => [
    path, originalSource(path.slice('lib/city/'.length, -3)),
  ]));
  return { baseline, sources };
}

test('Reviewed seating, character selection and camera changes project to unchanged source fixtures while all other bytes stay exact', () => {
  const { baseline, sources } = protectedSources();
  const audit = assertProtectedSources(sources, baseline);
  assert.equal(audit.reviewedBase, '53bb3c6');
  assert.deepEqual(audit.compatibility.map(row => row.path).sort(), [
    'lib/city/interiors.ts', 'lib/city/navigation.ts',
  ]);
  assert.equal(Object.keys(audit.sourceHashes).length, 16);
  for (const row of audit.compatibility) {
    assert.equal(row.projectedHash, baseline[row.path]);
    assert.notEqual(row.actualHash, row.baselineHash);
    assert(row.reviewed.length > 0);
    sources[row.path] = (!row.reviewed.includes('walk-seat contract') && row.path === 'lib/city/navigation.ts'
      ? projectBeforeCharacter(row.path, sources[row.path])
      : projectBeforeSeating(row.path, sources[row.path])).source;
  }
  assert.deepEqual(assertProtectedSources(sources, baseline).compatibility, [],
    'exact fixture sources remain directly acceptable');
});

test('The prior seating-only navigation remains acceptable without requiring character-selection additions', () => {
  const { baseline, sources } = protectedSources();
  const path = 'lib/city/navigation.ts';
  let source = sources[path];
  for (const [before, after] of [
    ["import { makeCitizen, type CitizenCharacter } from './citizen';", "import { makeCitizen } from './citizen';"],
    ["  character: CitizenCharacter = 'male';\n", ''],
    ['    setCharacter(character: CitizenCharacter): void;\n', ''],
    [`  setCharacter(character: CitizenCharacter) {
    if (character !== 'male' && character !== 'female') return;
    this.walker.setCharacter(character);
    this.character = character;
    this.walker.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
  }
`, ''],
  ]) {
    assert(source.includes(before), 'reviewed character fixture anchor exists');
    source = source.replace(before, after);
  }
  assert(!source.includes('CitizenCharacter'));
  const audit = assertProtectedSources({ ...sources, [path]: source }, baseline);
  const navigation = audit.compatibility.find(row => row.path === path);
  if (navigation) {
    assert.equal(navigation.projectedHash, baseline[path]);
    assert(navigation.reviewed.every(label => !label.startsWith('character selection')));
  } else {
    assert.equal(audit.sourceHashes[path], baseline[path], 'a seated-source fixture needs no projection');
  }
});

test('Both seated-source fixtures and the original pre-seating navigation fixture retain exact protection', () => {
  const { baseline, sources } = protectedSources();
  const path = 'lib/city/navigation.ts';
  const current = assertProtectedSources(sources, baseline).compatibility.find(row => row.path === path);
  assert(current.reviewed.every(label => label.startsWith('character selection') || label.startsWith('walk camera')),
    'the current seated-source fixture must preserve all seating and curb code');
  const curbDelta = `        // Only explicit, static curb chunks from the source road group. Keep
        // them out of placement raycasts and navigation height sampling.
        (this.e.roads?.children ?? []).filter(
          (object): object is THREE.Mesh =>
            object instanceof THREE.Mesh &&
            object.userData.groundObstruction === true &&
            !object.userData.protectedSurface,
        ),
`;
  assert.equal(sources[path].split(curbDelta).length - 1, 1, 'upstream curb-only fixture delta exists');
  const legacySources = { ...sources, [path]: sources[path].replace(curbDelta, '') };
  const legacyHashes = { ...baseline, [path]: '6f0f78bb67395e0892ab8fff84187161be17657403151415ca0dbe28e3bd2802' };
  for (const source of [legacySources[path], projectBeforeCharacter(path, legacySources[path]).source]) {
    const audit = assertProtectedSources({ ...legacySources, [path]: source }, legacyHashes);
    const navigation = audit.compatibility.find(row => row.path === path);
    assert.equal(navigation.projectedHash, legacyHashes[path]);
    assert(navigation.reviewed.includes('walk-seat contract'), 'legacy fixtures still require exact seating subtraction');
    assert.throws(() => assertProtectedSources({ ...legacySources, [path]: source.replace('ROADSTER_TOP_SPEED : 21', 'ROADSTER_TOP_SPEED : 22') }, legacyHashes),
      /Protected pre-seating source drift|Reviewed seating anchor changed/);
  }
  const original = projectBeforeSeating(path, legacySources[path]).source;
  const audit = assertProtectedSources({ ...legacySources, [path]: original }, legacyHashes);
  assert(!audit.compatibility.some(row => row.path === path), 'the original pre-seating fixture remains directly acceptable');
});

test('Character compatibility rejects mutated, incomplete, duplicated or relocated selection additions', () => {
  const { baseline, sources } = protectedSources();
  const path = 'lib/city/navigation.ts';
  const source = sources[path];
  const field = "  character: CitizenCharacter = 'male';\n";
  for (const [before, after] of [
    ['    this.walker.setCharacter(character);', "    this.walker.setCharacter('male');"],
    ['    this.character = character;', "    this.character = character;\n    this.mode = 'walk';"],
    ['    this.character = character;\n    this.walker.group.traverse((object) => {\n      if (object instanceof THREE.Mesh) object.castShadow = false;', '    this.character = character;\n    this.walker.group.traverse((object) => {\n      if (object instanceof THREE.Mesh) object.castShadow = true;'],
    ['    setCharacter(character: CitizenCharacter): void;\n', ''],
    [field, field + field],
    [field + '  classicCar = new THREE.Group();', '  classicCar = new THREE.Group();\n' + field.trimEnd()],
  ]) {
    assert(source.includes(before), `negative character fixture anchor exists: ${before}`);
    assert.throws(() => assertProtectedSources({ ...sources, [path]: source.replace(before, after) }, baseline),
      /Protected pre-seating source drift|Reviewed seating anchor changed/,
      `unreviewed character mutation rejected: ${before}`);
  }
});

test('Camera compatibility rejects altered, missing or duplicated camera changes without weakening movement or material hashes', () => {
  const { baseline, sources } = protectedSources();
  const path = 'lib/city/navigation.ts', source = sources[path];
  for (const [before, after] of [
    ['this.mode === \'walk\' ? clampTravelPitch(pitch)', 'this.mode === \'walk\' ? pitch'],
    ['this.e.roads, this.e.terrain], 0.18, pos)', 'this.e.roads, this.e.terrain], 0.01, pos)'],
    ['    this.e.renderer.domElement.setPointerCapture?.(ev.pointerId);\n', ''],
    ['  private readonly cameraCollision = new TravelCameraCollision();\n',
      '  private readonly cameraCollision = new TravelCameraCollision();\n  private readonly cameraCollision = new TravelCameraCollision();\n'],
  ]) {
    assert(source.includes(before));
    assert.throws(() => assertProtectedSources({ ...sources, [path]: source.replace(before, after) }, baseline),
      /Protected pre-seating source drift|Reviewed seating anchor changed/);
  }
});

test('Seating compatibility rejects changes to driving, walking, collision, camera, bench geometry or the reviewed seat implementation', () => {
  const { baseline, sources } = protectedSources();
  for (const [path, before, after] of [
    ['lib/city/navigation.ts', 'ROADSTER_TOP_SPEED : 21', 'ROADSTER_TOP_SPEED : 22'],
    ['lib/city/navigation.ts', "pressed('shift') ? 12 : 4", "pressed('shift') ? 12 : 5"],
    ['lib/city/navigation.ts', 'if (!this.e.onLand(x, z)) return false;', 'if (!this.e.onLand(x, z)) return true;'],
    ['lib/city/navigation.ts', "carModel === 'roadster' ? 1.2 : 1.45", "carModel === 'roadster' ? 1.3 : 1.45"],
    ['lib/city/navigation.ts', 'this.walkSeat.height + 0.78', 'this.walkSeat.height + 0.8'],
    ['lib/city/navigation.ts', 'object.userData.groundObstruction === true', 'object.userData.groundObstruction === false'],
    ['lib/city/interiors.ts', 'parts.box([w, 0.55, 0.12]', 'parts.box([w, 0.56, 0.12]'],
    ['lib/city/interiors.ts', 'yaw: site.yaw, height: 0.48', 'yaw: site.yaw, height: 0.6'],
  ]) {
    assert(sources[path].includes(before), `negative fixture anchor exists: ${before}`);
    const mutated = { ...sources, [path]: sources[path].replace(before, after) };
    assert.throws(() => assertProtectedSources(mutated, baseline),
      /Protected pre-seating source drift|Reviewed seating anchor changed/,
      `unreviewed mutation rejected: ${before}`);
  }
  const other = 'lib/city/driver-camera.ts';
  assert.throws(() => assertProtectedSources({ ...sources, [other]: sources[other] + '\n// changed\n' }, baseline),
    /No reviewed seating projection/, 'the fourteen other sources remain exact-hash guarded');
});

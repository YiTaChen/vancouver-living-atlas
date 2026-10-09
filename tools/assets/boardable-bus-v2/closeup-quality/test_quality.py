"""Negative regressions: fail closed on changed geometry, ranges, hashes and budgets."""
import copy,json,sys,unittest,tempfile,struct
from pathlib import Path
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));import validate as V
from geometry import load,C
M=json.loads((HERE/'manifest.json').read_text());SCENES=[load(HERE/l['file'])[0] for l in M['assets'][0]['lods']]
def clone_scenes():
 # Keep every negative mutation isolated without recursively copying immutable triangle coordinates.
 return [{n:{**o,**{k:list(o[k]) for k in ['points','triangles','point','matrix'] if k in o}} for n,o in scene.items()} for scene in SCENES]
def box(lo,hi):return {'points':[[lo[0],lo[1],lo[2]],[hi[0],hi[1],hi[2]]],'triangles':[]}
class QualityTests(unittest.TestCase):
 def test_negative_scene_clone_isolation(self):
  scenes=clone_scenes();before=SCENES[0]['low-floor-slab']['points'][0];scenes[0]['low-floor-slab']['points'][0]=[99,99,99];scenes[0]['seat-01-pelvis']['point'][0]=99
  self.assertEqual(SCENES[0]['low-floor-slab']['points'][0],before);self.assertNotEqual(SCENES[0]['seat-01-pelvis']['point'][0],99)
 def bad_scene(self,edit,expected):
  scenes=clone_scenes();edit(scenes[0])
  with self.assertRaisesRegex((AssertionError,KeyError),expected):V.validate_geometry(M,scenes)
 def bad_sidecar(self,edit,expected):
  p=HERE/M['assets'][0]['lods'][0]['file'];s=json.loads(p.with_suffix('.components.json').read_text());edit(s)
  with self.assertRaisesRegex(AssertionError,expected):load(p,s)
 def bad_document(self,edit,expected,check_anchors=False):
  source=HERE/M['assets'][0]['lods'][0]['file'];doc,raw=C.read_glb(source);side=json.loads(source.with_suffix('.components.json').read_text());raw=bytearray(raw);edit(doc,raw)
  blob=json.dumps(doc,separators=(',',':')).encode();blob+=b' '*((-len(blob))%4);raw+=b'\0'*((-len(raw))%4)
  with tempfile.TemporaryDirectory(prefix='bus-negative-') as td:
   p=Path(td)/'mutated.glb';p.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(blob)+len(raw))+struct.pack('<I4s',len(blob),b'JSON')+blob+struct.pack('<I4s',len(raw),b'BIN\0')+raw);side['glbSha256']=C.digest(p)
   with self.assertRaisesRegex(AssertionError,expected):
    scene=load(p,side)[0]
    if check_anchors:V.validate_geometry(M,[scene,SCENES[1]])
 def test_range_overlap_rejected(self):self.bad_sidecar(lambda s:s['batches'][0]['ranges'][1].update(indexStart=0),'gap or overlap')
 def test_missing_batch_rejected(self):self.bad_sidecar(lambda s:s['batches'].pop(),'uncovered draw geometry')
 def test_extra_batch_rejected(self):self.bad_sidecar(lambda s:s['batches'].append({'batch':'invented','ranges':[]}),'missing or duplicate batch')
 def test_batch_transform_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if 'mesh' in n).update(translation=[1,0,0]),'batch or ancestor transform changed')
 def test_ancestor_transform_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if n['name']=='vehicle').update(translation=[1,0,0]),'batch or ancestor transform changed')
 def test_duplicate_seat_anchor_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if n['name']=='seat-22-camera').update(name='seat-22-pelvis'),'duplicate node name')
 def test_missing_seat_anchor_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if n['name']=='seat-22-camera').update(name='unexpected'),'anchors differ from master',True)
 def test_extra_seat_anchor_rejected(self):
  def edit(d,b):
   d['nodes'].append({'name':'seat-25-pelvis'});next(n for n in d['nodes'] if n['name']=='vehicle')['children'].append(len(d['nodes'])-1)
  self.bad_document(edit,'anchors differ from master',True)
 def test_wrong_actual_yaw_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if n['name']=='seat-22').update(rotation=[0,0,0,1]),'anchor transformed matrix or yaw mismatch',True)
 def test_wrong_actual_anchor_position_rejected(self):self.bad_document(lambda d,b:next(n for n in d['nodes'] if n['name']=='seat-22-pelvis').update(translation=[99,0,0]),'anchor transformed matrix or yaw mismatch',True)
 def test_escaped_component_indices_rejected(self):
  def edit(d,b):
   mesh=d['meshes'][next(n for n in d['nodes'] if n['name']=='interior-batch-fixture')['mesh']];a=d['accessors'][mesh['primitives'][0]['indices']];view=d['bufferViews'][a['bufferView']];offset=view.get('byteOffset',0)+a.get('byteOffset',0);struct.pack_into('<H',b,offset,100)
  self.bad_document(edit,'index escapes component vertex range')
 def test_manifest_sidecar_digest_rejected(self):
  m=copy.deepcopy(M);m['assets'][0]['lods'][0]['componentSidecar']['sha256']='0'*64
  with self.assertRaisesRegex(AssertionError,'manifest sidecar hash'):V.validate(m)
 def test_sloped_floor_preserving_bounds_rejected(self):
  source=HERE/M['assets'][0]['lods'][0]['file'];side=json.loads(source.with_suffix('.components.json').read_text());batch=next(b for b in side['batches'] if any(r['componentId']=='low-floor-slab' for r in b['ranges']));r=next(r for r in batch['ranges'] if r['componentId']=='low-floor-slab')
  def edit(d,b):
   primitive=d['meshes'][next(n for n in d['nodes'] if n['name']==batch['batch'])['mesh']]['primitives'][0];pa=d['accessors'][primitive['attributes']['POSITION']];pv=d['bufferViews'][pa['bufferView']];positions=C.accessor(d,b,primitive['attributes']['POSITION']);indices=[x[0] for x in C.accessor(d,b,primitive['indices'])][r['indexStart']:r['indexStart']+r['indexCount']]
   for i in range(0,len(indices),3):
    ids=indices[i:i+3];tri=[positions[j] for j in ids]
    if V.G.cross(V.G.sub(tri[1],tri[0]),V.G.sub(tri[2],tri[0]))[1]>1e-9:
     vertex=ids[0];offset=pv.get('byteOffset',0)+pa.get('byteOffset',0)+vertex*12+4;struct.pack_into('<f',b,offset,positions[vertex][1]-.048);break
   after=C.accessor(d,b,primitive['attributes']['POSITION'])[r['vertexStart']:r['vertexStart']+r['vertexCount']]
   self.assertEqual([min(p[k] for p in after) for k in range(3)],r['boundsM']['min']);self.assertEqual([max(p[k] for p in after) for k in range(3)],r['boundsM']['max'])
  self.bad_document(edit,'sloped or wrong-height upward support triangles',True)
 def test_missing_floor_triangle_support_rejected(self):
  scenes=clone_scenes();scenes[0]['rear-step-1-slab']['triangles']=[]
  with self.assertRaisesRegex(AssertionError,'upward support triangles'):V.validate_support_triangles(M,scenes)
 def test_missing_portal_strip_rejected(self):
  scenes=clone_scenes();scenes[0].pop('door-front-threshold-slab')
  with self.assertRaisesRegex(AssertionError,'missing support component'):V.validate_support_triangles(M,scenes)
 def test_portal_strip_height_drift_rejected(self):
  scenes=clone_scenes();obj=scenes[0]['door-rear-threshold-slab'];obj['triangles']=[tuple([p[0],p[1]+.006,p[2]] for p in t) for t in obj['triangles']]
  with self.assertRaisesRegex(AssertionError,'wrong-height upward support triangles'):V.validate_support_triangles(M,scenes)
 def test_portal_join_gap_rejected(self):
  scenes=clone_scenes();obj=scenes[0]['door-front-threshold-slab'];obj['triangles']=[tuple([min(p[0],-1.16),p[1],p[2]] for p in t) for t in obj['triangles']]
  with self.assertRaisesRegex(AssertionError,'support polygon coverage or join boundary mismatch'):V.validate_support_triangles(M,scenes)
 def test_portal_surface_metadata_omission_rejected(self):
  m=copy.deepcopy(M);m['vehicles'][0]['floorSurfaces'].pop()
  with self.assertRaisesRegex(AssertionError,'unauthorized original floor change or portal extension'):V.validate(m)
 def test_actual_budget_and_geometry(self):self.assertEqual(V.validate(M)[0]['status'],'pass')
 def test_quality_does_not_claim_legacy_budget(self):
  for lod in M['assets'][0]['lods']:self.assertFalse(V.budget_comparison(lod,lod['level'])['pass'])
 def test_portal_edge_trim_intrusion_rejected(self):
  scenes=clone_scenes();o=scenes[0]['window-outer-blue-pillar--1-8'];o['points']=[[p[0],p[1],p[2]+.026] for p in o['points']]
  with self.assertRaisesRegex(AssertionError,'window trim intrudes into full front'):V.quality_features(M,scenes)
 def test_reference_features(self):self.assertEqual(len(V.quality_features(M,SCENES)),2)
 def test_sidecar_hash_binding(self):self.bad_sidecar(lambda s:s.update(glbSha256='0'*64),'hash mismatch')
 def test_range_gaps_rejected(self):self.bad_sidecar(lambda s:s['batches'][0]['ranges'][0].update(vertexStart=1),'gap or overlap')
 def test_range_truncation_rejected(self):self.bad_sidecar(lambda s:s['batches'][0]['ranges'].pop(),'coverage incomplete')
 def test_duplicate_batch_rejected(self):self.bad_sidecar(lambda s:s['batches'].append(s['batches'][0]),'duplicate batch')
 def test_recorded_bounds_not_trusted(self):self.bad_sidecar(lambda s:s['batches'][0]['ranges'][0]['boundsM']['min'].__setitem__(0,99),'differ from actual geometry')
 def test_seat_capacity_geometry_required(self):self.bad_scene(lambda s:s.pop('seat-24'),'anchors differ from master')
 def test_pelvis_anchor_required(self):self.bad_scene(lambda s:s['seat-18-pelvis']['point'].__setitem__(0,0),'seat anchor mismatch')
 def test_camera_facing_offset_required(self):self.bad_scene(lambda s:s['seat-18-camera']['point'].__setitem__(2,99),'seat anchor mismatch')
 def test_inward_seat_orientation_required(self):self.bad_scene(lambda s:s['seat-22']['matrix'].__setitem__(8,0),'anchor transformed matrix or yaw mismatch')
 def test_stowed_places_not_deleted(self):self.bad_scene(lambda s:s.pop('front-priority-stowed-pad-0'),'stowed priority geometry')
 def test_unseated_right_wheelhouse_shape_required(self):self.bad_scene(lambda s:s.update({'front-wheel-cap--1':box([.7,.7,2.48],[1.1,1.17,3.72])}),'right wheelhouse geometry')
 def test_driver_side_cabinet_required(self):self.bad_scene(lambda s:s.update({'front-equipment-cabinet':box([-.1,.7,2.48],[.1,2.3,3.72])}),'driver-side cabinet geometry')
 def test_floor_height_geometry_required(self):self.bad_scene(lambda s:s['low-floor-slab']['points'].__setitem__(0,[0,.8,0]),'floor geometry height')
 def test_wheelchair_bay_clearance_required(self):self.bad_scene(lambda s:s.update({'bad-bay-blocker':box([-.9,.6,1.0],[-.5,1.4,1.4])}),'wheelchair reserved volume blocked')
 def test_door_entry_clearance_required(self):self.bad_scene(lambda s:s.update({'bad-door-blocker':box([-1,.4,4.0],[-.8,2.0,4.5])}),'entry front blocked')
 def test_standing_clearance_required(self):self.bad_scene(lambda s:s.update({'bad-aisle-blocker':box([-.2,.4,0],[.2,2.0,.1])}),'standing clearance')
 def test_active_stowed_capacity_rejected(self):
  m=copy.deepcopy(M);m['vehicles'][0]['interiorLayout']['stowedPlacesArePassengerAnchors']=True
  with self.assertRaisesRegex(AssertionError,'active versus stowed capacity'):V.validate_geometry(m,SCENES)
 def test_stale_collision_refs_rejected(self):
  m=copy.deepcopy(M);m['vehicles'][0]['walkableFloor']['obstacleCollisionRefs'].append('deleted-component')
  with self.assertRaisesRegex(AssertionError,'stale obstacle refs'):V.validate(m)
if __name__=='__main__':unittest.main(verbosity=2)

"""Derive editable budget LODs from a hash-pinned detailed artist master.
Never overwrites the master. Re-export uses export.py, not this derivation.
"""
import argparse,hashlib,json,sys
from pathlib import Path
import bpy
HERE=Path(__file__).resolve().parent
MASTER=HERE.parent
EXPECTED='f9fb01939c1e65c0c308c8bc2cdca72f26d9d6b728e489df6743bfb6849dc673'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def triangles(o):
 ev=o.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();me.calc_loop_triangles();n=len(me.loop_triangles);ev.to_mesh_clear();return n

def make(lod,out):
 src=MASTER/'source/city-bus-12m-interior-v2.lod0.blend';assert sha(src)==EXPECTED,'Detailed master changed; review before deriving.'
 bpy.ops.wm.open_mainfile(filepath=str(src));removed=[];reductions=[]
 for o in list(bpy.context.scene.objects):
  if o.type!='MESH':continue
  n=o.name
  omit='-upholstery-button' in n or n.startswith(('driver-pedal-tread','front-equipment-cabinet-fastener'))
  if lod==1:
   omit=omit or any(s in n for s in ['-grab-side','-grab-top','-pan','-foot']) and n.startswith('seat-')
   omit=omit or n.startswith(('strap-','ad-frame','ad-blank','roof-hatch','ceiling-seam','driver-console-switch','driver-gauge','rear-vent-slat','front-priority-hinge','front-priority-grab','stop-cord','driver-arm-support','driver-gate-handle','driver-partition-top'))
  if omit:removed.append(n);bpy.data.objects.remove(o,do_unlink=True);continue
  for mod in list(o.modifiers):
   if mod.type=='BEVEL':
    if lod==0 and any(s in n for s in ['-back-shell','-back-pad','-cushion','driver-back','driver-headrest']):mod.segments=1
    else:o.modifiers.remove(mod)
  before=triangles(o)
  # Preserve exact slab surfaces and cushion bounds; simplify curved fittings.
  if lod==0:
   target=20 if o.get('semantic_role') in ['metal','rail'] or any(s in n for s in ['-leg-','-foot','-grab-','steering-','strap-']) else before
   if n.startswith('front-wheel-arch'):target=48
  else:
   target=before
   if '-back-shell' in n:target=16
   elif o.get('semantic_role') in ['metal','rail'] or any(s in n for s in ['-leg-','steering-']):target=8
   if n.startswith('front-wheel-arch'):target=28
   if n.startswith('steering-ring'):target=4
  if before>target:
   mod=o.modifiers.new(f'Budget LOD{lod} reduction, editable','DECIMATE');mod.ratio=target/before;mod.use_collapse_triangulate=True
  after=triangles(o)
  reductions.append({'component':n,'preReductionTriangles':before,'evaluatedTriangles':after})
  o['candidate_lod']=lod
 sys.path.insert(0,str(HERE));from threshold_support import apply_to_loaded_candidate
 names=apply_to_loaded_candidate()
 reductions += [{'component':n,'preReductionTriangles':12,'evaluatedTriangles':12,'newCandidateOnlySupport':True} for n in names]
 bpy.context.scene['runtime_candidate']='budget derivative; not runtime integrated'
 bpy.context.scene['detailed_master']='../source/city-bus-12m-interior-v2.lod0.blend'
 bpy.context.scene['detailed_master_sha256']=EXPECTED;bpy.context.scene['lod']=lod
 p=out/'source'/f'city-bus-12m-interior-v2-runtime.lod{lod}.blend';p.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
 report={'lod':lod,'addedPortalSupportComponents':names,'masterSource':'../source/'+src.name,'masterSha256':EXPECTED,'masterUnchanged':sha(src)==EXPECTED,'retainedMeshObjects':len(reductions),'trianglesEvaluated':sum(x['evaluatedTriangles'] for x in reductions),'omittedComponents':removed,'reductions':reductions,'scope':'Derivative simplification; rear is NOT byte-identical to master.'}
 (out/'qa'/f'derivation-lod{lod}.json').write_text(json.dumps(report,indent=2)+'\n');print('DERIVED',lod,report['trianglesEvaluated'],flush=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=HERE);ap.add_argument('--replace-candidate',action='store_true');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 assert a.output.resolve()!=MASTER.resolve();(a.output/'qa').mkdir(parents=True,exist_ok=True)
 if list((a.output/'source').glob('*.blend')) and not a.replace_candidate:raise RuntimeError('Refusing to overwrite candidate sources without explicit --replace-candidate')
 for lod in [0,1]:make(lod,a.output)
if __name__=='__main__':main()

"""Actual-GLB, equal-camera/equal-light close-up comparison; no image synthesis."""
import argparse, hashlib, importlib.util, json, sys
from pathlib import Path
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
PARENT=HERE.parent
sp=importlib.util.spec_from_file_location('baseline_qa',PARENT/'qa_blender.py');Q=importlib.util.module_from_spec(sp);sp.loader.exec_module(Q)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
PROFILES={
 'baseline-master':PARENT/'exports/city-bus-12m-interior-v2.lod0.glb',
 'budget-candidate':PARENT/'runtime-candidate/exports/city-bus-12m-interior-v2-runtime.lod0.glb',
 'quality-lod0':HERE/'exports/city-bus-12m-interior-v2-closeup.lod0.glb',
 'quality-lod1':HERE/'exports/city-bus-12m-interior-v2-closeup.lod1.glb'}
VIEWS={
 'cabin':([0,1.87,4.40],[0,1.53,-4.65],20),
 'seat':([-.05,1.28,2.00],[.85,1.12,1.33],30),
 'roof-rail':([.08,2.06,1.78],[.45,2.48,-.75],24),
 'front':([0,1.80,.15],[.10,1.40,4.90],18),
 'rear':([0,2.03,-4.77],[0,1.52,4.8],20)}
def setup(profile):
 Q.setup(0,False,True)
 # Remove only the imported master interior tree; exterior remains as exact dependency.
 # setup imported two separate 'vehicle' roots, identify interior by child seat names.
 roots=[o for o in bpy.context.scene.objects if o.parent is None and o.type=='EMPTY']
 for root in roots:
  if any(c.name.startswith('seat-') for c in root.children_recursive):
   for o in list(root.children_recursive)[::-1]+[root]:bpy.data.objects.remove(o,do_unlink=True)
 p=PROFILES[profile];bpy.ops.import_scene.gltf(filepath=str(p))
 s=bpy.context.scene;s.cycles.samples=96;s.cycles.adaptive_threshold=.02;s.render.resolution_x=1152;s.render.resolution_y=768
 return [p,PARENT.parent/'boardable-bus/exports/city-bus-12m-exterior.lod0.glb']
def render(profile,view):
 paths=setup(profile);s=bpy.context.scene;eye,target,lens=VIEWS[view]
 d=bpy.data.cameras.new('Identical QA camera');o=bpy.data.objects.new(d.name,d);s.collection.objects.link(o);o.location=Q.cv(eye);o.rotation_euler=(Vector(Q.cv(target))-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;d.clip_start=.03;d.clip_end=60;s.camera=o
 name=f'{view}-{profile}.png';p=HERE/'qa/previews'/name;s.render.filepath=str(p);bpy.ops.render.render(write_still=True)
 result={'file':name,'sha256':sha(p),'profile':profile,'view':view,'eyeVehicleM':eye,'targetVehicleM':target,'lensMm':lens,'actualGLBInputs':[{'file':str(p.relative_to(PARENT.parent)),'sha256':sha(p)} for p in paths],'renderer':'Cycles CPU','samples':96,'adaptiveThreshold':.02,'maximumBounces':4,'resolution':[1152,768],'colorManagement':'AgX','exposure':0,'denoising':False,'lighting':'identical baseline daytime area lamps and world; never exported','runtimeOrWebGL':False}
 out=HERE/'qa/previews/index.json';data=json.loads(out.read_text()) if out.exists() else {'status':'rendered_awaiting_pixel_review','renders':[]};data['renders']=[r for r in data['renders'] if r['file']!=name]+[result];out.write_text(json.dumps(data,indent=2)+'\n');print('CLOSEUP_RENDER_DONE',name,flush=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--profiles',nargs='+',default=list(PROFILES));ap.add_argument('--views',nargs='+',default=list(VIEWS));a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 for profile in a.profiles:
  for view in a.views:render(profile,view)

"""Ground/planting offline authoring. Defaults are explicit; export.py never rebuilds sources."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, math, struct, sys
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent; ROOT=HERE.parents[2]
SURFACES=['soil','grass','sand','concrete','asphalt','street-brick']
PROPS=['curb-straight-1m','soil-grass-edge-1m','planter-trough','planter-round','perennial-rosette','perennial-tuft']
COLORS={'soil':(.22,.14,.075),'grass':(.20,.30,.115),'sand':(.68,.59,.43),'concrete':(.57,.58,.55),'asphalt':(.26,.28,.28),'street-brick':(.47,.32,.24),'foliage':(.15,.28,.085),'soil-grass-edge':(.24,.29,.115)}
REPEAT={'soil':[2,2],'grass':[2,2],'sand':[2,2],'concrete':[1.5,1.5],'asphalt':[3,3],'street-brick':[1.92,1.92],'soil-grass-edge':[2,2],'foliage':[1,1]}
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def dump(p,v):Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(json.dumps(v,indent=2)+'\n')
def need(v,s):
 if not v:raise ValueError(s)
def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def config():
 s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=8;s.cycles.use_denoising=False;s.render.threads_mode='FIXED';s.render.threads=2;s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=0
 return s
def reset():bpy.ops.wm.read_factory_settings(use_empty=True);config()
def mat(role):
 name='role-'+role
 if name in bpy.data.materials:return bpy.data.materials[name]
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*[linear(x) for x in COLORS[role]],1);bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=m.diffuse_color;bs.inputs['Roughness'].default_value=.9;m['semantic_role']=role;m['tile_metres']=REPEAT[role];m['binding']='Named shared surface; exporter retains editable color/roughness; inspection maps explicitly rebound from catalog';return m
def mesh(name,verts,faces,role,uv=None):
 me=bpy.data.meshes.new(name+'-editable');me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob);me.materials.append(mat(role));layer=me.uv_layers.new(name='UVMap')
 for p in me.polygons:
  normal=p.normal; axes=(0,1) if abs(normal.z)>.5 else ((0,2) if abs(normal.y)>.5 else (1,2))
  for li in p.loop_indices:
   vi=me.loops[li].vertex_index;layer.data[li].uv=uv[vi] if uv else tuple(verts[vi][k]/REPEAT[role][j] for j,k in enumerate(axes))
 ob['semantic_role']=role;return ob
def box(name,loc,dim,role):
 x,y,z=loc;a,b,c=[v/2 for v in dim];v=[(x+i*a,y+j*b,z+k*c)for i,j,k in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
 return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],role)
def join_all(name):
 obs=[o for o in bpy.context.scene.objects if o.type=='MESH'];bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();obs[0].name=name;return obs[0]
def coupon(sid,size):
 a=size/2;r=REPEAT[sid];return mesh(f'{sid}-study-{size}m',[(-a,-a,0),(a,-a,0),(a,a,0),(-a,a,0)],[(0,1,2,3)],sid,[(0,0),(size/r[0],0),(size/r[0],size/r[1]),(0,size/r[1])])
def curb(lod):
 # Chamfer is explicit editable profile, invariant height and width in both LODs.
 cross=[(-.09,0),(.09,0),(.09,.13),(.07,.15),(-.07,.15),(-.09,.13)] if lod==0 else [(-.09,0),(.09,0),(.09,.15),(-.09,.15)]
 n=len(cross);vs=[(x,y,z)for x in [-.5,.5]for y,z in cross];faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 return mesh('curb-body',vs,faces,'concrete')
def edge(lod):
 n=8 if lod==0 else 2;vs=[];uv=[]
 # A physical 0.4m crop of the existing 2m transition map, not a stretched full texture.
 for j in range(n+1):
  y=-.5+j/n
  for i in range(n+1):
   x=-.2+.4*i/n;vs.append((x,y,0));uv.append((.4+.2*i/n,(y+.5)/2))
 fs=[(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i)for j in range(n)for i in range(n)]
 o=mesh('soil-grass-edge-surface',vs,fs,'soil-grass-edge',uv);a=o.data.attributes.new('_GRASS_WEIGHT','FLOAT','POINT')
 for i,p in enumerate(vs):a.data[i].value=(p[0]+.2)/.4
 o['weight_semantics']='Low-frequency linear vertex QA attribute only, NOT source pixel blend-weight mask';return o
def planter(kind,lod):
 if kind=='trough':
  rings=[(.8,.6,0),(.8,.6,.49),(.78,.58,.5),(.69,.49,.5),(.69,.49,.07)] if lod==0 else [(.8,.6,0),(.8,.6,.5),(.69,.49,.5),(.69,.49,.07)]
  vs=[(sx*w/2,sy*d/2,z)for w,d,z in rings for sx,sy in [(-1,-1),(1,-1),(1,1),(-1,1)]]
  fs=[(j*4+i,j*4+(i+1)%4,(j+1)*4+(i+1)%4,(j+1)*4+i)for j in range(len(rings)-1)for i in range(4)]
  fs += [(3,2,1,0),tuple(range((len(rings)-1)*4,len(rings)*4))]
  mesh('planter-trough-hollow-shell',vs,fs,'concrete')
  mesh('planter-trough-soil',[(-.345,-.245,.4),(.345,-.245,.4),(.345,.245,.4),(-.345,.245,.4)],[(0,1,2,3)],'soil')
  return join_all('planter-trough-shell-and-soil')
 n=32 if lod==0 else 12;r=.325;ri=.273;h=.40;vs=[]
 for radius,z in [(r,0),(r,h),(ri,h),(ri,.07)]:
  vs += [(radius*math.cos(2*math.pi*i/n),radius*math.sin(2*math.pi*i/n),z)for i in range(n)]
 faces=[]
 for j in range(3):faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)for i in range(n)]
 faces.append(tuple(reversed(range(n))));mesh('planter-round-hollow-shell',vs,faces,'concrete')
 v=[(0,0,.31)]+[(ri*math.cos(2*math.pi*i/n),ri*math.sin(2*math.pi*i/n),.31)for i in range(n)]
 mesh('planter-round-soil',v,[(0,i+1,(i+1)%n+1)for i in range(n)],'soil');return join_all('planter-round-shell-and-soil')
def perennial(kind,lod):
 # Original perennial source controls silhouette/radius envelope; independent leaf surfaces do not replace legacy seven-triangle mesh.
 v=[];f=[]
 if kind=='rosette':
  count=12 if lod==0 else 8;H=.30;R=.255
  for i in range(count):
   a=2*math.pi*i/count;r=R*(.8+.2*(i%3)/2);h=H*(.7+.3*((i+1)%3)/2);st=len(v)
   for dist,width,z in [(0,.014,0),(r*.46,.044,h*.65),(r,.008,h)]:
    for sign in [-1,1]:v.append((math.cos(a)*dist-math.sin(a)*width*sign,math.sin(a)*dist+math.cos(a)*width*sign,z))
   f += [(st,st+1,st+3,st+2),(st+2,st+3,st+5,st+4)]
 else:
  count=20;H=.45
  for i in (range(count) if lod==0 else [2,3,6,7,11,14,15,19]):
   a=2*math.pi*i/count;r=.16*(.5+.5*(i%4)/3);h=H*(.75+.25*((i+1)%4)/3);st=len(v);w=.012
   v += [(-math.sin(a)*w,math.cos(a)*w,0),(math.sin(a)*w,-math.cos(a)*w,0),(math.cos(a)*r,math.sin(a)*r,h)]
   f += [(st,st+1,st+2)]
 o=mesh('perennial-'+kind+'-leaves',v,f,'foliage');o.data.materials[0].use_backface_culling=False;return o

def create_source(aid,lod,output):
 reset()
 if aid.startswith('surface-'):
  _,sid,size=aid.rsplit('-',2) if False else ('',aid[len('surface-'):].rsplit('-',1)[0],aid.rsplit('-',1)[1]);coupon(sid,int(size[:-1]))
 elif aid=='curb-straight-1m':curb(lod)
 elif aid=='soil-grass-edge-1m':edge(lod)
 elif aid.startswith('planter-'):planter(aid[8:],lod)
 else:perennial(aid[10:],lod)
 s=bpy.context.scene;s['asset_id']=aid;s['lod']=lod;s['geographic_placement']='NONE: local geometry. See source-selected reference contract; coupons not terrain';s['authoring_contract']='Metres; Blender Z up to glTF Y up once. UVMap contains normalized physical tile coordinates, not world placement.'
 for o in s.objects:o['asset_id']=aid
 output.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)

def create_sand(output):
 reset();spec=importlib.util.spec_from_file_location('roof_study',HERE.parent/'roof-surface-studies/build.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
 m=r.make_material('ground-sand-grain',[.68,.59,.43],.94)
 # Reuse the periodic membrane graph topology but remove macro seam contribution; authored fine sand only.
 m.name='role-sand-procedural';m['surface_id']='sand';m['provenance']='Original representative sand, periodic 4D procedural grain; no beach survey or image copying'
 nt=m.node_tree;nt.nodes['PERIODIC_GRAIN: edit scale/detail'].inputs['Scale'].default_value=95;nt.nodes['Lap relief 2.8mm'].inputs[1].default_value=0;nt.nodes['EDIT_ROUGHNESS_BASE'].inputs[2].default_value=.93;nt.nodes['EDIT_RELIEF_METRES'].inputs['Distance'].default_value=.005
 o=r.make_coupon('sand',2,m);bpy.context.scene['asset_id']='sand-procedural-master';bpy.ops.wm.save_as_mainfile(filepath=str(output),compress=True)

def bake_sand(source,out):
 before=digest(source);bpy.ops.wm.open_mainfile(filepath=str(source),use_scripts=False);config()
 spec=importlib.util.spec_from_file_location('baker',HERE.parent/'city-materials/export_material_library.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b);b.SOURCE_SIZE=512
 m=bpy.data.materials['role-sand-procedural'];b.principled(m);scene=bpy.data.scenes.new('SAND-BAKE');prior=bpy.context.window.scene;bpy.context.window.scene=scene;config();groups=[];copy=b.material_copy(m,groups);data=b.bake_tile(scene,copy,[2,2],4)
 for k,arr in data.items():b.png(out/f'sand-{k}.png',b.encoded(b.linear_to_srgb(arr)if k=='color'else arr),color=k=='color')
 bpy.context.window.scene=prior;need(digest(source)==before,'sand source modified');return {'source':'source/sand-procedural-master.blend','sha256':before,'sourcePreserved':True,'resolution':[512,512],'cyclesCPU':True,'nodeCount':len(m.node_tree.nodes),'maps':[{'file':str(p.relative_to(HERE)) if p.is_relative_to(HERE) else str(p),'sha256':digest(p)}for p in out.glob('sand-*.png')]}

def main():
 p=argparse.ArgumentParser();p.add_argument('--defaults',action='store_true');args=p.parse_args(sys.argv[sys.argv.index('--')+1:]if '--'in sys.argv else []);need(args.defaults,'Use --defaults deliberately; use export.py for artist edits')
 for sid in SURFACES:
  for size in [2,10]:create_source(f'surface-{sid}-{size}m',0,HERE/'source'/f'surface-{sid}-{size}m.lod0.blend')
 for aid in PROPS:
  for lod in [0,1]:create_source(aid,lod,HERE/'source'/f'{aid}.lod{lod}.blend')
 create_sand(HERE/'source/sand-procedural-master.blend');dump(HERE/'qa/sand-bake.json',bake_sand(HERE/'source/sand-procedural-master.blend',HERE/'source/textures'))
if __name__=='__main__':main()

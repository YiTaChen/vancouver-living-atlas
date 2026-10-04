"""Original D01 modular station-space sources. Blender Z-up; all helpers take glTF metres.
Build recreates defaults; export.py opens saved editable sources without rebuilding.
"""
import argparse,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
IDS=['bus-stop-pole','platform-edge-2m','station-guidance-sign','bus-threshold-deck','metro-threshold-deck']
COLORS={'painted-metal':(.065,.16,.22,1),'sign-face':(.77,.81,.76,1),'sign-symbol':(.018,.048,.064,1),'concrete':(.49,.52,.48,1),'tactile-yellow':(.80,.55,.10,1)}
def clean():
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1;return s
def xyz(v):return (v[0],-v[2],v[1])
def mat(role):
 m=bpy.data.materials.get(role)
 if m:return m
 m=bpy.data.materials.new(role);m.diffuse_color=COLORS[role];m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=COLORS[role];n.inputs['Roughness'].default_value=.65 if role!='painted-metal' else .4;n.inputs['Metallic'].default_value=.6 if role=='painted-metal' else 0;m['semanticRole']=role;m['sharedSurfaceId']='station-'+role;return m
def finish(o,name,role,bevel=0):
 o.name=name;o.data.name=name+'-editable-mesh';o.data.materials.append(mat(role));o['semanticRole']=role
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 # Box projection metric UV, preserved in source and exported.
 uv=o.data.uv_layers.new(name='UVMap') if not o.data.uv_layers else o.data.uv_layers[0]
 for p in o.data.polygons:
  dominant=max(range(3),key=lambda k:abs(p.normal[k]));axes=[i for i in range(3) if i!=dominant]
  for li in p.loop_indices:
   v=o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=(v[axes[0]],v[axes[1]])
 if bevel:
  m=o.modifiers.new('Editable edge chamfer','BEVEL');m.width=min(bevel,min(o.dimensions)/5);m.segments=2;m.affect='EDGES'
  n=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');n.keep_sharp=True
 o.select_set(False);return o
def box(name,c,d,role,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(c));o=bpy.context.object;o.dimensions=(d[0],d[2],d[1]);return finish(o,name,role,bevel)
def cyl(name,c,r,h,role,lod):
 bpy.ops.mesh.primitive_cylinder_add(vertices=12 if lod==0 else 6,radius=r,depth=h,location=xyz(c));return finish(bpy.context.object,name,role)
def prism(name,points,z0,z1,role):
 # Points in X/Y plane, depth in Z.
 vs=[xyz((x,y,z)) for z in (z0,z1) for x,y in points];n=len(points);fs=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return finish(o,name,role)
def anchor(name,p):
 o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=xyz(p);o.empty_display_type='PLAIN_AXES';o.empty_display_size=.12;o['anchor']=True

def build(a,lod):
 b=.008 if lod==0 else 0
 if a=='bus-stop-pole':
  cyl('ground-foot',(0,.035,0),.13,.07,'painted-metal',lod);cyl('pole',(0,1.35,0),.032,2.63,'painted-metal',lod)
  box('stop-sign-frame',(0,2.285,.015),(.58,.73,.12),'painted-metal',b)
  box('stop-sign-face',(0,2.29,.080),(.52,.66,.016),'sign-face',b)
  # Original abstract bus pictogram, no operator logo, route number or branding.
  box('bus-pictogram-body',(0,2.36,.093),(.31,.28,.008),'sign-symbol',b)
  box('bus-pictogram-window',(0,2.4,.10),(.25,.13,.008),'sign-face')
  for x in [-.10,.10]:box('bus-pictogram-wheel-'+str(x),(x,2.20,.098),(.058,.09,.016),'sign-symbol')
  box('generic-route-rule',(0,2.085,.097),(.30,.033,.008),'sign-symbol')
  if lod==0:
   for x in [-.21,.21]:cyl('sign-mount-'+str(x),(x,1.957,0),.016,.04,'painted-metal',lod)
  anchor('ground-contact',[0,0,0]);anchor('read-face',[0,2.285,.1])
 elif a=='platform-edge-2m':
  # +X is track edge, +Z is track direction; upper surface exactly Y=.95.
  box('platform-foundation',(0,.435,0),(4,.87,2),'concrete')
  box('platform-deck',(-.335,.91,0),(3.33,.08,2),'concrete')
  box('platform-edge-cap',(1.67,.91,0),(.66,.08,2),'concrete')
  box('tactile-band',(1.65,.951,0),(.50,.002,2),'tactile-yellow')
  if lod==0:
   # shallow recessed-looking studs contained within the .95m height contract.
   for x in [1.49,1.65,1.81]:
    for z in [-.84,-.60,-.36,-.12,.12,.36,.60,.84]:
     cyl('tactile-stud', (x,.9535,z),.019,.003,'tactile-yellow',1)
   for z in [-.75,-.25,.25,.75]:box('edge-face-drain', (1.998,.64,z),(.004,.05,.10),'painted-metal')
  anchor('platform-top',[0,.95,0]);anchor('track-edge',[2,.95,0]);anchor('join-forward',[0,.95,1]);anchor('join-back',[0,.95,-1])
 elif a in ['bus-threshold-deck','metro-threshold-deck']:
  x0,x1,width=(-.50,.45,.95) if a=='bus-threshold-deck' else (-.48,.42,1.10)
  # Floor-edge root; short 1.5cm rise with 20cm tapered bearing ends (7.5% grade).
  profile=[(x0,-.02),(x1,-.02),(x1,0),(x1-.20,.015),(x0+.20,.015),(x0,0)]
  prism('threshold-deck',profile,-width/2,width/2,'painted-metal')
  if lod==0:
   for z in [-width*.34,0,width*.34]:
    box('deck-grip-strip',((x0+x1)/2,.014,z),(.24,.002,.025),'tactile-yellow')
  anchor('station-bearing',[x0,0,0]);anchor('vehicle-bearing',[x1,0,0]);anchor('deck-high-point',[0,.015,0])
 else:
  for x in [-.85,.85]:
   box('sign-post-'+str(x),(x,1.36,0),(.07,2.72,.07),'painted-metal',b)
   box('sign-foot-'+str(x),(x,.035,0),(.18,.07,.24),'painted-metal',b)
  box('guidance-panel',(0,2.59,0),(1.8,.52,.13),'painted-metal',b)
  box('guidance-face',(0,2.59,.07),(1.72,.44,.014),'sign-face',b)
  prism('direction-arrow',[(-.69,2.59),(-.47,2.75),(-.47,2.65),(-.23,2.65),(-.23,2.53),(-.47,2.53),(-.47,2.43)],.078,.086,'sign-symbol')
  for y,w in [(2.67,.61),(2.54,.43)]:box('generic-destination-rule-'+str(y),(.33,y,.083),(w,.045,.009),'sign-symbol')
  anchor('ground-contact',[0,0,0]);anchor('clear-passage',[0,0,0]);anchor('read-face',[0,2.59,.085])

def export_source(src,out,batch_static=True):
 bpy.ops.wm.open_mainfile(filepath=str(src));bpy.ops.object.select_all(action='DESELECT')
 for o in bpy.context.scene.objects:
  if o.type in {'MESH','EMPTY'} and not o.get('qaOnly',False):o.select_set(True)
 out.parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_materials='EXPORT',export_extras=True,export_cameras=False,export_lights=False)
 if batch_static:
  sys.path.insert(0,str(ROOT))
  from batch_static import batch
  batch(out)

def main():
 selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else IDS
 for a in selected:
  assert a in IDS
  for l in range(2):
   clean();build(a,l);s=ROOT/'source'/f'{a}.lod{l}.blend';bpy.context.scene['assetId']=a;bpy.context.scene['lod']=l;bpy.context.scene['authoredSource']='original unbaked parametric components; modifiers and UV retained';bpy.ops.wm.save_as_mainfile(filepath=str(s),compress=True);export_source(s,ROOT/'exports'/f'{a}.lod{l}.glb')
if __name__=='__main__':main()

"""Original, representative four-car metro. Authoring source only, never re-export edits here."""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from contract import vehicle, PROFILE, write_manifest

def B(p): return (p[0],-p[2],p[1])
def reset():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.preferences.filepaths.save_version=0
 bpy.context.scene.unit_settings.system='METRIC'; bpy.context.scene.unit_settings.scale_length=1
 bpy.context.scene.render.threads_mode='FIXED'; bpy.context.scene.render.threads=2
 global mats,root
 mats={}
 for role,color,rough,metal,alpha in [('paint',(1,1,1),.32,.48,1),('glass',(.32,.52,.62),.12,.12,.25),('rubber',(.027,.038,.047),.88,0,1),('steel-metal',(.12,.16,.18),.40,.90,1),('lights',(1,.87,.58),.35,0,1),('floor',(.24,.29,.31),.83,0,1),('wall',(.72,.76,.75),.6,.12,1),('seat',(.08,.27,.46),.75,0,1),('priority-seat',(.75,.28,.08),.72,0,1),('rail',(.63,.69,.70),.23,.85,1),('screen',(.05,.23,.32),.5,0,1)]:
  m=bpy.data.materials.new('metro-'+role); m.use_nodes=True; m.diffuse_color=(*color,alpha); p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,alpha); p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal; p.inputs['Alpha'].default_value=alpha
  if role=='paint':
   attr=m.node_tree.nodes.new('ShaderNodeVertexColor'); attr.layer_name='Tint'; m.node_tree.links.new(attr.outputs['Color'],p.inputs['Base Color'])
  if role in ('lights','screen'):
   p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=2 if role=='lights' else .5
  if role=='glass': m.surface_render_method='DITHERED'; m.use_backface_culling=True
  mats[role]=m
 root=empty('vehicle',[0,0,0],None); root['profileId']=PROFILE; root['datum']='rail contact Y=0; midpoint of bogie centers; glTF +Z front'

def empty(name,p,parent=True):
 o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o)
 o.location=B(p)
 if parent is True: o.parent=root
 elif parent is not None: o.parent=parent
 return o

def tint(o,color):
 a=o.data.color_attributes.new(name='Tint',type='FLOAT_COLOR',domain='CORNER')
 for d in a.data: d.color=(*color,1)

def box(name,p,size,role='paint',color=(.65,.72,.74),bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=B(p)); o=bpy.context.object; o.name=name; o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); o.data.materials.append(mats[role]); o.parent=root
 if role=='paint': tint(o,color)
 if bevel:
  mod=o.modifiers.new('editable-edge-bevel','BEVEL'); mod.width=bevel; mod.segments=1
 return o

def cylinder(name,p,r,length,role='rubber',axis='X',vertices=12):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=length,location=B(p)); o=bpy.context.object; o.name=name
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Z':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True); o.data.materials.append(mats[role]);o.parent=root
 if role=='paint':tint(o,(.55,.61,.62))
 return o

def join(obs,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=name
 # Preserve bevel on authored individual parts via evaluated exporter; joining modifier-bearing
 # objects would lose non-active modifiers, so detailed trim gets explicit unmodified geometry.
 return o

def mesh_plane(name,verts,faces,role):
 m=bpy.data.meshes.new(name);m.from_pydata([B(p) for p in verts],[],faces);m.update();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(mats[role]);o.parent=root; return o

def anchors(v,include):
 for a in v['anchors']:
  if a['resource']==include:empty(a['nodeId'],a['positionM'])

def exterior(variant,lod):
 v=vehicle(variant); shell=[]; glass=[]; lights=[]
 if lod==2:
  shell.append(box('body-shell',[0,2.015,0],[2.65,2.17,17]))
  shell.append(box('roof',[0,3.19,0],[2.8,.14,17],color=(.50,.57,.59)))
  for side in [-1,1]:
   glass.append(box('closed-window-band',[side*1.329,2.32,0],[.008,.88,15.7],'glass'))
   for z in [-5.5,0,5.5]:shell.append(box('closed-door-inlay',[side*1.334,1.975,z],[.006,2.05,1.4],color=(.25,.36,.43)))
 else:
  spans=[(-8.5,-6.2),(-4.8,-.7),(.7,4.8),(6.2,8.5)]
  for side in [-1,1]:
   for i,(a,b) in enumerate(spans):
    shell.append(box('side-sill',[side*1.28,1.315,(a+b)/2],[.09,.77,b-a]))
    shell.append(box('side-header',[side*1.28,3.0,(a+b)/2],[.09,.24,b-a]))
    n=1 if b-a<3 else 2
    edges=[a+(b-a)*k/n for k in range(n+1)]
    for j,z in enumerate(edges):shell.append(box('window-mullion',[side*1.28,2.29,z+(.045 if j==0 else -.045 if j==len(edges)-1 else 0)],[.09,1.18,.09]))
    for aa,bb in zip(edges,edges[1:]):glass.append(box('side-glass',[side*1.283,2.29,(aa+bb)/2],[.018,1.18,bb-aa-.09],'glass'))
    if lod==0:shell.append(box('blue-belt',[side*1.328,1.49,(a+b)/2],[.012,.19,b-a],color=(.045,.14,.27)))
    if lod==0:shell.append(box('yellow-pinstripe',[side*1.329,1.625,(a+b)/2],[.013,.038,b-a],color=(.86,.56,.07)))
   for z in [-5.5,0,5.5]:
    shell.append(box('door-header',[side*1.28,3.07,z],[.09,.14,1.4]))
    shell.append(box('door-threshold',[side*1.275,.915,z],[.10,.07,1.4],color=(.6,.62,.54)))
  shell.append(box('roof-center',[0,3.215,0],[2.65,.17,17],color=(.55,.62,.64)))
  # Chamfered shoulder roof pieces remain separate authored primitives.
  for side in [-1,1]:shell.append(box('roof-eave',[side*1.35,3.18,0],[.1,.10,17],color=(.55,.62,.64)))
  for end in [-1,1]:
   observation=(variant=='lead' and end==1) or (variant=='tail' and end==-1)
   if observation:
    shell.append(box('observation-sill',[0,1.295,end*8.455],[2.65,.69,.09]))
    for side in [-1,1]:shell.append(box('observation-pillar',[side*1.2225,2.295,end*8.455],[.205,1.31,.09],color=(.08,.19,.29)))
    shell.append(box('observation-header',[0,3.045,end*8.455],[2.65,.15,.09]))
    glass.append(box('observation-glass',[0,2.295,end*8.46],[2.24,1.31,.018],'glass'))
    for side in [-1,1]:lights.append(box('headlight',[side*.93,1.36,end*8.508],[.25,.12,.025],'lights'))
   else:
    for side in [-1,1]:shell.append(box('gangway-jamb',[side*.9525,1.995,end*8.455],[.745,2.11,.09]))
    shell.append(box('gangway-header',[0,3.075,end*8.455],[1.16,.09,.09]))
    for side in [-1,1]:shell.append(box('gangway-bellows-side',[side*.64,2.00,end*8.65],[.12,2.1,.3],'rubber'))
    shell.append(box('gangway-bellows-header',[0,3.06,end*8.65],[1.4,.12,.3],'rubber'))
    shell.append(box('gangway-floor-bridge',[0,.915,end*8.65],[1.16,.07,.3],color=(.49,.56,.58)))
   shell.append(box('coupler',[0,.64,end*8.7],[.32,.20,.40],'steel-metal'))
  for d in v['doors']:
   p=d['closedTransform']['translationM']; sid=d['doorId']; leaf=[]
   # All component geometry in root coordinates, then origin moved to rest leaf datum.
   leaf.append(box(sid+'-lower',[p[0],1.345,p[2]],[.055,.79,.69],color=(.19,.31,.40)))
   leaf.append(box(sid+'-top',[p[0],2.95,p[2]],[.055,.1,.69],color=(.19,.31,.40)))
   for dz in [-.33,.33]:leaf.append(box(sid+'-stile',[p[0],2.29,p[2]+dz],[.055,1.22,.03],color=(.19,.31,.40)))
   leaf.append(box(sid+'-glass',[p[0],2.29,p[2]],[.02,1.22,.63],'glass'))
   o=join(leaf,d['nodeId']); bpy.context.scene.cursor.location=B(p);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o['doorId']=sid;o['motion']='pure transform endpoints in manifest; local XYZ converted once'
 for z in [-2.6,2.6]:shell.append(box('roof-equipment',[0,3.39,z],[1.18,.18,1.5],color=(.40,.47,.49)))
 # Wheel and bogie nodes persist even at display-only LOD2.
 for b in v['bogies']:
  parent=empty(b['nodeId'],b['centerM']); o=box(b['nodeId']+'-frame',[0,.44,b['centerM'][2]],[1.75,.28,2.05],'steel-metal');o.parent=parent;o.location-=parent.location
 for w in v['wheels']:
  o=cylinder(w['nodeId'],w['centerM'],w['radiusM'],.16,role='steel-metal',vertices=[16,8,4][lod]);
  # Keep wheel local frame directly at root; bogie association is explicit metadata.
 if lod==2:
  for end in [-1,1]:shell.append(box('coupler',[0,.64,end*8.7],[.32,.20,.40],'steel-metal'))
  for end in [-1,1]:glass.append(box('end-closed-glass',[0,2.35,end*8.505],[2.15,1.1,.01],'glass'))
 join(shell,'body-shell')
 if glass:join(glass,'glass')
 if lights:join(lights,'lights')
 anchors(v,'exterior')

def interior(lod):
 v=vehicle('middle'); shell=[];rails=[]
 # Top face is a real +Y surface; both geometric and metadata floor share exact vertices.
 box('floor',[0,.915,0],[2.45,.07,17],'floor')
 box('ceiling',[0,3.14,0],[2.45,.06,17],'wall')
 for side in [-1,1]:
  for a,b in [(-8.5,-6.2),(-4.8,-.7),(.7,4.8),(6.2,8.5)]:
   shell.append(box('interior-wall-lower',[side*1.219,1.315,(a+b)/2],[.012,.73,b-a],'wall'))
   shell.append(box('interior-wall-upper',[side*1.219,3.0,(a+b)/2],[.012,.20,b-a],'wall'))
 for s in v['seats']:
  x,y,z=s['pelvisPointM']; role='priority-seat' if s['priority'] else 'seat'
  objs=[box('cushion',[x,1.36,z],[.46,.08,.46],role),box('back',[math.copysign(1.17,x),1.63,z],[.075,.54,.46],role)]
  if lod==0:objs.append(box('seat-support',[x,1.15,z],[.22,.40,.23],'rail'))
  join(objs,s['nodeId'])
 for side in [-1,1]:
  for z in [-4.15,-1.2,1.2,4.15]:
   if (side==1 and z==-4.15) or (side==-1 and z==4.15):continue
   rails.append(cylinder('stanchion',[side*.67,2.01,z],.018,2.12,'rail',axis='Y',vertices=8 if lod==0 else 6))
  rails.append(cylinder('overhead-rail',[side*.70,3.08,0],.018,15.3,'rail',axis='Z',vertices=8 if lod==0 else 6))
  for z in [-4.3,4.3]:box('next-stop-screen-'+str(side)+'-'+str(z),[side*1.15,2.90,z],[.06,.23,.62],'screen')
 if lod==0:
  for side in [-1,1]:
   for z in [-2.9,2.9]:rails.append(cylinder('seat-entry-handle',[side*.72,1.86,z],.018,.55,'rail',axis='Y',vertices=8))
 join(shell,'interior-walls');join(rails,'handrails')
 anchors(v,'interior')

def export(path):
 bpy.ops.object.select_all(action='SELECT')
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_animations=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 if 'interior' in path.stem:
  from batch_static import batch
  batch(path)

if __name__=='__main__':
 for variant in ['lead','middle','tail']:
  for lod in range(3):
   reset();exterior(variant,lod);stem=f'expo-metro-{variant}-exterior.lod{lod}';bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'{stem}.blend'),compress=True);export(ROOT/'exports'/f'{stem}.glb')
 for lod in range(2):
  reset();interior(lod);stem=f'expo-metro-shared-interior.lod{lod}';bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'{stem}.blend'),compress=True);export(ROOT/'exports'/f'{stem}.glb')
 write_manifest()

"""Original editable representative Canada Line meshes. Regeneration is explicit; use export.py for artist edits."""
import bpy,sys,math,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT));from contract import vehicle,DOOR_Z,FLOOR,PROFILE,write_manifest

def B(p):return (p[0],-p[2],p[1])
def reset():
 global mats,root
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0;bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1;mats={}
 for role,col,rough,metal,alpha in [('shell',(.62,.67,.69),.37,.55,1),('blue',(.025,.20,.60),.34,.18,1),('glass',(.14,.26,.31),.15,.10,.30),('steel',(.15,.18,.20),.38,.9,1),('rubber',(.025,.03,.035),.9,0,1),('floor',(.19,.24,.27),.83,0,1),('wall',(.77,.80,.77),.68,0,1),('seat',(.08,.28,.42),.78,0,1),('priority',(.44,.54,.18),.77,0,1),('rail',(.57,.63,.63),.29,.8,1),('sign',(.04,.10,.16),.65,0,1),('lamp',(.82,.88,.86),.4,0,1)]:
  m=bpy.data.materials.new('canada-'+role);m.use_nodes=True;m.diffuse_color=(*col,alpha);p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,alpha);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;p.inputs['Alpha'].default_value=alpha;m['semantic_role']=role
  if role=='glass':m.surface_render_method='DITHERED';m.use_backface_culling=True
  mats[role]=m
 root=empty('vehicle',[0,0,0],None);root['profileId']=PROFILE;root['datum']='Rail contact plane Y=0 in glTF; +Z observation front'
def empty(n,p,parent=True):
 o=bpy.data.objects.new(n,None);bpy.context.collection.objects.link(o);o.location=B(p)
 if parent is True:o.parent=root
 elif parent is not None:o.parent=parent
 return o
def box(n,p,s,role='shell'):
 bpy.ops.mesh.primitive_cube_add(size=1,location=B(p));o=bpy.context.object;o.name=n;o.dimensions=(s[0],s[2],s[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mats[role]);o.parent=root;return o
def cylinder(n,p,r,length,role='steel',axis='X',vertices=12):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=length,location=B(p));o=bpy.context.object;o.name=n
 if axis=='X':o.rotation_euler[1]=math.pi/2
 elif axis=='Z':o.rotation_euler[0]=math.pi/2
 bpy.ops.object.transform_apply(location=False,rotation=True,scale=True);o.data.materials.append(mats[role]);o.parent=root;return o
def join(obs,n):
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();o=bpy.context.object;o.name=n;return o
def anchors(res):
 for a in vehicle()['anchors']:
  if a['resource']==res:empty(a['nodeId'],a['positionM'])
def exterior(lod):
 v=vehicle();shell=[];glazing=[];blue=[];rubber=[]
 if lod==2:
  shell.append(box('closed-body',[0,2.30,0],[3,2.6,20.5]));glazing.append(box('closed-front',[0,2.5,10.242],[2.44,1.45,.016],'glass'))
  for sign in [-1,1]:
   glazing.append(box('closed-window-band',[sign*1.508,2.5,0],[.015,1.15,18.8],'glass'))
   for z in DOOR_Z:blue.append(box('closed-door-inlay',[sign*1.519,2.165,z],[.014,2.13,1.5],'blue'))
 else:
  for sign in [-1,1]:
   for a,b in [(-10.25,-7.15),(-5.65,-.75),(.75,5.65),(7.15,10.25)]:
    shell.extend([box('side-lower',[sign*1.455,1.47,(a+b)/2],[.09,.74,b-a]),box('side-header',[sign*1.455,3.35,(a+b)/2],[.09,.3,b-a])]);n=2 if b-a>4 else 1
    for j in range(n):
     aa=a+(b-a)*j/n;bb=a+(b-a)*(j+1)/n;glazing.append(box('window',[sign*1.459,2.50,(aa+bb)/2],[.016,1.32,bb-aa-.16],'glass'));shell.append(box('window-post',[sign*1.455,2.50,aa+.04],[.09,1.32,.08]))
    shell.append(box('window-end-post',[sign*1.455,2.50,b-.04],[.09,1.32,.08]))
   for z in DOOR_Z:
    shell.extend([box('door-header',[sign*1.455,3.34,z],[.09,.22,1.5]),box('threshold',[sign*1.45,1.06,z],[.1,.08,1.5])])
   blue.append(box('end-blue-vertical',[sign*1.506,2.26,9.75],[.012,2.26,.65],'blue'))
  # Open observation-front glazing, distinctive blue fascia, no invented driver cabin.
  shell.append(box('front-lower',[0,1.415,10.205],[3,.63,.09]));blue.extend([box('front-blue-header',[0,3.29,10.205],[3,.32,.09],'blue'),box('front-blue-belt',[0,1.82,10.208],[3,.18,.096],'blue')])
  for sign in [-1,1]:blue.append(box('front-blue-pillar',[sign*1.35,2.49,10.205],[.3,1.32,.09],'blue'))
  glazing.append(box('observation-glass',[0,2.53,10.217],[2.4,1.24,.016],'glass'))
  for sign in [-1,1]:
   shell.append(box('gangway-jamb',[sign*1.075,2.165,-10.205],[.85,2.13,.09]));rubber.append(box('gangway-bellows',[sign*.73,2.17,-10.365],[.16,2.14,.27],'rubber'))
  shell.extend([box('gangway-header',[0,3.34,-10.205],[1.3,.22,.09]),box('gangway-bridge',[0,1.06,-10.325],[1.3,.08,.35])]);rubber.append(box('gangway-bellows-top',[0,3.31,-10.365],[1.62,.16,.27],'rubber'))
  for d in v['doors']:
   x,y,z=d['closedTransform']['translationM'];parts=[box('leaf-lower',[x,1.50,z],[.06,.8,.738]),box('leaf-top',[x,3.15,z],[.06,.16,.738])]
   for dz in [-.348,.348]:parts.append(box('leaf-stile',[x,2.485,z+dz],[.06,1.17,.042]))
   parts.append(box('leaf-window',[x,2.485,z],[.024,1.17,.654],'glass'));o=join(parts,d['nodeId']);bpy.context.scene.cursor.location=B([x,y,z]);bpy.ops.object.origin_set(type='ORIGIN_CURSOR');o['doorId']=d['doorId']
 shell.append(box('roof',[0,3.575,0],[3,.15,20.5]))
 for z in [-3.4,3.4]:shell.append(box('roof-vent',[0,3.655,z],[1.3,.10,2.1]))
 if lod<2:
  for sign in [-1,1]:box('front-lamp-'+str(sign),[sign*1.0,1.5,10.244],[.3,.2,.012],'lamp')
  box('destination-panel',[0,3.06,10.245],[1.1,.17,.01],'sign')
 for b in v['bogies']:
  parent=empty(b['nodeId'],b['centerM']);o=box(b['nodeId']+'-frame',[0,.49,b['centerM'][2]],[1.85,.26,2.7],'steel');o.parent=parent;o.location-=parent.location
 for w in v['wheels']:cylinder(w['nodeId'],w['centerM'],w['radiusM'],w['widthM'],vertices=[16,8,6][lod])
 for z in [10.07,-10.35]:box('coupler-mesh',[0,.68,z],[.32,.20,.30],'steel')
 join(shell,'body-shell')
 if glazing:join(glazing,'glass')
 if blue:join(blue,'blue-fascia')
 if rubber:join(rubber,'gangway-rubber')
 anchors('exterior')
def interior(lod):
 box('floor',[0,1.06,-.045],[2.8,.08,20.41],'floor');box('ceiling',[0,3.48,-.045],[2.8,.06,20.41],'wall');walls=[]
 for sign in [-1,1]:
  for a,b in [(-10.25,-7.15),(-5.65,-.75),(.75,5.65),(7.15,10.16)]:
   walls.extend([box('wall-lower',[sign*1.402,1.47,(a+b)/2],[.015,.74,b-a],'wall'),box('wall-upper',[sign*1.402,3.35,(a+b)/2],[.015,.22,b-a],'wall')])
 for s in vehicle()['seats']:
  x,y,z=s['pelvisPointM'];sign=1 if x>0 else -1;role='priority' if s['priority'] else 'seat';parts=[box('cantilever-cushion',[x,1.56,z],[.56,.10,.56],role),box('seat-back',[sign*1.388,1.875,z],[.065,.65,.56],role)]
  # Wall attached, deliberately no floor supports, matching official reference.
  if lod==0:parts.append(box('cantilever-bracket',[sign*1.36,1.51,z],[.12,.08,.42],'rail'))
  join(parts,s['nodeId'])
 rails=[]
 for sign in [-1,1]:
  for z in [-7.35,-5.45,-.97,.97,5.45,7.35]:
   # Keep wheelchair and baggage rectangles and all door-width crossings clear.
   if (sign==1 and z==.97) or (sign==-1 and z==-.97):continue
   rails.append(cylinder('stanchion',[sign*.74,2.27,z],.022,2.34,'rail',axis='Y',vertices=8 if lod==0 else 6))
  rails.append(cylinder('overhead-rail',[sign*.74,3.28,0],.022,18.4,'rail',axis='Z',vertices=8 if lod==0 else 6))
 for z in [-5.2,5.2]:
  for sign in [-1,1]:box('next-stop-display',[sign*1.36,3.25,z],[.08,.24,1.0],'sign')
 join(walls,'interior-walls');join(rails,'handrails');anchors('interior')

def export(path):
 bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_yup=True,export_apply=True,export_animations=False,export_extras=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
 if 'interior' in path.stem:
  spec=importlib.util.spec_from_file_location('atlas_metro_batch',ROOT.parent/'boardable-metro/batch_static.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.batch(path)
if __name__=='__main__':
 for kind,count in [('exterior',3),('interior',2)]:
  for lod in range(count):
   reset();exterior(lod) if kind=='exterior' else interior(lod);stem=f'canada-line-{"endcar" if kind=="exterior" else "shared"}-{kind}.lod{lod}';bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/f'{stem}.blend'),compress=True);export(ROOT/'exports'/f'{stem}.glb')
 write_manifest()

"""Original representative E01 meshes. Author in metres; never invoked by export.py."""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
SPECS={
 'traffic-sedan':dict(variant='sedan',width=1.86,bodyWidth=1.80,height=1.48,length=4.50,front=2.30,rear=-2.20,wheelbase=2.70,radius=.32,track=1.57,cabinRear=-1.22,cabinFront=1.08,roofRear=-.65,roofFront=.45,shoulder=.94),
 'traffic-suv':dict(variant='suv',width=1.92,bodyWidth=1.86,height=1.76,length=4.65,front=2.375,rear=-2.275,wheelbase=2.78,radius=.35,track=1.62,cabinRear=-1.84,cabinFront=1.13,roofRear=-1.40,roofFront=.54,shoulder=1.08)}
def point(p):return (p[0],-p[2],p[1])
def clear():
 bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1;s.render.threads_mode='FIXED';s.render.threads=2;bpy.context.preferences.filepaths.save_version=0
 bpy.data.collections.new('AUTHORING-metre-scale');s.collection.children.link(bpy.data.collections['AUTHORING-metre-scale'])
def material(name,color,rough,metal,vertex=False):
 m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1);m.use_backface_culling=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
 if vertex:
  n=m.node_tree.nodes.new('ShaderNodeVertexColor');n.layer_name='RoleColor';m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
 m['semantic_role']=name;m['shared_surface_id']={'paint':'traffic-shared-recolorable-paint','glass':'traffic-shared-glazing-and-lenses','rubber':'traffic-shared-tyre-rubber'}[name]
 return m
def mesh(name,verts,faces,mat,color=None,closed=True,normal=None):
 v=[point(a) for a in verts];f=[list(a) for a in faces]
 if normal:
  a,b,c=[Vector(verts[i]) for i in f[0][:3]]
  if (b-a).cross(c-a).dot(Vector(normal))<0:f=[list(reversed(a)) for a in f]
 me=bpy.data.meshes.new(name+'-editable-mesh');me.from_pydata(v,[],f);me.update();ob=bpy.data.objects.new(name,me);bpy.data.collections['AUTHORING-metre-scale'].objects.link(ob);me.materials.append(mat);ob['semantic_role']=mat.name;ob['export_asset']=True
 if closed:
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
 uv=me.uv_layers.new(name='UVMap')
 for poly in me.polygons:
  axis=max(range(3),key=lambda k:abs(poly.normal[k]));axes=[k for k in range(3) if k!=axis]
  if len(poly.loop_indices)==4:
   vs=[me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices];u=(vs[1]-vs[0]).length;v=(vs[3]-vs[0]).length
   for li,pair in zip(poly.loop_indices,[(0,0),(u,0),(u,v),(0,v)]):uv.data[li].uv=pair
  else:
   for li in poly.loop_indices:
    co=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]],co[axes[1]])
 if color:
  ca=me.color_attributes.new(name='RoleColor',type='FLOAT_COLOR',domain='CORNER')
  for d in ca.data:d.color=(*color,1)
 return ob
def box(name,center,size,mat,color=None):
 x,y,z=center;a,b,c=[v/2 for v in size]
 return mesh(name,[(x+sx*a,y+sy*b,z+sz*c) for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat,color)
def wheel(name,x,y,z,r,depth,n,mat,color=None):
 verts=[(x+side*depth/2,y+r*math.cos(2*math.pi*i/n),z+r*math.sin(2*math.pi*i/n)) for side in [-1,1] for i in range(n)]
 faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 ob=mesh(name,verts,faces,mat,color);center=Vector(point((x,y,z)))
 for v in ob.data.vertices:v.co-=center
 ob.location=center;ob['wheel_radius_m']=r;ob['axle_axis_gltf']='+X';ob['anchor_center_gltf']=[x,y,z]
 return ob
def body(s,lod,paint):
 if lod==2:return box('body-shell',(0,(s['shoulder']+.15)/2,(s['front']+s['rear'])/2),(s['width'],s['shoulder']-.15,s['length']),paint)
 wb=s['wheelbase']/2;r=s['radius']+.06;zs=[s['rear'],s['rear']+.15,-.45,.45,s['front']-.17,s['front']]
 for cz in [-wb,wb]:zs += [cz+r*math.sin(-math.pi/2+math.pi*i/(8 if lod==0 else 4)) for i in range((8 if lod==0 else 4)+1)]
 zs=sorted(set(round(z,6) for z in zs));verts=[]
 for z in zs:
  e=min((z-s['rear'])/.25,(s['front']-z)/.25,1);w=s['bodyWidth']/2*(.91+.09*max(0,e));top=s['shoulder']-.08*(1-max(0,e));bottom=.25 if s['variant']=='sedan' else .28
  arch=max([bottom]+[s['radius']+math.sqrt(max(0,r*r-(z-a)**2)) for a in [-wb,wb] if abs(z-a)<=r]);shoulder=top-.13
  # Raised lower outer edge is a real wheel-arch contour. Inner chassis stays inboard.
  verts += [(x,y,z) for x,y in [(-.60,bottom),(-w*.98,arch),(-w,shoulder),(-w*.93,top-.035),(-w*.70,top),(w*.70,top),(w*.93,top-.035),(w,shoulder),(w*.98,arch),(.60,bottom)]]
 faces=[tuple(range(9,-1,-1))]
 for j in range(len(zs)-1):faces += [(j*10+i,j*10+(i+1)%10,(j+1)*10+(i+1)%10,(j+1)*10+i) for i in range(10)]
 faces.append(tuple((len(zs)-1)*10+i for i in range(10)));return mesh('body-shell',verts,faces,paint)
def cabin(s,lod,paint,glass):
 b=s['shoulder']-.005;t=s['height'];w=s['bodyWidth']/2-.075;rw=w-.14;br=s['cabinRear'];bf=s['cabinFront'];rr=s['roofRear'];rf=s['roofFront']
 verts=[(-w,b,br),(w,b,br),(w,b,bf),(-w,b,bf),(-rw,t-.035,rr),(rw,t-.035,rr),(rw,t-.035,rf),(-rw,t-.035,rf),(0,t,rr),(0,t,rf)]
 faces=[(0,3,2,1),(0,1,5,8,4),(3,7,9,6,2),(0,4,7,3),(1,2,6,5),(4,8,9,7),(8,5,6,9)]
 if lod==2:
  # Far layer keeps the previous body/cabin massing intent; no fine door trim.
  return mesh('cabin-silhouette',verts,faces,glass,(.12,.21,.26))
 mesh('cabin-shell',verts,faces,paint)
 def panel(name,v,n):return mesh(name,v,[tuple(range(len(v)))],glass,(.085,.16,.21),closed=False,normal=n)
 # Side window subdivisions retain a painted A/B/C pillar frame.
 for sign,label in [(-1,'right'),(1,'left')]:
  def at(z,upper):
   if upper:return(sign*(rw+.004),t-.10,z)
   return(sign*(w+.004),b+.085,z)
  panel('glass-'+label+'-rear',[at(br+.13,False),at(-.12,False),at(-.12,True),at(rr+.08,True)],(sign,0,0))
  panel('glass-'+label+'-front',[at(-.04,False),at(bf-.13,False),at(rf-.06,True),at(-.04,True)],(sign,0,0))
 # Fit panes to sloped planes using interpolation from actual lower to roof rings.
 def pane(name,z0,z1,n):
  v=[]
  for a,xsgn in [(.12,-1),(.12,1),(.86,1),(.86,-1)]:
   y=b+(t-.035-b)*a+.022;z=z0+(z1-z0)*a+( .025 if n[2]>0 else -.025);x=xsgn*(w+(rw-w)*a-.07);v.append((x,y,z))
  panel(name,v,n)
 pane('glass-windshield',bf,rf,(0,.4,1));pane('glass-rear-window',br,rr,(0,.4,-1))
def lamps(s,lod,glass):
 for side in [-1,1]:
  x=side*s['bodyWidth']*.33
  for front in [True,False]:
   z=(s['front']+.002) if front else(s['rear']-.002);y=s['shoulder']-.18;width=.37 if front else .30
   mesh(('headlight-lens-' if front else 'taillight-lens-')+('left' if side>0 else 'right'),[(x-width/2,y-.065,z),(x+width/2,y-.065,z),(x+width/2,y+.055,z),(x-width/2,y+.055,z)],[(0,1,2,3)],glass,(.85,.93,1) if front else (.65,.025,.013),closed=False,normal=(0,0,1 if front else -1))
def build(aid,s,lod):
 clear();paint=material('paint',(.20,.36,.44),.30,.38);glass=material('glass',(1,1,1),.32,.08,True);rubber=material('rubber',(.023,.028,.031),.79,.02)
 body(s,lod,paint);cabin(s,lod,paint,glass);n=[24,12,6][lod]
 for side,label in [(-1,'right'),(1,'left')]:
  for front,cz in [('front',s['wheelbase']/2),('rear',-s['wheelbase']/2)]:
   x=side*s['track']/2;ob=wheel('wheel-'+front+'-'+label,x,s['radius'],cz,s['radius'],.22,n,rubber)
   if lod==0:
    hub=wheel('hub-'+front+'-'+label,x+side*.114,s['radius'],cz,s['radius']*.62,.012,12,paint);hub.parent=ob;hub.location-=ob.location
    # Small recessed dark hub center creates wheel construction without extra role.
    cap=wheel('hub-center-'+front+'-'+label,x+side*.122,s['radius'],cz,.07,.012,8,rubber);cap.parent=ob;cap.location-=ob.location
 if lod<2:
  for side,label in [(-1,'right'),(1,'left')]:
   box('mirror-'+label,(side*(s['width']/2-.055),s['shoulder']+.11,.85),(.11,.10,.18),paint)
   if lod==0:
    # Grille and door hardware remain separate, explicitly named rubber details.
    for z in [-.65,.48]:box('door-handle-'+label+str(z),(side*(s['bodyWidth']/2-.01),s['shoulder']-.04,z),(.015,.025,.15),rubber)
  box('front-grille',(0,s['shoulder']-.30,s['front']+.001),(.65,.15,.012),rubber)
 lamps(s,lod,glass)
 scene=bpy.context.scene;scene['asset_id']=aid;scene['lod']=lod;scene['source_kind']='original-editable-authoring';scene['root_datum']='ground-contact; axle midpoint; +Z forward in glTF';scene['spec_json']=json.dumps(s)
 for ob in scene.objects:
  if ob.type=='MESH':ob['asset_id']=aid
 bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'source'/f'{aid}.lod{lod}.blend'),compress=True)
if __name__=='__main__':
 import argparse
 ap=argparse.ArgumentParser();ap.add_argument('--replace-sources',action='store_true');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if any((HERE/'source').glob('*.blend')) and not args.replace_sources:raise SystemExit('Existing editable sources: use export.py to preserve edits, or explicitly --replace-sources to rebuild defaults.')
 (HERE/'source').mkdir(parents=True,exist_ok=True)
 for aid,s in SPECS.items():
  for lod in range(3):build(aid,s,lod)
 print('SAVED_SIX_EDITABLE_CAR_SOURCES')

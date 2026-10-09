"""Blender-only original metre-scale authoring. No lights/cameras in source or export."""
import sys,json,math
from pathlib import Path
import bpy,bmesh
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT));from layout import COLORS
LAYOUT=json.loads((ROOT/'station-layout.json').read_text())
def xyz(p):return (p[0],-p[2],p[1])
def clean():
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1

def material(name):
 if name in bpy.data.materials:return bpy.data.materials[name]
 m=bpy.data.materials.new(name);m.diffuse_color=COLORS[name];m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=COLORS[name];n.inputs['Roughness'].default_value=.7;n.inputs['Metallic'].default_value=.65 if name=='steel' else 0;return m

def box(part):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(part['centerM']));o=bpy.context.object;o.name=part['id'];o.dimensions=(part['sizeM'][0],part['sizeM'][2],part['sizeM'][1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler.z=math.radians(part['yawDegrees']);
 if part.get('originAtTop'):
  w,h,l=part['sizeM'];section=[(-w/2,-h),(-w/2+.02,0),(w/2-.02,0),(w/2,-h)];vs=[xyz([x,y,z]) for z in [-l/2,l/2] for x,y in section];faces=[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)];mesh=bpy.data.meshes.new('tapered-threshold');mesh.from_pydata(vs,[],faces);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free();o.data=mesh
 if 'rotationQuaternionXYZW' in part:
  x,y,z,w=part['rotationQuaternionXYZW'];o.rotation_mode='QUATERNION';o.rotation_quaternion=(w,x,-z,y)
 o.data.materials.append(material(part['material']));o['semanticRole']=part['role'];o['componentId']=part['id'];return o

def build(s):
 clean();root=bpy.data.objects.new(s['stationId']+'-root',None);bpy.context.collection.objects.link(root);root['stationId']=s['stationId'];root['units']='m';root['status']='offline-representative; no runtime or survey acceptance'
 shared={}
 for p in s['geometryParts']:
  o=box(p);o.parent=root
  if p.get('assetRef'):
   aid=p['assetRef']
   if aid in shared:o.data=shared[aid]
   else:shared[aid]=o.data;o.data.name='shared-'+aid
 for a in s['anchors']:
  o=bpy.data.objects.new(a['nodeId'],None);bpy.context.collection.objects.link(o);o.location=xyz(a['pointM']);o.parent=root;o['anchorId']=a['id'];o['kind']=a['kind'];o.empty_display_size=.2
 # Signs are geometry-only information bands, no downloaded logo or artwork.
 for i,p in enumerate(s['platforms']):
  pos=p['doorAlignmentPoints'][len(p['doorAlignmentPoints'])//2]['stationWaitingPointM'];o=box({'id':p['platformId']+'-line-sign','centerM':[pos[0],pos[1]+2.7,pos[2]],'sizeM':[.08,.4,3.0],'yawDegrees':0,'material':p['lineId'],'role':'sign'});o.parent=root
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/(s['stationId']+'.blend')),compress=True)

if __name__=='__main__':
 for s in LAYOUT['stations']:
  if '--' not in sys.argv or s['stationId'] in sys.argv[sys.argv.index('--')+1:]:build(s)

if __name__=='__main__':
 for line,width in [('canada',.24),('expo',.22)]:
  clean();aid='threshold-bridge-'+line;box({'id':aid,'centerM':[0,0,0],'sizeM':[width,.015,1.3],'yawDegrees':0,'material':'steel','role':'threshold','originAtTop':True});bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/(aid+'.blend')),compress=True)

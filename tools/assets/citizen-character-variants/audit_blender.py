"""Independent re-import bounds, anatomical UV/normal/skin and LOD surface audit."""
import bpy,json,sys,math,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[2]

def load(path):
 bpy.ops.wm.read_factory_settings(use_empty=True);sc=bpy.context.scene;sc.render.fps=30;bpy.ops.import_scene.gltf(filepath=str(path));rig=next(o for o in sc.objects if o.type=='ARMATURE');rig.animation_data.action=None
 for t in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(t)
 for p in rig.pose.bones:p.matrix_basis.identity()
 bpy.context.view_layer.update();meshes=[o for o in sc.objects if o.type=='MESH' and any(m.type=='ARMATURE'for m in o.modifiers)];return sc,rig,meshes

def geometry(path):
 sc,rig,meshes=load(path);verts=[];uvs=[];triangles=[];normals=[];weights=[]
 for ob in meshes:
  m=ob.data;m.calc_loop_triangles()
  for t in m.loop_triangles:
   tris=[]
   for li in t.loops:
    loop=m.loops[li];v=m.vertices[loop.vertex_index];tris.append(len(verts));verts.append(ob.matrix_world@v.co);uvs.append(m.uv_layers.active.data[li].uv.copy());normals.append(m.corner_normals[li].vector.copy());weights.append({ob.vertex_groups[g.group].name:g.weight for g in v.groups})
   triangles.append(tris)
 return verts,uvs,triangles,normals,weights
ref=REPO/'public/models/citizen/vancouver-citizen.glb';rv,ru,rt,rn,rw=geometry(ref);tree=BVHTree.FromPolygons(rv,rt,all_triangles=True)

def bary(p,a,b,c):
 v0=b-a;v1=c-a;v2=p-a;d00=v0.dot(v0);d01=v0.dot(v1);d11=v1.dot(v1);d20=v2.dot(v0);d21=v2.dot(v1);den=d00*d11-d01*d01
 if abs(den)<1e-20:return (1/3,1/3,1/3)
 v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den;return (1-v-w,v,w)

reports=[]
for tag,path in [('old-lod1',REPO/'tools/assets/citizen/optimization/glb/citizen-lod1.glb'),('old-lod2',REPO/'tools/assets/citizen/optimization/glb/citizen-lod2.glb')]+[(f'citizen.lod{i}',ROOT/'exports'/f'citizen.lod{i}.glb')for i in [0,1,2]]:
 v,u,t,n,w=geometry(path);errors=[];uv=[];normal=[];waist=[];weights=[];degenerate=0
 for ids in t:
  p=sum((v[i] for i in ids),Vector())/3
  area=(v[ids[1]]-v[ids[0]]).cross(v[ids[2]]-v[ids[0]]).length/2
  if area<1e-12:degenerate+=1;continue
  q,no,face,dist=tree.find_nearest(p);refs=rt[face];b=bary(q,*[rv[i]for i in refs]);uvref=sum((ru[i]*x for i,x in zip(refs,b)),Vector((0,0)));uvmean=sum((u[i]for i in ids),Vector((0,0)))/3;nd=sum((n[i]for i in ids),Vector()).normalized();nr=sum((rn[i]*x for i,x in zip(refs,b)),Vector()).normalized();uvdiff=(uvmean-uvref).length;anglediff=math.degrees(math.acos(max(-1,min(1,nd.dot(nr)))));errors.append(dist);uv.append(uvdiff);normal.append(anglediff)
  if .835<p.z<.98 and abs(p.x)<.17 and p.y>0:waist.append({'distanceM':dist,'uvDelta':uvdiff,'normalAngleDeg':anglediff})
 def stats(a):
  a=sorted(a);return {'count':len(a),'max':max(a,default=0),'p95':a[min(len(a)-1,int(len(a)*.95))]if a else 0,'mean':sum(a)/len(a)if a else 0}
 reports.append({'asset':tag,'triangles':len(t),'surfaceCentroidDistanceM':stats(errors),'uvDeltaAtNearestSourceSurface':stats(uv),'normalAngleDegAtNearestSourceSurface':stats(normal),'posteriorWaist':{key:stats([a[key]for a in waist])for key in ['distanceM','uvDelta','normalAngleDeg']},'degenerateTriangles':degenerate,'note':'Closest-surface correspondence can choose adjacent overlapping cloth triangles; UV maximum is diagnostic, not texture-pixel proof.'})
 print('AUDITED',tag,reports[-1]['posteriorWaist'],flush=True)
(ROOT/'qa/lod-surface-audit.json').write_text(json.dumps({'method':'Blender BVHTree nearest reference triangle, centroid barycentric UV and normal interpolation','baselineSha256':hashlib.sha256(ref.read_bytes()).hexdigest(),'baselineTriangles':len(rt),'baselineDegenerateTrianglesAt1e12M2':sum((rv[t[1]]-rv[t[0]]).cross(rv[t[2]]-rv[t[0]]).length/2<1e-12 for t in rt),'assets':reports},indent=2)+'\n')
# Verify all delivered GLBs can independently load with maps, skin and actions.
reimports=[]
for p in sorted((ROOT/'exports').glob('*.glb')):
 sc,rig,meshes=load(p);coords=[ob.matrix_world@v.co for ob in meshes for v in ob.data.vertices];mins=[min(c[i]for c in coords)for i in range(3)];maxs=[max(c[i]for c in coords)for i in range(3)];images=[{'name':im.name,'size':list(im.size),'colorSpace':im.colorspace_settings.name}for im in bpy.data.images];assert len(images)==3 and all(im['size']==[1024,1024]for im in images);assert len(rig.data.bones)==22;assert all(o.type not in ['CAMERA','LIGHT']for o in sc.objects)
 # Convert min/max once into glTF axis ordering; -Y forward reverses bounds.
 reimports.append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'blenderBoundsM':{'min':mins,'max':maxs},'gltfBoundsM':{'min':[mins[0],mins[2],-maxs[1]],'max':[maxs[0],maxs[2],-mins[1]]},'bones':22,'images':images,'actions':[(a.name,round((a.frame_range[1]-a.frame_range[0])/30,6))for a in bpy.data.actions],'status':'pass'})
(ROOT/'qa/blender-reimport.json').write_text(json.dumps({'blender':bpy.app.version_string,'status':'pass','assets':reimports},indent=2)+'\n')

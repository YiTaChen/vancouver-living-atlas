import bpy,json
from pathlib import Path
from collections import defaultdict
R=Path(__file__).resolve().parent; REPO=R.parents[2]
bpy.ops.wm.open_mainfile(filepath=str(REPO/'tools/assets/citizen/optimization/source/citizen-lod0.blend'))
ob=next(o for o in bpy.context.scene.objects if o.type=='MESH');rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
m=ob.data
parent=list(range(len(m.vertices)))
def root(a):
 while parent[a]!=a: parent[a]=parent[parent[a]];a=parent[a]
 return a
def union(a,b):
 a,b=root(a),root(b)
 if a!=b:parent[b]=a
pos={}
for v in m.vertices:
 p=tuple(round(x,6) for x in v.co)
 if p in pos:union(v.index,pos[p])
 else:pos[p]=v.index
for e in m.edges:union(*e.vertices)
cs=defaultdict(list)
for v in m.vertices:cs[root(v.index)].append(v)
out=[]
for vs in sorted(cs.values(),key=len,reverse=True):
 co=[ob.matrix_world@v.co for v in vs];out.append({'count':len(vs),'index':vs[0].index,'bounds':[list(map(min,zip(*co))),list(map(max,zip(*co)))]})
d={'blender':bpy.app.version_string,'objects':[(o.name,o.type) for o in bpy.context.scene.objects],'meshMatrix':[list(x) for x in ob.matrix_world],'customNormals':m.has_custom_normals,'meshAttributes':list(m.attributes.keys()),'uv':list(m.uv_layers.keys()),'components':out,'bones':[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local)} for b in rig.data.bones],'actions':[(a.name,list(a.frame_range),len(a.fcurves)) for a in bpy.data.actions],'fps':bpy.context.scene.render.fps}
(R/'qa/source-inspection.json').write_text(json.dumps(d,indent=2));print(json.dumps(d,indent=2))

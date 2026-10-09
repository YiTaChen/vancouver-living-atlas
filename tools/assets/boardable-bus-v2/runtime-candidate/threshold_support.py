"""Explicit candidate-only flush support extensions at the two inherited portals.
Defines narrow support geometry; never changes the detailed master or door frames.
Importing this module is read-only. apply_to_loaded_candidate must be called by
an authorized derivation/update on the separate candidate source.
"""
PORTALS=[('front',3.70,4.85),('rear',-1.20,-.05)]
X0,X1=-1.25,-1.15
TOP,BOTTOM=.36,.26

def surfaces():
 return [{'surfaceId':group+'-door-threshold-extension','frameId':'vehicle','verticesM':[[X0,TOP,z0],[X1,TOP,z0],[X1,TOP,z1],[X0,TOP,z1]],'indices':[0,2,1,0,3,2],'visibleComponentId':'door-'+group+'-threshold-slab','obstaclesMustBeSubtracted':True,'scope':'Candidate-only flush extension across the detailed master\'s 0.10 m portal support gap.'} for group,z0,z1 in PORTALS]

def apply_to_loaded_candidate():
 import bpy
 names=[]
 for group,z0,z1 in PORTALS:
  name='door-'+group+'-threshold-slab';assert name not in bpy.data.objects,'Refuse duplicate portal support extension'
  pts=[(X0,BOTTOM,z0),(X1,BOTTOM,z0),(X1,BOTTOM,z1),(X0,BOTTOM,z1),(X0,TOP,z0),(X1,TOP,z0),(X1,TOP,z1),(X0,TOP,z1)]
  verts=[(x,-z,y) for x,y,z in pts];faces=[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(bpy.data.materials['floor']);obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);obj.parent=bpy.data.objects['vehicle'];obj['semantic_role']='floor';obj['support_surface']='candidate-only flush portal extension';names.append(name)
 bpy.context.view_layer.update();return names

if __name__=='__main__':
 import json
 from pathlib import Path
 import bpy
 here=Path(__file__).resolve().parent
 for level in [0,1]:
  p=here/'source'/f'city-bus-12m-interior-v2-runtime.lod{level}.blend';bpy.ops.wm.open_mainfile(filepath=str(p));names=apply_to_loaded_candidate();bpy.context.scene['portal_support_revision']='two flush strips at unchanged portals; detailed master untouched';bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
  report_path=here/'qa'/f'derivation-lod{level}.json';r=json.loads(report_path.read_text());r['addedPortalSupportComponents']=names;r['retainedMeshObjects']+=2;r['trianglesEvaluated']+=24;r['reductions'] += [{'component':n,'preReductionTriangles':12,'evaluatedTriangles':12,'newCandidateOnlySupport':True} for n in names];report_path.write_text(json.dumps(r,indent=2)+'\n')

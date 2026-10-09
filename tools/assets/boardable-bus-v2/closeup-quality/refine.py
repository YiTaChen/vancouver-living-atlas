"""Image-based seat/ceiling reconstruction and round tubing in independent editable sources.
Preserves the approved vehicle frame, corrected front arrangement and every anchor.
Original master and budget fallback are read-only inputs. Never used by re-export.
"""
import argparse, hashlib, importlib.util, json, math, re, sys
from pathlib import Path
import bpy, bmesh
from mathutils import Vector
HERE=Path(__file__).resolve().parent;MASTER=HERE.parent
sys.path.insert(0,str(MASTER));import build as A
B=A.B
EXPECTED='f9fb01939c1e65c0c308c8bc2cdca72f26d9d6b728e489df6743bfb6849dc673'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def replace_mesh(ob,vs,fs,smooth=True):
 old=ob.data;me=bpy.data.meshes.new(ob.name+' reference-shaped surface');me.from_pydata(vs,[],fs);me.update();bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free()
 for m in old.materials:me.materials.append(m)
 ob.data=me;ob.modifiers.clear()
 uv=me.uv_layers.new(name='UVMap')
 for poly in me.polygons:
  axis=max(range(3),key=lambda i:abs(poly.normal[i]));ij=[i for i in range(3) if i!=axis]
  for k in poly.loop_indices:
   v=me.vertices[me.loops[k].vertex_index].co;uv.data[k].uv=(v[ij[0]],v[ij[1]])
 for p in me.polygons:p.use_smooth=smooth
 return ob

def sweep(ob,points,radius,sides):
 pts=[Vector(p) for p in points];vs=[];fs=[];previous=None;u=None
 for i,p in enumerate(pts):
  t=((pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)])).normalized()
  if previous is None:
   axis=Vector((0,0,1)) if abs(t.z)<.9 else Vector((1,0,0));u=t.cross(axis).normalized()
  else:u=previous.rotation_difference(t)@u;u=(u-t*u.dot(t)).normalized()
  v=t.cross(u)
  vs.extend([tuple(p+radius*(u*math.cos(k*math.tau/sides)+v*math.sin(k*math.tau/sides))) for k in range(sides)]);previous=t
 for j in range(len(pts)-1):
  for k in range(sides):a=j*sides+k;b=j*sides+(k+1)%sides;fs.append((a,b,b+sides,a+sides))
 fs.extend([tuple(range(sides-1,-1,-1)),tuple((len(pts)-1)*sides+k for k in range(sides))]);replace_mesh(ob,vs,fs)
 ob.data.polygons[-1].use_smooth=False;ob.data.polygons[-2].use_smooth=False
 ob['radial_segments']=sides;ob['continuous_round_tube']=True;ob['surface_revision']='closeup-quality-v1'
 return ob

def fillet(points,steps=8,cut=.065):
 pts=[Vector(p) for p in points];result=[pts[0]]
 for i in range(1,len(pts)-1):
  incoming=pts[i]-pts[i-1];outgoing=pts[i+1]-pts[i];d=min(cut,incoming.length*.3,outgoing.length*.3);a=pts[i]-incoming.normalized()*d;b=pts[i]+outgoing.normalized()*d
  for j in range(steps+1):
   t=j/steps;result.append((1-t)**2*a+2*(1-t)*t*pts[i]+t*t*b)
 result.append(pts[-1]);return result

def cylinder_axis(ob):
 polys=ob.data.polygons;caps=[p for p in polys if len(p.vertices)>4]
 if len(caps)!=2:return None
 cs=[sum((ob.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices) for p in caps]
 if (cs[0]-cs[1]).length<1e-6:return None
 radii=[(ob.data.vertices[i].co-cs[j]).length for j in range(2) for i in caps[j].vertices]
 radius=sum(radii)/len(radii)
 if max(radii)-min(radii)>1e-5:return None
 return cs,radius

def rounded_outline(width,height,radius,steps):
 out=[]
 for cx,cy,start in [(width/2-radius,height/2-radius,0),(-width/2+radius,height/2-radius,90),(-width/2+radius,-height/2+radius,180),(width/2-radius,-height/2+radius,270)]:
  for j in range(steps):
   a=math.radians(start+(j/(steps-1))*90);out.append((cx+radius*math.cos(a),cy+radius*math.sin(a)))
 return out

def upholstered(ob,kind,lod):
 # Physical lofts, not bevel-only boxes. High/medium use the same curves and dimensions.
 step=9 if lod==0 else 5;radial=[1,.94,.78,.52,.23] if lod==0 else [1,.78,.30];vs=[];fs=[]
 if kind=='cushion':w,h,r=.42,.445,.059;outline=rounded_outline(w,h,r,step)
 elif kind=='pad':w,h,r=.365,.478,.052;outline=rounded_outline(w,h,r,step)
 else:w,h,r=.418,.604,.045;outline=rounded_outline(w,h,r,step)
 n=len(outline)
 for layer in ['back','front']:
  for scale in radial:
   for x,y in outline:
    x*=scale;y*=scale
    if kind=='cushion':
     z=.010+y
     if layer=='back':height=.380+.010*(1-scale)
     else:
      # Waterfall front edge, softly dished sitting surface, max 0.450 m preserved.
      height=.417+.033*math.sin(min(1,(1-scale)/.22)*math.pi/2)-.009*(1-scale)**2
      height-=.011*max(0,(z-.11)/.13)*(1-scale)
     p=(x,height,z)
    else:
     yy=(.748 if kind=='pad' else .731)+y
     # Recline plus lumbar convexity, with shallow transverse hollow.
     spine=-.239-.13*(yy-.75)+.012*math.exp(-((yy-.65)/.15)**2)
     if kind=='pad':depth=(.009 if layer=='back' else .029+.013*(1-scale)-.011*(1-(x/(w/2))**2)*(1-scale))
     else:depth=(-.028 if layer=='back' else -.012)
     p=(x,yy,spine+depth)
    vs.append(B.cv(p))
  # Centre closes the concentric loft without giant non-planar n-gons.
  if kind=='cushion':vs.append(B.cv((0,.390 if layer=='back' else .441,.010)))
  else:
   yy=.748 if kind=='pad' else .731;spine=-.239-.13*(yy-.75)+.012*math.exp(-((yy-.65)/.15)**2)
   vs.append(B.cv((0,yy,spine+(.009 if layer=='back' else .031) if kind=='pad' else spine+(-.028 if layer=='back' else -.012))))
  start=(0 if layer=='back' else len(radial)*n+1)
  for ring in range(len(radial)-1):
   for k in range(n):a=start+ring*n+k;b=start+ring*n+(k+1)%n;fs.append((a,b,b+n,a+n))
  center=start+len(radial)*n
  for k in range(n):fs.append((start+(len(radial)-1)*n+k,start+(len(radial)-1)*n+(k+1)%n,center))
 offset=len(radial)*n+1
 for k in range(n):fs.append((k,(k+1)%n,offset+(k+1)%n,offset+k))
 replace_mesh(ob,vs,fs);ob['reference_seat_shape']=kind;ob['surface_revision']='closeup-quality-v1'
 if kind=='cushion':
  # Match the established exact maximal cushion dimensions while retaining contour.
  for axis,lo,hi in [(0,-.21,.21),(1,-.2325,.2125),(2,.38,.45)]:
   a=min(v.co[axis] for v in ob.data.vertices);b=max(v.co[axis] for v in ob.data.vertices)
   for v in ob.data.vertices:v.co[axis]=lo+(v.co[axis]-a)*(hi-lo)/(b-a)
 return ob

def tube_new(name,points,radius,role,parent,sides,cut=.04):
 ob=B.mesh(name,[(0,0,0),(1,0,0),(0,1,0)],[(0,1,2)],role,parent);return sweep(ob,[B.cv(p) for p in fillet(points,8 if sides>=24 else 3,cut)],radius,sides)

def seats(lod,sides):
 removed=[]
 for ob in list(bpy.context.scene.objects):
  if ob.type=='MESH' and ob.name.startswith('seat-') and any(t in ob.name for t in ['-upholstery-button','-grab-','-leg-','-foot']):removed.append(ob.name);bpy.data.objects.remove(ob,do_unlink=True)
 for i in range(1,25):
  n=f'seat-{i:02d}';node=bpy.data.objects[n]
  upholstered(bpy.data.objects[n+'-back-pad'],'pad',lod);upholstered(bpy.data.objects[n+'-back-shell'],'shell',lod);upholstered(bpy.data.objects[n+'-cushion'],'cushion',lod)
  pan=bpy.data.objects[n+'-pan'];pan.modifiers.clear();m=pan.modifiers.new('Rounded pale cushion cradle','BEVEL');m.width=.012;m.segments=5 if lod==0 else 3
  for p in pan.data.polygons:p.use_smooth=True
  norm=pan.modifiers.new('Cradle face normals','WEIGHTED_NORMAL');norm.keep_sharp=True
  # The silver continuous U-shaped upper handle and side supports follow the PNG.
  tube_new(n+'-grab-frame',[(-.188,.40,-.207),(-.205,.69,-.27),(-.188,1.02,-.29),(-.172,1.105,-.288),(.172,1.105,-.288),(.188,1.02,-.29),(.205,.69,-.27),(.188,.40,-.207)],.013,'metal',node,sides,.045)
  for x,label in [(-.139,'left'),(.139,'right')]:tube_new(n+'-leg-'+label,[(x,.026,.08),(x,.326,.08),(x,.36,-.12)],.018,'metal',node,sides,.045)
  tube_new(n+'-foot',[(-.18,.023,.08),(.18,.023,.08)],.019,'metal',node,sides)
 return removed

def ceiling(lod):
 # Keep the established underside plane/headroom; detailing is concentrated outboard.
 for ob in bpy.context.scene.objects:
  if ob.type!='MESH':continue
  if ob.name.startswith('roof-hatch') and not ob.name.startswith('roof-hatch-insert'):
   ob.data.materials.clear();ob.data.materials.append(B.M['seat-shell'])
  if ob.name.startswith('roof-hatch-insert'):
   vs=ob.data.vertices;cx=sum(v.co.x for v in vs)/len(vs);cy=sum(v.co.y for v in vs)/len(vs)
   for v in vs:v.co.x=cx+(v.co.x-cx)*(.632/.57);v.co.y=cy+(v.co.y-cy)*(.692/.63)
 for ob in bpy.context.scene.objects:
  if ob.type=='MESH' and ob.name.startswith(('roof-shoulder','roof-hatch','ceiling-fixture')):
   for mod in ob.modifiers:
    if mod.type=='BEVEL':mod.segments=5 if lod==0 else 3
   for p in ob.data.polygons:p.use_smooth=True
   m=ob.modifiers.new('Broad panel weighted normals','WEIGHTED_NORMAL');m.keep_sharp=True
 for j,z in enumerate([-4.94,-3.05,-1.15,.75,2.65,4.55]):
  A.box(f'ceiling-cross-seam-{j}',(0,2.597,z),(1.29,.005,.012),'rubber')
 for side in [-1,1]:
  # Continuous recessed cove groove, narrow reflector and separate lens edge.
  A.box(f'ceiling-cove-shadow-{side}',(side*.833,2.563,.1),(.030,.018,10.70),'rubber',.004)
  A.box(f'ceiling-light-trim-{side}',(side*.695,2.567,.1),(.022,.022,10.70),'metal',.005)
  for j,z in enumerate([-4.35,-2.60,-.85,.90,2.65,4.40]):
   A.box(f'ceiling-vent-recess-{side}-{j}',(side*.895,2.405,z),(.1681,.015,.2964),'seat-shell',.009)
   for k in range(6):A.box(f'ceiling-vent-louver-{side}-{j}-{k}',(side*.895,2.397,z-.117+k*.0468),(.15416,.014,.01326),'panel',.005 if lod==0 else .003)
   for zz in [z-.17004,z+.17004]:A.box(f'ceiling-vent-cap-{side}-{j}',(side*.895,2.406,zz),(.1927,.018,.02184),'panel',.006)
 for j,z in enumerate([-3.9,0,3.5]):
  for x in [-.20,.20]:A.box(f'roof-hatch-latch-{j}',(x,2.558,z),(.085,.020,.028),'metal',.005)
  A.box(f'roof-hatch-handle-{j}',(0,2.547,z+.18),(.16,.018,.030),'rubber',.006)

def fittings(lod,sides):
 # The reference uses silver tubes, local yellow grips/cords, pale collars and black loops.
 col=(.96,.60,.025,1);m=bpy.data.materials.new('yellow-grip');m.use_nodes=True;m.diffuse_color=col;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=col;m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.48;m['semantic_role']='rail';m['shared_surface_id']='bus-v2-yellow-grip';B.M['yellow-grip']=m
 m=B.M['rail'];m.diffuse_color=(.46,.52,.55,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.46,.52,.55,1);m.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.78;m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.23
 for ob in list(bpy.context.scene.objects):
  if ob.name.startswith('stop-cord-'):ob.data.materials.clear();ob.data.materials.append(B.M['yellow-grip'])
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH' or not ob.name.startswith(('stanchion-','front-priority-bay-end','front-priority-pair-rail','front-entry-stanchion','rear-entry-stanchion')):continue
  # Find lowest straight axis from source geometry, then sleeve only its grasping segment.
  pts=[v.co for v in ob.data.vertices];z0=min(v.z for v in pts);low=[v for v in pts if v.z<z0+.01]
  if not low:continue
  c=sum(low,Vector())/len(low);x,z=c.x,-c.y
  if not (.30<abs(x)<1.11):continue
  tube_new(ob.name+'-yellow-grip',[(x,1.17,z),(x,1.51,z)],.026,'yellow-grip',B.ROOT,sides)
  tube_new(ob.name+'-floor-socket',[(x,z0+.003,z),(x,z0+.040,z)],.046,'metal',B.ROOT,sides)
  near=sorted(pts,key=lambda v:abs(v.z-2.24))[:sides]
  cc=sum(near,Vector())/len(near)
  tube_new(ob.name+'-upper-collar',[(cc.x,2.225,-cc.y),(cc.x,2.267,-cc.y)],.030,'fixture',B.ROOT,sides)
 for side in [-1,1]:
  for j,z in enumerate([-4.55,-2.45,.35,2.95]):
   tube_new(f'overhead-mount-{side}-{j}',[(side*.43,2.40,z),(side*.43,2.55,z)],.014,'metal',B.ROOT,sides)
   A.box(f'overhead-mount-plate-{side}-{j}',(side*.43,2.582,z),(.085,.018,.09),'fixture',.01)
 # Black hanging loops with continuous rounded corners; remove the old triangular segments.
 for ob in list(bpy.context.scene.objects):
  if ob.name.startswith('strap-loop'):bpy.data.objects.remove(ob,do_unlink=True)
 for side in [-1,1]:
  for j,z in enumerate([-4.5,-3.65,-2.8,-.90,.10,1.15,2.4]):
   if side<0 and z==-.90:continue
   tube_new(f'strap-loop-refined-{side}-{j}',[(side*.43,2.12,z),(side*.43,1.995,z-.073),(side*.43,1.982,z+.073),(side*.43,2.12,z)],.009,'rubber',B.ROOT,24 if lod==0 else 16,.045)

def windows(lod):
 # Explicit user hierarchy: BLACK INNER frame, BLUE OUTER structural frame.
 # Exterior blue pillars remain untouched; these inner seals/reveals sit toward the cabin.
 m=bpy.data.materials.new('window-outer-blue');m.use_nodes=True;m.diffuse_color=(.055,.21,.37,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.055,.21,.37,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.38;m.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.18;m['semantic_role']='panel';m['shared_surface_id']='bus-window-outer-blue';B.M['window-outer-blue']=m
 stations=[-5.68,-4.45,-3.25,-2.05,-1.25,0,1.25,2.5,3.65,4.90,5.70]
 for side in [-1,1]:
  st=stations if side>0 else [v for v in stations if not any(a<v<b for _,a,b in A.DOORS)]
  for j,z in enumerate(st):
   outer_z=z+(-.025 if side<0 and z in [-1.25,3.65] else .025 if side<0 and z in [0,4.90] else 0)
   A.box(f'window-outer-blue-pillar-{side}-{j}',(side*1.213,1.845,outer_z),(.032,1.444,.150),'window-outer-blue',.006)
   A.box(f'window-inner-black-pillar-{side}-{j}',(side*1.179,1.845,z),(.032,1.36,.088),'rubber',.005)
   A.box(f'window-inner-reveal-{side}-{j}',(side*1.199,1.845,z),(.038,1.37,.096),'metal',.004)
  intervals=[]
  for a,b in zip(st,st[1:]):
   segs=[(a,b)]
   if side<0:
    for _,d0,d1 in A.DOORS:segs=[v for lo,hi in segs for v in ([(lo,min(hi,d0))] if lo<d0 else [])+([(max(lo,d1),hi)] if hi>d1 else []) if v[1]-v[0]>.10]
   intervals+=segs
  for j,(a,b) in enumerate(intervals):
   for y,label in [(1.132,'lower'),(2.555,'upper')]:A.box(f'window-outer-blue-{label}-{side}-{j}',(side*1.211,y,(a+b)/2),(.038,.050,b-a),'window-outer-blue',.005)
   for y,label in [(1.177,'lower'),(2.501,'upper')]:
    A.box(f'window-inner-black-{label}-{side}-{j}',(side*1.178,y,(a+b)/2),(.033,.060,b-a-.030),'rubber',.005)
    A.box(f'window-reveal-depth-{label}-{side}-{j}',(side*1.20,y,(a+b)/2),(.042,.077,b-a-.026),'metal',.006)
   A.box(f'window-sill-cap-{side}-{j}',(side*1.137,1.158,(a+b)/2),(.094,.024,b-a-.02),'panel',.008)
 for side in [-1,1]:
  intervals=[(-5.65,5.72)] if side>0 else [(-5.65,-1.20),(-.05,3.70),(4.85,5.72)]
  for j,(a,b) in enumerate(intervals):
   A.box(f'lower-wall-gray-infill-{side}-{j}',(side*1.162,.592,(a+b)/2),(.022,.465,b-a),'panel',.005)
   A.box(f'lower-wall-skirt-{side}-{j}',(side*1.143,.395,(a+b)/2),(.030,.070,b-a),'rubber',.003)
 # Recessed liner joints make the lower side panels read as assembled trim.
 for side in [-1,1]:
  for j,z in enumerate([-4.4,-2.05,1.25,2.5,4.95]):
   if side<0 and any(a<z<b for _,a,b in A.DOORS):continue
   A.box(f'liner-panel-joint-{side}-{j}',(side*1.149,.975,z),(.007,.285,.010),'rubber')

def floor_finish(out):
 # Small tile is actual exported material data, not a preview-only effect.
 import random
 rng=random.Random(9040);size=256;im=bpy.data.images.new('Deterministic gray transit floor speckle',width=size,height=size,alpha=True);pixels=[]
 base=(.17,.19,.21)
 for i in range(size*size):
  v=rng.random();mult=(.62 if v<.055 else 1.40 if v>.947 else .94+rng.random()*.12)
  pixels.extend([(12.92*c*mult if c*mult<=.0031308 else 1.055*(c*mult)**(1/2.4)-.055) for c in base]+[1])
 im.pixels[:]=pixels;im.file_format='PNG';p=out/'source/floor-speckle.png';im.filepath_raw=str(p);im.save();im.pack()
 m=B.M['floor'];nodes=m.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.name='Packed physical speckle tile';tex.image=im;tex.extension='REPEAT';coord=nodes.new('ShaderNodeTexCoord');scale=nodes.new('ShaderNodeVectorMath');scale.operation='SCALE';scale.inputs[3].default_value=6.0;m.node_tree.links.new(coord.outputs['UV'],scale.inputs[0]);m.node_tree.links.new(scale.outputs[0],tex.inputs['Vector']);m.node_tree.links.new(tex.outputs['Color'],nodes['Principled BSDF'].inputs['Base Color'])
 # UV tiling is baked into editable mesh UVs because arbitrary Mapping nodes are not portable glTF.
 for ob in bpy.context.scene.objects:
  if ob.type=='MESH' and any(mat==m for mat in ob.data.materials) and ob.data.uv_layers.active:
   for uv in ob.data.uv_layers.active.data:uv.uv*=6
 m.node_tree.links.remove(tex.inputs['Vector'].links[0]);m.node_tree.links.new(coord.outputs['UV'],tex.inputs['Vector'])

def make(lod,out):
 src=MASTER/'source/city-bus-12m-interior-v2.lod0.blend';assert sha(src)==EXPECTED,'Review changed source before applying reconstruction.'
 bpy.ops.wm.open_mainfile(filepath=str(src));B.ROOT=bpy.data.objects['vehicle'];B.M.clear()
 for name in ['floor','panel','seat','seat-shell','rail','metal','rubber','glass','marking','fixture','button']:B.M[name]=bpy.data.materials[name]
 # PNG shell is pale neutral; the explicitly requested navy upholstery remains exact.
 m=B.M['seat-shell'];m.diffuse_color=(.44,.49,.51,1);m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.44,.49,.51,1);m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.43
 m=B.M['metal'];m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.26
 sides=32 if lod==0 else 16;rounded=[]
 # Every existing straight cylinder gets true circular radial resampling and smooth walls.
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH':continue
  axis=cylinder_axis(ob)
  if axis:
   cs,r=axis;sweep(ob,cs,r,sides if r>=.012 else (24 if lod==0 else 16));rounded.append(ob.name)
 # Replace segmented bent rails with connected filleted sweeps; no caps at elbow joins.
 groups={}
 for ob in list(bpy.context.scene.objects):
  if ob.type!='MESH':continue
  match=re.match(r'^(stanchion--?\d+-\d+|front-priority-bay-end--?\d+|front-priority-pair-rail--?\d+|front-wheel-guard|front-entry-assist-bend)-(\d+)$',ob.name)
  if match:groups.setdefault(match[1],[]).append((int(match[2]),ob))
 joined=[]
 for prefix,obs in groups.items():
  obs.sort();centers=[];r=None
  for _,ob in obs:
   cs,r=cylinder_axis(ob)
   if centers:
    if (cs[1]-centers[-1]).length<(cs[0]-centers[-1]).length:cs.reverse()
    centers.append(cs[1])
   else:
    # Source cap order is start/end after first sweep.
    centers.extend(cs)
  first=obs[0][1];sweep(first,fillet(centers,10 if lod==0 else 4),r,sides);first['joined_source_components']=[o.name for _,o in obs]
  for _,o in obs[1:]:bpy.data.objects.remove(o,do_unlink=True)
  joined.append(prefix)
 removed=seats(lod,sides);ceiling(lod);fittings(lod,sides);windows(lod);floor_finish(out)
 if lod==1:
  for ob in bpy.context.scene.objects:
   if ob.type=='MESH' and ob.name.startswith(('window-','ceiling-','liner-','lower-wall-','ad-')):
    for mod in ob.modifiers:
     if mod.type=='BEVEL':mod.segments=1
 # Same already-reviewed threshold repair as the budget fallback.
 sp=importlib.util.spec_from_file_location('support',MASTER/'runtime-candidate/threshold_support.py');T=importlib.util.module_from_spec(sp);sp.loader.exec_module(T);thresholds=T.apply_to_loaded_candidate()
 s=bpy.context.scene;s['surface_revision']='image-reconstructed-closeup-quality-v1';s['lod']=lod;s['historical_image_use']='Visible seat/ceiling design reconstructed; no old 3D asset recovered';s['quality_profile']='preferred close-up master' if lod==0 else 'medium-distance quality derivative; not old budget cap';s['source_master_sha256']=EXPECTED
 p=out/'source'/f'city-bus-12m-interior-v2-closeup.lod{lod}.blend';bpy.ops.wm.save_as_mainfile(filepath=str(p),compress=True)
 report={'lod':lod,'sourceInput':'../source/'+src.name,'sourceInputSha256':EXPECTED,'sourceOutput':'source/'+p.name,'sourceOutputSha256':sha(p),'originalSourceUnchanged':sha(src)==EXPECTED,'radialSegments':sides,'roundResampledComponents':rounded,'continuousFilletGroups':joined,'replacedSeatHardware':removed,'addedThresholdSupport':thresholds,'seatShape':'Reference PNG contoured navy pads, pale wraparound shells, continuous silver handles and support frames','ceilingDetail':'cross seams, cove/reflector edges, vent recesses/louvers and hatch latches','limits':'Image-based reconstruction; no exact depth/dimension recovery from a single view; rear layout retained but surface topology intentionally rebuilt.'}
 (out/'qa'/f'derivation-lod{lod}.json').write_text(json.dumps(report,indent=2)+'\n');print('REFINED',p,flush=True)
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=HERE);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 for d in ['source','exports','qa']:(a.output/d).mkdir(parents=True,exist_ok=True)
 if list((a.output/'source').glob('*.blend')):raise RuntimeError('Use a new output directory; never overwrite edited sources with reconstruction.')
 for lod in [0,1]:make(lod,a.output)

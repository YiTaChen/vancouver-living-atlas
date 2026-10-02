"""Original bounded PBR role library, Blender 4.3+. No runtime modifications."""
import bpy, math, json, argparse, sys, hashlib
from pathlib import Path
import numpy as np
from mathutils import Vector
P=Path(__file__).resolve().parent
ROLES=[
 ('landmark-brushed-aluminum',1.0,[.64,.68,.70],.36,1,'brushed'),
 ('landmark-pale-panel',1.0,[.69,.70,.68],.58,0,'mineral'),
 ('vehicle-red-paint',.5,[.55,.012,.025],.24,.32,'paint'),
 ('vehicle-tire-rubber',.5,[.022,.026,.029],.86,0,'rubber'),
 ('vehicle-seat-leather',.5,[.38,.17,.072],.74,0,'leather'),
 ('interior-terrazzo',1.0,[.53,.52,.46],.56,0,'terrazzo'),
 ('interior-oak-veneer',1.0,[.37,.22,.105],.58,0,'wood'),
 ('interior-matte-plaster',1.0,[.72,.69,.62],.9,0,'plaster')]
def image(name,arr,folder,noncolor=False):
 h,w=arr.shape[:2]; im=bpy.data.images.new(name,width=w,height=h,alpha=True)
 if noncolor: im.colorspace_settings.name='Non-Color'
 im.pixels.foreach_set(np.concatenate([arr,np.ones((h,w,1))],axis=2).astype('float32').ravel()); im.filepath_raw=str(folder/(name+'.png')); im.file_format='PNG';im.save();im.pack();return im

def originals(role):
 name,metres,col,r,m,kind=role; n=256;y,x=np.mgrid[:n,:n]/n;t=2*math.pi
 noise=(np.sin(t*(19*x+13*y))+.6*np.cos(t*(37*x-29*y))+.35*np.sin(t*(67*x+71*y)))/1.95
 h=noise*.05; shade=noise*.022
 if kind=='brushed': h=.11*np.sin(t*100*y)+noise*.01;shade=.028*np.sin(t*100*y)
 elif kind=='paint': h=noise*.008;shade=noise*.008
 elif kind=='rubber':
  groove=np.exp(-((np.sin(t*(8*x+2*np.sin(t*y))))/.20)**2); h=-.3*groove+noise*.03;shade=-groove*.006
 elif kind=='leather': h=.10*np.sin(t*31*x)*np.sin(t*29*y)+noise*.07;shade=h*.07
 elif kind=='terrazzo':
  rng=np.random.default_rng(8402);h=noise*.015
  for i in range(160):
   cx,cy=rng.random(2);dx=np.minimum(abs(x-cx),1-abs(x-cx));dy=np.minimum(abs(y-cy),1-abs(y-cy));mask=(dx*dx+dy*dy)<rng.uniform(.003,.014)**2;shade=np.where(mask,rng.uniform(-.19,.19),shade)
 elif kind=='wood': h=.12*np.sin(t*(27*x+.2*np.sin(t*3*y)))+.035*np.sin(t*61*x);shade=h*.46
 elif kind=='plaster': h=noise*.13;shade=noise*.013
 base=np.clip(np.array(col)[None,None,:]+shade[:,:,None],.003,1)
 # Analytic periodic height field; +Y tangent-space normal, small physical relief.
 dx=(np.roll(h,-1,1)-np.roll(h,1,1))*n/(2*metres)*.0007
 dy=(np.roll(h,-1,0)-np.roll(h,1,0))*n/(2*metres)*.0007
 norm=np.stack([-dx,-dy,np.ones_like(dx)],axis=2);norm/=np.linalg.norm(norm,axis=2)[:,:,None];norm=norm*.5+.5
 orm=np.stack([np.ones_like(x),np.clip(r+noise*.025,.05,1),np.ones_like(x)*m],axis=2)
 return base,orm,norm

def source_material(role):
 name,metres,*_=role;mat=bpy.data.materials.new(name);mat.use_nodes=True;mat['tile_metres']=metres
 nodes=mat.node_tree.nodes;nodes.clear();ln=mat.node_tree.links
 out=nodes.new('ShaderNodeOutputMaterial');out.location=(700,0)
 bs=nodes.new('ShaderNodeBsdfPrincipled');bs.name='ROLE_PBR';bs.location=(410,0);ln.new(bs.outputs['BSDF'],out.inputs['Surface'])
 for i,(channel,arr) in enumerate(zip(['basecolor','orm','normal'],originals(role))):
  im=image(name+'-'+channel,arr,P/'source/textures',channel!='basecolor');tex=nodes.new('ShaderNodeTexImage');tex.image=im;tex.name='SOURCE_'+channel;tex.location=(-700,200-i*280)
  if channel=='basecolor':
   tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=(1,1,1,1);tint.name='EDIT_BASE_TINT';tint.location=(-350,220);ln.new(tex.outputs['Color'],tint.inputs[1]);ln.new(tint.outputs[0],bs.inputs['Base Color'])
  elif channel=='orm':
   sep=nodes.new('ShaderNodeSeparateColor');sep.location=(-450,-70);ln.new(tex.outputs['Color'],sep.inputs[0]);mult=nodes.new('ShaderNodeMath');mult.operation='MULTIPLY';mult.name='EDIT_ROUGHNESS_SCALE';mult.inputs[1].default_value=1;mult.location=(-200,-80);ln.new(sep.outputs['Green'],mult.inputs[0]);ln.new(mult.outputs[0],bs.inputs['Roughness']);ln.new(sep.outputs['Blue'],bs.inputs['Metallic'])
  else:
   nm=nodes.new('ShaderNodeNormalMap');nm.name='EDIT_NORMAL_STRENGTH';nm.location=(-180,-320);ln.new(tex.outputs['Color'],nm.inputs['Color']);ln.new(nm.outputs[0],bs.inputs['Normal'])
 return mat

def cube(name,loc,scale,mat):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 # One world metre in tangent-plane corresponds to 1/tile_metres UV units.
 uv=o.data.uv_layers.active
 for poly in o.data.polygons:
  axis=max(range(3),key=lambda k:abs(poly.normal[k])); axes=[k for k in range(3) if k!=axis]
  for li in poly.loop_indices:
   co=o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=(co[axes[0]]/mat['tile_metres'],co[axes[1]]/mat['tile_metres'])
 o.data.materials.append(mat);return o

def make_source():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for i,role in enumerate(ROLES):
  mat=source_material(role);x=(i%4)*1.5;y=(i//4)*1.8
  o=cube(role[0]+'-coupon',(x,y,.10),(1.2,1.2,.2),mat);o['role_id']=role[0];o['uv_metres']=role[1]
  # Sculptural 3D reflectance sample alongside the metre-scale surface.
  if role[0]=='vehicle-tire-rubber':
   bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=12,major_radius=.23,minor_radius=.09,location=(x,y,.52),rotation=(math.pi/2,0,0));sx,sy=2*math.pi*.23,2*math.pi*.09
  else:
   bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=.31,location=(x,y,.51));sx,sy=2*math.pi*.31,math.pi*.31
  s=bpy.context.object;s.name=role[0]+'-curvature';s.data.materials.append(mat);s['role_id']=role[0]
  for v in s.data.uv_layers.active.data:v.uv.x*=sx/role[1];v.uv.y*=sy/role[1]
  for f in s.data.polygons:f.use_smooth=True
 bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1
 bpy.ops.wm.save_as_mainfile(filepath=str(P/'source/role-material-library.blend'))

def bake(mat,channel,dest):
 bpy.ops.object.select_all(action='DESELECT');bpy.ops.mesh.primitive_plane_add(size=1);o=bpy.context.object;o.name='BAKE_ONLY';o.data.materials.append(mat)
 nodes=mat.node_tree.nodes;ln=mat.node_tree.links;bs=nodes['ROLE_PBR'];out=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
 im=bpy.data.images.new(mat.name+'-'+channel,width=256,height=256,alpha=True)
 if channel!='basecolor':im.colorspace_settings.name='Non-Color'
 target=nodes.new('ShaderNodeTexImage');target.image=im;nodes.active=target
 old=out.inputs['Surface'].links[0].from_socket;temp=[]
 if channel!='normal':
  em=nodes.new('ShaderNodeEmission');temp.append(em)
  if channel=='basecolor':ln.new(bs.inputs['Base Color'].links[0].from_socket,em.inputs['Color'])
  else:
   cmb=nodes.new('ShaderNodeCombineColor');temp.append(cmb);cmb.inputs[0].default_value=1
   ln.new(bs.inputs['Roughness'].links[0].from_socket,cmb.inputs[1]);ln.new(bs.inputs['Metallic'].links[0].from_socket,cmb.inputs[2]);ln.new(cmb.outputs[0],em.inputs['Color'])
  ln.new(em.outputs[0],out.inputs['Surface'])
 bpy.ops.object.bake(type='NORMAL' if channel=='normal' else 'EMIT',margin=0,use_clear=True)
 ln.new(old,out.inputs['Surface'])
 for nd in temp+[target]:nodes.remove(nd)
 im.filepath_raw=str(dest/(mat.name+'-'+channel+'.png'));im.file_format='PNG';im.save();bpy.data.objects.remove(o,do_unlink=True);return im

def validate_material(mat):
 nd=mat.node_tree.nodes;bs=nd.get('ROLE_PBR')
 if bs is None:raise ValueError('Missing ROLE_PBR: '+mat.name)
 out=next(n for n in nd if n.type=='OUTPUT_MATERIAL')
 if not out.inputs['Surface'].is_linked or out.inputs['Surface'].links[0].from_node!=bs or out.inputs['Displacement'].is_linked:raise ValueError('Unsupported surface/displacement: '+mat.name)
 for key,default in [('Transmission Weight',0),('Coat Weight',0),('Emission Strength',0),('Alpha',1),('Anisotropic',0),('Sheen Weight',0),('Subsurface Weight',0),('Diffuse Roughness',0),('Thin Film Thickness',0),('IOR',1.5),('Specular IOR Level',.5)]:
  sk=bs.inputs[key]
  if sk.is_linked or abs(sk.default_value-default)>1e-7:raise ValueError('Unsupported '+key+' in '+mat.name)
 for key in ['Base Color','Roughness','Metallic','Normal']:
  if not bs.inputs[key].is_linked:raise ValueError('Keep role input graph connected: '+key)

def export_material(mat,imgs):
 new=bpy.data.materials.new(mat.name+'-export');new.use_nodes=True;nd=new.node_tree.nodes;ln=new.node_tree.links;bs=nd.get('Principled BSDF')
 for channel,im in imgs.items():
  tex=nd.new('ShaderNodeTexImage');tex.image=im
  if channel=='basecolor':ln.new(tex.outputs['Color'],bs.inputs['Base Color'])
  elif channel=='normal':
   nm=nd.new('ShaderNodeNormalMap');ln.new(tex.outputs['Color'],nm.inputs['Color']);ln.new(nm.outputs[0],bs.inputs['Normal'])
  else:
   sep=nd.new('ShaderNodeSeparateColor');ln.new(tex.outputs['Color'],sep.inputs[0]);ln.new(sep.outputs['Green'],bs.inputs['Roughness']);ln.new(sep.outputs['Blue'],bs.inputs['Metallic'])
 return new

def run_export(root,render):
 root.mkdir(parents=True,exist_ok=True);(root/'textures').mkdir(exist_ok=True)
 sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=1;sc.cycles.use_denoising=False;sc.cycles.device='CPU';sc.render.bake.use_selected_to_active=False
 source_objects=[o for o in sc.objects if o.type=='MESH']; records=[]
 for role in ROLES:
  mat=bpy.data.materials[role[0]];validate_material(mat);imgs={ch:bake(mat,ch,root/'textures') for ch in ['basecolor','orm','normal']};new=export_material(mat,imgs)
  objs=[o for o in source_objects if o.get('role_id')==role[0]]
  for o in objs:o.data.materials.clear();o.data.materials.append(new)
  records.append({'id':role[0],'tile_metres':role[1],'map_resolution':[256,256],'maps':{ch:'textures/'+im.name.split('.')[0]+'.png' for ch,im in imgs.items()}})
 for group in ['landmark','vehicle','interior']:
  bpy.ops.object.select_all(action='DESELECT');objs=[o for o in source_objects if o.get('role_id','').startswith(group)]
  for o in objs:o.select_set(True)
  bpy.context.view_layer.objects.active=objs[0];bpy.ops.export_scene.gltf(filepath=str(root/(group+'-material-study.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=False)
 manifest={'schema':1,'blender':bpy.app.version_string,'status':'offline candidates; integration deferred','roles':records,'color_space':{'basecolor':'sRGB','normal':'Non-Color OpenGL +Y tangent','orm':'Non-Color R=1 G=roughness B=metallic'},'resident_rgba_mips_mib':8*3*256*256*4*4/3/1048576,'provenance':'Original analytic periodic textures and authored sample meshes; no external textures/models','source_objects':len(source_objects)}
 (root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 if render:render_views(root,source_objects)

def render_views(root,objs):
 sc=bpy.context.scene;sc.cycles.samples=96;sc.render.resolution_x=1000;sc.render.resolution_y=650;sc.render.resolution_percentage=100;sc.view_settings.view_transform='AgX'
 bpy.ops.object.camera_add(location=(7,-8,9));cam=bpy.context.object;cam.rotation_euler=(Vector((2.25,.9,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=8.5;sc.camera=cam
 bpy.ops.object.light_add(type='AREA',location=(0,-2,6));key=bpy.context.object;key.data.shape='DISK';key.data.size=5
 bpy.ops.object.light_add(type='AREA',location=(5,4,4));fill=bpy.context.object;fill.data.size=4;fill.rotation_euler=(Vector((2,1,0))-fill.location).to_track_quat('-Z','Y').to_euler()
 for label,power,world,color in [('sunny',1300,.35,(1,.95,.87)),('overcast',750,.65,(.84,.90,1)),('dusk',600,.16,(1,.50,.22)),('night',420,.035,(.48,.67,1))]:
  key.data.energy=power;key.data.color=color;fill.data.energy=power*.6;sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.72,.82,1);sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value=world;sc.render.filepath=str(root/(label+'.png'));bpy.ops.render.render(write_still=True)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--from-source',type=Path);ap.add_argument('--output',type=Path,default=P/'exports');ap.add_argument('--render',action='store_true');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
 if a.from_source:bpy.ops.wm.open_mainfile(filepath=str(a.from_source.resolve()))
 else:make_source()
 run_export(a.output.resolve(),a.render)
if __name__=='__main__':main()

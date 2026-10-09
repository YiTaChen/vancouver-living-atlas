"""Original near-interactive skin reconstruction; Blender only, no external art.
Derived from the project's original low-cost silhouettes with smooth subdivision
and 14-bone skin. No old unpublished binary or acceptance claim is reused.
"""
import bpy,sys,math,json,hashlib,importlib.util
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('background',ROOT.parent/'city-life-pedestrians/build.py'); bg=importlib.util.module_from_spec(s);s.loader.exec_module(bg)
CLIPS=['idle','walk','look','yield','guide','sit']
def coord(p):return Vector((p[0],-p[2],p[1]))
def build(spec):
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.save_version=0
 obj=bg.create(spec,0);obj.name='interactive-body'
 bpy.context.view_layer.objects.active=obj
 sub=obj.modifiers.new('surface-refinement','SUBSURF');sub.subdivision_type='SIMPLE';sub.levels=1;bpy.ops.object.modifier_apply(modifier=sub.name)
 scale=obj['scaleToDesignHeight'];w=spec['width']
 arm=bpy.data.armatures.new('interactive-skeleton');rig=bpy.data.objects.new('interactive-rig',arm);bpy.context.collection.objects.link(rig)
 bpy.context.view_layer.objects.active=rig;obj.select_set(False);rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 defs=[('pelvis',(0,.90,0),(0,1.02,0),None),('spine',(0,1.02,0),(0,1.43,0),'pelvis'),('neck',(0,1.43,0),(0,1.51,0),'spine'),('head',(0,1.51,0),(0,1.76,0),'neck')]
 for side,sign in [('left',1),('right',-1)]:
  x=sign*.103*w;sx=sign*.221*w;ex=sign*.275*w;hx=sign*.31*w
  defs += [(side+'-upper-arm',(sx,1.36,0),(ex,1.105,0),'spine'),(side+'-forearm',(ex,1.105,0),(hx,.78,0),side+'-upper-arm'),(side+'-thigh',(x,.92,0),(x,.50,0),'pelvis'),(side+'-shin',(x,.50,0),(x,.085,0),side+'-thigh'),(side+'-foot',(x,.085,0),(x,.055,.16),side+'-shin')]
 for name,h,t,parent in defs:
  b=arm.edit_bones.new(name);b.head=coord(h)*scale;b.tail=coord(t)*scale
  if parent:b.parent=arm.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT')
 oldgroups={g.index:g.name for g in obj.vertex_groups}
 limbmap={'torso':0,'head':1,'arm-left':2,'arm-right':3,'leg-left':4,'leg-right':5}
 limbs=[limbmap[oldgroups[max(v.groups,key=lambda g:g.weight).group]] for v in obj.data.vertices]
 for g in list(obj.vertex_groups):obj.vertex_groups.remove(g)
 groups={name:obj.vertex_groups.new(name=name) for name,_,_,_ in defs}
 limbattr=obj.data.attributes['_LIMB']
 for v in obj.data.vertices:
  limb=limbs[v.index];y=v.co.z/scale
  if limb==0:weights=[('pelvis',1)] if y<1.0 else [('spine',1)]
  elif limb==1:weights=[('head',1)]
  elif limb in (2,3):
   side='left' if limb==2 else 'right';t=max(0,min(1,(y-1.055)/.10));weights=[(side+'-upper-arm',t),(side+'-forearm',1-t)]
  else:
   side='left' if limb==4 else 'right'
   if y<.13:weights=[(side+'-foot',1)]
   else:
    t=max(0,min(1,(y-.44)/.12));weights=[(side+'-thigh',t),(side+'-shin',1-t)]
  for name,weight in weights:
   if weight>0:groups[name].add([v.index],weight,'REPLACE')
 for a in list(obj.data.attributes):
  if a.name.startswith('_'):obj.data.attributes.remove(a)
 mod=obj.modifiers.new('skin','ARMATURE');mod.object=rig;obj.parent=rig
 obj['animationContract']='interactive-skin-v1';obj['status']='runtime_pending_webgl'
 for p in rig.pose.bones:p.rotation_mode='XYZ'
 scene=bpy.context.scene;scene.render.fps=24
 rig.animation_data_create()
 for clip in CLIPS:
  action=bpy.data.actions.new(clip);rig.animation_data.action=action
  for frame in (1,7,13,19,25):
   t=(frame-1)/24;wave=math.sin(t*2*math.pi)
   for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
   if clip=='idle':rig.pose.bones['spine'].rotation_euler.x=.015*wave
   if clip=='walk':
    for side,sign in [('left',1),('right',-1)]:
     rig.pose.bones[side+'-thigh'].rotation_euler.x=.35*wave*sign
     rig.pose.bones[side+'-shin'].rotation_euler.x=.35*max(0,-wave*sign)
     rig.pose.bones[side+'-upper-arm'].rotation_euler.x=-.24*wave*sign
   if clip=='look':rig.pose.bones['head'].rotation_euler.y=.55*wave
   if clip=='yield':rig.pose.bones['spine'].rotation_euler.z=.12*math.sin(t*math.pi);rig.pose.bones['right-upper-arm'].rotation_euler.x=-.35*math.sin(t*math.pi)
   if clip=='guide':rig.pose.bones['left-upper-arm'].rotation_euler.x=-1.05*math.sin(t*math.pi);rig.pose.bones['head'].rotation_euler.y=.2*math.sin(t*math.pi)
   if clip=='sit':
    rig.pose.bones['pelvis'].location.y=-.44*scale
    for side in ('left','right'):
     rig.pose.bones[side+'-thigh'].rotation_euler.x=-math.pi/2;rig.pose.bones[side+'-shin'].rotation_euler.x=math.pi/2
     rig.pose.bones[side+'-upper-arm'].rotation_euler.x=-.2;rig.pose.bones[side+'-forearm'].rotation_euler.x=-.7
   for p in rig.pose.bones:p.keyframe_insert('rotation_euler',frame=frame);p.keyframe_insert('location',frame=frame)
  track=rig.animation_data.nla_tracks.new();track.name=clip;track.strips.new(clip,1,action);track.mute=True
 rig.animation_data.action=None
 for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
 scene.frame_set(1);scene.frame_end=25
 obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
 source=ROOT/'source'/(spec['id']+'.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source),compress=True)
 bpy.ops.export_scene.gltf(filepath=str(ROOT/'exports'/(spec['id']+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_animations=True,export_animation_mode='ACTIONS',export_nla_strips=True,export_skins=True,export_all_influences=False,export_normals=True,export_texcoords=False,export_extras=True,export_cameras=False,export_lights=False)
for p in ('source','exports','qa/previews'):(ROOT/p).mkdir(parents=True,exist_ok=True)
for spec in bg.SPECS:build(spec)
print('INTERACTIVE_GENERATION_COMPLETE')

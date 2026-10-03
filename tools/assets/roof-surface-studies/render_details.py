"""Actual GLB reimport grazing-angle detail cameras. No postprocessed crops."""
from pathlib import Path
import argparse
import importlib.util
import math
import sys
import bpy
from mathutils import Vector
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('roof_build',HERE/'build.py'); b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

def render(root):
    records=[]
    for sid,_,_ in b.SURFACES:
        bpy.ops.wm.read_factory_settings(use_empty=True); scene=bpy.context.scene; b.config(scene)
        path=root/'exports'/f'{sid}-2m.inspection.glb'; bpy.ops.import_scene.gltf(filepath=str(path))
        cd=bpy.data.cameras.new('QA-detail-camera'); camera=bpy.data.objects.new('QA-detail-camera',cd); scene.collection.objects.link(camera)
        camera.location=(.18,-.50,.25); target=Vector((0,0,0))
        camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler(); cd.type='ORTHO'; cd.ortho_scale=.68; scene.camera=camera
        ld=bpy.data.lights.new('QA-grazing-sun','SUN'); sun=bpy.data.objects.new('QA-grazing-sun',ld); scene.collection.objects.link(sun)
        ld.energy=2.2; ld.angle=math.radians(3); ld.color=(1,.94,.84); sun.rotation_euler=(math.radians(78),math.radians(10),math.radians(-80))
        scene.world=bpy.data.worlds.new('QA-detail-world'); scene.world.use_nodes=True; bg=scene.world.node_tree.nodes.get('Background')
        bg.inputs['Color'].default_value=(.70,.78,1,1); bg.inputs['Strength'].default_value=.15
        scene.cycles.samples=32; scene.render.resolution_x=960; scene.render.resolution_y=640; scene.render.resolution_percentage=100; scene.render.image_settings.file_format='PNG'
        p=root/'qa/previews'/f'{sid}-grazing-detail.png'; scene.render.filepath=str(p); bpy.ops.render.render(write_still=True)
        records.append({'surfaceId':sid,'file':str(p.relative_to(root)),'sha256':b.digest(p),'import':str(path.relative_to(root)),'importSha256':b.digest(path),'renderer':'Cycles CPU','threads':2,'samples':32,'resolution':[960,640],'cameraPositionM':list(camera.location),'cameraTargetM':list(target),'orthographicWidthM':.68,'sunElevationApproxDegrees':12,'exposure':0,'inspectionOnly':True,'postprocessing':'None: close-up is an actual camera render of delivered GLB. AgX display transform only.','scope':'Magnifies baked relief and filtering; not city appearance or a physical reflectance measurement.'})
    b.dump(root/'qa/detail-render-evidence.json',{'status':'pass','renders':records})
if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--root',type=Path,default=HERE); args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []); render(args.root.resolve())

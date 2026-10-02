"""Original modern/residential add-on kit; Blender 4.3+, metres, offline only.

Reuses the existing architecture-details geometry/material/export helpers without
changing that kit. Artist scenes are standalone; --from-source does not regenerate
meshes or UVs. This generator rebuilds defaults only when --from-source is absent.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
HELPER = HERE.parent/'architecture-details/build_architecture_details.py'
spec = importlib.util.spec_from_file_location('architecture_helpers', HELPER)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
CATALOG = HERE/'catalog.json'
sys.path.insert(0,str(HERE))
ASSETS = json.loads(CATALOG.read_text())['assets']
KINDS = {a['id']: a for a in ASSETS}
h.KINDS = {a['id']: {'triangles': a['triangleCaps']} for a in ASSETS}


def rectangular_loops(name, loops, surface):
    """Closed strip around a sequence of (left,right,bottom,top,depth) loops."""
    vertices = []
    for left, right, bottom, top, depth in loops:
        vertices.extend([(left,bottom,depth),(right,bottom,depth),
                         (right,top,depth),(left,top,depth)])
    faces = []
    for j in range(len(loops)):
        next_j = (j+1)%len(loops)
        for k in range(4):
            faces.append((j*4+k,j*4+(k+1)%4,next_j*4+(k+1)%4,next_j*4+k))
    return h.mesh(name,vertices,faces,surface)


def vertical_profile(name, footprint, levels, surface):
    n = len(footprint)
    verts = [(x*scale,height,.02+(z-.02)*scale) for height,scale in levels for x,z in footprint]
    faces = [tuple(range(n-1,-1,-1)),tuple(range((len(levels)-1)*n,len(levels)*n))]
    for j in range(len(levels)-1):
        faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)]
    return h.mesh(name,verts,faces,surface)


def gable(name, front, rear):
    profile = [(-1,2.66),(0,3.10),(1,2.66),(1,2.58),(0,3.02),(-1,2.58)]
    n = len(profile)
    verts = [(x,y,z) for z in [rear,front] for x,y in profile]
    faces = [tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return h.mesh(name,verts,faces,'cedar')


def build(kind, lod):
    fine = lod == 0
    if kind == 'modern-recessed-window-surround':
        loops = [(-1.10,1.10,0,1.75,.02),(-1.10,1.10,0,1.75,.26),
                 (-.96,.96,.14,1.61,.26),(-.96,.96,.14,1.61,.07),
                 (-1.025,1.025,.075,1.675,.02)]
        if fine:
            loops.insert(2,(-1.08,1.08,.02,1.73,.26))
            loops.insert(3,(-1.08,1.08,.02,1.73,.245))
        rectangular_loops('Deep return with folded face and recessed glazing stop',loops,'painted-metal')
    elif kind == 'modern-sill-drip':
        profile = [(.02,0),(.045,0),(.045,.085),(.29,.045),(.29,0),
                   (.32,0),(.32,.08),(.045,.125),(.045,.16),(.02,.16)]
        if fine:
            profile = [(.02,0),(.045,0),(.045,.085),(.29,.045),(.29,0),
                       (.32,0),(.32,.012),(.307,.012),(.307,.025),(.32,.025),
                       (.32,.08),(.045,.125),(.045,.16),(.02,.16)]
        h.prism('Folded metal sill with rear upstand and downturned drip',profile,2.26,'painted-metal')
    elif kind == 'modern-parapet-cap':
        profile = [(.02,0),(.055,0),(.055,.14),(.445,.11),(.445,0),
                   (.48,0),(.48,.16),(.02,.19)]
        if fine:
            profile = [(.02,0),(.055,0),(.055,.015),(.04,.015),(.04,.04),
                       (.055,.04),(.055,.14),(.445,.11),(.445,.04),(.46,.04),
                       (.46,.015),(.445,.015),(.445,0),(.48,0),(.48,.16),(.02,.19)]
        h.prism('Hollow sloped parapet coping with two folded drip skirts',profile,2.4,'painted-metal')
    elif kind == 'concrete-shadow-plinth':
        profile = [(.02,0),(.15,0),(.18,.035),(.18,.12),(.16,.14),
                   (.16,.31),(.13,.33),(.13,.36),(.16,.38),(.16,.46),(.12,.50),(.02,.50)]
        if not fine:
            profile = [(.02,0),(.15,0),(.18,.035),(.18,.12),(.16,.14),
                       (.16,.31),(.13,.345),(.16,.38),(.16,.46),(.12,.50),(.02,.50)]
        h.prism('Cast concrete base with true recessed shadow course',profile,2.4,'concrete')
    elif kind == 'concrete-chamfer-corner':
        footprint = [(.06,.02),(.36,.02),(.36,.11),(.11,.11),(.11,.38),(0,.38),(0,.07)]
        levels = [(0,1)]
        if fine:
            for y in [.90,1.80]:
                levels += [(y-.012,1),(y-.008,.975),(y+.008,.975),(y+.012,1)]
        levels.append((2.70,1))
        vertical_profile('L-plan exterior broad chamfer with recessed joints',footprint,levels,'concrete')
    elif kind == 'residential-cedar-window-surround':
        # Separate mortise-style jambs and horizontal members remain editable.
        for side in [-1,1]:
            h.box('Vertical cedar jamb', (side*.69,.86,.06),(.10,1.72,.08),'cedar')
        h.box('Lower cedar rail',(0,.05,.07),(1.28,.10,.10),'cedar')
        h.box('Cedar header under head cap',(0,1.67,.07),(1.28,.10,.10),'cedar')
        h.prism('Overhanging sloped cedar head cap',[(.02,1.72),(.18,1.72),(.18,1.80),(.04,1.84),(.02,1.84)],1.62,'cedar')
        if fine:
            for side in [-1,1]:
                h.box('Inner face glazing stop',(side*.6525,.86,.115),(.025,1.52,.03),'cedar')
            h.box('Header face glazing stop',(0,1.6325,.115),(1.28,.025,.03),'cedar')
            h.box('Lower face glazing stop',(0,.0875,.115),(1.28,.025,.03),'cedar')
    elif kind == 'residential-cedar-sill':
        profile = [(.02,0),(.29,0),(.31,.025),(.31,.075),(.06,.13),(.02,.13)]
        if fine:
            profile = [(.02,0),(.235,0),(.235,.018),(.255,.018),(.255,0),
                       (.29,0),(.31,.025),(.31,.075),(.285,.09),(.06,.13),(.02,.13)]
        h.prism('Thick sloping cedar sill with chamfered nose and drip kerf',profile,1.62,'cedar')
    elif kind == 'residential-gabled-entry-canopy':
        gable('Continuous double pitch timber canopy',1.08,.02)
        # Triangular bracket profiles begin above the preserved 2.30 m clear zone.
        for side in [-1,1]:
            profile = [(.04,2.36),(.86,2.58),(.67,2.58),(.04,2.43)]
            h.prism('Diagonal cedar wall bracket',profile,.075,'cedar',side*.74)
            h.box('Bracket wall mounting block',(side*.74,2.48,.055),(.11,.24,.07),'cedar')
        if fine:
            # Real additional front/rear fascia thickness and three internal rails.
            front = gable('Front gabled fascia',1.08,1.02)
            rear = gable('Rear gabled fascia',.08,.02)
            # Fascia top meets the underside at an edge; it does not overlap the roof slab.
            for obj in [front,rear]:
                for v in obj.data.vertices:
                    v.co.z -= .08
                h.metric_uv(obj)
            for z in [.17,.53,.90]:
                h.box('Exposed longitudinal ridge bearer',(0,2.985,z),(.085,.07,.18),'cedar')
    else:
        raise ValueError(kind)


def make_preview(output, lod):
    """Eight isolated views, identical camera/light per asset between both LODs."""
    import tempfile
    import subprocess
    manifest = json.loads((output/'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='architecture-preview-') as temp:
        frames = Path(temp)
        for asset in manifest['assets']:
            scene = h.clean()
            bounds = asset['lods'][0]['bounds']
            lo, hi = bounds['min'], bounds['max']
            centre = Vector(((lo[0]+hi[0])/2,-(lo[2]+hi[2])/2,(lo[1]+hi[1])/2))
            bpy.ops.import_scene.gltf(filepath=str(output/asset['lods'][lod]['file']))
            bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,lo[1]-.07))
            floor = bpy.context.object
            neutral = bpy.data.materials.new('Inspection background only')
            neutral.diffuse_color = (.19,.22,.25,1)
            floor.data.materials.append(neutral)
            for offset,energy,size in [((2,-3,6),850,5),((-3,1,4),400,4)]:
                bpy.ops.object.light_add(type='AREA',location=centre+Vector(offset))
                light = bpy.context.object
                light.data.energy,light.data.size = energy,size
                light.rotation_euler = (centre-light.location).to_track_quat('-Z','Y').to_euler()
            bpy.ops.object.camera_add(location=centre+Vector((2.7,-5,2.3)))
            camera = bpy.context.object
            camera.rotation_euler = (centre-camera.location).to_track_quat('-Z','Y').to_euler()
            camera.data.type = 'ORTHO'
            camera.data.ortho_scale = max((hi[0]-lo[0])*1.35+(hi[2]-lo[2])*.8,(hi[1]-lo[1])*1.70+(hi[0]-lo[0])*.33)
            scene.camera = camera
            scene.render.engine = 'CYCLES'
            scene.cycles.samples = 24
            scene.cycles.use_denoising = False
            scene.world.color = (.35,.35,.35)
            scene.render.resolution_x = 640
            scene.render.resolution_y = 480
            scene.render.resolution_percentage = 100
            scene.render.image_settings.file_format = 'PNG'
            scene.render.filepath = str(frames/f'{asset["id"]}.png')
            bpy.ops.render.render(write_still=True)
        subprocess.run(['python3',str(HERE/'compose_previews.py'),'--frames',str(frames),'--output',str(output),'--lod',str(lod)],check=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--output',type=Path,default=HERE)
    p.add_argument('--from-source',type=Path)
    p.add_argument('--skip-render',action='store_true')
    p.add_argument('--render-only',action='store_true')
    args = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output = args.output.resolve()
    if output == ROOT/'public' or ROOT/'public' in output.parents:
        raise ValueError('Offline output must remain outside public')
    if args.from_source and args.from_source.resolve() == output/'source':
        raise ValueError('Re-export output must differ from input source folder')
    if args.render_only:
        for lod in [0,1]:
            make_preview(output,lod)
        return
    for folder in ['source','assets']:
        (output/folder).mkdir(parents=True,exist_ok=True)
    manifest = {'kit':'Original modern and residential architecture expansion','version':1,
                'status':'offline-candidate; no runtime integration','license':'LicenseRef-Vancouver-Living-Atlas-NC-1.0',
                'units':'metres','upAxis':'+Y','frontAxis':'+Z',
                'origin':'Facade attachment plane at local ground datum; external corner datum for corner',
                'blenderVersion':bpy.app.version_string,'catalogSha256':h.sha(h.CATALOG),
                'expansionCatalogSha256':h.sha(CATALOG),'builderSha256':h.sha(__file__),
                'sharedHelperSha256':h.sha(HELPER),'sourceMaps':{},'assets':[]}
    for surface in sorted({a['surface'] for a in ASSETS}):
        manifest['sourceMaps'][surface] = {k:h.sha(h.TEXTURES/f'{surface}-{k}.png') for k in ['color','normal','orm']}
    for asset in ASSETS:
        kind = asset['id']
        entry = {k:v for k,v in asset.items() if k not in ['triangleCaps','surface']}
        entry.update({'lods':[],'maximumMaterials':1,'integrationStatus':'not-integrated'})
        for lod in [0,1]:
            if args.from_source:
                source = args.from_source.resolve()/f'{kind}.lod{lod}.blend'
                before = h.sha(source)
                bpy.ops.wm.open_mainfile(filepath=str(source))
                if bpy.context.scene.get('asset_id') != kind or bpy.context.scene.get('lod') != lod:
                    raise ValueError('Source asset identity or LOD mismatch')
                entry.setdefault('inputSources',[]).append({'level':lod,'sha256':before})
            else:
                h.clean()
                build(kind,lod)
            if args.from_source:
                from validate_architecture_expansion import MATERIAL_AUDIT
                exec(MATERIAL_AUDIT,{})
            entry['lods'].append(h.export(kind,lod,output))
            if args.from_source and h.sha(source) != before:
                raise ValueError('Input source modified during export')
        manifest['assets'].append(entry)
    (output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    if not args.skip_render:
        for lod in [0,1]:
            make_preview(output,lod)
    print(json.dumps({'assets':len(ASSETS),'output':str(output),'triangles':{str(l):sum(a['lods'][l]['triangles'] for a in manifest['assets']) for l in [0,1]}}))


if __name__ == '__main__':
    main()

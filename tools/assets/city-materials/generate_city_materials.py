"""Blender 4.5: reproducible, original city PBR library and inspection scene.

One editable catalog controls physical scale and finishes across GIS surfaces
and authored GLB modules. No downloaded/photographic material is included.
"""
from pathlib import Path
import argparse, sys, json, math, struct, zlib, hashlib
import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
p = argparse.ArgumentParser()
p.add_argument('--output', default=str(ROOT/'public/materials/city'))
p.add_argument('--source', default=str(Path(__file__).resolve().parent/'source'))
p.add_argument('--skip-render', action='store_true')
A = p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT, SOURCE = Path(A.output).resolve(), Path(A.source).resolve()
OUT.mkdir(parents=True, exist_ok=True)
(SOURCE/'textures').mkdir(parents=True, exist_ok=True)
catalog = json.loads((Path(__file__).parent/'catalog.json').read_text())

def png(path, data):
    """Store known sRGB or data bytes, bottom-origin UV -> PNG top scanline."""
    a = np.rint(np.clip(data, 0, 1)*255).astype(np.uint8)[::-1]
    h,w,c = a.shape
    def chunk(kind, value):
        return struct.pack('!I',len(value))+kind+value+struct.pack('!I',zlib.crc32(kind+value)&0xffffffff)
    raw = b''.join(b'\x00'+row.tobytes() for row in a)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,2 if c==3 else 6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b''))

def noise(x,y,seed):
    # Periodic isotropic value noise; no directional Fourier bands on stone.
    v=np.zeros_like(x)
    rng=np.random.default_rng(seed)
    for cells,weight in [(4,.20),(16,.35),(64,.45)]:
        grid=rng.uniform(-1,1,(cells,cells))
        xx=x*cells; yy=y*cells; ix=np.floor(xx).astype(int)%cells; iy=np.floor(yy).astype(int)%cells
        u=xx%1; w=yy%1; u=u*u*(3-2*u); w=w*w*(3-2*w)
        a=grid[iy,ix]*(1-u)+grid[iy,(ix+1)%cells]*u
        b=grid[(iy+1)%cells,ix]*(1-u)+grid[(iy+1)%cells,(ix+1)%cells]*u
        v+=(a*(1-w)+b*w)*weight
    return v

def fields(m, size):
    y,x = np.mgrid[0:size,0:size].astype(float)
    x=(x+.5)/size; y=(y+.5)/size
    seed = sum(map(ord,m['id']))
    n=noise(x,y,seed); fine=noise(x*3,y*3,seed+9)
    base=np.array(m['averageColor']); color=base[None,None,:]*(1+n[...,None]*.085)
    h=n*.10; rough=m['roughness']+fine*.045
    pattern=m['pattern']
    if pattern in ['brick','paver','shingle']:
        columns,rows=(8,24) if pattern=='brick' else ((8,16) if pattern=='paver' else (4,8))
        row=np.floor(y*rows); bx=x*columns+np.mod(row,2)*.5
        cell=np.floor(bx); qx=bx%1; qy=(y*rows)%1
        variation=np.sin((cell%columns)*7.13+row*13.17+seed)*.5+.5
        physical_edge=np.minimum(np.minimum(qx,1-qx)*m['tileMeters'][0]/columns,np.minimum(qy,1-qy)*m['tileMeters'][1]/rows)
        edge=np.clip((physical_edge-.0015)/.0035,0,1)
        edge=edge*edge*(3-2*edge)
        mortar=np.array([.47,.45,.40]) if pattern=='brick' else np.array([.27,.28,.26])
        if pattern=='shingle': mortar=base*.70
        brick=color*(.83+variation[...,None]*.30)+fine[...,None]*.012
        color=mortar+(brick-mortar)*edge[...,None]
        h=edge+fine*.10
        rough=np.clip(rough+(1-edge)*.04,0,1)
    elif pattern=='cladding':
        course=(y*8)%1
        edge=np.clip(np.minimum(course,1-course)/.055,0,1)
        grain=np.sin(math.tau*(x*57+.04*np.sin(y*math.tau*3)))
        color*= (1-.09*(1-edge)+grain*.014)[...,None]
        h=edge*.75+grain*.055+n*.07
    elif pattern=='stone':
        fleck=np.maximum(0,fine-.35)
        color+=n[...,None]*.025-fleck[...,None]*.06
        h=n*.3+fine*.15
    elif pattern=='concrete':
        pits=np.maximum(0,fine-.3)
        color-=pits[...,None]*.06; h=n*.2-pits*.3
    elif pattern=='paint':
        color*=1+fine[...,None]*.02; h=fine*.3
    else:
        aggregate=noise(x*4,y*4,seed+17)
        color+=aggregate[...,None]*.045; h=fine*.3+aggregate*.22
    height=h*m['reliefMeters']
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*m['tileMeters'][0]/size)
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*m['tileMeters'][1]/size)
    normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1)
    normal/=np.linalg.norm(normal,axis=-1)[...,None]
    orm=np.stack([np.ones_like(x),rough,np.full_like(x,m['metalness'])],axis=-1)
    return {'color':np.clip(color,0,1),'normal':normal*.5+.5,'orm':np.clip(orm,0,1)}

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.scene.unit_settings.system='METRIC'
atlases={key:np.zeros((512,1024,3)) for key in ['color','normal','orm']}
materials=[]
for slot,m in enumerate(catalog['materials']):
    source=fields(m,480); runtime=fields(m,240)
    # Fallback colors match actual encoded source means, not a separate palette.
    m['averageColor']=[round(float(v),6) for v in runtime['color'].mean(axis=(0,1))]
    mat=bpy.data.materials.new(m['id']); mat.use_nodes=True; mat.use_fake_user=True
    nt=mat.node_tree; bs=nt.nodes.get('Principled BSDF')
    uv=nt.nodes.new('ShaderNodeTexCoord'); uv.location=(-850,0)
    mapping=nt.nodes.new('ShaderNodeVectorMath'); mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(1/m['tileMeters'][0],1/m['tileMeters'][1],1)
    mapping.label='UV in metres / physical tile dimensions'; mapping.location=(-650,0)
    nt.links.new(uv.outputs['UV'],mapping.inputs[0])
    nodes={}
    for i,key in enumerate(['color','normal','orm']):
        file=SOURCE/'textures'/f"{m['id']}-{key}.png"; png(file,source[key])
        image=bpy.data.images.load(str(file)); image.colorspace_settings.name='sRGB' if key=='color' else 'Non-Color'
        image.pack()
        node=nt.nodes.new('ShaderNodeTexImage'); node.image=image; node.location=(-450,250-i*280)
        nt.links.new(mapping.outputs[0],node.inputs['Vector']); nodes[key]=node
        padded=np.pad(runtime[key],((8,8),(8,8),(0,0)),mode='wrap')
        row,col=divmod(slot,4); atlases[key][row*256:(row+1)*256,col*256:(col+1)*256]=padded
    nt.links.new(nodes['color'].outputs['Color'],bs.inputs['Base Color'])
    nm=nt.nodes.new('ShaderNodeNormalMap'); nm.uv_map='UVMap'; nm.location=(-100,-150)
    nt.links.new(nodes['normal'].outputs['Color'],nm.inputs['Color']); nt.links.new(nm.outputs[0],bs.inputs['Normal'])
    sep=nt.nodes.new('ShaderNodeSeparateColor'); sep.mode='RGB'; sep.location=(-100,-430)
    nt.links.new(nodes['orm'].outputs['Color'],sep.inputs[0])
    nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']); nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
    mat['surface_id']=m['id']; mat['tile_metres']=m['tileMeters']; materials.append(mat)
    # Preview objects share metre UV convention with generated city walls.
    row,col=divmod(slot,4)
    bpy.ops.mesh.primitive_cube_add(size=1,location=(col*2.4,0,row*2.6+1.15))
    ob=bpy.context.object; ob.name=m['id']+' / metric material swatch'; ob.dimensions=(2.1,.22,2.1)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mesh=ob.data
    for poly in mesh.polygons:
        axis=max(range(3),key=lambda k:abs(poly.normal[k]))
        for li in poly.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co
            mesh.uv_layers.active.data[li].uv=(co.x,co.z) if axis==1 else ((co.x,co.y) if axis==2 else (co.y,co.z))
    ob.data.materials.append(mat)
    mod=ob.modifiers.new('Sample edge bevel','BEVEL'); mod.width=.028; mod.segments=3
    ob.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    text=bpy.data.curves.new(m['id'],'FONT'); text.body=m['id']; text.size=.15; text.align_x='CENTER'
    label=bpy.data.objects.new(m['id']+' label',text); bpy.context.collection.objects.link(label)
    label.location=(col*2.4,-.16,row*2.6-.1); label.rotation_euler=(math.pi/2,0,0)
for key,data in atlases.items(): png(OUT/f'{key}.png',data)
catalog.update({'maps':{'color':'color.png','normal':'normal.png','orm':'orm.png'},
    'normalConvention':'OpenGL +Y tangent', 'uvConvention':'metres; atlas row zero is lower UV row',
    'authoring':'Blender 4.5 material library; original periodic mathematical surfaces, no baked illumination',
    'source':'tools/assets/city-materials/source/city-material-library.blend',
    'files':{key:{'bytes':(OUT/f'{key}.png').stat().st_size,'sha256':hashlib.sha256((OUT/f'{key}.png').read_bytes()).hexdigest()} for key in atlases}})
(OUT/'manifest.json').write_text(json.dumps(catalog,indent=2)+'\n')
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=950; scene.render.resolution_percentage=100
scene.world.use_nodes=True; scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.30,.36,.42,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.45
bpy.ops.object.light_add(type='AREA',location=(-1,-5,8)); light=bpy.context.object; light.data.energy=1700; light.data.size=7
light.rotation_euler=(Vector((3.5,0,2.5))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(11,-16,8)); cam=bpy.context.object; cam.rotation_euler=(Vector((3.6,0,2.5))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'; cam.data.ortho_scale=11.4; scene.camera=cam
scene.view_settings.view_transform='AgX'; scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(SOURCE/'material-board.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'city-material-library.blend'),compress=True)
if not A.skip_render: bpy.ops.render.render(write_still=True)
print('CITY MATERIAL LIBRARY COMPLETE',OUT)

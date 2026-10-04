"""Original 10 m mature tree sources. Destructive rebuild is explicitly separate from export.py."""
import bpy, bmesh, math, random, json, sys, importlib.util
from pathlib import Path
from mathutils import Vector, Euler
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SPECIES=['maple','alder','douglas-fir','western-redcedar']
SEEDS=[41003,42003,43003,44003]
TAU=math.tau

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s=bpy.context.scene;s.unit_settings.system='METRIC';s.unit_settings.scale_length=1

def material(name,role):
    m=bpy.data.materials.new(name);m.use_nodes=True;m['semantic_role']=role
    b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Roughness'].default_value=.88
    return m,b

def image(name,noncolor=False):
    p=(HERE/'source/textures'/name) if name.startswith('bark_') else (HERE.parent/'vegetation_ground/maps'/name)
    im=bpy.data.images.load(str(p));im.colorspace_settings.name='Non-Color' if noncolor else 'sRGB';im.pack();return im

def tex(m,im):
    n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;n.extension='REPEAT';return n

def materials(species):
    bark,b=material('bark-opaque','bark');m=bark
    for name,socket,nc in [('bark_basecolor.png','Base Color',False),('bark_normal.png','Normal',True),('bark_orm.png','Roughness',True)]:
        t=tex(m,image(name,nc))
        if socket=='Normal':
            n=m.node_tree.nodes.new('ShaderNodeNormalMap');m.node_tree.links.new(t.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],b.inputs['Normal'])
        elif socket=='Roughness':
            sep=m.node_tree.nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(t.outputs['Color'],sep.inputs[0]);m.node_tree.links.new(sep.outputs['Green'],b.inputs['Roughness']);m.node_tree.links.new(sep.outputs['Blue'],b.inputs['Metallic'])
        else:m.node_tree.links.new(t.outputs['Color'],b.inputs[socket])
    bark['physical_tile_metres']=[.8,1.6];bark.use_backface_culling=True
    cards,b=material('foliage-straight-alpha','foliage-cards');t=tex(cards,image('leaf_atlas_rgba.png'));t.extension='EXTEND';cards.node_tree.links.new(t.outputs['Color'],b.inputs['Base Color']);cards.node_tree.links.new(t.outputs['Alpha'],b.inputs['Alpha']);cards.surface_render_method='DITHERED';cards.alpha_threshold=.4;cards.use_backface_culling=False
    cards['alpha_mode']='MASK';cards['alpha_cutoff']=.4;cards['alpha_contract']='straight RGBA; alpha is coverage; color and depth use the same mask'
    core,b=material('foliage-solid-interior','foliage-core');b.inputs['Base Color'].default_value=[(.08,.19,.023,1),(.075,.17,.027,1),(.042,.115,.03,1),(.045,.135,.04,1)][species];core.use_backface_culling=True;core['solid']=True
    return bark,cards,core

class Mesh:
    def __init__(self):self.v=[];self.f=[];self.uv=[];self.groups=[]
    def face(self,ids,uv):self.f.append(ids);self.uv.append(uv)
    def object(self,name,mat):
        me=bpy.data.meshes.new(name+'-editable-mesh');me.from_pydata(self.v,[],self.f);me.update();ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob);me.materials.append(mat)
        uv=me.uv_layers.new(name='UVMap')
        for p,coords in zip(me.polygons,self.uv):
            for li,co in zip(p.loop_indices,coords):uv.data[li].uv=co
            p.use_smooth=name!='foliage-cards'
        for label,start,end in self.groups:ob.vertex_groups.new(name=label).add(list(range(start,end)),1,'REPLACE')
        ob['semantic_role']=name;return ob

def tube(mesh,path,radii,sides,label):
    start=len(mesh.v);lengths=[0]
    for a,b in zip(path,path[1:]):lengths.append(lengths[-1]+(Vector(b)-Vector(a)).length)
    for j,pp in enumerate(path):
        p=Vector(pp);axis=(Vector(path[min(j+1,len(path)-1)])-Vector(path[max(0,j-1)])).normalized();right=axis.cross(Vector((0,1,0))).normalized();up=axis.cross(right).normalized()
        for i in range(sides):mesh.v.append(tuple(p+(right*math.cos(i*TAU/sides)+up*math.sin(i*TAU/sides))*radii[j]))
    for j in range(len(path)-1):
        for i in range(sides):
            k=(i+1)%sides;ids=[start+j*sides+i,start+j*sides+k,start+(j+1)*sides+k,start+(j+1)*sides+i]
            u0=i/sides;u1=(i+1)/sides;cs=[TAU*radii[j]/.8,TAU*radii[j+1]/.8]
            mesh.face(ids,[(u0*cs[0],lengths[j]/1.6),(u1*cs[0],lengths[j]/1.6),(u1*cs[1],lengths[j+1]/1.6),(u0*cs[1],lengths[j+1]/1.6)])
    # Ends are intentionally open at buried branch junctions; trunk ground cap is unnecessary.
    mesh.groups.append((label,start,len(mesh.v)))
    return {'id':label,'pathM':[list(p) for p in path],'radiiM':radii,'sides':sides,'arcLengthsM':lengths,'vertexRange':[start,len(mesh.v)],'uvTileM':[.8,1.6]}

def ico(mesh,centre,radii,subdivision,seed,label):
    bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=subdivision,radius=1);bm.verts.ensure_lookup_table();start=len(mesh.v)
    for v in bm.verts:
        p=v.co;noise=1+.055*math.sin(p.x*7.3+p.y*5.2+p.z*4.1+seed)
        mesh.v.append(tuple(centre[k]+p[k]*radii[k]*noise for k in range(3)))
    for f in bm.faces:mesh.face([start+v.index for v in f.verts],[(.5,.5)]*len(f.verts))
    mesh.groups.append((label,start,len(mesh.v)));bm.free()

def microcore(mesh,centre,radii,label):
    start=len(mesh.v);randomizer=random.Random(label);rotation=Euler(tuple(randomizer.random()*math.tau for _ in range(3))).to_matrix()
    for v in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
        p=rotation@Vector(v);mesh.v.append(tuple(centre[k]+p[k]*radii[k] for k in range(3)))
    for ids in [(0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5)]:mesh.face([start+i for i in ids],[(.5,.5)]*3)
    mesh.groups.append((label,start,len(mesh.v)))

def card(mesh,c,size,normal,cell,angle,label,pair=True,planes=3):
    start=len(mesh.v);n=Vector(normal).normalized();helper=Vector((0,0,1)) if abs(n.z)<.9 else Vector((1,0,0));r=n.cross(helper).normalized();u=n.cross(r).normalized();rr=r*math.cos(angle)+u*math.sin(angle);uu=-r*math.sin(angle)+u*math.cos(angle)
    for nr in range(planes if pair else 1):
        right=(rr*math.cos(nr*math.pi/planes)+n*math.sin(nr*math.pi/planes)) if pair else rr;up=uu
        # Shallow central fold supplies a real 3D cluster, never a multi-metre leaf plane.
        if pair:
            base=len(mesh.v)
            for x,y in [(-.5,-.5),(.5,-.5),(.5,.5),(-.5,.5)]:mesh.v.append(tuple(Vector(c)+right*x*size+up*y*size))
            u0=(cell%2+.008)/2;u1=(cell%2+.992)/2;v0=(1-cell//2+.008)/2;v1=(1-cell//2+.992)/2
            mesh.face([base+i for i in range(4)],[(u0,v0),(u1,v0),(u1,v1),(u0,v1)])
            continue
        pts=[(-.5,-.5,0),(0,-.5,.07),(.5,-.5,0),(-.5,.5,0),(0,.5,.07),(.5,.5,0)];base=len(mesh.v)
        for x,y,z in pts:mesh.v.append(tuple(Vector(c)+right*x*size+up*y*size+n*z*size))
        def uv(x,y):return ((cell%2+.008+x*.984)/2,(1-cell//2+.008+y*.984)/2)
        for ids,uvs in [([0,1,4,3],[(0,0),(.5,0),(.5,1),(0,1)]),([1,2,5,4],[(.5,0),(1,0),(1,1),(.5,1)])]:mesh.face([base+i for i in ids],[uv(*p) for p in uvs])
    mesh.groups.append((label,start,len(mesh.v)))


def skeleton(species):
    rng=random.Random(SEEDS[species]);conifer=species>=2
    if not conifer:
        lobes=[((.02,-.04,8.83),(.84,.87,1.0))]
        for i in range(5):
            a=i*TAU/5+.24;z=7.22+.25*math.sin(i*2.2);r=1.05
            lobes.append(((math.cos(a)*r,math.sin(a)*r,z),(1.06,.98,1.35 if species==0 else 1.57)))
        for i in range(3):
            a=i*TAU/3+1.15;lobes.append(((math.cos(a)*1.1,math.sin(a)*1.1,5.55+.22*math.sin(i)),(1.03,.97,1.02 if species==0 else 1.26)))
    else:
        lobes=[]
        for i,(z,r,h) in enumerate([(3.8,2.0,.91),(4.9,1.85,.95),(6.0,1.55,.9),(7.03,1.2,.86),(8.03,.85,.79),(8.9,.52,.66),(9.55,.24,.45)]):
            lobes.append(((math.sin(i*2.1)*.08,math.cos(i*1.4)*.08,z),(r,r*.95,h)))
    trunk=[(0,0,0),(.025,-.015,1.8),(.01,.02,3.4),(-.08,.01,5.1),(.02,-.04,6.8),(.015,.015,8.4),(0,0,9.64)]
    primary=[]
    if not conifer:
        for i,(c,rad) in enumerate(lobes):
            root=(trunk[2] if i>5 else trunk[3]);tip=(c[0]*.95,c[1]*.95,c[2]-.15)
            mid=((root[0]+tip[0])*.48,(root[1]+tip[1])*.48,(root[2]+tip[2])*.5)
            primary.append([root,mid,tip])
    else:
        for i,(c,rad) in enumerate(lobes[:-1]):
            for j in range(5):
                a=j*TAU/5+i*1.72;root=(0,0,c[2]+.3);tip=(c[0]+math.cos(a)*rad[0]*.90,c[1]+math.sin(a)*rad[1]*.90,c[2]-.12-(.2 if species==3 else 0))
                mid=((root[0]+tip[0])*.53,(root[1]+tip[1])*.53,c[2]+.04);primary.append([root,mid,tip])
    samples=[]
    # Shared immutable samples across tiers; leaf-level randomness cannot move scaffolds.
    total=440
    weights=[r[0]*r[1]+r[1]*r[2]+r[0]*r[2] for c,r in lobes];counts=[max(16,round(total*w/sum(weights))) for w in weights]
    for li,((c,r),count) in enumerate(zip(lobes,counts)):
        for j in range(count):
            # Fibonacci sphere plus modest seed jitter creates a closed but irregular crown.
            zz=1-2*(j+.5)/count;phi=j*2.3999632297+li*1.83;rr=math.sqrt(1-zz*zz)
            n=Vector((rr*math.cos(phi),rr*math.sin(phi),zz));shell=.91+.07*rng.random()
            p=Vector(tuple(c[k]+n[k]*r[k]*shell+(rng.random()-.5)*.14 for k in range(3)))
            if species==3:p.z-=.1*abs(n.x)
            size=.28+.105*rng.random();normal=(n+Vector((.16,0,.4))).normalized() if not conifer else Vector((n.x*.25,n.y*.25,1)).normalized()
            samples.append({'id':f'cluster-{li:02}-{j:03}','lobe':li,'centre':p,'size':size,'normal':normal,'angle':rng.random()*TAU,'index':j})
    return trunk,primary,lobes,samples


def build(species,lod):
    clear();s=bpy.context.scene;aid='mature-'+SPECIES[species];s['asset_id']=aid;s['lod']=lod;s['templateHeightM']=10.;s['normalizationMode']='physical-template-source-height-divided-by-template-height';s['source_seed']=SEEDS[species]
    bark,leaf,coremat=materials(species);wood=Mesh();branches=Mesh();cores=Mesh();cards=Mesh();trunk,primary,lobes,samples=skeleton(species);records=[]
    if lod<2:
        records.append(tube(wood,trunk,[.26,.20,.165,.123,.085,.042,.012],10 if lod==0 else 6,'leader-trunk'))
        for i,path in enumerate(primary):
            records.append(tube(branches,path,[.115 if species<2 else .055,.057 if species<2 else .03,.018],6 if lod==0 else 4,f'primary-{i:02}'))
            if lod==0:
                tip=Vector(path[-1]);axis=(tip-Vector(path[0])).normalized();side=axis.cross(Vector((0,0,1))).normalized()
                if side.length<.1:side=Vector((1,0,0))
                for j in range(4 if species<2 else 2):
                    root=Vector(path[1]).lerp(tip,.25+j*.17);sign=1 if j%2 else -1;end=root+side*sign*(.30+.10*j)+Vector((0,0,.3 if species<2 else .08))
                    records.append(tube(branches,[root,end],[.03,.007],4,f'secondary-{i:02}-{j:02}'))
        chosen=samples if lod==0 else [v for v in samples if v['index']%5==0]
        for q in chosen:
            size=q['size'];scale=1 if lod==0 else (2.35 if species>=2 else 2.1)
            radii=tuple(scale*x for x in ((size*.62,size*.57,size*.56) if species<2 else (size*.60,size*.54,size*.32)))
            c=Vector(lobes[q['lobe']][0]);p=c+(q['centre']-c)*.72
            if species<2 and lod==0:
                # Near broadleaf has no opaque crown: spend the former volume budget on
                # five crossed, alpha-masked leaf planes at irregular inner branch positions.
                p=c+(q['centre']-c)*.63
                card(cores,p,size,q['normal'],species,q['angle']+.57,'inner-'+q['id'],pair=True,planes=5)
            else:microcore(cores,p,radii,'inner-volume-'+q['id'])
        for q in chosen:card(cards,q['centre'],q['size']*(.86 if lod==1 else 1),q['normal'],species,q['angle'],q['id'],pair=lod==0)
    else:
        path=[trunk[i] for i in [0,2,4,6]];records.append(tube(wood,path,[.26,.165,.085,.012],3,'leader-trunk'))
        chosenprim=primary[:4] if species<2 else primary[::6]
        for i,p in enumerate(chosenprim):records.append(tube(branches,[p[0],p[-1]],[.09,.014],3,f'primary-{i:02}'))
        for li,(c,r) in enumerate(lobes):ico(cores,c,[v*1.065 for v in r],1,li+species*11,f'crown-interior-{li:02}')
    objects=[wood.object('trunk',bark),branches.object('branches',bark),cores.object('foliage-core',leaf if species<2 and lod==0 else coremat)]
    if lod<2:objects.append(cards.object('foliage-cards',leaf))
    # One authoring transform derived from LOD0; every LOD shares origin, scaffold and source-height conversion.
    # The final envelope is stated, not inferred to be botanical measurement.
    if lod==0:
        allpts=[v for m in [wood,branches,cores,cards] for v in m.v];width=max(v[0] for v in allpts)-min(v[0] for v in allpts);height=max(v[2] for v in allpts);factor=(4.78 if species==0 else 4.67 if species==1 else 4.70 if species==2 else 4.76)/width
        factors={'xy':factor,'z':10/height};(HERE/'qa'/f'{aid}-authoring-transform.json').write_text(json.dumps(factors))
    else:factors=json.loads((HERE/'qa'/f'{aid}-authoring-transform.json').read_text())
    for ob in objects:
        for v in ob.data.vertices:v.co.x*=factors['xy'];v.co.y*=factors['xy'];v.co.z*=factors['z']
        ob['asset_id']=aid;ob['lod']=lod;ob['templateHeightM']=10.;ob['source_seed']=SEEDS[species]
    # A horizontal contact ring and shared 10 m apical leader make the physical datum exact.
    trunk_sides=records[0]['sides']
    for v in objects[0].data.vertices[:trunk_sides]:v.co.z=0
    for v in objects[0].data.vertices[-trunk_sides:]:v.co.z=10
    if lod>0:
        fol=[v for ob in objects[2:] for v in ob.data.vertices]
        width=max(v.co.x for v in fol)-min(v.co.x for v in fol)
        fac=(4.78 if species==0 else 4.67 if species==1 else 4.70 if species==2 else 4.76)/width
        for v in fol:v.co.x*=fac;v.co.y*=fac
    if lod<2:
        layers=[(objects[-1],cards)]
        if species<2 and lod==0:layers.append((objects[2],cores))
        for ob,mesh in layers:
            for _,start,end in mesh.groups:
                vs=[ob.data.vertices[i] for i in range(start,end)]
                centre=sum((v.co for v in vs),Vector())/len(vs)
                size=max(max(v.co[k] for v in vs)-min(v.co[k] for v in vs) for k in range(3))
                if size>.58:
                    for v in vs:v.co=centre+(v.co-centre)*(.58/size)
    # Retile bark after baked authoring envelope adjustment using measured ring perimeter/arc length.
    for ob in objects[:2]:
        grouprecs=[r for r in records if (r['id']=='leader-trunk')==(ob.name=='trunk')]
        poly=0
        for r in grouprecs:
            pts=[Vector((p[0]*factors['xy'],p[1]*factors['xy'],p[2]*factors['z'])) for p in r['pathM']];lengths=[0]
            for a,b in zip(pts,pts[1:]):lengths.append(lengths[-1]+(b-a).length)
            start=r['vertexRange'][0];sides=r['sides'];circ=[]
            if r['id']=='leader-trunk':
                pts[0].z=0;pts[-1].z=10;lengths=[0]
                for a,b in zip(pts,pts[1:]):lengths.append(lengths[-1]+(b-a).length)
            for j in range(len(pts)):
                ring=[ob.data.vertices[start+j*sides+i].co for i in range(sides)];circ.append(sum((ring[(i+1)%sides]-ring[i]).length for i in range(sides)))
            for j in range(len(pts)-1):
                for i in range(sides):
                    uv=[(i/sides*circ[j]/.8,lengths[j]/1.6),((i+1)/sides*circ[j]/.8,lengths[j]/1.6),((i+1)/sides*circ[j+1]/.8,lengths[j+1]/1.6),(i/sides*circ[j+1]/.8,lengths[j+1]/1.6)]
                    for loop,co in zip(ob.data.polygons[poly].loop_indices,uv):ob.data.uv_layers.active.data[loop].uv=co
                    poly+=1
            r['pathM']=[list(p) for p in pts];r['arcLengthsM']=lengths;r['ringPerimetersM']=circ
    s['bark_uv_records']=json.dumps(records)
    s['crown_cluster_count']=len(cards.groups);s['crown_lobes']=len(lobes)
    # Preserve editable per-cluster/per-branch vertex groups, native UVs, separate material nodes and packed originals.
    s['authoring_notes']='Original full-height mature skeleton; not an enlarged sprig. Build is destructive; export.py preserves saved artist edits.'
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'source'/f'{aid}.lod{lod}.blend'),compress=True)


def main():
    for species in range(4):
        for lod in range(3):build(species,lod)
    print('MATURE_TREE_SOURCES_BUILT')
if __name__=='__main__':main()

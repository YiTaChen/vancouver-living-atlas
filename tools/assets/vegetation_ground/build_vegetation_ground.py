"""Original offline vegetation/ground candidates. Blender 4.3+, no dependencies/downloads.
Run: blender -b -t 2 --python tools/assets/vegetation_ground/build_vegetation_ground.py
"""
from pathlib import Path
import bpy, numpy as np, math, json, struct, zlib, hashlib
from mathutils import Vector
def main():
    ROOT=Path(__file__).resolve().parent
    for d in ('maps','exports','source','previews'): (ROOT/d).mkdir(exist_ok=True)
    N=512; TAU=math.tau
    SPECIES=['maple','alder','douglas_fir','western_redcedar']
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.context.scene.unit_settings.system='METRIC'
    bpy.context.scene.unit_settings.scale_length=1

    def png(path,a):
        a=np.rint(np.clip(a,0,1)*255).astype(np.uint8)[::-1]; h,w,c=a.shape
        def chunk(k,d): return struct.pack('!I',len(d))+k+d+struct.pack('!I',zlib.crc32(k+d)&0xffffffff)
        path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',w,h,8,6 if c==4 else 2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(b'\0'+r.tobytes() for r in a),9))+chunk(b'IEND',b''))

    def noise(x,y,seed):
        rng=np.random.default_rng(seed); v=np.zeros_like(x)
        for c,w in [(4,.18),(16,.30),(64,.32),(128,.20)]:
            g=rng.uniform(-1,1,(c,c)); X=x*c; Y=y*c
            ix=np.floor(X).astype(int)%c; iy=np.floor(Y).astype(int)%c
            u=X%1; t=Y%1; u=u*u*(3-2*u); t=t*t*(3-2*t)
            v+=w*((g[iy,ix]*(1-u)+g[iy,(ix+1)%c]*u)*(1-t)+(g[(iy+1)%c,ix]*(1-u)+g[(iy+1)%c,(ix+1)%c]*u)*t)
        return v

    y,x=np.mgrid[0:N,0:N].astype(float); x=(x+.5)/N; y=(y+.5)/N
    atlas=np.zeros((1024,1024,4),float)

    def leaf_cell(kind):
        base=np.array([[.26,.39,.12],[.23,.37,.14],[.22,.33,.14],[.24,.36,.17]][kind]); rgb=np.broadcast_to(base,(N,N,3)).copy(); alpha=np.zeros((N,N)); detail=np.zeros((N,N)); colorfield=np.ones((N,N))
        def segment(ax,ay,bx,by,width,tone):
            vx=bx-ax; vy=by-ay; t=np.clip(((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy),0,1)
            d=np.hypot(x-ax-t*vx,y-ay-t*vy); a=np.clip((width-d)*N+.5,0,1)
            replace=a>alpha; alpha[:]=np.maximum(alpha,a); colorfield[replace]=tone
        def broad(cx,cy,length,width,angle,lobed):
            dx=x-cx; dy=y-cy; u=(dx*np.cos(angle)+dy*np.sin(angle))/width; v=(-dx*np.sin(angle)+dy*np.cos(angle))/length
            t=v+.5; env=np.maximum(0,np.sin(np.clip(t,0,1)*math.pi))**.75
            # Palmate five-lobe maple silhouette is evaluated below.
            serr=.98+.02*np.cos(t*math.pi*38)
            signed=np.minimum(env*serr-np.abs(u)*2,np.minimum(t,1-t)*4)
            if lobed:
                poly=[(0,-.5),(-.14,-.21),(-.44,-.28),(-.32,-.02),(-.50,.17),(-.23,.18),(-.24,.40),(-.08,.32),(0,.54),(.08,.32),(.24,.40),(.23,.18),(.50,.17),(.32,-.02),(.44,-.28),(.14,-.21)]
                inside=np.zeros_like(u,dtype=bool); dist=np.full_like(u,999.)
                for ii,(ax,ay) in enumerate(poly):
                    bx,by=poly[(ii+1)%len(poly)]; vx=bx-ax;vy=by-ay
                    inside ^= ((ay>v)!=(by>v)) & (u < (bx-ax)*(v-ay)/(by-ay+1e-20)+ax)
                    tt=np.clip(((u-ax)*vx+(v-ay)*vy)/(vx*vx+vy*vy),0,1)
                    dist=np.minimum(dist,np.hypot(u-ax-tt*vx,v-ay-tt*vy))
                signed=np.where(inside,dist,-dist)
            a=np.clip(signed*N*min(width,length)+.5,0,1)
            mid=np.exp(-(u*width*N/1.25)**2); veins=np.exp(-(np.abs((v*8-np.abs(u)*1.8+.5)%1-.5)*30)**2)
            field=1+noise(x,y,kind+71)*.16+mid*.20+veins*.07
            replace=a>alpha; colorfield[replace]=field[replace]; alpha[:]=np.maximum(alpha,a)
        segment(.5,.08,.5,.9,.006,.72)
        if kind<2:
            for j,(cx,cy,an) in enumerate([(.33,.29,-.68),(.66,.40,.68),(.33,.55,-.75),(.63,.69,.55),(.49,.79,0)]):
                segment(.5,cy-.1,cx,cy,.004,.80)
                broad(cx,cy,.33 if kind==0 else .31,.28 if kind==0 else .22,an,kind==0)
        else:
            for j in range(8):
                cy=.19+j*.085; reach=.31*(1-j*.06)
                for s in (-1,1):
                    bx=.5+s*reach; by=cy+.16
                    segment(.5,cy,bx,by,.004,.80)
                    for k in range(8 if kind==2 else 6):
                        t=.10+k/(8 if kind==2 else 6)*.85; cx=.5+(bx-.5)*t; yy=cy+(by-cy)*t
                        for side in (-1,1):
                            if kind==2: segment(cx,yy,cx+s*.045+side*.018,yy+.055-side*.025,.0031,1+.11*math.sin(k+j))
                            else: broad(cx+s*.017,yy+.032,.105,.035,s*.45+side*.6,False)
        rgb*=colorfield[...,None]; return np.dstack((np.clip(rgb,0,1),alpha))
    for i in range(4):
        row=1-i//2; col=i%2; atlas[row*N:(row+1)*N,col*N:(col+1)*N]=leaf_cell(i)
    png(ROOT/'maps/leaf_atlas_rgba.png',atlas)
    # Mip references use per-cell coverage correction, never silently applied by GLTF.
    coverage=[]; base_cov=[]
    accepted=lambda a: np.rint(np.clip(a,0,1)*255)>=102  # actual 8-bit PNG alpha at cutoff .4
    for i in range(4):
        cell=atlas[(1-i//2)*N:(2-i//2)*N,(i%2)*N:(i%2+1)*N]; base_cov.append(float(accepted(cell[...,3]).mean()))
    cur=atlas
    for level in range(5):
        if level: cur=cur.reshape(cur.shape[0]//2,2,cur.shape[1]//2,2,4).mean((1,3))
        corrected=cur.copy(); n=cur.shape[0]//2
        cells=[]
        for i in range(4):
            sl=(slice((1-i//2)*n,(2-i//2)*n),slice((i%2)*n,(i%2+1)*n)); a=cur[sl][...,3]; lo,hi=.05,16.
            for _ in range(25):
                m=(lo+hi)/2
                if accepted(a*m).mean()<base_cov[i]:lo=m
                else:hi=m
            scale=1 if level==0 else (lo+hi)/2; corrected[sl][...,3]=np.clip(a*scale,0,1)
            cells.append({'species':SPECIES[i],'baseCoverage':base_cov[i],'boxCoverage':float(accepted(a).mean()),'correctedCoverage':float(accepted(corrected[sl][...,3]).mean()),'alphaScale':scale})
        png(ROOT/f'maps/leaf_mip_{level}_{cur.shape[0]}.png',corrected)
        coverage.append({'level':level,'size':cur.shape[0],'cells':cells})
    (ROOT/'alpha-coverage.json').write_text(json.dumps({'cutoff':.4,'measurement':'uncompressed texel coverage, not projected crown silhouette','mips':coverage},indent=2)+'\n')

    materials={}
    def material(name,color,normal=None,orm=None,alpha=False):
        m=bpy.data.materials.new(name); m.use_nodes=True; nt=m.node_tree; bs=nt.nodes.get('Principled BSDF'); bs.inputs['Roughness'].default_value=.92
        def tex(path,space,xy):
            im=bpy.data.images.load(str(path),check_existing=True); im.colorspace_settings.name=space; im.pack(); nd=nt.nodes.new('ShaderNodeTexImage'); nd.image=im; nd.location=xy; nd.label=path.name; return nd
        c=tex(color,'sRGB',(-650,200)); nt.links.new(c.outputs['Color'],bs.inputs['Base Color'])
        if alpha:
            nt.links.new(c.outputs['Alpha'],bs.inputs['Alpha']); m.surface_render_method='DITHERED'; m.alpha_threshold=.4; m.use_backface_culling=False
        if normal:
            n=tex(normal,'Non-Color',(-650,-80)); nm=nt.nodes.new('ShaderNodeNormalMap'); nm.location=(-300,-70); nt.links.new(n.outputs['Color'],nm.inputs['Color']); nt.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
        if orm:
            o=tex(orm,'Non-Color',(-650,-400)); sep=nt.nodes.new('ShaderNodeSeparateColor'); sep.location=(-300,-350); nt.links.new(o.outputs['Color'],sep.inputs[0]); nt.links.new(sep.outputs['Green'],bs.inputs['Roughness']); nt.links.new(sep.outputs['Blue'],bs.inputs['Metallic'])
        materials[name]=m; return m
    leafmat=material('Foliage_RGBA_Cutout_candidate',ROOT/'maps/leaf_atlas_rgba.png',alpha=True)

    soilnoise=noise(x,y,58); fine=noise(x*2,y*2,59)
    soil=np.array([.29,.235,.17])*(1+soilnoise[...,None]*.30)+fine[...,None]*.023
    # Fine blade field is periodic and subdued; no baked cast shadows.
    grassfield=noise(x,y,72); blades=np.sin(TAU*(x*96+.35*np.sin(TAU*y*8)))
    grass=np.array([.285,.34,.155])*(1+grassfield[...,None]*.30)+blades[...,None]*.014
    blend=np.clip((x-.35+noise(x,y,49)*.16)/.30,0,1); blend=blend*blend*(3-2*blend)
    for name in ['bark','soil','grass','soil_grass_edge']:
        if name=='bark':
            groove=(.5+.5*np.sin(TAU*(x*22+.20*np.sin(TAU*y*3)+noise(x,y,21)*.16)))**7
            h=(noise(x,y,26)*.6-groove)*.004; color=np.array([.31,.275,.225])*(1+noise(x,y,28)[...,None]*.24-groove[...,None]*.23); rough=.92+fine*.055; tile=[.8,1.6]
        elif name=='soil': h=(soilnoise*.75+fine*.25)*.008; color=soil; rough=.95+fine*.03; tile=[2.,2.]
        elif name=='grass': h=(grassfield*.5+blades*.20)*.009; color=grass; rough=.94+fine*.035; tile=[2.,2.]
        else: h=((soilnoise*.75+fine*.25)*.008)*(1-blend)+(grassfield*.5+blades*.20)*.009*blend; color=soil*(1-blend[...,None])+grass*blend[...,None]; rough=.95+fine*.03; tile=[2.,2.]
        dx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*tile[0]/N); dy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*tile[1]/N)
        if name=='soil_grass_edge': dx[:,0]=dx[:,1]; dx[:,-1]=dx[:,-2]
        normal=np.stack([-dx,-dy,np.ones_like(x)],-1); normal/=np.linalg.norm(normal,axis=-1)[...,None]
        for suffix,arr in [('basecolor',color),('normal',normal*.5+.5),('orm',np.stack([np.ones_like(x),np.clip(rough,0,1),np.zeros_like(x)],-1))]: png(ROOT/f'maps/{name}_{suffix}.png',arr)
        m=material(name,ROOT/f'maps/{name}_basecolor.png',ROOT/f'maps/{name}_normal.png',ROOT/f'maps/{name}_orm.png'); m['tile_metres']=tile; m['normal_convention']='OpenGL +Y'; m['authoring']='Deterministic original analytic fields in build_vegetation_ground.py'
    png(ROOT/'maps/soil_grass_blend_weight.png',np.repeat(blend[...,None],3,axis=-1))

    # Mesh constructors keep metre units, seam-correct UVs and separate alpha/opaque roles.
    def mesh(name,verts,faces,uvs,mat):
        me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update(); uv=me.uv_layers.new(name='UVMap')
        for p,coords in zip(me.polygons,uvs):
            for li,co in zip(p.loop_indices,coords):uv.data[li].uv=co
        ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); me.materials.append(mat); return ob

    def wood(name,segments,sides):
        vs=[];fs=[];uv=[]
        for a,b,r0,r1 in segments:
            a=Vector(a);b=Vector(b);axis=(b-a).normalized(); r=axis.cross(Vector((0,1,0))).normalized(); t=axis.cross(r); offset=len(vs)
            for p,radius in [(a,r0),(b,r1)]:
                for j in range(sides):vs.append(tuple(p+radius*(r*math.cos(j*TAU/sides)+t*math.sin(j*TAU/sides))))
            for j in range(sides):
                fs.append((offset+j,offset+(j+1)%sides,offset+sides+(j+1)%sides,offset+sides+j)); u0=j/sides*TAU*r0/.8;u1=(j+1)/sides*TAU*r0/.8; v=(b-a).length/1.6;uv.append([(u0,0),(u1,0),(u1,v),(u0,v)])
            fs.extend([tuple(offset+j for j in reversed(range(sides))),tuple(offset+sides+j for j in range(sides))]); uv.extend([[(.5+.48*math.cos(j*TAU/sides),.5+.48*math.sin(j*TAU/sides)) for j in reversed(range(sides))],[(.5+.48*math.cos(j*TAU/sides),.5+.48*math.sin(j*TAU/sides)) for j in range(sides)]])
        return mesh(name,vs,fs,uv,materials['bark'])

    def foliage(name,species,count):
        vs=[];fs=[];uv=[]
        # Nested spatial directions; LOD retains extremal anchor sprays.
        anchors=[(0,0,.96),(.36,0,.73),(-.36,0,.73),(0,.30,.68),(0,-.30,.68),(.22,.22,.44),(-.22,-.22,.44),(.23,-.23,.53),(-.23,.23,.53),(.16,.10,.83),(-.16,-.10,.83),(.03,-.18,.38)]
        for j in range(count):
            c=Vector(anchors[j]); axis=Vector((c.x*.8,c.y*.8,.7)).normalized(); r=Vector((math.cos(j*2.4),math.sin(j*2.4),0)); r=(r-axis*r.dot(axis)).normalized(); normal=r.cross(axis).normalized(); start=len(vs)
            for v in [-.5,.5]:
                for u in [-.5,0,.5]:vs.append(tuple(c+r*u*.49+axis*v*.48+normal*(1-abs(u*2))*.044))
            row=1-species//2;col=species%2
            def U(u,v):return ((col+.008+u*.984)/2,(row+.008+v*.984)/2)
            for ids,coords in [((0,1,3),[(0,0),(.5,0),(0,1)]),((1,4,3),[(.5,0),(.5,1),(0,1)]),((1,2,4),[(.5,0),(1,0),(.5,1)]),((2,5,4),[(1,0),(1,1),(.5,1)])]:fs.append(tuple(start+k for k in ids));uv.append([U(*p) for p in coords])
        ob=mesh(name,vs,fs,uv,leafmat); ob['species']=SPECIES[species];ob['alpha_cutoff']=.4; return ob

    manifest={'schemaVersion':1,'status':'offline integration candidates; no runtime replacement','provenance':'Original analytic geometry/textures authored for Vancouver Living Atlas; no downloaded imagery, scans or third-party assets. Repository LICENSE applies.','units':'metres; Blender Z-up, GLB Y-up','normalConvention':'OpenGL +Y','alphaContract':'Straight RGBA cutout .4, double-sided; NOT compatible with existing neutral-matte/aSolid decoder without reviewed shader and solid UV changes.','assets':[]}
    all_groups=[]
    def export_group(name,objs,lod,role):
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objs:ob.select_set(True)
        bpy.context.view_layer.objects.active=objs[0]
        path=ROOT/'exports'/f'{name}.glb'
        bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_extras=True,export_yup=True,export_attributes=True)
        # Blender 4.3 exports DITHERED as BLEND. Patch JSON-only alpha semantics to explicit cutout.
        data=path.read_bytes(); n,kind=struct.unpack_from('<II',data,12); doc=json.loads(data[20:20+n]); changed=False
        for m in doc.get('materials',[]):
            if m.get('name')=='Foliage_RGBA_Cutout_candidate': m['alphaMode']='MASK';m['alphaCutoff']=.4;m['doubleSided']=True;changed=True
        if role.startswith('bounded sloped'):
            for sampler in doc.get('samplers',[]): sampler['wrapS']=33071; sampler['wrapT']=10497
            changed=True
        if changed:
            raw=json.dumps(doc,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4);tail=data[20+n:];path.write_bytes(struct.pack('<III',0x46546c67,2,12+8+len(raw)+len(tail))+struct.pack('<II',len(raw),0x4e4f534a)+raw+tail)
        verts=sum(len(o.data.vertices) for o in objs);tris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)
        manifest['assets'].append({'id':name,'file':f'exports/{name}.glb','lod':lod,'role':role,'vertices':verts,'triangles':tris,'primitives':len(objs),'bytes':path.stat().st_size,'boundsBlender':[[round(min(v.co[k] for o in objs for v in o.data.vertices),6) for k in range(3)],[round(max(v.co[k] for o in objs for v in o.data.vertices),6) for k in range(3)]]})
        collection=bpy.data.collections.new(name); collection['delivery_asset']=True; bpy.context.scene.collection.children.link(collection)
        for o in objs:
            for old in list(o.users_collection): old.objects.unlink(o)
            collection.objects.link(o)
            o['asset_id']=name
        all_groups.append((name,objs))
    for species in range(4):
        for lod,(count,sides) in enumerate([(12,8),(9,6),(5,4)]):
            seg=[((0,0,0),(0,0,1.04),.034,.012)]
            # Same branch endpoints retained across LODs; cards are reduced, not population.
            for j in range(4):
                angle=j*TAU/4;seg.append(((0,0,.27+j*.1),(.29*math.cos(angle),.29*math.sin(angle),.69+j*.04),.018,.004))
            name=f'{SPECIES[species]}_sprig_lod{lod}';objs=[wood(name+'_wood',seg,sides),foliage(name+'_leaves',species,count)];export_group(name,objs,lod,'representative 1.25 m sapling/branch study; not mature city-tree replacement')
            for o in objs:o.location=(species*1.8,lod*1.9,0);o['display_offset']=list(o.location)
    for lod,n in enumerate([16,8,4]):
        vs=[];fs=[];uv=[]
        for j in range(n+1):
            for i in range(n+1):
                u=i/n;v=j/n;vs.append((u*2,v*2,.1*u+.03*math.sin(v*TAU)*math.sin(u*math.pi)))
        for j in range(n):
            for i in range(n):
                a=j*(n+1)+i;fs.extend([(a,a+1,a+n+2),(a,a+n+2,a+n+1)]);uv.extend([[(i/n,j/n),((i+1)/n,j/n),((i+1)/n,(j+1)/n)],[(i/n,j/n),((i+1)/n,(j+1)/n),(i/n,(j+1)/n)]])
        name=f'soil_grass_slope_lod{lod}';ob=mesh(name,vs,fs,uv,materials['soil_grass_edge']);attr=ob.data.attributes.new(name='_GRASS_WEIGHT',type='FLOAT',domain='POINT')
        for p in ob.data.vertices: t=max(0,min(1,(p.co.x/2-.35)/.30));attr.data[p.index].value=t
        ob['UV_semantics']='0..1 covers 2m edge; U soil-to-grass, V repeats; no repeating U seam';export_group(name,[ob],lod,'bounded sloped ground replacement sample; no overlay/population');ob.location=(lod*2.4,-3,0);ob['display_offset']=list(ob.location)
    # Inspectable editable atlas plates and material study cylinders, excluded from GLB.
    for i in range(4):
        col=i%2;row=1-i//2;coords=[(col/2,row/2),((col+1)/2,row/2),((col+1)/2,(row+1)/2),(col/2,(row+1)/2)]
        ob=mesh(SPECIES[i]+'_atlas_authoring_plate',[(0,0,0),(1,0,0),(1,0,1),(0,0,1)],[(0,1,2,3)],[coords],leafmat);ob.location=(i*1.8,-4.3,.2)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=False;scene.render.threads_mode='FIXED';scene.render.threads=2
    scene.render.resolution_x=1400;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.28,.34,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    bpy.ops.object.light_add(type='AREA',location=(1,-4,10));bpy.context.object.data.energy=1700;bpy.context.object.data.size=7
    bpy.ops.object.camera_add(location=(9,-12,10));cam=bpy.context.object;cam.rotation_euler=(Vector((2.8,0,0.6))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11;scene.camera=cam
    scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'previews/vegetation_ground_board.png')
    scene['integration_status']='OFFLINE ONLY. RGBA shader/depth/aSolid adaptation + matched runtime LOD and device gates required.'
    # Keep rebuild instructions and editable source in the packed .blend.
    code=bpy.data.texts.new('build_vegetation_ground.py'); code.write(Path(__file__).read_text())
    txt=bpy.data.texts.new('REBUILD_AND_LICENSE');txt.write(__doc__+'\nOriginal asset contribution. Based on Vancouver Living Atlas by YiTaChen.\nhttps://github.com/YiTaChen/vancouver-living-atlas\nLicense: Vancouver Living Atlas Noncommercial Research and Attribution 1.0\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/vegetation_ground.blend'),compress=True)
    bpy.ops.render.render(write_still=True)
    for f in sorted((ROOT/'maps').glob('*.png')):manifest.setdefault('maps',[]).append({'file':str(f.relative_to(ROOT)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    manifest['budgets']={'maxMapDimension':1024,'groundLOD0Triangles':512,'sprigLOD0Triangles':208,'maxPrimitivesPerSprig':2,'populationAdded':0,'RGBA8BaseMapsWithMipUpperBoundBytes':int((1024**2+13*512**2)*4*4/3),'mipReferenceFiles':'Manual QA/reference mip levels, not loaded by GLB. GLBs embed repeated textures for standalone inspection; deduplicate before integration.'}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('VEGETATION_GROUND_COMPLETE')

if __name__=='__main__':
    main()

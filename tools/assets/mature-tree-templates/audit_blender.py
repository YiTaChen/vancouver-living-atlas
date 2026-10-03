"""Reopen all saved originals and actually reimport all 12 GLBs; audit editable source and metric UV."""
import bpy,json,sys,importlib.util,math,platform,tempfile,shutil
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('exporter',HERE/'export.py');e=importlib.util.module_from_spec(s);s.loader.exec_module(e)

def bounds(obs):
    pts=[o.matrix_world@v.co for o in obs if o.type=='MESH' for v in o.data.vertices];p=[(v.x,v.z,-v.y) for v in pts];lo=[min(v[i] for v in p) for i in range(3)];hi=[max(v[i] for v in p) for i in range(3)];return {'min':lo,'max':hi,'size':[hi[i]-lo[i] for i in range(3)]}

def main():
    manifest=json.loads((HERE/'manifest.json').read_text());rows=[];clusters=[]
    for asset in manifest['assets']:
        for lod in asset['lods']:
            src=HERE/lod['source'];sha=e.contract.digest(src);bpy.ops.wm.open_mainfile(filepath=str(src));scene=bpy.context.scene
            assert scene['asset_id']==asset['id'] and scene['lod']==lod['level'] and scene['templateHeightM']==10
            obs=list(scene.objects);assert all(o.type=='MESH' and list(o.scale)==[1,1,1] and list(o.location)==[0,0,0] for o in obs)
            assert all(o.data.uv_layers.active and len(o.data.materials)==1 for o in obs)
            assert set(o.name for o in obs)==({'trunk','branches','foliage-core','foliage-cards'} if lod['level']<2 else {'trunk','branches','foliage-core'})
            for mat in set(m for o in obs for m in o.data.materials):e.graph_check(mat)
            tri=0
            for ob in obs:ob.data.calc_loop_triangles();tri+=len(ob.data.loop_triangles)
            assert tri==lod['triangles']
            records=json.loads(scene['bark_uv_records']);uvmax=0
            leader=records[0];trunkpoints=[Vector(p) for p in leader['pathM']]
            for branch in [r for r in records if r['id'].startswith('primary-')]:
                p=Vector(branch['pathM'][0]);attached=False
                for i,(a,b) in enumerate(zip(trunkpoints,trunkpoints[1:])):
                    t=max(0,min(1,(p-a).dot(b-a)/(b-a).length_squared));distance=(p-a.lerp(b,t)).length
                    radius=(leader['radiiM'][i]*(1-t)+leader['radiiM'][i+1]*t)
                    if distance<=radius+1e-4:attached=True
                assert attached,('detached primary branch',branch['id'])
            for name in ['trunk','branches']:
                ob=bpy.data.objects[name];rs=[r for r in records if (r['id']=='leader-trunk')==(name=='trunk')];poly=0
                for r in rs:
                    n=r['sides'];circs=r['ringPerimetersM'];length=r['arcLengthsM'];start=r['vertexRange'][0]
                    centres=[]
                    for ring in range(len(circs)):
                        vertices=[ob.data.vertices[start+ring*n+i].co for i in range(n)]
                        perimeter=sum((vertices[(i+1)%n]-vertices[i]).length for i in range(n));assert abs(perimeter-circs[ring])<1e-5
                        centres.append(sum(vertices,Vector())/n)
                    arc=[0]
                    for a,b in zip(centres,centres[1:]):arc.append(arc[-1]+(b-a).length)
                    assert max(abs(a-b) for a,b in zip(arc,length))<1e-5
                    for j in range(len(circs)-1):
                        for i in range(n):
                            expected=[(i/n*circs[j]/.8,length[j]/1.6),((i+1)/n*circs[j]/.8,length[j]/1.6),((i+1)/n*circs[j+1]/.8,length[j+1]/1.6),(i/n*circs[j+1]/.8,length[j+1]/1.6)]
                            for li,ex in zip(ob.data.polygons[poly].loop_indices,expected):
                                uv=ob.data.uv_layers.active.data[li].uv;uvmax=max(uvmax,abs(uv.x-ex[0]),abs(uv.y-ex[1]))
                            poly+=1
                assert uvmax<1e-5
            if lod['level']<2:
                alpha_objects=[o for o in obs if o.data.materials[0].name=='foliage-straight-alpha']
                if asset['variant'] in ['maple','alder'] and lod['level']==0:
                    assert {o.name for o in alpha_objects}=={'foliage-cards','foliage-core'},'broadleaf LOD0 cannot contain opaque crown surfaces'
                for ob in alpha_objects:
                    groups={g.index:[] for g in ob.vertex_groups}
                    for v in ob.data.vertices:
                        for g in v.groups:groups[g.group].append(v.co.copy())
                    for group in ob.vertex_groups:
                        ps=groups[group.index]
                        lo=[min(v[i] for v in ps) for i in range(3)];hi=[max(v[i] for v in ps) for i in range(3)];sz=[hi[i]-lo[i] for i in range(3)]
                        assert .2<=max(sz)<=.6,(asset['id'],lod['level'],group.name,sz)
                        clusters.append({'assetId':asset['id'],'lod':lod['level'],'node':ob.name,'id':group.name,'boundsM':{'min':[lo[0],lo[2],-hi[1]],'max':[hi[0],hi[2],-lo[1]],'size':[sz[0],sz[2],sz[1]]}})
            bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(HERE/lod['file']));actual=bounds(list(bpy.context.scene.objects))
            for side in ['min','max','size']:assert all(abs(actual[side][i]-lod['boundsM'][side][i])<1e-5 for i in range(3))
            assert abs(actual['min'][1])<1e-6 and abs(actual['max'][1]-10)<.02
            assert sha==e.contract.digest(src)
            rows.append({'assetId':asset['id'],'lod':lod['level'],'status':'pass','sourceTriangles':tri,'editableMeshObjects':len(obs),'sourceUnchanged':True,'maximumMetricUvError':uvmax,'reimportBoundsM':actual})
    (HERE/'qa/blender-audit.json').write_text(json.dumps({'status':'pass','blenderVersion':bpy.app.version_string,'environment':platform.platform(),'mode':'actual Blender source reopening and GLB reimport CPU','records':rows},indent=2)+'\n')
    (HERE/'qa/leaf-cluster-bounds.json').write_text(json.dumps({'units':'metres','scope':'actual saved source alpha-cluster vertex groups: three outer planes per LOD0 cluster; five inner planes for broadleaf LOD0; one folded outer card per LOD1 cluster; opaque conifer/mid/far crown volumes are separate geometry','count':len(clusters),'bounds':clusters},indent=2)+'\n')
    print('MATURE_TREE_BLENDER_AUDIT_PASS')
if __name__=='__main__':main()

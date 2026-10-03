"""CPU audit of complete tree package, standard GLB channels, role groups and alpha-aware LOD projections."""
import argparse,importlib.util,json,math,hashlib,platform
from pathlib import Path
import numpy as np
from PIL import Image
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('contract',HERE.parent/'package-contract/validate.py');c=importlib.util.module_from_spec(s);s.loader.exec_module(c)


def primitives(path):
    doc,binary=c.read_glb(path);out=[]
    def walk(index,parent):
        node=doc['nodes'][index];mat=c.matmul(parent,c.transform(node))
        if 'mesh' in node:
            for prim in doc['meshes'][node['mesh']]['primitives']:
                ps=np.array([c.point(mat,p) for p in c.accessor(doc,binary,prim['attributes']['POSITION'])]);uv=np.array(c.accessor(doc,binary,prim['attributes']['TEXCOORD_0']));idx=np.array(c.accessor(doc,binary,prim['indices'])).flatten().reshape(-1,3)
                m=doc['materials'][prim['material']];out.append((node['name'],ps,uv,idx,m))
        for k in node.get('children',[]):walk(k,mat)
    for n in doc['scenes'][doc.get('scene',0)]['nodes']:walk(n,c.IDENTITY)
    return doc,out


def raster(parts,side,alpha,size=(320,528)):
    width,height=size;canvas=np.zeros((height,width),bool)
    for name,pos,uv,indices,mat in parts:
        pp=np.stack([(pos[:,side]+3.2)/6.4*width,(10.56-pos[:,1])/10.56*height],axis=1)
        cut=mat.get('alphaMode')=='MASK'
        for face in indices:
            tri=pp[face];lo=np.maximum(np.floor(tri.min(axis=0)).astype(int),0);hi=np.minimum(np.ceil(tri.max(axis=0)).astype(int),[width-1,height-1])
            if np.any(hi<lo):continue
            xx,yy=np.meshgrid(np.arange(lo[0],hi[0]+1)+.5,np.arange(lo[1],hi[1]+1)+.5)
            a,b,d=tri;den=(b[1]-d[1])*(a[0]-d[0])+(d[0]-b[0])*(a[1]-d[1])
            if abs(den)<1e-9:continue
            wa=((b[1]-d[1])*(xx-d[0])+(d[0]-b[0])*(yy-d[1]))/den;wb=((d[1]-a[1])*(xx-d[0])+(a[0]-d[0])*(yy-d[1]))/den;wc=1-wa-wb;inside=(wa>=0)&(wb>=0)&(wc>=0)
            if cut:
                t=uv[face];u=wa*t[0,0]+wb*t[1,0]+wc*t[2,0];v=wa*t[0,1]+wb*t[1,1]+wc*t[2,1];tx=np.clip(u*alpha.shape[1]-.5,0,alpha.shape[1]-1);ty=np.clip(v*alpha.shape[0]-.5,0,alpha.shape[0]-1)
                x0=tx.astype(int);y0=ty.astype(int);x1=np.minimum(x0+1,alpha.shape[1]-1);y1=np.minimum(y0+1,alpha.shape[0]-1);fx=tx-x0;fy=ty-y0;aa=alpha[y0,x0]*(1-fx)*(1-fy)+alpha[y0,x1]*fx*(1-fy)+alpha[y1,x0]*(1-fx)*fy+alpha[y1,x1]*fx*fy;inside&=aa>=.4
            canvas[lo[1]:hi[1]+1,lo[0]:hi[0]+1]|=inside
    return canvas


def validate(root,projection=True):
    common=c.validate(root);m=json.loads((root/'manifest.json').read_text());checks=[];projections=[]
    alpha_raw=np.array(Image.open(root/'exports/textures/leaf_atlas_rgba.png').convert('RGBA'));alpha=alpha_raw[:,:,3]/255
    assert hashlib.sha256((root/'exports/textures/leaf_atlas_rgba.png').read_bytes()).hexdigest()==c.digest(root.parent/'vegetation_ground/maps/leaf_atlas_rgba.png')
    coverage=[]
    transparent=alpha_raw[:,:,3]==0;assert np.all(alpha_raw[transparent,:3].sum(axis=1)>0),'straight-alpha edge RGB extension required'
    for cell in range(4):
        crop=alpha[cell//2*512:(cell//2+1)*512,cell%2*512:(cell%2+1)*512];coverage.append({'species':m['assets'][cell]['variant'],'baseCoverageAtPoint4':float((crop>=.4).mean())})
    textures=m['textures'];assert len(textures)==4 and len(set(t['sha256'] for t in textures))==4
    candidate=0
    for t in textures:
        path=root/t['file'];assert c.digest(path)==t['sha256'];im=np.array(Image.open(path));assert im.shape[:2]==(t['height'],t['width']);candidate+=t['width']*t['height']*4*4/3
        if 'normal' in t['id']:
            n=im[:,:,:3].astype(float)/127.5-1;assert np.max(abs(np.linalg.norm(n,axis=2)-1))<.01
        if t['id'].endswith('-orm'):assert np.all(im[:,:,0]==255) and np.all(im[:,:,2]==0)
    assert candidate<=8*1024*1024
    for asset in m['assets']:
        assert asset['templateHeightM']==10 and asset['normalizationMode']=='physical-template-source-height-divided-by-template-height'
        silhouettes=[]
        for lod in asset['lods']:
            level=lod['level'];r=next(r for r in common['results'] if r['assetId']==asset['id'] and r['lod']==level);assert r['triangles']<=[8000,2000,240][level];assert r['geometryBytes']<=[1048576,262144,65536][level];assert r['embeddedImageBytes']==0
            assert abs(r['boundsM']['min'][1])<1e-6 and abs(r['boundsM']['max'][1]-10)<.02
            assert 4.6<=r['boundsM']['size'][0]<=4.9
            doc,parts=primitives(root/lod['file']);assert not doc.get('extensionsRequired'),'ordinary decoder-free GLB required';assert len(parts)==(4 if level<2 else 3)
            assert set(p[0] for p in parts)==({'trunk','branches','foliage-core','foliage-cards'} if level<2 else {'trunk','branches','foliage-core'})
            maxrad=max(np.hypot(p[:,0],p[:,2]).max() for _,p,*_ in parts);assert maxrad<=2.85
            canopymin=min(float(p[:,1].min()) for name,p,*_ in parts if name.startswith('foliage'));assert canopymin>=2.5
            for name,p,uv,idx,mat in parts:
                assert np.isfinite(uv).all()
                if name=='foliage-cards' or (name=='foliage-core' and asset['variant'] in ['maple','alder'] and level==0):
                    assert mat['alphaMode']=='MASK' and mat['alphaCutoff']==.4 and mat['doubleSided']
                    tex=doc['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']];sampler=doc['samplers'][tex['sampler']];assert sampler['wrapS']==sampler['wrapT']==33071,'atlas clamp sampler'
                    cell=m['assets'].index(asset);u0=(cell%2+.008)/2;u1=(cell%2+.992)/2;v0=(cell//2+.008)/2;v1=(cell//2+.992)/2
                    assert (uv[:,0]>=u0-1e-6).all() and (uv[:,0]<=u1+1e-6).all() and (uv[:,1]>=v0-1e-6).all() and (uv[:,1]<=v1+1e-6).all(),'species atlas UV bounds'
                    # Every individual triangle is local, separately from source cluster bounding audit.
                    sizes=p[idx].max(axis=1)-p[idx].min(axis=1);assert sizes.max()<=.6
                else:
                    assert mat.get('alphaMode','OPAQUE')=='OPAQUE'
                    if name in ['trunk','branches']:
                        for info in [mat['normalTexture'],mat['pbrMetallicRoughness']['baseColorTexture'],mat['pbrMetallicRoughness']['metallicRoughnessTexture']]:
                            tex=doc['textures'][info['index']];sampler=doc['samplers'][tex['sampler']];assert sampler.get('wrapS',10497)==sampler.get('wrapT',10497)==10497,'metric bark repeat sampler'
            checks.append({'assetId':asset['id'],'lod':level,'status':'pass','triangles':r['triangles'],'geometryBytes':r['geometryBytes'],'boundsM':r['boundsM'],'maximumCrownRadiusM':float(maxrad),'minimumCanopyHeightM':canopymin,'primitives':len(parts),'embeddedImageBytes':0,'opaqueFoliageTriangles':sum(len(idx) for name,ps,uv,idx,mat in parts if name.startswith('foliage') and mat.get('alphaMode','OPAQUE')=='OPAQUE'),'alphaFoliageTriangles':sum(len(idx) for name,ps,uv,idx,mat in parts if name.startswith('foliage') and mat.get('alphaMode')=='MASK')})
            if projection:silhouettes.append([raster(parts,side,alpha) for side in [0,2]])
        if projection:
            board=np.ones((528,320*6,3),dtype=np.uint8)*238
            for level,views in enumerate(silhouettes):
                for view,mask in enumerate(views):board[:,(view*3+level)*320:(view*3+level+1)*320][mask]=[28,52,31]
            file=root/'qa/previews'/f"{asset['variant']}-alpha-silhouettes.png";Image.fromarray(board).save(file)
            for view in range(2):
                base=silhouettes[0][view]
                for level in [1,2]:
                    mask=silhouettes[level][view];iou=float((base&mask).sum()/(base|mask).sum());area=float(mask.sum()/base.sum());assert iou>=.62 and .70<=area<=1.35,('LOD projection discontinuity',asset['id'],level,view,iou,area)
                    projections.append({'assetId':asset['id'],'lod':level,'view':['front','side'][view],'intersectionOverUnion':iou,'areaRatioToLOD0':area,'status':'pass','thresholds':{'minimumIoU':.62,'areaRatio':[.7,1.35]},'image':str(file.relative_to(root))})
    report={'status':'pass','scope':'offline CPU packaging, metric geometry, alpha/UV/channel/cost and alpha-aware orthographic silhouette audit; not WebGL acceptance','environment':{'python':platform.python_version(),'platform':platform.platform(),'projection':'320x528 CPU triangle raster, bilinear straight-alpha cutoff .4; no shader lighting'},'assets':checks,'textures':{'candidateUniqueRgba8FullMipsBytes':candidate,'limitBytes':8388608,'deltaVsProduction':'not measured; offline assets never assumed resident','embeddedImageBytes':0,'alphaCoverage':coverage,'authoredMipReference':'../vegetation_ground/alpha-coverage.json; not bound by ordinary GLB','automaticMipRisk':'Standard glTF does not carry authored coverage mips. Runtime must measure thin needles and choose approved mip upload; offline base coverage is not distant GPU acceptance.'},'lodProjections':projections}
    (root/'qa/measurements.json').write_text(json.dumps({'assets':common['results'],'candidateUniqueRgba8FullMipsBytes':candidate,'textureDownloadBytes':sum(t['bytes'] for t in textures),'allSourceBytes':sum((root/l['source']).stat().st_size for a in m['assets'] for l in a['lods'])},indent=2)+'\n')
    return report

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,default=HERE);ap.add_argument('--skip-projections',action='store_true');args=ap.parse_args();report=validate(args.root.resolve(),not args.skip_projections);(args.root/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

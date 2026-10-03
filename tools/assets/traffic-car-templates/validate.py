"""Read-only E01-specific geometry/role/datum/budget checks, plus common contract."""
import importlib.util,json,math,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');common=importlib.util.module_from_spec(sp);sp.loader.exec_module(common)
def need(test,msg):
 if not test:raise ValueError(msg)
def world_meshes(doc,binary):
 out={}
 def walk(index,parent):
  node=doc['nodes'][index];matrix=common.matmul(parent,common.transform(node))
  if 'mesh' in node:
   ps=[];tris=[]
   for pr in doc['meshes'][node['mesh']]['primitives']:
    attr=pr['attributes'];need(all(k in attr for k in ['POSITION','NORMAL','TEXCOORD_0','TANGENT']),'position/normal/UV/tangent required')
    points=common.accessor(doc,binary,attr['POSITION']);normals=common.accessor(doc,binary,attr['NORMAL']);tan=common.accessor(doc,binary,attr['TANGENT'])
    for n,t in zip(normals,tan):need(abs(sum(n[k]*t[k] for k in range(3)))<.005 and abs(abs(t[3])-1)<.005,'tangent frame')
    points=[common.point(matrix,p) for p in points];ids=[r[0] for r in common.accessor(doc,binary,pr['indices'])]
    ps+=points;tris += [[points[j] for j in ids[i:i+3]] for i in range(0,len(ids),3)]
   out[node['name']]={'points':ps,'triangles':tris,'origin':common.point(matrix,[0,0,0]),'kind':'mesh'}
  else:out[node['name']]={'points':[],'triangles':[],'origin':common.point(matrix,[0,0,0]),'kind':'anchor'}
  for child in node.get('children',[]):walk(child,matrix)
 for node in doc['scenes'][doc.get('scene',0)]['nodes']:walk(node,common.IDENTITY)
 return out

def validate(root=HERE):
 root=Path(root);m=json.loads((root/'manifest.json').read_text());common_report=common.validate(root);specs=json.loads((root/'specs.json').read_text());results=[]
 need({a['id'] for a in m['assets']}==set(specs),'two explicit variants required');need(m['textures']==[],'no texture copies')
 audit=json.loads((root/'qa/blender-audit.json').read_text());proof=json.loads((root/'qa/source-edit-preservation.json').read_text());need(audit['status']==proof['status']=='pass','source audit status');need(len(audit['results'])==6,'reopen all six sources')
 previews=json.loads((root/'qa/preview-index.json').read_text());need(len(previews['images'])==20,'20 view/LOD/light previews required')
 for a in m['assets']:
  for l in a['lods']:need(previews['inputGlbSha256'][l['file']]==l['sha256'],'stale rendered GLB')
 for p in previews['images']:
  need((root/p['file']).read_bytes().startswith(b'\x89PNG'),'preview PNG');need(common.digest(root/p['file'])==p['sha256'],'preview image hash');need((root/p['file']).stat().st_size==p['bytes'],'preview bytes')
 for a in m['assets']:
  s=specs[a['id']];base=a['boundsM'];need(a['frontAxis']=='+Z' and a['attachmentDatum']['planeY']==0,'axis/datum');need([l['level'] for l in a['lods']]==[0,1,2],'three ordered LODs');need({b['role'] for b in a['materialBindings']}=={'paint','glass','rubber'},'roles')
  for l in a['lods']:
   d,bin=common.read_glb(root/l['file']);r=common.measure_glb(root/l['file']);level=l['level'];need(r['triangles']<=[3000,600,120][level],'triangle budget');need(r['primitives']<=[11,7,3][level],'draw-candidate primitive budget');need(r['geometryBytes']<=[393216,98304,32768][level],'geometry bytes budget');need(r['embeddedImageBytes']==0 and not d.get('images'),'no texture duplication');need(set(r['materialNames'])=={'paint','glass','rubber'},'shared material roles');need(abs(r['boundsM']['min'][1])<1e-5,'wheel ground datum')
   need(all(abs(r['boundsM']['size'][i]-[s['width'],s['height'],s['length']][i])<=.02 for i in range(3)),'dimension proposal tolerance')
   for k in ('min','max','size'):need(all(abs(r['boundsM'][k][i]-base[k][i])<=.02 for i in range(3)),'LOD bounds drift')
   need((root/l['source']).stat().st_size<20*1024*1024,'source size');need((root/l['source']).read_bytes()[:4] in [b'\x28\xb5\x2f\xfd',b'\x1f\x8b\x08\x00'],'compressed native blend')
   audit_item=next(q for q in audit['results'] if q['assetId']==a['id'] and q['lod']==level);need(audit_item['sourceSha256']==l['sourceSha256'],'stale source audit')
   for role in a['materialBindings']:
    declared={(p['node'],p['primitive']) for p in role['primitiveBindingsByLod'][str(level)]};actual=set()
    for node in d['nodes']:
     if 'mesh' not in node:continue
     for pi,primitive in enumerate(d['meshes'][node['mesh']]['primitives']):
      if d['materials'][primitive['material']]['name']==role['material']:
       actual.add((node['name'],pi))
       if role['role']=='paint':need('COLOR_0' not in primitive['attributes'],'paint recolor must not multiply baked vertex tint')
       if role['role']=='glass':
        need('COLOR_0' in primitive['attributes'],'glazing/lens vertex colors required');colors=common.accessor(d,bin,primitive['attributes']['COLOR_0']);palette=[(.085,.16,.21),(.85,.93,1),(.65,.025,.013),(.12,.21,.26)]
        need(all(any(max(abs(color[i]-p[i]) for i in range(3))<1e-5 for p in palette) for color in colors),'glazing/lens color changed by batching')
       if role['role']=='rubber' and 'COLOR_0' in primitive['attributes']:
        colors=common.accessor(d,bin,primitive['attributes']['COLOR_0']);need(all(all(abs(c-1)<1e-6 for c in color) for color in colors),'wheel joining must not tint rubber')
    need(declared==actual,'primitive semantic binding mismatch')
   for node in d['nodes']:
    if not node.get('name','').startswith('wheel-'):continue
    if level<2:
     wheel_roles={d['materials'][p['material']]['name'] for p in d['meshes'][node['mesh']]['primitives']};need(wheel_roles==({'rubber','paint'} if level==0 else {'rubber'}),'wheel hubs must be painted metal, never glass')
    else:need('mesh' not in node and node.get('extras',{}).get('geometry_owner')=='trim','coarse wheel anchor owner')
   meshes=world_meshes(d,bin);need(all(not n.startswith('QA-') for n in meshes),'QA reference leak');seen=set()
   for mesh in meshes.values():
    for tri in mesh['triangles']:
     key=tuple(sorted(tuple(round(v,6) for v in p) for p in tri));need(key not in seen,'duplicate coplanar triangle');seen.add(key)
   for an in a['anchors']:
    if 'node' not in an:continue
    wheel=meshes[an['node']];need(max(abs(x-y) for x,y in zip(wheel['origin'],an['positionM']))<1e-5,'wheel anchor mismatch')
    ps=wheel['points'] if level<2 else [p for p in meshes['trim']['points'] if abs(p[0]-an['positionM'][0])<.111 and abs(p[1]-an['positionM'][1])<=an['radiusM']+.001 and abs(p[2]-an['positionM'][2])<=an['radiusM']+.001]
    need(ps and wheel['kind']==('mesh' if level<2 else 'anchor'),'LOD wheel node capability');rr=max(math.hypot(p[1]-an['positionM'][1],p[2]-an['positionM'][2]) for p in ps);need(abs(rr-an['radiusM'])<1e-5,'actual wheel radius mismatch')
   if level<2:
    body=meshes['body-shell']['points'];need(len({round(p[2],4) for p in body})>=14,'body must have shaped sections, not a box')
    for axle in [-s['wheelbase']/2,s['wheelbase']/2]:
     side=[p for p in body if abs(p[0])>s['bodyWidth']*.44 and abs(p[2]-axle)<.001];need(side and min(p[1] for p in side)>s['radius']+.03,'actual wheel arch relief')
   box=a['collision']['primitives'][0]
   for mesh in meshes.values():
    for p in mesh['points']:need(all(abs(p[k]-box['centerM'][k])<=box['sizeM'][k]/2+1e-5 for k in range(3)),'collision misses exterior')
   env=a['clearance']['turningEnvelope'];need(env['outerRadiusM']>=max(math.hypot(x-env['leftTurnCenterM'][0],z-env['leftTurnCenterM'][2]) for x in [base['min'][0],base['max'][0]] for z in [base['min'][2],base['max'][2]]),'turn sweep misses exterior')
   results.append({'assetId':a['id'],'lod':level,'status':'pass','triangles':r['triangles'],'bytes':r['bytes'],'primitives':r['primitives'],'checks':['common GLB/hashes/bounds/normals/indices','UV/tangents','source compression and reopen audit hash','dimension and shared datum','wheel centres/radii and real arch relief','unique coplanar triangles','three semantic roles/no maps','collision and static turning envelope','LOD budgets and bounds','11/7/3 semantic batching cap']})
 return {'status':'pass','scope':'offline E01 package, no WebGL acceptance','commonContract':'pass','results':results,'sourceEditProof':'pass','previewCount':20,'runtimeChecks':'not_run'}
if __name__=='__main__':
 report=validate();(HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))

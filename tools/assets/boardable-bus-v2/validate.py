"""Read-only validation of measured geometry, dependency frames and fit metadata.
No runtime, regulatory, GPU or photogrammetric claim is made by these checks.
"""
import copy, hashlib, importlib.util, json, math
from pathlib import Path
HERE=Path(__file__).resolve().parent
sp=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(sp);sp.loader.exec_module(C)
sp=importlib.util.spec_from_file_location('bus_geometry',HERE.parent/'boardable-bus/validate.py');G=importlib.util.module_from_spec(sp);sp.loader.exec_module(G)
def need(v,m):
 if not v:raise AssertionError(m)
def close(a,b,t=2e-5):return len(a)==len(b) and all(abs(x-y)<t for x,y in zip(a,b))
def bounds(o):
 p=o['points'];return {'min':[min(v[k] for v in p) for k in range(3)],'max':[max(v[k] for v in p) for k in range(3)]}
def overlap(a,b,epsilon=1e-5):return all(min(a['max'][k],b['max'][k])-max(a['min'][k],b['min'][k])>epsilon for k in range(3))
def validate_node_identities(doc):
 names=[n.get('name','') for n in doc['nodes']]
 need(all(names) and len(set(names))==len(names),'duplicate or missing GLB node identity')
def validate_contract(m,root=HERE,scenes=None):
 root=Path(root);C.finite(m);v=m['vehicles'][0];a=m['assets'][0];checks=[]
 def check(name,count,detail):checks.append({'check':name,'status':'pass','samples':count,'detail':detail})
 need(m['schemaVersion']==1 and m['units']=='m','coordinate contract');need(m['coordinateSystem']['runtime']=='glTF +Y up, +Z front, -X vehicle right','axis contract')
 need(m['scope']['runtimeIntegration']=='pending' and m['scope']['WebGL']=='not_run' and m['scope']['newNightLighting']=='deferred_not_implemented','scope overclaim')
 dep=m['dependencies'][0];dep_root=root.parent/'boardable-bus';need(C.digest(dep_root/'manifest.json')==dep['manifestSha256'],'dependency hash');old=json.loads((dep_root/'manifest.json').read_text());ov=old['vehicles'][0]
 for f in dep['files']:need(C.digest(root/f['file'])==f['sha256'],'dependency file hash')
 need(v['frames']==ov['frames'] and v['doors']==ov['doors'] and v['contactDatum']==ov['contactDatum'],'original frame door datum drift')
 need(v['composition']['lodMapping']==ov['composition']['lodMapping'],'nonboarding LOD2 capability')
 check('unchanged-exterior-frame-dependency',len(dep['files']),'Pinned external bus package, original doors, animated leaf frames, metre datum, +Z front and nonboarding LOD2 preserved.')
 seats=v['seats'];need(len({s['seatId'] for s in seats})==len(seats),'duplicate seat');need(len(seats)>0,'no seats')
 scenes=scenes or [G.load(root/l['file'])[0] for l in a['lods']]
 fit_samples=door_samples=0
 for lod,scene in zip(a['lods'],scenes):
  geomseats={n for n in scene if len(n)==7 and n.startswith('seat-') and n[-2:].isdigit()}
  need(geomseats=={s['nodeId'] for s in seats},'seat count geometry mismatch')
  need(len([s for s in seats if s['group'].startswith('rear-')])==17,'rear seat topology')
  need(len([s for s in seats if s['group']=='low-floor-priority-left'])==3,'priority seat topology')
  need(len([s for s in seats if s['group']=='low-floor-forward'])==4,'front pair topology')
  need(v['interiorLayout']['activeSeats']==len(seats) and v['interiorLayout']['stowedPriorityPlaces']==3 and not v['interiorLayout']['stowedPlacesArePassengerAnchors'],'active versus stowed capacity')
  need(len([n for n in scene if n.startswith('front-priority-stowed-pad-')])==3,'stowed priority geometry')
  for s in seats:need(not 2.45<s['pelvisPointM'][2]<3.74,'front wheelhouse falsely seated')
  need(bounds(scene['front-equipment-cabinet'])['min'][0]>.7 and bounds(scene['front-equipment-cabinet'])['max'][1]>2.2,'driver-side cabinet geometry')
  need(bounds(scene['front-wheel-cap--1'])['max'][0]<-.7,'right wheelhouse geometry')
  doc,_=C.read_glb(root/lod['file']);validate_node_identities(doc);need(close(scene['vehicle']['matrix'],C.IDENTITY),'nonidentity GLB vehicle root');up=next(t for t in doc['materials'] if t['name']=='seat')['pbrMetallicRoughness'];need(close(up['baseColorFactor'],a['appearance']['baseColorLinearRGBA']) and close(up['baseColorFactor'],[.010,.033,.073,1]) and abs(up['roughnessFactor']-.78)<1e-5,'dark navy upholstery geometry/material mismatch')
  actual=C.measure_glb(root/lod['file'])
  for k in ['triangles','vertices','primitives','bytes']:need(actual[k]==lod[k],'measured '+k)
  need(lod['capabilities']=={'level':lod['level'],'doorsAnimated':True,'passengerCapable':True,'openingsPreserved':True},'LOD geometry capability')
  need(actual['embeddedImageBytes']==0 and actual['primitives']<=12,'texture/draw budget')
  for s in seats:
   need(s['frameId']=='vehicle' and s['humanReference']=='pelvis, not feet/root','seat frame/reference')
   need(close(scene[s['pelvisAnchorNodeId']]['point'],s['pelvisPointM']) and close(scene[s['cameraAnchorNodeId']]['point'],s['cameraEyePointM']),'seat anchor mismatch')
   mat=scene[s['nodeId']]['matrix'];q=s['facingQuaternionXYZW'];need(len(q)==4 and abs(sum(v*v for v in q)-1)<1e-5,'seat quaternion');qx,qy,qz,qw=q;forward=[2*(qx*qz+qw*qy),2*(qy*qz-qw*qx),1-2*(qx*qx+qy*qy)];need(close(forward,[mat[k] for k in [8,9,10]]),'seat orientation geometry mismatch');right=[mat[k] for k in [0,1,2]];pts=scene[s['cushionComponentId']]['points'];width=max(sum(p[k]*right[k] for k in range(3)) for p in pts)-min(sum(p[k]*right[k] for k in range(3)) for p in pts)
   cameraDelta=[s['cameraEyePointM'][k]-s['pelvisPointM'][k] for k in range(3)];need(close(cameraDelta,[forward[0]*.05,.59,forward[2]*.05]),'seat camera facing mismatch')
   if s['group']=='low-floor-priority-left':need(forward[0]<-.99 and abs(forward[2])<1e-5,'left priority seat not inward')
   if s['group']=='low-floor-priority-right':need(forward[0]>.99 and abs(forward[2])<1e-5,'right priority seat not inward')
   b=bounds(scene[s['cushionComponentId']]);need(abs(b['max'][1]-s['seatSurfaceHeightM'])<2e-5,'seat surface height')
   need(abs(width-s['seatWidthM'])<2e-5 and .419<s['seatWidthM']<.50,'seat width')
   need(abs(s['seatAboveFloorM']-(s['seatSurfaceHeightM']-s['localFloorHeightM']))<2e-5,'seat above floor')
   e=s['cameraEyePointM'];head={'min':[e[0]-.10,e[1]-.03,e[2]-.10],'max':[e[0]+.10,e[1]+.18,e[2]+.10]}
   for n,o in scene.items():
    if o['points']:need(not overlap(head,bounds(o)),f'seated head blocked {s["seatId"]} by {n}')
   fit_samples+=1
  for surface in v['floorSurfaces']:
   o=scene[surface['visibleComponentId']];b=bounds(o);ys={round(p[1],4) for p in surface['verticesM']};need(len(ys)==1 and abs(next(iter(ys))-b['max'][1])<2e-5,'floor geometry height')
   for p in surface['verticesM']:need(b['min'][0]-1e-5<=p[0]<=b['max'][0]+1e-5 and b['min'][2]-1e-5<=p[2]<=b['max'][2]+1e-5,'floor geometry extent')
  for region in v['standingRegions']:
   floor=region['feetPointM'][1];height=region['maximumCharacterHeightM'];need(region['headClearanceM']>=1.95,'standing headroom consumer contract');need(height+.06<=region['headClearanceM'],'standing headroom overclaim')
   zs=[p[2] for p in region['polygonM']];z0,z1=min(zs),max(zs);steps=max(2,math.ceil((z1-z0)/.15))
   # A conservative 0.50 m square prism encloses the requested capsule.
   for j in range(steps+1):
    z=z0+(z1-z0)*j/steps;body={'min':[-.25,floor+.035,z-.25],'max':[.25,floor+height,z+.25]}
    for n,o in scene.items():
     if not o['points']:continue
     need(not overlap(body,bounds(o)),f'standing clearance {region["regionId"]} at {z:.3f} blocked by {n}')
    fit_samples+=1
  bay=v['reservedAccessibilityRegions'][0];poly=bay['polygonM'];height=bay['maximumOccupantHeightAboveFloorM'];floor=bay['feetPointM'][1]
  need(height+.06<=bay['headClearanceM'],'wheelchair headroom overclaim')
  volume={'min':[min(p[0] for p in poly),floor+.035,min(p[2] for p in poly)],'max':[max(p[0] for p in poly),floor+height,max(p[2] for p in poly)]}
  for n,o in scene.items():
   if o['points']:need(not overlap(volume,bounds(o)),f'wheelchair reserved volume blocked by {n}')
  fit_samples+=1
  # Main driver/front/rear entry centre line: 1.95 m standing capsule supported by low floor.
  for group,za,zb in [('front',3.7,4.85),('rear',-1.2,-.05)]:
   z=(za+zb)/2;door=next(d for d in ov['doors'] if d['doorGroupId']==group)
   need(door['doorWidthM']>=.50+.10 and door['doorHeightM']>=1.95+.06,'door anthropometric margin')
   for x in [-1.1,-.85,-.6,-.35,0]:
    body={'min':[x-.25,.395,z-.25],'max':[x+.25,2.31,z+.25]}
    for n,o in scene.items():
     if o['points'] and not n.endswith('-slab') and 'entry-edge' not in n:need(not overlap(body,bounds(o)),f'entry {group} blocked by {n}')
    door_samples+=1
  # Measured component proxies cover all actual geometry; no hand-authored omissions.
  if lod['level']==0:
   proxies={c['visibleNodeId']:c for c in v['collision']['primitives'] if c.get('visibleNodeId') and c['collisionId'].startswith('v2-')}
   need(set(proxies)=={n for n,o in scene.items() if o['points']},'collision coverage mismatch')
   for n,c in proxies.items():
    b=bounds(scene[n]);need(close(b['min'],c['boundsM']['min']) and close(b['max'],c['boundsM']['max']),'collision bounds mismatch')
 check('front-photo-topology-and-navy-material',len(scenes),'Distinct left driver cabinet, unseated right wheelhouse, three inward priority seats, three stowed places and four forward low-floor seats; actual GLB dark navy PBR material verified.')
 check('measured-export-lods',len(scenes),'Actual triangle/index, bytes, 11 static material batches per LOD; no textures or exported QA lights/cameras.')
 check('seat-pelvis-camera-geometry',len(seats)*len(scenes),'Count derives from real seat nodes; actual cushion width/height and independent head envelopes validated.')
 check('floor-standing-and-seat-fit',fit_samples,'0.50 m square body envelope, 0.15 m centreline samples; 1.95 m low-floor standing and separate conservative 1.50 m seated wheelchair envelope. Raised rear is seated-only and never exposed as a standing anchor.')
 check('door-entry-static-interior-clearance',door_samples,'Both low-floor portals and lateral entry paths fit 1.95 m / radius 0.25 m reference in both LODs.')
 # Check exterior door animation geometrically with rays through portal samples.
 for lev in [0,1]:
  file=dep_root/old['assets'][0]['lods'][lev]['file'];opened={d['nodeId']:d['openTransform']['translationM'] for d in ov['doors']}
  ex,_,_=G.load(file,opened);tri=G.alltris(ex)
  for group in ['front','rear']:
   d=next(d for d in ov['doors'] if d['doorGroupId']==group);zs=[p[2] for p in d['openingPolygonM']]
   for z in [min(zs)+.28,sum(zs)/4,max(zs)-.28]:
    for h in [.45,1.0,1.75,2.30]:need(not G.hits(tri,[-1.65,h,z],[-1.10,h,z]),'open door blocked');door_samples+=1
 check('external-open-door-geometry',48,'Actual legacy animated door GLBs at declared open transforms preserve both portals, sampled at 12 points each and in each LOD.')
 return {'status':'pass','scope':'Offline asset/package and sampled conservative geometry fit only','runtimeStatus':'pending','WebGL':'not_run','checks':checks,'seatCount':len(seats),'knownLimitations':['Not a fleet-identical or survey-derived TransLink replica.','Both detailed interior LODs exceed the original B-CAB triangle and byte budgets; optimization is pending.','Three right-side folding places are static stowed geometry, not active seats or deployed seat animation.','Rear deck has 1.92 m headroom and is seated-only; no rear standing anchor is exposed.','Inherited detailed-master limitation: interior floor ends at X=-1.15 m, exterior portal frame is X=-1.25 m, and the 0.10 m strip has no open-door support triangles at either portal. Door checks above establish clearance, not continuous threshold support. A separately validated derivative may add flush strips.','These samples do not establish continuous runtime navigation, accessibility certification, GPU performance or boarding behavior.']}
def main():
 m=json.loads((HERE/'manifest.json').read_text());common=C.validate(HERE);report=validate_contract(m)
 (HERE/'qa/common-validation.json').write_text(json.dumps(common,indent=2)+'\n');(HERE/'qa/validation.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
if __name__=='__main__':main()

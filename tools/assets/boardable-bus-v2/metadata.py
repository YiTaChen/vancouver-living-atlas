"""Measure delivered GLBs; retain the original vehicle/door/frame vocabulary."""
import copy, hashlib, importlib.util, json, platform, subprocess, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));from layout import *
spec=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
spec=importlib.util.spec_from_file_location('legacy_bus_validation',HERE.parent/'boardable-bus/validate.py');V=importlib.util.module_from_spec(spec);spec.loader.exec_module(V)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rect(x0,x1,z0,z1,y):return [[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]]
def bb(pts):
 lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
 return {'min':lo,'max':hi,'size':[b-a for a,b in zip(lo,hi)]}
def write():
 old=json.loads((HERE.parent/'boardable-bus/manifest.json').read_text());asset=copy.deepcopy(old['assets'][1]);vehicle=copy.deepcopy(old['vehicles'][0]);lods=[];measures=[]
 for level in [0,1]:
  p=HERE/f'exports/city-bus-12m-interior-v2.lod{level}.glb';s=HERE/f'source/city-bus-12m-interior-v2.lod{level}.blend';r=C.measure_glb(p)
  lods.append({'level':level,'file':'exports/'+p.name,'source':'source/'+s.name,'sha256':sha(p),'sourceSha256':sha(s),'sourceBytes':s.stat().st_size,**{k:r[k] for k in ['triangles','vertices','primitives','bytes','boundsM','geometryBytes','embeddedImageBytes']},'capabilities':{'level':level,'doorsAnimated':True,'passengerCapable':True,'openingsPreserved':True},'capabilityScope':'Offline geometry composed with unchanged original exterior; runtime integration remains pending.'});measures.append({'level':level,**r})
 scene,doc,_=V.load(HERE/lods[0]['file'])
 asset.update(id='city-bus-12m-interior-v2',variant='photo-informed-representative-12m-lowfloor-stepped-rear',source=lods[0]['source'],sourceSha256=lods[0]['sourceSha256'],lods=lods,boundsM=lods[0]['boundsM'],expectedDimensionsM=lods[0]['boundsM']['size'],dimensionBasis='Original game-ready approximation within existing project 12 m bus frame. Photos inform visual features, never surveyed dimensions or a fleet-identical seat count.')
 asset['materialBindings']=[{'material':n['name'],'semanticRole':n.get('extras',{}).get('semantic_role',n['name']),'sharedSurfaceId':n.get('extras',{}).get('shared_surface_id','bus-v2-'+n['name']),'primitiveSelection':{'materialName':n['name']},'maps':[]} for n in doc['materials']]
 asset['textureCost']={'geometryBytes':sum(l['geometryBytes'] for l in lods),'embeddedImageBytes':0,'glbTotalBytes':sum(l['bytes'] for l in lods),'uniqueTexelBytesWithMips':0,'note':'11 shared PBR material-role batches per LOD; no per-seat texture or photo texture.'}
 asset['clearance']={'frameId':'vehicle','floorHeightM':FLOOR,'rearFloorHeightM':REAR_FLOOR,'ceilingUndersideM':CEILING,'standingHeadroomM':2.02,'ceilingPlaneHeadroomM':CEILING-FLOOR,'rearHeadroomM':CEILING-REAR_FLOOR,'minimumMainAisleM':.58,'doorWidthM':1.15,'doorHeightM':2.10,'rearStandingAllowed':False,'note':'1.95 m standing reference is restricted to the low-floor area; rear raised deck is seated-only for the existing fixed-anchor consumer.'}
 asset['offlineChecks']={'status':'pending','evidence':['qa/validation.json','qa/blender-validation.json','qa/visual-review.json','qa/previews/index.json']};asset['runtimeChecks']={'status':'not_run','reason':'Supplement only. Not copied into public runtime, not integrated, not WebGL tested, not boarding acceptance.'}
 asset['lodPolicy']['stateRule']='Retain interior LOD0 or LOD1 and original exterior LOD0/1 for any occupant. Rear deck access requires per-character headroom validation. Never board with exterior LOD2.'
 asset['anchors']=['driver-pelvis','driver-camera','camera-aisle','standing-center','wheelchair-reference']+[f'seat-{i:02d}-{x}' for i in range(1,len(SEATS)+1) for x in ['pelvis','camera']]
 seats=[]
 for i,(x,z,y,group) in enumerate(SEATS,1):
  n=f'seat-{i:02d}';cb=bb(scene[n+'-cushion']['points']);seats.append({'seatId':n,'nodeId':n,'frameId':'vehicle','group':group,'pelvisPointM':scene[n+'-pelvis']['point'],'facingQuaternionXYZW':[0,0,0,1],'cameraEyePointM':scene[n+'-camera']['point'],'pelvisAnchorNodeId':n+'-pelvis','cameraAnchorNodeId':n+'-camera','humanReference':'pelvis, not feet/root','seatWidthM':cb['size'][0],'seatDepthM':cb['size'][2],'seatSurfaceHeightM':cb['max'][1],'localFloorHeightM':y,'seatAboveFloorM':cb['max'][1]-y,'cushionComponentId':n+'-cushion','backComponentId':n+'-back-pad'})
 floors=[]
 for name,a,b,y in FLOOR_ZONES:
  w=1.15 if name in ['low-floor','raised-rear'] else .325
  floors.append({'surfaceId':name,'frameId':'vehicle','verticesM':rect(-w,w,a,b,y),'indices':[0,2,1,0,3,2],'visibleComponentId':name+'-slab','obstaclesMustBeSubtracted':True})
 collisions=[]
 for n,o in scene.items():
  if not o['points']:continue
  role='walkable-floor' if n.endswith('-slab') and n[:-5] in [z[0] for z in FLOOR_ZONES] else ('ceiling' if n=='ceiling' else 'obstacle')
  collisions.append({'collisionId':'v2-'+n,'visibleNodeId':n,'frameId':'vehicle','type':'box','boundsM':bb(o['points']),'role':role,'basis':'AABB conservatively measured from actual exported component vertices; no fictitious solid bus hull.'})
 # Retain only dependency-owned exterior shell/door collisions, never old seats/floor.
 collisions += [copy.deepcopy(c) for c in vehicle['collision']['primitives'] if c['role'] in ['shell','animated-door-leaf'] and not c['collisionId'].startswith('liner')]
 vehicle['assetRefs']={'exterior':'boardable-bus:city-bus-12m-exterior','interior':asset['id'],'collision':None};vehicle['seats']=seats;vehicle['floorSurfaces']=floors
 vehicle['floorSegments']=[{'segmentId':name,'frameId':'vehicle','heightM':y,'raised':y>FLOOR,'stepHeightM':.16 if 'step' in name else 0,'zRangeM':[a,b]} for name,a,b,y in FLOOR_ZONES]
 vehicle['walkableFloor']={'frameId':'vehicle','surfaceRefs':[f['surfaceId'] for f in floors],'obstacleCollisionRefs':[c['collisionId'] for c in collisions if c['role']=='obstacle'],'rule':'Floor surfaces are support areas; subtract obstacles and test headroom. Do not treat full floor rectangles as unobstructed navigation polygons.'}
 vehicle['ceiling']={'frameId':'vehicle','undersideHeightM':CEILING,'minimumStandingHeadroomM':1.92,'lowFloorHeadroomM':2.24,'rearHeadroomM':1.92}
 vehicle['standingRegions']=[{'regionId':'low-floor-aisle','frameId':'vehicle','polygonM':rect(-.29,.29,-1.18,4.50,FLOOR),'feetPointM':[0,FLOOR,0],'headClearanceM':2.02,'shoulderClearanceM':.58,'characterCentreInsetM':.25,'maximumCharacterHeightM':1.95},{'regionId':'raised-rear-aisle','frameId':'vehicle','polygonM':rect(-.29,.29,-4.65,-2.02,REAR_FLOOR),'feetPointM':[0,REAR_FLOOR,-3.1],'headClearanceM':1.92,'shoulderClearanceM':.58,'characterCentreInsetM':.25,'maximumCharacterHeightM':1.80},{'regionId':'wheelchair-stroller','frameId':'vehicle','polygonM':rect(-1.02,-.42,.12,1.62,FLOOR),'feetPointM':[-.76,FLOOR,.8],'headClearanceM':1.48,'maximumOccupantHeightAboveFloorM':1.40,'use':'reserved-seated-wheelchair','reservedClearSpace':True,'note':'0.60 x 1.50 m representative seated-use bay excluding restraint and stanchions; a conservative bent-stanchion AABB limits its full-area seated envelope. Not regulatory certification.'}]
 regions=vehicle['standingRegions']
 rear=regions[1];rear.pop('maximumCharacterHeightM');rear.update(use='seated-only',standingAllowed=False,note='Not offered as a standing anchor. Free walking and ingress to rear seats require later per-character fit logic.')
 vehicle['nonStandingRegions']=[rear];vehicle['reservedAccessibilityRegions']=[regions[2]];vehicle['standingRegions']=regions[:1]
 vehicle['driver'].update(pelvisPointM=scene['driver-pelvis']['point'],cameraEyePointM=scene['driver-camera']['point'])
 vehicle['cameraAnchors']=[{'cameraId':n,'nodeId':n,'frameId':'vehicle','eyePointM':scene[n]['point'],'facingQuaternionXYZW':[0,0,0,1]} for n in ['driver-camera','camera-aisle']]
 vehicle['collision']['primitives']=collisions;vehicle['composition']['exteriorFiles']=['../boardable-bus/'+x for x in vehicle['composition']['exteriorFiles']];vehicle['composition']['interiorFiles']=[l['file'] for l in lods];vehicle['composition']['sharedMaterialRoles']=sorted({x['semanticRole'] for x in asset['materialBindings']})
 vehicle['composition']['dependencyPolicy']='Resolve exterior only through the hash-pinned dependency. Do not load old interior with this replacement. Metadata namespaces refer to the same vehicle frame.'
 vehicle['fitReference']={'standingHeightRangeM':[1.55,1.95],'standingCapsuleRadiusM':.25,'seatedEyeAbovePelvisM':.59,'rearStandingAllowed':False,'limitations':['Photographic style reference, not a surveyed replica.','Rear standing is not exposed to the current passenger adapter: 1.92 m headroom is insufficient for the 1.95 m contract.','Runtime pathfinding, step traversal, seated animation and WebGL not accepted.']}
 m={'schemaVersion':1,'packageId':'boardable-bus-v2','version':'2.0.0','baseRevision':'9efce79601deac6a0648cf8e158f3935cbb46f51','status':'offline_validation_pending','units':'m','coordinateSystem':old['coordinateSystem'],'provenance':{**old['provenance'],'authoring':'Original reconstruction by this authorized project agent. Prior project primitives and static batching reused; no downloaded mesh, photo textures, transit logos or advertisements.','referencesFile':'REFERENCES.md','dimensions':'Project frame preserved, seats and raised rear are representative modelling approximations.'},'reexportCommand':'blender -b -t 2 --python tools/assets/boardable-bus-v2/export.py -- --output /tmp/bus-v2-reexport','validationCommand':'python tools/assets/boardable-bus-v2/validate.py && python tools/assets/boardable-bus-v2/test_bus-v2.py','assets':[asset],'textures':[],'vehicles':[vehicle],'dependencies':[{'packageId':'boardable-bus','manifest':'../boardable-bus/manifest.json','manifestSha256':sha(HERE.parent/'boardable-bus/manifest.json'),'assetId':'city-bus-12m-exterior','files':[{'file':'../boardable-bus/'+l['file'],'sha256':l['sha256']} for l in old['assets'][0]['lods']]}],'scope':{'runtimeIntegration':'pending','WebGL':'not_run','newNightLighting':'deferred_not_implemented','originalBusPackageChanged':False,'recovery':'New reconstruction of missing supplement; not a byte-identical recovery.'}}
 # Base is the verified PR6 implementation commit; this supplement retains its exterior dependency.
 (HERE/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
 (HERE/'qa/measurements.json').write_text(json.dumps({'status':'measured','method':'actual transformed GLB accessors and indices','blenderVersion':'4.3.2','device':'CPU','pythonVersion':platform.python_version(),'seatCount':len(seats),'lods':measures,'combinedExteriorPlusInteriorPrimitives':[old['assets'][0]['lods'][i]['primitives']+lods[i]['primitives'] for i in range(2)],'embeddedImageBytes':0,'uniqueTextureGpuBytesWithMips':0,'runtimeMeasured':False},indent=2)+'\n')
if __name__=='__main__':write()

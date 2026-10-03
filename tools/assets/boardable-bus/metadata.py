"""Measure the actual ordinary GLBs and write the versioned transit contract."""
import hashlib,importlib.util,json,platform,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('common',HERE.parent/'package-contract/validate.py');C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
DOORS=[('front',3.7,4.85),('rear',-1.2,-.05)]
SEATS=[(x,z) for z in [-4.85,-4.05,-1.85,.50,1.30,2.10] for x in [-.83,.83] if not (x<0 and z in [.50,1.30])]
BASE='8b95f013297597845d542463d6ce635105a95c4f'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def bounds(lo,hi):return {'min':lo,'max':hi,'size':[b-a for a,b in zip(lo,hi)]}
def tx(p):return {'parentFrameId':'vehicle','translationM':p,'rotationQuaternionXYZW':[0,0,0,1],'scale':[1,1,1]}
def rect(x0,x1,z0,z1,y=.36):return [[x0,y,z0],[x1,y,z0],[x1,y,z1],[x0,y,z1]]
def record(i,polygon):return {'surfaceId':i,'frameId':'vehicle','verticesM':polygon,'indices':[0,2,1,0,3,2]}
def cap(lod):return {'level':lod,'doorsAnimated':lod<2,'passengerCapable':lod<2,'openingsPreserved':lod<2}
def write():
 measurements=[];assets=[]
 for kind,levels in [('exterior',range(3)),('interior',range(2))]:
  aid='city-bus-12m-'+kind;lods=[]
  for level in levels:
   stem=aid+'.lod'+str(level);p=HERE/'exports'/(stem+'.glb');s=HERE/'source'/(stem+'.blend');r=C.measure_glb(p);measurements.append({'assetId':aid,'level':level,**r})
   lods.append({'level':level,'file':'exports/'+p.name,'source':'source/'+s.name,'sha256':sha(p),'sourceSha256':sha(s),**{k:r[k] for k in ['triangles','vertices','primitives','bytes','boundsM']},'capabilities':cap(level),'sourceBytes':s.stat().st_size,'geometryBytes':r['geometryBytes'],'embeddedImageBytes':r['embeddedImageBytes']})
  if kind=='interior':
   for lod in lods:
    doc,raw=C.read_glb(HERE/lod['file'])
    lod['staticBatching']={'schemaVersion':1,'editableSourceObjectsRetained':True,'sourceGeometryNodesRetainedAsZeroDrawAnchors':True,'batches':[{'nodeId':n['name'],'material':doc['materials'][doc['meshes'][n['mesh']]['primitives'][0]['material']]['name'],'componentRanges':n['extras']['componentRanges']} for n in doc['nodes'] if n.get('extras',{}).get('componentRanges')]}
  roles={'paint':'automotive-paint','rubber':'rubber','glass':'transit-glass','lights':'transit-lights','floor':'transit-floor','panel':'pale-panel','seat':'transit-seat','rail':'brushed-aluminum'}
  names=sorted(set(n for rr in measurements if rr['assetId']==aid for n in rr['materialNames']))
  a={'id':aid,'taskId':'D02' if kind=='exterior' else 'D03','variant':'representative-12m-low-floor','kind':'transit-'+kind,'source':lods[0]['source'],'sourceSha256':lods[0]['sourceSha256'],'lods':lods,'boundsM':lods[0]['boundsM'],'expectedDimensionsM':[3.04,3.07,12.034] if kind=='exterior' else [2.355,2.44,11.43],'dimensionToleranceM':.02,'dimensionBasis':'Representative project proposal; no specific manufacturer measurement claim. Body nominal 12.0 x 2.5 m; full exterior includes mirrors, lamps and roof equipment.','pivot':{'frameId':'vehicle','positionM':[0,0,0],'meaning':'Tyre-contact datum at midpoint of front/rear axle centres'},'attachmentDatum':{'frameId':'vehicle','kind':'tyre-contact-plane','heightM':0},'frontAxis':'+Z','materialBindings':[{'material':n,'semanticRole':n,'sharedSurfaceId':roles[n],'primitiveSelection':{'materialName':n},'maps':[]} for n in names],'textureMode':'shared','textureCost':{'geometryBytes':sum(l['geometryBytes'] for l in lods),'embeddedImageBytes':0,'glbTotalBytes':sum(l['bytes'] for l in lods),'uniqueTexelBytesWithMips':0,'note':'Texture-free ordinary GLBs. Role IDs enable later shared material binding; no instance maps.'},'lodPolicy':{'distanceProposalM':[0,35,120] if kind=='exterior' else [0,18],'stateRule':'Keep exterior LOD0/1 and interior LOD0/1 loaded for any occupant, open door or boarding. LOD2 only closed, empty, nonboarding display.','residentRule':'Lazy-load interior for occupied or inspected buses only.','capabilities':[cap(l) for l in levels]},'clearance':{'frameId':'vehicle','floorHeightM':.36,'ceilingUndersideM':2.60,'standingHeadroomM':2.24,'minimumMainAisleM':.90,'doorWidthM':1.15,'doorHeightM':2.10},'collision':{'frameId':'vehicle','kind':'JSON primitives','vehicleRef':'city-bus-12m','note':'Door proxies must animate with leaf transform; never use a solid body AABB for occupied state.'},'anchors':['boarding-front','boarding-rear','axle-front','axle-rear'] if kind=='exterior' else ['driver-pelvis','driver-camera','camera-aisle','standing-center','wheelchair-reference']+[f'seat-{i:02d}-{t}' for i in range(1,len(SEATS)+1) for t in ['pelvis','camera']],'placementCompatibility':{'profileIds':['low-floor-bus-12m'],'scale':[1,1,1],'sourceRequirement':'Consumer-selected road service transform and surveyed stop/walk-surface alignment. No fixed world XYZ.'},'intendedConsumer':['lib/city/city-buses.ts'],'offlineChecks':{'status':'pending','evidence':['qa/validation.json','qa/blender-validation.json','qa/measurements.json','qa/previews/index.json']},'runtimeChecks':{'status':'not_run','reason':'Offline package; WebGL integration and D06 boarding are not implemented here.'}}
  assets.append(a)
 frames=[{'frameId':'vehicle','parentFrameId':None,'units':'m','upAxis':'+Y','frontAxis':'+Z','translationM':[0,0,0],'rotationQuaternionXYZW':[0,0,0,1],'scale':[1,1,1]}];doors=[];anchors=[]
 for group,a,b in DOORS:
  anchors += [{'anchorId':'boarding-'+group,'nodeId':'boarding-'+group,'frameId':'vehicle','pointM':[-1.70,.36,(a+b)/2]},{'anchorId':'doorway-'+group,'nodeId':'doorway-'+group,'frameId':'vehicle','pointM':[-1.25,.36,(a+b)/2]}]
  for sign,z in [(-1,a+(b-a)/4),(1,b-(b-a)/4)]:
   name=f'door-right-{group}-'+('a' if sign<0 else 'b');closed=tx([-1.25,.36,z]);opened=tx([-1.39,.36,z+sign*.62]);frames.append({'frameId':name,**closed})
   doors.append({'doorId':name.removeprefix('door-'),'doorGroupId':group,'nodeId':name,'frameId':'vehicle','doorFrameId':name,'side':'right','carId':'city-bus-12m','openingPolygonM':[[-1.25,.36,a],[-1.25,.36,b],[-1.25,2.46,b],[-1.25,2.46,a]],'outwardNormal':[-1,0,0],'closedTransform':closed,'openTransform':opened,'motion':{'type':'plug-then-slide','durationS':1,'keyframes':[{'timeS':0,'transform':closed},{'timeS':.25,'transform':tx([-1.39,.36,z])},{'timeS':1,'transform':opened}],'translationTravelM':.76},'animationClip':name+'-open','animationNodeId':name,'sweptBoundsM':{'frameId':'vehicle',**bounds([-1.417,.36,min(z,z+sign*.62)-.28],[-1.223,2.44,max(z,z+sign*.62)+.28])},'boardingPointM':[-1.70,.36,(a+b)/2],'doorLocalToVehicleTransform':closed,'doorWidthM':1.15,'doorHeightM':2.10,'sillHeightM':.36})
 floors=[record('main-center',rect(-.78,.78,-5.68,5.75))]
 for side in [-1,1]:
  x0,x1=(-1.15,-.78) if side<0 else (.78,1.15)
  for i,(a,b) in enumerate([(-5.68,-3.75),(-2.45,2.45),(3.75,5.75)]):floors.append(record(f'side-{side}-{i}',rect(x0,x1,a,b)))
 seats=[]
 for i,(x,z) in enumerate(SEATS,1):
  name=f'seat-{i:02d}';seats.append({'seatId':name,'nodeId':name,'frameId':'vehicle','pelvisPointM':[x,.88,z],'facingQuaternionXYZW':[0,0,0,1],'cameraEyePointM':[x,1.47,z+.025],'pelvisAnchorNodeId':name+'-pelvis','cameraAnchorNodeId':name+'-camera','humanReference':'pelvis, not feet/root','seatWidthM':.46,'seatDepthM':.44,'seatSurfaceHeightM':.81,'localFloorHeightM':.36,'seatAboveFloorM':.45})
 wheels=[]
 for z,axle in [(-3.1,'rear'),(3.1,'front')]:
  for side,label in [(-1,'right'),(1,'left')]:wheels.append({'wheelId':f'wheel-{axle}-{label}','nodeId':f'wheel-{axle}-{label}','frameId':'vehicle','axleId':axle,'centerM':[side*1.13,.49,z],'radiusM':.49,'spinAxis':[1,0,0],'steered':axle=='front'})
 collisions=[]
 def boxproxy(i,lo,hi,role='obstacle',frame='vehicle'):collisions.append({'collisionId':i,'frameId':frame,'type':'box','boundsM':bounds(lo,hi),'role':role})
 boxproxy('floor',[-1.15,.26,-5.68],[1.15,.36,5.75],'walkable-floor')
 boxproxy('ceiling',[-1.135,2.60,-5.64],[1.135,2.70,5.74],'ceiling')
 for side in [-1,1]:
  for z in [-3.1,3.1]:boxproxy('wheel-well-'+str(side)+'-'+str(z),[side*.965-.175,.36,z-.59],[side*.965+.175,1.01,z+.59])
 for seat in seats:
  x,y,z=seat['pelvisPointM'];i=seat['seatId'];boxproxy(i+'-cushion',[x-.23,.74,z-.22],[x+.23,.81,z+.22]);boxproxy(i+'-back',[x-.23,.775,z-.2375],[x+.23,1.345,z-.1725])
 boxproxy('driver-partition',[.37,.36,4.1425],[1.17,2.215,4.1975])
 for d in doors:boxproxy(d['doorId'],[-.027,0,-.28],[.027,2.08,.28],'animated-door-leaf',d['doorFrameId'])
 # Thin shell collision regions preserve both portals; glass is a collidable boundary.
 for side in [-1,1]:
  intervals=[(-5.68,5.75)] if side>0 else [(-5.68,-1.2),(-.05,3.7),(4.85,5.75)]
  for i,(a,b) in enumerate(intervals):boxproxy(f'side-wall-{side}-{i}',[side*1.215-.035,.36,a],[side*1.215+.035,2.60,b],'shell')
 boxproxy('rear-wall',[-1.25,.36,-5.80],[1.25,2.70,-5.73],'shell');boxproxy('front-wall',[-1.10,.36,5.89],[1.10,2.60,6.20],'shell')
 # Complete static-interior obstruction coverage is measured from actual transformed GLB nodes.
 from validate import load
 actual,_,_=load(HERE/'exports/city-bus-12m-interior.lod0.glb')
 covered={c['collisionId'] for c in collisions}
 for name,ob in actual.items():
  pts=ob['points']
  if not pts or name in covered:continue
  lo=[min(p[k] for p in pts) for k in range(3)];hi=[max(p[k] for p in pts) for k in range(3)]
  boxproxy(name,lo,hi,'shell' if name.startswith('liner-') else 'obstacle')
  collisions[-1]['visibleNodeId']=name
 cameras=[{'cameraId':'driver','nodeId':'driver-camera','frameId':'vehicle','eyePointM':[.77,1.51,4.9],'facingQuaternionXYZW':[0,0,0,1]},{'cameraId':'aisle','nodeId':'camera-aisle','frameId':'vehicle','eyePointM':[0,1.99,-4.8],'facingQuaternionXYZW':[0,0,0,1]}]
 for z,name in [(3.1,'front'),(-3.1,'rear')]:anchors.append({'anchorId':'axle-'+name,'nodeId':'axle-'+name,'frameId':'vehicle','pointM':[0,.49,z]})
 vehicle={'vehicleId':'city-bus-12m','profileId':'low-floor-bus-12m','frameId':'vehicle','assetRefs':{'exterior':assets[0]['id'],'interior':assets[1]['id'],'collision':None},'frames':frames,'nominalLengthM':12,'bodyBoundsM':bounds([-1.25,.26,-5.8],[1.25,2.82,6.2]),'fullBoundsM':assets[0]['boundsM'],'dimensionBasis':'Representative project modelling target, not a specific New Flyer survey or accessibility certification','contactDatum':{'frameId':'vehicle','kind':'tyre-ground-contact','pointM':[0,0,0],'normal':[0,1,0]},'legacyToVehicleRoot':{'translationM':[0,-.01,.025],'rotationQuaternionXYZW':[0,0,0,1],'scale':[1,1,1],'note':'Datum conversion only from old local contact Y=.01 and axle midpoint Z=-.025. This newly proportioned model is not a vertexwise legacy mapping. Remove old runtime ground+1.08 offset.'},'wheelbaseM':6.2,'axles':[{'axleId':name,'frameId':'vehicle','centerM':[0,.49,z]} for z,name in [(-3.1,'rear'),(3.1,'front')]],'wheels':wheels,'floorSurfaces':floors,'floorSegments':[{'segmentId':'continuous-low-floor','frameId':'vehicle','heightM':.36,'raised':False,'stepHeightM':0,'note':'Representative all-low-floor proposal; wheel-wells are explicit excluded obstacles.'}],'walkableFloor':{'frameId':'vehicle','surfaceRefs':[f['surfaceId'] for f in floors],'obstacleCollisionRefs':[c['collisionId'] for c in collisions if c['role']=='obstacle']},'ceiling':{'frameId':'vehicle','undersideHeightM':2.60,'minimumStandingHeadroomM':2.24},'doors':doors,'seats':seats,'driver':{'frameId':'vehicle','pelvisPointM':[.77,.91,4.85],'cameraEyePointM':[.77,1.51,4.9],'pelvisAnchorNodeId':'driver-pelvis','cameraAnchorNodeId':'driver-camera'},'standingRegions':[{'regionId':'main-aisle','frameId':'vehicle','polygonM':rect(-.45,.45,-5.35,3.65),'feetPointM':[0,.36,0],'headClearanceM':2.24,'shoulderClearanceM':.90,'characterCentreInsetM':.25},{'regionId':'wheelchair-stroller','frameId':'vehicle','polygonM':rect(-1.12,-.40,.15,1.70),'feetPointM':[-.76,.36,.9],'headClearanceM':2.24,'reservedClearSpace':True,'note':'0.72 x 1.55 m representative free region, not regulatory certification'}],'cameraAnchors':cameras,'anchors':anchors,'collision':{'frameId':'vehicle','mode':'primitives','primitives':collisions,'dynamicRule':'Transform each animated-door-leaf proxy by its frame keyframes; floor metadata remains vehicle-local.'},'lodCapabilities':[cap(l) for l in range(3)],'composition':{'frameId':'vehicle','exteriorFiles':[l['file'] for l in assets[0]['lods']],'interiorFiles':[l['file'] for l in assets[1]['lods']],'collisionFiles':[],'sharedTextureKey':None,'sharedMaterialRoles':sorted(set(r['semanticRole'] for a in assets for r in a['materialBindings'])),'lodMapping':[{'exterior':0,'interior':0,'boardingAllowed':True},{'exterior':1,'interior':1,'boardingAllowed':True},{'exterior':2,'interior':None,'boardingAllowed':False}]}}
 manifest={'schemaVersion':1,'packageId':'boardable-bus','version':'1.0.0','baseRevision':BASE,'status':'offline_validation_pending','units':'m','coordinateSystem':{'authoring':'Blender +Z up, -Y front','runtime':'glTF +Y up, +Z front, -X vehicle right','conversion':'Blender (x,y,z) -> glTF (x,z,-y), exporter applies once'},'provenance':{'authoring':'Original parametric editable geometry built for Vancouver Living Atlas. No downloaded meshes, photography, logos or artwork.','project':'Vancouver Living Atlas by YiTaChen','source':'https://github.com/YiTaChen/vancouver-living-atlas','license':'Vancouver Living Atlas Noncommercial Research and Attribution 1.0','dimensionReference':'docs/AI_AGENT_DEVELOPMENT_BACKLOG.md sections 6.2, 6.4, 6.6','existingConsumer':'lib/city/city-buses.ts'},'reexportCommand':'blender -b -t 2 --python tools/assets/boardable-bus/export.py -- --output /tmp/boardable-bus-reexport','validationCommand':'python tools/assets/boardable-bus/validate.py','assets':assets,'textures':[],'vehicles':[vehicle]}
 (HERE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 (HERE/'qa/measurements.json').write_text(json.dumps({'schemaVersion':1,'environment':{'blender':'4.3.2','device':'CPU','threads':2,'python':platform.python_version(),'cpuModel':next((x.split(':',1)[1].strip() for x in (Path('/proc/cpuinfo').read_text().splitlines() if Path('/proc/cpuinfo').is_file() else []) if x.startswith('model name')),'unknown')},'scope':'Actual GLB rest-pose transformed geometry; CPU costs, not GPU measurements','results':measurements,'primitiveCounts':{'closedExterior':assets[0]['lods'][0]['primitives'],'openExterior':assets[0]['lods'][0]['primitives'],'exteriorPlusInterior':assets[0]['lods'][0]['primitives']+assets[1]['lods'][0]['primitives']},'uniqueTexelBytesWithMips':0,'embeddedImageBytes':0},indent=2)+'\n')
if __name__=='__main__':write()

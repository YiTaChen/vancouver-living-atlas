"""Original, offline representative station topology. Runtime coordinates are Y-up metres."""
import json,math,hashlib,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
SNAP=json.loads((REPO/'tools/transit/city-life-sources/transit-source-snapshot.json').read_text())
METRO=json.loads((ROOT.parent/'boardable-metro/manifest.json').read_text())
CANADA=json.loads((ROOT.parent/'canada-line-stage2/manifest.json').read_text())
CITY=json.loads((ROOT/'references/city-rapid-transit-stations.json').read_text())
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def reference_digest(sid):
 p=ROOT/'references'/f'{sid}.pdf'
 if p.exists():return digest(p)
 audit=json.loads((ROOT/'qa/source-audit.json').read_text())
 return next(r['sha256'] for r in audit['references'] if r['id']==sid+'-official-map')
def dump(p,d): (ROOT/p).write_text(json.dumps(d,indent=2)+'\n')
def transform(p,o,yaw):
 a=math.radians(yaw); x,y,z=p
 return [round(o[0]+x*math.cos(a)+z*math.sin(a),6),round(o[1]+y,6),round(o[2]-x*math.sin(a)+z*math.cos(a),6)]
def rect(x,y,z,w,l):return [[x-w/2,y,z-l/2],[x-w/2,y,z+l/2],[x+w/2,y,z+l/2],[x+w/2,y,z-l/2]]
COLORS={'concrete':(.50,.53,.55,1),'floor':(.69,.70,.66,1),'steel':(.18,.23,.27,1),'yellow':(.93,.66,.05,1),'expo':(.06,.30,.55,1),'canada':(.04,.60,.66,1),'brick':(.48,.22,.12,1),'glass':(.27,.49,.55,1),'wall':(.83,.83,.76,1),'white':(.93,.93,.88,1),'wood':(.42,.27,.12,1)}
class Station:
 def __init__(self,sid,kind,cityname,yaw):
  src=next(s for s in SNAP['stationEntities'] if s['stationId']==sid); records=[r for r in CITY['results'] if r['station']==cityname];geo=records[0]['geom']['geometry']['coordinates'];mx=111320*math.cos(math.radians(49.286));wx=(geo[0]+123.128)*mx;wz=-(geo[1]-49.286)*111320
  self.d={'stationId':sid,'name':src['name'],'layoutKind':kind,'frameId':sid,'units':'m','assetRef':sid,'sourceParentStationId':src['sourceParentStationId'],'geographicAnchor':{'provider':'City of Vancouver rapid-transit-stations','coordinatesLonLat':geo,'allMatchingCityPointsLonLat':[r['geom']['geometry']['coordinates'] for r in records],'gtfsParentLonLat':src['sourceAnchorLonLat'],'meaning':'station selection/initial anchor only, not a surveyed entrance/platform centre','cityPointMinusGtfsDistanceM':round(math.hypot((geo[0]-src['sourceAnchorLonLat'][0])*mx,(geo[1]-src['sourceAnchorLonLat'][1])*111320),3)},'localToWorld':{'frameId':sid,'parentFrameId':'atlas-world','translationM':[round(wx,6),0,round(wz,6)],'rotationQuaternionXYZW':[0,math.sin(math.radians(yaw)/2),0,math.cos(math.radians(yaw)/2)],'scale':[1,1,1],'horizontalProjection':'lib/city/geo.ts ORIGIN [-123.128,49.286], MX=111320*cos(49.286deg), world +Z south','headingBasis':'representative map-aligned heading, not surveyed track tangent','verticalDatum':'local street=0; world Y=0 placeholder MUST be replaced after terrain/track survey','worldPlacementReady':False},'provenance':{'mapUrl':src['stationMapUrl'],'mapSha256':reference_digest(sid),'actualMapPixelsInspected':True,'mapPage':1,'dimensionStatus':'representative engineering layout; no interior measured plan available','depthStatus':'unsurveyed local offsets; source-backed broad topology only'},'levels':[],'floorSurfaces':[],'entrances':[],'platforms':[],'connections':[],'trackExclusionVolumes':[],'obstacles':[],'instances':[],'anchors':[],'transferRoutes':[],'runtimeChecks':{'worldPlacement':'not_run','terrainAttachment':'not_run','walkAndElevatorRuntime':'not_run','doorBoardingAndMovingCollision':'not_run','webglDrawCallsAndLifecycle':'not_run','readyForBoarding':False}}
  self.parts=[]; self.origin=[0,0,0];self.yaw=0
 def part(self,name,p,size,mat='concrete',yaw=0,role='static'):
  self.parts.append({'id':name,'centerM':transform(p,self.origin,self.yaw),'sizeM':size,'yawDegrees':yaw+self.yaw,'material':mat,'role':role})
 def surface(self,name,x,y,z,w,l,level,kind='walk',mat='floor'):
  vs=[transform(p,self.origin,self.yaw) for p in rect(x,y,z,w,l)];sf={'surfaceId':name,'frameId':self.d['stationId'],'levelId':level,'verticesM':vs,'indices':[0,1,2,0,2,3],'walkable':True,'kind':kind,'geometryNodeId':'floor-'+name,'headClearanceM':2.5}
  self.d['floorSurfaces'].append(sf);self.part('floor-'+name,[x,y-.15,z],[w,.3,l],mat,role='floor');return name
 def anchor(self,name,p,kind):
  q=transform(p,self.origin,self.yaw);self.d['anchors'].append({'id':name,'nodeId':'anchor-'+name,'frameId':self.d['stationId'],'pointM':q,'kind':kind});return q
 def level(self,name,y,label):
  if not any(l['levelId']==name for l in self.d['levels']): self.d['levels'].append({'levelId':name,'label':label,'floorHeightM':self.origin[1]+y,'heightBasis':'unsurveyed model offset'})
 def edge(self,a,b,kind,p,q,**kw):
  self.d['connections'].append({'connectionId':f'{a}--{b}-{kind}','fromSurfaceId':a,'toSurfaceId':b,'type':kind,'frameId':self.d['stationId'],'startPointM':transform(p,self.origin,self.yaw),'endPointM':transform(q,self.origin,self.yaw),'bidirectional':True,'runtimeEnabled':False,**kw})
 def platform(self,pid,line,y,length,width=6,origin=None,yaw=0,stack=False,access_end=-1,street=0,entrance_label=None):
  self.origin=origin or [0,0,0];self.yaw=yaw;level=pid+'-level';self.level(level,y,line.upper()+' platform');pf=self.surface(pid,0,y,0,width,length,level,'platform');canada=line=='canada';floor=1.1 if canada else .95;half=1.46 if canada else 1.28;gap=.24 if canada else .22
  # Single-sided stacked tunnel platforms have one track; other platforms are islands.
  sides=[1] if stack else [-1,1];plats=[]
  for sign in sides:
   tx=sign*(width/2+half+gap);direction=('northbound' if sign<0 else 'southbound') if canada else ('westbound' if sign<0 else 'eastbound')
   if stack:direction='westbound' if access_end<0 else 'eastbound'
   track=pid+'-'+direction; rail=y-floor
   for rx in [-.7175,.7175]:self.part('rail-'+track+str(rx),[tx+rx,rail-.035,0],[.07,.07,length+12],'steel',role='rail')
   self.part('trackbed-'+track,[tx,rail-.27,0],[2.9,.4,length+12],'concrete',role='trackbed')
   self.part('tactile-'+track,[sign*(width/2-.22),y+.012,0],[.38,.024,length],'yellow')
   for zz in range(-int(length/2),int(length/2),3):self.part('sleeper-'+track+str(zz),[tx,rail-.1,zz],[2.5,.14,.2],'steel',role='rail')
   polygon=[transform(p,self.origin,self.yaw) for p in rect(tx,rail-.3,0,2*half+gap,length+12)]
   self.d['trackExclusionVolumes'].append({'id':track+'-no-walk','frameId':self.d['stationId'],'footprintM':polygon,'minY':self.origin[1]+rail-.5,'maxY':self.origin[1]+y+3,'rule':'never walk; board only through validated door corridor when stationary'})
   stop=[tx,rail,0];stopnode=self.anchor(track+'-stop',stop,'vehicle-root-stop');carcenters=[10.5,-10.5] if canada else [c['translationM'][2] for c in METRO['composition']['cars']];doorzs=[-6.4,0,6.4] if canada else sorted(set(round((d['openingPolygonM'][0][2]+d['openingPolygonM'][1][2])/2,3) for d in METRO['vehicles'][0]['doors']))
   aligned=[]
   for ci,cz in enumerate(carcenters):
    for di,dz in enumerate(doorzs):
     # stop pose uses +Z vehicle orientation for both tracks; direction signs are explicit.
     car_yaw_pi=canada and ci==1;z=cz+(-dz if car_yaw_pi else dz);sid=track+f'-car{ci+1}-door{di+1}';sill=[tx-sign*half,y,z];edge=[sign*width/2,y,z];point=self.anchor(sid,edge,'platform-door');aligned.append({'id':sid,'carIndex':ci,'carLocalDoorZ':dz,'consistLocalSillPointM':[-sign*half,floor,z],'carLocalSillPointM':[(sign if car_yaw_pi else -sign)*half,floor,dz],'carLocalSide':'left' if (sign>0 if car_yaw_pi else sign<0) else 'right','carPoseInConsist':{'translationM':[0,0,cz],'rotationQuaternionXYZW':[0,1,0,0] if car_yaw_pi else [0,0,0,1]},'stationSillPointM':transform(sill,self.origin,self.yaw),'platformEdgePointM':point,'stationWaitingPointM':transform([sign*(width/2-1),y,z],self.origin,self.yaw),'horizontalThresholdGapM':gap,'verticalDifferenceM':0,'openingWidthM':1.5 if canada else 1.4,'boardingSide':'right' if sign>0 else 'left','thresholdProvision':'no bridge installed; D06 must validate gap/accessibility before enabling boarding'})
   self.d['platforms'].append({'platformId':track,'stationLineId':self.d['stationId']+':'+line,'sourceServiceStopId':self.d['stationId']+':'+line+':'+direction,'lineId':line,'direction':direction,'surfaceId':pf,'frameId':self.d['stationId'],'profileRef':{'packageId':'canada-line-stage2' if canada else 'boardable-metro','profileId':'canada-line-2car-representative-v1' if canada else METRO['composition']['profileId'],'status':'representative'},'lengthM':length,'widthM':width,'floorHeightM':y+self.origin[1],'railHeightM':rail+self.origin[1],'floorAboveRailM':floor,'requiredConsistLengthM':CANADA['composition']['actualLengthM'] if canada else METRO['composition']['actualLengthM'],'stoppingToleranceEachEndM':1,'stopPosition':{'translationM':stopnode,'rotationQuaternionXYZW':[0,math.sin(math.radians(yaw)/2),0,math.cos(math.radians(yaw)/2)],'approachDirection':transform([0,0,1],[0,0,0],yaw),'motionDirectionSign':1 if direction in ['eastbound','northbound'] else -1,'semanticNote':'bidirectional train uses fixed root orientation; motion sign must not relabel door sides'},'doorAlignmentPoints':aligned,'waitingRegions':[{'frameId':self.d['stationId'],'polygonM':[transform(p,self.origin,self.yaw) for p in rect(sign*(width/2-1.2),y,0,1.5,length-4)]}],'trackExclusionId':track+'-no-walk'})
  # Open centre corridor, posts and benches confined to inner stripe, clear edge aisle >=1.5 m.
  for i,z in enumerate(range(-int(length/2)+7,int(length/2)-6,12)):
   self.part(pid+'-column-'+str(i),[0,y+1.7,z],[.25,3.4,.25],'steel')
   self.part(pid+'-bench-'+str(i),[0,y+.46,z+2],[.7,.15,1.7],'wood')
  self.part(pid+'-roof',[0,y+3.65,0],[width+7,.2,length+1],'steel',role='removable-roof')
  if stack:self.part(pid+'-backwall',[-width/2-.15,y+1.7,0],[.3,3.4,length],'wall',role='wall')
  # Distinct access bank at chosen end, entirely between track corridors.
  sx=-width/2+1.3;end=access_end;z0=end*(length/2+2);lower=self.surface(pid+'-landing',0,y,z0,width,4,level,'landing');self.edge(pf,lower,'walk',[0,y,end*length/2],[0,y,end*length/2])
  total=abs(street-y);n=math.ceil(total/3.8);dz=total*1.9;run=dz/n;dy=(street-y)/n;cur=lower;cy=y;cz=z0+end*2
  for i in range(n):
   ny=cy+dy;nz=cz+end*run;lid=pid+f'-landing-{i+1}';lv=pid+f'-access-{i+1}';self.level(lv,ny,'Access landing');nxt=self.surface(lid,0,ny,nz+end*1.5,width,3,lv,'landing');steps=math.ceil(abs(dy)/.17)
   for k in range(steps):
    sy=cy+dy*(k+1)/steps;sz=cz+end*run*(k+.5)/steps;self.part(pid+f'-stair-{i}-{k}',[sx,sy-.09,sz],[2.4,.18,run/steps],'concrete',role='stair-tread')
   self.edge(cur,nxt,'stairs',[sx,cy,cz],[sx,ny,nz],clearWidthM=2.4,riserCount=steps,riseM=abs(dy)/steps,treadRunM=run/steps,geometryPrefix=pid+f'-stair-{i}-',stepDirection='up' if dy>0 else 'down');cy=ny;cz=nz+end*3;cur=nxt
  # Elevator beside (not in) access landing, plus separated upper side passage.
  ex=width/2-.95;shaftz=z0;ely=min(y,street);eh=abs(street-y)
  for dx in [-1,1]:
   for zz in [-1,1]:self.part(pid+f'-lift-post-{dx}-{zz}',[ex+dx*.8,ely+eh/2+1.25,shaftz+zz*.8],[.13,eh+2.5,.13],'steel',role='lift-shaft')
  lowbranch=self.surface(pid+'-lift-lower',0,y,z0,width,3,level,'lift-landing');self.edge(lower,lowbranch,'walk',[0,y,z0],[0,y,z0])
  upperbranch=self.surface(pid+'-lift-upper',0,street,z0,width,3,pid+f'-access-{n}','lift-landing');upperz=cz-end*1.5
  side=self.surface(pid+'-lift-side',ex,street,(z0+upperz)/2,1.8,abs(upperz-z0)+3,pid+f'-access-{n}','corridor');topbranch=self.surface(pid+'-lift-top',0,street,upperz,width,3,pid+f'-access-{n}','corridor')
  self.edge(lowbranch,upperbranch,'elevator',[ex,y,z0],[ex,street,z0],clearCabinSizeM=[1.6,2.2,1.6],doorWidthM=1.0,geometryPrefix=pid+'-lift-',dynamicRuntime='not_implemented; shaft skeleton and stops only')
  self.edge(upperbranch,side,'walk',[ex,street,z0],[ex,street,z0]);self.edge(side,topbranch,'walk',[ex,street,upperz],[ex,street,upperz]);self.edge(topbranch,cur,'walk',[0,street,upperz],[0,street,upperz])
  for j in range(1,n):
   my=y+dy*j;mz=z0+end*(2+run*j+3*(j-1)+1.5);ml=pid+f'-access-{j}';ms=self.surface(pid+f'-lift-mid-{j}',0,my,z0,width,3,ml,'lift-landing');mc=self.surface(pid+f'-lift-corridor-{j}',ex,my,(z0+mz)/2,1.8,abs(mz-z0)+3,ml,'corridor');self.edge(lowbranch,ms,'elevator',[ex,y,z0],[ex,my,z0],clearCabinSizeM=[1.6,2.2,1.6],doorWidthM=1.0,geometryPrefix=pid+'-lift-',dynamicRuntime='not_implemented; intermediate stop');self.edge(ms,mc,'walk',[ex,my,z0],[ex,my,z0]);self.edge(mc,pid+f'-landing-{j}','walk',[ex,my,mz],[ex,my,mz])
  entrance=self.anchor(pid+'-entrance',[0,street,upperz],'entrance-exit');self.d['entrances'].append({'entranceId':pid+'-entry','label':entrance_label or 'Representative source-map entrance connection','frameId':self.d['stationId'],'pointM':entrance,'surfaceId':cur,'entranceAndExit':True,'externalWalkSurfaceId':None,'streetAttachmentStatus':'pending terrain and sidewalk verification'})
  for xx in [-3.4,3.4]:self.part(pid+'-entry-post'+str(xx),[xx,street+1.7,upperz],[.22,3.4,5],'brick' if self.d['stationId']=='yaletown-roundhouse' else 'steel')
  self.part(pid+'-entry-canopy',[0,street+3.5,upperz],[7.3,.2,5.6],'wood' if self.d['stationId']=='yaletown-roundhouse' else 'glass',role='removable-roof')
  out={'floor':cur,'point':entrance,'local':[0,street,upperz],'platformFloor':pf,'platformPoint':transform([0,y,0],self.origin,self.yaw)};self.origin=[0,0,0];self.yaw=0;return out
 def bridge(self,name,a,b,y):
  # Axis-aligned orthogonal bridge between station-local entrance points above tracks.
  x1,_,z1=a['point'];x2,_,z2=b['point'];s1=self.surface(name+'-eastwest',(x1+x2)/2,y,z1,abs(x2-x1)+4,4,name,'transfer');s2=self.surface(name+'-northsouth',x2,y,(z1+z2)/2,4,abs(z2-z1)+4,name,'transfer');self.level(name,y,'Representative connecting concourse');self.edge(a['floor'],s1,'walk',[x1,y,z1],[x1,y,z1]);self.edge(s1,s2,'walk',[x2,y,z1],[x2,y,z1]);self.edge(s2,b['floor'],'walk',[x2,y,z2],[x2,y,z2]);return [s1,s2]
 def finish(self):
  for e in self.d['connections']:
   if e['type']=='stairs':
    e['treadSurfaces']=[{'partId':p['id'],'frameId':self.d['stationId'],'verticesM':[transform(v,p['centerM'],p['yawDegrees']) for v in rect(0,p['sizeM'][1]/2,0,p['sizeM'][0],p['sizeM'][2])],'indices':[0,1,2,0,2,3]} for p in self.parts if p['id'].startswith(e['geometryPrefix'])]
  for p in self.parts:
   if any(k in p['id'] for k in ['-bench-','-column-','-entry-post']):self.d['obstacles'].append({'id':p['id'],'type':'oriented-box','frameId':self.d['stationId'],'centerM':p['centerM'],'sizeM':p['sizeM'],'yawDegrees':p['yawDegrees'],'collisionRole':'static-obstacle'})
  self.d['thresholdBridges']=[]
  for p in self.d['platforms']:
   can=p['lineId']=='canada';width=.24 if can else .22;mid=1.60 if can else 1.41;store=1.67 if can else 1.47;heading=p['stopPosition']['rotationQuaternionXYZW'];yaw=math.degrees(2*math.atan2(heading[1],heading[3]));stop=p['stopPosition']['translationM'];floor=p['floorAboveRailM']
   for d in p['doorAlignmentPoints']:
    side=1 if d['consistLocalSillPointM'][0]>0 else -1;z=d['consistLocalSillPointM'][2];deployed=transform([side*mid,floor+.015,z],stop,yaw);stored=transform([side*(store-.0075),floor-.02-width/2,z],stop,yaw);h=math.radians(yaw)/2;q=side*math.pi/4;storedq=[math.sin(h)*math.sin(q),math.sin(h)*math.cos(q),math.cos(h)*math.sin(q),math.cos(h)*math.cos(q)];aid='threshold-bridge-canada' if can else 'threshold-bridge-expo';iid='bridge-'+d['id'];sf=[transform([xx,yy,zz],deployed,yaw) for xx,yy in [(-width/2,-.015),(-width/2+.02,0),(width/2-.02,0),(width/2,-.015)] for zz in [-.65,.65]]
    bridge={'instanceId':iid,'nodeId':iid,'assetRef':aid,'frameId':self.d['stationId'],'pairedDoorAlignmentId':d['id'],'storedTransform':{'translationM':stored,'rotationQuaternionXYZW':storedq,'scale':[1,1,1]},'deployedTransform':{'translationM':deployed,'rotationQuaternionXYZW':heading,'scale':[1,1,1]},'defaultPose':'stored','deployedFloor':{'surfaceId':iid+'-conditional-floor','verticesM':sf,'indices':[0,1,3,0,3,2,2,3,5,2,5,4,4,5,7,4,7,6],'walkableOnlyWhen':'stopped-correct-consist AND both paired leaves fully-open AND bridge deployed AND dynamic collision accepted','enabled':False},'clearWidthAlongTrainM':1.3,'thicknessM':.015,'maximumRiseM':.015,'deployedContact':'bottom rests on sill/platform; 15 mm raised top, no hidden slab penetration','vehicleBearingOverlapM':.02 if can else .025,'stationBearingOverlapM':.02,'vehicleFloorOuterXM':1.5 if can else 1.325,'storedBelowDoorSillClearanceM':.02,'mechanism':'original representative removable lift-fold plate, not surveyed station equipment; no automatic hardware claim','sequence':[{'phase':'raise vertical in clear gap','translationM':transform([side*(store-.0075),floor+.18,z],stop,yaw),'rotationQuaternionXYZW':storedq},{'phase':'rotate above platform and sill','translationM':transform([side*(store-.0075),floor+.18,z],stop,yaw),'rotationQuaternionXYZW':heading},{'phase':'translate over bearing ends','translationM':transform([side*mid,floor+.18,z],stop,yaw),'rotationQuaternionXYZW':heading},{'phase':'lower bottom to bearing surface; top is 15 mm above floor','translationM':deployed,'rotationQuaternionXYZW':heading}],'deploymentRequires':['correct source profile and stop pose','train stationary','both paired leaves fully open','boarding corridor clear','runtime swept-volume validation before animation'],'retractionRequires':['boarding corridor unoccupied','retract before door movement or train motion'],'runtimeEnabled':False}
    self.d['thresholdBridges'].append(bridge);d['thresholdBridgeId']=iid;d['thresholdProvision']='explicit 15mm-rise representative bridge; measured stored/deployed geometry; runtime controlled deployment pending';self.parts.append({'id':iid,'centerM':stored,'sizeM':[width,.015,1.3],'rotationQuaternionXYZW':storedq,'yawDegrees':yaw,'material':'steel','role':'threshold','assetRef':aid,'originAtTop':True})
  self.d['moduleReferences']=[{'packageId':'transit-station-spaces','manifest':'../transit-station-spaces/manifest.json','usage':'D01 guidance and edge conventions; no copied meshes; threshold module deliberately not auto-deployed'},{'packageId':'skytrain-stations-stage2','materialRoles':list(COLORS),'usage':'original platform slabs, stair treads, lift-shaft skeleton, canopy and rails defined by geometryParts'}]
  self.d['geometryParts']=self.parts;return self.d

def build_layout():
 out=[]
 s=Station('waterfront','two-line-independent-perpendicular-platforms','Waterfront',-55)
 a=s.platform('waterfront-expo','expo',-7,74,origin=[-24,0,0],entrance_label='Cordova historic station lobby connection')
 b=s.platform('waterfront-canada','canada',-13,44,origin=[32,0,8],yaw=90,entrance_label='Canada Line passage to lobby; Granville entrance represented')
 bridge=s.bridge('waterfront-lobby-transfer',a,b,0);s.d['transferRoutes'].append({'id':'expo-to-canada-via-lobby','fromStationLineId':'waterfront:expo','toStationLineId':'waterfront:canada','viaSurfaceIds':[a['platformFloor'],a['floor']]+bridge+[b['floor'],b['platformFloor']],'connectionGraphAuthoritative':True,'source':'TransLink Buzzer 2008-09-12 p2','status':'representative connected route, not surveyed passage; no SeaBus corridor reused'});out.append(s.finish())
 s=Station('burrard','stacked-underground','Burrard',-135);a=s.platform('burrard-upper','expo',-9,74,width=4.5,stack=True,access_end=-1,entrance_label='Burrard/Dunsmuir entry');b=s.platform('burrard-lower','expo',-15,74,width=4.5,stack=True,access_end=1,entrance_label='Shared representative surface access');s.bridge('burrard-street-plaza',a,b,0);out.append(s.finish())
 s=Station('granville','deep-stacked-underground-multiflight','Granville',-135);a=s.platform('granville-upper','expo',-20,74,width=4.5,stack=True,access_end=-1,entrance_label='Dunsmuir accessible entrance');b=s.platform('granville-lower','expo',-26,74,width=4.5,stack=True,access_end=1,entrance_label='Granville/Seymour approach');s.bridge('granville-surface-link',a,b,0);s.d['provenance']['noSamePlatformCanadaTransfer']=True;out.append(s.finish())
 s=Station('stadium-chinatown','upper-beatty-lower-pacific','Stadium - Chinatown',-135);a=s.platform('stadium-expo','expo',-5,74,width=7,street=0,entrance_label='Upper Beatty Street exit');s.level('pacific-lower',-9,'Lower Pacific Boulevard entry');lower=s.surface('pacific-entry',0,-9,48,7,4,'pacific-lower','entrance');s.d['entrances'].append({'entranceId':'pacific-lower','label':'Lower Pacific Boulevard exit','frameId':s.d['stationId'],'pointM':s.anchor('pacific-entry',[0,-9,48],'entrance-exit'),'surfaceId':lower,'entranceAndExit':True,'externalWalkSurfaceId':None,'streetAttachmentStatus':'pending sidewalk height attachment'});top=s.surface('pacific-upper-landing',0,-5,38,7,2,'stadium-expo-level','landing');s.edge('stadium-expo',top,'walk',[0,-5,37],[0,-5,37]);liftcorr=s.surface('pacific-lift-upper',2.5,-5,43,1.6,12,'stadium-expo-level','lift-landing');s.edge(top,liftcorr,'walk',[2.5,-5,38],[2.5,-5,38]);s.edge(lower,liftcorr,'elevator',[2.5,-9,48],[2.5,-5,48],clearCabinSizeM=[1.6,2.2,1.6],doorWidthM=1.0,geometryPrefix='pacific-lift-',dynamicRuntime='not_implemented');
 for xx in [-1,1]:s.part('pacific-lift-'+str(xx),[2.5+xx*.8,-5.8,48],[.15,6.4,.15],'steel',role='lift-shaft')
 for i in range(24):s.part('pacific-stair-'+str(i),[-1,-9+4*(i+1)/24-.08,46-7*(i+.5)/24],[2,.16,7/24],'concrete',role='stair-tread')
 s.edge(lower,top,'stairs',[-1,-9,46],[-1,-5,39],clearWidthM=2,riserCount=24,riseM=4/24,treadRunM=7/24,geometryPrefix='pacific-stair-');out.append(s.finish())
 s=Station('main-street-science-world','elevated-island-twin-stationhouses','Main Street - Science World',-105);a=s.platform('main-expo','expo',8,74,width=7,street=0,entrance_label='West stationhouse / Main Street');# mirrored independent east vertical access, using second access-only route later
 # Elevated columns, street crossing remains below rails; east stairway connects at far platform end.
 for zz in [-28,-12,12,28]:s.part('main-viaduct-pier-'+str(zz),[0,3.6,zz],[1.5,7.2,1.5],'concrete')
 ground=s.surface('main-east-entry',0,0,59,8,8,'main-street','entrance');s.level('main-street',0,'Street');top=s.surface('main-east-top',0,8,39,7,4,'main-expo-level','landing');s.edge('main-expo',top,'walk',[0,8,37],[0,8,37]);s.edge(ground,top,'stairs',[0,0,55],[0,8,41],clearWidthM=2.4,riserCount=48,riseM=8/48,treadRunM=14/48,geometryPrefix='main-east-stair-')
 for i in range(48):s.part('main-east-stair-'+str(i),[0,8*(i+1)/48-.08,55-14*(i+.5)/48],[2.4,.16,14/48],'concrete',role='stair-tread')
 # Elevator landings link via a high-level side corridor outside the staircase.
 ug=s.surface('main-east-lift-upper',2.5,8,50,1.6,24,'main-expo-level','lift-landing');s.edge(top,ug,'walk',[2.5,8,39],[2.5,8,39]);s.edge(ground,ug,'elevator',[2.5,0,59],[2.5,8,59],clearCabinSizeM=[1.6,2.2,1.6],doorWidthM=1,geometryPrefix='main-east-lift-',dynamicRuntime='not_implemented')
 for xx in [1.7,3.3]:s.part('main-east-lift-'+str(xx),[xx,5,59],[.15,10,.15],'steel',role='lift-shaft')
 s.d['entrances'].append({'entranceId':'main-east','label':'East stationhouse / Terminal Avenue','frameId':s.d['stationId'],'pointM':s.anchor('main-east',[0,0,59],'entrance-exit'),'surfaceId':ground,'entranceAndExit':True,'externalWalkSurfaceId':None,'streetAttachmentStatus':'pending sidewalk attachment'});out.append(s.finish())
 s=Station('vancouver-city-centre','underground-island-mall-spur','Vancouver City Center',-45);a=s.platform('vcc-canada','canada',-9,44,width=7,entrance_label='Granville Street at Georgia street entrance');s.level('mall-interface',-3,'Limited mall interface');mallz=next(sf for sf in s.d['floorSurfaces'] if sf['surfaceId']=='vcc-canada-landing-2')['verticesM'][0][2]+1.5;mall=s.surface('vcc-mall-spur',15,-3,mallz,30,4,'mall-interface','mall-interface');s.part('vcc-mall-cap',[30,-1.7,mallz],[.3,2.6,4],'wall');s.d['obstacles'].append({'id':'vcc-mall-cap','reason':'beyond stub excluded; no Granville same-platform link','boundsM':{'min':[29.85,-3,mallz-2],'max':[30.15,-.4,mallz+2]}});s.edge('vcc-canada-landing-2',mall,'walk',[0,-3,mallz],[0,-3,mallz]);s.d['mallInterface']={'surfaceId':mall,'connectionStatus':'internal access connected; capped external mall continuation excluded','noGranvilleSamePlatformConnection':True};out.append(s.finish())
 s=Station('yaletown-roundhouse','deep-underground-brick-pavilion','Yaletown - Roundhouse',-135);a=s.platform('yaletown-canada','canada',-15,44,width=6,entrance_label='Davie/Mainland pavilion');s.d['provenance']['depthBasis']='TransLink Buzzer 2008-09-12 p2 reports about 15 m; model uses -15 m local floor, not survey elevation';
 for xx in [-4.5,4.5]:s.part('yaletown-brick-return'+str(xx),[xx,1.7,a['point'][2]],[.6,3.4,7],'brick')
 out.append(s.finish())
 return {'schemaVersion':1,'packageId':'skytrain-stations-stage2','units':'m','coordinateSystem':'glTF Y-up; local station frames, +Z representative track axis','status':'offline_representative_supplement','rideReady':False,'dependencies':[{'packageId':m['packageId'],'manifest':'../'+m['packageId']+'/manifest.json','sourceSha256AtBuild':digest(ROOT.parent/m['packageId']/'manifest.json'),'profileId':m['composition']['profileId'],'actualConsistLengthM':m['composition']['actualLengthM']} for m in [METRO,CANADA]],'sourceSnapshotRef':'../../transit/city-life-sources/transit-source-snapshot.json','sourceSnapshotSha256':digest(REPO/'tools/transit/city-life-sources/transit-source-snapshot.json'),'excluded':['night lighting','runtime app integration','live service claims','survey certification','SeaBus','WCE','Olympic Village','VCC-Clark'],'stations':out}
if __name__=='__main__':dump('station-layout.json',build_layout());print('wrote seven station layouts')

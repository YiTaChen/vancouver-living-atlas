"""Final collision / geometry audit. Kept ground pavement is a physical solid
where the chosen source coast exposes water beneath its existing mesh.
Protected/elevated bridge floors are deliberately not treated as seabed.
"""
exec(open(__file__.replace('finish-data.py','prepare.py')).read().split('# The original 32m tessellation')[0])
doc=read(HERE/'beach-coast.json')
pavement=unary_union([Polygon(p).intersection(rem) for p in read(HERE/'ground-pavement.json') if Polygon(p).intersects(rem)])
obstacles=[mapping(p)['coordinates'] for p in parts(pavement,'Polygon') if p.area>.01]
doc['groundObstacleFootprints']=obstacles
for file in ['public/data/roads.geojson','public/data/trees.json','public/data/bridges.json','lib/city/street-curb-extensions.json','lib/city/causeway-city-cuts.json']:
 doc['sourceHashes'][file]=hashlib.sha256((APP/file).read_bytes()).hexdigest()
doc['statistics']['coastGroundPavementObstacleM2']=pavement.area;doc['statistics']['coastGroundPavementObstacles']=len(obstacles)
(HERE/'beach-coast.json').write_text(json.dumps(doc,separators=(',',':')))
V=doc['profilePositions'];polys=[Polygon([(V[i+j],V[i+j+2]) for j in [0,3,6]]) for i in range(0,len(V),9)]
profileUnion=unary_union(polys)
O=doc['outsidePositions'];outside=unary_union([Polygon([(O[i+j],O[i+j+2]) for j in [0,3,6]]) for i in range(0,len(O),9)])
P=doc['pathPositions'];paths=unary_union([Polygon([(P[i+j],P[i+j+2]) for j in [0,3,6]]) for i in range(0,len(P),9)])
shore=unary_union([transform(xz,shape(f['geometry'])) for f in doc['shoreline']['features']])
replacement=set(doc['replaceTriangles']);base=read(HERE/'base-terrain.json')
scope=rem.union(domain)
leftLeaks=sum(Polygon(rec['p']).intersection(scope).area for rec in base if rec['key'] not in replacement and Polygon(rec['p']).intersects(scope))
report={'profileCoverageDifferenceM2':profileUnion.symmetric_difference(domain).area,'retainedOriginalTerrainOverlapM2':leftLeaks,'replacementOutsideTerrainInProfileM2':outside.intersection(domain).area,'replacementOutsideTerrainInRemovedLandM2':outside.intersection(rem).area,'pathWetSideOverlapM2':paths.intersection(domain).difference(dry).area,'greyRibbonDistanceFromProfileM':shore.distance(domain),'collisionGroundPavementM2':pavement.area,'totalTerrainTriangles':len(base)-len(replacement)+len(O)//9+len(V)//9}
assert report['profileCoverageDifferenceM2']<1
assert leftLeaks<1e-5
assert report['replacementOutsideTerrainInProfileM2']<.2
assert report['replacementOutsideTerrainInRemovedLandM2']<1
assert report['pathWetSideOverlapM2']<.1
assert report['greyRibbonDistanceFromProfileM']>4.99
(HERE/'geometry-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

#!/usr/bin/env python3
"""Download open source inputs for the release's derived-asset tools.
No keys/authentication required. Read-only network requests; writes only OUT.
Downloaded City records retain OGL-Vancouver and OSM records retain ODbL1.0.
Live downloads can differ from the archived release; retain SHA256 manifests.
"""
import argparse,hashlib,json,time,urllib.parse,urllib.request
from pathlib import Path
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--out-dir',type=Path,required=True)
ap.add_argument('--only',nargs='+',choices=['city-buildings','contours','osm-buildings','osm-paths','osm-coast'],help='Defaults to all5 required raw sources')
ap.add_argument('--osm-date',help='Optional historical OSM UTC timestamp, e.g.2026-09-04T19:30:00Z; City endpoints are not date-versioned')
ap.add_argument('--overwrite',action='store_true',help='Replace downloaded files; default preserves existing snapshot')
a=ap.parse_args();a.out_dir.mkdir(parents=True,exist_ok=True)
where="intersects(geom,geom'POLYGON((-123.165 49.267,-123.095 49.267,-123.095 49.315,-123.165 49.315,-123.165 49.267))')"
city=lambda dataset:'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/'+dataset+'/exports/geojson?'+urllib.parse.urlencode({'where':where})
prefix='[out:json][timeout:100]'+('[date:'+json.dumps(a.osm_date)+']' if a.osm_date else '')+';'
spec={
 'city-buildings':('raw-building-footprints-2009.geojson',city('building-footprints-2009'),None),
 'contours':('raw-elevation-contour-lines-1-metre-contours.geojson',city('elevation-contour-lines-1-metre-contours'),None),
 'osm-buildings':('osm-features.json','https://overpass-api.de/api/interpreter',prefix+'(way(49.267,-123.165,49.315,-123.095)[natural~"^(water|beach|wood)$"];relation(49.267,-123.165,49.315,-123.095)[natural~"^(water|beach|wood)$"];way(49.267,-123.165,49.315,-123.095)[building];way(49.267,-123.165,49.315,-123.095)["building:part"];);out geom;'),
 'osm-paths':('osm-stanley-paths.json','https://overpass-api.de/api/interpreter',prefix+'way(49.293,-123.165,49.315,-123.13)[highway];out geom;'),
 'osm-coast':('osm-context-coastline.json','https://overpass-api.de/api/interpreter',prefix+'way(49.22,-123.26,49.44,-122.97)[natural=coastline];out geom;'),
}
records=[]
for k in a.only or spec:
 filename,url,query=spec[k];target=a.out_dir/filename
 if not target.exists() or a.overwrite:
  data=urllib.parse.urlencode({'data':query}).encode() if query else None
  req=urllib.request.Request(url,data=data,headers={'User-Agent':'VancouverLivingAtlas/1.0 source-data rebuild'})
  for attempt in range(3):
   try:
    with urllib.request.urlopen(req,timeout=180) as r:payload=r.read()
    parsed=json.loads(payload)
    if not isinstance(parsed,dict):raise ValueError('Expected source JSON object')
    target.write_bytes(payload);break
   except Exception:
    if attempt==2:raise
    time.sleep(2**attempt)
 payload=target.read_bytes();parsed=json.loads(payload)
 rec={'source':k,'file':filename,'url':url,'query':query,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest(),'records':len(parsed.get('features',parsed.get('elements',[]))),'osmTimestamp':parsed.get('osm3s',{}).get('timestamp_osm_base')}
 records.append(rec);print(filename,rec['records'],rec['sha256'],flush=True)
(a.out_dir/'download-manifest.json').write_text(json.dumps(records,indent=2)+'\n')

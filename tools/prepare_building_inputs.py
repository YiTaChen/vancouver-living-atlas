#!/usr/bin/env python3
"""Prepare original City2009 and OSM records for building reconciliation.
Code MIT. City records OGL-Vancouver; OSM-derived records ODbL1.0.
"""
import argparse,json
from pathlib import Path
from shapely.geometry import shape,box,Polygon,mapping
from shapely import make_valid
ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('--city-raw',type=Path,required=True,help='City building-footprints-2009 GeoJSON export')
ap.add_argument('--osm-raw',type=Path,required=True,help='Overpass JSON including building and building:part ways')
ap.add_argument('--out-dir',type=Path,required=True)
a=ap.parse_args();a.out_dir.mkdir(parents=True,exist_ok=True)
bbox=[-123.165,49.267,-123.095,49.315];clip=box(*bbox)
def rr(v):
 if isinstance(v,float):return round(v,7)
 if isinstance(v,(list,tuple)):return [rr(x) for x in v]
 if isinstance(v,dict):return {k:rr(x) for k,x in v.items()}
 return v
def feature(g,p):return {'type':'Feature','properties':p,'geometry':rr(mapping(g))}
def write(n,fs):
 (a.out_dir/n).write_text(json.dumps({'type':'FeatureCollection','bbox':bbox,'features':fs},separators=(',',':')))
 print(n,len(fs))
def number(s,default=None):
 try:return float(str(s).replace('m','').strip())
 except (ValueError,TypeError):return default
city=[]
for f in json.loads(a.city_raw.read_text())['features']:
 p=f['properties'];g=shape(f['geometry'])
 if not g.is_valid:g=make_valid(g)
 g=g.intersection(clip)
 if g.is_empty or g.geom_type not in ['Polygon','MultiPolygon'] or p.get('area_m2',0)<3:continue
 h=p.get('hgt_agl') or p.get('avght_m') or 3;base=p.get('baseelev_m')
 city.append(feature(g,{'id':p['id'],'buildingId':p.get('bldgid'),'height':round(max(.5,h),2),'base':round(base if base is not None else p.get('base_m') or 0,2),'roof':p.get('rooftype'),'area':round(p.get('area_m2') or 0,1),'source':'cov-2009'}))
osm=[]
for e in json.loads(a.osm_raw.read_text())['elements']:
 t=e.get('tags',{})
 if not(t.get('building') or t.get('building:part')):continue
 if e.get('type')!='way':raise ValueError('This release prep expects building ways; inspect relation inputs explicitly before adding support.')
 c=[(p['lon'],p['lat']) for p in e.get('geometry',[])]
 if len(c)<4 or c[0]!=c[-1]:continue
 g=Polygon(c)
 if not g.is_valid:g=make_valid(g)
 g=g.intersection(clip)
 if g.is_empty or g.geom_type not in ['Polygon','MultiPolygon']:continue
 osm.append(feature(g,{'id':'osm-'+str(e['id']),'name':t.get('name'),'height':number(t.get('height')),'levels':number(t.get('building:levels')),'minHeight':number(t.get('min_height'),0.0),'base':None,'part':bool(t.get('building:part')),'roof':t.get('roof:shape'),'roofColor':t.get('roof:colour'),'building':t.get('building') or 'part','source':'OpenStreetMap'}))
write('city-buildings.geojson',city);write('buildings-osm-all.geojson',osm)

#!/usr/bin/env python3
"""Original LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid) code: download 9 public Terrarium DEM tiles, build 100m context.

Requires NumPy and Pillow. Underlying elevation data retain source licences.
Run from any directory: python build_context.py --out-dir PATH [--cache-dir PATH] [--offline]
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = None
TILES = None
OFFLINE = False
WEST, SOUTH, EAST, NORTH = BOUNDS = [-123.26,49.22,-122.97,49.44]
ZOOM = 11
SIZE = 256 * 2**ZOOM
R = 6371008.8
LAT0 = (NORTH+SOUTH)/2
MX = math.pi*R/180*math.cos(math.radians(LAT0))
MY = math.pi*R/180
WIDTH = round((EAST-WEST)*MX/100)+1
HEIGHT = round((NORTH-SOUTH)*MY/100)+1


def mercator_pixels(lon,lat):
    return ((np.asarray(lon)+180)/360*SIZE-.5,
            (1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*SIZE-.5)


def fetch_tile(xy):
    x,y=xy
    url=f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ZOOM}/{x}/{y}.png'
    filename=TILES/f'{ZOOM}-{x}-{y}.png'
    metadata_file=filename.with_suffix('.json')
    if not filename.exists() or not metadata_file.exists():
        if OFFLINE:
            raise FileNotFoundError(f'Missing cached tile or metadata: {filename}; rerun without --offline to download.')
        req=urllib.request.Request(url,headers={'User-Agent':'VancouverAtlasTerrainBuild/1.0'})
        with urllib.request.urlopen(req,timeout=45) as response:
            data=response.read()
            headers=dict(response.headers)
        filename.write_bytes(data)
        metadata={'url':url,'headers':headers,'sha256':hashlib.sha256(data).hexdigest()}
        metadata_file.write_text(json.dumps(metadata,indent=2)+'\n')
    else:
        metadata=json.loads(metadata_file.read_text())
    png=np.asarray(Image.open(filename).convert('RGB'),dtype=np.float64)
    # Published Terrarium encoding; RGB channels contain actual height values.
    heights=png[:,:,0]*256+png[:,:,1]+png[:,:,2]/256-32768
    return x,y,heights,metadata


def main():
    global ROOT,TILES,OFFLINE
    ap=argparse.ArgumentParser(description='Build regional ~100m Terrarium elevation context.')
    ap.add_argument('--out-dir',type=Path,required=True)
    ap.add_argument('--cache-dir',type=Path,help='Tile PNG/JSON cache; defaults to OUT/tiles')
    ap.add_argument('--offline',action='store_true',help='Use cached tiles only')
    args=ap.parse_args()
    ROOT=args.out_dir.resolve();ROOT.mkdir(parents=True,exist_ok=True)
    TILES=args.cache_dir.resolve() if args.cache_dir else ROOT/'tiles';OFFLINE=args.offline
    TILES.mkdir(parents=True,exist_ok=True)
    nw=mercator_pixels(WEST,NORTH)
    se=mercator_pixels(EAST,SOUTH)
    xmin,xmax=int(np.floor(nw[0]/256)),int(np.floor((se[0]+1)/256))
    ymin,ymax=int(np.floor(nw[1]/256)),int(np.floor((se[1]+1)/256))
    coordinates=[(x,y) for y in range(ymin,ymax+1) for x in range(xmin,xmax+1)]
    mosaic=np.zeros(((ymax-ymin+1)*256,(xmax-xmin+1)*256))
    tile_metadata=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for x,y,data,metadata in pool.map(fetch_tile,coordinates):
            ox,oy=(x-xmin)*256,(y-ymin)*256
            mosaic[oy:oy+256,ox:ox+256]=data
            tile_metadata.append(metadata)
    lons=np.linspace(WEST,EAST,WIDTH)
    lats=np.linspace(NORTH,SOUTH,HEIGHT)
    gx,gy=np.meshgrid(lons,lats)
    px,py=mercator_pixels(gx,gy)
    px-=xmin*256; py-=ymin*256
    ix,iy=np.floor(px).astype(int),np.floor(py).astype(int)
    fx,fy=px-ix,py-iy
    raw=(mosaic[iy,ix]*(1-fx)*(1-fy)+mosaic[iy,ix+1]*fx*(1-fy)
         +mosaic[iy+1,ix]*(1-fx)*fy+mosaic[iy+1,ix+1]*fx*fy)
    assert np.isfinite(raw).all()
    # Context-only inferred sea mask. Low coastal cells <= 1m are treated as sea.
    land=raw>1
    heights=np.round(np.where(land,raw,0),1)
    sources=sorted(set(m['headers'].get('x-amz-meta-x-imagery-sources','unknown') for m in tile_metadata))
    peak=np.unravel_index(heights.argmax(),heights.shape)
    stats={'min':float(heights.min()),'max':float(heights.max()),
           'rawMin':round(float(raw.min()),3),'rawMax':round(float(raw.max()),3),
           'landCells':int(land.sum()),'totalCells':int(heights.size),
           'peakCoordinates':[float(lons[peak[1]]),float(lats[peak[0]])]}
    metadata={
        'schema':'vancouver-context-elevation-grid/1.0',
        'bounds':BOUNDS,'width':WIDTH,'height':HEIGHT,'crs':'EPSG:4326','units':'meters',
        'order':'row-major; row 0 north, column 0 west; endpoints include bounds',
        'spacingMeters':{'eastWest':round((EAST-WEST)*MX/(WIDTH-1),3),
                         'northSouth':round((NORTH-SOUTH)*MY/(HEIGHT-1),3)},
        'min':stats['min'],'max':stats['max'],
        'source':{
            'name':'Mapzen Terrain Tiles / AWS Open Data, Terrarium z11',
            'url':'https://registry.opendata.aws/terrain-tiles/',
            'encodingDocumentation':'https://www.mapzen.com/blog/terrain-tile-service/',
            'sourceDocumentation':'https://github.com/tilezen/joerd/blob/master/docs/data-sources.md',
            'attributionDocumentation':'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
            'acquired':datetime.now(timezone.utc).date().isoformat(),
            'imagerySourcesFromTileHeaders':sources,
            'attribution':'Terrain tiles by Mapzen / AWS Open Data. 3DEP (formerly NED) terrain data courtesy of the U.S. Geological Survey. Contains information licensed under the Open Government Licence – Canada.',
            'license':'USGS NED/3DEP data: public domain. Canadian CDEM data: Open Government Licence – Canada. See attributionDocumentation.',
            'canadaLicenseUrl':'https://open.canada.ca/en/open-government-licence-canada',
        },
        'method':'Nine Terrarium RGB height tiles at zoom 11; exact published decoding; bilinear resampling into a regular geographic ~100m grid. Values <= 1m are treated as sea and set to zero; remaining values rounded to 0.1m.',
        'contextOnly':True,
        'limitations':[
            'Coarse surrounding context. The detailed downtown core uses a separate City of Vancouver contour-derived grid.',
            'Sea mask is inferred from elevation <= 1m, not a vector shoreline. Low reclaimed land, lakes, streams, piers, bridges, and narrow inlets may be simplified or misclassified.',
            'No bathymetry. Inland lakes may retain local terrain elevation and require separate flat water overlays.',
            'Source tiles were last modified in 2017 and are not a current terrain survey. 100m sampling and 0.1m encoding precision do not imply corresponding elevation accuracy.',
            'The rectangular context boundary should be visually concealed by view limits or distance fog.',
        ],
        'statistics':stats,'tiles':tile_metadata,
    }
    output={**metadata,'heights':heights.ravel().tolist()}
    (ROOT/'context-terrain.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
    (ROOT/'context-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
    t=np.clip(heights/1450,0,1)
    rgb=np.stack((52+170*t,100+94*t,63+98*t),axis=-1).astype(np.uint8)
    rgb[~land]=[111,175,198]
    preview=Image.fromarray(rgb).resize((WIDTH*4,HEIGHT*4),Image.Resampling.NEAREST)
    d=ImageDraw.Draw(preview)
    d.rectangle((8,8,640,60),fill=(245,245,235))
    d.text((18,18),'Vancouver context elevation | North up | ~100 m grid',fill=(20,35,40))
    d.text((18,36),f'Mapzen / USGS NED / CDEM | Max {heights.max():.1f} m | Sea inferred at <=1 m',fill=(20,35,40))
    # White rectangle: separately modeled detailed downtown core.
    def imagexy(lon,lat):
        return ((lon-WEST)/(EAST-WEST)*(WIDTH-1)*4,(NORTH-lat)/(NORTH-SOUTH)*(HEIGHT-1)*4)
    d.rectangle([imagexy(-123.165,49.315),imagexy(-123.095,49.267)],outline=(255,255,255),width=2)
    preview.save(ROOT/'context-preview.png')
    print(json.dumps({'width':WIDTH,'height':HEIGHT,'statistics':stats,'imagerySources':sources,
                      'bytes':(ROOT/'context-terrain.json').stat().st_size},indent=2))


if __name__=='__main__':
    main()

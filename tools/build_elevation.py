#!/usr/bin/env python3
"""Build a reproducible ~20m Vancouver terrain grid from official 1m contours.

Dependencies: numpy, scipy, Pillow. Source input GeoJSON is read only.
Run with explicit --contours, --land and --out-dir paths (see README.md).
Data: City of Vancouver Open Government Licence. Code: LicenseRef-Vancouver-Living-Atlas-NC-1.0 (see LICENSE; prior MIT grants remain valid).
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
WEST, SOUTH, EAST, NORTH = BOUNDS = [-123.165, 49.267, -123.095, 49.315]
WIDTH, HEIGHT = 257, 273
R = 6371008.8
LAT0 = (NORTH + SOUTH) / 2
LON_SCALE = math.cos(math.radians(LAT0)) * math.pi * R / 180
LAT_SCALE = math.pi * R / 180


def project(points):
    points = np.asarray(points, dtype=np.float64)
    return np.column_stack(((points[:, 0] - WEST) * LON_SCALE,
                            (points[:, 1] - SOUTH) * LAT_SCALE))


def thin_line(points, spacing=5):
    """Retain original measured vertices with >=spacing m travel separation."""
    if len(points) < 3:
        return points
    p = project(points)
    travel = np.insert(np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1)), 0, 0)
    keep = np.insert(np.diff(np.floor(travel / spacing)).astype(bool), 0, True)
    keep[-1] = True
    return np.asarray(points)[keep]


def mask_polygon(lons, lats, rings):
    """Scanline point-in-polygon; supports exterior ring and interior holes."""
    result = np.zeros((len(lats), len(lons)), dtype=bool)
    for ring in rings:
        p = np.asarray(ring)
        x1, y1 = p[:-1, 0], p[:-1, 1]
        x2, y2 = p[1:, 0], p[1:, 1]
        for row, y in enumerate(lats):
            hit = (y1 > y) != (y2 > y)
            xs = np.sort(x1[hit] + (y-y1[hit])*(x2[hit]-x1[hit])/(y2[hit]-y1[hit]))
            # Even/odd rule also handles disjoint subparts and exact shared nodes.
            result[row] ^= (np.searchsorted(xs, lons, side='right') % 2).astype(bool)
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--contours', type=Path, required=True, help='Original City 1m contour GeoJSON')
    ap.add_argument('--land', type=Path, required=True, help='Prepared core land Polygon GeoJSON')
    ap.add_argument('--out-dir', type=Path, required=True, help='Generated data and QA destination')
    ap.add_argument('--source-date',default='unknown',help='Acquisition date of supplied City snapshot (YYYY-MM-DD)')
    args = ap.parse_args()
    out_dir=args.out_dir.resolve(); out_dir.mkdir(parents=True,exist_ok=True)
    contours = json.loads(args.contours.read_text())['features']
    land = json.loads(args.land.read_text())['features'][0]['geometry']
    assert land['type'] == 'Polygon'
    rings = land['coordinates']

    coords, elevations = [], []
    # Retain a 150m interpolation buffer around the study area.
    dx, dy = 150/LON_SCALE, 150/LAT_SCALE
    for feature in contours:
        elevation = float(feature['properties']['elevation'])
        geom = feature['geometry']
        lines = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
        for line in lines:
            points = thin_line(line)
            keep = (points[:, 0] >= WEST-dx) & (points[:, 0] <= EAST+dx) & (points[:, 1] >= SOUTH-dy) & (points[:, 1] <= NORTH+dy)
            points = points[keep]
            coords.extend(points)
            elevations.extend([elevation]*len(points))
    contour_count = len(coords)

    # The actual coastline is an extra zero-elevation interpolation constraint;
    # exclude synthetic polygon closing edges along the rectangular study bounds.
    for ring in rings:
        for a, b in zip(ring[:-1], ring[1:]):
            a, b = np.array(a), np.array(b)
            border = any(abs(a[dim]-edge)<1e-8 and abs(b[dim]-edge)<1e-8
                         for dim, edge in [(0,WEST),(0,EAST),(1,SOUTH),(1,NORTH)])
            if border:
                continue
            distance = np.linalg.norm(project([a,b])[1] - project([a,b])[0])
            for t in np.linspace(0,1,max(2,math.ceil(distance/5)+1))[:-1]:
                coords.append(a*(1-t)+b*t)
                elevations.append(0.)
    coords, elevations = np.array(coords), np.array(elevations)
    # Remove coincident points; prefer coastline zero when it shares a point.
    keys = np.round(project(coords), 2)
    unique, reverse = np.unique(keys, axis=0, return_inverse=True)
    values = np.full(len(unique), np.inf)
    np.minimum.at(values, reverse, elevations)
    print('interpolation points', len(unique), 'contour points', contour_count, flush=True)
    interpolator = LinearNDInterpolator(unique, values)

    lons, lats = np.linspace(WEST,EAST,WIDTH), np.linspace(NORTH,SOUTH,HEIGHT)
    gx, gy = np.meshgrid(lons,lats)
    queries = project(np.column_stack((gx.ravel(),gy.ravel())))
    grid = interpolator(queries).reshape(HEIGHT,WIDTH)
    sea_mask = mask_polygon(lons,lats,rings)
    missing = np.isnan(grid) & sea_mask
    if missing.any():
        grid[missing] = NearestNDInterpolator(unique,values)(queries.reshape(HEIGHT,WIDTH,2)[missing])
    unmasked_min, unmasked_max = float(np.nanmin(grid)), float(np.nanmax(grid))
    grid = np.where(sea_mask,np.clip(np.nan_to_num(grid),0,None),0)
    grid = np.round(grid,1)
    controls = {
        'Prospect Point': [-123.1426,49.3130],
        'Stanley Park highest contour': [-123.14804,49.30895],
        'Stanley Park Beaver Lake': [-123.1430,49.3037],
        'West End / Nelson Park': [-123.1296,49.2825],
        'Vancouver Art Gallery / Robson Square': [-123.1207,49.2829],
        'English Bay Beach': [-123.1413,49.2867],
        'Science World': [-123.1032,49.2734],
    }
    checks = []
    for name, lonlat in controls.items():
        z = float(interpolator(project([lonlat]))[0])
        checks.append({'name':name,'coordinates':lonlat,'interpolatedMeters':round(max(0,z),2)})
    peak = np.unravel_index(grid.argmax(),grid.shape)
    metadata = {
        'schema':'vancouver-elevation-grid/1.0',
        'bounds':BOUNDS,
        'width':WIDTH,
        'height':HEIGHT,
        'crs':'EPSG:4326',
        'units':'meters',
        'order':'row-major; row 0 north, column 0 west; endpoints include bounds',
        'spacingMeters':{'eastWest':round((EAST-WEST)*LON_SCALE/(WIDTH-1),3),'northSouth':round((NORTH-SOUTH)*LAT_SCALE/(HEIGHT-1),3)},
        'min':float(grid.min()),
        'max':float(grid.max()),
        'peakCoordinates':[float(lons[peak[1]]),float(lats[peak[0]])],
        'source':{
            'name':'City of Vancouver — Elevation contour lines, 1-metre contours',
            'url':'https://opendata.vancouver.ca/explore/dataset/elevation-contour-lines-1-metre-contours/',
            'year':2002,
            'license':'Open Government Licence – Vancouver',
            'licenseUrl':'https://opendata.vancouver.ca/pages/licence/',
            'attribution':'Contains information licensed under the Open Government Licence – Vancouver.',
            'acquired':args.source_date,
            'contourSha256':hashlib.sha256(args.contours.read_bytes()).hexdigest(),
            'landSha256':hashlib.sha256(args.land.read_bytes()).hexdigest(),
        },
        'method':'Piecewise-linear Delaunay interpolation of official 1m contour vertices thinned at ~5m travel intervals; coast constrained to 0m; clipped to the detailed City 2002 land polygon; negative heights clamped to 0m. Output rounded to 0.1m.',
        'limitations':['Derived visualization raster, not survey grade. Source contours were digitized from 2002 orthophotos and are approximate.','20m mesh spacing and 0.1m encoding precision do not imply corresponding vertical accuracy.','No post-2002 grading/reclamation changes represented. Inland lake surfaces must be overlaid separately.','Sea is zero; no bathymetry. Border nodes on polygon boundary can be classified as sea.'],
        'statistics':{'interpolationPoints':len(unique),'contourPoints':contour_count,'landCells':int(sea_mask.sum()),'nearestFillLandCells':int(missing.sum()),'unmaskedMin':round(unmasked_min,3),'unmaskedMax':round(unmasked_max,3)},
        'controlPoints':checks,
    }
    result={**metadata,'heights':grid.ravel().tolist()}
    (out_dir/'terrain.json').write_text(json.dumps(result,separators=(',',':'))+'\n')
    (out_dir/'terrain-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')

    # Plain scientific elevation preview: turquoise sea, green lowland to ochre highland.
    t=np.clip(grid/76,0,1)
    rgb=np.stack((48+165*t,111+65*t,85-45*t),axis=-1).astype(np.uint8)
    rgb[~sea_mask]=[115,183,205]
    preview=Image.fromarray(rgb).resize((WIDTH*3,HEIGHT*3),Image.Resampling.NEAREST)
    d=ImageDraw.Draw(preview)
    d.rectangle((10,10,490,65),fill=(250,250,245))
    d.text((20,20),'Vancouver terrain / City of Vancouver 2002 contours',fill=(25,40,45))
    d.text((20,38),f'Approx. 20 m grid | 0 - {grid.max():.1f} m | North up',fill=(25,40,45))
    preview.save(out_dir/'elevation-preview.png')
    print(json.dumps(metadata,indent=2))


if __name__ == '__main__':
    main()

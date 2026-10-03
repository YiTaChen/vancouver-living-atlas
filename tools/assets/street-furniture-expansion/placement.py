"""Offline source-selected placement gate. This is not imported by runtime.
Input polygons are in the candidate's actual sidewalk plane, metres. Exclusion
polygons must already represent complete door sweeps/approaches/road corridors.
"""
import hashlib,json,math

def source_key(feature):
    payload={'source':feature['properties'].get('source'),'name':feature['properties'].get('name'),'geometry':feature['geometry']}
    return 'road-sha256:'+hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def overlap(a,b):
    # SAT for convex footprints and convex exclusion polygons; touching is blocked.
    for poly in [a,b]:
        for p,q in zip(poly,poly[1:]+poly[:1]):
            axis=(q[1]-p[1],p[0]-q[0]);aa=[x*axis[0]+y*axis[1] for x,y in a];bb=[x*axis[0]+y*axis[1] for x,y in b]
            if max(aa)<min(bb)-1e-8 or max(bb)<min(aa)-1e-8:return False
    return True

def convex(poly):
    if len(poly)<3 or any(len(p)!=2 or not all(math.isfinite(v) for v in p) for p in poly):return False
    turns=[]
    for i in range(len(poly)):
        p,q,r=poly[i-2],poly[i-1],poly[i];t=(q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0])
        if abs(t)>1e-9:turns.append(t>0)
    return bool(turns) and all(t==turns[0] for t in turns)

def inside(p,poly):
    signs=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        cross=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])
        if abs(cross)>1e-8:signs.append(cross>0)
    return bool(signs) and all(x==signs[0] for x in signs)

def assess(candidate,allowed_sources):
    reasons=[];foot=candidate.get('footprint',[]);walk=candidate.get('walkablePolygon',[])
    if candidate.get('sourceKey') not in allowed_sources:reasons.append('missing-or-unselected-source')
    if not candidate.get('replacementOfExistingId'):reasons.append('unapproved-population-increase')
    if candidate.get('scale')!=[1,1,1]:reasons.append('non-unit-furniture-scale')
    if not convex(foot) or not convex(walk):reasons.append('invalid-or-nonconvex-footprint')
    elif not all(inside(p,walk) for p in foot):reasons.append('outside-authoritative-walkable-polygon')
    heights=candidate.get('terrainSamplesM',[])
    if len(heights)<3 or not all(math.isfinite(h) for h in heights):reasons.append('insufficient-terrain-samples')
    elif max(heights)-min(heights)>.14+1e-9:reasons.append('excessive-slope')
    if candidate.get('remainingPedestrianWidthM',0)<1.8:reasons.append('pedestrian-corridor-too-narrow')
    for item in candidate.get('exclusions',[]):
        if not convex(item.get('polygon',[])):reasons.append('invalid-exclusion')
        elif convex(foot) and overlap(foot,item['polygon']):reasons.append('intersects-'+item['kind'])
    required={'doorway-approach','car-door-sweep','road-rail'}
    if not required<=set(candidate.get('checkedExclusionLayers',[])):reasons.append('missing-exclusion-layer')
    return {'status':'reject' if reasons else 'candidate-only','reasons':reasons,'runtimeAccepted':False,'groundDatumM':max(heights) if heights and all(math.isfinite(h) for h in heights) else None}

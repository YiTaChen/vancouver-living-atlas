"""CPU research-fit checks only; never a navigation or runtime placement implementation."""
import math
EPS=1e-8
def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def on(p,a,b):return abs(cross(a,b,p))<EPS and min(a[0],b[0])-EPS<=p[0]<=max(a[0],b[0])+EPS and min(a[1],b[1])-EPS<=p[1]<=max(a[1],b[1])+EPS
def segments(a,b,c,d):
 x,y,z,w=cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b)
 return (x*y<0 and z*w<0)or on(c,a,b)or on(d,a,b)or on(a,c,d)or on(b,c,d)
def inside(p,poly):
 hit=False
 for a,b in zip(poly,poly[1:]+poly[:1]):
  if on(p,a,b):return True
  if (a[1]>p[1])!=(b[1]>p[1]) and p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]:hit=not hit
 return hit
def overlap(a,b):
 return any(inside(p,b)for p in a)or any(inside(p,a)for p in b)or any(segments(p,q,r,s)for p,q in zip(a,a[1:]+a[:1])for r,s in zip(b,b[1:]+b[:1]))
def fit(*,source_id,footprint,contour,heights,roads=(),doors=(),holes=(),rigid=True):
 if not source_id:return False,'missing-source-id'
 if any(not math.isfinite(v)for p in footprint+contour for v in p)or any(not math.isfinite(v)for v in heights):return False,'nonfinite'
 if len(heights)<3:return False,'insufficient-rendered-surface-samples'
 if not all(inside(p,contour)for p in footprint):return False,'outside-source-contour'
 # Reject proper boundary crossings as well as point failures: a narrow concavity may miss every corner and midpoint.
 for a,b in zip(footprint,footprint[1:]+footprint[:1]):
  for c,d in zip(contour,contour[1:]+contour[:1]):
   if cross(a,b,c)*cross(a,b,d)<-EPS and cross(c,d,a)*cross(c,d,b)<-EPS:return False,'bridged-contour'
 # Boundary-coincident segments remain bounded by inside tests; rendered-triangle draping is still required.
 if not all(inside([(p[0]+q[0])/2,(p[1]+q[1])/2],contour)for p,q in zip(footprint,footprint[1:]+footprint[:1])):return False,'bridged-contour'
 for name,polys in [('road',roads),('door',doors),('hole',holes)]:
  if any(overlap(footprint,p)for p in polys):return False,name+'-exclusion'
 if max(heights)-min(heights)>(.02 if rigid else .5):return False,'slope-relief'
 return True,'offline-research-fit-only'

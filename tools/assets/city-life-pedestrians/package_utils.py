"""Standard-library geometry measurements and a conservative analytic gait envelope."""
import importlib.util, math
from pathlib import Path
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('asset_common',ROOT.parent/'package-contract/validate.py')
common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)

def primitive_data(file):
    doc,binary=common.read_glb(file);primitive=doc['meshes'][0]['primitives'][0]
    return doc,primitive,{key:common.accessor(doc,binary,value) for key,value in primitive['attributes'].items()}

def trig_range(a,b,limit):
    # Exact range of a*cos(t)+b*sin(t) over [-limit,limit].
    points=[-limit,limit];critical=math.atan2(b,a)
    for k in range(-2,3):
        t=critical+k*math.pi
        if -limit<=t<=limit:points.append(t)
    values=[a*math.cos(t)+b*math.sin(t) for t in points]
    return min(values),max(values)

def animated_bounds(file):
    _,_,attrs=primitive_data(file);lo=[math.inf]*3;hi=[-math.inf]*3
    for i,p in enumerate(attrs['POSITION']):
        limb=int(attrs['_LIMB'][i][0]);pivot=[attrs['_PIVOT_'+axis][i][0] for axis in 'XYZ'];q=[p[k]-pivot[k] for k in range(3)]
        ranges=[(v,v) for v in q]
        if limb==1:
            ranges[0]=trig_range(q[0],q[2],.75);ranges[2]=trig_range(q[2],-q[0],.75)
        elif limb in (2,3,4,5):
            ranges[1]=trig_range(q[1],-q[2],.42);ranges[2]=trig_range(q[2],q[1],.42)
        for k in range(3):
            lo[k]=min(lo[k],ranges[k][0]+pivot[k]);hi[k]=max(hi[k],ranges[k][1]+pivot[k]+(.051 if k==1 else 0))
    # Millimetre padding covers float32 export and CPU/GPU trig differences.
    lo=[v-.002 for v in lo];hi=[v+.002 for v in hi]
    return {'min':lo,'max':hi,'size':[hi[k]-lo[k] for k in range(3)],'method':'analytic interval extrema per exported vertex; limb X +/-0.42 rad, head Y +/-0.75 rad, root lift 0..0.051 m, plus 0.002 m padding','scope':'local rigid-limb-v1 envelope only; consumer must transform once and expand for any added animation'}

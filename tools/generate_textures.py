"""Original deterministic, periodically sampled PBR street materials.
No reference photographs, downloaded raster images, or third-party artwork.
Run with Python, numpy and Pillow. Generated normals use OpenGL +Y convention.
"""
import argparse
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ap=argparse.ArgumentParser(description='Generate original deterministic PBR material maps.')
ap.add_argument('--out-dir',type=Path,required=True)
ap.add_argument('--font',type=Path,help='Optional font file used only in diagnostic contact sheet')
args=ap.parse_args()
OUT=args.out_dir.resolve();OUT.mkdir(parents=True,exist_ok=True)
N=1024
Y,X=np.mgrid[0:N,0:N].astype(np.float32)


def smooth(t):
    t=np.clip(t,0,1)
    return t*t*(3-2*t)


def noise(cells,seed):
    """Smooth periodic value noise. All sampled bands wrap at exactly N pixels."""
    rng=np.random.default_rng(seed)
    grid=rng.random((cells,cells),dtype=np.float32)
    sx=X*cells/N; sy=Y*cells/N
    ix=np.floor(sx).astype(np.int32); iy=np.floor(sy).astype(np.int32)
    u=smooth(sx-ix);v=smooth(sy-iy)
    return ((1-u)*(1-v)*grid[iy%cells,ix%cells]
            +u*(1-v)*grid[iy%cells,(ix+1)%cells]
            +(1-u)*v*grid[(iy+1)%cells,ix%cells]
            +u*v*grid[(iy+1)%cells,(ix+1)%cells])


def rng_image(seed):
    return np.random.default_rng(seed).random((N,N),dtype=np.float32)


def export(name,color,rough,height,tile_m,notes,emissive=None,normal_gain=1):
    color=np.clip(color,0,255).astype(np.uint8)
    rough=np.clip(rough*255,0,255).astype(np.uint8)
    dx=tile_m[0]/N;dy=tile_m[1]/N
    gx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))/(2*dx)
    gy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))/(2*dy)
    norm=np.stack([-gx*normal_gain,gy*normal_gain,np.ones_like(gx)],axis=-1)
    norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
    norm=np.clip((norm*.5+.5)*255,0,255).astype(np.uint8)
    Image.fromarray(color,'RGB').save(OUT/f'{name}-albedo.png',optimize=True)
    Image.fromarray(rough,'L').save(OUT/f'{name}-roughness.png',optimize=True)
    Image.fromarray(norm,'RGB').save(OUT/f'{name}-normal.png',optimize=True)
    if emissive is not None:
        Image.fromarray(np.clip(emissive,0,255).astype(np.uint8),'RGB').save(OUT/f'{name}-night-emissive.png',optimize=True)
    # Edge diagnostics compare expected neighboring texels across the periodic boundary,
    # not equality of opposite pixels (which would duplicate the end sample).
    edge=np.concatenate([np.abs(color[0].astype(float)-color[-1]),np.abs(color[:,0].astype(float)-color[:,-1])])
    records.append(dict(name=name,resolution=[N,N],tileMeters=tile_m,notes=notes,
        maps=dict(albedo=f'{name}-albedo.png',roughness=f'{name}-roughness.png',normal=f'{name}-normal.png',
                  **({'nightEmissive':f'{name}-night-emissive.png'} if emissive is not None else {})),
        roughnessRange=[round(float(rough.min()/255),3),round(float(rough.max()/255),3)],
        wrapping='RepeatWrapping; fully periodic pattern and noise; no padding required',
        edgeMeanDifferenceRGB=round(float(edge.mean()),3)))


records=[]


def bricks(name,base,mortar,seed):
    # 8 × 24 running-bond units; 216 × 72 mm including a 10 mm mortar joint.
    ux=N/8;uy=N/24; mortar_px=N/1.728*.010
    row=np.floor(Y/uy).astype(int)
    sx=X+(row%2)*ux/2
    col=np.floor(sx/ux).astype(int)%8
    bx=sx%ux;by=Y%uy
    dist=np.minimum(np.minimum(bx,ux-bx),np.minimum(by,uy-by))
    raised=smooth((dist-mortar_px/2+.7)/2.1)
    nlarge=noise(8,seed+1)-.5;nmed=noise(64,seed+2)-.5
    nfine=noise(256,seed+3)-.5; grain=rng_image(seed+4)-.5
    palette=np.random.default_rng(seed).normal(0,1,(24,8,2)).astype(np.float32)
    variation=palette[row%24,col]
    kiln=variation[...,0,None]*5.5+variation[...,1,None]*np.array([2.5,.3,-1.3])
    brick=np.array(base)[None,None,:]+kiln+nlarge[...,None]*8+nmed[...,None]*11+nfine[...,None]*12+grain[...,None]*5
    grout=np.array(mortar)[None,None,:]+nmed[...,None]*8+nfine[...,None]*10+grain[...,None]*5
    # Narrow softened brick edges, restrained dirt speckling and kiln variation.
    edgeShade=1-.09*(1-raised)
    brick*=edgeShade[...,None]
    pits=(nfine<-.30)*(.30-nfine)*6
    brick-=pits[...,None]
    color=grout*(1-raised[...,None])+brick*raised[...,None]
    rough=.91*(1-raised)+(.77+nmed*.11+nfine*.09)*raised
    height=.0045*raised+(nmed*.00042+nfine*.00042+grain*.00012)*raised+nfine*.00013*(1-raised)
    export(name,color,rough,height,[1.728,1.728],
      'Running bond: 8 bricks across × 24 courses. Nominal unit 216×72 mm, fired brick 206×62 mm, 10 mm joints. Tile every 1.728 m horizontally and vertically; normalScale 0.5–0.9. Original plausible material, not a measured local façade.')


bricks('brick-charcoal',[70,61,57],[93,91,84],110)
bricks('brick-terracotta',[135,76,58],[142,135,119],220)

# Fine-grained road asphalt. No lane markings baked in: mark roads with geometry/decal.
a=noise(4,330)-.5;b=noise(32,331)-.5;c=noise(128,332)-.5;d=noise(384,333)-.5;g=rng_image(334)-.5
light=a*8+b*5+c*6+d*14+g*6
color=np.array([65,69,70])[None,None,:]+light[...,None]
# Occasional small aggregate fragments are subdued, rather than white stars.
color+=(smooth((d-.25)/.22)*8)[...,None]
height=a*.0007+b*.00035+c*.0006+d*.00055+g*.00009
export('asphalt-fine',color,.91+c*.08+d*.06,height,[3.0,3.0],
  '3×3 m tile of subdued fine aggregate asphalt. Lane paint, road crowns, curbs, drains and repairs should be separate geometry/decals. normalScale 0.25–0.5; material roughness multiplier 1.0.')

# Concrete sidewalk: four 1.5 m slabs in a 3 m tile, subtly differentiated.
ux=N/2; uy=N/2
bx=X%ux;by=Y%uy
edge=np.minimum(np.minimum(bx,ux-bx),np.minimum(by,uy-by))
raised=smooth((edge-1.7)/2.0)
a=noise(8,440)-.5;b=noise(64,441)-.5;c=noise(256,442)-.5;g=rng_image(443)-.5
row=(Y//uy).astype(int);col=(X//ux).astype(int)
slab=np.array([[1.8,-2.0],[-.8,.5]])[row,col]
color=np.array([171,169,157])[None,None,:]+(slab+a*10+b*5+c*7+g*3)[...,None]
color=color*raised[...,None]+(np.array([106,108,102])+b[...,None]*7)*(1-raised[...,None])
height=.004*raised+a*.0005+b*.00013+c*.00016
export('sidewalk-concrete',color,.85+b*.08+c*.05,height,[3,3],
  '3×3 m tile; four 1.5×1.5 m slabs and approximately 10 mm expansion joints. For sidewalk geometry only. normalScale 0.4–0.7. Curbs remain separate geometry.')

# Architectural glass façade: 4 bays × 4 storeys, 3 m per bay/storey.
ux=N/4;uy=N/4
bx=X%ux;by=Y%uy
row=(Y//uy).astype(int);col=(X//ux).astype(int)
edge=np.minimum(np.minimum(bx,ux-bx),np.minimum(by,uy-by))
vertical=np.minimum(bx,ux-bx)
horizontal=np.minimum(by,uy-by)
# Frame: 8 cm outer metal mullions and a 4 cm centre mullion per 3 m bay.
frame=np.maximum(1-smooth((vertical-2.5)/2),1-smooth((horizontal-2.5)/2))
centre=1-smooth((np.abs(bx-ux*.5)-.9)/1.6)
frame=np.maximum(frame,centre)
spandrel=(1-smooth((by-uy*.16)/3))*(1-frame)
reflect=np.random.default_rng(550).normal(0,1,(4,4))
var=reflect[row,col]
a=noise(8,551)-.5;b=noise(64,552)-.5
# Local vertical variation suggests the sky without painting identifiable reflections.
glass=np.array([62,88,95])[None,None,:]+var[...,None]*np.array([3,4,4])+((by/uy-.5)*9)[...,None]+a[...,None]*4
spandrel_color=np.array([63,74,75])[None,None,:]+var[...,None]*3
color=glass*(1-spandrel[...,None])+spandrel_color*spandrel[...,None]
metal=np.array([147,153,148])[None,None,:]+b[...,None]*4
color=color*(1-frame[...,None])+metal*frame[...,None]
rough=np.full((N,N),.22,dtype=np.float32)+a*.015
rough=rough*(1-spandrel)+.39*spandrel
rough=rough*(1-frame)+.48*frame
height=.012*frame+.0015*spandrel
# Warm unbranded occupied windows. Kept separate so daylight does not glow.
occupied=np.array([[.72,0,.34,0],[0,.50,0,.23],[.21,0,.61,0],[0,.30,0,.68]])[row,col]
window_clear=(1-frame)*(1-spandrel)*smooth((by-uy*.20)/8)*smooth((uy-by-8)/5)
blind=(.82+.18*np.cos(by*.21))
emissive=np.array([174,135,80])[None,None,:]*(occupied*window_clear*blind)[...,None]
export('facade-glass',color,rough,height,[12,12],
  '12×12 m tile, 4 horizontal bays × 4 storeys, each 3 m. Two panes per bay, 80 mm principal mullions, narrow secondary mullions, upper spandrel band. Use material metalness 0.0–0.15, envMapIntensity 0.8–1.5; normalScale 0.25–0.5. Pane pattern is an original plausible façade and not a surveyed real building. Optional emissive map only at night, emissive white/intensity 0.15–0.45.',emissive=emissive)

metadata={'license':'MIT; all textures created originally from deterministic Python functions by this task. No third-party artwork.',
 'colorSpaces':{'albedo':'sRGB','roughness':'NoColorSpace / linear data','normal':'NoColorSpace / linear data','nightEmissive':'sRGB'},
 'normalConvention':'OpenGL tangent-space +Y (green positive up); no baked directional lighting.',
 'filtering':'RepeatWrapping on S and T, LinearMipmapLinearFilter, anisotropy min(renderer maximum,8). Preserve physical UV scale.',
 'materials':records}
(OUT/'materials.json').write_text(json.dumps(metadata,indent=2))

# Diagnostic 2×2 repetitions expose seams; this is an analysis preview, not a map.
W=1420;H=1780
sheet=Image.new('RGB',(W,H),'#171e22');draw=ImageDraw.Draw(sheet)
try: font=ImageFont.truetype(str(args.font),22) if args.font else ImageFont.load_default()
except:font=ImageFont.load_default()
for i,rec in enumerate(records):
 x=36+(i%2)*700;y=36+(i//2)*580
 albedo=Image.open(OUT/rec['maps']['albedo']).resize((320,256))
 # Preserve 4:4 square tile pixels in actual assets; preview stretched only in label card prohibited, use square.
 albedo=Image.open(OUT/rec['maps']['albedo']).resize((250,250))
 for oy in [0,250]:
  for ox in [0,250]:sheet.paste(albedo,(x+ox,y+oy))
 draw.text((x,y+509),rec['name'],fill='#e1e8e6',font=font)
 draw.text((x,y+539),f"{rec['tileMeters'][0]} × {rec['tileMeters'][1]} m / tile",fill='#9badac',font=font)
sheet.save(OUT/'material-preview.jpg',quality=92)
print(json.dumps({'generated':len(records),'textureMaps':len(list(OUT.glob('*.png'))),'directory':str(OUT)},indent=2))

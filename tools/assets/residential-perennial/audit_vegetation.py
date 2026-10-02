"""Read-only texture/material audit; Pillow + NumPy, never modifies source maps."""
import argparse, hashlib, json, pathlib
import numpy as np
from PIL import Image
p=argparse.ArgumentParser(); p.add_argument('--repo',required=True); p.add_argument('--output',required=True)
a=p.parse_args(); root=pathlib.Path(a.repo)
report={'scope':'Diagnostic inventory; unchanged source textures, placements, shaders and budget', 'textures':{}}
for stem in ['leaf-atlas','bark-albedo']:
 path=root/'public/textures/trees'/f'{stem}.png'; im=Image.open(path)
 row={'size':list(im.size),'mode':im.mode,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'fileBytes':path.stat().st_size,'estimatedRGBA8MipBytes':round(im.width*im.height*4*4/3)}
 if stem=='leaf-atlas':
  rgb=np.asarray(im).astype(float)/255
  linear=np.where(rgb<=.04045,rgb/12.92,((rgb+.055)/1.055)**2.4)
  coverage=1-linear.min(axis=2)
  row['neutralMatteDiagnostic']={'interpretation':'Base-level texel acceptance after sRGB decoding using existing alphaTest=0.4; not a projected crown coverage metric or browser mip/LOD validation','cells':{}}
  for i,name in enumerate(['maple','alder','douglas-fir','western-redcedar']):
   h,w=coverage.shape; cell=coverage[(i//2)*h//2:(i//2+1)*h//2,(i%2)*w//2:(i%2+1)*w//2]
   row['neutralMatteDiagnostic']['cells'][name]={'acceptedFraction':float((cell>=.4).mean()),'meanCoverage':float(cell.mean())}
 report['textures'][stem]=row
report['runtimeContracts']={'leaf':'sRGB; alphaTest 0.4; DoubleSide; identical neutral-matte decoding on standard/depth; aSolid protects opaque interior; roughness 0.92','bark':'sRGB map reused as bump, scale 0.045, roughness 1; repeat wrap; existing longitudinal UVs','terrain':'measured terrain mesh + vertex color, roughness 1; no new whole-ground atlas','residential':'source-profile/footprint-selected bounded 500 plots; two seven-triangle plants per accepted bed; shared vertex colors, roughness 1; 650 m cull LOD','sharedCityMaterials':'eight catalog slots untouched; foliage deliberately not reassigned to architectural PBR slots'}
pathlib.Path(a.output).write_text(json.dumps(report,indent=2)+'\n')

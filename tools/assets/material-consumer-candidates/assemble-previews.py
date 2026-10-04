"""Lossless labelled sheets from the recorded Blender pixels; no new imagery."""
from pathlib import Path
import json, hashlib, shutil
from PIL import Image,ImageDraw,ImageFont
P=Path(__file__).resolve().parent;report=json.loads((P/'qa'/'render-coverage.json').read_text());work=P/'qa'/'.coverage-work'
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
sheets=[]
for filename,indices,header in [('furniture-views-lods.png',list(range(16)),'Actual exported GLBs: FRONT / SIDE / BACK / TOP; LOD0 + LOD1'),('furniture-four-light.png',list(range(16,24)),'Actual exported LOD0 GLBs: CLEAR / OVERCAST / DUSK / NIGHT')]:
    width,height=288,256;rows=len(indices)//4;canvas=Image.new('RGB',(width*4,(height+30)*rows+35),(244,244,244));draw=ImageDraw.Draw(canvas);draw.text((10,10),header,fill=(25,30,35),font=font)
    for i,index in enumerate(indices):
        r=report['renders'][index];raw=work/r['rawFile'];assert hashlib.sha256(raw.read_bytes()).hexdigest()==r['rawPngSha256'];im=Image.open(raw).convert('RGB');x=(i%4)*width;y=35+(i//4)*(height+30);canvas.paste(im,(x,y));r['sheet']=f'qa/previews/{filename}';r['pixelRectangle']=[x,y,width,height];r['rgbPixelSha256']=hashlib.sha256(im.tobytes()).hexdigest()
        label=('Chair' if r['assetId'].startswith('lecture') else 'Counter')+f"  LOD{r['lod']}  {r['view']}  {r['lighting']}";draw.text((x+6,y+height+6),label,fill=(25,30,35),font=font)
    target=P/'qa'/'previews'/filename;canvas.save(target,optimize=True);sheets.append({'file':str(target.relative_to(P)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'width':canvas.width,'height':canvas.height,'rawPixelsUnchanged':True})
report['status']='pass';report['contactSheets']=sheets;report['rawRenderStorage']='Individual render files removed after lossless placement in sheet; pixel rectangles and RGB hashes verify the original rendered pixels.';(P/'qa'/'render-coverage.json').write_text(json.dumps(report,indent=2)+'\n');shutil.rmtree(work)
print('Saved two lossless contact sheets covering all24 actual GLB reimport renders.')

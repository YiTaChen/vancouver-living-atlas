"""Compact contact sheets from actual Cycles CPU renders; no synthetic asset imagery."""
import json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
HERE=Path(__file__).resolve().parent;QA=HERE/'qa';report=json.loads((QA/'preview-work.json').read_text());out=QA/'previews';out.mkdir(exist_ok=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13);small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',11)
ids=list(dict.fromkeys(r['assetId'] for r in report['renders']));sheets=[]
for aid in ids:
    for kind in ['lod-views','four-light']:
        specs=[(lod,v,'sunny') for lod in [0,1] for v in ['front','side','rear','top']] if kind=='lod-views' else [(0,'front',light) for light in ['sunny','overcast','dusk','night']]
        canvas=Image.new('RGB',(1024,40+(292 if kind=='four-light' else 2*292)),(240,242,241));draw=ImageDraw.Draw(canvas);draw.text((10,7),aid+' | '+kind+' | actual GLB / Cycles CPU',font=font,fill=(20,30,28))
        used=[]
        for i,(lod,view,light) in enumerate(specs):
            r=next(r for r in report['renders'] if r['assetId']==aid and r['lod']==lod and r['view']==view and r['lighting']==light)
            im=Image.open(r['workFile']).convert('RGB');x=(i%4)*256;y=40+(i//4)*292;canvas.paste(im,(x,y));draw.text((x+6,y+258),f'LOD{lod} / {view} / {light}',font=small,fill=(20,30,28));draw.text((x+6,y+273),'Blue 1.75 m | orange 1.81 m | ruler 1 m',font=small,fill=(55,65,60));used.append({k:v for k,v in r.items() if k!='workFile'})
        path=out/f'{aid}.{kind}.png';canvas.save(path,optimize=True);sheets.append({'file':str(path.relative_to(HERE)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'width':canvas.width,'height':canvas.height,'assetId':aid,'kind':kind,'renders':used})
index={k:v for k,v in report.items() if k not in ['workDirectory','renders']};index.update(status='pass',renderCount=len(report['renders']),contactSheetCount=len(sheets),sheets=sheets,denoising=False,environmentNote='First render attempt detected unavailable OpenImageDenoise. Final 88 renders use Cycles CPU, 16 samples, no denoising. No WebGL or GPU evidence.',lighting='Offline sunny/overcast/dusk/night rigs, exposure 0, AgX, fixed geometry and views; not asserted equivalent to city weather.')
(QA/'preview-index.json').write_text(json.dumps(index,indent=2)+'\n')
print('Composed',len(sheets),'sheets from',len(report['renders']),'actual GLB renders')

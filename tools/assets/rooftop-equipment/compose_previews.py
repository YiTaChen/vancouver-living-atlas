"""Label lossless contact sheets from actual CPU rendered inputs; no generated visuals."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
import hashlib
HERE=Path(__file__).resolve().parent
m=json.loads((HERE/'manifest.json').read_text());index=json.loads((HERE/'qa/preview-index.json').read_text())
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',17)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
rows=[]
for a in m['assets']:
 for lod in a['lods']:rows.append((a,lod))
sheets=[]
for label,views in [('lod-views',[('front','clear'),('side','clear'),('back','clear'),('top','clear')]),('four-light-scale',[('scale',x) for x in ['clear','overcast','dusk','night']])]:
 width=4*400;height=72+6*328
 sheet=Image.new('RGB',(width,height),(235,239,242));draw=ImageDraw.Draw(sheet)
 draw.text((16,10),'B01 rooftop equipment | Actual GLB reimport | Cycles CPU 12 samples',font=font,fill=(20,34,42))
 draw.text((16,39),'Metres; paired LOD cameras. Reference people and ruler never enter runtime exports. No WebGL acceptance.',font=small,fill=(45,60,66))
 for ri,(a,lod) in enumerate(rows):
  for ci,(view,condition) in enumerate(views):
   file=HERE/'qa/previews'/f'{a["id"]}.lod{lod["level"]}.{view}.{condition}.png'
   im=Image.open(file).convert('RGB');im.thumbnail((400,300));x=ci*400;y=72+ri*328
   sheet.paste(im,(x,y));draw.text((x+8,y+302),f'{a["id"]} L{lod["level"]} | {view} {condition}',font=small,fill=(20,34,42))
 path=HERE/'qa/previews'/f'{label}.png';sheet.save(path,optimize=True)
 sheets.append({'file':str(path.relative_to(HERE)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'kind':'labelled contact sheet of unmodified render inputs'})
index['contactSheets']=sheets
(HERE/'qa/preview-index.json').write_text(json.dumps(index,indent=2)+'\n')

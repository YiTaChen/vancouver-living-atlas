"""Build labelled contact sheets from the saved actual-GLB preview index.
Does not mark a visual review as passed; inspect the new sheets after rerendering.
"""
import json,hashlib,sys
from pathlib import Path
from PIL import Image,ImageDraw
HERE=Path(__file__).resolve().parent
assembly='--assembly' in sys.argv;indexpath=HERE/('qa/assembly-preview-index.json' if assembly else 'qa/preview-index.json');index=json.loads(indexpath.read_text());sheets=[]
for aid in sorted({p['assetId'] for p in index['images']}):
 rows=[p for p in index['images'] if p['assetId']==aid];sheet=Image.new('RGB',(1280,1380),'#dddddd');draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(rows):
  image=Image.open(HERE/p['file']).resize((426,293));x=(i%3)*426;y=(i//3)*345;sheet.paste(image,(x,y));draw.text((x+5,y+298),f"LOD{p['lod']} / {p['view']} / {p['lighting']}",fill='black')
 relative=f'qa/{aid}{".paired" if assembly else ""}.contact.png';sheet.save(HERE/relative);sheets.append({'file':relative,'sha256':hashlib.sha256((HERE/relative).read_bytes()).hexdigest()})
index.setdefault('visualReview',{'status':'pending'})['contactSheets']=sheets
indexpath.write_text(json.dumps(index,indent=2)+'\n')
print('COMPOSED',len(sheets))

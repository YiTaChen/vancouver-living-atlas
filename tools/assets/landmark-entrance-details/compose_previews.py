"""Contact sheets from actual Cycles PNGs; does not alter/render asset geometry."""
from pathlib import Path
from PIL import Image,ImageDraw
import json
HERE=Path(__file__).resolve().parent;P=HERE/'qa/previews';M=json.loads((HERE/'manifest.json').read_text())
def sheet(files,name,columns=3,w=400,h=425):
    out=Image.new('RGB',(columns*w,((len(files)+columns-1)//columns)*h),'#f2f2f0');d=ImageDraw.Draw(out)
    for i,f in enumerate(files):
        im=Image.open(P/f).convert('RGB');im.thumbnail((w,h-30));x=i%columns*w;y=i//columns*h;out.paste(im,(x+(w-im.width)//2,y+27));d.text((x+8,y+8),f.removesuffix('.png'),fill='black')
    out.save(P/name)
sheet([a['id']+'-lod0-front.png' for a in M['assets']],'template-contact-sheet.png')
sheet([a['id']+f'-lod{l}-front.png' for a in M['assets'] for l in range(3)],'lod-contact-sheet.png',3,350,375)
sheet([a['id']+'-'+view+'.png' for a in M['assets'] for view in ['side','back','top']],'side-back-top-contact-sheet.png',3,350,375)
sheet([assembly+'-'+light+'.png' for assembly in ['waterfront','marine'] for light in ['sunny','overcast','dusk','night']],'lighting-contact-sheet.png',4,360,280)

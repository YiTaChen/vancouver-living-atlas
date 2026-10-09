"""Original deterministic surfaces and redrawn information graphics. No reference pixels."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import random,math
HERE=Path(__file__).resolve().parent
OUT=HERE/'textures'; OUT.mkdir(exist_ok=True)
r=random.Random(6051)
im=Image.new('RGB',(512,512));p=im.load()
for y in range(512):
 for x in range(512):
  q=r.gauss(0,3); c=(94+q,122+q,140+q)
  if r.random()<.065:
   d=r.choice([-29,-19,20,39,54]); c=tuple(a+d for a in c)
  p[x,y]=tuple(max(0,min(255,int(a))) for a in c)
im.save(OUT/'original-rubber-floor.png')
im=Image.new('RGB',(256,256));p=im.load()
for y in range(256):
 for x in range(256):
  weave=6*math.sin(x*math.pi/2)*math.cos(y*math.pi/2)+r.gauss(0,.9)
  p[x,y]=(int(19+weave/2),int(77+weave),int(111+weave))
im.save(OUT/'original-blue-fabric.png')
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; bold=font.replace('.ttf','-Bold.ttf')
def f(s,b=False):return ImageFont.truetype(bold if b else font,s)
im=Image.new('RGB',(1024,1024),(244,246,242));d=ImageDraw.Draw(im)
# The LCD is an original simplified graphic, not a sampled operator screen.
d.rectangle((0,0,1023,76),fill='#006c97');d.text((24,13),'EXPO LINE  |  Waterfront',font=f(35,True),fill='white')
d.line((60,159,960,159),fill='#087ba4',width=7)
for x,t in [(65,'Stadium–Chinatown'),(360,'Granville'),(660,'Burrard'),(945,'Waterfront')]:
 d.ellipse((x-10,149,x+10,169),fill='#edf9fb',outline='#087ba4',width=4)
 xx=max(12,min(855,x-60));d.text((xx,192),t,font=f(18),fill='#07536c')
d.ellipse((644,143,676,175),fill='#ffd500',outline='#087ba4',width=5)
d.text((24,94),'Next station: Burrard',font=f(29,True),fill='#07536c')
d.rectangle((0,256,1024,382),fill='#006987');d.text((24,281),'Please stand clear of doors',font=f(44,True),fill='white')
d.rectangle((0,384,1024,510),fill='#ffd500');d.text((30,413),'For your safety · Please hold on',font=f(40,True),fill='#282c32')
d.rectangle((0,512,1024,638),fill='#428248');d.text((35,533),'BICYCLE AREA',font=f(44,True),fill='white');d.text((38,589),'Use the strap to secure your bicycle',font=f(25),fill='white')
d.rectangle((0,640,1024,766),fill='#005c93');d.text((30,657),'PRIORITY SEATING',font=f(38,True),fill='white');d.text((31,714),'Please offer this seat to someone who needs it',font=f(25),fill='white')
d.rectangle((0,768,1024,894),fill='#bb3c36');d.text((30,788),'EMERGENCY',font=f(39,True),fill='white');d.text((30,844),'Passenger intercom',font=f(29),fill='white')
d.rectangle((0,896,1024,1024),fill='#f5f4ed');d.text((26,920),'MARK V  /  A-CAR STUDY',font=f(43,True),fill='#274255');d.text((29,978),'Representative geometry · Expo Line',font=f(24),fill='#405465')
im.save(OUT/'original-information-atlas.png')
print('Saved original floor, fabric and sign textures')

# Matching low-resolution derivatives for the distant cabin LOD.
for p in OUT.glob('original-*.png'):
 size=256 if 'information' in p.name else 64
 Image.open(p).resize((size,size),Image.Resampling.LANCZOS).save(p.with_name('lod1-'+p.name))

"""Label actual Blender renders consistently; no geometry/image-generation proxy."""
from pathlib import Path
import argparse
import json
from PIL import Image,ImageDraw,ImageFont

HERE=Path(__file__).resolve().parent

def font(size):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',size)


def main():
    p=argparse.ArgumentParser();p.add_argument('--frames',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--lod',type=int,required=True);args=p.parse_args()
    manifest=json.loads((args.output/'manifest.json').read_text())
    board=Image.new('RGB',(1280,2310),(19,28,37));draw=ImageDraw.Draw(board)
    draw.text((28,20),f'MODERN + RESIDENTIAL ARCHITECTURE / LOD {args.lod}',font=font(28),fill=(233,238,239))
    draw.text((28,60),'Original Blender kit | matching camera + lighting | standalone assets, not an integrated city',font=font(18),fill=(160,180,190))
    for i,asset in enumerate(manifest['assets']):
        x=(i%2)*640;y=105+(i//2)*540
        board.paste(Image.open(args.frames/f'{asset["id"]}.png').convert('RGB').resize((600,450),Image.Resampling.LANCZOS),(x+20,y))
        draw.rectangle((x,y+450,x+640,y+540),fill=(25,36,47))
        draw.text((x+16,y+461),f'{i+1:02d}  '+asset['id'],font=font(18),fill=(243,245,240))
        lod=asset['lods'][args.lod];b=lod['bounds'];size=[b['max'][k]-b['min'][k] for k in range(3)]
        draw.text((x+16,y+488),f'{size[0]:.2f} W x {size[1]:.2f} H x {size[2]:.2f} D m | {lod["triangles"]} tris | '+lod['surface'],font=font(17),fill=(166,201,207))
        if asset['role']=='awning':
            draw.text((x+16,y+513),'Source height: 2.36-3.10 m | 2.30 m clear pedestrian zone',font=font(16),fill=(186,204,193))
    draw.text((28,2280),'Shared physical-scale PBR maps | no baked light | independent .blend sources | Vancouver Living Atlas',font=font(17),fill=(157,179,189))
    board.save(args.output/f'preview-lod{args.lod}.png',optimize=True)
    paths=[args.output/f'preview-lod{l}.png' for l in [0,1]]
    if all(path.exists() for path in paths):
        paired=Image.new('RGB',(2560,2310));paired.paste(Image.open(paths[0]),(0,0));paired.paste(Image.open(paths[1]),(1280,0));paired.save(args.output/'preview.png',optimize=True)


if __name__=='__main__':main()

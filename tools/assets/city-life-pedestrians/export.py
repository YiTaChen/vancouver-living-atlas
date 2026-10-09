"""Reopen editable sources and export their actual mesh/attributes, never rebuild them."""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy
ROOT=Path(__file__).resolve().parent;sys.path.insert(0,str(ROOT))
from build import export_object

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--source',type=Path)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=a.out.resolve()
    if out == (ROOT/'exports').resolve():raise ValueError('Use a new directory; review before replacing candidates')
    out.mkdir(parents=True,exist_ok=True);records=[]
    for source in ([a.source.resolve()] if a.source else sorted((ROOT/'source').glob('*.blend'))):
        target=out/(source.stem+'.glb')
        if target.exists():raise ValueError('Refusing existing output '+str(target))
        before=hashlib.sha256(source.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(source))
        bpy.ops.object.select_all(action='DESELECT')
        objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.get('animationContract')=='rigid-limb-v1']
        if len(objects)!=1:raise ValueError('Expected exactly one merged runtime body')
        objects[0].select_set(True);bpy.context.view_layer.objects.active=objects[0];export_object(target)
        after=hashlib.sha256(source.read_bytes()).hexdigest();assert before==after
        records.append(dict(source=source.name,sourceSha256Before=before,sourceSha256After=after,output=target.name,outputSha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    (out/'source-preserving-export.json').write_text(json.dumps(records,indent=2)+'\n')
if __name__=='__main__':main()

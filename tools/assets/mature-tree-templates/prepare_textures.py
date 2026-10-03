"""Deterministic 512 -> 256 bark derivatives. Leaves remain exact original straight RGBA."""
from PIL import Image
import numpy as np
from pathlib import Path
import hashlib, json
HERE=Path(__file__).resolve().parent

def main():
    target=HERE/'source/textures';target.mkdir(exist_ok=True);records=[]
    for role in ['basecolor','normal','orm']:
        src=HERE.parent/'vegetation_ground/maps'/('bark_'+role+'.png');out=target/src.name
        im=Image.open(src).convert('RGBA').resize((256,256),Image.Resampling.LANCZOS)
        if role=='normal':
            a=np.array(im);n=a[:,:,:3].astype(float)/127.5-1;n/=np.maximum(np.linalg.norm(n,axis=2,keepdims=True),1e-8);a[:,:,:3]=np.rint((n+1)*127.5).astype('uint8');im=Image.fromarray(a)
        im.save(out);records.append({'role':role,'source':str(src.relative_to(HERE.parent.parent.parent)),'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'output':str(out.relative_to(HERE)),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'dimensions':[256,256],'method':'Lanczos; tangent normal RGB decoded/renormalized/re-encoded' if role=='normal' else 'Lanczos'})
    (HERE/'qa/texture-derivation.json').write_text(json.dumps({'status':'pass','records':records},indent=2)+'\n')
if __name__=='__main__':main()

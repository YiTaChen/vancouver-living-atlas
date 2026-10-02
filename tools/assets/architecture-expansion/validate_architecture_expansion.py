"""Independent byte/source checks for the offline architecture expansion.

Uses the audited shared GLB reader, adds expansion catalog budgets/provenance,
packed source PBR node-graph checks, strict LOD reduction and immutable contracts.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = HERE.parent/'architecture-details/validate_architecture_details.py'
spec = importlib.util.spec_from_file_location('base_architecture_validation',BASE)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
require, digest, glb, accessor = base.require, base.digest, base.glb, base.accessor
validate_lod = base.validate_lod
clearance_intersections = base.clearance_intersections

# Kept as a separate exported string so the source exporter can reject material
# edits it cannot express instead of silently replacing them with shared maps.
MATERIAL_AUDIT = 'SHARED = '+repr(str(ROOT/'tools/assets/city-materials'))+'\n'+r'''
import bpy, hashlib, json
from pathlib import Path
shared=Path(SHARED)
shared_catalog={item['id']:item for item in json.loads((shared/'catalog.json').read_text())['materials']}
reference_mat=bpy.data.materials.new('Temporary shared-contract reference')
reference_mat.use_nodes=True
reference_bs=reference_mat.node_tree.nodes.get('Principled BSDF')
for ob in bpy.context.scene.objects:
 if ob.type != 'MESH': continue
 for mat in ob.data.materials:
  assert mat.use_nodes and mat.use_backface_culling, 'opaque PBR material required'
  nt=mat.node_tree
  assert all(not n.mute for n in nt.nodes), 'muted shared PBR node'
  surface=mat['city_surface_id']; tile=shared_catalog[surface]['tileMeters']
  assert tuple(mat['physical_tile_metres'])==tuple(tile), 'changed shared physical tile identity'
  by_type={}
  for node in nt.nodes: by_type.setdefault(node.type,[]).append(node)
  assert {k:len(v) for k,v in by_type.items()} == {'BSDF_PRINCIPLED':1,'OUTPUT_MATERIAL':1,'UVMAP':1,'VECT_MATH':1,'TEX_IMAGE':3,'NORMAL_MAP':1,'SEPARATE_COLOR':1}, 'unsupported edited PBR node graph'
  bs=by_type['BSDF_PRINCIPLED'][0]; out=by_type['OUTPUT_MATERIAL'][0]
  uv=by_type['UVMAP'][0]; scale=by_type['VECT_MATH'][0]
  normal=by_type['NORMAL_MAP'][0]; channels=by_type['SEPARATE_COLOR'][0]
  maps={node.image.name.split('-')[-1].split('.')[0]:node for node in by_type['TEX_IMAGE']}
  assert set(maps)=={'color','normal','orm'}
  assert scale.operation=='MULTIPLY' and channels.mode=='RGB'
  assert all(abs(scale.inputs[1].default_value[k]-1/tile[k])<1e-6 for k in [0,1]) and scale.inputs[1].default_value[2]==1, 'changed shared physical repeat multiplier'
  for kind,node in maps.items():
   image=node.image
   assert image.packed_file and not image.is_dirty, 'shared image must be packed and unmodified'
   assert hashlib.sha256(bytes(image.packed_file.data)).hexdigest()==hashlib.sha256((shared/'source/textures'/f'{surface}-{kind}.png').read_bytes()).hexdigest(), 'modified shared packed image bytes'
   assert image.colorspace_settings.name==('sRGB' if kind=='color' else 'Non-Color'), 'changed shared image colorspace'
   assert node.extension=='REPEAT' and node.interpolation=='Linear' and node.projection=='FLAT', 'changed shared sampler contract'
  assert normal.space=='TANGENT' and not uv.from_instancer, 'changed shared UV or normal space'
  for actual_input,reference_input in zip(bs.inputs,reference_bs.inputs):
   if not hasattr(actual_input,'default_value'): continue
   actual_value=actual_input.default_value
   expected_value=1.0 if actual_input.name in ['Roughness','Metallic'] else reference_input.default_value
   if hasattr(actual_value,'__len__') and not isinstance(actual_value,str):
    assert len(actual_value)==len(expected_value) and max(abs(a-b) for a,b in zip(actual_value,expected_value))<1e-6, ('unsupported Principled value',actual_input.name)
   elif isinstance(actual_value,(int,float)):
    assert abs(actual_value-expected_value)<1e-6, ('unsupported Principled value',actual_input.name)
   else: assert actual_value==expected_value, ('unsupported Principled value',actual_input.name)
  assert uv.uv_map==normal.uv_map=='UVMap'
  assert normal.inputs['Strength'].default_value==1
  assert bs.inputs['Roughness'].default_value==bs.inputs['Metallic'].default_value==bs.inputs['Alpha'].default_value==1
  assert bs.inputs['Transmission Weight'].default_value==0
  assert bs.inputs['Emission Strength'].default_value==0
  expected={(bs.name,'BSDF',out.name,'Surface'),(uv.name,'UV',scale.name,'Vector'),
   (scale.name,'Vector',maps['color'].name,'Vector'),(scale.name,'Vector',maps['normal'].name,'Vector'),(scale.name,'Vector',maps['orm'].name,'Vector'),
   (maps['color'].name,'Color',bs.name,'Base Color'),(maps['normal'].name,'Color',normal.name,'Color'),(normal.name,'Normal',bs.name,'Normal'),
   (maps['orm'].name,'Color',channels.name,'Color'),(channels.name,'Green',bs.name,'Roughness'),(channels.name,'Blue',bs.name,'Metallic')}
  actual={(link.from_node.name,link.from_socket.name,link.to_node.name,link.to_socket.name) for link in nt.links}
  assert actual==expected, 'unsupported changed PBR wiring'
bpy.data.materials.remove(reference_mat)
'''

# Run the shared full source UV/hash audit, then independently open every source
# a second time for PBR graph checks (the initial audit leaves only last LOD open).
BLENDER_AUDIT = base.BLENDER_AUDIT + '\nfor asset in manifest["assets"]:\n for lod in asset["lods"]:\n  bpy.ops.wm.open_mainfile(filepath=str(root/lod["source"]))\n  exec('+repr(MATERIAL_AUDIT)+')\nprint("EXPANSION_PBR_AUDIT_PASSED")\n'


def validate(root=HERE, blender=None, skip_blender=False):
    root = Path(root).resolve()
    manifest = json.loads((root/'manifest.json').read_text())
    catalog = json.loads((HERE/'catalog.json').read_text())
    require(manifest['status']=='offline-candidate; no runtime integration','offline status')
    require(manifest['units']=='metres' and manifest['upAxis']=='+Y' and manifest['frontAxis']=='+Z','coordinate contract')
    require([a['id'] for a in manifest['assets']]==[a['id'] for a in catalog['assets']],'exact expansion inventory')
    require(len({a['id'] for a in manifest['assets']})==8,'eight distinct assets')
    provenance = {'catalogSha256':ROOT/'tools/assets/city-materials/catalog.json',
                  'expansionCatalogSha256':HERE/'catalog.json',
                  'builderSha256':HERE/'build_architecture_expansion.py',
                  'sharedHelperSha256':HERE.parent/'architecture-details/build_architecture_details.py'}
    for key,path in provenance.items():
        require(manifest[key]==digest(path),f'current {key} provenance')
    results=[]
    for asset,specification in zip(manifest['assets'],catalog['assets']):
        require(asset['role']==specification['role'] and asset['profiles']==specification['profiles'],'documented integration roles')
        require(asset.get('clearance')==specification.get('clearance'),'authoritative clearance contract')
        require(asset['integrationStatus']=='not-integrated','no runtime integration claim')
        require([lod['level'] for lod in asset['lods']]==[0,1],'independent LOD pair')
        for lod in asset['lods']:
            require(lod['surface']==specification['surface'],'catalog material identity')
            require(lod['triangleCap']==specification['triangleCaps'][lod['level']],'catalog triangle cap')
            require(lod['materials']==lod['primitives']==1,'material and primitive caps')
            require(lod['bytes']<350000,'standalone file byte cap')
            results.append(validate_lod(root,asset,lod))
        fine,coarse=asset['lods']
        require(coarse['triangles']<fine['triangles'],'strict LOD triangle reduction')
        require(all(abs(fine['bounds'][side][k]-coarse['bounds'][side][k])<1e-5 for side in ['min','max'] for k in range(3)),'identical LOD primary bounds')
    status='skipped'
    if not skip_blender:
        binary=blender or shutil.which('blender')
        require(binary,'Blender is required for source verification')
        with tempfile.TemporaryDirectory() as temp:
            script=Path(temp)/'audit.py';script.write_text(BLENDER_AUDIT)
            result=subprocess.run([str(binary),'--background','--factory-startup','--threads','2','--python-exit-code','1','--python',str(script),'--',str(root)],capture_output=True,text=True,timeout=180)
            require(result.returncode==0 and 'EXPANSION_PBR_AUDIT_PASSED' in result.stdout,f'Blender source audit failed:\n{result.stdout}\n{result.stderr}')
        status='passed'
    return {'passed':True,'blenderSources':status,'checks':['exact eight-asset catalog','actual indexed GLB triangles and strict LOD reduction','one material and draw primitive','bounds and single axis conversion','packed PBR map hashes and node wiring','physical metre UVs and GLB repeats','independent saved source hash verification','window/parapet/pedestrian clearance','identical LOD primary bounds','no runtime integration'],
            'sourceFiles':16,'glbFiles':16,'totalTrianglesByLOD':{str(l):sum(a['lods'][l]['triangles'] for a in manifest['assets']) for l in [0,1]},'assets':results}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--root',type=Path,default=HERE)
    parser.add_argument('--blender',type=Path)
    parser.add_argument('--skip-blender',action='store_true')
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    report=validate(args.root,args.blender,args.skip_blender)
    text=json.dumps(report,indent=2)+'\n'
    if args.report:args.report.write_text(text)
    print(text)


if __name__=='__main__':main()

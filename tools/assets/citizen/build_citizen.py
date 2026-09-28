"""Original Vancouver Living Atlas citizen. Blender 4.5+.
No downloaded meshes, textures, mocap, or third-party character code.
Usage: blender -b --factory-startup --python build_citizen.py -- --out PATH [--preview-only] [--atlas-size 2048]
Metres; Blender -Y forward / Z up -> glTF +Z forward / Y up, soles at 0.
"""
import bpy, math, json, sys, argparse, random
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from math import sin, cos, pi, sqrt
args=argparse.ArgumentParser(); args.add_argument('--out',default=str(Path(__file__).parent));args.add_argument('--preview-only',action='store_true');args.add_argument('--atlas-size',type=int,default=2048);args.add_argument('--views',default='front,side,back,walk');args.add_argument('--samples',type=int,default=32)
a=args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);OUT=Path(a.out).resolve();OUT.mkdir(parents=True,exist_ok=True)
random.seed(23)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
SC=bpy.context.scene; SC.unit_settings.system='METRIC';SC.render.engine='CYCLES';SC.cycles.samples=48;SC.cycles.use_denoising=True
SC.world.color=(.18,.18,.18); SC.view_settings.view_transform='AgX';SC.render.image_settings.file_format='PNG'
parts=[]
def mat(name,col,rough=.72,noise=0,scale=140,bump=.001):
 m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Roughness'].default_value=rough
 if noise:
  tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=2;tex.inputs['Roughness'].default_value=.7
  ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.15;ramp.color_ramp.elements[1].position=.85
  ramp.color_ramp.elements[0].color=(*(v*(1-noise) for v in col),1);ramp.color_ramp.elements[1].color=(*(min(1,v*(1+noise)) for v in col),1);l.new(tex.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
  bn=n.new('ShaderNodeBump');bn.inputs['Strength'].default_value=.3;bn.inputs['Distance'].default_value=bump;l.new(tex.outputs['Fac'],bn.inputs['Height']);l.new(bn.outputs[0],p.inputs['Normal'])
 return m
M={
 'shell':mat('Rain shell — spruce woven nylon',(.027,.083,.076),.70,.14,180,.0013),
 'seam':mat('Bound seams — dark spruce',(.035,.087,.082),.79,.2,230,.0007),
 'denim':mat('Indigo cotton denim',(.020,.033,.052),.86,.20,215,.0017),
 'denimseam':mat('Denim raised seam',(.072,.098,.121),.88,.2,180,.0007),
 'skin':mat('Warm neutral skin',(.50,.285,.177),.61,.065,140,.0004),
 'lips':mat('Natural lip',(.34,.14,.105),.58),
 'hair':mat('Short dark brown hair',(.009,.006,.004),.9,.25,200,.001),
 'brow':mat('Brow and eye detail',(.031,.019,.013),.8),
 'eyes':mat('Eye sclera',(.65,.63,.53),.37),
 'iris':mat('Brown iris',(.035,.05,.036),.25),
 'shoe':mat('Weathered leather trainers',(.057,.069,.076),.63,.19,100,.001),
 'sole':mat('Warm grey rubber',(.28,.28,.245),.82,.14,150,.001),
 'lace':mat('Woven laces',(.30,.32,.29),.88,.2,250,.0004),
 'metal':mat('Brushed zipper',(.29,.32,.30),.34),
 'bag':mat('Ochre canvas daypack',(.18,.083,.033),.85,.17,190,.0012),
 'web':mat('Charcoal webbing',(.035,.039,.035),.92,.3,240,.001),
}
M['metal'].node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.65

def finish(obj,name,material,tag,collect=True):
 obj.name=name;obj.data.materials.clear();obj.data.materials.append(M[material]);obj['region']=tag
 for p in obj.data.polygons:p.use_smooth=True
 if collect:parts.append(obj)
 return obj

def mesh(name,verts,faces,material,tag,collect=True):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);return finish(o,name,material,tag,collect)

def ell(name,loc,size,material,tag,seg=24,rings=16,collect=True):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=loc);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,material,tag,collect)

def loft(name,prof,material,tag,n=40,ripple=0,collect=True):
 # profiles: z, centerX, centerY, radiusX, radiusY. Closed, continuous ring surface.
 v=[];f=[]
 for j,(z,x,y,rx,ry) in enumerate(prof):
  for i in range(n):
   ang=2*pi*i/n; k=1+ripple*(.55*sin(ang*5+z*31)+.45*sin(ang*9-z*43))*sin(pi*j/(len(prof)-1))
   v.append((x+rx*cos(ang)*k,y+ry*sin(ang)*k,z))
 for j in range(len(prof)-1):
  for i in range(n):f.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 f.append(tuple(reversed(range(n))));f.append(tuple((len(prof)-1)*n+i for i in range(n)))
 return mesh(name,v,f,material,tag,collect)

def join_remesh(objs,name,material,tag,voxel=.006,ratio=.65,smooth=3):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objs:o.select_set(True)
 bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();o=objs[0];o.name=name
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 md=o.modifiers.new('Continuous surface union','REMESH');md.mode='VOXEL';md.voxel_size=voxel;md.use_smooth_shade=True;bpy.ops.object.modifier_apply(modifier=md.name)
 md=o.modifiers.new('Surface relax','SMOOTH');md.factor=.55;md.iterations=smooth;bpy.ops.object.modifier_apply(modifier=md.name)
 md=o.modifiers.new('Budget topology','DECIMATE');md.ratio=ratio;bpy.ops.object.modifier_apply(modifier=md.name)
 for x in objs:
  if x in parts:parts.remove(x)
 return finish(o,name,material,tag)

def curve(name,pts,radius,material,tag,res=2):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=3;c.bevel_depth=radius;c.bevel_resolution=res
 s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
 for b,p in zip(s.bezier_points,pts):b.co=p;b.handle_left_type=b.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');return finish(o,name,material,tag)

def panel(name,pts,width,material,tag,depth=.004):
 # A smooth flat woven strip through 3D points; avoids cylinder-like bag straps.
 v=[];f=[]
 for p in pts:v.extend([(p[0]-width/2,p[1],p[2]),(p[0]+width/2,p[1],p[2])])
 for i in range(len(pts)-1):f.append((i*2,i*2+1,i*2+3,i*2+2))
 o=mesh(name,v,f,material,tag);bpy.context.view_layer.objects.active=o
 so=o.modifiers.new('Fabric thickness','SOLIDIFY');so.thickness=depth;bpy.ops.object.modifier_apply(modifier=so.name)
 be=o.modifiers.new('Soft binding edge','BEVEL');be.width=.002;be.segments=2;bpy.ops.object.modifier_apply(modifier=be.name)
 return o

# Tailored rain shell. Arms and torso are unioned to eliminate primitive intersections.
jack=[loft('Tailored torso',[(.835,0,.006,.176,.12),(.865,0,.006,.184,.125),(.98,0,.0,.181,.128),(1.10,0,0,.166,.111),(1.23,0,.007,.184,.128),(1.34,0,.014,.213,.13),(1.40,0,.014,.218,.108),(1.45,0,.011,.172,.084),(1.47,0,.008,.080,.068)],'shell','jacket',48,.015,False)]
for s in [-1,1]:
 jack.append(loft('Continuous sleeve',[(.885,s*.302,-.012,.044,.042),(.92,s*.307,-.010,.052,.046),(1.00,s*.310,-.002,.055,.049),(1.10,s*.294,.002,.062,.055),(1.16,s*.282,.004,.065,.061),(1.27,s*.258,.009,.071,.068),(1.36,s*.221,.011,.081,.077),(1.40,s*.205,.012,.078,.075),(1.43,s*.183,.012,.060,.058),(1.454,s*.15,.012,.026,.025)],'shell','jacket',32,.035,False))
join_remesh(jack,'Continuous rain shell','shell','jacket',.0055,.58,3)
loft('Standing collar',[(1.423,0,.001,.083,.073),(1.44,0,.001,.086,.074),(1.49,0,.006,.070,.062),(1.50,0,.006,.065,.058)],'seam','chest',40)
loft('Warm crewneck at collar',[(1.451,0,0,.062,.053),(1.50,0,0,.055,.049)],'web','chest',32)
loft('Neck',[(1.455,0,.005,.047,.045),(1.515,0,.005,.046,.046),(1.55,0,.005,.052,.047),(1.58,0,.005,.040,.037)],'skin','head',36)
# Seams, hem, fitted storm zip, sleeve cuffs, and pocket openings.
curve('Jacket zip tape',[(0,-.102,.861),(0,-.12,.97),(0,-.116,1.11),(0,-.128,1.25),(0,-.104,1.4),(0,-.067,1.47)],.004,'seam','jacket')
curve('Metal zip teeth',[(0,-.107,.868),(0,-.124,.97),(0,-.120,1.11),(0,-.132,1.25),(0,-.108,1.40),(0,-.071,1.47)],.0015,'metal','jacket',1)
for s in [-1,1]:
 curve('Diagonal welt pocket',[(s*.065,-.119,1.055),(s*.10,-.11,1.011),(s*.132,-.087,.964)],.004,'seam','jacket')
 curve('Pocket binding',[(s*.071,-.119,1.056),(s*.106,-.11,1.011),(s*.138,-.084,.964)],.0014,'shell','jacket',1)
 curve('Raglan seam',[(s*.067,-.054,1.452),(s*.136,-.085,1.411),(s*.201,-.089,1.335),(s*.226,-.055,1.284)],.0016,'seam','jacket',1)
 loft('Elastic cuff',[(.887,s*.302,-.012,.046,.044),(.915,s*.305,-.011,.048,.046)],'seam','fore'+str(s),32,.01)
 for z in [.875,.881]:curve('Hem topstitch',[(.16*cos(t),.009+.109*sin(t),z) for t in [2*pi*i/48 for i in range(49)]],.0009,'seam','hips',1)
ell('Zip pull',(0,-.13,1.31),(.007,.003,.017),'metal','chest',16,10)

# Jeans: pelvis unioned into tapering legs, with real front/back thickness and gentle folds.
pant=[loft('Pelvis denim',[(.78,0,.005,.115,.08),(.85,0,.005,.157,.106),(.94,0,.006,.162,.108),(.965,0,.006,.148,.096)],'denim','pants',40,.01,False)]
for s in [-1,1]:
 pant.append(loft('Tailored denim leg',[(.128,s*.091,.014,.049,.049),(.17,s*.091,.014,.053,.053),(.23,s*.09,.016,.051,.053),(.34,s*.091,.011,.059,.063),(.45,s*.092,-.010,.059,.061),(.52,s*.09,-.015,.062,.069),(.63,s*.09,.003,.075,.082),(.77,s*.085,.007,.084,.092),(.86,s*.08,.006,.087,.097),(.91,s*.078,.005,.089,.093)],'denim','pants',36,.024,False))
join_remesh(pant,'Continuous tailored denim','denim','pants',.005,.55,3)
for s in [-1,1]:
 curve('Outer leg double seam',[(s*.157,.014,.86),(s*.161,.014,.73),(s*.15,.005,.62),(s*.149,-.005,.49),(s*.15,.009,.38),(s*.145,.014,.25),(s*.14,.013,.146)],.0012,'denimseam','pants',1)
 loft('Denim cuff',[(.135,s*.091,.014,.05,.05),(.15,s*.091,.014,.051,.051)],'denimseam','shin'+str(s),32)
 # subtle fabric folds as shallow grooves rather than chunky rings
 for z,shift in [(.21,.2),(.42,1.0),(.51,-.6)]:
  curve('Denim fold',[(s*.091+.046*cos(t),.014-.052*sin(t),z+.007*sin(t*2+shift)) for t in [.15,.55,1.,1.4,1.9,2.5,3.]],.0014,'denimseam','pants',1)

# Human head: cheek, jaw, temple, skull profile; nose and ears blend into a continuous skin surface.
head=[loft('Head anatomical profile',[(1.525,0,-.019,.028,.036),(1.54,0,-.012,.046,.055),(1.56,0,-.001,.060,.069),(1.60,0,.004,.075,.079),(1.645,0,.003,.080,.086),(1.684,0,.006,.081,.083),(1.73,0,.011,.078,.079),(1.77,0,.013,.058,.060),(1.794,0,.013,.022,.025)],'skin','head',48,0,False)]
# Subdivide the base head, then sculpt broad anatomical planes and a blended
# nasal bridge directly into the surface rather than attaching facial spheres.
bpy.context.view_layer.objects.active=head[0]
md=head[0].modifiers.new('Facial topology','SUBSURF');md.levels=2;bpy.ops.object.modifier_apply(modifier=md.name)
for ve in head[0].data.vertices:
 x,y,z=ve.co
 if y<-.018:
  face=cl((-y-.018)/.055) if 'cl' in globals() else max(0,min(1,(-y-.018)/.055))
  nose=.033*math.exp(-(x/.014)**2-((z-1.641)/.027)**2)+.006*math.exp(-(x/.020)**2-((z-1.628)/.009)**2)
  cheeks=.004*(math.exp(-((x-.039)/.025)**2)+math.exp(-((x+.039)/.025)**2))*math.exp(-((z-1.641)/.030)**2)
  sockets=.005*(math.exp(-((x-.034)/.017)**2)+math.exp(-((x+.034)/.017)**2))*math.exp(-((z-1.670)/.009)**2)
  ve.co.y-=(nose+cheeks-sockets)*face
for s in [-1,1]:
 head.append(ell('Ear',(s*.081,.008,1.637),(.015,.018,.028),'skin','head',24,16,False))

join_remesh(head,'Anatomical head and ears','skin','head',.0021,.60,2)
for s in [-1,1]:
 ell('Ear concha',(s*.090,-.006,1.638),(.005,.0027,.013),'lips','head',16,10)
 # eyes remain small and seated behind lids
 ell('Eye',(s*.034,-.0815,1.669),(.014,.008,.0067),'eyes','head',24,12)
 ell('Iris',(s*.034,-.0891,1.669),(.0047,.0014,.0049),'iris','head',20,12)
 ell('Pupil',(s*.034,-.0900,1.669),(.0023,.0008,.0028),'brow','head',16,10)
 curve('Upper eyelid',[(s*.034-.014,-.082,1.668),(s*.034-.007,-.088,1.675),(s*.034+.005,-.088,1.675),(s*.034+.014,-.082,1.669)],.0022,'skin','head',2)
 curve('Lower eyelid',[(s*.034-.014,-.082,1.668),(s*.034,-.088,1.664),(s*.034+.014,-.082,1.669)],.0015,'skin','head',2)
 curve('Eyebrow',[(s*.019,-.083,1.688),(s*.032,-.084,1.691),(s*.048,-.078,1.688)],.0024,'hair','head',2)
 ell('Nostril',(s*.009,-.1015,1.628),(.0042,.0018,.0025),'lips','head',16,10)
curve('Mouth line',[(-.021,-.077,1.59),(-.01,-.083,1.590),(0,-.085,1.590),(.01,-.083,1.590),(.021,-.077,1.59)],.0013,'lips','head',2)
curve('Lower lip',[(-.017,-.079,1.587),(0,-.086,1.586),(.017,-.079,1.587)],.0023,'lips','head',2)
# Short swept crop: shape conforms to skull with an irregular temple/forehead hairline.
v=[];f=[];hs=64;hr=15
for j in range(hr+1):
 for i in range(hs):
  th=2*pi*i/hs;front=max(0,-sin(th)); back=max(0,sin(th));end=1.9-.65*front+.12*back+.06*sin(th*5)
  q=(j/hr)*end;ruff=1+.018*sin(th*7+q*3)+.009*sin(th*17-q*5)
  v.append((.085*sin(q)*cos(th)*ruff+.009*cos(q)**2,.012+.088*sin(q)*sin(th)*ruff,1.691+.114*cos(q)+.005*sin(th*3)*sin(q)))
for j in range(hr):
 for i in range(hs):f.append((j*hs+i,j*hs+(i+1)%hs,(j+1)*hs+(i+1)%hs,(j+1)*hs+i))
mesh('Cropped swept hair',v,f,'hair','head')
for k in range(30):
 th=2*pi*k/30;q=.25+(k%4)*.15;pts=[]
 for n in range(5):
  t=q+n*.11;ang=th+.18*n;pts.append((.086*sin(t)*cos(ang)+.009*cos(t)**2,.012+.089*sin(t)*sin(ang),1.692+.116*cos(t)))
 curve('Hair swept ridge',pts,.0018,'hair','head',1)

# Hands: palm with knuckle transition, four individually tapered fingers and a posed thumb.
for s in [-1,1]:
 tag='hand'+str(s);xx=s*.302
 hp=[loft('Palm',[(.798,xx,-.009,.028,.012),(.828,xx,-.010,.035,.020),(.86,xx,-.009,.029,.023),(.901,xx,-.008,.022,.023)],'skin',tag,28,0,False)]
 for i in range(4):
  x=xx+(i-1.5)*.016;length=[.063,.075,.07,.055][i];z=.813
  hp.append(loft('Tapered finger',[(z-length,x,-.011,.004,.004),(z-length+.007,x,-.016,.0065,.006),(z-length*.46,x,-.019,.0075,.007),(z,x,-.012,.008,.009)],'skin',tag,12,0,False))
 hp.append(loft('Thumb',[(.801,xx-s*.038,-.027,.005,.006),(.822,xx-s*.041,-.023,.010,.010),(.853,xx-s*.025,-.013,.014,.014)],'skin',tag,16,0,False))
 join_remesh(hp,'Continuous hand '+str(s),'skin',tag,.0028,.6,2)

# Trainers with separate outsole, toe box, quarters, tongue, stitched overlays, eyelets, and laces.
for s in [-1,1]:
 x=s*.091;tag='foot'+str(s)
 # Foot length 26 cm, heel +0.085, toe -0.175. Floor = 0.
 loft('Rubber outsole',[(.003,x,-.038,.055,.122),(.01,x,-.043,.066,.135),(.033,x,-.044,.067,.134),(.039,x,-.044,.062,.129)],'sole',tag,48)
 loft('Leather trainer upper',[(.034,x,-.042,.062,.126),(.065,x,-.039,.061,.125),(.087,x,-.024,.057,.108),(.115,x,.013,.043,.055),(.149,x,.022,.037,.042)],'shoe',tag,48,.005)
 loft('Shoe collar',[(.131,x,.019,.043,.048),(.151,x,.020,.039,.044)],'web',tag,32)
 panel('Padded shoe tongue',[(x,-.111,.07),(x,-.084,.084),(x,-.055,.104),(x,-.025,.123),(x,-.008,.143)],.038,'shoe',tag,.007)
 for yy,z in [(-.095,.080),(-.075,.091),(-.055,.104),(-.035,.119)]:
  curve('Shoe lace',[(x-.021,yy+.004,z),(x,yy-.006,z+.003),(x+.021,yy+.004,z)],.0015,'lace',tag,2)
 curve('Toe seam',[(x+.052*cos(t),-.043+.115*sin(t),.067) for t in [pi+i*pi/20 for i in range(21)]],.0013,'web',tag,1)
 for ss in [-1,1]:curve('Shoe side seam',[(x+ss*.049,.067,.060),(x+ss*.058,.015,.073),(x+ss*.059,-.04,.070),(x+ss*.047,-.105,.068)],.0015,'lace',tag,1)
 for i in range(6):curve('Sole tread notch',[(x-.05,-.143+i*.038,.012),(x+.05,-.143+i*.038,.012)],.0013,'web',tag,1)

# Daypack with padded harness, curved zipper and original unbranded patch.
loft('Canvas daypack',[(.98,0,.137,.075,.036),(1.01,0,.150,.115,.059),(1.12,0,.163,.133,.070),(1.28,0,.160,.125,.064),(1.39,0,.139,.100,.048),(1.425,0,.117,.06,.026)],'bag','chest',40,.012)
loft('Backpack front pocket',[(1.033,0,.216,.071,.019),(1.055,0,.224,.101,.023),(1.17,0,.224,.100,.02),(1.19,0,.219,.08,.014)],'bag','chest',32)
curve('Backpack pocket zip',[(-.085,.24,1.183),(0,.246,1.185),(.085,.24,1.183)],.002,'web','chest',1)
curve('Pack main zip',[(-.108,.180,1.06),(-.116,.185,1.27),(-.087,.165,1.385),(0,.15,1.411),(.087,.165,1.385),(.116,.185,1.27),(.108,.180,1.06)],.0023,'web','chest',1)
for s in [-1,1]:
 panel('Backpack padded strap',[(s*.081,.134,1.396),(s*.108,.082,1.421),(s*.118,.012,1.449),(s*.119,-.065,1.418),(s*.126,-.094,1.324),(s*.13,-.081,1.18),(s*.15,-.065,1.08)],.03,'web','chest',.006)
 curve('Strap edge stitch',[(s*.10,.082,1.421),(s*.11,.012,1.449),(s*.11,-.065,1.418),(s*.117,-.094,1.324),(s*.121,-.081,1.18)],.0008,'sole','chest',1)
curve('Backpack carry loop',[(-.029,.130,1.409),(-.023,.143,1.457),(.023,.143,1.457),(.029,.130,1.409)],.004,'web','chest',2)

# Adult head proportions: compress the cranial volume without shortening the
# visible neck or changing its attachment. Facial elements retain registration.
for ob in parts:
 if ob.get('region')=='head' and ob.name!='Neck':
  for ve in ob.data.vertices:
   wp=ob.matrix_world@ve.co;wp.z=1.80+(wp.z-1.80)*.90;ve.co=ob.matrix_world.inverted()@wp
# Weighted 22-joint skeleton. Semantic region weights preserve facial and accessory shapes.
arm=bpy.data.armatures.new('Citizen skeleton');rig=bpy.data.objects.new('CitizenRig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
bones={}
def bone(n,h,t,p=None):
 b=arm.edit_bones.new(n);b.head=h;b.tail=t
 if p:b.parent=bones[p]
 bones[n]=b
bone('root',(0,0,0),(0,0,.15));bone('hips',(0,0,.93),(0,0,1.05),'root');bone('spine',(0,0,1.05),(0,0,1.22),'hips');bone('chest',(0,0,1.22),(0,0,1.43),'spine');bone('neck',(0,0,1.43),(0,0,1.54),'chest');bone('head',(0,0,1.54),(0,0,1.79),'neck')
for s in [-1,1]:
 suf='L' if s>0 else 'R'
 bone('clavicle'+suf,(s*.045,0,1.405),(s*.212,.009,1.405),'chest')
 bone('upperArm'+suf,(s*.212,.009,1.405),(s*.290,.002,1.125),'clavicle'+suf)
 bone('foreArm'+suf,(s*.290,.002,1.125),(s*.302,-.010,.898),'upperArm'+suf)
 bone('hand'+suf,(s*.302,-.010,.898),(s*.302,-.011,.775),'foreArm'+suf)
 bone('thigh'+suf,(s*.091,0,.93),(s*.091,-.010,.505),'hips')
 bone('shin'+suf,(s*.091,-.010,.505),(s*.091,.018,.13),'thigh'+suf)
 bone('foot'+suf,(s*.091,.018,.13),(s*.091,-.125,.048),'shin'+suf)
 bone('toe'+suf,(s*.091,-.125,.048),(s*.091,-.176,.03),'foot'+suf)
bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
def cl(x):return max(0,min(1,x))
def pelvis_weights(x,z):
 # Match both layers through a continuous waist-to-thigh transition. A hard
 # split at z=.86 previously let denim jump through the shell during a stride.
 thigh=cl((.98-z)/.19);blend=cl((z-.73)/.09)
 left=blend*(.5+.5*math.tanh(x/.045))+(1-blend)*(1 if x>=0 else 0)
 return {'hips':1-thigh,'thighL':thigh*left,'thighR':thigh*(1-left)}
def skinweights(o):
 tag=o['region'];groups={n:o.vertex_groups.new(name=n) for n in arm.bones.keys()}
 for ve in o.data.vertices:
  x,y,z=o.matrix_world@ve.co;s=1 if x>=0 else -1;sf='L' if s>0 else 'R'
  if tag.startswith('hand'):w={'hand'+sf:1}
  elif tag.startswith('foot'):w={'foot'+sf:1}
  elif tag.startswith('fore'):w={'foreArm'+sf:1}
  elif tag.startswith('shin'):w={'shin'+sf:1}
  elif tag=='head':w={'head':1}
  elif tag=='hips':w={'hips':1}
  elif tag=='chest':w={'chest':1}
  elif tag=='pants':
   if z>.59:w=pelvis_weights(x,z)
   else:t=cl((.58-z)/.14);w={'thigh'+sf:1-t,'shin'+sf:t}
  elif tag=='jacket':
   # Connected raglan shoulder smooths upper-arm-to-chest transition.
   aw=cl((abs(x)-.168)/.07)*cl((1.48-z)/.14)
   if z<1.26:aw=cl((abs(x)-.192)/.044)
   fore=cl((1.205-z)/.155)
   chest=cl((z-1.1)/.20);spine=cl((z-.9)/.20)
   w={'chest':(1-aw)*chest,'spine':(1-aw)*(1-chest)*spine,'hips':(1-aw)*(1-chest)*(1-spine),'upperArm'+sf:aw*(1-fore),'foreArm'+sf:aw*fore}
  else:w={'hips':1}
  if tag in ('jacket','hips') and z<1.01 and abs(x)<.20:
   # A rain-shell hem rests over the upper thighs. Let each half drape with
   # its leg so long strides cannot poke the denim through a rigid coat skirt.
   cloth=cl((1.01-z)/.03)
   w={n:wt*(1-cloth) for n,wt in w.items()}
   for n,wt in pelvis_weights(x,z).items():w[n]=w.get(n,0)+cloth*wt
  for n,wt in w.items():
   if wt>1e-5:groups[n].add([ve.index],wt,'REPLACE')
for o in parts:skinweights(o)
# One mesh with source material slots; final bake creates a single GPU material.
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();cit=bpy.context.object;cit.name='Citizen_surface';cit.parent=rig
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
# A bounded exported topology budget, preserving skin weights and silhouette while
# simplifying the dense voxel union. Apply before UV generation so atlas islands
# belong to exactly the exported mesh.
cit.data.calc_loop_triangles()
source_triangles=len(cit.data.loop_triangles)
if source_triangles>38000:
 budget=cit.modifiers.new('38k triangle production budget','DECIMATE');budget.ratio=37800/source_triangles
 bpy.context.view_layer.objects.active=cit;bpy.ops.object.modifier_apply(modifier=budget.name)
# Stable manifold normals and UV unwrap, respecting all disconnected accessory seams.
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.008,area_weight=.3);bpy.ops.object.mode_set(mode='OBJECT')
mod=cit.modifiers.new('Skin deformation','ARMATURE');mod.object=rig
tri=cit.modifiers.new('Triangulate export','TRIANGULATE');bpy.context.view_layer.objects.active=cit;bpy.ops.object.modifier_apply(modifier=tri.name)
triangles=len(cit.data.polygons)
print('ASSET_GEOMETRY',len(cit.data.vertices),triangles,flush=True)

# Bake material appearance including fine fabric grain into portable glTF images.
if not a.preview_only:
 SC.cycles.samples=8;SC.render.bake.margin=10;SC.render.bake.use_clear=True
 imgs={}
 for kind,colspace in [('BaseColor','sRGB'),('Roughness','Non-Color'),('Normal','Non-Color')]:
  im=bpy.data.images.new('Citizen_'+kind,width=a.atlas_size,height=a.atlas_size,alpha=False);im.colorspace_settings.name=colspace;imgs[kind]=im
  for m in cit.data.materials:
   if not m.use_nodes:continue
   ns=m.node_tree.nodes
   for no in ns:no.select=False
   no=ns.new('ShaderNodeTexImage');no.image=im;no.select=True;ns.active=no
  typ={'BaseColor':'DIFFUSE','Roughness':'ROUGHNESS','Normal':'NORMAL'}[kind]
  bpy.ops.object.select_all(action='DESELECT');cit.select_set(True);bpy.context.view_layer.objects.active=cit
  if kind=='BaseColor':bpy.ops.object.bake(type=typ,pass_filter={'COLOR'})
  else:bpy.ops.object.bake(type=typ)
  im.filepath_raw=str(OUT/(im.name+'.png'));im.file_format='PNG';im.save();im.pack()
  print('BAKED',kind,flush=True)
 atlas=mat('Citizen PBR atlas',(.7,.7,.7));ns=atlas.node_tree.nodes;ls=atlas.node_tree.links;p=ns.get('Principled BSDF')
 for k in imgs:
  n=ns.new('ShaderNodeTexImage');n.image=imgs[k]
  if k=='BaseColor':ls.new(n.outputs['Color'],p.inputs['Base Color'])
  elif k=='Roughness':ls.new(n.outputs['Color'],p.inputs['Roughness'])
  else:nn=ns.new('ShaderNodeNormalMap');ls.new(n.outputs['Color'],nn.inputs['Color']);ls.new(nn.outputs['Normal'],p.inputs['Normal'])
 cit.data.materials.clear();cit.data.materials.append(atlas)
 for p in cit.data.polygons:p.material_index=0

# Baked locomotion. A two-link geometric solve plants each foot during stance.
rest={b.name:b.matrix_local.copy() for b in arm.bones};lengths={b.name:b.length for b in arm.bones}
for pb in rig.pose.bones:pb.rotation_mode='QUATERNION'
def clear_pose():
 for p in rig.pose.bones:p.matrix_basis=Matrix.Identity(4)
def orient(n,h,t):
 old=rest[n].to_quaternion();d=Vector(t)-Vector(h);q=old@Vector((0,1,0));delta=q.rotation_difference(d.normalized());rig.pose.bones[n].matrix=Matrix.Translation(Vector(h))@(delta@old).to_matrix().to_4x4()
def pose(kind,t):
 clear_pose();tau=t*2*pi;moving=kind!='idle';run=kind=='run'
 hipz=.93 if not moving else .919+(.008 if not run else .018)*cos(2*tau)
 # Keep the feet grounded without stretching the skin below the knee. The
 # desired ankle must fit inside BOTH two-link leg reach envelopes; merely
 # clamping the IK solve distance while leaving its target untouched causes a
 # 4–7 cm gap between the animated shin endpoint and the shoe at long strides.
 feet={}
 for s in [-1,1]:
  sf='L' if s>0 else 'R';phase=(t+(0 if s>0 else .5))%1
  if moving:
   stance=.57 if not run else .38;reach=.285 if not run else .36
   if phase<stance:
    u=phase/stance;fy=-reach+2*reach*u;lift=0
   else:
    u=(phase-stance)/(1-stance);smooth=u*u*(3-2*u);fy=reach-2*reach*smooth;lift=(.095 if not run else .23)*sin(pi*u)**1.1
  else:fy=0;lift=0
  feet[s]=Vector((s*.091,fy+.018,.13+lift))
  reach_limit=lengths['thigh'+sf]+lengths['shin'+sf]-.004
  hipz=min(hipz,feet[s].z+sqrt(max(.0001,reach_limit*reach_limit-feet[s].y*feet[s].y)))
 rig.pose.bones['hips'].location=rest['hips'].to_quaternion().inverted()@Vector((0,0,hipz-.93))
 rig.pose.bones['spine'].rotation_quaternion=Quaternion((1,0,0),(.025 if moving else 0)+.006*sin(tau))
 q=rest['chest'].to_quaternion();rig.pose.bones['chest'].rotation_quaternion=q.inverted()@Quaternion((0,0,1),(.023 if moving else .008)*sin(tau))@q
 q=rest['head'].to_quaternion();rig.pose.bones['head'].rotation_quaternion=q.inverted()@Quaternion((0,0,1),(-.014 if moving else .035)*sin(tau))@q
 bpy.context.view_layer.update()
 for s in [-1,1]:
  sf='L' if s>0 else 'R';phase=(t+(0 if s>0 else .5))%1
  H=Vector((s*.091,0,hipz));F=feet[s];D=F-H;dist=min(D.length,lengths['thigh'+sf]+lengths['shin'+sf]-.0001);d=D.normalized();l1=lengths['thigh'+sf];l2=lengths['shin'+sf];along=(l1*l1-l2*l2+dist*dist)/(2*dist)
  forward=Vector((0,-1,0));bend=(forward-d*forward.dot(d)).normalized();K=H+d*along+bend*sqrt(max(0,l1*l1-along*along))
  orient('thigh'+sf,H,K);bpy.context.view_layer.update();orient('shin'+sf,K,F);bpy.context.view_layer.update()
  pb=rig.pose.bones['foot'+sf];pb.matrix=Matrix.Translation(F)@rest['foot'+sf].to_quaternion().to_matrix().to_4x4();bpy.context.view_layer.update()
  # Arms counter-swing. Rest elbow slight flex with forearm bias; restrained shoulder motion.
  swing=(.38 if not run else .65)*sin(phase*2*pi) if moving else .015*sin(tau+s)
  pb=rig.pose.bones['upperArm'+sf];q=rest['upperArm'+sf].to_quaternion();world=Quaternion((1,0,0),-swing);pb.rotation_quaternion=q.inverted()@world@q
  pb=rig.pose.bones['foreArm'+sf];q=rest['foreArm'+sf].to_quaternion();world=Quaternion((1,0,0),-.10-(.12 if not run else .8)*(0.5+.5*cos(phase*2*pi)) if moving else -.08);pb.rotation_quaternion=q.inverted()@world@q
 bpy.context.view_layer.update()
SC.render.fps=30
clips=[]
for name,count,duration,stride in [('idle',60,2.0,0),('walk',30,1.0,1.0),('run',24,.8,1.9)]:
 rig.animation_data_create();action=bpy.data.actions.new(name);rig.animation_data.action=action;action.use_fake_user=True
 for frame in range(count+1):
  SC.frame_set(frame);pose(name,frame/count)
  for pb in rig.pose.bones:
   pb.keyframe_insert('location',frame=frame,group=pb.name);pb.keyframe_insert('rotation_quaternion',frame=frame,group=pb.name);pb.keyframe_insert('scale',frame=frame,group=pb.name)
 clips.append({'name':name,'duration':duration,'strideMetres':stride})
rig.animation_data.action=None;clear_pose();SC.frame_set(0);bpy.context.view_layer.update()
if not a.preview_only:
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);cit.select_set(True);bpy.context.view_layer.objects.active=rig
 bpy.ops.export_scene.gltf(filepath=str(OUT/'vancouver-citizen.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_anim_single_armature=True,export_merge_animation='ACTION',export_skins=True,export_yup=True,export_image_format='AUTO',export_apply=False,export_extras=True)

# QA studio. It is never selected for GLB export.
SC.cycles.samples=a.samples
floor=mat('Studio ground',(.18,.205,.22),.82)
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.name='Preview_ground';ground.data.materials.append(floor);ground.location.z=-.005
SC.world.use_nodes=True;SC.world.node_tree.nodes['Background'].inputs[0].default_value=(.23,.28,.32,1);SC.world.node_tree.nodes['Background'].inputs[1].default_value=.4
for name,loc,power,size in [('Key',(-3,-4,5),650,4),('Fill',(3,-1,3),380,3),('Rim',(1,3,4),850,2.5)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('QA camera');cam=bpy.data.objects.new('QA camera',d);bpy.context.collection.objects.link(cam);SC.camera=cam;d.type='ORTHO';d.ortho_scale=2.12
SC.render.resolution_x=920;SC.render.resolution_y=1080;SC.render.resolution_percentage=100
for name,loc,look,anim,t in [('front',(2.1,-4.8,2.1),(0,0,.92),'idle',0),('side',(4,-.3,1.9),(0,0,.92),'idle',0),('back',(-2,4.5,2),(0,0,.92),'idle',0),('walk',(2.3,-4.8,2.1),(0,0,.92),'walk',.20)]:
 if name not in a.views.split(','):continue
 rig.animation_data.action=None;pose(anim,t);cam.location=loc;cam.rotation_euler=(Vector(look)-cam.location).to_track_quat('-Z','Y').to_euler();SC.render.filepath=str(OUT/('preview-'+name+'.png'));bpy.ops.render.render(write_still=True)
rig.animation_data.action=None;clear_pose();bpy.context.view_layer.update()
# Save full reproducible editable scene with studio hidden only in viewport.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'vancouver-citizen.blend'))
meta={'name':'Original Vancouver citizen','authoring':'Procedural original geometry and baked procedural PBR, no external source assets','generator':'build_citizen.py, Blender '+bpy.app.version_string,'heightMetres':1.81,'forward':'+Z','up':'+Y','groundY':0,'vertices':len(cit.data.vertices),'triangles':triangles,'joints':len(arm.bones),'materialSlots':len(cit.data.materials),'textureSize':a.atlas_size,'animations':clips,'runtimeNotes':'In-place animation. Distance-driven clip sampling; each navigator owns its GLB and GPU resources. Keep procedural fallback until loading completes. Both legs obey reach bounds; shared continuous pelvis skinning aligns layered coat/denim deformation. Neck overlaps the compressed head. CPU tests sample 40 poses per clip for grounded soles and intact shin-to-ankle attachment.','license':'Repository LICENSE','exportedBytes':(OUT/'vancouver-citizen.glb').stat().st_size if not a.preview_only else None,'gpuTextureEstimateMiB':round(3*a.atlas_size*a.atlas_size*4*(4/3)/(1024*1024),1)}
(OUT/'metadata.json').write_text(json.dumps(meta,indent=2));print('DELIVERED',json.dumps(meta),flush=True)

import * as THREE from 'three';
import { sunAngle } from './clock';
import {
  DEFAULT_SKY,
  MOON_PHASES,
  NightSkyCycle,
  normalizeSky,
  type SkySettings,
} from './sky-state';

/** Camera-centred distant sky; opaque city geometry still occludes every effect.
 * Two draws, no texture downloads, shadow casters or per-frame geometry builds.
 */
export class SkyEffects {
  settings = { ...DEFAULT_SKY };
  qaTime: number | null = null;
  readonly group = new THREE.Group();
  private cycle = new NightSkyCycle();
  private stars: THREE.Points;
  private dome: THREE.Mesh;
  private uniforms = {
    sunDir: { value: new THREE.Vector3() },
    moonDir: { value: new THREE.Vector3() },
    hour: { value: 16 },
    night: { value: 0 },
    phase: { value: 0.25 },
    eclipse: { value: 0 },
    sunOn: { value: 1 },
    moonOn: { value: 1 },
    aurora: { value: 0 },
    density: { value: 0.45 },
    time: { value: 0 },
    meteors: { value: 0.3 },
  };
  constructor(scene: THREE.Scene) {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: this.uniforms,
      vertexShader: `varying vec3 ray;void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `precision highp float;
    varying vec3 ray;uniform vec3 sunDir,moonDir;uniform float night,phase,eclipse,sunOn,moonOn,aurora,density,time,meteors;
    float hash(float x){float n=mod(x,997.);return mod(n*n*7.+n*31.+137.,997.)/997.;}
    void main(){vec3 d=normalize(ray);float horizon=smoothstep(-.015,.045,d.y);vec3 color=vec3(0.);float alpha=0.;
      float sd=acos(clamp(dot(d,sunDir),-1.,1.));
      float disc=(1.-smoothstep(.010,.0115,sd))*sunOn*horizon;
      float glow=exp(-sd*sd/ .0012)*.22*sunOn*horizon;
      color+=vec3(5.,3.,1.2)*disc+vec3(1.,.81,.48)*glow;alpha=max(alpha,disc+glow);
      vec3 right=normalize(cross(moonDir,vec3(0.,1.,0.)));vec3 up=cross(right,moonDir);
      vec2 uv=vec2(dot(d,right),dot(d,up))/.014;float r=dot(uv,uv);
      if(r<1. && dot(d,moonDir)>.9 && moonOn>.5){
        float z=sqrt(max(0.,1.-r));vec3 n=vec3(uv,z);
        vec3 light=vec3(sin(phase*6.2831853),.025,-cos(phase*6.2831853));
        float lit=smoothstep(-.025,.06,dot(n,light));
        float mare=.82+.1*sin(uv.x*14.+sin(uv.y*9.))+.06*sin(uv.y*27.+uv.x*19.);
        float rim=1.-smoothstep(.94,1.,r);float ma=moonOn*horizon*rim;
        vec3 mc=mix(vec3(.018,.028,.04),vec3(.72,.76,.78)*mare,lit);
        if(eclipse>.5)mc=vec3(.22,.052,.025)*mare*(.4+.6*z);
        color=mix(color,mc,ma);alpha=max(alpha,ma);
      }
      float lon=atan(d.x,-d.z),lat=asin(d.y);
      float curtain=0.;
      if(aurora>.001 && d.y>0.){
        for(int i=0;i<6;i++){float k=float(i);if(k>density*5.)continue;
          // Lower, tighter curtains above the northern skyline. The .15 rad floor
          // is ~3.6 km above the camera on this 24 km dome; terrain peaks at 1.47 km.
          float base=.205+k*.022+.025*sin(lon*2.5+k+time*.07)+.010*sin(lon*8.-time*.11+k);
          float v=lat-base;float sheet=exp(-max(v,0.)*(22.+k))*smoothstep(-.020,.008,v);
          float strands=.45+.55*pow(.5+.5*sin(lon*(115.+k*19.)+sin(lon*17.+time*.12)*3.),3.);
          curtain+=sheet*strands*.21;
        }
        curtain*=smoothstep(.15,.17,lat)*aurora*night*horizon*(1.-smoothstep(1.05,1.95,abs(lon)));
        vec3 ac=mix(vec3(.10,.75,.40),vec3(.43,.22,.65),smoothstep(.35,.9,lat));
        color+=ac*curtain;alpha=max(alpha,min(.7,curtain));
      }
      if(meteors>.001&&night>.01){
        float period=mix(100.,3.,meteors),event=floor(time/period),age=mod(time,period);
        if(age<1.1){vec2 start=vec2((hash(event)-.5)*5.8,.55+hash(event+4.)*.55);
          vec2 vel=vec2(.28,-.19);vec2 head=start+vel*age;vec2 v=vec2(lon,lat)-head;
          float along=clamp(-dot(v,vel)/dot(vel,vel),0.,.48);float dist=length(v+vel*along);
          float line=exp(-dist*dist/.000006)*(1.-along/.48)*sin(min(1.,age/1.1)*3.14159)*night;
          color+=vec3(.62,.75,.85)*line;alpha=max(alpha,line);
        }
      }
      if(alpha<.001)discard;gl_FragColor=vec4(color/max(alpha,.001),clamp(alpha,0.,1.));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(24000, 40, 24),
      material,
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    const p: number[] = [],
      sizes: number[] = [];
    let seed = 1947;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < 3200; i++) {
      const y = 0.035 + rand() * 0.965,
        a = rand() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      p.push(Math.cos(a) * r * 26000, y * 26000, Math.sin(a) * r * 26000);
      sizes.push(0.9 + rand() * 1.1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
    this.stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { night: { value: 0 } },
        vertexShader: `attribute float size;varying float brightness;void main(){brightness=size*.28;gl_PointSize=size*1.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform float night;varying float brightness;void main(){float r=length(gl_PointCoord-.5);float a=(1.-smoothstep(.1,.5,r))*night*brightness;gl_FragColor=vec4(.72,.81,.91,a);}`,
      }),
    );
    this.stars.renderOrder = -20;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);
    scene.add(this.group);
  }
  configure(p: Partial<SkySettings>) {
    this.settings = normalizeSky(p, this.settings);
  }
  update(hour: number, day: number, time: number, camera: THREE.Camera) {
    const s = this.settings,
      u = this.uniforms,
      a = sunAngle(hour),
      cycle = this.cycle.update(hour, day);
    u.sunDir.value.set(Math.cos(a) * 0.9, Math.sin(a), 0.28).normalize();
    const ma = a - Math.PI;
    u.moonDir.value.set(Math.cos(ma) * 0.85, Math.sin(ma), -0.12).normalize();
    u.night.value = 1 - THREE.MathUtils.smoothstep(Math.sin(a), -0.04, 0.13);
    u.phase.value =
      s.moonPhase === 'auto'
        ? cycle.phase
        : Math.max(0, MOON_PHASES.indexOf(s.moonPhase) - 1) / 8;
    u.eclipse.value = s.moonPhase === 'eclipse' ? 1 : 0;
    u.sunOn.value = s.sun ? 1 : 0;
    u.moonOn.value = s.moon ? 1 : 0;
    u.aurora.value =
      s.aurora && (s.auroraMode === 'always' || cycle.aurora)
        ? s.auroraIntensity
        : 0;
    u.density.value = s.auroraDensity;
    u.time.value =
      process.env.VANCOUVER_VISUAL_QA === '1' && this.qaTime !== null
        ? this.qaTime
        : time / 1000;
    u.meteors.value = s.meteors ? s.meteorFrequency : 0;
    this.stars.visible = s.stars && u.night.value > 0.001;
    (this.stars.material as THREE.ShaderMaterial).uniforms.night.value =
      u.night.value;
    this.stars.geometry.setDrawRange(0, Math.round(s.starDensity * 3200));
    this.stars.rotation.y = (hour / 24) * Math.PI * 2;
    this.group.position.copy(camera.position);
  }
}

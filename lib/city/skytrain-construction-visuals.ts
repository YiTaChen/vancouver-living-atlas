import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Locale } from '../i18n';
import messages from '../i18n/skytrain-construction.json';
import type { SkyTrainStationOwner } from './skytrain-stations';
import type { StationConstructionPortal } from './skytrain-construction-access';
import type { VisualQuality } from './quality';

type PortalQuality = VisualQuality | 'low' | 'auto';
interface PortalVisual {
  group: THREE.Group;
  ring: THREE.Object3D;
  runes: THREE.Object3D;
  membrane: THREE.ShaderMaterial;
  particles: THREE.ShaderMaterial;
  sign: THREE.Group;
  placement: StationConstructionPortal;
  phase: number;
  label: SignLabel;
}
interface SignLabel {
  material: THREE.MeshBasicMaterial;
  kind: 'platform' | 'exit';
  detail: string;
  active: boolean;
}
const noRaycast = () => {};
const TAU = Math.PI * 2;
const membraneVertex = `
varying vec2 portalUv;
void main() {
  portalUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const membraneFragment = `
uniform float time;
uniform vec3 tint;
varying vec2 portalUv;
void main() {
  float radius = length(portalUv);
  float angle = atan(portalUv.y, portalUv.x);
  float spiral = sin(angle * 5.0 - radius * 18.0 + time * 1.6);
  float ripple = sin(radius * 31.0 - time * 2.3 + spiral * 1.4);
  float rim = pow(smoothstep(0.45, 1.0, radius), 3.0);
  float thread = pow(0.5 + 0.5 * spiral, 8.0) * (0.35 + 0.65 * radius);
  float alpha = (0.065 + rim * 0.3 + thread * 0.13 + ripple * 0.018)
    * (1.0 - smoothstep(0.965, 1.0, radius));
  vec3 color = mix(tint * 0.45, vec3(0.74, 0.96, 1.0), rim * 0.75 + thread * 0.3);
  gl_FragColor = vec4(color, alpha);
}`;
const particleVertex = `
uniform float time;
attribute vec4 seed;
varying float glow;
void main() {
  float angle = seed.x + time * (0.11 + seed.w * 0.15);
  float radius = 0.94 + sin(time * 0.8 + seed.y) * 0.055;
  vec3 p = vec3(cos(angle) * 0.76 * radius,
    sin(angle) * 1.04 * radius + 1.1, sin(angle * 2.0 + seed.z) * 0.10);
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  glow = 0.45 + 0.55 * sin(time * 1.4 + seed.z) * sin(time * 1.4 + seed.z);
  gl_PointSize = clamp((150.0 + seed.w * 120.0) / max(1.0, -view.z), 1.0, 7.0);
  gl_Position = projectionMatrix * view;
}`;
const particleFragment = `
uniform vec3 tint;
varying float glow;
void main() {
  float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float alpha = pow(max(0.0, 1.0 - radius), 2.0) * glow;
  gl_FragColor = vec4(mix(tint, vec3(1.0), 0.45), alpha);
}`;

function mergedBoxes(parts: readonly (readonly number[])[]) {
  const pieces = parts.map(([w, h, d, x, y, z, tilt = 0]) =>
    new THREE.BoxGeometry(w, h, d).rotateX(tilt).translate(x, y, z),
  );
  const geometry = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  return geometry;
}
function runicGeometry() {
  const points: number[] = [];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * TAU,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const line = (ax: number, ay: number, bx: number, by: number) => {
      for (const [x, y] of [
        [ax, ay],
        [bx, by],
      ])
        points.push(c * (0.91 + y) - s * x, s * (0.91 + y) + c * x, 0.028);
    };
    line(0, -0.035, 0, 0.035);
    line(0, 0.025, -0.025, 0.003);
    line(0, i % 2 ? 0.005 : -0.012, 0.025, i % 2 ? -0.018 : 0.012);
    if (i % 3 === 0) line(-0.024, -0.027, 0.024, -0.027);
  }
  return new THREE.BufferGeometry().setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3),
  );
}

/** Station-local explanation only. Every mesh explicitly opts out of camera and
 * picking collisions; the station owner retains all real walls and floors. */
export class SkyTrainConstructionVisuals {
  readonly group = new THREE.Group();
  private readonly visuals: PortalVisual[] = [];
  private readonly resources = new Set<THREE.BufferGeometry | THREE.Material>();
  private readonly labels = new Map<string, SignLabel>();
  private readonly world = new THREE.Vector3();
  private readonly particleGeometry: THREE.BufferGeometry;
  private readonly distances: Float64Array;
  private locale: Locale | null = null;
  private time = 0;
  private disposed = false;

  constructor(
    private readonly owner: SkyTrainStationOwner,
    placements: readonly StationConstructionPortal[],
  ) {
    this.group.name = 'SkyTrain construction — magical station portals';
    this.group.userData.cameraCollision = false;
    this.group.userData.constructionDecoration = true;
    this.distances = new Float64Array(placements.length);
    const geometry = <T extends THREE.BufferGeometry>(value: T) => {
        this.resources.add(value);
        return value;
      },
      material = <T extends THREE.Material>(value: T) => {
        this.resources.add(value);
        return value;
      },
      coreParts = [
        new THREE.TorusGeometry(1, 0.027, 6, 80),
        new THREE.TorusGeometry(1.055, 0.009, 4, 64, Math.PI * 1.65),
      ],
      torus = geometry(mergeGeometries(coreParts)!),
      runes = geometry(runicGeometry()),
      disk = geometry(new THREE.CircleGeometry(0.96, 64)),
      floor = geometry(new THREE.RingGeometry(0.43, 0.8, 48)),
      faceParts = [
        new THREE.PlaneGeometry(0.65, 0.8)
          .rotateX(-0.23)
          .translate(0, 0.55, 0.129),
        new THREE.PlaneGeometry(0.65, 0.8)
          .rotateY(Math.PI)
          .rotateX(0.23)
          .translate(0, 0.55, -0.129),
      ],
      face = geometry(mergeGeometries(faceParts)!),
      frame = geometry(
        mergedBoxes([
          [0.07, 1.05, 0.055, -0.35, 0.51, 0.12, -0.23],
          [0.07, 1.05, 0.055, 0.35, 0.51, 0.12, -0.23],
          [0.07, 1.05, 0.055, -0.35, 0.51, -0.12, 0.23],
          [0.07, 1.05, 0.055, 0.35, 0.51, -0.12, 0.23],
          [0.76, 0.065, 0.085, 0, 1.01, 0],
          [0.76, 0.055, 0.055, 0, 0.1, 0.1],
          [0.76, 0.055, 0.055, 0, 0.1, -0.1],
        ]),
      ),
      backing = geometry(
        mergedBoxes([
          [0.69, 0.84, 0.025, 0, 0.55, 0.11, -0.23],
          [0.69, 0.84, 0.025, 0, 0.55, -0.11, 0.23],
        ]),
      ),
      yellow = material(
        new THREE.MeshBasicMaterial({ color: 0xffca39, toneMapped: false }),
      ),
      black = material(
        new THREE.MeshBasicMaterial({ color: 0x20262b, toneMapped: false }),
      );
    for (const part of [...coreParts, ...faceParts]) part.dispose();
    const positions = new Float32Array(48 * 3),
      seeds = new Float32Array(48 * 4);
    for (let i = 0; i < 48; i++)
      seeds.set(
        [((i * 0.61803398875) % 1) * TAU, i * 1.71, i * 2.39, (i * 0.618) % 1],
        i * 4,
      );
    this.particleGeometry = geometry(new THREE.BufferGeometry());
    this.particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    this.particleGeometry.setAttribute(
      'seed',
      new THREE.BufferAttribute(seeds, 4),
    );
    this.particleGeometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 1.1, 0),
      1.35,
    );
    const colors = {
      platform: new THREE.Color(0x72c8ff),
      exit: new THREE.Color(0x7effcd),
    };
    const glow = new Map<
      'platform' | 'exit',
      {
        core: THREE.MeshBasicMaterial;
        halo: THREE.MeshBasicMaterial;
        runes: THREE.LineBasicMaterial;
      }
    >();
    for (const kind of ['platform', 'exit'] as const) {
      glow.set(kind, {
        core: material(
          new THREE.MeshBasicMaterial({
            color: colors[kind],
            toneMapped: false,
          }),
        ),
        halo: material(
          new THREE.MeshBasicMaterial({
            color: colors[kind],
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
        runes: material(
          new THREE.LineBasicMaterial({
            color: 0xc6f6ff,
            transparent: true,
            opacity: 0.88,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      });
    }
    for (let i = 0; i < placements.length; i++) {
      const placement = placements[i],
        root = new THREE.Group(),
        ellipse = new THREE.Group(),
        style = glow.get(placement.kind)!,
        sign = new THREE.Group();
      root.name = `Construction portal — ${placement.id}`;
      root.position.fromArray(placement.point.position);
      root.rotation.y = placement.point.yaw;
      root.userData.portalId = placement.id;
      root.visible = false;
      ellipse.position.y = 1.1;
      ellipse.scale.set(0.72, 1.02, 1);
      const ring = new THREE.Mesh(torus, style.core),
        glyphs = new THREE.LineSegments(runes, style.runes);
      ellipse.add(ring, glyphs);
      const membrane = material(
          new THREE.ShaderMaterial({
            uniforms: {
              time: { value: i * 0.71 },
              tint: { value: colors[placement.kind] },
            },
            vertexShader: membraneVertex,
            fragmentShader: membraneFragment,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        ),
        surface = new THREE.Mesh(disk, membrane);
      ellipse.add(surface);
      const particles = material(
        new THREE.ShaderMaterial({
          uniforms: {
            time: { value: i * 0.71 },
            tint: { value: colors[placement.kind] },
          },
          vertexShader: particleVertex,
          fragmentShader: particleFragment,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      const motes = new THREE.Points(this.particleGeometry, particles),
        footprint = new THREE.Mesh(floor, style.halo);
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.y = 0.018;
      root.add(ellipse, motes, footprint);
      sign.name = `Construction A-frame — ${placement.id}`;
      sign.visible = false;
      sign.position.fromArray(
        placement.signPosition ?? placement.point.position,
      );
      sign.rotation.y = placement.point.yaw;
      if (!placement.signPosition) {
        sign.position.x +=
          Math.cos(placement.point.yaw) * placement.signSide * 1.04;
        sign.position.z -=
          Math.sin(placement.point.yaw) * placement.signSide * 1.04;
      }
      const key = `${placement.kind}:${placement.label}`;
      let label = this.labels.get(key);
      if (!label) {
        label = {
          material: material(
            new THREE.MeshBasicMaterial({
              color: 0xffffff,
              side: THREE.DoubleSide,
              toneMapped: false,
            }),
          ),
          kind: placement.kind,
          detail: placement.label,
          active: false,
        };
        this.labels.set(key, label);
      }
      sign.userData.labelKey = key;
      sign.add(
        new THREE.Mesh(frame, yellow),
        new THREE.Mesh(backing, black),
        new THREE.Mesh(face, label.material),
      );
      this.group.add(root, sign);
      this.visuals.push({
        group: root,
        ring,
        runes: glyphs,
        membrane,
        particles,
        sign,
        placement,
        phase: i * 0.71,
        label,
      });
    }
    this.group.traverse((object) => {
      object.userData.cameraCollision = false;
      object.userData.constructionDecoration = true;
      object.raycast = noRaycast;
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    owner.group.add(this.group);
  }

  /** Optional prompt/capture anchor at the portal's visible centre. */
  worldAnchor(id: string, target = new THREE.Vector3()): THREE.Vector3 | null {
    for (const visual of this.visuals)
      if (visual.placement.id === id) {
        target.set(0, 1.1, 0);
        return visual.group.localToWorld(target);
      }
    return null;
  }

  update(
    dt: number,
    cameraPosition: THREE.Vector3,
    quality: PortalQuality,
    locale: Locale,
  ) {
    if (this.disposed) return;
    if (locale !== this.locale) this.updateLabels(locale);
    const low = quality === 'balanced' || quality === 'low',
      visibleRange = low ? 68 : 115,
      animatedRange = low ? 30 : 55;
    this.particleGeometry.setDrawRange(0, low ? 16 : 48);
    this.time =
      (this.time + Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0))) %
      4096;
    this.group.updateWorldMatrix(true, false);
    for (const label of this.labels.values()) label.active = false;
    for (let i = 0; i < this.visuals.length; i++) {
      const visual = this.visuals[i];
      visual.group.getWorldPosition(this.world);
      this.distances[i] = this.world.distanceToSquared(cameraPosition);
      visual.group.visible = false;
      visual.sign.visible = false;
    }
    for (let count = 0; count < (low ? 2 : 4); count++) {
      let nearest = -1,
        distanceSquared = visibleRange * visibleRange;
      for (let i = 0; i < this.distances.length; i++)
        if (this.distances[i] < distanceSquared) {
          nearest = i;
          distanceSquared = this.distances[i];
        }
      if (nearest < 0) break;
      this.distances[nearest] = Infinity;
      const visual = this.visuals[nearest];
      visual.group.visible = true;
      visual.sign.visible = true;
      visual.label.active = true;
      if (distanceSquared > animatedRange * animatedRange) continue;
      const time = this.time + visual.phase;
      visual.membrane.uniforms.time.value = time;
      visual.particles.uniforms.time.value = time;
      visual.ring.rotation.z = time * 0.17;
      visual.runes.rotation.z = -time * 0.055;
    }
    const t = messages[locale];
    for (const label of this.labels.values()) {
      if (label.active && !label.material.map) {
        label.material.map = this.labelTexture(
          t.construction,
          t[label.kind],
          label.detail,
          t.portal,
        );
        label.material.needsUpdate = true;
      } else if (!label.active && label.material.map) {
        label.material.map.dispose();
        label.material.map = null;
        label.material.needsUpdate = true;
      }
    }
  }

  private updateLabels(locale: Locale) {
    this.locale = locale;
    const t = messages[locale];
    for (const label of this.labels.values()) {
      label.material.map?.dispose();
      label.material.map = null;
      label.material.needsUpdate = true;
    }
    for (const visual of this.visuals) {
      visual.sign.userData.text = `${t.construction}\n${t[visual.placement.kind]}\n${visual.placement.label}\n${t.portal}`;
      visual.group.userData.destinationLabel = `${t[visual.placement.kind]} · ${visual.placement.label}`;
    }
  }

  private labelTexture(
    title: string,
    destination: string,
    detail: string,
    hint: string,
  ): THREE.Texture {
    const canvas =
        typeof document === 'undefined'
          ? null
          : document.createElement('canvas'),
      context = canvas?.getContext('2d');
    if (!canvas || !context) {
      const pixels = new Uint8Array(8 * 8 * 4);
      for (let i = 0; i < 64; i++)
        pixels.set(
          (i + Math.floor(i / 8)) % 4 < 2
            ? [255, 204, 45, 255]
            : [25, 31, 35, 255],
          i * 4,
        );
      const texture = new THREE.DataTexture(pixels, 8, 8);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }
    canvas.width = 384;
    canvas.height = 480;
    context.scale(0.5, 0.5);
    context.fillStyle = '#ffcf3d';
    context.fillRect(0, 0, 768, 960);
    context.save();
    context.beginPath();
    context.rect(0, 0, 768, 82);
    context.rect(0, 878, 768, 82);
    context.clip();
    context.fillStyle = '#20262b';
    for (let x = -960; x < 1728; x += 144) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 74, 0);
      context.lineTo(x + 1034, 960);
      context.lineTo(x + 960, 960);
      context.fill();
    }
    context.restore();
    context.fillStyle = '#20262b';
    context.lineWidth = 16;
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(384, 118);
    context.lineTo(490, 285);
    context.lineTo(278, 285);
    context.closePath();
    context.stroke();
    context.font = 'bold 116px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('!', 384, 264);
    const write = (text: string, y: number, size: number, maxLines: number) => {
      let lines: string[] = [];
      for (let fontSize = size; fontSize >= 26; fontSize -= 2) {
        context.font = `700 ${fontSize}px system-ui, sans-serif`;
        lines = [];
        let line = '';
        const words = /\s/.test(text) ? text.split(/\s+/) : Array.from(text);
        for (const word of words) {
          const candidate = line
            ? `${line}${/\s/.test(text) ? ' ' : ''}${word}`
            : word;
          if (line && context.measureText(candidate).width > 660) {
            lines.push(line);
            line = word;
          } else line = candidate;
        }
        if (line) lines.push(line);
        if (lines.length <= maxLines) {
          lines.forEach((line, index) =>
            context.fillText(line, 384, y + index * fontSize * 1.18),
          );
          return;
        }
      }
      lines
        .slice(0, maxLines)
        .forEach((line, index) => context.fillText(line, 384, y + index * 31));
    };
    write(title, 375, 68, 3);
    context.fillRect(66, 565, 636, 4);
    write(destination, 640, 46, 2);
    write(detail, 720, 40, 2);
    write(hint, 831, 31, 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const label of this.labels.values()) label.material.map?.dispose();
    this.labels.clear();
    for (const resource of this.resources) resource.dispose();
    this.resources.clear();
    this.visuals.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }
}

import type { CityEngine } from './engine';
import { project, unproject, rings, lines } from './geo';
import { VIEWS, type Feature, type Settings } from './types';

export const MINIMAP_SPANS = [200, 400, 800, 1600, 3200, 6400] as const;
export const DEFAULT_MINIMAP_SPAN = 800;
export function minimapZoomKey(event: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return ['+', '='].includes(event.key)
    ? 'in'
    : ['-', '_'].includes(event.key)
      ? 'out'
      : null;
}
export function zoomMinimap(span: number, direction: 'in' | 'out') {
  const index = MINIMAP_SPANS.reduce(
    (best, value, i) =>
      Math.abs(value - span) < Math.abs(MINIMAP_SPANS[best] - span) ? i : best,
    0,
  );
  return MINIMAP_SPANS[
    Math.max(
      0,
      Math.min(MINIMAP_SPANS.length - 1, index + (direction === 'in' ? -1 : 1)),
    )
  ];
}
export interface MapPose {
  x: number;
  z: number;
  yaw: number;
  following: boolean;
}
export function minimapPose(
  navigation: {
    mode: Settings['mode'];
    position: { x: number; z: number };
    yaw: number;
    boat: { state: { x: number; z: number; yaw: number } };
  } | null,
  target: { x: number; z: number },
): MapPose {
  if (!navigation || navigation.mode === 'orbit')
    return { ...target, yaw: 0, following: false };
  const source =
    navigation.mode === 'boat'
      ? navigation.boat.state
      : { ...navigation.position, yaw: navigation.yaw };
  return { x: source.x, z: source.z, yaw: source.yaw, following: true };
}
export function minimapTransform(
  pose: MapPose,
  span: number,
  width: number,
  height: number,
) {
  const centerX = pose.following ? pose.x : -140,
    centerZ = pose.following ? pose.z : -555,
    scale = pose.following
      ? width / span
      : Math.min((width - 16) / 5100, (height - 16) / 5350);
  return {
    scale,
    x: centerX - width / (2 * scale),
    z: centerZ - height / (2 * scale),
  };
}
export function minimapWorldPoint(
  px: number,
  py: number,
  transform: ReturnType<typeof minimapTransform>,
) {
  return {
    x: transform.x + px / transform.scale,
    z: transform.z + py / transform.scale,
  };
}
export function headingVector(yaw: number) {
  return { x: Math.sin(yaw), y: Math.cos(yaw) };
}

interface MapPath {
  path: Path2D;
  xmin: number;
  xmax: number;
  zmin: number;
  zmax: number;
  name?: string;
  points?: number[][];
  major?: boolean;
  trail?: boolean;
}
function mapPath(polygons: number[][][], close = true): MapPath {
  const path = new Path2D();
  let xmin = Infinity,
    xmax = -Infinity,
    zmin = Infinity,
    zmax = -Infinity;
  for (const ring of polygons) {
    ring.forEach(([x, z], i) => {
      if (i === 0) path.moveTo(x, z);
      else path.lineTo(x, z);
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      zmin = Math.min(zmin, z);
      zmax = Math.max(zmax, z);
    });
    if (close) path.closePath();
  }
  return { path, xmin, xmax, zmin, zmax };
}

/** A bounded 2D overlay: preproject once, cull off-screen paths, repaint at 10 Hz. */
export class LocalMinimap {
  span = DEFAULT_MINIMAP_SPAN;
  lastDraw = -Infinity;
  lastKey = '';
  transform = minimapTransform(
    { x: 0, z: 0, yaw: 0, following: false },
    this.span,
    280,
    180,
  );
  regional: MapPath[];
  land: MapPath[];
  parks: MapPath[];
  water: MapPath[];
  beaches: MapPath[];
  buildings: MapPath[];
  piers: MapPath[];
  roads: MapPath[];
  constructor(
    public e: CityEngine,
    public canvas: HTMLCanvasElement,
    public landmarkName: (id: string) => string,
  ) {
    this.regional = e.waterWorld.regional.map((p) => mapPath(p));
    this.land = e.landPolys.map((p) => mapPath(p));
    this.parks = e.parkPolys.map((p) => mapPath(p.poly));
    this.water = (e.data.waterSurfaces || []).map(
      (surface: { polygon: number[][][]; name: string }) => ({
        ...mapPath(surface.polygon),
        name: surface.name,
      }),
    );
    this.beaches = (e.data.beachPolys || []).map((p: number[][][]) =>
      mapPath(p),
    );
    this.piers = (e.data.solidWaterFootprints || []).map((p: number[][][]) =>
      mapPath(p),
    );
    this.buildings = e.data.buildings.features.flatMap((f: Feature) =>
      rings(f).map((p) => mapPath(p.map((r) => r.map(project)))),
    );
    this.roads = e.data.roads.features.flatMap((f: Feature) =>
      lines(f).map((line) => {
        const points = line.map(project);
        return {
          ...mapPath([points], false),
          points,
          name: String(f.properties.name || ''),
          major: /arterial/i.test(f.properties.class || ''),
          trail: /bikeway|trail|path/i.test(f.properties.class || ''),
        };
      }),
    );
  }
  draw(time: number, force = false) {
    if (time - this.lastDraw < 100 && !force) return;
    this.lastDraw = time;
    if (!this.canvas.clientWidth || !this.canvas.clientHeight) return;
    const pose = minimapPose(this.e.navigation, this.e.controls.target);
    const key = [
      pose.x.toFixed(2),
      pose.z.toFixed(2),
      pose.yaw.toFixed(3),
      pose.following,
      this.span,
      this.e.locale,
      this.canvas.clientWidth,
      this.canvas.clientHeight,
    ].join(':');
    if (key === this.lastKey && !force) return;
    this.lastKey = key;
    // Draw in CSS pixels so labels, markers and control exclusions remain
    // readable and correctly aligned at every responsive size.
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (this.canvas.width !== w * 2 || this.canvas.height !== h * 2) {
      this.canvas.width = w * 2;
      this.canvas.height = h * 2;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const t = (this.transform = minimapTransform(pose, this.span, w, h));
    const visible = (p: MapPath) =>
      p.xmax >= t.x &&
      p.xmin <= t.x + w / t.scale &&
      p.zmax >= t.z &&
      p.zmin <= t.z + h / t.scale;
    const fill = (paths: MapPath[], color: string) => {
      ctx.fillStyle = color;
      for (const p of paths) if (visible(p)) ctx.fill(p.path, 'evenodd');
    };
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#173d4a';
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(
      2 * t.scale,
      0,
      0,
      2 * t.scale,
      -2 * t.x * t.scale,
      -2 * t.z * t.scale,
    );
    fill(this.regional, '#607a70');
    // Match WaterWorld: detailed coast overrides regional geometry inside the core.
    const lo = project([-123.165, 49.315]),
      hi = project([-123.095, 49.267]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]);
    ctx.clip();
    ctx.fillStyle = '#173d4a';
    ctx.fillRect(lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]);
    fill(this.land, '#607a70');
    ctx.restore();
    fill(this.parks, '#365f4e');
    fill(this.beaches, '#adab7b');
    fill(this.water, '#215664');
    if (pose.following && this.span <= 1600) fill(this.buildings, '#82938a');
    fill(this.piers, '#a1aaa0');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const roads = this.roads.filter(visible);
    for (const road of roads) {
      if (!pose.following && !road.major) continue;
      ctx.strokeStyle = road.trail
        ? '#80b993'
        : road.major
          ? '#e0dbc0'
          : '#b6c3b3';
      ctx.lineWidth = (road.major ? 2 : road.trail ? 0.8 : 1.1) / t.scale;
      ctx.stroke(road.path);
    }
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const px = (x: number) => (x - t.x) * t.scale,
      py = (z: number) => (z - t.z) * t.scale;
    const occupied = [
      { x: w / 2 - 22, y: h / 2 - 24, w: 44, h: 48 },
      { x: 0, y: h - 32, w: 92, h: 32 },
      { x: w - 48, y: h - 83, w: 48, h: 83 },
    ];
    const label = (text: string, x: number, y: number, color: string) => {
      const width = ctx.measureText(text).width + 8;
      const box = { x: x - width / 2, y: y - 8, w: width, h: 16 };
      if (
        box.x < 5 ||
        box.y < 4 ||
        box.x + box.w > w - 5 ||
        box.y + box.h > h - 5 ||
        occupied.some(
          (b) =>
            box.x < b.x + b.w &&
            box.x + box.w > b.x &&
            box.y < b.y + b.h &&
            box.y + box.h > b.y,
        )
      )
        return false;
      occupied.push(box);
      ctx.strokeStyle = '#112c33';
      ctx.lineWidth = 3;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      return true;
    };
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (pose.following)
      for (const water of this.water.filter(visible)) {
        if (water.name && !/^(water|lake)$/i.test(water.name))
          label(
            water.name,
            px((water.xmin + water.xmax) / 2),
            py((water.zmin + water.zmax) / 2) - 40,
            '#b5e3e9',
          );
      }
    for (const view of VIEWS.filter(
      (v) =>
        !['overview', 'downtown', 'harbour', 'railway', 'skytrain'].includes(
          v.id,
        ),
    )) {
      const [x, z] = project(view.coord),
        sx = px(x),
        sy = py(z);
      if (sx < 4 || sx > w - 4 || sy < 4 || sy > h - 4) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e0eaaa';
      ctx.fill();
      if (pose.following)
        label(this.landmarkName(view.id), sx, sy - 12, '#e4edb8');
    }
    if (pose.following && this.span <= 1600) {
      const named = new Set<string>();
      for (const road of roads.toSorted(
        (a, b) => Number(b.major) - Number(a.major),
      )) {
        if (!road.name || named.has(road.name) || road.trail) continue;
        const points = road.points!;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1],
            b = points[i];
          if (
            label(
              road.name,
              px((a[0] + b[0]) / 2),
              py((a[1] + b[1]) / 2) - 8,
              '#edf0df',
            )
          ) {
            named.add(road.name);
            break;
          }
        }
        if (named.size >= 5) break;
      }
    }
    const x = px(pose.x),
      y = py(pose.z);
    if (pose.following) {
      const direction = headingVector(pose.yaw),
        right = { x: direction.y, y: -direction.x };
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = '#1ed8ec30';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + direction.x * 12, y + direction.y * 12);
      ctx.lineTo(
        x - direction.x * 8 + right.x * 8,
        y - direction.y * 8 + right.y * 8,
      );
      ctx.lineTo(x - direction.x * 4, y - direction.y * 4);
      ctx.lineTo(
        x - direction.x * 8 - right.x * 8,
        y - direction.y * 8 - right.y * 8,
      );
      ctx.closePath();
      ctx.strokeStyle = '#092b38';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = '#67f0ff';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#67f0ff';
      ctx.fill();
      ctx.strokeStyle = '#102e39';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const maxMeters = w / t.scale / 4,
      magnitude = 10 ** Math.floor(Math.log10(maxMeters));
    const meters =
      [5, 2, 1].map((n) => n * magnitude).find((n) => n <= maxMeters) ||
      magnitude;
    const length = meters * t.scale;
    ctx.fillStyle = '#102f39e8';
    ctx.fillRect(6, h - 31, length + 15, 27);
    ctx.strokeStyle = '#e8efdb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(12, h - 13);
    ctx.lineTo(12, h - 8);
    ctx.lineTo(12 + length, h - 8);
    ctx.lineTo(12 + length, h - 13);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8efdb';
    ctx.fillText(
      meters >= 1000 ? `${meters / 1000} km` : `${meters} m`,
      12,
      h - 22,
    );
    // Read-only diagnostics also allow QA to verify the drawn pose without a second renderer.
    const coord = unproject(pose.x, pose.z);
    Object.assign(this.canvas.dataset, {
      centerX: String(pose.following ? pose.x : -140),
      centerZ: String(pose.following ? pose.z : -555),
      playerX: String(pose.x),
      playerZ: String(pose.z),
      heading: String(pose.yaw),
      span: String(this.span),
      following: String(pose.following),
      lon: coord[0].toFixed(5),
      lat: coord[1].toFixed(5),
    });
  }
}

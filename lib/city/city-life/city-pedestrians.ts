import * as THREE from 'three';
import type { CityEngine } from '../engine';
import type { RoadEdge, RoadGraph } from '../road-graph';
import { GroundSurfaceIndex } from '../ground-surface';
import { project } from '../geo';
import { PathActor } from './actor-state';
import { SimulationClock } from './simulation-clock';
import {
  PopulationSelector,
  populationProfile,
  type ActorSelection,
  type PopulationCenter,
} from './population';
import {
  PedestrianRenderer,
  PEDESTRIAN_VARIANTS,
  type PedestrianRenderPose,
} from './pedestrian-renderer';
import {
  validatedSidewalkRoute,
  sampleSidewalkRoute,
  sidewalkStationWindow,
  SIDEWALK_MAX_WINDOWS_PER_EDGE,
  TrunkClearanceIndex,
  type SidewalkRoute,
  type SidewalkStationWindow,
} from './sidewalk-route';

/** Only source-authored, visible ground footways in a bounded coarse neighborhood.
 * Never copy all city ground geometry into a second population-owned index. */
export function nearbySidewalkMeshes(
  root: THREE.Object3D,
  cellX: number,
  cellZ: number,
) {
  const region = new THREE.Box3(
    new THREE.Vector3(cellX * 600 - 220, -Infinity, cellZ * 600 - 220),
    new THREE.Vector3(
      (cellX + 1) * 600 + 220,
      Infinity,
      (cellZ + 1) * 600 + 220,
    ),
  );
  const bounds = new THREE.Box3(),
    meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (
      !(o instanceof THREE.Mesh) ||
      !o.userData.walkSurface ||
      o.userData.protectedSurface ||
      (o.userData.surfaceId !== undefined &&
        o.userData.surfaceId !== 'ground') ||
      (o.userData.layer !== undefined && o.userData.layer !== 0) ||
      (o.userData.level !== undefined && o.userData.level !== 'ground') ||
      !/^(Clipped sidewalks|Water Street brick footways) /.test(o.name)
    )
      return;
    for (let parent: THREE.Object3D | null = o; parent; parent = parent.parent)
      if (!parent.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    if (!o.geometry.boundingBox || o.geometry.drawRange.count === 0) return;
    o.updateWorldMatrix(true, false);
    if (
      bounds
        .copy(o.geometry.boundingBox)
        .applyMatrix4(o.matrixWorld)
        .intersectsBox(region)
    )
      meshes.push(o);
  });
  return meshes;
}

interface Walker {
  actor: PathActor;
  route: SidewalkRoute;
  seed: number;
  previous: number;
  current: number;
  movementAt: number;
  interval: number;
  phase: number;
  delta: number;
  yaw: number;
}
interface SourceWindow {
  edge: RoadEdge;
  window: SidewalkStationWindow;
}
function windowDistance2(window: SidewalkStationWindow, x: number, z: number) {
  const dx = window.b[0] - window.a[0],
    dz = window.b[1] - window.a[1];
  const t = THREE.MathUtils.clamp(
    ((x - window.a[0]) * dx + (z - window.a[1]) * dz) / (dx * dx + dz * dz),
    0,
    1,
  );
  return (x - window.a[0] - dx * t) ** 2 + (z - window.a[1] - dz * t) ** 2;
}
/** One bounded city-wide background population. No player/vehicle collision
 * controller or near-distance passenger skeleton is claimed by this consumer.
 * Sidewalk meshes are queried only while validating a new local route.
 */
export class CityPedestrians {
  readonly renderer: PedestrianRenderer;
  readonly clock = new SimulationClock();
  private selector: PopulationSelector;
  private quality: string;
  private reselectingQuality = false;
  private graph: RoadGraph;
  private edgeCells = new Map<string, SourceWindow[]>();
  private routes = new Map<string, SidewalkRoute>();
  private walkers = new Map<string, Walker>();
  private attempted = new Map<string, boolean>();
  private floor: GroundSurfaceIndex | null = null;
  private floorCell = '';
  private floorMeshes = 0;
  private trunks: TrunkClearanceIndex | null = null;
  private selected: ActorSelection[] = [];
  private lastSelection = -Infinity;
  private streetVisible = false;
  private disposed = false;
  private frustum = new THREE.Frustum();
  private viewProjection = new THREE.Matrix4();
  private bounds = new THREE.Box3();
  private center = new THREE.Vector3();
  private rendered = 0;
  private closestCandidateM: number | null = null;
  private safeNearbyCandidates = 0;
  private nearbyCandidates = 0;
  private renderedIds: string[] = [];
  constructor(private e: CityEngine) {
    this.quality = e.settings.quality;
    this.selector = this.makeSelector();
    this.renderer = new PedestrianRenderer({
      capacity: e.compatibleGraphics ? 12 : 32,
    });
    this.renderer.group.name = 'Nearby sidewalk pedestrians';
    this.e.scene.add(this.renderer.group);
    this.graph = e.data.roadGraph;
    if (!this.graph) return;
    for (const edge of this.graph.edges)
      for (
        let windowIndex = 0;
        windowIndex < SIDEWALK_MAX_WINDOWS_PER_EDGE;
        windowIndex++
      ) {
        const window = sidewalkStationWindow(this.graph, edge, windowIndex);
        if (!window) break;
        const source = { edge, window };
        // An <=80m window touches at most four 100m cells, even on a diagonal.
        // This covers long-edge interiors with linear storage, instead of using
        // only node a or expanding the entire long segment's bounding rectangle.
        for (
          let x = Math.floor(Math.min(window.a[0], window.b[0]) / 100);
          x <= Math.floor(Math.max(window.a[0], window.b[0]) / 100);
          x++
        )
          for (
            let z = Math.floor(Math.min(window.a[1], window.b[1]) / 100);
            z <= Math.floor(Math.max(window.a[1], window.b[1]) / 100);
            z++
          ) {
            const key = `${x},${z}`;
            const bucket = this.edgeCells.get(key) ?? [];
            bucket.push(source);
            this.edgeCells.set(key, bucket);
          }
      }
  }
  private makeSelector() {
    return new PopulationSelector(
      populationProfile(
        this.e.compatibleGraphics ? 'compatible' : 'desktop',
        this.e.settings.quality,
      ),
    );
  }
  setHidden(hidden: boolean) {
    this.clock.setHidden(hidden);
  }
  private prepareNearby() {
    if (!this.trunks) {
      // DetailedTrees retains the actual world positions used by both city
      // instances and near models, including generated forest sources.
      const trees =
        this.e.detailedTrees?.trees ??
        (this.e.data.trees?.trees ?? [])
          .filter(
            (t: readonly number[]) =>
              t[0] >= -123.165 &&
              t[0] <= -123.095 &&
              t[1] >= 49.267 &&
              t[1] <= 49.315,
          )
          .map((t: readonly number[]) => {
            const [x, z] = project(t);
            return { x, z };
          })
          .filter(
            (t: { x: number; z: number }) =>
              Number.isFinite(t.x) &&
              Number.isFinite(t.z) &&
              this.e.onLand(t.x, t.z),
          );
      this.trunks = new TrunkClearanceIndex(trees);
    }
    const floorX = Math.floor(this.center.x / 600),
      floorZ = Math.floor(this.center.z / 600);
    const floorCell = `${floorX},${floorZ}`;
    if (!this.floor || this.floorCell !== floorCell) {
      const meshes = nearbySidewalkMeshes(this.e.roads, floorX, floorZ);
      this.floor = new GroundSurfaceIndex(meshes);
      this.floorCell = floorCell;
      this.floorMeshes = meshes.length;
      // A failed run may extend beyond the previous local floor index. Retry
      // failures against the new geometry neighborhood, preserving proven
      // routes and their existing actor identities.
      for (const [key, valid] of this.attempted)
        if (!valid) this.attempted.delete(key);
    }
    const cx = Math.floor(this.center.x / 100),
      cz = Math.floor(this.center.z / 100);
    const nearby = new Map<string, SourceWindow>();
    for (let x = cx - 2; x <= cx + 2; x++)
      for (let z = cz - 2; z <= cz + 2; z++)
        for (const source of this.edgeCells.get(`${x},${z}`) ?? [])
          nearby.set(`${source.edge.id}:${source.window.windowIndex}`, source);
    const windows = [...nearby.values()].sort(
      (a, b) =>
        windowDistance2(a.window, this.center.x, this.center.z) -
          windowDistance2(b.window, this.center.x, this.center.z) ||
        a.edge.id - b.edge.id ||
        a.window.windowIndex - b.window.windowIndex,
    );
    let probes = 0;
    for (const { edge, window } of windows)
      for (const side of [-1, 1] as const) {
        const key = `footway:${edge.id}:${side}:run${window.windowIndex}`;
        if (this.routes.has(key) || this.attempted.has(key) || probes >= 2)
          continue;
        if (this.routes.size >= 64) {
          const active = new Set(this.selected.map((s) => s.actorId));
          const stale = [...this.routes].find(
            ([id, route]) =>
              !active.has(`${id}:0`) &&
              !active.has(`${id}:1`) &&
              Math.hypot(
                route.points[0][0] - this.center.x,
                route.points[0][2] - this.center.z,
              ) > 180,
          );
          if (!stale) return;
          this.routes.delete(stale[0]);
          this.attempted.delete(stale[0]);
          this.walkers.delete(`${stale[0]}:0`);
          this.walkers.delete(`${stale[0]}:1`);
        }
        probes++;
        const probe = (x: number, z: number) => {
          if (!this.e.navigation?.clearGround(x, z, 'walk')) return undefined;
          const y = this.floor!.sample(x, z, this.e.elevation(x, z) + 1.18);
          return y === undefined
            ? undefined
            : { y, surfaceId: 'ground', layer: 0 };
        };
        let route: SidewalkRoute | null = null;
        for (const offsetFromCurbM of [1, 0.55, 1.45]) {
          route = validatedSidewalkRoute(this.graph, edge, side, probe, {
            offsetFromCurbM,
            windowIndex: window.windowIndex,
            clearSegment: (a, b) => this.trunks!.clearSegment(a, b),
          });
          if (route) break;
        }
        this.attempted.set(key, !!route);
        if (this.attempted.size > 256)
          this.attempted.delete(this.attempted.keys().next().value!);
        if (!route) continue;
        this.routes.set(key, route);
        for (let seed = 0; seed < 2; seed++) {
          // Spread the two identities along the physical footway (16% and 84%),
          // rather than clustering both in its middle. They still need a verified
          // offscreen birth; this does not create actors in front of the camera.
          const station = route.lengthM * (seed ? 0.58 : 0.08);
          const id = `${key}:${seed}`,
            pose = sampleSidewalkRoute(route, station);
          this.walkers.set(id, {
            actor: new PathActor(id, route, station, seed * 0.4),
            route,
            seed: edge.id * 2 + window.windowIndex * 7 + seed,
            previous: station,
            current: station,
            movementAt: this.clock.time,
            interval: 0.05,
            phase: seed * 0.4,
            delta: 0,
            yaw: pose.yawRadians,
          });
        }
      }
  }
  update(elapsed: number) {
    if (this.disposed || !this.graph) return;
    if (this.quality !== this.e.settings.quality) {
      this.quality = this.e.settings.quality;
      this.selector = this.makeSelector();
      this.reselectingQuality = true;
      this.lastSelection = -Infinity;
    }
    this.clock.advance(elapsed, (dt, time) => {
      if (time - this.lastSelection >= 0.2 - 1e-7) {
        this.lastSelection = time;
        this.center.copy(this.e.camera.position);
        const ground = this.e.elevation(this.center.x, this.center.z);
        this.streetVisible =
          this.e.settings.buildings &&
          this.center.y - ground >= 0 &&
          this.center.y - ground < 45 &&
          this.e.settings.mode !== 'flight';
        this.e.camera.updateMatrixWorld();
        this.viewProjection.multiplyMatrices(
          this.e.camera.projectionMatrix,
          this.e.camera.matrixWorldInverse,
        );
        this.frustum.setFromProjectionMatrix(this.viewProjection);
        if (!this.streetVisible) {
          // These are background walkers, with no necessary passenger/mission
          // state to simulate in an all-city view. Retain bounded light routes.
          this.selected = [];
          this.selector.clear();
          this.closestCandidateM = null;
          this.safeNearbyCandidates = 0;
          this.nearbyCandidates = 0;
          return;
        }
        this.prepareNearby();
        const nav = this.e.navigation;
        const centers: PopulationCenter[] = [
          {
            position: this.center.toArray() as [number, number, number],
            surfaceId: 'ground',
            layer: 0,
            streetVisible: this.streetVisible,
            kind: 'camera' as const,
          },
        ];
        if (
          nav &&
          this.e.settings.mode !== 'orbit' &&
          this.e.settings.mode !== 'flight'
        )
          centers.push({
            position: nav.position.toArray() as [number, number, number],
            surfaceId: nav.surfaceId ?? 'ground',
            layer: nav.surfaceLayer ?? 0,
            streetVisible: nav.surface === 'ground',
            kind: 'player',
          });
        const previousIds = new Set(this.selected.map((s) => s.actorId));
        this.closestCandidateM = null;
        this.safeNearbyCandidates = 0;
        this.nearbyCandidates = 0;
        const candidates = [...this.walkers].map(([actorId, w]) => {
          const position = sampleSidewalkRoute(w.route, w.current).position;
          this.bounds.min.set(
            position[0] - 0.7,
            position[1],
            position[2] - 0.7,
          );
          this.bounds.max.set(
            position[0] + 0.7,
            position[1] + 2.3,
            position[2] + 0.7,
          );
          const spawnSafe =
            previousIds.has(actorId) ||
            !this.frustum.intersectsBox(this.bounds);
          let near = Infinity;
          for (const c of centers)
            if (c.streetVisible && c.surfaceId === 'ground' && c.layer === 0)
              near = Math.min(
                near,
                Math.hypot(
                  c.position[0] - position[0],
                  c.position[1] - position[1],
                  c.position[2] - position[2],
                ),
              );
          if (Number.isFinite(near))
            this.closestCandidateM = Math.min(
              this.closestCandidateM ?? Infinity,
              near,
            );
          if (near <= this.selector.profile.selection) {
            this.nearbyCandidates++;
            if (spawnSafe) this.safeNearbyCandidates++;
          }
          return {
            actorId,
            position,
            surfaceId: 'ground',
            layer: 0,
            interactive: false,
            necessary: false,
            spawnSafe,
            skeletonEligible: false,
          };
        });
        if (this.reselectingQuality) {
          // Seed the replacement selector with existing identities before
          // allowing offscreen candidates to compete for any new capacity.
          this.selector.select(
            candidates.filter((c) => previousIds.has(c.actorId)),
            centers,
            time,
          );
          this.reselectingQuality = false;
        }
        this.selected = this.selector.select(candidates, centers, time);
        for (const s of this.selected)
          if (!previousIds.has(s.actorId)) {
            const w = this.walkers.get(s.actorId)!;
            w.previous = w.current;
            w.delta = 0;
            w.phase = w.actor.snapshot().animationPhase;
            w.movementAt = time;
          }
      }
      for (const selected of this.selected) {
        const w = this.walkers.get(selected.actorId)!;
        const interval = 1 / selected.movementHz;
        if (time - w.movementAt < interval - 1e-7) continue;
        const before = w.actor.snapshot(),
          nav = this.e.navigation;
        const position = sampleSidewalkRoute(w.route, before.stationM).position;
        const nearPlayer =
          nav &&
          nav.surface === 'ground' &&
          (nav.surfaceId ?? 'ground') === 'ground' &&
          (nav.surfaceLayer ?? 0) === 0 &&
          this.e.settings.mode !== 'orbit' &&
          Math.hypot(
            position[0] - nav.position.x,
            position[1] - nav.position.y,
            position[2] - nav.position.z,
          ) < 1.4;
        w.previous = before.stationM;
        w.phase = before.animationPhase;
        const after = w.actor.update(
          Math.min(1, time - w.movementAt),
          1.1 + (w.seed % 5) * 0.08,
          nearPlayer ? 0 : Infinity,
        );
        w.current = after.stationM;
        w.delta =
          (((w.current - w.previous) % w.route.lengthM) + w.route.lengthM) %
          w.route.lengthM;
        w.interval = interval;
        w.movementAt = time;
      }
    });
    const poses: PedestrianRenderPose[] = [];
    const now =
      this.clock.time + this.clock.interpolationAlpha * this.clock.step;
    for (const selected of this.selected) {
      if (!selected.visible || !this.streetVisible) continue;
      const w = this.walkers.get(selected.actorId)!;
      const t = THREE.MathUtils.clamp((now - w.movementAt) / w.interval, 0, 1);
      const pose = sampleSidewalkRoute(w.route, w.previous + w.delta * t);
      w.yaw +=
        Math.atan2(
          Math.sin(pose.yawRadians - w.yaw),
          Math.cos(pose.yawRadians - w.yaw),
        ) * Math.min(1, Math.max(0, elapsed) * 8);
      const state = w.actor.snapshot();
      poses.push({
        actorId: selected.actorId,
        position: pose.position,
        yawRadians: w.yaw,
        phaseRadians: (w.phase + (w.delta * t) / 1.4) * Math.PI * 2,
        walkWeight: state.activity === 'walk' ? 1 : 0,
        variant: PEDESTRIAN_VARIANTS[w.seed % 4],
        distanceM: this.center.distanceTo(new THREE.Vector3(...pose.position)),
      });
    }
    this.rendered = poses.length;
    this.renderedIds = poses.map((p) => p.actorId);
    this.renderer.update(poses);
  }
  /** QA observation only: copies of selected physical poses, never a placement,
   * spawn or authority operation. The observer may aim a camera at these IDs. */
  debugPoses() {
    const now =
      this.clock.time + this.clock.interpolationAlpha * this.clock.step;
    return this.selected.map((selected) => {
      const w = this.walkers.get(selected.actorId)!;
      const t = THREE.MathUtils.clamp((now - w.movementAt) / w.interval, 0, 1);
      const pose = sampleSidewalkRoute(w.route, w.previous + w.delta * t);
      return {
        actorId: selected.actorId,
        routeId: w.route.routeId,
        offsetFromCurbM: w.route.offsetFromCurbM,
        sourceWindow: w.route.sourceWindow,
        sourceStartM: w.route.sourceStartM,
        sourceEndM: w.route.sourceEndM,
        surfaceId: w.route.surfaceId,
        layer: w.route.layer,
        position: [...pose.position] as [number, number, number],
        yawRadians: w.yaw,
        movementHz: selected.movementHz,
        decisionHz: selected.decisionHz,
        rendered: this.renderedIds.includes(selected.actorId),
      };
    });
  }
  stats() {
    return {
      time: this.clock.time,
      streetVisible: this.streetVisible,
      selected: this.selected.length,
      rendered: this.rendered,
      routes: this.routes.size,
      actorStates: this.walkers.size,
      attemptedRoutes: this.attempted.size,
      floorIndexedMeshes: this.floorMeshes,
      indexedTreeTrunks: this.trunks?.count ?? 0,
      closestCandidateM: this.closestCandidateM,
      nearbyCandidates: this.nearbyCandidates,
      safeNearbyCandidates: this.safeNearbyCandidates,
      renderedIds: [...this.renderedIds],
      budget: this.selector.profile.total,
      renderer: this.renderer.stats(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.selector.clear();
    this.renderer.dispose();
    this.renderer.group.removeFromParent();
    this.routes.clear();
    this.walkers.clear();
    this.attempted.clear();
    this.edgeCells.clear();
    this.floor = null;
    this.trunks = null;
    this.selected = [];
    this.floorMeshes = 0;
    this.floorCell = '';
    this.closestCandidateM = null;
    this.nearbyCandidates = 0;
    this.safeNearbyCandidates = 0;
    this.renderedIds = [];
  }
}

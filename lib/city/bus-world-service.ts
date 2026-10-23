import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { CityBusAssets } from './bus-assets';
import type { SurfaceHit } from './surface-reachability';
import type { BusCabinVisit } from './bus-visit';
import { createBuses } from './city-buses';
import {
  BusRouteRuntime,
  validateWorldBusPacket,
  type WorldBusFrame,
  type WorldBusPacket,
} from './bus-route-runtime';

/** Four persistent vehicles on two real 5/6 GTFS circuits. The shared proxy and
 * occupied cabin consume exactly the same simulation pose, including in orbit.
 * Detail allocation never moves the player or changes a vehicle's route clock. */
export class BusWorldService {
  ready = false;
  loading = false;
  private error: string | null = null;
  private packet: WorldBusPacket | null = null;
  private runtimes: BusRouteRuntime[] = [];
  private proxies: THREE.InstancedMesh | null = null;
  private selected: string | null = null;
  private disposed = false;
  private abort: AbortController | null = null;
  private pending: Promise<boolean> | null = null;
  private transform = new THREE.Object3D();
  private blocked = new Set<string>();
  private detailRetryAt = 0;
  private elapsed = 0;
  constructor(
    private city: CityEngine,
    private assets: CityBusAssets,
    private cabin: BusCabinVisit,
  ) {}
  load(url = '/data/transit/bus-world-routes.json'): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.ready) return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.loading = true;
    this.abort = new AbortController();
    const run = async () => {
      try {
        const response = await fetch(url, { signal: this.abort!.signal });
        if (!response.ok) throw Error('Bus route packet unavailable');
        const packet = validateWorldBusPacket(await response.json());
        if (this.disposed) return false;
        this.packet = packet;
        this.runtimes = packet.routes.flatMap((route, index) => [
          new BusRouteRuntime(route, `world-bus-${index}-0`, 0),
          new BusRouteRuntime(
            route,
            `world-bus-${index}-1`,
            Math.floor(route.stops.length / 2),
          ),
        ]);
        this.proxies = createBuses(this.runtimes.length);
        this.proxies.name = 'Autonomous source-backed route buses';
        this.city.scene.add(this.proxies);
        this.ready = true;
        this.error = null;
        this.render();
        return true;
      } catch (error) {
        if (!this.disposed)
          this.error =
            error instanceof Error ? error.message : 'Bus service load failed';
        return false;
      } finally {
        this.loading = false;
        this.pending = null;
        this.abort = null;
      }
    };
    this.pending = run();
    return this.pending;
  }
  get frames(): readonly WorldBusFrame[] {
    return this.runtimes.map((runtime) => runtime.frame());
  }
  snapshot() {
    return {
      ready: this.ready,
      loading: this.loading,
      error: this.error,
      source: this.packet?.source ?? null,
      sourcePacketSha256: this.packet?.sourcePacketSha256 ?? null,
      legend: this.packet?.legend ?? null,
      simulation: this.packet?.simulation ?? null,
      detailVehicleId: this.cabin.serviceVehicleId,
      blockedVehicleIds: [...this.blocked],
      vehicles: this.frames,
    };
  }
  private hidden() {
    return document.hidden || this.city.pageSuspended || this.city.contextLost;
  }
  update(dt: number) {
    if (!this.ready || this.disposed || this.hidden()) return;
    // Explicit hidden-tab freeze, with no elapsed-time catch-up on resume.
    const h = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
    this.elapsed += h;
    this.blocked.clear();
    for (const runtime of this.runtimes) {
      const attached = runtime.vehicleId === this.cabin.serviceVehicleId;
      runtime.update(
        h,
        (frame) => {
          const clear = this.clearPose(frame);
          if (!clear) this.blocked.add(frame.vehicleId);
          return clear;
        },
        !attached || this.cabin.serviceDepartureReady(),
      );
    }
    const frames = this.frames;
    const current =
      this.cabin.serviceVehicleId === this.selected
        ? frames.find((f) => f.vehicleId === this.selected)
        : undefined;
    const origin =
      this.city.navigation?.mode === 'walk'
        ? this.city.navigation.position
        : this.city.controls.target;
    const distance = (f: WorldBusFrame) =>
      Math.hypot(f.x - origin.x, f.z - origin.z);
    const closest = [...frames].sort((a, b) => distance(a) - distance(b))[0];
    const walking =
      this.city.navigation?.mode === 'walk' && this.city.settings.traffic;
    if (
      !this.cabin.aboard &&
      (!walking || !current || distance(current) > 110)
    ) {
      this.cabin.releaseService();
      this.selected = null;
    }
    if (
      walking &&
      !this.selected &&
      closest &&
      distance(closest) <= 80 &&
      this.elapsed >= this.detailRetryAt
    ) {
      this.selected = closest.vehicleId;
      this.detailRetryAt = this.elapsed + 5;
      void this.cabin
        .prepareService(closest, {
          quality: this.city.settings.quality,
          compatible: this.city.compatibleGraphics,
          detail: this.city.busVisitDetail,
        })
        .then((ok) => {
          if (!ok && !this.disposed && this.selected === closest.vehicleId)
            this.selected = null;
        });
    }
    const selected = frames.find((f) => f.vehicleId === this.selected);
    if (selected) this.cabin.applyServiceFrame(selected);
    this.render();
  }
  /** Ground identity and complete body envelope, including the front corners.
   * An obstructed source route holds in place; it never crosses a building,
   * invents a connector or teleports to the other end of the map. */
  private clearPose(frame: WorldBusFrame) {
    const nav = this.city.navigation;
    if (!nav) return false;
    const c = Math.cos(frame.yaw),
      s = Math.sin(frame.yaw);
    for (const along of [-6.3, -4.8, -3.3, -1.8, -0.3, 1.2, 2.7, 4.2, 6.1])
      for (const side of [-1.5, 0, 1.5]) {
        const x = frame.x + c * side + s * along;
        const z = frame.z - s * side + c * along;
        if (
          !nav.clearGround(x, z, 'drive', true, true) ||
          this.city.interiors?.height(x, z) !== undefined ||
          this.city.data.travelSurfaces
            ?.lookup(x, z)
            .some((hit: SurfaceHit) => hit.surfaceId !== 'ground')
        )
          return false;
      }
    return true;
  }
  /** The traffic light collector uses the same global poses as the body pool. */
  forEachVehiclePose(visit: (matrix: THREE.Matrix4) => void) {
    for (const frame of this.frames) {
      this.poseTransform(frame);
      visit(this.transform.matrix);
    }
  }
  private poseTransform(frame: WorldBusFrame) {
    const nav = this.city.navigation;
    const y = nav?.groundHeight(frame.x, frame.z) ?? 0;
    const dx = Math.sin(frame.yaw) * 3.1,
      dz = Math.cos(frame.yaw) * 3.1;
    const slope = nav
      ? Math.atan2(
          nav.groundHeight(frame.x + dx, frame.z + dz) -
            nav.groundHeight(frame.x - dx, frame.z - dz),
          6.2,
        )
      : 0;
    this.transform.position.set(frame.x, y, frame.z);
    this.transform.rotation.set(-slope, frame.yaw, 0, 'YXZ');
    this.transform.updateMatrix();
  }
  private render() {
    if (!this.proxies) return;
    // Visibility is independent of the route clocks. Occupied cabins retain
    // their owner and door interactions when ambient traffic is hidden.
    this.proxies.visible = this.city.settings.traffic;
    let count = 0;
    for (const frame of this.frames) {
      if (
        this.cabin.serviceDetailReady &&
        frame.vehicleId === this.cabin.serviceVehicleId
      )
        continue;
      this.poseTransform(frame);
      this.proxies.setMatrixAt(count++, this.transform.matrix);
    }
    this.proxies.count = count;
    this.proxies.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.abort?.abort();
    this.cabin.releaseService();
    if (this.proxies) {
      this.proxies.removeFromParent();
      this.proxies.geometry.dispose();
      const materials = Array.isArray(this.proxies.material)
        ? this.proxies.material
        : [this.proxies.material];
      materials.forEach((material) => material.dispose());
      this.proxies = null;
    }
    this.runtimes = [];
    // Keep the constructor's asset ownership explicit; only cabin loaders own
    // loaded boardable assets, and those are released by releaseService().
    void this.assets;
  }
}

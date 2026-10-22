import * as THREE from 'three';
import type { CityEngine } from './engine';
import type {
  TeslaPose,
  TeslaShape,
  TeslaSweepHit,
  TeslaVec3,
} from './tesla-state';
import {
  applyVehicleDamage,
  createVehicleDamage,
  resetVehicleDamage,
  resolveVehicleImpact,
  vehicleDamagePerformance,
} from './vehicle-impact';
import { VehicleDamageVisuals } from './vehicle-damage-visuals';

/** One player's condition; no shared traffic-car geometry/material is mutated. */
export class VehicleCondition {
  readonly damage = createVehicleDamage();
  readonly visuals: VehicleDamageVisuals;
  private time = 0;
  private contacts = new Map<
    string,
    { seen: number; point: THREE.Vector3; maxClosing: number }
  >();
  private episode = 0;
  constructor(
    readonly e: CityEngine,
    readonly root: THREE.Group,
    readonly massKg: number,
    readonly modelOffsetY = 0,
  ) {
    this.visuals = new VehicleDamageVisuals(root, {
      maxMarks: 16,
      maxDentDepthM: 0.12,
    });
    e.prepareNightReceivers?.(this.visuals.group);
  }
  get performance() {
    return vehicleDamagePerformance(this.damage);
  }
  update(dt: number) {
    this.time += Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
    for (const [id, c] of this.contacts)
      if (this.time - c.seen > 0.2) this.contacts.delete(id);
    this.visuals.update(dt);
  }
  impact(query: {
    hit: TeslaSweepHit;
    pose: TeslaPose;
    velocity: TeslaVec3;
    shape: TeslaShape;
  }) {
    const obstacle = this.e.vehicleImpacts?.obstacle(query.hit.surfaceId) ?? {
      id: query.hit.surfaceId,
      kind: 'rigid' as const,
    };
    let response = resolveVehicleImpact({
      velocity: query.velocity,
      normal: query.hit.normal,
      massKg: this.massKg,
      obstacle,
    });
    if (
      response.broken &&
      !this.e.vehicleImpacts?.breakProp(obstacle.id, query.velocity)
    ) {
      response = resolveVehicleImpact({
        velocity: query.velocity,
        normal: query.hit.normal,
        massKg: this.massKg,
        obstacle: { id: obstacle.id, kind: 'rigid' },
      });
    }
    if (!response.valid)
      return { velocity: [0, 0, 0] as TeslaVec3, passThrough: false };
    const point = new THREE.Vector3(...query.hit.point),
      previous = this.contacts.get(obstacle.id);
    const newImpact =
      !previous || response.closingMps > Math.max(1, previous.maxClosing * 1.5);
    const newScrape =
      !!previous &&
      response.scrape > 0 &&
      point.distanceToSquared(previous.point) > 0.35 * 0.35;
    if (response.closingMps > 0.05) {
      this.contacts.set(obstacle.id, {
        seen: this.time,
        point: newImpact || newScrape ? point : previous!.point,
        maxClosing: Math.max(previous?.maxClosing ?? 0, response.closingMps),
      });
      if (this.contacts.size > 64)
        this.contacts.delete(this.contacts.keys().next().value!);
    }
    if (newImpact || newScrape) {
      const inverse = new THREE.Quaternion(...query.pose.quaternion).invert();
      const local = point
        .clone()
        .sub(new THREE.Vector3(...query.pose.position))
        .applyQuaternion(inverse);
      const normal = new THREE.Vector3(...query.hit.normal)
        .negate()
        .applyQuaternion(inverse);
      const h = query.shape.halfExtents;
      local.set(
        THREE.MathUtils.clamp(local.x, -h[0], h[0]),
        THREE.MathUtils.clamp(local.y, -h[1], h[1]),
        THREE.MathUtils.clamp(local.z, -h[2], h[2]),
      );
      const hit = applyVehicleDamage(this.damage, {
        localPoint: local.toArray(),
        localNormal: normal.toArray(),
        halfExtents: h,
        impact: newImpact
          ? response
          : { ...response, severity: Math.min(0.12, response.severity) },
        eventId: `${obstacle.id}:${this.episode++}`,
      });
      if (hit) {
        const visualPoint = local.clone();
        visualPoint.y += this.modelOffsetY;
        this.visuals.record({
          localPoint: visualPoint.toArray(),
          localNormal: normal.toArray(),
          severity: newImpact
            ? response.severity
            : Math.min(0.12, response.severity),
          scrape: response.scrape > 0.01,
          seed: this.episode,
        });
        this.e.impactFeedback?.emit({
          point: query.hit.point,
          normal: query.hit.normal,
          velocity: query.velocity,
          kind: obstacle.kind,
          severity: response.severity,
          scrape: response.scrape,
        });
      }
    }
    return { velocity: response.velocity, passThrough: response.broken };
  }
  repair(speedMps: number) {
    if (!Number.isFinite(speedMps) || Math.abs(speedMps) > 0.5) return false;
    resetVehicleDamage(this.damage);
    this.visuals.reset();
    this.contacts.clear();
    return true;
  }
  refresh() {
    this.visuals.refresh();
  }
  dispose() {
    this.visuals.dispose();
    this.contacts.clear();
  }
}

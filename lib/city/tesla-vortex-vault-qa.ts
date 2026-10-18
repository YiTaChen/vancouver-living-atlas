/** Controlled five-car fixture. Explicit loopback + opt-in QA only, never traffic. */
import * as THREE from 'three';
import type { CityEngine } from './engine';
import type { CityTeslaWorld, TeslaRoadSpawn } from './tesla-city-world';
import { project } from './geo';
import type { RoadGraph } from './road-graph';
import {
  createTesla,
  stepTesla,
  type TeslaShape,
  type TeslaSweepHit,
  type TeslaSweepQuery,
  type TeslaVec3,
} from './tesla-state';
import { TeslaWorld, fixedFacesSource, triangleFace } from './tesla-world';
import { sampleTeslaVortex } from './tesla-vortex';

interface Lease {
  isRunning(): boolean;
  begin(): boolean;
  end(): void;
}
interface RoadCandidate {
  origin: readonly [number, number];
  direction: readonly [number, number];
  heading: number;
  length: number;
  width: number;
  edgeIds: number[];
}
export interface TeslaQAVaultCar {
  position: TeslaVec3;
  heading: number;
  distanceM: number;
}
export const TESLA_QA_VAULT_DISTANCES = [8, 13.5, 19, 24.5, 30] as const;
const ROBSON = project([-123.12416073213134, 49.2841737758357]);
const BODY = { size: [1.8, 0.8, 4.3], centerY: 0.75 } as const;
const CABIN = { size: [1.52, 0.65, 2.25], centerY: 1.4 } as const;

/** Follow only actual connected ground edges; reject bends, short/narrow roads. */
export function teslaQAVaultRoadCandidates(graph: RoadGraph): RoadCandidate[] {
  const edges = graph.edges.filter((edge) => {
    const a = graph.nodes[edge.a],
      b = graph.nodes[edge.b];
    return (
      a?.level === 'ground' &&
      b?.level === 'ground' &&
      edge.width >= 8 &&
      !edge.classes.some((kind) => /lane|private|bikeway/.test(kind)) &&
      Math.hypot(a.point[0] - b.point[0], a.point[1] - b.point[1]) > 0.1
    );
  });
  const adjacency = new Map<number, typeof edges>();
  for (const edge of edges)
    for (const node of [edge.a, edge.b]) {
      const connected = adjacency.get(node) ?? [];
      connected.push(edge);
      adjacency.set(node, connected);
    }
  const seeds = edges
    .flatMap((edge) => [
      { edge, start: edge.a, end: edge.b },
      { edge, start: edge.b, end: edge.a },
    ])
    .filter(
      ({ start }) =>
        Math.hypot(
          graph.nodes[start].point[0] - ROBSON[0],
          graph.nodes[start].point[1] - ROBSON[1],
        ) <= 650,
    )
    .sort((a, b) => {
      const distance = (node: number) =>
        Math.hypot(
          graph.nodes[node].point[0] - ROBSON[0],
          graph.nodes[node].point[1] - ROBSON[1],
        );
      return distance(a.start) - distance(b.start);
    })
    .slice(0, 256);
  const found: RoadCandidate[] = [];
  for (const seed of seeds) {
    const start = graph.nodes[seed.start].point,
      first = graph.nodes[seed.end].point,
      initialLength = Math.hypot(first[0] - start[0], first[1] - start[1]),
      direction = [
        (first[0] - start[0]) / initialLength,
        (first[1] - start[1]) / initialLength,
      ] as const,
      visited = new Set([seed.edge.id]),
      edgeIds = [seed.edge.id];
    let end = seed.end,
      length = initialLength,
      width = seed.edge.width;
    while (length < 72 && edgeIds.length < 24) {
      const at = graph.nodes[end].point;
      const next = (adjacency.get(end) ?? [])
        .filter((edge) => !visited.has(edge.id))
        .map((edge) => {
          const node = edge.a === end ? edge.b : edge.a,
            point = graph.nodes[node].point,
            dx = point[0] - at[0],
            dz = point[1] - at[1],
            size = Math.hypot(dx, dz),
            projection =
              (point[0] - start[0]) * direction[0] +
              (point[1] - start[1]) * direction[1],
            lateral = Math.abs(
              (point[0] - start[0]) * direction[1] -
                (point[1] - start[1]) * direction[0],
            );
          return {
            edge,
            node,
            projection,
            lateral,
            dot: (dx * direction[0] + dz * direction[1]) / size,
          };
        })
        .filter(
          (item) =>
            item.dot >= 0.9994 &&
            item.lateral <= 0.25 &&
            item.projection > length,
        )
        .sort((a, b) => b.dot - a.dot)[0];
      if (!next) break;
      visited.add(next.edge.id);
      edgeIds.push(next.edge.id);
      end = next.node;
      length = next.projection;
      width = Math.min(width, next.edge.width);
    }
    // Reserve 5m before the initial vehicle and at least 55m beyond it.
    if (length < 65) continue;
    const origin = [
      start[0] + direction[0] * 5,
      start[1] + direction[1] * 5,
    ] as const;
    if (
      found.some(
        (item) =>
          Math.hypot(item.origin[0] - origin[0], item.origin[1] - origin[1]) <
            4 &&
          item.direction[0] * direction[0] + item.direction[1] * direction[1] >
            0.99,
      )
    )
      continue;
    found.push({
      origin,
      direction,
      heading: Math.atan2(direction[0], direction[1]),
      length: length - 5,
      width,
      edgeIds,
    });
    if (found.length === 32) break;
  }
  return found;
}

/** A sloped plane's elevated discovery probe shifts its returned centre in XZ.
 * Correct the next REQUEST only; each returned pose still comes from the real
 * full-vehicle placement proof. Never move a proved pose to an unproved target.
 */
export function teslaQAVaultGroundAt(
  world: Pick<CityTeslaWorld, 'groundPoseNear'>,
  target: TeslaVec3,
  shape: TeslaShape,
  heading: number,
) {
  const request: [number, number, number] = [...target];
  for (let iteration = 0; iteration < 3; iteration++) {
    if (Math.hypot(request[0] - target[0], request[2] - target[2]) > 0.5)
      return null;
    const spawn = world.groundPoseNear(request, shape, heading, 0, {
      surfaceId: 'ground',
      layer: 0,
    });
    if (
      !spawn ||
      spawn.identity.surfaceId !== 'ground' ||
      spawn.identity.layer !== 0 ||
      spawn.contact.kind !== 'ground'
    )
      return null;
    const dx = spawn.pose.position[0] - target[0],
      dz = spawn.pose.position[2] - target[2];
    if (Math.hypot(dx, dz) <= 0.02)
      return { spawn, request: [...request] as TeslaVec3 };
    request[0] -= dx;
    request[2] -= dz;
  }
  return null;
}

/** Base collision always wins equal times; no zero-fraction/source filtering. */
export function nearestTeslaQAVaultHit(
  base: TeslaSweepHit | null,
  extra: TeslaSweepHit | null,
) {
  if (!base) return extra;
  if (!extra) return base;
  if (!Number.isFinite(base.fraction) || !Number.isFinite(extra.fraction))
    throw new Error('Invalid controlled-fixture collision fraction');
  return extra.fraction < base.fraction ? extra : base;
}

/** Cheap original traffic-shaped boxes; rendered vertices are collision vertices. */
export function createTeslaQAVaultCars(cars: readonly TeslaQAVaultCar[]) {
  if (
    cars.length !== 5 ||
    cars.some(
      (car) =>
        ![...car.position, car.heading, car.distanceM].every(Number.isFinite),
    )
  )
    throw new Error('The controlled fixture requires exactly five finite cars');
  const group = new THREE.Group();
  group.name = 'CONTROLLED QA FIXTURE: five static vault cars';
  const body = new THREE.BoxGeometry(...BODY.size),
    cabin = new THREE.BoxGeometry(...CABIN.size),
    paint = new THREE.MeshStandardMaterial({
      color: 0xd6b16a,
      roughness: 0.46,
      metalness: 0.15,
    }),
    glass = new THREE.MeshStandardMaterial({
      color: 0x345260,
      roughness: 0.36,
      metalness: 0.2,
    }),
    sources = cars.map((car, carIndex) => {
      const root = new THREE.Group(),
        faces = [];
      root.position.fromArray(car.position);
      root.rotation.y = car.heading;
      group.add(root);
      for (const [part, geometry, material, datum] of [
        ['body', body, paint, BODY],
        ['cabin', cabin, glass, CABIN],
      ] as const) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = datum.centerY;
        root.add(mesh);
        group.updateMatrixWorld(true);
        const vertices = geometry.getAttribute('position'),
          index = geometry.index!;
        for (let i = 0; i < index.count; i += 3) {
          const vertex = (offset: number): TeslaVec3 =>
            new THREE.Vector3()
              .fromBufferAttribute(vertices, index.getX(i + offset))
              .applyMatrix4(mesh.matrixWorld)
              .toArray();
          const triangle = [vertex(0), vertex(1), vertex(2)] as const;
          faces.push(
            triangleFace(
              `qa-vault-car:${carIndex}:${part}`,
              `qa-vault-car:${carIndex}:${part}:${i / 3}`,
              'obstacle',
              triangle,
              false,
            ),
          );
        }
      }
      return fixedFacesSource(`qa-vault-car:${carIndex}`, faces, (point) => {
        const dx = point[0] - car.position[0],
          dz = point[2] - car.position[2],
          x = Math.cos(car.heading) * dx - Math.sin(car.heading) * dz,
          z = Math.sin(car.heading) * dx + Math.cos(car.heading) * dz;
        return [BODY, CABIN].some(
          (part) =>
            Math.abs(x) < part.size[0] / 2 &&
            Math.abs(z) < part.size[2] / 2 &&
            Math.abs(point[1] - car.position[1] - part.centerY) <
              part.size[1] / 2,
        );
      });
    }),
    world = new TeslaWorld({ sources, maxCachedTiles: 12 });
  let disposed = false;
  return {
    group,
    world,
    metadata: {
      label: 'Controlled QA fixture; not live traffic',
      cars: cars.map((car) => ({ ...car, body: BODY, cabin: CABIN })),
      collision: 'exact rendered box triangles; additive nearest collision',
      triangles: 120,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.clear();
      body.dispose();
      cabin.dispose();
      paint.dispose();
      glass.dispose();
      world.dispose();
    },
  };
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export function installTeslaVortexVaultQA(
  e: CityEngine,
  panel: HTMLElement,
  lease: Lease,
) {
  if (
    process.env.VANCOUVER_VISUAL_QA !== '1' ||
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(
      globalThis.location?.hostname ?? '',
    )
  )
    return;
  const section = document.createElement('section'),
    status = document.createElement('p');
  section.setAttribute('aria-label', 'Controlled five-car vault QA fixture');
  status.textContent =
    'Controlled QA fixture: five static cars, not live traffic';
  section.appendChild(status);
  panel.appendChild(section);
  let disposed = false,
    sequence = 0,
    observer = 0,
    armed = false,
    paused = false;
  let fixture: ReturnType<typeof createTeslaQAVaultCars> | null = null;
  let restore: (() => void) | null = null;
  let owner: CityEngine['tesla'] = null;
  let capturedWorld: NonNullable<CityEngine['tesla']>['world'] = null;
  let capturedState: NonNullable<CityEngine['tesla']>['state'] = null;
  let evidence: Record<string, unknown> | null = null;
  const clear = () => {
    sequence++;
    armed = false;
    if (observer) cancelAnimationFrame(observer);
    observer = 0;
    restore?.();
    restore = null;
    fixture?.dispose();
    fixture = null;
    if (paused && owner?.active) owner.setInputEnabled(true);
    paused = false;
    owner = null;
    capturedWorld = null;
    capturedState = null;
  };
  const valid = () =>
    !disposed &&
    !e.disposed &&
    !e.pageSuspended &&
    !e.contextLost &&
    !document.hidden;
  const observe = () => {
    observer = 0;
    if (
      !fixture ||
      !owner?.active ||
      owner.world !== capturedWorld ||
      owner.state !== capturedState ||
      !valid()
    ) {
      clear();
      return;
    }
    const motion = owner.state?.vortex;
    if (motion) {
      const progress = sampleTeslaVortex(motion).progress;
      if (evidence)
        evidence.maximumObservedProgress = Math.max(
          Number(evidence.maximumObservedProgress ?? 0),
          progress,
        );
      if (armed && progress >= 0.4 && progress <= 0.85) {
        owner.setInputEnabled(false);
        armed = false;
        paused = true;
        if (evidence)
          evidence.midpointPause = {
            progress,
            at: new Date().toISOString(),
            input: 'public setInputEnabled(false)',
          };
        status.textContent =
          'Controlled fixture paused AFTER actual Vortex progress; save checkpoint, then resume';
      }
    }
    observer = requestAnimationFrame(observe);
  };
  const prepare = async () => {
    if (!lease.begin()) return;
    clear();
    evidence = null;
    const token = sequence,
      attempts: Record<string, unknown>[] = [];
    try {
      if (!valid() || !e.tesla || !e.navigation)
        throw new Error('Live local Tesla/navigation required');
      const t = e.tesla;
      if (!t.active && !t.enter())
        throw new Error('No verified ordinary-ground Tesla entry');
      const world = t.world;
      if (!world) throw new Error('Actual city collision world unavailable');
      const candidates = teslaQAVaultRoadCandidates(e.data.roadGraph);
      for (const road of candidates) {
        await nextFrame();
        if (!valid() || token !== sequence)
          throw new Error('Controlled fixture preparation stopped');
        const attempt: Record<string, unknown> = {
          edgeIds: road.edgeIds,
          stage: 'road-seeds',
        };
        attempts.push(attempt);
        const offsets = [
            ...new Set([0, 5, ...TESLA_QA_VAULT_DISTANCES, 35, 40, 45, 50]),
          ].sort((a, b) => a - b),
          seeds: {
            distance: number;
            spawn: TeslaRoadSpawn;
            request: TeslaVec3;
          }[] = [];
        for (const distance of offsets) {
          const x = road.origin[0] + road.direction[0] * distance,
            z = road.origin[1] + road.direction[1] * distance,
            y = e.data.roadRelief?.(x, z) ?? e.elevation(x, z),
            grounded = teslaQAVaultGroundAt(
              world,
              [x, y + 1.05, z],
              t.shape,
              road.heading,
            ),
            spawn = grounded?.spawn;
          if (!spawn) {
            attempt.reason = 'no exact full-vehicle ground support';
            attempt.failedDistanceM = distance;
            attempt.failedTarget = [x, z];
            break;
          }
          if (
            spawn.identity.surfaceId !== 'ground' ||
            spawn.identity.layer !== 0 ||
            spawn.contact.kind !== 'ground' ||
            spawn.contact.normal[1] < 0.998 ||
            Math.hypot(spawn.pose.position[0] - x, spawn.pose.position[2] - z) >
              0.02 ||
            world.sweep({
              from: spawn.pose,
              to: spawn.pose,
              shape: t.shape,
              ignoreSurfaceId: spawn.contact.surfaceId,
            })
          ) {
            attempt.reason = 'ground identity/normal/body proof rejected';
            attempt.failedDistanceM = distance;
            attempt.failedNormalY = spawn.contact.normal[1];
            break;
          }
          attempt.maximumProbeCorrectionM = Math.max(
            Number(attempt.maximumProbeCorrectionM ?? 0),
            Math.hypot(grounded!.request[0] - x, grounded!.request[2] - z),
          );
          seeds.push({ distance, spawn, request: grounded!.request });
        }
        attempt.provedSeeds = seeds.length;
        attempt.heightVariationM = seeds.length
          ? Math.max(...seeds.map((seed) => seed.spawn.contact.point[1])) -
            Math.min(...seeds.map((seed) => seed.spawn.contact.point[1]))
          : null;
        if (seeds.length !== offsets.length) continue;
        if (Number(attempt.heightVariationM) > 1.5) {
          attempt.reason = 'road height variation exceeds1.5m over50m';
          continue;
        }
        attempt.stage = 'launch-corridor';
        const initial = seeds[0].spawn;
        if (!world.hasLaunchClearance(initial, t.shape)) {
          attempt.reason = 'actual20m vertical launch corridor blocked';
          continue;
        }
        const cars = TESLA_QA_VAULT_DISTANCES.map((distance) => {
          const seed = seeds.find((item) => item.distance === distance)!;
          return {
            position: [
              seed.spawn.pose.position[0],
              seed.spawn.contact.point[1],
              seed.spawn.pose.position[2],
            ] as TeslaVec3,
            heading: road.heading,
            distanceM: distance,
          };
        });
        // Entry uses public navigation and the existing controller. No player
        // position, contact, quaternion or air state is assigned by this helper.
        attempt.stage = 'public-entry';
        attempt.reason = 'public ground entry did not retain the verified seed';
        t.deactivate();
        e.flight?.clear();
        e.applySettings({
          ...e.settings,
          mode: 'drive',
          buildings: true,
          labels: false,
          autoRotate: false,
        });
        e.transition = null;
        const placed = e.navigation.startAt('drive', {
          x: seeds[0].request[0],
          z: seeds[0].request[2],
          y: seeds[0].request[1],
          yaw: road.heading,
          surface: 'ground',
          surfaceId: 'ground',
          layer: 0,
          name: 'Controlled five-car vault QA fixture',
          snappedDistance: 0,
        });
        if (
          placed === false ||
          !t.enter() ||
          !t.state ||
          t.state.mode !== 'ground' ||
          t.state.contact?.kind !== 'ground' ||
          Math.hypot(
            t.state.position[0] - initial.pose.position[0],
            t.state.position[2] - initial.pose.position[2],
          ) > 0.02
        )
          continue;
        const enteredIdentity = t.world?.identity(t.state.contact);
        if (
          !enteredIdentity ||
          enteredIdentity.surfaceId !== 'ground' ||
          enteredIdentity.layer !== 0 ||
          t.world !== world
        )
          continue;
        attempt.stage = 'cloned-actual-preflight';
        attempt.reason = 'actual fully swept arc rejected';
        const extra = createTeslaQAVaultCars(cars);
        // Retain exact method identity for restoration; invoke with world as this.
        // oxlint-disable-next-line typescript/unbound-method
        const originalSweep = world.sweep;
        // oxlint-disable-next-line typescript/unbound-method
        const originalDeparture = world.sweepGroundDeparture;
        const wrappedSweep = (query: TeslaSweepQuery) =>
          nearestTeslaQAVaultHit(
            originalSweep.call(world, query),
            extra.world.sweep(query),
          );
        const wrappedDeparture = (
          query: Parameters<typeof originalDeparture>[0],
        ) =>
          nearestTeslaQAVaultHit(
            originalDeparture.call(world, query),
            extra.world.sweep(query),
          );
        world.sweep = wrappedSweep;
        world.sweepGroundDeparture = wrappedDeparture;
        const release = () => {
          if (world.sweep === wrappedSweep) world.sweep = originalSweep;
          if (world.sweepGroundDeparture === wrappedDeparture)
            world.sweepGroundDeparture = originalDeparture;
        };
        let accepted = false;
        t.setInputEnabled(false);
        try {
          const proof = createTesla(
            [...t.state.position],
            t.state.heading,
            t.state.contact,
          );
          proof.quaternion = [...t.state.quaternion];
          let sawRoll = false,
            collisions = 0,
            maximumProgress = 0,
            preflightSteps = 0;
          for (let frame = 0; frame < 240; frame++) {
            const report = stepTesla(
              proof,
              frame === 0 ? { vortex: true } : {},
              1 / 120,
              world,
              t.shape,
            );
            preflightSteps++;
            collisions += report.collisions + report.environmentFailures;
            const upY =
              1 - 2 * (proof.quaternion[0] ** 2 + proof.quaternion[2] ** 2);
            sawRoll ||= upY < -0.5;
            maximumProgress = Math.max(
              maximumProgress,
              proof.vortex ? sampleTeslaVortex(proof.vortex).progress : 0,
            );
            if (collisions) break;
            if (!proof.vortex && sawRoll && maximumProgress > 0.9) break;
            if (frame % 24 === 23) {
              await nextFrame();
              if (!valid() || token !== sequence)
                throw new Error('Controlled fixture preflight stopped');
            }
          }
          const forwardDistance =
            (proof.position[0] - t.state.position[0]) * road.direction[0] +
            (proof.position[2] - t.state.position[2]) * road.direction[1];
          Object.assign(attempt, {
            collisions,
            sawRoll,
            maximumProgress,
            forwardDistance,
            remainingVortex: !!proof.vortex,
            collisionSurfaceId: proof.collisionSurfaceId,
          });
          if (
            collisions ||
            !sawRoll ||
            maximumProgress < 0.9 ||
            proof.vortex ||
            forwardDistance < 35
          )
            continue;
          accepted = true;
          fixture = extra;
          restore = release;
          owner = t;
          capturedWorld = world;
          capturedState = t.state;
          e.scene.add(extra.group);
          t.setView('chase');
          t.clearInput();
          evidence = {
            kind: 'controlled-five-car-vault-qa-v1',
            ...extra.metadata,
            preparedAt: new Date().toISOString(),
            road,
            selectionProof: {
              candidatesChecked: attempts.length,
              heightVariationM: attempt.heightVariationM,
              maximumProbeCorrectionM: attempt.maximumProbeCorrectionM,
              finalTargetToleranceM: 0.02,
              maximumRequestCorrectionM: 0.5,
              lowGradeHeightLimitM: 1.5,
            },
            initial: {
              position: [...t.state.position],
              quaternion: [...t.state.quaternion],
              contact: { ...t.state.contact },
            },
            preflight: {
              clonedActualSimulation: true,
              appliedToPlayer: false,
              steps: preflightSteps,
              landingProved: false,
              collisions,
              sawRoll,
              maximumProgress,
              forwardDistance,
            },
            collisionOverlayActive: true,
            maximumObservedProgress: 0,
          };
          observer = requestAnimationFrame(observe);
          status.textContent =
            'Controlled five-car fixture READY: use native V or mobile Vortex Jump; arm midpoint pause before jumping if needed';
          return;
        } finally {
          if (t.active) t.setInputEnabled(true);
          if (!accepted) {
            release();
            extra.dispose();
          }
        }
      }
      throw new Error(
        'No bounded, flat, actual road with a proved five-car arc; no fixture was invented',
      );
    } catch (error) {
      clear();
      evidence = {
        kind: 'controlled-five-car-vault-qa-v1',
        error: String(error),
        attempts,
        collisionOverlayActive: false,
      };
      const summary = attempts
        .slice(-4)
        .map((attempt) => {
          const stage =
              typeof attempt.stage === 'string' ? attempt.stage : 'unknown',
            reason =
              typeof attempt.reason === 'string'
                ? attempt.reason
                : typeof attempt.collisionSurfaceId === 'string'
                  ? attempt.collisionSurfaceId
                  : 'rejected',
            distance =
              typeof attempt.failedDistanceM === 'number'
                ? ` @${attempt.failedDistanceM}m`
                : '',
            height =
              typeof attempt.heightVariationM === 'number'
                ? ` Δh${attempt.heightVariationM.toFixed(2)}m`
                : '';
          return `${stage}: ${reason}${distance}${height}`;
        })
        .join(' | ');
      status.textContent = `${String(error)} (${attempts.length} candidates) ${summary}`;
    } finally {
      lease.end();
    }
  };
  const button = (
    label: string,
    action: () => void | Promise<void>,
    allowBusy = false,
  ) => {
    const element = document.createElement('button');
    element.textContent = label;
    element.onclick = () => {
      if (!allowBusy && lease.isRunning()) return;
      return action();
    };
    section.appendChild(element);
  };
  button('Controlled QA: prepare five-car vault', prepare);
  button('Controlled QA: arm actual midpoint pause', () => {
    if (!fixture) {
      status.textContent = 'Prepare the controlled fixture first';
      return;
    }
    armed = true;
    status.textContent =
      'Armed: native V/mobile Vortex will pause only after actual progress reaches 40%';
  });
  button('Controlled QA: resume actual maneuver', () => {
    if (paused && owner?.active && valid()) {
      owner.setInputEnabled(true);
      paused = false;
      status.textContent = 'Actual maneuver resumed; native controls are live';
    }
  });
  button(
    'Controlled QA: clear five-car fixture',
    () => {
      clear();
      evidence = null;
      status.textContent =
        'Controlled fixture removed; original collision methods restored';
    },
    true,
  );
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clear();
    globalThis.removeEventListener?.('pagehide', dispose);
    section.remove?.();
  };
  globalThis.addEventListener?.('pagehide', dispose);
  return {
    metadata: () =>
      evidence
        ? {
            ...evidence,
            collisionOverlayActive: !!fixture,
            midpointPauseArmed: armed,
            pausedByQA: paused,
          }
        : null,
    dispose,
  };
}

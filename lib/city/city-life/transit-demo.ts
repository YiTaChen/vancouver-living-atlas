import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { SurfaceState } from '../surface-reachability';
import {
  ContinuousPath,
  riderWorldTransform,
  type LaneCurve,
} from './continuous-path';
import {
  PassengerTransfers,
  type BoardingProof,
  type PassengerState,
} from './passenger-transfers';
import { SimulationClock } from './simulation-clock';
import {
  TransitService,
  type ServicePlan,
  type ServiceSnapshot,
  type ServiceStop,
} from './transit-service';
import {
  passengerContractFromManifest,
  type VehiclePassengerContract,
} from './vehicle-profile-adapter';

const VEHICLE_ID = 'research-bus-instance';
const CAR_ID = 'research-bus-car';
const PASSENGER_ID = 'research-passenger';
export const TRANSIT_DEMO_SCOPE =
  'Representative research layout; not a geographic bus route or the seven-station network.';
type Point = [number, number, number];
interface DoorMetadata {
  doorId: string;
  doorGroupId: string;
  nodeId: string;
  animationClip: string;
  side: 'right';
  boardingPointM: Point;
  motion: {
    durationS: number;
    keyframes: { timeS: number; transform: { translationM: Point } }[];
  };
}
export interface TransitDemoStop extends ServiceStop {
  label: string;
  /** A real adapter supplies surveyed surfaces instead of these research curb rectangles. */
  curbBoundsLocal: { min: Point; max: Point };
}
export interface TransitDemoLayout {
  classification: 'representative-research-layout' | 'verified-source-service';
  sourceDescription: string;
  path: ContinuousPath;
  plan: ServicePlan;
  stops: readonly TransitDemoStop[];
  initialFloor: SurfaceState;
}
export interface TransferObservation {
  kind: 'board' | 'alight';
  floor: SurfaceState;
  doorWorldPoint: THREE.Vector3;
  vehicle: THREE.Group;
  stop: TransitDemoStop;
}
export interface TransferSurfaceChecks {
  floorValid: boolean;
  zoneClear: boolean;
  lineOfSight: boolean;
}
export interface TransitDemoOptions {
  assetBaseUrl?: string;
  manifestUrl?: string;
  signal?: AbortSignal;
  layout?: TransitDemoLayout;
  includeResearchEnvironment?: boolean;
  /** Required for a source-backed city layout. Must query fresh exact surfaces/collision. */
  validateTransfer?: (
    observation: TransferObservation,
  ) => TransferSurfaceChecks;
  /** A city adapter must supply occupancy clearance; the isolated empty test lane uses Infinity. */
  clearDistanceM?: (service: ServiceSnapshot) => number;
}
export interface TransitDemoSnapshot {
  scope: string;
  sourceDescription: string;
  service: ServiceSnapshot;
  currentStopLabel: string;
  passenger: PassengerState;
  paused: boolean;
  doorsOpen: boolean;
  doorProgress: number;
  canBoard: boolean;
  canAlight: boolean;
  anchors: {
    id: string;
    kind: 'seat' | 'standing';
    datum: 'pelvis' | 'feet';
  }[];
  passengerCount: number;
  pendingTransfers: number;
  anchorErrorM: number;
  elapsedSeconds: number;
  lastAction: string;
  events: string[];
}
const point = (value: unknown): Point => {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    throw new Error('Invalid transit demo metadata point');
  return [...value] as Point;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid transit demo metadata record');
  return value as Record<string, unknown>;
};
const requiredString = (value: unknown) => {
  if (typeof value !== 'string' || !value)
    throw new Error('Missing transit demo metadata identity');
  return value;
};
export function transitDemoBusMetadata(manifest: unknown) {
  const root = record(manifest);
  if (!Array.isArray(root.vehicles) || !Array.isArray(root.assets))
    throw new Error('Missing bus manifest collections');
  const vehicle = record(
    root.vehicles.find((v) => record(v).vehicleId === 'city-bus-12m'),
  );
  if (!Array.isArray(vehicle.doors)) throw new Error('Missing bus doors');
  const doors: DoorMetadata[] = vehicle.doors.map((value) => {
    const d = record(value),
      motion = record(d.motion);
    if (
      d.side !== 'right' ||
      d.frameId !== 'vehicle' ||
      !Array.isArray(motion.keyframes)
    )
      throw new Error('Unsupported door frame/side');
    const durationS = Number(motion.durationS);
    if (!Number.isFinite(durationS) || durationS <= 0)
      throw new Error('Invalid door duration');
    const keyframes = motion.keyframes.map((value) => {
      const k = record(value),
        transform = record(k.transform),
        timeS = Number(k.timeS);
      if (!Number.isFinite(timeS) || transform.parentFrameId !== 'vehicle')
        throw new Error('Invalid door keyframe');
      return {
        timeS,
        transform: { translationM: point(transform.translationM) },
      };
    });
    if (
      keyframes.length < 2 ||
      keyframes[0].timeS !== 0 ||
      keyframes.at(-1)?.timeS !== durationS ||
      keyframes.some((k, i) => i > 0 && k.timeS <= keyframes[i - 1].timeS)
    )
      throw new Error('Invalid ordered door keyframes');
    return {
      doorId: requiredString(d.doorId),
      doorGroupId: requiredString(d.doorGroupId),
      nodeId: requiredString(d.nodeId),
      animationClip: requiredString(d.animationClip),
      side: 'right',
      boardingPointM: point(d.boardingPointM),
      motion: { durationS, keyframes },
    };
  });
  if (
    doors.length !== 4 ||
    new Set(doors.map((d) => d.doorId)).size !== 4 ||
    !doors.some((d) => d.doorGroupId === 'front') ||
    !doors.some((d) => d.doorGroupId === 'rear')
  )
    throw new Error('Incomplete representative bus door contract');
  const contract = passengerContractFromManifest(
    manifest,
    'city-bus-12m',
    'low-floor-bus-12m',
    VEHICLE_ID,
    CAR_ID,
    0,
  );
  const assets = root.assets.map(record);
  const assetFile = (id: string) => {
    const asset = assets.find((a) => a.id === id);
    if (!asset || !Array.isArray(asset.lods))
      throw new Error('Missing transit asset');
    const lod = asset.lods.map(record).find((l) => l.level === 0);
    if (!lod) throw new Error('Missing passenger-capable LOD0');
    const file = requiredString(lod.file);
    if (!/^exports\/[a-z0-9.-]+\.glb$/.test(file))
      throw new Error('Unexpected transit asset path');
    return file;
  };
  return {
    doors,
    contract,
    exteriorFile: assetFile(contract.assetRefs.exterior),
    interiorFile: assetFile(contract.assetRefs.interior),
  };
}

/** Original local test lane. These are intentionally not GTFS stops or geographic coordinates. */
export function createResearchTransitLayout(): TransitDemoLayout {
  const identity = {
    surfaceId: 'research-road',
    layer: 0,
    sourceId: 'authored-local-transit-qa',
  };
  const segments: LaneCurve[] = [
    {
      ...identity,
      segmentId: 'research-straight',
      points: [
        [0, 0, 0],
        [0, 0, 10],
        [0, 0, 20],
        [0, 0, 30],
      ],
    },
    {
      ...identity,
      segmentId: 'research-turn',
      points: [
        [0, 0, 30],
        [0, 0, 42],
        [10, 0, 52],
        [22, 0, 52],
      ],
    },
    {
      ...identity,
      segmentId: 'research-exit',
      points: [
        [22, 0, 52],
        [32, 0, 52],
        [42, 0, 52],
        [52, 0, 52],
      ],
    },
  ];
  const path = new ContinuousPath(segments);
  const stations = [8, 27, path.length - 9];
  const stops: TransitDemoStop[] = stations.map((pathStationM, index) => ({
    stopId: `research-stop-${index + 1}`,
    stationId: `research-curb-${index + 1}`,
    platformId: `research-bay-${index + 1}`,
    pathStationM,
    doorSide: 'right',
    surfaceId: `research-curb-${index + 1}`,
    layer: 0,
    label: `研究站 ${String.fromCharCode(65 + index)}`,
    curbBoundsLocal: { min: [-4, 0, -6], max: [-1.55, 0.36, 7] },
  }));
  const firstPose = path.sample(stations[0]);
  const waiting = new THREE.Vector3(-1.7, 0.36, 4.275)
    .applyQuaternion(firstPose.rotation)
    .add(firstPose.position);
  return {
    classification: 'representative-research-layout',
    sourceDescription:
      'Original three-stop curved test lane; 0.36 m level boarding islands are engineering proposals, not surveyed curbs.',
    path,
    stops,
    plan: {
      serviceId: 'research-bus-service',
      lineId: 'research-line',
      directionId: 'research-forward',
      vehicleProfileId: 'low-floor-bus-12m',
      pathId: 'research-continuous-path',
      pathLengthM: path.length,
      stops,
      speedLimitMps: 4,
      accelerationMps2: 1.5,
      brakingMps2: 2,
      endpoint: 'hold-for-alighting',
    },
    initialFloor: {
      x: waiting.x,
      y: waiting.y,
      z: waiting.z,
      surfaceId: stops[0].surfaceId,
      layer: stops[0].layer,
    },
  };
}

/** Shared disposal is safe for GLTF's shared geometry/material references. */
export function disposeTransitObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.clear();
}

function box(size: Point, position: Point, color: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
  );
  mesh.position.set(...position);
  return mesh;
}
function researchEnvironment(layout: TransitDemoLayout) {
  const group = new THREE.Group();
  group.name = 'research-only-curbs-and-road';
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const p = layout.path.sample((layout.path.length * i) / 100);
    for (const side of [-1, 1]) {
      const v = new THREE.Vector3(side * 4.6, 0, 0)
        .applyQuaternion(p.rotation)
        .add(p.position);
      vertices.push(v.x, v.y, v.z);
    }
    if (i) {
      const a = (i - 1) * 2,
        b = i * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const road = new THREE.BufferGeometry();
  road.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  road.setIndex(indices);
  road.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      road,
      new THREE.MeshStandardMaterial({
        color: 0x4c5962,
        side: THREE.DoubleSide,
      }),
    ),
  );
  for (const stop of layout.stops) {
    const p = layout.path.sample(stop.pathStationM),
      island = new THREE.Group(),
      bounds = stop.curbBoundsLocal;
    island.position.copy(p.position);
    island.quaternion.copy(p.rotation);
    const width = bounds.max[0] - bounds.min[0],
      length = bounds.max[2] - bounds.min[2];
    island.add(
      box(
        [width, bounds.max[1], length],
        [
          (bounds.min[0] + bounds.max[0]) / 2,
          bounds.max[1] / 2,
          (bounds.min[2] + bounds.max[2]) / 2,
        ],
        0xd9dfd5,
      ),
    );
    // Explicit local threshold spans the test curb's gap. This is not a real curb ramp.
    for (const z of [4.275, -0.625])
      island.add(box([0.46, 0.04, 1.15], [-1.325, 0.34, z], 0xf0b74f));
    island.add(box([0.08, 2.5, 0.08], [-3.6, 1.61, 4.8], 0x536a63));
    island.add(box([0.6, 0.55, 0.1], [-3.6, 2.7, 4.8], 0x66b8b0));
    group.add(island);
  }
  return group;
}

/** WebGL-independent controller + GLTF visual adapter. No engine/navigation/global camera ownership. */
export class TransitDemoRuntime {
  readonly root = new THREE.Group();
  readonly vehicle = new THREE.Group();
  readonly layout: TransitDemoLayout;
  readonly contract: VehiclePassengerContract;
  readonly service: TransitService;
  readonly transfers = new PassengerTransfers(1);
  private clock = new SimulationClock();
  private paused = false;
  private disposed = false;
  private doors: DoorMetadata[];
  private mixer: THREE.AnimationMixer;
  private doorActions: {
    door: DoorMetadata;
    node: THREE.Object3D;
    action: THREE.AnimationAction;
    startTime: number;
  }[];
  private doorProgress = 0;
  private stoppedSeconds = 0;
  private passengerVisual = new THREE.Group();
  private lastAction = '等待公車停靠研究站 A';
  private events: string[] = [];
  private phase: ServiceSnapshot['phase'] = 'moving';
  constructor(
    manifest: unknown,
    exterior: GLTF,
    interior: GLTF,
    private options: TransitDemoOptions = {},
  ) {
    const metadata = transitDemoBusMetadata(manifest);
    this.doors = metadata.doors;
    this.contract = metadata.contract;
    this.layout = options.layout ?? createResearchTransitLayout();
    if (
      this.layout.classification !== 'representative-research-layout' &&
      (!options.validateTransfer || !options.clearDistanceM)
    )
      throw new Error(
        'City service requires fresh surface and occupancy validators',
      );
    if (
      this.layout.plan.pathLengthM !== this.layout.path.length ||
      this.layout.stops.length !== this.layout.plan.stops.length ||
      this.layout.stops.some(
        (s, i) => s.stopId !== this.layout.plan.stops[i].stopId,
      )
    )
      throw new Error('Transit layout/plan mismatch');
    this.service = new TransitService(VEHICLE_ID, this.layout.plan);
    if (!this.transfers.register(PASSENGER_ID, this.layout.initialFloor))
      throw new Error('Invalid initial passenger floor');
    this.root.name = 'boardable-transit-runtime';
    this.vehicle.name = VEHICLE_ID;
    this.vehicle.add(exterior.scene, interior.scene);
    this.root.add(this.vehicle);
    this.mixer = new THREE.AnimationMixer(exterior.scene);
    this.doorActions = this.doors.map((door) => {
      const node = exterior.scene.getObjectByName(door.nodeId),
        clip = THREE.AnimationClip.findByName(
          exterior.animations,
          door.animationClip,
        );
      if (!node || !clip || !clip.tracks.length)
        throw new Error(`Missing actual door node/clip: ${door.doorId}`);
      // Blender exports frame 1 at 1/24 s, not necessarily t=0. Normalize the actual
      // track interval while retaining its authored plug/slide interpolation.
      const startTime = Math.min(...clip.tracks.map((track) => track.times[0]));
      const endTime = Math.max(
        ...clip.tracks.map((track) => track.times[track.times.length - 1]),
      );
      if (Math.abs(endTime - startTime - door.motion.durationS) > 1e-4)
        throw new Error(`Door clip interval mismatch: ${door.doorId}`);
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      action.paused = true;
      return { door, node, action, startTime };
    });
    if (
      options.includeResearchEnvironment !== false &&
      this.layout.classification === 'representative-research-layout'
    )
      this.root.add(researchEnvironment(this.layout));
    this.passengerVisual.name = PASSENGER_ID;
    this.root.add(this.passengerVisual);
    this.applyPose();
    this.applyDoors();
    this.applyPassenger();
    this.log('GLB 外殼、內裝、4 個門動畫與 12 個固定乘客錨點已載入');
  }
  update(elapsed: number) {
    if (this.disposed) return;
    this.clock.advance(elapsed, (dt) => {
      const before = this.service.snapshot();
      const target = ['opening', 'dwell', 'terminal'].includes(before.phase)
        ? 1
        : 0;
      this.doorProgress = THREE.MathUtils.clamp(
        this.doorProgress + Math.sign(target - this.doorProgress) * dt,
        0,
        1,
      );
      this.applyDoors();
      const stopped =
        ['stopped', 'opening', 'dwell', 'closing', 'terminal'].includes(
          before.phase,
        ) && before.speedMps <= 0.05;
      this.stoppedSeconds = stopped ? this.stoppedSeconds + dt : 0;
      const next = this.service.update(dt, {
        clearDistanceM: this.options.clearDistanceM?.(before) ?? Infinity,
        doorsClosed: this.doorProgress === 0,
        platformDoorsOpen: this.actualDoorsOpen(),
        alignmentValid: this.alignedAtStop(),
        pendingTransfers: this.transfers.pendingFor(VEHICLE_ID),
      });
      if (next.phase !== this.phase) {
        this.phase = next.phase;
        this.log(`${this.currentStop().label}: ${next.phase}`);
      }
      this.transfers.expire(this.clock.time);
      this.applyPose();
      this.applyPassenger();
    });
  }
  /** Explicit QA stepping; uses the same clock/service/actual GLTF animations, never a pose reset. */
  advanceToNextOpenStop() {
    if (this.paused || this.disposed) return false;
    const before = this.service.snapshot();
    const alreadyOpen =
      this.actualDoorsOpen() && ['dwell', 'terminal'].includes(before.phase);
    if (alreadyOpen && before.stopIndex === this.layout.stops.length - 1)
      return false;
    const targetIndex = before.stopIndex + (alreadyOpen ? 1 : 0);
    for (let i = 0; i < 1600; i++) {
      this.update(0.05);
      const next = this.service.snapshot();
      if (
        next.stopIndex === targetIndex &&
        this.actualDoorsOpen() &&
        ['dwell', 'terminal'].includes(next.phase)
      ) {
        if (
          targetIndex === this.layout.stops.length - 1 &&
          next.phase === 'dwell'
        )
          this.update(0.05);
        this.log(`驗證步進完成：${this.currentStop().label} 門已實際開啟`);
        return true;
      }
    }
    return this.reject('步進未到達有效開門站點；保留目前狀態');
  }
  setPaused(value: boolean) {
    if (value === this.paused) return;
    this.paused = value;
    this.clock.setHidden(value);
    this.log(
      value ? '服務暫停；保留車、乘客與門狀態' : '服務恢復；不補算隱藏時間',
    );
  }
  board(anchorId: string) {
    if (this.paused || this.disposed) return false;
    const anchor = this.contract.anchors.find(
        (a) => a.anchor.anchorId === anchorId,
      ),
      passenger = this.passenger();
    if (!anchor || passenger.mode !== 'walking')
      return this.reject('只能從已驗證候車地板登乘');
    const proof = this.proof('board', passenger.floor),
      token = this.transfers.beginBoard(
        PASSENGER_ID,
        anchor.anchor,
        proof,
        this.clock.time,
      );
    if (!token) return this.reject('尚未停妥、開門或門口未對位');
    this.transfers.markPreloaded(token, this.clock.time);
    const committed = this.transfers.commit(
      token,
      this.proof('board', passenger.floor),
      this.clock.time,
    );
    if (!committed) return this.reject('登乘前再次驗證失敗，保留原地板');
    this.applyPassenger();
    this.log(`已上車：${anchor.anchor.anchorId}（${anchor.datum} datum）`);
    return true;
  }
  requestStop() {
    if (this.paused || this.disposed || this.passenger().mode !== 'riding')
      return false;
    this.service.requestStop();
    this.log('已按下車鈴；此驗證服務仍每站停靠');
    return true;
  }
  alight() {
    if (this.paused || this.disposed || this.passenger().mode !== 'riding')
      return false;
    const floor = this.exitFloor(),
      proof = this.proof('alight', floor),
      token = this.transfers.beginAlight(
        PASSENGER_ID,
        floor,
        proof,
        this.clock.time,
      );
    if (!token) return this.reject('目前無有效開門停靠與下車地板');
    this.transfers.markPreloaded(token, this.clock.time);
    if (
      !this.transfers.commit(
        token,
        this.proof('alight', floor),
        this.clock.time,
      )
    )
      return this.reject('下車前再次驗證失敗，保留車上錨點');
    this.applyPassenger();
    this.log(`已由後門下車：${this.currentStop().label}`);
    return true;
  }
  snapshot(): TransitDemoSnapshot {
    const passenger = this.passenger(),
      boardProof =
        passenger.mode === 'walking'
          ? this.proof('board', passenger.floor)
          : null;
    const exitProof =
      passenger.mode === 'riding'
        ? this.proof('alight', this.exitFloor())
        : null;
    const valid = (p: BoardingProof | null) =>
      !!p &&
      p.doorOpen &&
      p.alignmentValid &&
      p.floorValid &&
      p.zoneClear &&
      p.lineOfSight &&
      p.distanceM <= 2 &&
      p.stoppedSeconds >= 0.5;
    let anchorErrorM = 0;
    if (passenger.mode === 'riding') {
      const expected = riderWorldTransform(
        this.vehicle.position,
        this.vehicle.quaternion,
        passenger.anchor.translationM,
        passenger.anchor.rotationQuaternionXYZW,
      );
      anchorErrorM = expected.position.distanceTo(
        this.passengerVisual.getWorldPosition(new THREE.Vector3()),
      );
    }
    return {
      scope:
        this.layout.classification === 'representative-research-layout'
          ? TRANSIT_DEMO_SCOPE
          : 'Source-backed service; geometry and transfer proofs supplied by host.',
      sourceDescription: this.layout.sourceDescription,
      service: this.service.snapshot(),
      currentStopLabel: this.currentStop().label,
      passenger,
      paused: this.paused,
      doorsOpen: this.actualDoorsOpen(),
      doorProgress: this.doorProgress,
      canBoard: !this.paused && valid(boardProof),
      canAlight: !this.paused && valid(exitProof),
      anchors: this.contract.anchors.map((a) => ({
        id: a.anchor.anchorId,
        kind: a.anchor.kind,
        datum: a.datum,
      })),
      passengerCount: this.transfers.occupantsFor(VEHICLE_ID),
      pendingTransfers: this.transfers.pendingFor(VEHICLE_ID),
      anchorErrorM,
      elapsedSeconds: this.clock.time,
      lastAction: this.lastAction,
      events: [...this.events],
    };
  }
  /** Camera is a consumer; changing view never changes passenger occupancy/state. */
  riderCameraPose() {
    const passenger = this.passenger();
    if (passenger.mode !== 'riding') return null;
    const contract = this.contract.anchors.find(
      (a) => a.anchor.anchorId === passenger.anchor.anchorId,
    )!;
    const localEye =
      contract.cameraEyePointM ??
      ([
        passenger.anchor.translationM[0],
        passenger.anchor.translationM[1] + 1.62,
        passenger.anchor.translationM[2],
      ] as Point);
    const eye = new THREE.Vector3(...localEye)
      .applyQuaternion(this.vehicle.quaternion)
      .add(this.vehicle.position);
    return {
      position: eye,
      rotation: this.vehicle.quaternion
        .clone()
        .multiply(
          new THREE.Quaternion(...passenger.anchor.rotationQuaternionXYZW),
        ),
      anchorId: passenger.anchor.anchorId,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.setHidden(true);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    disposeTransitObject(this.root);
  }
  private passenger() {
    return this.transfers.state(PASSENGER_ID)!;
  }
  private currentStop() {
    return this.layout.stops[this.service.snapshot().stopIndex];
  }
  private alignedAtStop() {
    const service = this.service.snapshot();
    return (
      Math.abs(service.pathStationM - this.currentStop().pathStationM) <=
        0.001 && service.speedMps <= 0.05
    );
  }
  private actualDoorsOpen() {
    if (this.doorProgress < 1 - 1e-6) return false;
    this.vehicle.updateWorldMatrix(true, true);
    return this.doorActions.every(({ door, node }) => {
      const actual = this.vehicle.worldToLocal(
        node.getWorldPosition(new THREE.Vector3()),
      );
      return (
        actual.distanceTo(
          new THREE.Vector3(
            ...door.motion.keyframes.at(-1)!.transform.translationM,
          ),
        ) < 0.002
      );
    });
  }
  private applyDoors() {
    for (const { action, door, startTime } of this.doorActions) {
      action.enabled = true;
      action.paused = true;
      action.time = startTime + this.doorProgress * door.motion.durationS;
    }
    this.mixer.update(0);
    this.vehicle.updateWorldMatrix(true, true);
  }
  private applyPose() {
    const pose = this.layout.path.sample(this.service.snapshot().pathStationM);
    this.vehicle.position.copy(pose.position);
    this.vehicle.quaternion.copy(pose.rotation);
    this.vehicle.updateWorldMatrix(true, true);
  }
  private exitFloor() {
    const door = this.doors.find((d) => d.doorGroupId === 'rear')!,
      pose = this.layout.path.sample(this.currentStop().pathStationM);
    const p = new THREE.Vector3(...door.boardingPointM)
      .applyQuaternion(pose.rotation)
      .add(pose.position);
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      surfaceId: this.currentStop().surfaceId,
      layer: this.currentStop().layer,
    };
  }
  private proof(kind: 'board' | 'alight', floor: SurfaceState): BoardingProof {
    const door = this.doors.find(
        (d) => d.doorGroupId === (kind === 'board' ? 'front' : 'rear'),
      )!,
      service = this.service.snapshot(),
      stop = this.currentStop();
    const doorWorldPoint = new THREE.Vector3(...door.boardingPointM)
      .applyQuaternion(this.vehicle.quaternion)
      .add(this.vehicle.position);
    const observation = {
      kind,
      floor,
      doorWorldPoint,
      vehicle: this.vehicle,
      stop,
    };
    const checks =
      this.options.validateTransfer?.(observation) ??
      this.researchSurfaceChecks(observation);
    return {
      vehicleId: VEHICLE_ID,
      serviceId: service.serviceId,
      carId: CAR_ID,
      stopId: stop.stopId,
      platformId: stop.platformId,
      doorId: door.doorId,
      doorSide: 'right',
      surfaceId: stop.surfaceId,
      layer: stop.layer,
      floorPointM: [floor.x, floor.y, floor.z],
      speedMps: service.speedMps,
      stoppedSeconds: this.stoppedSeconds,
      distanceM: new THREE.Vector3(floor.x, floor.y, floor.z).distanceTo(
        doorWorldPoint,
      ),
      doorOpen: this.actualDoorsOpen(),
      correctDoorSide: service.doorSide === 'right',
      alignmentValid: this.alignedAtStop(),
      ...checks,
      passengerCapable: this.contract.capabilities.passengerCapable,
    };
  }
  private researchSurfaceChecks({
    floor,
    stop,
    doorWorldPoint,
  }: TransferObservation): TransferSurfaceChecks {
    if (this.layout.classification !== 'representative-research-layout')
      return { floorValid: false, zoneClear: false, lineOfSight: false };
    const pose = this.layout.path.sample(stop.pathStationM),
      local = new THREE.Vector3(floor.x, floor.y, floor.z)
        .sub(pose.position)
        .applyQuaternion(pose.rotation.clone().invert()),
      bounds = stop.curbBoundsLocal;
    const floorValid =
      floor.surfaceId === stop.surfaceId &&
      floor.layer === stop.layer &&
      Math.abs(local.y - bounds.max[1]) < 0.001 &&
      local.x >= bounds.min[0] &&
      local.x <= bounds.max[0] &&
      local.z >= bounds.min[2] &&
      local.z <= bounds.max[2];
    // Actual open GLTF aperture rays, not a metadata bbox pretending to be collision.
    const entry = this.vehicle.worldToLocal(doorWorldPoint.clone());
    const ray = new THREE.Raycaster();
    let lineOfSight = true;
    this.vehicle.updateWorldMatrix(true, true);
    for (const zOffset of [-0.18, 0.18])
      for (const height of [0.45, 1.65]) {
        const from = new THREE.Vector3(
          entry.x,
          entry.y + height,
          entry.z + zOffset,
        )
          .applyQuaternion(this.vehicle.quaternion)
          .add(this.vehicle.position);
        const to = new THREE.Vector3(-0.65, entry.y + height, entry.z + zOffset)
          .applyQuaternion(this.vehicle.quaternion)
          .add(this.vehicle.position);
        const direction = to.clone().sub(from);
        ray.set(from, direction.clone().normalize());
        ray.near = 0.01;
        ray.far = direction.length();
        if (ray.intersectObject(this.vehicle, true).length) lineOfSight = false;
      }
    return { floorValid, zoneClear: floorValid && lineOfSight, lineOfSight };
  }
  private applyPassenger() {
    const state = this.passenger();
    // Rebuild only when posture changes; never rebuild GLTF per simulation tick.
    const seated = state.mode === 'riding' && state.anchor.kind === 'seat';
    if (this.passengerVisual.userData.seated !== seated) {
      disposeTransitObject(this.passengerVisual);
      this.passengerVisual.userData.seated = seated;
      const material = new THREE.MeshStandardMaterial({
        color: 0xdd785e,
        roughness: 0.9,
      });
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        material,
      );
      head.position.y = seated ? 0.59 : 1.63;
      const torso = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.48, 0.22),
        material,
      );
      torso.position.y = seated ? 0.27 : 1.24;
      this.passengerVisual.add(head, torso);
      for (const x of [-0.09, 0.09]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.13, seated ? 0.32 : 0.72, 0.14),
          material,
        );
        leg.position.set(x, seated ? -0.24 : 0.62, seated ? 0.15 : 0);
        this.passengerVisual.add(leg);
      }
    }
    if (state.mode === 'riding') {
      const pose = riderWorldTransform(
        this.vehicle.position,
        this.vehicle.quaternion,
        state.anchor.translationM,
        state.anchor.rotationQuaternionXYZW,
      );
      this.passengerVisual.position.copy(pose.position);
      this.passengerVisual.quaternion.copy(pose.rotation);
    } else {
      this.passengerVisual.position.set(
        state.floor.x,
        state.floor.y,
        state.floor.z,
      );
      this.passengerVisual.quaternion.identity();
    }
    this.passengerVisual.updateWorldMatrix(true, true);
  }
  private reject(message: string) {
    this.lastAction = message;
    return false;
  }
  private log(message: string) {
    this.lastAction = message;
    this.events = [
      ...this.events.slice(-11),
      `${this.clock.time.toFixed(1)}s ${message}`,
    ];
  }
}

export async function createTransitDemo(options: TransitDemoOptions = {}) {
  const base = (
    options.assetBaseUrl ?? '/__offline-assets/boardable-bus'
  ).replace(/\/$/, '');
  const manifestResponse = await fetch(
    options.manifestUrl ?? `${base}/manifest.json`,
    { signal: options.signal },
  );
  if (!manifestResponse.ok)
    throw new Error(`Bus manifest load failed (${manifestResponse.status})`);
  const manifest: unknown = await manifestResponse.json(),
    metadata = transitDemoBusMetadata(manifest),
    loader = new GLTFLoader();
  const loaded: GLTF[] = [];
  try {
    for (const file of [metadata.exteriorFile, metadata.interiorFile]) {
      const response = await fetch(`${base}/${file}`, {
        signal: options.signal,
      });
      if (!response.ok)
        throw new Error(`Bus GLB load failed (${response.status})`);
      const gltf = await loader.parseAsync(
        await response.arrayBuffer(),
        `${base}/`,
      );
      loaded.push(gltf);
      options.signal?.throwIfAborted();
    }
    return new TransitDemoRuntime(manifest, loaded[0], loaded[1], options);
  } catch (error) {
    for (const gltf of loaded) disposeTransitObject(gltf.scene);
    throw error;
  }
}

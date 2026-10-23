import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SkyTrainCabinAssets, type CabinOwner } from './skytrain-cabin-assets';
import type { LineId } from './skytrain-network';
import type { VisualQuality } from './quality';
import { openSkyTrainDoorApertures } from './skytrain-door-aperture';
import type { SkyTrainMotionPath } from './skytrain-motion-path';
import { SKYTRAIN_SERVICE_STOCK } from './skytrain-service-stock';
import {
  SkyTrainPassengerSpace,
  type CabinPoint,
} from './skytrain-passenger-space';

/** The exhibit assets remain immutable. This adapter supplies a separate moving
 * consist and selected-car passenger frame for the regional service. */
export class SkyTrainRideTrain {
  readonly group = new THREE.Group();
  readonly passenger = new THREE.Group();
  private readonly assets: SkyTrainCabinAssets;
  private owner: CabinOwner | null = null;
  private resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  private doors: {
    node: THREE.Object3D;
    z: number;
    side: 'left' | 'right';
    sign: number;
  }[] = [];
  private expoDoors: THREE.InstancedMesh | null = null;
  private expoDoorGlass: THREE.InstancedMesh | null = null;
  private shellInstances: THREE.InstancedMesh[] = [];
  private cars: THREE.Group[] = [];
  private passengerFrames: THREE.Group[] = [];
  private selectedPassengerCar = 0;
  private cabinLights: THREE.PointLight[] = [];
  private staticFrames = true;
  private readonly inverseRoot = new THREE.Matrix4();
  private readonly carMatrix = new THREE.Matrix4();
  private readonly doorMatrix = new THREE.Matrix4();
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly eyeOffset = new THREE.Vector3();
  private readonly pose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  };
  private line: LineId = 'expo';
  private generation = 0;
  private disposed = false;
  private doorAmount = 0;
  private side: 'left' | 'right' = 'left';
  readonly eye = new THREE.Vector3();
  passengerSpace: SkyTrainPassengerSpace | null = null;
  private passengerEyeHeight = 1.65;
  private passengerEyeXZ: readonly [number, number] = [0, 0];
  private passengerLocal: CabinPoint | null = null;
  facingYaw = Math.PI;
  get ready() {
    return this.owner !== null;
  }
  get serviceLine() {
    return this.line;
  }
  get carFrames(): readonly THREE.Group[] {
    return this.cars;
  }
  get passengerCarIndex() {
    return this.selectedPassengerCar;
  }
  /** The authored cabin coordinates, including the reversed Canada rear car. */
  get passengerFrame(): THREE.Group {
    this.ensureCarFrames();
    return this.passengerFrames[this.selectedPassengerCar] ?? this.group;
  }
  selectPassengerCar(index: number): boolean {
    if (
      this.disposed ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.offsets.length
    )
      return false;
    this.ensureCarFrames();
    this.selectedPassengerCar = index;
    this.attachPassengerFrame();
    return true;
  }
  get stationAligned() {
    return this.staticFrames;
  }
  private get offsets(): readonly number[] {
    return SKYTRAIN_SERVICE_STOCK[this.line].carOffsetsM;
  }
  get carOffset() {
    return this.line === 'expo' ? 26.85 : 10.5;
  }
  get floorAboveRail() {
    return SKYTRAIN_SERVICE_STOCK[this.line].floorAboveRailM;
  }
  constructor(assets = new SkyTrainCabinAssets()) {
    this.assets = assets;
    this.group.name = 'Regional SkyTrain — passenger service';
    this.group.add(this.passenger);
  }
  async load(line: LineId, quality: VisualQuality, compatible: boolean) {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.releaseVisuals();
    this.line = line;
    const owner = await this.assets.open(
      line === 'expo' ? 'mark-v' : 'canada-line',
      compatible || quality === 'balanced' ? 1 : 0,
    );
    if (this.disposed || generation !== this.generation || !owner) return false;
    this.owner = owner;
    // Mark V's authored cabin has a feet=0 datum. Canada's loaded floor top is
    // 1.10m above rail; its older display eye is corrected below for this ride.
    this.ensureCarFrames();
    owner.group.position.set(0, line === 'expo' ? 0.95 : 0, 0);
    (line === 'expo' ? this.passengerFrame : this.cars[0]).add(owner.group);
    if (line === 'expo') {
      openSkyTrainDoorApertures(owner.group);
      this.buildExpoShell();
    } else {
      const second = owner.group.clone(true);
      second.position.z = 0;
      second.rotation.y = Math.PI;
      second.name = 'Canada Line second car — shared original geometry';
      this.cars[1].add(second);
      for (const car of [owner.group, second])
        car.traverse((node) => {
          const match = /^door-(left|right)-\d-([ab])$/.exec(node.name);
          if (match)
            this.doors.push({
              node,
              z: node.position.z,
              side:
                car === second
                  ? match[1] === 'left'
                    ? 'right'
                    : 'left'
                  : (match[1] as 'left' | 'right'),
              sign: match[2] === 'a' ? -1 : 1,
            });
        });
    }
    const view = owner.descriptor.viewpoints.find((v) => v.id === 'standing')!;
    this.facingYaw = Math.atan2(view.facingXZ[0], view.facingXZ[1]);
    this.eye.fromArray(view.positionM).add(owner.group.position);
    this.eye.z += this.carOffset;
    this.eye.y = this.floorAboveRail + 1.65;
    this.passengerSpace = new SkyTrainPassengerSpace(
      owner,
      this.floorAboveRail,
    );
    this.passengerLocal = null;
    this.passengerEyeHeight = 1.65;
    this.passengerEyeXZ = [0, 0];
    this.syncPassengerAnchor();
    // Local, shadow-free cabin lamps preserve the authored PBR materials. Their
    // small range does not raise the city's night-time ambient illumination.
    for (const z of [-4, 4]) {
      const light = new THREE.PointLight(0xe8f5ff, 28, 17, 1.5);
      light.position.set(0, this.floorAboveRail + 2.1, z);
      this.cabinLights.push(light);
      this.passengerFrame.add(light);
    }
    this.doorAmount = 0;
    this.resetCarFrames();
    return true;
  }
  private ensureCarFrames() {
    if (this.disposed || this.cars.length === this.offsets.length) return;
    for (const car of this.cars) car.removeFromParent();
    this.cars = this.offsets.map((offset, index) => {
      const car = new THREE.Group();
      car.name = `SkyTrain ${this.line} car ${index}`;
      car.position.z = offset;
      car.updateMatrix();
      car.matrixAutoUpdate = false;
      this.group.add(car);
      return car;
    });
    this.passengerFrames = this.cars.map((car, index) => {
      if (this.line !== 'canada' || index === 0) return car;
      const frame = new THREE.Group();
      frame.name = 'Canada rear car — authored passenger coordinates';
      frame.rotation.y = Math.PI;
      car.add(frame);
      return frame;
    });
    if (this.selectedPassengerCar >= this.cars.length)
      this.selectedPassengerCar = 0;
    this.attachPassengerFrame();
  }
  private attachPassengerFrame() {
    const frame = this.passengerFrames[this.selectedPassengerCar];
    if (!frame) return;
    frame.add(this.passenger);
    if (this.line === 'expo' && this.owner) frame.add(this.owner.group);
    for (const light of this.cabinLights) frame.add(light);
    this.syncPassengerAnchor();
  }
  private syncPassengerAnchor() {
    if (this.passengerLocal) {
      this.passenger.position.fromArray(this.passengerLocal);
      return;
    }
    this.passenger.position.copy(this.eye);
    this.passenger.position.y -= 1.65;
    this.passenger.position.z -= this.carOffset;
  }
  setPassengerLocal(
    position: CabinPoint,
    eyeHeight = 1.65,
    eyeOffsetXZ: readonly [number, number] = [0, 0],
  ) {
    if (this.disposed) return;
    this.passengerLocal = [...position];
    this.passengerEyeHeight = eyeHeight;
    this.passengerEyeXZ = eyeOffsetXZ;
    this.ensureCarFrames();
    this.syncPassengerAnchor();
  }
  passengerPointToWorld(point: readonly number[]): CabinPoint {
    const frame = this.passengerFrame;
    frame.updateWorldMatrix(true, false);
    return new THREE.Vector3(...point)
      .applyMatrix4(frame.matrixWorld)
      .toArray();
  }
  /** Reestablish the exact authored straight consist for a station stop. */
  resetCarFrames() {
    this.ensureCarFrames();
    this.syncPassengerAnchor();
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      car.position.set(0, 0, this.offsets[i]);
      car.quaternion.identity();
      car.scale.set(1, 1, 1);
      car.updateMatrix();
    }
    this.staticFrames = true;
    this.updateInstances();
    this.group.updateMatrixWorld(true);
  }
  /** Each car follows its own physical arc position; the root remains the
   * train stop/reference pose used by the controller's physical proofs. */
  setPathPose(path: SkyTrainMotionPath, progress: number) {
    this.ensureCarFrames();
    const u = THREE.MathUtils.clamp(
      Number.isFinite(progress) ? progress : 0,
      0,
      1,
    );
    const distance = u * path.length;
    path.sampleDistance(distance, this.pose);
    this.group.position.copy(this.pose.position);
    this.group.quaternion.copy(this.pose.quaternion);
    this.group.updateWorldMatrix(true, false);
    this.inverseRoot.copy(this.group.matrixWorld).invert();
    for (let i = 0; i < this.cars.length; i++) {
      if (path.sampleCarDistance)
        path.sampleCarDistance(distance, this.offsets[i], this.pose);
      else
        path.sampleDistance(
          distance + this.offsets[i] * path.start.motionSign,
          this.pose,
        );
      this.carMatrix.compose(
        this.pose.position,
        this.pose.quaternion,
        this.unitScale,
      );
      const car = this.cars[i];
      car.matrix.multiplyMatrices(this.inverseRoot, this.carMatrix);
      car.matrix.decompose(car.position, car.quaternion, car.scale);
    }
    this.staticFrames = u === 0 || u === 1;
    this.updateInstances();
    this.group.updateMatrixWorld(true);
  }
  /** Occupied car's standing anchor and orientation, independent of the
   * reference root's rigid offset while other cars negotiate a curve. */
  passengerWorldPose(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.ensureCarFrames();
    this.passenger.getWorldPosition(position);
    this.passengerFrame.getWorldQuaternion(quaternion);
    this.eyeOffset
      .set(
        this.passengerEyeXZ[0],
        this.passengerEyeHeight,
        this.passengerEyeXZ[1],
      )
      .applyQuaternion(quaternion);
    position.add(this.eyeOffset);
  }
  private updateInstances() {
    for (const mesh of this.shellInstances) {
      for (let i = 0; i < this.cars.length; i++)
        mesh.setMatrixAt(i, this.cars[i].matrix);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    this.animateDoors();
  }
  private buildExpoShell() {
    const batches = new Map<number, THREE.BufferGeometry[]>();
    const add = (
      color: number,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const parts = batches.get(color) ?? [];
      parts.push(new THREE.BoxGeometry(w, h, d).translate(x, y + 0.95, z));
      batches.set(color, parts);
    };
    {
      const offset = 0;
      add(0x263842, 2.4, 0.45, 16.8, 0, -0.35, offset);
      add(0xd8e2e6, 2.65, 0.15, 17, 0, 2.48, offset);
      for (const side of [-1, 1]) {
        add(0xcbd8dd, 0.06, 0.4, 17, side * 1.31, 2.22, offset);
        // Clear apertures at the three actual Mark V cabin door centres.
        for (const z of [-7.25, -2.45, 2.45, 7.25]) {
          const length = Math.abs(z) > 7 ? 1.7 : 3.25;
          add(0xcbd8dd, 0.06, 0.7, length, side * 1.31, 0.35, offset + z);
          add(0x1a4265, 0.065, 0.21, length, side * 1.315, 0.78, offset + z);
          add(0xe5b83f, 0.07, 0.075, length, side * 1.32, 0.93, offset + z);
          add(0x3f6577, 0.025, 1.06, length, side * 1.315, 1.48, offset + z);
        }
        for (const z of [-8.45, -5.72, -4.08, -0.82, 0.82, 4.08, 5.72, 8.45])
          add(0xcbd8dd, 0.065, 1.35, 0.12, side * 1.32, 1.48, offset + z);
      }
      for (const z of [-8.48, 8.48]) {
        add(0xd8e2e6, 2.6, 0.85, 0.08, 0, 0.43, offset + z);
        add(0x274653, 2.35, 1.15, 0.07, 0, 1.5, offset + z);
        add(0xd8e2e6, 2.6, 0.35, 0.08, 0, 2.23, offset + z);
      }
    }
    for (const [color, parts] of batches) {
      const geometry = mergeGeometries(parts)!;
      parts.forEach((part) => part.dispose());
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.6,
        metalness: 0.25,
      });
      if (color === 0x3f6577 || color === 0x274653) {
        material.transparent = true;
        material.opacity = 0.22;
        material.depthWrite = false;
      }
      this.resources.push(geometry, material);
      const mesh = new THREE.InstancedMesh(geometry, material, 4);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = 'Original service exterior — Mark V inspired';
      this.group.add(mesh);
      this.shellInstances.push(mesh);
    }
    const frame = [
      new THREE.BoxGeometry(0.045, 0.7, 0.69).translate(0, -0.64, 0),
      new THREE.BoxGeometry(0.045, 0.13, 0.69).translate(0, 0.925, 0),
      ...[-1, 1].map((side) =>
        new THREE.BoxGeometry(0.045, 1.98, 0.05).translate(0, 0, side * 0.32),
      ),
    ];
    const geometry = mergeGeometries(frame)!;
    frame.forEach((part) => part.dispose());
    const material = new THREE.MeshStandardMaterial({
      color: 0xaebfc8,
      metalness: 0.3,
      roughness: 0.55,
    });
    this.resources.push(geometry, material);
    this.expoDoors = new THREE.InstancedMesh(geometry, material, 48);
    this.expoDoors.name = 'Animated platform-side train doors';
    this.expoDoors.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.expoDoors);
    const glass = new THREE.BoxGeometry(0.015, 1.15, 0.58).translate(
      0,
      0.285,
      0,
    );
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x7298ab,
      roughness: 0.2,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    this.resources.push(glass, glassMaterial);
    this.expoDoorGlass = new THREE.InstancedMesh(glass, glassMaterial, 48);
    this.expoDoorGlass.name = 'Animated train-door glazing';
    this.expoDoorGlass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.expoDoorGlass);
  }
  setDoors(open: boolean, side: 'left' | 'right', dt: number) {
    this.side = side;
    const target = open ? 1 : 0;
    const change =
      Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)) / 0.65;
    this.doorAmount += Math.max(
      -change,
      Math.min(change, target - this.doorAmount),
    );
    this.animateDoors();
  }
  get doorsClear() {
    return this.doorAmount > 0.98;
  }
  get doorsClosed() {
    return this.doorAmount < 0.02;
  }
  private animateDoors() {
    for (const door of this.doors)
      door.node.position.z =
        door.z +
        door.sign * (door.side === this.side ? this.doorAmount * 0.78 : 0);
    if (!this.expoDoors) return;
    let index = 0;
    for (const car of this.cars)
      for (const sign of [1, -1])
        for (const z of [-4.9, 0, 4.9])
          for (const leaf of [-1, 1]) {
            const opening =
              (sign === 1 ? 'left' : 'right') === this.side
                ? this.doorAmount * 0.78
                : 0;
            this.doorMatrix.makeTranslation(
              sign * 1.285,
              1.94,
              z + leaf * (0.35 + opening),
            );
            this.instanceMatrix.multiplyMatrices(car.matrix, this.doorMatrix);
            this.expoDoors.setMatrixAt(index, this.instanceMatrix);
            this.expoDoorGlass?.setMatrixAt(index++, this.instanceMatrix);
          }
    this.expoDoors.instanceMatrix.needsUpdate = true;
    this.expoDoors.computeBoundingSphere();
    if (this.expoDoorGlass) {
      this.expoDoorGlass.instanceMatrix.needsUpdate = true;
      this.expoDoorGlass.computeBoundingSphere();
    }
  }
  private releaseVisuals() {
    this.passengerSpace = null;
    this.passengerLocal = null;
    this.passengerEyeHeight = 1.65;
    this.passengerEyeXZ = [0, 0];
    // Clones share the asset owner's immutable buffers. Only that owner releases
    // those resources; procedural exterior buffers are independently owned.
    this.group.clear();
    this.passenger.removeFromParent();
    this.cars = [];
    this.passengerFrames = [];
    this.cabinLights = [];
    this.owner = null;
    this.resources.forEach((resource) => resource.dispose());
    this.resources = [];
    this.shellInstances.forEach((mesh) => mesh.dispose());
    this.shellInstances = [];
    this.doors = [];
    this.expoDoors?.dispose();
    this.expoDoors = null;
    this.expoDoorGlass?.dispose();
    this.expoDoorGlass = null;
    this.group.add(this.passenger);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.releaseVisuals();
    this.assets.dispose();
    this.group.removeFromParent();
  }
}

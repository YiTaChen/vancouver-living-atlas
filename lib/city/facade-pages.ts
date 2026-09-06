import * as THREE from 'three';
import { facadeWork, type FacadeBox, type FacadeInput } from './facade-plan';
/** Exact source BoxGeometry output, emitted in fixed-size pages. No final merge.
 * Rotation then translation each round positions AND normals through Float32,
 * matching the current Three BoxGeometry.rotateY().translate() sequence. */
export class FacadePageBuilder {
  readonly pages: THREE.BufferGeometry[] = [];
  readonly pageBoxes: number;
  readonly allocatedPageBytes: number;
  allocatedBytes = 0;
  usedBytes = 0;
  boxes = 0;
  tokens = 0;
  done = false;
  cancelled = false;
  private iterator: Generator<FacadeBox | null>;
  private page: {
    position: Float32Array;
    normal: Float32Array;
    uv: Float32Array;
    index: Uint16Array;
    count: number;
    box: THREE.Box3;
  } | null = null;
  private basePosition: THREE.BufferAttribute;
  private baseNormal: THREE.BufferAttribute;
  private baseUv: THREE.BufferAttribute;
  private baseIndex: THREE.BufferAttribute;
  private rotation = new THREE.Matrix4();
  private translation = new THREE.Matrix4();
  private normalRotation = new THREE.Matrix3();
  private normalTranslation = new THREE.Matrix3();
  private p = new THREE.Vector3();
  private n = new THREE.Vector3();
  private yaw = NaN;
  constructor(
    items: readonly FacadeInput[],
    options: { pageBoxes?: number; maxBytes?: number } = {},
  ) {
    this.pageBoxes = options.pageBoxes ?? 1024;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    if (
      !Number.isInteger(this.pageBoxes) ||
      this.pageBoxes < 1 ||
      this.pageBoxes > 2048 ||
      !Number.isFinite(this.maxBytes) ||
      this.maxBytes <= 0
    )
      throw new Error('Invalid facade page limits');
    this.allocatedPageBytes = this.pageBoxes * 840;
    const base = new THREE.BoxGeometry(1, 1, 1);
    this.basePosition = base.getAttribute('position') as THREE.BufferAttribute;
    this.baseNormal = base.getAttribute('normal') as THREE.BufferAttribute;
    this.baseUv = base.getAttribute('uv') as THREE.BufferAttribute;
    this.baseIndex = base.index!;
    base.dispose();
    this.iterator = facadeWork(items);
  }
  private maxBytes: number;
  private startPage() {
    if (this.allocatedBytes + this.allocatedPageBytes > this.maxBytes)
      throw new Error('Facade cell exceeds pending byte limit');
    const c = this.pageBoxes;
    this.page = {
      position: new Float32Array(c * 72),
      normal: new Float32Array(c * 72),
      uv: new Float32Array(c * 48),
      index: new Uint16Array(c * 36),
      count: 0,
      box: new THREE.Box3(),
    };
    this.allocatedBytes += this.allocatedPageBytes;
  }
  private seal() {
    const p = this.page;
    if (!p) return;
    const g = new THREE.BufferGeometry(),
      vertices = p.count * 24;
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(p.position.subarray(0, vertices * 3), 3),
    );
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(p.normal.subarray(0, vertices * 3), 3),
    );
    g.setAttribute(
      'uv',
      new THREE.BufferAttribute(p.uv.subarray(0, vertices * 2), 2),
    );
    g.setIndex(new THREE.BufferAttribute(p.index.subarray(0, p.count * 36), 1));
    g.boundingBox = p.box;
    const center = p.box.getCenter(new THREE.Vector3()),
      radius = p.box.getSize(new THREE.Vector3()).length() / 2;
    g.boundingSphere = new THREE.Sphere(center, radius);
    g.name = 'Facade reveals and balconies page';
    this.pages.push(g);
    this.usedBytes += p.count * 840;
    this.page = null;
  }
  private box(s: FacadeBox) {
    if (
      ![s.width, s.height, s.depth, s.x, s.y, s.z, s.yaw].every(Number.isFinite)
    )
      throw new Error('Invalid facade box');
    if (!this.page) this.startPage();
    const page = this.page!,
      vertex = page.count * 24;
    if (s.yaw !== this.yaw) {
      this.yaw = s.yaw;
      this.rotation.makeRotationY(s.yaw);
      this.normalRotation.getNormalMatrix(this.rotation);
    }
    this.translation.makeTranslation(s.x, s.y, s.z);
    this.normalTranslation.getNormalMatrix(this.translation);
    for (let i = 0; i < 24; i++) {
      this.p
        .set(
          Math.fround(this.basePosition.getX(i) * s.width),
          Math.fround(this.basePosition.getY(i) * s.height),
          Math.fround(this.basePosition.getZ(i) * s.depth),
        )
        .applyMatrix4(this.rotation);
      this.p
        .set(
          Math.fround(this.p.x),
          Math.fround(this.p.y),
          Math.fround(this.p.z),
        )
        .applyMatrix4(this.translation);
      const at = (vertex + i) * 3;
      page.position[at] = this.p.x;
      page.position[at + 1] = this.p.y;
      page.position[at + 2] = this.p.z;
      this.p.set(
        page.position[at],
        page.position[at + 1],
        page.position[at + 2],
      );
      page.box.expandByPoint(this.p);
      this.n
        .fromBufferAttribute(this.baseNormal, i)
        .applyNormalMatrix(this.normalRotation);
      this.n
        .set(
          Math.fround(this.n.x),
          Math.fround(this.n.y),
          Math.fround(this.n.z),
        )
        .applyNormalMatrix(this.normalTranslation);
      page.normal[at] = this.n.x;
      page.normal[at + 1] = this.n.y;
      page.normal[at + 2] = this.n.z;
      page.uv[(vertex + i) * 2] = this.baseUv.getX(i);
      page.uv[(vertex + i) * 2 + 1] = this.baseUv.getY(i);
    }
    for (let i = 0; i < 36; i++)
      page.index[page.count * 36 + i] = vertex + this.baseIndex.getX(i);
    page.count++;
    this.boxes++;
    if (page.count === this.pageBoxes) this.seal();
  }
  /** At most maxTokens descriptor/checkpoint advances, regardless of cell size. */
  step(maxTokens = 8) {
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 64)
      throw new Error('Invalid facade step limit');
    if (this.cancelled || this.done) return 0;
    let work = 0;
    while (work < maxTokens) {
      const next = this.iterator.next();
      work++;
      this.tokens++;
      if (next.done) {
        this.seal();
        this.done = true;
        break;
      }
      if (next.value) this.box(next.value);
    }
    return work;
  }
  cancel(keep?: THREE.BufferGeometry) {
    if (this.cancelled) return;
    this.cancelled = true;
    this.iterator.return(undefined);
    this.pages.forEach((p) => {
      if (p !== keep) p.dispose();
    });
    this.pages.length = 0;
    this.page = null;
    this.allocatedBytes = 0;
    this.usedBytes = 0;
  }
}

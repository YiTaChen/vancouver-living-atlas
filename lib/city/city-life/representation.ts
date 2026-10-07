export interface VehicleAuthority {
  vehicleId: string;
  serviceId: string;
  simulationAuthority: string;
  positionM: [number, number, number];
  rotationQuaternionXYZW: [number, number, number, number];
  speedMps: number;
  pathStationM: number;
  doorOpen: boolean;
  passengers: number;
  pendingTransfers: number;
}
export interface RepresentationCapabilities {
  passengerCapable: boolean;
  doorsAnimated: boolean;
  openingsPreserved: boolean;
}
export interface RepresentationToken {
  generation: number;
  target: 'instance' | 'detail';
}
interface Staged<T> {
  handle: T;
  capabilities: RepresentationCapabilities;
  release: () => void;
}
/** Data-side two-phase swap; the integration adapter must atomically install the
 * returned handle/collider before releasing the old handle. Never transfers service authority. */
export class RepresentationTransaction<T> {
  private generation = 0;
  private installing = false;
  private pending: {
    token: RepresentationToken;
    deadline: number;
    staged?: Staged<T>;
  } | null = null;
  constructor(
    readonly vehicleId: string,
    private current: T,
    private releaseCurrent: () => void,
    private representation: 'instance' | 'detail' = 'instance',
  ) {
    if (!vehicleId) throw new Error('Missing vehicle identity');
  }
  reserve(
    target: 'instance' | 'detail',
    now: number,
    timeoutSeconds = 15,
  ): RepresentationToken | null {
    if (
      !['instance', 'detail'].includes(target) ||
      this.pending ||
      this.installing ||
      !Number.isFinite(now) ||
      !Number.isFinite(timeoutSeconds) ||
      timeoutSeconds <= 0 ||
      target === this.representation
    )
      return null;
    const token = { generation: ++this.generation, target };
    this.pending = { token, deadline: now + timeoutSeconds };
    return { ...token };
  }
  preload(
    token: RepresentationToken,
    handle: T,
    capabilities: RepresentationCapabilities,
    release: () => void,
    now: number,
  ) {
    const p = this.pending;
    if (
      !p ||
      !this.matches(token) ||
      !Number.isFinite(now) ||
      now >= p.deadline
    ) {
      release();
      if (p && this.matches(token)) this.cancel(token);
      return false;
    }
    // Duplicate load callbacks never replace an already-staged candidate.
    if (p.staged) {
      release();
      return false;
    }
    p.staged = { handle, capabilities: { ...capabilities }, release };
    return true;
  }
  commit(token: RepresentationToken, authority: VehicleAuthority, now: number) {
    const p = this.pending;
    if (!p || !this.matches(token)) return null;
    const c = p.staged?.capabilities;
    const finite = [
      ...authority.positionM,
      ...authority.rotationQuaternionXYZW,
      authority.speedMps,
      authority.pathStationM,
    ].every(Number.isFinite);
    const valid =
      authority.vehicleId === this.vehicleId &&
      authority.serviceId &&
      authority.simulationAuthority &&
      finite &&
      authority.positionM.length === 3 &&
      authority.rotationQuaternionXYZW.length === 4 &&
      authority.pathStationM >= 0 &&
      Math.abs(Math.hypot(...authority.rotationQuaternionXYZW) - 1) < 1e-5 &&
      Number.isInteger(authority.passengers) &&
      authority.passengers >= 0 &&
      Number.isInteger(authority.pendingTransfers) &&
      authority.pendingTransfers >= 0;
    if (
      !p.staged ||
      !c ||
      !valid ||
      !Number.isFinite(now) ||
      now >= p.deadline ||
      ((authority.passengers > 0 ||
        authority.pendingTransfers > 0 ||
        authority.doorOpen) &&
        (!c.passengerCapable || !c.doorsAnimated || !c.openingsPreserved))
    ) {
      this.cancel(token);
      return null;
    }
    const oldHandle = this.current,
      releaseOld = this.releaseCurrent,
      oldRepresentation = this.representation;
    const releaseNew = p.staged.release;
    this.current = p.staged.handle;
    this.releaseCurrent = p.staged.release;
    this.representation = token.target;
    this.pending = null;
    this.installing = true;
    let settled = false;
    return {
      oldHandle,
      newHandle: this.current,
      authority: structuredClone(authority),
      /** Finalize ONLY after the adapter installed one collider/controller binding. */
      releaseOld: () => {
        if (!settled) {
          settled = true;
          this.installing = false;
          releaseOld();
        }
      },
      /** If adapter installation fails, keep the original valid representation. */
      rollback: () => {
        if (settled) return false;
        settled = true;
        this.current = oldHandle;
        this.releaseCurrent = releaseOld;
        this.representation = oldRepresentation;
        this.installing = false;
        releaseNew();
        return true;
      },
    };
  }
  cancel(token: RepresentationToken) {
    if (!this.matches(token)) return false;
    const p = this.pending!;
    this.pending = null;
    p.staged?.release();
    return true;
  }
  expire(now: number) {
    if (this.pending && Number.isFinite(now) && now >= this.pending.deadline)
      this.cancel(this.pending.token);
  }
  snapshot() {
    return {
      handle: this.current,
      representation: this.representation,
      pending: !!this.pending || this.installing,
    };
  }
  private matches(token: RepresentationToken) {
    return (
      this.pending?.token.generation === token.generation &&
      this.pending?.token.target === token.target
    );
  }
}

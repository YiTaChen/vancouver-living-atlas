export interface ResourceLease<T> {
  ready: Promise<T>;
  release: (now: number) => void;
}
interface Entry<T> {
  key: string;
  refs: number;
  lastRelease: number;
  value?: T;
  ready: Promise<T>;
  loaded: boolean;
}
/** Bounded shared owner. A pinned station/interior is never evicted by Orbit distance.
 * Loader must dispose its own partially-created resources on rejection. No unbounded queue. */
export class SharedResourceCache<T> {
  private entries = new Map<string, Entry<T>>();
  private loading = 0;
  constructor(
    readonly maxEntries: number,
    readonly maxPending: number,
    readonly idleSeconds: number,
    private dispose: (value: T) => void,
  ) {
    if (
      !Number.isInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isInteger(maxPending) ||
      maxPending < 1 ||
      !Number.isFinite(idleSeconds) ||
      idleSeconds < 0
    )
      throw new Error('Invalid cache bounds');
  }
  acquire(key: string, load: () => Promise<T>, now: number): ResourceLease<T> {
    if (!key || !Number.isFinite(now)) throw new Error('Invalid cache request');
    this.collect(now);
    let entry = this.entries.get(key);
    if (!entry) {
      if (
        this.entries.size >= this.maxEntries ||
        this.loading >= this.maxPending
      )
        throw new Error('Resource cache capacity reached');
      this.loading++;
      entry = {
        key,
        refs: 0,
        lastRelease: now,
        loaded: false,
        ready: null as unknown as Promise<T>,
      };
      const owned = entry;
      this.entries.set(key, owned);
      owned.ready = Promise.resolve()
        .then(load)
        .then(
          (value) => {
            this.loading--;
            owned.value = value;
            owned.loaded = true;
            return value;
          },
          (error) => {
            this.loading--;
            if (this.entries.get(key) === owned) this.entries.delete(key);
            throw error;
          },
        );
    }
    entry.refs++;
    const owned = entry;
    let released = false;
    return {
      ready: owned.ready,
      release: (time: number) => {
        if (released) return;
        if (!Number.isFinite(time)) throw new Error('Invalid release time');
        released = true;
        owned.refs--;
        owned.lastRelease = time;
      },
    };
  }
  collect(now: number) {
    if (!Number.isFinite(now)) throw new Error('Invalid collection time');
    for (const [key, entry] of this.entries)
      if (
        entry.refs === 0 &&
        entry.loaded &&
        now - entry.lastRelease >= this.idleSeconds
      ) {
        this.entries.delete(key);
        this.dispose(entry.value as T);
      }
  }
  stats() {
    return {
      entries: this.entries.size,
      pending: this.loading,
      references: [...this.entries.values()].reduce((n, e) => n + e.refs, 0),
    };
  }
}

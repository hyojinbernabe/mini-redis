export type Value =
  | { type: 'string'; data: Buffer }
  | { type: 'list'; data: Buffer[] }
  | { type: 'hash'; data: Map<string, Buffer> };

// how many keys with a TTL the active sweep checks per round, same as redis
const SWEEP_SAMPLE_SIZE = 20;
// keep sweeping while more than this share of the sample was expired
const SWEEP_REPEAT_THRESHOLD = 0.25;

export class Store {
  readonly now: () => number;
  // true while the AOF is replaying. keys must not expire halfway through a replay,
  // or a later PERSIST in the log would find nothing to persist
  loading = false;
  private data = new Map<string, Value>();
  // expiry times live in their own map (like redis) so the sweep only looks at keys that can expire
  private expires = new Map<string, number>();
  private sweepCursor: Iterator<[string, number]> | null = null;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(key: string): Value | undefined {
    if (this.expireIfNeeded(key)) return undefined;
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  // replaces the value and keeps any existing TTL (INCR, APPEND, LPUSH...)
  put(key: string, value: Value): void {
    this.data.set(key, value);
  }

  // SET semantics: a new value clears the old TTL
  set(key: string, value: Value, expireAt: number | null = null): void {
    this.data.set(key, value);
    if (expireAt === null) this.expires.delete(key);
    else this.expires.set(key, expireAt);
  }

  delete(key: string): boolean {
    this.expires.delete(key);
    return this.data.delete(key);
  }

  // raw lookup, doesn't expire the key. callers check has() first when that matters
  expireAtOf(key: string): number | undefined {
    return this.expires.get(key);
  }

  setExpireAt(key: string, expireAt: number): boolean {
    if (!this.has(key)) return false;
    this.expires.set(key, expireAt);
    return true;
  }

  persist(key: string): boolean {
    if (!this.has(key)) return false;
    return this.expires.delete(key);
  }

  keys(): string[] {
    const result: string[] = [];
    for (const key of [...this.data.keys()]) {
      if (!this.expireIfNeeded(key)) result.push(key);
    }
    return result;
  }

  // counts keys that expired but weren't cleaned up yet, same as redis DBSIZE
  get size(): number {
    return this.data.size;
  }

  flush(): void {
    this.data.clear();
    this.expires.clear();
    this.sweepCursor = null;
  }

  *entries(): Generator<[string, Value, number | undefined]> {
    for (const key of [...this.data.keys()]) {
      if (this.expireIfNeeded(key)) continue;
      yield [key, this.data.get(key)!, this.expires.get(key)];
    }
  }

  // a key is gone once the clock passes its expiry time. at exactly expireAt it still exists (redis does the same)
  private expireIfNeeded(key: string): boolean {
    const expireAt = this.expires.get(key);
    if (this.loading || expireAt === undefined || this.now() <= expireAt) return false;
    this.delete(key);
    return true;
  }

  // active expiry. lazy expiry alone never frees keys nobody reads again,
  // so every tick we check a sample of keys with a TTL and repeat while a lot of them were expired
  activeExpireCycle(timeBudgetMs = 25): number {
    const started = performance.now();
    let removed = 0;

    while (true) {
      const { checked, expired } = this.sampleExpires(SWEEP_SAMPLE_SIZE);
      removed += expired;
      if (checked === 0 || expired / checked <= SWEEP_REPEAT_THRESHOLD) break;
      if (performance.now() - started > timeBudgetMs) break;
    }

    return removed;
  }

  // picking random keys from a Map isn't cheap in JS, so instead we walk the
  // expires map with a cursor that picks up where the last round stopped
  private sampleExpires(sampleSize: number): { checked: number; expired: number } {
    const limit = Math.min(sampleSize, this.expires.size);
    const now = this.now();
    let checked = 0;
    let expired = 0;

    while (checked < limit) {
      let next = this.sweepCursor?.next();
      if (!next || next.done) {
        this.sweepCursor = this.expires.entries();
        next = this.sweepCursor.next();
        if (next.done) break;
      }

      const [key, expireAt] = next.value;
      checked++;
      if (now > expireAt) {
        this.delete(key);
        expired++;
      }
    }

    return { checked, expired };
  }
}

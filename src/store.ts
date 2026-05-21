export type Value =
  | { type: 'string'; data: Buffer }
  | { type: 'list'; data: Buffer[] }
  | { type: 'hash'; data: Map<string, Buffer> };

export class Store {
  readonly now: () => number;
  private data = new Map<string, Value>();
  // expiry times live in their own map, like redis does
  private expires = new Map<string, number>();

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
  }

  // a key is gone once the clock passes its expiry time. at exactly expireAt it still exists (redis does the same)
  private expireIfNeeded(key: string): boolean {
    const expireAt = this.expires.get(key);
    if (expireAt === undefined || this.now() <= expireAt) return false;
    this.delete(key);
    return true;
  }
}

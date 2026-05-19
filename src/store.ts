export type Value =
  | { type: 'string'; data: Buffer }
  | { type: 'list'; data: Buffer[] }
  | { type: 'hash'; data: Map<string, Buffer> };

export class Store {
  private data = new Map<string, Value>();

  get(key: string): Value | undefined {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  set(key: string, value: Value): void {
    this.data.set(key, value);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  keys(): string[] {
    return [...this.data.keys()];
  }

  get size(): number {
    return this.data.size;
  }

  flush(): void {
    this.data.clear();
  }
}

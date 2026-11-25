/** Small insertion-order LRU cache backed by Map, capping long-lived UI caches. */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("LruCache max must be at least 1.");
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key)!;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value!;
      this.entries.delete(oldest);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * 最大サイズ制限付きの Set（LRU eviction）。
 * 容量超過時は最も古いエントリから自動削除する。
 */
export class LRUSet<T> {
  private map: Map<T, true> = new Map();

  constructor(private maxSize: number) {}

  has(value: T): boolean {
    if (!this.map.has(value)) return false;
    this.map.delete(value);
    this.map.set(value, true);
    return true;
  }

  add(value: T): void {
    if (this.map.has(value)) {
      this.map.delete(value);
    }
    this.map.set(value, true);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(value: T): boolean {
    return this.map.delete(value);
  }

  get size(): number {
    return this.map.size;
  }

  toArray(): T[] {
    return Array.from(this.map.keys());
  }

  static fromArray<T>(items: T[], maxSize: number): LRUSet<T> {
    const set = new LRUSet<T>(maxSize);
    for (const item of items) {
      set.add(item);
    }
    return set;
  }
}

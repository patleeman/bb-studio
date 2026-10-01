/** Bounded change history for clients returning from the background. */
export interface ItemChange { pluginId: string; id: string; kind: string; removed: boolean; at: number }

export class ChangeLog {
  private cursor = 0;
  private oldest = 0;
  private entries: { cursor: number; change: ItemChange | null }[] = [];

  append(change: ItemChange | null): number {
    const cursor = ++this.cursor;
    this.entries.push({ cursor, change });
    if (this.entries.length > 1000) this.oldest = this.entries.shift()!.cursor;
    return cursor;
  }

  since(since: number): { cursor: number; changes: ItemChange[]; reset: boolean } {
    return {
      cursor: this.cursor,
      changes: this.entries.filter((entry) => entry.cursor > since && entry.change).map((entry) => entry.change!),
      reset: since > this.cursor || since < this.oldest || this.entries.some((entry) => entry.cursor > since && entry.change === null),
    };
  }
}

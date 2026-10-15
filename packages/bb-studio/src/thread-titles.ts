// Titles of the threads that made Studio items, for the library's Thread
// grouping. Looked up through BB and kept a few minutes, so listing items
// doesn't ask BB for every thread each time.

const TTL_MS = 5 * 60_000;

export class ThreadTitles {
  private readonly cache = new Map<string, { title: string; at: number }>();

  /** `fetch` resolves a thread's title ("" when it has none); a failure counts as none. */
  constructor(private readonly fetch: (threadId: string) => Promise<string>, private readonly now: () => number = Date.now) {}

  async titles(threadIds: Iterable<string>): Promise<Map<string, string>> {
    const ids = [...new Set(threadIds)];
    const at = this.now();
    await Promise.all(ids.filter((id) => !this.fresh(id, at)).map(async (id) => {
      const title = await this.fetch(id).catch(() => "");
      this.cache.set(id, { title: title.trim(), at });
    }));
    return new Map(ids.map((id) => [id, this.cache.get(id)?.title ?? ""]));
  }

  private fresh(id: string, at: number): boolean {
    const entry = this.cache.get(id);
    return entry !== undefined && at - entry.at < TTL_MS;
  }
}

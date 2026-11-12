import type { MirroredBatch } from "./mirror-live";

export interface CatchUpDeps {
  mirrored(since: number): MirroredBatch | null;
  known(threadId: string): boolean;
  classify(threadIds: readonly string[]): Promise<{ classified: number; settled: readonly string[] }>;
}

export class MirrorCatchUp {
  private since = -1;
  private readonly waiting = new Set<string>();
  private running: Promise<number> | null = null;

  constructor(private readonly deps: CatchUpDeps) {}

  run(): Promise<number> {
    this.running ??= this.sweep().finally(() => { this.running = null; });
    return this.running;
  }

  private async sweep(): Promise<number> {
    const batch = this.deps.mirrored(this.since);
    if (batch) {
      for (const id of batch.ids) this.waiting.add(id);
      this.since = batch.newest;
    }
    for (const id of [...this.waiting]) if (this.deps.known(id)) this.waiting.delete(id);
    if (!this.waiting.size) return 0;
    const { classified, settled } = await this.deps.classify([...this.waiting]);
    for (const id of settled) this.waiting.delete(id);
    return classified;
  }
}

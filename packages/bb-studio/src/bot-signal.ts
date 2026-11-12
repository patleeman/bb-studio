import { BOT_CHANGE_KINDS, botThreadsChanged, type BotChangeKind, type BotThreadsChanged } from "./bot-threads-contract";

export interface BotChange {
  botId: string;
  kinds: readonly BotChangeKind[];
}

export function kindOf(rec: { kind: "conversation" | "worker" }): BotChangeKind {
  return rec.kind === "worker" ? "workers" : "conversations";
}

export class BotSignal {
  private pending = new Map<string, Set<BotChangeKind>>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly publish: (event: BotThreadsChanged) => void, private readonly delayMs: number) {}

  add(changes: readonly BotChange[]): void {
    for (const change of changes) {
      if (!change.kinds.length) continue;
      const kinds = this.pending.get(change.botId) ?? new Set<BotChangeKind>();
      for (const kind of change.kinds) kinds.add(kind);
      this.pending.set(change.botId, kinds);
    }
    if (this.pending.size && !this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = [...this.pending];
    this.pending.clear();
    for (const [botId, kinds] of batch) {
      this.publish(botThreadsChanged.parse({ botId, changes: BOT_CHANGE_KINDS.filter((kind) => kinds.has(kind)) }));
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }
}

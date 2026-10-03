import type Database from "better-sqlite3";
import { z } from "zod";
import type { InboxEvent } from "./inbox-contract";

export type SourceEvent = Omit<InboxEvent, "spaceId" | "readAt" | "doneAt"> & { projectId: string | null };
export interface InboxSource {
  id: string;
  keyPrefix?: string;
  list(): Promise<SourceEvent[]>;
  act(event: SourceEvent, actionId: string, text?: string): Promise<void>;
}
const position = z.object({ at: z.number(), key: z.string(), spaceId: z.string(), type: z.string().nullable() });

/** Read model only. Decisions execute through the owning source's service. */
export class Inbox {
  private readonly acting = new Set<string>();
  constructor(private readonly db: Database.Database, private readonly sources: readonly InboxSource[], private readonly spaceForProject: (id: string | null) => string) {
    db.exec("CREATE TABLE IF NOT EXISTS inbox_state (key TEXT PRIMARY KEY, read_at INTEGER, done_at INTEGER)");
    if (new Set(sources.map(s => s.id)).size !== sources.length) throw new Error("Duplicate Inbox source");
  }

  private async records(key?: string) {
    const entries = (await Promise.all(this.sources.filter(s => !key || !s.keyPrefix || key.startsWith(s.keyPrefix)).map(async source => (await source.list()).map(event => ({ source, event }))))).flat();
    if (new Set(entries.map(e => e.event.key)).size !== entries.length) throw new Error("Duplicate Inbox event key");
    return entries;
  }

  async events(): Promise<InboxEvent[]> {
    const state = new Map((this.db.prepare("SELECT * FROM inbox_state").all() as { key: string; read_at: number | null; done_at: number | null }[]).map(s => [s.key, s]));
    return (await this.records()).map(({ event: { projectId, ...event } }) => ({
      ...event, spaceId: this.spaceForProject(projectId), readAt: (state.get(event.key)?.read_at ?? -1) >= event.createdAt ? state.get(event.key)!.read_at : null, doneAt: (state.get(event.key)?.done_at ?? -1) >= event.createdAt ? state.get(event.key)!.done_at : null,
    })).sort((a,b) => b.createdAt - a.createdAt || b.key.localeCompare(a.key));
  }

  async list(input: { spaceId: string; type?: InboxEvent["type"]; cursor?: string }, limit = 50) {
    const cursor = input.cursor ? position.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"))) : null;
    if (cursor && (cursor.spaceId !== input.spaceId || cursor.type !== (input.type ?? null))) throw new Error("This Inbox cursor belongs to another filter.");
    const events = (await this.events()).filter(e => e.doneAt === null && (input.spaceId === "all" || e.spaceId === input.spaceId) && (!input.type || e.type === input.type)
      && (!cursor || e.createdAt < cursor.at || (e.createdAt === cursor.at && e.key.localeCompare(cursor.key) < 0)));
    const page = events.slice(0, limit);
    const last = page.at(-1);
    return { events: page, cursor: events.length > limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt, key: last.key, spaceId: input.spaceId, type: input.type ?? null })).toString("base64url") : null };
  }

  async counts(spaceIds: readonly string[]) {
    const bySpace = Object.fromEntries(spaceIds.map(id => [id, { requests: 0, unreadReports: 0 }]));
    for (const event of await this.events()) {
      if (event.doneAt !== null) continue;
      const counts = bySpace[event.spaceId] ??= { requests: 0, unreadReports: 0 };
      if (event.type === "request") counts.requests++;
      if (event.type === "report" && event.readAt === null) counts.unreadReports++;
    }
    return { bySpace };
  }

  mark(keys: readonly string[], kind: "read" | "done"): void {
    const now = Date.now();
    this.db.transaction(() => {
      const put = this.db.prepare(kind === "read"
        ? "INSERT INTO inbox_state(key,read_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET read_at=MAX(COALESCE(inbox_state.read_at,0),excluded.read_at)"
        : "INSERT INTO inbox_state(key,done_at) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET done_at=MAX(COALESCE(inbox_state.done_at,0),excluded.done_at)");
      for (const key of keys) put.run(key, now);
    })();
  }

  async act(key: string, actionId: string, text?: string): Promise<void> {
    if (this.acting.has(key)) throw new Error("This request is already being handled.");
    this.acting.add(key);
    try {
      const record = (await this.records(key)).find(r => r.event.key === key);
      if (!record) throw new Error("This Inbox request is no longer available.");
      const state = this.db.prepare("SELECT done_at FROM inbox_state WHERE key=?").get(key) as { done_at: number | null } | undefined;
      if (state?.done_at != null && state.done_at >= record.event.createdAt) throw new Error("This request is already done.");
      if (!record.event.actions?.some(a => a.id === actionId)) throw new Error("That action is not available for this request.");
      await record.source.act(record.event, actionId, text);
      this.mark([key], "done");
    } finally { this.acting.delete(key); }
  }
}

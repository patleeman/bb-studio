import type Database from "better-sqlite3";
import type { InboxSource, SourceEvent } from "./inbox";

function initialize(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS office_legacy_attention (
    id TEXT PRIMARY KEY, raw TEXT NOT NULL, event TEXT NOT NULL, status TEXT NOT NULL,
    snoozed_until INTEGER, resolved_at INTEGER
  )`);
}

/** Copy first, then retire source tables in a separate transaction. A crash
 * between databases can only leave duplicate source records, never lose them. */
export function importLegacyAttention(core: Database.Database, teams: Database.Database): void {
  initialize(core);
  const rows = teams.prepare("SELECT * FROM channel_attention").all() as { id: string; room_id: string; status: string; snoozed_until: number | null; json: string }[];
  core.transaction(() => {
    for (const row of rows) {
      const attention = JSON.parse(row.json) as { reason: string; createdAt: number };
      const msg = teams.prepare("SELECT json FROM room_messages WHERE id=?").get(row.id) as { json: string } | undefined;
      const message = msg ? JSON.parse(msg.json) as { text: string; botId?: string; sourceThreadId?: string } : null;
      const conv = teams.prepare("SELECT project_id,json FROM conversations WHERE id=?").get(row.room_id) as { project_id: string; json: string } | undefined;
      const conversation = conv ? JSON.parse(conv.json) as { name: string } : null;
      const event: SourceEvent = {
        key: `team-attention:${row.id}`, projectId: conv?.project_id ?? null, source: "team-attention",
        type: attention.reason === "update" ? "report" : "request", title: conversation?.name ?? "Team request",
        body: message?.text ?? `Unresolved ${attention.reason} from a retired conversation.`,
        botId: message?.botId ?? null, threadId: message?.sourceThreadId ?? null,
        item: null, href: `/plugins/studio/channels/${row.room_id}`, createdAt: attention.createdAt,
        actions: [{ id: "resolve", label: "Resolve", primary: true }],
      };
      const raw = JSON.stringify(row);
      const old = core.prepare("SELECT raw FROM office_legacy_attention WHERE id=?").get(row.id) as { raw: string } | undefined;
      // A changed legacy source can refresh the event; preserve a local resolution.
      if (old?.raw !== raw) core.prepare(`INSERT INTO office_legacy_attention(id,raw,event,status,snoozed_until) VALUES (?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET raw=excluded.raw,event=excluded.event,status=excluded.status,snoozed_until=excluded.snoozed_until`)
        .run(row.id, raw, JSON.stringify(event), row.status, row.snoozed_until);
    }
  })();
}

export function legacyAttentionImported(core: Database.Database, teams: Database.Database, ids: readonly string[]): boolean {
  initialize(core);
  return ids.every(id => {
    const raw = teams.prepare("SELECT * FROM channel_attention WHERE id=?").get(id);
    const saved = core.prepare("SELECT raw FROM office_legacy_attention WHERE id=?").get(id) as { raw: string } | undefined;
    return raw !== undefined && saved?.raw === JSON.stringify(raw);
  });
}

export function legacyAttentionSource(core: Database.Database): InboxSource {
  initialize(core);
  return {
    id: "team-attention", keyPrefix: "team-attention:",
    async list() {
      const rows = core.prepare("SELECT event FROM office_legacy_attention WHERE resolved_at IS NULL AND (status='open' OR (status='snoozed' AND snoozed_until<=?))").all(Date.now()) as { event: string }[];
      return rows.map(r => JSON.parse(r.event) as SourceEvent);
    },
    async act(event, actionId) {
      if (actionId !== "resolve") throw new Error("Unsupported attention action.");
      core.prepare("UPDATE office_legacy_attention SET resolved_at=? WHERE id=?").run(Date.now(), event.key.slice("team-attention:".length));
    },
  };
}

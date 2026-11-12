import type Database from "better-sqlite3";
import { isBuiltinPresence, presencePackageSchema, type PresencePackage } from "./schema";

export interface PresenceCreator { name: string; botId: string | null }
export interface StoredPresence { presence: PresencePackage; creator: PresenceCreator | null; createdAt: number; updatedAt: number }

type Row = { json: string; creator: string | null; creator_bot_id: string | null; created_at: number; updated_at: number };

export class PresenceStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  private read(row: Row): StoredPresence | null {
    try {
      const parsed = presencePackageSchema.safeParse(JSON.parse(row.json));
      if (!parsed.success || isBuiltinPresence(parsed.data.id)) return null;
      return { presence: parsed.data, creator: row.creator ? { name: row.creator, botId: row.creator_bot_id } : null, createdAt: row.created_at, updatedAt: row.updated_at };
    } catch {
      return null;
    }
  }

  records(): StoredPresence[] {
    const rows = this.db.prepare("SELECT json, creator, creator_bot_id, created_at, updated_at FROM studio_presences ORDER BY created_at, id").all() as Row[];
    return rows.flatMap((row) => this.read(row) ?? []);
  }

  get(id: string): StoredPresence | null {
    const row = this.db.prepare("SELECT json, creator, creator_bot_id, created_at, updated_at FROM studio_presences WHERE id = ?").get(id) as Row | undefined;
    return row ? this.read(row) : null;
  }

  has(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM studio_presences WHERE id = ?").get(id);
  }

  save(presence: PresencePackage, creator: PresenceCreator | null): void {
    const at = this.now();
    this.db.prepare(`INSERT INTO studio_presences (id, name, json, creator, creator_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at`).run(presence.id, presence.name, JSON.stringify(presence), creator?.name ?? null, creator?.botId ?? null, at, at);
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM studio_presences WHERE id = ?").run(id).changes > 0;
  }
}

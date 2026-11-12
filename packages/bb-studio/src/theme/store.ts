import type Database from "better-sqlite3";
import { checkTheme, type CheckOptions, type CheckReport } from "./checks";
import { createThemeRegistry, isBuiltinTheme, type ThemeEntry, type ThemeRegistry } from "./registry";
import { parseThemePackage, type ThemePackage } from "./schema";

export type SaveResult = { ok: true; theme: ThemePackage; report: CheckReport } | { ok: false; report: CheckReport };
export interface ThemeCreator { name: string; botId: string | null }
export interface StoredTheme { theme: ThemePackage; creator: ThemeCreator | null; createdAt: number; updatedAt: number }

type Row = { json: string; creator: string | null; creator_bot_id: string | null; created_at: number; updated_at: number };

export class ThemeStore {
  constructor(private readonly db: Database.Database, private readonly now: () => number = Date.now) {}

  records(): StoredTheme[] {
    const rows = this.db.prepare("SELECT json, creator, creator_bot_id, created_at, updated_at FROM studio_themes ORDER BY created_at, id").all() as Row[];
    return rows.flatMap((row) => {
      try {
        const parsed = parseThemePackage(JSON.parse(row.json));
        if (!parsed.ok || isBuiltinTheme(parsed.theme.id)) return [];
        return [{ theme: parsed.theme, creator: row.creator ? { name: row.creator, botId: row.creator_bot_id } : null, createdAt: row.created_at, updatedAt: row.updated_at }];
      } catch {
        return [];
      }
    });
  }

  stored(): ThemePackage[] {
    return this.records().map((record) => record.theme);
  }

  registry(): ThemeRegistry {
    return createThemeRegistry(this.stored());
  }

  list(): ThemeEntry[] {
    return this.registry().list();
  }

  get(id: string): ThemePackage | null {
    return this.registry().get(id);
  }

  has(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM studio_themes WHERE id = ?").get(id);
  }

  save(input: unknown, options: CheckOptions = {}, creator: ThemeCreator | null = null): SaveResult {
    const report = checkTheme(input, options);
    const theme = report.theme;
    if (theme && isBuiltinTheme(theme.id)) {
      const refused: CheckReport = { pass: false, theme, results: [...report.results, { id: "id", pass: false, reason: `${theme.id} is a built-in theme` }] };
      return { ok: false, report: refused };
    }
    if (!report.pass || !theme) return { ok: false, report };
    const at = this.now();
    this.db.prepare(`INSERT INTO studio_themes (id, name, json, creator, creator_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at`).run(theme.id, theme.name, JSON.stringify(theme), creator?.name ?? null, creator?.botId ?? null, at, at);
    return { ok: true, theme, report };
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM studio_themes WHERE id = ?").run(id).changes > 0;
  }
}

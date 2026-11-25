import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { BotSkillView } from "./contract";
import { SKILL_NAME, skillMarkdown, skillView, type SkillRow } from "./bot-model";
import { lineDiff, lintSkill } from "./skill-learning";
import { rankSkills, type SearchableSkill, type SkillHit } from "./skill-search";

export interface BotSkillStoreDeps {
  db: Database.Database;
  userSkillsDir?: string;
  changed(): void;
}

/** Per-Bot skill CRUD, search, version history, linting, revert, and sharing to BB's user skills. */
export class BotSkillStore {
  /** Row+column keys already warned for malformed JSON, so each logs once. */
  private readonly jsonWarned = new Set<string>();

  constructor(private readonly deps: BotSkillStoreDeps) {}

  list(botId: string): BotSkillView[] {
    return (this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? ORDER BY name").all(botId) as SkillRow[]).map(skillView);
  }

  get(botId: string, name: string): (BotSkillView & { body: string }) | null {
    const skill = this.deps.db.prepare("SELECT * FROM bot_skills WHERE bot_id = ? AND name = ?").get(botId, name) as SkillRow | undefined;
    return skill ? { ...skillView(skill), body: skill.body } : null;
  }

  search(botId: string, query: string, limit = 10): SkillHit[] {
    const rows = this.deps.db.prepare("SELECT name, description, body FROM bot_skills WHERE bot_id = ? AND state != 'archived'").all(botId) as SearchableSkill[];
    return rankSkills(rows, query, limit);
  }

  /** The Bot loaded a skill (bot_skill_view): it's in use, so a stale one is active again. */
  touch(botId: string, name: string): void {
    this.deps.db.prepare("UPDATE bot_skills SET used_at = ?, state = CASE WHEN state = 'stale' THEN 'active' ELSE state END WHERE bot_id = ? AND name = ?").run(Date.now(), botId, name);
  }

  /** The curator's and Restore's state change; archived skills are hidden from the Bot, never deleted. */
  setState(botId: string, name: string, state: "active" | "stale" | "archived"): boolean {
    // Restored counts as used, so the next curator run doesn't archive it again.
    const changed = this.deps.db.prepare(`UPDATE bot_skills SET state = ?${state === "active" ? ", used_at = ?" : ""} WHERE bot_id = ? AND name = ?`).run(...(state === "active" ? [state, Date.now()] : [state]), botId, name).changes > 0;
    if (changed) this.deps.changed();
    return changed;
  }

  /** Pinned skills are exempt from the curator. */
  pin(botId: string, name: string, pinned: boolean): boolean {
    const changed = this.deps.db.prepare("UPDATE bot_skills SET pinned = ? WHERE bot_id = ? AND name = ?").run(pinned ? 1 : 0, botId, name).changes > 0;
    if (changed) this.deps.changed();
    return changed;
  }

  /** Adds or replaces one of a Bot's own skills. Only its thread loads them. */
  write(botId: string, input: { name: string; description: string; body: string }): BotSkillView {
    if (!SKILL_NAME.test(input.name)) throw new Error("A skill name is lowercase words joined by hyphens, like weekly-review.");
    const now = Date.now();
    this.deps.db.prepare(`INSERT INTO bot_skills (bot_id, name, description, body, created_at, updated_at, state, used_at, lint_warnings) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT (bot_id, name) DO UPDATE SET description = excluded.description, body = excluded.body, updated_at = excluded.updated_at, state = 'active', used_at = excluded.used_at, lint_warnings = excluded.lint_warnings`)
      .run(botId, input.name, input.description.trim(), input.body, now, now, now, JSON.stringify(lintSkill(input, this.list(botId).map((skill) => skill.name))));
    this.deps.changed();
    return this.list(botId).find((skill) => skill.name === input.name)!;
  }

  /** All content versions, including removed skills; reverting appends another version. */
  history(botId: string, before?: number, name?: string) {
    const rows = this.deps.db.prepare("SELECT * FROM bot_skill_versions WHERE bot_id = ? AND (? IS NULL OR id < ?) AND (? IS NULL OR name = ?) ORDER BY id DESC LIMIT 50").all(botId, before ?? null, before ?? null, name ?? null, name ?? null) as { id: number; name: string; description: string | null; body: string | null; old_body: string; warnings: string; at: number }[];
    return rows.map((row) => {
      let storedWarnings: string[] = [];
      const warnOnce = (reason: string) => {
        const key = `${row.id}:warnings`;
        if (this.jsonWarned.has(key)) return;
        this.jsonWarned.add(key);
        console.warn(`[studio] Ignoring malformed bot_skill_versions ${row.id} warnings: ${reason}`);
      };
      try {
        const parsed: unknown = JSON.parse(row.warnings);
        if (Array.isArray(parsed)) storedWarnings = parsed.filter((each): each is string => typeof each === "string");
        else warnOnce("expected array");
      } catch (error) {
        warnOnce(error instanceof Error ? error.message : String(error));
      }
      return {
        id: row.id, name: row.name, description: row.description, body: row.body, at: row.at,
        diff: lineDiff(row.old_body, row.body ?? ""),
        warnings: [...storedWarnings, ...(this.deps.db.prepare("SELECT warning FROM bot_skill_lints WHERE version_id = ? ORDER BY id").all(row.id) as { warning: string }[]).map((lint) => lint.warning)],
      };
    });
  }

  revert(botId: string, versionId: number): void {
    const version = this.deps.db.prepare("SELECT name, description, body FROM bot_skill_versions WHERE bot_id = ? AND id = ?").get(botId, versionId) as { name: string; description: string | null; body: string | null } | undefined;
    if (!version) throw new Error("That skill version is gone.");
    if (version.body === null) this.delete(botId, version.name);
    else this.write(botId, { name: version.name, description: version.description ?? version.name, body: version.body });
  }

  /** Model findings are advisory and belong to the exact version inspected. */
  lintVersion(botId: string, versionId: number, warnings: string[]): void {
    if (!this.deps.db.prepare("SELECT 1 FROM bot_skill_versions WHERE bot_id = ? AND id = ?").get(botId, versionId)) throw new Error("That skill version is gone.");
    this.deps.db.transaction(() => {
      for (const warning of warnings) this.deps.db.prepare("INSERT INTO bot_skill_lints(version_id, warning) VALUES (?, ?)").run(versionId, warning);
    })();
    this.deps.changed();
  }

  delete(botId: string, name: string): boolean {
    const deleted = this.deps.db.prepare("DELETE FROM bot_skills WHERE bot_id = ? AND name = ?").run(botId, name).changes > 0;
    if (deleted) this.deps.changed();
    return deleted;
  }

  /** Share: moves a skill into BB's user skills, where every agent finds it. */
  async share(botId: string, name: string): Promise<{ path: string }> {
    const skill = this.get(botId, name);
    if (!skill) throw new Error(`Your Bot has no skill "${name}".`);
    if (!this.deps.userSkillsDir) throw new Error("BB's skills folder isn't available.");
    const dir = join(this.deps.userSkillsDir, skill.name);
    if (existsSync(dir)) throw new Error(`A skill named "${skill.name}" is already shared. Rename the Bot's or delete the other first.`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    await writeFile(path, skillMarkdown(skill), { flag: "wx" });
    this.delete(botId, name);
    return { path };
  }
}

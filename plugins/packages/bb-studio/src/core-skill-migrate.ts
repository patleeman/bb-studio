// Moves each Bot's core profile page into its always-on skill, once
// (src/core-skill.ts). The page's text is copied whole: nothing is cut or
// rewritten, and a text over the always-on budget is kept and flagged by the
// skill's lint. The page and the retired memory tables stay as they are.
// A Bot without a core profile page gets the default template. The marker
// (bot_core_skills) makes it run once per Bot, so a skill the user later
// renames or deletes doesn't come back.
import type Database from "better-sqlite3";
import type { BotSkillStore } from "./bot-skills";
import { CORE_SKILL, CORE_SKILL_DESCRIPTION, CORE_TEMPLATE, alwaysOnChars } from "./core-skill";

export interface CoreMigrationDeps {
  db: Database.Database;
  skills: BotSkillStore;
  /** A page's Markdown (archived pages too), or null when there's no such page. */
  pageMarkdown(pageId: string): string | null;
}

export type CoreMigration = { state: "done" } | { state: "kept" | "moved" | "created"; skill: string; sourcePageId: string | null; chars: number };

const hasTable = (db: Database.Database, name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/** The Bot's core profile page: its memory_profiles row's page, else its bots.memory_page_id, when the page is there. */
function sourcePage(deps: CoreMigrationDeps, botId: string): { id: string; markdown: string } | null {
  const ids: string[] = [];
  if (hasTable(deps.db, "memory_profiles")) {
    const row = deps.db.prepare("SELECT profile_page_id FROM memory_profiles WHERE bot_id = ?").get(botId) as { profile_page_id: string | null } | undefined;
    if (row?.profile_page_id) ids.push(row.profile_page_id);
  }
  const bot = deps.db.prepare("SELECT memory_page_id FROM bots WHERE id = ?").get(botId) as { memory_page_id: string | null } | undefined;
  if (bot?.memory_page_id) ids.push(bot.memory_page_id);
  for (const id of ids) {
    const markdown = deps.pageMarkdown(id);
    if (markdown !== null) return { id, markdown };
  }
  return null;
}

/** Gives a Bot its always-on core skill, once. Safe to call any number of times. */
export function migrateCoreSkill(deps: CoreMigrationDeps, botId: string, now = Date.now()): CoreMigration {
  if (deps.db.prepare("SELECT 1 FROM bot_core_skills WHERE bot_id = ?").get(botId)) return { state: "done" };
  const mark = (skill: string, sourcePageId: string | null, chars: number) =>
    deps.db.prepare("INSERT OR IGNORE INTO bot_core_skills (bot_id, skill_name, source_page_id, chars, migrated_at) VALUES (?, ?, ?, ?, ?)").run(botId, skill, sourcePageId, chars, now);
  const already = deps.skills.alwaysOn(botId)[0];
  if (already) {
    mark(already.name, null, alwaysOnChars(already.body));
    return { state: "kept", skill: already.name, sourcePageId: null, chars: alwaysOnChars(already.body) };
  }
  const page = sourcePage(deps, botId);
  const text = page?.markdown.trim() ? `${page.markdown.trim()}\n` : CORE_TEMPLATE;
  const taken = (name: string) => !!deps.skills.get(botId, name);
  const name = !taken(CORE_SKILL) ? CORE_SKILL : !taken(`${CORE_SKILL}-moved`) ? `${CORE_SKILL}-moved` : `${CORE_SKILL}-${now.toString(36)}`;
  deps.db.transaction(() => {
    deps.skills.write(botId, { name, description: CORE_SKILL_DESCRIPTION, body: text, alwaysOn: true });
    deps.skills.setAlwaysOn(botId, name, true);
    mark(name, page?.markdown.trim() ? page.id : null, alwaysOnChars(text));
  })();
  return { state: page?.markdown.trim() ? "moved" : "created", skill: name, sourcePageId: page?.markdown.trim() ? page.id : null, chars: alwaysOnChars(text) };
}

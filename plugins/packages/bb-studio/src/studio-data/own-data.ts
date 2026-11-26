// Whether this install's Studio holds anything of the user's own, before bb's
// Studio data takes its place (start.ts, and the offer in Settings).
//
// It describes exactly what a new install has, and anything else counts:
//   - at most one Bot, with at most its Main thread and one welcome
//     conversation (bot_threads), and the personal project's lead (that
//     Bot's Main) and its run;
//   - at most one page: that Bot's core profile (memory) page, still the
//     template it was made from, and the item index row for it;
//   - at most that Bot's always-on core skill, still the template
//     (src/core-skill.ts), with its version and its move marker;
//   - rows only in the housekeeping tables below, and in full-text indexes,
//     which mirror other tables.
// Every other table must be empty, so a table a later Studio adds counts
// until it is listed here. Any error (a lock, a corrupt file, a renamed
// table) answers "has data": the check fails closed.
import type Database from "better-sqlite3";
import { MEMORY_TEMPLATE } from "../bot";
import { PROFILE_TEMPLATE } from "../memory/service";
import { PERSONAL_PROJECT_ID, BOT_RUN_PREFIX } from "../project-lead";
import { CORE_TEMPLATE } from "../core-skill";

/** Tables whose rows are never something the user made: Studio's own bookkeeping. */
export const HOUSEKEEPING_TABLES: ReadonlySet<string> = new Set([
  "_bb_migrations",
  "triggers",
  "bot_threads_state",
  "live_activity",
  "thread_titles",
  "studio_presences",
  "account_warnings",
  "loop_scheduler",
  "bot_cache_settings",
  "bot_cache_pings",
  "bot_cache_banner_off",
  "bot_cache_compactions",
  "bot_maintenance_settings",
  "bot_maintenance_runs",
  "bot_learning",
  "bot_skill_review_queue",
  "bot_skill_review_marks",
  "bot_hidden_threads",
  "bot_nudges",
  "bot_run_dismissals",
  "thread_auto_resumes",
  "trigger_runs",
  "next_suggestions",
  "automation_auto_resumes",
  "thread_seeds",
  "tabs",
  "item_activity",
  "mini_fetch_log",
]);

/** Checked one by one below. */
const RULED = new Set(["bots", "bot_threads", "pages", "items", "memory_profiles", "project_leads", "project_runs", "bot_skills", "bot_skill_versions", "bot_core_skills"]);

export type OwnData = { has: false } | { has: true; reason: string };

const has = (reason: string): OwnData => ({ has: true, reason });

/** Markdown with its spacing and list and heading marks evened out, to compare a page with the template it started from. */
const plain = (markdown: string) => markdown.replace(/^[\s>*+#-]+/gm, "").replace(/\s+/g, " ").trim();
const STARTING_PAGES = new Set([plain(PROFILE_TEMPLATE), plain(MEMORY_TEMPLATE)]);

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

/** Virtual tables (full-text indexes) and their shadow tables mirror other tables. */
function mirrorTables(db: Database.Database): Set<string> {
  const virtual = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'").all() as { name: string }[]).map((row) => row.name);
  const mirrors = new Set(virtual);
  const all = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
  for (const name of all) if (virtual.some((table) => name.startsWith(`${table}_`))) mirrors.add(name);
  return mirrors;
}

export function studioOwnData(db: Database.Database): OwnData {
  try {
    return check(db);
  } catch (error) {
    return has(`this install's Studio data could not be read (${error instanceof Error ? error.message : String(error)})`);
  }
}

function check(db: Database.Database): OwnData {
  const bots = db.prepare("SELECT id, thread_id, memory_page_id FROM bots").all() as { id: string; thread_id: string | null; memory_page_id: string | null }[];
  if (bots.length > 1) return has(`it has ${bots.length} Bots`);
  const bot = bots[0] ?? null;

  const threads = db.prepare("SELECT bot_id, is_main FROM bot_threads").all() as { bot_id: string; is_main: number }[];
  if (threads.some((row) => row.bot_id !== bot?.id)) return has("it has conversations of another Bot");
  if (threads.filter((row) => row.is_main).length > 1 || threads.filter((row) => !row.is_main).length > 1) return has(`its Bot has ${threads.length} conversations`);

  const profiles = db.prepare("SELECT bot_id, profile_page_id FROM memory_profiles").all() as { bot_id: string; profile_page_id: string }[];
  if (profiles.some((row) => row.bot_id !== bot?.id)) return has("it has another Bot's memory");
  const memoryPage = bot?.memory_page_id ?? profiles[0]?.profile_page_id ?? null;
  const pages = db.prepare("SELECT id, markdown FROM pages").all() as { id: string; markdown: string }[];
  for (const page of pages) {
    if (page.id !== memoryPage) return has(`it has ${pages.length} pages`);
    if (!STARTING_PAGES.has(plain(page.markdown))) return has("its Bot's core profile page was changed");
  }
  if (count(db, "SELECT COUNT(*) AS n FROM items WHERE NOT (plugin_id = 'pages' AND id IS ?)", memoryPage) > 0) return has("it has pages or apps");

  // The Bot's always-on core skill, as a new Bot gets it; its versions and marker follow the skill.
  const skills = db.prepare("SELECT bot_id, body, always_on FROM bot_skills").all() as { bot_id: string; body: string; always_on: number }[];
  if (skills.some((row) => row.bot_id !== bot?.id || !row.always_on)) return has("it has skills");
  if (skills.length > 1) return has(`its Bot has ${skills.length} skills`);
  if (skills[0] && plain(skills[0].body) !== plain(CORE_TEMPLATE)) return has("its Bot's always-on skill was changed");
  if (count(db, "SELECT COUNT(DISTINCT name) AS n FROM bot_skill_versions") > skills.length || count(db, "SELECT COUNT(*) AS n FROM bot_skill_versions") > skills.length) return has("its Bot's skills were edited");
  if (count(db, "SELECT COUNT(*) AS n FROM bot_core_skills WHERE bot_id IS NOT ?", bot?.id ?? null) > 0) return has("it has another Bot's skills");

  const leads = db.prepare("SELECT project_id, lead_thread_id FROM project_leads").all() as { project_id: string; lead_thread_id: string | null }[];
  // The personal project's lead is the primary Bot's Main.
  if (leads.some((row) => row.project_id !== PERSONAL_PROJECT_ID)) return has("it has project leads");
  const runs = db.prepare("SELECT project_id FROM project_runs").all() as { project_id: string }[];
  if (runs.some((row) => row.project_id !== PERSONAL_PROJECT_ID && row.project_id !== `${BOT_RUN_PREFIX}${bot?.id ?? ""}`)) return has("it has project heartbeats");

  const mirrors = mirrorTables(db);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  for (const table of tables) {
    if (RULED.has(table) || HOUSEKEEPING_TABLES.has(table) || mirrors.has(table)) continue;
    if (db.prepare(`SELECT 1 FROM "${table.replace(/"/g, '""')}" LIMIT 1`).get()) return has(`it has ${table.replace(/_/g, " ")}`);
  }
  return { has: false };
}

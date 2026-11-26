// The upgrade path: a data dir from before always-on skills, with memory
// records (and their FTS index) and a Bot's core profile page, migrated by
// this Studio. Nothing of the old data may be lost: the records and the page
// stay as they were, and the page's text moves whole into the always-on skill.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { Bots } from "./bot";
import { ALWAYS_ON_CAP } from "./core-skill";
import { MIGRATIONS } from "./migrations";
import { readMarkdown } from "./pages/doc";
import { PagesService } from "./pages/service";
import { PageStore } from "./pages/store";
import { PERSONAL_PROJECT_ID } from "./project-lead";

const dispose: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

/** The migrations a Studio from before always-on skills had: everything before the always_on column. */
const BEFORE = MIGRATIONS.findIndex((sql) => typeof sql === "string" && sql.includes("ALTER TABLE bot_skills ADD COLUMN always_on"));

const PROFILE = `## Who the user is

Sam, a staff engineer.

## How they work

${Array.from({ length: 120 }, (_, n) => `- Rule ${n}: one clear recommendation, and say what failed.`).join("\n")}

## Check-in

- Anything waiting on the user?
- Garage sensor battery on the 1st.
`;

function oldInstall() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS.slice(0, BEFORE));
  expect(db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('bot_skills') WHERE name = 'always_on'").get()).toEqual({ n: 0 });
  const store = new PageStore(db);
  const pages = new PagesService(bb as never, store);
  dispose.push(() => pages.hub.disposeAll());
  db.prepare("INSERT INTO bots (id, name, avatar, state, thread_id, heartbeat_was_on, created_at, updated_at) VALUES ('bot_main', 'Dot', 'x', 'active', NULL, 0, 1, 1), ('bot_two', 'Scout', 'y', 'active', NULL, 0, 2, 2)").run();
  const profile = pages.createPage({ projectId: PERSONAL_PROJECT_ID, parentId: null, title: "Dot's core profile", icon: "🪪", markdown: PROFILE, actor: "studio" }).id;
  db.prepare("INSERT INTO memory_profiles (bot_id, profile_page_id, legacy_page_id, split_at, created_at) VALUES ('bot_main', ?, NULL, NULL, 1)").run(profile);
  db.prepare("UPDATE bots SET memory_page_id = ? WHERE id = 'bot_main'").run(profile);
  const add = db.prepare("INSERT INTO memory_records (id, bot_id, topic, text, created_at, updated_at, source_kind, source_id, source_title, source_section, replaces_id, replaced_by_id, archived) VALUES (?, 'bot_main', ?, ?, ?, ?, 'manual', NULL, 'Added by you', NULL, NULL, NULL, 0)");
  for (let n = 0; n < 274; n++) add.run(`mem_${n}`, n % 2 ? "Conversations" : "Preferences", `Record ${n}: a fact worth keeping about the launch.`, n, n);
  return { bb, db, pages, profile };
}

it("upgrades an install with memory records and a core profile without losing anything, once", () => {
  const old = oldInstall();
  const records = () => old.db.prepare("SELECT id, topic, text, archived, replaced_by_id FROM memory_records ORDER BY rowid").all();
  const before = { records: records(), page: readMarkdown(old.pages.hub.open(old.profile).doc), fts: old.db.prepare("SELECT COUNT(*) AS n FROM memory_records_fts WHERE memory_records_fts MATCH 'launch'").get() };
  expect(before.records).toHaveLength(274);

  old.bb.storage.migrate(old.db, MIGRATIONS);
  const bots = new Bots({ db: old.db, sdk: old.bb.sdk, leads: null as never, changed: () => {}, presenceChanged: () => {}, memory: { exists: (id: string) => !!old.pages.store.meta(id), markdown: (id: string) => (old.pages.store.meta(id) ? readMarkdown(old.pages.hub.open(id).doc) : null) } } as never);

  // The records, their index and the page are untouched; the records table keeps its name.
  expect(records()).toEqual(before.records);
  expect(old.db.prepare("SELECT COUNT(*) AS n FROM memory_records_fts WHERE memory_records_fts MATCH 'launch'").get()).toEqual(before.fts);
  expect(readMarkdown(old.pages.hub.open(old.profile).doc)).toBe(before.page);
  expect(old.db.prepare("SELECT profile_page_id FROM memory_profiles WHERE bot_id = 'bot_main'").get()).toEqual({ profile_page_id: old.profile });

  // The page's text moves whole into the always-on skill, over the budget and flagged, not cut.
  expect(bots.ensureCore("bot_main")).toMatchObject({ state: "moved", skill: "core-profile", sourcePageId: old.profile });
  const skill = bots.skill("core-profile", "bot_main")!;
  expect(skill.body.trim()).toBe(before.page.trim());
  expect(skill).toMatchObject({ alwaysOn: true, pinned: true });
  expect(skill.body.length).toBeGreaterThan(ALWAYS_ON_CAP);
  expect(bots.skillBudget("bot_main")).toMatchObject({ over: true });
  expect(bots.skillLint({ name: "core-profile", body: skill.body }, "bot_main")).toEqual(expect.arrayContaining([expect.stringContaining("over the 3,000 budget")]));
  // Its check-in section is what the check-in reads.
  expect(skill.body).toContain("## Check-in\n\n- Anything waiting on the user?\n- Garage sensor battery on the 1st.");

  // A Bot without a profile page gets the template; a second run changes nothing.
  expect(bots.ensureCore("bot_two")).toMatchObject({ state: "created" });
  expect(bots.ensureCore("bot_main")).toEqual({ state: "done" });
  expect(bots.ensureCore("bot_two")).toEqual({ state: "done" });
  expect(old.db.prepare("SELECT bot_id, skill_name, source_page_id FROM bot_core_skills ORDER BY bot_id").all()).toEqual([
    { bot_id: "bot_main", skill_name: "core-profile", source_page_id: old.profile },
    { bot_id: "bot_two", skill_name: "core-profile", source_page_id: null },
  ]);
  expect(old.db.prepare("SELECT COUNT(*) AS n FROM bot_skill_versions WHERE bot_id = 'bot_main' AND name = 'core-profile'").get()).toEqual({ n: 1 });

  // Running the migrations again (the next start) is a no-op.
  old.bb.storage.migrate(old.db, MIGRATIONS);
  expect(records()).toEqual(before.records);
  expect(bots.skill("core-profile", "bot_main")!.body).toBe(skill.body);
});

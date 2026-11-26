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

const tables = (db: import("better-sqlite3").Database) => (db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'memory_%' ORDER BY name").all() as { name: string }[]).map((row) => row.name);

it("upgrades an install with memory records and a core profile: the profile into the skill first, then the tables go, once", () => {
  const old = oldInstall();
  const page = readMarkdown(old.pages.hub.open(old.profile).doc);
  expect(old.db.prepare("SELECT COUNT(*) AS n FROM memory_records").get()).toEqual({ n: 274 });

  old.bb.storage.migrate(old.db, MIGRATIONS);
  const bots = new Bots({ db: old.db, sdk: old.bb.sdk, leads: null as never, changed: () => {}, presenceChanged: () => {}, memory: { exists: (id: string) => !!old.pages.store.meta(id), markdown: (id: string) => (old.pages.store.meta(id) ? readMarkdown(old.pages.hub.open(id).doc) : null) } } as never);
  // The migrations themselves drop nothing.
  expect(tables(old.db)).toEqual(expect.arrayContaining(["memory_profiles", "memory_records", "memory_records_fts"]));

  // Until every Bot's profile is in its skill, the tables stay.
  expect(bots.ensureCore("bot_main")).toMatchObject({ state: "moved", skill: "core-profile", sourcePageId: old.profile });
  expect(bots.retireMemoryTables()).toBeNull();
  expect(tables(old.db)).toContain("memory_profiles");

  // The page's text moved whole into the always-on skill, over the budget and flagged, not cut.
  const skill = bots.skill("core-profile", "bot_main")!;
  expect(skill.body.trim()).toBe(page.trim());
  expect(skill).toMatchObject({ alwaysOn: true, pinned: true });
  expect(skill.body.length).toBeGreaterThan(ALWAYS_ON_CAP);
  expect(bots.skillLint({ name: "core-profile", body: skill.body }, "bot_main")).toEqual(expect.arrayContaining([expect.stringContaining("over the 2,000 budget")]));
  expect(skill.body).toContain("## Check-in\n\n- Anything waiting on the user?\n- Garage sensor battery on the 1st.");

  // The second Bot (no page) gets the template; now every Bot is in, and the tables go.
  expect(bots.ensureCore("bot_two")).toMatchObject({ state: "created" });
  expect(bots.retireMemoryTables()).toEqual({ dropped: ["memory_records_fts", "memory_records", "memory_profiles"] });
  expect(tables(old.db)).toEqual([]);
  expect(old.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memory_%'").all()).toEqual([]);
  // The page itself stays.
  expect(readMarkdown(old.pages.hub.open(old.profile).doc)).toBe(page);

  // A second start: no-op.
  old.bb.storage.migrate(old.db, MIGRATIONS);
  expect(bots.ensureCore("bot_main")).toEqual({ state: "done" });
  expect(bots.ensureCore("bot_two")).toEqual({ state: "done" });
  expect(bots.retireMemoryTables()).toEqual({ dropped: [] });
  expect(bots.skill("core-profile", "bot_main")!.body).toBe(skill.body);
  expect(old.db.prepare("SELECT bot_id, skill_name, source_page_id FROM bot_core_skills ORDER BY bot_id").all()).toEqual([
    { bot_id: "bot_main", skill_name: "core-profile", source_page_id: old.profile },
    { bot_id: "bot_two", skill_name: "core-profile", source_page_id: null },
  ]);
  expect(old.db.prepare("SELECT COUNT(*) AS n FROM bot_skill_versions WHERE bot_id = 'bot_main' AND name = 'core-profile'").get()).toEqual({ n: 1 });
});

it("holds the drop back when a Bot's copy fails, and doesn't wait on an external Bot", () => {
  const old = oldInstall();
  old.bb.storage.migrate(old.db, MIGRATIONS);
  const failing = new Bots({ db: old.db, sdk: old.bb.sdk, leads: null as never, changed: () => {}, presenceChanged: () => {}, memory: { exists: () => true, markdown: () => { throw new Error("page store unavailable"); } } } as never);
  expect(() => failing.ensureCore("bot_main")).toThrow("page store unavailable");
  failing.ensureCore("bot_two");
  expect(failing.retireMemoryTables()).toBeNull();
  expect(old.db.prepare("SELECT COUNT(*) AS n FROM memory_records").get()).toEqual({ n: 274 });
  // An external Bot keeps its own memory and gets no core skill; it never holds the drop back.
  old.db.prepare("UPDATE bots SET provider_id = 'hermes' WHERE id = 'bot_main'").run();
  expect(failing.retireMemoryTables()).toMatchObject({ dropped: expect.arrayContaining(["memory_records"]) });
});

import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { automationTable, bbFromFile, bbFromOverview, cronText, readImportedAt, readStudioEntries, readThreadOwners, whenText, type BbEntry, type TableInput } from "./automation-table";

const HOUR = 3_600_000;
const IMPORTED = 1_794_348_078_043;
const dirs: string[] = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "automation-table-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

// Studio's tables as the installed app has them (the columns this reads).
function studioDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE bots (id TEXT PRIMARY KEY, name TEXT NOT NULL, thread_id TEXT, created_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE bot_automations (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, instruction TEXT NOT NULL DEFAULT '',
      script TEXT, target TEXT NOT NULL DEFAULT 'main', schedule_json TEXT NOT NULL, state TEXT NOT NULL, project_id TEXT NOT NULL, bb_ids TEXT NOT NULL DEFAULT '[]',
      target_thread_id TEXT, last_fired_at INTEGER, created_at INTEGER NOT NULL, resources TEXT);
    CREATE TABLE bot_runners (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, name TEXT NOT NULL, job TEXT NOT NULL, thread_id TEXT UNIQUE, project_id TEXT NOT NULL,
      state TEXT NOT NULL, cadence TEXT NOT NULL, time TEXT NOT NULL, cron TEXT, automation_id TEXT, automation_project_id TEXT, last_run_at INTEGER,
      created_at INTEGER NOT NULL, timezone TEXT);
    CREATE TABLE bot_threads (thread_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL);
  `);
  const before = IMPORTED - 30 * 24 * HOUR;
  db.prepare("INSERT INTO bots VALUES (?, ?, ?, 0)").run("bot_main", "Chief of Staff", "thr_demo000022");
  db.prepare("INSERT INTO bots VALUES (?, ?, ?, 1)").run("bot_home", "Home", "thr_home");
  const automation = db.prepare("INSERT INTO bot_automations (id, bot_id, kind, name, instruction, script, schedule_json, state, project_id, bb_ids, target_thread_id, last_fired_at, created_at) VALUES (@id, @bot, @kind, @name, @instruction, @script, @schedule, @state, 'proj_personal', @bbIds, @thread, @fired, @created)");
  automation.run({ id: "aut_0ctdvm7eml", bot: "bot_main", kind: "watcher", name: "Silent heartbeat", instruction: "", script: "./health.sh", schedule: JSON.stringify({ type: "interval", every: 2, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "23:00", timezone: "America/New_York" }), state: "paused", bbIds: JSON.stringify(["auto_uwkxebxyzxg"]), thread: null, fired: IMPORTED - 5 * HOUR, created: before });
  automation.run({ id: "aut_3k8tydwuck", bot: "bot_main", kind: "watcher", name: "Morning card", instruction: "Write today's morning card.", script: "./card.sh", schedule: JSON.stringify({ type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["07:45"] }), state: "paused", bbIds: JSON.stringify(["auto_6cdixw-afss"]), thread: null, fired: null, created: before });
  automation.run({ id: "aut_dqm9klzlbe", bot: "bot_main", kind: "checkin", name: "Daily check-in", instruction: "How's the day?", script: null, schedule: JSON.stringify({ type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["13:00"] }), state: "paused", bbIds: JSON.stringify(["trg_automation_aut_dqm9klzlbe"]), thread: "thr_demo000022", fired: null, created: before });
  automation.run({ id: "aut_remind", bot: "bot_main", kind: "reminder", name: "Call the plumber", instruction: "Remind me", script: null, schedule: JSON.stringify({ type: "once", at: IMPORTED - 2 * HOUR }), state: "done", bbIds: "[]", thread: null, fired: IMPORTED - 2 * HOUR, created: before });
  automation.run({ id: "aut_new", bot: "bot_main", kind: "checkin", name: "Evening wrap-up", instruction: "Wrap up", script: null, schedule: JSON.stringify({ type: "times", days: [1, 2, 3, 4, 5], times: ["18:00"] }), state: "active", bbIds: "[]", thread: null, fired: null, created: IMPORTED + HOUR });
  automation.run({ id: "aut_home", bot: "bot_home", kind: "watcher", name: "Garage door", instruction: "", script: "./garage.sh", schedule: JSON.stringify({ type: "cron", cron: "*/20 * * * *" }), state: "active", bbIds: JSON.stringify(["auto_garage"]), thread: null, fired: null, created: IMPORTED + HOUR });
  const runner = db.prepare("INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, automation_project_id, last_run_at, created_at, timezone) VALUES (@id, @bot, @name, 'Sweep', @thread, 'proj_personal', 'paused', @cadence, @time, @cron, @automation, @project, @last, @created, 'America/New_York')");
  runner.run({ id: "run_l4v5bcrvlz", bot: "bot_main", name: "BB Studio fork sync", thread: "thr_demo000009", cadence: "daily", time: "04:30", cron: null, automation: "trg_runner_run_l4v5bcrvlz", project: "proj_personal", last: IMPORTED - 6 * HOUR, created: before });
  runner.run({ id: "run_5wtmlkr048", bot: "bot_main", name: "Set up GB Studio", thread: "thr_demo000010", cadence: "custom", time: "09:00", cron: "15 */2 * * *", automation: "auto_-hlcl9mslxy", project: "proj_zmdvqw4b4v", last: null, created: before });
  db.prepare("INSERT INTO bot_threads VALUES (?, ?, ?)").run("thr_demo000014", "bot_main", "worker");
  db.prepare("INSERT INTO bot_threads VALUES (?, ?, ?)").run("thr_home_chat", "bot_home", "conversation");
  return db;
}

const bb = (entry: Partial<BbEntry> & Pick<BbEntry, "id" | "name">): BbEntry => ({
  projectId: "proj_personal", enabled: false, cron: "0 9 * * *", runAt: null, nextRunAt: null, lastRunAt: IMPORTED - 24 * HOUR,
  lastRunStatus: "succeeded", threadIds: [], createdAt: IMPORTED - 40 * 24 * HOUR, instruction: null, ...entry,
});

// bb's automations as the installed app has them, after the import disabled every one.
const BB: BbEntry[] = [
  bb({ id: "auto_uwkxebxyzxg", name: "Chief of Staff · Silent heartbeat", cron: "0 8,10,12,14,16,18,20,22 * * *", lastRunAt: IMPORTED - HOUR, lastRunStatus: "skipped" }),
  bb({ id: "auto_6cdixw-afss", name: "Chief of Staff · Morning card", cron: "45 7 * * *", lastRunStatus: "failed" }),
  bb({ id: "auto_8dc_eupcyd4", name: "Chief of Staff · Daily check-in", cron: "0 13 * * *", threadIds: ["thr_demo000022"], lastRunAt: IMPORTED - 3 * HOUR }),
  bb({ id: "auto_bh3d0ntpyla", name: "Studio runner run_l4v5bcrvlz", cron: "30 4 * * *", threadIds: ["thr_demo000009"], lastRunAt: null, lastRunStatus: null }),
  bb({ id: "auto_20qc1awj8ag", name: "Staff · Briefing assemble", cron: "40 7 * * *", threadIds: ["thr_demo000022"] }),
  bb({ id: "auto_twnts2ex3zy", name: "Larkspur: health watchdog", cron: "15 */2 * * *", threadIds: ["thr_demo000014"] }),
  bb({ id: "auto_x1kt5kijizw", name: "Watch bb#1085", cron: "0 */6 * * *", projectId: "proj_y6wu7yah45", threadIds: ["thr_demo000016"] }),
  bb({ id: "auto_mvujgmm9tag", name: "Larkspur: utilities second pass", cron: null, runAt: IMPORTED - 50 * HOUR, lastRunAt: IMPORTED - 50 * HOUR, threadIds: ["thr_demo000014"] }),
  bb({ id: "auto_garage", name: "Home · Garage door", cron: "*/20 * * * *", enabled: true, createdAt: IMPORTED + HOUR }),
  bb({ id: "auto_home_news", name: "Home news", cron: "0 7 * * *", threadIds: ["thr_home_chat"] }),
];

function input(db: Database.Database, overrides: Partial<TableInput> = {}): TableInput {
  const bots = db.prepare("SELECT id, name, thread_id AS threadId FROM bots ORDER BY created_at").all() as { id: string; name: string; threadId: string | null }[];
  return {
    botId: "bot_main", primaryBotId: "bot_main", bots,
    studio: readStudioEntries(db, (id) => (id === "trg_automation_aut_dqm9klzlbe" ? { lastRunAt: IMPORTED - 26 * HOUR, lastRunStatus: "fired" } : null)),
    bb: BB, threadOwners: readThreadOwners(db, bots.map((bot) => ({ botId: bot.id, threadId: bot.threadId }))),
    importedAt: null, bbPlugin: "off", ...overrides,
  };
}

describe("the merged table", () => {
  it("has one row per automation: a Studio row and the bb automations behind it are one row", () => {
    const table = automationTable(input(studioDb()));
    const byId = new Map(table.rows.map((row) => [row.id, row]));
    expect([...byId.keys()].sort()).toEqual([
      "aut_0ctdvm7eml", "aut_3k8tydwuck", "aut_dqm9klzlbe", "aut_new", "aut_remind",
      "auto_20qc1awj8ag", "auto_mvujgmm9tag", "auto_twnts2ex3zy", "auto_x1kt5kijizw",
      "run_5wtmlkr048", "run_l4v5bcrvlz",
    ]);
    expect(byId.get("aut_0ctdvm7eml")).toMatchObject({ kind: "watcher", when: "Every 2 h, 8:00 AM–11:00 PM", bb: { id: "auto_uwkxebxyzxg", projectId: "proj_personal" }, lastRunAt: IMPORTED - HOUR, lastRun: "ok", via: "studio" });
    expect(byId.get("aut_3k8tydwuck")).toMatchObject({ when: "Daily 7:45 AM", lastRun: "failed", script: "./card.sh" });
    expect(byId.get("aut_dqm9klzlbe")).toMatchObject({ kind: "checkin", bb: { id: "auto_8dc_eupcyd4" }, lastRunAt: IMPORTED - 3 * HOUR, threadId: "thr_demo000022" });
    expect(byId.get("run_l4v5bcrvlz")).toMatchObject({ kind: "runner", when: "Daily 4:30 AM", bb: { id: "auto_bh3d0ntpyla" }, lastRunAt: IMPORTED - 6 * HOUR, threadId: "thr_demo000009" });
    expect(byId.get("run_5wtmlkr048")).toMatchObject({ when: "Every 2 h at :15", bb: null, lastRunAt: null });
  });

  it("attributes bb's own automations by thread, else to the primary Bot, and keeps another Bot's out", () => {
    const db = studioDb();
    const main = automationTable(input(db));
    const via = Object.fromEntries(main.rows.filter((row) => row.kind === "bb").map((row) => [row.name, row.via]));
    expect(via).toEqual({ "Staff · Briefing assemble": "thread", "Larkspur: health watchdog": "thread", "Larkspur: utilities second pass": "thread", "Watch bb#1085": "primary" });
    const home = automationTable(input(db, { botId: "bot_home" }));
    expect(home.rows.map((row) => [row.name, row.kind, row.via])).toEqual([["Garage door", "watcher", "studio"], ["Home news", "bb", "thread"]]);
  });

  it("shows paused, disabled and finished ones, active first then by name", () => {
    const table = automationTable(input(studioDb()));
    expect(table.rows[0]).toMatchObject({ name: "Evening wrap-up", status: "active", when: "Weekdays 6:00 PM" });
    const rest = table.rows.slice(1);
    expect(rest.map((row) => row.name)).toEqual([...rest.map((row) => row.name)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
    expect(table.rows.find((row) => row.id === "aut_remind")?.status).toBe("off");
    expect(table.rows.find((row) => row.id === "auto_mvujgmm9tag")?.status).toBe("off");
    expect(table.rows.find((row) => row.id === "auto_x1kt5kijizw")?.status).toBe("paused");
    expect(table.rows.every((row) => !row.inBb && !row.readOnly)).toBe(true);
  });

  it("on a mirrored install, marks what the import paused as in bb and read-only, and nothing made or running here", () => {
    const table = automationTable(input(studioDb(), { importedAt: IMPORTED }));
    expect(table.mirrored).toBe(true);
    const inBb = table.rows.filter((row) => row.inBb).map((row) => row.id).sort();
    expect(inBb).toEqual(["aut_0ctdvm7eml", "aut_3k8tydwuck", "aut_dqm9klzlbe", "auto_20qc1awj8ag", "auto_twnts2ex3zy", "auto_x1kt5kijizw", "run_5wtmlkr048", "run_l4v5bcrvlz"]);
    expect(table.rows.every((row) => row.readOnly === row.inBb)).toBe(true);
    expect(table.rows.find((row) => row.id === "aut_new")).toMatchObject({ status: "active", inBb: false });
    expect(table.rows.find((row) => row.id === "aut_remind")).toMatchObject({ status: "off", inBb: false });
  });

  it("links the heartbeat and maintenance rows when given, without an import pause", () => {
    const db = studioDb();
    const base = input(db, { importedAt: IMPORTED });
    const table = automationTable({ ...base, studio: [...base.studio, { id: "heartbeat", botId: "bot_main", kind: "schedule", name: "Check-in", when: "Hourly", status: "paused", createdAt: null, bbIds: [{ id: "auto_hb", projectId: "proj_personal" }], threadId: "thr_demo000022", lastRunAt: null, lastRun: null, instruction: null, script: null }], bb: [...BB, bb({ id: "auto_hb", name: "Personal heartbeat" })] });
    expect(table.rows.find((row) => row.id === "heartbeat")).toMatchObject({ kind: "schedule", bb: { id: "auto_hb" }, inBb: false, lastRunAt: IMPORTED - 24 * HOUR });
    expect(table.rows.some((row) => row.id === "auto_hb")).toBe(false);
  });
});

describe("reading the sources", () => {
  it("reads bb's automations from its data file, read-only, and none when it is missing", () => {
    const path = join(tempDir(), "data.db");
    const file = new Database(path);
    file.exec(`CREATE TABLE automations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, target_thread_id TEXT, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      trigger_type TEXT NOT NULL, trigger_config TEXT NOT NULL, run_mode TEXT NOT NULL, execution TEXT NOT NULL, origin TEXT NOT NULL, created_by_thread_id TEXT,
      next_run_at INTEGER, last_run_at INTEGER, last_run_status TEXT, created_at INTEGER NOT NULL)`);
    const insert = file.prepare("INSERT INTO automations VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)");
    insert.run("auto_8dc_eupcyd4", "proj_personal", "thr_demo000022", "Chief of Staff · Daily check-in", "schedule", JSON.stringify({ triggerType: "schedule", cron: "0 13 * * *", timezone: "America/New_York" }), "agent", JSON.stringify({ mode: "agent", prompt: " Check in. ", targetThreadId: "thr_demo000022" }), "app", null, 5, "succeeded", 1);
    insert.run("auto_g5s30nar9sm", "proj_99zf7vncus", null, "Daily rail digest", "once", JSON.stringify({ triggerType: "once", runAt: 1_893_488_400_000 }), "agent", JSON.stringify({ mode: "script", scriptFile: "script.sh" }), "agent", "thr_demo000019", null, null, 2);
    file.close();
    expect(bbFromFile(path)).toEqual([
      { id: "auto_8dc_eupcyd4", projectId: "proj_personal", name: "Chief of Staff · Daily check-in", enabled: false, cron: "0 13 * * *", runAt: null, nextRunAt: null, lastRunAt: 5, lastRunStatus: "succeeded", threadIds: ["thr_demo000022"], createdAt: 1, instruction: "Check in." },
      { id: "auto_g5s30nar9sm", projectId: "proj_99zf7vncus", name: "Daily rail digest", enabled: false, cron: null, runAt: 1_893_488_400_000, nextRunAt: null, lastRunAt: null, lastRunStatus: null, threadIds: ["thr_demo000019"], createdAt: 2, instruction: null },
    ]);
    expect(bbFromFile(join(tempDir(), "missing.db"))).toEqual([]);
  });

  it("reads bb's automations from its plugin's overview, skipping ones it can't read", () => {
    const overview = { automations: [
      { automation: { id: "auto_1", projectId: "proj_a", name: "Watch PR", enabled: true, trigger: { triggerType: "schedule", cron: "0 */2 * * *", timezone: "UTC" }, execution: { mode: "agent", prompt: "Watch", targetThreadId: "thr_t" }, createdByThreadId: "thr_c", nextRunAt: 9, lastRunAt: 8, lastRunStatus: "failed", createdAt: 7, origin: "agent" }, project: { id: "proj_a", name: "A" } },
      { automation: { id: "auto_2", projectId: "proj_a", name: "Broken", problem: "invalid-stored-data" }, project: { id: "proj_a", name: "A" } },
      { automation: { code: "unreadable" }, project: { id: "p", name: "P" } },
    ] };
    expect(bbFromOverview(overview)).toEqual([
      { id: "auto_1", projectId: "proj_a", name: "Watch PR", enabled: true, cron: "0 */2 * * *", runAt: null, nextRunAt: 9, lastRunAt: 8, lastRunStatus: "failed", threadIds: ["thr_t", "thr_c"], createdAt: 7, instruction: "Watch" },
      { id: "auto_2", projectId: "proj_a", name: "Broken", enabled: false, cron: null, runAt: null, nextRunAt: null, lastRunAt: null, lastRunStatus: null, threadIds: [], createdAt: null, instruction: null },
    ]);
    expect(bbFromOverview(null)).toEqual([]);
  });

  it("knows a mirrored install by the import's state file", () => {
    const dir = tempDir();
    expect(readImportedAt(dir)).toBeNull();
    writeFileSync(join(dir, "fork-import.json"), JSON.stringify({ version: 1, sourceDataDir: "/Users/x/.bb", importedAt: IMPORTED }));
    expect(readImportedAt(dir)).toBe(IMPORTED);
    writeFileSync(join(dir, "fork-import.json"), JSON.stringify({ version: 2, sourceDataDir: "/Users/x/.bb" }));
    expect(readImportedAt(dir)).toBeNull();
  });

  it("knows a cut-over install by its cutoverAt mark or its paused mirror, and only then", () => {
    const dir = tempDir();
    const state = { version: 1, sourceDataDir: "/Users/x/.bb", sourceServerHostId: "host_demo", importedAt: IMPORTED, sourceEventRowid: 42 };
    writeFileSync(join(dir, "fork-import.json"), JSON.stringify(state));
    const fork = new Database(join(dir, "fork-import.db"));
    fork.exec("CREATE TABLE cursors (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    fork.prepare("INSERT INTO cursors VALUES ('paused', 'false')").run();
    expect(readImportedAt(dir)).toBe(IMPORTED);
    fork.prepare("UPDATE cursors SET value = 'true' WHERE key = 'paused'").run();
    expect(readImportedAt(dir)).toBeNull();
    fork.prepare("DELETE FROM cursors").run();
    fork.close();
    writeFileSync(join(dir, "fork-import.json"), JSON.stringify({ ...state, cutoverAt: IMPORTED + HOUR }));
    expect(readImportedAt(dir)).toBeNull();
  });

  it("after the cutover, nothing in the table is in bb or read-only", () => {
    const table = automationTable(input(studioDb(), { importedAt: null }));
    expect(table.mirrored).toBe(false);
    expect(table.rows.every((row) => !row.inBb && !row.readOnly)).toBe(true);
  });
});

describe("when, in a few words", () => {
  it.each([
    [{ type: "times", days: [0, 1, 2, 3, 4, 5, 6], times: ["07:45"] }, "Daily 7:45 AM"],
    [{ type: "times", days: [1, 2, 3, 4, 5], times: ["09:00", "08:30"] }, "Weekdays 8:30 AM, 9:00 AM"],
    [{ type: "times", days: [0], times: ["09:00"] }, "Sun 9:00 AM"],
    [{ type: "interval", every: 2, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], from: "08:00", to: "23:00" }, "Every 2 h, 8:00 AM–11:00 PM"],
    [{ type: "interval", every: 1, unit: "hours", days: [0, 1, 2, 3, 4, 5, 6], quiet: { from: "03:00", to: "05:00" } }, "Hourly · quiet 3:00 AM–5:00 AM"],
    [{ type: "interval", every: 20, unit: "minutes", days: [0, 6] }, "Every 20 min · Weekends"],
    [{ type: "cron", cron: "15 10 * * 0" }, "Sun 10:15 AM"],
  ] as const)("%j is %s", (schedule, text) => {
    expect(whenText(schedule as never)).toBe(text);
  });

  it("dates a one-shot, with the year only when it isn't this year's", () => {
    const now = new Date(2026, 10, 11, 12).getTime();
    expect(whenText({ type: "once", at: new Date(2026, 10, 14, 9, 30).getTime() }, now)).toBe("Once, Nov 14, 9:30 AM");
    expect(whenText({ type: "once", at: new Date(2030, 0, 1, 4, 0).getTime() }, now)).toBe("Once, Jan 1 2030, 4:00 AM");
  });

  it.each([
    ["30 4 * * *", "Daily 4:30 AM"],
    ["0 4 * * *", "Daily 4:00 AM"],
    ["0 9 * * 1-5", "Weekdays 9:00 AM"],
    ["15 7,12,17,22 * * *", "Daily 7:15 AM, 12:15 PM, 5:15 PM, 10:15 PM"],
    ["0 8,10,12,14,16,18,20,22 * * *", "Every 2 h, 8:00 AM–10:00 PM"],
    ["0 0-2,5-23 * * *", "22× daily"],
    ["*/20 * * * *", "Every 20 min"],
    ["*/30 9-17 * * 1-5", "Every 30 min, 9:00 AM–5:30 PM · Weekdays"],
    ["0 * * * *", "Hourly"],
    ["15 */2 * * *", "Every 2 h at :15"],
    ["0 */6 * * *", "Every 6 h"],
    ["30 9,13,18 * * 1", "Mon 9:30 AM, 1:30 PM, 6:30 PM"],
    ["0 9 1 * *", "Custom: 0 9 1 * *"],
  ])("cron %s is %s", (cron, text) => {
    expect(cronText(cron)).toBe(text);
  });
});

import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migratedSqlDb } from "../test/migrated-db";
import { AutomationTasks, parentIdOf, readSources, type AutomationBotInfo } from "../tasks/automations";
import { TaskStore } from "../tasks/store";
import { Areas, fileStat, leadsFrom, ownNameWords, readText, runnersFrom, type AreaCaller, type AreaDeps, type AreaLead } from "./areas";
import { area as areaSchema, KEEP_AREA_RUNS } from "./contract";
import { addressesUser, areaFolder, coversFromAreaMd, deriveStatus, nameWords, readStatusFile, readStatusNotes, runOutcome, sinceAt, sortAreas } from "./derive";
import { registerAreas } from "./register";
import { AreaStore } from "./store";

const NOW = new Date("2026-11-15T13:00:00Z").getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const BOTS: AutomationBotInfo[] = [{ id: "bot_main", name: "Dot", threadId: "thr_main", heartbeatKey: "proj_personal" }];
let db: Database.Database;
let dir: string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = migratedSqlDb();
  dir = mkdtempSync(join(tmpdir(), "areas-"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

const at = (ms: number) => vi.setSystemTime(ms);

function runner(id: string, name: string, thread: string, job: string, extra: { state?: string; cron?: string; level?: string; report?: string; reportAt?: number } = {}) {
  db.prepare(`INSERT INTO bot_runners (id, bot_id, name, job, thread_id, project_id, state, cadence, time, cron, automation_id, last_level, last_report, last_report_at, created_at, updated_at)
    VALUES (?, 'bot_main', ?, ?, ?, 'proj_personal', ?, 'custom', '09:00', ?, ?, ?, ?, ?, ?, ?)`).run(id, name, job, thread, extra.state ?? "active", extra.cron ?? "0 7,12,17,22 * * *", `trg_runner_${id}`, extra.level ?? null, extra.report ?? null, extra.reportAt ?? null, NOW, NOW);
}

function checkin(id: string, name: string) {
  db.prepare(`INSERT INTO bot_automations (id, bot_id, kind, name, instruction, target, schedule_json, state, project_id, bb_ids, seen_until, created_at, updated_at)
    VALUES (?, 'bot_main', 'checkin', ?, 'Do it', 'main', ?, 'active', 'proj_personal', '[]', 0, ?, ?)`).run(id, name, JSON.stringify({ type: "times", days: [0], times: ["09:00"], timezone: "America/New_York" }), NOW, NOW);
}

function folder(name: string, files: { area?: string; status?: string; json?: unknown } = {}) {
  const path = join(dir, "staff", "areas", name);
  mkdirSync(path, { recursive: true });
  if (files.area !== undefined) writeFileSync(join(path, "AREA.md"), files.area);
  if (files.status !== undefined) writeFileSync(join(path, "STATUS.md"), files.status);
  if (files.json !== undefined) writeFileSync(join(path, "status.json"), typeof files.json === "string" ? files.json : JSON.stringify(files.json));
  return path;
}

const jobFor = (name: string) => `You are the ${name} area runner. Each run: read ${join(dir, "staff", "areas", "COMMON.md")} and staff/areas/${name}/AREA.md, then do the run.`;

function setup(callers: Record<string, AreaCaller> = {}, extra: Partial<AreaDeps> = {}) {
  const tasks = new TaskStore(db, () => {});
  const automation = new AutomationTasks(tasks, { sources: () => readSources(db, BOTS), zone: () => "America/New_York" });
  automation.sync({ backup: false });
  const changed = vi.fn();
  const areas = new Areas(new AreaStore(db, changed), tasks, {
    bot: () => ({ id: "bot_main", name: "Dot" }),
    runners: () => runnersFrom(db),
    caller: (threadId) => callers[threadId] ?? { kind: "thread" },
    zone: () => "America/New_York",
    ...extra,
  });
  const run = (runnerId: string, thread: string, work: () => void = () => {}, reply = "[PASS]") => {
    automation.sync({ backup: false });
    automation.started({ owner: "runner", ownerId: runnerId }, thread)?.sent();
    work();
    automation.settle(thread, reply, "succeeded");
    areas.sync();
  };
  const report = (runnerId: string, thread: string, level: "log" | "tell" | "urgent", summary: string) => {
    automation.report(runnerId, thread, level, summary);
    areas.reported(runnerId, level);
  };
  return { tasks, automation, areas, run, report, changed };
}

const status = (over: Partial<{ status: string; now: string; open: unknown[]; updatedAt: string }> = {}) => ({ status: "ok", now: "All quiet.", open: [], updatedAt: new Date(NOW).toISOString(), ...over });

describe("status.json", () => {
  it("accepts the schema and rejects what doesn't fit", () => {
    expect(readStatusFile(JSON.stringify(status({ open: [{ title: "Pest control visit", since: "2026-10-01", needsUser: true }] })))).toMatchObject({ ok: true, value: { status: "ok", open: [{ title: "Pest control visit", needsUser: true }] } });
    expect(readStatusFile(JSON.stringify(status({ open: [{ title: "No flag" }] })))).toMatchObject({ ok: true, value: { open: [{ needsUser: false }] } });
    expect(readStatusFile("{ nope")).toMatchObject({ ok: false, error: expect.stringContaining("Not valid JSON") });
    expect(readStatusFile(JSON.stringify(status({ status: "green" })))).toMatchObject({ ok: false, error: expect.stringContaining("status") });
    expect(readStatusFile(JSON.stringify(status({ updatedAt: "yesterday" })))).toMatchObject({ ok: false, error: expect.stringContaining("updatedAt") });
    expect(readStatusFile(JSON.stringify({ ...status(), extra: 1 }))).toMatchObject({ ok: false });
    expect(readStatusFile(JSON.stringify(status({ now: "" })))).toMatchObject({ ok: false, error: expect.stringContaining("now") });
    expect(readStatusFile(JSON.stringify(status({ open: [{ title: "x", taskId: "rm -rf" }] })))).toMatchObject({ ok: false });
  });

  it("reads a valid file after each run and on load, and falls back to the runner's report when it is missing or invalid", () => {
    const path = folder("house", { area: "# House\n\nOwns: the house itself: repairs, providers.\nBriefing keys: x\n" });
    runner("run_house", "House", "thr_house", jobFor("house"));
    const { areas, run, report } = setup();
    areas.sync();
    expect(areas.get("House")).toMatchObject({ covers: "the house itself: repairs, providers", statusFile: join(path, "status.json"), fileError: "status.json not found", status: "unknown" });

    at(NOW + HOUR);
    run("run_house", "thr_house", () => report("run_house", "thr_house", "tell", "DECISION: renew the pest plan?"));
    expect(areas.get("House")).toMatchObject({ status: "flagged", runs: [{ outcome: "flagged", line: "DECISION: renew the pest plan?" }] });

    at(NOW + 2 * HOUR);
    run("run_house", "thr_house", () => writeFileSync(join(path, "status.json"), JSON.stringify(status({ status: "broken", now: "Can't read the reminders list.", open: [{ title: "Defrost the freezer", since: "2026-09-26", needsUser: true }], updatedAt: new Date(NOW + 2 * HOUR).toISOString() }))));
    expect(areas.get("House")).toMatchObject({ status: "broken", now: "Can't read the reminders list.", fileError: null, open: [{ title: "Defrost the freezer", since: "2026-09-26", sinceAt: Date.UTC(2026, 8, 26), needsUser: true, taskId: null }] });
    expect(areas.get("House").runs.map((r) => r.outcome)).toEqual(["broken", "flagged"]);

    at(NOW + 3 * HOUR);
    run("run_house", "thr_house", () => { writeFileSync(join(path, "status.json"), "{ half written"); utimesSync(join(path, "status.json"), new Date(NOW + 3 * HOUR), new Date(NOW + 3 * HOUR)); report("run_house", "thr_house", "log", "Checked; nothing due."); });
    const view = areas.get("House");
    expect(view.fileError).toMatch(/Not valid JSON/);
    expect(view.now).toBe("Can't read the reminders list.");
    expect(view.runs[0]).toMatchObject({ outcome: "ok", line: "Checked; nothing due." });
    expect(view.status).toBe("ok");
  });

  it("uses a file only for the run that wrote it", () => {
    const path = folder("comms", { json: status({ status: "flagged", now: "Old news.", updatedAt: new Date(NOW - 5 * HOUR).toISOString() }) });
    runner("run_comms", "Comms", "thr_comms", jobFor("comms"));
    const { areas, run } = setup();
    at(NOW + HOUR);
    run("run_comms", "thr_comms");
    const view = areas.get("Comms");
    expect(view.runs[0]).toMatchObject({ outcome: "ok", line: "Nothing new" });
    expect(view.status).toBe("ok");
    expect(view.now).toBe("Old news.");
    expect(path).toContain("comms");
  });
});

describe("runs", () => {
  it("keeps the last 30 runs, newest first, each linked to its run task", () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.");
    const { areas, run, tasks } = setup();
    for (let i = 1; i <= KEEP_AREA_RUNS + 5; i++) { at(NOW + i * HOUR); run("run_sys", "thr_sys"); }
    const view = areas.get("Systems");
    expect(view.runs).toHaveLength(KEEP_AREA_RUNS);
    expect(view.runs[0]!.at).toBe(NOW + (KEEP_AREA_RUNS + 5) * HOUR);
    expect(view.runs.every((r, i) => i === 0 || r.at < view.runs[i - 1]!.at)).toBe(true);
    expect(tasks.find(view.runs[0]!.taskId!)?.parentId).toBe(parentIdOf("run_sys"));
    expect(view.lastRun).toBe(view.runs[0]!.at);
    areas.sync();
    expect(areas.get("Systems").runs).toHaveLength(KEEP_AREA_RUNS);
  });

  it("maps reports and failures to outcomes, and lists the run handed to the user as an open item", () => {
    runner("run_sec", "Security", "thr_sec", "Watch the network.");
    const { areas, run, report, automation } = setup();
    at(NOW + HOUR);
    run("run_sec", "thr_sec", () => report("run_sec", "thr_sec", "log", "All clear."));
    at(NOW + 2 * HOUR);
    run("run_sec", "thr_sec", () => report("run_sec", "thr_sec", "tell", "RUNNER PROBLEM: scanner missing."));
    at(NOW + 3 * HOUR);
    automation.started({ owner: "runner", ownerId: "run_sec" }, "thr_sec")?.sent();
    automation.settle("thr_sec", "boom", "failed");
    areas.sync();
    at(NOW + 4 * HOUR);
    run("run_sec", "thr_sec", () => report("run_sec", "thr_sec", "urgent", "URGENT: unknown SSH key on the server."));
    const view = areas.get("Security");
    expect(view.runs.map((r) => r.outcome)).toEqual(["broken", "broken", "broken", "ok"]);
    expect(view.runs[1]!.line).toBe("Failed: boom");
    expect(view.status).toBe("broken");
    expect(view.open).toEqual([expect.objectContaining({ title: "URGENT: unknown SSH key on the server.", needsUser: true, taskId: view.runs[0]!.taskId })]);
  });

  it("runOutcome covers each case", () => {
    const base = { state: "done", byUser: false, runner: true, line: "Nothing new", level: null, file: null } as const;
    expect(runOutcome(base)).toBe("ok");
    expect(runOutcome({ ...base, file: "flagged" })).toBe("flagged");
    expect(runOutcome({ ...base, level: "urgent", file: "ok" })).toBe("broken");
    expect(runOutcome({ ...base, level: "tell", file: "ok" })).toBe("ok");
    expect(runOutcome({ ...base, level: "tell" })).toBe("flagged");
    expect(runOutcome({ ...base, state: "failed" })).toBe("broken");
    expect(runOutcome({ ...base, byUser: true, runner: false })).toBe("flagged");
    expect(runOutcome({ ...base, line: "No report" })).toBe("flagged");
    expect(runOutcome({ ...base, line: "DECISION: pick one" })).toBe("flagged");
  });
});

describe("status", () => {
  const run = (at: number, outcome: "ok" | "flagged" | "broken") => ({ at, outcome, line: outcome, taskId: null });
  it("derives red, orange, green and unknown", () => {
    expect(deriveStatus({ stated: null, runs: [] })).toEqual({ status: "unknown", reason: null });
    expect(deriveStatus({ stated: null, runs: [run(NOW, "ok")] }).status).toBe("ok");
    expect(deriveStatus({ stated: { status: "flagged", at: NOW - MIN, from: "file" }, runs: [run(NOW, "ok")] }).status).toBe("flagged");
    expect(deriveStatus({ stated: { status: "flagged", at: NOW - 2 * HOUR, from: "file" }, runs: [run(NOW, "ok")] }).status).toBe("ok");
    expect(deriveStatus({ stated: { status: "ok", at: NOW, from: "file" }, runs: [run(NOW, "broken")] })).toEqual({ status: "broken", reason: "Last run: broken" });
    expect(deriveStatus({ stated: { status: "flagged", at: NOW, from: "agent" }, runs: [] }).status).toBe("flagged");
    expect(deriveStatus({ stated: null, runs: [run(NOW, "ok")] }, "No run since Nov 14")).toEqual({ status: "flagged", reason: "No run since Nov 14" });
    expect(deriveStatus({ stated: null, runs: [run(NOW, "broken")] }, "No run since Nov 14").status).toBe("broken");
  });

  it("sorts problems first", () => {
    const list = sortAreas([{ name: "B", status: "ok" as const }, { name: "A", status: "unknown" as const }, { name: "C", status: "flagged" as const }, { name: "D", status: "broken" as const }, { name: "E", status: "flagged" as const }]);
    expect(list.map((a) => a.name)).toEqual(["D", "C", "E", "B", "A"]);
  });

  it("flags an area whose runner missed its runs, and gives the next run", () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.", { cron: "0 7 * * *" });
    const { areas, run } = setup();
    at(Date.parse("2026-11-15T12:05:00Z"));
    run("run_sys", "thr_sys");
    expect(areas.get("Systems")).toMatchObject({ status: "ok", nextRun: Date.parse("2026-11-16T12:00:00Z"), nextLabel: null });
    at(Date.parse("2026-11-16T15:00:00Z"));
    expect(areas.get("Systems")).toMatchObject({ status: "flagged", reason: expect.stringMatching(/^No run since Nov 15/) });
  });
});

describe("runner changes", () => {
  it("takes a deleted runner's area off the list and doesn't remake an archived one", () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.");
    runner("run_old", "Old", "thr_old", "Old job.");
    const { areas } = setup({ thr_main: { kind: "bot", botId: "bot_main", main: true } });
    areas.sync();
    areas.update({ area: "Systems", archive: true }, "thr_main");
    db.prepare("DELETE FROM bot_runners WHERE id = 'run_old'").run();
    areas.sync();
    areas.sync();
    expect(areas.list()).toEqual([]);
    expect(areas.store.all().map((a) => [a.name, a.archived]).sort()).toEqual([["Old", true], ["Systems", true]]);
  });
});

describe("area_update", () => {
  it("lets a lead make and keep its own area, adds a run per status, and refuses other areas", () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.");
    const { areas } = setup({ thr_sys: { kind: "runner", runnerId: "run_sys" }, thr_main: { kind: "bot", botId: "bot_main", main: true } }, { leads: () => [{ thread: "thr_lead", name: "Studio" }] });
    new Areas(areas.store, areas.tasks, { ...areas.deps, leads: () => [] }).sync();
    expect(() => areas.update({ status: "ok" }, "thr_lead")).toThrow(/give it a name/);
    const made = areas.update({ name: "Studio", covers: "The app", status: "ok", now: "Shipped a build.", open: [{ title: "Your OK on the release", needsUser: true, since: "2026-11-14" }] }, "thr_lead").area;
    expect(made).toMatchObject({ name: "Studio", owner: { kind: "lead", thread: "thr_lead" }, ownerName: "Studio lead", status: "ok", now: "Shipped a build.", runs: [{ outcome: "ok", line: "Shipped a build." }], open: [{ needsUser: true, sinceAt: Date.UTC(2026, 10, 14) }] });
    at(NOW + HOUR);
    expect(areas.update({ status: "flagged", now: "Over budget." }, "thr_lead").area).toMatchObject({ status: "flagged", runs: [{ outcome: "flagged" }, { outcome: "ok" }] });
    expect(() => areas.update({ area: "Systems", now: "Mine now" }, "thr_lead")).toThrow(/looked after by Systems runner/);
    expect(() => areas.update({ area: "Studio", now: "x" }, "thr_sys")).toThrow(/looked after by Studio lead/);
    expect(areas.update({ now: "Disk fine.", status: "ok" }, "thr_sys").area).toMatchObject({ name: "Systems", now: "Disk fine.", runs: [] });
    expect(areas.update({ area: "Studio", now: "Checked by the Bot." }, "thr_main").area.now).toBe("Checked by the Bot.");
    expect(() => areas.update({ name: "Studio" }, "thr_other")).toThrow(/exists/);
    expect(areas.update({ archive: true }, "thr_lead").note).toMatch(/Archived/);
    expect(areas.list().map((a) => a.name)).toEqual(["Systems"]);
  });

  it("lets the Bot make its own area linked to a check-in, whose runs it then shows", () => {
    checkin("aut_intros", "Weekly intros");
    const { areas, automation } = setup({ thr_main: { kind: "bot", botId: "bot_main", main: true } });
    expect(() => areas.update({ name: "Job hunt", links: ["aut_missing"] }, "thr_main")).toThrow(/No schedule aut_missing/);
    const made = areas.update({ name: "Job hunt", covers: "Interviews and intros", links: ["aut_intros"] }, "thr_main").area;
    expect(made).toMatchObject({ owner: { kind: "bot", botId: "bot_main" }, ownerName: "Dot", links: [parentIdOf("aut_intros")], cadence: expect.stringContaining("9:00"), nextLabel: "Weekly intros" });
    at(NOW + HOUR);
    automation.started({ owner: "automation", ownerId: "aut_intros" }, "thr_main")?.sent();
    automation.settle("thr_main", "Sent one intro.", "succeeded");
    areas.sync();
    expect(areas.get("Job hunt").runs).toEqual([expect.objectContaining({ outcome: "ok", line: "Sent one intro." })]);
  });
});

describe("seed", () => {
  const AREA = "# Comms\n\nOwns: the inbound flow: email triage, the briefing inbox, DMs, GitHub contacts,\nthe overnight roundup and tech news.\nBriefing keys: attention.\n";
  const NOTES = "Last run: Sun Nov 15 17:05 ET (LIGHT). Inbox: none. GitHub: nothing new.\n\n## Open items (item | since | state | next)\n- Two PRs closed by the stale bot | Oct 30-31 | Told the owner | your call: reopen or ping\n- Plugin releases pending | Oct 5 | audit found 4 untagged | none\n\n## Watching\n- nothing\n";
  const SECURITY = "Last run: 2026-11-15 21:30 ET (FULL)\n\n## Open items\nitem | since | state | next\nOld image on the proxy | 10-25 | noted | recheck\nPending OS update | 10-21 | with you | recheck Sunday\n\n## Notes\n- x\n";

  it("parses AREA.md and STATUS.md", () => {
    expect(coversFromAreaMd(AREA)).toBe("the inbound flow: email triage, the briefing inbox, DMs, GitHub contacts, the overnight roundup and tech news");
    expect(coversFromAreaMd("# None\n")).toBeNull();
    const notes = readStatusNotes(NOTES, NOW);
    expect(notes).toMatchObject({ now: "Sun Nov 15 17:05 ET (LIGHT). Inbox: none. GitHub: nothing new.", status: "ok", problems: [] });
    expect(notes.open).toEqual([
      { title: "Two PRs closed by the stale bot", since: "Oct 30-31", sinceAt: Date.UTC(2026, 9, 30), needsUser: true, taskId: null },
      { title: "Plugin releases pending", since: "Oct 5", sinceAt: Date.UTC(2026, 9, 5), needsUser: false, taskId: null },
    ]);
    const table = readStatusNotes(SECURITY, NOW);
    expect(table.open.map((o) => [o.title, o.sinceAt, o.needsUser])).toEqual([["Old image on the proxy", Date.UTC(2026, 9, 25), false], ["Pending OS update", Date.UTC(2026, 9, 21), true]]);
    expect(table.status).toBeNull();
    expect(readStatusNotes("Last run: today (reminders: no access)\n", NOW)).toMatchObject({ status: "flagged", problems: ["no Open items section"] });
    expect(sinceAt("2026-12-01", NOW)).toBe(Date.UTC(2026, 11, 1));
    expect(sinceAt("Dec 20", NOW)).toBe(Date.UTC(2025, 11, 20));
    expect(sinceAt("-", NOW)).toBeNull();
    expect(areaFolder(jobFor("comms"))).toEqual({ dir: join(dir, "staff", "areas", "comms"), name: "comms" });
    expect(areaFolder("Do the sweep.")).toBeNull();
  });

  it("builds areas from runners, their folders, leads and extras once, and reports what didn't parse", () => {
    folder("comms", { area: AREA, status: NOTES });
    folder("security", { area: "# Security\nNo owner line\n", status: SECURITY });
    runner("run_comms", "Comms", "thr_comms", jobFor("comms"), { level: "tell", report: "New PR on a plugin repo.", reportAt: NOW - HOUR });
    runner("run_sec", "Security", "thr_sec", jobFor("security"));
    runner("run_staff", "Staff", "thr_staff", "The staff sweep. Read the runner notes.");
    runner("run_sync", "Studio fork sync", "thr_sync", "Daily upstream sync.");
    runner("run_game", "Side game", "thr_game", "Build the game.", { state: "paused" });
    checkin("aut_intros", "Weekly intros");
    db.prepare("INSERT INTO project_leads (project_id, lead_thread_id, created_at, updated_at) VALUES ('proj_personal', 'thr_main', 1, 1), ('proj_studio', 'thr_lead', 2, 2), ('proj_gone', 'thr_gone', 3, 3)").run();
    const leads = leadsFrom(db, new Map([["proj_studio", "Studio"], ["proj_personal", "Personal"]]), "proj_personal");
    expect(leads).toEqual([{ thread: "thr_lead", name: "Studio" }]);
    const tasks = new TaskStore(db, () => {});
    new AutomationTasks(tasks, { sources: () => readSources(db, BOTS) }).sync({ backup: false });
    const areas = new Areas(new AreaStore(db), tasks, { bot: () => ({ id: "bot_main", name: "Dot" }), runners: () => runnersFrom(db), leads: () => leads, zone: () => "America/New_York" });
    const report = areas.seed([{ name: "Job hunt", owner: "cos", covers: "Interviews", links: ["aut_intros", "aut_nope"] }]);
    expect(report.seeded).toBe(true);
    expect(report.created.sort()).toEqual(["Comms", "Job hunt", "Security", "Staff", "Studio"]);
    expect(report.problems).toEqual(expect.arrayContaining(["Job hunt: no schedule aut_nope", "Security: AREA.md has no Owns: line", "Staff: no area folder in its job; runner_report only"]));
    const byName = Object.fromEntries(areas.list().map((a) => [a.name, a]));
    expect(byName.Comms).toMatchObject({ status: "ok", ownerName: "Comms runner", now: expect.stringContaining("Inbox: none"), open: [expect.objectContaining({ needsUser: true }), expect.objectContaining({ needsUser: false })], runs: [{ outcome: "flagged", line: "New PR on a plugin repo." }] });
    expect(byName.Security).toMatchObject({ status: "unknown", covers: "You are the security area runner", open: [expect.anything(), expect.anything()] });
    expect(byName.Studio).toMatchObject({ owner: { kind: "lead", thread: "thr_lead" }, links: [parentIdOf("run_sync")], nextLabel: "Studio fork sync" });
    expect(byName["Job hunt"]).toMatchObject({ owner: { kind: "bot" }, links: [parentIdOf("aut_intros")] });
    expect(byName["Side game"]).toBeUndefined();
    expect(areas.seed()).toMatchObject({ seeded: false, created: [] });
    for (const row of db.prepare("SELECT record FROM areas").all() as { record: string }[]) expect(() => areaSchema.parse(JSON.parse(row.record))).not.toThrow();
    const again = areas.sync();
    expect(again).toMatchObject({ created: [], changed: 0 });
  });
});

describe("rpc and tools", () => {
  it("registers the agent tools and no RPCs (the Areas grid that read them is gone)", async () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.");
    const { areas } = setup({ thr_sys: { kind: "runner", runnerId: "run_sys" } });
    areas.sync();
    const handlers: Record<string, (input: any) => Promise<any>> = {};
    const tools: Record<string, { execute(input: unknown, ctx: unknown): Promise<string> }> = {};
    registerAreas({ rpc: { register: (_c: unknown, map: typeof handlers) => Object.assign(handlers, map) }, agents: { registerTool: (tool: { name: string; execute(input: unknown, ctx: unknown): Promise<string> }) => { tools[tool.name] = tool; } } } as never, areas);
    expect(Object.keys(handlers)).toEqual([]);
    expect(JSON.parse(await tools.area_update!.execute({ status: "flagged", now: "Backup stuck." }, { threadId: "thr_sys" })).area).toMatchObject({ status: "flagged", now: "Backup stuck." });
    expect(await tools.area_get!.execute({ id: "nope" }, {})).toMatch(/^Error: No area/);
    expect(Object.keys(tools).sort()).toEqual(["area_get", "area_list", "area_update"]);
  });
});

describe("review fixes", () => {
  it("stats status.json first: an unchanged file isn't read again, and a large one is refused before reading", () => {
    const path = folder("systems");
    runner("run_sys", "Systems", "thr_sys", jobFor("systems"));
    const reads: string[] = [];
    const { areas } = setup({}, { readText: (file) => { reads.push(file); return readText(file); }, fileStat });
    const file = join(path, "status.json");
    writeFileSync(file, JSON.stringify(status()));
    areas.sync();
    areas.sync();
    areas.sync();
    expect(reads.filter((r) => r === file)).toHaveLength(1);
    expect(areas.get("Systems")).toMatchObject({ now: "All quiet.", fileError: null });
    writeFileSync(file, `{"status":"ok","now":"${"x".repeat(70 * 1024)}","open":[],"updatedAt":"2026-11-15T13:00:00Z"}`);
    utimesSync(file, new Date(NOW + MIN), new Date(NOW + MIN));
    areas.sync();
    expect(reads.filter((r) => r === file)).toHaveLength(1);
    expect(areas.get("Systems")).toMatchObject({ now: "All quiet.", fileError: "Larger than 64 KB" });
  });

  it("clamps a status.json updatedAt in the future to the file's time", () => {
    const path = folder("comms");
    runner("run_comms", "Comms", "thr_comms", jobFor("comms"));
    const { areas } = setup({ thr_main: { kind: "bot", botId: "bot_main", main: true } });
    writeFileSync(join(path, "status.json"), JSON.stringify(status({ status: "flagged", updatedAt: new Date(NOW + 24 * HOUR).toISOString() })));
    utimesSync(join(path, "status.json"), new Date(NOW), new Date(NOW));
    areas.sync();
    expect(areas.store.find("area_run_comms")!.stated).toEqual({ status: "flagged", at: NOW + 5 * MIN, from: "file" });
    at(NOW + HOUR);
    expect(areas.update({ area: "Comms", status: "ok", now: "Fixed." }, "thr_main").area).toMatchObject({ status: "ok", now: "Fixed." });
    areas.sync();
    expect(areas.get("Comms")).toMatchObject({ status: "ok", now: "Fixed." });
  });

  it("adds a lead's area on any later sync, not only the first, and never remakes one that was archived or renamed", () => {
    runner("run_sys", "Systems", "thr_sys", "Watch the server.");
    let leads: AreaLead[] = [];
    const { areas } = setup({ thr_main: { kind: "bot", botId: "bot_main", main: true } }, { leads: () => leads });
    areas.sync();
    expect(areas.list().map((a) => a.name)).toEqual(["Systems"]);
    leads = [{ thread: "thr_lead", name: "Studio" }, { thread: "thr_two", name: "Site" }];
    expect(areas.sync().created).toEqual(["Studio", "Site"]);
    areas.update({ area: "Studio", archive: true }, "thr_main");
    areas.update({ area: "Site", name: "Website" }, "thr_main");
    expect(areas.sync().created).toEqual([]);
    expect(areas.list().map((a) => a.name).sort()).toEqual(["Systems", "Website"]);
  });

  it("picks up an area folder a runner's job names later", () => {
    runner("run_home", "Home", "thr_home", "Look after the home.");
    const { areas } = setup();
    areas.sync();
    expect(areas.get("Home").statusFile).toBeNull();
    const path = folder("home", { area: "# Home\n\nOwns: calendar and school.\n", json: status({ now: "School is closed Friday." }) });
    db.prepare("UPDATE bot_runners SET job = ? WHERE id = 'run_home'").run(jobFor("home"));
    areas.sync();
    expect(areas.get("Home")).toMatchObject({ statusFile: join(path, "status.json"), covers: "calendar and school", now: "School is closed Friday.", fileError: null });
  });

  it("lets only the Bot or a registered lead make an area", () => {
    const { areas } = setup({ thr_main: { kind: "bot", botId: "bot_main", main: true }, thr_conv: { kind: "bot", botId: "bot_main", main: false } }, { leads: () => [{ thread: "thr_lead", name: "Studio" }] });
    expect(() => areas.update({ name: "Junk" }, "thr_worker")).toThrow(/Only the Bot or a project's lead/);
    expect(() => areas.update({ area: "Unknown" }, "thr_worker")).toThrow(/Only the Bot or a project's lead/);
    expect(areas.update({ name: "Studio" }, "thr_lead").area.owner).toEqual({ kind: "lead", thread: "thr_lead" });
    expect(areas.update({ name: "Side project" }, "thr_conv").area.owner).toEqual({ kind: "lead", thread: "thr_conv" });
    expect(areas.update({ name: "Job hunt" }, "thr_main").area.owner).toEqual({ kind: "bot", botId: "bot_main" });
    expect(() => areas.update({ area: "Studio", now: "x" }, "thr_worker")).toThrow(/looked after by Studio lead/);
  });
});

describe("the user's name in STATUS.md", () => {
  it("counts a name only where the user is addressed, with Unicode word edges", () => {
    const zoe = nameWords("zoe", "Zoë Ångström");
    expect(addressesUser("Waiting on Zoë", zoe)).toBe(true);
    expect(addressesUser("Zoë signs it", zoe)).toBe(true);
    expect(addressesUser("Zoë's call", zoe)).toBe(true);
    expect(addressesUser("Asked Zoë; no answer", zoe)).toBe(true);
    expect(addressesUser("Ask Zoë", zoe)).toBe(true);
    expect(addressesUser("Zoëlle signs it", zoe)).toBe(false);
    expect(addressesUser("cleared by Zoë", zoe)).toBe(false);
    expect(addressesUser("Skipped (Zoë, Nov 1: done herself)", zoe)).toBe(false);
    expect(addressesUser("Recheck; Zoë to decide", zoe)).toBe(true);
    const will = nameWords("will", "Will Park");
    expect(addressesUser("Will check on the next run", will)).toBe(true);
    expect(addressesUser("Recheck; will check next run", will)).toBe(false);
    expect(addressesUser("The runner will ask later", will)).toBe(false);
    expect(addressesUser("Remind Will before winter", will)).toBe(true);
    expect(addressesUser("Ask me again tomorrow", will)).toBe(false);
    expect(addressesUser("Your call", will)).toBe(true);
    expect(addressesUser("yourself", will)).toBe(false);
    expect(addressesUser("Up to the user", [])).toBe(false);
  });

  const NOTES = (stamp: string) => `Last run: ${stamp}\n\n## Open items (item | since | state | next)\n- Renew the permit | Oct 2 | Waiting on Alex | Alex signs it\n- Gutter cleaning | Oct 9 | Booked | none\n`;

  it("takes the words from the account's full name and login, with you and me as the fallback", () => {
    expect(nameWords("alexq", "Alex Quinn")).toEqual(["you", "your", "user", "Alex", "alexq"]);
    expect(nameWords("root", "")).toEqual(["you", "your", "user"]);
    expect(nameWords(null, null)).toEqual(["you", "your", "user"]);
    expect(nameWords("a1", "System Administrator")).toEqual(["you", "your", "user", "System"]);
    expect(nameWords("zoe", "Zoë Ångström")).toEqual(["you", "your", "user", "Zoë", "zoe"]);
    expect(ownNameWords()).toEqual(expect.arrayContaining(["you", "your"]));
    expect(ownNameWords()).not.toContain("me");
    expect(readStatusNotes(NOTES("today"), NOW, nameWords("alexq", "Alex Quinn")).open.map((o) => o.needsUser)).toEqual([true, false]);
    expect(readStatusNotes(NOTES("today"), NOW).open.map((o) => o.needsUser)).toEqual([false, false]);
  });

  it("rereads STATUS.md with the words until the runner writes status.json", () => {
    const path = folder("house", { area: "# House\n\nOwns: the house.\n", status: NOTES("Sun 07:10, nothing new") });
    runner("run_house", "House", "thr_house", jobFor("house"));
    let words: string[] = [];
    const { areas } = setup({}, { userWords: () => words });
    areas.sync();
    expect(areas.get("House").open.filter((o) => o.needsUser)).toHaveLength(0);
    words = nameWords("alexq", "Alex Quinn");
    areas.sync();
    expect(areas.get("House").open.filter((o) => o.needsUser)).toHaveLength(0);
    writeFileSync(join(path, "STATUS.md"), NOTES("Mon 07:10, nothing new"));
    utimesSync(join(path, "STATUS.md"), new Date(NOW + MIN), new Date(NOW + MIN));
    areas.sync();
    expect(areas.get("House")).toMatchObject({ now: "Mon 07:10, nothing new", open: [expect.objectContaining({ title: "Renew the permit", needsUser: true }), expect.objectContaining({ needsUser: false })] });
    writeFileSync(join(path, "status.json"), JSON.stringify(status({ now: "From the file.", open: [] })));
    areas.sync();
    writeFileSync(join(path, "STATUS.md"), NOTES("Tue 07:10, nothing new"));
    utimesSync(join(path, "STATUS.md"), new Date(NOW + 2 * MIN), new Date(NOW + 2 * MIN));
    areas.sync();
    expect(areas.get("House")).toMatchObject({ now: "From the file.", open: [] });
  });
});

describe("an area's item that needs the user", () => {
  it("makes no task: there is no areas.itemTask, and the item stays on the card (the strand that holds the report shows it as needs you)", async () => {
    const { rpcContract } = await import("../public-contract");
    expect(Object.keys(rpcContract)).not.toContain("areas.itemTask");
    expect("itemTask" in Areas.prototype).toBe(false);
  });
});

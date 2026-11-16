import Database from "better-sqlite3";
import { readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS } from "../src/migrations";
import { Areas, leadsFrom, runnersFrom, type AreaExtra } from "../src/areas/areas";
import { AreaStore } from "../src/areas/store";
import { AutomationTasks, readSources, type AutomationBotInfo } from "../src/tasks/automations";
import { TaskStore } from "../src/tasks/store";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null; };
const [source, staffFrom, staffTo] = [args[0], flag("--staff-from"), flag("--staff-to")];
if (!source || !staffFrom || !staffTo) {
  console.error("Usage: tsx scripts/areas-dry-run.mts <Studio data.db> --staff-from <live staff dir> --staff-to <copy of it> [--projects projects.json] [--extra extra.json] [--leads-alive id,id] [--user-words a,b] [--zone Area/City] [--json out.json]");
  process.exit(1);
}
const mtime = statSync(source).mtimeMs;
const dir = mkdtempSync(join(tmpdir(), "areas-dry-run-"));
const copyPath = join(dir, "data.db");
const live = new Database(source, { readonly: true, fileMustExist: true });
await live.backup(copyPath);
live.close();
const copy = new Database(copyPath);
if (!copy.prepare("SELECT 1 FROM sqlite_master WHERE name = 'areas'").get()) copy.exec(MIGRATIONS.find((sql) => sql.includes("CREATE TABLE areas"))!);
copy.prepare("UPDATE bot_runners SET job = replace(job, ?, ?)").run(staffFrom, staffTo);
const json = <T,>(path: string | null, fallback: T): T => (path ? JSON.parse(readFileSync(path, "utf8")) as T : fallback);
const projects = new Map(json<{ id: string; name: string }[]>(flag("--projects"), []).map((p) => [p.id, p.name]));
const alive = new Set((flag("--leads-alive") ?? "").split(",").filter(Boolean));
const extra = json<AreaExtra[]>(flag("--extra"), []);
const zone = flag("--zone") ?? "America/New_York";
const botRows = copy.prepare("SELECT id, name, thread_id FROM bots ORDER BY (id = 'bot_main') DESC, created_at, id").all() as { id: string; name: string; thread_id: string | null }[];
const bots = botRows.map((bot, i): AutomationBotInfo => ({ id: bot.id, name: bot.name, threadId: bot.thread_id, heartbeatKey: i === 0 ? "proj_personal" : `bot:${bot.id}` }));
const tasks = new TaskStore(copy, () => {});
new AutomationTasks(tasks, { sources: () => readSources(copy, bots), zone: () => zone }).sync({ backup: false });
const leads = leadsFrom(copy, projects, "proj_personal");
const areas = new Areas(new AreaStore(copy), tasks, {
  bot: () => (botRows[0] ? { id: botRows[0].id, name: botRows[0].name } : null),
  runners: () => runnersFrom(copy),
  leads: () => leads.filter((lead) => !alive.size || alive.has(lead.thread)),
  zone: () => zone,
  userWords: () => (flag("--user-words") ?? "user,you,your").split(","),
});
const seeded = areas.seed(extra);
const second = areas.sync();
const list = areas.list();
const when = (at: number | null) => (at === null ? "-" : new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone }));
const out = {
  seeded: seeded.seeded, created: seeded.created, problems: seeded.problems,
  secondSync: second, leadsFound: leads, liveUnchanged: statSync(source).mtimeMs === mtime,
  areas: list,
};
if (flag("--json")) (await import("node:fs")).writeFileSync(flag("--json")!, JSON.stringify(out, null, 2));
console.log(`| Area | Status | Owner · cadence | Covers | Now | Open (you) | Runs (newest first) | Last | Next | status.json |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|`);
const cell = (text: string | null) => (text ?? "-").replace(/\|/g, "/").replace(/\s+/g, " ");
for (const a of list) {
  const runs = a.runs.slice(0, 7).map((r) => ({ ok: "g", flagged: "o", broken: "R" })[r.outcome]).join("");
  console.log(`| ${cell(a.name)} | ${a.status}${a.reason ? ` (${cell(a.reason)})` : ""} | ${cell(a.ownerName)} · ${cell(a.cadence)} | ${cell(a.covers.slice(0, 80))} | ${cell((a.now ?? "").slice(0, 90))} | ${a.open.length} (${a.open.filter((o) => o.needsUser).length}) | ${runs || "-"} (${a.runs.length}) | ${when(a.lastRun)} | ${when(a.nextRun)}${a.nextLabel ? ` (${cell(a.nextLabel)})` : ""} | ${cell(a.fileError ?? (a.statusFile ? "ok" : "none"))} |`);
}
console.log(`\nCreated: ${seeded.created.join(", ")}\nProblems:\n${seeded.problems.map((p) => `- ${p}`).join("\n")}\nSecond sync: ${JSON.stringify(second)}\nLive db unchanged: ${out.liveUnchanged}\nCopy: ${copyPath}`);
copy.close();

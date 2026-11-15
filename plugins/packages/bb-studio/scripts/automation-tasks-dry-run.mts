import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutomationTasks, parentIdOf, readSources, type AutomationBotInfo } from "../src/tasks/automations";
import { TaskStore } from "../src/tasks/store";
import { inLoopView, toLoop } from "../src/tasks/views";

const source = process.argv[2];
const keep = process.argv.includes("--keep");
if (!source) {
  console.error("Usage: tsx scripts/automation-tasks-dry-run.mts <path to Studio data.db> [--keep]");
  process.exit(1);
}
const mtime = statSync(source).mtimeMs;
const dir = mkdtempSync(join(tmpdir(), "automation-tasks-dry-run-"));
const copyPath = join(dir, "data.db");
const live = new Database(source, { readonly: true, fileMustExist: true });
await live.backup(copyPath);
live.close();

const copy = new Database(copyPath);
const tally = (values: readonly string[]) => values.reduce<Record<string, number>>((out, v) => ({ ...out, [v]: (out[v] ?? 0) + 1 }), {});
const bots = (copy.prepare("SELECT id, name, thread_id FROM bots ORDER BY created_at, id").all() as { id: string; name: string; thread_id: string | null }[])
  .map((bot, i): AutomationBotInfo => ({ id: bot.id, name: bot.name, threadId: bot.thread_id, heartbeatKey: i === 0 ? "proj_personal" : `bot:${bot.id}` }));
const store = new TaskStore(copy, () => {});
const phone = () => JSON.stringify(store.all().filter(inLoopView).map(toLoop));
const before = {
  automations: tally((copy.prepare("SELECT kind, state FROM bot_automations WHERE cleanup_pending = 0").all() as { kind: string; state: string }[]).map((r) => `${r.kind}:${r.state}`)),
  runners: tally((copy.prepare("SELECT state FROM bot_runners WHERE cleanup_pending = 0").all() as { state: string }[]).map((r) => r.state)),
  heartbeats: (copy.prepare("SELECT COUNT(*) AS n FROM project_runs").get() as { n: number }).n,
  tasks: store.all().length,
  events: (copy.prepare("SELECT COUNT(*) AS n FROM task_events").get() as { n: number }).n,
};
const phoneBefore = phone();
const tasks = new AutomationTasks(store, { sources: () => readSources(copy, bots) });
const sources = readSources(copy, bots);
const first = tasks.sync({ backup: true });
const parents = store.rows("SELECT record FROM tasks WHERE parent_id IS NULL AND json_extract(record, '$.automation.role') = 'schedule'");
const after = {
  parents: parents.length,
  byKind: tally(parents.map((t) => t.automation!.kind)),
  byState: tally(parents.map((t) => `${t.state}${t.schedule?.paused ? " (paused)" : ""}`)),
  watcherModes: Object.fromEntries(parents.filter((t) => t.automation!.kind === "watcher").map((t) => [t.title, t.automation!.mode])),
  rows: parents.map((t) => ({ title: t.title, kind: t.automation!.kind, owner: t.owner.startsWith("thread:") ? "thread" : t.owner, state: t.state, schedule: t.schedule?.text })),
  tasks: store.all().length,
  events: (copy.prepare("SELECT COUNT(*) AS n FROM task_events").get() as { n: number }).n,
};
const problems: string[] = [];
for (const src of sources) if (src.state !== "over" && !store.find(parentIdOf(src.id))) problems.push(`${src.id} has no task`);
if (phone() !== phoneBefore) problems.push("the phone's todo list changed");
const snapshot = JSON.stringify(store.all());
const second = tasks.sync({ backup: true });
if (JSON.stringify(store.all()) !== snapshot) problems.push("the second run changed tasks");

const silent = copy.prepare("SELECT id, last_fire FROM bot_automations WHERE kind = 'watcher' AND last_fire LIKE '%spend%' LIMIT 1").get() as { id: string; last_fire: string } | undefined;
let replay: unknown = null;
if (silent) {
  const at = Date.now();
  const bumped = silent.last_fire.replace(/\$(\d+)\.(\d+)/, (_, a: string, b: string) => `$${a}.${String((Number(b) + 19) % 100).padStart(2, "0")}`);
  const one = tasks.watcherRun(silent.id, silent.last_fire, null, at);
  const two = tasks.watcherRun(silent.id, bumped, null, at + 86_400_000);
  const three = tasks.watcherRun(silent.id, silent.last_fire, null, at + 2 * 86_400_000);
  const findings = store.children(parentIdOf(silent.id)).filter((t) => t.automation?.role === "finding");
  replay = { first: one === "quiet" ? "quiet" : "posted", second: two === "quiet" ? "quiet" : "posted", third: three === "quiet" ? "quiet" : "posted", findings: findings.length, count: findings[0]?.automation?.count ?? 0 };
  if (findings.length !== 1 || two !== "quiet" || three !== "quiet") problems.push("the spend finding was not deduped");
}
copy.close();
const backups = readdirSync(dir).filter((name) => name.includes("before-automation-tasks"));
const liveUnchanged = statSync(source).mtimeMs === mtime;
if (!keep) rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ copy: keep ? copyPath : "(deleted)", liveUnchanged, before, first: { ...first, backup: first.backup ? "(made in the copy's folder)" : null }, after, second, problems, backups: backups.length, replay }, null, 2));

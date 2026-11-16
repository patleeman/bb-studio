import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTasks, legacyCardsWithoutTask } from "../src/tasks/check";
import { applyLinks, asFact, linkAtStart, planLinks, summarizeLinks, ThreadDirectory } from "../src/tasks/links";
import { boardRows, dayStart, flightRows, workerRows } from "../src/tasks/rows";
import { TaskStore } from "../src/tasks/store";
import { inLoopView, toLoop } from "../src/tasks/views";

const [source, threadsFile] = process.argv.slice(2);
const keep = process.argv.includes("--keep");
if (!source || !threadsFile) {
  console.error("Usage: tsx scripts/task-links-dry-run.mts <path to Studio data.db> <threads.json from `bb thread list --json --include-hidden`> [--keep]");
  process.exit(1);
}
const mtime = statSync(source).mtimeMs;
const dir = mkdtempSync(join(tmpdir(), "task-links-dry-run-"));
const copyPath = join(dir, "data.db");
const live = new Database(source, { readonly: true, fileMustExist: true });
await live.backup(copyPath);
live.close();

const facts = (JSON.parse(readFileSync(threadsFile, "utf8")) as unknown[]).map(asFact).filter((f): f is NonNullable<typeof f> => !!f);
const copy = new Database(copyPath);
const store = new TaskStore(copy, () => {});
const threads = new ThreadDirectory(copy);
const zone = process.env.TZ_USER ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const ctx = { since: dayStart(Date.now(), zone), dir: threads };
const phone = () => JSON.stringify(store.all().filter(inLoopView).map(toLoop));
const title = (id: string) => store.find(id)?.title ?? id;

const views = () => {
  const all = store.all();
  const board = boardRows(all, ctx);
  const homes = [...new Set(board.rows.filter((r) => r.under === null && r.home).map((r) => r.home!))];
  const flights = Object.fromEntries(homes.map((h) => [h, flightRows(all, h, ctx).counts]));
  const workers = workerRows(all, ctx);
  const flightOpen = Object.values(flights).reduce((n, c) => n + c.open, 0);
  const boardOpenWithHome = board.rows.filter((r) => r.under === null && r.open && r.home).length;
  const flightWorkerRows = homes.reduce((n, h) => n + flightRows(all, h, ctx).rows.filter((r) => r.under === null && r.open && r.hasWorkers).length, 0);
  return { board: board.counts, workers: workers.counts, flights, agree: { flightOpen, boardOpenWithHome, workerRows: workers.counts.open, flightWorkerRows } };
};

const before = { summary: summarizeLinks(store.all(), facts, threads), views: views(), problems: checkTasks(store.all(), facts, ctx, legacyCardsWithoutTask(copy)) };
const phoneBefore = phone();
const plan = planLinks(store.all(), facts, threads);
const first = applyLinks(store, plan);
const after = { summary: summarizeLinks(store.all(), facts, threads), views: views(), problems: checkTasks(store.all(), facts, ctx, legacyCardsWithoutTask(copy)) };
const second = linkAtStart(store, facts, threads);
const backups = readdirSync(dir).filter((name) => name.includes(".before-"));
const allRows = boardRows(store.all(), { ...ctx, since: 0 }).rows;
const rootOfRow = new Map<string, string>();
for (const r of allRows) rootOfRow.set(r.id, r.under === null ? r.id : rootOfRow.get(r.under) ?? r.id);
const pairedRoots = new Set(first.pairs.map((p) => rootOfRow.get(p.child)).filter((id): id is string => !!id));
const pairedRows = allRows.filter((r) => pairedRoots.has(rootOfRow.get(r.id)!)).map((r) => ({ id: r.id, title: title(r.id), under: r.under, depth: r.depth, home: r.home, workers: r.workers }));
const phoneAfter = phone();
copy.close();
const liveUnchanged = statSync(source).mtimeMs === mtime;
if (!keep) rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({
  copy: keep ? copyPath : "(deleted)", liveUnchanged, zone, threadFacts: facts.length,
  before, after,
  pairs: first.pairs.map((p) => ({ thread: p.thread, parent: `${p.parent} ${JSON.stringify(p.parentTitle)}`, child: `${p.child} ${JSON.stringify(p.childTitle)}` })),
  dropped: first.drops.map((id) => `${id} ${JSON.stringify(title(id))}`),
  created: first.create.map((c, i) => ({ id: first.created[i], thread: c.threadId, title: c.title, state: c.state, conversation: c.conversation, parentId: c.parentId })),
  ambiguous: first.ambiguous,
  backups, backupError: first.backupError ?? null,
  secondRun: { pairs: second.pairs.length, drops: second.drops.length, created: second.created.length, backup: second.backup },
  phoneTodoListUnchanged: phoneBefore === phoneAfter,
  pairedRows,
}, null, 2));

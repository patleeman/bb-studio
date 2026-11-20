// Applies "Bring over BB Studio data" when Studio starts, before it opens its
// database (server.ts calls this first). See journal.ts for the folder.
//
// A "ready" journal (bb's Studio data is staged and the Bots' threads are
// here) is applied:
//   1. this install's Studio must have no data of its own (own-data.ts,
//      failing closed); otherwise it is refused and nothing changes;
//   2. the staged database must not be newer than this Studio: every
//      migration bb recorded must be one this Studio has, with the same
//      statement (BB's own migrate checks that), then it is brought up to
//      this Studio's migrations;
//   3. everything in it is stopped (stop.ts); Task reminders and the public
//      skill registry's approval are turned off in bb's key-value rows;
//   4. a marker (FROM_BB_FILE) goes in with bb's files: its Bots run here
//      now, none "in bb" (automation-table.ts readImportedAt);
//   5. the swap (swap.ts): this install's files and kv rows go to before/,
//      bb's come in, and the journal ends "applied".
// "restore-requested" ("Put my old Studio data back") swaps back: bb's go to
// replaced/, before/ comes back. "applying" and "restoring" left by a crash
// are finished, or rolled back. All of this happens only on Studio's first
// load in a server process: a reload leaves the journal for the next start.
import Database from "better-sqlite3";
import { existsSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS_KV_KEY } from "../settings/store";
import { SKILLS_REGISTRY_KV_KEY } from "../skills-registry";
import {
  BB_KV_FILE, BEFORE_DIR, BEFORE_KV_FILE, FROM_BB_FILE, KEPT_HERE, REPLACED_DIR, REPLACED_KV_FILE, STAGED_DIR,
  importPath, readJournal, readJson, studioDir, writeJournal, writePrivateJson, type ImportJournal,
} from "./journal";
import { studioOwnData, type OwnData } from "./own-data";
import { stopImportedStudio } from "./stop";
import { isRolledBack, rollBack, runSwap, type KvFile, type RolledBack, type StudioKv, type SwapPlan } from "./swap";

export interface StartDeps {
  dataDir: string;
  kv: StudioKv;
  /** BB's migration helper (bb.storage.migrate), run on the staged copy. */
  migrate(db: Database.Database, statements: string[]): void;
  migrations: string[];
  log: { info(message: string): void; warn(message: string): void };
  now?: () => number;
  /**
   * Whether this is Studio's first load in this server process. A reload
   * runs the new Studio while the old one still runs on the same files and
   * key-value rows, so a swap waits for the next real start.
   */
  firstLoad: boolean;
}

const LOADED = Symbol.for("bb-studio.studio-data.loaded");

/** True the first time Studio loads in this server process; reloads see false. */
export function claimFirstLoad(scope: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>): boolean {
  if (scope[LOADED]) return false;
  scope[LOADED] = true;
  return true;
}

/** States that change files or key-value rows when Studio starts. */
const ACTS_AT_START = new Set(["ready", "restore-requested", "applying", "restoring", "rolling-back"]);

/** bb's kv file as the server writes it; `prepared` once start.ts turned things off in it. */
interface BbKvFile extends KvFile { plugin_settings?: unknown[]; prepared?: boolean }

const ONBOARDING = "onboarding.json";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const applyPlan = (dataDir: string): SwapPlan => ({
  dataDir,
  incomingDir: importPath(dataDir, STAGED_DIR),
  asideDir: importPath(dataDir, BEFORE_DIR),
  incomingKvFile: importPath(dataDir, BB_KV_FILE),
  asideKvFile: importPath(dataDir, BEFORE_KV_FILE),
});

const restorePlan = (dataDir: string): SwapPlan => ({
  dataDir,
  incomingDir: importPath(dataDir, BEFORE_DIR),
  asideDir: importPath(dataDir, REPLACED_DIR),
  incomingKvFile: importPath(dataDir, BEFORE_KV_FILE),
  asideKvFile: importPath(dataDir, REPLACED_KV_FILE),
});

/** This install's own data, read from its database file (before Studio opens it). Fails closed. */
export function ownDataOnDisk(dataDir: string): OwnData {
  const path = join(studioDir(dataDir), "data.db");
  if (!existsSync(path)) return { has: false };
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 1000");
    return studioOwnData(db);
  } catch (error) {
    return { has: true, reason: `this install's Studio data could not be read (${errorText(error)})` };
  } finally {
    db?.close();
  }
}

/** Checks the staged database's migrations against this Studio's; a reason when it can't be used. */
export function schemaProblem(db: Database.Database, migrations: readonly string[]): string | null {
  let ids: number[];
  try {
    ids = (db.prepare("SELECT id FROM _bb_migrations ORDER BY id").all() as { id: number }[]).map((row) => row.id);
  } catch {
    return "bb's copy is not a BB Studio database";
  }
  const newest = ids.length ? Math.max(...ids) : -1;
  if (newest >= migrations.length) return `bb runs a newer BB Studio than this one (its data has ${newest + 1} changes; this BB Studio knows ${migrations.length}). Update BB Studio, then bring it over again.`;
  return null;
}

/** Task reminders off, and the public skill registry's approval not carried over. */
export function prepareKv(file: BbKvFile): BbKvFile {
  const rows = file.plugin_kv.filter((row) => row.key !== SKILLS_REGISTRY_KV_KEY);
  const at = rows.findIndex((row) => row.key === SETTINGS_KV_KEY);
  let values: Record<string, unknown> = {};
  if (at >= 0) {
    try {
      const parsed = JSON.parse(rows[at]!.value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed as Record<string, unknown>;
    } catch {
      // Unreadable settings start from the defaults.
    }
  }
  const settings = { key: SETTINGS_KV_KEY, value: JSON.stringify({ ...values, loopsEnabled: false }) };
  if (at >= 0) rows[at] = settings;
  else rows.push(settings);
  return { ...file, plugin_kv: rows, prepared: true };
}

/** bb's onboarding flag, or one that says onboarding is done (an import), so a second Assistant isn't made. */
function prepareOnboarding(stagedDir: string, now: number): void {
  const path = join(stagedDir, ONBOARDING);
  let done = false;
  try {
    done = readJson<{ version?: unknown; state?: unknown }>(path).state === "done";
  } catch {
    done = false;
  }
  if (!done) writePrivateJson(path, { version: 1, state: "done", reason: "import", at: now, botId: null, welcomeThreadId: null, opened: true });
}

function settle(dataDir: string, journal: ImportJournal, log: StartDeps["log"]): ImportJournal {
  writeJournal(dataDir, journal);
  if (journal.error) log.warn(`BB Studio data from bb: ${journal.state}: ${journal.error}`);
  else log.info(`BB Studio data from bb: ${journal.state}.`);
  return journal;
}

function removeIfEmpty(path: string): void {
  try { rmdirSync(path); } catch { /* missing or not empty: kept */ }
}

type Ending = { done(journal: ImportJournal): ImportJournal; undone(journal: ImportJournal, reason: string): ImportJournal; where: string };

/** How an apply ends: done, or undone with this install's data back. */
function applyEnding(deps: StartDeps, plan: SwapPlan): Ending {
  const now = deps.now ?? Date.now;
  return {
    done: (journal) => {
      removeIfEmpty(plan.incomingDir);
      rmSync(plan.incomingKvFile, { force: true });
      return { ...journal, state: "applied", appliedAt: now(), error: null };
    },
    undone: (journal, reason) => ({ ...journal, state: "failed", error: `bb's Studio data could not be put in place (${reason}). This install's Studio data is back as it was.` }),
    where: `this install's Studio data is in ${plan.asideDir}, bb's in ${plan.incomingDir}`,
  };
}

/** How a put-back ends: restored, or undone with bb's data still in use. */
function restoreEnding(deps: StartDeps, plan: SwapPlan): Ending {
  const now = deps.now ?? Date.now;
  return {
    done: (journal) => {
      removeIfEmpty(plan.incomingDir);
      rmSync(plan.incomingKvFile, { force: true });
      return { ...journal, state: "restored", restoredAt: now(), error: null };
    },
    undone: (journal, reason) => ({ ...journal, state: "applied", error: `The old Studio data could not be put back (${reason}). bb's Studio data is still in use.` }),
    where: `bb's Studio data is in ${plan.asideDir}, this install's old data in ${plan.incomingDir}`,
  };
}

async function swapOrRollBack(deps: StartDeps, plan: SwapPlan, journal: ImportJournal, from: "out" | "in" | "kv", ending: Ending): Promise<ImportJournal> {
  const now = deps.now ?? Date.now;
  try {
    const finished = await runSwap(plan, journal, deps.kv, from, now);
    return settle(deps.dataDir, ending.done({ ...finished, phase: null, updatedAt: now() }), deps.log);
  } catch (thrown) {
    if (!isRolledBack(thrown)) throw thrown;
    return settleRollBack(deps, ending, thrown);
  }
}

/** Where a rollback leaves things: undone as the ending says, or "rollback-failed" with every file kept. */
function settleRollBack(deps: StartDeps, ending: Ending, thrown: RolledBack): ImportJournal {
  const now = deps.now ?? Date.now;
  const reason = errorText(thrown.error);
  if (!thrown.clean) {
    return settle(deps.dataDir, { ...thrown.journal, state: "rollback-failed", phase: thrown.journal.phase ?? null, updatedAt: now(), error: `The swap failed (${reason}) and could not be fully undone (${thrown.problems.slice(0, 3).join("; ")}). Nothing was deleted: ${ending.where}.` }, deps.log);
  }
  return settle(deps.dataDir, ending.undone({ ...thrown.journal, phase: null, undoing: undefined, updatedAt: now() }, reason), deps.log);
}

async function apply(deps: StartDeps, journal: ImportJournal): Promise<ImportJournal> {
  const now = deps.now ?? Date.now;
  const plan = applyPlan(deps.dataDir);
  const refuse = (error: string) => settle(deps.dataDir, { ...journal, state: "refused", error, updatedAt: now() }, deps.log);
  const stagedDb = join(plan.incomingDir, "data.db");
  if (!existsSync(stagedDb) || !existsSync(plan.incomingKvFile)) return refuse("bb's Studio data is not in the staged copy any more.");

  const own = ownDataOnDisk(deps.dataDir);
  if (own.has) return refuse(`BB Studio has data of its own now (${own.reason}), so bb's was not brought in. Nothing changed.`);

  let stopped: ImportJournal["stopped"] = null;
  const db = new Database(stagedDb, { fileMustExist: true });
  try {
    const problem = schemaProblem(db, deps.migrations);
    if (problem) return refuse(problem);
    try {
      deps.migrate(db, deps.migrations);
    } catch (error) {
      return refuse(`bb's BB Studio data doesn't match this BB Studio (${errorText(error)}). Nothing changed.`);
    }
    stopped = stopImportedStudio(db, now());
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
  for (const suffix of ["-wal", "-shm", "-journal"]) rmSync(`${stagedDb}${suffix}`, { force: true });
  prepareOnboarding(plan.incomingDir, now());
  writePrivateJson(join(plan.incomingDir, FROM_BB_FILE), { version: 1, journalId: journal.id, at: now() });
  const bbKv = readJson<BbKvFile>(plan.incomingKvFile);
  if (!bbKv.prepared) writePrivateJson(plan.incomingKvFile, prepareKv(bbKv));

  const incoming = readdirSync(plan.incomingDir).filter((name) => !KEPT_HERE.has(name)).sort();
  const applying: ImportJournal = { ...journal, state: "applying", phase: "out", incoming, stopped, error: null, updatedAt: now() };
  writeJournal(deps.dataDir, applying);
  return swapOrRollBack(deps, plan, applying, "out", applyEnding(deps, plan));
}

async function restore(deps: StartDeps, journal: ImportJournal): Promise<ImportJournal> {
  const now = deps.now ?? Date.now;
  const plan = restorePlan(deps.dataDir);
  if (!existsSync(plan.incomingDir) || !existsSync(plan.incomingKvFile)) {
    return settle(deps.dataDir, { ...journal, state: "applied", error: "The old Studio data is not there any more, so it could not be put back.", updatedAt: now() }, deps.log);
  }
  const incoming = readdirSync(plan.incomingDir).filter((name) => !KEPT_HERE.has(name)).sort();
  const restoring: ImportJournal = { ...journal, state: "restoring", phase: "out", incoming, error: null, updatedAt: now() };
  writeJournal(deps.dataDir, restoring);
  return swapOrRollBack(deps, plan, restoring, "out", restoreEnding(deps, plan));
}

/** At Studio's start, before its database opens: applies, puts back, or finishes what a crash left. */
export async function finishStudioImport(deps: StartDeps): Promise<ImportJournal | null> {
  const journal = readJournal(deps.dataDir);
  if (journal === null) return null;
  if (journal === "unreadable") {
    deps.log.warn(`BB Studio data from bb: the journal in ${importPath(deps.dataDir, "")} can't be read, so nothing was applied.`);
    return null;
  }
  if (!deps.firstLoad && ACTS_AT_START.has(journal.state)) {
    deps.log.info(`BB Studio data from bb: ${journal.state}; Studio was reloaded, not restarted, so this waits for BB Studio to be quit and reopened.`);
    return journal;
  }
  switch (journal.state) {
    case "ready": return apply(deps, journal);
    case "restore-requested": return restore(deps, journal);
    case "applying": {
      const plan = applyPlan(deps.dataDir);
      return swapOrRollBack(deps, plan, journal, journal.phase ?? "out", applyEnding(deps, plan));
    }
    case "restoring": {
      const plan = restorePlan(deps.dataDir);
      return swapOrRollBack(deps, plan, journal, journal.phase ?? "out", restoreEnding(deps, plan));
    }
    case "rolling-back": {
      const restoring = journal.undoing === "restoring";
      const plan = restoring ? restorePlan(deps.dataDir) : applyPlan(deps.dataDir);
      const ending = restoring ? restoreEnding(deps, plan) : applyEnding(deps, plan);
      return settleRollBack(deps, ending, await rollBack(plan, journal, deps.kv, new Error("BB Studio stopped while undoing a swap")));
    }
    default: return journal;
  }
}

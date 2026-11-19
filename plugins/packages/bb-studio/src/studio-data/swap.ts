// One swap of Studio's data folder and key-value rows, journaled so a crash
// at any point is finished, or undone, at the next start (start.ts).
//
// Phases, each written to the journal before it starts:
//   out  this install's files (all but KEPT_HERE) move into the aside folder;
//        its kv rows were saved to the aside kv file first;
//   in   the incoming files move into place;
//   kv   the kv rows are replaced by the incoming ones.
// Every step can run again: a resumed phase moves only what is left.
//
// A failure rolls back: the journal says "rolling-back" first, so a crash
// during the rollback resumes the rollback, not the swap. Then kv rows from
// the aside file, the files the swap moved in back to the incoming folder,
// the aside files back into place. Each step is tried on its own. If any
// fails, nothing is deleted and the journal says where the files are (state
// "rollback-failed").
import { existsSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { KEPT_HERE, privateDir, readJson, studioDir, writeJournal, writePrivateJson, type ImportJournal, type SwapPhase } from "./journal";

export interface StudioKv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

/** Key-value rows as stored: the key and its JSON text. */
export interface KvFile { plugin_kv: { key: string; value: string }[] }

export interface SwapPlan {
  dataDir: string;
  incomingDir: string;
  asideDir: string;
  incomingKvFile: string;
  asideKvFile: string;
}

export class SwapError extends Error {}

const names = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((name) => !KEPT_HERE.has(name)).sort() : []);

export async function readKv(kv: StudioKv): Promise<KvFile> {
  const rows: KvFile["plugin_kv"] = [];
  for (const key of (await kv.list()).sort()) {
    const value = await kv.get<unknown>(key);
    if (value !== undefined) rows.push({ key, value: JSON.stringify(value) });
  }
  return { plugin_kv: rows };
}

export async function replaceKv(kv: StudioKv, file: KvFile): Promise<void> {
  for (const key of await kv.list()) await kv.delete(key);
  for (const row of file.plugin_kv) await kv.set(row.key, JSON.parse(row.value));
}

/** Runs the swap from `from`, updating the journal as it goes. Throws on failure, after rolling back. */
export async function runSwap(plan: SwapPlan, journal: ImportJournal, kv: StudioKv, from: SwapPhase, now: () => number): Promise<ImportJournal> {
  const target = studioDir(plan.dataDir);
  let current = journal;
  const enter = (phase: SwapPhase) => {
    current = { ...current, phase, updatedAt: now() };
    writeJournal(plan.dataDir, current);
  };
  const order: SwapPhase[] = ["out", "in", "kv"];
  try {
    for (const phase of order.slice(order.indexOf(from))) {
      enter(phase);
      if (phase === "out") {
        privateDir(plan.asideDir);
        if (!existsSync(plan.asideKvFile)) writePrivateJson(plan.asideKvFile, await readKv(kv));
        for (const name of names(target)) {
          if (existsSync(join(plan.asideDir, name))) throw new SwapError(`${name} is already in ${plan.asideDir}`);
          renameSync(join(target, name), join(plan.asideDir, name));
        }
      } else if (phase === "in") {
        for (const name of names(plan.incomingDir)) {
          if (existsSync(join(target, name))) throw new SwapError(`${name} appeared in Studio's folder during the swap`);
          renameSync(join(plan.incomingDir, name), join(target, name));
        }
      } else {
        await replaceKv(kv, readJson<KvFile>(plan.incomingKvFile));
      }
    }
    return current;
  } catch (error) {
    current = { ...current, state: "rolling-back", undoing: current.state === "restoring" ? "restoring" : "applying", updatedAt: now() };
    writeJournal(plan.dataDir, current);
    throw await rollBack(plan, current, kv, error);
  }
}

export interface RolledBack { error: unknown; journal: ImportJournal; clean: boolean; problems: string[] }

/**
 * Undoes a swap from the phase it reached; also run at the next start for a
 * journal left in "rolling-back". Moves back only the names the swap moved in
 * (journal.incoming), then every entry of the aside folder.
 */
export async function rollBack(plan: SwapPlan, journal: ImportJournal, kv: StudioKv, error: unknown): Promise<RolledBack> {
  const target = studioDir(plan.dataDir);
  const problems: string[] = [];
  const attempt = async (what: string, step: () => unknown) => {
    try { await step(); } catch (cause) { problems.push(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  if (journal.phase === "kv" && existsSync(plan.asideKvFile)) {
    await attempt("key-value rows", async () => replaceKv(kv, readJson<KvFile>(plan.asideKvFile)));
  }
  if (journal.phase === "in" || journal.phase === "kv") {
    for (const name of journal.incoming ?? []) {
      if (KEPT_HERE.has(name) || !existsSync(join(target, name))) continue;
      if (existsSync(join(plan.incomingDir, name))) continue;
      await attempt(name, () => renameSync(join(target, name), join(plan.incomingDir, name)));
    }
  }
  for (const name of names(plan.asideDir)) {
    await attempt(name, () => {
      if (existsSync(join(target, name))) throw new Error("something else is in its place");
      renameSync(join(plan.asideDir, name), join(target, name));
    });
  }
  const clean = problems.length === 0;
  if (clean) {
    rmSync(plan.asideKvFile, { force: true });
    try { rmdirSync(plan.asideDir); } catch { /* not there, or not empty: kept */ }
  }
  return { error, journal, clean, problems };
}

export function isRolledBack(value: unknown): value is RolledBack {
  return typeof value === "object" && value !== null && "clean" in value && "problems" in value;
}

// "Bring over BB Studio data" from bb: the folder and journal that BB
// Studio's server (the fork's /fork/bring-over/studio-data routes) and this
// plugin share. The server only stages: it copies bb's Studio data into
// plugins/studio/import-staged/ while Studio runs. This plugin applies it at
// its next start, before it opens its database (start.ts).
//
//   import-staged/                 0700
//     journal.json                 0600, the state below
//     staged/                      bb's Studio files, data.db included (server)
//     bb-kv.json                   0600, bb's Studio key-value rows (server)
//     before/  before-kv.json      this install's Studio data, set aside at the swap
//     replaced/ replaced-kv.json   bb's, set aside when the old data is put back
//
// Who writes which state:
//   server:  staging -> staged -> ready (once the Bots' threads came over);
//            applied -> restore-requested ("Put my old Studio data back");
//            Discard and Delete remove the folder.
//   plugin:  ready -> applying -> applied | refused | failed | rollback-failed;
//            restore-requested -> restoring -> restored | applied (with error).
// A journal left in applying or restoring is finished, or rolled back, at the
// next start. A rollback that fails keeps every file and says where they are.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STUDIO_ID = "studio";
export const IMPORT_DIR_NAME = "import-staged";
export const JOURNAL_FILE = "journal.json";
export const STAGED_DIR = "staged";
export const BB_KV_FILE = "bb-kv.json";
export const BEFORE_DIR = "before";
export const BEFORE_KV_FILE = "before-kv.json";
export const REPLACED_DIR = "replaced";
export const REPLACED_KV_FILE = "replaced-kv.json";

/** What stays this install's at a swap: secrets, logs, host and bridge data, backup sessions, and this folder. */
export const KEPT_HERE: ReadonlySet<string> = new Set(["secrets", "logs", "host-data", "bridge-data", "backup-sessions", IMPORT_DIR_NAME]);

export const IMPORT_STATES = ["staging", "staged", "ready", "applying", "applied", "refused", "failed", "rollback-failed", "restore-requested", "restoring", "restored"] as const;
export type ImportState = (typeof IMPORT_STATES)[number];
export type SwapPhase = "out" | "in" | "kv";

export interface ImportJournal {
  version: 1;
  id: string;
  state: ImportState;
  stagedAt: number;
  /** When the server read bb's database for this copy (the bring-over snapshot's time). */
  snapshotAt: number | null;
  updatedAt: number;
  /** Why it was refused or failed, in plain words. */
  error: string | null;
  /** Where a swap got to, while applying or restoring. */
  phase?: SwapPhase | null;
  /** The names that were in the incoming folder when the swap began. */
  incoming?: string[];
  appliedAt?: number | null;
  restoredAt?: number | null;
  /** The thread ids the Bots can't do without (their Main threads). */
  required?: string[];
  /** What the swap stopped: the Bots and their schedules. */
  stopped?: StopSummary | null;
}

export interface StopSummary {
  bots: number;
  heartbeats: number;
  runners: number;
  automations: number;
  leads: number;
  otherTriggers: number;
  approvals: number;
}

export const studioDir = (dataDir: string) => join(dataDir, "plugins", STUDIO_ID);
export const importDir = (dataDir: string) => join(studioDir(dataDir), IMPORT_DIR_NAME);
export const importPath = (dataDir: string, name: string) => join(importDir(dataDir), name);

/** The journal; "unreadable" when the file is there but isn't one (nothing is applied then). */
export function readJournal(dataDir: string): ImportJournal | "unreadable" | null {
  let text: string;
  try {
    text = readFileSync(importPath(dataDir, JOURNAL_FILE), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "unreadable";
  }
  try {
    const value = JSON.parse(text) as Partial<ImportJournal>;
    if (value?.version !== 1 || typeof value.id !== "string" || !IMPORT_STATES.includes(value.state as ImportState)) return "unreadable";
    return value as ImportJournal;
  } catch {
    return "unreadable";
  }
}

/** Writes the journal in one step (a temp file, then rename), readable only by this user. */
export function writeJournal(dataDir: string, journal: ImportJournal): void {
  writePrivateJson(importPath(dataDir, JOURNAL_FILE), journal);
}

export function writePrivateJson(path: string, value: unknown): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function privateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

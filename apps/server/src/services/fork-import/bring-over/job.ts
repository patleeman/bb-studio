import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ServerLogger } from "../../../types.js";
import { readHostId } from "../sync.js";
import { BringOverCancelledError, errorDetail } from "./files.js";
import { threadIdsOfProject } from "./listing.js";
import { applySetting, type SettingId } from "./settings.js";
import { openSnapshot, type SourceSnapshot } from "./source.js";
import { importThread, referencedFirst } from "./threads.js";

type Sqlite = Database.Database;

export type BringOverPick =
  | { kind: "project"; id: string }
  | { kind: "thread"; id: string };

export interface BringOverRequest {
  picks: BringOverPick[];
  attachments: boolean;
  settings: { id: SettingId; replace: boolean }[];
}

export interface BringOverJob {
  id: string;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  finishedAt: number | null;
  threadsTotal: number;
  threadsDone: number;
  threadsImported: number;
  threadsSkipped: number;
  files: number;
  settingsApplied: string[];
  failures: { item: string; detail: string }[];
}

interface RunningJob {
  job: BringOverJob;
  control: AbortController;
  finished: Promise<void>;
}

const running = new Map<string, RunningJob>();
const last = new Map<string, BringOverJob>();

export function currentBringOverJob(dataDir: string): BringOverJob | null {
  return running.get(dataDir)?.job ?? last.get(dataDir) ?? null;
}

export function cancelBringOverJob(dataDir: string): BringOverJob | null {
  const entry = running.get(dataDir);
  if (entry === undefined) return currentBringOverJob(dataDir);
  entry.control.abort();
  return entry.job;
}

export function bringOverJobFinished(dataDir: string): Promise<void> {
  return running.get(dataDir)?.finished ?? Promise.resolve();
}

function threadIdsFor(
  source: Sqlite,
  picks: readonly BringOverPick[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const threads =
      pick.kind === "project" ? threadIdsOfProject(source, pick.id) : [pick.id];
    for (const id of threads) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

const yieldToServer = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export function startBringOverJob(args: {
  dataDir: string;
  snapshot: SourceSnapshot;
  target: Sqlite;
  request: BringOverRequest;
  logger: Pick<ServerLogger, "info" | "warn">;
  now: number;
}): BringOverJob | null {
  if (running.has(args.dataDir)) return null;
  const control = new AbortController();
  const job: BringOverJob = {
    id: randomUUID(),
    state: "running",
    startedAt: args.now,
    finishedAt: null,
    threadsTotal: 0,
    threadsDone: 0,
    threadsImported: 0,
    threadsSkipped: 0,
    files: 0,
    settingsApplied: [],
    failures: [],
  };
  const run = async () => {
    const source = openSnapshot(args.snapshot);
    try {
      for (const setting of args.request.settings) {
        if (control.signal.aborted) break;
        try {
          await applySetting({
            ...setting,
            source,
            target: args.target,
            sourceDataDir: args.snapshot.sourceDataDir,
            dataDir: args.dataDir,
          });
          job.settingsApplied.push(setting.id);
        } catch (error) {
          job.failures.push({ item: setting.id, detail: errorDetail(error) });
        }
      }
      const threadIds = referencedFirst(
        source,
        threadIdsFor(source, args.request.picks),
      );
      job.threadsTotal = threadIds.length;
      const context = {
        source,
        target: args.target,
        dataDir: args.dataDir,
        sourceDataDir: args.snapshot.sourceDataDir,
        sourceHostId: args.snapshot.sourceHostId,
        ourHostId: readHostId(args.dataDir),
        attachments: args.request.attachments,
        signal: control.signal,
      };
      for (const threadId of threadIds) {
        if (control.signal.aborted) break;
        try {
          const result = await importThread(context, threadId);
          if (result.imported) job.threadsImported += 1;
          else job.threadsSkipped += 1;
          job.files += result.files;
        } catch (error) {
          if (error instanceof BringOverCancelledError) break;
          job.failures.push({ item: threadId, detail: errorDetail(error) });
        }
        job.threadsDone += 1;
        await yieldToServer();
      }
      job.state = control.signal.aborted
        ? "cancelled"
        : job.failures.length > 0
          ? "failed"
          : "done";
    } catch (error) {
      job.state = "failed";
      job.failures.push({ item: "job", detail: errorDetail(error) });
    } finally {
      source.close();
      job.finishedAt = Date.now();
      running.delete(args.dataDir);
      last.set(args.dataDir, job);
      args.logger.info(
        {
          state: job.state,
          imported: job.threadsImported,
          skipped: job.threadsSkipped,
          failures: job.failures.length,
        },
        "Bring-over from bb finished",
      );
    }
  };
  const entry: RunningJob = { job, control, finished: Promise.resolve() };
  running.set(args.dataDir, entry);
  entry.finished = run();
  return job;
}

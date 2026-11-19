import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { BringOverError, throwIfCancelled } from "./files.js";

export const snapshotChildSource = String.raw`
"use strict";
const Database = require(process.env.BB_STUDIO_SNAPSHOT_DRIVER);
const jobs = JSON.parse(process.env.BB_STUDIO_SNAPSHOT_JOBS);
const ALL_PAGES = 0x7fffffff;
let orphaned = false;
const stop = () => { orphaned = true; process.exit(1); };
process.stdin.on("end", stop);
process.stdin.on("close", stop);
process.stdin.on("error", stop);
process.stdin.resume();
(async () => {
  for (const job of jobs) {
    if (orphaned) process.exit(1);
    const source = new Database(job.from, { readonly: true, fileMustExist: true });
    try {
      source.pragma("busy_timeout = 5000");
      await source.backup(job.to, { progress: () => ALL_PAGES });
    } finally {
      source.close();
    }
  }
})().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
`;

export interface SnapshotJob {
  from: string;
  to: string;
}

export async function snapshotDatabases(
  jobs: readonly SnapshotJob[],
  signal?: AbortSignal,
): Promise<void> {
  if (jobs.length === 0) return;
  throwIfCancelled(signal);
  let driverPath: string;
  try {
    driverPath = createRequire(import.meta.url).resolve("better-sqlite3");
  } catch {
    throw new BringOverError("the SQLite driver could not be found");
  }
  const child = spawn(process.execPath, ["-e", snapshotChildSource], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BB_STUDIO_SNAPSHOT_DRIVER: driverPath,
      BB_STUDIO_SNAPSHOT_JOBS: JSON.stringify(jobs),
    },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000);
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.once("error", () => resolve(null));
  });
  const onAbort = () => child.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });
  let code: number | null;
  try {
    code = await exited;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  throwIfCancelled(signal);
  if (code !== 0) {
    throw new BringOverError(
      `the copy of bb's database failed${stderr.length > 0 ? `: ${stderr.trim().slice(0, 300)}` : ""}`,
    );
  }
}

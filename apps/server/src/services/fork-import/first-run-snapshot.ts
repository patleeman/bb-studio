import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  FirstRunImportTimeoutError,
  type ImportDeadline,
} from "./first-run-install.js";

const snapshotChildSource = String.raw`
"use strict";
const Database = require(process.env.BB_STUDIO_SNAPSHOT_DRIVER);
const jobs = JSON.parse(process.env.BB_STUDIO_SNAPSHOT_JOBS);
const ALL_PAGES = 0x7fffffff;
(async () => {
  for (const job of jobs) {
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

const driverPath = createRequire(import.meta.url).resolve("better-sqlite3");

export interface SnapshotJob {
  from: string;
  to: string;
}

export async function snapshotDatabases(
  jobs: readonly SnapshotJob[],
  deadline: ImportDeadline,
): Promise<void> {
  if (jobs.length === 0) return;
  deadline.check();
  const child = spawn(process.execPath, ["-e", snapshotChildSource], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BB_STUDIO_SNAPSHOT_DRIVER: driverPath,
      BB_STUDIO_SNAPSHOT_JOBS: JSON.stringify(jobs),
    },
    stdio: ["ignore", "ignore", "pipe"],
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
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(
      () => resolve("timed-out"),
      Math.max(0, deadline.at - Date.now()),
    );
  });
  const result = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  if (result === "timed-out") {
    child.kill("SIGKILL");
    await exited;
    throw new FirstRunImportTimeoutError(deadline.timeoutMs);
  }
  if (result !== 0) {
    throw new Error(
      `database copy failed${stderr.length > 0 ? `: ${stderr.trim()}` : ""}`,
    );
  }
}

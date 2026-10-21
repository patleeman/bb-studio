// Backend only. Both sides use the same process fence before touching editor state.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

export interface ProcessRow { pid: number; parent: number; command: string }
export function processRows(text: string): ProcessRow[] {
  return text.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3]! }] : [];
  });
}
/** Include extension hosts and terminals, even when their command has no root path. */
export function codeProcesses(rows: ProcessRow[], root: string): number[] {
  const base = root.replace(/\/+$/, "");
  const markers = [`${base}/code-server/`, `${base}/watchdog.cjs`, `${base}/workspaces/`];
  const pids = new Set(rows.filter((row) => row.pid !== process.pid && markers.some((marker) => row.command.includes(marker))).map((row) => row.pid));
  let previous = -1;
  while (previous !== pids.size) {
    previous = pids.size;
    for (const row of rows) if (row.pid !== process.pid && pids.has(row.parent)) pids.add(row.pid);
  }
  return [...pids];
}
export const systemProcesses = async () => processRows((await promisify(execFile)("ps", ["-axo", "pid=,ppid=,command="], { maxBuffer: 16 * 1024 * 1024 })).stdout);

/** Fail closed: no copy or new server until every old process has exited. */
export async function quiesceCode(root: string, driver = {
  list: systemProcesses,
  stop: (pid: number) => { try { process.kill(pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } },
  pause: () => sleep(100),
}, attempts = 150): Promise<void> {
  const tracked = new Set<number>();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const rows = await driver.list();
    for (const pid of codeProcesses(rows, root)) {
      if (!tracked.has(pid)) { tracked.add(pid); driver.stop(pid); }
    }
    // Tracked descendants can be reparented while the watchdog shuts down.
    if (!rows.some((row) => tracked.has(row.pid))) return;
    await driver.pause();
  }
  throw new Error("Old VS Code processes have not stopped; the copy and Studio's code-server remain blocked.");
}

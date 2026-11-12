// Runs a watcher's script on the server host, for when bb's automations
// plugin is off and Studio runs watchers on its own trigger engine
// (src/automations.ts). The same contract as bb's script automations: the
// script runs with its interpreter, in its working directory, with its env,
// until it exits or its timeout passes; stdout is its output.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WatcherScript {
  body: string;
  interpreter: string;
  timeoutMs: number;
  env: Record<string, string>;
  /** Where it runs; made when missing. */
  cwd: string;
}
export interface WatcherScriptResult { exitCode: number | null; output: string; error: string | null }
export type RunWatcherScript = (script: WatcherScript) => Promise<WatcherScriptResult>;

const OUTPUT_LIMIT = 64_000;
const EXTENSION: Record<string, string> = { bash: "sh", sh: "sh", node: "js", python3: "py" };

export const runWatcherScript: RunWatcherScript = (script) => new Promise((resolve) => {
  try {
    mkdirSync(script.cwd, { recursive: true });
  } catch (error) {
    resolve({ exitCode: null, output: "", error: `Its folder can't be made: ${(error as Error).message}` });
    return;
  }
  // The script file sits apart from its folder, which may be the user's.
  const holder = mkdtempSync(join(tmpdir(), "studio-watcher-"));
  const file = join(holder, `script.${EXTENSION[script.interpreter] ?? "sh"}`);
  writeFileSync(file, script.body, { mode: 0o700 });
  // Its own process group, so a timeout stops what the script started too.
  const child = spawn(script.interpreter, [file], { cwd: script.cwd, env: { ...process.env, ...script.env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let stdout = "", stderr = "", settled = false;
  const done = (result: WatcherScriptResult) => { if (!settled) { settled = true; clearTimeout(timer); rmSync(holder, { recursive: true, force: true }); resolve(result); } };
  child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString("utf8")).slice(-OUTPUT_LIMIT); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-OUTPUT_LIMIT); });
  const timer = setTimeout(() => {
    try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    done({ exitCode: null, output: stdout, error: `Timed out after ${Math.max(1, Math.round(script.timeoutMs / 1000))} s.` });
  }, script.timeoutMs);
  child.on("error", (error) => done({ exitCode: null, output: stdout, error: error.message }));
  child.on("close", (code) => done({ exitCode: code, output: stdout, error: code === 0 ? null : stderr.trim().slice(-500) || `Exited with ${code}.` }));
});

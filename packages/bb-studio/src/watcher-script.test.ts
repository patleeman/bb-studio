import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runWatcherScript } from "./watcher-script";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "watcher-")); dirs.push(dir); return join(dir, "aut_1"); };

it("runs the script in its folder with its env, and keeps its output", async () => {
  const cwd = folder();
  expect(await runWatcherScript({ body: 'echo "$GREETING from $(basename "$PWD")"', interpreter: "bash", timeoutMs: 10_000, env: { GREETING: "hi" }, cwd })).toEqual({ exitCode: 0, output: "hi from aut_1\n", error: null });
});

it("says why a script failed or ran too long", async () => {
  expect(await runWatcherScript({ body: "echo oops >&2; exit 3", interpreter: "sh", timeoutMs: 10_000, env: {}, cwd: folder() })).toEqual({ exitCode: 3, output: "", error: "oops" });
  expect(await runWatcherScript({ body: "sleep 5", interpreter: "sh", timeoutMs: 200, env: {}, cwd: folder() })).toMatchObject({ exitCode: null, error: "Timed out after 1 s." });
});

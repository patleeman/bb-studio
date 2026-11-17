import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Script automations set BB_CLI to the bb command, a launcher that runs the
// bb-app entry. Before upstream's BB_CLI_REEXEC handshake, the entry re-ran
// BB_CLI on every call, so a script calling `bb` re-launched it without end
// and scripts had to `unset BB_CLI`. This runs that chain with real
// processes: the wrapper runs once from the script and once as the re-exec,
// then the bundled CLI runs.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("a BB_CLI launcher that calls the bb entry again", () => {
  it.skipIf(process.platform === "win32")(
    "runs the bundled CLI after one re-exec, with BB_CLI still set",
    () => {
      const root = mkdtempSync(join(tmpdir(), "bb-app-reexec-chain-"));
      roots.push(root);
      const daemonBundleDir = join(root, "host-daemon");
      mkdirSync(daemonBundleDir);
      const hops = join(root, "hops.txt");
      writeFileSync(
        join(daemonBundleDir, "bb"),
        "require('node:fs').appendFileSync(process.env.TEST_HOPS, 'bundled ' + process.argv.slice(2).join(' ') + '\\n')",
      );
      const entry = join(root, "entry.mjs");
      writeFileSync(
        entry,
        [
          `import { runBundledCliCommand } from ${JSON.stringify(pathToFileURL(join(packageRoot, "src/launcher.ts")).href)};`,
          "const context = JSON.parse(process.env.TEST_CONTEXT);",
          "process.exitCode = await runBundledCliCommand({ args: process.argv.slice(2), context, env: process.env });",
        ].join("\n"),
      );
      const wrapper = join(root, "bb");
      writeFileSync(
        wrapper,
        [
          "#!/bin/sh",
          'echo wrapper >> "$TEST_HOPS"',
          `[ "$(grep -c wrapper "$TEST_HOPS")" -gt 3 ] && exit 99`,
          `exec ${JSON.stringify(process.execPath)} --conditions=source --import tsx ${JSON.stringify(entry)} "$@"`,
          "",
        ].join("\n"),
      );
      chmodSync(wrapper, 0o755);
      const context = {
        appVersion: "0.0.0-test",
        daemonBundleDir,
        daemonPort: 1,
        serverEntry: join(root, "server/dist/index.js"),
        serverUrl: "http://127.0.0.1:1",
      };
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        BB_CLI: wrapper,
        TEST_CONTEXT: JSON.stringify(context),
        TEST_HOPS: hops,
      };
      delete env.BB_CLI_REEXEC;

      const result = spawnSync(wrapper, ["thread", "tell", "thr_x", "hi"], {
        cwd: repoRoot,
        encoding: "utf8",
        env,
        timeout: 60_000,
      });

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(readFileSync(hops, "utf8")).toBe(
        "wrapper\nwrapper\nbundled thread tell thr_x hi\n",
      );
    },
    90_000,
  );
});

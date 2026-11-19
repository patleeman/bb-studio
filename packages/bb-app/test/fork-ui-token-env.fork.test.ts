import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  FORK_UI_TOKEN_HASH_ENV,
  withoutForkUiTokenHash,
} from "../src/fork-ui-token-env.js";
import {
  createDaemonEnv,
  resolveBbAppRuntimeState,
  runBundledCliCommand,
} from "../src/launcher.js";

const HASH = "a".repeat(64);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

async function runtimeWithHash() {
  const dataDir = mkdtempSync(join(tmpdir(), "bb-app-ui-token-"));
  dirs.push(dataDir);
  const runtime = await resolveBbAppRuntimeState({
    entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
    env: { BB_DATA_DIR: dataDir, [FORK_UI_TOKEN_HASH_ENV]: HASH },
    homeDir: "/home/tester",
    options: { help: false },
    serverUrlMode: "local",
  });
  return { dataDir, runtime };
}

describe("the bring-over token hash in the launcher", () => {
  it("goes to the server on every start, and never to the host daemon that runs agent shells", async () => {
    const { runtime } = await runtimeWithHash();
    expect(runtime.serverEnv[FORK_UI_TOKEN_HASH_ENV]).toBe(HASH);
    expect(runtime.env[FORK_UI_TOKEN_HASH_ENV]).toBe(HASH);
    const daemonEnv = createDaemonEnv({
      context: runtime.context,
      env: runtime.env,
      serverUrl: runtime.context.serverUrl,
    });
    expect(daemonEnv).not.toHaveProperty(FORK_UI_TOKEN_HASH_ENV);
    const restarted = await resolveBbAppRuntimeState({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: runtime.env,
      homeDir: "/home/tester",
      options: { help: false },
      serverUrlMode: "local",
    });
    expect(restarted.serverEnv[FORK_UI_TOKEN_HASH_ENV]).toBe(HASH);
  });

  it("is not passed to bb commands the launcher runs", async () => {
    const { dataDir, runtime } = await runtimeWithHash();
    const out = join(dataDir, "cli-env.txt");
    const exitCode = await runBundledCliCommand({
      args: [
        "-e",
        `require('node:fs').writeFileSync(process.argv[1], process.env.${FORK_UI_TOKEN_HASH_ENV} ?? 'missing')`,
        out,
      ],
      context: runtime.context,
      env: { ...runtime.env, BB_CLI: process.execPath },
    });
    expect(exitCode).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("missing");
  });

  it("strips only the hash", () => {
    expect(
      withoutForkUiTokenHash({ PATH: "/bin", [FORK_UI_TOKEN_HASH_ENV]: HASH }),
    ).toEqual({ PATH: "/bin" });
  });
});

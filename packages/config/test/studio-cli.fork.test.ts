import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  guardStudioCliEnv,
  isStudioCliPath,
  STUDIO_CLI_ALIAS_MARKER,
  toStudioCommandText,
} from "../src/cli-command.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bbs-cli-env-"));
  scratchDirs.push(dir);
  return dir;
}

const home = "/home/someone";

/** What scripts/fork/studio-cli-aliases.mjs writes next to Studio's bb. */
function writeStudioAliases(dir: string): void {
  for (const name of ["bbs", "bb-studio"]) {
    writeFileSync(join(dir, name), `#!/bin/sh\n# ${STUDIO_CLI_ALIAS_MARKER}\n`);
  }
}

describe("guardStudioCliEnv", () => {
  it("drops stock bb's data folder, server, daemon port and thread context", () => {
    const env: NodeJS.ProcessEnv = {
      BB_DATA_DIR: "~/.bb",
      BB_ENVIRONMENT_ID: "env_stock",
      BB_HOST_DAEMON_PORT: "38887",
      BB_PROJECT_ID: "proj_stock",
      BB_SERVER_URL: "http://127.0.0.1:38886",
      BB_THREAD_ID: "thr_stock",
      PATH: "/usr/bin",
    };
    expect(guardStudioCliEnv(env, home).sort()).toEqual([
      "BB_DATA_DIR",
      "BB_ENVIRONMENT_ID",
      "BB_HOST_DAEMON_PORT",
      "BB_PROJECT_ID",
      "BB_SERVER_URL",
      "BB_THREAD_ID",
    ]);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("matches stock bb's data folder however it is written", () => {
    for (const value of ["/home/someone/.bb", "/home/someone/.bb/", "~/.bb"]) {
      const env: NodeJS.ProcessEnv = { BB_DATA_DIR: value };
      guardStudioCliEnv(env, home);
      expect(env.BB_DATA_DIR).toBeUndefined();
    }
    const env: NodeJS.ProcessEnv = { BB_SERVER_URL: "http://localhost:38886/" };
    guardStudioCliEnv(env, home);
    expect(env.BB_SERVER_URL).toBeUndefined();
  });

  it("keeps Studio's own and scratch values", () => {
    const env: NodeJS.ProcessEnv = {
      BB_DATA_DIR: "/home/someone/.bb-studio",
      BB_HOST_DAEMON_PORT: "39487",
      BB_SERVER_URL: "http://127.0.0.1:38986",
      BB_THREAD_ID: "thr_studio",
    };
    const before = { ...env };
    expect(guardStudioCliEnv(env, home)).toEqual([]);
    expect(env).toEqual(before);

    const remote: NodeJS.ProcessEnv = {
      BB_SERVER_URL: "http://studio.example:38886",
    };
    guardStudioCliEnv(remote, home);
    expect(remote.BB_SERVER_URL).toBe("http://studio.example:38886");
  });

  it("follows a BB_CLI only when Studio's bbs sits next to it", () => {
    const studioBin = scratchDir();
    const stockBin = scratchDir();
    writeFileSync(join(studioBin, "bb"), "");
    writeFileSync(join(stockBin, "bb"), "");
    writeFileSync(join(stockBin, "bbs"), "#!/bin/sh\n# something else\n");
    writeStudioAliases(studioBin);

    const studio: NodeJS.ProcessEnv = { BB_CLI: join(studioBin, "bb") };
    expect(guardStudioCliEnv(studio, home)).toEqual([]);
    expect(studio.BB_CLI).toBe(join(studioBin, "bb"));

    const stock: NodeJS.ProcessEnv = { BB_CLI: join(stockBin, "bb") };
    expect(guardStudioCliEnv(stock, home)).toEqual(["BB_CLI"]);
    expect(stock.BB_CLI).toBeUndefined();
  });

  it("BBS_ALLOW_BB_ENV=1 keeps everything", () => {
    const env: NodeJS.ProcessEnv = {
      BBS_ALLOW_BB_ENV: "1",
      BB_CLI: "/nowhere/bb",
      BB_DATA_DIR: "~/.bb",
      BB_SERVER_URL: "http://127.0.0.1:38886",
    };
    const before = { ...env };
    expect(guardStudioCliEnv(env, home)).toEqual([]);
    expect(env).toEqual(before);
  });
});

describe("isStudioCliPath", () => {
  it("needs Studio's alias file, not just any bbs", () => {
    const dir = scratchDir();
    writeStudioAliases(dir);
    expect(isStudioCliPath(join(dir, "bb"))).toBe(true);
    expect(isStudioCliPath(join(scratchDir(), "bb"))).toBe(false);
  });
});

describe("toStudioCommandText", () => {
  it("renames bb commands in code and leaves prose alone", () => {
    const text = [
      "bb is an agentic IDE. Run `bb status` or `bb guide <chapter>`.",
      "Use `$BB_CLI` and `~/.bb/bin/bb thread list` as they are.",
      "```sh",
      "bb thread list --json",
      'echo "$(bb status)" && bb project list | head',
      "```",
      "The bb CLI talks to the bb server. Send long text with `bb thread tell <id>",
      "--message-file <path>`.",
    ].join("\n");
    expect(toStudioCommandText(text)).toBe(
      [
        "bb is an agentic IDE. Run `bbs status` or `bbs guide <chapter>`.",
        "Use `$BB_CLI` and `~/.bb/bin/bb thread list` as they are.",
        "```sh",
        "bbs thread list --json",
        'echo "$(bbs status)" && bbs project list | head',
        "```",
        "The bb CLI talks to the bb server. Send long text with `bbs thread tell <id>",
        "--message-file <path>`.",
      ].join("\n"),
    );
  });
});

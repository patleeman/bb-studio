// Fork-owned. This file is copied byte for byte to
// apps/cli/src/studio-cli-env.fork.ts, which may load nothing but node
// builtins before a command is chosen (startup-graph.test.ts); a test in
// packages/config/test/studio-cli.fork.test.ts keeps the copies equal.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * BB Studio's CLI is `bbs`, with `bb-studio` as a long alias, so a terminal
 * can hold both it and stock bb's `bb`. Inside BB Studio's own agent shells
 * `bb` also runs Studio's CLI (the host daemon's bin folder comes first on
 * PATH and holds `bb`, `bbs` and `bb-studio`).
 */
export const STUDIO_CLI_NAME = "bbs";
export const STUDIO_CLI_ALIASES: readonly string[] = ["bb-studio"];
export const STUDIO_CLI_NAMES: readonly string[] = [
  STUDIO_CLI_NAME,
  ...STUDIO_CLI_ALIASES,
];

/** Written into the `bbs` and `bb-studio` files next to Studio's bundled CLI. */
export const STUDIO_CLI_ALIAS_MARKER =
  "Written by BB Studio: runs BB Studio's bb command next to this file.";

/** Set to 1 to let Studio's CLI use stock bb's data folder, server or CLI. */
export const STUDIO_CLI_ALLOW_BB_ENV_NAME = "BBS_ALLOW_BB_ENV";

const STOCK_BB_DATA_DIR_NAME = ".bb";
const STOCK_BB_SERVER_PORT = "38886";
const STOCK_BB_HOST_DAEMON_PORT = "38887";
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);
const STOCK_SHELL_CONTEXT_KEYS: readonly string[] = [
  "BB_ENVIRONMENT_ID",
  "BB_PROJECT_ID",
  "BB_THREAD_ID",
  "BB_THREAD_STORAGE",
];

function isStockDataDir(value: string, homeDir: string): boolean {
  const trimmed = value.trim();
  const expanded =
    trimmed === "~"
      ? homeDir
      : /^~[\\/]/u.test(trimmed)
        ? join(homeDir, trimmed.slice(2))
        : trimmed;
  return (
    expanded.length > 0 &&
    resolve(expanded) === resolve(homeDir, STOCK_BB_DATA_DIR_NAME)
  );
}

function isStockServerUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (
      LOOPBACK_HOSTNAMES.has(url.hostname) && url.port === STOCK_BB_SERVER_PORT
    );
  } catch {
    return false;
  }
}

/**
 * A BB_CLI is Studio's when Studio's `bbs` sits next to it: Studio's host
 * daemon bin folder holds both, stock bb's holds only `bb`.
 */
function isStudioAliasFile(path: string): boolean {
  try {
    return (
      statSync(path).size < 4096 &&
      readFileSync(path, "utf8").includes(STUDIO_CLI_ALIAS_MARKER)
    );
  } catch {
    return false;
  }
}

export function isStudioCliPath(cliPath: string): boolean {
  const directory = dirname(cliPath);
  return STUDIO_CLI_NAMES.some(
    (name) =>
      isStudioAliasFile(join(directory, name)) ||
      isStudioAliasFile(join(directory, `${name}.cmd`)),
  );
}

/**
 * Drops what stock bb's shell or `bb` command hands to Studio's CLI: stock
 * bb's data folder (~/.bb), its server and host daemon on their default ports
 * (with that shell's thread context), and a BB_CLI that is not Studio's (the
 * CLI would otherwise run stock bb's CLI). Studio's own defaults then apply.
 * BBS_ALLOW_BB_ENV=1 keeps everything. Returns the names it dropped.
 */
export function guardStudioCliEnv(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): string[] {
  if (env[STUDIO_CLI_ALLOW_BB_ENV_NAME] === "1") {
    return [];
  }
  const dropped: string[] = [];
  const drop = (key: string): void => {
    if (env[key] !== undefined) {
      delete env[key];
      dropped.push(key);
    }
  };
  if (
    env.BB_DATA_DIR !== undefined &&
    isStockDataDir(env.BB_DATA_DIR, homeDir)
  ) {
    drop("BB_DATA_DIR");
  }
  if (env.BB_SERVER_URL !== undefined && isStockServerUrl(env.BB_SERVER_URL)) {
    drop("BB_SERVER_URL");
    for (const key of STOCK_SHELL_CONTEXT_KEYS) {
      drop(key);
    }
  }
  if (env.BB_HOST_DAEMON_PORT?.trim() === STOCK_BB_HOST_DAEMON_PORT) {
    drop("BB_HOST_DAEMON_PORT");
  }
  const cli = env.BB_CLI?.trim();
  if (cli !== undefined && cli.length > 0 && !isStudioCliPath(cli)) {
    drop("BB_CLI");
  }
  return dropped;
}

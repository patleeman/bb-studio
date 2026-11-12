import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** One staging-owned descriptor is the source of HTTP, CLI and database routing. */
export function readStagedInstance(env = process.env) {
  if (!env.BB_CAPTURE_INSTANCE) throw new Error("Source the staged BB's capture.env first (missing BB_CAPTURE_INSTANCE).");
  const path = realpathSync(env.BB_CAPTURE_INSTANCE);
  const dir = dirname(path);
  const instance = JSON.parse(readFileSync(path, "utf8"));
  const realBB = join(homedir(), ".bb");
  if (dir === homedir() || dir === dirname(dir) || dir === realBB || dir.startsWith(`${realBB}/`) || path !== join(dir, "instance.json") ||
      instance.kind !== "bb-studio-staged" || instance.directory !== dir ||
      instance.dataDir !== join(dir, "data") || instance.cli !== join(dir, "bb-app/node_modules/.bin/bb") ||
      !Number.isInteger(instance.port) || instance.port < 1024 || instance.port > 65531 ||
      instance.serverUrl !== `http://127.0.0.1:${instance.port}` || instance.cdpPort !== instance.port + 2 ||
      !existsSync(instance.cli) || !realpathSync(instance.cli).startsWith(`${dir}/bb-app/`) || realpathSync(instance.dataDir) !== instance.dataDir) {
    throw new Error(`Invalid staged instance descriptor: ${path}`);
  }
  for (const [key, expected] of [["BB_DATA_DIR", instance.dataDir], ["BB_SERVER_URL", instance.serverUrl], ["BB_CAPTURE_CDP_PORT", String(instance.cdpPort)]]) {
    if (env[key] !== undefined && env[key] !== expected) throw new Error(`${key} disagrees with ${path}`);
  }
  return instance;
}

// No BB_CLI: the bb launcher re-execs to BB_CLI with the same environment, so
// pointing it at the staged launcher itself spawns copies until fork fails.
export function captureEnv(instance, env = process.env) {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("BB_"))),
    BB_DATA_DIR: instance.dataDir,
    BB_SERVER_URL: instance.serverUrl,
    BB_HOST_DAEMON_PORT: String(instance.port + 1),
  };
}

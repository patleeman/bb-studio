#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "apps", "cli", "dist", "index.js");

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    console.error(`failed: ${command} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}

function pluginDirs(argv) {
  if (argv.length > 0) return argv.map((dir) => resolve(dir));
  const optionsPath = join(homedir(), ".bb-studio-import.json");
  if (!existsSync(optionsPath)) return monorepoPluginDirs();
  const { pluginPaths } = JSON.parse(readFileSync(optionsPath, "utf8"));
  return Object.values(pluginPaths ?? {}).filter(
    (dir) => typeof dir === "string",
  );
}

function monorepoPluginDirs() {
  const packages = [
    resolve(root, "..", "bb-studio-app", "plugins", "packages"),
    resolve(root, "..", "plugins", "packages"),
  ].find((dir) => existsSync(dir));
  if (packages === undefined) return [];
  return readdirSync(packages)
    .map((name) => join(packages, name))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

const dirs = pluginDirs(process.argv.slice(2));
if (dirs.length === 0) {
  console.error(
    "usage: node scripts/fork/build-plugins.mjs [plugin dir ...] (default: pluginPaths in ~/.bb-studio-import.json, or every package in the monorepo's plugins/packages)",
  );
  process.exit(2);
}

run("pnpm", ["exec", "turbo", "run", "build", "--filter=@bb/cli"], {
  cwd: root,
});
const builtAt = statSync(cli).mtimeMs;
for (const dir of dirs) {
  run(process.execPath, [cli, "plugin", "build", "."], {
    cwd: dir,
    env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "" },
  });
  const bundle = join(dir, "dist", "app.js");
  if (existsSync(bundle) && statSync(bundle).mtimeMs < builtAt) {
    console.error(`${bundle} is older than the CLI that should have built it`);
    process.exit(1);
  }
  console.log(`built ${dir}`);
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO_BUNDLED_PLUGINS = ["bb-studio", "bb-studio-visual-chat"];

const SKIPPED = new Set(["node_modules", ".turbo"]);

export function runtimePackageJson(source) {
  const bb = { ...source.bb, server: "./dist/server.js" };
  if (source.bb.app !== undefined) bb.app = "./dist/app.js";
  if (source.bb.host !== undefined) bb.host = "./dist/host.js";
  return { ...source, bb };
}

export function copyRuntime(sourceDir, targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (entry) => {
      const first = relative(sourceDir, entry).split(sep)[0];
      return !SKIPPED.has(first) && !first.startsWith(".bundled-");
    },
  });
  const source = JSON.parse(
    readFileSync(join(sourceDir, "package.json"), "utf8"),
  );
  writeFileSync(
    join(targetDir, "package.json"),
    `${JSON.stringify(runtimePackageJson(source), null, 2)}\n`,
  );
}

function fail(message) {
  console.error(`bundle-studio-plugins: ${message}`);
  process.exit(1);
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const option = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1];
  };
  const packages = option("--packages");
  const outs = argv
    .map((arg, index) => (arg === "--out" ? argv[index + 1] : null))
    .filter((value) => value !== null);
  if (packages === null || outs.length === 0 || argv.includes("--help")) {
    console.log(`Build Studio and Visual Chat with this checkout's CLI and write their bundled copies.

  node scripts/fork/bundle-studio-plugins.mjs --packages <monorepo plugins/packages> --out <dir> [--out <dir>]

Each --out gets <dir>/bb-studio and <dir>/bb-studio-visual-chat: the package without
node_modules, its dist/ from \`bb plugin build\`, and a package.json whose entries
point at dist/. Point --out at packages/bb-app/server/dist/builtin-plugins
before electron-builder runs.`);
    process.exit(packages === null || outs.length === 0 ? 2 : 0);
  }
  const cli = join(root, "apps", "cli", "dist", "index.js");
  if (!existsSync(cli)) fail(`${cli} is missing: build the CLI first`);
  for (const name of STUDIO_BUNDLED_PLUGINS) {
    const dir = resolve(packages, name);
    if (!existsSync(join(dir, "package.json")))
      fail(`${dir} has no package.json`);
    const built = spawnSync(process.execPath, [cli, "plugin", "build", "."], {
      cwd: dir,
      stdio: "inherit",
      env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "" },
    });
    if (built.status !== 0) fail(`bb plugin build failed in ${dir}`);
    for (const file of ["server.js", "server.meta.json"]) {
      if (!existsSync(join(dir, "dist", file)))
        fail(`${dir}/dist/${file} is missing`);
    }
    for (const out of outs) {
      copyRuntime(dir, resolve(out, name));
      console.log(`bundled ${name} into ${resolve(out, name)}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

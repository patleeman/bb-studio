#!/usr/bin/env node
// Rebuild the vendored Thread List source from a BB commit, then apply Studio's hooks.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
const upstream = resolve(option("--upstream") ?? "/Users/patrick/workingdir/bb");
const commit = option("--commit") ?? "HEAD";
const check = args.includes("--check");
const prefix = "plugins/thread-list/";
const destination = join(repo, "packages/bb-studio-sidebar/source");
const staging = mkdtempSync(join(tmpdir(), "bb-sidebar-sync-"));
const run = (command, argv, cwd) => execFileSync(command, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  const sha = run("git", ["rev-parse", commit], upstream).trim();
  const names = run("git", ["ls-tree", "-r", "--name-only", sha, "--", "plugins/thread-list"], upstream)
    .trim().split("\n").filter((name) => name.startsWith(prefix));
  for (const name of names) {
    const relative = name.slice(prefix.length);
    if (!/^(app\.tsx|app\.test\.tsx|server\.ts|server\.test\.ts|app\/|shared\/)/u.test(relative)) continue;
    const output = join(staging, "source", relative);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, execFileSync("git", ["show", `${sha}:${name}`], { cwd: upstream }));
  }
  for (const patch of ["studio-hooks.patch", "tests.patch"]) {
    const file = join(repo, "scripts/sidebar-patches", patch);
    if (!readFileSync(file, "utf8").trim()) continue;
    try {
      run("git", ["apply", "--unidiff-zero", "--check", file], staging);
      run("git", ["apply", "--unidiff-zero", file], staging);
    } catch (error) {
      console.error(`Conflict applying ${patch} to BB ${sha}:`);
      console.error(error.stderr?.toString() ?? error.message);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) {
    const fixture = join(staging, "source/app/model/fixtures.ts");
    const relocated = join(staging, "source/app/testing/fixtures.ts");
    mkdirSync(dirname(relocated), { recursive: true });
    renameSync(fixture, relocated);
    writeFileSync(relocated, readFileSync(relocated, "utf8").replace('"./use-sidebar-data.js"', '"../model/use-sidebar-data.js"'));
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });
    const generated = walk(join(staging, "source"));
    const protectedPaths = new Set(["app/testing/fixtures.ts"]);
    const local = walk(destination).map((file) => file.slice(destination.length + 1));
    const generatedPaths = new Set(generated.map((file) => file.slice(join(staging, "source").length + 1)));
    const extra = local.filter((path) => !path.startsWith("app/studio/") && !protectedPaths.has(path) && !generatedPaths.has(path));
    if (extra.length) {
      console.error(`Conflict: local source files absent from BB ${sha}: ${extra.join(", ")}`);
      process.exitCode = 1;
    }
    const differences = generated.filter((file) => {
      const target = join(destination, file.slice(join(staging, "source").length + 1));
      return !existsSync(target) || !readFileSync(file).equals(readFileSync(target));
    });
    console.log(`BB ${sha}: ${generated.length} source files, ${differences.length} changed after Studio patches.`);
    if (!check && !process.exitCode) {
      for (const file of generated) {
        const target = join(destination, file.slice(join(staging, "source").length + 1));
        mkdirSync(dirname(target), { recursive: true });
        cpSync(file, target);
      }
      rmSync(join(destination, "app/model/fixtures.ts"), { force: true });
      console.log(`Synced ${basename(destination)}. Update UPSTREAM.md with ${sha} after review.`);
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

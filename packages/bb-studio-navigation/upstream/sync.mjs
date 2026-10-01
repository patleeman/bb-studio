#!/usr/bin/env node
// Rebuild the vendored Navigation source and the shared UI it imports from a
// BB commit, then apply Studio's hooks.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const option = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
if (!option("--upstream")) throw new Error("Usage: node upstream/sync.mjs --upstream <bb checkout> [--commit <sha>] [--check]");
const upstream = resolve(option("--upstream"));
const commit = option("--commit") ?? "HEAD";
const check = args.includes("--check");
const prefix = "plugins/navigation/";
const sharedUi = "packages/shared-ui/src/";
// The registry swaps the shared icon for the host's, as BB's own copy does.
const iconFlavor = "packages/plugin-registry/flavors/components/ui/icon.tsx";
const vendored = ["source", "components", "lib"];
const staging = mkdtempSync(join(tmpdir(), "bb-navigation-sync-"));
const run = (command, argv, cwd) => execFileSync(command, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  const sha = run("git", ["rev-parse", commit], upstream).trim();
  const show = (name) => execFileSync("git", ["show", `${sha}:${name}`], { cwd: upstream });
  const tracked = new Set(run("git", ["ls-tree", "-r", "--name-only", sha, "--", "plugins/navigation", "packages/shared-ui/src"], upstream).trim().split("\n"));
  const write = (relative, contents) => {
    const output = join(staging, relative);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, contents);
  };

  // Follow `@/` imports from the plugin, then `@/` and relative imports
  // through shared-ui, as paths under shared-ui's `src`.
  const pending = [];
  const enqueue = (source, from) => {
    for (const [, specifier] of source.matchAll(/from "(@\/[^"]+|\.{1,2}\/[^"]+)"/gu)) {
      if (specifier.startsWith("@/")) pending.push(specifier.slice(2));
      else if (from !== null) pending.push(posix.join(posix.dirname(from), specifier).replace(/\.js$/u, ""));
    }
  };
  for (const name of tracked) {
    if (!name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    if (!/^(app\.tsx|app\.test\.tsx|server\.ts|app\/)/u.test(relative)) continue;
    const contents = show(name);
    write(join("source", relative), contents);
    enqueue(contents.toString(), null);
  }
  const seen = new Set();
  while (pending.length) {
    const specifier = pending.pop();
    if (seen.has(specifier)) continue;
    seen.add(specifier);
    if (specifier === "components/ui/icon") {
      write("components/ui/icon.tsx", show(iconFlavor));
      continue;
    }
    const name = [".ts", ".tsx", "/index.ts"].map((extension) => `${sharedUi}${specifier}${extension}`).find((path) => tracked.has(path));
    if (!name) throw new Error(`BB ${sha} has no shared-ui module for @/${specifier}`);
    const contents = show(name);
    write(name.slice(sharedUi.length), contents);
    enqueue(contents.toString(), name.slice(sharedUi.length));
  }

  const file = join(here, "studio-hooks.patch");
  if (readFileSync(file, "utf8").trim()) {
    try {
      run("git", ["apply", "--unidiff-zero", "--check", file], staging);
      run("git", ["apply", "--unidiff-zero", file], staging);
    } catch (error) {
      console.error(`Conflict applying studio-hooks.patch to BB ${sha}:`);
      console.error(error.stderr?.toString() ?? error.message);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    const walk = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }) : [];
    const relativeTo = (base) => (path) => path.slice(base.length + 1);
    const generated = vendored.flatMap((dir) => walk(join(staging, dir))).map(relativeTo(staging));
    const generatedPaths = new Set(generated);
    const local = vendored.flatMap((dir) => walk(join(root, dir))).map(relativeTo(root));
    const extra = local.filter((path) => !path.startsWith("source/app/studio/") && !generatedPaths.has(path));
    if (extra.length) {
      console.error(`Conflict: local files absent from BB ${sha}: ${extra.join(", ")}`);
      process.exitCode = 1;
    }
    const differences = generated.filter((path) => {
      const target = join(root, path);
      return !existsSync(target) || !readFileSync(join(staging, path)).equals(readFileSync(target));
    });
    console.log(`BB ${sha}: ${generated.length} vendored files, ${differences.length} changed after Studio patches.`);
    if (check && differences.length) process.exitCode = 1;
    if (!check && !process.exitCode) {
      for (const path of generated) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        cpSync(join(staging, path), join(root, path));
      }
      console.log(`Synced ${basename(root)}. Update UPSTREAM.md with ${sha} after review.`);
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

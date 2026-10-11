#!/usr/bin/env node
// Promote a commit on main to the `stable` branch, which every marketplace
// entry installs from. Work lands on main all day, some of it mid-feature;
// users only get what passes here.
//
//   node scripts/release.mjs [--ref <commit>] [--dry-run] [--skip-tests] [--solo]
//
// The commit (default: origin/main) must be on origin/main and a fast-forward
// of origin/stable. It's checked out alone in a temporary worktree, so other
// agents' uncommitted work in this checkout can't make it pass or fail, and
// these must pass there: the repo checks, every package's typecheck and tests
// (unless --skip-tests), and with --solo the one-plugin-at-a-time install check.
// Then origin/stable moves to it. Never force: a non-fast-forward is refused.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1] ?? null; };
const flag = (name) => args.includes(name);
const git = (...argv) => execFileSync("git", argv, { cwd: repo, encoding: "utf8" }).trim();
const isAncestor = (ancestor, commit) => spawnSync("git", ["merge-base", "--is-ancestor", ancestor, commit], { cwd: repo }).status === 0;

git("fetch", "--quiet", "origin");
const sha = git("rev-parse", "--verify", `${option("--ref") ?? "origin/main"}^{commit}`);
const short = sha.slice(0, 8);
if (!isAncestor(sha, "origin/main")) throw new Error(`${short} isn't on origin/main. Push it to main first.`);
const stable = spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/stable"], { cwd: repo, encoding: "utf8" }).stdout.trim() || null;
if (stable === sha) { console.log(`stable is already at ${short}.`); process.exit(0); }
if (stable && !isAncestor(stable, sha)) throw new Error(`${short} isn't a fast-forward of stable (${stable.slice(0, 8)}). Release a later commit on main.`);

const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "bb-studio-release-"));
const tree = join(work, "repo");
const results = [];
let failed = false;
try {
  git("worktree", "add", "--quiet", "--detach", tree, sha);
  // Reuse this checkout's installed dependencies; the release commit's own
  // locks must match them, which the kit check and tests below rely on.
  // Each entry is linked one by one so @bb-studio/kit can point at the release
  // commit's kit, not this checkout's, which may hold uncommitted edits.
  const link = (relative) => {
    const from = join(repo, relative, "node_modules");
    const to = join(tree, relative, "node_modules");
    if (!existsSync(from) || !existsSync(join(tree, relative)) || existsSync(to)) return;
    mkdirSync(to);
    for (const entry of readdirSync(from)) {
      if (entry === "@bb-studio") {
        mkdirSync(join(to, entry));
        for (const scoped of readdirSync(join(from, entry))) {
          symlinkSync(scoped === "kit" ? join(tree, "packages", "bb-studio-kit") : join(from, entry, scoped), join(to, entry, scoped), "dir");
        }
      } else symlinkSync(join(from, entry), join(to, entry));
    }
  };
  link(".");
  const packages = readdirSync(join(tree, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(tree, "packages", entry.name, "package.json"))).map((entry) => entry.name);
  for (const name of packages) link(join("packages", name));

  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache || join(work, "npm-cache") };
  const step = (label, command, argv, cwd = tree) => {
    const result = spawnSync(command, argv, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const ok = result.status === 0;
    if (!ok) failed = true;
    results.push({ label, ok });
    console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
    if (!ok) console.log(`${result.stdout}${result.stderr}`.trim().split("\n").slice(-20).map((line) => `      ${line}`).join("\n"));
    return ok;
  };

  console.log(`Checking ${short} for stable${stable ? ` (now ${stable.slice(0, 8)})` : ""}:`);
  for (const check of ["check-marketplace", "check-docs", "check-icons", "check-sdk-compat", "check-native-payload-fixtures"]) {
    step(check, process.execPath, [join("scripts", `${check}.mjs`)]);
  }
  step("contracts", join(tree, "node_modules", ".bin", "tsx"), [join("scripts", "gen-contracts.mjs"), "--check"]);
  step("kit tarball", "sh", [join("scripts", "pack-kit.sh"), "--check"]);
  if (!flag("--skip-tests")) {
    for (const name of packages) {
      const dir = join(tree, "packages", name);
      const bin = (tool) => join(dir, "node_modules", ".bin", tool);
      const config = readdirSync(dir).find((file) => /^vitest\.config\.[cm]?[jt]s$/.test(file));
      const hasTests = Boolean(config) || existsSync(join(dir, "test")) || readdirSync(dir).some((file) => file.endsWith(".test.ts"));
      // A package whose dependencies this checkout never installed (a new
      // package before `pnpm install`) would otherwise skip its checks silently.
      if (existsSync(join(dir, "tsconfig.json")) && !existsSync(bin("tsc"))) {
        failed = true;
        results.push({ label: `${name} typecheck`, ok: false });
        console.log(`FAIL  ${name} typecheck: its dependencies aren't installed in this checkout; run pnpm install, then release again`);
      } else if (existsSync(bin("tsc"))) step(`${name} typecheck`, bin("tsc"), ["--noEmit"], dir);
      if (hasTests && !existsSync(bin("vitest"))) {
        failed = true;
        results.push({ label: `${name} tests`, ok: false });
        console.log(`FAIL  ${name} tests: its dependencies aren't installed in this checkout; run pnpm install, then release again`);
      } else if (hasTests) step(`${name} tests`, bin("vitest"), ["run", ...(config ? ["--config", config] : [])], dir);
    }
  }
  // Build each plugin the way BB installs it from Git: its package directory
  // alone beside the packed kit, `npm install --omit=dev` as BB runs it, then
  // `bb plugin build`. The workspace's shared node_modules can hide a missing
  // dependency or a frontend import that only resolves there.
  const plugins = JSON.parse(execFileSync("git", ["show", `${sha}:.bb/plugins.json`], { cwd: repo, encoding: "utf8" })).plugins;
  const builds = join(work, "builds");
  for (const { name, source } of plugins) {
    const dir = join(builds, "packages", source.replace(/^\.\/packages\//, ""));
    mkdirSync(join(builds, "packages"), { recursive: true });
    cpSync(join(tree, source), dir, { recursive: true, filter: (path) => !/\/(node_modules|dist)(\/|$)/.test(path.slice(join(tree, source).length)) });
    if (!existsSync(join(builds, "packages", "bb-studio-kit.tgz"))) cpSync(join(tree, "packages", "bb-studio-kit.tgz"), join(builds, "packages", "bb-studio-kit.tgz"));
    // Same command BB runs (apps/server/src/services/plugins/git-plugin-dependencies.ts).
    if (step(`${name} clean install`, "npm", ["install", "--prefix", dir, "--ignore-scripts", "--omit=dev", "--omit=optional", "--no-audit", "--no-fund"], dir)) step(`${name} build`, "bb", ["plugin", "build", "."], dir);
  }
  if (flag("--solo")) {
    const solo = join(tree, "scripts", "solo-check.mjs");
    if (existsSync(solo)) step("solo installs", process.execPath, [solo, "--ref", sha]);
    else { failed = true; console.log("FAIL  solo installs: scripts/solo-check.mjs isn't in this commit"); }
  }
} finally {
  spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: repo });
  rmSync(work, { recursive: true, force: true });
}

const passed = results.filter((result) => result.ok).length;
if (failed) {
  console.log(`\n${passed} of ${results.length} passed. stable stays at ${stable?.slice(0, 8) ?? "nothing"}.`);
  process.exit(1);
}
if (flag("--dry-run")) {
  console.log(`\nAll ${results.length} passed. Dry run: stable not moved.`);
  process.exit(0);
}
execFileSync("git", ["push", "origin", `${sha}:refs/heads/stable`], { cwd: repo, stdio: "inherit" });
console.log(`\nAll ${results.length} passed. stable is now ${short}.`);

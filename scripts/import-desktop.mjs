#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const STACK = "refs/heads/desktop";
const COAUTHOR = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";

if (args.includes("--help")) {
  console.log(`Import the tree of the desktop branch as desktop/ on main.

  node scripts/import-desktop.mjs [--check] [--skip-ledger]

Run it in the main worktree. It makes one merge commit whose second parent is
the tip of the desktop branch and whose desktop/ tree is exactly that tip's
tree. It does nothing when desktop/ already equals the tip's tree.
--check only compares the two trees and exits 1 when they differ.
--skip-ledger skips check-core-diff (it needs a worktree with desktop checked out).`);
  process.exit(0);
}

const git = (...argv) =>
  execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();
const tryGit = (...argv) => spawnSync("git", argv, { cwd: root, encoding: "utf8" });
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const stackTree = git("rev-parse", `${STACK}^{tree}`);
const imported = tryGit("rev-parse", "-q", "--verify", "HEAD:desktop");
const importedTree = imported.status === 0 ? imported.stdout.trim() : "";

if (args.includes("--check")) {
  if (importedTree !== stackTree) {
    fail(`main:desktop ${importedTree || "(none)"} differs from desktop^{tree} ${stackTree}`);
  }
  console.log(`main:desktop equals desktop^{tree} ${stackTree}`);
  process.exit(0);
}

if (git("rev-parse", "--show-prefix") !== "") fail("Run this at the root of the main worktree.");
if (git("branch", "--show-current") !== "main") fail("Run this on the main branch.");
if (git("status", "--porcelain") !== "") fail("The main worktree is not clean.");
if (importedTree === stackTree) {
  console.log(`desktop/ already equals desktop^{tree} ${stackTree}`);
  process.exit(0);
}

if (!args.includes("--skip-ledger")) {
  const blocks = git("worktree", "list", "--porcelain").split("\n\n");
  const block = blocks.find((entry) => /^branch refs\/heads\/desktop$/m.test(entry));
  const worktree = block?.match(/^worktree (.+)$/m)?.[1];
  const script = worktree && join(worktree, "scripts/fork/check-core-diff.mjs");
  if (!script || !existsSync(script)) {
    fail("No worktree has the desktop branch checked out; check-core-diff cannot run. Use --skip-ledger to import anyway.");
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: worktree, encoding: "utf8" }).trim();
  if (dirty !== "") fail(`The desktop worktree ${worktree} is not clean.`);
  const checked = spawnSync(process.execPath, [script, "--cwd", worktree, "--base", "upstream/main"], {
    cwd: worktree,
    encoding: "utf8",
  });
  if (checked.status !== 0) {
    fail(`check-core-diff failed on desktop:\n${checked.stderr}`);
  }
}

const tip = git("rev-parse", "--short=10", STACK);
const base = git("merge-base", STACK, "upstream/main").slice(0, 10);
execFileSync("git", ["merge", "-s", "ours", "--no-commit", "--allow-unrelated-histories", STACK], {
  cwd: root,
  stdio: "inherit",
});
git("rm", "-rq", "--ignore-unmatch", "desktop");
git("read-tree", "--prefix=desktop/", "-u", STACK);
git("commit", "-q", "-m", `desktop: import ${tip} (upstream ${base})`, "-m", COAUTHOR);
if (git("rev-parse", "HEAD:desktop") !== stackTree) {
  fail("The imported desktop/ tree does not equal desktop^{tree}.");
}
console.log(`imported desktop ${tip} (upstream ${base}); main is ${git("rev-parse", "--short=10", "HEAD")}`);

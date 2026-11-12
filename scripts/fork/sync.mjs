#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveImportConflictsInFile } from "./import-conflicts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const flag = (name) => args.includes(name);

if (flag("--help")) {
  console.log(`Replay the fork onto a newer upstream commit, in a throwaway worktree.

  node scripts/fork/sync.mjs [--onto upstream/main] [--source desktop]
                             [--candidate desktop-candidate]
                             [--fetch] [--checks none|quick|full] [--keep]
                             [--continue <worktree>]

It never moves or checks out the source branch. On success it moves only the
local candidate branch. On a conflict it stops and leaves the worktree; fix the
files there, run "git cherry-pick --continue", then rerun with
--continue <worktree>. Conflicts that only touch import lines are resolved by
the script (upstream's imports plus the ones the fork commit added); typecheck
is the safety net. git rerere is off: no recorded resolution is replayed.
Nothing is pushed. Run it in the desktop worktree, not in main's desktop/.
Worktrees and reports go to ../.bb-studio-fork-sync (BB_STUDIO_SYNC_DIR
overrides it).`);
  process.exit(0);
}

const SOURCE = option("--source", "desktop");
const ONTO = option("--onto", "upstream/main");
const CANDIDATE = option("--candidate", "desktop-candidate");
const CHECKS = option("--checks", "quick");
const resumeDir = option("--continue", undefined);
const TRAILER = "Fork-Generated";
const COAUTHOR = "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>";

const git = (cwd, ...argv) =>
  execFileSync("git", argv, { cwd, encoding: "utf8" }).trim();
const tryGit = (cwd, ...argv) =>
  spawnSync("git", argv, { cwd, encoding: "utf8" });

if (git(root, "rev-parse", "--show-prefix") !== "") {
  fail("Run sync.mjs in the desktop worktree, not in main's desktop/.");
}
const sourceRef = git(root, "rev-parse", "--verify", SOURCE);
if (CANDIDATE === SOURCE) {
  fail(`The candidate branch must not be the source branch (${SOURCE}).`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const syncRoot =
  process.env.BB_STUDIO_SYNC_DIR ?? resolve(root, "..", ".bb-studio-fork-sync");
mkdirSync(syncRoot, { recursive: true });
const worktree = resumeDir ? resolve(resumeDir) : join(syncRoot, stamp);
const reportPath = join(syncRoot, `report-${stamp}.md`);
const report = [`# Fork sync ${stamp}`, ""];
const note = (line) => {
  report.push(line);
  console.log(line);
};
const finish = (ok) => {
  report.push("", ok ? "Result: OK" : "Result: STOPPED");
  writeFileSync(reportPath, `${report.join("\n")}\n`);
  console.log(`report: ${reportPath}`);
  process.exit(ok ? 0 : 1);
};

if (flag("--fetch")) {
  const remote = ONTO.split("/")[0];
  note(`fetch ${remote}`);
  git(root, "fetch", "--no-tags", remote);
}

const ontoRef = git(root, "rev-parse", "--verify", ONTO);
const base = git(root, "merge-base", sourceRef, ontoRef);
const all = git(root, "rev-list", "--reverse", `${base}..${sourceRef}`)
  .split("\n")
  .filter(Boolean);
const isGenerated = (commit) =>
  git(
    root,
    "log",
    "-1",
    `--format=%(trailers:key=${TRAILER},valueonly)`,
    commit,
  ) !== "";
const hand = all.filter((commit) => !isGenerated(commit));
note(`source ${SOURCE} ${sourceRef.slice(0, 10)}`);
note(`onto ${ONTO} ${ontoRef.slice(0, 10)} (fork base ${base.slice(0, 10)})`);
note(
  `${hand.length} hand commits to replay, ${all.length - hand.length} generated commits to rebuild`,
);

if (!resumeDir) {
  git(root, "worktree", "add", "--detach", worktree, ontoRef);
}
if (!existsSync(worktree)) fail(`No worktree at ${worktree}`);
git(worktree, "config", "rerere.enabled", "false");
git(worktree, "config", "merge.conflictStyle", "diff3");

const done = new Set(
  git(
    worktree,
    "log",
    "--format=%(trailers:key=Fork-Source,valueonly)",
    `${ontoRef}..HEAD`,
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);

for (const commit of hand) {
  if (done.has(commit)) continue;
  const subject = git(root, "log", "-1", "--format=%s", commit);
  const picked = tryGit(
    worktree,
    "-c",
    "rerere.enabled=false",
    "cherry-pick",
    "--allow-empty",
    commit,
  );
  if (picked.status !== 0) {
    const unmerged = git(worktree, "status", "--porcelain")
      .split("\n")
      .filter((line) => /^(U.|.U|AA|DD) /.test(line));
    const unresolved = unmerged.map((line) => line.slice(3));
    const importOnly = [];
    const stillMarked = unmerged
      .filter((line) => {
        const file = join(worktree, line.slice(3));
        if (!/^UU /.test(line) || !existsSync(file)) return true;
        const result = resolveImportConflictsInFile(file);
        if (result.resolved > 0 && result.unresolved === 0) {
          importOnly.push(line.slice(3));
        }
        return /^(<<<<<<<|>>>>>>>) /m.test(readFileSync(file, "utf8"));
      })
      .map((line) => line.slice(3));
    if (unresolved.length === 0 || stillMarked.length > 0) {
      note(`CONFLICT in "${subject}" (${commit.slice(0, 10)})`);
      for (const file of unresolved) {
        note(
          `  ${file}${importOnly.includes(file) ? " (imports resolved by the script)" : ""}`,
        );
      }
      note("");
      note(`Fix the files in ${worktree}, then:`);
      note(`  git -C ${worktree} status --short`);
      note(
        `  git -C ${worktree} add <each file you fixed> && git -C ${worktree} cherry-pick --continue`,
      );
      note(
        `  git -C ${worktree} commit --amend --no-edit --trailer "Fork-Source: ${commit}"`,
      );
      note(
        `  node scripts/fork/sync.mjs --continue ${worktree} --onto ${ONTO}`,
      );
      finish(false);
    }
    git(worktree, "add", "--", ...unresolved);
    const continued = spawnSync(
      "git",
      ["-c", "core.editor=true", "cherry-pick", "--continue"],
      { cwd: worktree, encoding: "utf8" },
    );
    if (continued.status !== 0) {
      note(
        `Could not continue after resolving imports in "${subject}": ${continued.stderr}`,
      );
      finish(false);
    }
    note(
      `replayed with import-only conflicts resolved by the script: ${subject} (${importOnly.join(", ")})`,
    );
  }
  git(
    worktree,
    "commit",
    "--amend",
    "--no-edit",
    "--allow-empty",
    "--trailer",
    `Fork-Source: ${commit}`,
  );
}
note(`replayed ${hand.length} hand commits`);

const run = (label, command, argv) => {
  const started = Date.now();
  const result = spawnSync(command, argv, {
    cwd: worktree,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (result.status !== 0) {
    const logPath = join(
      syncRoot,
      `${stamp}-${label.replace(/\W+/g, "-")}.log`,
    );
    writeFileSync(logPath, `${result.stdout}\n${result.stderr}`);
    note(`FAILED ${label} (${seconds}s), log: ${logPath}`);
    finish(false);
  }
  note(`ok ${label} (${seconds}s)`);
};

const commitGenerated = (kind, script, body) => {
  git(worktree, "add", "-A");
  if (tryGit(worktree, "diff", "--cached", "--quiet").status === 0) {
    note(`${kind}: nothing to commit`);
    return;
  }
  git(
    worktree,
    "commit",
    "-q",
    "-m",
    `fork: ${kind} (generated by scripts/fork/${script})`,
    "-m",
    body,
    "-m",
    `${TRAILER}: ${kind}\n${COAUTHOR}`,
  );
};

run("core diff against the ledger", "node", [
  "scripts/fork/check-core-diff.mjs",
  "--base",
  ontoRef,
]);
run("strip and install", "node", ["scripts/fork/strip-plugins.mjs"]);
commitGenerated(
  "strip removed plugins",
  "strip-plugins.mjs",
  "Do not rebase this commit. Drop it and run the script again.",
);
run("identity", "node", ["scripts/fork/identity.mjs"]);
commitGenerated(
  "identity",
  "identity.mjs",
  "Do not rebase this commit. Drop it and run the script again.",
);
run("rebrand", "node", ["scripts/fork/rebrand.mjs"]);
commitGenerated(
  "rebrand",
  "rebrand.mjs",
  "Do not rebase this commit. Drop it and run the script again (after pnpm install; the icon generator needs sharp).",
);

if (CHECKS !== "none") {
  run("typecheck", "pnpm", ["exec", "turbo", "run", "typecheck"]);
  run("build", "pnpm", ["exec", "turbo", "run", "build"]);
  const filters =
    CHECKS === "full"
      ? []
      : ["@bb/server", "@bb/web", "@bb/plugin-build", "@get-bb/plugin-sdk"].map(
          (name) => `--filter=${name}`,
        );
  run(`tests (${CHECKS})`, "pnpm", [
    "exec",
    "turbo",
    "run",
    "test",
    ...filters,
  ]);
}

const tip = git(worktree, "rev-parse", "HEAD");
if (ontoRef === base) {
  const same = tryGit(root, "diff", "--quiet", sourceRef, tip).status === 0;
  note(
    same
      ? "tree is identical to the source branch (same base)"
      : "tree DIFFERS from the source branch on the same base: the scripts do not reproduce the generated commits",
  );
  if (!same) finish(false);
}
git(root, "branch", "-f", CANDIDATE, tip);
note(`moved ${CANDIDATE} to ${tip.slice(0, 10)}`);
if (!flag("--keep")) {
  git(root, "worktree", "remove", "--force", worktree);
  note("removed the worktree");
}
finish(true);

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

if (args.includes("--help")) {
  console.log(`List the upstream files the fork edits by hand and check them against the ledger.

  node scripts/fork/check-core-diff.mjs [--base <ref>] [--head <ref>] [--cwd <dir>] [--json]

A core edit is a change to a file that exists upstream. Files the fork adds
are not core edits, and neither is the output of the generated commits
(those carry a Fork-Generated trailer and are left out). Every core edit
must be listed in scripts/fork/core-edits.json with its seam, its intent and
a line budget (added plus removed lines). The check fails when a file is not
listed or is over its budget.`);
  process.exit(0);
}

const cwd = resolve(option("--cwd", root));
const git = (...argv) =>
  execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }).trim();

const head = git("rev-parse", option("--head", "HEAD"));
const base = git("merge-base", head, option("--base", "upstream/main"));
const isGenerated = (commit) =>
  git(
    "log",
    "-1",
    "--format=%(trailers:key=Fork-Generated,valueonly)",
    commit,
  ) !== "";
const commits = git("rev-list", `${base}..${head}`).split("\n").filter(Boolean);
let handTip = base;
for (const commit of commits) {
  if (!isGenerated(commit)) {
    handTip = commit;
    break;
  }
}
const generatedBelowHand = commits
  .slice(commits.indexOf(handTip) + 1)
  .filter(isGenerated);

const ledger = JSON.parse(
  readFileSync(resolve(cwd, "scripts/fork/core-edits.json"), "utf8"),
);
const edits = git("diff", "--numstat", "--diff-filter=MDRT", base, handTip)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [added, removed, file] = line.split("\t");
    return {
      file,
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
    };
  });
const addedFiles = git("diff", "--name-only", "--diff-filter=A", base, handTip)
  .split("\n")
  .filter(Boolean).length;

const problems = [];
const seen = new Set();
for (const edit of edits) {
  seen.add(edit.file);
  const entry = ledger.files[edit.file];
  const lines = edit.added + edit.removed;
  if (entry === undefined) {
    problems.push(
      `NOT LEDGERED ${edit.file} (+${edit.added} -${edit.removed}): move the change into a fork-owned file or a plugin, or add the file to scripts/fork/core-edits.json with its seam, intent and budget`,
    );
  } else if (lines > entry.budget) {
    problems.push(
      `OVER BUDGET ${edit.file}: ${lines} changed lines, budget ${entry.budget} (seam "${entry.seam}")`,
    );
  }
}
const stale = Object.keys(ledger.files).filter((file) => !seen.has(file));
if (generatedBelowHand.length > 0) {
  problems.push(
    `GENERATED COMMITS BELOW HAND COMMITS: ${generatedBelowHand.map((commit) => commit.slice(0, 10)).join(", ")}. Generated commits belong at the tip.`,
  );
}

const total = edits.reduce(
  (sum, edit) => ({
    added: sum.added + edit.added,
    removed: sum.removed + edit.removed,
  }),
  { added: 0, removed: 0 },
);
const summary = {
  base,
  handTip,
  coreFiles: edits.length,
  added: total.added,
  removed: total.removed,
  forkOwnedFiles: addedFiles,
  problems,
  stale,
};

if (args.includes("--json")) {
  console.log(JSON.stringify({ ...summary, edits }, null, 2));
} else {
  for (const edit of [...edits].sort(
    (a, b) => b.added + b.removed - (a.added + a.removed),
  )) {
    const entry = ledger.files[edit.file];
    console.log(
      `${String(edit.added).padStart(4)} ${String(edit.removed).padStart(4)}  ${edit.file}${entry ? `  [${entry.seam}]` : "  [NOT LEDGERED]"}`,
    );
  }
  console.log(
    `\ncore edits: ${edits.length} files, +${total.added} -${total.removed}; fork-owned files added: ${addedFiles}`,
  );
  for (const file of stale) {
    console.log(`stale ledger entry (file no longer edited): ${file}`);
  }
  for (const problem of problems) console.error(problem);
}
process.exit(problems.length > 0 ? 1 : 0);

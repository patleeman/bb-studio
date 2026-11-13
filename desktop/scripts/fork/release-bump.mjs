import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const git = (cwd, args, env) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function foldVersion({
  repo,
  tip,
  base,
  owner,
  versionFile,
  version,
  work,
  branch,
  coauthor,
  env,
}) {
  rmSync(work, { recursive: true, force: true });
  git(repo, ["worktree", "add", "--quiet", "--detach", work, tip]);
  try {
    const path = join(work, versionFile);
    const release = JSON.parse(readFileSync(path, "utf8"));
    release.version = version;
    writeFileSync(path, `${JSON.stringify(release, null, 2)}\n`);
    git(work, ["add", versionFile]);
    git(work, ["commit", "--quiet", "-m", `fixup! ${owner}\n\n${coauthor}`]);
    git(
      work,
      [
        "-c",
        "rerere.enabled=false",
        "-c",
        "rebase.updateRefs=false",
        "rebase",
        "--quiet",
        "--autosquash",
        "--interactive",
        base,
      ],
      {
        ...(env ?? process.env),
        GIT_SEQUENCE_EDITOR: "true",
        GIT_EDITOR: "true",
      },
    );
    const head = git(work, ["rev-parse", "HEAD"]);
    git(repo, ["branch", "-f", branch, head]);
    return head;
  } finally {
    git(repo, ["worktree", "remove", "--force", work]);
  }
}

export function bumpProblems({ repo, tip, folded, versionFile, generated }) {
  const problems = [];
  const changed = git(repo, ["diff", "--name-only", tip, folded])
    .split("\n")
    .filter(Boolean);
  if (changed.length !== 1 || changed[0] !== versionFile) {
    problems.push(
      `the folded stack differs from ${tip.slice(0, 10)} in more than the version: ${changed.join(", ")}`,
    );
  }
  const subjects = (ref) =>
    git(repo, ["log", "-n", String(generated), "--format=%s", ref]);
  if (subjects(tip) !== subjects(folded)) {
    problems.push(
      `the folded stack does not end with the same ${generated} generated commits`,
    );
  }
  return problems;
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { bumpProblems, foldVersion } from "./release-bump.mjs";

const VERSION_FILE = "apps/desktop/studio-release.fork.json";
const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Tester",
  GIT_AUTHOR_EMAIL: "tester@example.invalid",
  GIT_COMMITTER_NAME: "Tester",
  GIT_COMMITTER_EMAIL: "tester@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

function commit(repo, files, message) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
    git(repo, "add", file);
  }
  git(repo, "commit", "--quiet", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "release-bump-"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "-b", "desktop");
  const base = commit(repo, { "app.txt": "upstream\n" }, "upstream base");
  commit(
    repo,
    { [VERSION_FILE]: `${JSON.stringify({ version: "1.0.1" }, null, 2)}\n` },
    "seam: BB Studio's own version line and update feed",
  );
  commit(repo, { "feature.txt": "feature\n" }, "seam: a later feature");
  for (const name of ["strip", "identity", "rebrand"]) {
    commit(
      repo,
      {
        [`generated-${name}.txt`]: `${name}\n`,
        "app.txt": `upstream ${name}\n`,
      },
      `fork: ${name} (generated)\n\nFork-Generated: ${name}`,
    );
  }
  const tip = git(repo, "rev-parse", "HEAD");
  return { dir, repo, base, tip };
}

const fold = ({ repo, base, tip, dir }, from = tip) =>
  foldVersion({
    repo,
    tip: from,
    base,
    owner: "seam: BB Studio's own version line and update feed",
    versionFile: VERSION_FILE,
    version: "1.0.2",
    work: join(dir, "work"),
    branch: "desktop-release-work",
    coauthor: "Co-Authored-By: Tester <tester@example.invalid>",
    env,
  });

test("folds the version into its owner under the generated commits", () => {
  const f = fixture();
  try {
    const folded = fold(f);
    assert.equal(git(f.repo, "rev-parse", "desktop-release-work"), folded);
    assert.deepEqual(
      git(f.repo, "diff", "--name-only", f.tip, folded).split("\n"),
      [VERSION_FILE],
    );
    assert.equal(
      git(f.repo, "log", "--format=%s", `${f.base}..${folded}`),
      git(f.repo, "log", "--format=%s", `${f.base}..${f.tip}`),
    );
    const owner = git(f.repo, "rev-parse", `${folded}~4`);
    assert.equal(
      JSON.parse(git(f.repo, "show", `${owner}:${VERSION_FILE}`)).version,
      "1.0.2",
    );
    assert.deepEqual(
      bumpProblems({
        repo: f.repo,
        tip: f.tip,
        folded,
        versionFile: VERSION_FILE,
        generated: 3,
      }),
      [],
    );
    assert.equal(git(f.repo, "worktree", "list").split("\n").length, 1);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("flags a source made from the hand commits only, which sync.mjs can never match", () => {
  const f = fixture();
  try {
    const folded = fold(f, git(f.repo, "rev-parse", `${f.tip}~3`));
    const problems = bumpProblems({
      repo: f.repo,
      tip: f.tip,
      folded,
      versionFile: VERSION_FILE,
      generated: 3,
    });
    assert.equal(problems.length, 2);
    assert.match(problems[0], /more than the version/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

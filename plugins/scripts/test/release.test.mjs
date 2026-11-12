import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const repo = resolve(import.meta.dirname, "../..");
function write(path, content, executable = false) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, { mode: executable ? 0o755 : 0o644 });
}
function releaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bb-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "repo");
  mkdirSync(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const remote = join(root, "origin.git");
  git("init", "--bare", remote);
  git("init", "-b", "main");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "fixture@example.com");
  write(join(cwd, "scripts/release.mjs"), readFileSync(process.env.RELEASE_TEST_SOURCE || join(repo, "scripts/release.mjs")));
  for (const name of ["check-marketplace", "check-docs", "check-icons", "check-sdk-compat", "check-native-payload-fixtures"]) write(join(cwd, `scripts/${name}.mjs`), 'import { appendFileSync } from "node:fs"; appendFileSync(process.env.RELEASE_TEST_LOG, "check\\n");');
  write(join(cwd, "scripts/test/noop.test.mjs"), "");
  write(join(cwd, ".bb/plugins.json"), JSON.stringify({ plugins: [{ name: "demo", source: "./packages/demo" }] }));
  write(join(cwd, "packages/demo/package.json"), '{}');
  write(join(cwd, "packages/demo/tsconfig.json"), '{}');
  write(join(cwd, "packages/demo/demo.test.ts"), '');
  write(join(cwd, "pnpm-lock.yaml"), 'selected-commit-lock');
  git("add", "scripts", ".bb/plugins.json", "packages", "pnpm-lock.yaml");
  git("commit", "-qm", "Release fixture");
  git("remote", "add", "origin", remote);
  git("push", "-q", "origin", "main");
  // Caller dependencies deliberately disagree with the selected commit.
  write(join(cwd, "packages/demo/node_modules/.bin/tsc"), '#!/bin/sh\necho WRONG >&2\nexit 2\n', true);
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  write(log, '');
  write(join(bin, "pnpm"), `#!/usr/bin/env node
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
appendFileSync(process.env.RELEASE_TEST_LOG, "install " + process.argv.slice(2).join(" ") + " " + readFileSync("pnpm-lock.yaml", "utf8") + "\\n");
if (process.env.RELEASE_TEST_FAIL_INSTALL) process.exit(1);
for (const [dir, names] of [["node_modules/.bin", ["tsx"]], ["packages/demo/node_modules/.bin", ["tsc", "vitest"]]]) {
  mkdirSync(dir, { recursive: true });
  for (const name of names) writeFileSync(join(dir, name), '#!/bin/sh\\necho ' + name + ' >> "$RELEASE_TEST_LOG"\\n', { mode: 0o755 });
}
`, true);
  for (const command of ["npm", "bb"]) write(join(bin, command), `#!/bin/sh\necho '${command}' >> "$RELEASE_TEST_LOG"\n`, true);
  return { cwd, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RELEASE_TEST_LOG: log }, git };
}

for (const skipTests of [false, true]) test(`release uses selected frozen dependencies and keeps typechecking with skip-tests=${skipTests}`, (t) => {
  const f = releaseFixture(t);
  const result = spawnSync(process.execPath, ["scripts/release.mjs", "--ref", "HEAD", "--dry-run", ...(skipTests ? ["--skip-tests"] : [])], { cwd: f.cwd, env: f.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const commands = readFileSync(f.log, "utf8").trim().split("\n");
  assert.equal(commands[0], "install install --frozen-lockfile selected-commit-lock");
  assert.ok(commands.includes("tsc"));
  assert.equal(commands.includes("vitest"), !skipTests);
  assert.ok(commands.indexOf("npm") > commands.indexOf("tsc"));
  assert.match(result.stdout, /Dry run: stable not moved/);
  assert.throws(() => f.git("show-ref", "--verify", "refs/remotes/origin/stable"));
});

test("failed frozen installation stops release before checks or plugin builds", (t) => {
  const f = releaseFixture(t);
  const result = spawnSync(process.execPath, ["scripts/release.mjs", "--ref", "HEAD", "--dry-run"], { cwd: f.cwd, env: { ...f.env, RELEASE_TEST_FAIL_INSTALL: "1" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Frozen workspace install failed/);
  assert.deepEqual(readFileSync(f.log, "utf8").trim().split("\n"), ["install install --frozen-lockfile selected-commit-lock"]);
});

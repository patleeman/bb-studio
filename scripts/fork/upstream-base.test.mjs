import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { formatStudioUpstream } from "../../apps/desktop/scripts/studio-release.fork.mjs";
import {
  describeUpstreamBase,
  parseUpstreamDescribe,
} from "./upstream-base.mjs";

const SHA = "a08e116566aa0a5a6d7d6f8d32c95cb9a1f5f8a1";

test("the label names the release tag, and the commits past it when there are any", () => {
  assert.equal(
    formatStudioUpstream({ version: "0.50.1", commit: SHA, ahead: 0 }),
    "based on bb 0.50.1 @ a08e116",
  );
  assert.equal(
    formatStudioUpstream({ version: "0.49.0", commit: SHA, ahead: 59 }),
    "based on bb 0.49.0 + 59 commits @ a08e116",
  );
  assert.equal(
    formatStudioUpstream({ version: "0.49.0", commit: SHA, ahead: 1 }),
    "based on bb 0.49.0 + 1 commit @ a08e116",
  );
  assert.equal(
    formatStudioUpstream({ version: "0.49.0", commit: SHA }),
    "based on bb 0.49.0 @ a08e116",
  );
});

test("git describe output gives the tag's version and the distance", () => {
  assert.deepEqual(parseUpstreamDescribe("desktop-v0.50.1-0-ga08e11656\n"), {
    version: "0.50.1",
    ahead: 0,
  });
  assert.deepEqual(parseUpstreamDescribe("desktop-v0.49.0-168-gd2fd33885"), {
    version: "0.49.0",
    ahead: 168,
  });
  assert.deepEqual(
    parseUpstreamDescribe("desktop-v0.51.0-beta.2-3-gd2fd33885"),
    { version: "0.51.0-beta.2", ahead: 3 },
  );
  assert.equal(parseUpstreamDescribe("v1.0.7-2-gd2fd33885"), null);
});

test("the nearest desktop-v tag at or before the base, or none", () => {
  const dir = mkdtempSync(join(tmpdir(), "upstream-base-"));
  try {
    const run = (...args) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    run("init", "-q");
    const commit = (name) => {
      writeFileSync(join(dir, "file"), name);
      run("add", "file");
      run(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "commit",
        "-q",
        "-m",
        name,
      );
      return run("rev-parse", "HEAD");
    };
    const first = commit("one");
    assert.equal(describeUpstreamBase(dir, first), null);
    run("tag", "desktop-v0.49.0");
    run("tag", "v1.0.0");
    const second = commit("two");
    const third = commit("three");
    assert.deepEqual(describeUpstreamBase(dir, third), {
      version: "0.49.0",
      commit: third,
      ahead: 2,
    });
    run("tag", "desktop-v0.50.1", second);
    assert.deepEqual(describeUpstreamBase(dir, second), {
      version: "0.50.1",
      commit: second,
      ahead: 0,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("studio-upstream.json without a count reads as the old label", async () => {
  const { readStudioUpstream } =
    await import("../../apps/desktop/scripts/studio-release.fork.mjs");
  const dir = mkdtempSync(join(tmpdir(), "studio-upstream-"));
  try {
    const path = join(dir, "studio-upstream.json");
    writeFileSync(path, JSON.stringify({ version: "0.49.0", commit: SHA }));
    assert.deepEqual(readStudioUpstream(path), {
      version: "0.49.0",
      commit: SHA,
      ahead: null,
    });
    writeFileSync(
      path,
      JSON.stringify({ version: "0.50.1", commit: SHA, ahead: 0 }),
    );
    assert.equal(
      formatStudioUpstream(readStudioUpstream(path)),
      "based on bb 0.50.1 @ a08e116",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

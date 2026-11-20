import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  STUDIO_CLI_ALIAS_MARKER,
  studioCliAliasFiles,
  writeStudioCliAliases,
} from "./studio-cli-aliases.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the alias marker matches the one Studio's CLI looks for", () => {
  assert.ok(
    read("packages/config/src/studio-cli-env.fork.ts").includes(
      JSON.stringify(STUDIO_CLI_ALIAS_MARKER),
    ),
  );
});

test("the CLI's copy of the env guard is the same as packages/config's", () => {
  assert.equal(
    read("apps/cli/src/studio-cli-env.fork.ts"),
    read("packages/config/src/studio-cli-env.fork.ts"),
  );
});

test("writes bbs and bb-studio that run the bb beside them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bbs-aliases-"));
  try {
    await writeStudioCliAliases(dir);
    for (const name of studioCliAliasFiles()) {
      assert.ok(statSync(join(dir, name)).isFile(), name);
    }
    const sh = readFileSync(join(dir, "bbs"), "utf8");
    assert.match(sh, /^#!\/bin\/sh\n/);
    assert.ok(sh.includes(STUDIO_CLI_ALIAS_MARKER));
    assert.ok(sh.includes('exec "$(dirname "$0")/bb" "$@"'));
    assert.equal(statSync(join(dir, "bbs")).mode & 0o111, 0o111);
    assert.ok(readFileSync(join(dir, "bb-studio.cmd"), "utf8").includes('node "%~dp0bb" %*'));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

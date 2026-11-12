import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { localLinkErrors } from "../docs-links.mjs";

const repo = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "bb-docs-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

test("local documentation links handle encoded paths, titles, anchors and broken references", async (t) => {
  const dir = fixture(t);
  write(join(dir, "some file.md"), "ok");
  const errors = await localLinkErrors(join(dir, "README.md"), '[ok](some%20file.md#anchor) [ok](<some file.md>) [external](https://example.com) [anchor](#here) [bad](missing.md "title")');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing.md/);
});

test("documentation entry point checks the root README and nested maintained guides", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "packages"));
  mkdirSync(join(dir, "docs/nested"), { recursive: true });
    // Keep the entry point's root calculation unchanged.
  mkdirSync(join(dir, "scripts"));
  cpSync(process.env.DOCS_TEST_SOURCE || join(repo, "scripts/check-docs.mjs"), join(dir, "scripts/check-docs.mjs"));
  cpSync(join(repo, "scripts/docs-links.mjs"), join(dir, "scripts/docs-links.mjs"));
  write(join(dir, "README.md"), "[root](missing-root.md)");
  write(join(dir, "docs/nested/guide.md"), "[guide](missing-guide.md)");
  const result = spawnSync(process.execPath, [join(dir, "scripts/check-docs.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing-root.md/);
  assert.match(result.stderr, /missing-guide.md/);
});

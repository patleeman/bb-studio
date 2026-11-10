import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveImportConflicts } from "./import-conflicts.mjs";

test("keeps upstream's imports and adds the fork's new ones", () => {
  const text = [
    "<<<<<<< HEAD",
    'import { a } from "./a";',
    'import { b2 } from "./b";',
    "||||||| parent of abc (fork)",
    'import { a } from "./a";',
    'import { b } from "./b";',
    "=======",
    'import { forkThing } from "./thing.fork";',
    'import { a } from "./a";',
    'import { b } from "./b";',
    ">>>>>>> abc (fork)",
    "const x = 1;",
  ].join("\n");
  const result = resolveImportConflicts(text);
  assert.equal(result.resolved, 1);
  assert.equal(result.unresolved, 0);
  assert.equal(
    result.text,
    [
      'import { forkThing } from "./thing.fork";',
      'import { a } from "./a";',
      'import { b2 } from "./b";',
      "const x = 1;",
    ].join("\n"),
  );
});

test("leaves a block with code in it for a person", () => {
  const text = [
    "<<<<<<< HEAD",
    "const a = upstream();",
    "||||||| base",
    "const a = base();",
    "=======",
    "const a = fork();",
    ">>>>>>> fork",
  ].join("\n");
  const result = resolveImportConflicts(text);
  assert.equal(result.resolved, 0);
  assert.equal(result.unresolved, 1);
  assert.equal(result.text, text);
});

test("needs the base section (diff3) to decide", () => {
  const text = ["<<<<<<< HEAD", 'import a from "a";', "=======", 'import b from "b";', ">>>>>>> fork"].join("\n");
  assert.equal(resolveImportConflicts(text).unresolved, 1);
});

test("handles multi-line import lists", () => {
  const text = [
    "<<<<<<< HEAD",
    "import {",
    "  one,",
    "  two,",
    '} from "./x";',
    "||||||| base",
    "import {",
    "  one,",
    '} from "./x";',
    "=======",
    "import {",
    "  one,",
    '} from "./x";',
    'import { fork } from "./y.fork";',
    ">>>>>>> fork",
  ].join("\n");
  const result = resolveImportConflicts(text);
  assert.equal(result.resolved, 1);
  assert.ok(result.text.includes('import { fork } from "./y.fork";'));
  assert.ok(result.text.includes("  two,"));
});

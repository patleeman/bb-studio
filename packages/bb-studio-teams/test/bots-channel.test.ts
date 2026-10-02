import { createTestStore } from "./test-store";
import { test } from "vitest";
import assert from "node:assert/strict";

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";




import { document, saveDocument } from "../store";





import { bot } from "./bots-fixture";

test("bot home persists and stale saves cannot overwrite changed memory", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-bots-test-")),
    db = new Database(join(root, "data.db"));
  try {
    const store = createTestStore(db),
      b = bot(join(store.root, "bot_0123456789abcdef"));
    await store.initialize(b, "Keep releases healthy.");
    store.put(b);
    const original = await document(b.home, "MEMORY.md");
    await writeFile(join(b.home, "MEMORY.md"), "A new fact from the bot.\n");
    await assert.rejects(
      () => saveDocument(b.home, "MEMORY.md", "stale editor", original.version),
      /changed/,
    );
    assert.equal(
      (await document(b.home, "MEMORY.md")).text,
      "A new fact from the bot.\n",
    );
    assert.equal(createTestStore(db).get(b.id).name, "Atlas");
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});


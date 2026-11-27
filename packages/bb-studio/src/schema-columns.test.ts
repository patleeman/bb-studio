import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { ensureColumns, ENSURED_COLUMNS } from "./schema-columns";

const dispose: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

async function host() {
  const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
  dispose.push(() => harness.lifecycle.dispose());
  return bb;
}
const columns = (db: { prepare(sql: string): { all(): unknown[] } }) => (db.prepare("PRAGMA table_info(bots)").all() as { name: string }[]).map((each) => each.name);

it("FM (migration): a database where another branch already used the next migration position still loads and gets the main_* columns", async () => {
  const bb = await host();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  // A build from another branch (quiet-compact, r3-owner) appended its own migration at the next index.
  const other = MIGRATIONS.concat("CREATE TABLE quiet_compact_marker (id TEXT PRIMARY KEY);");
  bb.storage.migrate(db, other);
  // Back on this build: the migrations load (no index of ours collides), and the columns are added by checking.
  expect(() => bb.storage.migrate(db, MIGRATIONS)).not.toThrow();
  expect(columns(db)).not.toContain("main_model");
  expect(ensureColumns(db)).toEqual(["bots.main_provider_id", "bots.main_model", "bots.main_reasoning", "strand_items.prev_strand_id", "strand_items.reply_tag", "strand_items.reply_ask", "strand_items.reply_by", "strand_items.reply_resolved_at", "strand_items.also_strands", "strand_items.reply_quick", "strand_items.quiet", "strand_items.merge_also", "strands.done_at", "strands.parent_id", "strands.kind", "strands.merge_parent"]);
  expect(columns(db)).toEqual(expect.arrayContaining(["main_provider_id", "main_model", "main_reasoning"]));
  // Every start: nothing more to add, nothing thrown.
  expect(ensureColumns(db)).toEqual([]);
});

it("FM (migration): a database that already has the columns (an earlier build's migration) is left as it is", async () => {
  const bb = await host();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  db.exec("ALTER TABLE bots ADD COLUMN main_provider_id TEXT; ALTER TABLE bots ADD COLUMN main_model TEXT;");
  expect(ensureColumns(db)).toEqual(["bots.main_reasoning", "strand_items.prev_strand_id", "strand_items.reply_tag", "strand_items.reply_ask", "strand_items.reply_by", "strand_items.reply_resolved_at", "strand_items.also_strands", "strand_items.reply_quick", "strand_items.quiet", "strand_items.merge_also", "strands.done_at", "strands.parent_id", "strands.kind", "strands.merge_parent"]);
});

it("leaves a table that isn't there yet alone", async () => {
  const bb = await host();
  const db = bb.storage.database();
  expect(ensureColumns(db)).toEqual([]);
});

it("the reason it can't be a migration: BB refuses a database whose index holds a different statement", async () => {
  const bb = await host();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS.concat("CREATE TABLE quiet_compact_marker (id TEXT PRIMARY KEY);"));
  expect(() => bb.storage.migrate(db, MIGRATIONS.concat("ALTER TABLE bots ADD COLUMN main_model TEXT;"))).toThrow(/does not match the recorded statement/);
});

it("strands.done_at (strand_note's done) is added by checking, so it takes no migration slot; a database that has it already is left alone", async () => {
  const bb = await host();
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  expect(MIGRATIONS.some((sql) => /done_at/.test(sql))).toBe(false);
  db.exec("ALTER TABLE strands ADD COLUMN done_at INTEGER;");
  expect(ensureColumns(db)).not.toContain("strands.done_at");
  expect((db.prepare("PRAGMA table_info(strands)").all() as { name: string }[]).filter((c) => c.name === "done_at")).toHaveLength(1);
});

it("a reply's tag columns (src/strands/reply.ts) are added by checking, with no migration slot", () => {
  expect(MIGRATIONS.some((sql) => /reply_tag|reply_resolved_at/.test(sql))).toBe(false);
  expect(ENSURED_COLUMNS.strand_items!.map(([name]) => name)).toEqual(["prev_strand_id", "reply_tag", "reply_ask", "reply_by", "reply_resolved_at", "also_strands", "reply_quick", "quiet", "merge_also"]);
});

it("a strand's parent and kind, and the strands a message is also about, are added by checking, with no migration slot", () => {
  expect(MIGRATIONS.some((sql) => /also_strands|ALTER TABLE strands/.test(sql ?? ""))).toBe(false);
  expect(ENSURED_COLUMNS.strands!.map(([name]) => name)).toEqual(["done_at", "parent_id", "kind", "merge_parent"]);
});

import { expect, it } from "vitest";
import { ftsTerms } from "./store";
import { memoryHost } from "./test-fixture";

const manual = { kind: "manual" as const, id: null, title: "Added by you", section: null };
const list = (x: Awaited<ReturnType<typeof memoryHost>>, options: Partial<Parameters<typeof x.memory.store.list>[0]> = {}) =>
  x.memory.store.list({ botId: "bot_main", sort: options.query ? "relevance" : "newest", includeReplaced: true, includeArchived: false, limit: 50, ...options });

it("finds records by words in topic and text, by prefix and any case, and ranks the topic higher", async () => {
  const x = await memoryHost();
  const add = (topic: string, text: string, createdAt: number) => x.memory.store.add({ botId: "bot_main", topic, text, source: manual, createdAt });
  add("homelab", "Saturday 03:00–05:00 ET is backup maintenance on the server.", 1);
  add("Home", "GORUCK return window ends Nov 15.", 2);
  add("Backups", "Offsite copy goes to the NAS weekly.", 3);
  x.memory.store.add({ botId: "bot_scout", topic: "Backups", text: "Scout's own backup note.", source: manual });
  expect(list(x, { query: "backup" }).records.map((record) => record.topic)).toEqual(["Backups", "homelab"]);
  expect(list(x, { query: "GORUCK window" }).records.map((record) => record.topic)).toEqual(["Home"]);
  // Every word together first; when that finds nothing, any word.
  expect(list(x, { query: "goruck maintenance" }).records.map((record) => record.topic).sort()).toEqual(["Home", "homelab"]);
  expect(list(x, { query: "backup", topic: "HOMELAB" }).records.map((record) => record.topic)).toEqual(["homelab"]);
  expect(list(x, { query: "\"*)(" })).toEqual({ records: [], total: 0 });
  expect(list(x, { sort: "oldest" }).records.map((record) => record.topic)).toEqual(["homelab", "Home", "Backups"]);
  expect(list(x, { limit: 1 })).toMatchObject({ total: 3, records: [{ topic: "Backups" }] });
  expect(ftsTerms("don't  stop-me")).toEqual(['"don"*', '"t"*', '"stop"*', '"me"*']);
});

it("keeps a topic's first spelling, counts topics by use, and hides archived records", async () => {
  const x = await memoryHost();
  const a = x.memory.store.add({ botId: "bot_main", topic: "homelab", text: "One.", source: manual });
  const b = x.memory.store.add({ botId: "bot_main", topic: "  HOMELAB ", text: "Two.", source: manual });
  x.memory.store.add({ botId: "bot_main", topic: "Home", text: "Three.", source: manual });
  expect(b.topic).toBe("homelab");
  expect(x.memory.store.topics("bot_main")).toEqual([{ topic: "homelab", count: 2 }, { topic: "Home", count: 1 }]);
  x.memory.store.archive("bot_main", a.id, true);
  expect(list(x, { query: "one" }).total).toBe(0);
  expect(list(x, { query: "one", includeArchived: true }).records[0]).toMatchObject({ id: a.id, archived: true });
  expect(x.memory.store.counts("bot_main")).toEqual({ current: 2, replaced: 0, archived: 1 });
  expect(() => x.memory.store.archive("bot_scout", b.id, true)).toThrow(/No memory record/);
});

it("replaces a record with a new one, keeps the old as history after current ones, and refuses to fork the chain", async () => {
  const x = await memoryHost();
  const old = x.memory.store.add({ botId: "bot_main", topic: "Launch", text: "Give high-level design 20 minutes.", source: manual, createdAt: 100 });
  x.memory.store.add({ botId: "bot_main", topic: "Home", text: "Older fact.", source: manual, createdAt: 50 });
  const { record, replaced } = x.memory.store.replace("bot_main", old.id, { text: "High-level design gets 15 minutes.", source: manual }, 200);
  expect(record).toMatchObject({ topic: "Launch", replacesId: old.id, replaces: { id: old.id, text: "Give high-level design 20 minutes.", createdAt: 100 }, replacedById: null, createdAt: 200 });
  expect(replaced).toMatchObject({ id: old.id, replacedById: record.id, replacedAt: 200 });
  // Current records first (newest first), then replaced ones.
  expect(list(x).records.map((each) => each.text)).toEqual(["High-level design gets 15 minutes.", "Older fact.", "Give high-level design 20 minutes."]);
  expect(list(x, { includeReplaced: false }).total).toBe(2);
  // Search finds both, the current one first.
  expect(list(x, { query: "design" }).records.map((each) => each.id)).toEqual([record.id, old.id]);
  expect(() => x.memory.store.replace("bot_main", old.id, { text: "Again.", source: manual })).toThrow(new RegExp(`already replaced by ${record.id}`));
  const third = x.memory.store.replace("bot_main", record.id, { text: "Ten minutes.", topic: "Launch prep", source: manual }, 300).record;
  expect(third).toMatchObject({ topic: "Launch prep", replacesId: record.id });
  expect(x.memory.store.counts("bot_main")).toEqual({ current: 2, replaced: 2, archived: 0 });
  // The index follows the rows.
  expect(list(x, { query: "ten" }).records.map((each) => each.id)).toEqual([third.id]);
});

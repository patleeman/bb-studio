import { expect, it } from "vitest";
import { registerMemory } from "./register";
import { fillSlot, MEMORY_SLOT, memoryInstructions, withMemory } from "./service";
import { INSTRUCTIONS_LIMIT, PROFILE_CAP_CHARS } from "./shared";
import { MEMORY_PAGE, memoryHost } from "./test-fixture";

async function withTools() {
  const x = await memoryHost();
  registerMemory(x.bb, x.memory);
  const tool = async (name: string, input: unknown, threadId: string) => String(await x.harness.callAgentTool(name, input, { threadId }));
  const rpc = (method: string, input: unknown) => x.harness.behavior.callRpc(method, input) as Promise<never>;
  return { ...x, tool, rpc };
}
const json = (text: string) => JSON.parse(text.slice(text.indexOf("{")));

it("memory_add saves under the calling thread's Bot, with the thread as its source", async () => {
  const x = await withTools();
  await x.tool("memory_add", { topic: "Fork", text: "No main tabs." }, "thr_main");
  await x.tool("memory_add", { topic: "Launch", text: "One mock a day." }, "thr_side");
  await x.tool("memory_add", { topic: "homelab", text: "Backups Saturday." }, "thr_runner");
  await x.tool("memory_add", { topic: "Fork", text: "Repo is a tag." }, "thr_worker");
  await x.tool("memory_add", { topic: "Scout", text: "Scout's own." }, "thr_scout");
  // A thread no Bot owns counts for the primary Bot.
  await x.tool("memory_add", { topic: "Misc", text: "From elsewhere." }, "thr_loose");
  const sources = Object.fromEntries((await x.memory.list({ botId: "bot_main" })).records.map((record) => [record.text, [record.source.kind, record.source.id, record.source.title, record.sourceState]]));
  expect(sources).toEqual({
    "No main tabs.": ["conversation", "thr_main", "Main", "live"],
    "One mock a day.": ["conversation", "thr_side", "Launch prep", "finished"],
    "Backups Saturday.": ["worker", "thr_runner", "Runner: staff sweep", "live"],
    "Repo is a tag.": ["worker", "thr_worker", "Fable lead: sidebar rewrite", "live"],
    "From elsewhere.": ["thread", "thr_loose", "Someone else's thread", "live"],
  });
  expect((await x.memory.list({ botId: "bot_scout" })).records.map((record) => record.text)).toEqual(["Scout's own."]);
});

it("names sources from Studio's record of conversations and workers: Main, the conversation's title, the worker's", async () => {
  const x = await withTools();
  x.threads.set("thr_conv", { id: "thr_conv", title: "BB's title for it", archived: false });
  x.places.set("thr_main", { botId: "bot_main", kind: "conversation", isMain: true, title: null });
  x.places.set("thr_conv", { botId: "bot_main", kind: "conversation", isMain: false, title: "Launch prep" });
  // A conversation Studio has no title for reads BB's; a worker its own; a runner "Runner: <name>".
  x.places.set("thr_loose", { botId: "bot_scout", kind: "conversation", isMain: false, title: null });
  x.places.set("thr_worker", { botId: "bot_main", kind: "worker", isMain: false, title: null });
  x.places.set("thr_runner", { botId: "bot_main", kind: "worker", isMain: false, title: null });
  // A fork Studio placed as another Bot's worker: no guessing from its chat.
  x.places.set("thr_side", { botId: "bot_scout", kind: "worker", isMain: false, title: "Audit lane 2" });
  const add = (threadId: string, text: string) => x.tool("memory_add", { topic: "T", text }, threadId);
  for (const [threadId, text] of [["thr_main", "a"], ["thr_conv", "b"], ["thr_loose", "c"], ["thr_worker", "d"], ["thr_runner", "e"], ["thr_side", "f"]] as const) await add(threadId, text);
  const sources = async (botId: string) => Object.fromEntries((await x.memory.list({ botId })).records.map((record) => [record.text, [record.source.kind, record.source.title]]));
  expect(await sources("bot_main")).toEqual({
    a: ["conversation", "Main"],
    b: ["conversation", "Launch prep"],
    d: ["worker", "Fable lead: sidebar rewrite"],
    e: ["worker", "Runner: staff sweep"],
  });
  expect(await sources("bot_scout")).toEqual({ c: ["conversation", "Someone else's thread"], f: ["worker", "Audit lane 2"] });
  // The session's role follows the record too.
  expect(x.memory.threadRole(context("thr_side"))).toEqual({ botId: "bot_scout", role: "worker" });
  expect(x.memory.threadRole(context("thr_loose"))).toEqual({ botId: "bot_scout", role: "conversation" });
});

it("memory_add takes an explicit source: a finished conversation's summary links back to it", async () => {
  const x = await withTools();
  const saved = json(await x.tool("memory_add", { topic: "Launch", text: "Summary: outline done.", source: { kind: "conversation", id: "thr_side" } }, "thr_main"));
  expect(saved).toMatchObject({ topic: "Launch", source: { kind: "conversation", id: "thr_side", title: "Launch prep", finished: true }, replaced: false });
  const titled = json(await x.tool("memory_add", { topic: "Fork", text: "x", source: { kind: "conversation", id: "thr_gone", title: "Fork redesign" } }, "thr_main"));
  expect(titled.source).toEqual({ kind: "conversation", id: "thr_gone", title: "Fork redesign" });
  await expect(x.tool("memory_add", { topic: "Fork", text: "x", source: { kind: "conversation" } }, "thr_main")).rejects.toThrow(/needs its id/);
});

it("memory_update makes a replacing record, memory_search marks the old one replaced, and another Bot's record is out of reach", async () => {
  const x = await withTools();
  const first = json(await x.tool("memory_add", { topic: "Launch", text: "High-level design gets 20 minutes." }, "thr_main"));
  const reply = await x.tool("memory_update", { id: first.id, text: "High-level design gets 15 minutes." }, "thr_side");
  expect(reply).toMatch(new RegExp(`replaces ${first.id}, kept as history`));
  const found = json(await x.tool("memory_search", { query: "high-level design" }, "thr_worker"));
  expect(found.total).toBe(2);
  expect(found.records.map((record: { text: string; replaced: boolean; source: { title: string } }) => [record.text, record.replaced, record.source.title])).toEqual([
    ["High-level design gets 15 minutes.", false, "Launch prep"],
    ["High-level design gets 20 minutes.", true, "Main"],
  ]);
  expect(found.records[0]).toMatchObject({ replaces: first.id, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  await expect(x.tool("memory_update", { id: first.id, text: "Again" }, "thr_main")).rejects.toThrow(/already replaced/);
  await expect(x.tool("memory_update", { id: found.records[0].id, text: "Scout's take" }, "thr_scout")).rejects.toThrow(/No memory record/);
  expect(json(await x.tool("memory_search", { query: "nothing like it" }, "thr_main"))).toMatchObject({ total: 0, note: expect.stringMatching(/No records match/) });
});

it("the RPC lists, adds, edits and archives records as the user, newest first and replaced ones last", async () => {
  const x = await withTools();
  const { record } = await x.rpc("memory.add", { topic: "Home", text: "GORUCK window ends Nov 15." }) as { record: { id: string; source: unknown } };
  expect(record.source).toEqual({ kind: "manual", id: null, title: "Added by you", section: null });
  const edit = await x.rpc("memory.update", { id: record.id, text: "GORUCK window ends Nov 16." }) as { record: { id: string; source: { title: string }; replaces: { text: string } }; replaced: { replacedById: string } };
  expect(edit.record.source.title).toBe("Edited by you");
  expect(edit.record.replaces.text).toBe("GORUCK window ends Nov 15.");
  expect(edit.replaced.replacedById).toBe(edit.record.id);
  await x.rpc("memory.archive", { id: edit.record.id, archived: true });
  const overview = await x.rpc("memory.overview", {}) as { counts: unknown; topics: unknown; bot: unknown };
  expect(overview).toMatchObject({ bot: { id: "bot_main", name: "Dot" }, counts: { current: 0, replaced: 1, archived: 1 }, topics: [] });
  expect(await x.rpc("memory.list", { includeArchived: true })).toMatchObject({ total: 2, records: [{ archived: true }, { replacedById: edit.record.id }] });
  x.external.add("bot_scout");
  await expect(x.rpc("memory.overview", { botId: "bot_scout" })).rejects.toThrow(/keeps its own memory/);
});

it("splits the old Memory page once, on the first load of the Bot's memory, and never writes the old page", async () => {
  const x = await withTools();
  const old = x.legacy("bot_main");
  const before = structuredClone(x.pages.get(old));
  expect(x.memory.split("bot_main")).toEqual({ state: "needed", legacyPageId: old, legacyTitle: "Chief of Staff's Memory", splitAt: null });
  const overview = await x.rpc("memory.overview", {}) as { profile: { pageId: string; over: boolean; chars: number }; split: unknown; counts: { current: number } };
  expect(overview.profile).toMatchObject({ pageId: "pg_new1", over: false });
  expect(overview.split).toMatchObject({ state: "done", legacyPageId: old, splitAt: expect.any(Number) });
  expect(overview.counts.current).toBe(18);
  expect(x.writes).toEqual(["pg_new1"]);
  expect(x.pages.get(old)).toEqual(before);
  // The profile is the check-in list and how he works; everything else is records citing the old page and their section.
  expect(x.pages.get("pg_new1")).toMatchObject({ title: "Dot's core profile", icon: "🪪" });
  expect(x.pages.get("pg_new1")!.markdown).toMatch(/^## Check-in\n\n[\s\S]*\n\n## How he works\n\n- Wants one recommendation[\s\S]*small commits\.\n$/);
  expect((x.db.prepare("SELECT memory_page_id FROM bots WHERE id = 'bot_main'").get() as { memory_page_id: string }).memory_page_id).toBe("pg_new1");
  const records = (await x.memory.list({ botId: "bot_main", query: "Hetzner" })).records;
  expect(records[0]).toMatchObject({ topic: "Facts and decisions", source: { kind: "page", id: old, title: "Chief of Staff's Memory", section: "Facts and decisions" }, createdAt: new Date(2026, 9, 28, 12).getTime() });
  expect((await x.memory.list({ botId: "bot_main", query: "email" })).records[0]).toMatchObject({ topic: "Hard rules", source: { section: "Hard rules" } });
  expect((await x.memory.list({ botId: "bot_main", query: "Edited by both" })).records[0]!.source.section).toBeNull();

  // Once only: records exist and the marker is set, so nothing runs again.
  await x.rpc("memory.overview", {});
  expect(x.memory.autoSplit("bot_main")).toBeNull();
  x.memory.autoSplitAll();
  expect(x.writes).toEqual(["pg_new1"]);
  expect(x.memory.store.counts("bot_main").current).toBe(18);
  expect(x.pages.get(old)).toEqual(before);
  // The preview's RPCs are gone.
  await expect(x.rpc("memory.splitPreview", {})).rejects.toThrow();
});

it("splits every Bot that still needs it at start, and leaves the others alone", async () => {
  const x = await memoryHost();
  const old = x.legacy("bot_main");
  const before = structuredClone(x.pages.get(old));
  const profile = x.memory.newProfile("bot_scout", "Scout");
  x.db.prepare("UPDATE bots SET memory_page_id = ? WHERE id = 'bot_scout'").run(profile);
  x.writes.length = 0;
  x.memory.autoSplitAll();
  expect(x.writes).toEqual(["pg_new2"]);
  expect(x.memory.split("bot_main")).toMatchObject({ state: "done", legacyPageId: old });
  expect(x.memory.split("bot_scout").state).toBe("none");
  expect(x.memory.store.counts("bot_scout").current).toBe(0);
  expect(x.pages.get(old)).toEqual(before);
  x.memory.autoSplitAll();
  expect(x.writes).toEqual(["pg_new2"]);
});

it("splits an old page whose check-in and how-he-works sections are over the cap: the longest goes to records, and the profile fits", async () => {
  const x = await memoryHost();
  const habits = Array.from({ length: 30 }, (_, index) => `- Habit ${index + 1}: one recommendation, short reports in simple English.`).join("\n");
  const checks = Array.from({ length: 12 }, (_, index) => `- Check ${index + 1}: anything waiting on Sam from the morning sweep?`).join("\n");
  const markdown = `## Check-in\n\n${checks}\n\n## How Sam works\n\n${habits}\n`;
  expect(markdown.trim().length).toBeGreaterThan(PROFILE_CAP_CHARS);
  const old = x.legacy("bot_main", markdown);
  const result = x.memory.autoSplit("bot_main");
  expect(result).toEqual({ profilePageId: "pg_new1", records: 30, legacyPageId: old });
  expect(x.memory.overview("bot_main").profile).toMatchObject({ over: false, cap: PROFILE_CAP_CHARS });
  expect(x.pages.get("pg_new1")!.markdown).toBe(`## Check-in\n\n${checks}\n`);
  expect((await x.memory.list({ botId: "bot_main", topic: "How Sam works" })).total).toBe(30);
  expect(x.pages.get(old)!.markdown).toBe(markdown);
});

it("a new Bot's memory page is a core profile, with nothing to split", async () => {
  const x = await memoryHost();
  const pageId = x.memory.newProfile("bot_scout", "Scout");
  x.db.prepare("UPDATE bots SET memory_page_id = ? WHERE id = 'bot_scout'").run(pageId);
  expect(x.pages.get(pageId)).toMatchObject({ title: "Scout's core profile" });
  expect(x.pages.get(pageId)!.markdown).toMatch(/## Who the user is[\s\S]*## Check-in\n\n- Anything waiting/);
  expect(x.memory.overview("bot_scout")).toMatchObject({ split: { state: "none" }, profile: { pageId, over: false, cap: PROFILE_CAP_CHARS } });
});

const context = (threadId: string, extra: { parentThreadId?: string; sourceThreadId?: string; metadata?: Record<string, unknown> } = {}) =>
  ({ thread: { id: threadId, parentThreadId: extra.parentThreadId ?? null, sourceThreadId: extra.sourceThreadId ?? null }, pluginMetadata: extra.metadata ?? {} });

it("gives every conversation and worker of a Bot the memory tools and its core profile, at the slot", async () => {
  const x = await memoryHost();
  x.legacy("bot_main");
  x.memory.autoSplit("bot_main");
  const inner = () => ({ tools: ["pages_read"], skills: [], instructions: ["You are Dot.", MEMORY_SLOT, "Pages: …"].join("\n\n") });
  const configure = withMemory(() => x.memory, () => false, inner);
  const own = configure(context("thr_main"));
  expect(own.tools).toEqual(["pages_read", "memory_search", "memory_add", "memory_update"]);
  expect(own.instructions).toMatch(/^You are Dot\.\n\n## Memory\nFacts, decisions and notes are memory records[\s\S]*Your core profile \(page pg_new1\)[\s\S]*<core-profile>\n## Check-in\n[\s\S]*## How he works[\s\S]*<\/core-profile>\n\nPages: …$/);
  expect(own.instructions).not.toContain("Hetzner");
  expect(own.instructions).not.toContain(MEMORY_SLOT);
  const worker = configure(context("thr_child", { parentThreadId: "thr_main" }));
  expect(worker.instructions).toMatch(/You work for "Dot"\. Its memory records[\s\S]*Dot's core profile of the user \(page pg_new1\); its rules apply to you too:/);
  expect(configure(context("thr_runner")).instructions).toContain("You work for \"Dot\"");
  // A fork of the Bot's chat is another conversation with it.
  expect(configure(context("thr_fork", { sourceThreadId: "thr_main" })).instructions).toContain("Your core profile");
  // No Bot, an external Bot, or a skipped session: nothing added, and the slot is gone.
  expect(configure(context("thr_loose"))).toEqual({ ...inner(), instructions: "You are Dot.\n\nPages: …" });
  x.external.add("bot_main");
  expect(configure(context("thr_main")).tools).toEqual(["pages_read"]);
  expect(withMemory(() => x.memory, () => true, inner)(context("thr_scout")).instructions).toBe("You are Dot.\n\nPages: …");
  // Before the split: the tools, and the old page to read but not edit.
  const y = await memoryHost();
  const old = y.legacy("bot_main");
  expect(withMemory(() => y.memory, () => false, inner)(context("thr_main")).instructions).toContain(`Your old Memory page ${old} ("Chief of Staff's Memory") hasn't been split into a core profile and records yet`);
});

it("cuts a long core profile to the cap and to what is left of BB's 4,096 characters, and says where the rest is", () => {
  const long = Array.from({ length: 400 }, (_, index) => `- Rule ${index}: keep it short.`).join("\n");
  const capped = memoryInstructions({ botName: "Dot", role: "conversation", profile: { pageId: "pg_p", markdown: long }, legacy: null });
  const profile = /<core-profile>\n([\s\S]*)\n<\/core-profile>/.exec(capped)![1]!;
  expect(profile.length).toBeLessThanOrEqual(PROFILE_CAP_CHARS);
  expect(profile.endsWith("keep it short.")).toBe(true);
  expect(capped).toMatch(/\(Cut here: the rest of the core profile is on page pg_p; read it with pages_read\.\)$/);
  // After 3,000 characters of the Bot's own instructions, the whole block still fits.
  const block = memoryInstructions({ botName: "Dot", role: "conversation", profile: { pageId: "pg_p", markdown: long }, legacy: null, room: INSTRUCTIONS_LIMIT - 3000 - 2 });
  expect(block.length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT - 3000 - 2);
  expect(fillSlot(`${"x".repeat(3000)}\n\n${MEMORY_SLOT}`, block).length).toBeLessThanOrEqual(INSTRUCTIONS_LIMIT);
  const short = memoryInstructions({ botName: "Dot", role: "conversation", profile: { pageId: "pg_p", markdown: MEMORY_PAGE.slice(0, 400) }, legacy: null });
  expect(short).not.toContain("Cut here");
});

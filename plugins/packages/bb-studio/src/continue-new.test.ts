import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTINUE_TOOL, continueInNew, continueResult, continuedFromLine, continuedLines, handoffText, registerContinueNew, sourceSeqOf, type ContinueDeps } from "./continue-new";
import { MIGRATIONS } from "./migrations";
import { findCardMessage, type TimelineReader } from "./work/register";
import { WorkCardStore } from "./work/store";

const NOW = new Date("2026-11-13T15:00:00Z").getTime();
let db: Database.Database;
let work: WorkCardStore;
let spawned: Record<string, unknown>[];
let recorded: [string, string][];
let changed: string[];

const TIMELINE = [
  { id: "u1", kind: "conversation", role: "user", text: "Let's plan the trip", messageSeq: 10 },
  { id: "a1", kind: "conversation", role: "assistant", text: "Sure", messageSeq: 11 },
  { id: "u2", kind: "conversation", role: "user", text: "Also, the HUD needs a rethink", messageSeq: 12 },
  { id: "a2", kind: "conversation", role: "assistant", text: "Pick up the HUD in its own conversation?", messageSeq: 13 },
  { id: "u3", kind: "conversation", role: "user", text: "Yes, do it", messageSeq: 14 },
  { id: "w1", kind: "work", role: "assistant", messageSeq: 15 },
];

function deps(patch: Partial<ContinueDeps> = {}): ContinueDeps {
  return {
    conversation: (threadId) => ({ thr_main: { botId: "bot_a", kind: "conversation" as const }, thr_worker: { botId: "bot_a", kind: "worker" as const } })[threadId] ?? null,
    thread: async () => ({ projectId: "personal", environmentId: "env_1" }),
    timeline: async () => TIMELINE,
    defaultModel: () => ({ providerId: "codex", model: "gpt-5.5", reasoning: "high" }),
    spawn: async (request) => { spawned.push(request); return { id: "thr_hud", projectId: "personal" }; },
    recordConversation: (threadId, botId) => { recorded.push([threadId, botId]); },
    focus: () => {},
    card: (id) => work.find(id),
    moveCard: (id, threadId) => work.move(id, threadId),
    changed: (threadId) => { changed.push(threadId); },
    ...patch,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = new Database(":memory:");
  db.exec(MIGRATIONS.find((sql) => sql.includes("CREATE TABLE work_cards"))!);
  work = new WorkCardStore(db);
  spawned = [];
  recorded = [];
  changed = [];
});
afterEach(() => { db.close(); vi.useRealTimers(); });

it("starts a conversation of the same Bot from the handoff, not the transcript", async () => {
  const result = await continueInNew(deps(), "thr_main", { title: "HUD redesign", handoff: "**Decisions**\n- Keep the compass\n\n**Open questions**\n- Dark mode?" });
  expect(result).toMatchObject({ threadId: "thr_hud", projectId: "personal", title: "HUD redesign", moved: [], skipped: [] });
  expect(spawned).toHaveLength(1);
  const request = spawned[0]!;
  expect(request).toMatchObject({
    projectId: "personal", title: "HUD redesign", visibility: "visible",
    environment: { type: "reuse", environmentId: "env_1" },
    pluginMetadata: { botConversation: "bot_a", continuedFrom: { threadId: "thr_main", messageSeq: 14 } },
    providerId: "codex", model: "gpt-5.5", reasoningLevel: "high",
  });
  expect(request).not.toHaveProperty("sourceThreadId");
  expect(request).not.toHaveProperty("sourceSeqEnd");
  for (const forkOnly of ["parentThreadId", "originKind", "startedOnBehalfOf", "senderThreadId"]) expect(request).not.toHaveProperty(forkOnly);
  const input = request.input as { text: string; visibility?: string }[];
  expect(input[0]).toEqual({ type: "text", text: "Continued from another conversation", mentions: [] });
  expect(input[1]!.visibility).toBe("agent-only");
  const text = input[1]!.text;
  expect(text.startsWith("Continued from @thread:thr_main#msg=14\n\n**Decisions**")).toBe(true);
  expect(text).toContain("Dark mode?");
  for (const row of TIMELINE) if (row.text) expect(text).not.toContain(row.text);
  expect(recorded).toEqual([["thr_hud", "bot_a"]]);
  expect(changed).toEqual(["thr_hud", "thr_main"]);
});

it("leaves a link card for the source conversation that reads as a plain link where cards aren't known", async () => {
  const result = await continueInNew(deps(), "thr_main", { title: "HUD redesign", handoff: "Notes" });
  expect(result.post).toBe('::continued{to="thr_hud" title="HUD redesign"}\n[Continued in HUD redesign →](/threads/thr_hud)');
  const [card, link] = result.post.split("\n");
  const iosDirective = /^::([A-Za-z][\w-]*)\{(.*)\}$/;
  const iosCards = new Set(["artifact", "page", "drawing", "design", "recording", "mini", "inline-vis", "loop", "loops"]);
  expect(card).toMatch(iosDirective);
  expect(iosCards.has(card!.match(iosDirective)![1]!)).toBe(false);
  expect(link).not.toMatch(/^::/);
  expect(link).toMatch(/^\[[^\]]+\]\(\/threads\/thr_hud\)$/);
  expect(continuedLines("thr_x", 'Odd "title" {with} [brackets]\nand lines')).toBe('::continued{to="thr_x" title="Odd title with [brackets] and lines"}\n[Continued in Odd "title" {with} brackets and lines →](/threads/thr_x)');
  expect(JSON.parse(continueResult(result))).toEqual({ threadId: "thr_hud", title: "HUD redesign", moved: [], post: result.post });
});

it("moves the topic's work cards: each conversation's In flight list shows only its own", async () => {
  const hud = work.create({ title: "HUD mockups", threadId: "thr_main", kind: "worker" });
  const trip = work.create({ title: "Trip bookings", threadId: "thr_main" });
  const other = work.create({ title: "Release", threadId: "thr_elsewhere" });
  work.placed(hud.id, "m_hud", 12);
  vi.setSystemTime(NOW + 5_000);
  const result = await continueInNew(deps(), "thr_main", { title: "HUD redesign", handoff: "Notes", workCards: [hud.id, other.id, "wc_missing"], openingMessage: "Show the two layouts and ask which" });
  expect(result.moved).toEqual([hud.id]);
  expect(result.skipped).toEqual([other.id, "wc_missing"]);
  expect(JSON.parse(continueResult(result))).toMatchObject({ notMoved: [other.id, "wc_missing"] });
  expect(work.get(hud.id)).toMatchObject({ threadId: "thr_hud", messageId: null, messageSeq: null, title: "HUD mockups", updatedAt: NOW + 5_000 });
  expect(work.get(other.id).threadId).toBe("thr_elsewhere");
  expect(work.inFlight("thr_main").map((card) => card.id)).toEqual([trip.id]);
  expect(work.inFlight("thr_hud").map((card) => card.id)).toEqual([hud.id]);
  const text = (spawned[0]!.input as { text: string }[])[1]!.text;
  expect(text).toContain(`**Moved here:** HUD mockups. Post each card once, on its own line, in your first reply: \`::work{id="${hud.id}"}\``);
  expect(text.endsWith("**First:** Show the two layouts and ask which")).toBe(true);
  const read: TimelineReader = async (threadId) => ({ rows: threadId === "thr_hud" ? [{ id: "r1", kind: "conversation", role: "assistant", text: `Picking up the HUD.\n\n::work{id="${hud.id}"}`, messageSeq: 3 }] : [] });
  expect(await findCardMessage(read, work.get(hud.id))).toEqual({ messageId: "r1", messageSeq: 3 });
});

it("refuses a worker, a thread with no project, and bad input, and starts nothing", async () => {
  await expect(continueInNew(deps(), "thr_worker", { title: "X", handoff: "Y" })).rejects.toThrow(/conversation with the user/);
  await expect(continueInNew(deps(), "thr_unknown", { title: "X", handoff: "Y" })).rejects.toThrow(/conversation with the user/);
  await expect(continueInNew(deps({ thread: async () => null }), "thr_main", { title: "X", handoff: "Y" })).rejects.toThrow(/no project/);
  await expect(continueInNew(deps(), "thr_main", { title: "X", handoff: "" })).rejects.toThrow();
  await expect(continueInNew(deps(), "thr_main", { title: "X", handoff: "x".repeat(4_001) })).rejects.toThrow();
  expect(spawned).toEqual([]);
});

it("opens with one plain line naming where it came from: Main, or the conversation's title", () => {
  expect(continuedFromLine({ isMain: true, title: "Assistant" })).toBe("Continued from Main");
  expect(continuedFromLine({ isMain: false, title: "Spring  menu" })).toBe("Continued from “Spring menu”");
  expect(continuedFromLine({})).toBe("Continued from another conversation");
});

it("links back to the user's latest message, and starts without a model or an environment when there's none", async () => {
  expect(sourceSeqOf(TIMELINE)).toBe(14);
  expect(sourceSeqOf([{ kind: "conversation", role: "user", initiator: "agent", messageSeq: 3 }, { kind: "conversation", role: "assistant", messageSeq: 4 }])).toBeNull();
  expect(handoffText({ sourceThreadId: "thr_main", sourceSeq: null, handoff: " Notes ", moved: [] })).toBe("Continued from @thread:thr_main\n\nNotes\n\n**First:** a one-line recap and the next step.");
  await continueInNew(deps({ defaultModel: () => null, thread: async () => ({ projectId: "proj_1", environmentId: null }), timeline: async () => { throw new Error("offline"); } }), "thr_main", { title: "T", handoff: "H" });
  expect(spawned[0]).toMatchObject({ projectId: "proj_1", environment: { type: "project-default" } });
  expect(spawned[0]).not.toHaveProperty("model");
  expect((spawned[0]!.input as { text: string }[])[1]!.text.startsWith("Continued from @thread:thr_main\n\n")).toBe(true);
});

it("without a Bot default model, starts on the provider and model the source conversation uses, not the project's default", async () => {
  await continueInNew(deps({ defaultModel: () => null, thread: async () => ({ projectId: "proj_1", environmentId: null, providerId: "claude-code", model: "opus" }) }), "thr_main", { title: "T", handoff: "H" });
  expect(spawned[0]).toMatchObject({ providerId: "claude-code", model: "opus", executionInputSources: { providerId: "explicit", model: "explicit" } });
});

it("registers the tool, which answers with the post line and reports failures as text", async () => {
  const tools = new Map<string, { execute: (input: unknown, ctx: { threadId?: string }) => Promise<string> }>();
  registerContinueNew({ agents: { registerTool: (tool: { name: string; execute: never }) => { tools.set(tool.name, tool); } } } as never, deps());
  const tool = tools.get(CONTINUE_TOOL)!;
  expect(JSON.parse(await tool.execute({ title: "HUD", handoff: "Notes" }, { threadId: "thr_main" }))).toMatchObject({ threadId: "thr_hud", post: continuedLines("thr_hud", "HUD") });
  expect(await tool.execute({ title: "HUD", handoff: "Notes" }, {})).toMatch(/conversation the topic is in/);
  expect(await tool.execute({ title: "HUD", handoff: "Notes" }, { threadId: "thr_worker" })).toMatch(/conversation with the user/);
});

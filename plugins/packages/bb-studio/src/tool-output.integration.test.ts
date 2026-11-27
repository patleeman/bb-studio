// Long tool results in parts (src/paging.ts), on the real plugin in the SDK's fake host: each walk follows the
// "Next:" calls exactly as written (through the merged tool an agent sees) until there is none, and checks
// that every item came once, in order, and that a stale cursor says so.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import plugin from "../server";

type Tool = { name: string; execute(input: unknown, ctx: unknown): Promise<unknown> };
// Seeding hundreds of items is slow on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
let tools: Map<string, Tool>;
let configure: (context: unknown) => unknown;
let dispose: () => Promise<void> = async () => {};
let db: { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown } } | null = null;
const MAIN = "thr_out_main";
const MINI_FILES = { "mini.json": JSON.stringify({ entry: "main.jsx", libs: [], collections: { items: { indexes: [] } } }), "main.jsx": "export default function App() { return null; }\n" };

const run = async (name: string, input: unknown, threadId = MAIN) => {
  const result = await tools.get(name)!.execute(input, { threadId, projectId: "proj_personal", callId: "call_1" });
  if (typeof result === "string") return result;
  const content = (result as { content?: { text?: string }[] }).content;
  return content ? content.map((each) => each.text ?? "").join("") : JSON.stringify(result);
};

/** The call a reply's "Next:" line names, parsed: tool name and arguments. */
export function nextCall(reply: string): { tool: string; args: Record<string, unknown> } | null {
  const match = /Next: ([a-z_]+) \{ (.*?) \}\./.exec(reply);
  if (!match) return null;
  return { tool: match[1]!, args: JSON.parse(`{${match[2]!.replace(/(^|, )([A-Za-z_]+): /g, '$1"$2": ')}}`) as Record<string, unknown> };
}

/** Follows Next calls from a first reply; returns every reply. */
async function walk(first: string, limit = 60): Promise<string[]> {
  const replies = [first];
  let next = nextCall(first);
  while (next && replies.length < limit) {
    const reply = await run(next.tool, next.args);
    replies.push(reply);
    next = nextCall(reply);
  }
  expect(next, "the walk ended").toBeNull();
  return replies;
}

const all = (replies: string[], pattern: RegExp) => replies.flatMap((reply) => [...reply.matchAll(pattern)].map((match) => match[1]!));

beforeAll(async () => {
  const thread = (threadId: string) => ({ id: threadId, projectId: "proj_personal", environmentId: "env", providerId: "claude-code", model: "claude-opus-5-5", title: null, status: "idle", parentThreadId: null, sourceThreadId: null, createdAt: 1, updatedAt: 1, archivedAt: null });
  const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async ({ threadId }: { threadId: string }) => thread(threadId), defaultExecutionOptions: async () => ({ providerId: "claude-code", model: "claude-opus-5-5" }), updatePluginMetadata: async () => ({}), setVisibility: async () => ({}), update: async () => ({}) }, projects: { list: async () => [] } } } as never);
  await plugin(host.bb);
  configure = host.harness.registrations.agentConfigurationProvider as unknown as (context: unknown) => unknown;
  tools = new Map((host.harness.registrations as unknown as { agentTools: Tool[] }).agentTools.map((tool) => [tool.name, tool]));
  const database = host.bb.storage.database() as unknown as { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown } };
  db = database;
  // The primary Bot's own thread is MAIN (Studio keeps its Bots in memory, so through its RPC, not the database).
  const answer = await (host.harness as unknown as { callRpc(method: string, input: unknown): Promise<{ bot: { id: string } }> }).callRpc("bot_set_thread", { threadId: MAIN });
  const botId = answer.bot.id;
  const now = Date.now();
  for (let index = 0; index < 70; index++) {
    database.prepare("INSERT INTO bot_threads (thread_id, bot_id, kind, is_main, title, latest, activity_at, source, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, 'created', ?, ?)")
      .run(`thr_c${String(index).padStart(3, "0")}`, botId, index < 40 ? "conversation" : "worker", `Conversation ${index} ${"about something ".repeat(4)}`, `The latest line of ${index} ${"words ".repeat(30)}`, now - index * 1000, now - index * 1000, now);
  }
  // Talk recordings: 60 short ones that mention "zebra", and one long transcript.
  const recording = database.prepare("INSERT INTO recordings (id, title, title_source, kind, status, created_at, updated_at, heartbeat_at) VALUES (?, ?, 'user', 'dictation', 'done', ?, ?, ?)");
  const segment = database.prepare("INSERT INTO segments (recording_id, id, session_id, idx, started_at, duration_ms, mime_type, bytes, file, status, text, created_at) VALUES (?, ?, 's1', ?, ?, 1000, 'audio/webm', 1, 'f', 'done', ?, ?)");
  for (let index = 0; index < 60; index++) {
    const id = `rec_${String(index).padStart(3, "0")}`;
    recording.run(id, `Recording ${index} ${"about the zoo ".repeat(3)}`, now - index * 1000, now - index * 1000, now);
    segment.run(id, "seg_0", 0, now, `We saw a zebra near gate ${index}. ${"Then we walked on. ".repeat(10)}`, now);
  }
  recording.run("rec_long", "Long meeting", now - 999_999, now - 999_999, now);
  for (let index = 0; index < 400; index++) segment.run("rec_long", `seg_${index}`, index, now + index, `Sentence ${index}: ${"the plan moves forward ".repeat(5)}`, now);
  // Main's session: Claude Code gets every tool, so the merged tools' op checks see it all.
  configure({ pluginMetadata: {}, thread: { id: MAIN, title: null, parentThreadId: null, sourceThreadId: null }, project: { id: "proj_personal", kind: "personal", name: "Personal", gitRemoteUrl: null }, environment: { id: "env", name: null, path: null, branchName: null, workspaceProvisionType: null }, host: { id: "host", name: "host" }, provider: { id: "claude-code", model: "claude-opus-5-5", capabilities: { supportsNativeUserQuestion: false } }, origin: { kind: null, pluginId: null } });
  dispose = () => host.harness.lifecycle.dispose();
});
afterAll(() => dispose());

describe("skills", () => {
  it("lists every skill once, in parts", async () => {
    for (let index = 0; index < 40; index++) await run("bot_skill", { op: "edit", change: "write", name: `skill-${String(index).padStart(2, "0")}`, description: `Use when ${"something specific happens ".repeat(10)}`, body: "Do the thing." });
    const replies = await walk(await run("bot_skill", { op: "list" }));
    expect(replies.length).toBeGreaterThan(1);
    const seen = all(replies, /^- (skill-\d+)/gm);
    expect(seen).toEqual(Array.from({ length: 40 }, (_, index) => `skill-${String(index).padStart(2, "0")}`).filter((name) => seen.includes(name)));
    expect(new Set(seen).size).toBe(40);
    expect(await run("bot_skill", { op: "list", after: "not-a-cursor" })).toMatch(/That cursor is no longer in this list.*Start again: bot_skill \{ op: "list" \}/);
  });

  it("reads a long skill in parts that add up to the whole body", async () => {
    const body = Array.from({ length: 300 }, (_, index) => `Step ${index}: ${"do this carefully ".repeat(3)}`).join("\n");
    await run("bot_skill", { op: "edit", change: "write", name: "long-skill", description: "A long one.", body });
    const replies = await walk(await run("bot_skill", { op: "view", name: "long-skill" }));
    expect(replies.length).toBeGreaterThan(1);
    expect(replies[0]!.split("\n")[2]).toMatch(/^\(Characters 0–[\d,]+ of [\d,]+\. Next: bot_skill \{ op: "view"/);
    const text = replies.map((reply) => reply.slice(reply.indexOf("\n\n") + 2)).join("");
    expect(text).toBe(body);
    expect(await run("bot_skill", { op: "view", name: "long-skill", offset: 999_999 })).toMatch(/past its end/);
  });
});

describe("conversations", () => {
  it("lists every conversation and worker once, with each section's heading in its parts", async () => {
    const replies = await walk(await run("bot_info", { view: "conversations" }));
    expect(replies.length).toBeGreaterThan(1);
    const seen = all(replies, /\(\/threads\/(thr_c\d+)\)/g);
    expect(seen.length).toBe(70);
    expect(new Set(seen).size).toBe(70);
    expect(replies.some((reply, index) => index > 0 && reply.includes("Workers (agents you started"))).toBe(true);
    expect(await run("bot_info", { view: "conversations", after: "thr_gone" })).toMatch(/Thread thr_gone is no longer in this list.*Start again: bot_info \{ view: "conversations" \}/);
  });
});

describe("areas", () => {
  it("lists every area once as a short line, in parts", async () => {
    for (let index = 0; index < 50; index++) expect(await run("area", { op: "update", area: `Area ${String(index).padStart(2, "0")}`, covers: "Things", status: "ok", now: `Fine. ${"Nothing new to report here today. ".repeat(8)}` })).not.toMatch(/^Error/);
    const replies = await walk(await run("area", { op: "list" }));
    expect(replies.length).toBeGreaterThan(1);
    const seen = all(replies, /"name":"(Area \d+)"/g);
    expect(new Set(seen).size).toBe(50);
    expect(seen.length).toBe(50);
    expect(await run("area", { op: "list", after: "not-a-cursor" })).toMatch(/Start again: area \{ op: "list" \}/);
  });
});

describe("apps", () => {
  it("finds a mini app's records in parts, each once, and refuses an offset past the end", async () => {
    const created = await run("apps", { op: "create", type: "mini", input: { name: "Tracker", files: MINI_FILES } });
    const miniId = /mini_[A-Za-z0-9]+/.exec(created)![0];
    for (let index = 0; index < 80; index++) await run("minis_data", { miniId, op: "insert", collection: "items", data: { title: `Item ${index}`, note: "x".repeat(200) } });
    const replies = await walk(await run("minis_data", { miniId, op: "find", collection: "items" }));
    expect(replies.length).toBeGreaterThan(2);
    const seen = all(replies, /"title": "(Item \d+)"/g);
    expect(seen.length).toBe(80);
    expect(new Set(seen).size).toBe(80);
    expect(await run("minis_data", { miniId, op: "find", collection: "items", query: { offset: 500 } })).toMatch(/past the end/);
  });

  it("reads a long artifact in parts that add up to its text", async () => {
    const content = Array.from({ length: 900 }, (_, index) => `Line ${index}: ${"text ".repeat(8)}`).join("\n");
    const created = await run("apps", { op: "create", type: "artifact", input: { title: "Notes", name: "notes.md", content } });
    const id = /art_[A-Za-z0-9]+/.exec(created)![0];
    const replies = await walk(await run("apps", { op: "read", id }));
    expect(replies.length).toBeGreaterThan(2);
    expect(replies[0]).toMatch(/Next: apps \{ op: "read", id: "art_/);
    for (let index = 0; index < 900; index += 97) expect(replies.filter((reply) => reply.includes(`Line ${index}: `)).length).toBe(1);
    expect(await run("apps", { op: "read", id, offset: 9_999_999 })).toMatch(/past its end/);
  });

  it("lists apps in parts", async () => {
    for (let index = 0; index < 120; index++) await run("apps", { op: "create", type: "mini", input: { name: `App ${String(index).padStart(3, "0")} ${"long name part ".repeat(3)}`, files: MINI_FILES } });
    const replies = await walk(await run("apps", { op: "list" }));
    expect(replies.length).toBeGreaterThan(1);
    const seen = all(replies, /\(id (mini_[A-Za-z0-9]+)/g);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(121);
  });
});

describe("pages", () => {
  it("lists every page once, in parts", async () => {
    for (let index = 0; index < 150; index++) await run("pages_create", { title: `Page ${String(index).padStart(3, "0")} ${"with a long title ".repeat(2)}`, markdown: "x" });
    const replies = await walk(await run("pages_read", {}));
    expect(replies.length).toBeGreaterThan(1);
    expect(replies[0]!.split("\n")[1]).toMatch(/^\(Showing 1–\d+ of \d+ pages\. Next: pages_read \{ after: "pg_/);
    const seen = all(replies, /\(id (pg_[A-Za-z0-9]+)/g);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(150);
    expect(await run("pages_read", { after: "pg_gone" })).toMatch(/Page pg_gone is no longer in this list.*Start again: pages_read \{\}/);
  });

  it("reads a design's named screens in parts, the rest named in Next", async () => {
    const created = await run("pages_create", { title: "Screens", type: "design" });
    const designId = /dsn_[A-Za-z0-9]+/.exec(created)![0];
    for (const screenId of ["1a", "1b", "1c", "1d"]) await run("design_screen", { op: "write", designId, screenId, html: `<!doctype html><title>${screenId}</title><body>${`<p>screen ${screenId}</p>`.repeat(700)}</body>` });
    const replies = await walk(await run("pages_read", { page: designId, screenIds: ["1a", "1b", "1c", "1d"] }));
    expect(replies.length).toBeGreaterThan(1);
    for (const screenId of ["1a", "1b", "1c", "1d"]) expect(replies.filter((reply) => reply.includes(`"${screenId}": "<!doctype html><title>${screenId}`)).length).toBe(1);
  });
});

describe("talk", () => {
  it("lists and searches recordings in parts, each once", async () => {
    const listed = await walk(await run("talk", { op: "list" }));
    expect(listed.length).toBeGreaterThan(1);
    const ids = all(listed, /\((rec_[a-z0-9_]+)\)/g);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(61);
    const found = await walk(await run("talk", { op: "search", query: "zebra" }));
    expect(found.length).toBeGreaterThan(1);
    const hits = all(found, /\((rec_\d+)\)/g);
    expect(new Set(hits).size).toBe(60);
    expect(hits.length).toBe(60);
    expect(await run("talk", { op: "list", after: "not-a-cursor" })).toMatch(/Start again: talk \{ op: "list" \}/);
  });

  it("reads a long transcript in parts, the Next call right after the title", async () => {
    const replies = await walk(await run("talk", { op: "read", id: "rec_long" }));
    expect(replies.length).toBeGreaterThan(2);
    expect(replies[0]!.split("\n\n")[1]).toMatch(/^\(Characters 0–[\d,]+ of [\d,]+\. Next: talk \{ op: "read", id: "rec_long", offset: \d+ \}\.\)$/);
    for (let index = 0; index < 400; index += 37) expect(replies.filter((reply) => reply.includes(`Sentence ${index}: `)).length).toBe(1);
    expect(await run("talk", { op: "read", id: "rec_long", offset: 9_999_999 })).toMatch(/past its end/);
  });
});

describe("schedule", () => {
  it("lists scheduled items as short lines in parts, each once, and one in full by id", async () => {
    const created: string[] = [];
    for (let index = 0; index < 70; index++) {
      const reply = await run("schedule", { op: "create", kind: "checkin", name: `Check ${String(index).padStart(2, "0")} ${"of the morning list ".repeat(2)}`.trim().slice(0, 60), instruction: `Look at the ${index}th thing. ${"Be thorough about every detail of it. ".repeat(20)}`, schedule: { times: ["09:00"] } });
      created.push(reply);
    }
    expect(created[0]).not.toMatch(/can't take|isn't available|Error/);
    const replies = await walk(await run("schedule", { op: "list" }));
    expect(replies.length).toBeGreaterThan(1);
    const names = all(replies, /^- (Check \d+)/gm);
    expect(new Set(names).size).toBe(70);
    expect(names.length).toBe(70);
    expect(replies.join("\n")).not.toContain("Be thorough about every detail of it. Be thorough");
    const id = /- Check \d+[^(]*\(checkin, ([a-z0-9_]+), /.exec(replies.join("\n"))![1]!;
    expect(await run("schedule", { op: "list", id })).toContain("Be thorough about every detail of it. Be thorough");
    expect(await run("schedule", { op: "list", after: "aut_gone" })).toMatch(/Scheduled item aut_gone is no longer in this list.*Start again: schedule \{ op: "list" \}/);
  });
});

describe("parts while the data changes", () => {
  it("migrates every mini app record once while following Next (a find whose matches change)", async () => {
    const created = await run("apps", { op: "create", type: "mini", input: { name: "Migrate", files: MINI_FILES } });
    const miniId = /mini_[A-Za-z0-9]+/.exec(created)![0];
    for (let index = 0; index < 90; index++) await run("minis_data", { miniId, op: "insert", collection: "items", data: { n: index, v: 1, note: "y".repeat(150) } });
    const query = { where: { v: 1 } };
    const migrated: number[] = [];
    let reply = await run("minis_data", { miniId, op: "find", collection: "items", query });
    for (let guard = 0; guard < 20; guard++) {
      const records = JSON.parse(reply.slice(reply.indexOf("<mini-data>") + 11, reply.indexOf("</mini-data>"))) as { id: string; data: { n: number } }[];
      for (const record of records) { await run("minis_data", { miniId, op: "patch", collection: "items", recordId: record.id, fields: { v: 2 } }); migrated.push(record.data.n); }
      const next = nextCall(reply);
      if (!next) break;
      reply = await run(next.tool, next.args);
    }
    expect(migrated.length).toBe(90);
    expect(new Set(migrated).size).toBe(90);
    expect(await run("minis_data", { miniId, op: "count", collection: "items", query })).toBe("0 record(s).");
  });

  it("doesn't repeat recordings when one is retitled between parts", async () => {
    const first = await run("talk", { op: "list" });
    const shown = all([first], /\((rec_[a-z0-9_]+)\)/g);
    db!.prepare("UPDATE recordings SET title = 'Renamed', updated_at = ? WHERE id = ?").run(Date.now() + 10_000, shown.at(-1));
    db!.prepare("UPDATE recordings SET title = 'Renamed too', updated_at = ? WHERE id = ?").run(Date.now() + 10_000, shown[0]);
    const rest = await walk(first);
    const ids = all(rest, /\((rec_[a-z0-9_]+)\)/g);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(61);
  });

  it("ends a conversations list with no workers by saying so once, at the end", async () => {
    db!.prepare("UPDATE bot_threads SET kind = 'conversation' WHERE kind = 'worker'").run();
    const replies = await walk(await run("bot_info", { view: "conversations" }));
    expect(replies.length).toBeGreaterThan(1);
    expect(replies.filter((reply) => reply.includes("Workers (agents you started")).length).toBe(1);
    expect(replies.at(-1)).toMatch(/Workers \(agents you started[^\n]*\n- none/);
  });

  it("keeps a design reply inside its cap when a screen's HTML is mostly quotes", async () => {
    const created = await run("pages_create", { title: "Quotes", type: "design" });
    const designId = /dsn_[A-Za-z0-9]+/.exec(created)![0];
    const html = `<!doctype html><body>${'<p class="a" data-x="b">"q" 🙂</p>\n'.repeat(2900)}</body>`;
    for (const screenId of ["1a", "1b"]) await run("design_screen", { op: "write", designId, screenId, html });
    const replies = await walk(await run("pages_read", { page: designId, screenIds: ["1a", "1b"] }));
    for (const reply of replies) expect(reply.length).toBeLessThanOrEqual(120_000);
    for (const reply of replies) expect(reply).not.toMatch(/\\ud83d"/);
  });

  it("follows cursors for skills and areas with the longest names, non-ASCII ones too", async () => {
    // A 64-character skill name and an 80-character CJK area name make the longest keyset cursors.
    const skills = Array.from({ length: 30 }, (_, index) => `long-${String(index).padStart(2, "0")}-${"x".repeat(56)}`);
    expect(skills[0]!.length).toBe(64);
    for (const name of skills) await run("bot_skill", { op: "edit", change: "write", name, description: `Use when ${"something specific happens ".repeat(10)}`, body: "Do it." });
    const skillReplies = await walk(await run("bot_skill", { op: "list" }));
    const shownSkills = all(skillReplies, /^- (long-\d+-x+)/gm);
    expect(shownSkills.sort()).toEqual(skills);
    expect(skillReplies.slice(0, -1).some((reply) => (nextCall(reply)!.args.after as string).length > 64)).toBe(true);
    const areas = Array.from({ length: 40 }, (_, index) => `${String(index).padStart(2, "0")}${"区域名称".repeat(19)}和`);
    expect(areas[0]!.length).toBe(79);
    for (const area of areas) expect(await run("area", { op: "update", area: `${area}é`, covers: "Things", status: "ok", now: `Fine. ${"Nothing new. ".repeat(20)}` })).not.toMatch(/^Error/);
    const areaReplies = await walk(await run("area", { op: "list" }));
    const shownAreas = all(areaReplies, /"name":"(\d\d区域[^"]+)"/g);
    expect(shownAreas.sort()).toEqual(areas.map((area) => `${area}é`));
    expect(areaReplies.slice(0, -1).some((reply) => (nextCall(reply)!.args.after as string).length > 200)).toBe(true);
  });

  it("caps talk lists by creation, the order its parts go in, and keeps each part near its budget", async () => {
    // 460 more recordings, made before the others, with long titles: 521 in all, over the 500 cap.
    const now = Date.now();
    const recording = db!.prepare("INSERT INTO recordings (id, title, title_source, kind, status, created_at, updated_at, heartbeat_at) VALUES (?, ?, 'user', 'dictation', 'done', ?, ?, ?)");
    for (let index = 0; index < 460; index++) recording.run(`rec_old_${String(index).padStart(3, "0")}`, `Old recording ${index} ${"with a long title ".repeat(12)}`, now - 10_000_000 - index * 1000, now - 10_000_000 - index * 1000, now);
    // The oldest is edited now: last changed, but still the oldest made, so it stays past the cap.
    db!.prepare("UPDATE recordings SET updated_at = ? WHERE id = 'rec_old_459'").run(now + 60_000);
    const first = await run("talk", { op: "list" });
    expect(first.split("\n")[0]).toBe("At least 500 recordings, newest first.");
    const replies = await walk(first, 100);
    const ids = all(replies, /\((rec_[a-z0-9_]+)\)/g);
    expect(ids.length).toBe(500);
    expect(new Set(ids).size).toBe(500);
    expect(ids).toContain("rec_000");
    expect(ids).not.toContain("rec_old_459");
    for (const reply of replies) expect(reply.length).toBeLessThanOrEqual(6_000 + 200);
    db!.prepare("DELETE FROM recordings WHERE id LIKE 'rec_old_%'").run();
  });
});

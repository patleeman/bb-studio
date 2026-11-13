import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SideThreads } from "./bot-side-threads";
import type { ThreadFacts } from "./bot-threads";
import { registerBotThreads } from "./bot-threads-server";
import { MIGRATIONS } from "./migrations";
import { readMirroredSince } from "./mirror-live";
import { ThreadSeeds, turnContext } from "./thread-seeds";

const dispose: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const fn of dispose.splice(0)) await fn(); });

const MAIN_ROWS = [
  { id: "thr_main:user:1", kind: "conversation", role: "user", initiator: "user", text: "When do we ship?", sourceSeqEnd: 4, createdAt: 1 },
  { id: "thr_main:assistant:2", kind: "conversation", role: "assistant", text: "Friday.", sourceSeqEnd: 9, turnId: "t1", createdAt: 2 },
  { id: "thr_main:user:3", kind: "conversation", role: "user", initiator: "user", text: "Who signs off?", sourceSeqEnd: 14, createdAt: 3 },
  { id: "thr_main:assistant:4", kind: "conversation", role: "assistant", text: "QA, on Thursday.", sourceSeqEnd: 19, turnId: "t2", createdAt: 4 },
];

function mirrorDir(rows: { id: string; at: number }[]) {
  const dir = mkdtempSync(join(tmpdir(), "studio-mirror-"));
  dispose.push(() => rmSync(dir, { recursive: true, force: true }));
  const db = new Database(join(dir, "fork-import.db"));
  db.exec("CREATE TABLE mirrored_threads (thread_id TEXT PRIMARY KEY NOT NULL, source_updated_at INTEGER NOT NULL, source_status TEXT NOT NULL, taken_over_at INTEGER)");
  const insert = db.prepare("INSERT OR REPLACE INTO mirrored_threads (thread_id, source_updated_at, source_status) VALUES (?, ?, 'idle')");
  for (const row of rows) insert.run(row.id, row.at);
  db.close();
  return {
    dir,
    add: (id: string, at: number) => { const write = new Database(join(dir, "fork-import.db")); write.prepare("INSERT OR REPLACE INTO mirrored_threads (thread_id, source_updated_at, source_status) VALUES (?, ?, 'idle')").run(id, at); write.close(); },
  };
}

const BB_HOST = "host_bb";
const STUDIO_HOST = "host_studio";

async function setup(options: { mirror?: string; mirroredHost?: boolean; forkFails?: boolean; stock?: boolean } = {}) {
  const threads = new Map<string, ThreadFacts & { environmentId?: string }>([
    ["thr_main", { id: "thr_main", title: "Main", projectId: "proj_personal", createdAt: 1, status: "idle", environmentId: "env_main" }],
  ]);
  const environmentHost = options.mirroredHost ? BB_HOST : STUDIO_HOST;
  const rows = new Map<string, unknown[]>([["thr_main", MAIN_ROWS]]);
  const fork = vi.fn(async (args: { sourceThreadId: string }) => {
    if (options.forkFails) throw Object.assign(new Error("Cannot fork: source has no active session to clone"), { status: 400 });
    const id = `fork_${threads.size}`;
    threads.set(id, { id, title: "Main", projectId: "proj_personal", originKind: "fork", sourceThreadId: args.sourceThreadId, createdAt: 9, status: "idle" });
    return { id, projectId: "proj_personal", providerId: "claude" };
  });
  const spawn = vi.fn(async (args: { projectId: string; title?: string }) => {
    const id = `seeded_${threads.size}`;
    threads.set(id, { id, title: args.title ?? null, projectId: args.projectId, createdAt: 9, status: "idle" });
    return { id, projectId: args.projectId, providerId: "claude" };
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "studio", sdk: {
    threads: {
      list: (async (args: { threadIds?: string[]; sourceThreadId?: string; originPluginId?: string; offset?: number; limit?: number }) => {
        if (args.originPluginId) return [...threads.values()].filter((thread) => thread.sourceThreadId === args.sourceThreadId && thread.originPluginId === args.originPluginId);
        return [...threads.values()].filter((thread) => !args.threadIds || args.threadIds.includes(thread.id)).slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 200));
      }) as never,
      get: (async ({ threadId }: { threadId: string }) => { const thread = threads.get(threadId); if (!thread) throw Object.assign(new Error("Not found"), { status: 404 }); return thread; }) as never,
      timeline: (async ({ threadId, beforeAnchorId }: { threadId: string; beforeAnchorId?: string }) => {
        const all = rows.get(threadId) ?? [];
        if (threadId !== "thr_main") return { rows: all, timelinePage: { olderCursor: null } };
        return beforeAnchorId
          ? { rows: all.slice(0, 2), timelinePage: { olderCursor: null } }
          : { rows: all.slice(2), timelinePage: { olderCursor: { anchorSeq: 10, anchorId: "timeline-v3:older" } } };
      }) as never,
      fork: fork as never,
      spawn: spawn as never,
      update: (async () => ({})) as never,
      output: (async () => ({ output: null })) as never,
      interactions: { list: (async () => []) as never } as never,
      events: { list: (async () => [{ seq: 1, type: "turn/completed", createdAt: Date.now() }]) as never },
    },
    environments: {
      get: (async ({ environmentId }: { environmentId: string }) => ({ id: environmentId, hostId: environmentHost, path: "/Users/me/chief", environmentProviderId: null })) as never,
      list: (async () => []) as never,
    } as never,
    hosts: { list: (async () => [{ id: BB_HOST, status: "disconnected" }, { id: STUDIO_HOST, status: "connected" }]) as never } as never,
    system: { config: (async () => ({ primaryHostId: STUDIO_HOST })) as never } as never,
    projects: { get: (async ({ projectId }: { projectId: string }) => ({ id: projectId, kind: "personal" })) as never } as never,
  } });
  dispose.push(() => harness.lifecycle.dispose());
  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);
  const sides = new SideThreads({ db, sdk: bb.sdk, changed: () => {}, waits: [], botFor: (threadId) => threadId === "thr_main" ? { id: "dot", name: "Dot" } : null });
  const seeds = new ThreadSeeds(db);
  if (!options.stock) seeds.enable();
  const server = registerBotThreads(bb, db, {
    bots: () => [{ id: "dot", name: "Dot", avatar: "🤖", primary: true, threadId: "thr_main" }],
    signals: () => ({ bots: [{ id: "dot", threadId: "thr_main", chain: ["thr_main"] }], sideThread: (threadId) => sides.forThread(threadId), runnerBot: () => null, leadThreads: new Set(), internal: new Set(), managedBot: () => null }),
    items: () => [],
    originThreads: () => new Map(),
    changed: () => {}, log: () => {},
    actingBot: async () => null,
    defaultModel: () => null,
    sideThreads: sides,
    seeds,
    ...(options.mirror ? { mirrored: (since: number) => readMirroredSince(options.mirror!, since) } : {}),
  });
  await server.start();
  return { server, sides, threads, rows, fork, spawn, db, seeds };
}

it("Fork conversation from here records the message it was forked from, so the message shows the fork", async () => {
  const { server, sides, fork, threads } = await setup();
  const made = await server.rpc.bot_fork_conversation({ threadId: "thr_main", messageId: "thr_main:assistant:2", turnId: "t1", sourceSeqEnd: 9 });
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "thr_main", sourceSeqEnd: 9, visibility: "visible" }));
  expect(server.store.get(made.threadId)).toMatchObject({ botId: "dot", kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "thr_main:assistant:2", turnId: "t1" } });
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ title: "Main · fork" }));
  expect(sides.forThread(made.threadId)).toEqual({ botId: "dot", sourceThreadId: "thr_main", messageId: "thr_main:assistant:2" });
  expect(await sides.list("thr_main")).toEqual([expect.objectContaining({ messageId: "thr_main:assistant:2", threadId: made.threadId, kind: "fork", replies: 0, conversations: 1 })]);
  threads.get(made.threadId)!.status = "active";
  expect(await sides.list("thr_main")).toEqual([expect.objectContaining({ messageId: "thr_main:assistant:2", threadId: made.threadId, kind: "fork", conversations: 1 })]);
  const again = await server.rpc.bot_fork_conversation({ threadId: "thr_main", messageId: "thr_main:assistant:2", turnId: "t1", sourceSeqEnd: 9 });
  expect(again.threadId).not.toBe(made.threadId);
  expect(fork).toHaveBeenCalledTimes(2);
});

it("Reply in thread makes the message's thread once, finds where to fork, and reopens it after", async () => {
  const { server, sides, fork } = await setup();
  const [a, b] = await Promise.all([
    server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" }),
    server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" }),
  ]);
  expect(a).toEqual({ threadId: "fork_1", projectId: "proj_personal", created: true });
  expect(b).toEqual(a);
  expect(fork).toHaveBeenCalledTimes(1);
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "thr_main", sourceSeqEnd: 9, visibility: "visible" }));
  expect(server.store.get("fork_1")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "thr_main:assistant:2", turnId: null } });
  expect(await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" })).toEqual({ threadId: "fork_1", projectId: "proj_personal", created: false });
  await server.rpc.bot_fork_conversation({ threadId: "thr_main", messageId: "thr_main:assistant:2", turnId: "t1", sourceSeqEnd: 9 });
  expect(await sides.newest("thr_main", "thr_main:assistant:2")).toBe("fork_1");
  await expect(server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "missing" })).rejects.toThrow("Couldn't find that message");
  await expect(server.rpc.bot_thread_reply({ threadId: "elsewhere", messageId: "m" })).rejects.toThrow(/isn't one of a Bot's/);
});

it("Reply in thread on a conversation mirrored from bb finds an older reply and seeds the thread on this machine", async () => {
  const { server, fork } = await setup({ mirroredHost: true });
  await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" });
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "thr_main", sourceSeqEnd: 9, environment: { type: "host", hostId: STUDIO_HOST, workspace: { type: "personal" } } }));
});

it("a conversation Studio hasn't placed yet is its Bot's on the first owner lookup, so its menu offers Studio's fork from the start", async () => {
  const { server, threads } = await setup();
  threads.set("thr_trip", { id: "thr_trip", title: "Trip", projectId: "proj_personal", createdAt: 30, status: "idle" });
  expect(server.store.get("thr_trip")).toBeNull();
  expect(await server.owner("thr_trip")).toBe("dot");
  expect(server.store.get("thr_trip")).toMatchObject({ kind: "conversation", botId: "dot" });
  expect(await server.owner("thr_missing")).toBeNull();
});

it("a conversation on a machine that is connected forks where it is", async () => {
  const { server, fork } = await setup();
  await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:4" });
  expect(fork).toHaveBeenCalledWith(expect.not.objectContaining({ environment: expect.anything() }));
  expect(fork).toHaveBeenCalledWith(expect.objectContaining({ sourceSeqEnd: 19 }));
});

it("the thread's replies and last replier reach the message's row", async () => {
  const { server, sides, rows } = await setup();
  const { threadId } = await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" });
  rows.set(threadId, [
    { id: `${threadId}:user:1`, kind: "conversation", role: "user", initiator: "user", text: "Why Friday?", createdAt: 50 },
    { id: `${threadId}:assistant:2`, kind: "conversation", role: "assistant", text: "QA signs off Thursday.", turnId: "x", createdAt: 60 },
  ]);
  await sides.recount(threadId);
  expect(await sides.list("thr_main")).toEqual([{ messageId: "thr_main:assistant:2", threadId, botId: "dot", replies: 2, lastReplyAt: 60, lastReplyRole: "assistant", working: false, kind: "reply", conversations: 1 }]);
});

it("the catch-up sorts threads the mirror imported after the first sweep, once, and links forks made from a message", async () => {
  const mirror = mirrorDir([{ id: "thr_main", at: 1 }]);
  const { server, threads, db } = await setup({ mirror: mirror.dir });
  threads.set("mir_review", { id: "mir_review", title: "Dot · skill review", projectId: "proj_personal", originKind: "fork", originPluginId: "studio", visibility: "hidden", sourceThreadId: "thr_main", createdAt: 20, status: "idle" });
  threads.set("mir_side", { id: "mir_side", title: "Dot · Friday", projectId: "proj_personal", originKind: "fork", originPluginId: "side-chat", visibility: "hidden", sourceThreadId: "thr_main", lifecycleOwnerThreadId: "thr_main", createdAt: 21, status: "idle" });
  threads.set("mir_chat", { id: "mir_chat", title: "Trip", projectId: "proj_personal", createdAt: 22, status: "idle" });
  threads.set("mir_old", { id: "mir_old", title: "Old", projectId: "proj_personal", createdAt: 23, status: "idle", archivedAt: 5 });
  db.prepare("INSERT INTO bot_side_threads (thread_id, bot_id, source_thread_id, message_id, created_at) VALUES ('mir_side', 'dot', 'thr_main', 'thr_main:assistant:2', 21)").run();
  for (const [id, at] of [["mir_review", 30], ["mir_side", 31], ["mir_chat", 32], ["mir_old", 33]] as const) mirror.add(id, at);
  for (const id of ["mir_review", "mir_side", "mir_chat"]) expect(server.store.get(id)).toBeNull();

  expect(await server.catchUp()).toEqual({ classified: 3, linked: 0 });
  expect(server.store.get("mir_review")).toMatchObject({ kind: "worker", botId: "dot" });
  expect(server.store.get("mir_review")!.archivedAt).not.toBeNull();
  expect(server.store.get("mir_side")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "thr_main:assistant:2" }, archivedAt: null });
  expect(server.store.get("mir_chat")).toMatchObject({ kind: "conversation", botId: "dot" });
  expect(server.store.get("mir_old")).toBeNull();
  const view = await server.rpc.bot_threads_view({});
  expect(view.conversations.map((each) => each.threadId)).not.toContain("mir_side");

  expect(await server.catchUp()).toEqual({ classified: 0, linked: 0 });
  const rowsBefore = db.prepare("SELECT COUNT(*) AS n FROM bot_threads").get();
  expect(await server.catchUp()).toEqual({ classified: 0, linked: 0 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM bot_threads").get()).toEqual(rowsBefore);

  threads.set("mir_fork", { id: "mir_fork", title: "Fork", projectId: "proj_personal", originKind: "fork", sourceThreadId: "thr_main", createdAt: 40, status: "idle", experimental_sourceMessageId: "thr_main:assistant:2" } as ThreadFacts);
  mirror.add("mir_fork", 40);
  expect(await server.catchUp()).toEqual({ classified: 1, linked: 1 });
  expect(server.store.get("mir_fork")).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "thr_main:assistant:2" } });
  expect(db.prepare("SELECT kind FROM bot_side_threads WHERE thread_id = 'mir_fork'").get()).toEqual({ kind: "fork" });
});

it("reads only the mirror's rows changed since the last sweep", () => {
  const mirror = mirrorDir([{ id: "a", at: 5 }, { id: "b", at: 9 }]);
  expect(readMirroredSince(mirror.dir, -1)).toEqual({ ids: ["a", "b"], newest: 9 });
  expect(readMirroredSince(mirror.dir, 9)).toEqual({ ids: [], newest: 9 });
  mirror.add("c", 12);
  expect(readMirroredSince(mirror.dir, 9)).toEqual({ ids: ["c"], newest: 12 });
  expect(readMirroredSince(join(mirror.dir, "nope"), -1)).toBeNull();
});

it("a fork whose parent session can't be copied starts idle, with the transcript up to the message as its first turn's context", async () => {
  const { server, sides, spawn, threads, seeds } = await setup({ forkFails: true });
  const made = await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" });
  expect(made).toMatchObject({ created: true });
  expect(made.threadId).toMatch(/^seeded_/);
  const args = spawn.mock.calls[0]![0] as unknown as { title: string; input: unknown[]; startedOnBehalfOf?: unknown; environment: unknown };
  expect(args.title).toBe("Main · thread");
  expect(args).not.toHaveProperty("startedOnBehalfOf");
  expect(args.environment).toEqual({ type: "reuse", environmentId: "env_main" });
  expect(args.input).toEqual([]);
  expect(server.store.get(made.threadId)).toMatchObject({ kind: "conversation", forkedFrom: { threadId: "thr_main", messageId: "thr_main:assistant:2" } });
  expect(sides.forThread(made.threadId)).toEqual({ botId: "dot", sourceThreadId: "thr_main", messageId: "thr_main:assistant:2" });
  expect(await sides.list("thr_main")).toEqual([]);
  const context = turnContext(seeds.take(made.threadId), null)!;
  expect(context).toContain("User: When do we ship?\n\nAssistant: Friday.");
  expect(context).not.toContain("Who signs off?");
  expect(seeds.take(made.threadId)).toBeNull();
  threads.get(made.threadId)!.status = "active";
  expect(await sides.list("thr_main")).toEqual([expect.objectContaining({ threadId: made.threadId, kind: "reply", working: true })]);
});

it("on a BB that can't give an idle thread context, a failed fork starts nothing", async () => {
  const { server, spawn } = await setup({ forkFails: true, stock: true });
  await expect(server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" })).rejects.toThrow("Couldn't start a thread from that message.");
  expect(spawn).not.toHaveBeenCalled();
});

it("neither a reply thread nor a fork gets a row in Conversations; their work shows on the parent's row", async () => {
  const { server, threads } = await setup();
  const reply = await server.rpc.bot_thread_reply({ threadId: "thr_main", messageId: "thr_main:assistant:2" });
  const forked = await server.rpc.bot_fork_conversation({ threadId: "thr_main", messageId: "thr_main:assistant:4", turnId: "t2", sourceSeqEnd: 19 });
  threads.set("thr_trip", { id: "thr_trip", title: "Trip", projectId: "proj_personal", createdAt: 30, status: "idle" });
  await server.reconcile();
  let view = await server.rpc.bot_threads_view({});
  expect(view.conversations.map((each) => each.threadId)).not.toContain(reply.threadId);
  expect(view.conversations.map((each) => each.threadId)).not.toContain(forked.threadId);
  expect(view.conversations.find((each) => each.isMain)).toMatchObject({ threadId: "thr_main", running: false });
  threads.get(forked.threadId)!.status = "active";
  server.threadChanged(forked.threadId);
  view = await server.rpc.bot_threads_view({});
  expect(view.conversations.map((each) => each.threadId)).not.toContain(forked.threadId);
  expect(view.conversations.find((each) => each.isMain)).toMatchObject({ threadId: "thr_main", running: true });
  expect((await server.rpc.bot_threads_older({})).conversations.map((each) => each.threadId)).not.toContain(forked.threadId);
});

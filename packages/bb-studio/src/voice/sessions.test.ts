import { describe, expect, it } from "vitest";
import { VOICE_KV_KEY, VoiceSessions } from "./sessions";

type Sent = { threadId: string; mode: string; senderThreadId?: string; input: { text: string; visibility?: string }[] };

function setup(options: { events?: Record<string, { seq: number; type: string; data?: unknown }[]>; bot?: string | null } = {}) {
  const kv = new Map<string, unknown>();
  const spawned: Record<string, unknown>[] = [];
  const sent: Sent[] = [];
  const events = options.events ?? {};
  const sdk = {
    system: { config: async () => ({ primaryHostId: "host_main" }) },
    threads: {
      spawn: async (args: Record<string, unknown>) => { spawned.push(args); return { id: "thr_voice" }; },
      get: async ({ threadId }: { threadId: string }) => ({ id: threadId, title: `Title of ${threadId}` }),
      send: async (args: Sent) => { sent.push(args); return { delivery: "sent" }; },
      events: {
        list: async ({ threadId, afterSeq, order, types }: { threadId: string; afterSeq?: string; order?: string; types?: string[] }) => {
          let rows = (events[threadId] ?? []).filter((row) => !afterSeq || row.seq > Number(afterSeq)).filter((row) => !types || types.includes(row.type));
          if (order === "desc") rows = [...rows].reverse();
          return rows;
        },
      },
    },
  };
  const sessions = new VoiceSessions({
    sdk: sdk as never,
    kv: { get: async (key) => kv.get(key), set: async (key, value) => { kv.set(key, JSON.parse(JSON.stringify(value))); } },
    botThread: () => (options.bot === undefined ? "thr_bot" : options.bot),
    warn: () => {},
  });
  return { sessions, kv, spawned, sent, events };
}

describe("VoiceSessions", () => {
  it("starts a voice chat in a new thread on the fast model, with voice on", async () => {
    const { sessions, kv, spawned } = setup();
    expect(await sessions.start("luna-fast", "proj_app")).toBe("thr_voice");
    expect(spawned[0]).toMatchObject({ projectId: "proj_app", environment: { type: "host", hostId: "host_main", workspace: { type: "unmanaged", path: null } }, providerId: "codex", model: "gpt-6-luna", serviceTier: "fast", executionInputSources: { serviceTier: "explicit" }, pluginMetadata: { voice: "on" } });
    expect((kv.get(VOICE_KV_KEY) as { threads: string[] }).threads).toEqual(["thr_voice"]);
    expect(sessions.isOn("thr_voice")).toBe(true);
    await sessions.start("luna-fast");
    expect(spawned[1]).toMatchObject({ projectId: "proj_personal", environment: { type: "project-default" } });
  });

  it("turns voice mode on and off in any thread", async () => {
    const { sessions } = setup();
    expect(sessions.isOn("thr_code")).toBe(false);
    await sessions.set("thr_code", true);
    await sessions.set("thr_code", true);
    expect(sessions.isOn("thr_code")).toBe(true);
    await sessions.set("thr_code", false);
    expect(sessions.isOn("thr_code")).toBe(false);
    expect(sessions.conversational).toBe(true);
    await sessions.setConversational(false);
    expect(sessions.conversational).toBe(false);
    // A new voice chat's first turn comes before Studio has stored it.
    expect(sessions.isOn("thr_new", { voice: "on" })).toBe(true);
  });

  it("falls back to the first model for an unknown one, and gives Haiku no service tier", async () => {
    const { sessions, spawned } = setup();
    await sessions.start("nope");
    await sessions.start("haiku");
    expect(spawned[0]).toMatchObject({ model: "gpt-6-luna" });
    expect(spawned[1]).toMatchObject({ providerId: "claude-code", model: "claude-haiku-5-5" });
    expect(spawned[1]!.serviceTier).toBeUndefined();
  });

  it("delegates to the Bot as the voice thread, and asks for a speakable summary", async () => {
    const { sessions, sent } = setup({ events: { thr_bot: [{ seq: 7, type: "turn/completed" }] } });
    const result = await sessions.delegate("thr_voice", "Bot", "Check the build.");
    expect(result).toEqual({ threadId: "thr_bot", title: "Title of thr_bot" });
    expect(sent[0]).toMatchObject({ threadId: "thr_bot", senderThreadId: "thr_voice" });
    expect(sent[0]!.input[0]!.text).toBe("Check the build.");
    expect(sent[0]!.input[1]!.visibility).toBe("agent-only");
    expect(sessions.pending("thr_voice")).toEqual(["thr_bot"]);
  });

  it("refuses to delegate to itself or to a Bot that doesn't exist", async () => {
    await expect(setup().sessions.delegate("thr_voice", "thr_voice", "Hi")).rejects.toThrow(/this voice thread/);
    await expect(setup({ bot: null }).sessions.delegate("thr_voice", "bot", "Hi")).rejects.toThrow(/no Bot/);
  });

  it("brings back the reply to the turn it asked for, once", async () => {
    const { sessions, sent, events } = setup({ events: { thr_work: [{ seq: 3, type: "turn/completed" }] } });
    await sessions.delegate("thr_voice", "thr_work", "Run the tests.");
    events.thr_work!.push({ seq: 4, type: "client/turn/requested", data: { senderThreadId: "thr_voice" } });
    expect(await sessions.idle("thr_work", "Two tests fail in auth.")).toBe(true);
    const note = sent.at(-1)!;
    expect(note).toMatchObject({ threadId: "thr_voice", mode: "queue-if-active", senderThreadId: "thr_work" });
    expect(note.input[0]!.visibility).toBe("agent-only");
    expect(note.input[0]!.text).toContain("Two tests fail in auth.");
    expect(sessions.pending("thr_voice")).toEqual([]);
    expect(await sessions.idle("thr_work", "Again.")).toBe(false);
  });

  it("waits when the turn that ended isn't the one it asked for", async () => {
    const { sessions, sent, events } = setup({ events: { thr_work: [{ seq: 3, type: "turn/completed" }] } });
    await sessions.delegate("thr_voice", "thr_work", "Run the tests.");
    const before = sent.length;
    // The thread was busy: an earlier turn ends before ours starts.
    expect(await sessions.idle("thr_work", "Old work done.")).toBe(false);
    // Someone else's turn started after ours.
    events.thr_work!.push({ seq: 4, type: "client/turn/requested", data: { senderThreadId: "thr_voice" } }, { seq: 5, type: "client/turn/requested", data: { senderThreadId: null } });
    expect(await sessions.idle("thr_work", "User's other request.")).toBe(false);
    expect(sent.length).toBe(before);
    expect(sessions.pending("thr_voice")).toEqual(["thr_work"]);
  });

  it("ignores threads it isn't waiting on, and keeps its state across a reload", async () => {
    const { sessions, kv } = setup();
    expect(await sessions.idle("thr_random", "Hi")).toBe(false);
    await sessions.start("luna-fast");
    await sessions.delegate("thr_voice", "thr_work", "Do it.");
    const reloaded = new VoiceSessions({ sdk: {} as never, kv: { get: async (key) => kv.get(key), set: async () => {} }, botThread: () => null, warn: () => {} });
    await reloaded.load();
    expect(reloaded.isOn("thr_voice")).toBe(true);
    expect(reloaded.pending("thr_voice")).toEqual(["thr_work"]);
  });
});

describe("VoiceSessions from the one-session days", () => {
  it("keeps the old session's thread in voice mode", async () => {
    const kv = new Map<string, unknown>([[VOICE_KV_KEY, { session: { threadId: "thr_old", modelId: "luna-fast", startedAt: 1 }, delegations: {} }]]);
    const sessions = new VoiceSessions({ sdk: {} as never, kv: { get: async (key) => kv.get(key), set: async () => {} }, botThread: () => null, warn: () => {} });
    await sessions.load();
    expect(sessions.isOn("thr_old")).toBe(true);
  });
});

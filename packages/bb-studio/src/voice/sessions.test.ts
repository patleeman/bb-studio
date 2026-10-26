import { describe, expect, it, vi } from "vitest";
import { VOICE_KV_KEY, VoiceSessions } from "./sessions";

type Sent = { threadId: string; mode: string; senderThreadId?: string; input: { text: string; visibility?: string }[] };

function setup(options: { events?: Record<string, { seq: number; type: string; data?: unknown }[]>; bot?: string | null } = {}) {
  const kv = new Map<string, unknown>();
  const sent: Sent[] = [];
  const events = options.events ?? {};
  const sdk = {
    threads: {
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
  return { sessions, kv, sent, events, sdk };
}

describe("VoiceSessions", () => {
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
    await sessions.setConversational(true);
    // A voice chat from before New voice chat was removed says so in its metadata.
    expect(sessions.isOn("thr_new", { voice: "on" })).toBe(true);
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

  it("retries a saved result after reload even when the target's latest turn changes", async () => {
    const { sessions, sdk, kv, events } = setup();
    await sessions.delegate("thr_voice", "thr_work", "Run tests");
    events.thr_work = [{ seq: 1, type: "client/turn/requested", data: { senderThreadId: "thr_voice" } }];
    const send = vi.spyOn(sdk.threads, "send").mockRejectedValueOnce(new Error("offline"));
    await expect(sessions.idle("thr_work", "Original result")).rejects.toThrow("offline");
    const stored = kv.get(VOICE_KV_KEY);
    const recovered = setup();
    recovered.kv.set(VOICE_KV_KEY, stored);
    await recovered.sessions.load();
    await recovered.sessions.retryResults();
    expect(recovered.sent[0]!.input[0]!.text).toContain("Original result");
    expect(recovered.sessions.pending("thr_voice")).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed result pending and coalesces concurrent delivery retries", async () => {
    const { sessions, sdk, events } = setup();
    await sessions.delegate("thr_voice", "thr_work", "Run tests");
    events.thr_work = [{ seq: 1, type: "client/turn/requested", data: { senderThreadId: "thr_voice" } }];
    const send = vi.spyOn(sdk.threads, "send").mockRejectedValueOnce(new Error("offline"));
    await expect(sessions.idle("thr_work", "Done")).rejects.toThrow("offline");
    expect(sessions.pending("thr_voice")).toEqual(["thr_work"]);
    await Promise.all([sessions.idle("thr_work", "Done"), sessions.idle("thr_work", "Done")]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sessions.pending("thr_voice")).toEqual([]);
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

  it("keeps delegations from two voice chats to the same Bot and routes each reply to its source", async () => {
    const { sessions, sent, events } = setup({ events: { thr_bot: [{ seq: 7, type: "turn/completed" }] } });
    await sessions.delegate("thr_voice_a", "bot", "Check the build.");
    await sessions.delegate("thr_voice_b", "bot", "Review the release.");
    expect(sessions.pending("thr_voice_a")).toEqual(["thr_bot"]);
    expect(sessions.pending("thr_voice_b")).toEqual(["thr_bot"]);

    events.thr_bot!.push(
      { seq: 8, type: "client/turn/requested", data: { senderThreadId: "thr_voice_a" } },
      { seq: 9, type: "client/turn/requested", data: { senderThreadId: "thr_voice_b" } },
    );
    expect(await sessions.idle("thr_bot", "Release review complete.")).toBe(true);
    expect(sent.at(-1)).toMatchObject({ threadId: "thr_voice_b", senderThreadId: "thr_bot" });
    expect(sessions.pending("thr_voice_a")).toEqual(["thr_bot"]);
    expect(sessions.pending("thr_voice_b")).toEqual([]);
    // A repeated idle callback for the same Bot turn must not consume A's request.
    expect(await sessions.idle("thr_bot", "Duplicate reply.")).toBe(false);
    expect(sessions.pending("thr_voice_a")).toEqual(["thr_bot"]);

    events.thr_bot!.push({ seq: 10, type: "client/turn/requested", data: { senderThreadId: "thr_voice_a" } });
    expect(await sessions.idle("thr_bot", "Build check complete.")).toBe(true);
    expect(sent.at(-1)).toMatchObject({ threadId: "thr_voice_a", senderThreadId: "thr_bot" });
    expect(sessions.pending("thr_voice_a")).toEqual([]);
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

  it("sends the conversational note while it's on, says once that it's off, then nothing", async () => {
    const { sessions } = setup();
    expect(await sessions.turnNote("thr_a")).toBe("on");
    expect(await sessions.turnNote("thr_a")).toBe("on");
    await sessions.setConversational(false);
    expect(await sessions.turnNote("thr_a")).toBe("off");
    expect(await sessions.turnNote("thr_a")).toBeNull();
    // A thread that never had the note isn't told it's off.
    expect(await sessions.turnNote("thr_b")).toBeNull();
    await sessions.setConversational(true);
    expect(await sessions.turnNote("thr_a")).toBe("on");
  });

  it("ignores threads it isn't waiting on, and keeps its state across a reload", async () => {
    const { sessions, kv } = setup();
    expect(await sessions.idle("thr_random", "Hi")).toBe(false);
    await sessions.set("thr_voice", true);
    await sessions.delegate("thr_voice", "thr_work", "Do it.");
    const reloaded = new VoiceSessions({ sdk: {} as never, kv: { get: async (key) => kv.get(key), set: async () => {} }, botThread: () => null, warn: () => {} });
    await reloaded.load();
    expect(reloaded.isOn("thr_voice")).toBe(true);
    expect(reloaded.pending("thr_voice")).toEqual(["thr_work"]);
  });
});

describe("VoiceSessions from the one-session days", () => {
  it("keeps the old session's thread in voice mode", async () => {
    const kv = new Map<string, unknown>([[VOICE_KV_KEY, {
      session: { threadId: "thr_old", modelId: "luna-fast", startedAt: 1 },
      delegations: { thr_work: { voiceThreadId: "thr_old", afterSeq: 3, at: Date.now() } },
    }]]);
    const sessions = new VoiceSessions({ sdk: {} as never, kv: { get: async (key) => kv.get(key), set: async () => {} }, botThread: () => null, warn: () => {} });
    await sessions.load();
    expect(sessions.isOn("thr_old")).toBe(true);
    expect(sessions.pending("thr_old")).toEqual(["thr_work"]);
  });
});

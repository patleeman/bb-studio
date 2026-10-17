import { describe, expect, it } from "vitest";
import { registerVoice } from "./register";
import { VOICE_REALTIME_CHANNEL } from "./shared";

function fakeBb(session: { threadId: string } | null) {
  const handlers: Record<string, (payload: never) => void> = {};
  const published: { channel: string; data: unknown }[] = [];
  const tools: Record<string, { execute(input: unknown, ctx: { threadId: string }): Promise<unknown> }> = {};
  const kv = new Map<string, unknown>([["voice:state", { threads: session ? [session.threadId] : [], delegations: {} }]]);
  const bb = {
    sdk: { threads: { events: { list: async () => [] }, getPluginMetadata: async () => ({}) } },
    storage: { kv: { get: async (key: string) => kv.get(key), set: async (key: string, value: unknown) => { kv.set(key, value); } } },
    rpc: { register: () => {} },
    events: { on: (name: string, handler: (payload: never) => void) => { handlers[name] = handler; } },
    realtime: { publish: (channel: string, data: unknown) => published.push({ channel, data }) },
    agents: { registerTool: (tool: { name: string; execute(input: unknown, ctx: { threadId: string }): Promise<unknown> }) => { tools[tool.name] = tool; } },
    log: { warn: () => {} },
  };
  return { bb, handlers, published, tools };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("registerVoice", () => {
  it("speaks the voice thread's reply: makes its pieces now and tells the open view", async () => {
    const { bb, handlers, published } = fakeBb({ threadId: "thr_voice" });
    const warmed: string[] = [];
    const speech = { warm: (text: string) => { warmed.push(text); return "a".repeat(40); }, problem: () => null };
    await registerVoice(bb as never, { speech: speech as never, botThread: () => null });
    handlers["thread.idle"]!({ thread: { id: "thr_voice" }, lastAssistantText: "**Done.** Two tests fail." } as never);
    await settle();
    expect(warmed).toEqual(["Done. Two tests fail."]);
    expect(published).toEqual([{ channel: VOICE_REALTIME_CHANNEL, data: { threadId: "thr_voice", text: "Done. Two tests fail.", pieces: ["Done. Two tests fail."], urls: [`/api/v1/plugins/studio/http/speech/audio?key=${"a".repeat(40)}`] } }]);
  });

  it("says why a reply can't be spoken, and stays quiet for other threads", async () => {
    const { bb, handlers, published } = fakeBb({ threadId: "thr_voice" });
    const speech = { warm: () => { throw new Error("Add an OpenRouter API key."); }, problem: () => "Add an OpenRouter API key." };
    await registerVoice(bb as never, { speech: speech as never, botThread: () => null });
    handlers["thread.idle"]!({ thread: { id: "thr_other" }, lastAssistantText: "Hi" } as never);
    handlers["thread.idle"]!({ thread: { id: "thr_voice" }, lastAssistantText: "Hello." } as never);
    await settle();
    expect(published).toHaveLength(1);
    expect((published[0]!.data as { problem: string }).problem).toMatch(/OpenRouter/);
  });

  it("gives a voice chat its own setup, adds voice to a thread in voice mode, and keeps its tools to voice threads", async () => {
    const { bb, tools } = fakeBb({ threadId: "thr_voice" });
    const voice = await registerVoice(bb as never, { speech: { problem: () => null } as never, botThread: () => null });
    expect(voice.configure("thr_new", { voice: "on" })).toMatchObject({ chat: true, instructions: expect.stringContaining("This is a voice chat") });
    expect(voice.configure("thr_voice")).toMatchObject({ chat: false, tools: ["voice_delegate", "voice_threads", "voice_read"], instructions: expect.stringContaining("Voice mode is on") });
    expect(voice.configure("thr_other")).toBeNull();
    await expect(tools.voice_delegate!.execute({ target: "bot", message: "Hi" }, { threadId: "thr_other" })).rejects.toThrow(/Only a thread with voice mode on/);
  });
});

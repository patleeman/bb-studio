import { describe, expect, it, vi } from "vitest";
import { talkModels } from "./models";
import { rpcContract } from "../shared/contract";
import { cleanTranscript } from "./cleanup";
import { generateRecordingSummary } from "./meetings";
import { generateTitle } from "./titles";

const selection = { providerId: "test", model: "small", reasoningLevel: "low" as const, serviceTier: "fast" as const };

describe("Talk model preferences", () => {
  it("defaults to Decisions and saves each purpose independently across reloads", async () => {
    const saved = new Map<string, unknown>();
    const bb = { storage: { kv: { get: async (key: string) => saved.get(key), set: async (key: string, value: unknown) => { saved.set(key, value); } } } };
    const models = talkModels(bb as never);
    expect(await models.handlers["models.get"]()).toEqual({ cleanup: null, title: null, summary: null });
    await models.handlers["models.set"]({ purpose: "cleanup", selection });
    await models.handlers["models.set"]({ purpose: "title", selection: { ...selection, model: "title-model" } });
    expect(await talkModels(bb as never).get("cleanup")).toEqual(selection);
    await models.handlers["models.set"]({ purpose: "cleanup", selection: null });
    expect(await models.get("cleanup")).toBeNull();
    expect((await models.get("title"))?.model).toBe("title-model");
    expect(rpcContract["models.set"].input.safeParse({ purpose: "cleanup", selection: { ...selection, model: "" } }).success).toBe(false);
  });

  it("routes cleanup, titles and summaries through their selected model", async () => {
    let output = "We should ship it on Friday.";
    const callRpc = vi.fn(async () => ({ ok: true, text: output, via: "test/small", ms: 1 }));
    const bb = { sdk: {
      system: { config: async () => ({ primaryHostId: "host" }) },
      providers: { list: async () => [{ id: "test", available: true }] },
      plugins: { callRpc },
    }, log: { warn: vi.fn() } };
    const signal = new AbortController().signal;
    const options = { recordingId: "rec_test", transcript: "um we should ship it on Friday", modelSelection: selection };
    expect(await cleanTranscript(bb as never, options, signal)).toBe(output);
    output = "Friday release";
    expect(await generateTitle(bb as never, { ...options, createdAt: 0 }, signal)).toBe(output);
    output = '{"summary":"Ship on Friday."}';
    expect((await generateRecordingSummary(bb as never, options.recordingId, options.transcript, signal, selection)).summary).toBe("Ship on Friday.");
    for (const call of callRpc.mock.calls as unknown as [{ input: { modelSelection: unknown } }][]) expect(call[0].input.modelSelection).toEqual(selection);
    callRpc.mockRejectedValueOnce(new Error("Unavailable"));
    expect(await cleanTranscript(bb as never, options, signal)).toBeNull();
  });
});

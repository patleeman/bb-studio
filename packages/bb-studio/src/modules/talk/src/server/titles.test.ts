import { test } from "vitest";
import assert from "node:assert/strict";
import { fallbackTitle, generateTitle } from "./titles";

const createdAt = Date.UTC(2026, 8, 30);

test("Talk titles through Decisions and names the recording as caller", async () => {
  const calls: unknown[] = [];
  const bb = { sdk: {
    system: { config: async () => ({ primaryHostId: "host" }) },
    providers: { list: async () => [{ id: "codex", available: true }] },
    plugins: { callRpc: async (args: any) => {
      calls.push(args);
      return args.outputSchema.parse({ ok: true, text: "Product planning", via: "codex", ms: 1 });
    } },
  } };
  assert.equal(await generateTitle(bb as never, { transcript: "Discuss product planning", recordingId: "rec_1", createdAt }, new AbortController().signal), "Product planning");
  assert.deepEqual((calls[0] as any).input, {
    caller: "talk", requestId: "rec_1", hostId: "host", providerId: "codex",
    prompt: (calls[0] as any).input.prompt,
  });
});

test("Talk uses a stable title when Decisions is absent or unavailable", async () => {
  const transcript = "Discuss the launch checklist with everyone tomorrow";
  const options = { transcript, recordingId: "rec_2", createdAt };
  const expected = fallbackTitle(transcript, createdAt);
  assert.equal(expected, "Discuss the launch checklist with everyone tomorrow · 2026-09-30");
  for (const callRpc of [
    async () => { throw new Error("Plugin missing"); },
    async (args: any) => args.outputSchema.parse({ ok: false, unavailable: true, error: "No fallback model" }),
  ]) {
    const bb = { sdk: { system: { config: async () => ({ primaryHostId: "host" }) }, providers: { list: async () => [{ id: "codex", available: true }] }, plugins: { callRpc } } };
    assert.equal(await generateTitle(bb as never, options, new AbortController().signal), expected);
  }
});

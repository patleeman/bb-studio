import { expect, test } from "vitest";
import { askModel, DecisionsUnavailableError } from "./decisions";

test("Talk and other callers address Studio's built-in model service", async () => {
  const calls: unknown[] = [];
  const bb = { sdk: { plugins: { callRpc: async (args: unknown) => { calls.push(args); return { ok: true, text: "Title", via: "chosen", ms: 1 }; } } } };
  const request = { caller: "talk", requestId: "one", hostId: "host", providerId: null, prompt: "Title this" };
  expect((await askModel(bb as never, request, new AbortController().signal)).text).toBe("Title");
  expect(calls).toEqual([expect.objectContaining({ pluginId: "studio", method: "decisions.model.ask", input: request })]);
});

test("an unavailable built-in model retains the typed failure callers handle", async () => {
  const bb = { sdk: { plugins: { callRpc: async () => ({ ok: false, unavailable: true, error: "No fallback" }) } } };
  await expect(askModel(bb as never, { caller: "talk", requestId: "one", hostId: "host", providerId: null, prompt: "Title this" }, new AbortController().signal)).rejects.toBeInstanceOf(DecisionsUnavailableError);
});

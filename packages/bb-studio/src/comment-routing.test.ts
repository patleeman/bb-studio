import { expect, it, vi } from "vitest";
import { routeCommentMentions } from "./comment-routing";

it("routes an explicit bot mention to that bot's conversation", async () => {
  const calls: { method: string; input: unknown }[] = [];
  const sdk = { plugins: { callRpc: vi.fn(async ({ method, input }: { method: string; input: unknown }) => {
    calls.push({ method, input });
    if (method === "list") return { bots: [{ id: "bot-a", name: "Atlas" }, { id: "bot-b", name: "Other" }] };
    if (method === "conversation") return { id: "room-a" };
    return {};
  }) } };
  await routeCommentMentions(sdk as never, "@Atlas check this", "/plugins/artifacts/a/a");
  expect(calls.map((call) => call.method)).toEqual(["list", "conversation", "send"]);
  expect(calls[2]?.input).toMatchObject({ id: "room-a", text: expect.stringContaining("/plugins/artifacts/a/a") });
});

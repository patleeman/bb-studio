import { describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { rpcContract } from "@bb-studio/kit/chat-contract";

async function setup(values: Map<string, unknown>, fail = false) {
  const callRpc = vi.fn(async ({ method, input }: { method: keyof typeof rpcContract; input: any }) => {
    rpcContract[method].input.parse(input);
    if (fail) throw new Error("Studio is unavailable");
    return method === "chat.importLinks" ? { imported: input.links.length } : { thread: { threadId: "thread", title: "Linked", origin: "chosen" } };
  });
  let handlers: any, cli: any;
  const warn = vi.fn();
  await plugin({
    storage: { kv: { list: async () => [...values.keys()], get: async (key: string) => values.get(key) } },
    sdk: { plugins: { callRpc } },
    ui: { registerMentionProvider: vi.fn() },
    rpc: { register: (_contract: unknown, value: unknown) => { handlers = value; } },
    cli: { register: (value: unknown) => { cli = value; } },
    log: { warn },
  } as any);
  return { callRpc, handlers, cli, warn };
}

describe("Chat upgrade bridge", () => {
  it("migrates chosen links and explicit unlinks in bounded batches without changing source storage", async () => {
    const values = new Map<string, unknown>(Array.from({ length: 251 }, (_, i) => [`link:artifacts:id:${i}`, { threadId: i ? `thread_${i}` : null, at: i }]));
    const { callRpc, cli } = await setup(values);
    expect(callRpc.mock.calls.map(([call]) => call.input.links.length)).toEqual([250, 1]);
    expect(callRpc.mock.calls[0]![0].input.links[0]).toEqual({ item: { pluginId: "artifacts", id: "id:0" }, threadId: null, at: 0 });
    expect(values.size).toBe(251);
    expect((await cli.run(["migrate"])).stdout).toContain("Migration complete");
  });
  it("forwards an older client's home request after retrying migration", async () => {
    const { callRpc, handlers } = await setup(new Map([["link:pages:page", { threadId: "old", at: 1 }]]));
    callRpc.mockClear();
    expect((await handlers.home({ pluginId: "pages", id: "page" })).thread.threadId).toBe("thread");
    expect(callRpc.mock.calls.map(([call]) => call.method)).toEqual(["chat.importLinks", "chat.home"]);
  });
  it("reports failed and malformed migrations without claiming completion or deleting originals", async () => {
    for (const [value, fail] of [[{ threadId: "old", at: 1 }, true], [{ threadId: "old" }, false]] as const) {
      const values = new Map([["link:pages:page", value]]);
      const { cli, warn } = await setup(values, fail);
      expect(warn).toHaveBeenCalled();
      const result = await cli.run(["migrate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBeUndefined();
      expect(values.get("link:pages:page")).toEqual(value);
    }
  });
});

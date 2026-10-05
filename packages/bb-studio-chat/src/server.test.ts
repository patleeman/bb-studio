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
    storage: { kv: {
      list: async (prefix: string) => [...values.keys()].filter(key => key.startsWith(prefix)),
      get: async (key: string) => values.get(key),
      set: async (key: string, value: unknown) => { values.set(key, value); },
    } },
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
    expect([...values.keys()].filter(key => key.startsWith("link:"))).toHaveLength(251);
    expect(values.get("link:artifacts:id:5")).toEqual({ threadId: "thread_5", at: 5 });
    expect((await cli.run(["migrate"])).stdout).toContain("Migration complete");
  });
  it("forwards an older client's home request without resending migrated links", async () => {
    const { callRpc, handlers } = await setup(new Map([["link:pages:page", { threadId: "old", at: 1 }]]));
    callRpc.mockClear();
    expect((await handlers.home({ pluginId: "pages", id: "page" })).thread.threadId).toBe("thread");
    expect(callRpc.mock.calls.map(([call]) => call.method)).toEqual(["chat.home"]);
  });
  it("reports a failed migration without claiming completion or deleting originals", async () => {
    const values = new Map<string, unknown>([["link:pages:page", { threadId: "old", at: 1 }]]);
    const { cli, warn } = await setup(values, true);
    expect(warn).toHaveBeenCalled();
    const result = await cli.run(["migrate"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBeUndefined();
    expect(values.get("link:pages:page")).toEqual({ threadId: "old", at: 1 });
  });
  it("skips and reports a malformed link while migrating the rest and serving legacy calls", async () => {
    const values = new Map<string, unknown>([["link:pages:bad", { threadId: "old" }], ["link:nocolon", { threadId: "x", at: 1 }], ["link:pages:page", { threadId: "old", at: 1 }]]);
    const { callRpc, cli, handlers, warn } = await setup(values);
    expect(warn.mock.calls[0]![0]).toContain("link:pages:bad");
    expect(callRpc.mock.calls[0]![0].input.links).toEqual([{ item: { pluginId: "pages", id: "page" }, threadId: "old", at: 1 }]);
    expect((await handlers.home({ pluginId: "pages", id: "page" })).thread.threadId).toBe("thread");
    const result = await cli.run(["migrate"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Skipped 2 malformed links[\s\S]*Migration complete/);
    expect(values.get("link:pages:bad")).toEqual({ threadId: "old" });
  });
  it("sends each link once: legacy calls and reruns skip links already copied", async () => {
    const values = new Map<string, unknown>([["link:pages:page", { threadId: "old", at: 1 }]]);
    const { callRpc, cli, handlers } = await setup(values);
    await handlers.home({ pluginId: "pages", id: "page" });
    expect((await cli.run(["migrate"])).stdout).toContain("imported 0");
    expect(callRpc.mock.calls.filter(([call]) => call.method === "chat.importLinks")).toHaveLength(1);
    values.set("link:pages:page", { threadId: "newer", at: 2 });
    expect((await cli.run(["migrate"])).stdout).toContain("imported 1");
  });
});

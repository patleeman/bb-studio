import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseFlags, subcommand, takeFlag, takeOption, usage } from "./cli";
import { studioSchemas } from "./contract";
import { newId } from "./ids";
import { createChangeBus, defineItemMention, discoverProviderSnapshot, fanOutProviders, mustGet, registerStudioProvider, serveBytes } from "./server";
import { storeActions } from "./server/provider";

afterEach(() => vi.useRealTimers());

describe("server helpers", () => {
  it("makes one id scheme", () => {
    expect(newId("pg")).toMatch(/^pg_[0-9a-f]{16}$/);
  });

  it("keeps existing CLI flag and usage output", () => {
    expect(subcommand(["list", "--thread", "thr_1"])).toEqual({ command: "list", rest: ["--thread", "thr_1"] });
    expect(parseFlags(["--thread", "thr_1", "--force", "path"], ["force"])).toEqual({
      positional: ["path"], values: { thread: "thr_1", force: "" },
    });
    const argv = ["--all", "title", "--markdown", "hello"];
    expect(takeFlag(argv, "--all")).toBe(true);
    expect(takeOption(argv, "--markdown")).toBe("hello");
    expect(argv).toEqual(["title"]);
    expect(usage("bb pages create <title>")).toEqual({ exitCode: 1, stderr: "usage: bb pages create <title>\n" });
  });

  it("publishes the local event and coalesces Studio notifications", async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const callRpc = vi.fn().mockResolvedValue(null);
    const bus = createChangeBus({
      bb: { realtime: { publish }, sdk: { plugins: { callRpc } } },
      channel: "item-changed",
      pluginId: "pages",
      schemas: studioSchemas(z),
      event: (id: string) => ({ id }),
    });
    bus.changed("pg_1");
    bus.changed("pg_2");
    expect(publish.mock.calls).toEqual([["item-changed", { id: "pg_1" }], ["item-changed", { id: "pg_2" }]]);
    await vi.advanceTimersByTimeAsync(250);
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(callRpc.mock.calls[0]![0]).toMatchObject({ pluginId: "studio", method: "studio_changed", input: { pluginId: "pages" } });
    bus.dispose();
  });

  it("bounds mentions without changing ids or resolution", async () => {
    const provider = defineItemMention({
      id: "page", label: "Pages",
      search: () => Array.from({ length: 60 }, (_, n) => ({ id: `pg_${n}`, title: String(n) })),
      resolve: (id) => ({ context: id }),
    });
    expect((await provider.search({ query: "" } as Parameters<typeof provider.search>[0])).map((item) => item.id)).toHaveLength(50);
    expect(provider.resolve("pg_1")).toEqual({ context: "pg_1" });
  });

  it("runs bulk actions separately and keeps per-id errors", async () => {
    const actions = storeActions({
      move(id) { if (id === "missing") throw new Error("Not found"); },
      archive() {},
      delete() {},
    });
    expect(await actions.studio_move({ ids: ["ok", "missing"], projectId: null })).toEqual({
      done: ["ok"], failed: [{ id: "missing", error: "Not found" }],
    });
    expect(mustGet(() => 0, "id", "No item")).toBe(0);
    expect(() => mustGet(() => null, "id", "No item")).toThrow("No item");
  });

  it("defaults rename to unsupported and validates its title", () => {
    const register = vi.fn();
    const schemas = studioSchemas(z);
    registerStudioProvider({ rpc: { register } } as unknown as Parameters<typeof registerStudioProvider>[0], schemas, {} as Parameters<typeof registerStudioProvider>[2]);
    const handlers = register.mock.calls[0]![1] as { studio_rename(input: unknown): unknown };
    expect(() => handlers.studio_rename({ id: "pg_1", title: "New" })).toThrow("does not support");
    expect(schemas.provider.studio_rename.input.parse({ id: "pg_1", title: "  New  " })).toEqual({ id: "pg_1", title: "New" });
    expect(() => schemas.provider.studio_rename.input.parse({ id: "pg_1", title: "   " })).toThrow();
    expect(() => schemas.provider.studio_rename.input.parse({ id: "pg_1", title: "x".repeat(201) })).toThrow();
  });

  it("discovers enabled providers and isolates fan-out failures", async () => {
    const { providers } = await discoverProviderSnapshot({
      plugins: {
        list: async () => ({ plugins: [
          { id: "pages", enabled: true, name: "Pages", status: "running", statusDetail: null, version: "1" },
          { id: "extra", enabled: true, name: "Extra", status: "running", statusDetail: null, version: "1" },
        ] }),
        experimental_discoverRpc: async () => [{ pluginId: "extra" }],
      },
    }, { method: "studio_list", known: ["pages"] });
    expect(providers.map((item) => item.id)).toEqual(["pages", "extra"]);
    expect(await fanOutProviders(providers, async (item) => {
      if (item.id === "extra") throw new Error("offline");
      return item.id;
    }, () => "failed")).toEqual(["pages", "failed"]);
  });

  it("serves immutable private bytes with caller CSP", () => {
    const response = serveBytes("hello", { "content-type": "text/plain", "content-security-policy": "sandbox" });
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
  });
});

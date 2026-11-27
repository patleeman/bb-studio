import { describe, expect, it, vi } from "vitest";
import { studioIndex } from "./kit/server/index";
import { schemas } from "./contract";
import { StudioHub, type HubSdk } from "./hub";

function plugin(id: string, patch: Record<string, unknown> = {}) {
  return { id, name: `Studio ${id}`, enabled: true, status: "running", statusDetail: null, version: "1.0.0", ...patch };
}

const capabilities = { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: false, comments: false, versions: false, links: false };
const kind = { id: "page", label: "Page", plural: "Pages", icon: "FileText", columns: [], actions: [], create: { mode: "rpc" as const }, canArchive: true, blurb: "", capabilities, mentionProviderId: "page" };
const item = (id: string) => ({
  id,
  kind: "page",
  title: id,
  icon: null,
  projectId: null,
  parentId: null,
  createdAt: 1,
  updatedAt: 2,
  updatedBy: null,
  preview: null,
  facts: [],
  badge: null,
  thumbnailUrl: null,
  href: `/plugins/pages/pages/${id}`,
  archived: false,
});

function fakeSdk(options: {
  plugins: ReturnType<typeof plugin>[];
  discovered?: string[];
  rpc: Record<string, (input: unknown) => unknown>;
}): HubSdk & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    plugins: {
      list: async () => ({ plugins: options.plugins }),
      experimental_discoverRpc: async () => (options.discovered ?? options.plugins.map((entry) => entry.id)).map((pluginId) => ({ pluginId })),
      callRpc: async ({ pluginId, method, input, outputSchema }) => {
        calls.push(`${pluginId}.${method}`);
        const handler = options.rpc[`${pluginId}.${method}`];
        if (!handler) throw Object.assign(new Error("Not found"), { status: 404 });
        return outputSchema.parse(await handler(input));
      },
    },
  };
}

describe("StudioHub", () => {
  it("shares absence, outage and partial-list behavior with the standalone picker", async () => {
    // An add-on that isn't built into Studio (Pages is, so the picker asks Studio for it).
    const options = { plugins: [plugin("notes")], discovered: ["notes"], rpc: {
      "notes.studio_describe": () => ({ pluginId: "notes", version: 2, panel: null, kinds: [kind] }),
      "notes.studio_list": (): unknown => ({ items: [item("pg_1")], truncated: false }),
      "notes.studio_get": (): unknown => ({ items: [item("pg_1")] }),
    } };
    const sdk = fakeSdk(options);
    const hub = new StudioHub(sdk);
    const picker = studioIndex(sdk as never, schemas);
    expect((await picker.snapshot()).items.map((entry) => entry.id)).toEqual(["pg_1"]);
    options.rpc["notes.studio_list"] = () => { throw new Error("Temporary outage"); };
    options.rpc["notes.studio_get"] = () => { throw new Error("Temporary outage"); };
    picker.invalidate();
    expect(await hub.itemsResult("notes", ["pg_1"])).toMatchObject({ status: "unavailable" });
    await expect(hub.get("notes", ["pg_1"])).rejects.toThrow("Temporary outage");
    expect(await picker.snapshot()).toMatchObject({ complete: false, items: [{ id: "pg_1" }] });
    options.rpc["notes.studio_list"] = () => ({ items: [], truncated: true });
    picker.invalidate();
    expect((await picker.items()).map((entry) => entry.id)).toEqual(["pg_1"]);
    options.rpc["notes.studio_list"] = () => ({ items: [], truncated: false });
    options.rpc["notes.studio_get"] = () => ({ items: [] });
    picker.invalidate();
    expect(await hub.itemsResult("notes", ["pg_1"])).toEqual({ status: "ready", items: [], complete: true });
    expect(await picker.items()).toEqual([]);
    options.plugins = [];
    expect(await hub.itemsResult("notes", ["pg_1"])).toEqual({ status: "absent" });
  });

  it("refreshes same-version descriptions after observed restart or public metadata change", async () => {
    const entry = plugin("pages", { updatedAt: "2026-10-01T00:00:00Z" });
    let label = "Before";
    const sdk = fakeSdk({ plugins: [entry], rpc: { "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [{ ...kind, label }] }) } });
    const hub = new StudioHub(sdk);
    expect((await hub.providers())[0]!.kinds[0]!.label).toBe("Before");
    entry.status = "error";
    await hub.providers();
    entry.status = "running";
    label = "Restarted";
    expect((await hub.providers())[0]!.kinds[0]!.label).toBe("Restarted");
    Object.assign(entry, { updatedAt: "2026-10-02T00:00:00Z" });
    label = "Updated";
    expect((await hub.providers())[0]!.kinds[0]!.label).toBe("Updated");
  });

  it("lists and describes only the requested provider during targeted recovery", async () => {
    const sdk = fakeSdk({ plugins: [plugin("pages"), plugin("talk")], rpc: {
      "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind] }),
      "pages.studio_list": () => ({ items: [item("pg_1")] }),
    } });
    expect((await new StudioHub(sdk).overview(new Set(["pages"]))).items.map((entry) => entry.id)).toEqual(["pg_1"]);
    expect(sdk.calls.some((call) => call.startsWith("talk."))).toBe(false);
  });

  it("eventually refreshes descriptions when stable hosts expose no restart revision", async () => {
    vi.useFakeTimers();
    try {
      let label = "Before reload";
      const sdk = fakeSdk({ plugins: [plugin("pages")], rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [{ ...kind, label }] }),
      } });
      const hub = new StudioHub(sdk);
      await hub.providers();
      label = "After same-version reload";
      await vi.advanceTimersByTimeAsync(30_001);
      expect((await hub.providers())[0]!.kinds[0]!.label).toBe(label);
    } finally { vi.useRealTimers(); }
  });
  it("marks failed discovery incomplete while still loading built-in providers", async () => {
    const sdk = fakeSdk({ plugins: [plugin("custom")], rpc: {} });
    sdk.plugins.experimental_discoverRpc = async () => { throw new Error("Discovery down"); };
    const pages = { pluginId: "pages", name: "Pages", handlers: {
      studio_describe: () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind] }),
      studio_list: () => ({ items: [item("pg_1")] }),
    } as never };
    const overview = await new StudioHub(sdk, [pages]).overview();
    expect(overview).toMatchObject({ discoveryComplete: false });
    expect(overview.items.map((entry) => entry.id)).toEqual(["pg_1"]);
  });

  it("lists discovered plugins, skipping disabled plugins and itself", async () => {
    const sdk = fakeSdk({
      plugins: [plugin("zeta"), plugin("pages"), plugin("talk", { enabled: false }), plugin("studio")],
      discovered: ["zeta", "studio", "pages"],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "zeta.studio_describe": () => ({ pluginId: "zeta", version: 2, panel: null, kinds: [] }),
      },
    });
    const providers = await new StudioHub(sdk).providers();
    expect(providers.map((provider) => [provider.pluginId, provider.state])).toEqual([
      ["pages", "ready"],
      ["zeta", "ready"],
    ]);
  });

  it("takes a plugin without studio_describe, and one that isn't running, offline", async () => {
    const sdk = fakeSdk({ plugins: [plugin("pages"), plugin("talk", { status: "error", statusDetail: "Crashed" })], rpc: {} });
    const providers = await new StudioHub(sdk).providers();
    expect(providers).toMatchObject([
      { pluginId: "pages", state: "offline", detail: "Not found" },
      { pluginId: "talk", state: "offline", detail: "Crashed" },
    ]);
  });

  it("tags items with their plugin and takes a failing provider offline", async () => {
    const sdk = fakeSdk({
      plugins: [plugin("pages"), plugin("talk")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "pages.studio_list": () => ({ items: [item("pg_1")] }),
        "talk.studio_describe": () => ({ pluginId: "talk", version: 2, panel: "recordings", kinds: [] }),
        "talk.studio_list": () => {
          throw new Error("Database locked");
        },
      },
    });
    const overview = await new StudioHub(sdk).overview();
    expect(overview.items.map((entry) => `${entry.pluginId}:${entry.id}`)).toEqual(["pages:pg_1"]);
    expect(overview.providers[1]).toMatchObject({ pluginId: "talk", state: "offline", detail: "Database locked" });
  });

  it("names the providers that listed only some of their items", async () => {
    const sdk = fakeSdk({
      plugins: [plugin("pages"), plugin("talk")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "pages.studio_list": () => ({ items: [item("pg_1")] }),
        "talk.studio_describe": () => ({ pluginId: "talk", version: 2, panel: "recordings", kinds: [] }),
        "talk.studio_list": () => ({ items: [], truncated: true }),
      },
    });
    expect([...(await new StudioHub(sdk).overview()).truncated]).toEqual(["talk"]);
  });

  it("describes each plugin version once", async () => {
    const sdk = fakeSdk({
      plugins: [plugin("pages")],
      rpc: { "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }) },
    });
    const hub = new StudioHub(sdk);
    await hub.providers();
    await hub.providers();
    expect(sdk.calls.filter((call) => call === "pages.studio_describe")).toHaveLength(1);
  });

  it("loads requested items with studio_get", async () => {
    const sdk = fakeSdk({
      plugins: [plugin("pages")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind] }),
        "pages.studio_get": () => ({ items: [item("pg_1")] }),
      },
    });
    const hub = new StudioHub(sdk);
    expect((await hub.get("pages", ["pg_1"])).map((row) => row.id)).toEqual(["pg_1"]);
    expect(sdk.calls).toContain("pages.studio_get");
    expect(sdk.calls).not.toContain("pages.studio_list");
  });

  it("marks an incomplete description offline", async () => {
    const sdk = fakeSdk({ plugins: [plugin("pages")], rpc: { "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [{ ...kind, capabilities: undefined }] }) } });
    expect((await new StudioHub(sdk).providers())[0]).toMatchObject({ state: "offline", detail: expect.stringContaining("missing capabilities") });
  });

  it("refuses to call itself", async () => {
    const hub = new StudioHub(fakeSdk({ plugins: [], rpc: {} }));
    await expect(hub.call("studio", "studio_list", null)).rejects.toThrow("Studio isn't a provider.");
  });

  it("coalesces concurrent overview() and providers() fan-outs, then runs fresh after settlement", async () => {
    let listCalls = 0;
    let releaseList!: () => void;
    const gate = new Promise<void>((resolve) => { releaseList = resolve; });
    const sdk = fakeSdk({
      plugins: [plugin("pages")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "pages.studio_list": async () => {
          listCalls += 1;
          await gate;
          return { items: [item("pg_1")] };
        },
      },
    });
    const listPluginsSpy = vi.spyOn(sdk.plugins, "list");
    const hub = new StudioHub(sdk);
    const pending = Promise.all([hub.overview(), hub.overview(), hub.overview(), hub.overview()]);
    releaseList();
    const results = await pending;
    expect(listCalls).toBe(1);
    expect(results.every((r) => r.items.length === 1)).toBe(true);

    // After settlement, a subsequent call runs a fresh fan-out.
    await hub.overview();
    expect(listCalls).toBe(2);

    // Concurrent providers() calls coalesce on plugins.list / discovery (not just cached studio_describe).
    listPluginsSpy.mockClear();
    const providerLists = await Promise.all([hub.providers(), hub.providers(), hub.providers()]);
    expect(providerLists).toHaveLength(3);
    expect(listPluginsSpy).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh fan-out when a write happens while overview() is in flight", async () => {
    const stored = [item("pg_1")];
    let listCalls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sdk = fakeSdk({
      plugins: [plugin("pages")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "pages.studio_list": async () => {
          const call = ++listCalls;
          const snapshot = [...stored];
          if (call === 1) await firstGate;
          return { items: snapshot };
        },
        "pages.studio_create": async () => {
          const created = item("pg_2");
          stored.push(created);
          return { item: created };
        },
      },
    });
    const hub = new StudioHub(sdk);
    const first = hub.overview();
    // Wait until the first studio_list has started and captured ["pg_1"].
    await new Promise((resolve) => setTimeout(resolve, 10));
    await hub.call("pages", "studio_create", { kind: "page", projectId: null });
    const second = hub.overview();
    releaseFirst();

    const [r1, r2] = await Promise.all([first, second]);
    expect(listCalls).toBe(2);
    expect(r1.items.map((each) => each.id)).toEqual(["pg_1"]);
    expect(r2.items.map((each) => each.id)).toEqual(["pg_1", "pg_2"]);
  });

  it("clears the in-flight slot on rejection and keeps overview(only) uncoalesced", async () => {
    let fail = true;
    const sdk = fakeSdk({
      plugins: [plugin("pages")],
      rpc: {
        "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: "pages", kinds: [kind] }),
        "pages.studio_list": () => ({ items: [item("pg_1")] }),
      },
    });
    const origList = sdk.plugins.list;
    sdk.plugins.list = async () => {
      if (fail) throw new Error("host down");
      return origList();
    };
    const hub = new StudioHub(sdk);
    await expect(Promise.all([hub.overview(), hub.overview()])).rejects.toThrow("host down");

    fail = false;
    const recovered = await hub.overview();
    expect(recovered.items.map((each) => each.id)).toEqual(["pg_1"]);

    // overview(only) does not join or populate the unfiltered coalescing slot.
    const listBefore = sdk.calls.filter((c) => c === "pages.studio_list").length;
    await Promise.all([hub.overview(new Set(["pages"])), hub.overview(new Set(["pages"]))]);
    expect(sdk.calls.filter((c) => c === "pages.studio_list").length).toBe(listBefore + 2);
  });
});

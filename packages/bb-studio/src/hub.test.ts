import { describe, expect, it, vi } from "vitest";
import { studioIndex } from "@bb-studio/kit/server";
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
      experimental_discoverRpc: async () => (options.discovered ?? []).map((pluginId) => ({ pluginId })),
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
    const options = { plugins: [plugin("pages")], rpc: {
      "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind] }),
      "pages.studio_list": (): unknown => ({ items: [item("pg_1")], truncated: false }),
      "pages.studio_get": (): unknown => ({ items: [item("pg_1")] }),
    } };
    const sdk = fakeSdk(options);
    const hub = new StudioHub(sdk);
    const picker = studioIndex(sdk as never, schemas);
    expect((await picker.snapshot()).items.map((entry) => entry.id)).toEqual(["pg_1"]);
    options.rpc["pages.studio_list"] = () => { throw new Error("Temporary outage"); };
    options.rpc["pages.studio_get"] = () => { throw new Error("Temporary outage"); };
    picker.invalidate();
    expect(await hub.itemsResult("pages", ["pg_1"])).toMatchObject({ status: "unavailable" });
    await expect(hub.get("pages", ["pg_1"])).rejects.toThrow("Temporary outage");
    expect(await picker.snapshot()).toMatchObject({ complete: false, items: [{ id: "pg_1" }] });
    options.rpc["pages.studio_list"] = () => ({ items: [], truncated: true });
    picker.invalidate();
    expect((await picker.items()).map((entry) => entry.id)).toEqual(["pg_1"]);
    options.rpc["pages.studio_list"] = () => ({ items: [], truncated: false });
    options.rpc["pages.studio_get"] = () => ({ items: [] });
    picker.invalidate();
    expect(await hub.itemsResult("pages", ["pg_1"])).toEqual({ status: "ready", items: [], complete: true });
    expect(await picker.items()).toEqual([]);
    options.plugins = [];
    expect(await hub.itemsResult("pages", ["pg_1"])).toEqual({ status: "absent" });
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
  it("marks failed discovery incomplete while still loading known providers", async () => {
    const sdk = fakeSdk({ plugins: [plugin("pages"), plugin("custom")], rpc: {
      "pages.studio_describe": () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind] }),
      "pages.studio_list": () => ({ items: [item("pg_1")] }),
    } });
    sdk.plugins.experimental_discoverRpc = async () => { throw new Error("Discovery down"); };
    const overview = await new StudioHub(sdk).overview();
    expect(overview).toMatchObject({ discoveryComplete: false });
    expect(overview.items.map((entry) => entry.id)).toEqual(["pg_1"]);
  });

  it("lists suite plugins first, then discovered ones, skipping disabled plugins and itself", async () => {
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

  it("takes a suite plugin without studio_describe, and one that isn't running, offline", async () => {
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

  it("lists Studio's own kinds and items beside the add-ons'", async () => {
    const space = { ...item("spc_1"), kind: "space", href: "/plugins/studio/spaces/spc_1" };
    const hub = new StudioHub(fakeSdk({ plugins: [], rpc: {} }), { kinds: [{ ...kind, id: "space" }], items: () => [{ ...space, pluginId: "studio" }] });
    expect((await hub.providers()).map((provider) => [provider.pluginId, provider.state])).toEqual([["studio", "ready"]]);
    expect((await hub.overview()).items.map((each) => each.id)).toEqual(["spc_1"]);
    expect((await hub.get("studio", ["spc_1", "spc_2"])).map((each) => each.id)).toEqual(["spc_1"]);
  });
});

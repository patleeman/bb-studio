import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { StudioProviderHandlers } from "@bb-studio/kit/server";
import type { ProviderView } from "./contract";
import { StudioHub, type HubSdk } from "./hub";
import { builtinOn, frontendState, KINDS_KV_KEY, KindSettingsStore, parseKindSettings, replacements, resolveKind, resolveKinds, routeProviders, routingInstructions, type KindSettings } from "./kinds";
import { MIGRATIONS } from "./migrations";
import { SearchIndex } from "./search-index";

const capabilities = { create: true, move: true, archive: true, delete: true, rename: true, duplicate: false, export: false, comments: false, versions: false, links: false };
const kind = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, plural: `${id}s`, icon: "FileText", columns: [], actions: [], create: { mode: "rpc" as const }, canArchive: true, blurb: "", capabilities, mentionProviderId: null, ...extra });
const item = (id: string, kindId: string, title: string) => ({
  id, kind: kindId, title, icon: null, projectId: null, parentId: null, createdAt: 1, updatedAt: 2, updatedBy: null,
  preview: null, facts: [], badge: null, thumbnailUrl: null, href: `/x/${id}`, archived: false,
});
const view = (pluginId: string, kinds: ReturnType<typeof kind>[], state: "ready" | "offline" = "ready"): ProviderView => ({ pluginId, name: pluginId === "pages" ? "Pages" : `Ext ${pluginId}`, state, detail: null, panel: null, kinds });
const settings = (patch: Partial<KindSettings> = {}): KindSettings => ({ off: [], use: {}, ...patch });

function memoryKv() {
  const map = new Map<string, unknown>();
  return { map, get: async (key: string) => map.get(key), set: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); } };
}

describe("kind settings", () => {
  it("persist in KV and survive a restart", async () => {
    const kv = memoryKv();
    const store = new KindSettingsStore(kv);
    await store.load();
    expect(store.current).toEqual({ off: [], use: {} });
    const seen: string[] = [];
    store.onChange((next) => seen.push(next.off.join(",")));
    await store.update("drawing", { on: false });
    await store.update("page", { use: "notion" });
    expect(kv.map.get(KINDS_KV_KEY)).toEqual({ off: ["drawing"], use: { page: "notion" } });
    const restarted = new KindSettingsStore(kv);
    expect(await restarted.load()).toEqual({ off: ["drawing"], use: { page: "notion" } });
    await restarted.update("drawing", { on: true });
    await restarted.update("page", { use: null });
    expect(restarted.current).toEqual({ off: [], use: {} });
    expect(seen).toEqual(["drawing", "drawing"]);
    await expect(store.update("table", { on: false })).rejects.toThrow("isn't a kind built into Studio");
  });

  it("ignore stored values that aren't built-in kinds", () => {
    expect(parseKindSettings({ off: ["page", "table", 3, "page"], use: { page: "notion", nope: "x", drawing: "" } })).toEqual({ off: ["page"], use: { page: "notion" } });
    expect(parseKindSettings(null)).toEqual({ off: [], use: {} });
    expect(builtinOn(settings({ off: ["page"] }), "pages")).toBe(false);
    expect(builtinOn(settings({ off: ["page"] }), "notion")).toBe(true);
  });
});

describe("open and create with", () => {
  const pages = view("pages", [kind("page")]);
  const notion = view("notion", [kind("notion-page", { replaces: "page" })]);
  const coda = view("coda", [kind("coda-doc", { replaces: "page" })]);

  it("discovers only ready external kinds that declare replaces", () => {
    expect(replacements([pages, notion, view("down", [kind("x", { replaces: "page" })], "offline"), view("other", [kind("y")])], "page"))
      .toEqual([{ pluginId: "notion", name: "Ext notion", kindId: "notion-page", label: "notion-page" }]);
    // A built-in can't replace another built-in.
    expect(replacements([view("excalidraw", [kind("drawing", { replaces: "page" })])], "page")).toEqual([]);
  });

  it("prefers the user's choice, then a single replacement, then the built-in", () => {
    expect(resolveKind("page", [pages], settings())).toMatchObject({ active: { pluginId: "pages" }, reason: "built-in" });
    expect(resolveKind("page", [pages, notion], settings())).toMatchObject({ active: { pluginId: "notion", kindId: "notion-page" }, reason: "only-replacement" });
    expect(resolveKind("page", [pages, notion, coda], settings())).toMatchObject({ active: { pluginId: "pages" }, reason: "built-in" });
    expect(resolveKind("page", [pages, notion, coda], settings({ use: { page: "coda" } }))).toMatchObject({ active: { pluginId: "coda" }, reason: "chosen" });
    expect(resolveKind("page", [pages, notion], settings({ use: { page: "studio" } }))).toMatchObject({ active: { pluginId: "pages" }, reason: "chosen" });
    // A chosen provider that's gone falls back, keeping the choice for when it's back.
    expect(resolveKind("page", [pages], settings({ use: { page: "coda" } }))).toMatchObject({ active: { pluginId: "pages" }, reason: "built-in", choice: "coda" });
  });

  it("offers New only on the chosen candidate, and says so to agents", () => {
    const routed = routeProviders([pages, notion], settings());
    expect(routed.find((each) => each.pluginId === "pages")!.kinds[0]).toMatchObject({ create: null, capabilities: { create: false, rename: true } });
    expect(routed.find((each) => each.pluginId === "notion")!.kinds[0]).toMatchObject({ create: { mode: "rpc" }, capabilities: { create: true } });
    const back = routeProviders([pages, notion], settings({ use: { page: "studio" } }));
    expect(back.find((each) => each.pluginId === "pages")!.kinds[0]!.create).toEqual({ mode: "rpc" });
    expect(back.find((each) => each.pluginId === "notion")!.kinds[0]!.create).toBeNull();
    const routes = resolveKinds([pages, notion], settings());
    expect(routingInstructions(routes, settings())).toContain("New pages: the user makes them with Ext notion (notion-page, plugin notion)");
    expect(routingInstructions(resolveKinds([pages], settings()), settings())).toBe("");
    expect(routingInstructions(resolveKinds([pages], settings({ off: ["design"] })), settings({ off: ["design"] }))).toContain("Designs are turned off in Studio");
    expect(frontendState(routes, settings({ off: ["design"] }))).toEqual({ off: ["design"], routedAway: ["page"] });
  });
});

describe("the hub with kinds", () => {
  /** Studio's built-in Pages, in-process, and a fake external plugin whose kind replaces `page`. */
  function setup(kindSettings: KindSettings) {
    const current = { value: kindSettings };
    const pagesProvider: Partial<StudioProviderHandlers> = {
      studio_describe: () => ({ pluginId: "pages", version: 2, panel: null, kinds: [kind("page")] }),
      studio_list: () => ({ items: [item("pg_1", "page", "Launch plan")] }),
      studio_get: ({ ids }) => ({ items: [item("pg_1", "page", "Launch plan")].filter((each) => ids.includes(each.id)) }),
      studio_read: () => ({ content: "launch notes" }),
      studio_search: () => ({ ids: [] }),
    };
    const external: Record<string, (input: unknown) => unknown> = {
      "notion.studio_describe": () => ({ pluginId: "notion", version: 2, panel: null, kinds: [kind("notion-page", { replaces: "page", label: "Notion page" })] }),
      "notion.studio_list": () => ({ items: [item("n_1", "notion-page", "Launch doc")] }),
      "notion.studio_get": () => ({ items: [item("n_1", "notion-page", "Launch doc")] }),
      "notion.studio_read": () => ({ content: "" }),
    };
    const sdk: HubSdk = {
      plugins: {
        list: async () => ({ plugins: [{ id: "notion", name: "Notion", enabled: true, status: "running", statusDetail: null, version: "1" }] }),
        experimental_discoverRpc: async () => [{ pluginId: "notion" }],
        callRpc: async ({ pluginId, method, input, outputSchema }) => outputSchema.parse(await external[`${pluginId}.${method}`]!(input)),
      },
    };
    const hub = new StudioHub(sdk, [{ pluginId: "pages", name: "Pages", handlers: pagesProvider as StudioProviderHandlers }], {
      builtinOn: (pluginId) => builtinOn(current.value, pluginId),
      route: (providers) => routeProviders(providers, current.value),
    });
    return { hub, current };
  }

  it("discovers the replacing provider over RPC and gives it the New entry", async () => {
    const { hub } = setup(settings());
    const providers = await hub.providers();
    expect(providers.map((each) => each.pluginId).sort()).toEqual(["notion", "pages"]);
    expect(resolveKind("page", providers, settings())).toMatchObject({ active: { pluginId: "notion", label: "Notion page" }, reason: "only-replacement" });
    const creatable = providers.flatMap((each) => each.kinds.filter((entry) => entry.create).map((entry) => `${each.pluginId}:${entry.id}`));
    expect(creatable).toEqual(["notion:notion-page"]);
    // Existing built-in pages still list and open in Studio.
    expect((await hub.overview()).items.map((each) => `${each.pluginId}:${each.id}`).sort()).toEqual(["notion:n_1", "pages:pg_1"]);
    expect(await hub.get("pages", ["pg_1"])).toHaveLength(1);
  });

  it("turned off, a built-in kind leaves items, search and New, and comes back", async () => {
    const { hub, current } = setup(settings());
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.exec(sql);
    const search = new SearchIndex(db, hub);
    await search.ensure();
    expect(search.search("launch").map((hit) => hit.ref.pluginId).sort()).toEqual(["notion", "pages"]);

    current.value = settings({ off: ["page"] });
    const overview = await hub.overview();
    expect(overview.providers.map((each) => each.pluginId)).toEqual(["notion"]);
    expect(overview.items.map((each) => each.id)).toEqual(["n_1"]);
    await expect(hub.call("pages", "studio_list", null)).rejects.toThrow("turned off in Studio");
    expect(await hub.itemsResult("pages", ["pg_1"])).toEqual({ status: "absent" });
    await search.changed("pages");
    expect(search.search("launch").map((hit) => hit.ref.pluginId)).toEqual(["notion"]);

    current.value = settings();
    expect((await hub.overview()).items.map((each) => each.id).sort()).toEqual(["n_1", "pg_1"]);
    await search.changed("pages");
    expect(search.search("launch").map((hit) => hit.ref.pluginId).sort()).toEqual(["notion", "pages"]);
    db.close();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({}), useRpc: () => ({}) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const tabs = vi.hoisted(() => ({ openTabRef: vi.fn(async () => true), openStudioTab: vi.fn(async () => true) }));
vi.mock("../ui/tab-open", () => tabs);
const nav = vi.hoisted(() => ({ openAppPath: vi.fn() }));
vi.mock("../kit/app/nav", () => nav);

import { inMainWindow, linkDeps, openLinkFromAnywhere, routesLink, setLinkRuntime } from "./open";

afterEach(() => { setLinkRuntime(null); vi.clearAllMocks(); window.history.replaceState({}, "", "/"); });

describe("where the rule runs", () => {
  it("is the main window unless this is a plugin window or a popped-out route", () => {
    expect(inMainWindow({ pathname: "/threads/thr_1", search: "" })).toBe(true);
    expect(inMainWindow({ pathname: "/fork-window/studio/launcher", search: "" })).toBe(false);
    expect(inMainWindow({ pathname: "/fork-window/_bb/tab", search: "?bbBare=1" })).toBe(false);
    expect(inMainWindow({ pathname: "/threads/thr_1", search: "?bbBare=1" })).toBe(false);
    expect(inMainWindow({ pathname: "/plugins/studio/studio", search: "?bbBare=0" })).toBe(true);
  });
});

describe("BB's side of the deps", () => {
  it("relays over window.runInMain, resolves over links.resolve, pops out through experimental_popOut, and opens URLs by BB's setting", async () => {
    const call = vi.fn(async (method: string, _input: unknown) => (method === "links.resolve" ? { found: true, title: "Plan", spec: null } : { ok: true }));
    const popOut = vi.fn(async (_options: { path: string; title?: string }) => true);
    const deps = linkDeps({ navigate: { openUrl: () => true, experimental_popOut: popOut } as never, rpc: { call } });
    await deps.relay("bb://page/pg_1", "window");
    expect(call).toHaveBeenCalledWith("window.runInMain", { kind: "link", link: "bb://page/pg_1", how: "window" });
    expect(await deps.resolve({ kind: "page", id: "pg_1" }, "thr_1")).toEqual({ found: true, title: "Plan", spec: null });
    expect(call).toHaveBeenLastCalledWith("links.resolve", { kind: "page", id: "pg_1", threadId: "thr_1" });
    expect(await deps.popOut("/plugins/studio/studio/pages/pg_1", "Plan")).toBe(true);
    expect(popOut).toHaveBeenCalledWith({ path: "/plugins/studio/studio/pages/pg_1", title: "Plan" });
    expect(deps.openUrl("https://example.com/")).toBe(true);
    deps.openMain("/threads/thr_2");
    expect(nav.openAppPath).toHaveBeenCalledWith("/threads/thr_2");
    expect(deps.inMain()).toBe(true);
    window.history.replaceState({}, "", "/threads/thr_9");
    expect(deps.thread()).toBe("thr_9");
    expect(deps.studioPage()).toBe(false);
    const without = linkDeps({ navigate: { openUrl: () => { throw new Error("no"); } }, rpc: { call } });
    expect(await without.popOut("/threads/thr_1", null)).toBe(false);
    expect(without.openUrl("https://example.com/")).toBe(false);
  });

  it("opens nothing from outside React until a bridge lends BB's navigation", async () => {
    expect(await openLinkFromAnywhere("bb://library", { source: "gesture" })).toEqual({ via: "none", reason: "Studio is still starting." });
    const call = vi.fn(async () => ({ found: true, title: null, spec: null }));
    setLinkRuntime({ navigate: { openUrl: () => true }, rpc: { call } });
    window.history.replaceState({}, "", "/threads/thr_1");
    expect(await openLinkFromAnywhere("bb://library", { source: "gesture" })).toEqual({ via: "workbench", pane: null, opened: true });
    expect(tabs.openTabRef).toHaveBeenCalledWith({ kind: "library", id: null }, null, { threadId: "thr_1" });
    expect(await openLinkFromAnywhere("nonsense", { source: "gesture" })).toEqual({ via: "none", reason: "Not a link to anything BB opens." });
    expect(routesLink("bb://page/pg_1")).toBe(true);
    expect(routesLink("https://example.com/")).toBe(false);
    expect(routesLink("/settings")).toBe(false);
  });
});

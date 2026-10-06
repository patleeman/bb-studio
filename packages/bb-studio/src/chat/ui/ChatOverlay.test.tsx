// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemChatHost } from "@bb-studio/kit/app";
import type { Viewed } from "../contract";
import { ChatOverlay } from "./ChatOverlay";
import { chooseThreadPath, itemDraftPath, quoteDraftPath, quoteDrafts } from "./conversation-drafts";

const state = vi.hoisted(() => ({
  path: "/plugins/pages/pages/main",
  rpc: { call: vi.fn() },
  host: null as ItemChatHost | null,
  open: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => state.rpc,
}));
vi.mock("@bb-studio/kit/app", () => ({
  usePathname: () => state.path,
  useOpenTarget: () => ({ open: state.open, anchor: null }),
  itemChatChanged: () => {},
  setItemChatHost: (host: ItemChatHost) => { state.host = host; return () => { state.host = null; }; },
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));

const main: Viewed = {
  pluginId: "pages", id: "main", kind: "page", kindLabel: "Page", title: "Main page",
  icon: null, kindIcon: "FileText", projectId: "project_main", href: "/plugins/pages/pages/main",
};
const companion: Viewed = {
  ...main, pluginId: "excalidraw", id: "companion", kind: "drawing", kindLabel: "Drawing",
  title: "Companion drawing", projectId: "project_companion", href: "/plugins/excalidraw/drawings/companion",
};
const quote = { text: "Keep this arrow", note: "", image: null, where: null };
const homeOf = (threadId: string) => ({ thread: { threadId, title: "Linked", origin: "chosen" as const } });
const split = (path: string) => [{ kind: "path", path, title: expect.any(String), icon: "MessageSquare" }, "split"];
let root: Root;
let container: HTMLDivElement;
const render = async () => { await act(async () => { root.render(<ChatOverlay />); }); };
const actHost = async (action: (host: ItemChatHost) => unknown) => { await act(async () => { await action(state.host!); }); };

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.path = main.href;
  state.rpc.call.mockImplementation(async (method, input) => {
    if (method === "chat.viewing") return { item: main };
    if (method === "chat.subject") return { item: input.id === companion.id ? companion : main };
    if (method === "chat.home") return { thread: null };
    if (method === "chat.send") return { threadId: null };
    if (method === "chat.start") return { threadId: "created_thread" };
    if (method === "chat.link") return { thread: { threadId: input.threadId, title: "Chosen", origin: "chosen" } };
    throw new Error(`Unexpected RPC ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("item Chat actions", () => {
  it("refreshes an item's home after a retained composer creates its thread", async () => {
    state.rpc.call.mockClear();
    await act(async () => { window.dispatchEvent(new CustomEvent("bb-studio-chat:started", { detail: { pluginId: companion.pluginId, id: companion.id } })); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat.home", { pluginId: companion.pluginId, id: companion.id });
  });

  it("refreshes again when a conversation is created during an earlier home lookup", async () => {
    let release!: (value: any) => void;
    state.rpc.call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const started = () => window.dispatchEvent(new CustomEvent("bb-studio-chat:started", { detail: { pluginId: companion.pluginId, id: companion.id } }));
    await act(async () => { started(); });
    const thread = { threadId: "created_during_lookup", title: "New", origin: "chosen" };
    state.rpc.call.mockResolvedValueOnce({ thread });
    await act(async () => { started(); release({ thread: null }); });
    expect(state.host!.home(companion)).toEqual(thread);
  });

  it("draws nothing over the screen", () => {
    expect(container.innerHTML).toBe("");
  });

  it("opens an item's thread in a split", async () => {
    state.rpc.call.mockImplementation(async (method) => (method === "chat.home" ? homeOf("linked") : { item: main }));
    await actHost(host => host.watch(companion));
    await actHost(host => host.open(companion));
    expect(state.open).toHaveBeenCalledWith({ kind: "thread", threadId: "linked" }, "split");
  });

  it("opens a new conversation about an unlinked item in a split", async () => {
    await actHost(host => host.watch(companion));
    await actHost(host => host.open(companion));
    expect(state.open).toHaveBeenCalledWith(...split(itemDraftPath(companion)));
  });

  it("starts another conversation in a split even when one is linked", async () => {
    state.rpc.call.mockImplementation(async (method) => (method === "chat.home" ? homeOf("linked") : { item: main }));
    await actHost(host => host.watch(companion));
    await actHost(host => host.start(companion));
    expect(state.open).toHaveBeenCalledWith(...split(itemDraftPath(companion)));
  });

  it("opens the thread picker in a split", async () => {
    await actHost(host => host.choose(companion));
    expect(state.open).toHaveBeenCalledWith(...split(chooseThreadPath(companion)));
  });

  it("sends a quote to the linked thread and opens it in a split", async () => {
    state.rpc.call.mockImplementation(async (method) => (method === "chat.send" ? { threadId: "linked" } : { item: main }));
    await actHost(host => host.send(companion, quote));
    expect(state.rpc.call).toHaveBeenCalledWith("chat.send", { item: { pluginId: companion.pluginId, id: companion.id }, quote });
    expect(state.open).toHaveBeenCalledWith({ kind: "thread", threadId: "linked" }, "split");
  });

  it("saves a quote for an unlinked item and composes with it in a split", async () => {
    const id = "1a0fdc3e-8eb5-4652-b596-424a021e409b";
    const save = vi.spyOn(quoteDrafts, "save").mockResolvedValue({ id, item: { pluginId: companion.pluginId, id: companion.id }, quote, createdAt: 1 });
    await actHost(host => host.send(companion, quote));
    expect(save).toHaveBeenCalledWith({ pluginId: companion.pluginId, id: companion.id }, quote);
    expect(state.open).toHaveBeenCalledWith(...split(quoteDraftPath(id)));
  });

  it("reports a quote that couldn't be saved", async () => {
    vi.spyOn(quoteDrafts, "save").mockRejectedValue(new Error("Close other BB tabs"));
    await actHost(host => host.send(companion, quote));
    expect(state.error).toHaveBeenCalledWith("Close other BB tabs");
    expect(state.open).not.toHaveBeenCalled();
  });
});

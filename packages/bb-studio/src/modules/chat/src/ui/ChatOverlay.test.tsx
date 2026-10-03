// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemChatHost } from "@bb-studio/kit/app";
import type { Viewed } from "../contract";
import { ChatOverlay } from "./ChatOverlay";
import { quoteDrafts } from "./conversation-drafts";

const state = vi.hoisted(() => ({
  path: "/plugins/pages/pages/main",
  rpc: { call: vi.fn() },
  host: null as ItemChatHost | null,
  composer: null as any,
  picker: null as any,
  float: vi.fn((_target: unknown, _options?: unknown) => true),
  available: false,
  navigate: { toThread: vi.fn() },
  error: vi.fn(),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: () => null,
  useRpc: () => state.rpc,
  useBbNavigate: () => state.navigate,
  useComposer: () => ({ scope: { kind: "none" } }),
  experimental_NewThreadComposer: (props: any) => {
    state.composer = props;
    return <textarea aria-label="New conversation" defaultValue={props.initialPrompt} />;
  },
}));
vi.mock("@bb-studio/kit/app", async () => ({
  NewConversationComposer: (await import("../../../../../../bb-studio-kit/src/app/new-conversation")).NewConversationComposer,
  cn: (...classes: string[]) => classes.join(" "),
  usePathname: () => state.path,
  useFloatAvailable: () => state.available,
  useCompanionNavigate: () => () => false,
  openCompanion: state.float,
  itemChatChanged: () => {},
  setItemChatHost: (host: ItemChatHost) => { state.host = host; return () => { state.host = null; }; },
  Icon: () => null,
  FloatDockPortal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FloatThreadLeading: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("./ThreadPicker", () => ({
  ThreadPicker: (props: any) => { state.picker = props; return <div>Choose conversation</div>; },
}));

const main: Viewed = {
  pluginId: "pages", id: "main", kind: "page", kindLabel: "Page", title: "Main page",
  icon: null, kindIcon: "FileText", projectId: "project_main", href: "/plugins/pages/pages/main",
};
const companion: Viewed = {
  ...main, pluginId: "excalidraw", id: "companion", kind: "drawing", kindLabel: "Drawing",
  title: "Companion drawing", projectId: "project_companion", href: "/plugins/excalidraw/drawings/companion",
};
const quote = { text: "Keep this arrow", note: "", image: null, where: null };
let root: Root;
let container: HTMLDivElement;
const render = async () => { await act(async () => { root.render(<ChatOverlay />); }); };
const actHost = async (action: (host: ItemChatHost) => unknown) => { await act(async () => { await action(state.host!); }); };

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.path = main.href;
  state.available = false;
  state.composer = state.picker = null;
  state.float.mockReturnValue(true);
  state.rpc.call.mockImplementation(async (method, input) => {
    if (method === "chat_viewing") return { item: main };
    if (method === "chat_subject") return { item: input.id === companion.id ? companion : main };
    if (method === "chat_home") return { thread: null };
    if (method === "chat_send") return { threadId: null };
    if (method === "chat_start") return { threadId: "created_thread" };
    if (method === "chat_link") return { thread: { threadId: input.threadId, title: "Chosen", origin: "chosen" } };
    throw new Error(`Unexpected RPC ${method}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });

describe("item Chat actions", () => {
  it("opens one canonical companion destination for an item's new composer", async () => {
    state.available = true;
    await render();
    await actHost(host => host.start!(companion));
    const expected = { kind: "path", path: `/plugins/studio/chats/item/${encodeURIComponent(JSON.stringify({ pluginId: companion.pluginId, id: companion.id }))}`, title: "Chat: Companion drawing", icon: "MessageSquare" };
    expect(state.float).toHaveBeenCalledWith(expected);
    expect(container.querySelector("textarea")).toBeNull();
    await actHost(host => host.start!(companion));
    expect(state.float.mock.calls.filter(([target]) => (target as any).kind === "path").map(([target]) => target)).toEqual([expected, expected]);
  });

  it("refreshes an item's home after a retained composer creates its thread", async () => {
    state.rpc.call.mockClear();
    await act(async () => { window.dispatchEvent(new CustomEvent("bb-studio-chat:started", { detail: { pluginId: companion.pluginId, id: companion.id } })); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat_home", { pluginId: companion.pluginId, id: companion.id });
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

  it("keeps the quote available if durable storage is unavailable", async () => {
    state.available = true;
    vi.spyOn(quoteDrafts, "save").mockRejectedValue(new Error("Storage unavailable"));
    await render();
    await actHost(host => host.send(companion, quote));
    expect(state.error).toHaveBeenCalledWith("Storage unavailable");
    expect(state.composer.initialPrompt).toContain(quote.text);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("doesn't open a quote whose storage finished after a newer Chat action", async () => {
    state.available = true;
    let release!: (draft: any) => void;
    vi.spyOn(quoteDrafts, "save").mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const remove = vi.spyOn(quoteDrafts, "remove").mockResolvedValue();
    await render();
    await actHost(host => host.send(companion, quote));
    await actHost(host => host.start!(main));
    await act(async () => { release({ id: "stale" }); });
    expect(remove).toHaveBeenCalledWith("stale");
    expect(state.float.mock.calls.filter(([target]) => (target as any).kind === "path")).toHaveLength(1);
    expect(state.float).toHaveBeenCalledWith(expect.objectContaining({ title: "Chat: Main page" }));
  });

  it("keeps an image quote in the submission without Float", async () => {
    const image = "data:image/png;base64,aGVsbG8=";
    await actHost(host => host.send(companion, { ...quote, image }));
    expect(container.querySelector("img")?.src).toBe(image);
    await act(async () => { await state.composer.onSubmit({ input: [{ type: "text", text: "Fix the arrow" }] }); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat_start", {
      item: { pluginId: companion.pluginId, id: companion.id },
      request: { input: [{ type: "text", text: "Fix the arrow" }, { type: "image", url: image }] },
    });
  });
  it("opens an unlinked item's composer and submits that item after navigating away", async () => {
    await actHost((host) => host.open(companion));
    expect(container.textContent).toContain("Companion drawing");
    expect(state.composer.defaultProjectId).toBe("project_companion");
    expect(state.composer.draftKey).toBe("studio-chat:excalidraw:companion");
    state.path = "/settings";
    await render();
    expect(container.querySelector("textarea")).not.toBeNull();
    const request = { input: [{ type: "text", text: "Fix it" }] };
    await act(async () => { await state.composer.onSubmit(request); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat_start", { item: { pluginId: companion.pluginId, id: companion.id }, request });
    expect(state.float).toHaveBeenCalledWith({ kind: "thread", threadId: "created_thread" }, { tag: "studio-chat:item" });
  });

  it("links a picked conversation to the companion instead of the main item", async () => {
    await actHost((host) => host.choose(companion));
    expect(container.textContent).toContain("Companion drawing");
    await act(async () => { state.picker.onPick("picked_thread"); });
    expect(state.rpc.call).toHaveBeenCalledWith("chat_link", { pluginId: companion.pluginId, id: companion.id, threadId: "picked_thread" });
    expect(state.host!.home(companion)?.threadId).toBe("picked_thread");
    expect(state.host!.home(main)).toBeNull();
  });

  it("keeps a companion's quote and project in its new conversation", async () => {
    await actHost((host) => host.send(companion, quote));
    expect(state.composer.initialPrompt).toContain("Keep this arrow");
    expect(state.composer.defaultProjectId).toBe(companion.projectId);
    expect(container.textContent).toContain(companion.title);
    expect(state.rpc.call).toHaveBeenCalledWith("chat_subject", { pluginId: companion.pluginId, id: companion.id });
  });

  it("continues the linked conversation and can explicitly start another", async () => {
    await actHost((host) => host.choose(companion));
    await act(async () => { state.picker.onPick("picked_thread"); });
    state.float.mockClear();
    await actHost((host) => host.open(companion));
    expect(state.float).toHaveBeenCalledWith({ kind: "thread", threadId: "picked_thread" }, { tag: "studio-chat:item" });
    expect(container.querySelector("textarea")).toBeNull();
    await actHost((host) => host.start!(companion));
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(state.host!.home(companion)?.threadId).toBe("picked_thread");
  });

  it("keeps the latest intent when an earlier item resolves late", async () => {
    let release!: (value: { item: Viewed }) => void;
    state.rpc.call.mockImplementation((method, input) => method === "chat_subject" && input.id === main.id
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ item: companion }));
    await actHost((host) => host.start!(main));
    await actHost((host) => host.start!(companion));
    await act(async () => { release({ item: main }); });
    expect(container.textContent).toContain(companion.title);
    expect(container.textContent).not.toContain(main.title);
  });

  it("does not reopen a closed dialog when a pending item resolves", async () => {
    await actHost((host) => host.start!(companion));
    let release!: (value: { item: Viewed }) => void;
    state.rpc.call.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await actHost((host) => host.start!(main));
    await act(async () => { (container.querySelector('[aria-label="Close composer"]') as HTMLButtonElement).click(); });
    await act(async () => { release({ item: main }); });
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("reports missing items instead of composing about the main item", async () => {
    state.rpc.call.mockResolvedValue({ item: null });
    await actHost((host) => host.start!(companion));
    expect(state.error).toHaveBeenCalledWith("That Studio item is archived or gone.");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("keeps a newer composer open when an earlier submission finishes", async () => {
    await actHost((host) => host.start!(companion));
    let release!: (value: { threadId: string }) => void;
    const original = state.rpc.call.getMockImplementation()!;
    state.rpc.call.mockImplementation((method, input) => method === "chat_start"
      ? new Promise((resolve) => { release = resolve; }) : original(method, input));
    let sending!: Promise<void>;
    await act(async () => { sending = state.composer.onSubmit({ input: [{ type: "text", text: "Fix it" }] }); });
    await actHost((host) => host.start!(main));
    await act(async () => { release({ threadId: "created_thread" }); await sending; });
    expect(container.textContent).toContain(main.title);
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(state.composer.draftKey).toBe("studio-chat:pages:main");
  });

  it("keeps the draft available after a failed submission", async () => {
    await actHost((host) => host.start!(companion));
    const draft = container.querySelector("textarea")!;
    draft.value = "Keep my changes";
    state.rpc.call.mockRejectedValue(new Error("Connection lost"));
    await act(async () => {
      await expect(state.composer.onSubmit({ input: [{ type: "text", text: draft.value }] })).rejects.toThrow("Connection lost");
    });
    expect(container.querySelector("textarea")).toBe(draft);
    expect(draft.value).toBe("Keep my changes");
    expect(container.textContent).toContain("Connection lost");
  });

  it("falls back to the main thread view when Float is absent", async () => {
    state.float.mockReturnValue(false);
    await actHost((host) => host.choose(companion));
    await act(async () => { state.picker.onPick("picked_thread"); });
    expect(state.navigate.toThread).toHaveBeenCalledWith("picked_thread");
  });

  it("leaves Teams saved views' own chat and Send button unobstructed", async () => {
    state.path = "/plugins/bot-teams/views/launch";
    state.rpc.call.mockClear();
    state.rpc.call.mockResolvedValue({ item: { ...main, pluginId: "bot-teams", id: "launch", kind: "view", href: state.path } });
    await render();
    expect(container.children).toHaveLength(0);
    expect(state.rpc.call.mock.calls.map(([method]) => method)).toEqual(["chat_viewing"]);
  });
});

// @vitest-environment jsdom
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageMetaView } from "../contract";
import { PageChat, openPageConversation } from "./PageChat";

const state = vi.hoisted(() => ({
  companion: vi.fn(() => true), navigate: { toThread: vi.fn() }, rpc: { call: vi.fn() },
  composer: null as any, started: vi.fn(), closeMenu: null as any,
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => state.navigate,
  experimental_NewThreadComposer: (props: any) => { state.composer = props; return <textarea aria-label="Page draft" />; },
}));
vi.mock("@bb-studio/kit/app", () => ({ FLOATING: "", openCompanion: state.companion }));
vi.mock("@bb-studio/kit/ui", () => ({
  cn: (...classes: string[]) => classes.join(" "), Icon: () => null,
  Dialog: ({ open, onOpenChange, children }: any) => open ? <div><button onClick={() => onOpenChange(false)}>Close composer</button>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogDescription: ({ children }: any) => <p>{children}</p>,
  DropdownMenu: ({ children }: any) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ onCloseAutoFocus, children }: any) => { state.closeMenu = onCloseAutoFocus; return <div>{children}</div>; },
  DropdownMenuItem: ({ onSelect, children }: any) => <button onClick={() => { onSelect(); state.closeMenu({ preventDefault() {} }); }}>{children}</button>,
}));

const page = { id: "page_legacy", title: "Release review", projectId: "project_release" } as PageMetaView;
let root: Root;
let container: HTMLDivElement;
const render = async (threadId: string | null = null) => act(async () => {
  root.render(<PageChat page={page} rpc={state.rpc as any} threadId={threadId} onStarted={state.started} />);
});
const click = async (text: string) => act(async () => {
  const button = [...container.querySelectorAll("button")].find(node => node.textContent?.trim() === text);
  if (!button) throw new Error(`Missing ${text}`);
  button.click();
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  state.companion.mockReturnValue(true);
  state.composer = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("continues an existing page conversation through the shared destination", async () => {
  await render("legacy_thread"); await click("Chat");
  expect(state.companion).toHaveBeenCalledWith({ kind: "thread", threadId: "legacy_thread" });
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  expect(state.composer).toBeNull();
  expect(state.rpc.call).not.toHaveBeenCalled();
});

it("opens ordinary thread navigation when the shared companion host is absent", () => {
  state.companion.mockReturnValue(false);
  openPageConversation("legacy_thread", state.navigate as any);
  expect(state.navigate.toThread).toHaveBeenCalledWith("legacy_thread");
});

it("keeps the legacy draft key and page project when starting a conversation", async () => {
  state.rpc.call.mockResolvedValue({ threadId: "created_thread" });
  await render(); await click("Chat");
  expect(state.composer.draftKey).toBe("pages:page_legacy");
  expect(state.composer.defaultProjectId).toBe("project_release");
  const request = { input: [{ type: "text", text: "Review this release" }] };
  await act(async () => { await state.composer.onSubmit(request); });
  expect(state.rpc.call).toHaveBeenCalledWith("work", { id: page.id, request });
  expect(state.started).toHaveBeenCalledWith("created_thread");
  expect(state.companion).toHaveBeenCalledWith({ kind: "thread", threadId: "created_thread" });
  expect(container.querySelector("textarea")).toBeNull();
});

it("offers New conversation without replacing the existing thread", async () => {
  await render("legacy_thread"); await click("New conversation");
  expect(container.querySelector("textarea")).not.toBeNull();
  expect(state.companion).not.toHaveBeenCalled();
  expect(state.started).not.toHaveBeenCalled();
});

it("keeps a failed request open and rethrows so the SDK preserves its draft", async () => {
  state.rpc.call.mockRejectedValue(new Error("Try again"));
  await render(); await click("Chat");
  await act(async () => { await expect(state.composer.onSubmit({ input: [] })).rejects.toThrow("Try again"); });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Try again");
  expect(container.querySelector("textarea")).not.toBeNull();
  expect(state.companion).not.toHaveBeenCalled();
});

it("does not let an older submitted composer close or redirect its replacement", async () => {
  let finish!: (value: { threadId: string }) => void;
  state.rpc.call.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await click("Chat");
  const submitted = state.composer.onSubmit({ input: [] });
  await click("Close composer"); await click("Chat");
  await act(async () => { finish({ threadId: "older_thread" }); await submitted; });
  expect(container.querySelector("textarea")).not.toBeNull();
  expect(state.started).not.toHaveBeenCalled();
  expect(state.companion).not.toHaveBeenCalled();
});

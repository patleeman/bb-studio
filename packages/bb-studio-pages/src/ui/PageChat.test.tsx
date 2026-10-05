// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageMetaView } from "../contract";
import { PageChat, PageConversation, pageConversationPath } from "./PageChat";

const state = vi.hoisted(() => ({ open: vi.fn(), rpc: { call: vi.fn() }, composer: null as any, closeMenu: null as any }));
vi.mock("@bb-studio/kit/app", () => ({
  useOpenMain: () => state.open,
  ChatButton: ({ title, onOpen, items }: any) => <div><button title={title} onClick={onOpen}>Chat</button>{items.map((item: any, index: number) => <button key={index} onClick={item.onSelect}>{item.label}</button>)}</div>,
  NewConversationComposer: (props: any) => { state.composer = props; return <textarea aria-label="Page draft" />; },
}));
vi.mock("@bb-studio/kit/ui", () => ({
  cn: (...classes: string[]) => classes.join(" "), Icon: () => null,
  DropdownMenu: ({ children }: any) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ onCloseAutoFocus, children }: any) => { state.closeMenu = onCloseAutoFocus; return <div>{children}</div>; },
  DropdownMenuItem: ({ onSelect, children }: any) => <button onClick={() => { onSelect(); state.closeMenu({ preventDefault() {} }); }}>{children}</button>,
}));

const page = { id: "page_legacy", title: "Release review", projectId: "project_release" } as PageMetaView;
let root: Root;
let container: HTMLDivElement;
const render = async (threadId: string | null = null) => act(async () => { root.render(<PageChat page={page} threadId={threadId} />); });
const compose = async (subject = page) => act(async () => { root.render(<PageConversation page={subject} rpc={state.rpc as any} />); });
const click = async (text: string) => act(async () => {
  const button = [...container.querySelectorAll("button")].find(node => node.textContent?.trim() === text);
  if (!button) throw new Error(`Missing ${text}`);
  button.click();
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.composer = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("continues an existing page conversation through the shared destination", async () => {
  await render("legacy_thread"); await click("Chat");
  expect(state.open).toHaveBeenCalledWith({ kind: "thread", threadId: "legacy_thread" });
  expect(state.composer).toBeNull(); expect(state.rpc.call).not.toHaveBeenCalled();
});

it("opens the canonical retained composer without replacing the existing thread", async () => {
  await render("legacy_thread"); await click("New conversation");
  const target = { kind: "path", path: "/plugins/pages/pages/page_legacy/compose", title: "Chat: Release review", icon: "MessageSquare" };
  expect(state.open).toHaveBeenCalledWith(target);
  await click("New conversation"); expect(state.open).toHaveBeenLastCalledWith(target);
  expect(container.querySelector("textarea")).toBeNull(); expect(state.rpc.call).not.toHaveBeenCalled();
});

it("keeps the legacy draft key, project and submitted inputs with the shared composer", async () => {
  state.rpc.call.mockResolvedValue({ threadId: "created_thread" });
  await compose();
  expect(state.composer.draftKey).toBe("pages:page_legacy");
  expect(state.composer.defaultProjectId).toBe("project_release");
  const request = { input: [{ type: "text", text: "Review this release", mentions: [] }, { type: "file", path: "release.txt" }], sendAt: 1_900_000_000_000 };
  await act(async () => { await state.composer.onSubmit(request); });
  expect(state.rpc.call).toHaveBeenCalledWith("work", { id: page.id, request });
  expect(state.open).toHaveBeenCalledWith({ kind: "thread", threadId: "created_thread" });
});

it("lets global pages use the composer's chosen project", async () => {
  await compose({ ...page, projectId: null });
  expect(state.composer).not.toHaveProperty("defaultProjectId");
});

it("rethrows a failed request so the shared composer and SDK preserve the draft", async () => {
  state.rpc.call.mockRejectedValue(new Error("Try again"));
  await compose();
  await expect(state.composer.onSubmit({ input: [] })).rejects.toThrow("Try again");
  expect(container.querySelector("textarea")).not.toBeNull(); expect(state.open).not.toHaveBeenCalled();
});

it("retains the submitted page context while another page renders", async () => {
  let finish!: (value: { threadId: string }) => void;
  state.rpc.call.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await compose(); const submitted = state.composer.onSubmit({ input: [] });
  await compose({ ...page, id: "other_page" });
  await act(async () => { finish({ threadId: "created_thread" }); await submitted; });
  expect(state.rpc.call).toHaveBeenCalledWith("work", { id: page.id, request: { input: [] } });
});

it("encodes the page id in its draft route", () => {
  expect(pageConversationPath("page/one%two")).toBe("/plugins/pages/pages/page%2Fone%25two/compose");
});

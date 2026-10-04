// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotChat } from "../bot-chat";

const state = vi.hoisted(() => ({ call: vi.fn(), companion: vi.fn(), main: vi.fn(), error: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({ call: state.call }), useBbNavigate: () => ({ toThread: state.main }) }));
vi.mock("../bot-ui", () => ({ message: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("@bb-studio/kit/app", () => ({
  Icon: () => null, openCompanion: state.companion,
  ChatButton: ({ title, disabled, onOpen, items }: any) => React.createElement("div", null,
    React.createElement("button", { title, disabled, onClick: onOpen }, "Chat"),
    ...items.map((item: any, index: number) => React.createElement("button", { key: index, disabled, onClick: item.onSelect }, item.label))),
  DropdownMenu: ({ children }: any) => children,
  DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ children }: any) => children,
  DropdownMenuItem: ({ children, onSelect }: any) => React.createElement("button", { onClick: onSelect }, children),
}));

let root: Root, container: HTMLDivElement;
const button = (text: string) => [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === text)!;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.companion.mockReturnValue(true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(React.createElement(BotChat, { id: "atlas", onError: state.error })));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("bot conversation entry points", () => {
  it("resumes the bot's existing conversation and only creates a fresh one on explicit request", async () => {
    state.call.mockResolvedValue({ threadId: "existing" });
    await act(async () => button("Chat").click());
    expect(state.call).toHaveBeenLastCalledWith("conversation", { id: "atlas" });
    expect(state.companion).toHaveBeenLastCalledWith({ kind: "thread", threadId: "existing" });
    state.call.mockResolvedValue({ threadId: "fresh" });
    await act(async () => button("New conversation").click());
    expect(state.call).toHaveBeenLastCalledWith("newConversation", { id: "atlas" });
    expect(state.companion).toHaveBeenLastCalledWith({ kind: "thread", threadId: "fresh" });
    expect(state.main).not.toHaveBeenCalled();
  });

  it("coalesces repeated clicks and ignores a response after the originating profile closes", async () => {
    let resolve!: (value: { threadId: string }) => void;
    state.call.mockReturnValue(new Promise(r => { resolve = r; }));
    act(() => { button("Chat").click(); button("Chat").click(); });
    expect(state.call).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    await act(async () => resolve({ threadId: "late" }));
    expect(state.companion).not.toHaveBeenCalled();
    expect(state.main).not.toHaveBeenCalled();
  });

  it("allows retry after an error and falls back to main when no companion host is running", async () => {
    state.call.mockRejectedValueOnce(new Error("Unavailable"));
    await act(async () => button("Chat").click());
    expect(state.error).toHaveBeenCalledWith("Unavailable");
    expect(button("Chat").disabled).toBe(false);
    state.call.mockResolvedValue({ threadId: "retry" }); state.companion.mockReturnValue(false);
    await act(async () => button("Chat").click());
    expect(state.main).toHaveBeenCalledWith("retry");
  });
});

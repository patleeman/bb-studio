// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SideThreadView } from "../../contract";

const host = vi.hoisted(() => ({ calls: [] as { method: string; input: unknown }[], toThread: vi.fn(), spaces: { bots: [{ id: "dot", name: "Dot", primary: true }] } }));
vi.mock("../live", () => ({
  useCall: () => async (method: string, input: unknown) => { host.calls.push({ method, input }); return method === "bot_thread_reply" ? { threadId: "thr_reply", projectId: null, created: true } : {}; },
  useLive: (method: string) => ({ data: method === "bot_spaces" ? host.spaces : null, error: null, loading: false, refresh: () => {} }),
}));
vi.mock("@get-bb/plugin-sdk/app", async (original) => ({
  ...(await original<object>()),
  useBbNavigate: () => ({ toThread: host.toThread }),
  experimental_Icon: () => null,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const { openThreadBeside, ReplyInThreadAction, ThreadIndicator } = await import("./SideThreads");
const { setTabNavigator } = await import("../tab-open");
const { noteBotThread, resetBotThreadsForTest } = await import("../conversations/bot-thread-owners");

let root: Root, element: HTMLDivElement;
const workbench = { open: vi.fn(async () => "tab_1") };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host.calls = [];
  host.toThread.mockClear();
  workbench.open.mockClear();
  setTabNavigator({ experimental_workbench: (threadId?: string) => (threadId === "thr_main" ? workbench : null) });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); setTabNavigator(null); resetBotThreadsForTest(); vi.unstubAllGlobals(); });
const render = (node: React.ReactNode) => act(async () => { root.render(node); });
const settled = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const view = (fields: Partial<SideThreadView>): SideThreadView => ({ messageId: "m1", threadId: "thr_reply", botId: "dot", replies: 2, lastReplyAt: Date.now() - 5 * 60_000, lastReplyRole: "assistant", working: false, kind: "reply", conversations: 1, ...fields });

it("opens a message's thread in the side panel of the conversation it came from", async () => {
  expect(await openThreadBeside("thr_main", "thr_reply", host.toThread)).toBe(true);
  expect(workbench.open).toHaveBeenCalledWith({ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_reply" }, title: "Conversation" }, { focus: true });
  expect(host.toThread).not.toHaveBeenCalled();
  expect(await openThreadBeside("thr_main", "thr_reply", host.toThread, async () => false)).toBe(false);
  expect(host.toThread).toHaveBeenCalledWith("thr_reply");
});

it("shows Reply in thread on a Bot's replies only, and opens the thread beside the conversation", async () => {
  const assistant = { id: "m1", threadId: "thr_main", createdAt: 1, turnId: "t1", role: "assistant" as const };
  await render(<ReplyInThreadAction message={assistant} />);
  expect(element.querySelector("[data-studio-reply-in-thread]")).toBeNull();
  await act(async () => { noteBotThread("thr_main", true); });
  expect(element.querySelector("[data-studio-reply-in-thread]")).not.toBeNull();
  await render(<ReplyInThreadAction message={{ ...assistant, role: "user", initiator: "user" }} />);
  expect(element.querySelector("[data-studio-reply-in-thread]")).toBeNull();
  await render(<ReplyInThreadAction message={assistant} />);
  const button = element.querySelector<HTMLButtonElement>("[data-studio-reply-in-thread]")!;
  expect(button.getAttribute("aria-label")).toBe("Reply to this message");
  await act(async () => { button.click(); });
  await settled();
  expect(host.calls).toEqual([{ method: "bot_thread_reply", input: { threadId: "thr_main", messageId: "m1", turnId: "t1" } }]);
  expect(workbench.open).toHaveBeenCalledWith(expect.objectContaining({ params: { threadId: "thr_reply" } }), { focus: true });
});

it("shows the reply count and last reply's time as a quiet link, Replying… while it works, and nothing for an empty thread", async () => {
  const onOpen = vi.fn();
  const now = new Date(2026, 10, 12, 18, 0).getTime();
  const at = new Date(2026, 10, 12, 16, 13).getTime();
  await render(<ThreadIndicator thread={view({ lastReplyAt: at })} onOpen={onOpen} now={now} />);
  expect(element.textContent).toMatch(/^2 replies · Last reply 4:13\sPM$/);
  expect(element.textContent).not.toContain("💬");
  const link = element.querySelector<HTMLButtonElement>("[data-studio-side-thread]")!;
  expect(link.className).toContain("text-primary");
  expect(link.className).not.toMatch(/rounded|border|bg-state/);
  expect(element.querySelector('[data-testid="bot-presence"]')).not.toBeNull();
  await render(<ThreadIndicator thread={view({ replies: 1, lastReplyRole: "user", lastReplyAt: at })} onOpen={onOpen} now={now} />);
  expect(element.textContent).toMatch(/^1 reply · Last reply/);
  expect(element.querySelector('[data-testid="user-mark"]')).not.toBeNull();
  await render(<ThreadIndicator thread={view({ working: true })} onOpen={onOpen} now={now} />);
  expect(element.textContent).toBe("Replying…");
  await render(<ThreadIndicator thread={view({ kind: "fork", conversations: 1 })} onOpen={onOpen} now={now} />);
  expect(element.textContent).toBe("Forked here · 1 conversation");
  element.querySelector<HTMLButtonElement>("[data-studio-side-thread]")!.click();
  expect(onOpen).toHaveBeenCalledTimes(1);
  await render(<ThreadIndicator thread={view({ replies: 0, lastReplyRole: null, lastReplyAt: null })} onOpen={onOpen} now={now} />);
  expect(element.querySelector("[data-studio-side-thread]")).toBeNull();
});

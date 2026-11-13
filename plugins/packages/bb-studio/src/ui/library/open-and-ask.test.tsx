// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openTab: vi.fn((_options: unknown) => true), insert: vi.fn(), threadId: "conv" }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  experimental_useAppPanel: () => ({ openTab: state.openTab, getTabs: () => ({ open: false, selectedKey: null, tabs: [] }) }),
  useComposer: () => ({ scope: { kind: "thread", threadId: state.threadId }, insert: state.insert }),
}));
vi.mock("../../kit/app/nav", () => ({ openAppPath: vi.fn() }));

const { askBotAboutItem, askTarget } = await import("../ask-about-item");
const { requestComposerMention, resetThreadTabRequests, ThreadTabReceiver } = await import("../../kit/app/thread-panel");
const { rememberConversation, resetSidebarState, setCurrentBot } = await import("../conversations/state");

const PAGE = "/plugins/studio/studio/pages/pg_b";
const spaces = async () => ({ bots: [{ id: "cos", mainThreadId: "main" }], currentBotId: "cos" });
const gone = new Set<string>();
const land = async ({ last }: { botId: string; last: string | null }) => ({ threadId: [last, "main"].find((id) => !!id && !gone.has(id)) ?? null });

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); state.openTab.mockClear(); state.insert.mockClear(); resetSidebarState(); });
afterEach(() => { resetThreadTabRequests(); resetSidebarState(); vi.unstubAllGlobals(); });

it("asks the Bot in the conversation the file is beside, else in the Bot's last conversation, else Main, with the file mentioned", async () => {
  expect(await askTarget({ kind: "thread", threadId: "beside" }, spaces, land)).toEqual({ threadId: "beside", opens: false });
  expect(await askTarget(null, spaces, land)).toEqual({ threadId: "main", opens: true });
  setCurrentBot("cos");
  rememberConversation("cos", "prep");
  expect(await askTarget({ kind: "studio" }, spaces, land)).toEqual({ threadId: "prep", opens: true });
  gone.add("prep");
  expect(await askTarget({ kind: "studio" }, spaces, land)).toEqual({ threadId: "main", opens: true });
  gone.clear();
  const open = vi.fn();
  const mention = vi.fn(async () => true);
  expect(await askBotAboutItem({ item: { title: "Plan", href: PAGE }, itemRef: { pluginId: "pages", id: "pg_b" }, container: null }, { spaces, land, open, mention })).toBe(true);
  expect(open).toHaveBeenCalledWith("prep");
  expect(mention).toHaveBeenCalledWith("prep", { provider: "page", id: "pg_b", label: "Plan" });
});

it("a thread's composer puts a requested mention in once, when its view is on screen", async () => {
  state.threadId = "prep";
  const asked = requestComposerMention("prep", { provider: "page", id: "pg_b", label: "Plan" });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => { root.render(<ThreadTabReceiver />); });
  expect(await asked).toBe(true);
  expect(state.insert).toHaveBeenCalledWith({ provider: "page", id: "pg_b", label: "Plan" });
  await act(async () => { root.render(<ThreadTabReceiver key="again" />); });
  expect(state.insert).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

import { expect, it } from "vitest";
import { BOARD_TAB, BOARD_TAB_EVENT, boardThreadId, registerBoardTab, takeTabRequest, type TabRequest } from "./board-tab";

const request = (over: Partial<TabRequest> = {}): TabRequest & { replies: (string | null)[] } => {
  const replies: (string | null)[] = [];
  return { pluginId: "studio-visual-chat", tabId: BOARD_TAB, params: { threadId: "thr_b" }, title: "Election night", threadId: "thr_1", options: { focus: true, pane: 2, index: 0 }, taken: false, reply: (key) => { replies.push(key); }, replies, ...over };
};

it("opens a board Studio asks for in that conversation's workbench, where it says", async () => {
  const opened: unknown[] = [];
  const asked = request();
  expect(takeTabRequest(asked, (threadId) => ({ open: async (spec, options) => { opened.push([threadId, spec, options]); return "k7"; } }))).toBe(true);
  expect(asked.taken).toBe(true);
  await Promise.resolve(); await Promise.resolve();
  expect(opened).toEqual([["thr_1", { kind: "tab", tab: { id: "board" }, params: { threadId: "thr_b" }, title: "Election night" }, { focus: true, pane: 2, index: 0 }]]);
  expect(asked.replies).toEqual(["k7"]);
});

it("leaves other plugins' and other tabs' requests alone, and answers null with no workbench", () => {
  expect(takeTabRequest(request({ pluginId: "studio" }), () => null)).toBe(false);
  expect(takeTabRequest(request({ params: null }), () => null)).toBe(false);
  const off = request();
  expect(takeTabRequest(off, () => null)).toBe(true);
  expect(off.replies).toEqual([null]);
  // Studio's src/ui/tab-open.ts sends on the same event.
  expect(BOARD_TAB_EVENT).toBe("bb-studio:open-plugin-tab");
});

it("registers the board tab for other plugins to open, off BB's New Tab page, and only shows a thread id's board", () => {
  const tabs: Record<string, unknown>[] = [];
  const overlays: string[] = [];
  expect(registerBoardTab({}, () => null, "icon")).toBe(false);
  expect(registerBoardTab({ experimental_tab: (tab: Record<string, unknown>) => tabs.push(tab), experimental_appOverlay: (overlay: { id: string }) => overlays.push(overlay.id) }, () => null, "icon")).toBe(true);
  expect(tabs[0]).toMatchObject({ id: BOARD_TAB, context: { kind: "thread" }, availability: "action", experimental_openableByPlugins: true, experimental_showInNewTab: false });
  expect(overlays).toEqual(["board-tab-requests"]);
  expect(boardThreadId({ threadId: "thr_b" })).toBe("thr_b");
  expect(boardThreadId({ threadId: "../x" })).toBeNull();
});

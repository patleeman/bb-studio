import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({}), useBbContext: () => ({}) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn() }));
vi.mock("../talk/ui/call-view", () => ({ openCallPicker: vi.fn() }));
vi.mock("../voice/meeting/ui/store", () => ({ startMeeting: vi.fn() }));

const { entryFor, NEW_MENU_KINDS, registerNewMenu } = await import("./new-menu");

it("registers the kinds, then a Bot, only where BB has the New menu slot", () => {
  const rows: { id: string; group?: string }[] = [];
  expect(registerNewMenu({ navPanel() {} })).toBe(false);
  expect(registerNewMenu({ experimental_sidebarNewItem: (row: { id: string; group?: string }) => { rows.push(row); } })).toBe(true);
  expect(rows.map((row) => row.id)).toEqual([...NEW_MENU_KINDS.map((each) => `new-${each.kind}`), "new-bot"]);
  expect(rows.slice(0, -1).map((row) => row.group)).toEqual(["pages", "pages", "pages", "apps", "apps"]);
  expect(rows.at(-1)?.group).toBe("bot");
});

it("finds the entry a row makes, and none when the kind is off", () => {
  const page = { type: "kind", key: "pages:page", label: "Page", icon: "x", pluginId: "pages", addOn: "Pages", kind: { id: "page" } } as never;
  const board = { type: "whiteboard", key: "excalidraw:whiteboard", label: "Whiteboard", icon: "x" } as never;
  expect(entryFor("page", [page, board])).toBe(page);
  // A whiteboard is made as a page holding one, not as the drawing kind.
  expect(entryFor("drawing", [page, board])).toBe(board);
  expect(entryFor("mini", [page, board])).toBeNull();
});

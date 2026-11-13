import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({}), useBbContext: () => ({}) }));
vi.mock("../kit/app/nav", () => ({ openAppPath: vi.fn() }));
vi.mock("../talk/ui/call-view", () => ({ openCallPicker: vi.fn() }));

const { entryFor } = await import("./new-menu");

it("finds the entry a row makes, and none when the kind is off", () => {
  const page = { type: "kind", key: "pages:page", label: "Page", icon: "x", pluginId: "pages", addOn: "Pages", kind: { id: "page" } } as never;
  const board = { type: "whiteboard", key: "excalidraw:whiteboard", label: "Whiteboard", icon: "x" } as never;
  expect(entryFor("page", [page, board])).toBe(page);
  // A whiteboard is made as a page holding one, not as the drawing kind.
  expect(entryFor("drawing", [page, board])).toBe(board);
  expect(entryFor("mini", [page, board])).toBeNull();
});

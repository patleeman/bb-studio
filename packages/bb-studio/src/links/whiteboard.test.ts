import { expect, it, vi } from "vitest";
import { openWhiteboardLink } from "./whiteboard";

it("a link on a whiteboard element goes through the router with the click's keys, instead of Excalidraw's own window", () => {
  const open = vi.fn(async () => ({ via: "workbench" as const, pane: null, opened: true }));
  const event = { preventDefault: vi.fn(), detail: { nativeEvent: { metaKey: true, ctrlKey: false, shiftKey: false } } };
  expect(openWhiteboardLink({ link: "bb://page/pg_1" }, event, "thr_1", open)).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith("bb://page/pg_1", { source: "whiteboard", modifiers: { meta: true, ctrl: false, shift: false }, threadId: "thr_1" });
  expect(openWhiteboardLink({ link: "https://example.com/" }, { ...event, detail: { nativeEvent: { shiftKey: true } } }, null, open)).toBe(true);
  expect(open).toHaveBeenLastCalledWith("https://example.com/", { source: "whiteboard", modifiers: { meta: false, ctrl: false, shift: true } });
  expect(openWhiteboardLink({ link: null }, event, "thr_1", open)).toBe(false);
  expect(open).toHaveBeenCalledTimes(2);
});

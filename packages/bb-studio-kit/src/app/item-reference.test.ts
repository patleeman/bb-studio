import { expect, it } from "vitest";
import { ITEM_REFERENCE_TYPE, itemReferenceFrom, itemReferenceText, parseItemReference } from "./item-reference";
import { itemLinkIcon, mentionQuery, splitItemLinks } from "./item-links";

const clipboard = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" }) as DataTransfer;

it("copies a reference as a Markdown link to the item's view", () => {
  expect(itemReferenceText({ href: "/plugins/pages/pages/pg_1", title: "Q4 [draft] plan" })).toBe("[Q4 draft plan](/plugins/pages/pages/pg_1)");
  expect(itemReferenceText({ href: "/plugins/excalidraw/drawings/d_1" })).toBe("[Untitled](/plugins/excalidraw/drawings/d_1)");
});

it("reads a reference back from its text", () => {
  expect(parseItemReference("[Plan](/plugins/pages/pages/pg_1)", "")).toEqual({ href: "/plugins/pages/pages/pg_1", title: "Plan" });
  expect(parseItemReference("@[Board](https://bb.local/plugins/studio-tasks/tasks/brd_1)", "https://bb.local")).toEqual({
    href: "/plugins/studio-tasks/tasks/brd_1",
    title: "Board",
  });
  expect(parseItemReference("https://bb.local/plugins/talk/recordings/r_1", "https://bb.local")).toEqual({ href: "/plugins/talk/recordings/r_1" });
  expect(parseItemReference("[Web](https://example.com/plugins/a/b/c)", "https://bb.local")).toBeNull();
  expect(parseItemReference("See [Plan](/plugins/pages/pages/pg_1) today", "")).toBeNull();
});

it("prefers Studio's own clipboard type, and takes bare links only when asked", () => {
  const ours = clipboard({ [ITEM_REFERENCE_TYPE]: JSON.stringify({ href: "/plugins/pages/pages/pg_1", title: "Plan", icon: "📋" }), "text/plain": "x" });
  expect(itemReferenceFrom(ours)).toEqual({ href: "/plugins/pages/pages/pg_1", title: "Plan", icon: "📋" });
  expect(itemReferenceFrom(clipboard({ [ITEM_REFERENCE_TYPE]: JSON.stringify({ href: "https://evil.com" }) }))).toBeNull();
  expect(itemReferenceFrom(clipboard({ "text/plain": "[Plan](/plugins/pages/pages/pg_1)" }))).toEqual({ href: "/plugins/pages/pages/pg_1", title: "Plan" });
  expect(itemReferenceFrom(clipboard({ "text/plain": "/plugins/pages/pages/pg_1" }))).toBeNull();
  expect(itemReferenceFrom(clipboard({ "text/plain": "/plugins/pages/pages/pg_1" }), { bare: true })).toEqual({ href: "/plugins/pages/pages/pg_1" });
});

it("splits item links out of plain text", () => {
  expect(splitItemLinks("See [Plan](/plugins/pages/pages/pg_1) and [web](https://a.com).")).toEqual([
    { text: "See " },
    { title: "Plan", href: "/plugins/pages/pages/pg_1" },
    { text: " and [web](https://a.com)." },
  ]);
});

it("finds the @ query before the caret", () => {
  expect(mentionQuery("Ask @road", 9)).toEqual({ start: 4, query: "road" });
  expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
  expect(mentionQuery("mail me@home", 12)).toBeNull();
  expect(mentionQuery("@road map", 9)).toBeNull();
});

it("picks an item's icon from its link", () => {
  expect(itemLinkIcon("/plugins/pages/pages/pg_1")).toBe("pages/pages");
  expect(itemLinkIcon("/plugins/studio-tasks/tasks/brd_1/list")).toBe("studio-tasks/board");
  expect(itemLinkIcon("/plugins/studio-tasks/tasks/tsk_1")).toBe("studio-tasks/task");
  expect(itemLinkIcon("/plugins/studio-tables/tables/tbl_1/view/v_1")).toBe("Rows2");
  expect(itemLinkIcon("/plugins/studio/studio/space/spc_1")).toBe("Layers");
  expect(itemLinkIcon("/plugins/unknown/things/x_1")).toBe("GridView");
});

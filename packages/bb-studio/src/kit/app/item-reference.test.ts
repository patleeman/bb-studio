import { expect, it } from "vitest";
import { ITEM_REFERENCE_TYPE, itemReferenceFrom, itemReferenceText, parseItemReference } from "./item-reference";

const clipboard = (data: Record<string, string>) => ({ getData: (type: string) => data[type] ?? "" }) as DataTransfer;

it("copies a reference as a Markdown link to the item's view", () => {
  expect(itemReferenceText({ href: "/plugins/pages/pages/pg_1", title: "Q4 [draft] plan" })).toBe("[Q4 draft plan](/plugins/pages/pages/pg_1)");
  expect(itemReferenceText({ href: "/plugins/excalidraw/drawings/d_1" })).toBe("[Untitled](/plugins/excalidraw/drawings/d_1)");
});

it("reads a reference back from its text", () => {
  expect(parseItemReference("[Plan](/plugins/pages/pages/pg_1)", "")).toEqual({ href: "/plugins/pages/pages/pg_1", title: "Plan" });
  expect(parseItemReference("@[Drawing](https://bb.local/plugins/excalidraw/drawings/drw_1)", "https://bb.local")).toEqual({
    href: "/plugins/excalidraw/drawings/drw_1",
    title: "Drawing",
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

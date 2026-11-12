// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Icon: ({ name, className }: { name: string; className?: string }) => <i data-icon={name} className={className} />,
  experimental_useAppPanel: () => ({ openTab: () => false }),
  useBbNavigate: () => ({ toThread: () => {}, toCompose: () => {}, openUrl: () => true }),
  useBbContext: () => ({ projectId: null }),
  useRealtime: () => {},
  useRpc: () => ({ call: async () => ({}) }),
  useSdk: () => ({}),
}));

const { CollectionPage } = await import("./collection");

const kind = { pluginId: "studio", id: "page", label: "Page", plural: "Pages", icon: "File", columns: [], actions: [], create: null, canArchive: true, blurb: "" };
const item = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) => ({
  pluginId: "studio", id, kind: "page", title: `Item ${id}`, icon: null, projectId: null, parentId: null, createdAt: 0, updatedAt,
  updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null, href: `/p/${id}`, archived: false, template: false, ...extra,
});
const handlers = {
  onOpen: vi.fn(), onNewThread: vi.fn(), onMove: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onAction: vi.fn(),
  onStar: vi.fn(async () => {}),
};
const filter = (extra: Record<string, unknown> = {}) => ({ bar: null, text: "", snippets: new Map(), archived: false, empty: "Nothing matches.", ...extra });

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (props: Record<string, unknown>) => act(async () => root.render(
  <CollectionPage title="Studio" kinds={[kind]} items={[]} projects={[]} defaultProjectId={null} storageKey="test" kind="all" onKindChange={() => {}} handlers={handlers as never} {...props} />,
));
const groups = () => [...container.querySelectorAll('[role="rowgroup"]')].map((group) => [group.getAttribute("aria-label"), [...group.querySelectorAll('[role="row"][aria-label]')].map((row) => row.getAttribute("aria-label"))]);
const rows = () => [...container.querySelectorAll('[role="row"][aria-label]')].map((row) => row.getAttribute("aria-label"));

it("puts a leading group first, with the rest after it", async () => {
  await render({ items: [item("a", 3), item("b", 2), item("c", 1)], filter: filter(), leadingGroup: { id: "this-thread", label: "This thread", keys: new Set(["studio:b"]) } });
  expect(groups()).toEqual([["This thread", ["Item b"]], ["Other items", ["Item a", "Item c"]]]);
});

it("drops the leading group when its scope is cleared", async () => {
  await render({ items: [item("a", 3), item("b", 2)], filter: filter(), leadingGroup: null });
  expect(groups()).toEqual([]);
  expect(rows()).toEqual(["Item a", "Item b"]);
});

it("keeps the host's order for the starred list, ungrouped", async () => {
  await render({ items: [item("old", 9, { starredAt: 5 }), item("new", 1, { starredAt: 7 })].reverse(), filter: filter({ order: "given" }), defaultGroupBy: "project" });
  expect(rows()).toEqual(["Item new", "Item old"]);
  expect(groups()).toEqual([]);
});

it("marks starred rows", async () => {
  await render({ items: [item("a", 3, { starredAt: 1 }), item("b", 2)], filter: filter() });
  const starred = [...container.querySelectorAll('[role="row"][aria-label]')].map((row) => !!row.querySelector('[data-testid="collection-starred"]'));
  expect(starred).toEqual([true, false]);
});

it("shows the host's empty text", async () => {
  await render({ items: [], filter: filter({ empty: "Nothing starred" }) });
  expect(container.textContent).toContain("Nothing starred");
});

it("keeps the time on the right of a narrow row, with kind and project under the title", async () => {
  await render({ items: [item("a", Date.now())], filter: filter() });
  const row = container.querySelector('[role="row"][aria-label="Item a"]')!;
  const cells = row.querySelectorAll('[role="gridcell"]');
  const last = cells[cells.length - 1]!;
  // Narrow (@max-xl) rows hide the Project column but not the time.
  expect(last.querySelector("[title]")!.className).not.toContain("hidden");
  expect(row.textContent).toContain("Global");
});

it("offers Star and Unstar in a row's menu", async () => {
  await render({ items: [item("a", 3, { starredAt: 1 }), item("b", 2)], filter: filter() });
  const menuFor = async (label: string) => {
    const row = container.querySelector(`[role="row"][aria-label="${label}"]`)!;
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 })); });
    return [...document.querySelectorAll('[role="menuitem"]')].find((each) => /^(Star|Unstar)$/.test(each.textContent!.trim())) as HTMLElement;
  };
  const unstar = await menuFor("Item a");
  expect(unstar.textContent!.trim()).toBe("Unstar");
  await act(async () => unstar.click());
  expect(handlers.onStar).toHaveBeenLastCalledWith([expect.objectContaining({ id: "a" })], false);
  const star = await menuFor("Item b");
  expect(star.textContent!.trim()).toBe("Star");
  await act(async () => star.click());
  expect(handlers.onStar).toHaveBeenLastCalledWith([expect.objectContaining({ id: "b" })], true);
});

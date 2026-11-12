// @vitest-environment jsdom
// The Pages view and a thread's side panel share one layout: the reading
// column, the icon and the big title. These tests pin that, so the two can't
// drift apart again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PageMetaView } from "../contract";
import { PAGE_COLUMN, PAGE_GUTTER } from "./PageLayout";
import { TitleRecovery } from "./page-title";

const pageId = "pg_layout";
const page = { id: pageId, title: "Breakdown: Design ChatGPT", icon: "📘", updatedAt: 1, archived: false } as unknown as PageMetaView;
const state = vi.hoisted(() => ({ call: vi.fn(), rpc: { call: (...args: unknown[]) => state.call(...args) } }));

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => state.rpc, useRealtime: () => {}, experimental_Icon: () => null }));
vi.mock("../../ui/studio-open", () => ({ useStudioOpen: () => vi.fn() }));
vi.mock("./use-panel-page", () => ({ usePanelPage: () => ({ page, refetch: vi.fn(), markMissing: vi.fn() }) }));
vi.mock("./PagesPanel", () => ({ usePagesData: () => ({ pages: [page], bots: { bots: [] } }), usePagesUiValue: () => ({}) }));
vi.mock("./PageView", () => ({ useConnection: () => ({ connection: {}, status: "loaded", ready: true }), persistenceVisible: () => false, PersistenceBadge: () => null }));
vi.mock("./PageEditor", () => ({ PageEditor: () => <div className="pages-editor"><div className="pages-main"><div className="bn-editor" tabIndex={-1}>Body</div></div></div> }));
vi.mock("./PageIconPicker", () => ({ PageIconPicker: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("./notes/NoteActions", () => ({ NoteActions: () => null }));
vi.mock("./whiteboard-expand", () => ({ WhiteboardExpandHost: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const { PageTab } = await import("./PagePanel");
const here = join(process.cwd(), "src/pages/ui");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  state.call.mockReset();
  state.call.mockImplementation(async (method: string, input: { title?: string }) =>
    method === "pages.update" ? { page: { ...page, title: input.title, updatedAt: 2 } } : { page });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  const recovery = new TitleRecovery(location.origin, pageId);
  for (const draft of recovery.memory()) recovery.remove(draft);
  localStorage.clear(); vi.useRealTimers();
});

async function render() { await act(async () => root.render(<PageTab pageId={pageId} backLabel="Studio" onBack={() => {}} />)); }
const title = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Page title"]')!;

it("keeps the reading column centred at the Pages width, with the editor's gutter", () => {
  expect(PAGE_COLUMN).toContain("mx-auto");
  expect(PAGE_COLUMN).toContain("max-w-[828px]");
  expect(PAGE_GUTTER).toContain("px-[54px]");
  // The body text sits in the editor's padding, which must match the title's gutter.
  expect(readFileSync(join(here, "styles.css"), "utf8")).toMatch(/\.pages-main > \.bn-editor \{[^}]*padding-inline: 54px;/);
});

it("puts the side panel's page in the shared column, with the icon and big title", async () => {
  await render();
  const column = container.querySelector("[data-page-column]")!;
  expect(column.className).toBe(PAGE_COLUMN);
  const heading = column.querySelector("[data-page-heading]")!;
  expect(heading.querySelector('button[aria-label="Change icon"]')!.textContent).toBe("📘");
  expect(title().value).toBe("Breakdown: Design ChatGPT");
  // The title isn't repeated in the slim header.
  const header = container.querySelector("header")!;
  expect(header.textContent).not.toContain("Breakdown");
  expect(header.textContent).toContain("Edited");
  expect(header.textContent).toContain("Open in Pages");
});

it("renames the page from the big title, the way the Pages view does", async () => {
  await render();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => { setter.call(title(), "Breakdown: ChatGPT"); title().dispatchEvent(new Event("input", { bubbles: true })); });
  expect(container.querySelector("header")!.textContent).toContain("Saving title…");
  // Enter moves to this page's body instead of adding a line.
  await act(async () => { title().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(document.activeElement?.className).toBe("bn-editor");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
  expect(state.call.mock.calls.filter(([method]) => method === "pages.update")).toEqual([
    ["pages.update", { id: pageId, title: "Breakdown: ChatGPT", expectedTitle: "Breakdown: Design ChatGPT" }],
  ]);
});

it("uses the same layout in the Pages view", () => {
  const view = readFileSync(join(here, "PageView.tsx"), "utf8");
  expect(view).toContain("<PageColumn");
  expect(view).toContain("<PageHeading");
  // No second copy of the column or title markup.
  expect(view).not.toContain("max-w-[828px]");
  expect(view).not.toContain("<textarea");
});

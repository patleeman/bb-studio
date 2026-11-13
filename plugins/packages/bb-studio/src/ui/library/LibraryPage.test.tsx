// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryItem } from "../../bot-threads-contract";

const NOW = new Date("2026-11-10T15:00:00").getTime();
const HOUR = 3_600_000;
const state = vi.hoisted(() => ({ items: [] as unknown[], open: vi.fn(), toThread: vi.fn(), openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })) }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }) }));
vi.mock("../live", () => ({
  useLive: (method: string) => ({ data: method === "bot_library" ? { items: state.items } : method === "bot_spaces" ? { bots: [{ id: "bot_main", name: "Chief of Staff", mainThreadId: null }], currentBotId: "bot_main" } : null, error: null, refresh: () => {} }),
}));
vi.mock("../../kit/app/nav", () => ({ openAppPath: state.open }));
vi.mock("../../kit/ui/icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));
vi.mock("../../kit/app/index", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />, openAppPath: state.open,
  StudioBar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?(): void }) => <button type="button" role="menuitem" onClick={() => onSelect?.()}>{children}</button>,
}));

const { LibraryPage } = await import("./LibraryPage");
const item = (id: string, title: string, kind: LibraryItem["kind"], hoursAgo: number, madeIn: LibraryItem["madeIn"] = null): LibraryItem => ({ pluginId: "studio", id, title, kind, type: null, href: `/plugins/studio/studio/pages/${id}`, updatedAt: NOW - hoursAgo * HOUR, createdAt: null, madeIn });
const prep = { threadId: "thr_prep", title: "Launch prep", kind: "conversation" as const, conversationId: "thr_prep", conversationTitle: "Launch prep" };
const lead = { threadId: "thr_lead", title: "Fable lead", kind: "worker" as const, conversationId: "thr_prep", conversationTitle: "Launch prep" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  try { localStorage.removeItem("studio.library.group"); } catch { /* none */ }
  state.open.mockClear(); state.toThread.mockClear(); state.openLink.mockClear();
  state.items = [item("pg_0123456789abcdef", "Study plan", "page", 2, prep), item("wb_grid", "Grid sketch", "whiteboard", 5, lead), item("pg_mine", "Groceries", "page", 30)];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

it("is the Library on the Bot-page template: its header, Kind pills, conversation groups and one line per file", () => {
  act(() => root.render(<LibraryPage />));
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Library·Chief of Staff");
  expect(container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")?.placeholder).toBe("Search Library");
  expect([...container.querySelectorAll("[data-testid=bot-page-pill]")].map((each) => each.textContent)).toEqual(["All", "Starred", "Page", "Whiteboard", "Design", "App", "Recording"]);
  expect(container.querySelector("[data-testid=bot-page-subpills]")).toBeNull();
  const groups = [...container.querySelectorAll<HTMLElement>("[data-testid=library-group-section]")];
  expect(groups.map((each) => each.getAttribute("aria-label"))).toEqual(["Launch prep", "Made by you"]);
  const rows = [...groups[0]!.querySelectorAll<HTMLElement>("[data-testid=library-row]")];
  // In its conversation's group, a file says its kind and age; a worker's says who made it.
  expect(rows.map((row) => row.querySelector("[data-testid=bot-page-row-meta]")?.textContent)).toEqual(["Page · 2h", "Whiteboard · by Fable lead · 5h"]);
  // The group's title opens the conversation; a row opens the file.
  act(() => groups[0]!.querySelector<HTMLButtonElement>("h2 button")!.click());
  expect(state.toThread).toHaveBeenCalledWith("thr_prep");
  act(() => rows[0]!.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_0123456789abcdef", { source: "botPage", title: "Study plan", modifiers: { meta: false, ctrl: false, shift: false } });
  expect(rows[0]!.getAttribute("data-row-link")).toBe("bb://page/pg_0123456789abcdef");
  expect(rows[0]!.dataset.selected).toBe("true");
  expect(state.toThread).toHaveBeenCalledTimes(1);
  act(() => { rows[0]!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_0123456789abcdef", { source: "botPage", title: "Study plan", modifiers: { meta: true, ctrl: false, shift: false } });
  act(() => { rows[0]!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_0123456789abcdef", { source: "botPage", title: "Study plan", modifiers: { meta: false, ctrl: false, shift: true } });
  expect(state.open).not.toHaveBeenCalled();
  act(() => rows[1]!.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.open).toHaveBeenCalledWith("/plugins/studio/studio/pages/wb_grid");
  expect(state.openLink).toHaveBeenCalledTimes(3);
  act(() => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")].find((each) => each.textContent === "Whiteboard")!.click());
  expect([...container.querySelectorAll("[data-testid=library-row] [data-testid=bot-page-row-title]")].map((each) => each.textContent)).toEqual(["Grid sketch"]);
});

it("leaves out a worker's name when it is the file's own title", () => {
  state.items = [item("art_email", "Millers Flour discount email", "artifact", 1, { ...lead, title: "Millers Flour discount email" })];
  act(() => root.render(<LibraryPage />));
  expect(container.querySelector("[data-testid=library-row] [data-testid=bot-page-row-meta]")?.textContent).toBe("App · 1h");
});

it("labels a saved Markdown file a Document", () => {
  state.items = [{ ...item("art_notes", "Supplier notes", "artifact", 1), format: "markdown" }];
  act(() => root.render(<LibraryPage />));
  expect(container.querySelector("[data-testid=library-row] [data-testid=bot-page-row-meta]")?.textContent).toBe("Document · made by you · 1h");
});

it("files the Bot's core profile under the Bot", () => {
  state.items = [{ ...item("pg_profile", "Chief of Staff's core profile", "page", 1), byBot: true }, item("pg_mine", "Groceries", "page", 3)];
  act(() => root.render(<LibraryPage />));
  const groups = [...container.querySelectorAll<HTMLElement>("[data-testid=library-group-section]")];
  expect(groups.map((each) => each.getAttribute("aria-label"))).toEqual(["Chief of Staff", "Made by you"]);
  expect(groups[0]!.querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("Page · made by Chief of Staff · 1h");
});

it("shows the starred files under Starred", () => {
  state.items = [{ ...item("pg_star", "Starred plan", "page", 1), starred: true }, item("pg_mine", "Groceries", "page", 3), { ...item("mini_star", "Starred timer", "app", 4), starred: true }];
  act(() => root.render(<LibraryPage />));
  act(() => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")].find((each) => each.textContent === "Starred")!.click());
  expect([...container.querySelectorAll("[data-testid=library-row] [data-testid=bot-page-row-title]")].map((each) => each.textContent)).toEqual(["Starred plan", "Starred timer"]);
});

it("narrows App to Interactive or Saved with a second row of pills", () => {
  state.items = [item("art_report", "Q3 report", "artifact", 1), item("mini_timer", "Round timer", "app", 2), item("pg_mine", "Groceries", "page", 3)];
  act(() => root.render(<LibraryPage />));
  const pill = (testId: string, label: string) => [...container.querySelectorAll<HTMLButtonElement>(`[data-testid=${testId}]`)].find((each) => each.textContent === label)!;
  const titles = () => [...container.querySelectorAll("[data-testid=library-row] [data-testid=bot-page-row-title]")].map((each) => each.textContent);
  act(() => pill("bot-page-pill", "App").click());
  expect([...container.querySelectorAll("[data-testid=bot-page-subpill]")].map((each) => each.textContent)).toEqual(["All apps", "Interactive", "Saved"]);
  expect(titles()).toEqual(["Q3 report", "Round timer"]);
  act(() => pill("bot-page-subpill", "Saved").click());
  expect(titles()).toEqual(["Q3 report"]);
  act(() => pill("bot-page-subpill", "Interactive").click());
  expect(titles()).toEqual(["Round timer"]);
  act(() => pill("bot-page-pill", "All").click());
  expect(container.querySelector("[data-testid=bot-page-subpills]")).toBeNull();
  expect(titles()).toEqual(["Q3 report", "Round timer", "Groceries"]);
});

it("says what is empty and offers one way on: Clear search for a query, Show all files for an empty kind, a hint for Starred and a new Library", () => {
  act(() => root.render(<LibraryPage />));
  const search = container.querySelector<HTMLInputElement>("[data-testid=bot-page-search]")!;
  const type = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, value); search.dispatchEvent(new Event("input", { bubbles: true })); });
  const empty = () => [container.querySelector("[data-testid=bot-page-empty-title]")?.textContent ?? null, container.querySelector("[data-testid=bot-page-empty-hint]")?.textContent ?? null, container.querySelector("[data-testid=bot-page-empty-action]")?.textContent ?? null];
  const pill = (label: string) => act(() => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")].find((each) => each.textContent === label)!.click());
  type("zzzz");
  expect(empty()).toEqual(["No files match “zzzz”", null, "Clear search"]);
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=bot-page-empty-action]")!.click());
  expect(search.value).toBe("");
  expect(container.querySelectorAll("[data-testid=library-row]").length).toBe(3);
  pill("Starred");
  expect(empty()).toEqual(["No starred files", "Open a file and press Star in its header.", null]);
  pill("Recording");
  expect(empty()).toEqual(["No recordings", null, "Show all files"]);
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=bot-page-empty-action]")!.click());
  expect(container.querySelectorAll("[data-testid=library-row]").length).toBe(3);
  state.items = [];
  act(() => root.render(<LibraryPage key="fresh" />));
  expect(empty()).toEqual(["No files yet", "Ask in a conversation for a page, a design or an app.", null]);
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MemoryRecordView } from "../contract";

const NOW = new Date("2026-11-10T15:00:00").getTime();
const day = (d: number, m = 11) => new Date(2026, m - 1, d, 12).getTime();
const record = (id: string, topic: string, text: string, extra: Partial<MemoryRecordView> = {}): MemoryRecordView => ({
  id, botId: "bot_main", topic, text, createdAt: day(10), updatedAt: day(10),
  source: { kind: "conversation", id: "thr_main", title: "Main", section: null }, sourceState: "live",
  replacesId: null, replaces: null, replacedById: null, replacedAt: null, archived: false, ...extra,
});
const state = vi.hoisted(() => ({
  calls: [] as [string, unknown][],
  overview: null as unknown,
  records: [] as unknown[],
  open: vi.fn(),
  openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })),
}));
const respond = async (method: string, input: unknown) => {
  state.calls.push([method, input]);
  if (method === "memory.overview") return state.overview;
  if (method === "memory.get") return { record: (state.records as { id: string }[]).find((each) => each.id === (input as { id: string }).id) ?? null };
  if (method === "memory.list") return { records: state.records, total: state.records.length };
  return { record: state.records[0] };
};
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => ({ call: respond }),
  useRealtime: () => {},
  useRealtimeConnectionState: () => "connected",
  useSdk: () => ({}),
  experimental_Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../ui/studio-open", () => ({ useStudioOpen: () => state.open }));
vi.mock("../../ui/bot/selection", () => ({ lastBot: () => undefined }));
vi.mock("./ProfilePane", () => ({ default: ({ pageId, header }: { pageId: string; header(page: { updatedAt: number }): unknown }) => <div data-testid="profile-pane" data-page={pageId}>{header({ updatedAt: day(9) }) as never}</div> }));

const { default: MemoryView } = await import("./MemoryView");
const { RecordTab } = await import("./RecordTab");
let root: Root, container: HTMLDivElement, tabRoot: Root, tabHost: HTMLDivElement;
const overview = (extra: Record<string, unknown> = {}) => ({
  bot: { id: "bot_main", name: "Chief of Staff" },
  profile: { pageId: "pg_profile", title: "Chief of Staff's core profile", updatedAt: day(9), chars: 900, cap: 2500, over: false },
  split: { state: "done", legacyPageId: "pg_old", legacyTitle: "Chief of Staff's Memory", splitAt: day(10) },
  counts: { current: 4, replaced: 1, archived: 0 },
  topics: [{ topic: "Launch", count: 2 }, { topic: "Fork", count: 1 }, { topic: "homelab", count: 1 }],
  ...extra,
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.calls = []; state.open.mockClear(); state.openLink.mockClear();
  state.overview = overview();
  state.records = [
    record("mem_new", "Launch", "The outline keeps 15 minutes for high-level design.", { source: { kind: "conversation", id: "thr_prep", title: "Launch prep", section: null }, sourceState: "finished", replacesId: "mem_old", replaces: { id: "mem_old", text: "Give high-level design 20 minutes in the outline.", createdAt: day(6) } }),
    record("mem_fork", "Fork", "The sidebar's top level is the Bot."),
    record("mem_red4", "homelab", "Saturday 03:00–05:00 ET is backup maintenance.", { createdAt: day(7), source: { kind: "worker", id: "thr_runner", title: "Runner: staff sweep", section: null } }),
    record("mem_split", "Launch", "One mock a day.", { createdAt: day(6), source: { kind: "page", id: "pg_old", title: "Chief of Staff's Memory", section: "Facts and decisions" }, sourceState: null }),
    record("mem_old", "Launch", "Give high-level design 20 minutes in the outline.", { createdAt: day(6), replacedById: "mem_new", replacedAt: day(10) }),
  ];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  tabHost = document.createElement("div"); document.body.append(tabHost); tabRoot = createRoot(tabHost);
});
afterEach(() => { act(() => { root.unmount(); tabRoot.unmount(); }); container.remove(); tabHost.remove(); vi.useRealTimers(); });

const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
const render = async () => { await act(async () => root.render(<MemoryView botId={null} />)); await flush(); };
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-testid=memory-record]")];
const button = (text: string, scope: ParentNode = document.body) => {
  const found = [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === text || each.getAttribute("aria-label") === text);
  if (!found) throw new Error(`No "${text}" button`);
  return found;
};
const lastList = () => state.calls.filter(([method]) => method === "memory.list").at(-1)?.[1] as Record<string, unknown>;
const key = (target: EventTarget, init: KeyboardEventInit) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })); });
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
};

const detail = () => tabHost.querySelector<HTMLElement>("[data-testid=record-detail]");
const openTab = async (id: string) => { await act(async () => tabRoot.render(<RecordTab params={{ id }} />)); await flush(); };
const openRow = async (row: HTMLElement) => {
  const id = row.getAttribute("data-record-id")!;
  await act(async () => row.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith(`bb://record/${id}`, expect.objectContaining({ source: "botPage", modifiers: { meta: false, ctrl: false, shift: false } }));
  expect(row.getAttribute("data-row-link")).toBe(`bb://record/${id}`);
  await openTab(id);
};
const unfold = async (testId: string) => { await act(async () => container.querySelector<HTMLButtonElement>(`[data-testid=${testId}] button[aria-expanded]`)!.click()); await flush(); };
const facts = () => Object.fromEntries([...detail()!.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));

it("shows the template's header, the folded profile, and one line per record; a record's detail has its topic, date, source and what it replaces", async () => {
  await render();
  // One row: the page's own title row, in BB's title bar where it lends one (src/ui/page-bar.tsx).
  expect(container.querySelector('[data-testid="page-bar"]')?.textContent).toBe("Memory·Chief of Staff");
  expect(container.querySelector('[data-testid="page-bar-title"]')?.className).toContain("shrink-0");
  expect(container.querySelector('[data-testid="page-bar-detail"]')?.className).toContain("truncate");
  // The core profile is a folded block above the records, with its count against the cap.
  expect(container.querySelector("[data-testid=memory-profile-count]")?.textContent).toBe("900 of 2,500 characters");
  expect(container.querySelector("[data-testid=memory-profile-count]")?.className).not.toContain("text-warning");
  expect(container.querySelector("[data-testid=profile-pane]")).toBeNull();
  await unfold("memory-profile");
  expect(container.querySelector("[data-testid=profile-pane]")?.getAttribute("data-page")).toBe("pg_profile");
  expect(container.querySelector("[data-testid=memory-profile-header]")?.textContent).toBe("Edited Nov 9");
  expect(container.querySelector("input[type=search]")?.getAttribute("placeholder")).toBe("Search 5 records");
  expect([...container.querySelectorAll("[data-testid=bot-page-pill]")].map((each) => each.textContent)).toEqual(["All", "Launch", "Fork", "homelab"]);
  // Current records, one line each; the replaced one is folded below.
  expect(rows().map((row) => row.getAttribute("data-record-id"))).toEqual(["mem_new", "mem_fork", "mem_red4", "mem_split"]);
  expect(rows()[2]!.querySelector("[data-testid=bot-page-row-meta]")?.textContent).toBe("homelab · Nov 7");
  await unfold("memory-replaced");
  expect(rows().map((row) => row.getAttribute("data-record-id"))).toEqual(["mem_new", "mem_fork", "mem_red4", "mem_split", "mem_old"]);
  const [replacing, fork, runner, split, old] = rows();
  await openRow(replacing!);
  expect(facts()).toMatchObject({ Topic: "Launch", Added: "Nov 10", Source: "from “Launch prep” (finished)" });
  expect(detail()!.querySelector("[data-testid=memory-replaces]")?.textContent).toBe("replaces “Give high-level design 20 minutes in the outline.” (Nov 6)");
  expect(detail()!.querySelector("[data-testid=memory-replaces]")?.className).toContain("text-warning");
  // Source links open their thread or page.
  await act(async () => button("from “Launch prep” (finished)").click());
  expect(state.open).toHaveBeenCalledWith({ threadId: "thr_prep", title: "Launch prep" });
  await openRow(fork!);
  expect(facts().Source).toBe("from Main");
  await openRow(runner!);
  expect(facts().Source).toBe("from Runner: staff sweep");
  await openRow(split!);
  await act(async () => button("from “Chief of Staff's Memory” › Facts and decisions").click());
  expect(state.open).toHaveBeenLastCalledWith({ href: "/plugins/studio/studio/pages/pg_old", title: "Chief of Staff's Memory" });
  await openRow(old!);
  expect(old!.querySelector("[data-testid=bot-page-row-title]")?.className).toContain("text-muted-foreground");
  expect(facts().Replaced).toBe("Nov 10");
  expect(() => button("Edit", detail()!)).toThrow();
  expect(old!.dataset.selected).toBe("true");
  expect(container.querySelector("[data-testid=bot-page-detail], [data-fork-card=secondary-panel], [data-testid=memory-record-text]")).toBeNull();
  await act(async () => { fork!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://record/mem_fork", { source: "botPage", title: "Fork", modifiers: { meta: true, ctrl: false, shift: false } });
  await act(async () => { fork!.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://record/mem_fork", { source: "botPage", title: "Fork", modifiers: { meta: false, ctrl: false, shift: true } });
});

it("a deleted record's tab says Not found, with its link", async () => {
  await openTab("mem_gone");
  expect(detail()).toBeNull();
  expect(tabHost.querySelector("[data-testid=link-not-found]")?.textContent).toContain("bb://record/mem_gone");
});

it("searches as you type; / focuses the field, Esc clears it and a second Esc leaves it; pills and sort filter", async () => {
  await render();
  const field = container.querySelector<HTMLInputElement>("input[type=search]")!;
  await key(document.body, { key: "/" });
  expect(document.activeElement).toBe(field);
  await type(field, "backup");
  expect(lastList()).toEqual({ botId: "bot_main", query: "backup", sort: "newest", limit: 300 });
  await key(field, { key: "Escape" });
  await flush();
  expect(field.value).toBe("");
  expect(document.activeElement).toBe(field);
  await key(field, { key: "Escape" });
  expect(document.activeElement).not.toBe(field);
  // "/" typed in a text field is just text.
  field.focus();
  await key(field, { key: "/" });
  await act(async () => button("Launch").click());
  await flush();
  expect(button("Launch").getAttribute("data-state")).toBe("on");
  expect(lastList()).toEqual({ botId: "bot_main", topic: "Launch", sort: "newest", limit: 300 });
  // Sort is the app's menu button ("Newest ⌄"), not a native select.
  expect(container.querySelector("select")).toBeNull();
  const sort = container.querySelector<HTMLButtonElement>("[data-testid=memory-sort]")!;
  expect(sort.textContent).toBe("Newest");
  await key(sort, { key: "Enter" });
  await flush();
  await act(async () => { document.querySelector<HTMLElement>("[data-testid=memory-sort-choice][data-value=topic]")!.click(); });
  await flush();
  expect(lastList()).toMatchObject({ topic: "Launch", sort: "topic" });
  await act(async () => button("All").click());
  await flush();
  expect(lastList()).toEqual({ botId: "bot_main", sort: "topic", limit: 300 });
});

it("edits a record in place as a new replacing record, archives one, and adds one", async () => {
  await render();
  await openRow(rows()[1]!);
  await act(async () => button("Edit", detail()!).click());
  const text = detail()!.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(text.value).toBe("The sidebar's top level is the Bot.");
  expect(button("Save as new record", detail()!).disabled).toBe(true);
  await type(text, "The sidebar's top level is the Bot, with Conversations and Workers.");
  await act(async () => button("Save as new record", detail()!).click());
  await flush();
  expect(state.calls.find(([method]) => method === "memory.update")?.[1]).toEqual({ botId: "bot_main", id: "mem_fork", text: "The sidebar's top level is the Bot, with Conversations and Workers." });
  expect(detail()!.querySelector("textarea")).toBeNull();
  await openRow(rows()[2]!);
  await act(async () => button("Archive", detail()!).click());
  expect(state.calls.find(([method]) => method === "memory.archive")?.[1]).toEqual({ botId: "bot_main", id: "mem_red4", archived: true });
  await act(async () => button("New").click());
  const add = container.querySelector<HTMLElement>("[data-testid=memory-add]")!;
  await type(add.querySelector<HTMLInputElement>("input[aria-label=Topic]")!, "Home");
  await type(add.querySelector("textarea")!, "GORUCK return window ends Nov 15.");
  await act(async () => button("Add record", add).click());
  await flush();
  expect(state.calls.find(([method]) => method === "memory.add")?.[1]).toEqual({ botId: "bot_main", topic: "Home", text: "GORUCK return window ends Nov 15." });
  expect(container.querySelector("[data-testid=memory-add]")).toBeNull();
});

it("shows only the profile and the records, with no split preview, and says No records yet, with New record, when there are none", async () => {
  state.overview = overview({ split: { state: "done", legacyPageId: "pg_old", legacyTitle: "Chief of Staff's Memory", splitAt: day(10) }, counts: { current: 0, replaced: 0, archived: 0 }, topics: [] });
  state.records = [];
  await render();
  await unfold("memory-profile");
  expect(container.querySelector("[data-testid=profile-pane]")).not.toBeNull();
  expect(container.querySelector("[data-testid=memory-empty] [data-testid=bot-page-empty-title]")?.textContent).toBe("No records yet");
  expect(container.querySelector("[data-testid=memory-empty] [data-testid=bot-page-empty-action]")?.textContent).toBe("New record");
  expect(container.querySelector("[data-testid^=memory-split]")).toBeNull();
  expect(container.textContent).not.toMatch(/split/i);
  expect(state.calls.map(([method]) => method).filter((method) => !["memory.overview", "memory.list"].includes(method))).toEqual([]);
  // Before the split has run (a moment at most), there's no profile yet and still no preview.
  state.overview = overview({ profile: null, split: { state: "needed", legacyPageId: "pg_old", legacyTitle: "Chief of Staff's Memory", splitAt: null }, counts: { current: 0, replaced: 0, archived: 0 }, topics: [] });
  act(() => root.unmount()); root = createRoot(container);
  await render();
  await unfold("memory-profile");
  expect(container.querySelector("[data-testid=memory-profile-page]")?.textContent).toBe("No core profile");
  expect(container.querySelector("[data-testid^=memory-split]")).toBeNull();
  expect(container.textContent).not.toMatch(/split/i);
});

it("shows the core profile's count against the cap when it is over", async () => {
  state.overview = overview({ profile: { pageId: "pg_profile", title: "P", updatedAt: day(9), chars: 4100, cap: 2500, over: true } });
  await render();
  const count = container.querySelector("[data-testid=memory-profile-count]")!;
  expect(count.textContent).toBe("4,100 of 2,500 characters");
  expect(count.className).toContain("text-warning");
});

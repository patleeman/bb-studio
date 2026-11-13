// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AutomationTable, AutomationTableRow } from "../../automation-table-contract";

const state = vi.hoisted(() => ({ table: null as unknown, views: [] as unknown[], open: vi.fn(), openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })), openThread: vi.fn(), tabs: null as unknown, call: vi.fn(async () => ({})), calendar: null as { id: string }[] | null }));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({
    data: method === "bot_automation_table" ? state.table : method === "bot_automations" ? { automations: state.views } : method === "bot_automation_runs" ? { runs: [] } : method === "bot_list" ? { bots: [{ id: "bot_main", name: "Chief of Staff", state: "active" }] } : null,
    loading: false, error: null, refresh: () => {},
  }),
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({ ...(await importOriginal<object>()), experimental_usePanelTabs: () => state.tabs }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("../bot/workspace", () => ({ useOpenThread: () => state.openThread }));
vi.mock("../../kit/app/index", () => ({ GHOST_BUTTON: "", PRIMARY_BUTTON: "", DANGER_BUTTON: "", openAppPath: state.open, StudioBar: ({ children }: { children?: ReactNode }) => <div data-testid="studio-bar">{children}</div> }));
vi.mock("../../kit/ui/index", () => {
  const box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: box, DialogContent: box, DialogHeader: box, DialogFooter: box, DialogTitle: box, DialogDescription: box,
    DropdownMenu: box, DropdownMenuContent: box, DropdownMenuTrigger: box, DropdownMenuItem: box,
    Input: (props: object) => <input {...props} />, Icon: () => null,
  };
});
vi.mock("../../kit/ui/icon", () => ({ Icon: () => null }));
vi.mock("../bot/AutomationsCalendar", () => ({ AutomationsCalendar: (props: { automations: { id: string }[] }) => { state.calendar = props.automations; return null; } }));

const { AutomationsTable, lastRunText, statusText } = await import("./AutomationsTable");
const { AutomationTab } = await import("./AutomationTab");
const { AutomationsSection } = await import("../bot/Automations");

const HOUR = 3_600_000;
const row = (fields: Partial<AutomationTableRow> & Pick<AutomationTableRow, "id" | "kind" | "name">): AutomationTableRow => ({
  when: "Daily 09:00", lastRunAt: Date.now() - 2 * HOUR, lastRun: "ok", status: "paused", inBb: false, readOnly: false,
  bb: null, threadId: null, instruction: null, script: null, via: "studio", ...fields,
});
const table = (rows: AutomationTableRow[], fields: Partial<AutomationTable> = {}): AutomationTable => ({ botId: "bot_main", mirrored: false, bbPlugin: "on", rows, ...fields });
const view = (id: string, kind: string, name: string) => ({ id, kind, name, original: false, bbIds: [], instruction: "Write today's card.", schedule: { type: "times", days: [0], times: ["07:45"] }, scheduleText: "", state: "paused", nextRunAt: null, lastRunAt: null, lastOutcome: null, model: null, script: null, target: "main", targetName: "Chief of Staff", threadId: null });

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.open.mockClear(); state.openLink.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(() => root.render(<AutomationsTable botId="bot_main" botName="Chief of Staff" disabled={false} external={false} />));
const renderTab = (rowId: string) => act(() => root.render(<AutomationTab params={{ id: `bot_main:${rowId}` }} />));
const rows = () => [...container.querySelectorAll<HTMLElement>("[data-testid=automation-row]")];
const open = (row: HTMLElement) => row.querySelector<HTMLButtonElement>("[data-testid=bot-page-row-open]")!.click();
const cells = (row: HTMLElement) => [row.querySelector("[data-testid=bot-page-row-title]")!.textContent! + row.querySelector("[data-testid=bot-page-row-status]")!.textContent!, ...[...row.querySelectorAll("[data-column]")].map((cell) => cell.textContent)];
const pills = () => [...container.querySelectorAll<HTMLButtonElement>("[data-testid=bot-page-pill]")];
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);

it("lists every row with its kind, when, last run and status, paused and off ones included", () => {
  state.table = table([
    row({ id: "aut_new", kind: "checkin", name: "Evening wrap-up", status: "active", when: "Weekdays 18:00", lastRunAt: null, lastRun: null }),
    row({ id: "aut_3k8tydwuck", kind: "watcher", name: "Morning card", when: "Daily 07:45" }),
    row({ id: "run_l4v5bcrvlz", kind: "runner", name: "BB Studio fork sync", when: "Daily 04:30", lastRun: "failed" }),
    row({ id: "auto_x1kt5kijizw", kind: "bb", name: "Watch bb#1085", when: "Every 6 h", status: "off", via: "primary" }),
  ]);
  render();
  expect(container.querySelector("[data-testid=page-bar]")?.textContent).toBe("Automations·Chief of Staff");
  expect([...container.querySelectorAll("[role=columnheader]")].map((th) => th.textContent)).toEqual(["Name", "Kind", "When", "Last run"]);
  expect(rows().map(cells)).toEqual([
    ["Evening wrap-upActive", "Check-in", "Weekdays 18:00", "Never"],
    ["Morning cardPaused", "Watcher", "Daily 07:45", "2h ago"],
    ["BB Studio fork syncPaused", "Runner", "Daily 04:30", "2h ago"],
    ["Watch bb#1085Off", "bb automation", "Every 6 h", "2h ago"],
  ]);
});

it("narrows by kind and by search", () => {
  state.table = table([
    row({ id: "aut_1", kind: "watcher", name: "Morning card" }),
    row({ id: "aut_2", kind: "watcher", name: "Silent heartbeat" }),
    row({ id: "run_1", kind: "runner", name: "Comms" }),
  ]);
  render();
  expect(pills().map((tab) => tab.textContent)).toEqual(["All", "Watchers", "Runners"]);
  act(() => pills().find((tab) => tab.textContent === "Runners")!.click());
  expect(rows().map((tr) => tr.dataset.automation)).toEqual(["run_1"]);
  act(() => pills().find((tab) => tab.textContent === "All")!.click());
  const search = container.querySelector<HTMLInputElement>("input[aria-label='Search automations']")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "heart"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(rows().map((tr) => tr.dataset.automation)).toEqual(["aut_2"]);
});

it("a row opens the automation through the link router: a click in the workbench, with Cmd the second pane, with Shift a window; the page has no panel of its own", () => {
  state.table = table([row({ id: "aut_3k8tydwuck", kind: "watcher", name: "Morning card" }), row({ id: "heartbeat", kind: "schedule", name: "Check-in" })]);
  render();
  const morning = rows().find((each) => each.dataset.automation === "aut_3k8tydwuck")!;
  expect(morning.getAttribute("data-row-link")).toBe("bb://automation/bot_main%3Aaut_3k8tydwuck");
  act(() => open(morning));
  expect(state.openLink).toHaveBeenLastCalledWith("bb://automation/bot_main%3Aaut_3k8tydwuck", { source: "botPage", title: "Morning card", modifiers: { meta: false, ctrl: false, shift: false } });
  act(() => { morning.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://automation/bot_main%3Aaut_3k8tydwuck", expect.objectContaining({ modifiers: { meta: true, ctrl: false, shift: false } }));
  act(() => { morning.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://automation/bot_main%3Aaut_3k8tydwuck", expect.objectContaining({ modifiers: { meta: false, ctrl: false, shift: true } }));
  expect(morning.dataset.selected).toBe("true");
  state.tabs = { open: true, selectedKey: "k2", tabs: [{ key: "k1", detail: { kind: "info" } }, { key: "k2", detail: { kind: "plugin", pluginId: "studio", tab: { id: "automation" }, params: { id: "bot_main:heartbeat" } } }] };
  render();
  expect(rows().filter((each) => each.dataset.selected === "true").map((each) => each.dataset.automation)).toEqual(["heartbeat"]);
  state.tabs = null;
  expect(container.querySelector("[data-testid=bot-page-detail], [data-fork-card=secondary-panel], [data-testid=automation-detail]")).toBeNull();
  expect(state.open).not.toHaveBeenCalled();
});

it("the automation tab shows a Studio automation's own detail, with its actions", () => {
  state.table = table([row({ id: "aut_3k8tydwuck", kind: "watcher", name: "Morning card" })]);
  state.views = [view("aut_3k8tydwuck", "checkin", "Morning card")];
  renderTab("aut_3k8tydwuck");
  expect(container.querySelector("[data-testid=automation-tab] [data-testid=automation-detail]")?.textContent).toContain("Write today's card.");
  expect(container.querySelector("[data-testid=bot-item-title]")?.textContent).toBe("Morning card");
  expect(Object.fromEntries([...container.querySelectorAll("[data-testid=bot-item-facts] dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]))).toMatchObject({ Kind: "Watcher", Status: "Paused", When: "Daily 09:00" });
  expect(buttons()).toEqual(expect.arrayContaining(["Resume", "Run now", "Edit", "Delete"]));
  state.views = [];
});

it("on a mirrored install, the page shows what runs in bb as Paused · in bb and its tab is read-only", () => {
  state.table = table([
    row({ id: "aut_3k8tydwuck", kind: "watcher", name: "Morning card", inBb: true, readOnly: true, script: "./card.sh", threadId: "thr_demo000022" }),
    row({ id: "auto_x1kt5kijizw", kind: "bb", name: "Watch bb#1085", inBb: true, readOnly: true, bb: { id: "auto_x1kt5kijizw", projectId: "proj_y6wu7yah45" }, instruction: "Watch the issue.", via: "primary" }),
  ], { mirrored: true, bbPlugin: "off" });
  state.views = [view("aut_3k8tydwuck", "watcher", "Morning card")];
  render();
  expect(rows().map((tr) => tr.querySelector("[data-testid=bot-page-row-status]")?.textContent)).toEqual(["Paused · in bb", "Paused · in bb"]);
  renderTab("aut_3k8tydwuck");
  expect(container.querySelector("[data-testid=automation-read-only]")?.textContent).toContain("./card.sh");
  expect(buttons().filter((text) => ["Resume", "Pause", "Run now", "Edit", "Delete", "Take over", "Open in bb"].includes(text ?? ""))).toEqual([]);
  act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Thread")!.click());
  expect(state.openThread).toHaveBeenCalledWith("thr_demo000022");
  renderTab("auto_x1kt5kijizw");
  expect(container.querySelector("[data-testid=automation-read-only]")?.textContent).toContain("Watch the issue.");
  state.views = [];
});

it("a bb automation's tab opens bb's own automation page while bb's automations plugin is on", () => {
  state.table = table([row({ id: "auto_x1kt5kijizw", kind: "bb", name: "Watch bb#1085", bb: { id: "auto_x1kt5kijizw", projectId: "proj_y6wu7yah45" }, via: "primary" })]);
  renderTab("auto_x1kt5kijizw");
  act(() => container.querySelector<HTMLButtonElement>("[data-testid=automation-open-bb]")!.click());
  expect(state.open).toHaveBeenCalledWith("/plugins/automations/automations/proj_y6wu7yah45/auto_x1kt5kijizw");
});

it("a deleted automation's tab says Automation deleted, with no raw id or link; a malformed link still says Not found", () => {
  state.table = table([]);
  renderTab("aut_gone");
  expect(container.querySelector("[data-testid=automation-deleted]")?.textContent).toBe("Automation deleted");
  expect(container.querySelector("[data-testid=link-not-found]")).toBeNull();
  expect(container.textContent).not.toContain("bb://automation");
  act(() => root.render(<AutomationTab params={{ id: "no-bot" }} />));
  expect(container.querySelector("[data-testid=link-not-found]")).not.toBeNull();
});

it("words status and last run", () => {
  expect(statusText({ status: "paused", inBb: true })).toBe("Paused · in bb");
  expect(statusText({ status: "paused", inBb: false })).toBe("Paused");
  expect(statusText({ status: "off", inBb: false })).toBe("Off");
  expect(lastRunText({ lastRunAt: null })).toBe("Never");
});

it("leaves what runs in bb out of the Bot page's week, and keeps what was made here", () => {
  state.views = [{ ...view("aut_old", "watcher", "Morning card"), inBb: true }, { ...view("aut_new", "checkin", "Evening"), state: "active" }, view("aut_paused", "checkin", "Paused here")];
  act(() => root.render(<AutomationsSection botId="bot_main" botName="Chief of Staff" onOpen={() => {}} disabled={false} page />));
  expect(state.calendar?.map((each) => each.id)).toEqual(["aut_new", "aut_paused"]);
  state.views = [];
});

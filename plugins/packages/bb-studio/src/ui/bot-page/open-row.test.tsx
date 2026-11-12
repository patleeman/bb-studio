// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openLink: vi.fn(async (_link: string, _options: unknown) => ({ via: "workbench" })), openPath: vi.fn(), tabs: null as unknown }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_usePanelTabs: () => state.tabs }));
vi.mock("../../links/open", () => ({ openLinkFromAnywhere: state.openLink, clickModifiers: (event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => ({ meta: !!event?.metaKey, ctrl: !!event?.ctrlKey, shift: !!event?.shiftKey }) }));
vi.mock("../../kit/app/nav", () => ({ openAppPath: state.openPath }));
vi.mock("../../kit/ui/icon", () => ({ Icon: () => null }));

const { BotPageRow } = await import("./BotPageRow");
const { focusClosedRow, openLinksOf, rowLink, useRowOpen } = await import("./open-row");

const plugin = (key: string, tabId: string, params: Record<string, string>) => ({ key, detail: { kind: "plugin", pluginId: "studio", tab: { id: tabId }, params } });
const TODO = "bb://todo/loop_1";

function Rows() {
  const rowOpen = useRowOpen();
  return <>
    <BotPageRow testId="todo" title="Pay the bill" {...rowOpen({ kind: "todo", id: "loop_1" }, "Pay the bill")} />
    <BotPageRow testId="thread" title="Trip" {...rowOpen({ kind: "conversation", id: "thr_1" }, "Trip")} />
    <BotPageRow testId="file" title="Plan" {...rowOpen("/plugins/studio/studio/pages/pg_0123456789abcdef", "Plan")} />
    <BotPageRow testId="other" title="Other" {...rowOpen("/plugins/other/thing", "Other")} />
  </>;
}

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.openLink.mockClear(); state.openPath.mockClear(); state.tabs = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = () => act(() => root.render(<Rows />));
const row = (id: string) => container.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
const selected = () => [...container.querySelectorAll<HTMLElement>("[data-selected]")].map((each) => each.dataset.testid);

it("every row opens through the link router with its canonical link, its title and the click's modifiers; Enter on a focused row is a click", () => {
  render();
  expect(["todo", "thread", "file", "other"].map((id) => row(id).getAttribute("data-row-link"))).toEqual([TODO, "bb://conversation/thr_1", "bb://page/pg_0123456789abcdef", "/plugins/other/thing"]);
  act(() => row("todo").querySelector("button")!.click());
  expect(state.openLink).toHaveBeenLastCalledWith(TODO, { source: "botPage", title: "Pay the bill", modifiers: { meta: false, ctrl: false, shift: false } });
  act(() => { row("thread").querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_1", { source: "botPage", title: "Trip", modifiers: { meta: true, ctrl: false, shift: false } });
  act(() => { row("file").querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })); });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_0123456789abcdef", { source: "botPage", title: "Plan", modifiers: { meta: false, ctrl: false, shift: true } });
  expect(row("todo").querySelector("button")!.tagName).toBe("BUTTON");
  expect(row("todo").querySelector("button")!.getAttribute("type")).toBe("button");
  act(() => row("other").querySelector("button")!.click());
  expect(state.openPath).toHaveBeenCalledWith("/plugins/other/thing");
  expect(state.openLink).toHaveBeenCalledTimes(3);
  expect(row("todo").getAttribute("draggable")).toBe("true");
});

it("highlights the row whose item is the workbench's selected tab, and the row clicked last where the host lists no tabs", () => {
  render();
  expect(selected()).toEqual([]);
  act(() => row("todo").querySelector("button")!.click());
  expect(selected()).toEqual(["todo"]);
  state.tabs = { open: true, selectedKey: "b", tabs: [plugin("a", "todo", { id: "loop_1" }), plugin("b", "thread", { threadId: "thr_1" }), { key: "c", detail: { kind: "info" } }] };
  render();
  expect(selected()).toEqual(["thread"]);
  state.tabs = { open: true, selectedKey: null, tabs: [] };
  render();
  expect(selected()).toEqual([]);
  act(() => row("file").querySelector("button")!.click());
  state.tabs = { open: false, selectedKey: null, tabs: [] };
  render();
  expect(selected()).toEqual(["file"]);
  expect(openLinksOf({ open: true, selectedKey: "x", tabs: [plugin("x", "automation", { id: "bot_main:heartbeat" }), plugin("y", "memory-record", { id: "mem_1" })] })).toEqual({ open: ["bb://automation/bot_main%3Aheartbeat", "bb://record/mem_1"], selected: "bb://automation/bot_main%3Aheartbeat" });
  expect(rowLink("/threads/thr_9")).toEqual({ link: "bb://conversation/thr_9", ref: { kind: "conversation", id: "thr_9" } });
});

it("closing an item's tab returns focus to its row, unless focus is somewhere else", () => {
  state.tabs = { open: true, selectedKey: "a", tabs: [plugin("a", "todo", { id: "loop_1" })] };
  render();
  expect(document.activeElement).toBe(document.body);
  state.tabs = { open: true, selectedKey: null, tabs: [] };
  render();
  expect(document.activeElement).toBe(row("todo").querySelector("button"));
  const field = document.createElement("input"); document.body.append(field); field.focus();
  expect(focusClosedRow([TODO])).toBe(false);
  expect(document.activeElement).toBe(field);
  field.remove();
  expect(focusClosedRow(["bb://todo/loop_other"])).toBe(false);
});

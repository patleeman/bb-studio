// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { botPageTitle, noteBotName, PageBar, useStudioPageTitle } from "./page-bar";

const tab = vi.hoisted(() => ({ window: null as null | { title: string; toolbar: HTMLElement | null } }));
vi.mock("../kit/app/host-sdk", async (original) => ({ ...await original<typeof import("../kit/app/host-sdk")>(), useHostTabWindow: () => tab.window }));

let root: Root;
let pane: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pane = document.createElement("div");
  document.body.append(pane);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); tab.window = null; });

it("puts the page's title row in BB's title bar, so the page shows one header row", async () => {
  // BB's plugin page: its title row (the panel's label, then the slot Studio's headerContent draws), then the page.
  pane.innerHTML = '<header data-testid="app-page-header-content-row"><div id="history"></div><div id="label">Library / Memory</div><div><div data-bb-plugin-root=""><div data-studio-bar-slot=""></div></div></div></header><div id="body"></div>';
  root = createRoot(pane.querySelector("#body")!);
  await act(async () => { root.render(<PageBar icon="◈" title="Memory" detail="Chief of Staff" actions={<button type="button">＋ Add a record</button>} />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  const bar = pane.querySelector('header [data-testid="page-bar"]');
  expect(bar?.textContent).toBe("◈Memory·Chief of Staff＋ Add a record");
  expect(pane.querySelectorAll('[data-testid="page-bar"]')).toHaveLength(1);
  expect(pane.querySelector("#body")?.textContent).toBe("");
  // The panel's own label ("Library / Memory") is hidden by the bar's style; BB's back and forward ahead of it stay.
  expect(pane.querySelector("#label")?.hasAttribute("data-studio-bar-label")).toBe(true);
  expect(pane.querySelector("#history")?.hasAttribute("data-studio-bar-label")).toBe(false);
});

it("where BB lends no title bar, the same single row sits at the top of the page", async () => {
  root = createRoot(pane);
  await act(async () => { root.render(<PageBar title="Library" detail="Chief of Staff's files · made by the Bot and its workers" />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(pane.querySelectorAll('[data-testid="page-bar"]')).toHaveLength(1);
  expect(pane.querySelector('[data-testid="page-bar-title"]')?.textContent).toBe("Library");
});

it("in a tab's own window, the window bar has the title: the page draws no title row and puts its actions in the bar", async () => {
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  tab.window = { title: "Memory", toolbar };
  root = createRoot(pane);
  await act(async () => { root.render(<PageBar title="Memory" detail="Chief of Staff" actions={<button type="button">New</button>} />); });
  expect(pane.textContent).toBe("");
  expect(document.querySelector('[data-testid="page-bar-title"]')).toBeNull();
  expect(toolbar.querySelector('[data-testid="page-bar"]')?.textContent).toBe("New");
  expect(toolbar.querySelector('[data-testid="page-bar"]')?.hasAttribute("data-bb-plugin-root")).toBe(true);
  await act(async () => { root.render(<PageBar title="Memory" detail="Chief of Staff" />); });
  expect(toolbar.textContent).toBe("");
  expect(pane.textContent).toBe("");
});

it("titles the window by the Bot's page, and leaves the Library's own title alone", () => {
  expect(botPageTitle("memory/bot_main")).toEqual({ title: "Memory", windowTitle: "Memory" });
  expect(botPageTitle("conversations")).toEqual({ title: "Archive", windowTitle: "Archive" });
  expect(botPageTitle("conversations/bot_main")).toEqual({ title: "Archive", windowTitle: "Archive" });
  // Todos is under the Bot page: its header named the Library before.
  expect(botPageTitle("bot/bot_main/loops")).toEqual({ title: "Todos", windowTitle: "Todos" });
  expect(botPageTitle("/bot/bot_main/loops/")).toEqual({ title: "Todos", windowTitle: "Todos" });
  expect(botPageTitle("bot/bot_main")).toBeNull();
  expect(botPageTitle("bot/new")).toEqual({ title: "New Bot", windowTitle: "New Bot" });
  expect(botPageTitle("")).toBeNull();
  expect(botPageTitle("pages/pg_1")).toBeNull();
  expect(botPageTitle("automation/auto_1")).toEqual({ title: "Automation", windowTitle: "Automation" });
  expect(botPageTitle("todo/loop_1")).toEqual({ title: "Todo", windowTitle: "Todo" });
  expect(botPageTitle("record/rec_1")).toEqual({ title: "Memory record", windowTitle: "Memory record" });
  expect(botPageTitle("automation")).toBeNull();
});

it("titles a Bot's Info page with the Bot's name once its page tells it", async () => {
  const seen: (string | null)[] = [];
  function Probe({ subPath }: { subPath: string }) {
    seen.push(useStudioPageTitle({ subPath })?.title ?? null);
    return null;
  }
  const host = document.createElement("div");
  const probeRoot = createRoot(host);
  await act(async () => { probeRoot.render(<Probe subPath="bot/bot_t10" />); });
  expect(seen.at(-1)).toBe("Bot");
  await act(async () => { noteBotName("bot_t10", "Chief of Staff"); });
  expect(seen.at(-1)).toBe("Chief of Staff");
  await act(async () => { probeRoot.render(<Probe subPath="bot/new" />); });
  expect(seen.at(-1)).toBe("New Bot");
  await act(async () => { probeRoot.render(<Probe subPath="memory/bot_t10" />); });
  expect(seen.at(-1)).toBe("Memory");
  await act(async () => { probeRoot.unmount(); });
});

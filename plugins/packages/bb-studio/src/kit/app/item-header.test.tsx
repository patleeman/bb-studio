// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarCrumb, BarSeparator, ItemHeader, OpenInSplitButton, StudioBar, StudioBarSlot } from "./item-header";
import { StudioContainerProvider } from "./container";

const state = vi.hoisted(() => ({
  split: vi.fn(),
  openTab: vi.fn((_options: unknown) => true),
  toCompose: vi.fn(),
  host: null as null | Record<"open" | "start" | "choose" | "unlink" | "watch", (...args: unknown[]) => unknown>,
  home: null as { threadId: string; title: string; origin: "chosen" } | null,
  globalWorkbench: false,
  tabWindow: null as null | { title: string; toolbar: HTMLElement | null },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => ({ toCompose: state.toCompose }),
  experimental_useAppPanel: () => ({ openTab: state.openTab }),
  useRpc: () => ({ call: async () => ({ failed: [] }) }),
}));
vi.mock("./item-chat", () => ({ useHomeThread: () => state.home, useItemChat: () => state.host }));
vi.mock("./host-sdk", async (original) => ({ ...await original<typeof import("./host-sdk")>(), get hasGlobalWorkbench() { return state.globalWorkbench; }, useHostTabWindow: () => state.tabWindow }));
vi.mock("./item-window", () => ({ OpenInWindowMenuItem: () => null }));
vi.mock("./move", () => ({ useOpenTarget: () => ({ open: state.split, anchor: null }) }));
vi.mock("../ui/icon", () => ({ Icon: () => null }));

const launch = { title: "Launch", href: "/plugins/pages/pages/launch" };
function Harness() {
  return <ItemHeader backLabel="Studio" onBack={() => {}} item={launch} />;
}

let root: Root;
let container: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const menu = async () => {
  await act(async () => {
    document.querySelector('[aria-label="More"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    await settle();
  });
};
const entries = () => [...document.querySelectorAll('[role="menuitem"]')].map((element) => element.textContent?.trim());
const pick = async (label: string) => {
  const entry = [...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.trim() === label) as HTMLElement;
  await act(async () => { entry.click(); await settle(); });
};
const newThread = () => container.querySelector<HTMLButtonElement>('[aria-label="New thread about this"]');

beforeEach(async () => {
  state.split.mockClear();
  state.openTab.mockReset().mockReturnValue(true);
  state.toCompose.mockClear();
  state.host = { open: vi.fn(), start: vi.fn(), choose: vi.fn(), unlink: vi.fn(async () => {}), watch: vi.fn() };
  state.home = null;
  state.globalWorkbench = false;
  state.tabWindow = null;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Open in split", () => {
  const target = { title: "Draft", href: "/plugins/studio/chats/draft/one" };
  it("opens the view's exact route in a split", async () => {
    await act(async () => root.render(<OpenInSplitButton item={target} />));
    await act(async () => { (container.querySelector('[aria-label="Open in split"]') as HTMLElement).click(); });
    expect(state.split).toHaveBeenCalledWith({ kind: "path", path: target.href, title: target.title }, "split");
  });
});

describe("Item tools", () => {
  it("keeps accessory state mounted while a narrow header opens, closes, and widens", async () => {
    const width = window.innerWidth;
    const resize = (value: number) => { Object.defineProperty(window, "innerWidth", { configurable: true, value }); window.dispatchEvent(new Event("resize")); };
    try {
      await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={launch} trailing={<input aria-label="Accessory draft" defaultValue="Keep me" />} />));
      const input = container.querySelector("input")!;
      input.value = "Edited accessory draft";
      await act(async () => resize(390));
      const actions = container.querySelector<HTMLElement>('[data-studio-item-actions]')!;
      expect(actions.style.display).toBe("none");
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Item actions"]')!;
      await act(async () => trigger.click());
      expect(actions.style.display).toBe("");
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(actions.style.display).toBe("none");
      expect(document.activeElement).toBe(trigger);
      await act(async () => resize(900));
      expect(container.querySelector("input")).toBe(input);
      expect(input.value).toBe("Edited accessory draft");
      expect(actions.style.display).toBe("");
      expect(container.querySelector('button[aria-label="Item actions"]')).toBeNull();
    } finally { await act(async () => resize(width)); }
  });
  it("has no Chat button: the way back, a new thread, Open in split and the menu", () => {
    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent?.trim() || button.getAttribute("aria-label"));
    expect(labels).toEqual(["Studio", "New thread about this", "Open in split", "More"]);
    expect(container.textContent).not.toContain("Chat");
  });
  it("names a built-in kind's item by its own namespace, not Studio's panel", async () => {
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={{ title: "Flow", href: "/plugins/studio/studio/drawings/d1" }} />));
    expect(newThread()?.getAttribute("data-studio-item-thread")).toBe("excalidraw:d1");
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={{ title: "Studio", href: "/plugins/studio/studio/unknown/x" }} />));
    expect(newThread()).toBeNull();
  });
  it("leaves a view's own menu alone", async () => {
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={launch} trailing={<button>Own menu</button>} />));
    expect(container.querySelector('[aria-label="More"]')).toBeNull();
    expect(newThread()).not.toBeNull();
  });
});

describe("New thread about an item", () => {
  const params = { pluginId: "pages", id: "launch" };
  it("opens the composer tab in the Studio page's workbench, as an ordinary tab", async () => {
    state.globalWorkbench = true;
    await act(async () => newThread()!.click());
    expect(state.openTab).toHaveBeenCalledTimes(1);
    expect(state.openTab).toHaveBeenCalledWith({ tab: { id: "item-thread", context: { kind: "nav-panel", panelId: "studio" }, availability: "action" }, params, title: "New thread" });
    expect(state.host!.start).not.toHaveBeenCalled();
    expect(state.toCompose).not.toHaveBeenCalled();
  });
  it("opens it in the thread's own workbench from a thread", async () => {
    await act(async () => root.render(<StudioContainerProvider value={{ kind: "thread", threadId: "thr_1" }}><Harness /></StudioContainerProvider>));
    await act(async () => newThread()!.click());
    expect(state.openTab).toHaveBeenCalledTimes(1);
    expect(state.openTab).toHaveBeenCalledWith({ tab: { id: "item-thread", context: { kind: "thread" }, availability: "action" }, params, title: "New thread" });
  });
  it("with no workbench beside the item, opens the composer as before", async () => {
    state.openTab.mockReturnValue(false);
    await act(async () => newThread()!.click());
    expect(state.host!.start).toHaveBeenCalledWith(params);
    expect(state.toCompose).not.toHaveBeenCalled();
    state.host = null;
    await act(async () => root.render(<Harness />));
    await act(async () => newThread()!.click());
    expect(state.toCompose).toHaveBeenCalledWith({ initialPrompt: "[Launch](/plugins/pages/pages/launch) ", focusPrompt: true });
  });
});

describe("Linked thread in the item menu", () => {
  it("offers only linking while the item has no thread", async () => {
    await menu();
    expect(entries()).toEqual(["Copy reference", "Link a thread…"]);
    await pick("Link a thread…");
    expect(state.host!.choose).toHaveBeenCalledWith({ pluginId: "pages", id: "launch" });
  });
  it("opens, relinks and unlinks a linked thread", async () => {
    state.home = { threadId: "thr_9", title: "Launch plan", origin: "chosen" };
    await menu();
    expect(entries()).toEqual(["Copy reference", "Open “Launch plan”", "Link another thread…", "Unlink thread"]);
    await pick("Open “Launch plan”");
    expect(state.host!.open).toHaveBeenCalledWith({ pluginId: "pages", id: "launch" });
    await menu();
    await pick("Unlink thread");
    expect(state.host!.unlink).toHaveBeenCalledWith({ pluginId: "pages", id: "launch" });
  });
  it("draws no thread entries until Studio's item chat is up", async () => {
    state.host = null;
    await act(async () => root.render(<Harness />));
    await menu();
    expect(entries()).toEqual(["Copy reference"]);
  });
});

describe("Studio bar in BB's title bar", () => {
  it("marks the title bar it fills, without :has(), and unmarks it when it goes", async () => {
    // BB's pane: a header row whose last div holds the plugin's slot, then the view.
    const pane = document.createElement("div");
    pane.innerHTML = '<header><div data-testid="app-page-header-content-row"><div>Label</div><div class="[app-region:no-drag]"><div data-bb-plugin-root></div></div></div></header><main></main>';
    document.body.append(pane);
    const slotRoot = createRoot(pane.querySelector("[data-bb-plugin-root]")!), viewRoot = createRoot(pane.querySelector("main")!);
    await act(async () => { slotRoot.render(<StudioBarSlot />); viewRoot.render(<StudioBar>Crumbs</StudioBar>); await settle(); });
    const row = pane.querySelector('[data-testid="app-page-header-content-row"]')!;
    expect(pane.querySelector("[data-studio-bar-slot] [data-studio-bar]")?.textContent).toBe("Crumbs");
    expect(row.hasAttribute("data-studio-bar-row")).toBe(true);
    expect(row.children[0]!.hasAttribute("data-studio-bar-label")).toBe(true);
    expect(row.children[1]!.hasAttribute("data-studio-bar-drag")).toBe(true);
    expect(row.children[1]!.hasAttribute("data-studio-bar-fill")).toBe(true);
    expect(pane.querySelector("[data-bb-plugin-root]")!.hasAttribute("data-studio-bar-fill")).toBe(true);
    expect(pane.querySelector("style")!.textContent).not.toContain(":has(");
    await act(async () => viewRoot.unmount());
    expect(pane.querySelectorAll("[data-studio-bar-row], [data-studio-bar-label], [data-studio-bar-drag], [data-studio-bar-fill]")).toHaveLength(0);
    await act(async () => slotRoot.unmount());
    pane.remove();
  });

  it("hides the panel's label, not the back and forward buttons BB puts ahead of it", async () => {
    // The fork's header: back/forward first, then the label ("Library / Todos"), then the actions holding the slot.
    const pane = document.createElement("div");
    pane.innerHTML = '<header><div data-testid="app-page-header-content-row"><div id="history"><button>Back</button></div><div id="label">Library / Todos</div><div class="[app-region:no-drag]"><div id="actions"><div data-bb-plugin-root></div><div data-plugin-right-panel-toggle-portal></div></div><span id="reserve"></span></div></div></header><main></main>';
    document.body.append(pane);
    const slotRoot = createRoot(pane.querySelector("[data-bb-plugin-root]")!), viewRoot = createRoot(pane.querySelector("main")!);
    await act(async () => { slotRoot.render(<StudioBarSlot />); viewRoot.render(<StudioBar>Todos</StudioBar>); await settle(); });
    expect(pane.querySelector("#label")!.hasAttribute("data-studio-bar-label")).toBe(true);
    expect(pane.querySelector("#history")!.hasAttribute("data-studio-bar-label")).toBe(false);
    expect(pane.querySelector("#actions")!.hasAttribute("data-studio-bar-fill")).toBe(true);
    expect(pane.querySelector("#reserve")!.hasAttribute("data-studio-bar-fill")).toBe(false);
    await act(async () => { viewRoot.unmount(); slotRoot.unmount(); });
    pane.remove();
  });

  it("leaves the title bar while its retained view is set aside, and returns with it", async () => {
    const pane = document.createElement("div");
    pane.innerHTML = '<header><div data-testid="app-page-header-content-row"><div>Label</div><div><div data-bb-plugin-root></div></div></div></header><main></main>';
    const parking = document.createElement("div");
    document.body.append(pane, parking);
    const view = document.createElement("div");
    pane.querySelector("main")!.append(view);
    const slotRoot = createRoot(pane.querySelector("[data-bb-plugin-root]")!), viewRoot = createRoot(view);
    await act(async () => { slotRoot.render(<StudioBarSlot />); viewRoot.render(<StudioBar>Release notes</StudioBar>); await settle(); });
    const inTitleBar = () => pane.querySelector("[data-studio-bar-slot] [data-studio-bar]")?.textContent ?? null;
    expect(inTitleBar()).toBe("Release notes");
    await act(async () => { parking.append(view); await settle(); });
    expect(inTitleBar()).toBeNull();
    await act(async () => { pane.querySelector("main")!.append(view); await settle(); });
    expect(inTitleBar()).toBe("Release notes");
    await act(async () => { viewRoot.unmount(); slotRoot.unmount(); });
    pane.remove(); parking.remove();
  });
});

it("keeps workspace editor toolbars inside each editor instead of sharing the app header", async () => {
  const pane = document.createElement("div");
  pane.innerHTML = '<header><div data-studio-bar-slot></div></header><main data-studio-workspace-editor></main>';
  document.body.append(pane);
  const root = createRoot(pane.querySelector("main")!);
  await act(async () => { root.render(<StudioBar>Page tools</StudioBar>); await settle(); });
  expect(pane.querySelector("header")!.textContent).toBe("");
  expect(pane.querySelector("main [data-studio-bar]")!.textContent).toBe("Page tools");
  await act(async () => root.unmount());
  pane.remove();
});

it("uses its workspace tab's slot in the tab row, never the app's slot", async () => {
  const pane = document.createElement("div");
  pane.innerHTML = '<header><div data-studio-bar-slot></div></header><nav><div data-studio-workspace-bar="one"></div></nav><section data-studio-workspace-frame="one"><main data-studio-workspace-editor></main></section>';
  document.body.append(pane);
  const root = createRoot(pane.querySelector("main")!);
  await act(async () => { root.render(<ItemHeader backLabel="Studio" onBack={() => {}} leading="Release notes" trailing="Page tools" />); await settle(); });
  expect(pane.querySelector(":scope > header")!.textContent).toBe("");
  const bar = pane.querySelector("[data-studio-workspace-bar]")!;
  expect(bar.textContent).toContain("Page tools");
  // No way back from a tab; the view's own crumbs stay.
  expect(bar.querySelector('[title="Back to Studio"]')).toBeNull();
  expect(bar.querySelector("nav")!.textContent).toBe("Release notes");
  await act(async () => root.unmount()); pane.remove();
});

it("leaves a view's crumbs to the tab, keeping its status", async () => {
  const pane = document.createElement("div");
  pane.innerHTML = '<nav><div data-studio-workspace-bar="one"></div></nav><section data-studio-workspace-frame="one"><main data-studio-workspace-editor></main></section>';
  document.body.append(pane);
  const root = createRoot(pane.querySelector("main")!);
  await act(async () => { root.render(<ItemHeader backLabel="Studio" onBack={() => {}} leading={<><BarCrumb onClick={() => {}}>Parent</BarCrumb><BarSeparator /><BarCrumb current>Release notes</BarCrumb><span>Paused</span></>} />); await settle(); });
  expect(pane.querySelector("[data-studio-workspace-bar] nav")!.textContent).toBe("Paused");
  await act(async () => root.unmount()); pane.remove();
});

it("in a tab's own window, leaves the title to the window bar and puts its tools there", async () => {
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  state.tabWindow = { title: "Release notes", toolbar };
  await act(async () => { root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={launch} leading={<><BarCrumb onClick={() => {}}>Parent</BarCrumb><BarSeparator /><BarCrumb current>Release notes</BarCrumb><span>Paused</span></>} trailing={<button type="button">Page tools</button>} />); await settle(); });
  expect(container.textContent).toBe("");
  expect(toolbar.querySelector('[title="Back to Studio"]')).toBeNull();
  expect(toolbar.querySelector("nav")!.textContent).toBe("Paused");
  expect(toolbar.textContent).toContain("Page tools");
  expect(toolbar.querySelector('[aria-label="New thread about this"]')).not.toBeNull();
  expect(toolbar.querySelector('[aria-label="Open in split"]')).toBeNull();
  await act(async () => root.render(<ItemHeader inline backLabel="Studio" onBack={() => {}} item={launch} leading={<BarCrumb current>Detail</BarCrumb>} />));
  expect(container.querySelector('[title="Back to Studio"]')).not.toBeNull();
  expect(container.textContent).toContain("Detail");
  toolbar.remove();
});

describe("Star", () => {
  it("shows the item's star from Studio's host, and toggles it", async () => {
    const { setItemStarHost } = await import("./item-star");
    const starred = new Set<string>();
    const set = vi.fn(async (ref: { pluginId: string; id: string }, star: boolean) => { if (star) starred.add(`${ref.pluginId}:${ref.id}`); else starred.delete(`${ref.pluginId}:${ref.id}`); });
    const page = { title: "Round outline", href: "/plugins/pages/pages/pg_round" };
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={page} />));
    // No host yet: no star.
    expect(container.querySelector("[data-studio-star]")).toBeNull();
    let clear = () => {};
    await act(async () => { clear = setItemStarHost({ starred: (ref) => starred.has(`${ref.pluginId}:${ref.id}`), set }); });
    const button = () => container.querySelector<HTMLButtonElement>('[data-studio-star="pages:pg_round"]')!;
    expect(button().getAttribute("aria-label")).toBe("Star");
    expect(button().getAttribute("aria-pressed")).toBe("false");
    await act(async () => { button().click(); });
    expect(set).toHaveBeenCalledWith({ pluginId: "pages", id: "pg_round" }, true);
    // The host tells headers when stars change.
    const { itemStarsChanged } = await import("./item-star");
    await act(async () => itemStarsChanged());
    expect(button().getAttribute("aria-label")).toBe("Unstar");
    expect(button().getAttribute("aria-pressed")).toBe("true");
    await act(async () => clear());
    expect(container.querySelector("[data-studio-star]")).toBeNull();
  });
});

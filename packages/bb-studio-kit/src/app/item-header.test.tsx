// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemHeader, OpenInSplitButton, StudioBar, StudioBarSlot } from "./item-header";

const state = vi.hoisted(() => ({ launch: null as ((mode: string) => void) | null, split: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toCompose: () => {} }) }));
vi.mock("./item-chat", () => ({
  useHomeThread: () => null,
  useItemChat: () => ({
    open: () => state.launch?.("compose"),
    start: () => state.launch?.("compose"),
    choose: () => state.launch?.("choose"),
  }),
}));
vi.mock("./presence", () => ({ useStudioChatPresent: () => true, useStudioPresent: () => true }));
vi.mock("./move", () => ({ useOpenTarget: () => ({ open: state.split, anchor: null }) }));
vi.mock("./related-panel", () => ({ RelatedPanel: () => null }));
vi.mock("../ui/icon", () => ({ Icon: () => null }));

function Dialog({ mode, close }: { mode: string; close(): void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return <input aria-label={mode} ref={input} onBlur={close} />;
}

function Harness() {
  const [mode, setMode] = useState<string | null>(null);
  state.launch = setMode;
  return <>
    <ItemHeader backLabel="Studio" onBack={() => {}} item={{ title: "Launch", href: "/plugins/pages/pages/launch" }} />
    {mode ? <Dialog mode={mode} close={() => setMode(null)} /> : null}
  </>;
}

let root: Root;
let container: HTMLDivElement;
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const menu = async () => {
  await act(async () => {
    document.querySelector('[aria-label="Chat options"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
    await settle();
  });
};

beforeEach(async () => {
  state.split.mockClear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); state.launch = null; });

describe("Open in split", () => {
  const target = { title: "Draft", href: "/plugins/studio/chats/draft/one" };
  it("opens the view's exact route in a split", async () => {
    await act(async () => root.render(<OpenInSplitButton item={target} />));
    await act(async () => { (container.querySelector('[aria-label="Open in split"]') as HTMLElement).click(); });
    expect(state.split).toHaveBeenCalledWith({ kind: "path", path: target.href, title: target.title }, "split");
  });
});

describe("Chat menu focus", () => {
  it("keeps Chat visible and accessory state mounted while a narrow header opens, closes, and widens", async () => {
    const width = window.innerWidth;
    const resize = (value: number) => { Object.defineProperty(window, "innerWidth", { configurable: true, value }); window.dispatchEvent(new Event("resize")); };
    try {
      await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={{ title: "Launch", href: "/plugins/pages/pages/launch" }} trailing={<input aria-label="Accessory draft" defaultValue="Keep me" />} />));
      const input = container.querySelector("input")!;
      input.value = "Edited accessory draft";
      await act(async () => resize(390));
      const actions = container.querySelector<HTMLElement>('[data-studio-item-actions]')!;
      expect(actions.style.display).toBe("none");
      expect(container.querySelector('[data-studio-chat-item]')?.closest('[data-studio-item-actions]')).toBeNull();
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
  it("lets a conversation-owning view supply one Chat action or opt out", async () => {
    const item = { title: "Atlas", href: "/plugins/bot-teams/bots/atlas" };
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={item} chatAction={<button>Chat with Atlas</button>} />));
    const labels = () => [...container.querySelectorAll("button")].map((button) => button.textContent?.trim() || button.getAttribute("aria-label"));
    expect(labels()).toEqual(["Studio", "Chat with Atlas", "Open in split"]);
    expect(container.querySelector('[data-studio-chat-item]')).toBeNull();
    await act(async () => root.render(<ItemHeader backLabel="Studio" onBack={() => {}} item={item} chatAction={null} />));
    expect(labels()).toEqual(["Studio", "Open in split"]);
  });
  it("shows the way back, the item's Chat and Open in split", () => {
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Studio")).toBe(true);
    expect(container.querySelector('[data-studio-chat-item="pages:launch"] > button')?.textContent?.trim()).toBe("Chat");
    expect(container.querySelector('[aria-label="Open in split"]')).not.toBeNull();
  });
  it.each([["New conversation", "compose"], ["Choose conversation…", "choose"]])("keeps %s focused after the menu closes", async (label, mode) => {
    await menu();
    const entry = [...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.trim() === label) as HTMLElement;
    expect(entry).toBeDefined();
    await act(async () => { entry.click(); await settle(); });
    expect(document.activeElement).toBe(document.querySelector(`[aria-label="${mode}"]`));
    expect(document.querySelector(`[aria-label="${mode}"]`)).not.toBeNull();
  });

  it("restores focus to Chat options when the menu is dismissed", async () => {
    await menu();
    await act(async () => {
      document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await settle();
    });
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Chat options"]'));
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
    expect(row.children[1]!.hasAttribute("data-studio-bar-drag")).toBe(true);
    expect(pane.querySelector("[data-bb-plugin-root]")!.hasAttribute("data-studio-bar-root")).toBe(true);
    expect(pane.querySelector("style")!.textContent).not.toContain(":has(");
    await act(async () => viewRoot.unmount());
    expect(pane.querySelectorAll("[data-studio-bar-row], [data-studio-bar-drag], [data-studio-bar-root]")).toHaveLength(0);
    await act(async () => slotRoot.unmount());
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

it("uses a workspace editor's own header slot, never the app's slot", async () => {
  const pane = document.createElement("div");
  pane.innerHTML = '<header><div data-studio-bar-slot></div></header><section data-studio-workspace-frame><header><div data-studio-bar-slot></div></header><main data-studio-workspace-editor></main></section>';
  document.body.append(pane);
  const root = createRoot(pane.querySelector("main")!);
  await act(async () => { root.render(<StudioBar>Page tools</StudioBar>); await settle(); });
  expect(pane.querySelector(":scope > header")!.textContent).toBe("");
  expect(pane.querySelector("section > header")!.textContent).toBe("Page tools");
  await act(async () => root.unmount()); pane.remove();
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  spaces: null as unknown,
  themes: [] as unknown[],
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ ok: true })),
  toast: vi.fn(),
}));
vi.mock("../../ui/live", () => ({
  useLive: (method: string) => ({ data: method === "bot_spaces" ? state.spaces : method === "themes_list" ? { themes: state.themes } : null, error: null, loading: false, refresh: () => {} }),
  useCall: () => state.call,
}));
vi.mock("sonner", () => ({ toast: { error: state.toast } }));

import { fakeWebGl } from "../../test/fake-webgl";
import { resetSidebarState } from "../../ui/conversations/state";
import { defaultAppearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { createThemeRegistry } from "../registry";
import { PreviewHub } from "./preview";
import { setThemePopoverOpen, themeChoices, toggleThemePopover } from "./quick";
import { appearanceDraft, appearanceOverrides, forgetSavedAppearance, setAppearanceDraft, shownAppearance } from "./state";
import { ThemeQuickHost } from "./ThemePopover";

let root: Root;
let host: HTMLDivElement;
let hub: PreviewHub;
const stored = [{ ...structuredClone(GRID), id: "after-dark", name: "After Dark" }, { ...structuredClone(NORD), id: "fjord", name: "Fjord" }];
const registry = createThemeRegistry(stored);
const makePreviews = () => {
  hub = new PreviewHub({ createContext: () => ({ gl: fakeWebGl().gl, canvas: document.createElement("canvas") }), paint: () => {}, requestFrame: () => 1, cancelFrame: () => {}, now: () => 0 });
  return hub;
};
const mine = { ...defaultAppearance(GRID), intensity: 0.31, glass: 0.44, motion: 0.12, effects: { workers: false, finished: true, needsYou: false, error: true } };
const bot = (id: string, appearance: unknown) => ({ id, name: id, avatar: "🤖", shape: null, color: null, avatarImageUrl: null, primary: id === "cos", mainThreadId: null, needsYou: false, theme: null, appearance });
const cos = () => (state.spaces as { bots: { id: string; appearance: typeof mine | null }[] }).bots[0]!;
const popover = () => document.querySelector<HTMLElement>('[data-testid="theme-popover"]');
const thumb = (id: string) => document.querySelector<HTMLElement>(`[data-testid="theme-thumb"][data-theme-id="${id}"]`)!;
const names = (group: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="theme-group-${group}"] [data-testid="theme-thumb"]`)].map((each) => each.getAttribute("aria-label"));
const shown = () => shownAppearance(cos(), appearanceOverrides());
const key = (name: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
const openPopover = () => act(async () => { toggleThemePopover(); });

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.spaces = { currentBotId: "cos", bots: [bot("cos", mine), bot("home", null)] };
  state.themes = stored.map((theme) => ({ source: "stored", theme }));
  state.call.mockClear();
  state.toast.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<ThemeQuickHost makePreviews={makePreviews} />); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  forgetSavedAppearance(["cos", "home"]);
  setAppearanceDraft("cos", null, false);
  setThemePopoverOpen(false);
  resetSidebarState();
  vi.unstubAllGlobals();
});

it("opens from the footer button with the scene themes, then Classic starting with None, agent themes tagged Custom, and one live preview", async () => {
  expect(popover()).toBeNull();
  await openPopover();
  expect(popover()!.className).toContain("bg-popover");
  expect(popover()!.className).toContain("rounded-[8px]");
  expect(popover()!.className).toContain("border-0");
  expect([...document.querySelectorAll("h3")].map((each) => each.textContent)).toEqual(["Scene", "Classic"]);
  expect(names("scene")).toEqual(registry.scenes().map((entry) => entry.theme.name));
  expect(names("classic")).toEqual(["None", ...registry.classics().map((entry) => entry.theme.name)]);
  expect(names("scene").at(-1)).toBe("After Dark");
  expect([...document.querySelectorAll<HTMLElement>('[data-testid="theme-custom"]')].map((each) => [each.closest<HTMLElement>('[data-testid="theme-thumb"]')!.dataset.themeId, each.textContent])).toEqual([["after-dark", "Custom"], ["fjord", "Custom"]]);
  expect(thumb("grid").getAttribute("aria-checked")).toBe("true");
  expect(document.activeElement).toBe(thumb("grid"));
  expect(thumb("grid").querySelector('[data-testid="theme-live-preview"]')).not.toBeNull();
  expect(thumb("nord").querySelector('[data-testid="theme-mock"]')).not.toBeNull();
  expect(hub.snapshot().live).toEqual(["grid"]);
  expect(hub.snapshot().stills).toEqual(expect.arrayContaining(["after-dark"]));
  expect(shown()).toEqual(mine);
});

it("previews the hovered theme behind the popover through the draft, without writing", async () => {
  await openPopover();
  await act(async () => { thumb("after-dark").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  expect(appearanceDraft()).toEqual({ botId: "cos", appearance: { ...defaultAppearance(registry.get("after-dark")!), effects: mine.effects } });
  expect(hub.snapshot().live).toEqual(["after-dark"]);
  await act(async () => { thumb("nord").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  expect(shown()).toEqual({ ...defaultAppearance(NORD), effects: mine.effects });
  await act(async () => { thumb("none").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  expect(shown()).toBeNull();
  await act(async () => { thumb("grid").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  expect(shown()).toEqual(mine);
  expect(state.call).not.toHaveBeenCalled();
});

it("applies a clicked theme to the Bot on screen at once, with no Save, and closes", async () => {
  await openPopover();
  await act(async () => { thumb("nord").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  await act(async () => { thumb("nord").click(); });
  const next = { ...defaultAppearance(NORD), effects: mine.effects };
  expect(state.call.mock.calls).toEqual([["bot_set_appearance", { botId: "cos", appearance: next }]]);
  expect(popover()).toBeNull();
  expect(appearanceDraft()).toBeNull();
  expect(shown()).toEqual(next);
  expect(document.querySelector('[data-testid="edit-space-save"]')).toBeNull();
});

it("goes back to the theme from before on Esc", async () => {
  await openPopover();
  await act(async () => { thumb("nord").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  expect(shown()!.themeId).toBe("nord");
  await key("Escape");
  expect(popover()).toBeNull();
  expect(appearanceDraft()).toBeNull();
  expect(shown()).toEqual(mine);
  expect(state.call).not.toHaveBeenCalled();
});

it("moves with the arrows, previewing as it goes, and applies with Enter", async () => {
  await openPopover();
  const order = [...document.querySelectorAll<HTMLElement>('[data-testid="theme-thumb"]')].map((each) => each.dataset.themeId!);
  const at = order.indexOf("grid");
  await key("ArrowRight");
  expect((document.activeElement as HTMLElement).dataset.themeId).toBe(order[at + 1]);
  expect(shown()?.themeId ?? "none").toBe(order[at + 1]);
  await key("ArrowLeft");
  expect(document.activeElement).toBe(thumb("grid"));
  await key("ArrowDown");
  const focused = (document.activeElement as HTMLElement).dataset.themeId!;
  expect(focused).not.toBe("grid");
  await act(async () => { (document.activeElement as HTMLElement).click(); });
  expect(state.call.mock.calls.map(([method, input]) => [method, (input as { appearance: { themeId: string } | null }).appearance?.themeId ?? "none"])).toEqual([["bot_set_appearance", focused]]);
  expect(popover()).toBeNull();
});

it("keeps an open Edit space's draft when the popover closes, and takes the theme back when the write fails", async () => {
  const editing = { ...mine, glass: 0.9 };
  setAppearanceDraft("cos", editing);
  await openPopover();
  await act(async () => { thumb("nord").dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  await key("Escape");
  expect(appearanceDraft()).toEqual({ botId: "cos", appearance: editing });
  setAppearanceDraft("cos", null, false);
  state.call.mockRejectedValueOnce(new Error("offline"));
  await openPopover();
  await act(async () => { thumb("none").click(); });
  await act(async () => {});
  expect(state.toast).toHaveBeenCalledWith("offline");
  expect(shown()).toEqual(mine);
  expect(themeChoices(registry).at(-1)!.id).toBeNull();
});

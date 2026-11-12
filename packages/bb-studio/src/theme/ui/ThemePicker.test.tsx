// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultAppearance, type Appearance } from "../appearance";
import { NORD } from "../builtin/classic";
import { GRID } from "../builtin/grid";
import { TONIGHTS_SKY } from "../builtin/tonights-sky";
import { onThemeOptions, type ThemeOptionsClient } from "../options";
import { createThemeRegistry } from "../registry";
import { fakeWebGl } from "../../test/fake-webgl";
import type { CheckReport } from "../checks";
import { PreviewHub } from "./preview";
import { CARD_GRID, ThemePicker, type ThemePickerProps } from "./ThemePicker";

let root: Root;
let host: HTMLDivElement;
const onChange = vi.fn();
const onEveryBot = vi.fn();
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
const registry = createThemeRegistry([{ ...structuredClone(GRID), id: "after-dark", name: "After Dark" }, { ...structuredClone(NORD), id: "fjord", name: "Fjord" }]);
let hub: PreviewHub;
let frames: (() => void)[] = [];
const makePreviews = () => {
  hub = new PreviewHub({ createContext: () => ({ gl: fakeWebGl().gl, canvas: document.createElement("canvas") }), paint: () => {}, requestFrame: (callback) => { frames.push(() => callback(0)); return frames.length; }, cancelFrame: () => { frames = []; }, now: () => 0 });
  return hub;
};
const passed: CheckReport = { pass: true, theme: null, results: [{ id: "frame-time", pass: true, reason: "30 frames at 640×400: 1.4 ms each (budget 6 ms)" }] };
const check = vi.fn((): CheckReport => passed);
const render = (value: Appearance | null, everyBot = false, extra: Partial<ThemePickerProps> = {}) => act(() => root.render(<ThemePicker registry={registry} mode="dark" value={value} onChange={onChange} everyBot={everyBot} onEveryBot={onEveryBot} makePreviews={makePreviews} check={check} {...extra} />));
const click = (element: HTMLElement | null) => act(() => { element!.click(); });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onChange.mockClear();
  onEveryBot.mockClear();
  check.mockClear();
  frames = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("has the scene themes in a wrapping grid of live previews and a Classic grid of app mocks under it, agent themes after the built-ins in their own kind's grid with a Custom tag", () => {
  render(defaultAppearance(GRID));
  const rows = $$('[role="radiogroup"]');
  expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Scene", "Classic"]);
  const names = (row: HTMLElement) => [...row.querySelectorAll('[data-testid="theme-card"]')].map((card) => card.getAttribute("aria-label"));
  const scenes = names(rows[0]!);
  expect(scenes.at(-1)).toBe("After Dark");
  expect(scenes.slice(0, -1)).toContain("Grid");
  expect(names(rows[1]!)).toEqual(["None", "bb Default", "One Dark", "Dracula", "Solarized Light", "GitHub Light", "GitHub Dark", "Nord", "Catppuccin Mocha", "Fjord"]);
  expect(rows[0]!.compareDocumentPosition(rows[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect($('[data-theme-id="grid"]')!.getAttribute("aria-checked")).toBe("true");
  expect($('[data-theme-id="grid"]')!.querySelectorAll('[data-testid="palette-swatch"]')).toHaveLength(4);
  expect($('[data-theme-id="grid"] [data-testid="theme-live-preview"]')).not.toBeNull();
  expect($('[data-theme-id="nord"] [data-testid="theme-mock"]')).not.toBeNull();
  expect($('[data-theme-id="nord"] [data-testid="theme-live-preview"]')).toBeNull();
  expect($$('[data-testid="theme-custom"]').map((each) => [each.closest<HTMLElement>('[data-testid="theme-card"]')!.dataset.themeId, each.textContent])).toEqual([["after-dark", "Custom"], ["fjord", "Custom"]]);
  expect($$("h2").map((each) => each.textContent)).toEqual(["Scene", "Classic"]);
  for (const row of rows) {
    expect(row.className).toBe(CARD_GRID);
    expect(row.className).toContain("grid-cols-[repeat(auto-fill,");
    expect(row.className).not.toMatch(/overflow-x|grid-flow-col|auto-cols/);
  }
  expect($('[data-testid="theme-picker"]')!.innerHTML).not.toMatch(/overflow-x-(auto|scroll)/);
});

it("runs one live preview, the chosen scene's, and the hovered one's in its place", () => {
  render(defaultAppearance(GRID));
  expect(hub.snapshot().live).toEqual(["grid"]);
  expect(hub.snapshot().stills).toEqual(expect.arrayContaining(["after-dark"]));
  act(() => { $('[data-theme-id="after-dark"]')!.dispatchEvent(new Event("pointerover", { bubbles: true })); $('[data-theme-id="after-dark"]')!.focus(); });
  expect(hub.snapshot().live).toEqual(["after-dark"]);
  act(() => { $('[data-theme-id="after-dark"]')!.blur(); });
  expect(hub.snapshot().live).toEqual(["grid"]);
  render(defaultAppearance(NORD));
  expect(hub.snapshot().live).toEqual([]);
});

it("checks an agent-made theme in the app with real WebGL timing and shows the result", async () => {
  render(defaultAppearance(GRID));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(check).not.toHaveBeenCalled();
  expect($('[data-testid="theme-check"]')).toBeNull();
  render({ ...defaultAppearance(GRID), themeId: "after-dark" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(check).toHaveBeenCalledWith(registry.get("after-dark"));
  expect($('[data-testid="theme-check"]')!.textContent).toBe("Checks passed · 30 frames at 640×400: 1.4 ms each (budget 6 ms)");
  check.mockReturnValueOnce({ pass: false, theme: null, results: [{ id: "frame-time", pass: false, reason: "30 frames at 640×400: 9.5 ms each (budget 6 ms)" }] });
  render(defaultAppearance(NORD));
  render({ ...defaultAppearance(NORD), themeId: "fjord" });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect($('[data-testid="theme-check"]')!.textContent).toBe("Checks failed · frame-time: 30 frames at 640×400: 9.5 ms each (budget 6 ms)");
});

it("ends with Reset and the actions it's given", () => {
  render(defaultAppearance(GRID), false, { actions: <><button type="button">Cancel</button><button type="button">Save</button></> });
  expect([...$('[data-testid="theme-picker-actions"]')!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Reset", "Cancel", "Save"]);
});

it("picks a theme with its defaults and keeps the effect switches; None takes the theme off", () => {
  const mine = { ...defaultAppearance(GRID), effects: { workers: false, finished: true, needsYou: false, error: true } };
  render(mine);
  click($('[data-theme-id="nord"]'));
  expect(onChange).toHaveBeenLastCalledWith({ ...defaultAppearance(NORD), effects: mine.effects });
  click($('[data-theme-id="none"]'));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it("shows the sliders and switches for a scene, with the values as percentages", () => {
  render({ ...defaultAppearance(GRID), intensity: 0.7, glass: 0.62, motion: 0.4 });
  expect(["intensity", "glass", "motion"].map((key) => $(`[data-testid="theme-${key}"]`)!.textContent)).toEqual(["70%", "62%", "40%"]);
  expect($$('[role="slider"]')).toHaveLength(3);
  for (const label of ["Intensity", "Glass opacity", "Motion"]) expect($(`[aria-label="${label}"]`)?.querySelector('[role="slider"]')).not.toBeNull();
  const switches = $$('[role="switch"]');
  expect(switches.map((each) => each.getAttribute("aria-label"))).toEqual(["Workers in the scene", "Ripple when a turn finishes", "Pulse while waiting on me", "Red ripple on an error", "Use on every Bot"]);
  click(switches[0]!);
  expect(onChange).toHaveBeenLastCalledWith({ ...defaultAppearance(GRID), intensity: 0.7, glass: 0.62, motion: 0.4, effects: { ...defaultAppearance(GRID).effects, workers: false } });
  click(switches[4]!);
  expect(onEveryBot).toHaveBeenLastCalledWith(true);
  expect($$('[role="img"]').map((swatch) => swatch.getAttribute("aria-label"))).toEqual(["Background", "Accent", "Highlight", "Worker"]);
});

it("turns the scene controls off for a classic theme, keeps the needs-you pulse, and resets to the theme's defaults", () => {
  render({ ...defaultAppearance(NORD), effects: { workers: false, finished: false, needsYou: false, error: false } });
  expect($$('[role="slider"]').every((slider) => slider.hasAttribute("data-disabled"))).toBe(true);
  expect($('[data-testid="theme-intensity"]')!.textContent).toBe("–");
  const disabled = $$('[role="switch"]').map((each) => (each as HTMLButtonElement).disabled);
  expect(disabled).toEqual([true, true, false, true, false]);
  click([...host.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent === "Reset")!);
  expect(onChange).toHaveBeenLastCalledWith(defaultAppearance(NORD));
});

it("shows a theme's options under the sliders only for a theme that declares them, reads the stored value and writes a choice through the setting", async () => {
  const stored = { view: "south" };
  const client: ThemeOptionsClient = {
    load: vi.fn(async () => ({ ...stored })),
    save: vi.fn(async (_themeId: string, id: string, value: string) => { Object.assign(stored, { [id]: value }); return { ...stored }; }),
  };
  const changed: string[] = [];
  const stop = onThemeOptions((themeId) => changed.push(themeId));
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  render(defaultAppearance(GRID), false, { options: client });
  await settle();
  expect($('[data-testid="theme-options"]')).toBeNull();
  expect(client.load).not.toHaveBeenCalled();
  render(defaultAppearance(NORD), false, { options: client });
  expect($('[data-testid="theme-options"]')).toBeNull();

  render(defaultAppearance(TONIGHTS_SKY), false, { options: client });
  const row = $('[data-testid="theme-option"]')!;
  expect(row.dataset.optionId).toBe("view");
  expect(row.querySelector("span")!.textContent).toBe("View");
  const choices = () => [...row.querySelectorAll<HTMLElement>('[role="radio"]')];
  expect(choices().map((choice) => choice.textContent)).toEqual(["Follow the sun", "South", "East", "West"]);
  expect(choices().map((choice) => choice.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
  expect($('[data-testid="theme-options"]')!.compareDocumentPosition($('[role="slider"]')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  await settle();
  expect(client.load).toHaveBeenCalledWith("tonights-sky");
  expect(choices().map((choice) => choice.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);

  click(choices()[3]!);
  expect(choices()[3]!.getAttribute("aria-checked")).toBe("true");
  await settle();
  expect(client.save).toHaveBeenCalledWith("tonights-sky", "view", "west");
  expect(stored.view).toBe("west");
  expect(changed).toEqual(["tonights-sky"]);
  expect(onChange).not.toHaveBeenCalled();

  (client.save as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("offline"));
  click(choices()[2]!);
  await settle();
  expect(choices().map((choice) => choice.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true"]);
  expect($('[data-testid="theme-options"] [role="alert"]')!.textContent).toBe("Couldn't save View: offline");
  expect(changed).toHaveLength(1);
  stop();
});

// On stable BB (no plugin windows) Visual Chat is what it was: a page in BB's rail and the quick card.
import { expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ definePluginApp: (setup: unknown) => ({ setup }), useSdk: () => ({}), useSettings: () => ({ values: undefined }) }));

const { default: plugin } = await import("../app");
const { hasHostWindows, registerHostWindow, useHostWindows } = await import("./host-windows");
const { registerWindowApp } = await import("./window-app");
const { createQuickStore } = await import("./ui/quick-store");

const STOCK_NAV_PANEL_FIELDS = new Set(["id", "title", "icon", "path", "component", "fixedTabs", "experimental_useBadge", "experimental_usePageTitle", "experimental_sidebar", "headerContent"]);

function stockNavPanel(panel: Record<string, unknown>) {
  for (const key of Object.keys(panel)) {
    if (key.startsWith("experimental_") && !STOCK_NAV_PANEL_FIELDS.has(key)) throw new Error(`slots.navPanel: unknown field "${key}"`);
  }
}

function stockApp() {
  const panels: Record<string, unknown>[] = [];
  const overlays: string[] = [];
  const commands: string[] = [];
  const app = {
    slots: { navPanel: (panel: Record<string, unknown>) => { stockNavPanel(panel); panels.push(panel); }, experimental_appOverlay: (overlay: { id: string }) => { overlays.push(overlay.id); } },
    commands: { register: (command: { id: string }) => { commands.push(command.id); } },
  };
  return { app, panels, overlays, commands };
}

it("is its page on the rail, without the off-rail field stock BB refuses, with the quick card, with no window, launcher, window command or Open in window", () => {
  const { app, panels, overlays, commands } = stockApp();
  (plugin as unknown as { setup(app: unknown): void }).setup(app);
  expect(panels.map(({ component: _component, ...panel }) => panel)).toEqual([{ id: "canvas", title: "Visual Chat", icon: "studio-visual-chat/visual-chat", path: "canvas" }]);
  expect(overlays).toEqual(["quick-card"]);
  expect(commands).toEqual(["ask"]);
});

it("finds no window API, and every window call answers false", async () => {
  expect(hasHostWindows).toBe(false);
  expect(registerWindowApp(stockApp().app as never)).toBeNull();
  expect(registerHostWindow({ navPanel() {} }, { id: "canvas", title: "Visual Chat", component: () => null })).toBe(false);
  const windows = useHostWindows();
  expect(windows.native).toBe(false);
  expect(await windows.open("canvas")).toBe(false);
});

it("expands the quick card to the page's address unless a window takes it", () => {
  const navigate = vi.fn();
  const page = createQuickStore();
  page.open();
  page.setThread("thr_quick");
  page.expand(navigate);
  expect(navigate).toHaveBeenCalledWith("/plugins/studio-visual-chat/canvas/thr_quick");
  const expandTo = vi.fn();
  const windowed = createQuickStore({ expandTo });
  windowed.open();
  windowed.setThread("thr_quick");
  navigate.mockClear();
  windowed.expand(navigate);
  expect(expandTo).toHaveBeenCalledWith("thr_quick");
  expect(navigate).not.toHaveBeenCalled();
  expect(windowed.get().open).toBe(false);
});

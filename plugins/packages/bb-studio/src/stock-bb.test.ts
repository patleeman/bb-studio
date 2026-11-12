// @vitest-environment jsdom
import { expect, it } from "vitest";
import { FORK_HOOKS, forkOnly, isForkSdk, onForkHost } from "./kit/app/host-sdk";

const STOCK_SLOTS = [
  "experimental_tab", "threadPanelAction", "experimental_threadHeaderAction", "experimental_sidebarHeader", "homepageSection",
  "settingsSection", "experimental_appOverlay", "navPanel", "experimental_newThreadPanelAction", "pendingInteraction",
  "sidebarFooterAction", "experimental_threadList", "experimental_sidebarNavigation", "experimental_threadContextSegment",
  "experimental_threadRowMetadata", "experimental_threadInfoRow", "experimental_threadInfoSection", "experimental_threadContextCardRow",
  "experimental_threadContextCardSection", "experimental_threadAction", "experimental_browserToolbarAction", "fileOpener",
  "experimental_sourceCodeRenderer", "experimental_diffRenderer", "experimental_composer", "messageDirective",
  "experimental_codeFenceRenderer", "messageAction", "experimental_messageMetadata", "experimental_providerIcon",
  "experimental_timelineRenderer", "experimental_environmentProviderInputs", "experimental_machineProviderInputs",
  "internal_DO_NOT_USE_setupGuideSection",
] as const;

const STOCK_NAV_PANEL_FIELDS = new Set(["id", "title", "icon", "path", "component", "fixedTabs", "experimental_useBadge", "experimental_usePageTitle", "experimental_sidebar", "headerContent"]);

function stockNavPanel(panel: Record<string, unknown>) {
  for (const key of Object.keys(panel)) {
    if (key.startsWith("experimental_") && !STOCK_NAV_PANEL_FIELDS.has(key)) throw new Error(`slots.navPanel: unknown field "${key}"`);
  }
}

function stockHost() {
  const calls: { slot: string; registration: Record<string, unknown> }[] = [];
  const slots: Record<string, (registration: Record<string, unknown>) => unknown> = {};
  for (const slot of STOCK_SLOTS) {
    slots[slot] = (registration) => {
      if (slot === "navPanel") stockNavPanel(registration);
      calls.push({ slot, registration });
      return undefined;
    };
  }
  const recorder = (): unknown => new Proxy(() => undefined, { get: (_target, key) => (key === "then" ? undefined : recorder()), apply: () => undefined });
  const app = new Proxy({ slots } as Record<string | symbol, unknown>, { get: (target, key) => (key in target ? target[key] : recorder()) });
  return { app, calls };
}

it("knows stock BB's SDK from the fork's", () => {
  expect(onForkHost).toBe(false);
  expect(isForkSdk({})).toBe(false);
  for (const hook of FORK_HOOKS) expect(isForkSdk({ [hook]: () => null })).toBe(true);
  expect(forkOnly({ experimental_hideFromNavigation: true })).toEqual({});
  expect(forkOnly({ experimental_hideFromNavigation: true }, true)).toEqual({ experimental_hideFromNavigation: true });
});

it("refuses a panel field stock BB doesn't know, as stock BB does", () => {
  expect(() => stockNavPanel({ id: "a", experimental_hideFromNavigation: true })).toThrow('slots.navPanel: unknown field "experimental_hideFromNavigation"');
  expect(() => stockNavPanel({ id: "a", experimental_usePageTitle: () => "" })).not.toThrow();
});

it("registers its whole frontend on stock BB, with its pages on the rail", async () => {
  const { default: plugin } = await import("../app");
  const { app, calls } = stockHost();
  expect(() => (plugin as unknown as { setup(app: unknown): void }).setup(app)).not.toThrow();
  const panels = calls.filter((call) => call.slot === "navPanel").map((call) => call.registration);
  expect(panels.map((panel) => panel.id)).toEqual(expect.arrayContaining(["studio"]));
  for (const panel of panels) expect(panel).not.toHaveProperty("experimental_hideFromNavigation");
  expect(calls.filter((call) => call.slot === "experimental_appOverlay").map((call) => call.registration.id)).toContain("new-menu");
}, 60_000);

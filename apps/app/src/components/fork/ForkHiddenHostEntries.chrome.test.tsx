// @vitest-environment jsdom

import { cleanup, render, renderHook } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { buildSettingsSearchItems } from "@/components/settings/settings-search";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings/settings-sections";
import {
  sidebarFooterCapacityAtom,
} from "@/components/sidebar/sidebarFooterPreferences";
import { SidebarFooterCustomize } from "@/components/sidebar/SidebarFooterCustomize";
import {
  useForkSettingsSectionHidden,
  useForkVisibleSettingsSections,
} from "./ForkHiddenHostEntries";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function hideChrome() {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      hiddenHostEntries: [
        {
          id: "chrome",
          settingsSections: ["mobile"],
          footer: [
            "builtin:mobile",
            "builtin:report-bug",
            "plugin:usage/usage",
          ],
        },
      ],
    }),
  );
}

function registerUsage() {
  setPluginSlotRegistrations(
    "usage",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.experimental_sidebarFooter.register({
          kind: "action",
          id: "usage",
          label: "Provider usage",
          icon: "ChartColumn",
          onActivate: vi.fn(),
        });
      }),
    ),
  );
}

function footerKeys() {
  const store = createStore();
  store.set(sidebarFooterCapacityAtom, 8);
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>
          <SidebarProvider>
            <SidebarFooterCustomize onDone={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </Provider>,
  );
  const keys = Array.from(
    document.querySelectorAll<HTMLElement>("[data-footer-icon]"),
    (element) => element.dataset.footerIcon,
  );
  view.unmount();
  return keys;
}

describe("hidden host chrome", () => {
  it("leaves bb's footer items until a plugin hides them", () => {
    registerUsage();
    expect(footerKeys()).toEqual([
      "builtin:mobile",
      "plugin:usage/usage",
      "builtin:report-bug",
    ]);
    hideChrome();
    expect(footerKeys()).toEqual([]);
  });

  it("collects the footer and settings section lists", () => {
    const collected = collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_hideHostEntries({
          id: "chrome",
          settingsSections: ["mobile"],
          footer: ["builtin:mobile"],
        });
      }),
    );
    expect(collected.hiddenHostEntries).toEqual([
      {
        id: "chrome",
        navigation: [],
        pages: [],
        settings: [],
        settingsSections: ["mobile"],
        footer: ["builtin:mobile"],
      },
    ]);
  });

  it("drops a hidden settings section from the list and from search", () => {
    const { result, rerender } = renderHook(() => ({
      sections: useForkVisibleSettingsSections(SETTINGS_NAV_SECTIONS),
      hidden: useForkSettingsSectionHidden("mobile"),
      general: useForkSettingsSectionHidden("general"),
    }));
    expect(result.current.sections.map((section) => section.id)).toContain(
      "mobile",
    );
    expect(result.current.hidden).toBe(false);
    hideChrome();
    rerender();
    const ids = result.current.sections.map((section) => section.id);
    expect(ids).not.toContain("mobile");
    expect(ids).toHaveLength(SETTINGS_NAV_SECTIONS.length - 1);
    expect(result.current.hidden).toBe(true);
    expect(result.current.general).toBe(false);
    const titles = buildSettingsSearchItems({
      conditions: new Set(),
      pluginEntries: [],
      pluginSettings: [],
      sections: [...result.current.sections],
    }).map((item) => item.title);
    expect(titles).not.toContain("Mobile");
  });
});

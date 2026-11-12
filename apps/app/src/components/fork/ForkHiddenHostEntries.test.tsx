// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { getPluginNavPanelKey } from "@/components/plugin/pluginNavSidebarOrder";
import {
  createSidebarNavigationRows,
  SKILLS_NAVIGATION_ITEM_ID,
} from "@/components/sidebar/sidebarNavigationItems";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { buildSettingsSearchItems } from "@/components/settings/settings-search";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings/settings-sections";
import { SkillsView } from "@/views/ToolsView";
import {
  useForkHostSettingHidden,
  useForkVisibleNavigationRows,
} from "./ForkHiddenHostEntries";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function hideSkills() {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      hiddenHostEntries: [
        {
          id: "skills",
          navigation: [SKILLS_NAVIGATION_ITEM_ID],
          pages: ["skills"],
          settings: ["cli-skills"],
        },
      ],
    }),
  );
}

const rows = createSidebarNavigationRows([]);
const keys = (list: typeof rows) => list.map(getPluginNavPanelKey);

describe("hidden host entries", () => {
  it("keeps every navigation row until a plugin hides one", () => {
    const { result, rerender } = renderHook(() =>
      useForkVisibleNavigationRows(rows),
    );
    expect(keys(result.current)).toContain(SKILLS_NAVIGATION_ITEM_ID);
    hideSkills();
    rerender();
    expect(keys(result.current)).not.toContain(SKILLS_NAVIGATION_ITEM_ID);
    expect(keys(result.current)).toEqual(
      keys(rows).filter((key) => key !== SKILLS_NAVIGATION_ITEM_ID),
    );
  });

  it("sends a hidden page's address home", () => {
    hideSkills();
    render(
      <MemoryRouter initialEntries={["/skills"]}>
        <Routes>
          <Route path="/" element={<p>Home</p>} />
          <Route path="/skills" element={<SkillsView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("hides a settings section and its search entry", () => {
    const { result, rerender } = renderHook(() =>
      useForkHostSettingHidden("cli-skills"),
    );
    expect(result.current).toBe(false);
    hideSkills();
    rerender();
    expect(result.current).toBe(true);
    const titles = (conditions: Set<"cliSkills">) =>
      buildSettingsSearchItems({
        conditions,
        pluginEntries: [],
        pluginSettings: [],
        sections: [...SETTINGS_NAV_SECTIONS],
      }).map((item) => item.title);
    expect(titles(new Set(["cliSkills"]))).toContain("bb CLI skills");
    expect(titles(new Set())).not.toContain("bb CLI skills");
  });
});

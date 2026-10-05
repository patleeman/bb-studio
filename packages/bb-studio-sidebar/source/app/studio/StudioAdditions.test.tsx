// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { publishThreadBadges } from "@bb-studio/kit/app";
import { StudioNewProjectItem } from "./StudioHeaderMenuItems.js";
import { StudioThreadBadge } from "./StudioThreadBadge.js";

installTestPluginRuntime();
afterEach(cleanup);

describe("Studio sidebar additions", () => {
  it("opens New project through its menu callback", () => {
    const onSelect = vi.fn();
    render(<DropdownMenu open><DropdownMenuContent><StudioNewProjectItem onSelect={onSelect} /></DropdownMenuContent></DropdownMenu>);
    fireEvent.click(screen.getByRole("menuitem", { name: "New project" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows a published badge only on its thread", () => {
    const unpublish = publishThreadBadges("bot-teams", new Map([["thr_bot", { glyph: "🦉", label: "Working as Atlas" }]]));
    try {
      const { container } = render(<TooltipProvider><StudioThreadBadge threadId="thr_bot" /><StudioThreadBadge threadId="thr_plain" /></TooltipProvider>);
      expect(screen.getByRole("img", { name: "Working as Atlas" }).textContent).toBe("🦉");
      expect(container.querySelectorAll("[data-sidebar-thread-badge]")).toHaveLength(1);
    } finally {
      unpublish();
    }
    render(<StudioThreadBadge threadId="thr_bot" />);
    expect(screen.queryByRole("img", { name: "Working as Atlas" })).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent } from "@/components/ui/context-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { STUDIO_CHAT_FLOAT_EVENT } from "@bb-studio/kit/contract";
import { publishThreadBadges } from "@bb-studio/kit/app";
import { StudioNewProjectItem } from "./StudioHeaderMenuItems.js";
import { StudioChatFloatItem } from "./StudioChatFloatItem.js";
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

  it("sends the selected thread to Studio Chat", () => {
    const received = vi.fn();
    window.addEventListener(STUDIO_CHAT_FLOAT_EVENT, received);
    try {
      render(<ContextMenu open><ContextMenuContent><StudioChatFloatItem surface="context" threadId="thr_studio" /></ContextMenuContent></ContextMenu>);
      fireEvent.click(screen.getByRole("menuitem", { name: "Float in Studio Chat" }));
      expect(received).toHaveBeenCalledOnce();
      expect((received.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ threadId: "thr_studio" });
    } finally {
      window.removeEventListener(STUDIO_CHAT_FLOAT_EVENT, received);
    }
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

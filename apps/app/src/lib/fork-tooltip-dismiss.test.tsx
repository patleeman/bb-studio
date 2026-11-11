// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { installTooltipDismiss } from "./fork-tooltip-dismiss";

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  cleanup();
  vi.useRealTimers();
  document.body.querySelectorAll("[data-test-overlay]").forEach((node) => {
    node.remove();
  });
});

function OpenTooltip() {
  return (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <button type="button">Attention</button>
        </TooltipTrigger>
        <TooltipContent>2 things need attention</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function overlay(role: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-test-overlay", "");
  const content = document.createElement("div");
  content.setAttribute("role", role);
  wrapper.append(content);
  return wrapper;
}

async function flushObserver() {
  await act(async () => {
    await Promise.resolve();
  });
}

function tooltipShown(): boolean {
  return screen.queryByRole("tooltip") !== null;
}

describe("tooltips and menus", () => {
  it("hides an open tooltip when a menu or popover opens", async () => {
    uninstall = installTooltipDismiss(document);
    render(<OpenTooltip />);
    expect(tooltipShown()).toBe(true);
    document.body.append(overlay("dialog"));
    await flushObserver();
    expect(tooltipShown()).toBe(false);
  });

  it("hides a tooltip that reopens as a menu closes and focus returns to its trigger", async () => {
    uninstall = installTooltipDismiss(document);
    const menu = overlay("menu");
    document.body.append(menu);
    await flushObserver();
    render(<OpenTooltip />);
    expect(tooltipShown()).toBe(true);
    vi.useFakeTimers();
    menu.remove();
    await flushObserver();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(tooltipShown()).toBe(false);
  });

  it("leaves tooltips alone for other changes, and after it is uninstalled", async () => {
    uninstall = installTooltipDismiss(document);
    render(<OpenTooltip />);
    const plain = document.createElement("div");
    plain.setAttribute("data-test-overlay", "");
    document.body.append(plain);
    await flushObserver();
    expect(tooltipShown()).toBe(true);
    uninstall();
    uninstall = null;
    document.body.append(overlay("menu"));
    await flushObserver();
    expect(tooltipShown()).toBe(true);
  });
});

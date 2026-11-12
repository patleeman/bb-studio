// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

const state = vi.hoisted(() => ({ compact: false }));
vi.mock("./hooks/use-compact-viewport.js", () => ({ useIsCompactViewport: () => state.compact }));
vi.mock("./hooks/use-pointer-coarse.js", () => ({ usePointerCoarse: () => false }));

const { Dialog, DialogContent, DialogTitle } = await import("./dialog");

installTestPluginRuntime();
let root: Root | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.useRealTimers(); });

for (const compact of [false, true]) {
  it(`opens by default in ${compact ? "the drawer" : "the dialog"} presentation`, async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.compact = compact;
    root = createRoot(document.createElement("div"));
    await act(async () => {
      root!.render(<Dialog defaultOpen><DialogContent><DialogTitle>Open by default</DialogTitle></DialogContent></Dialog>);
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-state")).toBe("open");
  });
}

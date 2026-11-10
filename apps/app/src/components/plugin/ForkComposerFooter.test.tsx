// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginComposerFooter } from "./ForkComposerFooter";

function Chip() {
  return <span>Cache warm</span>;
}

function Broken(): never {
  throw new Error("chip failed");
}

function register() {
  setPluginSlotRegistrations(
    "alpha",
    makePluginRegistrationSet({
      composerCustomizations: [
        {
          id: "status",
          scopes: ["thread"],
          experimental_footer: [
            { id: "broken", component: Broken },
            { id: "cache", component: Chip },
          ],
        },
        {
          id: "compose-only",
          scopes: ["new-thread"],
          experimental_footer: [
            { id: "draft", component: () => <span>Draft only</span> },
          ],
        },
      ],
    }),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("plugin composer footer", () => {
  it("renders the thread scope's items, skips other scopes, and survives a crashing item", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    register();
    render(
      <PluginComposerFooter scope={{ kind: "thread", threadId: "thr_1" }} />,
    );
    expect(screen.getByText("Cache warm")).toBeTruthy();
    expect(screen.queryByText("Draft only")).toBeNull();
  });

  it("renders nothing when customizations are suppressed", () => {
    register();
    const view = render(<PluginComposerFooter scope={null} />);
    expect(view.container.textContent).toBe("");
  });
});

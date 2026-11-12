// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { forkModelPickerGate } from "./ForkModelPickerGate";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

function Picker({ hasSelectedModel }: { hasSelectedModel: boolean }) {
  return (
    <>
      {forkModelPickerGate(<button type="button">Select model</button>, {
        hasSelectedModel,
      })}
    </>
  );
}

describe("a plugin's model picker gate", () => {
  it("keeps bb's picker without a gate, and draws the gate's node or bb's picker with one", () => {
    const { rerender } = render(<Picker hasSelectedModel={false} />);
    expect(screen.getByText("Select model")).toBeTruthy();
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        modelPickerGates: [
          {
            id: "sign-in",
            component: ({ hasSelectedModel, children }) =>
              hasSelectedModel ? (
                <>{children}</>
              ) : (
                <button type="button">Sign in</button>
              ),
          },
        ],
      }),
    );
    rerender(<Picker hasSelectedModel={false} />);
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByText("Select model")).toBeNull();
    rerender(<Picker hasSelectedModel />);
    expect(screen.getByText("Select model")).toBeTruthy();
  });

  it("falls back to bb's picker when the gate throws", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        modelPickerGates: [
          {
            id: "broken",
            component: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    );
    const errors = console.error;
    console.error = () => {};
    try {
      render(<Picker hasSelectedModel={false} />);
    } finally {
      console.error = errors;
    }
    expect(screen.getByText("Select model")).toBeTruthy();
  });
});

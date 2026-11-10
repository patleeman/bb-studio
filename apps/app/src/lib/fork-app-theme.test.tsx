// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setPreferredTheme } from "@/hooks/useTheme";
import { applyAppThemeCss } from "@/lib/themes";
import { usePluginAppTheme } from "./fork-app-theme";

function Probe() {
  const theme = usePluginAppTheme();
  return <div data-testid="theme">{`${theme.mode}:${theme.epoch}`}</div>;
}

function shown(): [string, number] {
  const [mode = "", epoch = "0"] = (
    screen.getByTestId("theme").textContent ?? ""
  ).split(":");
  return [mode, Number(epoch)];
}

afterEach(() => {
  cleanup();
  act(() => setPreferredTheme("system"));
});

describe("plugin app theme", () => {
  it("follows the mode and bumps the epoch when the theme's variables change", () => {
    act(() => setPreferredTheme("light"));
    render(<Probe />);
    const [mode, epoch] = shown();
    expect(mode).toBe("light");
    act(() => setPreferredTheme("dark"));
    expect(shown()[0]).toBe("dark");
    act(() => applyAppThemeCss(":root { --background: #101820; }"));
    expect(shown()[1]).toBeGreaterThan(epoch);
  });
});

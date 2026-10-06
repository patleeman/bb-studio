import { describe, expect, it } from "vitest";
import { mergeSettings } from "./server/settings";
import { BB_THEME_VARIABLES, bbThemeSchema, themeSettings, vscodeColors, type BbTheme } from "./theme";

const theme: BbTheme = {
  mode: "dark",
  colors: Object.fromEntries(BB_THEME_VARIABLES.map((name) => [name, "#123456"])) as BbTheme["colors"],
};

describe("BB theme in VS Code", () => {
  it("maps BB's palette onto the workbench", () => {
    const colors = vscodeColors({ ...theme, colors: { ...theme.colors, background: "#1f3a40", primary: "#ff7a45" } });
    expect(colors["editor.background"]).toBe("#1f3a40");
    expect(colors["button.background"]).toBe("#ff7a45");
    expect(colors["editor.selectionBackground"]).toBe("#ff7a454d");
    for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
  });

  it("picks the Modern theme of BB's mode", () => {
    expect(themeSettings(theme)["workbench.colorTheme"]).toBe("Dark Modern");
    expect(themeSettings({ ...theme, mode: "light" })["workbench.colorTheme"]).toBe("Light Modern");
  });

  it("refuses colors that aren't hex", () => {
    expect(bbThemeSchema.safeParse({ ...theme, colors: { ...theme.colors, border: "oklch(0.3 0 0)" } }).success).toBe(false);
  });
});

describe("settings merge", () => {
  it("keeps the user's other settings", () => {
    const merged = JSON.parse(mergeSettings(`{"editor.fontSize": 15}`, themeSettings(theme))!);
    expect(merged["editor.fontSize"]).toBe(15);
    expect(merged["workbench.colorTheme"]).toBe("Dark Modern");
  });

  it("leaves a file with comments alone", () => {
    expect(mergeSettings(`{\n  // mine\n  "editor.fontSize": 15\n}`, themeSettings(theme))).toBeNull();
  });

  it("starts a missing file", () => {
    expect(JSON.parse(mergeSettings(null, { a: 1 })!)).toEqual({ a: 1 });
  });
});

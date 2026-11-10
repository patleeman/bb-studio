import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ThreadSearchPaletteMode.tsx", import.meta.url)),
  "utf8",
);

describe("plugin rows in the search palette", () => {
  it("resets the highlight after the effect that sets it from the active index", () => {
    const setsKeyFromActiveIndex = source.indexOf(
      "setHighlightedKey(activeIndex < 0 ? null : optionKey(options[activeIndex]))",
    );
    const resetsForLeadingPluginRows = source.indexOf(
      "usePluginPaletteHighlightReset({",
    );

    expect(setsKeyFromActiveIndex).toBeGreaterThan(-1);
    expect(resetsForLeadingPluginRows).toBeGreaterThan(setsKeyFromActiveIndex);
  });

  it("merges plugin rows before the highlight state is derived from the options", () => {
    const mergesOptions = source.indexOf("usePluginPaletteOptions({");
    const derivesActiveIndex = source.indexOf(
      "setHighlightedIndex(Math.max(activeIndex, 0))",
    );

    expect(mergesOptions).toBeGreaterThan(-1);
    expect(derivesActiveIndex).toBeGreaterThan(mergesOptions);
  });
});

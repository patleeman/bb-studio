import { describe, expect, it } from "vitest";
import {
  backdropTokenRemaps,
  isSeeThroughValue,
  OPAQUE_ON_PURPOSE,
  sourceBackgroundUtilities,
  surfaceVerdict,
  translucentThemeTokens,
} from "@/test/fork-surface-audit";

describe("bb's background utilities over an app backdrop", () => {
  const utilities = sourceBackgroundUtilities();

  it("finds the utilities bb paints surfaces with", () => {
    for (const name of [
      "background",
      "card",
      "muted",
      "popover",
      "surface-recessed",
      "surface-raised-solid",
      "surface-scrim",
      "background/70",
      "muted/40",
    ]) {
      expect([...utilities.keys()]).toContain(name);
    }
    expect(utilities.size).toBeGreaterThan(40);
  });

  it("every one is translucent, remapped, ruled or opaque on purpose", () => {
    const opaque = [...utilities]
      .filter(([, utility]) => surfaceVerdict(utility) === "opaque")
      .map(([key]) => `bg-${key}`);
    expect(opaque).toEqual([]);
  });

  it("classifies each kind of surface the way the docs say", () => {
    const verdict = (key: string) => {
      const utility = utilities.get(key);
      if (utility === undefined) throw new Error(`no bg-${key} in the source`);
      return surfaceVerdict(utility);
    };
    expect(verdict("surface-recessed")).toBe("translucent");
    expect(verdict("surface-raised")).toBe("translucent");
    expect(verdict("state-hover")).toBe("translucent");
    for (const key of [
      "card",
      "muted",
      "muted/40",
      "secondary",
      "accent",
      "surface-recessed-solid",
      "surface-raised-solid",
      "surface-scrim",
      "sidebar",
    ]) {
      expect(verdict(key)).toBe("remapped");
    }
    for (const key of ["background", "background/30", "background/70"]) {
      expect(verdict(key)).toBe("ruled");
    }
    expect(verdict("popover")).toBe("opaque on purpose");
    expect(verdict("primary")).toBe("opaque on purpose");
  });

  it("lists no exception the source does not use", () => {
    const used = new Set([...utilities.values()].map((each) => each.name));
    expect(
      Object.keys(OPAQUE_ON_PURPOSE).filter((name) => !used.has(name)),
    ).toEqual([]);
  });

  it("remaps tokens only to see-through values and leaves popovers alone", () => {
    const remaps = backdropTokenRemaps();
    expect(remaps.length).toBeGreaterThan(10);
    for (const remap of remaps) {
      expect(
        isSeeThroughValue(remap.value),
        `${remap.token}: ${remap.value}`,
      ).toBe(true);
    }
    const tokens = new Set(remaps.map((remap) => remap.token));
    expect(tokens.has("popover")).toBe(false);
    expect(tokens.has("background")).toBe(false);
    expect(tokens.has("card")).toBe(true);
  });

  it("reads bb's own translucent tokens from theme.css", () => {
    const translucent = translucentThemeTokens();
    expect(translucent.has("surface-recessed")).toBe(true);
    expect(translucent.has("card")).toBe(false);
    expect(translucent.has("surface-recessed-solid")).toBe(false);
  });
});

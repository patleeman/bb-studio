import { describe, expect, it } from "vitest";
import { FORK_PIERRE_CSS, withForkPierreCSS } from "./fork-pierre-css";

describe("withForkPierreCSS", () => {
  it("gives the gutter its own fill and keeps the caller's CSS after it", () => {
    const options = withForkPierreCSS({
      overflow: "scroll",
      unsafeCSS: "[data-line] { color: red; }",
    });
    expect(options?.overflow).toBe("scroll");
    expect(options?.unsafeCSS).toBe(
      `${FORK_PIERRE_CSS}\n[data-line] { color: red; }`,
    );
    expect(FORK_PIERRE_CSS).toContain(
      "[data-gutter] { --diffs-bg: var(--fork-diffs-gutter-bg,",
    );
  });

  it("adds the CSS when the caller has none", () => {
    expect(withForkPierreCSS<{ unsafeCSS?: string }>({})?.unsafeCSS).toBe(
      FORK_PIERRE_CSS,
    );
  });
});

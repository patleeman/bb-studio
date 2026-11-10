import { describe, expect, it } from "vitest";
import { firstChangedLine } from "./fork-first-changed-line";

describe("firstChangedLine", () => {
  it("is the first added line of the first hunk, counting context and skipping removals", () => {
    const patch = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -10,5 +10,6 @@ function a() {",
      " keep",
      " keep",
      "-old",
      "+new",
      " keep",
    ].join("\n");
    expect(firstChangedLine(patch)).toBe(12);
  });

  it("falls back to the hunk start for a removal-only hunk, and to null without a hunk", () => {
    expect(firstChangedLine("@@ -3,2 +3,1 @@\n keep\n-gone")).toBe(3);
    expect(firstChangedLine("@@ -1 +0,0 @@\n-only")).toBe(1);
    expect(firstChangedLine("Binary files differ")).toBeNull();
    expect(firstChangedLine(undefined)).toBeNull();
  });
});

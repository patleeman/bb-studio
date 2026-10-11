import { describe, expect, it } from "vitest";
import { resolveInside } from "./paths";

describe("resolveInside", () => {
  const base = "/tmp/applets/hud";
  it("keeps paths inside the folder", () => {
    expect(resolveInside(base, "/index.html")).toBe("/tmp/applets/hud/index.html");
    expect(resolveInside(base, "js/a%20b.js")).toBe("/tmp/applets/hud/js/a b.js");
  });
  it("rejects escapes, encoded or not, and bad encodings", () => {
    for (const bad of ["../x", "/../../etc/passwd", "%2e%2e/x", "a/../../x", "%E0%A4%A"]) expect(resolveInside(base, bad)).toBeNull();
    expect(resolveInside(base, "../hud-evil/x")).toBeNull();
  });
});

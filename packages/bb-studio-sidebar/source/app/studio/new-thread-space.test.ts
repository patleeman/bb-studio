// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setSpaceNewThreadTarget, spaceNewThreadTarget } from "./new-thread-space.js";

describe("Space new thread target", () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("is kept per window, not in storage shared across BB windows", () => {
    setSpaceNewThreadTarget({ spaceId: "spc_work", projectId: "proj_work" });
    expect(spaceNewThreadTarget()).toEqual({ spaceId: "spc_work", projectId: "proj_work" });
    expect(localStorage.length).toBe(0);
  });

  it("clears only this window's target", () => {
    localStorage.setItem("bb-studio:space-new-thread-project", "proj_other_window");
    setSpaceNewThreadTarget({ spaceId: "spc_work", projectId: "proj_work" });
    setSpaceNewThreadTarget(null);
    expect(spaceNewThreadTarget()).toBeNull();
    expect(localStorage.getItem("bb-studio:space-new-thread-project")).toBe("proj_other_window");
  });

  it("ignores malformed values", () => {
    sessionStorage.setItem("bb-studio:space-new-thread", "{\"spaceId\":1}");
    expect(spaceNewThreadTarget()).toBeNull();
  });
});

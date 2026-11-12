// What a VS Code page in the main view is called, and its addresses.
import { describe, expect, it } from "vitest";
import { CHOOSE_PATH, codePageAt, codePageLabel, workspacePath, WORKSPACES_PATH } from "./page-title";

describe("the VS Code page's name", () => {
  it("is VS Code and the workspace or project name", () => {
    expect(codePageLabel("bb-studio")).toBe("VS Code · bb-studio");
    expect(codePageLabel("  fix-retry ")).toBe("VS Code · fix-retry");
  });

  it("is VS Code alone until the name is known", () => {
    expect(codePageLabel("")).toBe("VS Code");
    expect(codePageLabel(null)).toBe("VS Code");
  });
});

describe("VS Code's pages", () => {
  it("live under their own nav panel", () => {
    expect(WORKSPACES_PATH).toBe("/plugins/studio/vscode");
    expect(workspacePath("cws_abc")).toBe("/plugins/studio/vscode/cws_abc");
    expect(CHOOSE_PATH).toBe("/plugins/studio/vscode/choose");
  });

  it("finds the workspace, or the picker, in the panel's sub-path", () => {
    expect(codePageAt("cws_abc")).toBe("cws_abc");
    expect(codePageAt("/cws_abc/")).toBe("cws_abc");
    expect(codePageAt("choose")).toBe("choose");
    for (const path of ["", "cws_abc/more", "100%"]) expect(codePageAt(path)).toBeNull();
  });

});

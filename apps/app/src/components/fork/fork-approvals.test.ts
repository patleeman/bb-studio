import { describe, expect, it } from "vitest";
import { nextApprovalForBrowser, type PendingApproval } from "./fork-approvals";

function approval(
  id: string,
  kind: PendingApproval["kind"] = "plugin",
): PendingApproval {
  return {
    id,
    kind,
    pluginId: "studio",
    title: id,
    message: "",
    detail: null,
    items: [],
    confirmLabel: "Approve",
  };
}

describe("which approval the browser dialog shows", () => {
  it("skips approvals the desktop dialog has taken and pairing requests, which only the desktop app answers", () => {
    const pending = [
      approval("a"),
      approval("pair", "pair-browser"),
      approval("b"),
    ];

    expect(nextApprovalForBrowser(pending, new Set(["a"]), null)?.id).toBe("b");
    expect(
      nextApprovalForBrowser(pending, new Set(["a", "b"]), null),
    ).toBeNull();
    expect(nextApprovalForBrowser(pending, new Set(), null)?.id).toBe("a");
  });
});

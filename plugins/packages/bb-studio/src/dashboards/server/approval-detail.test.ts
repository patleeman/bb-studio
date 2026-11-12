import { describe, expect, it } from "vitest";
import { scriptApprovalDetail } from "./approval-detail";

describe("scriptApprovalDetail", () => {
  it("says where, how often and within what limits the command runs, and who proposed it", () => {
    const text = scriptApprovalDetail({ cwd: "/Users/p/repo", cwdIsHome: false, host: "studio-mac", intervalSec: 300, backgroundSec: 600, timeoutSec: 20, maxOutputBytes: 65536, proposedBy: { actor: "agent", threadTitle: "Build status" } });
    expect(text).toContain("Runs on studio-mac, in /Users/p/repo, every 5 minutes while the dashboard is open, and for 10 minutes after.");
    expect(text).toContain("stopped after 20 seconds and may print up to 64 KB");
    expect(text).toContain("Proposed by an agent in “Build status”.");
  });
  it("names the home folder and leaves out a proposer when there is none", () => {
    const text = scriptApprovalDetail({ cwd: "/Users/p", cwdIsHome: true, host: "studio-mac", intervalSec: 60, backgroundSec: 300, timeoutSec: 10, maxOutputBytes: 1024, proposedBy: null });
    expect(text).toContain("in your home folder, every minute");
    expect(text).not.toContain("Proposed by");
  });
});

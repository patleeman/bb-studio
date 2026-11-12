import { describe, expect, it } from "vitest";
import { grantAfterHostApproval, hostApproval } from "./host-approval";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("host approval", () => {
  it("is null on a BB without the dialog", () => {
    expect(hostApproval({})).toBeNull();
    expect(hostApproval({ experimental_hooks: {} })).toBeNull();
  });

  it("grants only after the person approves, with what they allowed", async () => {
    const granted: string[][] = [];
    grantAfterHostApproval(async () => ({ approved: true, picked: ["fetch"] }), { title: "t", message: "m" }, (picked) => { granted.push(picked); });
    grantAfterHostApproval(async () => ({ approved: false, picked: [] }), { title: "t", message: "m" }, (picked) => { granted.push(picked); });
    await tick();
    expect(granted).toEqual([["fetch"]]);
  });

  it("reports a grant that fails after approval", async () => {
    const failures: string[] = [];
    grantAfterHostApproval(async () => ({ approved: true, picked: [] }), { title: "t", message: "m" }, () => { throw new Error("The command changed."); }, (message) => failures.push(message));
    await tick();
    expect(failures).toEqual(["The command changed."]);
  });
});

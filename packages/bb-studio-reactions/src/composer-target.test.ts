import { describe, expect, it } from "vitest";
import { pickComposer } from "./composer-target";

const main = { name: "main", scope: { kind: "new-thread", projectId: null } } as const;
const floated = { name: "floated", scope: { kind: "thread", threadId: "thr_a" } } as const;
const other = { name: "other", scope: { kind: "thread", threadId: "thr_b" } } as const;
const side = {
  name: "side",
  scope: { kind: "side-chat", projectId: "p", parentThreadId: "thr_b", tabId: "t", childThreadId: "thr_c" },
} as const;

describe("pickComposer", () => {
  it("drafts into the composer for the message's thread, not the newest one", () => {
    expect(pickComposer([floated, main], "thr_a")).toBe(floated);
    expect(pickComposer([floated, other], "thr_a")).toBe(floated);
  });

  it("matches a side chat by its child thread", () => {
    expect(pickComposer([side, other], "thr_c")).toBe(side);
  });

  it("falls back to the newest composer when none writes to the thread", () => {
    expect(pickComposer([other, main], "thr_z")).toBe(main);
  });

  it("returns null when no composer is mounted", () => {
    expect(pickComposer([], "thr_a")).toBeNull();
  });
});

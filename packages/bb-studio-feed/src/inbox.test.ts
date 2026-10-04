import { describe, expect, it } from "vitest";
import { inboxBadge, waitingThreads, failedThreads, type InboxThreadSource } from "./inbox";

const thread = (id: string, overrides: Partial<InboxThreadSource> = {}): InboxThreadSource => ({
  id,
  displayTitle: `Thread ${id}`,
  href: `/projects/p/threads/${id}`,
  hasPendingInteraction: true,
  indicatorLabel: "Thread needs user input",
  isArchived: false,
  isHidden: false,
  latestAttentionAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("waitingThreads", () => {
  it("lists threads blocked on the user, most recent first", () => {
    const result = waitingThreads([
      thread("a", { latestAttentionAt: 10 }),
      thread("b", { hasPendingInteraction: false, latestAttentionAt: 50 }),
      thread("c", { latestAttentionAt: 30 }),
      thread("d", { isArchived: true }),
      thread("e", { isHidden: true }),
      thread("f", { latestAttentionAt: 0, updatedAt: 20, indicatorLabel: null }),
    ]);
    expect(result.map((each) => each.id)).toEqual(["c", "f", "a"]);
    expect(result[0]).toEqual({ id: "c", title: "Thread c", why: "Thread needs user input", href: "/projects/p/threads/c", at: 30 });
    expect(result[1]?.why).toBeNull();
  });
});

describe("inboxBadge", () => {
  it("adds waiting threads and unread posts", () => {
    expect(inboxBadge(0, 0)).toBeNull();
    expect(inboxBadge(2, 3)).toBe("5");
    expect(inboxBadge(60, 60)).toBe("99+");
  });
});

describe("failedThreads", () => {
  it("includes ordinary failures and failed queues without duplicating pending interactions", () => {
    const failed = (id: string, extra = {}) => ({ ...thread(id, { hasPendingInteraction: false }), status: "error", queuedWork: "none", ...extra });
    expect(failedThreads([failed("run"), failed("queue", { status: "idle", queuedWork: "failed" }), failed("hidden", { isHidden: true }), failed("pending", { hasPendingInteraction: true }), failed("archived", { isArchived: true })]).map(t => t.id)).toEqual(["run", "queue"]);
  });
});

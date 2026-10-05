import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "../testing/fixtures.js";
import { compactAge, spaceThreadState } from "./SpaceThreadRow.js";
import { threadLineIds, THREAD_LINES_LIMIT } from "./useThreadLines.js";

describe("By space rows", () => {
  it("shows the most urgent state in the dot", () => {
    const state = (fields: Parameters<typeof makeSidebarThread>[0]) => spaceThreadState(makeSidebarThread({ isUnread: false, ...fields }));
    expect(state({ status: "active", hasPendingInteraction: true })).toBe("needs-you");
    expect(state({ indicator: "waiting-for-input" })).toBe("needs-you");
    expect(state({ status: "active", indicator: "unread-error" })).toBe("working");
    expect(state({ runtimeStatus: "provisioning" })).toBe("working");
    expect(state({ indicator: "unread-error" })).toBe("error");
    expect(state({ indicator: "unread-success" })).toBe("unread");
    expect(state({ isUnread: true })).toBe("unread");
    expect(state({})).toBe("idle");
  });

  it("writes a compact age", () => {
    const now = 1_000_000_000_000;
    expect(compactAge(now - 10_000, now)).toBe("now");
    expect(compactAge(now - 5 * 60_000, now)).toBe("5m");
    expect(compactAge(now - 3 * 3_600_000, now)).toBe("3h");
    expect(compactAge(now - 2 * 86_400_000, now)).toBe("2d");
    expect(compactAge(now - 15 * 86_400_000, now)).toBe("2w");
    expect(compactAge(now - 90 * 86_400_000, now)).toBe("3mo");
    expect(compactAge(now - 400 * 86_400_000, now)).toBe("1y");
  });

  it("asks for leads first, then by recency, capped", () => {
    const rest = Array.from({ length: 80 }, (_, index) => makeSidebarThread({ id: `t${index}`, updatedAt: index, latestAttentionAt: 0 }));
    const ids = threadLineIds([makeSidebarThread({ id: "lead", updatedAt: 0, latestAttentionAt: 0 })], rest);
    expect(ids).toHaveLength(THREAD_LINES_LIMIT);
    expect(ids.slice(0, 3)).toEqual(["lead", "t79", "t78"]);
  });
});

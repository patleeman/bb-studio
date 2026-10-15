import { describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => null, useBbNavigate: () => null }));
vi.mock("@bb-studio/kit/app", () => ({ BAR_BUTTON: "", Icon: () => null }));
vi.mock("@bb-studio/kit/format", () => ({ errorMessage: String }));

describe("opening a file with VS Code as the default", () => {
  it("goes straight to the thread's VS Code for files in the thread's folder or on its host", async () => {
    const { shouldAutoOpen } = await import("./file-opener");
    expect(shouldAutoOpen({ kind: "workspace", threadId: "thr_1" })).toBe(true);
    expect(shouldAutoOpen({ kind: "host", threadId: "thr_1" })).toBe(true);
  });

  it("stays on BB's preview with no thread, or for thread storage", async () => {
    const { shouldAutoOpen } = await import("./file-opener");
    expect(shouldAutoOpen({ kind: "workspace", threadId: null })).toBe(false);
    expect(shouldAutoOpen({ kind: "host", threadId: null })).toBe(false);
    expect(shouldAutoOpen({ kind: "thread-storage", threadId: "thr_1" })).toBe(false);
  });
});

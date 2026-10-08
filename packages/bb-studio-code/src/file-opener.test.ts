import { describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => null, useBbNavigate: () => null }));
vi.mock("@bb-studio/kit/app", () => ({ BAR_BUTTON: "", Icon: () => null }));
vi.mock("@bb-studio/kit/format", () => ({ errorMessage: String }));

describe("opening a file with VS Code as the default", () => {
  const rpcWith = (workspace: unknown, fail = false) => {
    const calls: string[] = [];
    return { calls, rpc: { call: async (method: string) => { calls.push(method); if (fail) throw new Error("down"); return { workspace }; } } };
  };

  it("leaves BB's preview alone and makes nothing when the thread has no workspace", async () => {
    const { openIfWorkspace } = await import("./file-opener");
    const { calls, rpc } = rpcWith(null);
    const open = vi.fn();
    expect(await openIfWorkspace(rpc as never, "thr_1", open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(calls).toEqual(["threadWorkspace"]);
  });

  it("sends the file to VS Code when the thread already has a workspace", async () => {
    const { openIfWorkspace } = await import("./file-opener");
    const { rpc } = rpcWith({ id: "ws_1" });
    const open = vi.fn();
    expect(await openIfWorkspace(rpc as never, "thr_1", open)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it("stays on BB's preview when Studio Code can't answer", async () => {
    const { openIfWorkspace } = await import("./file-opener");
    const { rpc } = rpcWith(null, true);
    const open = vi.fn();
    expect(await openIfWorkspace(rpc as never, "thr_1", open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

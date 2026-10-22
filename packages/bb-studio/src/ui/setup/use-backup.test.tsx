// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => rpc }));

const { useBackup } = await import("./use-backup");

test("a restore that fails its check deletes the uploaded file", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpc.call.mockImplementation(async (method: string) => {
    if (method === "backup.upload") return { uploadId: "up_1", received: 3 };
    if (method === "backup.restore") throw new Error("This isn't a backup file.");
    return { ok: true };
  });
  let api!: ReturnType<typeof useBackup>;
  function Probe() { api = useBackup(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(async () => { await api.plan(new File(["abc"], "x.zip")); });
  expect(api.state).toEqual({ step: "error", message: "This isn't a backup file." });
  expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_1" });
  act(() => root.unmount());
});

const result = { dryRun: true, createdAt: "2026-10-21", sections: [], projects: { mapped: 0, unmapped: [] }, text: "Plan", failed: false };
async function probe() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  rpc.call.mockClear();
  let api!: ReturnType<typeof useBackup>;
  function Probe() { api = useBackup(); return null; }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  return { get api() { return api; }, unmount: () => act(() => root.unmount()) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("confirm errors retain the plan and upload for retry or cancel", async () => {
  let fail = true;
  rpc.call.mockImplementation(async (method: string, input: { dryRun?: boolean }) => {
    if (method === "backup.upload") return { uploadId: "up_retry" };
    if (method === "backup.restore" && !input.dryRun && fail) throw new Error("Busy, try again");
    return result;
  });
  const x = await probe();
  try {
    await act(async () => { await x.api.plan(new File(["abc"], "retry.zip")); });
    await act(async () => { await x.api.confirm(); });
    expect(x.api.state).toMatchObject({ step: "planned", uploadId: "up_retry", error: "Busy, try again" });
    fail = false;
    await act(async () => { await x.api.confirm(); });
    expect(x.api.state).toMatchObject({ step: "restored", uploadId: null });
    await act(async () => { await x.api.plan(new File(["abc"], "cancel.zip")); });
    fail = true;
    await act(async () => { await x.api.confirm(); });
    await act(async () => x.api.cancel());
    expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_retry" });
  } finally { x.unmount(); }
});

test("replacing a plan and unmounting discard their independently owned uploads", async () => {
  let next = 0;
  rpc.call.mockImplementation(async (method: string) => method === "backup.upload" ? { uploadId: `up_${++next}` } : result);
  const x = await probe();
  await act(async () => { await x.api.plan(new File(["abc"], "first.zip")); });
  await act(async () => { await x.api.plan(new File(["abc"], "second.zip")); });
  expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_1" });
  x.unmount();
  expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_2" });
});

test("an upload completing after unmount is discarded", async () => {
  const pending = deferred<{ uploadId: string }>();
  const started = deferred<void>();
  rpc.call.mockImplementation(async (method: string) => {
    if (method === "backup.upload") { started.resolve(); return pending.promise; }
    return result;
  });
  const x = await probe();
  let sending!: Promise<void>;
  await act(async () => { sending = x.api.plan(new File(["abc"], "late.zip")); await started.promise; });
  x.unmount();
  await act(async () => { pending.resolve({ uploadId: "up_late" }); await sending; });
  expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_late" });
  expect(rpc.call).not.toHaveBeenCalledWith("backup.restore", expect.anything());
});

test("a superseded check cannot replace the newest plan", async () => {
  let next = 0;
  const pending = deferred<typeof result>();
  const started = deferred<void>();
  rpc.call.mockImplementation(async (method: string, input: { uploadId?: string }) => {
    if (method === "backup.upload") return { uploadId: `up_${++next}` };
    if (method === "backup.restore" && input.uploadId === "up_1") { started.resolve(); return pending.promise; }
    return result;
  });
  const x = await probe();
  try {
    let first!: Promise<void>;
    await act(async () => { first = x.api.plan(new File(["abc"], "first.zip")); await started.promise; });
    await act(async () => { await x.api.plan(new File(["abc"], "second.zip")); });
    await act(async () => { pending.resolve(result); await first; });
    expect(x.api.state).toMatchObject({ step: "planned", fileName: "second.zip", uploadId: "up_2" });
    expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_1" });
  } finally { x.unmount(); }
});

test("a cleanup failure preserves the original error and is retried on cancel", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  let cleanupFails = true;
  rpc.call.mockImplementation(async (method: string) => {
    if (method === "backup.upload") return { uploadId: "up_cleanup" };
    if (method === "backup.restore") throw new Error("Invalid backup");
    if (method === "backup.discard" && cleanupFails) throw new Error("Cleanup offline");
    return { ok: true };
  });
  const x = await probe();
  try {
    await act(async () => { await x.api.plan(new File(["abc"], "bad.zip")); });
    expect(x.api.state).toEqual({ step: "error", message: "Invalid backup" });
    expect(warning).toHaveBeenCalled();
    cleanupFails = false;
    await act(async () => x.api.cancel());
    expect(rpc.call.mock.calls.filter(([method]) => method === "backup.discard")).toHaveLength(2);
  } finally { x.unmount(); warning.mockRestore(); }
});

test("starting a backup discards the pending restore plan", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  rpc.call.mockImplementation(async (method: string) => {
    if (method === "backup.upload") return { uploadId: "up_replaced" };
    if (method === "backup.create") return { name: "backup.zip", bytes: 3, text: "Saved" };
    return result;
  });
  const x = await probe();
  try {
    await act(async () => { await x.api.plan(new File(["abc"], "plan.zip")); });
    await act(async () => { await x.api.backup(); });
    expect(x.api.state.step).toBe("backed-up");
    expect(rpc.call).toHaveBeenCalledWith("backup.discard", { uploadId: "up_replaced" });
  } finally { x.unmount(); click.mockRestore(); }
});

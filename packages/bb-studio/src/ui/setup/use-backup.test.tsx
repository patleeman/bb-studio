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

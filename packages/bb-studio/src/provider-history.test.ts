import { expect, it, vi } from "vitest";
import { ProviderHistory } from "./provider-history";

it("reads original artifact versions and bytes for canonical Studio refs", async () => {
  const callRpc = vi.fn(async ({ method }: { method: string }) => method === "get"
    ? { versions: [{ id: "v1", name: "report.txt", createdAt: 123 }] }
    : { bytes: Buffer.from("Preserved 雪").toString("base64") });
  const history = new ProviderHistory({ plugins: { callRpc } } as never);
  const ref = { pluginId: "studio", id: "art_0123456789abcdef" };
  const versions = await history.versions(ref);
  expect(versions).toMatchObject([{ id: "v1", ref, label: "report.txt", createdAt: 123 }]);
  expect(Buffer.from((await history.read(ref, "v1"))!).toString()).toBe("Preserved 雪");
  expect(callRpc.mock.calls.every(([args]) => args.method === "get" || args.method === "versionBytes")).toBe(true);
  expect(await history.versions({ pluginId: "studio", id: "tbl_1" })).toBeNull();
});

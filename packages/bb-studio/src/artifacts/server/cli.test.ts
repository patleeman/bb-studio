import { afterEach, expect, it } from "vitest";
import { artifactsHost } from "../test/host";

const hosts: ReturnType<typeof artifactsHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose(); });

it("bb studio artifacts list --thread outside a thread refuses instead of listing everything", async () => {
  const host = artifactsHost();
  hosts.push(host);
  await host.harness.behavior.callRpc("artifacts.importFile", { name: "elsewhere.txt", mime: "text/plain", bytes: Buffer.from("x").toString("base64"), projectId: null });
  const result = await host.artifacts.cli(["list", "--thread"], {} as never);
  expect(result.exitCode).toBe(1);
  expect(result.stdout ?? "").not.toContain("Elsewhere");
});

it("artifacts_save refuses inline content named . or ..", async () => {
  const host = artifactsHost();
  hosts.push(host);
  for (const name of ["..", "notes/..", "."]) {
    const result = await host.harness.behavior.callAgentTool("artifacts_save", { content: "x", name, title: "Dots" });
    expect(result).toMatchObject({ isError: true });
  }
  expect((await host.artifacts.cli(["list"], {} as never)).stdout).toBe("No artifacts yet.\n");
});

it("bb studio artifacts save refuses a file the host reports as over 25 MB before decoding it", async () => {
  const host = artifactsHost();
  hosts.push(host);
  const stub = host.harness.sdk.stub as unknown as (path: string, fn: () => unknown) => void;
  stub("threads.get", async () => ({ projectId: null, environment: { hostId: "local", path: "/work" } }));
  stub("threads.storageLocation", async () => { throw new Error("no storage"); });
  // Tiny content, but the host reports 26 MB: the size check must come first.
  stub("files.read", async () => ({ path: "/work/huge.bin", content: "AAAA", contentEncoding: "base64", sha256: "x", sizeBytes: 26 * 1024 * 1024 }));
  const result = await host.artifacts.cli(["save", "huge.bin"], { threadId: "thr_1", cwd: "/work" } as never);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("at most 25 MB");
  expect((await host.artifacts.cli(["list"], {} as never)).stdout).toBe("No artifacts yet.\n");
});

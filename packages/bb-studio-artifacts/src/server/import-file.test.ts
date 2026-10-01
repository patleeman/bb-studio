import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../../server";
import { MAX_ARTIFACT_BYTES } from "../shared";
import { memoryStore } from "../test/db";
import { importedFile } from "./import-file";

describe("importedFile", () => {
  it("exposes a validated RPC that can be read and deleted", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "artifacts" });
    await plugin(bb);
    try {
      const { id } = (await harness.behavior.callRpc("importFile", {
        name: "QA capture.txt", mime: "text/plain", bytes: Buffer.from("hello").toString("base64"), projectId: "proj_qa",
      })) as { id: string };
      const read = (await harness.behavior.callRpc("get", { id })) as {
        artifact: { projectId: string; version: { name: string } };
      };
      expect(read.artifact).toMatchObject({ projectId: "proj_qa", version: { name: "QA capture.txt" } });
      await harness.behavior.callRpc("delete", { id });
      expect(await harness.behavior.callRpc("get", { id })).toMatchObject({ artifact: null });
    } finally {
      await harness.lifecycle.dispose();
    }
  });

  it("saves binary bytes in a project as an app artifact", () => {
    const { store } = memoryStore();
    const file = importedFile({
      name: "folder/QA capture.png", mime: "application/octet-stream", bytes: Buffer.from([0, 1, 255]).toString("base64"),
    });
    const saved = store.save({ ...file, projectId: "proj_qa", by: "app" });
    expect(saved.artifact).toMatchObject({ project_id: "proj_qa", updated_by: "user" });
    expect(saved.artifact.version).toMatchObject({ name: "QA capture.png", mime: "image/png", size: 3 });
    expect(store.bytes(saved.artifact.version.sha256)).toEqual(Buffer.from([0, 1, 255]));
  });

  it("rejects malformed and oversized input before storing it", () => {
    expect(() => importedFile({ name: "a.txt", mime: "text/plain", bytes: "%%%=" })).toThrow("Invalid file data");
    expect(() => importedFile({
      name: "a.txt", mime: "text/plain", bytes: Buffer.alloc(MAX_ARTIFACT_BYTES + 1).toString("base64"),
    })).toThrow("at most 25 MB");
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "../../server";

it("merges a full scene file together with the image files its elements reference", async () => {
  const host = createFakePluginHost({ pluginId: "excalidraw", sdk: {
    plugins: { callRpc: async () => { throw new Error("Studio is optional"); } },
  } });
  await plugin(host.bb);
  const dir = mkdtempSync(join(tmpdir(), "draw-cli-"));
  try {
    const { drawing } = await host.harness.behavior.callRpc("createDrawing", { name: "Images" }) as { drawing: { id: string } };
    const file = { id: "f1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 };
    writeFileSync(join(dir, "scene.json"), JSON.stringify({ type: "excalidraw", elements: [{ id: "img", type: "image", fileId: "f1" }], files: { f1: file } }));
    const result = await host.harness.behavior.runCli(["merge", drawing.id, "scene.json"], { cwd: dir } as never);
    expect(result.exitCode).toBe(0);
    const stored = JSON.parse((await host.harness.behavior.callRpc("getDrawing", { id: drawing.id }) as { drawing: { data: string } }).drawing.data);
    expect(stored.files).toEqual({ f1: file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await host.harness.lifecycle.dispose();
  }
});

it("tells the agent when an upsert of a deleted element was not applied", async () => {
  const host = createFakePluginHost({ pluginId: "excalidraw", sdk: {
    plugins: { callRpc: async () => { throw new Error("Studio is optional"); } },
  } });
  await plugin(host.bb);
  try {
    const { drawing } = await host.harness.behavior.callRpc("createDrawing", { name: "Boxes" }) as { drawing: { id: string } };
    const call = (input: object) => host.harness.behavior.callAgentTool("excalidraw_update_drawing", { drawingId: drawing.id, ...input });
    await call({ elements: [{ id: "box1", type: "rectangle" }] });
    await call({ deletedElementIds: ["box1"] });
    const result = await call({ elements: [{ id: "box1", type: "rectangle", x: 10 }, { id: "box2", type: "rectangle" }] });
    expect(String(result)).toContain("upserted 1 element(s)");
    expect(String(result)).toContain("NOT applied: box1");
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("shows an agent the elements of a drawing with a large image, without the image data", async () => {
  const host = createFakePluginHost({ pluginId: "excalidraw", sdk: {
    plugins: { callRpc: async () => { throw new Error("Studio is optional"); } },
  } });
  await plugin(host.bb);
  try {
    const { drawing } = await host.harness.behavior.callRpc("createDrawing", { name: "Photo" }) as { drawing: { id: string } };
    const dataURL = `data:image/png;base64,${"A".repeat(500_000)}`;
    await host.harness.behavior.callAgentTool("excalidraw_update_drawing", {
      drawingId: drawing.id,
      elements: [{ id: "img", type: "image", fileId: "f1" }],
      files: { f1: { mimeType: "image/png", dataURL } },
    });
    const result = JSON.parse(String(await host.harness.behavior.callAgentTool("excalidraw_get_drawing", { drawingId: drawing.id })));
    expect(result.scene.elements.map((el: { id: string }) => el.id)).toEqual(["img"]);
    expect(result.scene.files).toEqual({ f1: { id: "f1", mimeType: "image/png", dataURLChars: dataURL.length } });
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

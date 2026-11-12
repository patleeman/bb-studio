import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it, vi } from "vitest";
import { MIGRATIONS } from "../migrations";
import { registerDraw } from "../draw/server";
import { registerArtifacts } from "../artifacts/server";
import { StudioServices } from "../services";
import { studioEmbeds } from "./embeds";

it("reads and edits built-in embeds in process and preserves read errors", async () => {
  const callRpc = vi.fn(async () => { throw new Error("RPC must not be used"); });
  const host = createFakePluginHost({ pluginId: "studio", sdk: { plugins: { callRpc } } });
  const db = host.bb.storage.database();
  for (const sql of MIGRATIONS) db.exec(sql);
  const services = new StudioServices(db);
  const draw = registerDraw(host.bb, db, services, async () => {});
  const artifacts = registerArtifacts(host.bb, db, services, async () => {});
  const recording = vi.fn(() => null);
  const embeds = studioEmbeds({
    items: async () => [], create: async () => { throw new Error("not in this test"); },
    drawing: draw.getDrawing, saveDrawing: draw.saveDrawing, artifact: artifacts.getArtifact,
    artifactText: artifacts.readText, recording,
  });
  try {
    const drawing = draw.store.create({ name: "Whiteboard", by: "app", projectId: null });
    const view = await embeds.saveWhiteboard(drawing.id, [{ id: "stroke_a", points: [[1, 1], [5, 5]], color: "#1e1e1e", width: 2 }], []);
    expect(view.markup).not.toBe("");
    expect(draw.getDrawing(drawing.id)?.data).toContain("stroke_a");
    expect(await embeds.whiteboard("missing")).toBeNull();
    await expect(embeds.saveWhiteboard("missing", [], [])).rejects.toThrow("gone");
    const { artifact } = artifacts.store.save({ name: "notes.md", mime: "text/markdown", bytes: Buffer.from("Latest content"), title: "Notes", projectId: null, by: "app" });
    expect(await embeds.artifactView(artifact.id)).toMatchObject({ name: "notes.md", type: "markdown", text: "Latest content" });
    expect(await embeds.recording("missing")).toBeNull();
    recording.mockImplementation(() => { throw new Error("recordings unavailable"); });
    await expect(embeds.recording("rec_a")).rejects.toThrow("recordings unavailable");
    expect(callRpc).not.toHaveBeenCalled();
  } finally { artifacts.dispose(); draw.dispose(); await host.harness.lifecycle.dispose(); }
});
